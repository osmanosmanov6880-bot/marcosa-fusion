#!/usr/bin/env node
/**
 * MARCOSA R119 — actual Node 22 + SQLite social API tested via loopback on VPS.
 *
 * Inputs: reviewed server-lab source, no customer records, no secrets.
 * Creates ONLY a fresh in-memory SQLite DB with two synthetic identities.
 * Closes 127.0.0.1 ephemeral listener in finally. No external endpoints,
 * production accounts, disk writes, deploys, DNS, Nginx or network services.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server-lab/server.mjs';

const SHA40=/^[0-9a-f]{40}$/;
const expectNode=()=>{
  const [major,minor]=process.versions.node.split('.').map(Number);
  assert.ok(major>22 || major===22 && minor>=13,'R119 requires Node >=22.13 with built-in SQLite');
};
const random=()=>randomBytes(24).toString('hex');
const noCredentials=(data)=>{
  assert.equal(JSON.stringify(data).includes('password_hash'),false);
  assert.equal(JSON.stringify(data).includes('token_hash'),false);
};
const JSON_HEADERS={'content-type':'application/json'};
export async function runSocialSmoke({releaseSha}={}) {
  expectNode();
  assert.match(releaseSha||'',SHA40,'R119 requires a fully reviewed 40-character main SHA');
  const invite=random(), password=random();
  // The users below are synthetic, never external identities or actual email inboxes.
  const users=['r119alpha','r119beta'];
  const app=createApp({databasePath:':memory:',inviteCode:invite,registrationMode:'legacy'});
  let running=false,port=0;
  try{
    await new Promise((ok,fail)=>{
      app.server.once('error',fail);
      app.server.listen(0,'127.0.0.1',ok);
    });
    running=true;
    const address=app.server.address();
    assert.equal(address.address,'127.0.0.1');
    assert.ok(Number.isInteger(address.port)&&address.port>0);
    port=address.port;
    const origin='http://127.0.0.1:'+port;
    async function request(path,{method='GET',json,cookie,originOverride}={}) {
      assert.ok(path.startsWith('/') && !path.startsWith('//'),'No remote URL');
      const headers={};
      if(method!=='GET')Object.assign(headers,JSON_HEADERS,
        {Origin:originOverride??origin});
      if(cookie)headers.Cookie=cookie;
      const res=await fetch(origin+path,{
        method,headers,redirect:'error',signal:AbortSignal.timeout(8000),
        ...(json===undefined?{}:{body:JSON.stringify(json)}),
      });
      const text=await res.text();
      assert.ok(text.length<300000,'Unexpected response size');
      return {status:res.status,data:JSON.parse(text),headers:res.headers};
    }
    const health=await request('/api/health');
    assert.equal(health.status,200);
    assert.equal(health.data.production,false);
    assert.equal(health.data.mode,'loopback-lab');
    assert.equal(health.headers.get('x-frame-options'),'DENY');
    assert.match(health.headers.get('content-security-policy')||'',/default-src 'none'/);
    assert.equal((await request('/api/account/export')).status,401);
    const hostileOrigin=await request('/api/auth/register',{
      method:'POST',originOverride:'https://attacker.example',
      json:{username:'hostile',email:'hostile@example.net',password,inviteCode:invite},
    });
    assert.equal(hostileOrigin.status,403);
    const hostileHost=await new Promise((ok,fail)=>{
      const req=httpRequest({
        hostname:'127.0.0.1',port,path:'/api/health',
        headers:{Host:'evil.example'},agent:false,setHost:false,timeout:5000,
      },res=>{res.resume();res.on('end',()=>ok(res.statusCode));});
      req.once('error',fail);req.once('timeout',()=>req.destroy(new Error('HTTP timeout')));
      req.end();
    });
    assert.equal(hostileHost,421);
    const account={};
    for(const username of users){
      const reg=await request('/api/auth/register',{
        method:'POST',
        json:{username,email:username+'@example.net',password,inviteCode:invite},
      });
      assert.equal(reg.status,201);
      const logged=await request('/api/auth/login',{
        method:'POST',json:{email:username+'@example.net',password},
      });
      assert.equal(logged.status,200);
      const setCookie=logged.headers.get('set-cookie')||'';
      assert.match(setCookie,/HttpOnly/);
      assert.match(setCookie,/SameSite=Strict/);
      const cookie=setCookie.split(';')[0];
      assert.match(cookie,/^marcosa_session=[a-f0-9]{64}$/);
      const me=await request('/api/auth/me',{cookie});
      assert.equal(me.status,200);
      assert.equal(me.data.user.username,username);
      assert.equal(me.data.worlds.length,1);
      account[username]={cookie,worldId:me.data.worlds[0].id};
    }
    assert.notEqual(account.r119alpha.worldId,account.r119beta.worldId);
    const draft=await request('/api/posts',{method:'POST',
      cookie:account.r119alpha.cookie,
      json:{worldId:account.r119alpha.worldId,body:'Ephemeral R119 draft',status:'draft'},
    });
    assert.equal(draft.status,201);
    const crossTenant=await request('/api/posts',{method:'POST',
      cookie:account.r119beta.cookie,
      json:{worldId:account.r119alpha.worldId,body:'Foreign world overwrite',status:'published'},
    });
    assert.equal(crossTenant.status,403);
    const betaPrivate=await request('/api/me/posts',{cookie:account.r119beta.cookie});
    assert.equal(betaPrivate.status,200);
    assert.equal(betaPrivate.data.items.length,0);
    const guestFeed=await request('/api/posts');
    assert.equal(guestFeed.status,200);
    assert.ok(guestFeed.data.items.every(item=>item.body!=='Ephemeral R119 draft'));
    const published=await request('/api/posts',{method:'POST',
      cookie:account.r119alpha.cookie,
      json:{worldId:account.r119alpha.worldId,body:'Ephemeral R119 publication',status:'published'},
    });
    assert.equal(published.status,201);
    const feed=await request('/api/posts');
    assert.equal(feed.status,200);
    assert.ok(feed.data.items.some(item=>item.id===published.data.id));
    const exportAlpha=await request('/api/account/export',{cookie:account.r119alpha.cookie});
    const exportBeta=await request('/api/account/export',{cookie:account.r119beta.cookie});
    assert.equal(exportAlpha.status,200);assert.equal(exportBeta.status,200);
    assert.equal(exportAlpha.data.format,'MARCOSA-ACCOUNT-EXPORT-v1');
    assert.equal(exportAlpha.data.posts.length,2);
    assert.equal(exportBeta.data.posts.length,0);
    noCredentials(exportAlpha.data);noCredentials(exportBeta.data);
    const deleted=await request('/api/account',{method:'DELETE',
      cookie:account.r119alpha.cookie,json:{confirm:'DELETE',password},
    });
    assert.equal(deleted.status,200);
    assert.equal(deleted.data.deleted,true);
    assert.equal((await request('/api/auth/me',{cookie:account.r119alpha.cookie})).status,401);
    const emptyFeed=await request('/api/posts');
    assert.equal(emptyFeed.status,200);
    assert.ok(!emptyFeed.data.items.some(item=>item.id===published.data.id));
    assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(app.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
    // Never serialize synthetic passwords, cookies or the raw database.
    return {
      format:'MARCOSA-R119-EPHEMERAL-VPS-SOCIAL-API-v1',
      releaseSha,scope:'disposable_loopback_sqlite_only',
      labAccountsSynthetic:2,accountDataPersisted:false,
      publicNetworkListener:false,verifiedListener:'127.0.0.1',
      actualHttpTests:true,crossTenantWriteRejected:true,
      guestPrivateExportRejected:true,wrongHostRejected:true,
      hostileOriginRejected:true,ownerOnlyExport:true,
      accountDeletionAndSessionRevocation:true,
      sqliteForeignKeysValid:true,sqliteQuickCheckValid:true,
      productionAuthorized:false,productionAccountMigrationVerified:false,
      postgresOrSupabaseVerified:false,paymentsVerified:false,
    };
  }finally{
    if(running)await app.close();
  }
}
async function main(){
  const evidence=await runSocialSmoke({releaseSha:process.env.RELEASE_SHA});
  console.log('R119_ACTUAL_VPS_EPHEMERAL_SOCIAL_API=PASS');
  console.log('R119_RELEASE_SHA='+evidence.releaseSha);
  console.log('R119_HTTP_AUTH_PRIVACY=PASS');
  console.log('R119_CROSS_TENANT_DENIAL=PASS');
  console.log('R119_SQLITE_IN_MEMORY_INTEGRITY=PASS');
  console.log('R119_LISTENER=127.0.0.1_EPHEMERAL');
  console.log('R119_PRODUCTION_AUTHORIZED=NO');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    console.error('R119_EPHEMERAL_LAB_FAILED='+String(error.message||error).slice(0,150));
    process.exitCode=2;
  });
}
