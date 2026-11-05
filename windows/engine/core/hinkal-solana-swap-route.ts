import {PublicKey,ComputeBudgetProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,NATIVE_MINT} from '@solana/spl-token';
import {CHAINS} from './payment-intent';
import {HINKAL_SOLANA} from './hinkal-solana-intent';
import {inspectLifiSolana,LookupSnapshot,SolanaSwapBounds,SOLANA_LIFI} from './lifi-solana-inspect';

export const HINKAL_SWAP_FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export function hinkalSolanaSwapper(seed:string){
 if(!/^[1-9][0-9]{0,77}$/.test(seed)||BigInt(seed)>=HINKAL_SWAP_FIELD)throw Error('Invalid Hinkal swapper seed.');
 return PublicKey.findProgramAddressSync([Buffer.from('hinkal_swapper'),new PublicKey(HINKAL_SOLANA.originalDeployer).toBytes(),Buffer.from(BigInt(seed).toString(16).padStart(64,'0'),'hex')],new PublicKey(HINKAL_SOLANA.program))[0];
}
// The proposal is first decoded under the unchanged wallet-only v11 policy.
// Only then rebase the exact actor and its canonical ATAs to the pool PDA.
// Index 255 means that PDA; remaining accounts never carry a wallet signature.
export function hinkalSolanaSwapRoute(proposal:{unsignedTransaction:string,lookupTables:LookupSnapshot[],bounds:SolanaSwapBounds},seed:string){
 const r=proposal.bounds;if(r.tokenIn!=='SOL')throw Error('Only native SOL input is enabled for private Solana swaps.');
 const checked=inspectLifiSolana(proposal.unsignedTransaction,proposal.lookupTables,r),swapper=hinkalSolanaSwapper(seed),actor=new PublicKey(r.from),replace=new Map<string,string>([[actor.toBase58(),swapper.toBase58()]]);
 for(const mint of [NATIVE_MINT.toBase58(),CHAINS.solana.usdc,SOLANA_LIFI.intermediateMint])replace.set(getAssociatedTokenAddressSync(new PublicKey(mint),actor).toBase58(),getAssociatedTokenAddressSync(new PublicKey(mint),swapper,true).toBase58());
 if(checked.keys.some(k=>k.equals(swapper)))throw Error('Proposal already references the private swapper.');
 const remainingAccounts:{pubkey:PublicKey,isSigner:false,isWritable:boolean}[]=[],instructions:{programIndex:number,accountIndexes:Buffer,data:Buffer}[]=[];
 function index(address:PublicKey,writable:boolean){const value=replace.get(address.toBase58())||address.toBase58();if(value===swapper.toBase58())return 255;let i=remainingAccounts.findIndex(a=>a.pubkey.toBase58()===value);if(i<0){i=remainingAccounts.length;if(i>=64)throw Error('Private swap CPI account limit exceeded.');remainingAccounts.push({pubkey:new PublicKey(value),isSigner:false,isWritable:writable});}else if(writable)remainingAccounts[i].isWritable=true;return i;}
 for(const ix of checked.message.instructions){if(ix.programId.equals(ComputeBudgetProgram.programId))continue;if(ix.keys.some(k=>k.isSigner&&!k.pubkey.equals(actor)))throw Error('Unexpected private swap CPI signer.');const accountIndexes=Buffer.from(ix.keys.map(k=>index(k.pubkey,k.isWritable))),programIndex=index(ix.programId,false);if(programIndex===255)throw Error('Private swapper cannot be a CPI program.');instructions.push({programIndex,accountIndexes,data:Buffer.from(ix.data)});}
 if(remainingAccounts.some(a=>a.pubkey.equals(actor)||replace.has(a.pubkey.toBase58())))throw Error('Original wallet authority remains in private swap CPI.');
 return {swapper:swapper.toBase58(),instructions,remainingAccounts,review:checked.review};
}
