import {normalizePositions,normalizePlanningState} from './lineup-planning.mjs';
const idPattern=/^[a-zA-Z0-9_-]{1,128}$/;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const validId=value=>typeof value==='string'&&idPattern.test(value)&&value!=='prototype'&&!Object.hasOwn(Object.prototype,value);
export function validateRoster(list,max=60,uniqueNumbers=true) {
 if(!Array.isArray(list)||list.length>max)throw Error('名冊格式或人數不正確');
 const ids=new Set(),nums=new Set();
 for(const p of list){
  if(!record(p)||!validId(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||typeof p.num!=='string'||p.num.length>5||(uniqueNumbers&&p.num&&nums.has(p.num)))throw Error('名冊含無效姓名、ID 或重複背號');
  normalizePositions(p.positions);
  ids.add(p.id);if(p.num)nums.add(p.num);
 }
 return list;
}
export function validateGame(game) {
 if(!record(game)||!validId(game.id)||!['away','home'].includes(game.side)||!Array.isArray(game.events)||!record(game.score)||!Number.isInteger(game.inning)||game.inning<1||game.inning>9||!['top','bottom'].includes(game.half))throw Error('比賽資料格式不正確');
 for(const side of ['away','home']){
  const t=game[side];if(!record(t)||typeof t.name!=='string'||!record(t.stats)||!record(t.pitchStats))throw Error('隊伍資料不完整');
  validateRoster(t.roster,40,false);
  const ids=new Set(t.roster.map(p=>p.id));
  if(!Array.isArray(t.lineup)||t.lineup.length!==9||new Set(t.lineup).size!==9||t.lineup.some(id=>!ids.has(id))||!ids.has(t.pitcher))throw Error('先發名單或投手資料不正確');
  if(!Array.isArray(game.score[side])||game.score[side].length!==9||game.score[side].some(v=>v!==null&&(!Number.isInteger(v)||v<0)))throw Error('比分資料不正確');
 }
 return game;
}
export function validateSchedule(schedule){
 if(!record(schedule)||schedule.format!=='TR-SCHEDULE-1'||typeof schedule.season!=='string'||!Array.isArray(schedule.games)||schedule.games.length>2000)throw Error('賽程資料格式不正確');
 const ids=new Set();
 for(const game of schedule.games){
  if(!record(game)||!validId(game.id)||ids.has(game.id)||typeof game.opponent!=='string'||!game.opponent.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(game.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(game.time)||!['scheduled','postponed','cancelled','completed'].includes(game.status))throw Error('賽程日期、時間、對手或狀態不正確');
  const date=new Date(game.date+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==game.date)throw Error('賽程日期不正確');
  ids.add(game.id);
 }
 return schedule;
}
export function parseBackup(raw) {
 if(typeof raw!=='string'||raw.length>30_000_000)throw Error('備份檔案過大');
 const value=JSON.parse(raw);
 const db=value.format==='TR-SECURE-BACKUP-15'?(value.unsavedUi||value.workspace?.db):value;
 if(!db||!Array.isArray(db.games))throw Error('不是有效的工作區備份');
 validateRoster(db.clubRoster||[]);db.games.forEach(validateGame);
 if(db.schedule)validateSchedule(db.schedule);
 if(db.draft?.guests)validateRoster(db.draft.guests,20,false);
 if(db.logo&&!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(db.logo))throw Error('備份 Logo 格式不正確');
 return normalizePlanningState(db);
}
