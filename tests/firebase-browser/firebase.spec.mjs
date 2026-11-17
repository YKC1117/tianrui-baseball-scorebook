import {test,expect} from '@playwright/test';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,Timestamp,getDoc,getDocs,collection} from 'firebase/firestore';
import {fixtureRoster} from '../support/fixtures.mjs';
import {RECORDER_EMAIL} from '../../src/login-config.mjs';
import {readFile} from 'node:fs/promises';
let env,users;const password=crypto.randomUUID()+'Aa1!';
const privileged=async fn=>{let value;await env.withSecurityRulesDisabled(async c=>{value=await fn(c.firestore());});return value;};
test.beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-tianrui',firestore:{host:'127.0.0.1',port:8080}});});
test.afterAll(()=>env?.cleanup());
test.beforeEach(async()=>{
 await env.clearFirestore();await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-tianrui/accounts',{method:'DELETE'});users={};
 for(const role of ['admin','recorder']){
  const email=role==='recorder'?RECORDER_EMAIL:`${role}-${crypto.randomUUID()}@example.test`,r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});expect(r.status).toBe(200);users[role]={email,uid:(await r.json()).localId};
 }
 await privileged(db=>setDoc(doc(db,'access/team'),{adminUid:users.admin.uid,recorderUid:users.recorder.uid,adminEnabled:true,recorderEnabled:true}));
});
async function login(page,role='recorder'){
 await page.goto('/');if(role==='admin'){await page.locator('#adminLogin').click();await page.locator('#account').fill(users[role].email);}else await expect(page.locator('#account')).toHaveCount(0);await page.locator('#password').fill(password);await page.locator('#login').click();await expect(page.locator('#syncStatus')).toBeVisible();
}
const nav=async(p,tab)=>p.locator(`[data-tab="${tab}"]:visible`).first().click();
async function sync(p){await p.locator('#syncNow').click();await expect(p.locator('#app')).toHaveAttribute('aria-busy','false');await expect(p.locator('#syncStatus')).toContainText('待同步 0 筆');}
async function importRoster(p){
 await nav(p,'team');await p.locator('#clubImport').setInputFiles({name:'synthetic-roster.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'TR-CLUB-ROSTER-1',roster:fixtureRoster()}))});await expect(p.locator('[data-club-name]')).toHaveCount(20);await sync(p);
}
async function start(p){await nav(p,'setup');await p.locator('#draftOpponent').fill('模擬器測試對手');await p.locator('#draftOpponent').blur();await p.locator('[data-setup-step="2"]').first().click();await p.locator('#attendAll').click();await p.locator('[data-setup-step="3"]').first().click();await p.locator('#startDraftGame').click();await p.locator('#recorderName').fill('紀錄甲');await p.locator('#recorderConfirm').click();await expect(p.locator('[data-pitch="B"]')).toBeVisible();await sync(p);}
async function tool(p,id){if(!await p.locator('#'+id).isVisible())await p.locator('#accountTools>summary').click();await p.locator('#'+id).click();}
const rows=()=>privileged(async db=>(await getDocs(collection(db,'games'))).docs.map(d=>({id:d.id,...d.data()})));
test('real Firebase: shared account on two devices, hidden lease, offline takeover conflict, restore and revoke',async({browser})=>{
 const contexts=await Promise.all([1,2].map(()=>browser.newContext({baseURL:'http://127.0.0.1:4175',serviceWorkers:'block',viewport:{width:390,height:844}})));
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 const errors=[];for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('測試紀錄員'):d.accept());}
 try{
  await login(a);await importRoster(a);await start(a);
  const id=(await rows())[0].id;
  await login(b);await nav(b,'team');await expect(b.locator('[data-club-name]')).toHaveCount(20);await expect(b.locator('[data-club-num="p0"]')).toHaveValue('');await nav(b,'home');
  let denial='';b.once('dialog',d=>{denial=d.message();});await b.locator('[data-open]').first().click();await b.locator('#recorderName').fill('紀錄乙');await b.locator('#recorderConfirm').click();await expect.poll(()=>denial).toContain('另一裝置');
  await a.locator('[data-pitch="B"]').click();await expect.poll(async()=>(await rows())[0].payload.balls).toBe(1);
  await contexts[0].setOffline(true);await a.locator('[data-pitch="B"]').click();await expect(a.locator('#syncStatus')).toContainText('待同步 1 筆');await expect(a.locator('#syncStatus')).toContainText('離線');
  await privileged(db=>updateDoc(doc(db,'leases',id),{expiresAt:Timestamp.fromMillis(1)}));
  await b.locator('[data-open]').first().click();await b.locator('#recorderName').fill('紀錄乙');await b.locator('#recorderConfirm').click();await expect(b.locator('[data-pitch="S"]')).toBeVisible();await b.locator('[data-pitch="S"]').click();await sync(b);await tool(b,'releaseRecording');await expect(b.locator('#syncStatus')).toContainText('紀錄權已交出');
  await contexts[0].setOffline(false);await a.locator('#syncNow').click();await expect(a.locator('#syncStatus')).toContainText('版本衝突');
  const download=a.waitForEvent('download');await tool(a,'allBackup');expect((await download).suggestedFilename()).toContain('workspace');
  await a.getByRole('button',{name:'保留兩份（比賽另存）'}).click();await sync(a);await expect.poll(async()=>(await rows()).length).toBe(2);
  const games=await rows();expect(games.find(g=>g.id===id).payload.strikes).toBe(1);expect(games.find(g=>g.id!==id).payload.balls).toBe(2);
  await privileged(db=>updateDoc(doc(db,'access/team'),{recorderEnabled:false}));await a.locator('#syncNow').click();await expect(a.locator('#loginForm')).toBeVisible();await expect(a.locator('[data-open]')).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
test('integrated Firebase: schedule role restrictions use the new UI; shared planning moves safely between devices',async({browser})=>{
 const contexts=await Promise.all([1,2].map(()=>browser.newContext({baseURL:'http://127.0.0.1:4175',serviceWorkers:'block',viewport:{width:390,height:844}}))),[a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 for(const p of [a,b])p.on('dialog',d=>d.type()==='prompt'?d.accept('賽程紀錄員'):d.accept());
 try{
  await login(a,'admin');await importRoster(a);await nav(a,'schedule');await a.locator('[data-calendar-new]').click();await a.locator('#matchDate').fill('2026-11-22');await a.locator('#matchOpponent').fill('合成整合對手');await a.locator('[data-calendar-save]').click();await sync(a);
  const row=await privileged(async db=>(await getDoc(doc(db,'team/schedule'))).data());expect(row.payload.games).toHaveLength(1);const id=row.payload.games[0].id;
  await login(b);await nav(b,'schedule');await expect(b.locator('.calendarCard')).toHaveCount(1);await b.locator(`[data-prepare-game="${id}"]`).click();await b.locator('[data-attend="p0"]').check();await b.locator('[data-attend="p9"]').check();await sync(b);
  await sync(a);await nav(a,'schedule');await a.locator(`[data-prepare-game="${id}"]`).click();await expect(a.locator('[data-attend="p0"]')).toBeChecked();await expect(a.locator('[data-attend="p9"]')).toBeChecked();
  await nav(b,'schedule');await b.locator('[data-calendar-edit]').click();await b.locator('#matchOpponent').fill('不應被儲存');await b.locator('[data-calendar-save]').click();expect((await privileged(async db=>(await getDoc(doc(db,'team/schedule'))).data())).payload.games[0].opponent).toBe('合成整合對手');
  expect((await privileged(async db=>(await getDocs(collection(db,'audit'))).docs.map(x=>x.data()))).some(x=>x.kind==='planning'&&x.actor===users.recorder.uid)).toBe(true);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
test('real Firebase PWA: offline reload restores Auth and pending draft, requires fresh name and syncs exactly once',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4175',serviceWorkers:'allow'}),page=await context.newPage();
 page.on('dialog',d=>d.type()==='prompt'?d.accept('離線測試'):d.accept());
 try{
  await login(page);await importRoster(page);await start(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);await page.locator('[data-pitch="B"]').click();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
  await page.reload();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
  await nav(page,'home');await page.locator('[data-open]').first().click();await expect(page.locator('#recorderName')).toHaveValue('');await page.locator('#recorderName').fill('重開紀錄員');await page.locator('#recorderConfirm').click();await expect(page.locator('[data-pitch="B"]')).toBeVisible();
  await context.setOffline(false);await sync(page);const game=(await rows())[0];expect(game.payload.balls).toBe(1);expect(game.payload.events.filter(x=>x.kind==='pitch')).toHaveLength(1);
  const cached=await page.evaluate(async()=>{const out=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())out.push(req.url);return out;});expect(cached.every(x=>x.startsWith('http://127.0.0.1:4175/'))).toBe(true);
 }finally{await context.close();}
});
test('integrated Firebase: DH and automatic S3 corrections round-trip with audit, handover, favorites and backup restore',async({browser})=>{
 const contexts=await Promise.all([1,2].map(()=>browser.newContext({baseURL:'http://127.0.0.1:4175',serviceWorkers:'block',viewport:{width:390,height:844}}))),[a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 const errors=[];for(const p of [a,b]){p.on('dialog',d=>d.type()==='prompt'?d.accept('整合驗收員'):d.accept());p.on('pageerror',e=>errors.push(e.message));}
 try{
  await a.goto('/');await a.evaluate(()=>{localStorage.setItem('TR_BASEBALL_OFFLINE_V1','legacy-sentinel');localStorage.setItem('TR_UI_REVIEW_SANDBOX_V1','preview-sentinel');});await login(a);await importRoster(a);await start(a);let g=(await rows())[0].payload,id=g.id;expect(g.away.dh.enabled).toBe(true);expect(g.away.lineup).not.toContain(g.away.pitcher);const pid=g.home.pitcher,bid=g.away.lineup[g.away.next],prior=structuredClone(g);
  await a.locator('#editFavorites').click();await a.locator('#favorite_3B').check();await a.locator('#favoriteColumns').selectOption('2');await a.locator('#saveFavorites').click();await sync(a);
  for(let i=0;i<3;i++){await a.locator('[data-pitch="S"]').click();await a.waitForTimeout(300);}await sync(a);g=(await rows())[0].payload;expect(g.away.stats[bid].SO-prior.away.stats[bid].SO).toBe(1);expect(g.home.pitchStats[pid].pitches-prior.home.pitchStats[pid].pitches).toBe(3);expect(g.pendingThirdStrike).toBeTruthy();
  await tool(a,'releaseRecording');await login(b);await b.locator('[data-open]').first().click();await b.locator('#recorderName').fill('第二台接手員');await b.locator('#recorderConfirm').click();await b.locator('#correctThirdStrike').click();await b.locator('[data-uncaught-bat="1"]').click();await b.locator('#uncaughtCause').selectOption('WP');await b.locator('#completeUncaught').click();await sync(b);g=(await rows())[0].payload;expect(g.outs).toBe(0);expect(g.bases[0].pid).toBe(bid);expect(g.away.stats[bid].SO).toBe(1);expect(g.home.pitchStats[pid].BF).toBe(1);expect(g.home.pitchStats[pid].pitches).toBe(3);expect(g.home.pitchStats[pid].WP).toBe(1);expect(g.events.findLast(e=>e.kind==='correction').recorder).toBe('第二台接手員');
  for(let i=0;i<2;i++){await b.locator('[data-result="SO"]').click();await b.waitForTimeout(650);}for(let i=0;i<3;i++){await b.locator('[data-pitch="S"]').click();await b.waitForTimeout(300);}await sync(b);const switched=(await rows())[0].payload;expect(switched.half).toBe('bottom');expect(switched.halfNotice.from.half).toBe('top');await expect(b.locator('.halfChangeNotice')).toContainText('已進入');await b.locator('#dismissHalfNotice').click();await sync(b);expect((await rows())[0].payload.half).toBe('bottom');
  await tool(b,'releaseRecording');await sync(a);await nav(a,'home');await a.locator('[data-open]').first().click();await a.locator('#recorderName').fill('第一台恢復員');await a.locator('#recorderConfirm').click();await sync(a);expect((await rows())[0].payload.away.stats[g.away.pitcher].PA).toBe(0);
  const download=a.waitForEvent('download');await tool(a,'allBackup');const bytes=await readFile(await(await download).path());const archive=JSON.parse(bytes);expect(archive.workspace.db.settings.quickScoring.favorites).toContain('3B');expect(archive.workspace.db.settings.quickScoring.columns).toBe(2);
  const chooser=a.waitForEvent('filechooser');await tool(a,'importLegacy');await(await chooser).setFiles({name:'synthetic-integrated-backup.json',mimeType:'application/json',buffer:bytes});await expect.poll(async()=>(await rows()).length).toBe(2);await sync(a);expect((await rows()).every(r=>r.payload.away.dh.enabled)).toBe(true);expect(await a.evaluate(()=>localStorage.getItem('TR_BASEBALL_OFFLINE_V1'))).toBe('legacy-sentinel');expect(await a.evaluate(()=>localStorage.getItem('TR_UI_REVIEW_SANDBOX_V1'))).toBe('preview-sentinel');expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
