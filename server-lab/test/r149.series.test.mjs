import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

test('season publishing, reader access, retry and moderation use the real social graph', async t => {
 const inviteCode='season-pilot-local-invite';
 const app=createApp({inviteCode});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 async function request(path, cookie='', method='GET', body) {
  const headers={cookie,origin:base,'content-type':'application/json'};
  const response=await fetch(base+path,{headers,method,body:JSON.stringify(body)});
  const content=await response.text();
  return {status:response.status,content,json: response.headers.get('content-type').includes('application/json')?JSON.parse(content):null,
   cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function member(username) {
  const credentials={email:username+'@example.org',password:'long-enough-season-password'};
  assert.equal((await request('/api/auth/register','','POST',{...credentials,username,inviteCode})).status,201);
  const {cookie}=await request('/api/auth/login','','POST',credentials);
  const {json}=await request('/api/auth/me',cookie);
  return {cookie,world:json.worlds[0].id};
 }
 const author=await member('director149'),fan=await member('viewer149');
 const season={worldId:author.world,slug:'the-evening',title:'Летний вечер',nextAt:1900000000000};
 assert.equal((await request('/api/series',fan.cookie,'POST',season)).status,404);
 assert.equal((await request('/api/series',author.cookie,'POST',season)).status,201);
 assert.equal((await request('/api/series',author.cookie,'POST',season)).status,409);
 const createPost=async (member,status)=> (await request('/api/posts',member.cookie,'POST',{body:'Вечер <script>test</script>',worldId:member.world,status})).json.id;
 const id=await createPost(author,'published'),draft=await createPost(author,'draft'),foreign=await createPost(fan,'published');
 const detail='/api/series/the-evening';
 const add=async postId=>request(detail+'/episodes',author.cookie,'POST',{title:'Глава первая',postId});
 assert.equal((await add(draft)).status,404);
 assert.equal((await add(foreign)).status,404);
 assert.equal((await add(id)).status,201);assert.equal((await add(id)).status,200);
 const discovered=await request('/api/series?q=director149');
 assert.equal(discovered.json.items.length,1);
 assert.equal(discovered.json.items[0].episodeCount,1);
 assert.equal(discovered.json.items[0].firstEpisodeId,(await request(detail)).json.episodes[0].id);
 assert.equal((await request('/api/series?q=absent')).json.items.length,0);
 assert.equal((await request('/api/series?q='+encodeURIComponent('x'.repeat(73)))).status,400);
 assert.match((await request('/series?q=director149')).content,/Начать с первого выпуска/);
 assert.doesNotMatch((await request('/series?q='+encodeURIComponent('<script>'))).content,/<script>/);
 assert.equal((await request(detail)).json.episodes.length,1);
 const page=await request('/series/the-evening');
 assert.match(page.content,/Вечер &lt;script&gt;test&lt;\/script&gt;/);
 assert.match(page.content,/Глава первая/);assert.doesNotMatch(page.content,/id="next-release"/);
 assert.match((await request('/series/the-evening',author.cookie)).content,/id="next-release"/);
 assert.equal((await request(detail,author.cookie,'PATCH',{nextAt:null})).json.nextAt,null);
 await request('/api/me/profile',author.cookie,'PATCH',{visibility:'private'});
 assert.equal((await request(detail,fan.cookie)).status,404);assert.equal((await request('/api/series')).json.items.length,0);
 assert.equal((await request('/api/users/director149/follow',fan.cookie,'POST',{})).status,202);
 await request('/api/users/viewer149/follow-request',author.cookie,'POST',{decision:'accept'});
 assert.equal((await request(detail,fan.cookie)).status,200);
 await request('/api/users/viewer149/block',author.cookie,'POST',{});
 assert.equal((await request(detail,fan.cookie)).status,404);
 app.db.prepare("UPDATE posts SET status='hidden' WHERE id=?").run(id);
 assert.deepEqual((await request(detail,author.cookie)).json.episodes,[]);
 assert.equal((await request('/api/series?q=director149',author.cookie)).json.items[0].episodeCount,0);
 assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
