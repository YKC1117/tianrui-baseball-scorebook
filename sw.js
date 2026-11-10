'use strict';
const VERSION='tianrui-baseball-v1.1.1';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-tianrui.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tianrui-baseball-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{if(resp.ok){let cp=resp.clone();caches.open(VERSION).then(cache=>cache.put(event.request,cp));}return resp;}).catch(()=>caches.match('./index.html'))));
});