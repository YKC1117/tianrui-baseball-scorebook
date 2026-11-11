import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positions,normalizePositions,normalizePlanningState,cacheDraft,activateSchedule,analyzeCoverage,suggestDefense} from '../src/lineup-planning.mjs';
import {parseBackup,validateRoster} from '../src/validation.mjs';
const codes=positions.map(([code])=>code);
const blank=()=>({date:'2026-11-15',opponent:'',side:'away',selected:[],lineup:[],positions:{},guests:[]});
const players=codes.map((code,i)=>({id:`p${i}`,name:`示範${i}`,num:'',positions:[code]}));
test('legacy twenty-player roster and backups migrate optional positions without changing historical games',()=>{
 const clubRoster=Array.from({length:20},(_,i)=>({id:`p${i}`,num:i<18?String(i):'',name:`示範${i}`}));
 const old={clubRoster,games:[],draft:blank(),settings:{scale:1.2}};
 const result=parseBackup(JSON.stringify(old));assert.equal(result.clubRoster.length,20);assert.ok(result.clubRoster.every(p=>p.positions.length===0));assert.equal(old.clubRoster[0].positions,undefined);const legacyDraft={...blank(),lineup:['p0'],positions:{p0:'P'}};assert.deepEqual(normalizePlanningState({...old,draft:legacyDraft}).draft.manualPositions,['p0']);assert.deepEqual(result.settings,old.settings);
 const historic={id:'historical',away:{roster:[{id:'p1',name:'原球員',num:''}]},defense:{P:'p1'}};
 assert.deepEqual(normalizePlanningState({...old,games:[historic]}).games,[historic]);
 assert.deepEqual(normalizePositions(['RF','B1','1B','P','RF']),['P','1B','RF']);assert.deepEqual(normalizePositions(null),[]);
 for(const bad of ['P',['DH'],[1],{}]){assert.throws(()=>normalizePositions(bad));assert.throws(()=>validateRoster([{...clubRoster[0],positions:bad}]));}
});
test('schedule drafts isolate attendance, guests, manual defense and legacy unlinked drafts across switches and backups',()=>{
 const db=normalizePlanningState({clubRoster:players,games:[],draft:{...blank(),opponent:'舊草稿',selected:['p0']}});
 const a={id:'a',date:'2026-11-15',opponent:'模擬A',status:'scheduled'},b={...a,id:'b',date:'2026-11-22',opponent:'模擬B'};
 activateSchedule(db,a,blank);assert.deepEqual(db.draft.selected,[]);db.draft.selected=['p1'];db.draft.lineup=['p1'];db.draft.positions={p1:'C'};db.draft.manualPositions=['p1'];db.draft.guests=[{id:'guest',name:'支援',num:'',positions:['C']}];
 activateSchedule(db,b,blank);assert.deepEqual(db.draft.guests,[]);assert.deepEqual(db.draft.selected,[]);db.draft.selected=['p2'];cacheDraft(db);
 const restored=parseBackup(JSON.stringify(db));activateSchedule(restored,{...a,date:'2026-12-01'},blank);assert.equal(restored.draft.date,'2026-12-01');assert.deepEqual(restored.draft.selected,['p1']);assert.deepEqual(restored.draft.manualPositions,['p1']);assert.equal(restored.draft.guests[0].id,'guest');
 activateSchedule(restored,null,blank);assert.equal(restored.draft.opponent,'舊草稿');assert.deepEqual(restored.draft.selected,['p0']);
 const checkpoint=structuredClone(restored);assert.throws(()=>activateSchedule(restored,{...b,status:'cancelled'},blank));assert.deepEqual(restored,checkpoint);
 assert.throws(()=>normalizePlanningState({...db,scheduleDrafts:JSON.parse('{"__proto__":{"scheduleId":"__proto__"}}')}));
});
test('coverage uses augmenting paths rather than greedy counts and detects shared catcher / shortstop',()=>{
 const flexible=structuredClone(players);flexible[0].positions=['P','C'];flexible[1].positions=['P'];assert.equal(analyzeCoverage(flexible).missing,0);
 const shared=structuredClone(players);shared[1].positions=['C','SS'];shared[5].positions=[];
 const a=analyzeCoverage(shared);assert.equal(a.missing,1);assert.equal(a.positions.find(p=>p.code==='C').status,'需要調整');assert.equal(a.positions.find(p=>p.code==='SS').status,'需要調整');assert.deepEqual(a.conflicts[0].codes,['C','SS']);assert.deepEqual(a.conflicts[0].playerIds,['p1']);assert.equal(a.unknown.length,1);
 const noC=players.filter(p=>p.id!=='p1');assert.equal(analyzeCoverage(noC).positions.find(p=>p.code==='C').status,'待補');
 assert.equal(analyzeCoverage([...players,players[0]]).matched,9);assert.equal(analyzeCoverage([]).missing,9);
});
test('suggestions never mutate batting order or manual defense, permit manually pinned unknown players',()=>{
 const draft={...blank(),lineup:players.map(p=>p.id),positions:Object.fromEntries(players.map((p,i)=>[p.id,['P','C','B1','B2','B3','SS','LF','CF','RF'][i]]))};
 const checkpoint=structuredClone(draft),suggestion=suggestDefense(draft,players);assert.deepEqual(draft,checkpoint);assert.equal(new Set(Object.values(suggestion)).size,9);
 const unknown=structuredClone(players);unknown[0].positions=[];assert.equal(suggestDefense(draft,unknown),null);draft.manualPositions=['p0'];assert.equal(suggestDefense(draft,unknown).p0,'P');
 draft.positions.p0='C';draft.positions.p1='P';draft.manualPositions=['p0','p1'];const pinned=suggestDefense(draft,unknown);assert.equal(pinned.p0,'C');assert.equal(pinned.p1,'P');assert.deepEqual(draft.lineup,checkpoint.lineup);
});
