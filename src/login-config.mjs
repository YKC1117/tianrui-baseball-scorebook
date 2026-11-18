export const RECORDER_EMAIL='recorder@tianrui-baseball.invalid';
export const EXPECTED_PROJECT='tianrui-baseball';
export function validatePublicConfig(config,{emulators=false}={}){
 if(config===null)return null;
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Firebase 公開設定格式不正確');
 const allowed=['projectId','apiKey','authDomain','appId','emulators'];
 if(Object.keys(config).some(key=>!allowed.includes(key)))throw Error('公開設定只允許 Firebase Web 公開欄位，不能包含密碼、UID 或其他憑證');
 if(config.emulators){if(!emulators||config.projectId!=='demo-tianrui')throw Error('正式入口禁止使用模擬器設定');return config;}
 if(config.projectId!==EXPECTED_PROJECT||config.authDomain!==`${EXPECTED_PROJECT}.firebaseapp.com`||!/^AIza[\w-]{20,}$/.test(config.apiKey)||!/^1:\d+:web:[\w-]+$/.test(config.appId))throw Error('必須使用天睿 tianrui-baseball 專案的完整公開 Web 設定');
 return config;
}
