import { describe, expect, it } from "vitest";
import { chunkBlocks, contextualText } from "./chunk";
import { parseMarkdown } from "./parse";

const SOP = `# Refund Policy

## Eligibility

Customers can request a refund within 30 days of purchase.

## Approval

To issue a refund:

1. Open the order in the billing system.
2. Check the purchase date is within 30 days.
3. Refunds over $500 need manager approval on form RF-12.
   Attach the receipt to the form.
4. Issue the refund and email the customer.

### Exceptions

Damaged items are refunded without a time limit.
`;

describe("chunkBlocks", () => {
  const chunks = chunkBlocks(parseMarkdown(SOP));

  it("never crosses a heading and records the full heading path", () => {
    expect(chunks.map((c) => c.headingPath)).toEqual([
      "Refund Policy > Eligibility",
      "Refund Policy > Approval",
      "Refund Policy > Approval > Exceptions",
    ]);
  });

  it("keeps the lead-in sentence and every step together", () => {
    const approval = chunks[1].content;
    expect(approval).toMatch(/^To issue a refund:\n1\. Open the order/);
    expect(approval).toContain("3. Refunds over $500 need manager approval on form RF-12. Attach the receipt to the form.");
    expect(approval).toContain("4. Issue the refund");
  });

  it("splits long step lists between steps, not inside them", () => {
    const steps = Array.from({ length: 40 }, (_, i) => `${i + 1}. ${"Do the next part of the procedure carefully. ".repeat(3)}`);
    const md = `# Long SOP\n\n${steps.join("\n")}\n`;
    const out = chunkBlocks(parseMarkdown(md), { maxTokens: 200, minTokens: 50, overlapTokens: 0 });
    expect(out.length).toBeGreaterThan(3);
    for (const c of out) {
      for (const line of c.content.split("\n")) expect(line).toMatch(/^\d+\. Do the next part/);
      expect(c.tokenCount).toBeLessThanOrEqual(200);
    }
    // Every step appears exactly once when there's no overlap.
    expect(out.flatMap((c) => c.content.split("\n")).length).toBe(40);
  });

  it("repeats a short trailing step as overlap", () => {
    const steps = Array.from({ length: 12 }, (_, i) => `${i + 1}. Step number ${i + 1} of the process.`);
    const out = chunkBlocks(parseMarkdown(`# S\n\n${steps.join("\n")}`), { maxTokens: 40, minTokens: 10, overlapTokens: 20 });
    expect(out.length).toBeGreaterThan(1);
    const lastOfFirst = out[0].content.split("\n").at(-1);
    expect(out[1].content.split("\n")[0]).toBe(lastOfFirst);
  });

  it("splits an oversized paragraph on sentence boundaries", () => {
    const para = "This sentence is part of a very long policy paragraph. ".repeat(80);
    const out = chunkBlocks(parseMarkdown(`# P\n\n${para}`), { maxTokens: 150 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.content.trim()).toMatch(/\.$/);
  });

  it("tracks page ranges", () => {
    const out = chunkBlocks([
      { type: "heading", level: 1, text: "Intro", page: 1 },
      { type: "paragraph", text: "First page text.", page: 1 },
      { type: "paragraph", text: "Second page text.", page: 2 },
    ]);
    expect(out[0]).toMatchObject({ pageStart: 1, pageEnd: 2 });
  });

  it("prefixes embedded text with the document and section", () => {
    expect(contextualText("Refund Policy", chunks[0])).toMatch(/^Refund Policy > Eligibility\n\nCustomers/);
    expect(contextualText("Other Title", chunks[0])).toMatch(/^Other Title > Refund Policy > Eligibility\n/);
  });
});
