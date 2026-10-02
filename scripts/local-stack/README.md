# Local stack without Docker

`supabase start` (Docker) is the normal way to run this project locally. This
folder is a fallback for machines and CI runners that have PostgreSQL but no
Docker: it runs the real Supabase Auth (GoTrue) and PostgREST binaries against
a local Postgres, behind a small gateway that serves them on the usual
`/auth/v1` and `/rest/v1` paths and emulates the handful of Storage endpoints
the app uses (upload, list, remove, download, signed URLs) on local disk.

Requirements: PostgreSQL 15+ with pgvector, Node 20+, and network access to
GitHub releases on first run.

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/local-stack/start.sh
# prints the .env.local values to use, then keeps running; Ctrl+C stops it
```

The Storage emulation is for development and tests only. It does not implement
RLS on storage objects; the app only touches storage with the service-role key.
