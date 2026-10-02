export const ROLES = ["staff", "manager", "hr", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type DocumentStatus = "processing" | "active" | "retired" | "failed";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  roles: Role[];
  created_at: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  department: string | null;
  source_filename: string;
  mime_type: string;
  storage_path: string | null;
  version: number;
  checksum: string | null;
  allowed_roles: Role[];
  status: DocumentStatus;
  error: string | null;
  chunk_count: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

/** A row returned by the match_chunks RPC. */
export interface MatchedChunk {
  id: string;
  document_id: string;
  document_title: string;
  mime_type: string;
  heading_path: string;
  page_start: number | null;
  page_end: number | null;
  content: string;
  similarity: number;
  rank_score: number;
}

/** A source the assistant cited, as stored on the message and sent to the UI. */
export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  snippet: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  answered: boolean | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
}

/** Newline-delimited JSON events streamed by POST /api/chat. */
export type ChatStreamEvent =
  | { type: "start"; sessionId: string; userMessageId: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      messageId: string;
      content: string;
      citations: Citation[];
      answered: boolean;
    }
  | { type: "error"; message: string };
