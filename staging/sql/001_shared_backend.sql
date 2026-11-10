-- TianRui baseball v1.5  |  SQL staging migration (not yet applied)
-- Create ONLY in a dedicated, personally-owned Supabase project, not an unrelated company organization.
-- Requires two MANUALLY provisioned Supabase Auth users (admin, shared recorder).
-- Before opening to users, disable public signups in Auth settings.
-- Never put team names, passwords, auth emails or service-role keys in public GitHub.

begin;

create table if not exists public.tr_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('admin','recorder')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.tr_documents (
  doc_key text primary key check (doc_key in ('roster','schedule')),
  document jsonb not null default '{}'::jsonb check (jsonb_typeof(document) = 'object'),
  revision bigint not null default 1 check (revision >= 1),
  modified_by uuid not null references auth.users(id),
  recorder_name text not null check (length(btrim(recorder_name)) between 1 and 32),
  updated_at timestamptz not null default now()
);
create table if not exists public.tr_games (
  game_id text primary key check (game_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  state jsonb not null check (jsonb_typeof(state)='object'),
  revision bigint not null default 1 check (revision >= 1),
  modified_by uuid not null references auth.users(id),
  recorder_name text not null check (length(btrim(recorder_name)) between 1 and 32),
  updated_at timestamptz not null default now(),
  constraint tr_state_id_match check (state->>'id'=game_id)
);
create table if not exists public.tr_leases (
  game_id text primary key references public.tr_games(game_id) on delete cascade,
  holder_token uuid not null,
  holder_name text not null check (length(btrim(holder_name)) between 1 and 32),
  held_by uuid not null references auth.users(id),
  expires_at timestamptz not null
);
create table if not exists public.tr_audit (
  id bigint generated always as identity primary key,
  operation_id uuid not null unique,
  object_type text not null check (object_type in ('game','roster','schedule')),
  object_id text not null,
  actor_id uuid not null references auth.users(id),
  recorder_name text not null check (length(btrim(recorder_name)) between 1 and 32),
  operation text not null,
  revision_before bigint not null,
  revision_after bigint not null,
  occurred_at timestamptz not null default now()
);
create index if not exists tr_games_updated_at_idx on public.tr_games(updated_at desc);
create index if not exists tr_audit_object_idx on public.tr_audit(object_type,object_id,occurred_at desc);

alter table public.tr_members enable row level security;
alter table public.tr_documents enable row level security;
alter table public.tr_games enable row level security;
alter table public.tr_leases enable row level security;
alter table public.tr_audit enable row level security;

-- Minimize PostgREST surface: public client only SELECTs own membership & protected content.
revoke all on table public.tr_members, public.tr_documents, public.tr_games,
 public.tr_leases, public.tr_audit from anon, authenticated;
grant select on public.tr_members, public.tr_documents, public.tr_games,
 public.tr_audit to authenticated;
-- Lease holder_token is private: NEVER grant SELECT on tr_leases to authenticated.

create policy tr_members_self_read on public.tr_members
 for select to authenticated using (user_id = (select auth.uid()));
create policy tr_docs_members_read on public.tr_documents
 for select to authenticated using (
  exists(select 1 from public.tr_members m where m.user_id=(select auth.uid()) and m.enabled)
 );
create policy tr_games_members_read on public.tr_games
 for select to authenticated using (
  exists(select 1 from public.tr_members m where m.user_id=(select auth.uid()) and m.enabled)
 );
create policy tr_audit_members_read on public.tr_audit
 for select to authenticated using (
  exists(select 1 from public.tr_members m where m.user_id=(select auth.uid()) and m.enabled)
 );

-- This function bypasses table RLS, therefore MUST strictly check auth.uid and role
-- and be executable only by authenticated users. Invoker cannot write tables directly.
create or replace function public.tr_member_role()
returns text language plpgsql stable security definer set search_path = '' as $$
declare r text;
begin
  if (select auth.uid()) is null then raise exception 'NOT_AUTHENTICATED' using errcode='42501'; end if;
  select m.member_role into r from public.tr_members m
  where m.user_id=(select auth.uid()) and m.enabled;
  if r is null then raise exception 'NOT_APPROVED' using errcode='42501'; end if;
  return r;
end; $$;

create or replace function public.tr_save_document(
  p_key text, p_expected_revision bigint, p_document jsonb,
  p_recorder_name text, p_operation_id uuid, p_operation text
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare r bigint; existing bigint; user_role text;
begin
  user_role := public.tr_member_role();
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'INVALID_REVISION'; end if;
  if p_key not in ('roster','schedule') then raise exception 'INVALID_DOC_KEY'; end if;
  if p_key='schedule' and user_role <> 'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' then raise exception 'INVALID_DOCUMENT'; end if;
  if length(btrim(coalesce(p_recorder_name,''))) not between 1 and 32 then raise exception 'RECORDER_REQUIRED'; end if;
  if p_operation_id is null or length(btrim(coalesce(p_operation,''))) not between 1 and 60 then raise exception 'INVALID_OPERATION'; end if;
  select a.revision_after into existing from public.tr_audit a
    where a.operation_id=p_operation_id and a.object_type=p_key and a.object_id=p_key;
  if found then return existing; end if;
  select d.revision into r from public.tr_documents d where d.doc_key=p_key for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'REVISION_CONFLICT'; end if;
    insert into public.tr_documents(doc_key,document,revision,modified_by,recorder_name)
      values(p_key,p_document,1,(select auth.uid()),btrim(p_recorder_name));
    r := 1;
  else
    if r <> p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
    update public.tr_documents set document=p_document,revision=r+1,
      modified_by=(select auth.uid()),recorder_name=btrim(p_recorder_name),updated_at=now()
      where doc_key=p_key;
    r := r+1;
  end if;
  insert into public.tr_audit(operation_id,object_type,object_id,actor_id,recorder_name,operation,revision_before,revision_after)
  values(p_operation_id,p_key,p_key,(select auth.uid()),btrim(p_recorder_name),btrim(p_operation),p_expected_revision,r);
  return r;
end; $$;

-- Add games by saving initial state at revision 0; gameplay lease then becomes available.
create or replace function public.tr_create_game(
  p_game_id text,p_state jsonb,p_recorder_name text,p_operation_id uuid
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare existing bigint;
begin
  perform public.tr_member_role();
  if p_game_id is null or p_game_id !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'INVALID_GAME_ID'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or p_state->>'id' is distinct from p_game_id then raise exception 'INVALID_GAME_STATE'; end if;
  if length(btrim(coalesce(p_recorder_name,''))) not between 1 and 32 then raise exception 'RECORDER_REQUIRED'; end if;
  if p_operation_id is null then raise exception 'INVALID_OPERATION'; end if;
  select revision_after into existing from public.tr_audit where operation_id=p_operation_id
    and object_type='game' and object_id=p_game_id;
  if found then return existing; end if;
  insert into public.tr_games(game_id,state,revision,modified_by,recorder_name)
   values(p_game_id,p_state,1,(select auth.uid()),btrim(p_recorder_name));
  insert into public.tr_audit(operation_id,object_type,object_id,actor_id,recorder_name,operation,revision_before,revision_after)
   values(p_operation_id,'game',p_game_id,(select auth.uid()),btrim(p_recorder_name),'CREATE',0,1);
  return 1;
end; $$;

-- Per-game single active writer. Non-writers can keep reading via RLS.
-- Token identifies tab/device, NOT a replacement for Supabase Auth.
create or replace function public.tr_acquire_lease(
  p_game_id text,p_holder_token uuid,p_recorder_name text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare acquired boolean;
begin
  perform public.tr_member_role();
  if p_holder_token is null then raise exception 'INVALID_HOLDER'; end if;
  if length(btrim(coalesce(p_recorder_name,''))) not between 1 and 32 then raise exception 'RECORDER_REQUIRED'; end if;
  if not exists(select 1 from public.tr_games where game_id=p_game_id) then raise exception 'UNKNOWN_GAME'; end if;
  insert into public.tr_leases(game_id,holder_token,holder_name,held_by,expires_at)
  values(p_game_id,p_holder_token,btrim(p_recorder_name),(select auth.uid()),now()+interval '120 seconds')
  on conflict (game_id) do update set
   holder_token=excluded.holder_token,holder_name=excluded.holder_name,
   held_by=excluded.held_by,expires_at=excluded.expires_at
  where public.tr_leases.expires_at <= now()
     or (public.tr_leases.holder_token=excluded.holder_token
         and public.tr_leases.held_by=excluded.held_by)
  returning true into acquired;
  return coalesce(acquired,false);
end; $$;

create or replace function public.tr_release_lease(p_game_id text,p_holder_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_deleted integer;
begin
  perform public.tr_member_role();
  delete from public.tr_leases where game_id=p_game_id and holder_token=p_holder_token and held_by=(select auth.uid());
  get diagnostics count_deleted = row_count;
  return count_deleted>0;
end; $$;

create or replace function public.tr_save_game(
  p_game_id text,p_expected_revision bigint,p_state jsonb,
  p_recorder_name text,p_holder_token uuid,p_operation_id uuid,p_operation text
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; seen_revision bigint;
begin
  perform public.tr_member_role();
  if p_state is null or jsonb_typeof(p_state)<>'object' or p_state->>'id' is distinct from p_game_id then raise exception 'INVALID_GAME_STATE'; end if;
  if length(btrim(coalesce(p_recorder_name,''))) not between 1 and 32 then raise exception 'RECORDER_REQUIRED'; end if;
  if p_operation_id is null or length(btrim(coalesce(p_operation,''))) not between 1 and 60 then raise exception 'INVALID_OPERATION'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'INVALID_REVISION'; end if;
  select a.revision_after into seen_revision from public.tr_audit a where a.operation_id=p_operation_id
    and a.object_type='game' and a.object_id=p_game_id;
  if found then return seen_revision; end if;
  select g.revision into current_revision from public.tr_games g where g.game_id=p_game_id for update;
  if not found then raise exception 'UNKNOWN_GAME'; end if;
  if not exists(select 1 from public.tr_leases l
      where l.game_id=p_game_id and l.holder_token=p_holder_token
        and l.held_by=(select auth.uid()) and l.expires_at > now())
    then raise exception 'NOT_RECORDING_LEASE_HOLDER' using errcode='42501'; end if;
  if current_revision <> p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  update public.tr_games set state=p_state,revision=revision+1,
   modified_by=(select auth.uid()),recorder_name=btrim(p_recorder_name),updated_at=now()
   where game_id=p_game_id;
  insert into public.tr_audit(operation_id,object_type,object_id,actor_id,recorder_name,operation,revision_before,revision_after)
   values(p_operation_id,'game',p_game_id,(select auth.uid()),btrim(p_recorder_name),btrim(p_operation),current_revision,current_revision+1);
  return current_revision+1;
end; $$;

-- Postgres grants on functions default to PUBLIC, revoke explicitly.
revoke all on function public.tr_member_role() from public,anon,authenticated;
revoke all on function public.tr_save_document(text,bigint,jsonb,text,uuid,text) from public,anon,authenticated;
revoke all on function public.tr_create_game(text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.tr_acquire_lease(text,uuid,text) from public,anon,authenticated;
revoke all on function public.tr_release_lease(text,uuid) from public,anon,authenticated;
revoke all on function public.tr_save_game(text,bigint,jsonb,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tr_member_role() to authenticated;
grant execute on function public.tr_save_document(text,bigint,jsonb,text,uuid,text) to authenticated;
grant execute on function public.tr_create_game(text,jsonb,text,uuid) to authenticated;
grant execute on function public.tr_acquire_lease(text,uuid,text) to authenticated;
grant execute on function public.tr_release_lease(text,uuid) to authenticated;
grant execute on function public.tr_save_game(text,bigint,jsonb,text,uuid,uuid,text) to authenticated;

commit;