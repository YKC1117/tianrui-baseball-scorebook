import {canonicalJSON} from './json-data.mjs';
import {DriveError,DRIVE_APP} from './drive-api.mjs';
import {validateRoster,validateGame,validateSchedule,validId} from './validation.mjs';
import {planningDocument,validatePlanning,applyPlanning} from './planning-document.mjs';
import {normalizePlanningState} from './lineup-planning.mjs';

const copy=x=>structuredClone(x),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
export const emptyDriveDb=()=>normalizePlanningState({games:[],clubRoster:[],schedule:{format:'TR-SCHEDULE-1',season:'球隊賽程',games:[]},activeId:null,draft:null,settings:{scale:1,pitchView:'split'},logo:null});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(value)))),x=>x.toString(16).padStart(2,'0')).join('');
export function documents(db){return {...Object.fromEntries(db.games.map(g=>['game:'+g.id,g])),'roster':db.clubRoster,'schedule':db.schedule,'planning':planningDocument(db)};}
function validateDocument(key,data){if(key==='roster')return validateRoster(data);if(key==='schedule')return validateSchedule(data);if(key==='planning')return validatePlanning(data);if(key.startsWith('game:')&&validId(key.slice(5))&&data?.id===key.slice(5))return validateGame(data);throw new DriveError('Drive 文件類型或 ID 不正確。','INVALID_DATA');}
function apply(db,key,data){validateDocument(key,data);if(key==='roster')db.clubRoster=copy(data);else if(key==='schedule')db.schedule=copy(data);else if(key==='planning')applyPlanning(db,data);else db.games=db.games.filter(g=>g.id!==data.id).concat(copy(data));}
export async function revision({id,key,parents,data,actor,recorder,holder,time,operation='EDIT',operations=[]}){validateDocument(key,data);const value={format:'TR-DRIVE-REVISION-1',id,key,parents:[...parents].sort(),data:copy(data),actor,recorder,holder,time,operation,operations:copy(operations)};return {...value,sha256:await digest(value)};}
function changes(before,after,path=[]){if(same(before,after))return [];if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)){return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>changes(before[k],after[k],[...path,k]));}return [{path,...(before===undefined?{}:{before:copy(before)}),...(after===undefined?{}:{after:copy(after)})}];}
async function checkRevision(value,meta){
 if(!value||value.format!=='TR-DRIVE-REVISION-1'||!validId(value.id)||value.id!==meta.appProperties?.trRevision||value.key!==meta.appProperties?.trKey||!Array.isArray(value.parents)||value.parents.length>100||value.parents.some(x=>!validId(x)||x===value.id)||new Set(value.parents).size!==value.parents.length||typeof value.recorder!=='string'||!value.recorder.trim()||value.recorder.length>32||typeof value.actor!=='string'||typeof value.holder!=='string'||typeof value.time!=='string')throw new DriveError('Drive 版本檔格式不正確，已停止採用。','INVALID_DATA');
 const {sha256,...payload}=value;if(sha256!==await digest(payload))throw new DriveError('Drive 版本檔完整性檢查失敗；本機草稿保留。','INTEGRITY');if(!Array.isArray(value.operations)||value.operations.some(op=>!validId(op.id)||typeof op.recorder!=='string'||!op.recorder.trim()||op.recorder.length>32||typeof op.time!=='string'||!Array.isArray(op.changes)))throw new DriveError('Drive 操作紀錄格式不完整。','INVALID_DATA');validateDocument(value.key,value.data);return value;
}
export function revisionHeads(rows){
 const byId=new Map();for(const r of rows){if(byId.has(r.id)&&byId.get(r.id).sha256!==r.sha256)throw new DriveError('同一版本 ID 有不同內容，已停止寫入。','INTEGRITY');byId.set(r.id,r);}
 const children=new Set();for(const r of byId.values())for(const p of r.parents){if(!byId.has(p))throw new DriveError('缺少前版資料：可能尚未授權既有檔案或檔案已被移走。請用選檔器補授權，不可建立空白資料蓋過它。','MISSING_HISTORY');children.add(p);}
 // Detect cycles even when another valid head exists.
 const done=new Set(),visiting=new Set();function walk(id){if(visiting.has(id))throw new DriveError('Drive 版本鏈循環，已停止採用。','INVALID_DATA');if(done.has(id))return;visiting.add(id);for(const p of byId.get(id).parents)walk(p);visiting.delete(id);done.add(id);}for(const id of byId.keys())walk(id);
 return [...byId.values()].filter(r=>!children.has(r.id)).sort((a,b)=>a.id.localeCompare(b.id));
}

