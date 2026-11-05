import '../engine/offline-signer/network-deny';
import {z} from 'zod';
import {proveProductProof} from '../engine/offline-signer/hinkal-product-prover';
const policy=require('./store-payment-policy.cjs');
const schema=z.object({action:z.literal('prove-product-proof'),vault:z.unknown(),password:z.string().min(16).max(256),request:z.unknown(),response:z.unknown(),artifactDirectory:z.string().max(4096)}).strict();
let bytes=0,parts:Buffer[]=[];
const clear=()=>{parts.forEach(p=>p.fill(0));parts=[];};
process.stdin.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>256*1024){b.fill(0);clear();process.exit(2);}parts.push(b);});
process.stdin.on('end',async()=>{let job:any;try{
 const raw=Buffer.concat(parts);clear();try{job=schema.parse(JSON.parse(raw.toString('utf8')));}finally{raw.fill(0);}
 policy.assertProductProof(job.request);
 const result=await proveProductProof(job.vault,job.password,job.request,job.response,job.artifactDirectory);job.password=undefined;job=undefined;
 process.stdout.write(JSON.stringify({ok:true,result}),()=>process.exit(0));
}catch{if(job)job.password=undefined;job=undefined;clear();process.stdout.write(JSON.stringify({ok:false,error:'Offline proof creation was rejected. Preserve the approved request and authorization.'}),()=>process.exit(1));}});
process.stdin.on('error',()=>{clear();process.exit(2);});
