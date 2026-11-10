import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'allow'});
test('PWA offline shell loads, old public schedule cache is purged, legacy data survives',async({page,context})=>{
 await page.goto('/logo-tianrui.png');
 await page.evaluate(async()=>{
  localStorage.setItem('TR_BASEBALL_OFFLINE_V1','legacy-sentinel');
  const old=await caches.open('tianrui-baseball-v1.4.1');await old.put('./schedule.json',new Response('private-cache-sentinel'));
 });
 await page.goto('/');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await expect.poll(()=>page.evaluate(()=>caches.keys())).not.toContain('tianrui-baseball-v1.4.1');
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
 // A later owner configuration change must not stay pinned in a cache forever.
 // Seed stale public settings, then prove online reload uses the server copy.
 await page.evaluate(async()=>{const key=(await caches.keys()).find(k=>k.startsWith('tianrui-baseball-'));const cache=await caches.open(key);await cache.put(new URL('./src/config.mjs',location.href).href,new Response('export const cloudConfig={stale:true};',{headers:{'Content-Type':'text/javascript'}}));});
 await page.reload();await expect(page.locator('#app')).toContainText('天睿專用後端尚未設定');
 await context.setOffline(true);await page.reload();await expect(page.locator('#app')).toContainText('天睿專用後端尚未設定');
 expect(await page.evaluate(()=>localStorage.getItem('TR_BASEBALL_OFFLINE_V1'))).toBe('legacy-sentinel');
 const result=await page.evaluate(async()=>{const r=await fetch('./schedule.json');return {status:r.status,body:await r.text()};});
 expect(result.status).toBe(410);expect(result.body).not.toContain('private-cache-sentinel');
 const paths=await page.evaluate(async()=>{const result=[];for(const key of await caches.keys())for(const req of await(await caches.open(key)).keys())result.push(req.url);return result;});
 expect(paths.some(p=>p.includes('schedule.json')||p.includes('/auth/')||p.includes('/rest/'))).toBe(false);
});
