'use strict';
const VERSION='tianrui-baseball-v1.5-review-1';
const FILES=['./','./index.html','./schedule.html','./publish.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-tianrui.png',
 './src/app.mjs','./src/config.mjs','./src/cloud-gateway.mjs','./src/workspace-store.mjs','./src/sync-store.mjs','./src/validation.mjs','./src/scorebook.mjs','./src/schedule.mjs'];
const ALLOWED=new Set(FILES.map(path=>new URL(path,self.location.href).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tianrui-baseball-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('/schedule.json')){event.respondWith(Promise.resolve(new Response('Private schedule requires authentication',{status:410})));return;}
 url.search='';url.hash='';
 // No API data, tokens, arbitrary responses or private exports enter CacheStorage.
 if(!ALLOWED.has(url.href))return;
 event.respondWith(caches.open(VERSION).then(async cache=>{
  const cached=await cache.match(url.href);if(cached)return cached;
  return fetch(event.request);
 }));
});
