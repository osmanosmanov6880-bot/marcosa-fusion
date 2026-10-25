import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createApp} from '../server.mjs';
import {sanitizePngCover,MAX_COVER_BYTES,MAX_COVER_PIXELS} from '../media/safe-png.mjs';

const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
function crc(data){
 let c=0xffffffff;
 for(const x of data){c^=x;for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);}
 return (c^0xffffffff)>>>0;
}
function chunk(type,data){
 const b=Buffer.alloc(12+data.length);
 b.writeUInt32BE(data.length,0);b.write(type,4,'ascii');data.copy(b,8);
 b.writeUInt32BE(crc(b.subarray(4,8+data.length)),8+data.length);
 return b;
}
function png({width=2,height=2,color=6,filter=0,extra=[],rawOverride=null}={}){
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
 ihdr[8]=8;ihdr[9]=color;
 const channels=color===6?4:color===2?3:4;
 const oneRow=Buffer.alloc(1+width*channels,89);
 oneRow[0]=filter;
 const raw=rawOverride||Buffer.concat(Array.from({length:height},()=>oneRow));
 return Buffer.concat([SIGNATURE,chunk('IHDR',ihdr),...extra,
  chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const sha=b=>createHash('sha256').update(b).digest('hex');
const textChunk=()=>chunk('tEXt',Buffer.from('Comment\0Private metadata must be removed'));
function mutate(buf,seed){
 let n=seed>>>0;
 const rand=()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return n>>>0;};
 const out=Buffer.from(buf),changes=1+rand()%4;
 for(let k=0;k<changes;k++){
  const index=rand()%out.length;
  out[index]^=1<<(rand()%8);
 }
 return out;
}
test('R85 deterministic PNG corpus: accepted canonical output is metadata-free, idempotent, bounded',()=>{
 const withMetadata=png({extra:[textChunk()]});
 const normalized=sanitizePngCover(withMetadata);
 assert.equal(normalized.width,2);assert.equal(normalized.height,2);
 assert.equal(normalized.bytes,normalized.png.length);
 assert.ok(normalized.png.length<=MAX_COVER_BYTES);
 assert.notEqual(sha(withMetadata),sha(normalized.png));
 assert.equal(normalized.png.includes(Buffer.from('tEXt')),false);
 assert.equal(normalized.png.includes(Buffer.from('Private metadata')),false);
 assert.ok(sanitizePngCover(normalized.png).png.equals(normalized.png));
 const rgb=sanitizePngCover(png({color:2}));
 assert.ok(rgb.png.length>57);
 assert.equal(MAX_COVER_PIXELS,1_500_000);
});
test('R85 hostile PNG shapes fail closed: overflow, APNG, CRC, truncation, wrong zlib and filter',()=>{
 const good=png(),badHeader=Buffer.from(good);badHeader[0]=0;
 const badCrc=Buffer.from(good);badCrc[good.length-6]^=64;
 const failures=[
  badHeader,badCrc,good.subarray(0,good.length-1),
  Buffer.concat([good,Buffer.from([1,2,3])]),
  png({color:3}),
  png({width:1600,height:1600,rawOverride:Buffer.from([0])}),
  png({filter:9}),
  png({extra:[chunk('acTL',Buffer.alloc(8))]}),
  png({extra:[chunk('fcTL',Buffer.alloc(26))]}),
  png({extra:[chunk('fdAT',Buffer.from([1,2,3]))]}),
  png({extra:[chunk('ABCD',Buffer.from([1,2,3]))]}),
  png({rawOverride:Buffer.from('zlib stream expands to wrong pixel row count')}),
  Buffer.concat([good,Buffer.alloc(MAX_COVER_BYTES)])
 ];
 const repeatedHdr=Buffer.concat([good.subarray(0,8+25),chunk('IHDR',Buffer.alloc(13)),good.subarray(8+25)]);
 failures.push(repeatedHdr);
 for(const [i,data] of failures.entries())
  assert.throws(()=>sanitizePngCover(Buffer.from(data)),/INVALID_PNG_COVER/,'hostile '+i);
});
test('R85 bounded deterministic adversarial byte mutations never produce noncanonical public PNG',()=>{
 const samples=[png(),png({color:2}),png({extra:[textChunk()]})];
 let refused=0,allowed=0;
 for(const s of samples){
  for(let i=1;i<=600;i++){
   const candidate=mutate(s,(i*2654435761)>>>0);
   try{
    const result=sanitizePngCover(candidate);
    allowed++;
    assert.equal(result.bytes,result.png.length);
    assert.ok(result.bytes<=MAX_COVER_BYTES);
    assert.ok(result.width*result.height<=MAX_COVER_PIXELS);
    assert.equal(result.png.includes(Buffer.from('tEXt')),false);
    assert.ok(sanitizePngCover(result.png).png.equals(result.png));
   }catch(error){
    assert.match(String(error.message),/INVALID_PNG_COVER/);
    refused++;
   }
  }
 }
 assert.equal(refused+allowed,1800);
 assert.ok(refused>1000,'Adversarial inputs should mostly be rejected');
});
test('R85 true HTTP/SQLite: malformed owner uploads never replace approved queue or provenance',async()=>{
 const app=createApp({inviteCode:'r85-private-malformed-png'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 const registration={username:'r85owner',email:'r85owner@example.invalid',
  password:'r85-super-private-test-passphrase',inviteCode:'r85-private-malformed-png'};
 const request=async(path,{method='GET',cookie=null,body=null,mime='application/json'}={})=>{
  const headers={};if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){headers.Origin=base;headers['Content-Type']=mime;}
  if(mime==='image/png')headers['X-Marcosa-Rights-Attestation']='rights-v1';
  const response=await fetch(base+path,{method,headers,...(body===null?{}:{
   body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
  const type=response.headers.get('content-type')||'';
  return{status:response.status,body:type.startsWith('image/png')?
   Buffer.from(await response.arrayBuffer()):await response.json(),
   cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
 };
 try{
  let x=await request('/api/auth/register',{method:'POST',body:registration});
  assert.equal(x.status,201);
  x=await request('/api/auth/login',{method:'POST',
   body:{email:registration.email,password:registration.password}});
  assert.equal(x.status,200);const cookie=x.cookie;
  const identity=await request('/api/auth/me',{cookie});
  assert.equal(identity.status,200);const slug=identity.body.worlds[0].slug;
  const path='/api/worlds/'+slug+'/cover';
  for(const hostile of [png({filter:8}),png({color:3}),png({extra:[chunk('acTL',Buffer.alloc(8))]})]){
   x=await request(path,{method:'POST',cookie,body:hostile,mime:'image/png'});
   assert.equal(x.status,422);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM world_covers').get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM world_cover_rights_history').get().n,0);
  const original=png({extra:[textChunk()]});
  x=await request(path,{method:'POST',cookie,body:original,mime:'image/png'});
  assert.equal(x.status,200);
  assert.equal(x.body.metadataRemoved,true);
  assert.equal(x.body.rightsDeclarationRecorded,true);
  assert.equal(x.body.publicVisible,false);
  const before=app.db.prepare('SELECT png,review_status FROM world_covers').get();
  const canonical=Buffer.from(before.png);
  assert.equal(before.review_status,'pending');
  assert.notEqual(sha(original),sha(canonical));
  assert.equal(canonical.includes(Buffer.from('tEXt')),false);
  for(const hostile of [png({filter:9}),png({width:1600,height:1600,rawOverride:Buffer.from([0])}),
    Buffer.from('malicious uploaded payload')]){
   x=await request(path,{method:'POST',cookie,body:hostile,mime:'image/png'});
   assert.equal(x.status,422);
  }
  assert.ok(Buffer.from(app.db.prepare('SELECT png FROM world_covers').get().png).equals(canonical));
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM world_cover_rights_history').get().n,1);
  assert.equal(app.db.prepare('SELECT asset_sha256 FROM world_cover_rights').get().asset_sha256,sha(canonical));
  assert.equal((await request(path)).status,404,'Pending media never publicly delivered');
  const privateImage=await request('/api/me/worlds/'+slug+'/cover',{cookie});
  assert.equal(privateImage.status,200);
  assert.ok(privateImage.body.equals(canonical));
  assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await app.close();}
});
