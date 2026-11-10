// Produce an additive upgrade from 39a01ee; no tables/rows are dropped or reset.
import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('../staging/sql/001_shared_backend.sql',import.meta.url),'utf8');
const wanted=['tr_private.active_member','public.tr_member_role','tr_private.validate_players','tr_private.validate_game','tr_private.validate_document','public.tr_save_document'];
const functions=[...source.matchAll(/create function ([\w.]+)\([\s\S]*?\$\$;/g)].filter(m=>wanted.includes(m[1])).map(m=>m[0].replace('create function','create or replace function'));
if(functions.length!==wanted.length)throw Error('Required upgrade function missing');
const policies=[...source.matchAll(/create policy \w+ on [\w.]+ for select to authenticated\s+using\([\s\S]*?;/g)].map(m=>m[0].replace(/create policy (\w+) on ([\w.]+) for select to authenticated/, 'alter policy $1 on $2'));
const indexes=[...source.matchAll(/create index \w+_actor_idx[^;]+;/g)].map(m=>m[0].replace('create index','create index if not exists'));
const result=`-- Additive upgrade for the 39a01ee schema. Back up and verify project ownership first.
-- Generated from 001_shared_backend.sql by scripts/build-upgrade.mjs.
begin;
do $$begin
 if to_regclass('public.tr_members') is null or to_regclass('tr_private.requests') is null then
  raise exception 'EXPECTED_39A01EE_SCHEMA_REQUIRED';
 end if;
end $$;
${functions.join('\n\n')}
${policies.join('\n')}
${indexes.join('\n')}
grant usage on schema tr_private to authenticated;
revoke all on function tr_private.active_member(),tr_private.validate_players(jsonb,integer,boolean),tr_private.validate_game(text,jsonb),tr_private.validate_document(text,jsonb) from public,anon,authenticated;
grant execute on function tr_private.active_member() to authenticated;
revoke all on function public.tr_member_role(),public.tr_save_document(text,bigint,jsonb,text,uuid,text) from public,anon,authenticated;
grant execute on function public.tr_member_role(),public.tr_save_document(text,bigint,jsonb,text,uuid,text) to authenticated;
commit;
`;
const target=new URL('../staging/sql/002_session_hardening.sql',import.meta.url);
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==result)throw Error('Upgrade SQL is stale; run node scripts/build-upgrade.mjs');}
else writeFileSync(target,result);
