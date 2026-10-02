/**
 * End-to-end check against a running app (seeded, MOCK_AI=1 recommended):
 *   BASE_URL=http://localhost:3000 pnpm e2e
 * Covers role-scoped answers with citations, "don't know" for documents a role
 * can't see, feedback, the admin upload/retire flow and gap analytics.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME = ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL - ${name}\n    ${(err as Error).message.split("\n")[0]}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function login(page: Page, label: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.waitForURL(/\/chat/);
}

async function ask(page: Page, question: string) {
  const before = await page.getByTestId("answer").count();
  await page.getByLabel("Ask a question").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.getByTestId("answer").nth(before);
  await answer.getByText("Was this helpful?").waitFor({ timeout: 30_000 });
  return answer;
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const uniq = Date.now().toString(36);

  console.log("staff");
  await login(page, "Staff");
  await check("answers a refund question with a cited source", async () => {
    const answer = await ask(page, "How do I process a refund over $500?");
    const text = await answer.innerText();
    assert(/RF-12/.test(text), `answer should mention form RF-12, got: ${text.slice(0, 200)}`);
    const chips = answer.getByRole("button", { name: /^Source \d+: / });
    assert((await chips.count()) > 0, "answer should have citation chips");
    const panel = page.getByRole("complementary", { name: "Sources" });
    assert(await panel.getByText("Refund and Returns Policy").first().isVisible(), "sources panel should show the policy");
  });
  await check("opening a source returns the original file", async () => {
    const href = await page.getByRole("complementary", { name: "Sources" }).getByRole("link", { name: /Open original/ }).first().getAttribute("href");
    assert(href?.startsWith("/api/documents/"), `unexpected link ${href}`);
    const res = await page.request.get(`${BASE}${href}`);
    assert(res.ok(), `open link returned ${res.status()}`);
    assert((await res.body()).length > 100, "file body should not be empty");
  });
  await check("feedback is saved with a reason", async () => {
    const answer = page.getByTestId("answer").last();
    await answer.getByRole("button", { name: "Not helpful" }).click();
    await answer.getByText("Outdated").click();
    await answer.getByPlaceholder(/What should the answer/).fill(`e2e ${uniq}`);
    await answer.getByRole("button", { name: "Send feedback" }).click();
    await answer.getByText(/documentation team will review/).waitFor();
  });
  await check("does not answer from an HR-only document", async () => {
    const answer = await ask(page, "How much notice is needed before a disciplinary hearing?");
    const text = await answer.innerText();
    assert(/Not in the knowledge base/.test(text), `staff should get no answer, got: ${text.slice(0, 200)}`);
    assert(!/48 hours/.test(text), "HR content leaked to staff");
  });

  console.log("hr");
  await login(page, "HR");
  await check("HR gets the HR policy answer with a page citation", async () => {
    const answer = await ask(page, "How much notice is needed before a disciplinary hearing?");
    const text = await answer.innerText();
    assert(/48 hours/.test(text), `HR should get the 48 hour rule, got: ${text.slice(0, 200)}`);
    const panel = page.getByRole("complementary", { name: "Sources" });
    assert(await panel.getByText("HR Leave and Disciplinary Policy").first().isVisible(), "should cite the HR policy");
    assert(await panel.getByText(/p\. \d/).first().isVisible(), "PDF citation should show a page");
  });
  await check("non-admins can't open the admin panel", async () => {
    await page.goto(`${BASE}/admin/documents`);
    await page.waitForURL(/\/chat/);
  });

  console.log("admin");
  await login(page, "Admin");
  const title = `Parking Policy ${uniq}`;
  await check("uploads and indexes a new document", async () => {
    await page.goto(`${BASE}/admin/documents`);
    await page.getByRole("button", { name: "Upload document" }).click();
    const file = path.join(process.cwd(), ".local-stack", `parking-${uniq}.md`);
    writeFileSync(
      file,
      `# Parking Policy\n\n## Visitor parking\n\nStaff park in the rear car park, level 2. Visitor bays at the front are reserved for clients. Request a permit code PK-${uniq} from reception.\n`,
    );
    await page.locator("#file").setInputFiles(file);
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Upload and index" }).click();
    await page.getByText(/was indexed and is now searchable/).waitFor({ timeout: 30_000 });
    const row = page.getByRole("row", { name: new RegExp(title) });
    await row.getByText("Active", { exact: false }).waitFor({ timeout: 10_000 });
  });
  await check("a new document answers questions", async () => {
    await page.goto(`${BASE}/chat`);
    const answer = await ask(page, `Where do staff park? permit PK-${uniq}`);
    assert(/rear car park/.test(await answer.innerText()), "should answer from the parking policy");
  });
  await check("retiring a document removes it from answers", async () => {
    await page.goto(`${BASE}/admin/documents`);
    const row = page.getByRole("row", { name: new RegExp(title) });
    await row.getByRole("button", { name: "Retire" }).click();
    await page.getByText(/^Retired “/).waitFor();
    await page.goto(`${BASE}/chat`);
    const answer = await ask(page, `Where do staff park? permit PK-${uniq}`);
    assert(!/rear car park/.test(await answer.innerText()), "retired content should not be used");
  });
  await check("analytics lists unanswered questions as gaps", async () => {
    await page.goto(`${BASE}/admin/analytics?days=7`);
    await page.getByRole("heading", { name: "Knowledge gaps", exact: true }).waitFor();
    assert(await page.getByText(`Where do staff park? permit PK-${uniq}`).first().isVisible(), "retired-doc question should be a gap");
    assert(await page.getByText(/^Outdated$/).first().isVisible(), "feedback reason should be listed");
  });
  await check("cleanup: delete the test document", async () => {
    await page.goto(`${BASE}/admin/documents`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("row", { name: new RegExp(title) }).getByRole("button", { name: "Delete" }).click();
    await page.getByText(/^Deleted “/).waitFor();
  });

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
