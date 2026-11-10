// Read-only: output paths, object counts and finding categories, never contents.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function inventory(cwd=process.cwd()){
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:20_000_000,stdio:['pipe','pipe','pipe']}).trim();
 const refs=git('for-each-ref','--format=%(objectname) %(refname)','refs/heads','refs/remotes').split('\n').filter(Boolean);
 const objects=git('rev-list','--objects','--all').split('\n').filter(Boolean),sensitive=new Map(),credentialIndicators=[],scanned=new Set();
 for(const item of objects){const [sha,...rest]=item.split(' '),path=rest.join(' ');if(!path)continue;
  if(!scanned.has(sha)&&/\.(?:mjs|js|html|json|md|ya?ml|toml|env)$/i.test(path)&&git('cat-file','-t',sha)==='blob'){
   scanned.add(sha);if(Number(git('cat-file','-s',sha))<=4_000_000){
    const content=git('cat-file','blob',sha);
    for(const [category,pattern] of [['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})\b/],['Supabase secret',/\bsb_secret_[A-Za-z0-9_-]{20,}\b/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]])if(pattern.test(content))credentialIndicators.push({path,blob:sha,category});
   }
  }
  const privatePath=path==='schedule.json'||/\.(?:backup|export)\.json$/i.test(path)||/(?:^|\/)\.env(?:\.|$)/.test(path)&&!path.endsWith('.example');
  if(!privatePath)continue;
  if(git('cat-file','-t',sha)!=='blob')continue;
  const entry=sensitive.get(path)||{path,blobs:[],presentInMain:false,presentInHead:false};entry.blobs.push(sha);sensitive.set(path,entry);
 }
 for(const entry of sensitive.values())for(const [ref,key] of [['HEAD','presentInHead'],['refs/remotes/origin/main','presentInMain']]){
  try{git('cat-file','-e',`${ref}:${entry.path}`);entry[key]=true;}catch{}
 }
 return {format:'TR-PRIVACY-INVENTORY-1',head:git('rev-parse','HEAD'),referenceCount:refs.length,scannedTextBlobCount:scanned.size,credentialIndicators,
  findings:[...sensitive.values()].map(e=>({path:e.path,historicalBlobCount:new Set(e.blobs).size,presentInHead:e.presentInHead,presentInMain:e.presentInMain,commitsTouchingPath:Number(git('rev-list','--all','--count','--',e.path))})),
  scope:'Local reachable Git refs only. Excludes deleted unreachable objects, forks, PR caches, CDN, device copies and GitHub secret-scanning results.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(inventory(),null,2));