// A Drive folder is not a transactional database. Every cloud write creates a new
// immutable file, so a simultaneous start produces recoverable branches, never
// last-writer-wins replacement. Claims are advisory, not atomic distributed locks.
export class DriveFolder {
 constructor(api,folderId,{now=()=>Date.now()}={}){Object.assign(this,{api,folderId,now});this.cache=new Map();}
 async directory(kind){const meta=await this.api.meta(this.manifest[kind]);if(meta.trashed||meta.mimeType!=='application/vnd.google-apps.folder'||!meta.parents?.includes(this.folderId))throw new DriveError('隊伍子目錄已移除或移出所選資料夾，已停止存取。','DIRECTORY_CHANGED');await this.api.permissions(meta.id);return meta.id;}
 async inspect(){const folder=await this.api.meta(this.folderId);if(folder.mimeType!=='application/vnd.google-apps.folder'||folder.trashed)throw new DriveError('請選擇可用的 Google Drive 共用資料夾。');await this.api.permissions(this.folderId);this.folder=folder;const manifests=(await this.api.list(this.folderId)).filter(f=>f.appProperties?.trApp===DRIVE_APP&&f.appProperties?.trKind==='manifest');if(manifests.length>1)throw new DriveError('資料夾有重複的隊伍入口，請先保留備份並整理，沒有自動覆寫。','DUPLICATE_MANIFEST');if(manifests.length){const m=await this.api.read(manifests[0].id);if(m.format!=='TR-DRIVE-TEAM-1'||m.folderId!==this.folderId||!validId(m.id))throw new DriveError('隊伍入口格式不正確。');for(const kind of ['games','backups','claims']){const dir=await this.api.meta(m[kind]);if(dir.mimeType!=='application/vnd.google-apps.folder'||!dir.parents?.includes(this.folderId))throw new DriveError('隊伍目錄不屬於這個資料夾。');await this.api.permissions(dir.id);}this.manifest=m;}
  return {name:folder.name,canEdit:folder.capabilities?.canEdit===true,initialized:Boolean(this.manifest)};
 }
 async initialize(){await this.inspect();if(this.manifest)return;if(!this.folder.capabilities?.canEdit)throw new DriveError('只有資料夾編輯者可以建立隊伍檔案。','FORBIDDEN');const m={format:'TR-DRIVE-TEAM-1',id:crypto.randomUUID(),folderId:this.folderId};const list=await this.api.list(this.folderId);for(const kind of ['games','backups','claims']){const candidates=list.filter(f=>f.mimeType==='application/vnd.google-apps.folder'&&f.appProperties?.trApp===DRIVE_APP&&f.appProperties?.trKind===kind);if(candidates.length>1)throw new DriveError('有重複目錄，請先備份並整理。');m[kind]=(candidates[0]||await this.api.folder(this.folderId,kind,{trKind:kind})).id;}await this.api.create(this.folderId,'tianrui-team.json',m,{trKind:'manifest'});await this.inspect();}
 async snapshot(){
  if(!this.manifest)throw new DriveError('此資料夾尚未建立天睿入口；若已有資料請先補授權，不要重新初始化。','UNINITIALIZED');
  await this.api.permissions(this.folderId);
  const groups={},stamps={};for(const kind of ['games','backups']){
   const list=await this.api.list(await this.directory(kind));
   for(const meta of list.filter(f=>f.appProperties?.trApp===DRIVE_APP&&f.appProperties?.trKind==='revision')){
    const stamp=String(meta.version)+'|'+meta.modifiedTime;stamps[meta.id]=stamp;let cached=this.cache.get(meta.id);
    if(cached&&cached.stamp!==stamp)throw new DriveError('既有版本檔被直接修改，已停止採用；請先備份並核對 Drive 歷史。','IMMUTABLE_CHANGED');
    if(!cached||cached.stamp!==stamp){const row=await checkRevision(await this.api.read(meta.id),meta);cached={stamp,row};this.cache.set(meta.id,cached);}
    (groups[cached.row.key]??=[]).push(copy(cached.row));
   }
  }
  const heads={};for(const [key,rows] of Object.entries(groups))heads[key]=revisionHeads(rows);return {groups,heads,stamps};
 }
 async append(row){const kind=row.key.startsWith('game:')?'games':'backups';const name=row.key.replace(':','_')+'__'+row.id+'.json';return this.api.create(await this.directory(kind),name,row,{trKind:'revision',trKey:row.key,trRevision:row.id});}
 async claimRows(){const list=await this.api.list(await this.directory('claims'));return list.filter(m=>m.appProperties?.trApp===DRIVE_APP&&m.appProperties?.trKind==='claim');}
 activeClaims(rows){const latest=new Map();for(const m of rows){const p=m.appProperties;if(!validId(p?.trHolder)||!['active','released'].includes(p.trState))throw new DriveError('紀錄裝置資訊不完整，請重新讀取。');const at=Date.parse(m.createdTime);if(!Number.isFinite(at))throw new DriveError('無法確認 Drive 紀錄權時間。');const old=latest.get(p.trHolder);if(!old||at>old.at||(at===old.at&&m.id>old.meta.id))latest.set(p.trHolder,{at,meta:m});}return [...latest.values()].filter(x=>x.meta.appProperties.trState==='active'&&x.at+120000>this.now()).map(x=>x.meta);}
 async assertClaim(holder){const active=this.activeClaims(await this.claimRows());if(active.length!==1||active[0].appProperties.trHolder!==holder)throw new DriveError(active.length>1?'偵測到同時開始紀錄，已停止上傳；各裝置草稿保留。請只留一台並交出其他裝置紀錄權。':'另一裝置正在紀錄，或紀錄權已到期。請重新填寫姓名並接手。','CLAIM_REQUIRED');}
 async claim(holder,recorder,release=false){if(!release){const active=this.activeClaims(await this.claimRows());if(active.some(m=>m.appProperties.trHolder!==holder))throw new DriveError('另一裝置正在紀錄；目前請查看，或請原裝置交出紀錄權。','CLAIM_BUSY');}await this.api.create(await this.directory('claims'),'device_'+crypto.randomUUID()+'.json',{format:'TR-DRIVE-CLAIM-1',holder,recorder,released:release},{trKind:'claim',trHolder:holder,trState:release?'released':'active'});if(!release)await this.assertClaim(holder);}
 async backup(payload){await this.api.permissions(this.folderId);return this.api.create(await this.directory('backups'),'完整備份_'+new Date().toISOString().replaceAll(':','-')+'_'+crypto.randomUUID()+'.json',payload,{trKind:'backup'});}
}

