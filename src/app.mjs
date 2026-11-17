import {cloudConfig} from './config.mjs';
import {TianRuiCloud} from './firebase-gateway.mjs';
import {WorkspaceStore} from './workspace-store.mjs';
import {SyncStore} from './sync-store.mjs';
import {mountScorebook} from './scorebook.mjs';
import {normalizeConfig} from './quick-scoring.mjs';
import {normalizePlanningState} from './lineup-planning.mjs';
import {planningDocument} from './planning-document.mjs';
import {RECORDER_EMAIL,validatePublicConfig} from './login-config.mjs';
import {parseBackup,validateGame,validateRoster} from './validation.mjs';
import {decodeArchive} from './backup-integrity.mjs';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cloud,engine,ui,documentRecorder='',role,releaseLock,activeLockKey,syncBusy=false;let loginRole='recorder';
function download(data,name) {
 const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function gate(message='隊友選擇球隊紀錄，只需輸入共用密碼。') {
 el('modalhost').replaceChildren();
 el('app').innerHTML=`<section class="card loginCard"><h1>天睿球隊登入</h1><p id="authMessage" role="status">${esc(message)}</p>${cloud?`<div class="tabs"><button class="btn ${loginRole==='recorder'?'sel':''}" id="recorderLogin">球隊紀錄</button><button class="btn ${loginRole==='admin'?'sel':''}" id="adminLogin">管理員</button></div><form id="loginForm">${loginRole==='admin'?'<div class="field"><label for="account">管理員帳號</label><input id="account" type="email" required autocomplete="username"></div>':''}<div class="field"><label for="password">${loginRole==='admin'?'管理員':'球隊共用'}密碼</label><input id="password" type="password" required autocomplete="current-password"></div><button class="btn orange" id="login">登入</button></form>`:''}<p class="small muted">帳號由管理員建立。開始、繼續或接手比賽時必須填寫紀錄人員姓名。</p><button class="btn" id="legacyDownload">下載此裝置舊版完整備份</button>${engine?'<button class="btn" id="emergencyBackup">下載待同步工作區備份</button>':''}</section>`;
 for(const [id,value] of [['recorderLogin','recorder'],['adminLogin','admin']])if(el(id))el(id).onclick=()=>{loginRole=value;gate();};
 el('legacyDownload').onclick=()=>{const raw=localStorage.getItem('TR_BASEBALL_OFFLINE_V1');if(raw)download(raw,'tianrui-legacy-backup.json');else alert('此裝置沒有舊版資料。');};
 if(el('emergencyBackup'))el('emergencyBackup').onclick=()=>download(backup(),'tianrui-workspace-backup.json');
 if(el('loginForm'))el('loginForm').onsubmit=async event=>{
  event.preventDefault();el('login').disabled=true;const password=el('password').value;el('password').value='';
  try {await cloud.signIn(loginRole==='recorder'?RECORDER_EMAIL:el('account').value,password);await start();}
  catch(error){gate(error.message);}
 };
}
async function askName() {
 const name=prompt('請填寫此次操作的紀錄人員姓名（最多 32 字）：');
 if(name===null)return null;cloud._assertRecorder(name);return name.trim();
}
function backup(){const value=JSON.parse(engine.backup());if(ui?.getState)value.unsavedUi=ui.getState();return JSON.stringify(value,null,2);}
function panel(){return `<section class="notice blue syncPanel" aria-label="同步狀態"><div class="syncSummary"><span id="syncStatus" role="status"></span><button class="btn" id="syncNow">同步</button></div><details id="accountTools"><summary>紀錄權與備份</summary><p class="small" id="lastCloudSync"></p><div class="row"><button class="btn" id="releaseRecording">交出紀錄權</button><button class="btn" id="allBackup">完整備份</button>${role==='admin'?'<button class="btn" id="cloudBackup">雲端稽核備份</button>':''}<button class="btn" id="importLegacy">匯入舊版／還原備份</button><button class="btn" id="logout">登出</button></div></details><div id="conflictActions"></div></section>`;}
function updateStatus(){
 if(el('syncStatus'))el('syncStatus').textContent=`${role==='admin'?'管理員':'共用紀錄帳號'} · ${engine.status} · 待同步 ${engine.pendingCount} 筆`;
 if(el('lastCloudSync'))el('lastCloudSync').textContent='最後雲端同步：'+(engine.workspace.lastSuccess?new Date(engine.workspace.lastSuccess).toLocaleString('zh-TW'):'尚無');
 if(el('conflictActions')){
  el('conflictActions').replaceChildren();
  for(const c of engine.workspace.conflicts.filter(c=>!c.resolved)){
   const row=document.createElement('p'),label=document.createElement('span');label.textContent=`${c.key.startsWith('game:')?'比賽':c.key.startsWith('planning:')?'排陣':'名冊／賽程'}版本衝突：`;
   row.append(label);
   for(const [keep,text] of [[true,'保留兩份（比賽另存）'],[false,'備份草稿並採用雲端']]){
    if(keep&&!c.key.startsWith('game:'))continue;
    const b=document.createElement('button');b.className='btn small';b.textContent=text;
    b.onclick=async()=>{try{const name=await askName();if(!name)return;download(backup(),'tianrui-conflict-backup.json');await ui.settled();ui.replace(await engine.resolve(c.key,name,keep));updateStatus();}catch(e){alert(e.message);}};
    row.append(b);
   }
   el('conflictActions').append(row);
  }
 }
}
async function start(){
 const approvalKey=`TR_APPROVED_V15:${cloud.url}`;
 let user;
 try {
  user=await cloud.verifySession();role=await cloud.memberRole();
  if(!['admin','recorder'].includes(role))throw Error('未核准角色');
  sessionStorage.setItem(approvalKey,JSON.stringify({id:user.id,role}));
 }catch(error){
  const approved=JSON.parse(sessionStorage.getItem(approvalKey)||'null');
  if(error.code!=='OFFLINE'||!approved||approved.id!==cloud.session?.user_id||Date.now()>=cloud.expiresAt)throw error;
  user={id:approved.id};role=approved.role;
 }
 documentRecorder='';
 const key=`${cloud.url}:${user.id}`;
 if(activeLockKey&&activeLockKey!==key){releaseLock?.();releaseLock=null;}activeLockKey=key;
 if(!navigator.locks)throw Error('此瀏覽器不支援安全分頁鎖，請更新瀏覽器後再使用。');
 if(!releaseLock){
  const locked=await new Promise(resolve=>{navigator.locks.request(`TR_WORKSPACE:${key}`,{ifAvailable:true},async lock=>{resolve(Boolean(lock));if(lock)await new Promise(release=>{releaseLock=release;});});});
  if(!locked)throw Error('同一瀏覽器已有開啟中的紀錄分頁，請回到該分頁操作。');
 }
 const holderKey=`TR_HOLDER_V15:${key}`;let holderToken=sessionStorage.getItem(holderKey);if(!holderToken){holderToken=crypto.randomUUID();sessionStorage.setItem(holderKey,holderToken);}
 engine=await new SyncStore({cloud,repository:new WorkspaceStore(key),holderToken,accountId:user.id}).open();
 if(navigator.onLine){try{await engine.flush();await engine.pull();}catch(error){if(error.code!=='OFFLINE'||!engine.workspace.lastSuccess)throw error;engine.status='離線待同步；目前顯示快取資料';}}
 else if(!engine.workspace.lastSuccess)throw Error('首次登入必須連網下載資料。');
 else engine.status='離線待同步；目前顯示快取資料';
 const currentEngine=engine;let mounted;
 const cached=engine.db;validateRoster(cached.clubRoster);cached.games.forEach(validateGame);
 const onError=error=>{if(engine!==currentEngine)return;currentEngine.status=error.message;updateStatus();};
 const onSave=async (db,ticket)=>{
  const stored=currentEngine.db;
  // Read-only stat rendering can normalize legacy pitching fields. Persist only
  // games for which this page has explicitly entered a recording session.
  db=normalizePlanningState(db);
  db.games=db.games.map(game=>ticket?.gameId===game.id?game:stored.games.find(g=>g.id===game.id)||game);
  validateRoster(db.clubRoster);db.games.forEach(validateGame);
  for(const game of db.games)if(game.logo)delete game.logo;
  if(!documentRecorder&&(JSON.stringify(db.clubRoster)!==JSON.stringify(stored.clubRoster)||JSON.stringify(db.schedule)!==JSON.stringify(stored.schedule)||JSON.stringify(planningDocument(db))!==JSON.stringify(planningDocument(stored))))documentRecorder=await askName();
  await currentEngine.commit(db,documentRecorder,'EDIT',false,ticket);updateStatus();
  void currentEngine.flush().catch(onError);return currentEngine.db;
 };
 mounted=mountScorebook({initialDb:currentEngine.db,onSave,onError,securityPanel:panel,
  onCapture:id=>currentEngine.recorderTicket(id),
  onRecorder:async(id,name,isNew)=>{await mounted?.settled();return currentEngine.beginRecording(id,name,isNew);},
  onGuard:async(type,id)=>{
   if(type==='view'){await mounted?.settled();await currentEngine.releaseEditors();return true;}
   if(type==='game'){currentEngine.assertEditor(id);return true;}
   if(type==='import')return askName();
   if(type==='schedule'&&role!=='admin')throw Error('只有管理員可以修改賽程');
   if(!documentRecorder)documentRecorder=await askName();
   return Boolean(documentRecorder);
  }
 });
 currentEngine.onChange=updateStatus;
 ui=mounted;
 currentEngine.onAuthLost=()=>{if(engine!==currentEngine)return;sessionStorage.removeItem(approvalKey);const previous=ui;previous?.destroy?.();void Promise.resolve(previous?.settled()).finally(()=>{if(ui!==previous)return;ui=null;gate('登入已失效，待同步草稿仍保留，請重新登入。');});};
 updateStatus();
}
// Buttons survive scorebook renders through delegation. Ordinary mutation handlers
// remain inside the original scorebook; auth/data access is owned here.
document.addEventListener('click',async event=>{
 const id=event.target.closest('button')?.id;
 if(!engine||!ui)return;
 try {
  if(id==='allBackup'){await ui.settled();download(backup(),'tianrui-workspace-backup.json');}
  if(id==='cloudBackup'){await ui.settled();await engine.flush();download(await cloud.exportBackup(),'tianrui-cloud-audit-backup.json');}
  if(id==='syncNow'){
   if(syncBusy)return;
   syncBusy=true;el('app').inert=true;el('app').setAttribute('aria-busy','true');
   try{await ui.settled();await engine.flush();ui.replace(await engine.pull(),{preserveRecorder:true});}
   finally{syncBusy=false;el('app').inert=false;el('app').setAttribute('aria-busy','false');updateStatus();}
  }
  if(id==='releaseRecording'){await ui.settled();await engine.flush();if(engine.pendingCount)throw Error('仍有未同步操作，請先備份並處理同步，尚未交出紀錄權。');await engine.releaseEditors();ui.replace(engine.db);engine.status='紀錄權已交出；再次紀錄需重新填寫姓名';updateStatus();}
  if(id==='logout'){
   await ui.settled();documentRecorder='';
   await engine.releaseEditors().catch(()=>{});engine.editors.clear();
   try{await cloud.signOut();}finally{sessionStorage.removeItem(`TR_APPROVED_V15:${cloud.url}`);releaseLock?.();releaseLock=null;location.reload();}
  }
  if(id==='importLegacy')await importWorkspace();
 }catch(error){alert(error.message);updateStatus();}
});
async function importWorkspace(){
 await ui.settled();download(backup(),'tianrui-before-import.json');
 const input=document.createElement('input');input.type='file';input.accept='.json';
 input.onchange=async()=>{try{
  const file=input.files?.[0];if(!file)return;
  const restored=parseBackup(await decodeArchive(await file.text()));
  const name=await askName();if(!name)return;
  if(!confirm('已下載匯入前備份。比賽會以新 ID 新增，不覆蓋雲端既有比賽；名冊只在雲端與待同步名冊均為空時匯入。繼續？'))return;
  const db=engine.db;
  if(!db.clubRoster.length&&!engine.workspace.revisions['roster:roster']&&!engine.workspace.pending.some(p=>p.type==='roster')){db.clubRoster=restored.clubRoster||[];db.draft=restored.draft||null;db.scheduleDrafts=restored.scheduleDrafts||{};db.unlinkedDraft=restored.unlinkedDraft||null;documentRecorder=name;}
  if(role==='admin'&&!db.schedule.games.length&&!engine.workspace.pending.some(p=>p.type==='schedule')&&restored.schedule){db.schedule=restored.schedule;documentRecorder=name;}
  await engine.releaseEditors();
  for(const game of restored.games){const cloned=structuredClone(game);cloned.importedFrom={id:game.id,time:new Date().toISOString()};if(cloned.auditTrail){cloned.importedAuditTrail=cloned.auditTrail;delete cloned.auditTrail;}cloned.id=`id_${crypto.randomUUID().replaceAll('-','')}`;db.games.push(cloned);}
  // Preferences remain local. Import only known fields, never credentials/outbox IDs.
  if(restored.settings)db.settings={scale:Number(restored.settings.scale)||1,pitchView:restored.settings.pitchView==='combined'?'combined':'split',quickScoring:normalizeConfig(restored.settings.quickScoring)};
  if(restored.logo)db.logo=restored.logo;
  await engine.commit(db,documentRecorder||name,'IMPORT_BACKUP',true);ui.replace(engine.db);updateStatus();void engine.flush().catch(error=>{engine.status=error.message;updateStatus();});
 }catch(error){alert('匯入失敗：'+error.message);}};
 input.click();
}
setInterval(()=>{if(engine&&ui){void engine.heartbeat();void engine.flush().catch(()=>{});}},30000);
addEventListener('online',()=>{if(engine&&ui)void engine.flush().catch(()=>{});});
addEventListener('offline',()=>{if(engine){engine.status='離線待同步；無法確認其他裝置操作';updateStatus();}});
// Updating only text avoids destroying partially completed forms during sync.
new MutationObserver(()=>{if(engine&&el('syncStatus')&&!el('syncStatus').textContent)updateStatus();}).observe(el('app'),{childList:true,subtree:true});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(!cloudConfig)gate('天睿專案已建立，網站連線設定尚未完成；目前無法登入或同步。請管理員完成一次性設定。舊版本機資料保留，可先下載備份。');
else {
 try{validatePublicConfig(cloudConfig,{emulators:['localhost','127.0.0.1'].includes(location.hostname)});cloud=new TianRuiCloud(cloudConfig);await cloud.ready;if(cloud.signedIn)await start();else gate();}
 catch(error){gate(error.message);}
}
