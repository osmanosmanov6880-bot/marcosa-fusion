import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createSandboxLedger,registerSandboxOrder,ingestSignedTestEvent,
 verifySignedTestEvent,sandboxCommercialStatus,CONTRACT_VERSION} from './stripe-sandbox-contract.mjs';

const secret='whsec_stripe_offline_lab_test_only_2026';
const clock=Date.parse('2026-10-25T13:00:00.000Z'),ts=Math.floor(clock/1000);
const base={id:'evt_test_0001',object:'event',livemode:false,type:'checkout.session.completed',
 data:{object:{object:'checkout.session',id:'cs_test_checkout0001',mode:'payment',
 status:'complete',payment_status:'paid',amount_total:1399,currency:'usd',
 client_reference_id:'r76_order0001'}}};
function raw(event=base){return Buffer.from(JSON.stringify(event),'utf8');}
function signed(data=raw(),secretForSig=secret,t=ts){
 return 't='+t+',v1='+createHmac('sha256',secretForSig).update(String(t)+'.').update(data).digest('hex');
}
function run(db,event=base,options={}){
 const body=raw(event);
 return ingestSignedTestEvent(db,{rawBody:body,signature:signed(body),secret,now:clock,...options});
}
const open=()=>{const db=new DatabaseSync(':memory:');createSandboxLedger(db);return db;};

test('R76 exact raw-byte HMAC, timestamp, unknown and malformed events must fail closed',()=>{
 const body=raw();
 assert.equal(verifySignedTestEvent({rawBody:body,signature:signed(body),secret,now:clock}).id,base.id);
 const altered=Buffer.from(JSON.stringify(base,null,2));
 assert.throws(()=>verifySignedTestEvent({rawBody:altered,signature:signed(body),secret,now:clock}),/signature mismatch/);
 assert.throws(()=>verifySignedTestEvent({rawBody:body,signature:signed(body,'whsec_not_this_endpoint_123456789'),secret,now:clock}),/signature mismatch/);
 assert.throws(()=>verifySignedTestEvent({rawBody:body,signature:signed(body,secret,ts-301),secret,now:clock}),/outside five-minute/);
 assert.throws(()=>verifySignedTestEvent({rawBody:body,signature:signed(body,secret,ts+301),secret,now:clock}),/outside five-minute/);
 assert.throws(()=>verifySignedTestEvent({rawBody:body,signature:signed(body).replace(/v1=[a-f0-9]{64}/,'v1=NOTREAL'),secret,now:clock}),/signature mismatch/);
 assert.throws(()=>verifySignedTestEvent({rawBody:body,signature:'t='+ts+',t='+ts+',v1='+('0'.repeat(64)),secret,now:clock}),/ambiguous/);
 assert.throws(()=>verifySignedTestEvent({rawBody:Buffer.alloc(140000),signature:signed(body),secret,now:clock}),/bounded raw Buffer/);
 const live={...base,livemode:true};
 assert.throws(()=>verifySignedTestEvent({rawBody:raw(live),signature:signed(raw(live)),secret,now:clock}),/Live Stripe/);
 const unknown={...base,type:'invoice.paid'};
 assert.throws(()=>verifySignedTestEvent({rawBody:raw(unknown),signature:signed(raw(unknown)),secret,now:clock}),/Unsupported event/);
 assert.throws(()=>verifySignedTestEvent({rawBody:body,signature:signed(body),secret:'wrong',now:clock}),/not configured/);
});

test('R76 actual SQLite idempotent test receipts, matched order, and immutable commercial nulls',()=>{
 const db=open();
 try{
  registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_test_checkout0001',amountMinor:1399,currency:'usd'});
  const status=run(db);assert.deepEqual(status,{eventId:base.id,duplicate:false,result:'paid',production:false});
  const duplicate=run(db);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.result,'paid');
  const second={...base,id:'evt_test_0002'};
  assert.equal(run(db,second).result,'already_paid','New event must not double-credit existing checkout');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r76_lab_receipts').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r76_lab_events').get().n,2);
  assert.equal(db.prepare('SELECT status FROM r76_lab_orders').get().status,'paid');
  assert.throws(()=>run(db,{...base,data:{object:{...base.data.object,amount_total:1499}}}),/Repeated event ID/);
  assert.throws(()=>run(db,{...base,id:'evt_test_0003',data:{object:{...base.data.object,amount_total:1499}}}),/disagrees/);
  assert.throws(()=>run(db,{...base,id:'evt_test_0004',data:{object:{...base.data.object,currency:'eur'}}}),/disagrees/);
  assert.throws(()=>run(db,{...base,id:'evt_test_0005',data:{object:{...base.data.object,id:'cs_test_unknown99'}}}),/Unknown or mismatched/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r76_lab_events').get().n,2,'Failed events cannot create ledger entries');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.deepEqual(sandboxCommercialStatus(db),{contract:CONTRACT_VERSION,production:false,simulated:true,
   testEvents:2,testReceipts:1,realPayments:null,verifiedImpressions:null,netRevenue:null,commercialLaunchAuthorized:false});
 }finally{db.close();}
});

test('R76 deferred payments remain unpaid until a distinct signed async success event',()=>{
 const db=open();
 try{
  registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_test_checkout0001',amountMinor:1399,currency:'usd'});
  const unpaid={...base,data:{object:{...base.data.object,payment_status:'unpaid'}}};
  assert.equal(run(db,unpaid).result,'unpaid');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r76_lab_receipts').get().n,0);
  assert.equal(db.prepare('SELECT status FROM r76_lab_orders').get().status,'awaiting_payment');
  const paid={...base,id:'evt_test_0002',type:'checkout.session.async_payment_succeeded'};
  assert.equal(run(db,paid).result,'paid');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r76_lab_receipts').get().n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});

test('R76 rejects live IDs, zero prices, forged order matching, unpaid status and duplicates',()=>{
 const db=open();
 try{
  assert.throws(()=>registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_live_broken',amountMinor:1399,currency:'usd'}),/Only test Checkout/);
  assert.throws(()=>registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_test_checkout0001',amountMinor:0,currency:'usd'}),/Positive/);
  registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_test_checkout0001',amountMinor:1399,currency:'usd'});
  assert.throws(()=>registerSandboxOrder(db,{orderId:'r76_order0001',sessionId:'cs_test_checkout0001',amountMinor:1399,currency:'usd'}),/UNIQUE/);
  assert.throws(()=>run(db,{...base,data:{object:{...base.data.object,mode:'setup'}}}),/not completed/);
  assert.throws(()=>run(db,{...base,data:{object:{...base.data.object,status:'open'}}}),/not completed/);
  assert.throws(()=>run(db,{...base,data:{object:{...base.data.object,client_reference_id:'r76_not_registered'}}}),/Unknown or mismatched/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r76_lab_receipts').get().n,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
