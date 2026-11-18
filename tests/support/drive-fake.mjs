// Synthetic Drive v3 contract simulator. Not evidence of real Google OAuth,
// Picker grants, folder ACLs, or concurrent Drive service behavior.
export class FakeDrive {
 constructor(){this.files=new Map();this.serial=0;this.clock=Date.now();this.calls=[];this.roles={alpha:'writer',beta:'writer',viewer:'reader'};this.failStatus=null;this.failAfterCreate=false;this.hidden=new Set();this.public=false;this.put({id:'team_folder',name:'合成天睿測試資料夾',mimeType:'application/vnd.google-apps.folder',parents:[]});}
 tick(ms=1){this.clock+=ms;return new Date(this.clock).toISOString();}
 put(meta,data){const id=meta.id||'file_'+(++this.serial);const value={id,name:meta.name,mimeType:meta.mimeType||'application/json',parents:meta.parents||[],appProperties:meta.appProperties||{},version:'1',modifiedTime:this.tick(),createdTime:this.tick(),...meta};this.files.set(id,{meta:value,data:structuredClone(data)});return structuredClone(value);}
 change(id,data){const f=this.files.get(id);f.data=structuredClone(data);f.meta.version=String(Number(f.meta.version)+1);f.meta.modifiedTime=this.tick();}
 response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
 async fetch(url,options={}){
  url=new URL(url);const method=options.method||'GET',headers=new Headers(options.headers),actor=(headers.get('Authorization')||'').replace('Bearer test-token-','');this.calls.push({method,path:url.pathname,actor});
  if(!['alpha','beta','viewer','outsider'].includes(actor))return this.response({},401);
  if(this.failStatus)return this.response({},this.failStatus);
  if(url.pathname==='/drive/v3/about')return this.response({user:{permissionId:actor,displayName:'合成帳號 '+actor,emailAddress:actor+'@example.invalid'}});
  if(!this.roles[actor])return this.response({},403);
  const role=this.roles[actor],wrap=m=>({...structuredClone(m),capabilities:{canEdit:role==='writer'}});
  if(method==='GET'&&url.pathname==='/drive/v3/files'){
   const parent=(url.searchParams.get('q')||'').match(/^'([^']+)' in parents/)?.[1];const files=[...this.files.values()].filter(f=>f.meta.parents.includes(parent)&&!this.hidden.has(actor+':'+f.meta.id)).map(f=>wrap(f.meta));return this.response({files});
  }
  const match=url.pathname.match(/^\/drive\/v3\/files\/([\w-]+)(\/permissions)?$/);
  if(method==='GET'&&match){const f=this.files.get(match[1]);if(!f||this.hidden.has(actor+':'+match[1]))return this.response({},404);if(match[2])return this.response({permissions:this.public?[{type:'anyone',role:'reader'}]:Object.entries(this.roles).map(([id,role])=>({type:'user',id,role}))});if(url.searchParams.get('alt')==='media')return this.response(f.data);return this.response(wrap(f.meta));}
  if(method==='POST'){
   if(role!=='writer')return this.response({},403);let meta,data;
   if(url.pathname==='/upload/drive/v3/files'){
    const boundary=headers.get('Content-Type')?.match(/boundary=(.+)$/)?.[1];const parts=String(options.body).split('--'+boundary).filter(p=>p.includes('Content-Type:'));[meta,data]=parts.map(p=>JSON.parse(p.slice(p.indexOf('\r\n\r\n')+4).trim()));
   }else if(url.pathname==='/drive/v3/files')meta=JSON.parse(options.body);else return this.response({},404);
   if(!meta.parents?.every(id=>this.files.has(id)))return this.response({},404);const result=this.put(meta,data);if(this.failAfterCreate){this.failAfterCreate=false;throw Error('Synthetic lost acknowledgement');}return this.response(wrap(result));
  }
  return this.response({},405);
 }
}
export class MemoryWorkspace {
 async read(){return structuredClone(this.value||null);}
 async write(value,gen){if((this.value?.generation||0)!==gen)throw Error('LOCAL_WORKSPACE_CONFLICT');this.value=structuredClone(value);}
}
