import {validateRoster,validateGame,validateSchedule} from './validation.mjs';
import { CloudError } from './cloud-gateway.mjs';
const copy = value => structuredClone(value);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sameGame = (a,b) => a && same({...a,auditTrail:null},{...b,auditTrail:null});
const objectKey = op => `${op.type}:${op.id}`;
const emptyDb = () => ({ games: [], clubRoster: [], schedule: {format:'TR-SCHEDULE-1',season:'球隊賽程',games:[]}, activeId:null, draft:null, settings:{scale:1,pitchView:'split'}, logo:null });
export class SyncStore {
  constructor({cloud, repository, online = () => navigator.onLine, uuid = () => crypto.randomUUID(), now = () => new Date().toISOString(), holderToken,accountId}) {
    Object.assign(this,{cloud, repository, online, uuid, now,accountId});
    this.chain = Promise.resolve(); this.token = holderToken || uuid(); this.editors = new Map(); this.recorders = new Map(); this.status = '尚未同步';
  }
  run(fn) { const next=this.chain.then(fn); this.chain=next.catch(()=>{}); return next; }
  async open() {
    this.workspace = await this.repository.read() || {format:'TR-WORKSPACE-15',generation:0,db:emptyDb(),revisions:{},pending:[],conflicts:[],lastSuccess:null};
    this.baseline = copy(this.workspace.db);
    return this;
  }
  get db() { return copy(this.workspace.db); }
  get pendingCount() { return this.workspace.pending.length; }
  async persist(next) {
    const generation=this.workspace.generation;
    next.generation=generation+1;
    await this.repository.write(next,generation);
    this.workspace=next; this.baseline=copy(next.db); this.onChange?.();
  }
  keyRevision(type,id) {
    const key=`${type}:${id}`;
    return (this.workspace.revisions[key] || 0) + this.workspace.pending.filter(op=>objectKey(op)===key).length;
  }
  assertEditor(gameId) {
    if (!this.editors.has(gameId)) throw new CloudError('請重新填寫姓名並取得本場紀錄權', 'RECORDER_REQUIRED');
    if (this.workspace.conflicts.some(c=>c.key===`game:${gameId}` && !c.resolved)) throw new CloudError('此場有衝突草稿，請先保留兩份或採用雲端版本', 'REVISION_CONFLICT');
  }
  assertAccount(userId=this.cloud.session?.user_id) {if(this.accountId&&userId!==this.accountId)throw new CloudError('帳號已變更，舊工作區草稿仍保留','ACCOUNT_CHANGED');}
  recorderTicket(gameId) { return copy(this.recorders.get(gameId)||null); }
  async beginRecording(gameId, name, isNew=false) {
    this.cloud._assertRecorder(name);
    return this.run(async()=>{
      if(this.accountId)this.assertAccount();
      for(const id of this.editors.keys()) if(id!==gameId) {
        if(this.online()) await this.cloud.releaseLease?.(id,this.token).catch(error=>{if(error.code!=='OFFLINE')throw error;});
        this.editors.delete(id);
      }
      if (this.online()) {
        try {
        await this.cloud.memberRole();
        if (!isNew) {
          if (!await this.cloud.acquireLease(gameId,this.token,name)) throw new CloudError('另一裝置正在紀錄本場；目前只能檢視', 'LEASE_BUSY');
          const row=await this.cloud.getGame(gameId);
          if (!row) throw new CloudError('找不到雲端比賽', 'UNKNOWN_GAME');
          validateGame(row.state);
          const key=`game:${gameId}`;
          const pending=this.workspace.pending.some(op=>objectKey(op)===key);
          if (pending && row.revision !== (this.workspace.revisions[key]||0)) {
            // Flush may resolve a lost acknowledgement. Never overwrite the draft here.
            this.status='待同步草稿需先核對版本';
          } else if (!pending) {
            const next=copy(this.workspace);
            next.db.games=next.db.games.filter(g=>g.id!==gameId).concat(row.state);
            next.revisions[key]=row.revision;
            await this.persist(next);
          }
        }
        } catch(error) {
          if(error.code!=='OFFLINE'||(!isNew&&!this.workspace.db.games.some(g=>g.id===gameId)))throw error;
          this.status='離線草稿：無法確認其他裝置操作';
        }
      } else if (isNew || this.workspace.db.games.some(g=>g.id===gameId)) {
        this.status='離線草稿：無法確認其他裝置操作';
      } else throw new CloudError('本機尚未快取此比賽','OFFLINE');
      this.editors.set(gameId,name.trim());
      this.recorders.set(gameId,{gameId,name:name.trim(),nonce:this.uuid()});
      return this.db.games.find(g=>g.id===gameId) || null;
    });
  }
  releaseEditors() { return this.run(async()=>{
    for(const id of this.editors.keys()) {
      if(this.online()) await this.cloud.releaseLease?.(id,this.token).catch(error=>{if(error.code!=='OFFLINE')throw error;});
      this.editors.delete(id);
    }
  }); }
  commit(db, recorderName, operation='EDIT', importNewGames=false, ticket=null) {
    const incoming=copy(db);validateRoster(incoming.clubRoster);incoming.games.forEach(validateGame);validateSchedule(incoming.schedule);
    return this.run(async()=>{
      const next=copy(this.workspace), old=this.baseline;
      // Deletion is archival only; silently dropping a game from a UI cannot erase it.
      if (old.games.some(g=>!incoming.games.some(x=>x.id===g.id))) throw new Error('GAME_REMOVAL_REQUIRES_ARCHIVE');
      for (const game of incoming.games) {
        const prior=old.games.find(g=>g.id===game.id);
        if (sameGame(prior,game)) { if(prior.auditTrail)game.auditTrail=copy(prior.auditTrail);continue; }
        const signedTicket=ticket?.gameId===game.id && this.recorders.get(game.id)?.nonce===ticket.nonce;
        if(!prior && importNewGames) this.cloud._assertRecorder(recorderName);
        else if(!signedTicket)this.assertEditor(game.id);
        const name=(!prior && importNewGames)?recorderName.trim():signedTicket?ticket.name:this.editors.get(game.id), expected=this.keyRevision('game',game.id), operationId=this.uuid();
        game.auditTrail=[...(prior?.auditTrail||[]),{operationId,recorder:name,time:this.now(),operation,revisionBefore:expected,revisionAfter:expected+1,events:copy(game.events?.slice(prior?.events?.length||0)||[])}];
        next.pending.push({type:'game',id:game.id,expected,data:copy(game),name,operation:expected===0?'CREATE':operation,operationId});
      }
      for(const type of ['roster','schedule']) {
        const before=type==='roster'?{roster:old.clubRoster}:old.schedule;
        const data=type==='roster'?{roster:incoming.clubRoster}:incoming.schedule;
        if (same(before,data)) continue;
        this.cloud._assertRecorder(recorderName);
        if(this.workspace.conflicts.some(c=>c.key===`${type}:${type}`&&!c.resolved)) throw new CloudError('請先處理資料衝突','REVISION_CONFLICT');
        next.pending.push({type,id:type,expected:this.keyRevision(type,type),data:copy(data),name:recorderName.trim(),operation,operationId:this.uuid()});
      }
      next.db=incoming;
      await this.persist(next);
      this.status=this.online()?'本機已保存，等待同步':'離線待同步';
    });
  }
  flush() { return this.run(()=>this._flush()); }
  async _flush() {
    if (!this.online()) { this.status='離線待同步'; this.onChange?.(); return; }
    try {
      this.assertAccount((await this.cloud.verifySession()).id); await this.cloud.memberRole();
      const blocked=new Set(this.workspace.conflicts.filter(c=>!c.resolved).map(c=>c.key));
      for (const op of [...this.workspace.pending]) {
        const key=objectKey(op);
        if (blocked.has(key)) continue;
        try {
          let revision;
          if (op.type==='game') {
            if(op.expected===0) revision=await this.cloud.createGame(op.data,op.name,op.operationId,this.token);
            else {
              if(!await this.cloud.acquireLease(op.id,this.token,op.name)) throw new CloudError('另一裝置正在紀錄，草稿已保留','LEASE_BUSY');
              revision=await this.cloud.saveGame(op.data,op.expected,this.token,op.name,op.operation,op.operationId);
            }
          } else revision=await this.cloud.saveDocument(op.type,op.expected,op.data,op.name,op.operation,op.operationId);
          const next=copy(this.workspace);
          next.pending=next.pending.filter(p=>p.operationId!==op.operationId);
          next.revisions[key]=Number(revision); next.lastSuccess=this.now();
          await this.persist(next);
          if(op.type==='game'&&!this.editors.has(op.id)&&!next.pending.some(p=>objectKey(p)===key))
            await this.cloud.releaseLease?.(op.id,this.token).catch(()=>{});
        } catch (error) {
          if(['REVISION_CONFLICT','OPERATION_ID_REUSED'].includes(error.code)) {
            const next=copy(this.workspace);
            next.conflicts.push({id:this.uuid(),key,operationId:op.operationId,time:this.now(),reason:error.code,resolved:false});
            await this.persist(next); blocked.add(key);
          } else if(['LEASE_BUSY','NOT_RECORDING_LEASE_HOLDER'].includes(error.code)) {
            blocked.add(key); this.editors.delete(op.id); this.status=error.message;
          } else throw error;
        }
      }
      if (this.workspace.conflicts.some(c=>!c.resolved)) this.status='版本衝突：草稿與雲端版本均保留';
      else if (this.pendingCount) this.status='仍有待同步草稿（請確認紀錄權）';
      else this.status='已同步';
    } catch(error) {
      this.status=error.code==='OFFLINE'?'離線待同步':error.message;
      if(['SESSION_EXPIRED','NOT_SIGNED_IN','NOT_APPROVED','SESSION_REVOKED','ACCOUNT_CHANGED'].includes(error.code)) { this.editors.clear(); this.onAuthLost?.(error); }
      this.onChange?.(); throw error;
    }
    this.onChange?.();
  }
  pull() { return this.run(async()=>{
    this.assertAccount((await this.cloud.verifySession()).id);await this.cloud.memberRole();
    const [roster,schedule,games]=await Promise.all([this.cloud.getDocument('roster'),this.cloud.getDocument('schedule'),this.cloud.listGames()]);
    await this.cloud.memberRole();
    validateRoster(roster?.document?.roster||[]);if(schedule)validateSchedule(schedule.document);games.forEach(row=>{validateGame(row.state);if(row.state.id!==row.game_id)throw Error('INVALID_GAME_ID');});
    const next=copy(this.workspace), pending=new Set(next.pending.map(objectKey));
    if(next.db.games.some(g=>!pending.has(`game:${g.id}`)&&!games.some(row=>row.game_id===g.id)))throw new CloudError('雲端資料不完整，保留目前快取並停止取代','INCOMPLETE_SNAPSHOT');
    for(const [type,row] of [['roster',roster],['schedule',schedule]])if(!row&&next.revisions[`${type}:${type}`])throw new CloudError('雲端文件不完整，保留目前快取','INCOMPLETE_SNAPSHOT');
    for(const [type,row] of [['roster',roster],['schedule',schedule]]) if(!pending.has(`${type}:${type}`)) {
      next.revisions[`${type}:${type}`]=row?.revision||0;
      if(type==='roster') next.db.clubRoster=row?.document?.roster||[];
      else next.db.schedule=row?.document||emptyDb().schedule;
    }
    const local=next.db.games.filter(game=>pending.has(`game:${game.id}`));
    next.db.games=local.concat(games.filter(row=>!pending.has(`game:${row.game_id}`)).map(row=>row.state));
    for(const row of games) if(!pending.has(`game:${row.game_id}`)) next.revisions[`game:${row.game_id}`]=row.revision;
    next.lastSuccess=this.now(); await this.persist(next);
    return this.db;
  }); }
  heartbeat() { return this.run(async()=>{
    if(!this.online()) return;
    for(const [id,name] of this.editors) {
      if(!(this.workspace.revisions[`game:${id}`]>0)) continue;
      try { if(!await this.cloud.acquireLease(id,this.token,name)) { this.editors.delete(id); this.status='紀錄權已由其他裝置持有，請重新接手'; } }
      catch(error) { this.status=error.message; if(error.code!=='OFFLINE') this.editors.delete(id); }
    }
    this.onChange?.();
  }); }
  backup() { return JSON.stringify({format:'TR-SECURE-BACKUP-15',exportedAt:this.now(),workspace:this.workspace},null,2); }
  resolve(key, name, keepBoth=false) { return this.run(async()=>{
    this.cloud._assertRecorder(name);
    const remote=key.startsWith('game:')?await this.cloud.getGame(key.slice(5)):await this.cloud.getDocument(key.split(':')[0]);
    if(remote){if(key.startsWith('game:'))validateGame(remote.state);else if(key==='roster:roster')validateRoster(remote.document.roster);else validateSchedule(remote.document);}
    const next=copy(this.workspace), ops=next.pending.filter(op=>objectKey(op)===key);
    if (!ops.length) throw new Error('NO_CONFLICT_DRAFT');
    const draft=ops.at(-1).data;
    next.conflicts=next.conflicts.map(c=>c.key===key&&!c.resolved?{...c,resolved:true,archivedOperations:ops}:c);
    next.pending=next.pending.filter(op=>objectKey(op)!==key);
    next.revisions[key]=remote?.revision||0;
    if(key.startsWith('game:')) {
      next.db.games=next.db.games.filter(g=>g.id!==key.slice(5));
      if(remote) next.db.games.push(remote.state);
      if(keepBoth) {
        const id=`id_${this.uuid().replaceAll('-','')}`, game={...copy(draft),id,note:(draft.note||'')+'（衝突草稿另存）'};
        next.db.games.push(game); this.editors.set(id,name);
        next.pending.push({type:'game',id,expected:0,data:game,name,operation:'CREATE',operationId:this.uuid()});
      }
    } else if(key==='roster:roster') next.db.clubRoster=remote?.document?.roster||[];
    else next.db.schedule=remote?.document||emptyDb().schedule;
    await this.persist(next); return this.db;
  }); }
}
