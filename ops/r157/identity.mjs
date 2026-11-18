/**
 * R157 verified identity boundary. No Supabase keys, tokens or secrets in repo.
 * JWKS is externally pinned by a trusted operator. Never fetch an arbitrary
 * URL from a token header; never accept HS*, 'none' or service_role JWTs.
 * Session revocation validation is mandatory for EVERY mutating command.
 */
import {createPublicKey,verify} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const b64=/^[A-Za-z0-9_-]+$/;
export class IdentityError extends Error {
 constructor(message='Invalid bearer identity'){super(message);this.name='IdentityError';this.status=401;}
}
const fail=()=>{throw new IdentityError();};
function decode(segment,max){
 if(typeof segment!=='string'||segment.length<1||segment.length>max||!b64.test(segment))fail();
 const bytes=Buffer.from(segment,'base64url');
 if(bytes.toString('base64url')!==segment)fail();
 return bytes;
}
function json(segment,max){
 const raw=decode(segment,max);
 try{
  const value=JSON.parse(raw.toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))fail();
  return value;
 }catch{fail();}
}
function numeric(t){return typeof t==='number'&&Number.isSafeInteger(t)&&t>=0;}
const algorithm={RS256:{type:'rsa',crypto:'RSA-SHA256'},ES256:{type:'ec',crypto:'sha256'}};

/** Returns {verifyBearer(token)}; test fixtures use locally signed ES256 JWT. */
export function createIdentityVerifier({
 issuer,audience='authenticated',jwks,isSessionActive,clock=()=>Date.now(),
 maxLifetimeSeconds=7200,leewaySeconds=30
}={}){
 if(typeof issuer!=='string'||!/^https:\/\//.test(issuer)||issuer.length>250||
  typeof audience!=='string'||!audience||!Array.isArray(jwks)||jwks.length<1||jwks.length>12||
  typeof isSessionActive!=='function'||typeof clock!=='function'||
  !Number.isInteger(maxLifetimeSeconds)||maxLifetimeSeconds<30||maxLifetimeSeconds>86400||
  !Number.isInteger(leewaySeconds)||leewaySeconds<0||leewaySeconds>60)
  throw Error('R157 requires pinned HTTPS issuer, public JWKS and mandatory session revocation check');
 const keys=new Map();
 for(const jwk of jwks){
  if(!jwk||typeof jwk!=='object'||typeof jwk.kid!=='string'||
   !/^[A-Za-z0-9_.-]{1,90}$/.test(jwk.kid)||!algorithm[jwk.alg]||
   jwk.kty!==(jwk.alg==='RS256'?'RSA':'EC')||
   (jwk.alg==='ES256'&&jwk.crv!=='P-256')||
   (jwk.use&&jwk.use!=='sig')||jwk.d||jwk.p||jwk.q||jwk.dp||jwk.dq||
   jwk.qi||jwk.oth||jwk.k||jwk.key_ops?.some(x=>x!=='verify')||
   keys.has(jwk.kid))throw Error('Unsafe or duplicate signing key in configured JWKS');
  try{
   const key=createPublicKey({key:jwk,format:'jwk'});
   if(key.asymmetricKeyType!==algorithm[jwk.alg].type)throw Error('key type mismatch');
   keys.set(jwk.kid,Object.freeze({alg:jwk.alg,key}));
  }catch{throw Error('Invalid pinned public JWT signing key');}
 }
 async function verifyBearer(token){
  if(typeof token!=='string'||token.length>8192||token.length<20)fail();
  const pieces=token.split('.');
  if(pieces.length!==3)fail();
  const [h,p,s]=pieces,header=json(h,2000),claims=json(p,6000);
  if(header.typ!=='JWT'||typeof header.kid!=='string'||!keys.has(header.kid)||
   header.alg!==keys.get(header.kid).alg||header.crit||header.jku||header.x5u||
   header.jwk||header.x5c||header.b64===false)fail();
  const signature=decode(s,2000),chosen=keys.get(header.kid);
  if(header.alg==='ES256'&&signature.length!==64)fail();
  const verified=verify(algorithm[header.alg].crypto,Buffer.from(h+'.'+p),
   header.alg==='ES256'?{key:chosen.key,dsaEncoding:'ieee-p1363'}:chosen.key,signature);
  if(!verified)fail();
  const now=Math.floor(clock()/1000);
  if(!Number.isSafeInteger(now)||claims.iss!==issuer||
   !(claims.aud===audience||(Array.isArray(claims.aud)&&claims.aud.length>0&&claims.aud.includes(audience)))||
   claims.role!=='authenticated'||claims.is_anonymous===true||
   typeof claims.sub!=='string'||!uuid.test(claims.sub)||
   typeof claims.session_id!=='string'||!uuid.test(claims.session_id)||
   !numeric(claims.iat)||!numeric(claims.exp)||
   (claims.nbf!==undefined&&!numeric(claims.nbf))||
   claims.exp<=now-leewaySeconds||claims.iat>now+leewaySeconds||
   claims.nbf>now+leewaySeconds||
   claims.exp<=claims.iat||
   claims.exp-claims.iat>maxLifetimeSeconds||
   now-claims.iat>maxLifetimeSeconds+leewaySeconds)fail();
  let active=false;
  try{
   active=(await isSessionActive({sub:claims.sub,sessionId:claims.session_id,
    issuer,expiresAt:claims.exp}))===true;
  }catch{fail();}
  if(!active)fail();
  return Object.freeze({actorId:claims.sub,sessionId:claims.session_id,
   authExpiresAt:claims.exp,issuer});
 }
 return Object.freeze({verifyBearer});
}
