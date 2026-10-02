import { describe, expect, it } from "vitest";
import { htmlToBlocks, mimeTypeFor, parseMarkdown, pdfPagesToBlocks } from "./parse";

describe("parseMarkdown", () => {
  it("reads headings, nested lists and paragraphs", () => {
    const blocks = parseMarkdown("# Title\n\nIntro line one\nline two.\n\n1. First\n   - sub item\n2. Second\n");
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Title", page: undefined },
      { type: "paragraph", text: "Intro line one line two.", page: undefined },
      { type: "list_item", marker: "1.", depth: 0, text: "First", page: undefined },
      { type: "list_item", marker: "-", depth: 1, text: "sub item", page: undefined },
      { type: "list_item", marker: "2.", depth: 0, text: "Second", page: undefined },
    ]);
  });

  it("flattens tables into readable rows", () => {
    const blocks = parseMarkdown("| Level | Limit |\n|---|---|\n| Agent | $100 |\n");
    expect(blocks).toEqual([{ type: "paragraph", text: "Level | Limit Agent | $100", page: undefined }]);
  });
});

describe("htmlToBlocks (DOCX via mammoth)", () => {
  it("keeps headings and numbers ordered list items", () => {
    const html =
      "<h1>Leave</h1><p>Book leave early.</p><ol><li>Open the HR portal</li><li><p>Pick dates</p><ul><li>Check the team calendar</li></ul></li></ol>" +
      "<table><tr><td>Type</td><td>Days</td></tr><tr><td>Annual</td><td>25</td></tr></table>";
    expect(htmlToBlocks(html)).toEqual([
      { type: "heading", level: 1, text: "Leave" },
      { type: "paragraph", text: "Book leave early." },
      { type: "list_item", text: "Open the HR portal", marker: "1.", depth: 0 },
      { type: "list_item", text: "Pick dates", marker: "2.", depth: 0 },
      { type: "list_item", text: "Check the team calendar", marker: "-", depth: 1 },
      { type: "paragraph", text: "Type | Days" },
      { type: "paragraph", text: "Annual | 25" },
    ]);
  });

  it("decodes entities", () => {
    expect(htmlToBlocks("<p>Terms &amp; conditions &lt;v2&gt;</p>")).toEqual([
      { type: "paragraph", text: "Terms & conditions <v2>" },
    ]);
  });
});

describe("pdfPagesToBlocks", () => {
  it("recovers numbered headings, steps and wrapped lines", () => {
    const blocks = pdfPagesToBlocks([
      "INCIDENT ESCALATION SOP\n1 Purpose\nThis procedure explains how to\nescalate incidents.\n2 Procedure\n1. Log the incident in the\nservice desk.\n2. Call the duty manager.\n1",
      "2.1 Severity levels\nSev 1 means full outage.",
    ]);
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "INCIDENT ESCALATION SOP", page: 1 },
      { type: "heading", level: 2, text: "1 Purpose", page: 1 },
      { type: "paragraph", text: "This procedure explains how to escalate incidents.", page: 1 },
      { type: "heading", level: 2, text: "2 Procedure", page: 1 },
      { type: "list_item", marker: "1.", depth: 0, text: "Log the incident in the service desk.", page: 1 },
      { type: "list_item", marker: "2.", depth: 0, text: "Call the duty manager.", page: 1 },
      { type: "heading", level: 3, text: "2.1 Severity levels", page: 2 },
      { type: "paragraph", text: "Sev 1 means full outage.", page: 2 },
    ]);
  });
});

describe("mimeTypeFor", () => {
  it("accepts supported extensions and rejects others", () => {
    expect(mimeTypeFor("SOP.PDF")).toBe("application/pdf");
    expect(mimeTypeFor("notes.md")).toBe("text/markdown");
    expect(() => mimeTypeFor("sheet.xlsx")).toThrow(/Unsupported/);
  });
});

describe("pdfPagesToBlocks title", () => {
  it("treats a short first line as the document title", () => {
    expect(pdfPagesToBlocks(["Refund Policy\nOwner: Finance. Version 2.\n1 Scope\nAll staff."]).slice(0, 2)).toEqual([
      { type: "heading", level: 1, text: "Refund Policy", page: 1 },
      { type: "paragraph", text: "Owner: Finance. Version 2.", page: 1 },
    ]);
  });
});
