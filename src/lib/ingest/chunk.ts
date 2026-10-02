import type { Block } from "./blocks";

export interface Chunk {
  index: number;
  headingPath: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Soft upper bound; a chunk only exceeds it when a single unit is larger. */
  maxTokens?: number;
  /** Chunks below this are extended with the next unit of the same section. */
  minTokens?: number;
  /** Trailing units up to this size are repeated at the start of the next chunk. */
  overlapTokens?: number;
}

export const HEADING_SEPARATOR = " > ";

/** ~4 characters per token for English prose; good enough for sizing chunks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Unit {
  text: string;
  tokens: number;
  pages: number[];
  isStep: boolean;
}

function renderListItem(b: Extract<Block, { type: "list_item" }>): string {
  const marker = /^\d+[.)]$|^[a-z][.)]$|^Step/i.test(b.marker) ? b.marker : "-";
  return `${"  ".repeat(b.depth)}${marker} ${b.text}`;
}

function splitLongText(text: string, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  const parts: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && estimateTokens(buf + s) > maxTokens) {
      parts.push(buf.trim());
      buf = "";
    }
    buf += s;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/**
 * Turns a section's blocks into units that should not be split. A list item is
 * kept together with its nested sub-items, and the sentence that introduces a
 * list ("To issue a refund:") is attached to the first step so the steps never
 * lose their context.
 */
function toUnits(blocks: Block[], maxTokens: number): Unit[] {
  const units: Unit[] = [];
  for (const b of blocks) {
    if (b.type === "heading") continue;
    const pages = b.page ? [b.page] : [];
    if (b.type === "list_item") {
      const text = renderListItem(b);
      const prev = units.at(-1);
      if (b.depth > 0 && prev?.isStep) {
        prev.text += `\n${text}`;
        prev.tokens = estimateTokens(prev.text);
        prev.pages.push(...pages);
      } else if (prev && !prev.isStep && /:\s*$/.test(prev.text) && prev.tokens < maxTokens / 3) {
        prev.text += `\n${text}`;
        prev.tokens = estimateTokens(prev.text);
        prev.pages.push(...pages);
        prev.isStep = true;
      } else {
        units.push({ text, tokens: estimateTokens(text), pages, isStep: true });
      }
      continue;
    }
    for (const part of estimateTokens(b.text) > maxTokens ? splitLongText(b.text, maxTokens) : [b.text]) {
      units.push({ text: part, tokens: estimateTokens(part), pages: [...pages], isStep: false });
    }
  }
  return units;
}

interface Section {
  path: string[];
  blocks: Block[];
}

function toSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Section = { path: [], blocks: [] };

  for (const b of blocks) {
    if (b.type === "heading") {
      if (current.blocks.length) sections.push(current);
      while (stack.length && stack.at(-1)!.level >= b.level) stack.pop();
      stack.push({ level: b.level, text: b.text });
      current = { path: stack.map((s) => s.text), blocks: [] };
    } else {
      current.blocks.push(b);
    }
  }
  if (current.blocks.length) sections.push(current);
  return sections;
}

/**
 * Structure-first chunking for procedural documents: chunks never cross a
 * heading, every chunk records its full heading path, and numbered steps are
 * packed whole rather than cut at a token boundary.
 */
export function chunkBlocks(blocks: Block[], options: ChunkOptions = {}): Chunk[] {
  const { maxTokens = 500, minTokens = 120, overlapTokens = 60 } = options;
  const chunks: Chunk[] = [];

  for (const section of toSections(blocks)) {
    const units = toUnits(section.blocks, maxTokens);
    const headingPath = section.path.join(HEADING_SEPARATOR);
    let buf: Unit[] = [];
    let carried = 0; // units at the start of buf repeated from the previous chunk

    const emit = () => {
      if (buf.length === carried) return;
      const content = buf.map((u) => u.text).join("\n");
      const pages = buf.flatMap((u) => u.pages);
      chunks.push({
        index: chunks.length,
        headingPath,
        content,
        pageStart: pages.length ? Math.min(...pages) : null,
        pageEnd: pages.length ? Math.max(...pages) : null,
        tokenCount: estimateTokens(content),
      });
    };

    for (const unit of units) {
      const size = buf.reduce((n, u) => n + u.tokens, 0);
      if (buf.length > carried && size + unit.tokens > maxTokens && size >= minTokens) {
        emit();
        const last = buf.at(-1)!;
        buf = last.tokens <= overlapTokens ? [last] : [];
        carried = buf.length;
      }
      buf.push(unit);
    }
    emit();
  }
  return chunks;
}

/** Text that is embedded: the chunk prefixed with where it sits in the document. */
export function contextualText(documentTitle: string, chunk: Pick<Chunk, "headingPath" | "content">): string {
  const section = sectionPath(documentTitle, chunk.headingPath);
  const where = section ? `${documentTitle}${HEADING_SEPARATOR}${section}` : documentTitle;
  return `${where}\n\n${chunk.content}`;
}

/** The heading path without a leading document title, which most documents repeat as their first heading. */
export function sectionPath(documentTitle: string, headingPath: string): string {
  const parts = headingPath ? headingPath.split(HEADING_SEPARATOR) : [];
  if (parts[0]?.trim().toLowerCase() === documentTitle.trim().toLowerCase()) parts.shift();
  return parts.join(HEADING_SEPARATOR);
}
