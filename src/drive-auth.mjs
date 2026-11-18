import {DRIVE_SCOPE,publicDriveConfig,DriveError} from './drive-api.mjs';
const scripts=new Map();
function loadScript(src){if(scripts.has(src))return scripts.get(src);const p=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>{scripts.delete(src);reject(new DriveError('無法載入 Google 授權工具；本機功能仍可使用。','NETWORK'));};document.head.append(s);});scripts.set(src,p);return p;}
export class DriveAuth {
 constructor(config){this.config=publicDriveConfig(config);this.token=null;this.expires=0;this.epoch=0;}
 getToken(){return Date.now()<this.expires?this.token:null;}
 async ready(){await Promise.all([loadScript('https://accounts.google.com/gsi/client'),loadScript('https://apis.google.com/js/api.js')]);await new Promise((resolve,reject)=>gapi.load('picker',{callback:resolve,onerror:()=>reject(new DriveError('Google 選檔器載入失敗。')),timeout:15000,ontimeout:()=>reject(new DriveError('Google 選檔器載入逾時。'))}));}
 // Called directly by a real click once scripts are ready; no passwords or refresh tokens.
 connect(){return new Promise((resolve,reject)=>{
  const client=google.accounts.oauth2.initTokenClient({client_id:this.config.clientId,scope:DRIVE_SCOPE,include_granted_scopes:false,
   callback:r=>{if(r.error||!r.access_token)return reject(new DriveError('Google 授權未完成；本機資料未變更。','AUTH_REQUIRED'));if(!google.accounts.oauth2.hasGrantedAllScopes(r,DRIVE_SCOPE))return reject(new DriveError('尚未授予必要的逐檔 Drive 權限。','AUTH_REQUIRED'));this.epoch++;this.token=r.access_token;this.expires=Date.now()+Math.max(0,Number(r.expires_in)-30)*1000;resolve();},
   error_callback:()=>reject(new DriveError('Google 授權視窗未完成，請再按一次連接。','AUTH_REQUIRED'))});client.requestAccessToken({prompt:'select_account'});
 });}
 choose({files=false,parent=null,multiple=false}={}){const token=this.getToken();if(!token)return Promise.reject(new DriveError('請先重新連接 Google Drive。','AUTH_REQUIRED'));return new Promise((resolve,reject)=>{
  const view=files?new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setMimeTypes('application/json'):new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
  if(parent)view.setParent(parent);
  let builder=new google.picker.PickerBuilder().setDeveloperKey(this.config.apiKey).setAppId(this.config.appId).setOAuthToken(token).setOrigin(location.origin).addView(view).setTitle(files?'授權已有的天睿 JSON 資料檔':'選擇「天睿棒球紀錄」共用資料夾');
  if(files||multiple)builder=builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
  const picker=builder.setCallback(data=>{if(data.action===google.picker.Action.PICKED){picker.setVisible(false);resolve(data.docs||[]);}else if(data.action===google.picker.Action.CANCEL){picker.setVisible(false);resolve([]);}else if(data.action==='error'){picker.setVisible(false);reject(new DriveError('Google 選檔器授權失敗。'));}}).build();picker.setVisible(true);
 });}
 disconnect(){this.epoch++;this.token=null;this.expires=0;}
}
