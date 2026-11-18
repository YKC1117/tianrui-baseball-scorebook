import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertProductionReady} from '../src/release-gate.mjs';
import {cloudConfig} from '../src/config.mjs';
import {validatePublicConfig} from '../src/login-config.mjs';
const release=process.argv.includes('--release');
validatePublicConfig(cloudConfig);
if(release){let acceptance=null;try{acceptance=JSON.parse(await readFile('.private/production-acceptance.json','utf8'));}catch{}assertProductionReady(cloudConfig,acceptance);}
const out='dist-integrated';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
// Keep only the public configuration external so setup can refresh it online.
const result=await build({entryPoints:['src/app.mjs'],bundle:true,format:'esm',target:['safari16','chrome105'],minify:true,write:false,external:['./config.mjs'],legalComments:'inline'});
const logo='data:image/png;base64,'+(await readFile('logo-tianrui.png')).toString('base64');
const css=await readFile('src/ui-review.css','utf8');
const js=result.outputFiles[0].text.replaceAll('./logo-tianrui.png',logo).replaceAll('</script','<\\/script');
let html=await readFile('index.html','utf8');html=html.replace('<link rel="stylesheet" href="./src/ui-review.css">',()=>'<style>'+css+'</style>').replace('<script type="module" src="./src/app.mjs"></script>',()=>'<script type="module">'+js+'</script>').replaceAll('./logo-tianrui.png',logo);
await writeFile(out+'/index.html',html);await copyFile('src/config.mjs',out+'/config.mjs');await writeFile(out+'/.nojekyll','');for(const file of ['manifest.webmanifest','icon-192.png','icon-512.png'])await copyFile(file,out+'/'+file);
await copyFile('src/vendor/firebase.mjs.LEGAL.txt',out+'/firebase.mjs.LEGAL.txt');
const version=createHash('sha256').update(html).update(await readFile('src/config.mjs')).digest('hex').slice(0,16);
await writeFile(out+'/sw.js',`const PREFIX='tianrui-integrated:'+new URL('.',self.location.href).pathname+':';const VERSION=PREFIX+'${version}';
const urls=['./','./index.html','./config.mjs','./manifest.webmanifest','./icon-192.png','./icon-512.png','./firebase.mjs.LEGAL.txt'].map(p=>new URL(p,self.location.href).href),allowed=new Set(urls);
self.addEventListener('install',e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(urls)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;u.search='';u.hash='';if(!allowed.has(u.href))return;e.respondWith(caches.open(VERSION).then(async c=>{if(u.pathname.endsWith('/config.mjs')||e.request.mode==='navigate'){try{const r=await fetch(e.request,{cache:'no-cache'});if(r.ok){await c.put(u.href,r.clone());return r;}}catch{}}return(await c.match(u.href))||fetch(e.request);}));});\n`);
await writeFile(out+'/release-status.json',JSON.stringify({format:'TR-RELEASE-1',project:'tianrui-baseball',configured:Boolean(cloudConfig),deployable:release&&Boolean(cloudConfig),version,remoteAcceptance:'UNVERIFIED',hardwareAcceptance:'UNVERIFIED'},null,2)+'\n');
console.log(JSON.stringify({output:out,version,configured:Boolean(cloudConfig),release}));
