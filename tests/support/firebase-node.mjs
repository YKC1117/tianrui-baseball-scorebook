// Use the same pinned Firebase SDK's Node transport in Node tests. The browser
// bundle uses XMLHttpRequest, which Node does not implement. No network mocks.
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='./vendor/firebase.mjs'&&context.parentURL?.endsWith('/src/firebase-gateway.mjs'))return next(new URL('../../src/firebase-sdk-entry.mjs',import.meta.url).href,context);
 return next(specifier,context);
}});
