// Host-only actual SVM execution of hash-bound disposable guest signatures.
// Synthetic starting balances/nonce state; no RPC, secret input, or public broadcast.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {LiteSVM,FailedTransactionMetadata}=require('litesvm');
const {getTransactionDecoder}=require('@solana/kit');
const {Transaction,PublicKey,SystemProgram,SystemInstruction,NonceAccount}=require('@solana/web3.js');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
assert(!fs.existsSync(output),'Fresh output required');
const reportBytes=fs.readFileSync(path.join(root,'result.json')),report=JSON.parse(reportBytes);
assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
const proofBytes=fs.readFileSync(path.join(root,'multichain-transfer-verification.json')),proof=JSON.parse(proofBytes);
assert.equal(proof.success,true);assert.equal(proof.harnessResultSha256,hash(reportBytes));assert.equal(proof.sourceImageSha256,report.sourceSha256);assert.equal(proof.actualChainSettlement,false);
function read(name){const bytes=fs.readFileSync(path.join(root,'wallet-output',name));assert.equal(hash(bytes),report.outputFiles.find(x=>x.name===name)?.sha256);assert.equal(hash(bytes),proof.fileDigests[name]);return JSON.parse(bytes);}
const request=read('unsigned-multi-request.json'),response=read('signed-multi-response.json');
assert.equal(request.standard,'native');assert.equal(request.network,'solana');assert.equal(hash(fs.readFileSync(path.join(root,'wallet-output','unsigned-multi-request.json'))),report.syntheticTransferInput.requests['unsigned-multi-request.json'].sha256);
const raw=Buffer.from(response.rawSignedTransaction,'base64'),tx=Transaction.from(raw);assert(tx.verifySignatures());assert.equal(tx.feePayer.toBase58(),request.from);assert.equal(tx.recentBlockhash,request.nonceValue);
const advance=SystemInstruction.decodeNonceAdvance(tx.instructions[0]),transfer=SystemInstruction.decodeTransfer(tx.instructions[1]);assert.equal(tx.instructions.length,2);assert.equal(advance.noncePubkey.toBase58(),request.nonceAccount);assert.equal(advance.authorizedPubkey.toBase58(),request.from);assert.equal(transfer.toPubkey.toBase58(),request.recipient);assert.equal(BigInt(transfer.lamports),BigInt(request.amount));
const svm=new LiteSVM();
function set(address,data,lamports){svm.setAccount({address,programAddress:SystemProgram.programId.toBase58(),data,lamports,executable:false});}
set(request.from,Buffer.alloc(0),1000000000n);set(request.recipient,Buffer.alloc(0),1000000n);
const nonce=Buffer.alloc(80);nonce.writeUInt32LE(1,0);nonce.writeUInt32LE(1,4);new PublicKey(request.from).toBuffer().copy(nonce,8);new PublicKey(request.nonceValue).toBuffer().copy(nonce,40);nonce.writeBigUInt64LE(5000n,72);set(request.nonceAccount,nonce,1000000000n);
const before=svm.getBalance(request.recipient),senderBefore=svm.getBalance(request.from);
const result=svm.sendTransaction(getTransactionDecoder().decode(raw));assert(!(result instanceof FailedTransactionMetadata),'SVM rejected exact guest transaction');
const after=svm.getBalance(request.recipient),senderAfter=svm.getBalance(request.from);assert.equal(after-before,BigInt(request.amount));assert.equal(senderBefore-senderAfter,BigInt(request.amount)+BigInt(request.maximumFee));
const nextNonce=NonceAccount.fromAccountData(Buffer.from(svm.getAccount(request.nonceAccount).data)).nonce;assert.notEqual(nextNonce,request.nonceValue);
const replay=svm.sendTransaction(getTransactionDecoder().decode(raw));assert(replay instanceof FailedTransactionMetadata);assert.equal(svm.getBalance(request.recipient),after);assert.equal(svm.getBalance(request.from),senderAfter);
const record={kind:'exact-guest-native-sol-local-svm-execution',sourceImageSha256:report.sourceSha256,harnessResultSha256:hash(reportBytes),signatureVerificationSha256:hash(proofBytes),executionHelperSha256:hash(fs.readFileSync(__filename)),rawSignedBytesSha256:hash(raw),transactionSignature:response.transactionHash,actualLocalSvmExecution:true,syntheticStartingAccountState:true,nonceCreatedByTransaction:false,deliveredBaseUnits:(after-before).toString(),exactSenderDebit:true,nonceConsumed:true,replayRejected:true,replayBalancesUnchanged:true,externalRPCRequests:0,publicChainSettlement:false,realFunds:0,fundingReady:false,success:true};
fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
