/**
 * Generates the demo documents in samples/ from the Markdown sources in
 * samples/src, as real PDF and DOCX files so the seed exercises every parser.
 *   pnpm make-samples
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const ROOT = path.resolve(__dirname, "..", "samples");
const manifest: { source: string; file: string }[] = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

type Line =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ol"; n: number; text: string }
  | { kind: "ul"; text: string }
  | { kind: "table"; rows: string[][] };

function parse(md: string): Line[] {
  const out: Line[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) out.push({ kind: "h", level: m[1].length, text: m[2] });
    else if ((m = /^(\d+)\.\s+(.*)$/.exec(line))) out.push({ kind: "ol", n: Number(m[1]), text: m[2] });
    else if ((m = /^-\s+(.*)$/.exec(line))) out.push({ kind: "ul", text: m[1] });
    else if (line.startsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      const last = out.at(-1);
      if (last?.kind === "table") last.rows.push(cells);
      else out.push({ kind: "table", rows: [cells] });
    } else out.push({ kind: "p", text: line });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function toPdf(lines: Line[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 64, width = W - M * 2;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const ensure = (h: number) => {
    if (y - h < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const draw = (text: string, font: PDFFont, size: number, indent = 0, gapAfter = 4) => {
    for (const l of wrap(text, font, size, width - indent)) {
      ensure(size + 4);
      page.drawText(l, { x: M + indent, y: y - size, size, font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    }
    y -= gapAfter;
  };

  // Spread the first document over more than one page so page citations are visible.
  for (const line of lines) {
    if (line.kind === "h") {
      const size = line.level === 1 ? 20 : line.level === 2 ? 14 : 12;
      if (line.level === 2 && y < H / 2) ensure(H);
      y -= line.level === 1 ? 0 : 8;
      draw(line.text, bold, size, 0, 6);
    } else if (line.kind === "p") draw(line.text, regular, 10.5, 0, 8);
    else if (line.kind === "ol") draw(`${line.n}. ${line.text}`, regular, 10.5, 12, 3);
    else if (line.kind === "ul") draw(`• ${line.text}`, regular, 10.5, 12, 3);
    else if (line.kind === "table") for (const r of line.rows) draw(r.join("   "), regular, 10.5, 0, 3);
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`${i + 1}`, { x: W / 2, y: M / 2, size: 9, font: regular, color: rgb(0.45, 0.45, 0.45) }),
  );
  return pdf.save();
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

async function toDocx(lines: Line[]): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  let listInstance = 0;
  let prevKind = "";
  for (const line of lines) {
    if (line.kind === "ol" && prevKind !== "ol") listInstance++;
    prevKind = line.kind;
    if (line.kind === "h") {
      const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][line.level - 1];
      children.push(new Paragraph({ text: line.text, heading }));
    } else if (line.kind === "p") children.push(new Paragraph({ children: [new TextRun(line.text)] }));
    else if (line.kind === "ol")
      children.push(new Paragraph({ text: line.text, numbering: { reference: "steps", level: 0, instance: listInstance } }));
    else if (line.kind === "ul") children.push(new Paragraph({ text: line.text, bullet: { level: 0 } }));
    else if (line.kind === "table")
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: line.rows.map(
            (r, i) =>
              new TableRow({
                children: r.map(
                  (c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, bold: i === 0 })] })] }),
                ),
              }),
          ),
        }),
      );
  }
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "steps",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function main() {
  for (const item of manifest) {
    const md = readFileSync(path.join(ROOT, "src", item.source), "utf8");
    const out = path.join(ROOT, item.file);
    const ext = path.extname(item.file);
    if (ext === ".pdf") writeFileSync(out, await toPdf(parse(md)));
    else if (ext === ".docx") writeFileSync(out, await toDocx(parse(md)));
    else writeFileSync(out, md);
    console.log(`wrote samples/${item.file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
