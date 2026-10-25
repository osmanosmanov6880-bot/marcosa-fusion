import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSandboxLedger,registerSandboxOrder,ingestSignedTestEvent} from './stripe-sandbox-contract.mjs';
import {createOfflineFinance,applyOfflineFinancialEvent,offlineFinanceReport,FINANCE_LAB} from './offline-refund-reconciliation.mjs';

const clock=Date.parse('2026-10-25T12:00:00Z'),secret='whsec_r86_offline_test_only_2026';
const evt=(kind,eventId,referenceId,amountMinor=100,currency='usd',orderId='r76_order0001')=>
 ({kind,eventId,orderId,referenceId,amountMinor,currency});
function markPaid(db,{orderId='r76_order0001',sessionId='cs_test_r86checkout001',amount=1399,currency='usd',eventId='evt_test_r86payment001'}={}){
 registerSandboxOrder(db,{orderId,sessionId,amountMinor:amount,currency});
 const event={object:'event',id:eventId,type:'checkout.session.completed',
  livemode:false,data:{object:{object:'checkout.session',id:sessionId,
   client_reference_id:orderId,mode:'payment',status:'complete',
   payment_status:'paid',amount_total:amount,currency}}};
 const rawBody=Buffer.from(JSON.stringify(event));
 const ts=Math.floor(clock/1000);
 const signature='t='+ts+',v1='+createHmac('sha256',secret).update(String(ts)+'.').update(rawBody).digest('hex');
 assert.equal(ingestSignedTestEvent(db,{rawBody,signature,secret,now:clock}).result,'paid');
}
const init=db=>{createSandboxLedger(db);createOfflineFinance(db);};

