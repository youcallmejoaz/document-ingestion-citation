-- RLS and retrieval checks. Run with scripts/test-db.sh (plain Postgres) or
-- against local Supabase:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

create or replace function pg_temp.vec(seed float) returns extensions.vector
language sql as $$
  select ('[' || string_agg(round(sin(seed * i)::numeric, 5)::text, ',') || ']')::extensions.vector
    from generate_series(1, 768) as i
$$;

create or replace function pg_temp.assert(ok boolean, msg text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

create or replace function pg_temp.login(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'staff@test',   '{"roles":["staff"]}',          '{"full_name":"Sam Staff"}'),
  ('00000000-0000-0000-0000-00000000000b', 'hr@test',      '{"roles":["staff","hr"]}',     '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'admin@test',   '{"roles":["admin"]}',          '{}'),
  -- user_metadata must not be able to grant roles
  ('00000000-0000-0000-0000-00000000000d', 'sneaky@test',  '{}',                           '{"roles":["admin"]}');

insert into public.documents (id, title, source_filename, mime_type, allowed_roles, status) values
  ('10000000-0000-0000-0000-000000000001', 'Refund Policy',   'refund.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '{staff,manager,hr,admin}', 'processing'),
  ('10000000-0000-0000-0000-000000000002', 'HR Leave Policy', 'leave.pdf',   'application/pdf', '{hr,admin}', 'processing'),
  ('10000000-0000-0000-0000-000000000003', 'Old Refund SOP',  'old.pdf',     'application/pdf', '{staff,manager,hr,admin}', 'processing');

select public.replace_document_chunks('10000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('chunk_index', 0, 'heading_path', 'Refunds > Approval',
    'content', 'Refunds over 500 dollars need manager approval using form RF-12.', 'token_count', 14,
    'embedding', pg_temp.vec(1.0)::text)));
select public.replace_document_chunks('10000000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('chunk_index', 0, 'heading_path', 'Leave > Disciplinary',
    'content', 'Disciplinary hearings require 48 hours written notice.', 'token_count', 9,
    'embedding', pg_temp.vec(1.0)::text)));
select public.replace_document_chunks('10000000-0000-0000-0000-000000000003',
  jsonb_build_array(jsonb_build_object('chunk_index', 0, 'heading_path', 'Refunds',
    'content', 'Old rule: refunds over 100 dollars need director approval.', 'token_count', 10,
    'embedding', pg_temp.vec(1.0)::text)), 'retired');

select pg_temp.assert((select roles from public.profiles where email = 'staff@test') = '{staff}', 'profile created with app_metadata roles');
select pg_temp.assert((select roles from public.profiles where email = 'sneaky@test') = '{staff}', 'user_metadata cannot grant roles');
select pg_temp.assert((select status from public.documents where id = '10000000-0000-0000-0000-000000000003') = 'retired', 'replace_document_chunks sets status');

-- ---- staff ----
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert((select count(*) from public.documents) = 1, 'staff sees only active docs shared with staff');
select pg_temp.assert((select count(*) from public.document_chunks) = 1, 'staff sees only chunks of visible docs');
select pg_temp.assert(
  (select count(*) from public.match_chunks(pg_temp.vec(1.0), 'disciplinary hearing notice', 10)) = 1,
  'staff match_chunks returns no HR or retired chunks');
select pg_temp.assert(
  (select bool_and(document_title = 'Refund Policy') from public.match_chunks(pg_temp.vec(1.0), 'refund approval', 10)),
  'staff match_chunks returns the active refund doc');
select pg_temp.assert(
  (select heading_path from public.match_chunks(pg_temp.vec(2.0), 'RF-12 form', 10) limit 1) = 'Refunds > Approval',
  'keyword search finds exact form codes');
select pg_temp.assert((select count(*) from public.profiles) = 1, 'staff sees only own profile');

