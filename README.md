# Knowledge Hub: a secure internal assistant for SOPs and onboarding

A private assistant that answers staff questions from company SOPs, policies, service standards, templates and onboarding material. Every answer cites the passages it came from and links back to the original document. Staff only get answers from documents their role is allowed to see. When the documents don't cover a question, the assistant says so and logs the question as a knowledge gap.

![Chat with cited sources](docs/screenshots/chat-citations.png)

| | |
|---|---|
| ![Not in the knowledge base](docs/screenshots/chat-not-in-knowledge-base.png) | ![Admin documents](docs/screenshots/admin-documents.png) |
| A staff member asks about an HR-only policy: no answer, no leak, gap logged | Upload, version, re-index, retire and set access per document |
| ![Analytics](docs/screenshots/admin-analytics-dark.png) | ![Mobile](docs/screenshots/chat-mobile.png) |
| Usage, answer rate, knowledge gaps and negative feedback | Works on a phone; sources sit under the answer |

> The screenshots were captured in offline demo mode (`MOCK_AI=1`), where the "model" builds answers by quoting the retrieved passages. With a Gemini key, answers are written by the model from the same sources, under the same citation rules.

## The problem

Documentation was spread across folders and drives. New staff asked the same questions again and again, and senior team members lost time answering them.

## What it does

- **Document ingestion** for PDF, Word (.docx), Markdown and plain text. Google Docs work when exported as .docx. Originals are kept in private storage.
- **Chunking tuned for procedures.** Chunks follow the heading structure, keep numbered steps whole, carry the full section path (for example "3 Procedure > 3.1 Before the kickoff call") and record page numbers for PDFs.
- **Hybrid retrieval.** Vector similarity (pgvector) is fused with Postgres full-text search, so exact form names and codes such as `RF-12` are found even when embeddings blur them.
- **Grounded answers with citations.** The model answers only from the retrieved passages and cites each sentence. Each citation shows the document, section, page and quoted passage, plus an **Open original** link to that page of the PDF.
- **"I don't know" instead of guessing.** If retrieval finds nothing relevant, the model is never called. If the passages don't answer the question, the model must return a sentinel, which the app turns into a clear "not in the knowledge base" reply.
- **Role-based access at retrieval time.** Postgres row-level security filters documents and chunks inside the search query itself. Content from a document you can't see never reaches the model.
- **Admin panel.** Upload, replace with a new version (swapped in atomically), re-index, retire or restore, change which roles can see a document (no re-indexing needed), delete, and manage users and roles.
- **Feedback.** Thumbs up/down on every answer. A thumbs-down asks why: wrong, missing info, outdated, unclear or other, with an optional comment.
- **Analytics.** Question volume, answer rate, top questions, knowledge gaps (exportable as CSV), feedback by reason, and the most-cited documents.

## Architecture

```mermaid
flowchart LR
  subgraph Admin["Admin panel"]
    U[Upload / new version]
  end
  subgraph Ingest["Ingestion (Next.js route, Node)"]
    P[Parse<br/>PDF · DOCX · MD] --> C[Chunk by headings<br/>keep steps whole] --> E[Embed<br/>Gemini embedding 768-d]
  end
  subgraph Supabase["Supabase (client's own project)"]
    S[(Storage<br/>private originals)]
    DB[(Postgres + pgvector<br/>documents · chunks · RLS)]
    A[Auth<br/>roles in app_metadata]
    L[(query_logs · feedback)]
  end
  subgraph Ask["Chat (Next.js)"]
    Q[Question] --> QE[Embed query]
    QE --> R["match_chunks()<br/>hybrid search, runs as the user<br/>so RLS filters by role"]
    R -->|below threshold| N["Not in the knowledge base<br/>(model not called)"]
    R -->|relevant passages| G[LLM answers only from<br/>numbered sources, cites each claim]
    G --> V[Validate citations<br/>drop unknown markers]
    V --> UI[Answer + source cards<br/>+ Open original]
  end
  U --> S
  U --> P
  E -->|atomic replace| DB
  A -.-> R
  DB --> R
  N --> L
  UI --> L
  UI -->|signed URL after RLS check| S
```

