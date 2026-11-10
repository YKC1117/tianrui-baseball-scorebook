import {build} from 'esbuild';
await build({entryPoints:['src/firebase-sdk-entry.mjs'],outfile:'src/vendor/firebase.mjs',bundle:true,format:'esm',target:['safari15','chrome100'],minify:true,legalComments:'linked'});
