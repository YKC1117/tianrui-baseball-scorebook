import assert from 'node:assert/strict';
import { TianRuiCloud, CloudError } from '../src/cloud-gateway.mjs';
const storage = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,v), removeItem: k => m.delete(k), get raw() { return [...m.values()].join(' ') } };
};
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json' } });
const mock = (handler, store=storage()) => new TianRuiCloud({
  projectUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_example', fetchImpl: handler, storage: store
});
const token = { access_token:'access-secret', refresh_token:'refresh-secret', expires_in:3600 };

{
  const calls=[], store=storage();
  const a=mock(async (url, options)=>{
    calls.push({url,options});
    if(url.includes('grant_type=password')) return reply(200, token);
    if(url.includes('tr_member_role')) return reply(200, 'recorder');
    if(url.includes('tr_documents')) return reply(200,[{doc_key:'roster',revision:2,document:{roster:[]}}]);
    if(url.includes('tr_acquire_lease')) return reply(200,true);
    if(url.includes('tr_save_game')) return reply(200,8);
    throw Error('unexpected request '+url);
  },store);
  const role=await a.signIn('team@example.test','secret');
  assert.equal(role,'recorder');
  assert.equal(a.signedIn,true);
  const doc=await a.getDocument('roster');assert.equal(doc.revision,2);
  assert.equal(await a.acquireLease('id_test','00000000-0000-4000-8000-000000000001','甲'),true);
  const rev=await a.saveGame({id:'id_test', events:[]},7,'00000000-0000-4000-8000-000000000001','甲','PITCH');
  assert.equal(rev,8);
  assert.equal(calls.find(c=>c.url.includes('tr_save_game')).options.headers.Authorization,'Bearer access-secret');
  assert.equal(store.raw.includes('secret"'),true); // tokens are persisted in sessionStorage intentionally
  assert.equal(store.raw.includes('team@example.test'),false);
  assert.equal(store.raw.includes('"password"'),false);
}
{
  let calls=0;
  const a=mock(async (url)=>{calls++; return url.includes('grant_type=password')?reply(200,token):reply(403,{message:'NOT_APPROVED'});});
  await assert.rejects(()=>a.signIn('not-allowed@test.com','password'), /NOT_APPROVED/);
  assert.equal(a.signedIn,false);
  assert.equal(calls,2);
}
{
  const a=mock(async (url)=>url.includes('grant_type=password')?reply(200,token):url.includes('tr_member_role')?reply(200,'recorder'):reply(400,{code:'P0001',message:'REVISION_CONFLICT'}));
  await a.signIn('team@x.test','password');
  await assert.rejects(()=>a.saveGame({id:'id_x'},4,'x','乙'), /REVISION_CONFLICT/);
}
{
  const a=mock(async (url)=>url.includes('grant_type=password')?reply(200,token):url.includes('tr_member_role')?reply(200,'recorder'):reply(200,1));
  await a.signIn('team@x.test','password');
  await assert.rejects(()=>a.saveDocument('roster',0,{},' '), err=>err instanceof CloudError && err.code==='RECORDER_REQUIRED');
}
{
  const a=mock(async ()=>{throw Error('network down')});
  await assert.rejects(()=>a.signIn('test@x.test','pass'), err=>err.code==='OFFLINE');
}
{
  assert.throws(()=>new TianRuiCloud({projectUrl:'http://evil.example',publishableKey:'sb_publishable_x',fetchImpl:async()=>reply(200,{})}), /HTTPS/);
  assert.throws(()=>new TianRuiCloud({projectUrl:'https://project.supabase.co',publishableKey:'service_role_secret',fetchImpl:async()=>reply(200,{})}), /publishable key/);
}
console.log('PASS cloud-gateway: 6 scenarios, no live project accessed');