do $$ begin
  update public.profiles set roles = '{admin}' where id = auth.uid();
  if (select roles from public.profiles where id = auth.uid()) <> '{staff}' then
    raise exception 'FAIL: staff escalated own roles';
  end if;
  raise notice 'ok - staff cannot change own roles';
end $$;

do $$ begin
  begin
    perform public.replace_document_chunks('10000000-0000-0000-0000-000000000001', '[]'::jsonb);
    raise exception 'FAIL: staff could call replace_document_chunks';
  exception when insufficient_privilege then
    raise notice 'ok - staff cannot call replace_document_chunks';
  end;
  begin
    perform public.admin_analytics(30);
    raise exception 'FAIL: staff could read analytics';
  exception when insufficient_privilege then
    raise notice 'ok - staff cannot read analytics';
  end;
end $$;

-- chat + feedback ownership
insert into public.chat_sessions (id, title) values ('20000000-0000-0000-0000-000000000001', 'Refunds');
insert into public.messages (id, session_id, role, content, citations, answered) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'assistant', 'Use RF-12 [1].',
   '[{"index":1,"documentId":"10000000-0000-0000-0000-000000000001","documentTitle":"Refund Policy"}]', true);
insert into public.feedback (message_id, rating, reason) values ('30000000-0000-0000-0000-000000000001', 'down', 'outdated');
insert into public.query_logs (message_id, question, normalized_question, top_similarity, chunk_count, answered)
  values ('30000000-0000-0000-0000-000000000001', 'How do I refund?', 'how do i refund', 0.81, 1, true),
         (null, 'What is the parking policy?', 'what is the parking policy', 0.2, 0, false);
select pg_temp.assert((select count(*) from public.query_logs) = 0, 'staff cannot read query logs');

reset role;

-- ---- hr ----
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.assert((select count(*) from public.documents) = 2, 'hr sees refund + HR docs');
select pg_temp.assert(
  (select count(*) from public.match_chunks(pg_temp.vec(1.0), 'disciplinary', 10)) = 2,
  'hr match_chunks includes HR chunk');
select pg_temp.assert((select count(*) from public.chat_sessions) = 0, 'hr cannot see staff chat sessions');
select pg_temp.assert((select count(*) from public.messages) = 0, 'hr cannot see staff messages');
do $$ begin
  begin
    insert into public.feedback (message_id, rating) values ('30000000-0000-0000-0000-000000000001', 'up');
    raise exception 'FAIL: hr left feedback on another user''s message';
  exception when insufficient_privilege then
    raise notice 'ok - feedback limited to own messages';
  end;
end $$;
reset role;

-- ---- admin ----
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.assert((select count(*) from public.documents) = 3, 'admin sees every document incl. retired');
select pg_temp.assert(
  (select count(*) from public.match_chunks(pg_temp.vec(1.0), 'refund', 10)) = 2,
  'admin retrieval still excludes retired docs');
select pg_temp.assert((public.admin_analytics(30) -> 'totals' ->> 'questions')::int = 2, 'analytics counts questions');
select pg_temp.assert((public.admin_analytics(30) -> 'gaps' -> 0 ->> 'question') = 'what is the parking policy', 'analytics lists gaps');
select pg_temp.assert((public.admin_analytics(30) -> 'feedback' -> 'by_reason' ->> 'outdated')::int = 1, 'analytics groups feedback reasons');
select pg_temp.assert((public.admin_analytics(30) -> 'top_documents' -> 0 ->> 'title') = 'Refund Policy', 'analytics counts cited docs');
update public.documents set allowed_roles = '{staff,hr,admin}' where id = '10000000-0000-0000-0000-000000000002';
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert((select count(*) from public.documents) = 2, 'role change applies immediately without re-indexing');
reset role;

-- ---- anon ----
set local role anon;
do $$ begin
  begin
    perform count(*) from public.documents;
    raise exception 'FAIL: anon read documents';
  exception when insufficient_privilege then
    raise notice 'ok - anon has no table access';
  end;
end $$;
reset role;

rollback;
