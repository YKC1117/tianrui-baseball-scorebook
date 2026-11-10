import {test,expect} from '@playwright/test';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,Timestamp,getDoc,getDocs,collection} from 'firebase/firestore';
import {fixtureRoster} from '../support/fixtures.mjs';
let env,users;const password=crypto.randomUUID()+'Aa1!';
const privileged=async fn=>{let value;await env.withSecurityRulesDisabled(async c=>{value=await fn(c.firestore());});return value;};
test.beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-tianrui',firestore:{host:'127.0.0.1',port:8080}});});
test.afterAll(()=>env?.cleanup());
test.beforeEach(async()=>{
 await env.clearFirestore();users={};
 for(const role of ['admin','recorder']){
  const email=`${role}-${crypto.randomUUID()}@example.test`,r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});expect(r.status).toBe(200);users[role]={email,uid:(await r.json()).localId};
 }
 await privileged(db=>setDoc(doc(db,'access/team'),{adminUid:users.admin.uid,recorderUid:users.recorder.uid,adminEnabled:true,recorderEnabled:true}));
});
async function login(page,role='recorder'){
 await page.goto('/');await page.locator('#account').fill(users[role].email);await page.locator('#password').fill(password);await page.locator('#login').click();await expect(page.locator('#syncStatus')).toBeVisible();
}
const nav=async(p,tab)=>p.locator(`[data-tab="${tab}"]:visible`).first().click();
async function sync(p){await p.locator('#syncNow').click();await expect(p.locator('#app')).toHaveAttribute('aria-busy','false');await expect(p.locator('#syncStatus')).toContainText('待同步 0 筆');}
async function importRoster(p){
 await nav(p,'team');await p.locator('#clubImport').setInputFiles({name:'synthetic-roster.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'TR-CLUB-ROSTER-1',roster:fixtureRoster()}))});await expect(p.locator('[data-club-name]')).toHaveCount(20);await sync(p);
}
async function start(p){await nav(p,'setup');await p.locator('#attendAll').click();await p.locator('#draftOpponent').fill('模擬器測試對手');await p.locator('#draftOpponent').blur();await p.locator('#startDraftGame').click();await p.locator('#recorderName').fill('紀錄甲');await p.locator('#recorderConfirm').click();await expect(p.locator('[data-pitch="B"]')).toBeVisible();await sync(p);}
const rows=()=>privileged(async db=>(await getDocs(collection(db,'games'))).docs.map(d=>({id:d.id,...d.data()})));
test('real Firebase: shared account on two devices, hidden lease, offline takeover conflict, restore and revoke',async({browser})=>{
 const contexts=await Promise.all([1,2].map(()=>browser.newContext({baseURL:'http://127.0.0.1:4175',serviceWorkers:'block',viewport:{width:390,height:844}})));
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 const errors=[];for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('測試紀錄員'):d.accept());}
 try{
  await login(a);await importRoster(a);await start(a);
  const id=(await rows())[0].id;
  await login(b);await nav(b,'team');await expect(b.locator('[data-club-name]')).toHaveCount(20);await expect(b.locator('[data-club-num="p0"]')).toHaveValue('');await nav(b,'home');
  let denial='';b.once('dialog',d=>{denial=d.message();});await b.locator('[data-open]').click();await b.locator('#recorderName').fill('紀錄乙');await b.locator('#recorderConfirm').click();await expect.poll(()=>denial).toContain('另一裝置');
  await a.locator('[data-pitch="B"]').click();await expect.poll(async()=>(await rows())[0].payload.balls).toBe(1);
  await contexts[0].setOffline(true);await a.locator('[data-pitch="B"]').click();await expect(a.locator('#syncStatus')).toContainText('待同步 1 筆');await expect(a.locator('#syncStatus')).toContainText('離線');
  await privileged(db=>updateDoc(doc(db,'leases',id),{expiresAt:Timestamp.fromMillis(1)}));
  await b.locator('[data-open]').click();await b.locator('#recorderName').fill('紀錄乙');await b.locator('#recorderConfirm').click();await expect(b.locator('[data-pitch="S"]')).toBeVisible();await b.locator('[data-pitch="S"]').click();await sync(b);await b.locator('#releaseRecording').click();await expect(b.locator('#syncStatus')).toContainText('紀錄權已交出');
  await contexts[0].setOffline(false);await a.locator('#syncNow').click();await expect(a.locator('#syncStatus')).toContainText('版本衝突');
  const download=a.waitForEvent('download');await a.locator('#allBackup').click();expect((await download).suggestedFilename()).toContain('workspace');
  await a.getByRole('button',{name:'保留兩份（比賽另存）'}).click();await sync(a);await expect.poll(async()=>(await rows()).length).toBe(2);
  const games=await rows();expect(games.find(g=>g.id===id).payload.strikes).toBe(1);expect(games.find(g=>g.id!==id).payload.balls).toBe(2);
  await privileged(db=>updateDoc(doc(db,'access/team'),{recorderEnabled:false}));await a.locator('#syncNow').click();await expect(a.locator('#loginForm')).toBeVisible();await expect(a.locator('[data-open]')).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
test('real Firebase: recorder cannot manage schedule; admin saves private schedule and audit',async({page})=>{
 page.on('dialog',d=>d.type()==='prompt'?d.accept('賽程管理員'):d.accept());await login(page);await page.goto('/schedule.html');await expect(page.locator('#toggle')).toBeHidden();
 await page.locator('#logout').click();await expect(page.locator('#loginForm')).toBeVisible();await page.locator('#account').fill(users.admin.email);await page.locator('#password').fill(password);await page.locator('#login').click();await expect(page.locator('#syncStatus')).toContainText('管理員');await page.goto('/schedule.html?manage=1');
 await page.locator('#seasonEdit').fill('免費方案測試');await page.locator('#add').click();await page.locator('[data-date]').fill('2000-01-02');await page.locator('[data-time]').fill('09:00');await page.locator('[data-opponent]').fill('測試對手');await page.locator('#next').click();
 await expect.poll(()=>privileged(async db=>(await getDoc(doc(db,'team/schedule'))).data()?.payload.season)).toBe('免費方案測試');
 const audits=await privileged(async db=>(await getDocs(collection(db,'audit'))).docs.map(x=>x.data()));expect(audits.some(x=>x.kind==='schedule'&&x.actor===users.admin.uid&&x.name==='賽程管理員')).toBe(true);
});
test('real Firebase PWA: offline reload restores Auth and pending draft, requires fresh name and syncs exactly once',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4175',serviceWorkers:'allow'}),page=await context.newPage();
 page.on('dialog',d=>d.type()==='prompt'?d.accept('離線測試'):d.accept());
 try{
  await login(page);await importRoster(page);await start(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);await page.locator('[data-pitch="B"]').click();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
  await page.reload();await expect(page.locator('#syncStatus')).toContainText('待同步 1 筆');
  await nav(page,'home');await page.locator('[data-open]').click();await expect(page.locator('#recorderName')).toHaveValue('');await page.locator('#recorderName').fill('重開紀錄員');await page.locator('#recorderConfirm').click();await expect(page.locator('[data-pitch="B"]')).toBeVisible();
  await context.setOffline(false);await sync(page);const game=(await rows())[0];expect(game.payload.balls).toBe(1);expect(game.payload.events.filter(x=>x.kind==='pitch')).toHaveLength(1);
  const cached=await page.evaluate(async()=>{const out=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())out.push(req.url);return out;});expect(cached.every(x=>x.startsWith('http://127.0.0.1:4175/'))).toBe(true);
 }finally{await context.close();}
});