export class DriveWorkspace {
 constructor({repository,folder=null,accountId='local',holder=crypto.randomUUID(),online=()=>globalThis.navigator?.onLine!==false,now=()=>new Date().toISOString()}){Object.assign(this,{repository,folder,accountId,holder,online,now});this.chain=Promise.resolve();this.recorders=new Map();this.writer='';this.status='本機模式・尚未連接 Google Drive';}
 run(fn){const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p;}
 async open(initial){this.workspace=await this.repository.read()||{format:'TR-DRIVE-WORKSPACE-1',generation:0,db:initial?copy(initial):emptyDriveDb(),heads:{},pending:{},conflicts:{},archives:[],audit:[],inflight:null,lastSuccess:null};return this;}
 get db(){return copy(this.workspace.db);}
 get pendingCount(){return Object.keys(this.workspace.pending).length;}
 get conflicts(){return Object.entries(this.workspace.conflicts).map(([key,value])=>({key,...copy(value)}));}
 async persist(next){const gen=this.workspace.generation;next.generation=gen+1;await this.repository.write(next,gen);this.workspace=next;this.onChange?.();}
 name(value){const s=String(value||'').trim();if(!s||s.length>32)throw new DriveError('請填寫紀錄人員姓名（最多 32 字）。','RECORDER_REQUIRED');return s;}
 ticket(id){return copy(this.recorders.get(id)||null);}
 async becomeWriter(name){this.writer=this.name(name);if(this.folder&&this.online()){if(!this.folder.folder?.capabilities?.canEdit){this.writer='';throw new DriveError('Google Drive 共用權限是唯讀，不能上傳。','FORBIDDEN');}try{await this.folder.claim(this.holder,this.writer);}catch(e){if(['NETWORK','AUTH_REQUIRED'].includes(e.code)&&this.workspace.lastSuccess){this.status='Google 尚未連接・僅保留本機草稿';return false;}this.writer='';throw e;}}return true;}
 async beginRecording(id,name){return this.run(async()=>{const remoteReady=await this.becomeWriter(name);if(this.folder&&this.online()&&remoteReady){try{await this.pullInternal();}catch(e){if(!['NETWORK','AUTH_REQUIRED'].includes(e.code)||!this.workspace.lastSuccess)throw e;this.status='連線中斷・僅記錄本機草稿';}}if(this.workspace.conflicts['game:'+id])throw new DriveError('本場有版本衝突，請先下載備份並處理。','CONFLICT');this.recorders.set(id,{id:crypto.randomUUID(),gameId:id,name:this.name(name)});return this.db.games.find(g=>g.id===id)||null;});}
 async save(db,ticket=null,{importing=false,name=this.writer}={}){const value=copy(db);validateRoster(value.clubRoster);validateSchedule(value.schedule);value.games.forEach(validateGame);return this.run(async()=>{
  const next=copy(this.workspace),old=documents(next.db),incoming=documents(value);if(next.db.games.some(g=>!value.games.some(x=>x.id===g.id)))throw new DriveError('比賽只能封存，不可移除原有紀錄。');
  const changed=[];for(const [key,data] of Object.entries(incoming)){if(same(data,old[key]))continue;
   if(key.startsWith('game:')&&!importing){const t=this.recorders.get(key.slice(5));if(!t||!ticket||t.id!==ticket.id){apply(value,key,old[key]);continue;}}
   validateDocument(key,data);const recorder=key.startsWith('game:')?(ticket?.name||name):name;
   const op={id:crypto.randomUUID(),recorder:this.name(recorder),actor:this.accountId,time:this.now(),localGeneration:next.generation+1,changes:changes(old[key],data)};
   next.pending[key]={data:copy(data),recorder:this.name(recorder),operation:importing?'RESTORE':'EDIT',operations:[...(next.pending[key]?.operations||[]),op]};changed.push(key);
  }
  next.db=value;if(changed.length)next.audit.push({id:crypto.randomUUID(),time:this.now(),recorder:this.name(name||ticket?.name),actor:this.accountId,holder:this.holder,keys:changed,localGeneration:next.generation+1,operation:importing?'RESTORE':'EDIT'});
  await this.persist(next);this.status=this.folder?(this.pendingCount?'本機已保存・待存到 Drive':'已讀取 Drive；單人記分模式'):'本機已保存・尚未連接 Google Drive';this.onChange?.();return this.db;
 });}
 async pullInternal(snapshot){
  const remote=snapshot||await this.folder.snapshot(),next=copy(this.workspace);
  for(const [id,stamp] of Object.entries(next.remoteStamps||{}))if(remote.stamps[id]!==stamp)throw new DriveError('已知版本檔被修改、移除或尚未授權，已停止寫入；本機資料保留。','IMMUTABLE_CHANGED');
  for(const [key,heads] of Object.entries(remote.heads)){
   const ids=heads.map(x=>x.id).sort(),known=next.heads[key]||[];
   if(heads.length!==1||(next.pending[key]&&!same(ids,known))){next.conflicts[key]={heads,detectedAt:this.now()};continue;}
   if(!next.pending[key]){apply(next.db,key,heads[0].data);next.heads[key]=ids;delete next.conflicts[key];}
  }
  // A formerly readable version disappearing is not an empty team.
  for(const key of Object.keys(next.heads))if(!remote.heads[key])throw new DriveError('已知遠端資料不可見或已移除，保留本機資料並停止儲存；請補授權。','MISSING_HISTORY');
  next.remoteStamps=remote.stamps;next.lastSuccess=this.now();await this.persist(next);return remote;
 }
 async pull(){return this.run(async()=>{if(!this.folder)throw new DriveError('尚未連接 Google Drive，本機資料仍保留。','AUTH_REQUIRED');if(!this.online())throw new DriveError('目前離線，保留本機草稿，尚未重新讀取。','NETWORK');if(this.workspace.inflight)await this.flushInternal();await this.pullInternal();this.status=this.conflicts.length?'版本衝突・兩份資料均保留':this.pendingCount?'遠端已核對・仍有本機待儲存草稿':'已讀取 Drive・單人記分／其他人查看';this.onChange?.();return this.db;});}
 async flush(){return this.run(()=>this.flushInternal());}
 async flushInternal(){
  if(!this.folder)return this.db;if(!this.online())throw new DriveError('離線待儲存；尚未存到 Google Drive。','NETWORK');
  if(!this.pendingCount&&!this.workspace.inflight)return this.db;if(!this.writer)throw new DriveError('請先填寫姓名並啟用單人紀錄，待儲存草稿仍在本機。','RECORDER_REQUIRED');
  await this.folder.assertClaim(this.holder);
  let remote=await this.folder.snapshot();
  // A failed HTTP acknowledgement never causes a different logical operation.
  if(this.workspace.inflight){const row=this.workspace.inflight;if(!(remote.groups[row.key]||[]).some(x=>x.id===row.id)){await this.folder.append(row);remote=await this.folder.snapshot();}await this.ack(row,remote);if(this.conflicts.length)return this.db;}
  await this.pullInternal(remote);
  if(this.conflicts.length){this.status='版本衝突・未覆蓋遠端，請先保留備份並處理';this.onChange?.();return this.db;}
  for(const key of Object.keys(this.workspace.pending)){
   await this.folder.assertClaim(this.holder);remote=await this.folder.snapshot();
   const heads=remote.heads[key]||[];if(!same(heads.map(h=>h.id).sort(),this.workspace.heads[key]||[])){await this.pullInternal(remote);this.status='版本衝突・未覆蓋遠端';this.onChange?.();return this.db;}
   const pending=this.workspace.pending[key],row=await revision({id:crypto.randomUUID(),key,parents:this.workspace.heads[key]||[],data:pending.data,recorder:pending.recorder,actor:this.accountId,holder:this.holder,time:this.now(),operation:pending.operation,operations:pending.operations});
   const next=copy(this.workspace);next.inflight=row;await this.persist(next);await this.folder.append(row);remote=await this.folder.snapshot();await this.ack(row,remote);if(this.conflicts.length)return this.db;
  }
  this.status='已存到 Google Drive・單人記分模式';this.onChange?.();return this.db;
 }
 async ack(row,remote){const heads=remote.heads[row.key]||[];if(!(remote.groups[row.key]||[]).some(x=>x.id===row.id))throw new DriveError('尚未讀回本次版本，不能確認已儲存；草稿與操作 ID 保留。','ACK_PENDING');const next=copy(this.workspace);for(const [id,stamp] of Object.entries(next.remoteStamps||{}))if(remote.stamps[id]!==stamp)throw new DriveError('已知遠端版本被改動，停止確認儲存。','IMMUTABLE_CHANGED');next.remoteStamps=remote.stamps;next.inflight=null;
  if(heads.length!==1||heads[0].id!==row.id){next.conflicts[row.key]={heads,detectedAt:this.now()};this.status='偵測到同時儲存分支・全部版本保留，請停止多台記分';}
  else{next.heads[row.key]=[row.id];const ids=new Set((row.operations||[]).map(x=>x.id)),remaining=(next.pending[row.key]?.operations||[]).filter(x=>!ids.has(x.id));if(same(next.pending[row.key]?.data,row.data)&&!remaining.length)delete next.pending[row.key];else if(next.pending[row.key])next.pending[row.key].operations=remaining;delete next.conflicts[row.key];next.lastSuccess=this.now();}
  await this.persist(next);
 }
 async resolve(key,chosenId,name){return this.run(async()=>{await this.becomeWriter(name);const remote=await this.folder.snapshot(),heads=remote.heads[key]||[],chosen=heads.find(x=>x.id===chosenId);if(!chosen)throw new DriveError('遠端版本已變動，請重新讀取後選擇。','CONFLICT');const next=copy(this.workspace);next.archives.push({time:this.now(),key,local:documents(next.db)[key],pending:next.pending[key]||null,heads});delete next.pending[key];delete next.conflicts[key];apply(next.db,key,chosen.data);next.heads[key]=heads.map(x=>x.id).sort();
  if(heads.length>1){const row=await revision({id:crypto.randomUUID(),key,parents:next.heads[key],data:chosen.data,recorder:this.name(name),actor:this.accountId,holder:this.holder,time:this.now(),operation:'RESOLVE'});next.inflight=row;next.pending[key]={data:chosen.data,recorder:this.name(name),operation:'RESOLVE'};}
  await this.persist(next);if(this.workspace.inflight){await this.folder.append(this.workspace.inflight);await this.ack(this.workspace.inflight,await this.folder.snapshot());}this.status='已採用所選版本；其他版本與本機衝突備份均保留';this.onChange?.();return this.db;
 });}
 async release(){return this.run(async()=>{if(this.pendingCount||this.workspace.inflight)throw new DriveError('仍有待存到 Drive 的資料，請先儲存或下載備份並處理，尚未交出。');if(this.folder&&this.writer&&this.online())await this.folder.claim(this.holder,this.writer,true);this.writer='';this.recorders.clear();this.status='已交出紀錄；再次開始需填寫姓名';this.onChange?.();});}
 async heartbeat(){return this.run(async()=>{if(this.folder&&this.writer&&this.online()){try{await this.folder.assertClaim(this.holder);await this.folder.claim(this.holder,this.writer);}catch(error){this.writer='';this.status=error.message;this.onChange?.();}}});}
 backup(){return {format:'TR-SECURE-BACKUP-15',storage:'Google Drive immutable versions',exportedAt:this.now(),workspace:copy(this.workspace)};}
}
