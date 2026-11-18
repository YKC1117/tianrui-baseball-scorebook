'use strict';
const PREFIX='tianrui-drive-source:'+new URL('.',self.location.href).pathname+':';
const VERSION=PREFIX+'1';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-tianrui.png','./preview/demo-data.json',
 './src/app.mjs','./src/drive-config.mjs','./src/drive-api.mjs','./src/drive-auth.mjs','./src/drive-workspace.mjs','./src/drive.css','./src/json-data.mjs','./src/ui-review.css','./src/baseball-rules.mjs','./src/quick-scoring.mjs','./src/lineup-planning.mjs','./src/planning-document.mjs','./src/backup-integrity.mjs','./src/workspace-store.mjs','./src/validation.mjs','./src/scorebook.mjs'];
const ALLOWED=new Set(FILES.map(path=>new URL(path,self.location.href).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('/schedule.json')){event.respondWith(Promise.resolve(new Response('Private schedule requires authentication',{status:410})));return;}
 url.search='';url.hash='';
 // No API data, tokens, arbitrary responses or private exports enter CacheStorage.
 if(!ALLOWED.has(url.href))return;
 event.respondWith(caches.open(VERSION).then(async cache=>{
  // Public project settings may change after initial setup. Online reload must
  // see the current settings without requiring the user to erase device data.
  if(url.pathname.endsWith('/src/drive-config.mjs')){
   try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok){await cache.put(url.href,response.clone());return response;}}catch{}
   const cached=await cache.match(url.href);if(cached)return cached;
   throw Error('Public configuration unavailable offline');
  }
  const cached=await cache.match(url.href);if(cached)return cached;
  return fetch(event.request);
 }));
});
