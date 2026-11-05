// Network capability only; no wallet password, vault or signing dispatch.
import {z} from 'zod';
import {prepareScopedViewJob} from '../online/hinkal-view';
const policy=require('./store-payment-policy.cjs');
for(const method of ['log','info','debug','warn','error'] as const)console[method]=()=>{};
const schema=z.object({action:z.literal('prepare-scoped-private-proof'),input:z.unknown(),wallet:z.unknown()}).strict();
let size=0,parts:Buffer[]=[];
const clear=()=>{parts.forEach(p=>p.fill(0));parts=[];};
process.stdin.on('data',(bytes:Buffer)=>{size+=bytes.length;if(size>192*1024){bytes.fill(0);clear();process.exit(2);}parts.push(bytes);});
process.stdin.on('end',async()=>{let job:any;try{const raw=Buffer.concat(parts);clear();try{job=schema.parse(JSON.parse(raw.toString('utf8')));}finally{raw.fill(0);}
 policy.assertPrivateView(job.input?.request);
 const result=await prepareScopedViewJob(job.input,job.wallet);job.input.transportPrivateKey=undefined;job=undefined;
 process.stdout.write(JSON.stringify({ok:true,result}),()=>process.exit(0));
}catch{if(job?.input&&typeof job.input==='object')job.input.transportPrivateKey=undefined;job=undefined;clear();process.stdout.write(JSON.stringify({ok:false,error:'Scoped private proof preparation failed. Preserve the original view request and session; no proof authorization or chain transaction was signed.'}),()=>process.exit(1));}});
process.stdin.on('error',()=>{clear();process.exit(2);});
