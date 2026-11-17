import {RECORDER_EMAIL,EXPECTED_PROJECT,validatePublicConfig} from '../src/login-config.mjs';
const firebase=`https://firebase.googleapis.com/v1beta1/projects/${EXPECTED_PROJECT}`;
const identity='https://identitytoolkit.googleapis.com';
const database=`https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)`;
export async function setupProject({request,adminEmail,askPassword,region,deploy,saveConfig}){
 if(typeof adminEmail!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)||adminEmail.toLowerCase()===RECORDER_EMAIL)throw Error('管理員必須使用與球隊紀錄帳號不同的電子郵件');
 const project=await request('GET',firebase);
 if(project.projectId!==EXPECTED_PROJECT)throw Error('拒絕操作其他專案');
 const billing=await request('GET',`https://cloudbilling.googleapis.com/v1/projects/${EXPECTED_PROJECT}/billingInfo`);
 if(billing.billingEnabled!==false)throw Error('無法確認免費且未綁計費；沒有套用設定');
 const authConfig=await request('GET',`${identity}/admin/v2/projects/${EXPECTED_PROJECT}/config`);
 if(authConfig.signIn?.email?.enabled!==true)throw Error('請在已建立的天睿專案啟用 Email/Password，沒有修改其他登入服務');
 const apps=await request('GET',firebase+'/webApps');let app=apps.apps?.find(a=>a.displayName==='TianRui Scorebook')||apps.apps?.[0];
 if(!app){let op=await request('POST',firebase+'/webApps',{displayName:'TianRui Scorebook'});for(let n=0;!op.done&&n<60;n++){await new Promise(r=>setTimeout(r,1000));op=await request('GET','https://firebase.googleapis.com/v1beta1/'+op.name);}if(!op.done||op.error)throw Error('Web App 建立尚未完成');app=op.response;}
 const sdk=await request('GET',`${firebase}/webApps/${encodeURIComponent(app.appId)}/config`);
 const config=Object.fromEntries(['projectId','apiKey','authDomain','appId'].map(k=>[k,sdk[k]]));validatePublicConfig(config);
 const users={};
 for(const [role,email] of [['admin',adminEmail],['recorder',RECORDER_EMAIL]]){
  const found=await request('POST',`${identity}/v1/projects/${EXPECTED_PROJECT}/accounts:query`,{expression:[{email}],limit:'2'});const exact=(found.userInfo||[]).filter(u=>u.email?.toLowerCase()===email.toLowerCase());
  if(exact.length>1)throw Error('帳號識別不唯一');let user=exact[0];
  if(!user){let password=await askPassword(role);if(typeof password!=='string'||password.length<12)throw Error('新密碼至少 12 字元；沒有儲存密碼');try{const created=await request('POST',`${identity}/v1/accounts:signUp?key=${encodeURIComponent(config.apiKey)}`,{targetProjectId:EXPECTED_PROJECT,email,password,returnSecureToken:false},{sensitive:true});user={email,localId:created.localId};}finally{password=null;}}
  if(!user.localId||user.disabled)throw Error('帳號不存在或已停用；不會自動重新啟用既有帳號');users[role]=user.localId;
 }
 if(users.admin===users.recorder)throw Error('兩個角色必須使用不同 UID');
 let db;
 try{db=await request('GET',database);}catch(e){if(e.status===403&&e.reason==='SERVICE_DISABLED'){let op=await request('POST',`https://serviceusage.googleapis.com/v1/projects/${EXPECTED_PROJECT}/services/firestore.googleapis.com:enable`,{});for(let n=0;!op.done&&n<60;n++){await new Promise(r=>setTimeout(r,1000));op=await request('GET','https://serviceusage.googleapis.com/v1/'+op.name);}if(!op.done||op.error)throw Error('Firestore API 尚未啟用');try{db=await request('GET',database);}catch(next){if(next.status!==404)throw next;}}else if(e.status!==404)throw e;}

 if(!db){const location=await region();if(!/^[a-z]+(?:-[a-z]+)*\d$/.test(location))throw Error('資料庫區域不正確');let op=await request('POST',`https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases?databaseId=(default)`,{locationId:location,type:'FIRESTORE_NATIVE',databaseEdition:'STANDARD',deleteProtectionState:'DELETE_PROTECTION_ENABLED',pointInTimeRecoveryEnablement:'POINT_IN_TIME_RECOVERY_DISABLED'});for(let n=0;!op.done&&n<120;n++){await new Promise(r=>setTimeout(r,1000));op=await request('GET','https://firestore.googleapis.com/v1/'+op.name);}if(!op.done||op.error)throw Error('資料庫建立尚未完成');db=await request('GET',database);}
 if(db.type!=='FIRESTORE_NATIVE'||db.databaseEdition&&db.databaseEdition!=='STANDARD'||db.pointInTimeRecoveryEnablement==='POINT_IN_TIME_RECOVERY_ENABLED')throw Error('資料庫不是預期的免費 Standard 原生配置；停止設定');
 const accessUrl=database+'/documents/access/team';let access;
 try{access=await request('GET',accessUrl);}catch(e){if(e.status!==404)throw e;}
 if(access&&(access.fields?.adminUid?.stringValue!==users.admin||access.fields?.recorderUid?.stringValue!==users.recorder))throw Error('既有角色 UID 不同，保留原授權並停止，請勿覆寫');
 await deploy();
 if(!access)await request('POST',database+'/documents:commit',{writes:[{update:{name:`projects/${EXPECTED_PROJECT}/databases/(default)/documents/access/team`,fields:{adminUid:{stringValue:users.admin},recorderUid:{stringValue:users.recorder},adminEnabled:{booleanValue:true},recorderEnabled:{booleanValue:true}}},currentDocument:{exists:false}}]});
 const domains=[...new Set([...(authConfig.authorizedDomains||[]),'ykc1117.github.io'])];if(domains.length!==(authConfig.authorizedDomains||[]).length)await request('PATCH',`${identity}/admin/v2/projects/${EXPECTED_PROJECT}/config?updateMask=authorizedDomains`,{authorizedDomains:domains});
 await saveConfig(config);
 return {projectId:EXPECTED_PROJECT,publicConfiguration:true,roles:2,rules:true,indexes:true,remoteAcceptance:'UNVERIFIED',hardwareAcceptance:'UNVERIFIED'};
}