test('R86: offline refund must follow an actually signed and paid R76 test receipt',()=>{
 const db=new DatabaseSync(':memory:');init(db);
 try{
  registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_test_r86checkout001',amountMinor:1399,currency:'usd'});
  const refund=evt('refund','evt_r86_refund0001','re_test_refund0001',300);
  assert.throws(()=>applyOfflineFinancialEvent(db,refund,{now:clock}),/verified R76 TEST receipt/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r86_lab_events').get().n,0);
  assert.throws(()=>applyOfflineFinancialEvent(db,{...refund,orderId:'r76_bad'}, {now:clock}),/verified/);
  assert.throws(()=>applyOfflineFinancialEvent(db,{...refund,currency:'eur'},{now:clock}),/verified/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});

test('R86: two partial refunds, immutable IDs, active chargeback, loss and no negative test balance',()=>{
 const db=new DatabaseSync(':memory:');init(db);
 try{
  markPaid(db);
  const refund=evt('refund','evt_r86_refund0001','re_test_refund0001',200);
  let x=applyOfflineFinancialEvent(db,refund,{now:clock});
  assert.deepEqual(x,{duplicate:false,result:'refund_recorded',simulated:true,production:false});
  x=applyOfflineFinancialEvent(db,refund,{now:clock});
  assert.equal(x.duplicate,true);
  assert.throws(()=>applyOfflineFinancialEvent(db,{...refund,amountMinor:201},{now:clock}),/altered immutable/);
  assert.throws(()=>applyOfflineFinancialEvent(db,{...refund,eventId:'evt_r86_refund0002'},{now:clock}),/Refund reference was previously/);
  assert.throws(()=>applyOfflineFinancialEvent(db,{...refund,eventId:'evt_r86_refund0003',referenceId:'re_test_refund0003',amountMinor:1500},{now:clock}),/exceeds original/);
  const second=evt('refund','evt_r86_refund0004','re_test_refund0004',300);
  assert.equal(applyOfflineFinancialEvent(db,second,{now:clock}).result,'refund_recorded');
  assert.throws(()=>applyOfflineFinancialEvent(db,{...second,eventId:'evt_r86_refund0005',referenceId:'re_test_refund0005',currency:'eur'},{now:clock}),/Currency differs/);
  const dispute=evt('dispute_open','evt_r86_dispute0001','dp_test_chargeback001',600);
  assert.equal(applyOfflineFinancialEvent(db,dispute,{now:clock}).result,'dispute_opened');
  assert.throws(()=>applyOfflineFinancialEvent(db,{...second,eventId:'evt_r86_refund0006',referenceId:'re_test_refund0006'},{now:clock}),/while a test dispute is open|unresolved dispute/);
  let report=offlineFinanceReport(db);
  assert.equal(report.contract,FINANCE_LAB);
  assert.equal(report.production,false);
  assert.equal(report.actualNetRevenue,null);
  assert.equal(report.commercialLaunchAuthorized,false);
  assert.deepEqual(report.testOnlyCurrencies,[{currency:'usd',
   simulatedGrossMinor:1399,simulatedRefundedMinor:500,
   simulatedLostDisputesMinor:0,simulatedOpenDisputeReserveMinor:600,
   simulatedNetAfterLossMinor:899,simulatedAvailableAfterReserveMinor:299}]);
  const loss=evt('dispute_lost','evt_r86_dispute0002','dp_test_chargeback001',600);
  assert.equal(applyOfflineFinancialEvent(db,loss,{now:clock}).result,'dispute_lost');
  assert.equal(applyOfflineFinancialEvent(db,loss,{now:clock}).duplicate,true);
  assert.throws(()=>applyOfflineFinancialEvent(db,{...loss,eventId:'evt_r86_dispute0003',kind:'dispute_won'},{now:clock}),/Only an existing open dispute/);
  assert.throws(()=>applyOfflineFinancialEvent(db,evt('refund','evt_r86_refund0007','re_test_refund0007',300),{now:clock}),/would double-credit/);
  assert.equal(applyOfflineFinancialEvent(db,evt('refund','evt_r86_refund0008','re_test_refund0008',299),{now:clock}).result,'refund_recorded');
  report=offlineFinanceReport(db);
  assert.equal(report.testOnlyCurrencies[0].simulatedAvailableAfterReserveMinor,0);
  assert.equal(report.testOnlyCurrencies[0].simulatedNetAfterLossMinor,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r86_lab_events').get().n,6);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});

test('R86: won chargeback preserves synthetic net balance; currency never converted',()=>{
 const db=new DatabaseSync(':memory:');init(db);
 try{
  markPaid(db);
  markPaid(db,{orderId:'r76_order0002',sessionId:'cs_test_r86checkout002',amount:2200,currency:'eur',eventId:'evt_test_r86payment002'});
  const opened=evt('dispute_open','evt_r86_case0001','dp_test_case000001',1000);
  const won=evt('dispute_won','evt_r86_case0002','dp_test_case000001',1000);
  assert.equal(applyOfflineFinancialEvent(db,opened,{now:clock}).result,'dispute_opened');
  assert.throws(()=>applyOfflineFinancialEvent(db,evt('dispute_lost','evt_r86_case0003','dp_test_case000001',999),{now:clock}),/Case amount/);
  assert.equal(applyOfflineFinancialEvent(db,won,{now:clock}).result,'dispute_won');
  assert.throws(()=>applyOfflineFinancialEvent(db,evt('dispute_open','evt_r86_case0004','dp_test_another001',300),{now:clock}),/one immutable test dispute/);
  const rep=offlineFinanceReport(db);
  assert.deepEqual(rep.testOnlyCurrencies.map(x=>x.currency),['eur','usd']);
  assert.equal(rep.testOnlyCurrencies[1].simulatedNetAfterLossMinor,1399);
  assert.equal(rep.testOnlyCurrencies[0].simulatedNetAfterLossMinor,2200);
  assert.equal(rep.actualGrossRevenue,null);
  assert.equal(rep.realCustomerCount,null);
 }finally{db.close();}
});

test('R86: persistent SQLite ledger survives restart without double-applying identical synthetic IDs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'marcosa-r86-')),file=join(dir,'payments.sqlite');
 let db=null;
 try{
  db=new DatabaseSync(file);init(db);markPaid(db);
  const ref=evt('refund','evt_r86_persist0001','re_test_persist0001',250);
  assert.equal(applyOfflineFinancialEvent(db,ref,{now:clock}).result,'refund_recorded');
  db.close();db=null;
  db=new DatabaseSync(file);init(db);
  assert.equal(applyOfflineFinancialEvent(db,ref,{now:clock}).duplicate,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM r86_lab_refunds').get().n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{if(db)db.close();rmSync(dir,{recursive:true,force:true});}
});
