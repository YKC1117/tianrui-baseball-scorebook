// Planning metadata is independent of historical game defense and statistics.
export const positions=[['P','投手'],['C','捕手'],['1B','一壘'],['2B','二壘'],['3B','三壘'],['SS','游擊'],['LF','左外野'],['CF','中外野'],['RF','右外野']];
const aliases={B1:'1B',B2:'2B',B3:'3B'};
export const canonical=code=>aliases[code]||code;
export const actual=code=>({'1B':'B1','2B':'B2','3B':'B3'}[code]||code);
export function normalizePositions(value){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.some(p=>typeof p!=='string'||!positions.some(([code])=>code===canonical(p))))throw Error('可守位置必須是九種守位組成的陣列');
 return positions.map(([code])=>code).filter(code=>value.some(p=>canonical(p)===code));
}
export const positionSummary=value=>normalizePositions(value).map(code=>positions.find(([p])=>p===code)[1]).join('・')||'可守位置尚未設定';
const copy=value=>structuredClone(value);
export const validPlanningId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id)&&id!=='prototype'&&!Object.hasOwn(Object.prototype,id);
export function normalizePlanningState(value){
 const db=copy(value);db.clubRoster=(db.clubRoster||[]).map(p=>({...p,positions:normalizePositions(p.positions)}));
 if(db.scheduleDrafts!==undefined&&(db.scheduleDrafts===null||typeof db.scheduleDrafts!=='object'||Array.isArray(db.scheduleDrafts)))throw Error('場次草稿格式不正確');
 db.scheduleDrafts=db.scheduleDrafts||{};
 const normalizeDraft=d=>{if(!d)return; if(d.scheduleId&&!validPlanningId(d.scheduleId))throw Error('場次關聯 ID 不正確');if(d.manualPositions===undefined)d.manualPositions=(d.lineup||[]).filter(id=>positions.some(([code])=>actual(code)===d.positions?.[id]));if(d.guests)d.guests=d.guests.map(p=>({...p,positions:normalizePositions(p.positions)}));};
 normalizeDraft(db.draft);normalizeDraft(db.unlinkedDraft);
 for(const [id,draft] of Object.entries(db.scheduleDrafts)){if(!validPlanningId(id)||!draft||draft.scheduleId!==id)throw Error('場次草稿關聯不正確');normalizeDraft(draft);}
 return db;
}
export function cacheDraft(db){
 if(!db.draft)return;
 if(db.draft.scheduleId){if(!validPlanningId(db.draft.scheduleId))throw Error('場次關聯 ID 不正確');db.scheduleDrafts??={};db.scheduleDrafts[db.draft.scheduleId]=copy(db.draft);}
 else db.unlinkedDraft=copy(db.draft);
}
export function activateSchedule(db,match,blank){
 if(match&&(!validPlanningId(match.id)||match.status!=='scheduled'))throw Error('這場賽程目前不能安排出賽');
 cacheDraft(db);
 db.draft=copy(match?(db.scheduleDrafts?.[match.id]||blank()):(db.unlinkedDraft||blank()));
 if(match)Object.assign(db.draft,{scheduleId:match.id,date:match.date,opponent:match.opponent});else delete db.draft.scheduleId;
 return db.draft;
}
// Augmenting paths enforce one actual defensive position per distinct player.
function matchPlayers(players,codes,pinned={}){
 const byPosition={},byPlayer={};
 for(const [id,code] of Object.entries(pinned)){if(!players.some(p=>p.id===id)||!codes.includes(code)||byPosition[code])return null;byPosition[code]=id;byPlayer[id]=code;}
 const locked=new Set(Object.keys(pinned));
 function augment(code,seen){for(const player of players){if(locked.has(player.id)||seen.has(player.id)||!normalizePositions(player.positions).includes(code))continue;seen.add(player.id);const old=byPlayer[player.id];if(!old||augment(old,seen)){byPosition[code]=player.id;byPlayer[player.id]=code;return true;}}return false;}
 for(const code of codes)if(!byPosition[code])augment(code,new Set());
 return {byPosition,byPlayer};
}
export function analyzeCoverage(players){
 const codes=positions.map(([code])=>code),unique=[...new Map(players.map(p=>[p.id,p])).values()],matching=matchPlayers(unique,codes),conflicts=[];
 const candidates=Object.fromEntries(codes.map(code=>[code,unique.filter(p=>normalizePositions(p.positions).includes(code))]));
 for(const start of codes.filter(code=>!matching.byPosition[code]&&candidates[code].length)){
  const group=new Set([start]),people=new Set(),queue=[start];
  while(queue.length){const code=queue.shift();for(const player of candidates[code]){people.add(player.id);const next=matching.byPlayer[player.id];if(next&&!group.has(next)){group.add(next);queue.push(next);}}}
  const overlap=conflicts.filter(c=>c.codes.some(code=>group.has(code)));
  for(const c of overlap){c.codes.forEach(code=>group.add(code));c.playerIds.forEach(id=>people.add(id));conflicts.splice(conflicts.indexOf(c),1);}
  conflicts.push({codes:codes.filter(code=>group.has(code)),playerIds:[...people],shortage:group.size-people.size});
 }
 const affected=new Set(conflicts.flatMap(c=>c.codes));
 return {matched:Object.keys(matching.byPosition).length,missing:9-Object.keys(matching.byPosition).length,conflicts,unknown:unique.filter(p=>!normalizePositions(p.positions).length),positions:positions.map(([code,label])=>({code,label,candidates:candidates[code],status:!candidates[code].length?'待補':affected.has(code)?'需要調整':'可選'}))};
}
export function suggestDefense(draft,players){
 const starters=draft.lineup.map(id=>players.find(p=>p.id===id)).filter(Boolean);
 if(starters.length!==9||new Set(starters.map(p=>p.id)).size!==9)return null;
 const pinned=Object.fromEntries((draft.manualPositions||[]).filter(id=>draft.lineup.includes(id)).map(id=>[id,canonical(draft.positions[id])]));
 const result=matchPlayers(starters,positions.map(([code])=>code),pinned);
 if(!result||Object.keys(result.byPosition).length!==9)return null;
 return Object.fromEntries(Object.entries(result.byPosition).map(([code,id])=>[id,actual(code)]));
}
