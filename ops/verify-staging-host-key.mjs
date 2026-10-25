/**
 * MARCOSA R70 — OFFLINE, read-only SSH staging identity verifier.
 * Accepts only a host's ED25519 key pinned to the exact host and port.
 * The expected fingerprint MUST be obtained independently from the hosting
 * provider's trusted console. This code does not establish that provenance.
 * Never scan a server to discover the "expected" key.
 */
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

function demand(ok,message){if(!ok)throw Error(message);}
const FP=/^SHA256:[A-Za-z0-9+/]{43}$/;
const HOST=/^[a-zA-Z0-9.-]{1,253}$/;
function validateHost(host,port){
 demand(typeof host==='string'&&HOST.test(host)&&!host.startsWith('.')&&!host.endsWith('.')
  &&!host.includes('..')&&!host.startsWith('-'), 'Invalid staging hostname');
 demand(Number.isInteger(port)&&port>=1&&port<=65535,'Invalid SSH port');
 return port===22?host:'['+host+']:'+port;
}
function validateEd25519PublicBlob(encoded){
 demand(typeof encoded==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),'Invalid SSH public key base64');
 const raw=Buffer.from(encoded,'base64');
 demand(raw.toString('base64').replace(/=+$/,'')===encoded.replace(/=+$/,''),'Non-canonical SSH public key base64');
 let offset=0;
 const take=()=>{
  demand(offset+4<=raw.length,'Invalid SSH wire string length');
  const size=raw.readUInt32BE(offset);offset+=4;
  demand(size<=raw.length-offset,'SSH wire length exceeds buffer');
  const part=raw.subarray(offset,offset+size);offset+=size;return part;
 };
 const type=take().toString('ascii'),point=take();
 demand(type==='ssh-ed25519'&&point.length===32&&offset===raw.length,'Not a complete ED25519 host public key');
 return raw;
}
export function verifyStagingHostPin({hostname,port=22,knownHosts,expected}){
 const matchHost=validateHost(hostname,port);
 demand(typeof expected==='string'&&FP.test(expected),'Expected independently verified SHA256 ED25519 fingerprint');
 demand(typeof knownHosts==='string'&&knownHosts.length<250000,'Invalid known_hosts data');
 let match=null;
 for(const line of knownHosts.split(/\r?\n/)){
  const trimmed=line.trim();
  if(!trimmed||trimmed.startsWith('#'))continue;
  const parts=trimmed.split(/\s+/);
  if(parts[0]!==matchHost)continue;
  demand(!match,'Ambiguous host key: multiple pinned entries for the same host and port');
  demand(parts.length>=3&&parts[1]==='ssh-ed25519','Wrong or unsupported host key algorithm');
  const blob=validateEd25519PublicBlob(parts[2]);
  const actual='SHA256:'+createHash('sha256').update(blob).digest('base64').replace(/=+$/,'');
  demand(actual===expected,'Pinned host key fingerprint mismatch: consult provider, never bypass SSH validation');
  match={hostname,port,hostTag:matchHost,algorithm:'ssh-ed25519',fingerprint:actual,
   localMatch:true,providerProvenanceVerifiedByTool:false,networkContacted:false};
 }
 demand(match,'No ED25519 host pin for the exact hostname and port');
 return match;
}
export function verifyStagingHostPinFile({hostname,port=22,path,expected}){
 demand(typeof path==='string'&&path.length>0&&!path.includes('\0'),'known_hosts path required');
 const file=resolve(path),meta=lstatSync(file);
 demand(meta.isFile()&&!meta.isSymbolicLink(),'known_hosts must be a regular non-symlink file');
 demand(meta.size>0&&meta.size<250000,'known_hosts file size invalid');
 return verifyStagingHostPin({hostname,port,expected,knownHosts:readFileSync(file,'utf8')});
}
function parseArgs(args){
 const fields={};
 while(args.length){
  const key=args.shift();
  demand(['--hostname','--port','--known-hosts','--expected'].includes(key)
   &&!Object.hasOwn(fields,key),'Unknown or duplicated CLI parameter');
  const value=args.shift();demand(value!==undefined&&value!==''&&!value.startsWith('--'),'CLI parameter missing a value');
  fields[key]=value;
 }
 demand(fields['--hostname']&&fields['--known-hosts']&&fields['--expected'],'Usage: --hostname HOST --port 22 --known-hosts FILE --expected SHA256:...');
 const port=fields['--port']===undefined?22:Number(fields['--port']);
 return{hostname:fields['--hostname'],port,path:fields['--known-hosts'],expected:fields['--expected']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=verifyStagingHostPinFile(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ok:true,...result},null,2));
 }catch(error){
  console.error('MARCOSA STAGING IDENTITY BLOCKED: '+error.message);
  process.exitCode=1;
 }
}
