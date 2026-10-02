-- Knowledge Hub: schema, row-level security and retrieval functions.
--
-- Access control lives here, not in application code: every table has RLS on,
-- and retrieval (match_chunks) runs as the calling user, so a chunk is only
-- ever returned when that user may see the document it came from.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Roles and profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  roles text[] not null default '{staff}',
  created_at timestamptz not null default now(),
  constraint profiles_roles_valid check (
    cardinality(roles) > 0
    and roles <@ array['staff', 'manager', 'hr', 'admin']::text[]
  )
);

-- Roles come from app_metadata (only settable with the service role), never
-- from user_metadata, which a user can write at sign-up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  initial_roles text[];
begin
  select coalesce(array_agg(r), '{staff}')
    into initial_roles
    from jsonb_array_elements_text(coalesce(new.raw_app_meta_data -> 'roles', '[]'::jsonb)) as r
   where r in ('staff', 'manager', 'hr', 'admin');

  insert into public.profiles (id, email, full_name, roles)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    initial_roles
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.current_user_roles() returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce((select roles from public.profiles where id = auth.uid()), '{}'::text[]);
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select 'admin' = any (public.current_user_roles());
$$;

-- ---------------------------------------------------------------------------
-- Documents and chunks
-- ---------------------------------------------------------------------------

create type public.document_status as enum ('processing', 'active', 'retired', 'failed');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  department text,
  source_filename text not null,
  mime_type text not null,
  storage_path text,
  version integer not null default 1,
  checksum text,
  allowed_roles text[] not null default '{staff,manager,hr,admin}',
  status public.document_status not null default 'processing',
  error text,
  chunk_count integer not null default 0,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint documents_roles_valid check (
    cardinality(allowed_roles) > 0
    and allowed_roles <@ array['staff', 'manager', 'hr', 'admin']::text[]
  )
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index integer not null,
  heading_path text not null default '',
  page_start integer,
  page_end integer,
  content text not null,
  token_count integer not null default 0,
  embedding extensions.vector(768) not null,
  fts tsvector generated always as (
    to_tsvector('english', heading_path || ' ' || content)
  ) stored,
  unique (document_id, chunk_index)
);

create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_document_idx on public.document_chunks (document_id);
create index documents_status_idx on public.documents (status);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Chat, feedback and query logs
-- ---------------------------------------------------------------------------

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]',
  answered boolean,
  created_at timestamptz not null default now()
);

create index messages_session_idx on public.messages (session_id, created_at);
create index chat_sessions_user_idx on public.chat_sessions (user_id, updated_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  reason text check (reason in ('wrong', 'missing', 'outdated', 'unclear', 'other')),
  comment text,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table public.query_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  question text not null,
  normalized_question text not null,
  top_similarity double precision,
  chunk_count integer not null default 0,
  answered boolean not null,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index query_logs_created_idx on public.query_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages enable row level security;
alter table public.feedback enable row level security;
alter table public.query_logs enable row level security;

-- Profiles: read your own; admins read and change everyone's. Users cannot
-- change their own roles.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Documents: visible when active and shared with one of your roles. Admins see
-- every document (including retired and failed) and manage them.
create policy documents_select on public.documents for select to authenticated
  using (
    public.is_admin()
    or (status = 'active' and allowed_roles && public.current_user_roles())
  );
create policy documents_admin_write on public.documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Chunks inherit visibility from their document (the subquery is itself
-- filtered by the documents policy).
create policy chunks_select on public.document_chunks for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));
create policy chunks_admin_write on public.document_chunks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Chat history is private to its owner; admins can read messages so they can
-- review answers that received negative feedback.
create policy sessions_owner on public.chat_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_select on public.messages for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid())
  );
create policy messages_insert on public.messages for insert to authenticated
  with check (
    exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid())
  );

create policy feedback_select on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy feedback_insert on public.feedback for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.chat_sessions s on s.id = m.session_id
      where m.id = message_id and s.user_id = auth.uid()
    )
  );
create policy feedback_update on public.feedback for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy query_logs_insert on public.query_logs for insert to authenticated
  with check (user_id = auth.uid());
create policy query_logs_admin_select on public.query_logs for select to authenticated
  using (public.is_admin());

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Retrieval
-- ---------------------------------------------------------------------------

-- Hybrid search: vector similarity and full-text rank, fused with Reciprocal
-- Rank Fusion. Full text catches exact form names, codes and step numbers that
-- embeddings blur. SECURITY INVOKER so the caller's RLS filters the results.
create function public.match_chunks(
  query_embedding extensions.vector(768),
  query_text text,
  match_count integer default 8,
  rrf_k integer default 50
)
returns table (
  id uuid,
  document_id uuid,
  document_title text,
  mime_type text,
  heading_path text,
  page_start integer,
  page_end integer,
  content text,
  similarity double precision,
  rank_score double precision
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with keyword_query as (
    -- OR the question's terms together: natural-language questions rarely
    -- contain every word of the passage that answers them.
    select case
      when plainto_tsquery('english', query_text)::text = '' then null
      else to_tsquery('english', replace(plainto_tsquery('english', query_text)::text, '&', '|'))
    end as q
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) as rank_ix
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
     where d.status = 'active'
     order by c.embedding <=> query_embedding
     limit match_count * 3
  ),
  keyword as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, kq.q) desc) as rank_ix
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
      cross join keyword_query kq
     where d.status = 'active' and kq.q is not null and c.fts @@ kq.q
     order by ts_rank_cd(c.fts, kq.q) desc
     limit match_count * 3
  )
  select c.id,
         c.document_id,
         d.title,
         d.mime_type,
         c.heading_path,
         c.page_start,
         c.page_end,
         c.content,
         1 - (c.embedding <=> query_embedding) as similarity,
         coalesce(1.0 / (rrf_k + s.rank_ix), 0.0)
           + coalesce(1.0 / (rrf_k + k.rank_ix), 0.0) as rank_score
    from semantic s
    full outer join keyword k on k.id = s.id
    join public.document_chunks c on c.id = coalesce(s.id, k.id)
    join public.documents d on d.id = c.document_id
   order by rank_score desc
   limit match_count;
