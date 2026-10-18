// Host-only actual SVM execution of hash-bound disposable guest signatures.
// Synthetic starting balances/nonce state; no RPC, secret input, or public broadcast.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {LiteSVM,FailedTransactionMetadata}=require('litesvm');
const {getTransactionDecoder}=require('@solana/kit');
const {Transaction,PublicKey,SystemProgram,SystemInstruction,NonceAccount}=require('@solana/web3.js');
const {TOKEN_PROGRAM_ID,MintLayout,AccountLayout,decodeTransferCheckedInstruction,getAssociatedTokenAddressSync}=require('@solana/spl-token');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
assert(!fs.existsSync(output),'Fresh output required');
const reportBytes=fs.readFileSync(path.join(root,'result.json')),report=JSON.parse(reportBytes);
assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
const proofBytes=fs.readFileSync(path.join(root,'token-signature-verification.json')),proof=JSON.parse(proofBytes);
assert.equal(proof.success,true);assert.equal(proof.harnessResultSha256,hash(reportBytes));assert.equal(proof.sourceImageSha256,report.sourceSha256);assert.equal(proof.actualChainSettlement,false);
function read(name){const bytes=fs.readFileSync(path.join(root,'wallet-output',name));assert.equal(hash(bytes),report.outputFiles.find(x=>x.name===name)?.sha256);assert.equal(hash(bytes),proof.fileDigests[name]);return JSON.parse(bytes);}
const request=read('unsigned-multi-request.json'),response=read('signed-multi-response.json');
assert.equal(request.standard,'spl');assert.equal(request.createRecipientAccount,true);assert.equal(request.network,'solana');assert.equal(hash(fs.readFileSync(path.join(root,'wallet-output','unsigned-multi-request.json'))),report.syntheticTransferInput.requests['unsigned-multi-request.json'].sha256);
const raw=Buffer.from(response.rawSignedTransaction,'base64'),tx=Transaction.from(raw);assert(tx.verifySignatures());assert.equal(tx.feePayer.toBase58(),request.from);assert.equal(tx.recentBlockhash,request.nonceValue);
const advance=SystemInstruction.decodeNonceAdvance(tx.instructions[0]),transfer=decodeTransferCheckedInstruction(tx.instructions[2]);assert.equal(tx.instructions.length,3);assert.equal(advance.noncePubkey.toBase58(),request.nonceAccount);assert.equal(advance.authorizedPubkey.toBase58(),request.from);assert.equal(transfer.keys.destination.pubkey.toBase58(),getAssociatedTokenAddressSync(new PublicKey(request.token),new PublicKey(request.recipient)).toBase58());assert.equal(transfer.data.amount,BigInt(request.amount));
const svm=new LiteSVM();
function set(address,data,lamports){svm.setAccount({address,programAddress:SystemProgram.programId.toBase58(),data,lamports,executable:false});}
set(request.from,Buffer.alloc(0),1000000000n);set(request.recipient,Buffer.alloc(0),1000000n);
const nonce=Buffer.alloc(80);nonce.writeUInt32LE(1,0);nonce.writeUInt32LE(1,4);new PublicKey(request.from).toBuffer().copy(nonce,8);new PublicKey(request.nonceValue).toBuffer().copy(nonce,40);nonce.writeBigUInt64LE(5000n,72);set(request.nonceAccount,nonce,1000000000n);
const mint=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:1,mintAuthority:new PublicKey(request.from),supply:1000000000n,decimals:request.decimals,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mint);
svm.setAccount({address:request.token,programAddress:TOKEN_PROGRAM_ID.toBase58(),data:mint,lamports:1000000000n,executable:false});
const source=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:new PublicKey(request.token),owner:new PublicKey(request.from),amount:1000000000n,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},source);
svm.setAccount({address:transfer.keys.source.pubkey.toBase58(),programAddress:TOKEN_PROGRAM_ID.toBase58(),data:source,lamports:1000000000n,executable:false});
const destination=transfer.keys.destination.pubkey.toBase58();assert.equal(svm.getAccount(destination).exists,false);const senderBefore=svm.getBalance(request.from);
const result=svm.sendTransaction(getTransactionDecoder().decode(raw));if(result instanceof FailedTransactionMetadata)throw Error(String(result.err())+' '+result.meta().logs().join('\n'));
const account=svm.getAccount(destination),decoded=AccountLayout.decode(Buffer.from(account.data));assert.equal(decoded.amount,BigInt(request.amount));assert.equal(decoded.owner.toBase58(),request.recipient);assert.equal(decoded.mint.toBase58(),request.token);
const senderAfter=svm.getBalance(request.from);assert.equal(senderBefore-senderAfter,account.lamports+BigInt(request.maximumFee));assert(account.lamports<=BigInt(request.accountRent));
assert.equal(AccountLayout.decode(Buffer.from(svm.getAccount(transfer.keys.source.pubkey.toBase58()).data)).amount,1000000000n-BigInt(request.amount));
const nextNonce=NonceAccount.fromAccountData(Buffer.from(svm.getAccount(request.nonceAccount).data)).nonce;assert.notEqual(nextNonce,request.nonceValue);
const replay=svm.sendTransaction(getTransactionDecoder().decode(raw));assert(replay instanceof FailedTransactionMetadata);assert.equal(AccountLayout.decode(Buffer.from(svm.getAccount(destination).data)).amount,decoded.amount);assert.equal(svm.getBalance(request.from),senderAfter);const record={kind:'exact-guest-spl-ata-local-svm-execution',sourceImageSha256:report.sourceSha256,harnessResultSha256:hash(reportBytes),signatureVerificationSha256:hash(proofBytes),executionHelperSha256:hash(fs.readFileSync(__filename)),rawSignedBytesSha256:hash(raw),transactionSignature:response.transactionHash,actualLocalSvmExecution:true,syntheticStartingAccountState:true,nonceCreatedByTransaction:false,recipientAtaCreated:true,actualRentLamports:account.lamports.toString(),deliveredBaseUnits:decoded.amount.toString(),exactSenderDebit:true,nonceConsumed:true,replayRejected:true,replayBalancesUnchanged:true,externalRPCRequests:0,publicChainSettlement:false,realFunds:0,fundingReady:false,success:true};
fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
