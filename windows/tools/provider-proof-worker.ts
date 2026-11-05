import {z} from 'zod';
import {finalizeProductProof} from '../online/hinkal-product-finalizer';
const policy=require('./store-payment-policy.cjs');
for(const method of ['log','warn','error','info','debug'] as const)console[method]=()=>{};
const schema=z.object({action:z.literal('finalize-product-proof'),input:z.unknown(),wallet:z.unknown()}).strict();
let parts:Buffer[]=[],size=0;const clear=()=>{parts.forEach(bytes=>bytes.fill(0));parts=[];};
process.stdin.on('data',(bytes:Buffer)=>{size+=bytes.length;if(size>192*1024){bytes.fill(0);clear();process.exit(2);}parts.push(bytes);});
process.stdin.on('end',async()=>{let job:any;try{const raw=Buffer.concat(parts);clear();try{job=schema.parse(JSON.parse(raw.toString('utf8')));}finally{raw.fill(0);}
 policy.assertProductProof(job.input?.request);const result=await finalizeProductProof(job.input,job.wallet);job=undefined;
 process.stdout.write(JSON.stringify({ok:true,result}),()=>process.exit(0));
}catch{job=undefined;clear();process.stdout.write(JSON.stringify({ok:false,error:'Provider proof finalization failed. Preserve the original authorization and attempt; do not automatically repeat or replace it.'}),()=>process.exit(1));}});
process.stdin.on('error',()=>{clear();process.exit(2);});
