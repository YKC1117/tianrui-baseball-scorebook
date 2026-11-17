import {test,expect} from '@playwright/test';
import {startLocalBackend} from '../support/local-backend.mjs';
import {fixtureRoster} from '../support/fixtures.mjs';
let backend;
test.beforeAll(async()=>{test.setTimeout(120000);backend=await startLocalBackend();});
test.afterAll(()=>backend?.stop());
test('real local Auth and PostgREST: two devices, roster import, lease handover, offline conflict and ban',async({browser})=>{
 test.setTimeout(90000);
 const contexts=await Promise.all([1,2].map(()=>browser.newContext({baseURL:'http://127.0.0.1:4173',serviceWorkers:'block',viewport:{width:390,height:844}})));
 try{
  for(const context of contexts)await backend.bridge(context);
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
  async function login(page){await page.goto('/');await page.locator('#account').fill(backend.users.recorder.email);await page.locator('#password').fill(backend.users.recorder.password);await page.locator('#login').click();await expect(page.locator('#syncStatus')).toBeVisible();}
  const nav=async(page,tab)=>page.locator(`[data-tab="${tab}"]:visible`).first().click();
  const sync=async page=>{await page.locator('#syncNow').click();await expect(page.locator('#syncStatus')).toContainText('待同步 0 筆');};
  a.on('dialog',d=>d.type()==='prompt'?d.accept('本機整合測試甲'):d.accept());
  await login(a);await nav(a,'team');
  await a.locator('#clubImport').setInputFiles({name:'synthetic-roster.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'TR-CLUB-ROSTER-1',roster:fixtureRoster()}))});
  await expect(a.locator('[data-club-name]')).toHaveCount(20);
  await a.locator('[data-club-name="p0"]').fill('測試修改姓名');await a.locator('#clubSave').click();await sync(a);
  await login(b);await nav(b,'team');await expect(b.locator('[data-club-name="p0"]')).toHaveValue('測試修改姓名');await expect(b.locator('[data-club-num="p0"]')).toHaveValue('');
  await nav(a,'setup');await a.locator('#attendAll').click();await a.locator('#draftOpponent').fill('本機測試對手');await a.locator('#draftOpponent').blur();await a.locator('#startDraftGame').click();await a.locator('#recorderName').fill('測試紀錄甲');await a.locator('#recorderConfirm').click();
  await expect(a.locator('[data-pitch="B"]')).toBeVisible();await expect.poll(()=>Number(backend.sql('select count(*) from public.tr_games'))).toBe(1);
  await sync(b);await nav(b,'home');let denial;
  b.once('dialog',async d=>{denial=d.message();await d.accept();});
  await b.locator('[data-open]').click();await b.locator('#recorderName').fill('測試紀錄乙');await b.locator('#recorderConfirm').click();await expect.poll(()=>denial).toContain('另一裝置');
  await expect(b.locator('#recorderName')).toHaveCount(0);
  await a.locator('[data-pitch="B"]').click();await expect.poll(()=>backend.sql("select state->>'balls' from public.tr_games")).toBe('1');
  await contexts[0].setOffline(true);await a.locator('[data-pitch="B"]').click();await expect(a.locator('#syncStatus')).toContainText('待同步 1 筆');
  backend.sql("update public.tr_leases set expires_at=now()-interval '1 second'");
  await b.locator('[data-open]').click();await b.locator('#recorderName').fill('測試紀錄乙');await b.locator('#recorderConfirm').click();await expect(b.locator('[data-pitch="S"]')).toBeVisible();await b.locator('[data-pitch="S"]').click();
  await expect.poll(()=>backend.sql("select state->>'strikes' from public.tr_games")).toBe('1');
  await nav(b,'home');await b.locator('[data-view]').click();
  await contexts[0].setOffline(false);await a.locator('#syncNow').click();await expect(a.locator('#syncStatus')).toContainText('版本衝突');
  await a.getByRole('button',{name:'保留兩份（比賽另存）'}).click();await a.locator('#syncNow').click();await expect.poll(()=>Number(backend.sql('select count(*) from public.tr_games'))).toBe(2);
  await sync(b);await nav(b,'home');await expect(b.locator('[data-view]')).toHaveCount(2);
  await backend.adminRequest('/admin/users/'+backend.users.recorder.id,{ban_duration:'1h'},'PUT');
  await a.locator('#syncNow').click();await expect(a.locator('#loginForm')).toBeVisible();await expect(a.locator('[data-open]')).toHaveCount(0);
  await a.locator('#account').fill(backend.users.admin.email);await a.locator('#password').fill(backend.users.admin.password);await a.locator('#login').click();await expect(a.locator('#syncStatus')).toContainText('管理員');
  backend.sql("update public.tr_leases set expires_at=now()-interval '1 second'");
  await a.locator('[data-open]').first().click();await a.locator('#recorderName').fill('管理員測試');await a.locator('#recorderConfirm').click();
  await a.locator('[data-pitch="B"]').click();
  await expect.poll(()=>backend.sql("select recorder_name from public.tr_audit order by id desc limit 1")).toBe('管理員測試');
  expect(backend.sql("select actor_id from public.tr_audit order by id desc limit 1")).toBe(backend.users.admin.id);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
