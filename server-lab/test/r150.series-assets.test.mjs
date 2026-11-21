import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('season catalog and each linked client script are served with the required security policy',async t=>{
 const app=createApp({inviteCode:'r150-assets-local-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 const catalog=await fetch(base+'/series');
 assert.equal(catalog.status,200);
 assert.match(catalog.headers.get('content-security-policy'),/script-src 'self'/);
 const html=await catalog.text();
 assert.match(html,/src="\/series\.js"/);
 assert.match(html,/src="\/series-subscriptions\.js"/);
 for(const path of ['/series.js','/series-subscriptions.js','/series-metrics.js','/series-sponsor.js','/votes.js']){
  const response=await fetch(base+path);
  assert.equal(response.status,200,path);
  assert.match(response.headers.get('content-type'),/javascript/,path);
  assert.ok((await response.text()).length>100,path);
 }
});
