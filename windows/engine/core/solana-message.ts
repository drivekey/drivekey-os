import {VersionedTransaction,TransactionMessage,PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
/** Finalized RPC metadata resolves v0 lookup addresses. Legacy remains readable. */
export function verifiedSolanaTransaction(value:any,expectedSignature:string){
 if(!Array.isArray(value?.transaction)||value.transaction[1]!=='base64'||typeof value.transaction[0]!=='string'||value.transaction[0].length>8192)throw Error('Malformed Solana transaction bytes.');
 const bytes=Buffer.from(value.transaction[0],'base64');if(bytes.toString('base64')!==value.transaction[0])throw Error('Noncanonical Solana transaction encoding.');
 const tx=VersionedTransaction.deserialize(bytes),message=tx.message,serialized=message.serialize(),count=message.header.numRequiredSignatures;
 if(!['legacy',0].includes(message.version)||count<1||count>16||tx.signatures.length!==count||bs58.encode(tx.signatures[0])!==expectedSignature)throw Error('Unsupported Solana version or signature context.');
 for(let n=0;n<count;n++)if(!nacl.sign.detached.verify(serialized,tx.signatures[n],message.staticAccountKeys[n].toBytes()))throw Error('Solana transaction signature mismatch.');
 const loaded=value.meta?.loadedAddresses,lookups=message.version===0?message.addressTableLookups:[];
 let writable:PublicKey[]=[],readonly:PublicKey[]=[];
 if(lookups.length){if(!loaded||!Array.isArray(loaded.writable)||!Array.isArray(loaded.readonly)||loaded.writable.length+loaded.readonly.length>256)throw Error('Missing finalized Solana lookup addresses.');writable=loaded.writable.map((s:string)=>new PublicKey(s));readonly=loaded.readonly.map((s:string)=>new PublicKey(s));if(writable.length!==lookups.reduce((n,l)=>n+l.writableIndexes.length,0)||readonly.length!==lookups.reduce((n,l)=>n+l.readonlyIndexes.length,0))throw Error('Solana lookup counts mismatch.');}
 const decompiled=TransactionMessage.decompile(message,{accountKeysFromLookups:{writable,readonly}}),keys=[...message.staticAccountKeys,...writable,...readonly];
 return {transaction:tx,instructions:decompiled.instructions,keys};
}
