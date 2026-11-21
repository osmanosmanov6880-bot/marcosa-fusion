import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../server-lab/server.mjs';
import {backupLocal,restoreLocal,verifyDatabase} from '../local-backup-restore.mjs';
import {createSandboxLedger,registerSandboxOrder,ingestSignedTestEvent} from '../payment-contract/stripe-sandbox-contract.mjs';
import {createOfflineFinance,applyOfflineFinancialEvent} from '../payment-contract/offline-refund-reconciliation.mjs';
import {initCreatorEarnings,attachTestCreatorShare,prepareTestReconciliation,reconcileTestBatch,testBatchReport,creatorTestBalance} from '../payment-contract/creator-earnings-r152.mjs';

test('R152 social story and synthetic creator ledger survive restore; tampered proof is rejected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r152-dr-'));
 const live=join(dir,'live.sqlite'),backup=join(dir,'snapshot.sqlite'),restored=join(dir,'restored.sqlite');
 const inviteCode='r152-dr-local-invite-only',clock=Date.now();
 let app=null,db=null,recovered=null;
 try{
  app=createApp({databasePath:live,inviteCode});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  async function request(path,{cookie='',method='GET',body}={}){
   const response=await fetch(base+'/api'+path,{method,
    headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   return{status:response.status,json:await response.json(),
    cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function member(name){
   const auth={username:name,email:name+'@example.invalid',password:'safe-recovery-password-2026',inviteCode};
   assert.equal((await request('/auth/register',{method:'POST',body:auth})).status,201);
   const login=await request('/auth/login',{method:'POST',body:auth});
   const me=await request('/auth/me',{cookie:login.cookie});
   return{cookie:login.cookie,world:me.json.worlds[0].id};
  }
  const writer=await member('backupauthor152'),reader=await member('backupreader152');
  assert.equal((await request('/series',{cookie:writer.cookie,method:'POST',
   body:{worldId:writer.world,slug:'dr-series-152',title:'Recovery series'}})).status,201);
  const post=await request('/posts',{cookie:writer.cookie,method:'POST',
   body:{worldId:writer.world,body:'Original recovery chapter',status:'published'}});
  assert.equal(post.status,201);
  const episode=await request('/series/dr-series-152/episodes',{cookie:writer.cookie,method:'POST',
   body:{postId:post.json.id,title:'Recovery chapter'}});assert.equal(episode.status,201);
  assert.equal((await request('/series/dr-series-152/subscription',{cookie:reader.cookie,method:'POST',body:{}})).status,200);
  assert.equal((await request('/series/dr-series-152/metrics/attendance',{cookie:reader.cookie,method:'POST',
   body:{episodeId:episode.json.id,consent:true}})).status,200);
  await app.close();app=null;
  db=new DatabaseSync(live);
  createSandboxLedger(db);createOfflineFinance(db);initCreatorEarnings(db);
  const orderId='r76_drcreator001',sessionId='cs_test_drcreator001',currency='usd';
  registerSandboxOrder(db,{orderId,sessionId,amountMinor:8000,currency});
  const event={object:'event',id:'evt_test_drcreator001',livemode:false,type:'checkout.session.completed',
   data:{object:{object:'checkout.session',id:sessionId,client_reference_id:orderId,
    mode:'payment',status:'complete',payment_status:'paid',amount_total:8000,currency}}};
  const rawBody=Buffer.from(JSON.stringify(event)),ts=Math.floor(clock/1000);
  const secret='whsec_r152_dr_fixture_only_2026';
  const signature='t='+ts+',v1='+createHmac('sha256',secret).update(String(ts)+'.').update(rawBody).digest('hex');
  assert.equal(ingestSignedTestEvent(db,{rawBody,signature,secret,now:clock}).result,'paid');
  const share={orderId,creatorId:'creator_test_recovery01',shareBps:3000};
  assert.equal(attachTestCreatorShare(db,share).duplicate,false);
  const batchId='batch_test_drrecovery001',reviewerId='auditor_test_recovery01';
  const proof=prepareTestReconciliation(db,{batchId,creatorId:share.creatorId,currency,makerId:'maker_test_recovery01'});
  assert.equal(proof.availableMinor,2400);
  assert.equal(reconcileTestBatch(db,{batchId,reviewerId,expectedSha256:proof.snapshotSha256}).reconciled,true);
  db.close();db=null;
  assert.equal(verifyDatabase(live).integrity,'ok');
  const copy=await backupLocal({source:live,destination:backup});
  assert.equal(copy.verification.foreignKeyViolations,0);
  assert.equal((await restoreLocal({backup,manifest:backup+'.json',destination:restored})).verification.integrity,'ok');
  recovered=new DatabaseSync(restored);
  createSandboxLedger(recovered);createOfflineFinance(recovered);initCreatorEarnings(recovered);
  assert.equal(recovered.prepare("SELECT count(*) AS n FROM series WHERE slug='dr-series-152'").get().n,1);
  assert.equal(recovered.prepare('SELECT count(*) AS n FROM series_subscriptions').get().n,1);
  assert.equal(recovered.prepare('SELECT count(*) AS n FROM series_attendance').get().n,1);
  assert.equal(recovered.prepare('SELECT count(*) AS n FROM r76_lab_receipts').get().n,1);
  assert.equal(recovered.prepare('SELECT count(*) AS n FROM r152_creator_review_audit').get().n,1);
  assert.equal(attachTestCreatorShare(recovered,share).duplicate,true);
  assert.equal(creatorTestBalance(recovered,{creatorId:share.creatorId,currency}).availableMinor,2400);
  assert.equal(testBatchReport(recovered,batchId).sourceCurrent,true);
  const refund={kind:'refund',eventId:'evt_r86_drrefund001',orderId,referenceId:'re_test_drrefund001',amountMinor:1000,currency};
  assert.equal(applyOfflineFinancialEvent(recovered,refund).duplicate,false);
  assert.equal(applyOfflineFinancialEvent(recovered,refund).duplicate,true);
  assert.equal(testBatchReport(recovered,batchId).sourceCurrent,false);
  assert.deepEqual(recovered.prepare('PRAGMA foreign_key_check').all(),[]);
  recovered.close();recovered=null;
  const manifest=JSON.parse(readFileSync(backup+'.json','utf8'));
  const corrupted=join(dir,'corrupt.json');
  writeFileSync(corrupted,JSON.stringify({...manifest,sha256:'f'.repeat(64)}));
  await assert.rejects(()=>restoreLocal({backup,manifest:corrupted,
   destination:join(dir,'untrusted.sqlite')}),/SHA-256 mismatch/);
  await assert.rejects(()=>restoreLocal({backup,manifest:backup+'.json',destination:restored}),/already exists/);
 }finally{
  if(db)db.close();
  if(recovered)recovered.close();
  if(app)await app.close().catch(()=>{});
  rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
