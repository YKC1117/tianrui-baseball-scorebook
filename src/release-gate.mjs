import {validatePublicConfig} from './login-config.mjs';
export function assertProductionReady(config,acceptance){
 validatePublicConfig(config);if(!config)throw Error('正式部署被阻擋：天睿 Firebase 公開設定尚未完成');
 if(acceptance?.projectId!=='tianrui-baseball'||!['realAuth','twoDevices','privacyReviewed','hardware'].every(k=>acceptance.checks?.[k]===true))throw Error('正式部署被阻擋：真實 Firebase、雙裝置及隱私驗收尚未完成');
 return true;
}
