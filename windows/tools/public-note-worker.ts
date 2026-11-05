// Network-only public download. No wallet, passphrase or private capability.
import {z} from 'zod';
import {OnlineAdapter} from '../online/adapter';
import {downloadPublicNoteSnapshot} from '../online/hinkal-note-snapshot';
const policy=require('./store-payment-policy.cjs');
for(const key of ['log','warn','error','info','debug']){(console as any)[key]=()=>{};}
let size=0;const chunks:Buffer[]=[];process.stdin.on('data',(b:Buffer)=>{size+=b.length;if(size>32768){b.fill(0);for(const part of chunks)part.fill(0);process.exit(2);}chunks.push(b);});
process.stdin.on('end',async()=>{try{const raw=Buffer.concat(chunks);let input;try{input=JSON.parse(raw.toString('utf8'));}finally{raw.fill(0);for(const b of chunks)b.fill(0);}policy.assertPrivateView();const p=z.object({chain:z.enum(['ethereum','solana'])}).strict().parse(input),urls=p.chain==='ethereum'?['https://0xrpc.io/eth','https://eth.rpc.blxrbdn.com']:['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'],result=await downloadPublicNoteSnapshot(p.chain,urls.map(url=>new OnlineAdapter({[p.chain]:url})));process.stdout.write(JSON.stringify({ok:true,result}));process.exitCode=0;}catch{process.stdout.write(JSON.stringify({ok:false,error:'Public encrypted note history could not be verified.'}));process.exitCode=1;}});
