'use strict';
// Packaging only. Publish exactly the validated bytes; never copy after hashing.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {HINKAL_PROVER_PINS}=require('../dist/hinkal-prover-pins.cjs');
async function stageProofArtifacts(source,destination){
 if(typeof source!=='string'||!path.isAbsolute(source)||typeof destination!=='string'||!path.isAbsolute(destination)||path.resolve(source)===path.resolve(destination))throw Error('Use separate absolute proving artifact source and staging directories.');
 const info=await fs.lstat(source);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Proving artifacts must be in a regular directory.');
 const inventory=[];await fs.mkdir(destination,{recursive:true});
 for(const [chain,pins]of Object.entries(HINKAL_PROVER_PINS))for(const pin of Object.values(pins)){
  const file=path.join(source,pin.name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==pin.bytes)throw Error('Missing or invalid pinned proving artifact.');
  const handle=await fs.open(file,'r');let bytes;
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==pin.bytes)throw Error('Proving artifact changed while opening.');bytes=Buffer.alloc(pin.bytes+1);let offset=0;while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}if(offset!==pin.bytes)throw Error('Proving artifact changed while reading.');bytes=bytes.subarray(0,offset);}
  finally{await handle.close();}
  if(createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('Proving artifact SHA-256 differs from the compiled pin.');
  await fs.writeFile(path.join(destination,pin.name),bytes,{flag:'wx'});inventory.push({chain,...pin});
 }
 await fs.writeFile(path.join(destination,'PROVING-ARTIFACTS.json'),JSON.stringify({version:1,files:inventory},null,2)+'\n',{flag:'wx'});
 return inventory;
}
module.exports={stageProofArtifacts};
