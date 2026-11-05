import {HINKAL_SOLANA} from './hinkal-solana-intent';
// A proof's historical root stays fixed. Concurrent appends are safe only while
// the exact signed transaction's output-root account remains the current bucket.
export function assertHinkalSolanaAppendCursor(prepared:string,current:string,outputs:number){
 if(!/^(0|[1-9][0-9]*)$/.test(prepared)||!/^(0|[1-9][0-9]*)$/.test(current)||![1,2].includes(outputs))throw Error('Invalid private-pool append cursor.');
 const a=BigInt(prepared)-HINKAL_SOLANA.minimumMerkleIndex,b=BigInt(current)-HINKAL_SOLANA.minimumMerkleIndex,cap=HINKAL_SOLANA.rootBucketCap;
 if(a<0n||b<a||b/cap>=(1n<<64n)||a/cap!==b/cap||b%cap+BigInt(outputs)>cap)throw Error('Private pool cursor moved backwards or requires an unapproved root bucket.');
 return {prepared,current,concurrentAppends:(b-a).toString(),rootBucket:(b/cap).toString()};
}
