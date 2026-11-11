import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const KEY='TR_UI_REVIEW_SANDBOX_V1';
const nav=async(page,tab)=>{if(['stats','lineup','history','files'].includes(tab)&&!await page.locator(`[data-tab="${tab}"]:visible`).count()){await page.locator('[data-tab="record"]:visible').first().click();if(await page.locator('#recorderName').isVisible()){await page.locator('#recorderName').fill('版面測試員');await page.locator('#recorderConfirm').click();}}await page.locator(`[data-tab="${tab}"]:visible`).first().click();};
const state=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
const game=async page=>{const db=await state(page);return db.games.find(g=>g.id===db.activeId);};
async function begin(page){await nav(page,'record');await page.locator('#recorderName').fill('試用紀錄員');await page.locator('#recorderConfirm').click();await expect(page.locator('[data-pitch="B"]')).toBeVisible();}
async function settle(page){await expect(page.locator('#demoSaveStatus')).toContainText('已儲存');}
test.beforeEach(async({page})=>{page.on('dialog',d=>d.type()==='prompt'?d.accept('試用紀錄員'):d.accept());await page.goto('/');await expect(page.getByRole('heading',{name:/每一場，.*都好好記錄/gi})).toBeVisible();});
test('all screens work without backends, touch targets fit, 320px and enlarged text do not overflow',async({page})=>{
 const errors=[],forbidden=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/firebase|supabase|identitytoolkit|firestore/.test(r.url()))forbidden.push(r.url());});
 const check=async()=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);};
 for(const tab of ['home','team','schedule','setup']){await nav(page,tab);await check();}
 await nav(page,'setup');for(const step of [2,3]){await page.locator(`[data-setup-step="${step}"]:visible`).first().click();await check();}
 await begin(page);
 for(const tab of ['record','lineup','stats','history','files']){await nav(page,tab);await check();}
 await nav(page,'stats');for(const section of ['batting','pitching','fielding']){await page.locator(`[data-statsection="${section}"]`).click();await check();}
 await page.setViewportSize({width:320,height:740});
 for(const tab of ['home','team','schedule','setup','stats']){await nav(page,tab);await check();}
 await nav(page,'setup');for(const step of [2,3]){await page.locator(`[data-setup-step="${step}"]:visible`).first().click();await check();}
 await nav(page,'files');await page.getByText('顯示設定與球隊 Logo',{exact:true}).click();await page.locator('#fontScale').evaluate(el=>{el.value='1.25';el.dispatchEvent(new Event('change',{bubbles:true}));});
 for(const tab of ['home','team','schedule','setup','stats']){await nav(page,tab);await check();}
 await nav(page,'record');if(await page.locator('#recorderName').isVisible()){await page.locator('#recorderName').fill('放大字體測試');await page.locator('#recorderConfirm').click();}
 await check();const buttons=await page.locator('button:visible').evaluateAll(nodes=>nodes.filter(n=>!n.disabled).map(n=>({text:n.textContent.trim(),w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));expect(buttons.filter(b=>b.w<44||b.h<44)).toEqual([]);
 expect(errors).toEqual([]);expect(forbidden).toEqual([]);
});
test('roster edits, blank numbers, search, support player and three-step lineup persist',async({page})=>{
 await nav(page,'team');await expect(page.locator('[data-club-name]')).toHaveCount(20);
 await page.locator('[data-club-name="demo_p01"]').fill('試用修改球員');await page.locator('[data-club-num="demo_p01"]').fill('');await page.locator('#clubSave').click();await settle(page);
 await page.locator('#rosterSearch').fill('試用修改');await expect(page.locator('.rosterItem:visible')).toHaveCount(1);await page.locator('#rosterSearch').fill('');
 await page.locator('#addPlayerDetails>summary').click();await page.locator('#clubName').fill('本機新增球員');await page.locator('#clubAdd').click();await expect(page.locator('[data-club-name]')).toHaveCount(21);await settle(page);
 await page.reload();await nav(page,'team');await expect(page.locator('[data-club-name="demo_p01"]')).toHaveValue('試用修改球員');await expect(page.locator('[data-club-num="demo_p01"]')).toHaveValue('');
 await nav(page,'setup');await page.locator('#draftOpponent').fill('模擬新對手');await page.locator('[data-setup-step="2"]').first().click();await expect(page.getByRole('heading',{name:'今天，誰會到場？'})).toBeVisible();
 await page.locator('#attendAll').click();await page.getByText('＋ 加入本場支援球員',{exact:true}).click();await page.locator('#guestName').fill('臨時試用支援');await page.locator('#guestAdd').click();await expect(page.locator('[data-guest-name]')).toHaveCount(1);await settle(page);
 expect((await state(page)).clubRoster.some(p=>p.guest)).toBe(false);
 await page.locator('[data-setup-step="3"]').first().click();const first=await page.locator('[data-batting-slot="0"]').inputValue(),second=await page.locator('[data-batting-slot="1"]').inputValue();await page.locator('[data-move-order="1:-1"]').click();await expect(page.locator('[data-batting-slot="0"]')).toHaveValue(second);await expect(page.locator('[data-batting-slot="1"]')).toHaveValue(first);
 await page.locator('#startDraftGame').click();await page.locator('#recorderConfirm').click();await expect(page.locator('#recorderName')).toBeVisible();await page.locator('#recorderName').fill('新場紀錄員');await page.locator('#recorderConfirm').click();await settle(page);
 expect((await game(page)).away.roster.some(p=>p.guest)).toBe(true);expect((await state(page)).clubRoster).toHaveLength(21);expect((await game(page)).events.at(-1).recorder).toBe('新場紀錄員');
});
test('actual scoring, running, fielding, undo and pitcher re-entry keep statistics intact',async({page})=>{
 await begin(page);const initial=await game(page);
 await page.locator('[data-pitch="B"]').click();await settle(page);expect((await game(page)).balls).toBe(initial.balls+1);
 await page.locator('[data-result="1B"]').click();await page.locator('[data-commitplay="1B"]').click();await settle(page);const hitter=(await game(page)).bases[0].pid;
 await page.locator('[data-run="SB"]').click();await page.locator('[data-commitrun="SB"]').click();await settle(page);expect((await game(page)).bases[1].pid).toBe(hitter);expect((await game(page)).away.stats[hitter].SB).toBe(1);
 await page.getByText('更多跑壘與守備事件',{exact:true}).click();await page.locator('#fielding').click();await page.locator('#po').fill('1');await page.locator('#confirmFielding').click();await settle(page);const fielder=(await game(page)).home.roster[0].id;
 expect((await game(page)).home.stats[fielder].PO).toBe(1);await page.locator('#undo').click();await settle(page);expect((await game(page)).home.stats[fielder].PO).toBe(0);await page.locator('#redo').click();await settle(page);expect((await game(page)).home.stats[fielder].PO).toBe(1);
 const before=await game(page),p1=before.home.pitcher,p2=before.home.roster[1].id;
 for(const pid of [p2,p1]){await page.locator('#pitcherChange').click();await page.locator('#newPitcher').selectOption(pid);await page.locator('[data-confirmpitcher]').click();await settle(page);}
 expect((await game(page)).home.pitchSessions.filter(s=>s.pid===p1)).toHaveLength(2);
 await nav(page,'stats');await page.locator('[data-statteam="home"]').click();await page.locator('[data-statsection="pitching"]').click();await expect(page.locator('.statsCard:visible')).toContainText('當日二次登板');await page.locator('[data-pitchview="combined"]').click();await expect(page.locator('.statsCard:visible')).toContainText('（合併）');
});
test('schedule add, edit, filters, text import, JSON export and prepare-game actions work',async({page})=>{
 await nav(page,'schedule');await expect(page.locator('.calendarCard')).toHaveCount(3);await page.locator('[data-calendar-new]').click();await page.locator('[data-calendar-save]').click();await expect(page.locator('#matchOpponent')).toBeVisible();
 await page.locator('#matchDate').fill('2026-12-06');await page.locator('#matchTime').fill('09:30');await page.locator('#matchOpponent').fill('模擬測試對手');await page.locator('#matchVenue').fill('示範測試球場');await page.locator('[data-calendar-save]').click();await expect(page.locator('.calendarCard')).toHaveCount(4);await settle(page);
 const match=(await state(page)).schedule.games.find(m=>m.opponent==='模擬測試對手');await page.locator(`[data-calendar-edit="${match.id}"]`).click();await page.locator('#matchStatus').selectOption('postponed');await page.locator('[data-calendar-save]').click();await page.locator('[data-calendar-filter="postponed"]').click();await expect(page.locator('.calendarCard')).toHaveCount(2);
 await page.locator('[data-calendar-filter="all"]').click();await page.getByText('從圖片或文字整理賽程',{exact:true}).click();await page.locator('#calendarRaw').fill('12/13 09:00 天睿 VS 模擬文字隊 示範棒球場');await page.locator('#parseCalendarText').click();await expect(page.locator('#calendarTextReview')).toContainText('2026-12-13');await page.locator('#confirmCalendarText').click();await expect(page.locator('.calendarCard')).toHaveCount(5);await settle(page);
 const target=(await state(page)).schedule.games.find(m=>m.opponent==='模擬文字隊');await page.locator(`[data-prepare-game="${target.id}"]`).click();await expect(page.locator('#draftOpponent')).toHaveValue('模擬文字隊');await expect(page.locator('#draftDate')).toHaveValue('2026-12-13');
 await nav(page,'schedule');await page.getByText('賽程備份與季別設定',{exact:true}).click();const download=page.waitForEvent('download');await page.locator('#exportCalendar').click();const exported=JSON.parse(await readFile(await(await download).path(),'utf8'));expect(exported.format).toBe('TR-SCHEDULE-1');expect(exported.games).toHaveLength(5);
});
test('PNG, CSV and JSON exports are real; importing a game creates a new ID',async({page})=>{
 await begin(page);await nav(page,'files');await page.locator('#exportPNG').click();await expect(page.locator('.previewImg')).toBeVisible();expect(await page.locator('.previewImg').getAttribute('src')).toMatch(/^data:image\/png;base64,/);await page.locator('#cancelModal').click();
 let event=page.waitForEvent('download');await page.locator('#exportCSV').click();const csv=await readFile(await(await event).path(),'utf8');expect(csv).toContain('WHIP');expect(csv).toContain('示範球員');
 event=page.waitForEvent('download');await page.locator('#exportJSON').click();const data=await readFile(await(await event).path());const exported=JSON.parse(data);expect(exported.format).toBe('TR-BASEBALL-1');const oldId=exported.game.id;
 await page.locator('#importJSON').setInputFiles({name:'synthetic-game.json',mimeType:'application/json',buffer:data});await settle(page);const saved=await state(page);expect(saved.games).toHaveLength(3);expect(saved.activeId).not.toBe(oldId);expect(saved.games.find(g=>g.id===saved.activeId).importedFrom.id).toBe(oldId);expect(saved.games.some(g=>g.id===oldId)).toBe(true);
});
test('preview reset and backup restore preserve all existing site data byte-for-byte',async({page})=>{
 const legacy='{"privateSentinel":"never-touch","games":[],"settings":{"scale":1.2}}';await page.evaluate(v=>{localStorage.setItem('TR_BASEBALL_OFFLINE_V1',v);localStorage.setItem('TR-SCHEDULE-PUBLIC-1','schedule-sentinel');},legacy);
 await begin(page);await page.locator('[data-pitch="B"]').click();await settle(page);const before=await state(page);
 await page.locator('#demoOptions').click();const download=page.waitForEvent('download');await page.locator('#exportPreview').click();const data=await readFile(await(await download).path());const archive=JSON.parse(data);expect(archive.workspace.db.games).toHaveLength(2);
 await page.locator('#resetPreview').click();await expect(page.locator('#previewSettings')).not.toBeVisible();await page.locator('#demoOptions').click();await page.locator('#previewImport').setInputFiles({name:'synthetic-workspace.json',mimeType:'application/json',buffer:data});await expect(page.locator('#previewSettings')).not.toBeVisible();expect((await state(page)).games.find(g=>g.id==='demo_live').balls).toBe(before.games.find(g=>g.id==='demo_live').balls);
 expect(await page.evaluate(()=>localStorage.getItem('TR_BASEBALL_OFFLINE_V1'))).toBe(legacy);expect(await page.evaluate(()=>localStorage.getItem('TR-SCHEDULE-PUBLIC-1'))).toBe('schedule-sentinel');
});
test('single-file preview is self-contained and opens without any web service',async({page})=>{
 await page.goto('http://127.0.0.1:4180/tianrui-ui-preview.html');await expect(page.getByRole('heading',{name:/每一場，.*都好好記錄/gi})).toBeVisible();await begin(page);await page.locator('[data-pitch="B"]').click();await settle(page);expect((await game(page)).balls).toBe(2);
 const source=await readFile('dist-ui/tianrui-ui-preview.html','utf8');expect(source).not.toContain('src="./app.js"');expect(source).not.toContain('href="../src/');expect(source).toContain('data:image/png;base64,');
});
test('name dialog supports keyboard focus, escape and mandatory names without creating changes',async({page})=>{
 await nav(page,'record');const dialog=page.getByRole('dialog',{name:'填寫紀錄員姓名'});await expect(dialog).toBeVisible();
 await page.locator('#recorderConfirm').focus();await page.keyboard.press('Tab');await expect(page.locator('#recorderName')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.locator('#recorderConfirm')).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.locator('#recorderName')).toHaveCount(0);
 await nav(page,'record');await page.locator('#recorderConfirm').click();await expect(dialog).toBeVisible();await page.locator('#recorderName').fill('鍵盤操作測試');await page.locator('#recorderName').press('Enter');await expect(page.locator('[data-pitch="B"]')).toBeVisible();await settle(page);expect((await game(page)).events.at(-1).recorder).toBe('鍵盤操作測試');
});
