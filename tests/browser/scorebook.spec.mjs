import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000002';
const roster=Array.from({length:20},(_,i)=>({id:'p'+i,name:'測試球員'+i,num:i<2?'':String(i+1)}));
async function mockCloud(context,{role='recorder',backend:shared}={}){
 const backend=shared||{games:new Map(),docs:new Map([['roster',{doc_key:'roster',revision:1,document:{roster}}],['schedule',{doc_key:'schedule',revision:1,document:{format:'TR-SCHEDULE-1',season:'測試賽程',games:[]}}]]),ops:new Map(),leases:new Map(),writes:[],loseReply:false};
 await context.route('**/src/config.mjs',route=>route.fulfill({contentType:'text/javascript',body:"export const cloudConfig={projectUrl:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'};"}));
 await context.route('https://fixture.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postDataJSON(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'},reply=data=>route.fulfill({json:data,headers});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.pathname==='/auth/v1/token')return reply({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,user:{id}});
  if(url.pathname==='/auth/v1/user')return reply({id});
  if(url.pathname==='/auth/v1/logout')return reply({});
  if(url.pathname.endsWith('/tr_member_role'))return reply(role);
  if(url.pathname==='/rest/v1/tr_documents')return reply([backend.docs.get(url.searchParams.get('doc_key')?.slice(3))].filter(Boolean));
  if(url.pathname==='/rest/v1/tr_games'){
   const key=url.searchParams.get('game_id')?.slice(3);return reply(key?[backend.games.get(key)].filter(Boolean):[...backend.games.values()]);
  }
  if(url.pathname.endsWith('/tr_acquire_lease')){
   if(backend.busy)return reply(false);
   const prior=backend.leases.get(body.p_game_id);if(prior&&prior!==body.p_holder_token)return reply(false);
   backend.leases.set(body.p_game_id,body.p_holder_token);return reply(true);
  }
  if(url.pathname.endsWith('/tr_release_lease')){backend.leases.delete(body.p_game_id);return reply(true);}
  if(url.pathname.includes('/rpc/tr_')){
   if(backend.ops.has(body.p_operation_id))return reply(backend.ops.get(body.p_operation_id));
   if(body.p_key==='schedule'&&role!=='admin')return route.fulfill({status:403,json:{message:'ADMIN_REQUIRED',code:'42501'}});
   const isGame=Boolean(body.p_game_id),map=isGame?backend.games:backend.docs,key=body.p_game_id||body.p_key;
   const revision=map.get(key)?.revision||0,expected=body.p_expected_revision||0;
   if(revision!==expected)return route.fulfill({status:400,json:{message:'REVISION_CONFLICT',code:'P0001'}});
   map.set(key,isGame?{game_id:key,revision:revision+1,state:body.p_state}:{doc_key:key,revision:revision+1,document:body.p_document});
   backend.ops.set(body.p_operation_id,revision+1);backend.writes.push(body);if(isGame&&expected===0)backend.leases.set(key,body.p_holder_token);
   if(backend.loseReply){backend.loseReply=false;return route.abort('failed');}
   return reply(revision+1);
  }
  return route.fulfill({status:404,json:{message:'unexpected fixture URL'}});
 });
 return backend;
}
async function login(page){await page.goto('/');await page.locator('#account').fill('team@example.test');await page.locator('#password').fill('fixture-password');await page.locator('#login').click();await expect(page.locator('#syncStatus')).toBeVisible();}
async function nav(page,tab){await page.locator(`[data-tab="${tab}"]:visible`).first().click();}
async function startGame(page){
 await nav(page,'setup');await page.locator('#attendAll').click();await page.locator('#draftOpponent').fill('測試對手');await page.locator('#draftOpponent').blur();
 await page.locator('#startDraftGame').click();await expect(page.locator('#recorderName')).toBeVisible();
 await page.locator('#recorderName').fill('紀錄甲');await page.locator('#recorderConfirm').click();await expect(page.locator('[data-pitch="B"]')).toBeVisible();
}
async function sync(page){await page.locator('#syncNow').click();await expect(page.locator('#syncStatus')).toContainText('待同步 0 筆');await nav(page,'home');}
async function resume(page){await page.locator('[data-open]').first().click();await page.locator('#recorderName').fill('紀錄乙');await page.locator('#recorderConfirm').click();await expect(page.locator('[data-pitch="B"]')).toBeVisible();}
test('unconfigured backend gates private UI and preserves all legacy bytes',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('TR_BASEBALL_OFFLINE_V1','{"games":[],"settings":{"scale":1.2},"sentinel":"keep"}'));
 await page.goto('/');await expect(page.locator('#app')).toContainText('天睿專用後端尚未設定');await expect(page.locator('#clubName')).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('TR_BASEBALL_OFFLINE_V1'))).toBe('{"games":[],"settings":{"scale":1.2},"sentinel":"keep"}');
 await expect(page.locator('#legacyDownload')).toBeVisible();
});
test('name is mandatory; scoring, undo, guest isolation, CSV/JSON/PNG stay intact',async({page,context})=>{
 const backend=await mockCloud(context);const errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page);await nav(page,'setup');
 await page.locator('#guestName').fill('臨時測試');await page.locator('#guestAdd').click();await page.locator('#attendAll').click();
 await page.locator('#draftOpponent').fill('測試對手');await page.locator('#draftOpponent').blur();await page.locator('#startDraftGame').click();
 page.once('dialog',dialog=>dialog.accept());await page.locator('#recorderConfirm').click();await expect(page.locator('#recorderName')).toBeVisible();expect(backend.games.size).toBe(0);
 await page.locator('#recorderName').fill('紀錄甲');await page.locator('#recorderConfirm').click();await expect(page.locator('[data-result="1B"]')).toBeVisible();
 await page.locator('[data-result="1B"]').click();await page.locator('[data-commitplay="1B"]').click();
 await page.locator('[data-run="SB"]').click();await page.locator('[data-commitrun="SB"]').click();
 await page.locator('#fielding').click();await page.locator('#po').fill('1');await page.locator('#confirmFielding').click();
 await page.locator('#undo').click();await page.locator('#redo').click();
 await nav(page,'files');let download=page.waitForEvent('download');await page.locator('#exportJSON').click();expect((await download).suggestedFilename()).toMatch(/json$/);
 download=page.waitForEvent('download');await page.locator('#exportCSV').click();expect((await download).suggestedFilename()).toMatch(/csv$/);
 await page.locator('#exportPNG').click();await expect(page.locator('.previewImg')).toBeVisible();await page.locator('#cancelModal').click();
 await expect.poll(()=>backend.writes.length).toBeGreaterThanOrEqual(6);
 expect(backend.docs.get('roster').document.roster.length).toBe(20);
 expect([...backend.games.values()][0].state.away.roster.some(p=>p.guest)).toBe(true);
 expect(errors).toEqual([]);
});
test('offline queue survives reload and replays once after reconnect',async({page,context})=>{
 const backend=await mockCloud(context);await login(page);await startGame(page);await sync(page);await resume(page);
 await expect.poll(()=>[...backend.games.values()][0].revision).toBeGreaterThan(1);
 await context.setOffline(true);await page.locator('[data-pitch="B"]').click();await expect(page.locator('#syncStatus')).toContainText('離線');
 // UI module responses are fulfilled from disk in this fixture to isolate the
 // durable queue; actual service-worker offline shell has a separate test.
 await context.route('http://127.0.0.1:4173/**',async route=>{
  const {readFile}=await import('node:fs/promises');const {resolve}=await import('node:path');const path=new URL(route.request().url()).pathname;if(path==='/src/config.mjs')return route.fallback();
  try{return route.fulfill({body:await readFile(resolve(process.cwd(),path==='/'?'index.html':'.'+path)),contentType:path.endsWith('.mjs')?'text/javascript':path.endsWith('.png')?'image/png':'text/html'});}catch{return route.abort();}
 });
 await page.reload();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
 await context.setOffline(false);await page.locator('#syncNow').click();await expect(page.locator('#syncStatus')).toContainText('待同步 0 筆');
 const game=[...backend.games.values()][0].state;expect(game.balls).toBe(1);expect(game.events.filter(e=>e.kind==='pitch')).toHaveLength(1);
});
test('second device cannot acquire same game or overwrite first device',async({page,context,browser})=>{
 const backend=await mockCloud(context);await login(page);await startGame(page);await sync(page);
 const other=await browser.newContext({serviceWorkers:'block'});await mockCloud(other,{backend});const p=await other.newPage();await login(p);
 p.once('dialog',dialog=>dialog.accept());await p.locator('[data-open]').first().click();await p.locator('#recorderName').fill('第二裝置');await p.locator('#recorderConfirm').click();
 await expect(p.locator('[data-view]').first()).toBeVisible();await p.locator('[data-view]').first().click();await expect(p.locator('.table').first()).toBeVisible();
 expect([...backend.games.values()][0].state.balls).toBe(0);await other.close();
});
test('recorder schedule is authenticated and read only',async({page,context})=>{
 await mockCloud(context);await login(page);await page.goto('/schedule.html');await expect(page.locator('#season')).toHaveText('測試賽程');await expect(page.locator('#toggle')).toBeHidden();
 expect(await page.locator('body').innerText()).not.toContain('GitHub Token');
});
test('admin saves private schedule with recorder name and expected revision',async({page,context})=>{
 const backend=await mockCloud(context,{role:'admin'});await login(page);await page.goto('/schedule.html?manage=1');
 await page.locator('#seasonEdit').fill('更新測試賽程');await page.locator('#add').click();
 await page.locator('[data-date]').fill('2000-01-02');await page.locator('[data-time]').fill('09:00');await page.locator('[data-opponent]').fill('測試對手');
 page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('管理測試'):dialog.accept());
 await page.locator('#next').click();await expect.poll(()=>backend.docs.get('schedule').revision).toBe(2);
 expect(backend.writes.at(-1).p_recorder_name).toBe('管理測試');expect(backend.writes.at(-1).p_expected_revision).toBe(1);
 expect(backend.docs.get('schedule').document.games).toHaveLength(1);
});
test('full backup restores games with new IDs and retains existing cloud data',async({page,context})=>{
 const backend=await mockCloud(context);await login(page);await startGame(page);await sync(page);
 const originalId=[...backend.games.keys()][0];const backupEvent=page.waitForEvent('download');await page.locator('#allBackup').click();
 const {readFile}=await import('node:fs/promises');const backup=await readFile(await(await backupEvent).path());
 expect(JSON.parse(backup.toString()).workspace.db.games).toHaveLength(1);
 page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('還原測試'):dialog.accept());
 const chooser=page.waitForEvent('filechooser');await page.locator('#importLegacy').click();await(await chooser).setFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:backup});
 await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');await page.locator('#syncNow').click();
 await expect.poll(()=>backend.games.size).toBe(2);expect(backend.games.has(originalId)).toBe(true);
 const restored=[...backend.games.values()].find(g=>g.game_id!==originalId).state;
 expect(restored.importedFrom.id).toBe(originalId);expect(restored.importedAuditTrail.length).toBeGreaterThan(0);
});
for(const failure of ['wrong-password','unapproved'])test(`${failure} cannot render private roster or games`,async({page,context})=>{
 await mockCloud(context);const headers={'access-control-allow-origin':'*'};
 await context.route(failure==='wrong-password'?'**/auth/v1/token?grant_type=password':'**/rest/v1/rpc/tr_member_role',route=>route.fulfill({status:failure==='wrong-password'?400:403,headers,json:{message:failure==='wrong-password'?'invalid credentials':'NOT_APPROVED'}}));
 await page.goto('/');await page.locator('#account').fill('team@example.test');await page.locator('#password').fill('fixture-password');await page.locator('#login').click();
 await expect(page.locator('#authMessage')).toContainText(failure==='wrong-password'?'invalid credentials':'NOT_APPROVED');
 await expect(page.locator('#clubName')).toHaveCount(0);await expect(page.locator('[data-open]')).toHaveCount(0);
 expect(await page.evaluate(()=>Boolean(JSON.parse(sessionStorage.getItem('TR_SECURE_AUTH_V15:https://fixture.supabase.co')||'null')?.access_token))).toBe(false);
});
test('conflict UI retains draft and can explicitly keep both versions',async({page,context})=>{
 const backend=await mockCloud(context);await login(page);await startGame(page);await sync(page);await resume(page);
 await expect(page.locator('#syncStatus')).toContainText('待同步 0 筆');await context.setOffline(true);await page.locator('[data-pitch="B"]').click();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
 const current=[...backend.games.values()][0];current.revision++;current.state={...current.state,balls:2};
 await context.setOffline(false);await expect(page.locator('#syncStatus')).toContainText('版本衝突');
 page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept('衝突處理測試'):dialog.accept());
 await page.getByRole('button',{name:'保留兩份（比賽另存）'}).click();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
 await page.locator('#syncNow').click();await expect.poll(()=>backend.games.size).toBe(2);
 expect(backend.games.get(current.game_id).state.balls).toBe(2);expect([...backend.games.values()].find(g=>g.game_id!==current.game_id).state.balls).toBe(1);
});
test('archiving preserves cloud game, stats and audit instead of silently discarding the edit',async({page,context})=>{
 const backend=await mockCloud(context);await login(page);await startGame(page);await page.locator('[data-pitch="B"]').click();
 await nav(page,'files');page.once('dialog',d=>d.accept());await page.locator('#deleteGame').click();
 await expect.poll(()=>[...backend.games.values()][0].state.archived).toBe(true);
 expect([...backend.games.values()][0].state.balls).toBe(1);expect([...backend.games.values()][0].state.auditTrail.length).toBeGreaterThan(1);
});
test('continuing from home requests a fresh recorder name and recording rights can be handed off',async({page,context})=>{
 const backend=await mockCloud(context);await login(page);await startGame(page);await nav(page,'home');await nav(page,'record');
 await expect(page.locator('#recorderName')).toHaveValue('');await page.locator('#recorderName').fill('接續測試乙');await page.locator('#recorderConfirm').click();
 await expect.poll(()=>[...backend.games.values()][0].state.recorderSessions.length).toBe(2);
 await page.locator('#releaseRecording').click();await expect(page.locator('#syncStatus')).toContainText('紀錄權已交出');
 expect(backend.leases.size).toBe(0);
});
