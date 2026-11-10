// Disposable local GoTrue + PostgREST + PostgreSQL. No hosted URL or credentials.
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
const exec=promisify(execFile);
const docker=(...args)=>{try{return execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}catch(error){throw Error(`Local Docker operation failed: ${error.stderr?.toString().slice(-1800)||'unknown error'}`);}};
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
export const AUTH_IMAGE='supabase/gotrue:v2.197.0',REST_IMAGE='postgrest/postgrest:v14.18';
export async function startLocalBackend(){
 await Promise.all([AUTH_IMAGE,REST_IMAGE].map(image=>exec('docker',['pull',image])));
 const name=`tr-local-${randomBytes(5).toString('hex')}`,db=`${name}-db`,auth=`${name}-auth`,rest=`${name}-rest`,secret=randomBytes(48).toString('hex');
 const containers=[];
 const sql=text=>docker('exec',db,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At','-c',text);
 const stop=()=>{for(const id of [...containers].reverse())try{docker('rm','-f','-v',id);}catch{}try{docker('network','rm',name);}catch{}};
 const token=claims=>{const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const head=enc({alg:'HS256',typ:'JWT'}),body=enc({iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...claims});return `${head}.${body}.${createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`;};
 const wait=async(fn)=>{for(let i=0;i<200;i++){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Local backend readiness timed out');};
 try{
  docker('network','create',name);
  docker('run','-d','--name',db,'--network',name,'--network-alias','db','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine');containers.push(db);
  await wait(()=>{try{docker('exec',db,'pg_isready','-h','127.0.0.1','-U','postgres');return true;}catch{return false;}});
  sql("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login noinherit;grant anon,authenticated,service_role to authenticator;create schema auth;alter role postgres set search_path=auth,public;");
  const env={GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://localhost:9999',GOTRUE_SITE_URL:'http://localhost:4173',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://postgres@db:5432/postgres',GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:'3600',GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED:'false',GOTRUE_MAILER_AUTOCONFIRM:'false'};
  docker('run','-d','--name',auth,'--network',name,'-p','127.0.0.1::9999',...Object.entries(env).flatMap(([k,v])=>['-e',`${k}=${v}`]),AUTH_IMAGE);containers.push(auth);
  const port=(container,exposed)=>Object.values(JSON.parse(docker('inspect',container))[0].NetworkSettings.Ports[exposed])[0].HostPort;
  const authUrl=`http://127.0.0.1:${port(auth,'9999/tcp')}`;
  await wait(async()=>{const r=await fetch(authUrl+'/health');return r.ok;});
  sql(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid$$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
  sql(readFileSync(new URL('../../staging/sql/001_shared_backend.sql',import.meta.url),'utf8'));
  docker('run','-d','--name',rest,'--network',name,'-p','127.0.0.1::3000','-e','PGRST_DB_URI=postgres://authenticator@db:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,REST_IMAGE);containers.push(rest);
  const restUrl=`http://127.0.0.1:${port(rest,'3000/tcp')}`;
  await wait(async()=>{const r=await fetch(restUrl+'/');return r.ok;});
  const adminToken=token({role:'service_role',aud:'authenticated'});
  async function adminRequest(path,body,method='POST'){
   const r=await fetch(authUrl+path,{method,headers:{Authorization:`Bearer ${adminToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await r.json();if(!r.ok)throw Error(`Local Auth admin failed (${r.status}): ${data.msg||data.message||data.error_code||''}`);return data;
  }
  const password=randomBytes(24).toString('base64url');
  const users={};
  for(const role of ['admin','recorder','outsider']){
   const email=`${role}@fixture.test`;const user=await adminRequest('/admin/users',{email,password,email_confirm:true});
   users[role]={id:user.id,email,password};
   if(role!=='outsider')sql(`insert into public.tr_members(user_id,member_role) values(${quote(user.id)},${quote(role)})`);
  }
  const fetchImpl=(url,options)=>{const path=new URL(url).pathname+new URL(url).search;return fetch(path.startsWith('/auth/v1/')?authUrl+path.slice(8):restUrl+path.slice(8),options);};
  return {sql,stop,users,authUrl,restUrl,fetchImpl,adminRequest,
   verifyRestore(){
    const dump=docker('exec',db,'pg_dump','-U','postgres','--no-owner','postgres');
    sql('create database tr_restore_test');
    execFileSync('docker',['exec','-i',db,'psql','-U','postgres','-d','tr_restore_test','-v','ON_ERROR_STOP=1'],{input:dump,stdio:['pipe','pipe','pipe']});
    const counts="select md5((select coalesce(jsonb_agg(to_jsonb(g) order by game_id),'[]')::text from public.tr_games g)||(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from public.tr_audit a)||(select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]')::text from tr_private.requests r))||':'||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tr_private') and c.relkind='r' and c.relrowsecurity)||':'||has_function_privilege('anon','tr_private.active_member()','EXECUTE')";
    return sql(counts)===docker('exec',db,'psql','-U','postgres','-d','tr_restore_test','-At','-c',counts);
   },anonToken:token({role:'anon'}),
   async bridge(context){
    await context.route('**/src/firebase-gateway.mjs',r=>r.fulfill({contentType:'text/javascript',body:"export {TianRuiCloud} from './cloud-gateway.mjs';"}));
    await context.route('**/src/config.mjs',r=>r.fulfill({contentType:'text/javascript',body:"export const cloudConfig={projectUrl:'https://local-fixture.supabase.co',publishableKey:'sb_publishable_local_fixture'};"}));
    await context.route('https://local-fixture.supabase.co/**',async route=>{
     if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
     const r=await fetchImpl(route.request().url(),{method:route.request().method(),headers:route.request().headers(),body:route.request().postData()||undefined});
     await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','access-control-allow-origin':'*'},body:Buffer.from(await r.arrayBuffer())});
    });
   }
  };
 }catch(error){stop();throw error;}
}
