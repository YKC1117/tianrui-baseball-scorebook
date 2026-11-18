import {normalizePlanningState} from '../src/lineup-planning.mjs';
import {mountScorebook} from '../src/scorebook.mjs';
import {validateGame,validateRoster,validateSchedule,parseBackup} from '../src/validation.mjs';
import demo from './demo-data.json' with {type:'json'};
const KEY='TR_UI_REVIEW_SANDBOX_V1';
let saved,ui,storageAvailable=true,lastStatus='',lastError=false;
try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{storageAvailable=false;}
let db=normalizePlanningState(saved||demo);
function status(message,error=false){lastStatus=message;lastError=error;const node=document.getElementById('demoSaveStatus');if(node){node.textContent=message;node.dataset.error=String(error);}}
function download(data,name,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}
function panel(){return `<div class="previewBar"><span><span class="statusDot"></span>UI 試用版・全部為模擬資料</span><button class="textButton" id="demoOptions">試用設定</button></div><div class="saveLine" id="demoSaveStatus" role="status" data-error="${lastError||!storageAvailable}">${lastStatus|| (storageAvailable?'試用進度保留在此瀏覽器':'目前無法自動保存，請由試用設定下載備份')}</div>`;}
ui=mountScorebook({initialDb:db,securityPanel:panel,onRecorder:async(id)=>structuredClone(db.games.find(g=>g.id===id)||null),onGuard:async type=>{if(type!=='import')return true;const name=prompt('請填寫這場匯入比賽的紀錄員姓名：');if(!name?.trim())return null;return name.trim().slice(0,32);},
 onSave:async value=>{validateRoster(value.clubRoster);value.games.forEach(validateGame);validateSchedule(value.schedule);db=structuredClone(value);try{localStorage.setItem(KEY,JSON.stringify(db));storageAvailable=true;status('已儲存・只影響本機試用資料');}catch{storageAvailable=false;throw Error('此瀏覽器無法保存，請由「試用設定」下載備份後再離開。');}return db;},onError:error=>status(error.message,true)});
document.addEventListener('click',async event=>{
 const anchor=event.target.closest('a[href^="#"]');if(anchor){event.preventDefault();document.getElementById(anchor.getAttribute('href').slice(1))?.scrollIntoView({behavior:'smooth'});return;}
 const id=event.target.closest('button')?.id;
 if(id==='demoOptions'){
  document.getElementById('previewSettings').showModal();
 }else if(id==='closePreviewSettings')document.getElementById('previewSettings').close();
 else if(id==='resetPreview'){
  if(!confirm('要回到最初的模擬名單與示範比賽嗎？只會重設這個試用版；其他網站資料不受影響。'))return;
  await ui.settled();const initial=normalizePlanningState(demo);try{localStorage.setItem(KEY,JSON.stringify(initial));db=initial;storageAvailable=true;document.getElementById('previewSettings').close();ui.replace(db);status('已重設模擬資料');}catch{status('無法保存重設結果，原有試用進度仍保留；請先下載備份。',true);}
 }else if(id==='downloadPreviewHTML'){
  try{const source=new URL('./tianrui-ui-preview.html',document.baseURI);source.search=new URL(document.baseURI).search;const response=await fetch(source,{cache:'no-store'});if(!response.ok)throw Error('下載未完成');download(await response.text(),'天睿_UIUX_離線試用版.html','text/html');}catch{alert('目前無法下載，請恢復連線後再試。已下載的 HTML 可直接用桌面瀏覽器開啟。');}
 }else if(id==='exportPreview'){
  await ui.settled();download(JSON.stringify({format:'TR-SECURE-BACKUP-15',exportedAt:new Date().toISOString(),workspace:{db:ui.getState()}},null,2),'天睿_UI試用_完整備份.json');
 }else if(id==='importPreview')document.getElementById('previewImport').click();
});
document.getElementById('downloadPreviewHTML').hidden=location.protocol==='file:';
document.getElementById('previewImport').onchange=async event=>{
 try{const file=event.target.files[0];if(!file)return;const restored=parseBackup(await file.text());if(!confirm('要在試用版載入這份備份嗎？不會連線或寫入正式系統。'))return;await ui.settled();localStorage.setItem(KEY,JSON.stringify(restored));db=structuredClone(restored);storageAvailable=true;ui.replace(db);document.getElementById('previewSettings').close();status('試用備份已載入');}catch(error){alert('無法載入或保存這份試用備份，原有進度未被取代：'+error.message);}finally{event.target.value='';}
};
