-- TianRui v1.5 bootstrap, dedicated NEW team project only. Not applied remotely.
-- Manually provision one admin and one recorder; disable Auth public signups.
-- Public RPCs are narrow SECURITY DEFINER transaction boundaries: callers cannot
-- write tables directly. Private helpers, empty search_path and explicit ACLs.
begin;
create schema if not exists tr_private;
revoke all on schema tr_private from public, anon, authenticated;
create table public.tr_members (
 user_id uuid primary key references auth.users(id),
 member_role text not null unique check(member_role in ('admin','recorder')),
 enabled boolean not null default true, created_at timestamptz not null default now()
);
create table public.tr_documents (
 doc_key text primary key check(doc_key in ('roster','schedule')),
 document jsonb not null check(jsonb_typeof(document)='object'),
 revision bigint not null check(revision>=1), modified_by uuid not null references auth.users(id),
 recorder_name text not null check(length(btrim(recorder_name)) between 1 and 32),
 updated_at timestamptz not null default now()
);
create table public.tr_games (
 game_id text primary key check(game_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
 state jsonb not null check(jsonb_typeof(state)='object' and state->>'id' is not null and state->>'id'=game_id),
 revision bigint not null check(revision>=1), modified_by uuid not null references auth.users(id),
 recorder_name text not null check(length(btrim(recorder_name)) between 1 and 32),
 updated_at timestamptz not null default now()
);
create table public.tr_leases (
 game_id text primary key references public.tr_games(game_id),
 holder_token uuid not null, held_by uuid not null references auth.users(id),
 holder_name text not null check(length(btrim(holder_name)) between 1 and 32),
 expires_at timestamptz not null
);
-- One immutable server row per accepted operation; details preserve event content
-- even when an undo removes an event from the mutable game snapshot.
create table public.tr_audit (
 id bigint generated always as identity primary key,
 operation_id uuid not null unique, object_type text not null check(object_type in ('game','roster','schedule')),
 object_id text not null, actor_id uuid not null references auth.users(id),
 recorder_name text not null check(length(btrim(recorder_name)) between 1 and 32),
 operation text not null, revision_before bigint not null, revision_after bigint not null,
 details jsonb not null, occurred_at timestamptz not null default clock_timestamp()
);
-- Exact JSONB request equality, not an unverified client hash. Lease token is
-- deliberately excluded: a retry after reconnect may own a new device lease.
create table tr_private.requests (
 operation_id uuid primary key, request jsonb not null, revision bigint not null
);
create index tr_audit_object_idx on public.tr_audit(object_type,object_id,occurred_at desc);
create index tr_documents_actor_idx on public.tr_documents(modified_by);
create index tr_games_actor_idx on public.tr_games(modified_by);
create index tr_leases_actor_idx on public.tr_leases(held_by);
create index tr_audit_actor_idx on public.tr_audit(actor_id);
create index tr_games_updated_idx on public.tr_games(updated_at desc);
alter table public.tr_members enable row level security;
alter table public.tr_documents enable row level security;
alter table public.tr_games enable row level security;
alter table public.tr_leases enable row level security;
alter table public.tr_audit enable row level security;
alter table tr_private.requests enable row level security;
revoke all on public.tr_members,public.tr_documents,public.tr_games,public.tr_leases,public.tr_audit from public,anon,authenticated;
revoke all on tr_private.requests from public,anon,authenticated;
grant select on public.tr_members,public.tr_documents,public.tr_games,public.tr_audit to authenticated;
-- JWT expiry alone does not revoke a signed-out/banned session. This internal
-- boolean helper checks server-owned Auth rows and never accepts caller IDs.
create function tr_private.active_member() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.tr_members m join auth.users u on u.id=m.user_id
  join auth.sessions s on s.user_id=u.id
  where m.user_id=(select auth.uid()) and m.enabled and u.is_anonymous is false
   and (u.banned_until is null or u.banned_until<=now())
   and s.id::text=(select auth.jwt()->>'session_id')
   and (s.not_after is null or s.not_after>now())
 );
