/**
 * MARCOSA R159: server-owned node-postgres-compatible pool contract.
 *
 * A production caller must inject a reviewed, pinned pg.Pool constructor and
 * secret values from a server-side secret manager. No public client exports,
 * .env defaults, service_role keys or silent TLS fallback are permitted.
 */
import {X509Certificate} from 'node:crypto';

const isHost=s=>typeof s==='string'&&s.length>=4&&s.length<=253&&
 /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i.test(s)&&!s.includes('..');
const invariant=(x,m)=>{if(!x)throw Error('R159 secure PG: '+m);};
export function validatePgConfig(config,{clock=()=>Date.now(),allowLoopbackFixture=false}={}){
 invariant(config&&Object.getPrototypeOf(config)===Object.prototype,'explicit config required');
 const accepted=['host','expectedHost','port','database','user','password','caPem',
  'maxConnections','connectionTimeoutMs','idleTimeoutMs','applicationName'];
 invariant(Object.keys(config).every(k=>accepted.includes(k)),'unsupported connection options');
 const {host,expectedHost,port,database,user,password,caPem}=config;
 invariant(isHost(host)&&isHost(expectedHost)&&host===expectedHost,
  'host must match exact operator-pinned expected hostname');
 const loopback=host==='127.0.0.1'||host==='localhost';
 invariant(!loopback||allowLoopbackFixture===true,'loopback only in isolated tests');
 invariant(!/^(?:postgres|supabase_admin|service_role|authenticator|anon|authenticated)$/i.test(user||''),
  'privileged/database-client role forbidden');
 invariant(typeof user==='string'&&/^[a-z][a-z0-9_.-]{3,100}$/i.test(user),'explicit least-privilege DB user required');
 invariant(typeof database==='string'&&/^[a-z][a-z0-9_]{2,63}$/i.test(database),
  'database name must be pinned');
 invariant(Number.isInteger(port)&&port>=1&&port<=65535,'explicit port required');
 invariant(typeof password==='string'&&password.length>=20&&!/\s/.test(password),
  'server-only strong password required');
 invariant(typeof caPem==='string'&&caPem.length<16000&&caPem.includes('BEGIN CERTIFICATE'),
  'operator-pinned CA certificate required');
 let certificate;
 try{certificate=new X509Certificate(caPem);}
 catch{throw Error('R159 secure PG: invalid CA certificate');}
 invariant(Date.parse(certificate.validFrom)<=clock()&&Date.parse(certificate.validTo)>clock(),
  'expired or not-yet-valid pinned CA');
 const max=config.maxConnections??4;
 invariant(Number.isInteger(max)&&max>=1&&max<=8,'bounded pool size 1..8');
 const conn=config.connectionTimeoutMs??4000,idle=config.idleTimeoutMs??15000;
 invariant(Number.isInteger(conn)&&conn>=500&&conn<=10000,'bounded connection timeout');
 invariant(Number.isInteger(idle)&&idle>=1000&&idle<=60000,'bounded idle timeout');
 invariant(config.applicationName===undefined||
  /^[a-z][a-z0-9_-]{3,60}$/.test(config.applicationName),'safe application name required');
 return Object.freeze({
  host,port,database,user,password,
  max,connectionTimeoutMillis:conn,idleTimeoutMillis:idle,
  allowExitOnIdle:false,keepAlive:true,
  application_name:config.applicationName||'marcosa_r159_gateway',
  statement_timeout:4500,query_timeout:5500,
  ssl:Object.freeze({rejectUnauthorized:true,ca:caPem,servername:host,minVersion:'TLSv1.2'})
 });
}
/**
 * Construct an actual driver pool only when a server explicitly supplies Pool.
 * pg Pool accepts the returned config shape. No automatic connection is made.
 */
export function createSecurePgPool({Pool,config,allowLoopbackFixture=false,clock,onPoolError}={}){
 invariant(typeof Pool==='function','pinned node-postgres Pool constructor required');
 const options=validatePgConfig(config,{allowLoopbackFixture,clock});
 const pool=new Pool(options);
 if(typeof pool?.on==='function')pool.on('error',()=>{
  // Node-postgres emits idle-client errors: never let an unhandled event crash staging.
  try{if(typeof onPoolError==='function')onPoolError();}catch{}
 });
 invariant(pool&&typeof pool.connect==='function'&&typeof pool.end==='function',
  'Pool implementation must expose connect/end');
 return Object.freeze({
  connect:()=>pool.connect(),
  end:()=>pool.end(),
  settings:Object.freeze({host:options.host,port:options.port,database:options.database,
   max:options.max,tlsCertificateVerified:true,loginRole:options.user,productionConfigured:!allowLoopbackFixture})
 });
}
/**
 * Verify the database authenticated as expected and writer privileges are
 * available through SET LOCAL ROLE, without leaving any pooled session state.
 */
export async function probeWriterPool(pool,{expectedLogin,expectedDatabase}={}){
 invariant(pool&&typeof pool.connect==='function','trusted pool required');
 invariant(typeof expectedLogin==='string'&&expectedLogin.length>0,'expected login required');
 invariant(typeof expectedDatabase==='string'&&expectedDatabase.length>0,'expected database required');
 let client,started=false;
 try{
  client=await pool.connect();
  invariant(client&&typeof client.query==='function'&&typeof client.release==='function',
   'bad database client');
  await client.query('BEGIN');started=true;
  await client.query("SET LOCAL statement_timeout='3000ms'");
  const q=await client.query(
   "SELECT current_user AS login, current_database() AS db, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass");
  invariant(q?.rows?.length===1&&q.rows[0].login===expectedLogin&&q.rows[0].db===expectedDatabase&&
   q.rows[0].bypass===false,'wrong database role, database or RLS bypass');
  await client.query('SET LOCAL ROLE marcosa_r156_writer');
  const role=await client.query('SELECT current_user AS role');
  invariant(role?.rows?.length===1&&role.rows[0].role==='marcosa_r156_writer',
   'cannot enter least-privilege writer role');
  await client.query('ROLLBACK');started=false;
  return Object.freeze({ok:true,loginRole:expectedLogin,role:'marcosa_r156_writer'});
 }catch{
  if(client&&started)try{await client.query('ROLLBACK');}catch{}
  throw Error('R159 secure PG: writer pool preflight failed');
 }finally{if(client)try{client.release();}catch{}}
}
