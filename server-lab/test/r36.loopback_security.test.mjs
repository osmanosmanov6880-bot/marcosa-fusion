import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createApp} from '../server.mjs';

test('R36: DNS rebinding, hostile Host, wrong port and cross-origin mutations fail closed',async()=>{
 const app=createApp({inviteCode:'r36-private-lab-invite-code'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const port=app.server.address().port;
 const trusted='127.0.0.1:'+port;
 const req=({host=trusted,method='GET',path='/api/health',origin,body}={})=>
  new Promise((resolve,reject)=>{
   const headers={Host:host};
   if(origin!==undefined)headers.Origin=origin;
   if(method!=='GET')headers['Content-Type']='application/json';
   const outgoing=httpRequest({hostname:'127.0.0.1',port,method,path,headers,agent:false,setHost:false},res=>{
    let data='';
    res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);
    res.on('end',()=>{let value;try{value=JSON.parse(data);}catch{value={raw:data}}resolve({status:res.statusCode,body:value,headers:res.headers});});
   });
   outgoing.on('error',reject);
   outgoing.end(body===undefined?(method==='GET'?undefined:'{}'):JSON.stringify(body));
  });
 try{
  let r=await req();
  assert.equal(r.status,200);assert.equal(r.body.production,false);
  assert.match(r.headers['content-security-policy'],/default-src 'none'/);
  const falseHosts=['evil.example','localhost.evil.example','127.0.0.1.evil.example','[::2]','0.0.0.0','127.0.0.2','localhost:65535'];
  for(const host of falseHosts){
   r=await req({host});
   assert.equal(r.status,421,'Host must be rejected: '+host);
   r=await req({host,method:'POST',path:'/api/auth/logout',origin:'http://'+host});
   assert.equal(r.status,421,'Host+Origin spoof must be rejected: '+host);
  }
  r=await req({host:'localhost:'+port});
  assert.equal(r.status,200);
  r=await req({host:'[::1]:'+port});
  assert.equal(r.status,200,'IPv6 localhost Host syntax allowed');
  r=await req({host:trusted,method:'POST',path:'/api/auth/logout',origin:'http://evil.example'});
  assert.equal(r.status,403);
  r=await req({host:trusted,method:'POST',path:'/api/auth/logout'});
  assert.equal(r.status,403,'missing Origin must not mutate state');
  r=await req({host:'localhost:'+port,method:'POST',path:'/api/auth/logout',origin:'http://'+trusted});
  assert.equal(r.status,403,'two valid but unequal origins must not be treated as same-origin');
  r=await req({host:trusted,method:'POST',path:'/api/auth/logout',origin:'http://'+trusted,body:{}});
  assert.equal(r.status,200);assert.equal(r.body.authenticated,false);
  r=await req({host:'localhost:'+port,method:'POST',path:'/api/auth/logout',origin:'http://localhost:'+port,body:{}});
  assert.equal(r.status,200,'same-origin localhost supported');
  const content=await req({host:trusted,path:'/'});
  assert.equal(content.status,200);
 }finally{await app.close();}
});
