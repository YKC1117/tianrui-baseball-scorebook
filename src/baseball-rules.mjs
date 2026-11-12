// Standard DH only (OBR 5.11); two-way-player exceptions are deliberately not inferred.
export const defenseCodes=['P','C','B1','B2','B3','SS','LF','CF','RF'];
const clone=value=>structuredClone(value);
export const activeDH=team=>team.dh?.enabled===true;
export function validateTeamDH(team){
 if(!activeDH(team)){if(team.lineupRules==='standard-9'){const fielders=defenseCodes.map(code=>team.defense?.[code]);if(team.lineup.length!==9||new Set(team.lineup).size!==9||team.defense?.P!==team.pitcher||new Set(fielders).size!==9||fielders.some(id=>!team.lineup.includes(id)))throw Error('未採 DH 時九棒必須對應九位守備，投手也須在打序');}return team;}
 const {playerId,slot}=team.dh,ids=new Set(team.roster.map(p=>p.id)),fielders=defenseCodes.map(code=>team.defense?.[code]);
 if(team.dh.endedAt||team.lineup.length!==9||new Set(team.lineup).size!==9||Object.entries(team.defense||{}).some(([code,id])=>id&&!defenseCodes.includes(code))||!ids.has(playerId)||team.lineup[slot]!==playerId||team.lineup.includes(team.pitcher)||team.pitcher===playerId||team.defense?.P!==team.pitcher||fielders.some(id=>!ids.has(id))||new Set(fielders).size!==9||fielders.includes(playerId)||team.lineup.some(id=>id!==playerId&&!fielders.includes(id)))throw Error('DH 必須在九棒、不佔守備；獨立投手不得同時佔打序');
 return team;
}
export function endDH(team,reason,time=new Date().toISOString()){if(activeDH(team))team.dh={...team.dh,enabled:false,endedAt:time,reason};}
export function syncDraft(d,roster){
 const ids=new Set(roster.map(p=>p.id));d.useDH=d.useDH===true;d.guests??=[];
 d.selected=[...new Set(d.selected||[])].filter(id=>ids.has(id));d.lineup=[...new Set(d.lineup||[])].filter(id=>d.selected.includes(id)).slice(0,9);d.positions??={};
 if(d.useDH){
  if(!d.selected.includes(d.pitcherId))d.pitcherId='';
  if(!d.pitcherId)d.pitcherId=d.selected.find(id=>!d.lineup.includes(id))||'';
  d.lineup=d.lineup.filter(id=>id!==d.pitcherId);
 }
 for(const id of d.selected)if(d.lineup.length<9&&!d.lineup.includes(id)&&(!d.useDH||id!==d.pitcherId))d.lineup.push(id);
 const codes=d.useDH?['DH',...defenseCodes.slice(1)]:defenseCodes;
 if(d.useDH){d.dhId=d.lineup.includes(d.dhId)?d.dhId:d.lineup.find(id=>d.positions[id]==='DH')||d.lineup.find(id=>d.positions[id]==='P')||d.lineup[0]||'';if(d.dhId)d.positions[d.dhId]='DH';}
 const taken=new Set();for(const id of d.lineup){let pos=d.positions[id];if(d.useDH&&id===d.dhId)pos='DH';if(!codes.includes(pos)||taken.has(pos)||d.useDH&&pos==='DH'&&id!==d.dhId)pos=codes.find(code=>!taken.has(code)&&(!d.useDH||code!=='DH'||id===d.dhId));d.positions[id]=pos||'';taken.add(pos);}
 if(!d.useDH){d.pitcherId=d.lineup.find(id=>d.positions[id]==='P')||'';delete d.dhId;}
 d.manualPositions=(d.manualPositions||[]).filter(id=>d.lineup.includes(id));return d;
}
export function toggleDraftDH(d,enabled){
 if(enabled===d.useDH)return;
 if(enabled){d.useDH=true;d.dhId=d.lineup.find(id=>d.positions[id]==='P')||d.lineup[0]||'';if(d.dhId)d.positions[d.dhId]='DH';d.pitcherId=d.selected.find(id=>!d.lineup.includes(id))||'';}
 else{const dh=d.dhId||d.lineup.find(id=>d.positions[id]==='DH'),slot=d.lineup.indexOf(dh),pitcher=d.pitcherId;if(pitcher&&slot>=0){d.lineup[slot]=pitcher;d.positions[pitcher]='P';}else if(dh)d.positions[dh]='P';d.useDH=false;delete d.dhId;}
}
export function setDraftPitcher(d,pid){
 if(!d.useDH||!d.selected.includes(pid))return;const old=d.pitcherId,slot=d.lineup.indexOf(pid);if(slot>=0){const replacement=d.selected.find(id=>id!==pid&&!d.lineup.includes(id)&&id!==old)||(old&&d.selected.includes(old)?old:'');if(replacement){d.lineup[slot]=replacement;d.positions[replacement]=d.positions[pid];if(d.dhId===pid)d.dhId=replacement;}else d.lineup.splice(slot,1);}d.pitcherId=pid;
}
export function draftRuleErrors(d){
 const errors=[],codes=d.useDH?['DH',...defenseCodes.slice(1)]:defenseCodes;
 if(d.selected.length<(d.useDH?10:9))errors.push(d.useDH?'採用 DH 至少需要 10 人（九棒＋獨立投手）':'至少需要 9 名球員');
 if(d.lineup.length!==9||new Set(d.lineup).size!==9)errors.push('打序固定九位不同球員');
 const roles=d.lineup.map(id=>d.positions[id]);if(roles.some(code=>!codes.includes(code))||new Set(roles).size!==9)errors.push(d.useDH?'九棒需一位 DH 與八位非投手守備，守位不可重複':'九棒與九守位必須完整且不重複');
 if(d.useDH&&(!d.selected.includes(d.pitcherId)||d.lineup.includes(d.pitcherId)))errors.push('請另選一名不在九棒的先發投手');
 return errors;
}
export function applyDraft(team,d){
 team.lineupRules='standard-9';team.lineup=[...d.lineup];team.defense={};for(const id of d.lineup)if(d.positions[id]!=='DH')team.defense[d.positions[id]]=id;
 team.pitcher=d.useDH?d.pitcherId:team.defense.P;team.defense.P=team.pitcher;
 if(d.useDH)team.dh={enabled:true,playerId:d.dhId,slot:d.lineup.indexOf(d.dhId)};else team.dh={enabled:false};validateTeamDH(team);
}
export function defaultOpponentDH(team,enabled=true){team.lineupRules='standard-9';if(!enabled){team.lineup=team.roster.slice(0,9).map(p=>p.id);team.pitcher=team.lineup[0];team.defense=Object.fromEntries(defenseCodes.map((code,i)=>[code,team.lineup[i]]));team.dh={enabled:false};validateTeamDH(team);return;}const pitcher=team.roster[9]?.id;if(!pitcher)throw Error('對手 DH 需至少十人');team.lineup=team.roster.slice(0,9).map(p=>p.id);team.pitcher=pitcher;team.defense=Object.fromEntries(defenseCodes.map((code,i)=>[code,i===0?pitcher:team.roster[i].id]));team.dh={enabled:true,playerId:team.lineup[0],slot:0};validateTeamDH(team);}
export function proposeSubstitution(team,slot,pid){
 const next=clone(team),old=next.lineup[slot];if(!next.roster.some(p=>p.id===pid)||!Number.isInteger(slot)||slot<0||slot>8||next.lineup.some((id,i)=>id===pid&&i!==slot))throw Error('換人必須使用不同且已報名的球員');
 let reason='';next.lineup[slot]=pid;
 if(activeDH(next)){
  if(pid===next.pitcher&&old!==next.dh.playerId)throw Error('正規 DH 模式投手只能替補 DH 打擊；如需多重換人，請先明確終止 DH 並核對守備與棒次');
  if(pid===next.pitcher){reason='投手進入打序，DH 身分終止';endDH(next,reason);}
  else if(old===next.dh.playerId)next.dh={...next.dh,playerId:pid,slot};
  else{const pos=defenseCodes.find(code=>next.defense[code]===old);if(!pos)throw Error('原先發缺少守位，請先核對守備');next.defense[pos]=pid;}
 }else{for(const code of defenseCodes)if(next.defense?.[code]===old)next.defense[code]=pid;if(next.pitcher===old){next.pitcher=pid;next.defense.P=pid;}}
 validateTeamDH(next);return {team:next,reason,pitcherChanged:team.pitcher!==next.pitcher};
}
export function proposePitcher(team,pid,batSlot=null){
 const next=clone(team);if(!next.roster.some(p=>p.id===pid))throw Error('投手不在當場名單');if(pid===next.pitcher)return {team:next,reason:'',pitcherChanged:false};
 const old=next.pitcher,oldPosition=defenseCodes.find(code=>code!=='P'&&next.defense?.[code]===pid);let reason='';
 if(activeDH(next)&&next.lineup.includes(pid)){reason='九棒球員接任投手，DH 身分終止';if(oldPosition)next.defense[oldPosition]=next.dh.playerId;endDH(next,reason);}
 else if(!activeDH(next)){
  if(oldPosition)next.defense[oldPosition]=old;
  if(!next.lineup.includes(pid)){if(next.lineup.indexOf(old)<0&&(batSlot===null||batSlot===''))throw Error('未採 DH，請明確選擇新投手的打序');const slot=next.lineup.indexOf(old)>=0?next.lineup.indexOf(old):Number(batSlot);if(!Number.isInteger(slot)||slot<0||slot>8)throw Error('未採 DH，請明確選擇新投手的打序');const replaced=next.lineup[slot];next.lineup[slot]=pid;for(const code of defenseCodes)if(code!=='P'&&next.defense?.[code]===replaced)delete next.defense[code];}
 }
 next.pitcher=pid;next.defense??={};next.defense.P=pid;validateTeamDH(next);return {team:next,reason,pitcherChanged:true};
}
export function proposeDefense(team,defense,pitcherSlot=null){
 const next=clone(team),ids=new Set(next.roster.map(p=>p.id)),fielders=Object.values(defense).filter(Boolean);if(defense.P!==next.pitcher||fielders.some(id=>!ids.has(id))||new Set(fielders).size!==fielders.length)throw Error('守備球員不可重複，投手請用更換投手');next.defense=clone(defense);let reason='';
 if(activeDH(next)&&fielders.includes(next.dh.playerId)){
  if(pitcherSlot===null||pitcherSlot==='')throw Error('請選擇投手接替的棒次');const slot=Number(pitcherSlot);if(!Number.isInteger(slot)||slot<0||slot>8||slot===next.dh.slot)throw Error('DH 改守備時，請明確指定投手接替被換下守備員的棒次');
  next.lineup[slot]=next.pitcher;const bat=new Set(next.lineup);if(fielders.length!==9||fielders.some(id=>!bat.has(id))||bat.size!==9)throw Error('DH 終止後，九棒必須正好對應九位守備球員，請核對投手接替的棒次');reason='DH 進入守備，投手加入打序，DH 身分終止';endDH(next,reason);
 }
 validateTeamDH(next);return {team:next,reason,pitcherChanged:false};
}
export const canAttemptUncaught=game=>!game.bases[0]||game.outs===2;
export function scoringToken(game){return JSON.stringify([game.inning,game.half,game.outs,game.bases,game.balls,game.strikes,game.score,game.finished,...['away','home'].map(k=>[game[k].next,game[k].pitcher]),game.events.filter(e=>!['recorder','audit'].includes(e.kind)).at(-1)?.id]);}
export function canCorrectStrikeout(game){return !!game.pendingThirdStrike&&game.pendingThirdStrike.appliedToken===scoringToken(game);}
export function capturePlateState(game){
 const atkKey=game.half==='top'?'away':'home',defKey=atkKey==='away'?'home':'away',atk=game[atkKey],def=game[defKey],batterId=atk.lineup[atk.next],runners=game.bases.filter(Boolean),batIds=[batterId,...runners.map(r=>r.pid)],pitchIds=[def.pitcher,...runners.map(r=>r.charge)];
 return {atkKey,defKey,batterId,eventCutoff:game.events.length,state:clone(Object.fromEntries(['inning','half','outs','bases','balls','strikes','score','finished','completedAt','halfNotice'].map(key=>[key,game[key]??null]))),next:atk.next,batting:Object.fromEntries([...new Set(batIds)].map(id=>[id,clone(atk.stats[id]||null)])),pitching:Object.fromEntries([...new Set(pitchIds)].map(id=>[id,clone(def.pitchStats[id]||null)])),sessions:Object.fromEntries((def.pitchSessions||[]).map(session=>[session.id,clone(session.stats)]))};
}
export function restorePlateState(game,patch,{supersede=false}={}){
 const next=clone(game);delete next.pendingThirdStrike;Object.assign(next,clone(patch.state));next[patch.atkKey].next=patch.next;
 for(const [id,value] of Object.entries(patch.batting)){if(value)next[patch.atkKey].stats[id]=clone(value);else delete next[patch.atkKey].stats[id];}
 for(const [id,value] of Object.entries(patch.pitching)){if(value)next[patch.defKey].pitchStats[id]=clone(value);else delete next[patch.defKey].pitchStats[id];}
 for(const session of next[patch.defKey].pitchSessions||[])if(patch.sessions[session.id])session.stats=clone(patch.sessions[session.id]);
 if(supersede){next.events=next.events.map((event,i)=>i<patch.eventCutoff||['pitch','recorder','audit'].includes(event.kind)?event:{...event,kind:'superseded-'+event.kind,superseded:true,message:'已改判｜'+event.message});}else next.events=next.events.slice(0,patch.eventCutoff);
 return next;
}
export function validateUncaught(game,entry){
 const map=clone(entry.map||{}),keys=['bat',...game.bases.flatMap((p,i)=>p?['r'+i]:[])],eligible=canAttemptUncaught(game),used=new Set();let outs=0,scored=0;
 if(Object.keys(map).length!==keys.length||keys.some(key=>!map[key]||!['1','2','3','H','O'].includes(map[key].dest)))throw Error('請選擇打者及每位跑者的最後結果');
 if(!eligible&&map.bat.dest!=='O')throw Error('一壘有人且未兩出局，打者仍三振出局，不能安全上壘');
 for(const [key,move] of Object.entries(map)){if(!keys.includes(key)||!['pending','yes','no'].includes(move.er))throw Error('跑壘資料不正確');if(move.dest==='O')outs++;if(move.dest==='H')scored++;if(/^[123]$/.test(move.dest)){if(used.has(move.dest))throw Error('同一壘包不能站兩位球員');used.add(move.dest);if(key!=='bat'&&Number(move.dest)<Number(key.slice(1))+1)throw Error('跑者不可退壘');}}
 if(game.outs+outs>3)throw Error('出局數超過三個，請依判決修正');let cancelledRuns=0;
 if(game.outs+outs===3&&scored){const beforeFirst=map.bat.dest==='O'&&!entry.batterReachedFirst;if(!beforeFirst&&!['force','time'].includes(entry.thirdOutRule))throw Error('請確認第三出局的封殺或得分先後');if(beforeFirst||entry.thirdOutRule==='force'){for(const move of Object.values(map))if(move.dest==='H'){move.dest='N';cancelledRuns++;}scored=0;}}
 const cause=entry.cause||'pending';if(!['pending','WP','PB'].includes(cause))throw Error('請依判決選擇暴投、捕逸或待判');const def=game[game.half==='top'?'home':'away'];if(cause==='PB'&&!def.roster.some(p=>p.id===entry.catcherId))throw Error('請指定捕手，或先保留原因待判');
 return {...entry,map,rbi:0,outs,scored,cancelledRuns,eligible,cause};
}
