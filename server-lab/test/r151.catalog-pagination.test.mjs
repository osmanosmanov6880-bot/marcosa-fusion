import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('keyset catalog pages remain deterministic and visibility-aware',async t=>{
 const app=createApp({inviteCode:'r151-catalog-invite'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 async function request(path,method='GET',cookie='',body){
  const response=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();
  return {status:response.status,text,json:response.headers.get('content-type')?.includes('json')?JSON.parse(text):null,
   cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const auth={username:'author151',email:'author151@example.org',password:'long-safe-test-password',inviteCode:'r151-catalog-invite'};
 assert.equal((await request('/api/auth/register','POST','',auth)).status,201);
 const cookie=(await request('/api/auth/login','POST','',auth)).cookie;
 const world=(await request('/api/auth/me','GET',cookie)).json.worlds[0].id;
 for(let i=0;i<45;i++){
  const out=await request('/api/series','POST',cookie,{worldId:world,slug:'series-'+String(i).padStart(3,'0'),title:'Searchable '+i});
  assert.equal(out.status,201);
 }
 let cursor=null,slugs=[],pages=0;
 do{
  const response=await request('/api/series'+(cursor?'?cursor='+cursor:''),'GET',cookie);
  assert.equal(response.status,200);
  assert.ok(response.json.items.length<=20);
  slugs.push(...response.json.items.map(x=>x.slug));
  cursor=response.json.nextCursor;
  pages++;
  assert.ok(pages<=3,'cursor must advance');
 }while(cursor);
 assert.equal(pages,3);
 assert.equal(slugs.length,45);
 assert.equal(new Set(slugs).size,45);
 assert.equal(slugs[0],'series-044');
 assert.equal(slugs.at(-1),'series-000');
 const search=await request('/api/series?q=Searchable%203','GET',cookie);
 assert.equal(search.status,200);
 assert.ok(search.json.items.length>=10);
 assert.ok(search.json.items.every(s=>s.title.includes('3')));
 const html=await request('/series?q=Searchable');
 assert.match(html.text,/Страницы сезонов/);
 assert.match(html.text,/Следующие сезоны/);
 for(const cursor of ['0','-1','1%20OR%201=1','99999999999999999999']) {
  assert.equal((await request('/api/series?cursor='+cursor)).status,400);
 }
 assert.equal((await request('/api/series')).json.items.length,20);
 await request('/api/me/profile','PATCH',cookie,{visibility:'private'});
 assert.deepEqual((await request('/api/series')).json.items,[]);
 assert.equal((await request('/api/series','GET',cookie)).json.items.length,20);
 assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
