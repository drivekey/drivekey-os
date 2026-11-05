// Explicit public artifact provisioning. No wallet, login, relayer or RPC access.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {HINKAL_PROVER_PINS}=createRequire(import.meta.url)('../dist/hinkal-prover-pins.cjs');
const sourceBase='https://wallet-prodv12.hinkal.io/verifiers-v4/';
const [directory,...extra]=process.argv.slice(2);
if(!directory||extra.length||!path.isAbsolute(directory))throw Error('Usage: node tools/provision-proof-artifacts.mjs <absolute artifact directory>');
const target=path.resolve(directory);await fs.mkdir(target,{recursive:true});const stat=await fs.lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Use a regular artifact directory.');
const sha=b=>createHash('sha256').update(b).digest('hex'),inventory=[];
for(const [chain,pins]of Object.entries(HINKAL_PROVER_PINS))for(const pin of Object.values(pins)){
 const file=path.join(target,pin.name);let existing;
 try{const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==pin.bytes)throw Error('Existing artifact differs; preserve and inspect it.');existing=await fs.readFile(file);if(sha(existing)!==pin.sha256)throw Error('Existing artifact differs; preserve and inspect it.');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(!existing){
  const response=await fetch(sourceBase+pin.name,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.body)throw Error('Official proving artifact download failed; no fallback was used.');
  const declared=response.headers.get('content-length');if(declared&&Number(declared)!==pin.bytes)throw Error('Official artifact size changed; retain compiled pins and inspect the change.');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>pin.bytes)throw Error('Official artifact exceeds the pinned size.');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)throw Error('Official artifact differs from the compiled SHA-256 pin.');
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{const handle=await fs.open(temporary,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await fs.link(temporary,file);}
  finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
 }
 inventory.push({chain,...pin,url:sourceBase+pin.name,cached:!!existing});
}
console.log(JSON.stringify({verified:true,files:inventory,source:'Pinned public artifacts from the official SDK manifest. No artifact version upgrade or distribution license is implied.'},null,2));
