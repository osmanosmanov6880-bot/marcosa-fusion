import test from 'node:test';
import assert from 'node:assert/strict';
import {createR165QuarantineFence,R165_GATE_SQL,createR165QuarantineControl,
 createR165QuarantinedStore} from '../r165/quarantine-gate.mjs';
const actor='16500000-0000-4165-8165-000000000001';
const session='16500000-0000-4165-8165-000000000002';
const season='16500000-0000-4165-8165-000000000003';
const key='16500000-0000-4165-8165-000000000004';
function harness({initiallyClosed=false,breakQuery=false}={}){
 let closed=initiallyClosed,generation=1,commits=0,rollbacks=0,releases=0;
 const queries=[];
 const client={
  async query(sql,params=[]){
   queries.push([sql,params]);
   if(sql===R165_GATE_SQL){if(breakQuery)throw Error('database unavailable');
    return{rows:[{closed,generation}]};}
   if(sql.includes('UPDATE marcosa_private.r165_quarantine')){
    if(!closed){closed=true;generation++;return{rows:[{generation}]};}
    return{rows:[]};
   }
   if(sql.startsWith('SELECT EXISTS(SELECT 1 FROM auth.sessions'))
    return{rows:[{active:true}]};
   if(sql.startsWith('SELECT marcosa_private.r156_edit_series'))
    return{rows:[{result:{revision:1}}]};
   if(sql==='COMMIT')commits++;
   if(sql==='ROLLBACK')rollbacks++;
   return{rows:[]};
  },
  release(){releases++;}
 };
 return{pool:{connect:async()=>client},meta:()=>({closed,generation,commits,rollbacks,releases,queries})};
}
const request=()=>({actorId:actor,sessionId:session,
 authExpiresAt:Math.floor(Date.now()/1000)+200,name:'edit',key,
 data:{seriesId:season,title:'Consent fenced',description:'test',revision:0}});
test('R165 open quarantined session validates twice inside same SQL transaction',async()=>{
 const h=harness();
 const value=await createR165QuarantinedStore({pool:h.pool}).execute(request());
 assert.equal(value.revision,1);
 const m=h.meta();
 assert.equal(m.commits,1);assert.equal(m.rollbacks,0);
 assert.equal(m.queries.filter(q=>q[0]===R165_GATE_SQL).length,2);
 assert.equal(m.queries.filter(q=>q[0]==='SET LOCAL ROLE marcosa_r165_gate_reader').length,2);
});
test('R165 quarantine closed before write or just before commit always rolls back',async()=>{
 const h=harness({initiallyClosed:true});
 await assert.rejects(createR165QuarantinedStore({pool:h.pool}).execute(request()),e=>e.status===503);
 assert.equal(h.meta().commits,0);
 assert.equal(h.meta().rollbacks,1);
 const second=harness();
 await assert.rejects(createR165QuarantinedStore({pool:second.pool,
  onAfterQuery:async()=>{await createR165QuarantineControl({pool:second.pool}).close();}
 }).execute(request()),e=>e.status===503);
 assert.equal(second.meta().closed,true);
 assert.equal(second.meta().commits,1); // quarantine control committed, writer did not
 assert.equal(second.meta().rollbacks,1);
});
test('R165 durable close cannot reopen and no state can be invented on SQL faults',async()=>{
 const h=harness(),ctl=createR165QuarantineControl({pool:h.pool});
 assert.equal((await ctl.status()).closed,false);
 const result=await ctl.close();
 assert.equal(result.changed,true);assert.equal(result.closed,true);
 assert.equal(result.canReopen,false);
 assert.equal((await ctl.close()).changed,false);
 assert.equal((await ctl.status()).closed,true);
 const offline=harness({breakQuery:true});
 assert.equal((await createR165QuarantineControl({pool:offline.pool}).status()).closed,true);
 const fence=createR165QuarantineFence();
 await assert.rejects(fence({client:{query:async()=>{throw Error('offline');}}}),e=>e.status===503);
});
