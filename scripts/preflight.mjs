// Read-only deployment check. No login credentials, hosted mutations or defaults.
import {pathToFileURL} from 'node:url';
export async function preflight(config,expectedRef,fetchImpl=fetch){
 if(!config||!expectedRef||!/^[a-z0-9-]+$/.test(expectedRef)||config.projectUrl!==`https://${expectedRef}.supabase.co`||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey||''))throw Error('Provide the explicitly approved team project ref and its public configuration first');
 const get=async(path,method='GET',body)=>{
  const response=await fetchImpl(config.projectUrl+path,{method,cache:'no-store',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});
  let payload;try{payload=await response.json();}catch{}
  return{response,payload};
 };
 const {response,payload}=await get('/auth/v1/settings');
 if(!response.ok||payload?.disable_signup!==true||payload?.external?.anonymous_users!==false)throw Error('Auth settings did not confirm signup disabled and anonymous sign-in unavailable');
 for(const table of ['tr_members','tr_documents','tr_games','tr_leases','tr_audit']){
  const r=await get(`/rest/v1/${table}?select=*&limit=1`);if(![401,403].includes(r.response.status))throw Error(`Anonymous access denial not verified: ${table}`);
 }
 // Invalid anonymous inputs must fail authorization before validation.
 for(const rpc of ['tr_member_role','tr_create_game','tr_save_game','tr_save_document','tr_acquire_lease','tr_release_lease']){
  const r=await get(`/rest/v1/rpc/${rpc}`,'POST',rpc==='tr_member_role'?{}:rpc==='tr_create_game'?{p_game_id:null,p_state:null,p_recorder_name:null,p_operation_id:null,p_holder_token:null}:rpc==='tr_save_game'?{p_game_id:null,p_expected_revision:null,p_state:null,p_recorder_name:null,p_holder_token:null,p_operation_id:null,p_operation:null}:rpc==='tr_save_document'?{p_key:null,p_expected_revision:null,p_document:null,p_recorder_name:null,p_operation_id:null,p_operation:null}:rpc==='tr_acquire_lease'?{p_game_id:null,p_holder_token:null,p_recorder_name:null}:{p_game_id:null,p_holder_token:null});
  if(![401,403].includes(r.response.status))throw Error(`Anonymous RPC denial not verified: ${rpc}`);
 }
 return {status:'public-boundary-checks-passed',projectRef:expectedRef,checks:12,unverified:['password login','roles','cross-device writes','revocation','backup restore','iOS devices']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const {cloudConfig}=await import('../src/config.mjs');const result=await preflight(cloudConfig,process.argv[2]);console.log(JSON.stringify(result,null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