**Ingestion.** An admin uploads a file. It's stored in a private bucket, parsed into structural blocks and chunked. Each chunk is embedded with its document title and section path prepended, which helps retrieval on short SOP sections. All of a document's chunks are written in one transaction (`replace_document_chunks`), so a new version never leaves a document half-indexed. While the new version is processed, the old version keeps answering questions.

**Asking.** The question is embedded and `match_chunks` runs through the signed-in user's Supabase client. It's a `SECURITY INVOKER` function, so row-level security restricts results to active documents shared with one of the user's roles. Results are fused from vector and keyword rankings with Reciprocal Rank Fusion. If the best match is below `MIN_SIMILARITY`, the app replies "not in the knowledge base" without calling the model. Otherwise up to eight passages go to the model as numbered `<source>` blocks, and the answer streams back to the browser. Citation markers are checked against the sources that were actually sent. The answer, citations and a query log row are saved.

**Short follow-ups** ("what about over $500?") are searched together with the previous question. That avoids a second model call to rewrite the question, which matters on the Gemini free tier.

## Accuracy and security safeguards

| Safeguard | How it's enforced |
|---|---|
| Answers only from retrieved documents | System prompt rules, numbered sources, citation validation. Only the latest question carries sources. |
| Says it doesn't know | Similarity threshold before any model call, plus a `NOT_FOUND` sentinel the model must use when the sources don't answer. Both are logged as knowledge gaps. |
| Access control at retrieval time | Postgres RLS on `documents` and `document_chunks`; `match_chunks` runs as the user. Covered by `supabase/tests/rls_test.sql`. |
| Roles can't be self-assigned | Roles come from Auth `app_metadata`, which only the service role can write, never from `user_metadata`. Users can't update their own profile roles. |
| Prompt injection from documents | Source text is fenced in `<source>` tags, attempts to close the tag are escaped, and the model is told to treat source text as data. |
| Original files stay private | Private bucket; "Open original" issues a 2-minute signed URL only after an RLS-checked read of the document. |
| Data stays in the client's infrastructure | Documents, embeddings, chats and logs live in the client's own Supabase project. Only the question and retrieved passages are sent to the model provider. See the note below. |
| Chat privacy | Users see only their own conversations. Admins can read all messages, so they can review answers that got negative feedback and fix the source documents. Tighten `messages_select` if that's too broad for your organisation. |

> **Gemini free tier and confidential data.** On the free tier, Google may use prompts and responses to improve its products. That's fine for this demo, which uses sample documents only. For real company documents, use a paid Gemini API tier or Vertex AI, where prompts aren't used for training. Or set `LLM_PROVIDER=anthropic` to answer with Claude. Embeddings still use Gemini in that case, so the same terms apply to the text being indexed.

## Tech stack

- **Next.js 15** (App Router, TypeScript, Tailwind CSS 4). Streaming route handlers on the Node runtime.
- **Supabase**: Postgres with **pgvector** (HNSW index), Auth, Storage, row-level security.
- **Gemini** via `@google/genai`: `gemini-embedding-001` at 768 dimensions for embeddings, and a Flash model for answers (free tier).
- **Claude** (optional) via `@anthropic-ai/sdk`: `LLM_PROVIDER=anthropic` answers with `claude-opus-5-5`, with server-side refusal fallback enabled.
- Parsing: `unpdf` (text per page), `mammoth` (DOCX to HTML, keeps headings and lists).
- Tests: Vitest (unit), SQL assertions (RLS and retrieval), Playwright (end to end).

## Getting started

### 1. Install

```bash
pnpm install
cp .env.example .env.local
```

### 2. Start Supabase

With Docker, use the Supabase CLI. It applies `supabase/migrations` automatically:

```bash
npx supabase start
npx supabase status   # copy the API URL, anon key and service_role key into .env.local
```

Without Docker (needs Postgres 15+ with pgvector), use the bundled local stack. It runs the real Supabase Auth and PostgREST binaries; see [scripts/local-stack/README.md](scripts/local-stack/README.md):

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/local-stack/start.sh
# copy the printed keys into .env.local
```

For a hosted Supabase project, run the migration with `npx supabase db push` (or paste it into the SQL editor), then copy the project's URL and keys.

### 3. Add an AI key, or use offline mode

Get a free key at [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY` in `.env.local`. To try everything without a key, set `MOCK_AI=1`. That switches to deterministic local embeddings and extractive answers.

