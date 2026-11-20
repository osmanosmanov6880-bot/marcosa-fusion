import {createHash} from 'node:crypto';
export const H40=/^[a-f0-9]{40}$/,H64=/^[a-f0-9]{64}$/,H32=/^[a-f0-9]{32}$/;
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
export const fail=m=>{throw Error('R190: '+m);};
export const requireTrue=(v,m)=>{if(!v)fail(m);};
export const sha256=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export const keys=x=>Object.keys(x).sort().join(',');
export function sealReceipt(data){
 requireTrue(plain(data)&&!('evidenceSha256' in data)&&data.schemaVersion===1&&
  data.productionAuthorized===false&&data.realPilotAuthorized===false,'receipts must be fail closed');
 return Object.freeze({...data,evidenceSha256:sha256(data)});
}
export function verifyReceipt(r,kind,commit,bundleSha256){
 requireTrue(plain(r)&&r.schemaVersion===1&&r.kind===kind&&
  r.sourceCommit===commit&&r.sourceBundleSha256===bundleSha256&&
  r.productionAuthorized===false&&r.realPilotAuthorized===false&&
  H64.test(r.evidenceSha256||''),'invalid '+kind+' receipt');
 const{evidenceSha256,...raw}=r;
 requireTrue(evidenceSha256===sha256(raw),'tampered '+kind+' receipt');
 return r;
}
