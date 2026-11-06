// Network capability only; no wallet password, vault or signing dispatch.
import {z} from 'zod';
import {prepareScopedViewJob,preparePrivateSwapViewDraft} from '../online/hinkal-view';
import {observeOwnedViewInputs,privateInputReaders} from '../online/hinkal-owned-inputs';
const policy=require('./store-payment-policy.cjs');
for(const method of ['log','info','debug','warn','error'] as const)console[method]=()=>{};
const schema=z.object({action:z.enum(['prepare-scoped-private-proof','observe-owned-private-inputs','prepare-private-swap-view-draft']),input:z.unknown(),wallet:z.unknown()}).strict();
let size=0,parts:Buffer[]=[];
const clear=()=>{parts.forEach(p=>p.fill(0));parts=[];};
process.stdin.on('data',(bytes:Buffer)=>{size+=bytes.length;if(size>1024*1024){bytes.fill(0);clear();process.exit(2);}parts.push(bytes);});
process.stdin.on('end',async()=>{let job:any;try{const raw=Buffer.concat(parts);clear();try{job=schema.parse(require('./strict-json.cjs').parseStrictJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw),1024*1024,500000));}finally{raw.fill(0);}
 policy.assertPrivateView(job.input?.request);
 let result;if(job.action==='prepare-private-swap-view-draft')result=await preparePrivateSwapViewDraft(job.input,job.wallet);else if(job.action==='prepare-scoped-private-proof')result=await prepareScopedViewJob(job.input,job.wallet);else{const chain=job.input?.request?.context?.chain;if(!['ethereum','solana'].includes(chain))throw Error();result=await observeOwnedViewInputs(job.input,job.wallet,privateInputReaders(chain));}job.input.transportPrivateKey=undefined;job=undefined;
 process.stdout.write(JSON.stringify({ok:true,result}),()=>process.exit(0));
}catch{if(job?.input&&typeof job.input==='object')job.input.transportPrivateKey=undefined;job=undefined;clear();process.stdout.write(JSON.stringify({ok:false,error:'Scoped private proof preparation failed. Preserve the original view request and session; no proof authorization or chain transaction was signed.'}),()=>process.exit(1));}});
process.stdin.on('error',()=>{clear();process.exit(2);});
