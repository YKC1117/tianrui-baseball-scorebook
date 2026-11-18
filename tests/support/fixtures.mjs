export const fixtureRoster=(count=20)=>Array.from({length:count},(_,i)=>({id:'p'+i,name:'測試球員'+i,num:i<2?'':String(i+1)}));
export function fixtureGame(id='fixture_game'){
 const roster=fixtureRoster(9),team=()=>({name:'測試隊',roster:structuredClone(roster),lineup:roster.map(p=>p.id),pitcher:'p0',defense:{P:'p0'},stats:{},pitchStats:{},next:0,errors:0});
 return{id,date:'2000-01-01',side:'away',away:team(),home:team(),inning:1,half:'top',outs:0,balls:0,strikes:0,bases:[null,null,null],score:{away:[0,...Array(8).fill(null)],home:Array(9).fill(null)},events:[],createdAt:1,finished:false};
}
