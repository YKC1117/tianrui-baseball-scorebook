-- Additive upgrade for the 39a01ee schema. Back up and verify project ownership first.
-- Generated from 001_shared_backend.sql by scripts/build-upgrade.mjs.
begin;
do $$begin
 if to_regclass('public.tr_members') is null or to_regclass('tr_private.requests') is null then
  raise exception 'EXPECTED_39A01EE_SCHEMA_REQUIRED';
 end if;
end $$;
create or replace function tr_private.active_member() returns boolean
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

create or replace function public.tr_member_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare r text;
begin
 if (select auth.uid()) is null then raise exception 'NOT_AUTHENTICATED' using errcode='42501'; end if;
 if not tr_private.active_member() then raise exception 'NOT_APPROVED' using errcode='42501'; end if;
 select member_role into r from public.tr_members where user_id=(select auth.uid()) and enabled;
 if r is null then raise exception 'NOT_APPROVED' using errcode='42501'; end if;
 return r;
end $$;

create or replace function tr_private.validate_players(p_roster jsonb,p_max integer,p_unique_numbers boolean) returns void
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

create or replace function tr_private.validate_game(p_id text,p_state jsonb) returns void
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

create or replace function tr_private.validate_document(p_key text,p_document jsonb) returns void
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

create or replace function public.tr_save_document(p_key text,p_expected_revision bigint,p_document jsonb,p_recorder_name text,p_operation_id uuid,p_operation text)
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
alter policy tr_members_self_read on public.tr_members
 using(user_id=(select auth.uid()) and (select tr_private.active_member()));
alter policy tr_docs_members_read on public.tr_documents
 using((select tr_private.active_member()));
alter policy tr_games_members_read on public.tr_games
 using((select tr_private.active_member()));
alter policy tr_audit_members_read on public.tr_audit
 using((select tr_private.active_member()));
create index if not exists tr_documents_actor_idx on public.tr_documents(modified_by);
create index if not exists tr_games_actor_idx on public.tr_games(modified_by);
create index if not exists tr_leases_actor_idx on public.tr_leases(held_by);
create index if not exists tr_audit_actor_idx on public.tr_audit(actor_id);
grant usage on schema tr_private to authenticated;
revoke all on function tr_private.active_member(),tr_private.validate_players(jsonb,integer,boolean),tr_private.validate_game(text,jsonb),tr_private.validate_document(text,jsonb) from public,anon,authenticated;
grant execute on function tr_private.active_member() to authenticated;
revoke all on function public.tr_member_role(),public.tr_save_document(text,bigint,jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.tr_member_role(),public.tr_save_document(text,bigint,jsonb,text,uuid,text) to authenticated;
commit;
