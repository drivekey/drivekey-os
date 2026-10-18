// Private typed transport. The existing Solana Jupiter v4 JSON format is unchanged.
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {z} from 'zod';
import {solSwapSchema,type SolSwapRequest} from '../core/sol-swap-protocol';
import {SOLANA_GENESIS} from '../core/multi-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_JUPITER_REQUEST_FRAME=28672,MAX_JUPITER_SIGN_FRAME=30720,MAX_JUPITER_RESPONSE_FRAME=2048;
class Writer{
 private chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 number(n:number,size:1|2|4,signed=false){if(!Number.isInteger(n))throw Error('Invalid boundary integer.');const b=Buffer.alloc(size);if(signed)b.writeInt32BE(n);else if(size===1)b.writeUInt8(n);else if(size===2)b.writeUInt16BE(n);else b.writeUInt32BE(n);this.chunks.push(b);}
 field(b:Uint8Array,max:number){if(b.length>max)throw Error('Boundary field exceeds limit.');this.number(b.length,2);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b)!==s)throw Error('Lossy boundary text.');this.field(b,max);}finally{b.fill(0);}}
 publicKey(s:string){this.bytes(new PublicKey(s).toBytes());}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Boundary frame exceeds limit.');}return b;}finally{for(const b of this.chunks)b.fill(0);}}
}
class Reader{
 private at=0;
 constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Boundary frame exceeds limit.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||this.at+n>this.b.length)throw Error('Truncated boundary frame.');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 number(size:1|2|4,signed=false){const b=this.bytes(size);return signed?b.readInt32BE():size===1?b.readUInt8():size===2?b.readUInt16BE():b.readUInt32BE();}
 count(max:number){const n=this.number(1);if(n>max)throw Error('Boundary count exceeds limit.');return n;}
 field(max:number){const n=this.number(2);if(n>max)throw Error('Boundary field exceeds limit.');return this.bytes(n);}
 text(max:number){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.field(max));}
 publicKey(){return new PublicKey(this.bytes(32)).toBase58();}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s,'ascii')))throw Error('Wrong boundary purpose/version.');}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
