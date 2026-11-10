import {cloudConfig} from './config.mjs';
import {TianRuiCloud} from './cloud-gateway.mjs';
import {WorkspaceStore} from './workspace-store.mjs';
import {SyncStore} from './sync-store.mjs';
import {mountScorebook} from './scorebook.mjs';
import {mountSchedule} from './schedule.mjs';
import {parseBackup,validateGame,validateRoster} from './validation.mjs';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cloud,engine,ui,documentRecorder='',role,releaseLock,activeLockKey;
function download(data,name) {
 const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function gate(message='請使用管理者提供的帳號登入。') {
 el('modalhost').replaceChildren();
 el('app').innerHTML=`<section class="card"><h1>天睿共用紀錄登入</h1><p id="authMessage" role="status">${esc(message)}</p>${cloud?'<form id="loginForm"><div class="field"><label for="account">共用／管理員帳號</label><input id="account" type="email" required autocomplete="username"></div><div class="field"><label for="password">密碼</label><input id="password" type="password" required autocomplete="current-password"></div><button class="btn orange" id="login">登入</button></form>':''}<p class="small muted">帳號由管理者建立；紀錄人員姓名於每次開賽或接手時填寫。</p><button class="btn" id="legacyDownload">下載此裝置舊版完整備份</button>${engine?'<button class="btn" id="emergencyBackup">下載待同步工作區備份</button>':''}</section>`;
 el('legacyDownload').onclick=()=>{const raw=localStorage.getItem('TR_BASEBALL_OFFLINE_V1');if(raw)download(raw,'tianrui-legacy-backup.json');else alert('此裝置沒有舊版資料。');};
 if(el('emergencyBackup'))el('emergencyBackup').onclick=()=>download(backup(),'tianrui-workspace-backup.json');
 if(el('loginForm'))el('loginForm').onsubmit=async event=>{
  event.preventDefault();el('login').disabled=true;
  try {await cloud.signIn(el('account').value,el('password').value);el('password').value='';await start();}
  catch(error){gate(error.message);}
 };
}
async function askName() {
 const name=prompt('請填寫此次操作的紀錄人員姓名（最多 32 字）：');
 if(name===null)return null;cloud._assertRecorder(name);return name.trim();
}
function backup(){const value=JSON.parse(engine.backup());if(ui?.getState)value.unsavedUi=ui.getState();return JSON.stringify(value,null,2);}
function panel(){return `<section class="notice blue" aria-label="同步狀態"><div class="row between"><span id="syncStatus" role="status"></span><div class="row"><button class="btn small" id="syncNow">重新同步／讀取</button><button class="btn small" id="allBackup">完整備份</button><button class="btn small" id="importLegacy">匯入舊版／還原備份</button><button class="btn small" id="logout">登出</button></div></div><div id="conflictActions"></div></section>`;}
function updateStatus(){
 if(el('syncStatus'))el('syncStatus').textContent=`${role==='admin'?'管理員':'共用紀錄帳號'} · ${engine.status} · 待同步 ${engine.pendingCount} 筆 · 最後成功：${engine.workspace.lastSuccess?new Date(engine.workspace.lastSuccess).toLocaleString('zh-TW'):'尚無'}`;
 if(el('conflictActions')){
  el('conflictActions').replaceChildren();
  for(const c of engine.workspace.conflicts.filter(c=>!c.resolved)){
   const row=document.createElement('p'),label=document.createElement('span');label.textContent=`${c.key.startsWith('game:')?'比賽':'名冊／賽程'}版本衝突：`;
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
 const key=`${cloud.url}:${user.id}`;
 if(activeLockKey&&activeLockKey!==key){releaseLock?.();releaseLock=null;}activeLockKey=key;
 if(!navigator.locks)throw Error('此瀏覽器不支援安全分頁鎖，請更新瀏覽器後再使用。');
 if(!releaseLock){
  const locked=await new Promise(resolve=>{navigator.locks.request(`TR_WORKSPACE:${key}`,{ifAvailable:true},async lock=>{resolve(Boolean(lock));if(lock)await new Promise(release=>{releaseLock=release;});});});
  if(!locked)throw Error('同一瀏覽器已有開啟中的紀錄分頁，請回到該分頁操作。');
 }
 const holderKey=`TR_HOLDER_V15:${key}`;let holderToken=sessionStorage.getItem(holderKey);if(!holderToken){holderToken=crypto.randomUUID();sessionStorage.setItem(holderKey,holderToken);}
 engine=await new SyncStore({cloud,repository:new WorkspaceStore(key),holderToken}).open();
 if(navigator.onLine){try{await engine.flush();await engine.pull();}catch(error){if(error.code!=='OFFLINE'||!engine.workspace.lastSuccess)throw error;engine.status='離線待同步；目前顯示快取資料';}}
 else if(!engine.workspace.lastSuccess)throw Error('首次登入必須連網下載資料。');
 else engine.status='離線待同步；目前顯示快取資料';
 const cached=engine.db;validateRoster(cached.clubRoster);cached.games.forEach(validateGame);
 const onError=error=>{engine.status=error.message;updateStatus();};
 const onSave=async db=>{
  const stored=engine.db;
  // Read-only stat rendering can normalize legacy pitching fields. Persist only
  // games for which this page has explicitly entered a recording session.
  db.games=db.games.map(game=>engine.editors.has(game.id)?game:stored.games.find(g=>g.id===game.id)||game);
  validateRoster(db.clubRoster);db.games.forEach(validateGame);
  for(const game of db.games)if(game.logo)delete game.logo;
  await engine.commit(db,documentRecorder,'EDIT');updateStatus();
  void engine.flush().catch(onError);return engine.db;
 };
 if(location.pathname.endsWith('/schedule.html'))ui=mountSchedule({engine,role,panel,updateStatus});
 else ui=mountScorebook({initialDb:engine.db,onSave,onError,securityPanel:panel,
  onRecorder:async(id,name,isNew)=>{await ui?.settled();return engine.beginRecording(id,name,isNew);},
  onGuard:async(type,id)=>{
   if(type==='view'){await ui?.settled();await engine.releaseEditors();return true;}
   if(type==='game'){engine.assertEditor(id);return true;}
   if(type==='import')return askName();
   if(!documentRecorder)documentRecorder=await askName();
   return documentRecorder;
  }
 });
 engine.onChange=updateStatus;
 engine.onAuthLost=()=>{ui?.destroy?.();ui=null;gate('登入已失效，待同步草稿仍保留，請重新登入。');};
 updateStatus();
}
// Buttons survive scorebook renders through delegation. Ordinary mutation handlers
// remain inside the original scorebook; auth/data access is owned here.
document.addEventListener('click',async event=>{
 const id=event.target.closest('button')?.id;
 if(!engine||!ui)return;
 try {
  if(id==='allBackup'){await ui.settled();download(backup(),'tianrui-workspace-backup.json');}
  if(id==='syncNow'){await ui.settled();await engine.flush();ui.replace(await engine.pull());updateStatus();}
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
  const restored=parseBackup(await file.text());
  const name=await askName();if(!name)return;
  if(!confirm('已下載匯入前備份。比賽會以新 ID 新增，不覆蓋雲端既有比賽；名冊只在雲端與待同步名冊均為空時匯入。繼續？'))return;
  const db=engine.db;
  if(!db.clubRoster.length&&!engine.workspace.revisions['roster:roster']&&!engine.workspace.pending.some(p=>p.type==='roster')){db.clubRoster=restored.clubRoster||[];db.draft=restored.draft||null;documentRecorder=name;}
  if(role==='admin'&&!db.schedule.games.length&&!engine.workspace.pending.some(p=>p.type==='schedule')&&restored.schedule){db.schedule=restored.schedule;documentRecorder=name;}
  await engine.releaseEditors();
  for(const game of restored.games){const cloned=structuredClone(game);cloned.importedFrom={id:game.id,time:new Date().toISOString()};if(cloned.auditTrail){cloned.importedAuditTrail=cloned.auditTrail;delete cloned.auditTrail;}cloned.id=`id_${crypto.randomUUID().replaceAll('-','')}`;db.games.push(cloned);}
  // Preferences remain local. Import only known fields, never credentials/outbox IDs.
  if(restored.settings)db.settings={scale:Number(restored.settings.scale)||1,pitchView:restored.settings.pitchView==='combined'?'combined':'split'};
  if(restored.logo)db.logo=restored.logo;
  await engine.commit(db,documentRecorder||name,'IMPORT_BACKUP',true);ui.replace(engine.db);updateStatus();
 }catch(error){alert('匯入失敗：'+error.message);}};
 input.click();
}
setInterval(()=>{if(engine&&ui){void engine.heartbeat();void engine.flush().catch(()=>{});}},30000);
addEventListener('online',()=>{if(engine&&ui)void engine.flush().catch(()=>{});});
addEventListener('offline',()=>{if(engine){engine.status='離線待同步；無法確認其他裝置操作';updateStatus();}});
// Updating only text avoids destroying partially completed forms during sync.
new MutationObserver(()=>{if(engine&&el('syncStatus')&&!el('syncStatus').textContent)updateStatus();}).observe(el('app'),{childList:true,subtree:true});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(!cloudConfig)gate('天睿專用後端尚未設定；目前無法登入或同步。舊版本機資料完整保留，可先下載備份。');
else {
 try{cloud=new TianRuiCloud(cloudConfig);if(cloud.signedIn)await start();else gate();}
 catch(error){gate(error.message);}
}
