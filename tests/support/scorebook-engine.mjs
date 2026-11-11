import * as planning from '../../src/lineup-planning.mjs';
import * as quick from '../../src/quick-scoring.mjs';
import {readFileSync} from 'node:fs';
export function engine(){
 let source=readFileSync(new URL('../../src/scorebook.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function mountScorebook','function mountScorebook');
 source=source.slice(0,source.indexOf('attachEvents();render();'))+`return {freshGame,newPitchSession,commitPlay,runPitch,st,ps,saveAdvanced,undo,redo,defaultMoves,setGame(x){db.games=[x];db.activeId=x.id;currentRecorder={gameId:x.id,name:'合成測試員'};},setAdvanced(id){advancedEventId=id;},get db(){return db;}};}`;
 source=source.replace('function render(){','function render(){return;');
 const fields={};const document={addEventListener(){},querySelectorAll(){return [];},getElementById:id=>fields[id]||null};
 const factory=new Function('planning','quick','document','window','confirm',source+';return mountScorebook;')(planning,quick,document,{alert:message=>{throw Error(message);}},()=>{throw Error('Unexpected blocking confirm');});
 const api=factory({initialDb:{games:[],clubRoster:[],settings:{scale:1}},onSave:async db=>structuredClone(db),onRecorder:async()=>{},onGuard:async()=>true,onError:error=>{throw error;},securityPanel:()=>''});
 const game=api.freshGame('away','合成對手','2026-11-15');api.setGame(game);
 function commit(type,entry=quick.quickPlan(api.db.games[0],type)){const current=api.db.games[0],validated=quick.validateQuickEntry(current,type,entry);api.commitPlay(type,{...validated,validated:true,quick:true});return current;}
 return {api,fields,game,commit};
}
