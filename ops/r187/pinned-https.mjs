/**
 * R187: no-credential, no-redirect, DNS-pinned IPv4 HTTPS transport.
 * Defends manual operator diagnostics against DNS rebinding / RFC1918,
 * loopback, link-local, multicast and public-domain -> private DNS.
 *
 * Constrained to exactly three R186 probe endpoints; no arbitrary URLs,
 * methods, cookies, auth, proxy, redirects, or body upload. Uses HTTPS with
 * TLS hostname verification/SNI and an OS DNS resolution pinned per run.
 * DNSSEC, independent TLS attestation and full remote identity are NOT proven.
 *
 * IPv6-only staging deliberately fails closed until a separate reviewed
 * globally-routable IPv6 implementation is approved.
 */
import {lookup} from 'node:dns/promises';
import {request as nodeHttpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {validateR186StagingHostname} from '../r186/https-preflight.mjs';
const fail=m=>{throw Error('R187 pinned HTTPS: '+m);};
const ok=(v,m)=>{if(!v)fail(m);};
const PATHS=new Map([
 ['/health','GET'],['/ready','GET'],['/','HEAD']
]);
function ipv4ToNumber(ip){
 if(isIP(ip)!==4)return null;
 const o=ip.split('.').map(Number);
 if(o.length!==4||o.some(x=>!Number.isInteger(x)||x<0||x>255))
  return null;
 return o.reduce((v,n)=>((v*256)+n)>>>0,0);
}
function inCidr(num,base,prefix){
 const m=prefix===0?0:(0xffffffff<<(32-prefix))>>>0;
 return (num&m)===((base>>>0)&m);
}
const CIDRS=Object.freeze([
 ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],
 ['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
 ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
 ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
 ['224.0.0.0',4],['240.0.0.0',4]
].map(([s,p])=>[ipv4ToNumber(s),p]));
export function isR187PublicIPv4(ip){
 const n=ipv4ToNumber(ip);
 return n!==null&&CIDRS.every(([base,prefix])=>!inCidr(n,base,prefix));
}
export function validateR187DnsAnswers(answers){
 ok(Array.isArray(answers)&&answers.length>=1&&answers.length<=12,
  '1..12 bounded addresses required');
 const ips=[];
 for(const a of answers){
  ok(a&&Object.getPrototypeOf(a)===Object.prototype&&
   a.family===4&&isR187PublicIPv4(a.address),
   'DNS resolved to non-global IPv4 / IPv6 / private / malformed address');
  if(!ips.includes(a.address))ips.push(a.address);
 }
 ok(ips.length>=1&&ips.length<=8,
  'DNS answer set exceeds bounded unique global IPv4 targets');
 ips.sort();
 return Object.freeze(ips);
}
export function createR187PinnedHttpsTransport({
 hostname,resolveAddresses=(h)=>lookup(h,{all:true,verbatim:true}),
 httpsRequest=nodeHttpsRequest,clock=()=>Date.now(),
 allowNetwork=false
}={}){
 validateR186StagingHostname(hostname);
 ok(typeof resolveAddresses==='function'&&typeof httpsRequest==='function'&&
  typeof clock==='function','bounded DNS lookup, TLS request and clock required');
 let pinned=null,checkedAtMs=0,requestCount=0;
 async function initialize(){
  ok(allowNetwork===true,'explicit opt-in for public staging required');
  const before=clock();
  ok(Number.isSafeInteger(before)&&before>0,
   'monotonic wall timestamp required');
  let resolved;
  try{resolved=await resolveAddresses(hostname);}
  catch{fail('DNS resolution unavailable');}
  pinned=validateR187DnsAnswers(resolved);
  checkedAtMs=clock();
  ok(checkedAtMs>=before&&checkedAtMs-before<=5000,
   'DNS resolution too old for bounded staging inspection');
  return pinned;
 }
 async function fetcher(rawUrl,opts={}){
  ok(typeof rawUrl==='string'&&opts&&
   Object.getPrototypeOf(opts)===Object.prototype,
   'exact bounded URL and transport options required');
  const url=new URL(rawUrl);
  const expected=PATHS.get(url.pathname);
  ok(pinned!==null&&checkedAtMs>0&&
   clock()-checkedAtMs>=0&&clock()-checkedAtMs<=15000&&
   requestCount<3&&url.protocol==='https:'&&url.hostname===hostname&&
   url.port===''&&url.username===''&&url.password===''&&
   url.search===''&&url.hash===''&&expected===opts.method&&
   opts.redirect==='error'&&opts.credentials==='omit'&&
   !('body' in opts)&&!('Authorization' in (opts.headers||{}))&&
   !('Cookie' in (opts.headers||{})),
   'public pinned staging only, 3 GET/HEAD requests, no credentials, no redirects');
  requestCount++;
  // Deterministic one-address pin prevents a second DNS resolution from
  // returning internal addresses; lookup callback cannot use system DNS.
  const ip=pinned[0];
  const headers={
   accept:opts.method==='HEAD'?'*/*':'application/json',
   'cache-control':'no-store',
   'user-agent':'marcosa-r187-pinned-readonly'
  };
  const transport={
   method:expected,port:443,servername:hostname,
   rejectUnauthorized:true,agent:false,timeout:7000,
   headers,lookup:(_host,_options,callback)=>{
    callback(null,ip,4);
   }
  };
  return new Promise((resolve,reject)=>{
   let done=false;
   const settle=(error,result)=>{
    if(done)return;
    done=true;
    if(error)reject(new Error('R187 pinned HTTPS: TLS or socket request failed'));
    else resolve(result);
   };
   let req;
   try{
    req=httpsRequest(rawUrl,transport,res=>{
     const status=res.statusCode;
     const out={
      status,url:rawUrl,redirected:false,
      headers:{get:name=>{
       const k=String(name).toLowerCase();
       const v=res.headers?.[k];
       return typeof v==='string'?v:null;
      }},
      text:async()=>new Promise((pass,deny)=>{
       let size=0,content='';
       res.on('data',chunk=>{
        const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk));
        size+=b.length;
        if(size>2048){
         req.destroy();deny(new Error('bounded staging body too large'));
         return;
        }
        content+=b.toString('utf8');
       });
       res.once('error',deny);
       res.once('end',()=>pass(content));
      })
     };
     // Both GET and HEAD are consumed in R186; zero traffic mutation.
     settle(null,out);
     if(expected==='HEAD')res.resume();
    });
    req.once('error',err=>settle(err));
    req.once('timeout',()=>req.destroy());
    req.end();
   }catch(e){settle(e);}
  });
 }
 return Object.freeze({
  initialize,fetcher,
  publicStatus:()=>({
   hostname,readOnly:true,enabled:allowNetwork,
   pinnedAddressCount:pinned?.length||0,
   pinnedAddressSetSha256:pinned?
    createHash('sha256').update(pinned.join('|')).digest('hex'):null,
   requestCount,originIdentityIndependentlyAttested:false,
   realPilotAuthorized:false,productionAuthorized:false
  })
 });
}
