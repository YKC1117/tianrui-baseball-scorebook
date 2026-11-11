import * as planning from '../src/lineup-planning.mjs';
import {readFileSync} from 'node:fs';
// Generate every sample score with the retained scoring engine, not mock totals.
export function createDemoData(){
 let source=readFileSync('src/scorebook.mjs','utf8').replace(/^import .*lineup-planning.*;\n/m,'').replace('export function mountScorebook','function mountScorebook');
 source=source.slice(0,source.indexOf('attachEvents();render();'))+`return {freshGame,newPitchSession,commitPlay,runPitch,finish,defaultMoves,blankBat,blankPitch,setGame(x){db.games=[x];db.activeId=x.id;currentRecorder={gameId:x.id,name:'示範紀錄員'};}};}`;
 source=source.replace('function render(){','function render(){return;');
 let moves=[],seed=123456;const randomMath=Object.create(Math);randomMath.random=()=>((seed=(seed*16807)%2147483647)-1)/2147483646;
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-08T01:00:00Z']));}static now(){return 1794099600000;}}
 const fields={rbi:{value:'0'},playCode:{value:''},playNote:{value:'示範紀錄'},runNote:{value:''}};
 const document={addEventListener(){},getElementById:id=>fields[id]||null,querySelectorAll:()=>moves.map(([key,dest])=>({getAttribute:()=>key,value:dest})),querySelector:()=>({value:'yes'})};
 const factory=new Function('planning','document','window','confirm','structuredClone','Math','Date',source+';return mountScorebook;')(planning,document,{alert:m=>{throw Error(m);}},()=>true,structuredClone,randomMath,FixedDate);
 const api=factory({initialDb:{games:[],clubRoster:[],settings:{scale:1},draft:null},onSave:async()=>{},onRecorder:async()=>{},onGuard:async()=>true,onError:e=>{throw e;},securityPanel:()=>''});
 const eligible=[['P','SS'],['C','1B'],['1B','3B'],['2B','SS'],['3B','1B'],['SS','2B'],['LF','CF'],['CF','RF'],['RF','LF'],['P','1B'],['C','RF'],['2B','3B'],['LF'],['CF'],['RF'],[],[],[],[],[]];
 const roster=Array.from({length:20},(_,i)=>({id:`demo_p${String(i+1).padStart(2,'0')}`,num:i>17?'':String(i+1).padStart(2,'0'),name:`示範球員 ${String(i+1).padStart(2,'0')}`,positions:eligible[i]}));
 function game(id,opponent,date){
  const x=api.freshGame('away',opponent,date);x.id=id;x.away.roster=structuredClone(roster);x.away.lineup=roster.slice(0,9).map(p=>p.id);x.away.pitcher=roster[0].id;x.away.defense=Object.fromEntries(['P','C','B1','B2','B3','SS','LF','CF','RF'].map((p,i)=>[p,roster[i].id]));x.away.stats={};x.away.pitchStats={};x.away.pitchSessions=[];api.newPitchSession(x.away,x.away.pitcher);
  for(const p of roster){x.away.stats[p.id]=api.blankBat();x.away.pitchStats[p.id]=api.blankPitch();}
  x.home.roster.forEach((p,i)=>p.name=`對手球員 ${String(i+1).padStart(2,'0')}`);api.setGame(x);return x;
 }
 function play(code){const map=api.defaultMoves(code);moves=Object.entries(map);fields.rbi.value=String(moves.filter(([,dest])=>dest==='H').length);api.commitPlay(code);}
 const completed=game('demo_completed','模擬灰熊隊','2026-11-01');play('1B');play('HR');for(let i=0;i<3;i++)play('SO');play('HR');for(let i=0;i<3;i++)play('SO');play('HR');for(let i=0;i<3;i++)play('SO');completed.away.pitcher=roster[1].id;api.newPitchSession(completed.away,roster[1].id);for(let i=0;i<6;i++)play('SO');completed.away.pitcher=roster[0].id;api.newPitchSession(completed.away,roster[0].id);for(let i=0;i<3;i++)play('SO');api.finish();completed.createdAt=1793494800000;
 const live=game('demo_live','模擬藍鷹隊','2026-11-08');play('1B');play('HR');api.runPitch('B');api.runPitch('S');live.createdAt=1794099600000;
 return {games:[live,completed],clubRoster:roster,activeId:live.id,settings:{scale:1,pitchView:'split'},logo:null,draft:{manualPositions:[],scheduleId:'demo_s1',date:'2026-11-15',opponent:'模擬山海隊',side:'away',selected:roster.slice(0,15).map(p=>p.id),lineup:roster.slice(0,9).map(p=>p.id),positions:Object.fromEntries(Object.entries(live.away.defense).map(([pos,id])=>[id,pos])),guests:[]},schedule:{format:'TR-SCHEDULE-1',season:'2026 秋季・試用賽程',games:[{id:'demo_s1',date:'2026-11-15',time:'09:00',opponent:'模擬山海隊',venue:'示範棒球場 A 場',status:'scheduled',notes:'08:20 集合暖身'},{id:'demo_s2',date:'2026-11-22',time:'13:30',opponent:'模擬長青隊',venue:'示範棒球場 B 場',status:'scheduled',notes:''},{id:'demo_s3',date:'2026-11-29',time:'09:00',opponent:'模擬海風隊',venue:'示範棒球場 A 場',status:'postponed',notes:'延期日期待確認'}]}};
}
