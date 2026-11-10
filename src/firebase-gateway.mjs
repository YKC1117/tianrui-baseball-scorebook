import * as f from './vendor/firebase.mjs';
import {CloudError} from './cloud-gateway.mjs';
import {validateGame,validateRoster,validateSchedule,validId} from './validation.mjs';
import {sealArchive} from './backup-integrity.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function cloudError(error) {
 if(error instanceof CloudError)return error;
 const code=String(error.code||'');
 if(/network-request-failed|unavailable|deadline-exceeded/.test(code))return new CloudError('無法連線，草稿仍保留，尚未同步。','OFFLINE');
 if(/resource-exhausted/.test(code))return new CloudError('免費配額暫時用完，草稿已保留；請稍後重試並下載備份。','QUOTA_EXHAUSTED');
 if(/permission-denied/.test(code))return new CloudError('雲端拒絕操作，請確認授權及紀錄權；草稿仍保留。','NOT_APPROVED');
 if(/user-disabled|user-token-expired|invalid-user-token/.test(code))return new CloudError('登入已失效，請重新登入。','SESSION_EXPIRED');
 if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code))return new CloudError('帳號或密碼錯誤。','BAD_CREDENTIALS');
 return new CloudError('雲端操作未完成，草稿已保留。',code||'UNKNOWN');
}
export class TianRuiCloud {
 constructor(config,{auth,db,app}={}) {
  if(!config?.projectId||!config?.apiKey||!config?.authDomain)throw Error('請先設定天睿專用 Firebase 專案。');
  if(config.emulators && (!config.projectId.startsWith('demo-') || !(globalThis.location?['localhost','127.0.0.1'].includes(location.hostname):globalThis.process?.env?.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8080')))throw Error('模擬器只允許本機 demo 專案測試。');
  this.url=`firebase:${config.projectId}`;this.names=new Map();this.generation=0;this.cachedExpiry=0;
  this.app=app||f.initializeApp(config,globalThis.location?`tianrui-v15-${config.projectId}`:`tr-${crypto.randomUUID()}`);
  this.auth=auth||f.getAuth(this.app);
  this.db=db||f.initializeFirestore(this.app,{localCache:f.memoryLocalCache(),experimentalForceLongPolling:true});
  if(config.emulators){
   f.connectAuthEmulator(this.auth,'http://127.0.0.1:9099',{disableWarnings:true});
   f.connectFirestoreEmulator(this.db,'127.0.0.1',8080);
  }
  this.ready=f.setPersistence(this.auth,globalThis.sessionStorage?f.browserSessionPersistence:f.inMemoryPersistence)
   .then(()=>this.auth.authStateReady()).then(async()=>{if(this.auth.currentUser){try{this.cachedExpiry=Date.parse((await this.auth.currentUser.getIdTokenResult()).expirationTime);}catch{}}});
 }
 get signedIn(){return Boolean(this.auth.currentUser);}
 get session(){return this.auth.currentUser?{user_id:this.auth.currentUser.uid}:null;}
 get expiresAt(){return this.cachedExpiry;}
 async call(fn){
  let timer;
  try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CloudError('連線逾時，草稿仍保留；尚未確認同步。','OFFLINE')),15000);})]);}
  catch(e){throw cloudError(e);}finally{clearTimeout(timer);}
 }
 async signIn(email,password){
  await this.ready;
  return this.call(async()=>{await f.signInWithEmailAndPassword(this.auth,email,password);try{await this.memberRole();return await this.verifySession();}catch(e){await this.signOut();throw e;}});
 }
 async signOut(){this.generation++;this.names.clear();this.cachedExpiry=0;await f.signOut(this.auth);}
 async verifySession(){
  await this.ready;const generation=this.generation,user=this.auth.currentUser;
  if(!user)throw new CloudError('請先登入。','NOT_SIGNED_IN');
  return this.call(async()=>{const result=await user.getIdTokenResult();if(generation!==this.generation||this.auth.currentUser?.uid!==user.uid)throw new CloudError('帳號已變更。','ACCOUNT_CHANGED');this.cachedExpiry=Date.parse(result.expirationTime);return {id:user.uid};});
 }
 async memberRole(){
  await this.verifySession();
  if(globalThis.navigator?.onLine===false)throw new CloudError('目前離線，草稿仍保留。','OFFLINE');
  return this.call(async()=>{const d=(await f.getDocFromServer(f.doc(this.db,'access/team'))).data();const uid=this.auth.currentUser?.uid;
   if(d?.adminUid===uid&&d.adminEnabled)return 'admin';
   if(d?.recorderUid===uid&&d.recorderEnabled)return 'recorder';
   throw new CloudError('此帳號未獲授權。','NOT_APPROVED');});
 }
 ref(type,id){if(!validId(id))throw new CloudError('資料 ID 不正確。','BAD_ID');return f.doc(this.db,type==='game'?'games':'team',id);}
 row(s,type){if(!s.exists())return null;const d=s.data();return type==='game'?{game_id:s.id,revision:d.revision,state:d.payload,updated_at:d.updatedAt?.toDate().toISOString()}:{doc_key:s.id,revision:d.revision,document:d.payload};}
 async getGame(id){return this.call(async()=>this.row(await f.getDocFromServer(this.ref('game',id)),'game'));}
 async listGames(){return this.call(async()=>(await f.getDocsFromServer(f.collection(this.db,'games'))).docs.map(s=>this.row(s,'game')));}
 async getDocument(id){return this.call(async()=>this.row(await f.getDocFromServer(this.ref(id,id)),id));}
 _assertRecorder(n){if(typeof n!=='string'||!n.trim()||n.trim().length>32)throw new CloudError('紀錄人員姓名必填（最多 32 字）','RECORDER_REQUIRED');}
 proof(writer,kind,id,token,name,operationId){
  if(typeof token!=='string'||token.length<32)throw new CloudError('裝置租約憑證不完整。','BAD_LEASE');
  writer.set(f.doc(this.db,'proofs',operationId),{kind,gameId:id,token,name:name.trim(),actor:this.auth.currentUser.uid,at:f.serverTimestamp()});
  writer.set(f.doc(this.db,'leases',id),{token,name:name.trim(),actor:this.auth.currentUser.uid,proofId:operationId,
   expiresAt:kind==='release'?f.serverTimestamp():f.Timestamp.fromMillis(Date.now()+90000)});
 }
 async acquireLease(id,token,name){
  this.ref('game',id);this._assertRecorder(name);
  await this.verifySession();
  try{const batch=f.writeBatch(this.db);this.proof(batch,'claim',id,token,name,crypto.randomUUID());await batch.commit();this.names.set(id,name.trim());return true;}
  catch(e){if(e.code==='permission-denied')return false;throw cloudError(e);}
 }
 async releaseLease(id,token){
  this.ref('game',id);await this.verifySession();
  const name=this.names.get(id);if(!name)return false;
  return this.call(async()=>{const batch=f.writeBatch(this.db);this.proof(batch,'release',id,token,name,crypto.randomUUID());await batch.commit();this.names.delete(id);return true;});
 }
 async write(type,id,expected,data,name,operation,operationId,token){
  this._assertRecorder(name);await this.verifySession();
  if(!validId(operationId))throw new CloudError('操作 ID 不正確。','BAD_ID');
  const payload=clone(data);
  if(type==='game')validateGame(payload);else if(type==='roster')validateRoster(payload.roster);else if(type==='schedule')validateSchedule(payload);else throw Error('BAD_DOCUMENT');
  // Duplicated immutable audit payload and Firestore's 1 MiB document ceiling.
  // Conservative byte cap leaves metadata overhead; rejection keeps the outbox.
  if(new TextEncoder().encode(JSON.stringify(payload)).length>700000)throw new CloudError('本場資料接近免費後端文件大小上限；草稿已保留，請先下載備份。','DOCUMENT_TOO_LARGE');
  const actor=this.auth.currentUser.uid,ref=this.ref(type,id),opRef=f.doc(this.db,'audit',operationId);
  const request={kind:type,target:id,actor,name:name.trim(),before:expected,after:expected+1,operation,payload};
  return this.call(async()=>{
   const revision=await f.runTransaction(this.db,async tx=>{
    const [prior,accepted]=await Promise.all([tx.get(ref),tx.get(opRef)]);
    if(this.auth.currentUser?.uid!==actor)throw new CloudError('帳號已變更。','ACCOUNT_CHANGED');
    if(accepted.exists()){
     const {at,...saved}=accepted.data();
     if(canonical(saved)!==canonical(request))throw new CloudError('操作 ID 已用於其他內容，草稿已保留。','OPERATION_ID_REUSED');
     return saved.after;
    }
    if((prior.data()?.revision||0)!==expected)throw new CloudError('版本衝突，兩份資料均已保留。','REVISION_CONFLICT');
    tx.set(ref,{revision:expected+1,payload,lastOperation:operationId,updatedAt:f.serverTimestamp()});
    tx.set(opRef,{...request,at:f.serverTimestamp()});
    if(type==='game')this.proof(tx,'game',id,token,name,operationId);
    return expected+1;
   });
   if(type==='game')this.names.set(id,name.trim());
   return revision;
  }).catch(async error=>{
   if(type==='game'&&error.code==='NOT_APPROVED'){
    await this.memberRole();
    throw new CloudError('紀錄權已失效或伺服器拒絕版本，草稿已保留；請重新接手。','NOT_RECORDING_LEASE_HOLDER');
   }
   throw error;
  });
 }
 createGame(game,name,op=crypto.randomUUID(),token){return this.write('game',game.id,0,game,name,'CREATE',op,token);}
 saveGame(game,expected,token,name,operation='EDIT',op=crypto.randomUUID()){return this.write('game',game.id,expected,game,name,operation,op,token);}
 saveDocument(type,expected,data,name,operation='EDIT',op=crypto.randomUUID()){return this.write(type,type,expected,data,name,operation,op);}
 async exportBackup(){
  if(await this.memberRole()!=='admin')throw new CloudError('只有管理員可建立完整雲端稽核備份。','ADMIN_REQUIRED');
  const snapshot=async()=>{const [games,roster,schedule]=await Promise.all([this.listGames(),this.getDocument('roster'),this.getDocument('schedule')]);return {games:games.sort((a,b)=>a.game_id.localeCompare(b.game_id)),roster,schedule};};
  const before=await snapshot();
  const audit=await this.call(async()=>(await f.getDocsFromServer(f.collection(this.db,'audit'))).docs.map(s=>({id:s.id,...s.data(),at:s.data().at.toDate().toISOString()})));
  const after=await snapshot();
  if(canonical(before)!==canonical(after))throw new CloudError('備份期間有其他裝置修改，請暫停紀錄後重試。','BACKUP_CHANGED');
  for(const row of audit){if(row.kind==='game')validateGame(row.payload);else if(row.kind==='roster')validateRoster(row.payload.roster);else validateSchedule(row.payload);}
  for(const [kind,id,revision] of [...after.games.map(g=>['game',g.game_id,g.revision]),...['roster','schedule'].filter(t=>after[t]).map(t=>[t,t,after[t].revision])]){
   if(!audit.some(a=>a.kind===kind&&a.target===id&&a.after===revision))throw new CloudError('雲端稽核資料不完整，未建立備份。','INCOMPLETE_SNAPSHOT');
  }
  const db={games:after.games.map(g=>g.state),clubRoster:after.roster?.document.roster||[],schedule:after.schedule?.document||{format:'TR-SCHEDULE-1',season:'球隊賽程',games:[]},draft:null,activeId:null,settings:{scale:1,pitchView:'split'},logo:null};
  const payload={format:'TR-SECURE-BACKUP-15',exportedAt:new Date().toISOString(),sourceProject:this.url,workspace:{db},serverSnapshot:after,serverAudit:audit};
  return sealArchive(payload);
 }
 async close(){await f.terminate(this.db);await f.deleteApp(this.app);}
}
