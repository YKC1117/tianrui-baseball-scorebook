// Isolated static server: emulator configuration never enters src/config.mjs.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=process.cwd();
createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path==='/src/config.mjs'){
   res.setHeader('Content-Type','text/javascript');res.end(`export const cloudConfig={projectId:'demo-tianrui',apiKey:'emulator-only-key',authDomain:'demo-tianrui.firebaseapp.com',emulators:true};`);return;
  }
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
}).listen(4175,'127.0.0.1');
