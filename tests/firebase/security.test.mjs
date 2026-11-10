import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,writeBatch,Timestamp,serverTimestamp} from 'firebase/firestore';
import {TianRuiCloud} from '../../src/firebase-gateway.mjs';
import {SyncStore} from '../../src/sync-store.mjs';
import {fixtureRoster,fixtureGame} from '../support/fixtures.mjs';
import {decodeArchive} from '../../src/backup-integrity.mjs';
import {parseBackup} from '../../src/validation.mjs';
const projectId='demo-tianrui',config={projectId,apiKey:'emulator-only-key',authDomain:`${projectId}.firebaseapp.com`,emulators:true};
let env,users,admin,a,b;const tokenA=crypto.randomUUID(),tokenB=crypto.randomUUID();
const password=crypto.randomUUID()+'Aa1!';
async function signup(email){const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});assert.equal(response.status,200);return{email,uid:(await response.json()).localId};}
const privileged=fn=>env.withSecurityRulesDisabled(c=>fn(c.firestore()));
const memberDb=()=>env.authenticatedContext(users.recorder.uid,{firebase:{sign_in_provider:'password'}}).firestore();
const failCode=(promise,code)=>assert.rejects(promise,e=>{assert.equal(e.code,code);return true;});
async function access(enabled=true){await privileged(db=>setDoc(doc(db,'access/team'),{adminUid:users.admin.uid,recorderUid:users.recorder.uid,adminEnabled:true,recorderEnabled:enabled}));}
async function expire(id){await privileged(db=>updateDoc(doc(db,'leases',id),{expiresAt:Timestamp.fromMillis(1)}));}
const memory=()=>{let value;return{read:async()=>structuredClone(value),write:async v=>{value=structuredClone(v);}};};
before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.rules','utf8')}});
 await env.clearFirestore();
 users={admin:await signup('admin@example.test'),recorder:await signup('recorder@example.test'),other:await signup('unknown@example.test')};
 await access();
 [admin,a,b]=[1,2,3].map(()=>new TianRuiCloud(config));
 await Promise.all([admin.signIn(users.admin.email,password),a.signIn(users.recorder.email,password),b.signIn(users.recorder.email,password)]);
});
after(async()=>{await Promise.all([admin,a,b].filter(Boolean).map(x=>x.close()));await env?.cleanup();});
test('real Auth emulator: two shared-account sessions, wrong password, unknown account denied',async()=>{
 assert.equal((await a.verifySession()).id,(await b.verifySession()).id);
 assert.equal(await a.memberRole(),'recorder');assert.equal(await admin.memberRole(),'admin');
 const other=new TianRuiCloud(config);
 try{await failCode(other.signIn(users.recorder.email,'wrong-password'),'BAD_CREDENTIALS');await failCode(other.signIn(users.other.email,password),'NOT_APPROVED');assert.equal(other.signedIn,false);}finally{await other.close();}
});
test('Rules deny anonymous, unapproved and anonymous-provider reads/writes, access escalation and unknown paths',async()=>{
 for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext(users.other.uid).firestore(),env.authenticatedContext(users.recorder.uid,{firebase:{sign_in_provider:'anonymous'}}).firestore()]){
  for(const path of ['access/team','team/roster','games/x','audit/x','leases/x','proofs/x']){
   await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,path),{attack:true}));
  }
 }
 const db=memberDb();await assertFails(updateDoc(doc(db,'access/team'),{adminUid:users.recorder.uid}));await assertFails(setDoc(doc(db,'unknown/x'),{x:1}));
});
test('roster and schedule CAS, role limits, immutable server audit, orphan writes denied',async()=>{
 assert.equal(await admin.saveDocument('roster',0,{roster:fixtureRoster()},'名冊測試','IMPORT','roster-1'),1);
 assert.equal((await b.getDocument('roster')).document.roster.length,20);
 const roster=fixtureRoster();roster[0].name='修改測試';assert.equal(await a.saveDocument('roster',1,{roster},'紀錄甲','EDIT','roster-2'),2);
 await failCode(b.saveDocument('roster',1,{roster:fixtureRoster()},'紀錄乙','EDIT','roster-stale'),'REVISION_CONFLICT');
 const schedule={format:'TR-SCHEDULE-1',season:'測試球季',games:[]};
 await failCode(a.saveDocument('schedule',0,schedule,'紀錄甲','EDIT','schedule-denied'),'NOT_APPROVED');
 assert.equal(await admin.saveDocument('schedule',0,schedule,'管理員','EDIT','schedule-1'),1);
 const db=memberDb(),audit=(await getDoc(doc(db,'audit/roster-2'))).data();
 assert.equal(audit.actor,users.recorder.uid);assert.equal(audit.before,1);assert.equal(audit.after,2);assert.ok(audit.at.toMillis()>Date.now()-60000);
 await assertFails(updateDoc(doc(db,'audit/roster-2'),{name:'偽造'}));await assertFails(deleteDoc(doc(db,'audit/roster-2')));
 await assertFails(setDoc(doc(db,'team/roster'),{revision:99,payload:{roster:[]},lastOperation:'orphan',updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(db,'audit/orphan'),{...audit,at:serverTimestamp()}));
});
test('new game + lease + audit are atomic; competing creators cannot both win',async()=>{
 const game=fixtureGame('atomic_game');const results=await Promise.allSettled([a.createGame(game,'紀錄甲','atomic-a',tokenA),b.createGame(game,'紀錄乙','atomic-b',tokenB)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await a.getGame(game.id)).revision,1);
 const db=memberDb(),audits=await getDocs(collection(db,'audit'));
 assert.equal(audits.docs.filter(x=>x.data().target===game.id).length,1);
 await assertFails(deleteDoc(doc(db,'games',game.id)));
});
test('private proof prevents same-account device from reading or patching the writer secret',async()=>{
 const game=fixtureGame('private_game');await a.createGame(game,'紀錄甲','private-create',tokenA);
 assert.equal(await b.acquireLease(game.id,tokenB,'紀錄乙'),false);
 const db=memberDb();
 await assertFails(getDoc(doc(db,'leases',game.id)));await assertFails(getDoc(doc(db,'proofs/private-create')));
 await assertFails(getDocs(collection(db,'leases')));await assertFails(getDocs(collection(db,'proofs')));
 await assertFails(updateDoc(doc(db,'leases',game.id),{expiresAt:Timestamp.fromMillis(Date.now()+100000)}));
 const batch=writeBatch(db);batch.set(doc(db,'proofs/forged-proof'),{kind:'claim',gameId:game.id,token:tokenB,actor:users.recorder.uid,name:'紀錄乙',at:serverTimestamp()});
 batch.update(doc(db,'leases',game.id),{proofId:'forged-proof',expiresAt:Timestamp.fromMillis(Date.now()+90000)});await assertFails(batch.commit());
 await assert.rejects(b.saveGame({...game,balls:1},1,tokenB,'紀錄乙','EDIT','private-forged'));
 assert.equal((await a.getGame(game.id)).revision,1);
});
test('idempotency binds complete payload; parallel updates, stale revision, lease expiry and takeover',async()=>{
 const game=fixtureGame('race_game');await a.createGame(game,'紀錄甲','race-create',tokenA);
 const next={...game,balls:1};await a.saveGame(next,1,tokenA,'紀錄甲','EDIT','race-update');
 assert.equal(await a.saveGame(next,1,tokenA,'紀錄甲','EDIT','race-update'),2);
 await failCode(a.saveGame({...game,balls:2},1,tokenA,'紀錄甲','EDIT','race-update'),'OPERATION_ID_REUSED');
 const results=await Promise.allSettled([a.saveGame({...game,balls:2},2,tokenA,'紀錄甲','EDIT','race-1'),a.saveGame({...game,balls:3},2,tokenA,'紀錄甲','EDIT','race-2')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await b.getGame(game.id)).revision,3);
 await expire(game.id);await assert.rejects(a.saveGame(game,3,tokenA,'紀錄甲','EDIT','race-expired'));
 assert.equal(await b.acquireLease(game.id,tokenB,'紀錄乙'),true);
 assert.equal(await a.acquireLease(game.id,tokenA,'紀錄甲'),false);
 await failCode(b.saveGame(game,2,tokenB,'紀錄乙','EDIT','race-stale'),'REVISION_CONFLICT');
 assert.equal(await b.saveGame({...game,strikes:1},3,tokenB,'紀錄乙','EDIT','race-takeover'),4);
 await b.releaseLease(game.id,tokenB);assert.equal(await a.acquireLease(game.id,tokenA,'接手甲'),true);
});
test('offline outbox + reconnect preserves conflict and both versions; full backup restores as new game',async()=>{
 const game=fixtureGame('offline_game');await a.createGame(game,'紀錄甲','offline-create',tokenA);
 let online=true;const repo=memory(),engine=await new SyncStore({cloud:a,repository:repo,online:()=>online,holderToken:tokenA,accountId:users.recorder.uid}).open();
 await engine.pull();await engine.beginRecording(game.id,'紀錄甲');online=false;
 const db=engine.db;db.games.find(g=>g.id===game.id).balls=1;await engine.commit(db,'紀錄甲');await engine.flush();assert.equal(engine.pendingCount,1);assert.match(engine.status,/離線/);
 const reloaded=await new SyncStore({cloud:a,repository:repo,online:()=>online,holderToken:tokenA,accountId:users.recorder.uid}).open();assert.equal(reloaded.pendingCount,1);
 await expire(game.id);await b.acquireLease(game.id,tokenB,'紀錄乙');await b.saveGame({...game,strikes:1},1,tokenB,'紀錄乙','EDIT','offline-remote');await b.releaseLease(game.id,tokenB);
 online=true;await reloaded.flush();assert.equal(reloaded.pendingCount,1);assert.match(reloaded.status,/版本衝突/);
 const backup=JSON.parse(reloaded.backup());assert.equal(backup.workspace.pending[0].data.balls,1);
 assert.equal(JSON.stringify(backup).includes(tokenA),false);
 await reloaded.resolve('game:'+game.id,'還原測試',true);await reloaded.flush();assert.equal(reloaded.pendingCount,0);
 const games=await a.listGames();assert.equal(games.find(x=>x.game_id===game.id).state.strikes,1);assert.ok(games.some(x=>x.game_id!==game.id&&x.state.balls===1));
});
test('authorization disable immediately blocks existing tokens, writes and lease claims; name required',async()=>{
 await access(false);await failCode(a.memberRole(),'NOT_APPROVED');await failCode(b.getGame('race_game'),'NOT_APPROVED');
 await failCode(b.saveDocument('roster',2,{roster:fixtureRoster()},'紀錄乙','EDIT','disabled'),'NOT_APPROVED');
 assert.equal(await a.acquireLease('race_game',tokenA,'紀錄甲'),false);
 assert.equal(await admin.memberRole(),'admin');await access();
 await failCode(a.saveDocument('roster',2,{roster:fixtureRoster()},'  ','EDIT','empty-name'),'RECORDER_REQUIRED');
 await a.signOut();assert.equal(a.signedIn,false);await failCode(a.verifySession(),'NOT_SIGNED_IN');
 assert.equal(await b.memberRole(),'recorder');
});
test('cloud archive includes server audit, checksum, all shared data and restores as a new game',async()=>{
 const raw=await admin.exportBackup(),decoded=JSON.parse(await decodeArchive(raw)),db=parseBackup(await decodeArchive(raw));
 assert.ok(decoded.serverAudit.length>5);assert.equal(db.clubRoster.length,20);assert.ok(db.games.length>=4);
 assert.equal(raw.includes(tokenA),false);assert.equal(raw.includes(tokenB),false);
 await failCode(b.exportBackup(),'ADMIN_REQUIRED');
 const source=db.games[0],restored={...source,id:'restored_archive',importedFrom:{id:source.id}};
 await admin.createGame(restored,'備份還原驗證','archive-restore',crypto.randomUUID());
 assert.deepEqual((await admin.getGame(restored.id)).state.score,source.score);
 assert.ok(await admin.getGame(source.id));
});
test('misconfigured identical role UIDs fail closed rather than elevating the shared account',async()=>{
 await privileged(db=>updateDoc(doc(db,'access/team'),{adminUid:users.recorder.uid}));
 try{await failCode(b.memberRole(),'NOT_APPROVED');}finally{await access();}
});
