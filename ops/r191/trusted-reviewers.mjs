/** Three cryptographic role signatures versus separate operator-pinned registry digest.
 * Keys and accounts are not independent proof of a person's identity. */
import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyR190ReviewSignatures} from '../r190/human-signatures.mjs';
import {H40,H64,plain,keys,requireTrue,sealReceipt,verifyReceipt} from '../r190/common.mjs';
const ROLES=['SECURITY','OPERATIONS','PRIVACY'];
const digest=x=>createHash('sha256').update(x).digest('hex');
export function verifyR191PinnedReviewers({
 registryBytes,expectedRegistrySha256,github,packet,signatures,
 bundleSha256,commit,revokedFingerprints=[],clock=()=>Date.now()
}={}){
 requireTrue(H40.test(commit||'')&&H64.test(bundleSha256||'')&&
  Buffer.isBuffer(registryBytes)&&registryBytes.length>=500&&
  registryBytes.length<=12000&&H64.test(expectedRegistrySha256||''),
  'externally pinned bounded reviewer registry required');
 const actual=digest(registryBytes);
 requireTrue(timingSafeEqual(Buffer.from(actual,'hex'),
  Buffer.from(expectedRegistrySha256,'hex')),
  'registry content differs from external operator pin');
 let doc;
 try{doc=JSON.parse(registryBytes.toString('utf8'));}
 catch{throw Error('R191: invalid trusted registry JSON');}
 requireTrue(plain(doc)&&keys(doc)==='expiresAtMs,issuedAtMs,pullRequest,repository,reviewers,schemaVersion,sourceCommit'&&
  registryBytes.equals(Buffer.from(JSON.stringify(doc)+'\n'))&&
  doc.schemaVersion===1&&doc.repository==='osmanosmanov6880-bot/marcosa-fusion'&&
  doc.pullRequest===168&&doc.sourceCommit===commit&&
  Number.isSafeInteger(doc.issuedAtMs)&&Number.isSafeInteger(doc.expiresAtMs)&&
  doc.expiresAtMs>doc.issuedAtMs&&doc.expiresAtMs-doc.issuedAtMs<=86400000&&
  Array.isArray(doc.reviewers)&&doc.reviewers.length===3,
  'canonical short-lived registry source invalid');
 const at=clock();
 requireTrue(Number.isSafeInteger(at)&&at>=doc.issuedAtMs&&at<=doc.expiresAtMs,
  'trusted reviewer registry expired or future');
 const g=verifyReceipt(github,'R191_PR',commit,bundleSha256);
 requireTrue(g.reviewPagesComplete===true&&
  Array.isArray(g.reviewChecks)&&g.reviewChecks.length===3,
  'source-bound complete GitHub chronology required');
 const registry={},ids=new Set(),logins=new Set();
 for(let i=0;i<3;i++){
  const row=doc.reviewers[i];
  requireTrue(plain(row)&&keys(row)==='githubLogin,githubUserId,keyFingerprintSha256,publicKeySpkiBase64,role,signerId'&&
   row.role===ROLES[i]&&
   typeof row.githubLogin==='string'&&
   /^[A-Za-z0-9-]{1,39}$/.test(row.githubLogin)&&
   Number.isSafeInteger(row.githubUserId)&&row.githubUserId>0&&
   !ids.has(row.githubUserId)&&
   !logins.has(row.githubLogin.toLowerCase())&&
   g.reviewChecks[i].role===row.role&&
   g.reviewChecks[i].githubUserId===row.githubUserId,
   'role or GitHub numeric account differs from trust registry');
  ids.add(row.githubUserId);logins.add(row.githubLogin.toLowerCase());
  registry[row.role]={signerId:row.signerId,
   keyFingerprintSha256:row.keyFingerprintSha256,
   publicKeySpkiBase64:row.publicKeySpkiBase64};
 }
 requireTrue(packet?.sourceCommit===commit&&
  packet.bundleSha256===bundleSha256&&
  packet.githubEvidenceSha256===g.evidenceSha256&&
  H64.test(packet.tlsEvidenceSha256||''),
  'signed review challenge is not bound to exact source and GitHub review history');
 const verified=verifyR190ReviewSignatures({
  packet,signatures,registry,revokedFingerprints,clock
 });
 requireTrue(verified.cryptographicSignaturesVerified===3,
  'all three distinct Ed25519 keys required');
 return sealReceipt({schemaVersion:1,kind:'R191_IDENTITIES',
  sourceCommit:commit,sourceBundleSha256:bundleSha256,
  sourceMode:g.sourceMode,
  githubEvidenceSha256:g.evidenceSha256,
  registrySha256:actual,signaturesReceiptSha256:verified.evidenceSha256,
  tlsEvidenceSha256:packet.tlsEvidenceSha256,
  verifiedCryptographicKeys:3,verifiedGithubRoleBindings:3,
  externallyPinnedRegistryHashMatched:true,
  registryOwnershipIndependentlyAudited:false,
  naturalHumanIdentitiesIndependentlyEstablished:false,
  observedAtMs:at,expiresAtMs:Math.min(packet.expiresAtMs,doc.expiresAtMs),
  decision:'NO_GO_INDEPENDENT_HUMAN_IDENTITY_CONFIRMATION_PENDING',
  realPilotAuthorized:false,productionAuthorized:false});
}
