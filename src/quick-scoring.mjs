export const resultCodes=['1B','2B','3B','HR','BB','IBB','HBP','SO','GO','FO','SF','SH','FC','ROE','DP'];
export const defaultConfig={favorites:['1B','2B','HR','BB','SO','GO'],columns:3,visibleCount:6,mode:'quick'};
export function normalizeConfig(value){
 if(value===undefined||value===null)return structuredClone(defaultConfig);
 if(typeof value!=='object'||Array.isArray(value))throw Error('常用記分鍵設定格式不正確');
 const config={...defaultConfig,...value};
 if(!Array.isArray(config.favorites)||config.favorites.some(code=>!resultCodes.includes(code))||![2,3].includes(config.columns)||!Number.isInteger(config.visibleCount)||config.visibleCount<1||config.visibleCount>15||!['quick','detail'].includes(config.mode))throw Error('常用記分鍵設定格式不正確');
 return {...config,favorites:[...new Set(config.favorites)]};
}
export function forcedWalk(bases){
 const map=Object.fromEntries(bases.flatMap((runner,i)=>runner?[[`r${i}`,{dest:String(i+1),er:'pending'}]]:[]));
 map.bat={dest:'1',er:'pending'};
 if(bases[0]){map.r0.dest='2';if(bases[1]){map.r1.dest='3';if(bases[2])map.r2.dest='H';}}
 return map;
}
export function quickPlan(game,type){
 if(!resultCodes.includes(type)||game.finished)return {error:'目前不能記錄這個打席結果'};
 if(['BB','IBB','HBP'].includes(type)){const map=forcedWalk(game.bases);return {automatic:true,map,rbi:Object.values(map).filter(m=>m.dest==='H').length};}
 const occupied=game.bases.some(Boolean),base={'1B':'1','2B':'2','3B':'3',HR:'H',ROE:'1',FC:'1'}[type]||'O';
 if(!occupied&&['1B','2B','3B','HR','SO','GO','FO'].includes(type))return {automatic:true,map:{bat:{dest:base,er:'pending'}},rbi:type==='HR'?1:0};
 if(type==='DP'&&(!occupied||game.outs>=2))return {error:'雙殺需要壘上有跑者且目前少於兩出局，請依實際結果改選滾地出局或野手選擇。'};
 if(['SF','SH'].includes(type)&&(!occupied||game.outs>=2))return {error:'犧牲打需要壘上有人且少於兩出局，請依實際結果改選一般出局。'};
 const map=Object.fromEntries(game.bases.flatMap((runner,i)=>runner?[[`r${i}`,{dest:type==='HR'?'H':'',er:'pending'}]]:[]));map.bat={dest:base,er:'pending'};
 return {automatic:false,map,rbi:type==='HR'?Object.keys(map).length:null};
}
export function validateQuickEntry(game,type,entry){
 if(game.finished)throw Error('比賽已結束');
 const expected=['bat',...game.bases.flatMap((p,i)=>p?['r'+i]:[])],map=structuredClone(entry.map||{});
 if(Object.keys(map).length!==expected.length||expected.some(key=>!map[key]||!['1','2','3','H','O'].includes(map[key].dest)))throw Error('請為每位跑者選擇最後結果');
 let outs=0;const used=new Set();
 for(const [key,move] of Object.entries(map)){
  if(!expected.includes(key)||!['pending','yes','no'].includes(move.er))throw Error('跑者資料格式不正確');
  if(move.dest==='O')outs++;
  if(/^[123]$/.test(move.dest)){if(used.has(move.dest))throw Error('同一壘包不能同時站兩位球員');used.add(move.dest);if(key!=='bat'&&Number(move.dest)<Number(key.slice(1))+1)throw Error('跑者不能往回退壘');}
 }
 if(game.outs+outs>3)throw Error('出局數超過三個，請核對跑者結果');
 if(type==='DP'&&outs!==2)throw Error('雙殺必須記錄兩位球員出局');
 if(['SO','GO','FO','SF','SH'].includes(type)&&map.bat.dest!=='O')throw Error('這個出局結果的打者必須出局；特殊情況請切換詳細模式');
 if(type==='HR'&&Object.values(map).some(m=>m.dest!=='H'))throw Error('全壘打的所有球員應回本壘；爭議情況請用詳細模式');
 let scored=Object.values(map).filter(m=>m.dest==='H').length,cancelledRuns=0;
 if(game.outs+outs===3&&scored){
  const certain=['SO','GO','FO'].includes(type)&&map.bat.dest==='O';
  if(!certain&&!['force','time'].includes(entry.thirdOutRule))throw Error('請確認第三出局是封殺，或得分是否先於非封殺第三出局');
  if(certain||entry.thirdOutRule==='force'){for(const move of Object.values(map))if(move.dest==='H'){move.dest='N';cancelledRuns++;}scored=0;}
 }
 if(['SF','SH'].includes(type)&&game.outs>=2)throw Error('兩出局不能記為犧牲打');
 if(type==='SF'&&(map.bat.dest!=='O'||scored===0))throw Error('高飛犧牲打必須有合法得分；未得分請改選飛球出局');
 const rbi=cancelledRuns||scored===0||type==='DP'?0:entry.rbi;
 if(!Number.isInteger(rbi)||rbi<0||rbi>scored)throw Error('請確認本打席打點（0 到實際得分人數）');
 if(type==='FO'&&scored>0&&rbi>0&&game.outs<2)throw Error('飛球接殺帶有打點，請改選高飛犧牲打；若因失誤或額外跑壘得分，打點應為 0');
 if(['BB','IBB','HBP'].includes(type)){const forced=forcedWalk(game.bases);if(expected.some(key=>map[key].dest!==forced[key].dest))throw Error('保送僅自動處理被迫進壘，額外推進請另外記錄');if(rbi!==Object.values(forced).filter(m=>m.dest==='H').length)throw Error('強迫得分的保送必須計入打點');}
 return {...entry,map,rbi,outs,scored,cancelledRuns};
}
// Native Pointer Events work in iPhone Safari. Only the grip owns the gesture;
// the rest of the row remains a normal scrolling and checkbox target.
export function installFavoriteDrag({document,signal,onDrop,onStart=()=>{}}){
 let drag=null,frame=null;
 const rows=list=>[...list.querySelectorAll('[data-favorite-row]')];
 function finish(commit){if(!drag)return;clearTimeout(drag.timer);cancelAnimationFrame(frame);const state=drag;drag=null;state.row.classList.remove('dragging');state.handle.setAttribute('aria-pressed','false');if(state.active){document.body.classList.remove('sortingFavorites');if(commit)onDrop(rows(state.list).map(row=>row.dataset.favoriteRow));else{for(const code of state.original){const row=rows(state.list).find(r=>r.dataset.favoriteRow===code);if(row)state.list.append(row);}}}try{state.handle.releasePointerCapture(state.id);}catch{}}
 function reorder(){if(!drag?.active)return;const target=document.elementFromPoint(drag.x,drag.y)?.closest('[data-favorite-row]');if(target&&target!==drag.row&&target.parentElement===drag.list){const rect=target.getBoundingClientRect();drag.list.insertBefore(drag.row,drag.y<rect.top+rect.height/2?target:target.nextSibling);try{drag.handle.setPointerCapture(drag.id);}catch{}}}
 function scroll(){if(!drag?.active)return;const rect=drag.list.getBoundingClientRect();if(drag.y<rect.top+40)drag.list.scrollTop-=8;else if(drag.y>rect.bottom-40)drag.list.scrollTop+=8;reorder();frame=requestAnimationFrame(scroll);}
 document.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-drag-favorite]');if(!handle||handle.disabled||event.button>0)return;finish(false);const row=handle.closest('[data-favorite-row]'),list=row.parentElement;drag={handle,row,list,id:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,active:false,original:rows(list).map(row=>row.dataset.favoriteRow)};try{handle.setPointerCapture(event.pointerId);}catch{}drag.timer=setTimeout(()=>{if(!drag)return;drag.active=true;drag.row.classList.add('dragging');handle.setAttribute('aria-pressed','true');document.body.classList.add('sortingFavorites');onStart();frame=requestAnimationFrame(scroll);},300);},{signal});
 document.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;drag.x=event.clientX;drag.y=event.clientY;if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>10){finish(false);return;}if(drag.active){event.preventDefault();reorder();}},{signal,passive:false});
 document.addEventListener('pointerup',event=>{if(drag&&event.pointerId===drag.id)finish(true);},{signal});
 document.addEventListener('pointercancel',()=>finish(false),{signal});signal.addEventListener('abort',()=>finish(false),{once:true});return ()=>finish(false);
}