type Instruction=SolSwapRequest['build']['swapInstruction'];
function writeInstruction(w:Writer,ix:Instruction){w.publicKey(ix.programId);w.number(ix.accounts.length,1);for(const a of ix.accounts){w.publicKey(a.pubkey);w.number((a.isSigner?1:0)|(a.isWritable?2:0),1);}w.text(ix.data,1024);}
function readInstruction(r:Reader):Instruction{const programId=r.publicKey(),count=r.count(64),accounts=[];for(let i=0;i<count;i++){const pubkey=r.publicKey(),flags=r.number(1);if(flags>3)throw Error('Invalid account flags.');accounts.push({pubkey,isSigner:!!(flags&1),isWritable:!!(flags&2)});}return {programId,accounts,data:r.text(1024)};}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
// Malformed network/kind claims cannot send an otherwise selected v4 Solana
// request to the unconfined legacy fallback. EVM v4 trades remain separate.
export function isJupiterTradeShape(value:unknown):boolean{return !!value&&typeof value==='object'&&'version' in value&&value.version===4&&(('network' in value&&value.network==='solana')||'unsignedMessage' in value);}
export function encodeJupiterRequestFrame(input:unknown){
 const r=solSwapSchema.parse(input),w=new Writer(),b=r.build,route=b.routePlan[0].swapInfo;
 w.bytes(Buffer.from('DKJUPRQ1'));w.text(r.requestId,36);w.text(r.deviceId,36);w.text(r.createdAt,24576);w.text(r.expiresAt,24576);
 for(const s of [r.from,r.nonceAccount,r.nonceValue])w.publicKey(s);w.text(r.nonceFee,20);w.text(r.tokenAccountRent,20);
 w.publicKey(b.inputMint);w.publicKey(b.outputMint);for(const s of [b.inAmount,b.outAmount,b.otherAmountThreshold])w.text(s,20);w.number(b.slippageBps,1);
 for(const s of [route.ammKey,route.inputMint,route.outputMint])w.publicKey(s);w.text(route.inAmount,20);w.text(route.outAmount,20);
 writeInstruction(w,b.swapInstruction);w.number(b.setupInstructions.length,1);for(const ix of b.setupInstructions)writeInstruction(w,ix);writeInstruction(w,b.cleanupInstruction);w.number(b.computeBudgetInstructions.length,1);for(const ix of b.computeBudgetInstructions)writeInstruction(w,ix);
 const ticks=Object.entries(r.tickStarts).sort(([a],[b])=>a<b?-1:a>b?1:0);w.number(ticks.length,1);for(const [key,start] of ticks){w.publicKey(key);w.number(start,4,true);}
 w.text(r.unsignedMessage,1800);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));return w.finish(MAX_JUPITER_REQUEST_FRAME);
}
export function decodeJupiterRequestFrame(frame:Buffer):SolSwapRequest{
 const r=new Reader(frame,MAX_JUPITER_REQUEST_FRAME);r.magic('DKJUPRQ1');const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(24576),expiresAt=r.text(24576),from=r.publicKey(),nonceAccount=r.publicKey(),nonceValue=r.publicKey(),nonceFee=r.text(20),tokenAccountRent=r.text(20);
 const inputMint=r.publicKey(),outputMint=r.publicKey(),inAmount=r.text(20),outAmount=r.text(20),otherAmountThreshold=r.text(20),slippageBps=r.number(1),ammKey=r.publicKey(),routeInput=r.publicKey(),routeOutput=r.publicKey(),routeIn=r.text(20),routeOut=r.text(20),swapInstruction=readInstruction(r);
 const setupInstructions=Array.from({length:r.count(4)},()=>readInstruction(r)),cleanupInstruction=readInstruction(r),computeBudgetInstructions=Array.from({length:r.count(1)},()=>readInstruction(r));
 const tickStarts:Record<string,number>={},count=r.count(4);let previous='';for(let i=0;i<count;i++){const key=r.publicKey();if(key<=previous)throw Error('Duplicate or unordered tick key.');previous=key;tickStarts[key]=r.number(4,true);}
 const unsignedMessage=r.text(1800),fingerprint=digest(r);r.end();
 return solSwapSchema.parse({version:4,network:'solana',kind:'swap',genesisHash:SOLANA_GENESIS,requestId,deviceId,createdAt,expiresAt,from,nonceAccount,nonceValue,nonceFee,tokenAccountRent,build:{inputMint,outputMint,inAmount,outAmount,otherAmountThreshold,slippageBps,swapMode:'ExactIn',routePlan:[{percent:100,bps:10000,swapInfo:{ammKey,label:'Raydium CLMM',inputMint:routeInput,outputMint:routeOutput,inAmount:routeIn,outAmount:routeOut}}],swapInstruction,setupInstructions,cleanupInstruction,computeBudgetInstructions,otherInstructions:[],tipInstruction:null},tickStarts,unsignedMessage,fingerprint});
}
export function encodeJupiterSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid Jupiter signing command.');const w=new Writer();w.bytes(Buffer.from('DKJUPKY1'));w.field(encodeJupiterRequestFrame(request),MAX_JUPITER_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_JUPITER_SIGN_FRAME);}
export function decodeJupiterSigningFrame(frame:Buffer){const r=new Reader(frame,MAX_JUPITER_SIGN_FRAME);r.magic('DKJUPKY1');const request=decodeJupiterRequestFrame(r.field(MAX_JUPITER_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};}
const responseSchema=z.object({version:z.literal(4),network:z.literal('solana'),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),signedAt:z.string().datetime().max(64),rawSignedTransaction:z.string().max(1800),transactionHash:z.string().max(90),approvalSignature:z.string().max(90)}).strict();
function signature(s:string){const b=bs58.decode(s);if(b.length!==64||bs58.encode(b)!==s)throw Error('Invalid signature encoding.');return b;}
export function encodeJupiterResponseFrame(input:unknown){const s=responseSchema.parse(input),raw=Buffer.from(s.rawSignedTransaction,'base64');if(raw.toString('base64')!==s.rawSignedTransaction||raw.length>1232)throw Error('Invalid transaction encoding.');const w=new Writer();w.bytes(Buffer.from('DKJUPRS1'));w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);w.field(raw,1232);w.bytes(signature(s.transactionHash));w.bytes(signature(s.approvalSignature));return w.finish(MAX_JUPITER_RESPONSE_FRAME);}
export function decodeJupiterResponseFrame(frame:Buffer){const r=new Reader(frame,MAX_JUPITER_RESPONSE_FRAME);r.magic('DKJUPRS1');const requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64),rawSignedTransaction=r.field(1232).toString('base64'),transactionHash=bs58.encode(r.bytes(64)),approvalSignature=bs58.encode(r.bytes(64));r.end();return responseSchema.parse({version:4,network:'solana',requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,transactionHash,approvalSignature});}
export function decodeJupiterRouteFrame(frame:Buffer){if(frame.length!==9||!frame.subarray(0,8).equals(Buffer.from('DKJUPRT1'))||frame[8]>1)throw Error('Invalid Jupiter routing reply.');return frame[8]===1;}
