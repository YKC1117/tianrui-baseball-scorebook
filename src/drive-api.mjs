export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const DRIVE_APP='tianrui-drive-v1';
export class DriveError extends Error {constructor(message,code='DRIVE_ERROR'){super(message);this.code=code;}}
export function publicDriveConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DriveError('尚缺 Google OAuth 用戶端 ID、專案編號及 Picker API 金鑰。','CONFIG_REQUIRED');
 if(Object.keys(value).some(k=>!['clientId','appId','apiKey'].includes(k)))throw new DriveError('只接受三個公開欄位，請勿提供密碼、token 或 client secret。','CONFIG_INVALID');
 const out=Object.fromEntries(['clientId','appId','apiKey'].map(k=>[k,String(value[k]||'').trim()]));
 if(!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(out.clientId)||!/^\d{5,30}$/.test(out.appId)||!/^AIza[\w-]{20,80}$/.test(out.apiKey))throw new DriveError('Google 公開設定格式不完整，請依一次性網頁設定說明填寫。','CONFIG_INVALID');
 return out;
}
const fileFields='id,name,mimeType,parents,version,modifiedTime,createdTime,appProperties,capabilities(canEdit),trashed';
const safeId=id=>{if(typeof id!=='string'||!/^[-\w]{1,200}$/.test(id))throw new DriveError('Drive 檔案 ID 不正確。');return id;};
export class DriveAPI {
 constructor({getToken,fetchImpl=globalThis.fetch,timeout=20000}){Object.assign(this,{getToken,fetchImpl,timeout});}
 async request(path,{method='GET',body,headers={},raw=false,query={}}={}){
  const token=this.getToken();if(!token)throw new DriveError('請重新連接 Google Drive；本機草稿仍保留。','AUTH_REQUIRED');
  const url=new URL('https://www.googleapis.com/'+path);for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeout);
  try{const response=await this.fetchImpl.call(globalThis,url,{method,body,headers:{Authorization:'Bearer '+token,...headers},signal:controller.signal,cache:'no-store'});
  if(!response.ok){
   if(response.status===401)throw new DriveError('Google 授權已到期，請按「連接 Google Drive」重新授權；草稿保留。','AUTH_REQUIRED');
   if(response.status===403)throw new DriveError('Drive 拒絕存取。請確認共用權限、API 啟用及用量；本機草稿保留。','FORBIDDEN');
   if(response.status===404)throw new DriveError('尚未取得這個檔案的逐檔授權，或檔案已移除；請用 Google 選檔器重新選取。','NOT_FOUND');
   if(response.status===429)throw new DriveError('Google Drive 用量暫時受限，請稍後重試；未顯示為已儲存。','QUOTA');
   if(response.status>=500)throw new DriveError('Google Drive 服務暫時無法使用，保留本機草稿，尚未存到 Drive。','NETWORK');
   throw new DriveError('Drive 請求未完成（'+response.status+'）；請保留本機備份。','DRIVE_ERROR');
  }
  if(Number(response.headers?.get('Content-Length'))>30_000_000)throw new DriveError('Drive 回應過大，請先下載備份。','INVALID_DATA');
  const text=await response.text();if(raw)return text;if(!text)return {};try{return JSON.parse(text);}catch{throw new DriveError('Drive 回傳格式錯誤，沒有採用遠端資料。','INVALID_RESPONSE');}
  }catch(error){if(error instanceof DriveError)throw error;throw new DriveError('網路未完成，資料只在本機、尚未存到 Drive；請重新讀取確認。','NETWORK');}finally{clearTimeout(timer);}
 }
 about(){return this.request('drive/v3/about',{query:{fields:'user(permissionId,displayName)'}}).then(r=>{if(!r.user?.permissionId)throw new DriveError('無法辨識 Google 授權帳號。');return r.user;});}
 meta(id){return this.request('drive/v3/files/'+safeId(id),{query:{fields:fileFields,supportsAllDrives:true}});}
 async read(id){const raw=await this.request('drive/v3/files/'+safeId(id),{raw:true,query:{alt:'media',supportsAllDrives:true}});if(raw.length>30_000_000)throw new DriveError('Drive 檔案過大，請先下載備份。');try{return JSON.parse(raw);}catch{throw new DriveError('Drive JSON 格式錯誤；本機資料未被取代。','INVALID_DATA');}}
 async list(parent){
  const files=[];let pageToken;
  do{const page=await this.request('drive/v3/files',{query:{q:"'"+safeId(parent)+"' in parents and trashed = false",fields:'nextPageToken,incompleteSearch,files('+fileFields+')',pageSize:1000,supportsAllDrives:true,includeItemsFromAllDrives:true,...(pageToken?{pageToken}:{})}});
   if(page.incompleteSearch)throw new DriveError('Drive 搜尋不完整，已停止寫入，請稍後重新讀取。','INCOMPLETE');
   if(!Array.isArray(page.files))throw new DriveError('Drive 檔案清單不完整。','INVALID_RESPONSE');files.push(...page.files);pageToken=page.nextPageToken;if(files.length>30000)throw new DriveError('版本檔過多，請先備份並整理資料夾。','QUOTA');
  }while(pageToken);return files;
 }
 permissions(id){return this.request('drive/v3/files/'+safeId(id)+'/permissions',{query:{supportsAllDrives:true,fields:'nextPageToken,permissions(type,role,deleted)',pageSize:100}}).then(r=>{if(r.nextPageToken||!Array.isArray(r.permissions))throw new DriveError('無法確認完整共用權限，已停止連線。','ACL_UNVERIFIED');if(r.permissions.some(p=>!p.deleted&&p.type==='anyone'))throw new DriveError('這個資料夾開放給知道連結的任何人。請先改成「限制」，只分享指定球友。','PUBLIC_FOLDER');return r.permissions;});}
 // Existing team files are NEVER overwritten, patched, renamed or deleted.
 create(parent,name,payload,properties={}){
  const metadata={name,parents:[safeId(parent)],mimeType:'application/json',appProperties:{trApp:DRIVE_APP,...properties}};
  const boundary='tr_'+crypto.randomUUID().replaceAll('-','');
  const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(payload)+'\r\n--'+boundary+'--';
  return this.request('upload/drive/v3/files',{method:'POST',body,headers:{'Content-Type':'multipart/related; boundary='+boundary},query:{uploadType:'multipart',supportsAllDrives:true,fields:fileFields}});
 }
 folder(parent,name,properties={}){return this.request('drive/v3/files',{method:'POST',body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[safeId(parent)],appProperties:{trApp:DRIVE_APP,...properties}}),headers:{'Content-Type':'application/json'},query:{fields:fileFields,supportsAllDrives:true}});}
}
