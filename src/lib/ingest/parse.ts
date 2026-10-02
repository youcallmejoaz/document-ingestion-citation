import type { Block } from "./blocks";

export const SUPPORTED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
};

export function mimeTypeFor(filename: string, fallback?: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = SUPPORTED_TYPES[ext];
  if (mime) return mime;
  if (fallback && Object.values(SUPPORTED_TYPES).includes(fallback)) return fallback;
  throw new Error(`Unsupported file type ".${ext}". Upload PDF, DOCX, Markdown or plain text.`);
}

export async function parseDocument(data: Uint8Array, mimeType: string): Promise<Block[]> {
  switch (mimeType) {
    case SUPPORTED_TYPES.pdf:
      return parsePdf(data);
    case SUPPORTED_TYPES.docx:
      return parseDocx(data);
    case "text/markdown":
    case "text/plain":
      return parseMarkdown(new TextDecoder().decode(data));
    default:
      throw new Error(`Unsupported MIME type ${mimeType}`);
  }
}

// ---------------------------------------------------------------------------
// Markdown / plain text
// ---------------------------------------------------------------------------

const LIST_ITEM = /^(\s*)([-*+•]|\d+[.)]|[a-z][.)])\s+(.*)$/;

export function parseMarkdown(text: string, page?: number): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let inFence = false;

  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ").trim(), page });
    para = [];
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      para.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = LIST_ITEM.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].replace(/#+$/, "").trim(), page });
    } else if (item) {
      flush();
      blocks.push({
        type: "list_item",
        marker: item[2],
        depth: Math.floor(item[1].replace(/\t/g, "  ").length / 2),
        text: item[3].trim(),
        page,
      });
    } else if (/^\s{2,}\S/.test(line) && blocks.at(-1)?.type === "list_item" && para.length === 0) {
      // Indented continuation of the previous list item.
      const last = blocks.at(-1) as Extract<Block, { type: "list_item" }>;
      last.text += ` ${line.trim()}`;
    } else if (/^\s*\|?\s*:?-{3,}/.test(line)) {
      // Table separator row: skip.
    } else {
      para.push(line.trim().replace(/^\|\s*|\s*\|$/g, "").replace(/\s*\|\s*/g, " | "));
    }
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// DOCX (Word, and Google Docs exported as .docx)
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Walks mammoth's simple HTML output into blocks, keeping list numbering. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let current: { kind: "heading" | "paragraph" | "list_item"; level: number; text: string } | null = null;
  let cell = false;

  const flush = () => {
    if (!current) return;
    const text = decodeEntities(current.text).replace(/\s+/g, " ").trim();
    if (text) {
      if (current.kind === "heading") blocks.push({ type: "heading", level: current.level, text });
      else if (current.kind === "list_item") {
        const list = lists.at(-1);
        blocks.push({
          type: "list_item",
          text,
          marker: list?.ordered ? `${list.n}.` : "-",
          depth: Math.max(0, lists.length - 1),
        });
      } else blocks.push({ type: "paragraph", text });
    }
    current = null;
  };

  const re = /<(\/?)([a-z0-9]+)[^>]*>|([^<]+)/gi;
  for (const m of html.matchAll(re)) {
    const [, closing, tagRaw, text] = m;
    if (text !== undefined) {
      if (!current) current = { kind: "paragraph", level: 0, text: "" };
      current.text += text;
      continue;
    }
    const tag = tagRaw.toLowerCase();
    const open = !closing;
    if (/^h[1-6]$/.test(tag)) {
      flush();
      if (open) current = { kind: "heading", level: Number(tag[1]), text: "" };
    } else if (tag === "p") {
      if (cell) continue;
      // A <p> inside <li> continues the list item.
      if (open && current?.kind === "list_item") continue;
      if (!open && current?.kind === "list_item") continue;
      flush();
      if (open) current = { kind: "paragraph", level: 0, text: "" };
    } else if (tag === "ol" || tag === "ul") {
      flush();
      if (open) lists.push({ ordered: tag === "ol", n: 0 });
      else lists.pop();
    } else if (tag === "li") {
      flush();
      if (open) {
        const list = lists.at(-1);
        if (list) list.n += 1;
        current = { kind: "list_item", level: 0, text: "" };
      }
    } else if (tag === "tr") {
      flush();
      if (open) current = { kind: "paragraph", level: 0, text: "" };
    } else if (tag === "td" || tag === "th") {
      cell = open;
      if (open && current && current.text.trim()) current.text += " | ";
    } else if (tag === "br" && current) {
      current.text += " ";
    }
  }
  flush();
  return blocks;
}

async function parseDocx(data: Uint8Array): Promise<Block[]> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
  return htmlToBlocks(value);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

// "2 Procedure" or "2.1 Approval limits" is a heading; "2. Call the manager"
// (number followed by a dot) is a step.
const PDF_NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\s+([A-Z][^.!?:]{2,80})$/;
const PDF_LIST_ITEM = /^([-•▪●*]|\d+[.)]|[a-z][.)]|Step\s+\d+[:.])\s+(.*)$/;

function isAllCapsHeading(line: string): boolean {
  return line.length >= 4 && line.length <= 70 && /[A-Z]/.test(line) && line === line.toUpperCase() && !/[.!?]$/.test(line);
}

/**
 * PDFs carry no structure, so headings are recovered heuristically: numbered
 * section titles ("2.1 Approval limits") and short ALL-CAPS lines. Wrapped
 * lines are rejoined until a sentence ends or a new item starts.
 */
export function pdfPagesToBlocks(pages: string[]): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null;

  const close = () => {
    if (open && open.type !== "heading" && open.text.trim()) blocks.push(open);
    open = null;
  };

  pages.forEach((pageText, i) => {
    const page = i + 1;
    for (const raw of pageText.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) {
        close();
        continue;
      }
      if (/^(page\s+)?\d+(\s*(of|\/)\s*\d+)?$/i.test(line)) continue; // page numbers

      const numbered = PDF_NUMBERED_HEADING.exec(line);
      const item = PDF_LIST_ITEM.exec(line);
      const isTitle = blocks.length === 0 && !open && line.length <= 80 && !/[.!?:,]$/.test(line) && !item;
      if (isTitle) {
        blocks.push({ type: "heading", level: 1, text: line, page });
      } else if (numbered && !/[.!?]$/.test(line) && numbered[1].split(".").length <= 3 && line.length <= 90) {
        close();
        blocks.push({ type: "heading", level: numbered[1].split(".").length + 1, text: line, page });
      } else if (isAllCapsHeading(line)) {
        close();
        blocks.push({ type: "heading", level: 1, text: line, page });
      } else if (item) {
        close();
        open = { type: "list_item", marker: item[1], depth: 0, text: item[2], page };
      } else if (open && !/[.!?:]$/.test((open as { text: string }).text)) {
        (open as { text: string }).text += ` ${line}`;
      } else {
        close();
        open = { type: "paragraph", text: line, page };
      }
    }
    close();
  });
  return blocks;
}

async function parsePdf(data: Uint8Array): Promise<Block[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return pdfPagesToBlocks(text);
}
