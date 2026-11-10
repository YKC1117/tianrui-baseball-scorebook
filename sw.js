'use strict';
const VERSION='tianrui-baseball-v1.3.0';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-tianrui.png','./schedule.html','./schedule.json','./publish.html'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tianrui-baseball-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 if(new URL(event.request.url).pathname.endsWith('/schedule.json')){event.respondWith(fetch(event.request,{cache:'no-store'}).then(resp=>{if(resp.ok){const cp=resp.clone();caches.open(VERSION).then(cache=>cache.put('./schedule.json',cp));}return resp;}).catch(()=>caches.match('./schedule.json')));return;}
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{if(resp.ok){let cp=resp.clone();caches.open(VERSION).then(cache=>cache.put(event.request,cp));}return resp;}).catch(()=>caches.match('./index.html'))));
});