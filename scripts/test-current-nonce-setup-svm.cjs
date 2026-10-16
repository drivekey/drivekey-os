// Actual local SVM execution. Synthetic keys and balances only; no RPC or physical USB.
const assert=require("node:assert/strict");
const {LiteSVM,FailedTransactionMetadata}=require("litesvm");
const {getTransactionDecoder}=require("@solana/kit");
const {Keypair,PublicKey,SystemProgram,Transaction,NonceAccount}=require("@solana/web3.js");
const {nonceSeed,nonceAddress,nonceCreationTransaction,unsignedNonceBytes,validateNonceQuote,verifyNonceSigned}=require(process.argv[2]);
(async()=>{
 const svm=new LiteSVM(),sponsor=Keypair.generate(),offline=Keypair.generate(),other=Keypair.generate();
 function balance(k,n){svm.setAccount({address:k.toBase58(),programAddress:SystemProgram.programId.toBase58(),data:Buffer.alloc(0),lamports:n,executable:false});}
 balance(sponsor.publicKey,1_000_000_000n);balance(offline.publicKey,1_000_000_000n);
 const wallet={version:3,deviceId:"c9a9fa85-827b-49c0-b7f0-a04f91030400",createdAt:new Date().toISOString(),evmAddress:"0x0000000000000000000000000000000000000001",solanaAddress:offline.publicKey.toBase58()};
 const q={version:2,requestId:crypto.randomUUID(),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+90000).toISOString(),kind:"drivekey-nonce-setup",genesisHash:"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",deviceId:wallet.deviceId,authority:wallet.solanaAddress,sponsor:sponsor.publicKey.toBase58(),nonceAccount:await nonceAddress(sponsor.publicKey.toBase58(),wallet.solanaAddress),seed:nonceSeed(wallet.solanaAddress),depositLamports:Number(svm.minimumBalanceForRentExemption(80n)),feeLamports:5000,blockhash:svm.latestBlockhash(),lastValidBlockHeight:150,unsignedTransaction:""};
 q.unsignedTransaction=unsignedNonceBytes(nonceCreationTransaction(q));await validateNonceQuote(q,wallet,true);
 const tx=nonceCreationTransaction(q);tx.sign(sponsor);const raw=tx.serialize();await verifyNonceSigned(raw.toString("base64"),q,wallet);
 function send(t){return svm.sendTransaction(getTransactionDecoder().decode(t.serialize()));}
 const before=svm.getBalance(q.sponsor),result=send(tx);
 if(result instanceof FailedTransactionMetadata)throw Error(result.err()+" "+result.meta().logs().join("\n"));
 const info=svm.getAccount(q.nonceAccount);assert.equal(info.lamports,BigInt(q.depositLamports));assert.equal(info.programAddress,SystemProgram.programId.toBase58());
 assert.equal(NonceAccount.fromAccountData(Buffer.from(info.data)).authorizedPubkey.toBase58(),wallet.solanaAddress);
 assert.equal(before-svm.getBalance(q.sponsor),BigInt(q.depositLamports+q.feeLamports));
 assert(send(tx) instanceof FailedTransactionMetadata);
 svm.expireBlockhash();
 const nonce=new PublicKey(q.nonceAccount),attempts=[
  SystemProgram.nonceAdvance({noncePubkey:nonce,authorizedPubkey:sponsor.publicKey}),
  SystemProgram.nonceWithdraw({noncePubkey:nonce,authorizedPubkey:sponsor.publicKey,toPubkey:sponsor.publicKey,lamports:q.depositLamports}),
  SystemProgram.assign({accountPubkey:nonce,basePubkey:sponsor.publicKey,seed:q.seed,programId:other.publicKey}),
 ];
 for(const instruction of attempts){const attack=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:svm.latestBlockhash()}).add(instruction);attack.sign(sponsor);assert(send(attack) instanceof FailedTransactionMetadata,"Sponsor must not gain nonce control");}
 const advance=new Transaction({feePayer:offline.publicKey,recentBlockhash:svm.latestBlockhash()}).add(SystemProgram.nonceAdvance({noncePubkey:nonce,authorizedPubkey:offline.publicKey}));advance.sign(offline);
 const ok=send(advance);if(ok instanceof FailedTransactionMetadata)throw Error(ok.err()+" "+ok.meta().logs().join("\n"));
 assert.notEqual(NonceAccount.fromAccountData(Buffer.from(svm.getAccount(q.nonceAccount).data)).nonce,NonceAccount.fromAccountData(Buffer.from(info.data)).nonce);
 console.log(JSON.stringify({localSvm:true,mainnet:false,currentQuoteVersion:2,sourceOnlyNotGuest:true,syntheticStartingBalances:true,publicNetworkBroadcast:false,fundingReady:false,creationExecuted:true,exactDebit:true,duplicateRejected:true,sponsorAdvanceRejected:true,sponsorWithdrawRejected:true,sponsorReassignRejected:true,offlineAuthorityAdvanceSucceeded:true,depositLamports:q.depositLamports},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
