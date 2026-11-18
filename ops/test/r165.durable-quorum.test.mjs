import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createR164DrillChallenge,r164CanonicalChallengeBytes,
 r164ReviewerFingerprint} from '../r164/change-quorum.mjs';
import {createR165DurableQuorum,R165_CONSUME_NONCE_SQL} from '../r165/durable-quorum.mjs';
const at=1800000000000,commit='a'.repeat(40),targetDigest='b'.repeat(64);
function signed(){
 const keys=['operator','independent-reviewer'].map(role=>{
  const k=generateKeyPairSync('ed25519');
  return{role,privateKey:k.privateKey,publicKeyPem:k.publicKey.export({
   format:'pem',type:'spki'})};
 });
 const packet=createR164DrillChallenge({commit,targetDigest,clock:()=>at,
  nonce:'c'.repeat(32)});
 const approvals=keys.map(k=>({role:k.role,publicKeyPem:k.publicKeyPem,
  signature:sign(null,r164CanonicalChallengeBytes(packet),k.privateKey)
   .toString('base64url')}));
 const pinnedReviewerFingerprints=Object.fromEntries(keys.map(k=>[
  k.role,r164ReviewerFingerprint(k.publicKeyPem)]));
 return{packet,approvals,pinnedReviewerFingerprints,commit,targetDigest};
}
function database(){
 const used=new Set();let commits=0,rollbacks=0,releases=0,statements=[];
 return{
  pool:{connect:async()=>({async query(sql,params=[]){
   statements.push({sql,params});
   if(sql===R165_CONSUME_NONCE_SQL){
    await Promise.resolve();
    if(used.has(params[0]))return{rows:[]};
    used.add(params[0]);return{rows:[{nonce:params[0]}]};
   }
   if(sql==='COMMIT')commits++;
   if(sql==='ROLLBACK')rollbacks++;
   return{rows:[]};
  },release(){releases++;}})},
  metrics:()=>({commits,rollbacks,releases,statements})
 };
}
test('R165 signed Ed25519 two-key nonce consumed once across TWO worker instances',async()=>{
 const db=database(),proof=signed(),a=createR165DurableQuorum({pool:db.pool,clock:()=>at}),
  b=createR165DurableQuorum({pool:db.pool,clock:()=>at});
 const outcomes=await Promise.allSettled([a.consume(proof),b.consume(proof)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 assert.equal(db.metrics().commits,1);
 assert.equal(db.metrics().rollbacks,1);
 assert.equal(db.metrics().releases,2);
 assert.equal(outcomes.find(x=>x.status==='fulfilled').value.productionAuthorized,false);
});
test('R165 tampered, stale or real-staging challenge rejected before PostgreSQL',async()=>{
 const db=database(),proof=signed(),q=createR165DurableQuorum({pool:db.pool,clock:()=>at});
 const variants=[
  {...proof,commit:'0'.repeat(40)},
  {...proof,approvals:[proof.approvals[0],proof.approvals[0]]},
  {...proof,packet:{...proof.packet,synthetic:false}},
  {...proof,packet:{...proof.packet,expiresAtMs:at-1}}
 ];
 for(const data of variants)await assert.rejects(q.consume(data),/R164 quorum|R165/);
 assert.equal(db.metrics().statements.length,0);
});
