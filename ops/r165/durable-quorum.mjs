/**
 * R165: durable, cross-process PostgreSQL one-time fence for signed R164 drills.
 * Validates both Ed25519 signatures before touching DB. Never authorizes deploy.
 */
import {verifyR164DualReview} from '../r164/change-quorum.mjs';

const SQL=[
 'INSERT INTO marcosa_private.r165_drill_nonces',
 '(nonce,source_commit,target_digest,scope,synthetic,issued_at,expires_at)',
 "VALUES ($1::text,$2::text,$3::text,'staging-rehearsal-only',true,",
 'to_timestamp($4::numeric/1000),to_timestamp($5::numeric/1000))',
 'ON CONFLICT (nonce) DO NOTHING RETURNING nonce'
].join(' ');
export const R165_CONSUME_NONCE_SQL=SQL;
const failure=s=>{throw Error('R165 durable quorum: '+s);};
export function createR165DurableQuorum({pool,clock=()=>Date.now()}={}){
 if(!pool||typeof pool.connect!=='function'||typeof clock!=='function')
  failure('restricted PostgreSQL pool and clock required');
 return Object.freeze({
  async consume({packet,approvals,pinnedReviewerFingerprints,commit,targetDigest}={}){
   // R164 checks exact packet, 2 distinct pinned Ed25519 keys, signatures,
   // expiry and source. Cryptographic key distinction is NOT human identity.
   const proof=verifyR164DualReview({packet,approvals,pinnedReviewerFingerprints,
    commit,targetDigest,clock});
   if(proof.synthetic!==true||proof.productionAuthorized!==false||
    proof.expiry<=clock()||proof.signatureCount!==2)failure('CI-only signed proof required');
   let client,started=false;
   try{
    client=await pool.connect();
    if(!client||typeof client.query!=='function'||typeof client.release!=='function')
     failure('trusted SQL client unavailable');
    await client.query('BEGIN');started=true;
    await client.query("SET LOCAL statement_timeout='3500ms'");
    await client.query('SET LOCAL ROLE marcosa_r165_nonce_writer');
    const result=await client.query(SQL,[
     packet.nonce,packet.commit,packet.targetDigest,
     packet.issuedAtMs,packet.expiresAtMs
    ]);
    if(result?.rows?.length!==1||result.rows[0]?.nonce!==packet.nonce)
     failure('signed nonce already consumed or rejected');
    await client.query('COMMIT');started=false;
    return Object.freeze({
     rehearsalLeaseRecorded:true,durablePostgresFence:true,
     nonce:packet.nonce,commit,targetDigest,
     expiresAtMs:packet.expiresAtMs,syntheticCi:true,
     independentlyVerifiedHuman:false,productionAuthorized:false
    });
   }catch(e){
    if(client&&started)try{await client.query('ROLLBACK');}catch{}
    if(e?.message?.includes('signed nonce already consumed'))throw e;
    failure('database unavailable or rehearsal denied');
   }finally{if(client)try{client.release();}catch{}}
  }
 });
}
