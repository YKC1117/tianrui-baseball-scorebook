import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preflight} from '../scripts/preflight.mjs';
import {inventory} from '../scripts/privacy-inventory.mjs';
const config={projectUrl:'https://approved-fixture.supabase.co',publishableKey:'sb_publishable_fixture'};
test('deployment check refuses unset or mismatched ownership reference without making requests',async()=>{
 let requests=0;const fetchImpl=()=>{requests++;throw Error('unexpected network');};
 await assert.rejects(()=>preflight(null,'approved-fixture',fetchImpl));await assert.rejects(()=>preflight(config,'different-project',fetchImpl));assert.equal(requests,0);
});
test('deployment check requires disabled signup and actual authorization errors',async()=>{
 let count=0;const handler=async url=>{count++;return url.endsWith('/settings')?new Response(JSON.stringify({disable_signup:true,external:{anonymous_users:false}}),{status:200}):new Response('{}',{status:403});};
 const result=await preflight(config,'approved-fixture',handler);assert.equal(result.status,'public-boundary-checks-passed');assert.equal(count,12);
 await assert.rejects(()=>preflight(config,'approved-fixture',async()=>new Response(JSON.stringify({disable_signup:false}))),/Auth settings/);
 await assert.rejects(()=>preflight(config,'approved-fixture',async url=>url.endsWith('/settings')?new Response(JSON.stringify({disable_signup:true,external:{anonymous_users:false}})):new Response('[]')),/denial not verified/);
});
test('history inventory contains counts and scope without copying private field contents',()=>{
 const result=inventory();const schedule=result.findings.find(f=>f.path==='schedule.json');assert.ok(schedule.historicalBlobCount>0);assert.equal(schedule.presentInMain,true);assert.equal(schedule.presentInHead,false);
 assert.ok(result.scope.includes('forks'));assert.equal(Object.keys(schedule).some(k=>/player|opponent|content|password/i.test(k)),false);
});

test('reserved JavaScript object keys cannot become player IDs',async()=>{const {validateRoster}=await import('../src/validation.mjs');for(const id of ['__proto__','constructor','toString','prototype'])assert.throws(()=>validateRoster([{id,name:'fixture',num:''}]));});
