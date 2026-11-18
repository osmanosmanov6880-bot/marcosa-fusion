/**
 * R159: pin Supabase Auth JWKS URL by projectRef, never token-controlled jku.
 * Rotate in a bounded cache, fail closed on fetch errors/expiry, no stale keys.
 *
 * Supabase JWKS may be edge cached for 10 minutes, so operators should stage
 * a new signing key in advance. Only ES256 and RS256 accepted by R157.
 */
import {createIdentityVerifier,IdentityError} from '../r157/identity.mjs';

const error=()=>new IdentityError();
export function createRotatingSupabaseVerifier({
 projectRef,audience='authenticated',isSessionActive,
 fetchImpl=globalThis.fetch,clock=()=>Date.now(),cacheMs=120000,
 timeoutMs=3000,maxLifetimeSeconds=3600
}={}){
 if(typeof projectRef!=='string'||!/^[a-z0-9]{20,32}$/.test(projectRef)||
  typeof fetchImpl!=='function'||typeof clock!=='function'||
  typeof isSessionActive!=='function'||
  !Number.isInteger(cacheMs)||cacheMs<30000||cacheMs>600000||
  !Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>10000)
  throw Error('R159 JWKS: pinned Supabase project and bounded verification required');
 const issuer='https://'+projectRef+'.supabase.co/auth/v1';
 const endpoint=issuer+'/.well-known/jwks.json';
 let cached=null,expiresAt=0,pending=null;
 async function reload(){
  const response=await fetchImpl(endpoint,{
   method:'GET',redirect:'error',cache:'no-store',
   headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response||response.ok!==true||response.status!==200)throw error();
  const raw=await response.text();
  if(typeof raw!=='string'||raw.length<12||raw.length>32768)throw error();
  let payload;
  try{payload=JSON.parse(raw);}catch{throw error();}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
   !Array.isArray(payload.keys)||payload.keys.length<1||payload.keys.length>12)
   throw error();
  // createIdentityVerifier independently validates every key, algorithm,
  // missing/duplicate kid, public-only JWK and requested issuer/audience.
  const verifier=createIdentityVerifier({issuer,audience,jwks:payload.keys,
   isSessionActive,clock,maxLifetimeSeconds});
  cached=verifier;expiresAt=clock()+cacheMs;
 }
 async function fresh(){
  if(cached&&clock()<expiresAt)return cached;
  if(!pending)pending=reload().finally(()=>{pending=null;});
  try{await pending;}catch{
   // Even if a stale verifier exists, do not use it after a refresh failure.
   cached=null;expiresAt=0;throw error();
  }
  if(!cached||clock()>=expiresAt)throw error();
  return cached;
 }
 return Object.freeze({
  async verifyBearer(token){
   // Token claims and headers do not alter the JWKS URL or initiate discovery.
   const verifier=await fresh();
   try{return await verifier.verifyBearer(token);}
   catch{throw error();}
  },
  getPublicStatus:()=>Object.freeze({
   issuer,keysCached:cached!==null,cacheFresh:cached!==null&&clock()<expiresAt,
   jwksEndpointPinned:true,sessionRevocationRequired:true
  })
 });
}
