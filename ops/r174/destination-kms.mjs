/**
 * R174 read-only destination KMS key-policy and grants attestation.
 * Requires an independently pinned exact policy digest and checks that key
 * management permissions have NOT widened. KMS policy hashes are NOT a
 * substitute for AWS Organizations SCP or actual effective authorization.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const KEY=/^arn:aws:kms:([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):key\/[a-f0-9-]{36}$/;
const H64=/^[a-f0-9]{64}$/;
const fail=m=>{throw Error('R174 destination KMS policy: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export function r174PolicyHash(policy){
 const bytes=Buffer.from(JSON.stringify(canonical(policy)));
 return createHash('sha256').update(bytes).digest('hex');
}
function policyDoc(raw){
 let doc=raw;
 if(typeof doc==='string'){
  ok(doc.length>0&&doc.length<=30000,'bounded AWS policy required');
  try{doc=JSON.parse(doc);}
  catch{try{doc=JSON.parse(decodeURIComponent(raw));}
   catch{fail('malformed AWS IAM policy');}}
 }
 ok(doc&&Object.getPrototypeOf(doc)===Object.prototype&&
  doc.Version==='2012-10-17'&&Array.isArray(doc.Statement)&&
  doc.Statement.length>=2&&doc.Statement.length<=15,
  'versioned policy statements required');
 return doc;
}
const actions=x=>typeof x==='string'?[x]:Array.isArray(x)?x:[];
export function r174InspectKmsPolicyDocument(raw,approvedRoleArn){
 const doc=policyDoc(raw);
 ok(/^arn:aws:iam::[0-9]{12}:role\/marcosa-staging-backup-role$/
  .test(approvedRoleArn||''),'only reviewed staging role can decrypt');
 let decrypt=false,denyDelete=false;
 for(const s of doc.Statement){
  ok(s&&typeof s==='object'&&
   ['Allow','Deny'].includes(s.Effect)&&s.Resource==='*'&&
   actions(s.Action).length>=1&&actions(s.Action).length<=20,
   'unbounded KMS key statement');
  const ops=actions(s.Action);
  ok(ops.every(x=>typeof x==='string'&&/^kms:[A-Za-z*]+$/.test(x)),
   'invalid KMS policy action');
  if(s.Effect==='Allow'){
   ok(!ops.some(x=>x==='kms:*'||x==='kms:ScheduleKeyDeletion'||
    x==='kms:DisableKey'||x==='kms:PutKeyPolicy'||x==='kms:CreateGrant'),
    'dangerous KMS administrative permission granted');
   ok(s.Principal&&Object.getPrototypeOf(s.Principal)===Object.prototype&&
    s.Principal.AWS===approvedRoleArn,
    'wildcard, root or third-party KMS allow principal');
   const condition=s.Condition?.StringEquals;
   ok(condition&&condition['kms:EncryptionContext:marcosa-scope']===
    'isolated-staging-only','KMS cryptographic isolation context absent');
   if(ops.includes('kms:Decrypt'))decrypt=true;
  }else if(ops.includes('kms:ScheduleKeyDeletion')&&
   ops.includes('kms:DisableKey')){
   ok(s.Principal==='*','deny key destruction must apply to everyone');
   denyDelete=true;
  }
 }
 ok(decrypt&&denyDelete,'staging decrypt + universal key destruction deny required');
 return Object.freeze({policySha256:r174PolicyHash(doc),
  decryptScoped:true,globalDestructionDenied:true});
}
export function createR174DestinationKmsAudit({
 client,commands,keyArn,accountId,region,approvedRoleArn,
 approvedPolicySha256,clock=()=>Date.now(),allowExternalCalls=false
}={}){
 const parsed=KEY.exec(keyArn||'');
 ok(parsed&&parsed[1]===region&&parsed[2]===accountId&&
  approvedRoleArn==='arn:aws:iam::'+accountId+
   ':role/marcosa-staging-backup-role'&&
  H64.test(approvedPolicySha256||'')&&
  client&&typeof client.send==='function'&&
  commands&&['DescribeKeyCommand','GetKeyPolicyCommand',
   'GetKeyRotationStatusCommand','ListGrantsCommand'].every(
    x=>typeof commands[x]==='function')&&typeof clock==='function',
  'independent destination KMS ARN, trusted policy pin and AWS SDK required');
 async function call(type,params){
  ok(allowExternalCalls===true,'KMS provider disabled without staging approval');
  try{
   return await client.send(new commands[type+'Command'](params),{
    abortSignal:AbortSignal.timeout(8500)
   });
  }catch{fail('KMS read-only API denied: '+type);}
 }
 async function inspect(){
  ok(allowExternalCalls===true,'destination KMS provider disabled');
  const [metadata,policy,rotation,grants]=await Promise.all([
   call('DescribeKey',{KeyId:keyArn}),
   call('GetKeyPolicy',{KeyId:keyArn,PolicyName:'default'}),
   call('GetKeyRotationStatus',{KeyId:keyArn}),
   call('ListGrants',{KeyId:keyArn,Limit:100})
  ]);
  const key=metadata?.KeyMetadata;
  ok(key&&key.Arn===keyArn&&key.AWSAccountId===accountId&&
   key.KeyState==='Enabled'&&key.Enabled===true&&
   key.KeyManager==='CUSTOMER'&&key.Origin==='AWS_KMS'&&
   key.KeyUsage==='ENCRYPT_DECRYPT'&&key.KeySpec==='SYMMETRIC_DEFAULT'&&
   key.MultiRegion===false&&key.DeletionDate===undefined,
   'KMS key identity, cryptographic properties or lifecycle unsafe');
  ok(rotation?.KeyRotationEnabled===true,
   'destination KMS automatic rotation must be enabled');
  ok(grants&&Array.isArray(grants.Grants)&&grants.Grants.length===0&&
   !grants.Truncated&&!grants.NextMarker,
   'unexpected third-party KMS grants or incomplete pagination');
  const assertion=r174InspectKmsPolicyDocument(policy?.Policy,approvedRoleArn);
  ok(H64.test(assertion.policySha256)&&
   timingSafeEqual(Buffer.from(assertion.policySha256,'hex'),
    Buffer.from(approvedPolicySha256,'hex')),
   'destination key policy diverged from independently pinned source');
  const now=clock();
  ok(Number.isSafeInteger(now)&&now>0,'trusted inspection time required');
  return Object.freeze({
   checked:true,keyArn,accountId,region,approvedRoleArn,
   policySha256:assertion.policySha256,
   noUnexpectedGrants:true,rotationEnabled:true,
   keyNotPendingDeletion:true,exactPinnedKeyPolicy:true,
   checkedAtMs:now,expiresAtMs:now+60000,
   awsOrganizationsScpIndependentlyVerified:false,
   realAwsAccountUsed:false,productionAuthorized:false
  });
 }
 return Object.freeze({inspect,publicStatus:()=>Object.freeze({
  readOnly:true,networkEnabled:allowExternalCalls,
  productionAuthorized:false
 })});
}