$$;
-- Private schema is not exposed in PostgREST; only this argument-free helper is
-- callable for policy evaluation. No private table or other helper is granted.
grant usage on schema tr_private to authenticated;
create policy tr_members_self_read on public.tr_members for select to authenticated
 using(user_id=(select auth.uid()) and (select tr_private.active_member()));
create policy tr_docs_members_read on public.tr_documents for select to authenticated
 using((select tr_private.active_member()));
create policy tr_games_members_read on public.tr_games for select to authenticated
 using((select tr_private.active_member()));
create policy tr_audit_members_read on public.tr_audit for select to authenticated
 using((select tr_private.active_member()));

create function public.tr_member_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare r text;
begin
 if (select auth.uid()) is null then raise exception 'NOT_AUTHENTICATED' using errcode='42501'; end if;
 if not tr_private.active_member() then raise exception 'NOT_APPROVED' using errcode='42501'; end if;
 select member_role into r from public.tr_members where user_id=(select auth.uid()) and enabled;
 if r is null then raise exception 'NOT_APPROVED' using errcode='42501'; end if;
 return r;
end $$;

create function tr_private.check_request(p_id uuid,p_request jsonb) returns bigint
language plpgsql set search_path='' as $$
declare saved tr_private.requests;
begin
 if p_id is null then raise exception 'INVALID_OPERATION'; end if;
 -- Global operation lock prevents simultaneous retries from double-applying.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operation:'||p_id::text,0));
 select * into saved from tr_private.requests where operation_id=p_id;
 if found then
  if saved.request is distinct from p_request then raise exception 'OPERATION_ID_REUSED'; end if;
  return saved.revision;
 end if;
 return null;
end $$;
create function tr_private.audit(p_id uuid,p_request jsonb,p_revision bigint) returns void
language plpgsql set search_path='' as $$
begin
 insert into tr_private.requests values(p_id,p_request,p_revision);
 insert into public.tr_audit(operation_id,object_type,object_id,actor_id,recorder_name,operation,revision_before,revision_after,details)
 values(p_id,p_request->>'type',p_request->>'id',(p_request->>'actor')::uuid,
 p_request->>'name',p_request->>'operation',(p_request->>'expected')::bigint,p_revision,p_request->'data');
end $$;
create function tr_private.validate_name(p_name text) returns void
language plpgsql set search_path='' as $$
begin
 if length(btrim(coalesce(p_name,''))) not between 1 and 32 then raise exception 'RECORDER_REQUIRED'; end if;
end $$;

create function tr_private.validate_players(p_roster jsonb,p_max integer,p_unique_numbers boolean) returns void
language plpgsql set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(p_roster) is distinct from 'array' then raise exception 'INVALID_ROSTER'; end if;
 if jsonb_array_length(p_roster)>p_max then raise exception 'INVALID_ROSTER'; end if;
 for item in select value from jsonb_array_elements(p_roster) loop
  if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[a-zA-Z0-9_-]{1,128}$' or item->>'id' in ('__proto__','prototype','constructor','toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__')
   or jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 40
   or jsonb_typeof(item->'num') is distinct from 'string' or length(item->>'num')>5 then raise exception 'INVALID_ROSTER'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_roster) group by value->>'id' having count(*)>1)
  or (p_unique_numbers and exists(select 1 from jsonb_array_elements(p_roster) where value->>'num'<>'' group by value->>'num' having count(*)>1)) then raise exception 'INVALID_ROSTER'; end if;
end $$;