### 4. Seed and run

```bash
pnpm seed                    # demo users + six sample SOPs, indexed through the real pipeline
pnpm seed --demo-activity    # optional: 30 days of synthetic usage for the analytics page
pnpm dev
```

Open http://localhost:3000 and use a demo account. All of them use the password `demo-password`.

| Account | Roles | Can get answers from |
|---|---|---|
| staff@demo.local | staff | General SOPs and policies |
| manager@demo.local | staff, manager | + Incident Escalation SOP |
| hr@demo.local | staff, hr | + HR Leave and Disciplinary Policy |
| admin@demo.local | staff, admin | Everything, plus the admin panel |

The demo login buttons appear when `NEXT_PUBLIC_DEMO_MODE=1`. Turn that off, and never seed demo users, in a real deployment.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | | Server-only. Ingestion, signed URLs, user creation |
| `GEMINI_API_KEY` | | Embeddings and (by default) answers |
| `GEMINI_MODEL` | `gemini-flash-latest` | Answer model |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Embedding model (768-d output). Changing it means re-indexing |
| `LLM_PROVIDER` | `gemini` | `gemini` or `anthropic` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-opus-5-5` | Used when `LLM_PROVIDER=anthropic` |
| `MIN_SIMILARITY` | `0.6` (`0.12` in mock mode) | Best-match similarity needed before the model is called |
| `MATCH_COUNT` | `8` | Passages retrieved per question |
| `MOCK_AI` | `0` | `1` = offline embeddings and answers |
| `NEXT_PUBLIC_DEMO_MODE` | `0` | Show demo account buttons on the login page |

**Tune `MIN_SIMILARITY` on your own documents.** Too high and good questions get "not in the knowledge base". Too low and the model sees weak passages, though it should still refuse rather than guess. The "Closest match" column on the analytics page shows the best similarity for each unanswered question, which is a quick way to pick the cut-off.

## Tests

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit: chunker, parsers, citations, prompt, retrieval decisions
pnpm test:db                               # schema, RLS and hybrid search against Postgres + pgvector
pnpm e2e                                   # Playwright, against a running seeded app (MOCK_AI=1)
```

The database suite checks, among other things, that:
- staff get no HR chunks from `match_chunks`
- retired documents disappear from retrieval for everyone, admins included
- a role change applies immediately
- users can't grant themselves roles
- feedback can only be left on your own messages

The end-to-end suite logs in as each demo role and checks:
- cited answers, and that "Open original" serves the file
- feedback is saved
- staff are refused on HR-only content, and HR are answered
- upload, retire and delete work, and the knowledge-gaps report picks up the questions

`pnpm screenshots` regenerates the images in `docs/screenshots`.

## Project structure

```
src/app/api/chat/route.ts          streaming answer endpoint
src/app/api/admin/…                document and user management
src/app/api/documents/[id]/open    signed link to the original file
src/lib/ingest/                    parsers, chunker, ingestion pipeline
src/lib/rag/                       retrieval, prompt, citation handling
src/lib/ai/                        Gemini, Anthropic and offline providers
src/components/chat/               chat UI, citation chips, sources, feedback
src/components/admin/              documents, users, analytics charts
supabase/migrations/               schema, RLS, match_chunks, analytics
supabase/tests/                    RLS and retrieval assertions
samples/                           sample SOPs (PDF, DOCX, MD) and their sources
scripts/                           seed, sample generation, e2e, screenshots, local stack
```

## Limits and next steps

- **Google Drive and SharePoint sync** aren't built yet. The pipeline already takes a file, its type and its access roles, so a connector only needs to list changed files (Drive changes API or Microsoft Graph delta queries), download or export them, and call the same ingestion code on a schedule.
- **Scanned PDFs** have no text layer, so they need OCR before upload. The app reports "No text could be extracted" rather than indexing an empty document.
- **Ingestion runs inside the upload request.** That's fine for SOP-sized files. Very large libraries would move it to a background queue (Supabase Queues or a worker).
- **The free tier rate-limits requests.** Ingestion retries with backoff, and chat shows a "try again in a minute" message on a 429.
