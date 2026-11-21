/**
 * R160: actual, pinned node-postgres transport for a server-owned staging runtime.
 * Import resolves to ops/r160/node_modules/pg after npm ci (committed lockfile).
 * Never self-start or read connection secrets from environment.
 */
import {createRequire} from 'node:module';
import pg from 'pg';
import {createSecurePgPool,probeWriterPool} from '../r159/secure-pool.mjs';
const require=createRequire(import.meta.url);
const expected='8.23.1';
export const R160_PG_VERSION=expected;

function verifyDriver(){
 const actual=require('pg/package.json').version;
 if(actual!==expected)throw Error('R160 pinned pg version drift');
 if(typeof pg?.Pool!=='function')throw Error('R160 node-postgres driver unavailable');
}
export function createR160PgTransport({config,clock,ciLoopback=false,onPoolError}={}){
 verifyDriver();
 if(ciLoopback&&!(process.env.GITHUB_ACTIONS==='true' &&
   process.env.GITHUB_REPOSITORY==='osmanosmanov6880-bot/marcosa-fusion'))
  throw Error('R160 loopback transport allowed only in disposable CI');
 const pool=createSecurePgPool({Pool:pg.Pool,config,clock,
  allowLoopbackFixture:ciLoopback,onPoolError});
 return Object.freeze({
  connect:()=>pool.connect(),
  end:()=>pool.end(),
  preflight:()=>probeWriterPool(pool,{
   expectedLogin:config.user,expectedDatabase:config.database
  }),
  settings:Object.freeze({...pool.settings,driver:'pg',driverVersion:expected,
   sessionRoleChangesAreTransactionLocal:true})
 });
}