-- Validate the snapshot boundary so partial client state cannot replace a game.
create function tr_private.validate_game(p_id text,p_state jsonb) returns void
language plpgsql set search_path='' as $$
declare side text; team jsonb; item jsonb;
begin
 if p_id in ('__proto__','prototype','constructor','toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__') or p_state is null or jsonb_typeof(p_state)<>'object' or p_state->>'id' is distinct from p_id
 or coalesce(p_state->>'side','') not in ('away','home')
 or coalesce(p_state->>'half','') not in ('top','bottom')
 or coalesce(p_state->>'inning','') !~ '^[1-9]$'
 or jsonb_typeof(p_state->'events') is distinct from 'array' then raise exception 'INVALID_GAME_STATE'; end if;
 foreach side in array array['away','home'] loop
  team:=p_state->side;
  if jsonb_typeof(team) is distinct from 'object' or jsonb_typeof(team->'roster') is distinct from 'array'
   or jsonb_typeof(team->'lineup') is distinct from 'array'
   or jsonb_typeof(team->'stats') is distinct from 'object'
   or jsonb_typeof(team->'pitchStats') is distinct from 'object'
   or jsonb_typeof(p_state->'score'->side) is distinct from 'array' then raise exception 'INVALID_GAME_STATE'; end if;
  perform tr_private.validate_players(team->'roster',40,false);
  if jsonb_typeof(team->'name') is distinct from 'string' or jsonb_typeof(team->'pitcher') is distinct from 'string' then raise exception 'INVALID_GAME_STATE'; end if;
  if not exists(select 1 from jsonb_array_elements(team->'roster') p where p->>'id'=team->>'pitcher')
   or exists(select 1 from jsonb_array_elements(team->'lineup') v where not exists(select 1 from jsonb_array_elements(team->'roster') p where p->'id'=v))
   or exists(select 1 from jsonb_array_elements(team->'lineup') group by value having count(*)>1) then raise exception 'INVALID_GAME_STATE'; end if;
  for item in select value from jsonb_array_elements(p_state->'score'->side) loop
   if item='null'::jsonb then continue; end if;
   if jsonb_typeof(item)<>'number' then raise exception 'INVALID_GAME_STATE'; end if;
   if (item::text)::numeric<0 or (item::text)::numeric<>trunc((item::text)::numeric) then raise exception 'INVALID_GAME_STATE'; end if;
  end loop;
  if jsonb_array_length(team->'roster') not between 9 and 40 or jsonb_array_length(team->'lineup')<>9
   or jsonb_array_length(p_state->'score'->side)<>9 then raise exception 'INVALID_GAME_STATE'; end if;
 end loop;
end $$;

create function tr_private.validate_document(p_key text,p_document jsonb) returns void
language plpgsql set search_path='' as $$
declare item jsonb;
begin
 if p_key='roster' then
  perform tr_private.validate_players(p_document->'roster',60,true);
 elsif p_key='schedule' then
  if p_document->>'format' is distinct from 'TR-SCHEDULE-1' or jsonb_typeof(p_document->'season') is distinct from 'string'
   or jsonb_typeof(p_document->'games') is distinct from 'array' then raise exception 'INVALID_SCHEDULE'; end if;
  if jsonb_array_length(p_document->'games')>2000 then raise exception 'INVALID_SCHEDULE'; end if;
  for item in select value from jsonb_array_elements(p_document->'games') loop
   if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[a-zA-Z0-9_-]{1,128}$' or item->>'id' in ('__proto__','prototype','constructor','toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','__defineGetter__','__defineSetter__','__lookupGetter__','__lookupSetter__')
    or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(item->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or length(btrim(coalesce(item->>'opponent','')))=0
    or coalesce(item->>'status','') not in ('scheduled','postponed','cancelled','completed') then raise exception 'INVALID_SCHEDULE'; end if;
   perform (item->>'date')::date;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_document->'games') group by value->>'id' having count(*)>1) then raise exception 'INVALID_SCHEDULE'; end if;
 end if;
end $$;

