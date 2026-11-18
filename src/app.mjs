import {driveConfig} from './drive-config.mjs';
import {DriveAuth} from './drive-auth.mjs';
import {DriveAPI,publicDriveConfig,DriveError} from './drive-api.mjs';
import {DriveWorkspace,DriveFolder,documents} from './drive-workspace.mjs';
import {WorkspaceStore} from './workspace-store.mjs';
import {mountScorebook} from './scorebook.mjs';
import {canonicalJSON} from './json-data.mjs';
import {parseBackup} from './validation.mjs';
import {decodeArchive,sealArchive} from './backup-integrity.mjs';
import demoData from '../preview/demo-data.json' with {type:'json'};

const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CONFIG_KEY='TR_DRIVE_PUBLIC_CONFIG_V1',BINDING_KEY='TR_DRIVE_LAST_BINDING_V1';
let engine,ui,auth,authLoaded=false,authLoading=false,folderInfo=null,account=null,busy=false,isDemo=false,documentRecorder='',releaseLock=null,lockKey=null,previousLocal=null;
let config=driveConfig;try{config=JSON.parse(localStorage.getItem(CONFIG_KEY)||'null')||config;}catch{}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
async function archive(){await ui?.settled();return sealArchive({...engine.backup(),unsavedUi:ui?.getState()},'TR-DRIVE-ARCHIVE-1');}
async function backup(name='天睿_完整備份.json'){download(await archive(),name);}
function failure(error){engine.status=error.message;updateStatus();}
function apiForSession(){const owner=auth,epoch=owner.epoch;return new DriveAPI({getToken:()=>owner.epoch===epoch?owner.getToken():null});}
function panel(){return `<section class="notice blue syncPanel drivePanel" aria-label="Google Drive 狀態"><div class="syncSummary"><span id="syncStatus" role="status"></span><button class="btn" id="driveSave">${engine.folder?'儲存到 Drive':'Drive 與備份'}</button></div><details id="driveTools"><summary>連線、紀錄權與備份</summary><p id="driveFolder" class="small"></p><p class="small">單人記分／其他人查看。多人同時開始可能產生衝突；版本檔保留，不覆蓋舊紀錄。查看者按「重新讀取」取得更新。</p><div class="row"><button class="btn primary" id="driveConnect">連接 Google Drive</button><button class="btn" id="driveRefresh">重新讀取</button><button class="btn" id="driveRelease">交出紀錄</button><button class="btn" id="driveBackup">下載完整備份</button><button class="btn" id="driveCloudBackup">另存 Drive 備份</button><button class="btn" id="driveImport">匯入／還原備份</button><button class="btn" id="driveSettings">Google 連線設定</button><button class="btn" id="driveGrant">授權既有資料檔</button><button class="btn" id="driveLocal">${isDemo?'離開範例，使用我的球隊':'返回本機／中斷連線'}</button><button class="btn" id="driveDemo">操作模擬範例</button><button class="btn" id="driveLegacy">下載舊版本機備份</button></div></details><div id="driveConflicts"></div></section>`;}
function updateStatus(){
 if(!engine)return;if(el('syncStatus'))el('syncStatus').textContent=isDemo?'模擬範例・只保存在此裝置，未連接 Drive':`${!navigator.onLine?'離線・':''}${engine.status}${engine.folder?'・待存 '+engine.pendingCount+' 筆':''}`;
 if(el('driveFolder'))el('driveFolder').textContent=folderInfo?`資料夾：${folderInfo.name} · ${engine.folder&&auth?.getToken()?account?.displayName||'已授權帳號':'本機快取，需重新授權'} · ${engine.folder?(folderInfo.canEdit?'可編輯':'唯讀'):'遠端權限尚未核對'} · 最後核對：${engine.workspace.lastSuccess?new Date(engine.workspace.lastSuccess).toLocaleString('zh-TW'):'尚無'}`:'目前為本機資料；尚未綁定 Google Drive 共用資料夾。';
 if(el('driveConnect'))el('driveConnect').disabled=busy||authLoading;
 const host=el('driveConflicts');if(!host)return;host.replaceChildren();for(const c of engine.conflicts){const row=document.createElement('div');row.className='notice red';const label=document.createElement('p');label.textContent=(c.key.startsWith('game:')?'比賽':c.key==='roster'?'名冊':c.key==='schedule'?'賽程':'排陣')+'版本衝突：本機與所有遠端版本保留，請下載備份後選擇。';row.append(label);for(const h of c.heads){const b=document.createElement('button');b.className='btn';b.textContent=`採用 ${h.recorder}・${new Date(h.time).toLocaleString('zh-TW')} 的版本`;b.onclick=()=>exclusive(async()=>{await backup('天睿_衝突處理前備份.json');const name=askName();if(name)ui.replace(await engine.resolve(c.key,h.id,name));});row.append(b);}host.append(row);}
}
function askName(){return prompt('請填寫此次紀錄人員姓名（最多 32 字）：')?.trim()||null;}
async function exclusive(action){if(busy)return;busy=true;updateStatus();el('app').inert=true;try{await ui?.settled();await action();}catch(error){failure(error);alert(error.message);}finally{busy=false;el('app').inert=false;updateStatus();}}
function dialog(html){let host=el('driveDialogs');if(!host){host=document.createElement('div');host.id='driveDialogs';document.body.append(host);}host.innerHTML=`<dialog class="driveDialog" id="driveDialog">${html}<div class="modalFooter"><button class="btn" id="driveDialogClose">返回</button></div></dialog>`;el('driveDialogClose').onclick=()=>el('driveDialog').close();el('driveDialog').showModal();}
async function prepareAuth(){if(!config)return;auth?.disconnect();const current=new DriveAuth(config);auth=current;authLoaded=false;authLoading=true;updateStatus();try{await current.ready();if(auth===current)authLoaded=true;}catch(error){if(auth===current){authLoaded=false;if(engine)failure(error);}}finally{if(auth===current){authLoading=false;updateStatus();}}}
function settings(){dialog(`<h2>Google Drive 一次性連線設定</h2><p>不需要在公司電腦執行指令。管理員依<a href="./GOOGLE_DRIVE_SETUP.html" target="_blank" rel="noopener">設定步驟</a>取得三個公開欄位，再貼到這裡；不填 Google 密碼或 client secret。</p><form id="driveConfigForm"><div class="field"><label for="driveClientId">OAuth 網頁用戶端 ID</label><input id="driveClientId" autocomplete="off" value="${esc(config?.clientId||'')}"></div><div class="field"><label for="driveAppId">Google Cloud 專案編號（數字）</label><input id="driveAppId" inputmode="numeric" value="${esc(config?.appId||'')}"></div><div class="field"><label for="driveApiKey">Picker API 公開金鑰</label><input id="driveApiKey" autocomplete="off" value="${esc(config?.apiKey||'')}"></div><p id="driveConfigError" role="alert"></p><button class="btn primary" type="submit">保存公開設定</button></form><p class="small">只要求逐檔 <code>drive.file</code> 權限。公開設定留在此瀏覽器；授權 token 只在記憶體，不進備份或 GitHub。</p>`);
 el('driveConfigForm').onsubmit=async event=>{event.preventDefault();try{const value=publicDriveConfig({clientId:el('driveClientId').value,appId:el('driveAppId').value,apiKey:el('driveApiKey').value});localStorage.setItem(CONFIG_KEY,JSON.stringify(value));config=value;el('driveDialog').close();engine.status='正在載入 Google 授權工具…';updateStatus();await prepareAuth();if(authLoaded){engine.status='公開設定已保存，請按「連接 Google Drive」授權。';updateStatus();}}catch(error){if(el('driveConfigError'))el('driveConfigError').textContent=error.message;}};
}
async function mount(repositoryKey,{folder=null,user=null,initial=null,demo=false}={}){
 await ui?.settled();
 if(navigator.locks&&repositoryKey!==lockKey){let nextRelease;const available=await new Promise(resolve=>navigator.locks.request('TR_DRIVE_WORKSPACE:'+repositoryKey,{ifAvailable:true},async lock=>{if(!lock){resolve(false);return;}await new Promise(r=>{nextRelease=r;resolve(true);});}));if(!available)throw new DriveError('這個瀏覽器已有同一工作區分頁，請回到原分頁，避免重複紀錄。','LOCAL_BUSY');releaseLock?.();releaseLock=nextRelease;lockKey=repositoryKey;}
 ui?.destroy();documentRecorder='';
 let holder=sessionStorage.getItem('TR_DRIVE_HOLDER:'+repositoryKey);if(!holder){holder=crypto.randomUUID();sessionStorage.setItem('TR_DRIVE_HOLDER:'+repositoryKey,holder);}
 isDemo=demo;account=user;engine=await new DriveWorkspace({repository:new WorkspaceStore(repositoryKey),folder,accountId:user?.permissionId||'local',holder}).open(initial);
 if(folder&&navigator.onLine){try{await engine.pull();}catch(error){failure(error);}}
 const current=engine;
 ui=mountScorebook({initialDb:engine.db,securityPanel:panel,onError:failure,onCapture:id=>current.ticket(id),
  onRecorder:async(id,name)=>{await ui?.settled();documentRecorder=name;return current.beginRecording(id,name);},
  onGuard:async(type,id)=>{if(type==='view')return true;if(type==='game'){if(!current.ticket(id))throw new DriveError('請先填寫本場紀錄員姓名。');return true;}if(type==='import')return askName();if(['roster','schedule'].includes(type)&&!documentRecorder){const name=askName();if(!name)return false;await current.becomeWriter(name);documentRecorder=name;}return true;},
  onSave:async(value,ticket)=>{const old=documents(current.db),changes=Object.entries(documents(value)).filter(([k,v])=>!k.startsWith('game:')&&canonicalJSON(v)!==canonicalJSON(old[k]));if(changes.length&&!documentRecorder){const name=askName();if(!name)throw new DriveError('尚未填寫姓名；變更未保存，請先備份畫面草稿。');await current.becomeWriter(name);documentRecorder=name;}const saved=await current.save(value,ticket,{name:documentRecorder||ticket?.name});updateStatus();return saved;}});
 current.onChange=updateStatus;updateStatus();
}
async function local(demo=false){const url=new URL(location.href);if(demo)url.searchParams.set('demo','1');else url.searchParams.delete('demo');history.replaceState(null,'',url);folderInfo=null;await mount('drive-'+(demo?'demo':'local')+':'+location.pathname,{initial:demo?demoData:null,demo});}
async function bindFolder(id,user){
 const api=apiForSession(),folder=new DriveFolder(api,id);let info;
 try{info=await folder.inspect();}catch(error){if(error.code!=='NOT_FOUND')throw error;dialog('<h2>尚缺既有檔案或子資料夾授權</h2><p>只選主資料夾不會授權子目錄。請補選 games、backups、claims 子資料夾，以及需要的 JSON 版本檔，再重新讀取。若檔案已移除，請先保留備份並由資料夾擁有者還原。</p><div class="row"><button class="btn" id="grantDirectories">選取既有子資料夾</button><button class="btn" id="grantJsonFiles">選取既有 JSON 資料檔</button></div>');for(const [button,files] of [['grantDirectories',false],['grantJsonFiles',true]])el(button).onclick=async()=>{try{await auth.choose({files,parent:id,multiple:true});el('driveDialog').close();await bindFolder(id,user);}catch(e){alert(e.message);}};return;}
 if(!info.initialized){dialog(`<h2>綁定 ${esc(info.name)}</h2><p>尚未讀到天睿隊伍入口。若資料夾已有紀錄，先授權既有的 <code>tianrui-team.json</code> 與 JSON 版本檔；選取資料夾不會自動授權所有子檔案。</p><div class="row"><button class="btn" id="grantBeforeInit">授權已有資料檔</button><button class="btn primary" id="initializeDrive">這是新資料夾，建立天睿入口</button></div><p class="small">只新增 games／backups／claims 及入口檔，不覆寫或刪除既有檔案。</p>`);
  el('grantBeforeInit').onclick=async()=>{try{await auth.choose({files:true,parent:id});el('driveDialog').close();await bindFolder(id,user);}catch(error){alert(error.message);}};
  el('initializeDrive').onclick=async()=>{el('initializeDrive').disabled=true;try{await folder.initialize();el('driveDialog').close();await bindFolder(id,user);}catch(error){alert(error.message);if(el('initializeDrive'))el('initializeDrive').disabled=false;}};return;
 }
 previousLocal=engine.folder?null:ui.getState();await backup('天睿_連接Drive前本機備份.json');folderInfo=info;await mount('drive-account:'+user.permissionId+':'+id,{folder,user});localStorage.setItem(BINDING_KEY,JSON.stringify({folderId:id,accountId:user.permissionId,name:info.name}));
 if(previousLocal&&(previousLocal.clubRoster.length||previousLocal.games.length)&&!engine.db.clubRoster.length&&!engine.db.games.length){dialog('<h2>已連接空白隊伍</h2><p>原本本機資料已下載備份且仍留在原工作區。是否將這份本機名冊、賽程與比賽加入新的 Drive 隊伍？範例資料不會自動上傳。</p><button class="btn primary" id="uploadLocalDraft">加入本機資料</button>');el('uploadLocalDraft').onclick=()=>{el('driveDialog').close();void exclusive(async()=>{const name=askName();if(!name)return;await engine.becomeWriter(name);documentRecorder=name;await engine.save(previousLocal,null,{importing:true,name});await engine.flush();ui.replace(engine.db);});};}
}
async function importBackup(){await backup('天睿_還原前完整備份.json');const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=()=>void exclusive(async()=>{const file=input.files?.[0];if(!file)return;const restored=parseBackup(await decodeArchive(await file.text())),name=askName();if(!name)return;if(!confirm('已下載還原前備份。比賽以新 ID 加入、不覆蓋既有比賽；名冊與賽程只在目前為空時匯入。繼續？'))return;await engine.becomeWriter(name);documentRecorder=name;const value=engine.db;if(!value.clubRoster.length){value.clubRoster=restored.clubRoster;value.draft=restored.draft;value.scheduleDrafts=restored.scheduleDrafts;value.unlinkedDraft=restored.unlinkedDraft;}if(!value.schedule.games.length)value.schedule=restored.schedule;for(const g of restored.games){const clone=structuredClone(g);clone.importedFrom={id:g.id,time:new Date().toISOString()};clone.id='id_'+crypto.randomUUID().replaceAll('-','');value.games.push(clone);}value.settings=restored.settings||value.settings;value.logo=restored.logo||value.logo;await engine.save(value,null,{importing:true,name});ui.replace(engine.db);});input.click();}
document.addEventListener('click',event=>{
 const id=event.target.closest('button')?.id;
 if(id==='driveSettings')return settings();
 if(id==='driveConnect'){
  if(isDemo){alert('目前為隔離的模擬範例，請先按「離開範例，使用我的球隊」。範例不會上傳。');return;}
  if(!config)return settings();if(!authLoaded){engine.status='正在重新載入 Google 授權工具，完成後請再按連接。';updateStatus();void prepareAuth();return;}
  const connected=auth.connect();void exclusive(async()=>{await connected;const api=apiForSession(),user=await api.about();if(account&&user.permissionId!==account.permissionId){localStorage.removeItem(BINDING_KEY);folderInfo=null;await mount('drive-unbound:'+user.permissionId,{user});engine.status='Google 帳號已切換，請選擇已獲授權的資料夾';updateStatus();}const picked=await auth.choose();if(picked[0])await bindFolder(picked[0].id,user);});return;
 }
 if(id==='driveSave'&&!engine.folder){el('driveTools').open=!el('driveTools').open;return;}
 if(id==='driveSave')return void exclusive(()=>engine.flush());
 if(id==='driveRefresh')return void exclusive(async()=>{ui.replace(await engine.pull(),{preserveRecorder:true});});
 if(id==='driveBackup')return void exclusive(()=>backup());
 if(id==='driveCloudBackup')return void exclusive(async()=>{if(!engine.folder||!auth?.getToken())throw new DriveError('請先連接 Google Drive。');await engine.folder.backup(JSON.parse(await archive()));engine.status='完整備份已另存 Drive；待儲存草稿狀態不變';});
 if(id==='driveRelease')return void exclusive(async()=>{await engine.flush();await engine.release();ui.replace(engine.db);documentRecorder='';});
 if(id==='driveGrant')return void exclusive(async()=>{if(!engine.folder||!auth?.getToken())throw new DriveError('請先連接 Google Drive。');await auth.choose({files:true,parent:engine.folder.folderId});ui.replace(await engine.pull());});
 if(id==='driveImport')return void importBackup();
 if(id==='driveLocal')return void exclusive(async()=>{await backup('天睿_切換前備份.json');if(engine.folder&&engine.writer&&!engine.pendingCount)await engine.release();auth?.disconnect();localStorage.removeItem(BINDING_KEY);await local(false);});
 if(id==='driveDemo')return void exclusive(async()=>{await backup('天睿_進入範例前備份.json');if(engine.folder&&engine.writer&&!engine.pendingCount)await engine.release();auth?.disconnect();await local(true);});
 if(id==='driveLegacy'){const raw=localStorage.getItem('TR_BASEBALL_OFFLINE_V1');if(raw)download(raw,'天睿_舊版本機備份.json');else alert('此裝置沒有舊版本機資料。');}
});
setInterval(()=>{if(busy||!engine?.folder)return;void engine.heartbeat().then(()=>engine.flush()).catch(failure);},30000);
addEventListener('online',()=>{if(engine?.folder&&!busy)void engine.flush().catch(failure);});
addEventListener('offline',()=>{if(engine){engine.status='離線・僅保存在本機，尚未存到 Drive';updateStatus();}});
new MutationObserver(()=>{if(engine&&el('syncStatus')&&!el('syncStatus').textContent)updateStatus();}).observe(el('app'),{childList:true,subtree:true});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
try{let binding=null;try{binding=JSON.parse(localStorage.getItem(BINDING_KEY)||'null');}catch{}const demo=new URL(location.href).searchParams.get('demo')==='1';const cacheKey=binding?'drive-account:'+binding.accountId+':'+binding.folderId:null;
 if(!demo&&cacheKey&&await new WorkspaceStore(cacheKey).read()){await mount(cacheKey,{user:{permissionId:binding.accountId}});folderInfo={name:binding.name,canEdit:false};engine.status='Drive 快取草稿・尚未重新授權，修改僅保存在本機';updateStatus();}else await local(demo);
 if(config)void prepareAuth();}catch(error){el('app').innerHTML='<section class="card"><h1>工作區未開啟</h1><p role="alert">'+esc(error.message)+'</p><p>原資料仍保留；請回到既有分頁或先下載備份。</p></section>';}
