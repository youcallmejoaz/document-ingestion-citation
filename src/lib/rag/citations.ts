import { sectionPath } from "@/lib/ingest/chunk";
import type { Citation, MatchedChunk } from "@/lib/types";

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Source numbers referenced in the text, in order of first appearance. */
export function extractCitationIndices(text: string): number[] {
  const seen = new Set<number>();
  for (const match of text.matchAll(MARKER)) {
    for (const part of match[1].split(",")) {
      seen.add(Number(part.trim()));
    }
  }
  return [...seen];
}

/**
 * Removes markers that point at sources that don't exist (a model can invent
 * [9] when only 5 sources were given) and normalises "[1, 2]" to "[1][2]".
 */
export function cleanCitationMarkers(text: string, sourceCount: number): string {
  return text.replace(MARKER, (_, group: string) =>
    group
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount)
      .map((n) => `[${n}]`)
      .join(""),
  );
}

export function snippetOf(content: string, max = 320): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max)}…`;
}

export function documentLink(documentId: string, pageStart: number | null): string {
  return `/api/documents/${documentId}/open${pageStart ? `?page=${pageStart}` : ""}`;
}

/** Maps the markers used in an answer to the chunks they refer to. */
export function resolveCitations(text: string, sources: MatchedChunk[]): Citation[] {
  return extractCitationIndices(text)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length)
    .sort((a, b) => a - b)
    .map((n) => {
      const c = sources[n - 1];
      return {
        index: n,
        chunkId: c.id,
        documentId: c.document_id,
        documentTitle: c.document_title,
        headingPath: sectionPath(c.document_title, c.heading_path),
        pageStart: c.page_start,
        pageEnd: c.page_end,
        snippet: snippetOf(c.content),
        url: documentLink(c.document_id, c.page_start),
      };
    });
}