create function public.tr_save_document(p_key text,p_expected_revision bigint,p_document jsonb,p_recorder_name text,p_operation_id uuid,p_operation text)
returns bigint language plpgsql security definer set search_path='' as $$
declare role_name text; r bigint; seen bigint; req jsonb;
begin
 role_name:=public.tr_member_role();
 if p_key is null or p_key not in ('roster','schedule') then raise exception 'INVALID_DOC_KEY'; end if;
 if p_key='schedule' and role_name<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 perform tr_private.validate_name(p_recorder_name);
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'INVALID_REVISION'; end if;
 if p_document is null or jsonb_typeof(p_document)<>'object' then raise exception 'INVALID_DOCUMENT'; end if;
 if length(btrim(coalesce(p_operation,''))) not between 1 and 60 then raise exception 'INVALID_OPERATION'; end if;
 req:=jsonb_build_object('type',p_key,'id',p_key,'actor',auth.uid(),'name',btrim(p_recorder_name),'operation',p_operation,'expected',p_expected_revision,'data',p_document);
 seen:=tr_private.check_request(p_operation_id,req);
 if seen is not null then return seen; end if;
 perform tr_private.validate_document(p_key,p_document);
 -- Serialize absent-row creates as well as updates.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('document:'||p_key,0));
 select revision into r from public.tr_documents where doc_key=p_key for update;
 r:=coalesce(r,0);
 if r<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 insert into public.tr_documents values(p_key,p_document,r+1,auth.uid(),btrim(p_recorder_name),clock_timestamp())
 on conflict(doc_key) do update set document=excluded.document,revision=excluded.revision,
 modified_by=excluded.modified_by,recorder_name=excluded.recorder_name,updated_at=excluded.updated_at;
 perform tr_private.audit(p_operation_id,req,r+1);
 return r+1;
end $$;
create function public.tr_create_game(p_game_id text,p_state jsonb,p_recorder_name text,p_operation_id uuid,p_holder_token uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare seen bigint; req jsonb;
begin
 perform public.tr_member_role();
 perform tr_private.validate_name(p_recorder_name);
 perform tr_private.validate_game(p_game_id,p_state);
 if p_holder_token is null then raise exception 'INVALID_HOLDER'; end if;
 if p_game_id is null or p_game_id !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'INVALID_GAME_ID'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or p_state->>'id' is distinct from p_game_id then raise exception 'INVALID_GAME_STATE'; end if;
 req:=jsonb_build_object('type','game','id',p_game_id,'actor',auth.uid(),'name',btrim(p_recorder_name),'operation','CREATE','expected',0,'data',p_state);
 seen:=tr_private.check_request(p_operation_id,req);
 if seen is not null then return seen; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('game:'||p_game_id,0));
 if exists(select 1 from public.tr_games where game_id=p_game_id) then raise exception 'REVISION_CONFLICT'; end if;
 insert into public.tr_games values(p_game_id,p_state,1,auth.uid(),btrim(p_recorder_name),clock_timestamp());
 -- A new game and its first lease must commit atomically.
 insert into public.tr_leases values(p_game_id,p_holder_token,auth.uid(),btrim(p_recorder_name),clock_timestamp()+interval '120 seconds');
 perform tr_private.audit(p_operation_id,req,1);
 return 1;
end $$;
create function public.tr_acquire_lease(p_game_id text,p_holder_token uuid,p_recorder_name text)
returns boolean language plpgsql security definer set search_path='' as $$
declare acquired boolean;
begin
 perform public.tr_member_role();
 perform tr_private.validate_name(p_recorder_name);
 if p_holder_token is null then raise exception 'INVALID_HOLDER'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('game:'||p_game_id,0));
 if not exists(select 1 from public.tr_games where game_id=p_game_id) then raise exception 'UNKNOWN_GAME'; end if;
 insert into public.tr_leases values(p_game_id,p_holder_token,auth.uid(),btrim(p_recorder_name),clock_timestamp()+interval '120 seconds')
 on conflict(game_id) do update set holder_token=excluded.holder_token,held_by=excluded.held_by,holder_name=excluded.holder_name,expires_at=excluded.expires_at
 where public.tr_leases.expires_at<=clock_timestamp()
 or (public.tr_leases.holder_token=excluded.holder_token and public.tr_leases.held_by=excluded.held_by)
 returning true into acquired;
 return coalesce(acquired,false);
