import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SyncStore} from '../src/sync-store.mjs';
import {TianRuiCloud,CloudError} from '../src/cloud-gateway.mjs';
import {parseBackup} from '../src/validation.mjs';
const clone=x=>structuredClone(x);
class MemoryStore {
 async read(){return this.value?clone(this.value):null;}
 async write(next,generation){if((this.value?.generation||0)!==generation)throw Error('LOCAL_WORKSPACE_CONFLICT');if(this.fail)throw Error('disk full');this.value=clone(next);}
}
class Backend {
 constructor(){this.games=new Map();this.docs=new Map();this.operations=new Map();this.lease=new Map();this.audit=[];}
 client(){const b=this;return {
  _assertRecorder:TianRuiCloud.prototype._assertRecorder,
  async verifySession(){return{id:'approved'};},async memberRole(){return'recorder';},
  async listGames(){return [...b.games.values()].map(clone);},async getDocument(key){return clone(b.docs.get(key)||null);},async getGame(id){return clone(b.games.get(id)||null);},
  async acquireLease(id,token){if(b.busy)return false;if(b.lease.has(id)&&b.lease.get(id)!==token)return false;b.lease.set(id,token);return true;},
  async createGame(data,name,op){return b.save('game',data.id,0,data,name,op);},
  async saveGame(data,expected,token,name,operation,op){return b.save('game',data.id,expected,data,name,op);},
  async saveDocument(type,expected,data,name,operation,op){return b.save(type,type,expected,data,name,op);}
 };}
 save(type,id,expected,data,name,op){
  if(this.operations.has(op))return this.operations.get(op);
  const map=type==='game'?this.games:this.docs,row=map.get(id);
  if((row?.revision||0)!==expected)throw new CloudError('REVISION_CONFLICT','REVISION_CONFLICT');
  const revision=expected+1;map.set(id,type==='game'?{game_id:id,revision,state:clone(data)}:{doc_key:id,revision,document:clone(data)});
  this.operations.set(op,revision);this.audit.push({type,id,name,revision});
  if(this.loseReply){this.loseReply=false;throw new CloudError('Lost reply','OFFLINE');}
  return revision;
 }
}
async function setup(backend=new Backend(),repository=new MemoryStore(),online=()=>true){const engine=await new SyncStore({cloud:backend.client(),repository,online}).open();return{engine,backend,repository};}
const minimalGame=id=>({id,events:[],away:{},home:{}});
test('durable outbox preserves order and stable IDs across lost responses and reload',async()=>{
 const{engine,backend,repository}=await setup();await engine.beginRecording('id_test','紀錄甲',true);
 let db=engine.db;db.games.push(minimalGame('id_test'));await engine.commit(db,'紀錄甲');
 db=engine.db;db.games[0].events.push({kind:'pitch'});await engine.commit(db,'紀錄甲');
 const ids=engine.workspace.pending.map(p=>p.operationId);backend.loseReply=true;
 await assert.rejects(()=>engine.flush(),e=>e.code==='OFFLINE');assert.equal(engine.pendingCount,2);
 const restarted=(await setup(backend,repository)).engine;
 assert.deepEqual(restarted.workspace.pending.map(p=>p.operationId),ids);await restarted.flush();
 assert.equal(restarted.pendingCount,0);assert.equal(backend.audit.length,2);assert.equal(backend.games.get('id_test').revision,2);
 assert.equal(restarted.workspace.db.games[0].auditTrail.length,2);
});
test('stale offline draft remains intact; keep both makes a new game ID',async()=>{
 const{engine,backend}=await setup();backend.games.set('id_test',{game_id:'id_test',revision:8,state:minimalGame('id_test')});
 await engine.pull();await engine.beginRecording('id_test','紀錄甲');let db=engine.db;db.games[0].events.push({kind:'offline'});await engine.commit(db,'紀錄甲');
 backend.games.set('id_test',{game_id:'id_test',revision:9,state:{...minimalGame('id_test'),remote:true}});
 await engine.flush();assert.equal(engine.pendingCount,1);assert.equal(engine.workspace.conflicts.length,1);assert.equal(backend.games.get('id_test').revision,9);
 await engine.pull();assert.equal(engine.db.games[0].events.length,1);
 const resolved=await engine.resolve('game:id_test','紀錄乙',true);assert.equal(resolved.games.length,2);assert.ok(resolved.games.find(g=>g.id==='id_test').remote);
 await engine.flush();assert.equal(backend.games.size,2);assert.equal(backend.games.get('id_test').revision,9);
 assert.equal(engine.workspace.conflicts[0].archivedOperations.length,1);
});
test('offline edits keep snapshots without making network requests',async()=>{
 const {engine,backend}=await setup(undefined,undefined,()=>false);await engine.beginRecording('id_local','離線甲',true);
 const db=engine.db;db.games.push(minimalGame('id_local'));await engine.commit(db,'離線甲');await engine.flush();
 assert.equal(engine.pendingCount,1);assert.equal(backend.audit.length,0);assert.match(engine.status,/離線/);
});
test('lease denied prevents edits and never drops queued drafts',async()=>{
 const{engine,backend}=await setup();backend.games.set('id_test',{game_id:'id_test',revision:1,state:minimalGame('id_test')});await engine.pull();
 backend.busy=true;await assert.rejects(()=>engine.beginRecording('id_test','紀錄甲'),e=>e.code==='LEASE_BUSY');
 const db=engine.db;db.games[0].events.push({kind:'pitch'});await assert.rejects(()=>engine.commit(db,'紀錄甲'),e=>e.code==='RECORDER_REQUIRED');
 backend.busy=false;await engine.beginRecording('id_test','紀錄甲');await engine.commit(db,'紀錄甲');backend.busy=true;await engine.flush();
 assert.equal(engine.pendingCount,1);assert.equal(backend.audit.length,0);assert.throws(()=>engine.assertEditor('id_test'));
});
test('atomic persistence failure does not pretend save or sync succeeded',async()=>{
 const{engine,repository}=await setup();await engine.beginRecording('id_test','紀錄甲',true);const db=engine.db;db.games.push(minimalGame('id_test'));repository.fail=true;
 await assert.rejects(()=>engine.commit(db,'紀錄甲'),/disk full/);assert.equal(engine.pendingCount,0);assert.equal(engine.db.games.length,0);
});
test('concurrent tabs cannot overwrite the same persistent workspace generation',async()=>{
 const repository=new MemoryStore();const a=(await setup(undefined,repository)).engine,b=(await setup(undefined,repository)).engine;
 await a.commit(a.db,'');await assert.rejects(()=>b.commit(b.db,''),/LOCAL_WORKSPACE_CONFLICT/);
});
test('undo snapshots cannot erase durable audit trail; settings do not enqueue games',async()=>{
 const{engine}=await setup();await engine.beginRecording('id_test','紀錄甲',true);const db=engine.db;db.games.push(minimalGame('id_test'));await engine.commit(db,'紀錄甲');
 db.settings.scale=1.2;await engine.commit(db,'紀錄甲');assert.equal(engine.pendingCount,1);
 db.games[0].events.push({kind:'pitch'});await engine.commit(db,'紀錄甲');db.games[0].events=[];await engine.commit(db,'紀錄甲','UNDO');
 assert.equal(engine.db.games[0].auditTrail.length,3);assert.equal(engine.db.games[0].auditTrail[1].events[0].kind,'pitch');
});
test('blank recorder rejected for roster changes; backup contains pending and conflicts',async()=>{
 const{engine}=await setup();const db=engine.db;db.clubRoster.push({id:'p1',name:'測試甲',num:''});
 await assert.rejects(()=>engine.commit(db,' '),e=>e.code==='RECORDER_REQUIRED');await engine.commit(db,'紀錄甲');
 const backup=JSON.parse(engine.backup());assert.equal(backup.workspace.pending.length,1);assert.equal(parseBackup(JSON.stringify(backup)).clubRoster[0].num,'');
});
test('bulk restore atomically queues multiple new game IDs without renewing all as active editors',async()=>{
 const{engine,backend}=await setup();const db=engine.db;db.games.push(minimalGame('restored_a'),minimalGame('restored_b'));
 await engine.commit(db,'還原甲','IMPORT_BACKUP',true);assert.equal(engine.pendingCount,2);assert.equal(engine.editors.size,0);
 await engine.flush();assert.equal(backend.games.size,2);assert.equal(engine.pendingCount,0);
});
test('cached game remains editable as an offline draft when navigator reports online but fetch fails',async()=>{
 const{engine,backend}=await setup();backend.games.set('id_test',{game_id:'id_test',revision:1,state:minimalGame('id_test')});await engine.pull();
 engine.cloud.memberRole=async()=>{throw new CloudError('network down','OFFLINE');};
 await engine.beginRecording('id_test','紀錄甲');const db=engine.db;db.games[0].events.push({kind:'offline'});await engine.commit(db,'紀錄甲');
 assert.equal(engine.pendingCount,1);assert.equal(backend.audit.length,0);
 await assert.rejects(()=>engine.beginRecording('id_uncached','紀錄甲'),e=>e.code==='OFFLINE');
});
