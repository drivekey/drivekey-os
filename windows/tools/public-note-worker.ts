// Network-only public download. No wallet, passphrase or private capability.
import {z} from 'zod';
import {OnlineAdapter} from '../online/adapter';
import {downloadPublicNoteSnapshot} from '../online/hinkal-note-snapshot';
import {solanaArchiveReceiptCandidate} from '../online/solana-history-archive';
import {observeSolanaArchiveReceipts} from '../online/hinkal-solana-archive-history';
import {observePublicNoteReceipts,publicNoteEventCandidates,solanaNoteReferencePage,strictPublicHistoryJSON} from '../online/hinkal-note-history';
const policy=require('./store-payment-policy.cjs');
for(const key of ['log','warn','error','info','debug']){(console as any)[key]=()=>{};}
let size=0;const chunks:Buffer[]=[];process.stdin.on('data',(b:Buffer)=>{size+=b.length;if(size>32768){b.fill(0);for(const part of chunks)part.fill(0);process.exit(2);}chunks.push(b);});
process.stdin.on('end',async()=>{
 try{
  const raw=Buffer.concat(chunks);let input;
  try{input=require('./strict-json.cjs').parseStrictJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw),32768);}finally{raw.fill(0);for(const b of chunks)b.fill(0);}
  policy.assertPrivateView();
  const chain=z.enum(['ethereum','solana']),transactionIds=z.array(z.string().max(88)).min(1).max(4),p=z.union([
   z.object({chain}).strict(),
   z.object({chain,action:z.literal('receipt-candidates'),fromBlockNumber:z.number().int().nonnegative().safe()}).strict(),
   z.object({chain,action:z.literal('observe-receipts'),transactionIds}).strict(),
   z.object({chain:z.literal('solana'),action:z.literal('receipt-reference-page'),before:z.string().max(88).optional()}).strict(),
   z.object({chain:z.literal('solana'),action:z.literal('observe-reference-receipts'),transactionIds}).strict(),
   z.object({chain:z.literal('solana'),action:z.literal('archive-receipt-candidate'),transactionId:z.string().min(64).max(88),slot:z.number().int().nonnegative().safe()}).strict(),
   z.object({chain:z.literal('solana'),action:z.literal('observe-archive-receipts'),references:z.array(z.object({transactionId:z.string().min(64).max(88),slot:z.number().int().nonnegative().safe()}).strict()).min(1).max(4)}).strict()
  ]).parse(input),urls=p.chain==='ethereum'?['https://0xrpc.io/eth','https://eth.rpc.blxrbdn.com']:['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'],readers=urls.map(url=>new OnlineAdapter({[p.chain]:url},strictPublicHistoryJSON));let result;
  if(!('action'in p))result=await downloadPublicNoteSnapshot(p.chain,readers);
  else if(p.action==='receipt-candidates')result=await publicNoteEventCandidates(p.chain,p.fromBlockNumber);
  else if(p.action==='receipt-reference-page')result=await solanaNoteReferencePage(readers[0],p.before);
  else if(p.action==='archive-receipt-candidate')result=await solanaArchiveReceiptCandidate(p.transactionId,p.slot);
  else if(p.action==='observe-archive-receipts')result=await observeSolanaArchiveReceipts(p.references,readers);
  else result=await observePublicNoteReceipts(p.chain,p.transactionIds,readers,Date.now(),p.action==='observe-reference-receipts');
  process.stdout.write(JSON.stringify({ok:true,result}));process.exitCode=0;
 }catch{process.stdout.write(JSON.stringify({ok:false,error:'Public encrypted note history could not be verified.'}));process.exitCode=1;}
});
