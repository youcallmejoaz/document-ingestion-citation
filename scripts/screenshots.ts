/**
 * Captures the portfolio screenshots into docs/screenshots. Run against a
 * freshly seeded app:  pnpm seed --reset --demo-activity && pnpm screenshots
 */
import { existsSync, mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";
const CHROME = ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);

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
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  for (const scheme of ["light", "dark"] as const) {
    const suffix = scheme === "dark" ? "-dark" : "";
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/login`);
    await page.screenshot({ path: `${OUT}/login${suffix}.png` });

    await login(page, "Staff");
    await page.screenshot({ path: `${OUT}/chat-empty${suffix}.png` });
    const answer = await ask(page, "How do I process a refund over $500?");
    await answer.getByRole("button", { name: /^Source 1: / }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/chat-citations${suffix}.png` });

    await ask(page, "How much notice is needed before a disciplinary hearing?");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/chat-not-in-knowledge-base${suffix}.png` });

    await login(page, "Admin");
    await page.goto(`${BASE}/admin/documents`);
    await page.screenshot({ path: `${OUT}/admin-documents${suffix}.png` });
    await page.goto(`${BASE}/admin/analytics?days=30`);
    await page.getByRole("heading", { name: "Questions per day" }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/admin-analytics${suffix}.png`, fullPage: true });
    await page.goto(`${BASE}/admin/users`);
    await page.screenshot({ path: `${OUT}/admin-users${suffix}.png` });
    await ctx.close();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await mobile.newPage();
  await login(page, "HR");
  const answer = await ask(page, "How many days of annual leave do we get?");
  await answer.getByRole("button", { name: /^Source 1: / }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/chat-mobile.png` });

  await browser.close();
  console.log(`Screenshots written to ${OUT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
