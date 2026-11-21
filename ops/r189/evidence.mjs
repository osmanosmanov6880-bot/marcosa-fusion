import {createHash} from 'node:crypto';
export const H40=/^[a-f0-9]{40}$/;
export const H64=/^[a-f0-9]{64}$/;
export const fail=m=>{throw Error('R189 evidence: '+m)};
export const requireTrue=(condition,m)=>{if(!condition)fail(m)};
export const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
export function receipt(x,kind,commit,bundleSha256){
 requireTrue(plain(x)&&x.kind===kind&&x.schemaVersion===1&&
 x.sourceCommit===commit&&x.sourceBundleSha256===bundleSha256&&
 x.productionAuthorized===false&&x.realPilotAuthorized===false&&
 H64.test(x.evidenceSha256||''),'invalid '+kind+' source-bound receipt');
 const {evidenceSha256,...rest}=x;
 requireTrue(sha(rest)===evidenceSha256,'tampered '+kind+' receipt');
 return x;
}
export function seal(x){requireTrue(plain(x)&&!('evidenceSha256' in x),'plain unsealed document required');return Object.freeze({...x,evidenceSha256:sha(x)});}
