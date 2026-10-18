// Read-only prerequisite capture. Never signs, simulates, or broadcasts a transaction.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),root=process.cwd();
const out=path.join(root,'outputs/jupiter-current-readiness',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));fs.mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const report={status:'blocked',networkBroadcast:false,realFundsSpent:0,currentProgramExecution:false,checks:[],blockers:[]};
async function rpc(method,params=[]){
 if(!['getGenesisHash','getMultipleAccounts'].includes(method))throw Error('Forbidden RPC method');
 const r=await fetch('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!r.ok)throw Error('Public RPC HTTP '+r.status);
 const reader=r.body.getReader();let total=0;const chunks=[];
 try{for(;;){const x=await reader.read();if(x.done)break;total+=x.value.length;if(total>30000000)throw Error('Public RPC response exceeds 30 MB');chunks.push(Buffer.from(x.value));}}finally{await reader.cancel();}
 const body=JSON.parse(Buffer.concat(chunks).toString());if(body.error)throw Error('Public RPC error '+body.error.code);return body.result;
}
try{
 const files=['scripts/check-jupiter-current-artifacts.mjs','core/sol-swap-programs.ts','core/jupiter-account-policy.ts','core/sol-swap-protocol.ts','tests/fixtures/jupiter-r21/sol-usdc.json','tests/fixtures/jupiter-r21/usdc-sol-direct.json'];
 fs.mkdirSync(path.join(out,'source'));save('source-sha256.json',Object.fromEntries(files.map(f=>{const b=fs.readFileSync(f);fs.writeFileSync(path.join(out,'source',f.replaceAll('/','__')),b);return[f,hash(b)];})));
 const b=await build({entryPoints:['core/sol-swap-programs.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});fs.writeFileSync(path.join(out,'program-guard.cjs'),b.outputFiles[0].contents);
 const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);const {SOL_SWAP_PROGRAM_PINS,verifyProgramBytes}=m.exports;
 save('required-program-pins.json',SOL_SWAP_PROGRAM_PINS);report.programGuardBundleSha256=hash(b.outputFiles[0].contents);
 try{report.liteSvmModule=require.resolve('litesvm');}catch{report.checks.push('litesvm is not resolvable from the checkout; separately installed isolated runtimes are outside this capture check.');}
 const genesis=await rpc('getGenesisHash');if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Wrong genesis');report.checks.push('Public RPC mainnet identity confirmed; read-only requests only.');
 const addresses=SOL_SWAP_PROGRAM_PINS.flatMap(p=>[p.address,p.programData]);
 const snapshot=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'finalized'}]);save('public-program-snapshot.json',{addresses,...snapshot});
 const {PublicKey}=require('@solana/web3.js');
 const account=a=>a&&({...a,owner:new PublicKey(a.owner),data:Buffer.from(a.data[0],'base64')});
 report.slot=snapshot.context.slot;report.programs=[];
 for(let i=0;i<SOL_SWAP_PROGRAM_PINS.length;i++){
 const pin=SOL_SWAP_PROGRAM_PINS[i],program=account(snapshot.value[i*2]),data=account(snapshot.value[i*2+1]);const item={address:pin.address,expected:pin.sha256,observed:data?hash(data.data.subarray(45)):null,accepted:false};
 try{verifyProgramBytes(program,data,pin);item.accepted=true;}catch(e){item.reason=e.message;report.blockers.push(pin.address+': '+e.message);}report.programs.push(item);
 }
 // This tool captures current program identity only. Later route-state and
 // isolated runtime campaigns may exist; absence is not established here.
 report.executionEvidenceScope='This capture does not inspect or validate retained route-account snapshots, isolated-runtime campaigns, guard deployment or exact-image transaction acceptance.';
 report.status=report.programs.every(p=>p.accepted)?'pinned-program-artifacts-captured-execution-pending':'program-identity-blocked';
}catch(e){report.blockers.push(e.cause?.code||e.message);}
finally{save('run.json',report);console.log(JSON.stringify({output:out,...report},null,2));}
