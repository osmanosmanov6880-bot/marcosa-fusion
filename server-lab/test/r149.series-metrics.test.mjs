import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {handleMetrics} from '../series-metrics.mjs';

test('Series metrics deduplicate consent, respect withdrawal, classify fixtures and measure matured seven-day cohorts',async()=>{
 const app=createApp(),db=app.db;
 await new Promise(resolve=>app.server.listen(0,"127.0.0.1",resolve));
 let clock=1;
 const day=86400000;
 try {
  for(const id of ['owner','reader','fixture','recent']){
   db.prepare('INSERT INTO users(id,email,username,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@example.org',id,'unused','unused',clock);
  }
  db.exec(`INSERT INTO worlds(id,owner_id,slug,title,created_at) VALUES('w','owner','world','World',1);
   INSERT INTO series(id,slug,world_id,owner_id,title,created_at) VALUES(1,'example','w','owner','Example',1);
   INSERT INTO posts(id,world_id,author_id,body,status,created_at,updated_at) VALUES(1,'w','owner','First','published',1,1),(2,'w','owner','Second','published',1,1);
   INSERT INTO series_episodes(id,series_id,post_id,position,title,created_at) VALUES(1,1,1,1,'One',1),(2,1,2,2,'Two',1);
   INSERT INTO series_test_accounts(user_id) VALUES('fixture')`);
  async function request(id,method,suffix='',body={}) {
   let result;
   await handleMetrics({db,route:'/api/series/example/metrics'+suffix,method,user:{id},viewer:{id},body,now:()=>clock,check:(ok,status)=>{if(!ok)throw Error(String(status));},send:(_,status,data)=>{assert.equal(status,200);result=data;}});
   return result;
  }
  const mark=(id,episodeId)=>request(id,'POST','/attendance',{episodeId,consent:true});
  await assert.rejects(request('reader','GET'),/403/);
  await assert.rejects(request('reader','POST','/attendance',{episodeId:1}),/400/);
  await mark('reader',1);await mark('fixture',1);clock+=day;await mark('reader',1);await mark('reader',2);
  clock+=6*day;await mark('recent',1);
  await request('owner','POST','/effort',{episodeId:1,minutes:40});
  let report=await request('owner','GET');
  assert.deepEqual(report.return7d,{eligible:1,returned:1,rate:1});
  assert.equal(report.episodes[0].minutes,40);assert.equal(report.episodes[0].people,2);
  await request('reader','DELETE','/attendance');
  report=await request('owner','GET');assert.deepEqual(report.return7d,{eligible:0,returned:0,rate:null});
 }finally{await app.close();}
});
