import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {driveConfig} from '../src/drive-config.mjs';
import {publicDriveConfig} from '../src/drive-api.mjs';
if(driveConfig)publicDriveConfig(driveConfig);
if(process.argv.includes('--release')){if(!driveConfig)throw Error('正式部署阻擋：尚未提供 Google OAuth／Picker 公開設定。');let acceptance=null;try{acceptance=JSON.parse(await readFile('.private/drive-production-acceptance.json','utf8'));}catch{}if(!['realGoogleOAuth','sharedFolderAcrossAccounts','twoDevices','privacyReviewed','hardware'].every(k=>acceptance?.checks?.[k]===true))throw Error('正式部署阻擋：真實 Google 授權、共用逐檔權限、雙裝置、隱私及真機仍需實際驗收。');}
const out='dist-drive';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const result=await build({entryPoints:['src/app.mjs'],bundle:true,format:'esm',target:['safari16','chrome105'],minify:true,write:false,external:['./drive-config.mjs'],legalComments:'inline'});
const logo='data:image/png;base64,'+(await readFile('logo-tianrui.png')).toString('base64');
let html=await readFile('index.html','utf8');for(const file of ['src/ui-review.css','src/drive.css']){const css=await readFile(file,'utf8');html=html.replace('<link rel="stylesheet" href="./'+file+'">',()=>'<style>'+css+'</style>');}
const js=result.outputFiles[0].text.replaceAll('./logo-tianrui.png',logo).replaceAll('</script','<\\/script');
html=html.replace('<script type="module" src="./src/app.mjs"></script>',()=>'<script type="module">'+js+'</script>').replaceAll('./logo-tianrui.png',logo);
await writeFile(out+'/index.html',html);await copyFile('src/drive-config.mjs',out+'/drive-config.mjs');await writeFile(out+'/.nojekyll','');for(const file of ['manifest.webmanifest','icon-192.png','icon-512.png'])await copyFile(file,out+'/'+file);
await copyFile('docs/GOOGLE_DRIVE_SETUP.html',out+'/GOOGLE_DRIVE_SETUP.html');
const version=createHash('sha256').update(html).update(await readFile('src/drive-config.mjs')).digest('hex').slice(0,16);
await writeFile(out+'/sw.js',`const PREFIX='tianrui-drive:'+new URL('.',self.location.href).pathname+':';const VERSION=PREFIX+'${version}';
const urls=['./','./index.html','./drive-config.mjs','./GOOGLE_DRIVE_SETUP.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'].map(p=>new URL(p,self.location.href).href),allowed=new Set(urls);
self.addEventListener('install',e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(urls)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;u.search='';u.hash='';if(!allowed.has(u.href))return;e.respondWith(caches.open(VERSION).then(async c=>{if(e.request.mode==='navigate'||u.pathname.endsWith('/drive-config.mjs')){try{const r=await fetch(e.request,{cache:'no-cache'});if(r.ok){await c.put(u.href,r.clone());return r;}}catch{}}return(await c.match(u.href))||fetch(e.request);}));});\n`);
await writeFile(out+'/release-status.json',JSON.stringify({format:'TR-DRIVE-RELEASE-1',storage:'Google Drive',version,configured:Boolean(driveConfig),realGoogleAcceptance:'UNVERIFIED',hardwareAcceptance:'UNVERIFIED',mode:'single-recorder/others-view',atomicCAS:false},null,2)+'\n');
if(/firebasejs|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com|supabase\.co|@firebase/i.test(js))throw Error('Cancelled backend found in Drive bundle');
console.log(JSON.stringify({output:out,version,publicConfig:Boolean(driveConfig),realGoogleAcceptance:'UNVERIFIED'}));
