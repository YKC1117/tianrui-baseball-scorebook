import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firebasePreflight} from '../scripts/firebase-preflight.mjs';
const config={projectId:'tianrui-test-fixture',apiKey:'public-test-only'};
test('public Firebase preflight refuses unconfigured/mismatched projects and API-disabled false positives',async()=>{
 await assert.rejects(firebasePreflight(null));await assert.rejects(firebasePreflight(config,'another-project'));
 const denied=async()=>new Response(JSON.stringify({error:{status:'PERMISSION_DENIED',message:'Missing or insufficient permissions.'}}),{status:403});
 assert.equal((await firebasePreflight(config,config.projectId,denied)).checks,7);
 await assert.rejects(firebasePreflight(config,config.projectId,async()=>new Response(JSON.stringify({error:{status:'PERMISSION_DENIED',message:'API disabled',details:[{reason:'SERVICE_DISABLED'}]}}),{status:403})));
 await assert.rejects(firebasePreflight(config,config.projectId,async()=>new Response('{}',{status:200})));
});
