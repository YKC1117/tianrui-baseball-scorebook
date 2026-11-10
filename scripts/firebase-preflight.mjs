// Public, read-only boundary check; no password, Admin SDK or project mutation.
import {pathToFileURL} from 'node:url';
export async function firebasePreflight(config,expectedProject,fetchImpl=fetch){
 if(!config||config.emulators||!expectedProject||config.projectId!==expectedProject||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(expectedProject)||typeof config.apiKey!=='string')throw Error('請先確認天睿專用 Spark 專案並設定公開 Web App 組態，不能使用測試設定。');
 const root=`https://firestore.googleapis.com/v1/projects/${expectedProject}/databases/(default)/documents`;
 for(const path of ['access/team','team/roster','team/schedule','games','audit','leases','proofs']){
  const r=await fetchImpl(`${root}/${path}?key=${encodeURIComponent(config.apiKey)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  const payload=await r.json();
  if(r.status!==403||payload.error?.status!=='PERMISSION_DENIED'||!/^Missing or insufficient permissions\.?$/.test(payload.error?.message||'')||payload.error?.details?.some(d=>d.reason))throw Error(`尚未確認匿名存取拒絕：${path}。請核對 API、專案及 Rules。`);
 }
 return {projectId:expectedProject,publicBoundary:'passed',checks:7,unverified:['Spark billing status','real password login','two approved UIDs','real device handover','auth disable workflow','remote backup restore','iOS hardware']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const {cloudConfig}=await import('../src/config.mjs');console.log(JSON.stringify(await firebasePreflight(cloudConfig,process.argv[2]),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
