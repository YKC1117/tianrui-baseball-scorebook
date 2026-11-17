const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
export async function sealArchive(payload){const data=JSON.stringify(payload);return JSON.stringify({format:'TR-FIREBASE-ARCHIVE-1',sha256:await digest(data),payload});}
export async function decodeArchive(raw){
 const value=JSON.parse(raw);
 if(value.format!=='TR-FIREBASE-ARCHIVE-1')return raw;
 const data=JSON.stringify(value.payload);
 if(await digest(data)!==value.sha256)throw Error('備份完整性檢查失敗，沒有匯入任何資料。');
 return data;
}