end $$;
create function public.tr_release_lease(p_game_id text,p_holder_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 perform public.tr_member_role();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('game:'||p_game_id,0));
 delete from public.tr_leases where game_id=p_game_id and holder_token=p_holder_token and held_by=auth.uid();
 get diagnostics removed=row_count;
 return removed>0;
end $$;
create function public.tr_save_game(p_game_id text,p_expected_revision bigint,p_state jsonb,p_recorder_name text,p_holder_token uuid,p_operation_id uuid,p_operation text)
returns bigint language plpgsql security definer set search_path='' as $$
declare r bigint; seen bigint; req jsonb;
begin
 perform public.tr_member_role();
 perform tr_private.validate_name(p_recorder_name);
 if p_state is null or jsonb_typeof(p_state)<>'object' or p_state->>'id' is distinct from p_game_id then raise exception 'INVALID_GAME_STATE'; end if;
 perform tr_private.validate_game(p_game_id,p_state);
 if p_expected_revision is null or p_expected_revision<1 then raise exception 'INVALID_REVISION'; end if;
 if length(btrim(coalesce(p_operation,''))) not between 1 and 60 then raise exception 'INVALID_OPERATION'; end if;
 req:=jsonb_build_object('type','game','id',p_game_id,'actor',auth.uid(),'name',btrim(p_recorder_name),'operation',p_operation,'expected',p_expected_revision,'data',p_state);
 seen:=tr_private.check_request(p_operation_id,req);
 if seen is not null then return seen; end if;
 -- Lease acquire/release and saves take the SAME lock. A takeover cannot race
 -- between this check and commit. Check the clock after waiting for the lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('game:'||p_game_id,0));
 select revision into r from public.tr_games where game_id=p_game_id for update;
 if not found then raise exception 'UNKNOWN_GAME'; end if;
 if not exists(select 1 from public.tr_leases where game_id=p_game_id and holder_token=p_holder_token
 and held_by=auth.uid() and holder_name=btrim(p_recorder_name) and expires_at>clock_timestamp())
 then raise exception 'NOT_RECORDING_LEASE_HOLDER' using errcode='42501'; end if;
 if r<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 update public.tr_games set state=p_state,revision=r+1,modified_by=auth.uid(),recorder_name=btrim(p_recorder_name),updated_at=clock_timestamp() where game_id=p_game_id;
 perform tr_private.audit(p_operation_id,req,r+1);
 return r+1;
end $$;
revoke all on all functions in schema tr_private from public,anon,authenticated;
grant execute on function tr_private.active_member() to authenticated;
revoke all on function public.tr_member_role() from public,anon,authenticated;
revoke all on function public.tr_save_document(text,bigint,jsonb,text,uuid,text) from public,anon,authenticated;
revoke all on function public.tr_create_game(text,jsonb,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.tr_acquire_lease(text,uuid,text) from public,anon,authenticated;
revoke all on function public.tr_release_lease(text,uuid) from public,anon,authenticated;
revoke all on function public.tr_save_game(text,bigint,jsonb,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tr_member_role() to authenticated;
grant execute on function public.tr_save_document(text,bigint,jsonb,text,uuid,text) to authenticated;
grant execute on function public.tr_create_game(text,jsonb,text,uuid,uuid) to authenticated;
grant execute on function public.tr_acquire_lease(text,uuid,text) to authenticated;
grant execute on function public.tr_release_lease(text,uuid) to authenticated;
grant execute on function public.tr_save_game(text,bigint,jsonb,text,uuid,uuid,text) to authenticated;
commit;
