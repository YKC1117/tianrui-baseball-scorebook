import * as quick from '../src/quick-scoring.mjs';
import * as planning from '../src/lineup-planning.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Exercise the actual retained scoring functions with a tiny DOM fixture. No
// production debug API or private test data is included in the application.
function scoring(){
 let source=readFileSync(new URL('../src/scorebook.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function mountScorebook','function mountScorebook');
 const start=source.indexOf('attachEvents();render();');
 source=source.slice(0,start)+`return {freshGame,pitchCredit,newPitchSession,pitchRowsData,pitchingRows,battingRows,st,ps,applyMoves,commitPlay,commitRun,finish,get db(){return db;},setGame(x){db.games=[x];db.activeId=x.id;currentRecorder={gameId:x.id,name:'測試紀錄'};},setView(view){db.settings.pitchView=view;}};}`;
 source=source.replace('function render(){','function render(){return;');
 const elements={rbi:{value:'0'},playCode:{value:''},playNote:{value:''},runNote:{value:''},runActor:{value:'r0'}};let moves=[];
 const document={addEventListener:()=>{},getElementById:id=>elements[id]||null,querySelectorAll:()=>moves.map(([key,dest,er])=>({getAttribute:()=>key,value:dest})),querySelector:()=>({value:'yes'})};
 const factory=new Function('planning','quick','document','window','confirm','structuredClone',source+';return mountScorebook;')(planning,quick,document,{alert:message=>{throw Error(message);}},()=>true,structuredClone);
 const api=factory({initialDb:{games:[],clubRoster:[],settings:{scale:1},draft:null},onSave:async()=>{},onRecorder:async()=>{},onGuard:async()=>true,onError:error=>{throw error;},securityPanel:()=>''});
 return {api,elements,setMoves:value=>{moves=value;}};
}
test('pitcher re-entry preserves 2.2 and 2.0 separately, totals 4.2 with ERA/WHIP',()=>{
 const{api}=scoring();const game=api.freshGame('away','測試隊','2000-01-01');api.setGame(game);const t=game.home,p1=t.pitcher,p2=t.roster[1].id;
 api.pitchCredit(t,p1,'outs',8);api.pitchCredit(t,p1,'H',2);api.pitchCredit(t,p1,'ER',1);api.pitchCredit(t,p1,'BB',1);
 t.pitcher=p2;api.newPitchSession(t,p2);api.pitchCredit(t,p2,'outs',1);
 t.pitcher=p1;api.newPitchSession(t,p1);api.pitchCredit(t,p1,'outs',6);api.pitchCredit(t,p1,'H',1);
 const sessions=t.pitchSessions.filter(s=>s.pid===p1);assert.deepEqual(sessions.map(s=>s.stats.outs),[8,6]);assert.equal(t.pitchStats[p1].outs,14);
 api.setView('split');let html=api.pitchingRows(t);assert.match(html,/>2\.2</);assert.match(html,/>2\.0</);assert.match(html,/當日二次登板/);
 api.setView('combined');html=api.pitchingRows(t);assert.match(html,/>4\.2</);assert.match(html,/>1\.93</);assert.match(html,/>0\.86</);
 for(let i=0;i<3;i++)api.pitchRowsData(t);assert.equal(t.pitchStats[p1].outs,14);
});
test('batting, running, charged pitcher sessions, R/H/E and early ending remain correct',()=>{
 const{api,elements,setMoves}=scoring();const game=api.freshGame('away','測試隊','2000-01-01');api.setGame(game);const batter=game.away.lineup[0];
 setMoves([['bat','1']]);api.commitPlay('1B');assert.equal(api.st(game.away,batter).H,1);assert.equal(api.ps(game.home,game.home.pitcher).H,1);
 setMoves([['r0','2']]);api.commitRun('SB');assert.equal(api.st(game.away,batter).SB,1);assert.equal(game.bases[1].pid,batter);
 elements.rbi.value='2';setMoves([['r1','H'],['bat','H']]);api.commitPlay('HR');
 assert.equal(game.score.away[0],2);assert.equal(api.ps(game.home,game.home.pitcher).ER,2);assert.equal(api.st(game.away,game.away.lineup[1]).RBI,2);
 assert.match(api.battingRows(game.away),/>1\.000</);assert.match(api.battingRows(game.away),/>5\.000</);
 api.finish();assert.equal(game.finished,true);assert.equal(game.inning,1);assert.equal(game.score.home[0],null);
});
