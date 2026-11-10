const idPattern=/^[a-zA-Z0-9_-]{1,128}$/;
export function validateRoster(list,max=60,uniqueNumbers=true) {
 if(!Array.isArray(list)||list.length>max)throw Error('名冊格式或人數不正確');
 const ids=new Set(),nums=new Set();
 for(const p of list){
  if(!p||!idPattern.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||typeof p.num!=='string'||p.num.length>5||(uniqueNumbers&&p.num&&nums.has(p.num)))throw Error('名冊含無效姓名、ID 或重複背號');
  ids.add(p.id);if(p.num)nums.add(p.num);
 }
 return list;
}
export function validateGame(game) {
 if(!game||!idPattern.test(game.id)||!['away','home'].includes(game.side)||!Array.isArray(game.events)||!game.score||!Number.isInteger(game.inning)||game.inning<1||game.inning>9||!['top','bottom'].includes(game.half))throw Error('比賽資料格式不正確');
 for(const side of ['away','home']){
  const t=game[side];if(!t||typeof t.name!=='string'||!t.stats||!t.pitchStats)throw Error('隊伍資料不完整');
  validateRoster(t.roster,40,false);
  const ids=new Set(t.roster.map(p=>p.id));
  if(!Array.isArray(t.lineup)||t.lineup.length!==9||new Set(t.lineup).size!==9||t.lineup.some(id=>!ids.has(id))||!ids.has(t.pitcher))throw Error('先發名單或投手資料不正確');
  if(!Array.isArray(game.score[side])||game.score[side].length!==9||game.score[side].some(v=>v!==null&&(!Number.isInteger(v)||v<0)))throw Error('比分資料不正確');
 }
 return game;
}
export function parseBackup(raw) {
 if(typeof raw!=='string'||raw.length>30_000_000)throw Error('備份檔案過大');
 const value=JSON.parse(raw);
 const db=value.format==='TR-SECURE-BACKUP-15'?(value.unsavedUi||value.workspace?.db):value;
 if(!db||!Array.isArray(db.games))throw Error('不是有效的工作區備份');
 validateRoster(db.clubRoster||[]);db.games.forEach(validateGame);
 if(db.schedule&&(!Array.isArray(db.schedule.games)||db.schedule.format!=='TR-SCHEDULE-1'))throw Error('賽程備份格式不正確');
 if(db.draft?.guests)validateRoster(db.draft.guests,20,false);
 if(db.logo&&!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(db.logo))throw Error('備份 Logo 格式不正確');
 return db;
}
