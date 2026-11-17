// Owner-run bootstrap. No passwords in arguments, files, environment variables or logs.
import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import {createInterface} from 'node:readline/promises';import {mkdir,writeFile} from 'node:fs/promises';
import {setupProject} from './firebase-setup-core.mjs';import {EXPECTED_PROJECT} from '../src/login-config.mjs';
const require=createRequire(import.meta.url),auth=require('firebase-tools/lib/auth'),api=require('firebase-tools/lib/apiv2'),{requireAuth}=require('firebase-tools/lib/requireAuth');
const command=args=>{const r=spawnSync(process.execPath,[require.resolve('firebase-tools/lib/bin/firebase.js'),...args],{stdio:'inherit'});if(r.status!==0)throw Error('Firebase 指令未完成；停止後續設定');};
async function question(text){if(!process.stdin.isTTY)throw Error('請由擁有者在私人互動終端執行；不要將密碼放進命令列');const r=createInterface({input:process.stdin,output:process.stdout});try{return(await r.question(text)).trim();}finally{r.close();}}
async function secret(text){if(!process.stdin.isTTY)throw Error('密碼只接受擁有者在私人終端輸入');process.stdout.write(text);process.stdin.setRawMode(true);process.stdin.resume();let value='';try{return await new Promise((resolve,reject)=>{const read=data=>{for(const ch of data.toString()){if(ch==='\u0003'){process.stdin.off('data',read);reject(Error('已取消'));return;}if(ch==='\r'||ch==='\n'){process.stdin.off('data',read);resolve(value);return;}if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else value+=ch;}};process.stdin.on('data',read);});}finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');value='';}}
try{
 if(!process.argv.includes('--apply')){console.log('未修改遠端。擁有者確認天睿專案後執行 npm run setup:firebase -- --apply。');process.exit(0);}
 let account=auth.getProjectDefaultAccount(process.cwd());if(!account){command(['login']);account=auth.getProjectDefaultAccount(process.cwd());}if(!account)throw Error('尚無 Firebase 擁有者授權');
 await requireAuth({project:EXPECTED_PROJECT,user:account.user,tokens:account.tokens,nonInteractive:true});
 const allowed=new Set(['firebase.googleapis.com','identitytoolkit.googleapis.com','firestore.googleapis.com','cloudbilling.googleapis.com','serviceusage.googleapis.com']);
 const request=async(method,url,body)=>{const u=new URL(url);if(u.protocol!=='https:'||!allowed.has(u.hostname))throw Error('拒絕未核准的設定端點');const token=await api.getAccessToken();const response=await fetch(u,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok){const error=new Error(`Firebase 設定請求未完成（HTTP ${response.status}）；未輸出請求內容或憑證`);error.status=response.status;error.reason=data.error?.details?.find(d=>d.reason)?.reason;throw error;}return data;};
 const adminEmail=await question('管理員既有／要建立的 Email（隊友不用記 Email）：');
 const result=await setupProject({request,adminEmail,
  askPassword:async role=>{const label=role==='admin'?'新管理員':'新球隊共用';const a=await secret(label+'密碼（至少 12 字，不顯示）：'),b=await secret('再次輸入：');if(a!==b)throw Error('兩次密碼不同；停止設定');return a;},
  region:async()=>await question('新資料庫區域（建立後不能更改，台灣可填 asia-east1）：'),
  deploy:async()=>command(['deploy','--only','firestore:rules,firestore:indexes','--project',EXPECTED_PROJECT,'--non-interactive']),
  saveConfig:async config=>{await mkdir('.private',{recursive:true,mode:0o700});await writeFile('src/config.mjs','// Public Firebase Web configuration only. No credentials or UIDs.\nexport const cloudConfig = '+JSON.stringify(config,null,2)+';\n');await writeFile('.private/firebase-public-config.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});}
 });
 await writeFile('.private/firebase-setup-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('天睿後端設定完成。請提供產生的 .private/firebase-public-config.json（只有網站公開設定）；不要提供密碼、登入憑證或其他檔案。真實雙裝置與上線驗收仍需完成。');
}catch(e){console.error(e.message);process.exitCode=1;}