$$;

grant execute on function public.match_chunks(extensions.vector, text, integer, integer) to authenticated;

-- Swaps a document's chunks in one transaction, so a re-index or new version
-- never leaves the document half-indexed. Ingestion only (service role).
create function public.replace_document_chunks(
  p_document_id uuid,
  p_chunks jsonb,
  p_status public.document_status default 'active'
)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  delete from public.document_chunks where document_id = p_document_id;

  insert into public.document_chunks
    (document_id, chunk_index, heading_path, page_start, page_end, content, token_count, embedding)
  select p_document_id,
         (c ->> 'chunk_index')::integer,
         coalesce(c ->> 'heading_path', ''),
         (c ->> 'page_start')::integer,
         (c ->> 'page_end')::integer,
         c ->> 'content',
         coalesce((c ->> 'token_count')::integer, 0),
         (c ->> 'embedding')::extensions.vector
    from jsonb_array_elements(p_chunks) as c;

  update public.documents
     set status = p_status,
         error = null,
         chunk_count = jsonb_array_length(p_chunks),
         retired_at = case when p_status = 'retired' then coalesce(retired_at, now()) else null end
   where id = p_document_id;
end;
$$;

revoke execute on function public.replace_document_chunks(uuid, jsonb, public.document_status) from public, anon, authenticated;
grant execute on function public.replace_document_chunks(uuid, jsonb, public.document_status) to service_role;

-- ---------------------------------------------------------------------------
-- Analytics (admin only)
-- ---------------------------------------------------------------------------

create function public.admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => p_days);
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'questions', count(*),
        'answered', count(*) filter (where answered),
        'unanswered', count(*) filter (where not answered),
        'users', count(distinct user_id)
      )
      from public.query_logs where created_at >= since
    ),
    'feedback', (
      select jsonb_build_object(
        'up', count(*) filter (where rating = 'up'),
        'down', count(*) filter (where rating = 'down'),
        'by_reason', coalesce((
          select jsonb_object_agg(reason, n) from (
            select coalesce(reason, 'unspecified') as reason, count(*) as n
              from public.feedback
             where rating = 'down' and created_at >= since
             group by 1
          ) r
        ), '{}'::jsonb)
      )
      from public.feedback where created_at >= since
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'answered', answered, 'unanswered', unanswered) order by day)
      from (
        select date_trunc('day', created_at)::date as day,
               count(*) filter (where answered) as answered,
               count(*) filter (where not answered) as unanswered
          from public.query_logs where created_at >= since
         group by 1
      ) d
    ), '[]'::jsonb),
    'top_questions', coalesce((
      select jsonb_agg(t order by t.count desc, t.last_asked desc)
      from (
        select normalized_question as question,
               (array_agg(question order by created_at desc))[1] as example,
               count(*) as count,
               round(avg(case when answered then 1 else 0 end)::numeric, 2) as answer_rate,
               max(created_at) as last_asked
          from public.query_logs where created_at >= since
         group by normalized_question
         order by count(*) desc, max(created_at) desc
         limit 15
      ) t
    ), '[]'::jsonb),
    'gaps', coalesce((
      select jsonb_agg(g order by g.count desc, g.last_asked desc)
      from (
        select normalized_question as question,
               (array_agg(question order by created_at desc))[1] as example,
               count(*) as count,
               max(top_similarity) as best_similarity,
               max(created_at) as last_asked
          from public.query_logs
         where created_at >= since and not answered
         group by normalized_question
         order by count(*) desc, max(created_at) desc
         limit 50
      ) g
    ), '[]'::jsonb),
    'negative_feedback', coalesce((
      select jsonb_agg(f order by f.created_at desc)
      from (
        select fb.id, fb.reason, fb.comment, fb.created_at,
               m.content as answer,
               (select q.question from public.query_logs q where q.message_id = m.id limit 1) as question
          from public.feedback fb
          join public.messages m on m.id = fb.message_id
         where fb.rating = 'down' and fb.created_at >= since
         order by fb.created_at desc
         limit 50
      ) f
    ), '[]'::jsonb),
    'top_documents', coalesce((
      select jsonb_agg(td order by td.citations desc)
      from (
        select c ->> 'documentId' as document_id,
               max(c ->> 'documentTitle') as title,
               count(*) as citations
          from public.messages m
          cross join jsonb_array_elements(m.citations) as c
         where m.role = 'assistant' and m.created_at >= since
         group by 1
         order by count(*) desc
         limit 10
      ) td
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_analytics(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for original files. Staff never read it directly;
-- the app issues short-lived signed URLs after an RLS-checked document read.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy documents_bucket_admin on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.is_admin())
  with check (bucket_id = 'documents' and public.is_admin());
