import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TianRuiCloud} from '../src/cloud-gateway.mjs';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const config={projectUrl:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'};
test('single-flight refresh protects simultaneous REST calls',async()=>{
 let refreshes=0;
 const cloud=new TianRuiCloud({...config,storage:memory(),fetchImpl:async(url)=>{
  if(url.includes('grant_type=refresh_token')){refreshes++;await new Promise(r=>setTimeout(r,5));return response({access_token:'new',refresh_token:'new-refresh',expires_in:3600,user:{id:'fixture'}});}
  return response([]);
 }});
 cloud._storeSession({access_token:'old',refresh_token:'old-refresh',expires_in:1,user:{id:'fixture'}});
 await Promise.all([cloud.getDocument('roster'),cloud.getDocument('schedule'),cloud.listGames()]);
 assert.equal(refreshes,1);assert.equal(cloud.session.access_token,'new');
});
test('local logout preserves other devices; password is never stored',async()=>{
 let logout;const store=memory();
 const cloud=new TianRuiCloud({...config,storage:store,fetchImpl:async(url,opts)=>{
  if(url.includes('grant_type=password'))return response({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture'}});
  if(url.includes('tr_member_role'))return response('recorder');
  logout={url,opts};return response({});
 }});
 await cloud.signIn('account@example.test','fixture-password');
 assert.doesNotMatch(store.getItem(cloud.sessionKey),/fixture-password|account@example/);
 await cloud.signOut();assert.ok(logout.url.endsWith('/logout?scope=local'));assert.equal(cloud.signedIn,false);assert.equal(store.getItem(cloud.sessionKey),null);
});
test('Postgres application errors retain actionable conflict codes',async()=>{
 const cloud=new TianRuiCloud({...config,storage:memory(),fetchImpl:async()=>response({code:'P0001',message:'REVISION_CONFLICT'},400)});
 cloud._storeSession({access_token:'fixture',refresh_token:'fixture',expires_in:3600});
 await assert.rejects(()=>cloud.getGame('id_test'),e=>e.code==='REVISION_CONFLICT');
});
test('refresh denial clears tokens and does not execute protected request',async()=>{
 let calls=0;const cloud=new TianRuiCloud({...config,storage:memory(),fetchImpl:async()=>{calls++;return response({},401);}});
 cloud._storeSession({access_token:'fixture',refresh_token:'fixture',expires_in:1});
 await assert.rejects(()=>cloud.getDocument('roster'),e=>e.code==='SESSION_EXPIRED');assert.equal(cloud.signedIn,false);assert.equal(calls,1);
});
test('new game RPC includes first device lease in the same request',async()=>{
 let sent;const cloud=new TianRuiCloud({...config,storage:memory(),fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return response(1);}});
 cloud._storeSession({access_token:'fixture',refresh_token:'fixture',expires_in:3600});
 await assert.rejects(()=>cloud.createGame({id:'id_new'},'紀錄甲'),e=>e.code==='BAD_GAME');
 await cloud.createGame({id:'id_new'},'紀錄甲','operation-fixture','holder-fixture');
 assert.equal(sent.p_holder_token,'holder-fixture');assert.equal(sent.p_operation_id,'operation-fixture');
});
test('late refresh cannot resurrect a cleared session',async()=>{
 let finish;const cloud=new TianRuiCloud({...config,storage:memory(),fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
 cloud._storeSession({access_token:'fixture',refresh_token:'fixture',expires_in:1});
 const pending=cloud._refresh();cloud.clearSession();finish(response({access_token:'new-fixture',refresh_token:'new-fixture',expires_in:3600}));
 await assert.rejects(()=>pending,error=>error.code==='SESSION_EXPIRED');assert.equal(cloud.signedIn,false);
});
test('interrupted response bodies and request timeouts preserve an offline error',async()=>{
 const cloud=new TianRuiCloud({...config,storage:memory(),timeoutMs:5,fetchImpl:async()=>({text:async()=>{throw Error('body interrupted');}})});
 await assert.rejects(()=>cloud.signIn('fixture@test.invalid','fixture'),e=>e.code==='OFFLINE');
 cloud.fetchImpl=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
 await assert.rejects(()=>cloud.signIn('fixture@test.invalid','fixture'),e=>e.code==='OFFLINE');
});
test('transient Auth 5xx does not discard refresh tokens',async()=>{
 const cloud=new TianRuiCloud({...config,storage:memory(),fetchImpl:async()=>response({},503)});
 cloud._storeSession({access_token:'fixture',refresh_token:'fixture',expires_in:1});
 await assert.rejects(()=>cloud.getDocument('roster'),e=>e.code==='OFFLINE');assert.equal(cloud.signedIn,true);
});
