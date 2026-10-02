/** Structural pieces a parser extracts from a document, before chunking. */
export type Block =
  | { type: "heading"; level: number; text: string; page?: number }
  | { type: "paragraph"; text: string; page?: number }
  | { type: "list_item"; text: string; marker: string; depth: number; page?: number };
