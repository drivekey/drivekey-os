'use strict';
// Fresh unfunded proof with a synthetic tree and a locally assembled unsigned
// transaction. No provider preflight, signing, broadcast or settlement claim.
const {randomUUID}=require('node:crypto'),{Transaction}=require('ethers');
const {productProofFixture}=require('../../dist/hinkal-product-proof-fixture.cjs'),{localSolanaFixture}=require('./hinkal-local-solana-fixture.cjs');
const {createProductProof,productProofFingerprint}=require('../../dist/hinkal-product-proof.cjs'),{authorizeProductProof}=require('../../dist/hinkal-product-proof-signer.cjs'),{proveProductProof}=require('../../dist/hinkal-product-prover.cjs');
const {HINKAL_PIN}=require('../../dist/hinkal.cjs'),{HINKAL_SOLANA}=require('../../dist/hinkal-solana.cjs');
const {hinkalEvmSwapFingerprint,validateHinkalEvmSwap}=require('../../dist/hinkal-evm-swap.cjs'),{hinkalSolanaSwapFingerprint,validateHinkalSolanaSwap}=require('../../dist/hinkal-solana-swap.cjs'),{buildHinkalSolanaSwapWire}=require('../../dist/hinkal-solana-swap-wire.cjs');
async function admissionFixture(chain='ethereum'){
 let f;if(chain==='ethereum')f=await productProofFixture();else{const s=await localSolanaFixture();f={vault:s.vault,password:s.password,request:createProductProof(s.seed,s.vault.public,s.view.spendingPublicKey)};}
 // Choose a narrower product deadline before either authorization is created.
 f.request.expiresAt=new Date(Date.parse(f.request.expiresAt)-5000).toISOString();f.request.fingerprint=productProofFingerprint(f.request);
 const response=await authorizeProductProof(f.vault,f.password,f.request,f.request.fingerprint),result=await proveProductProof(f.vault,f.password,f.request,response,process.env.DRIVEKEY_HINKAL_ARTIFACTS),document={version:28,kind:'drivekey-hinkal-product-proof-package',request:f.request,response,result};
 function chainRequest(){
  const seed=f.request.seed,c=seed.job.context,at=Date.now(),common={requestId:randomUUID(),deviceId:f.request.deviceId,createdAt:new Date(at).toISOString(),expiresAt:f.request.expiresAt,from:c.from,recipient:c.recipient,amount:c.amount,proofSeed:structuredClone(seed),proofAuthorization:structuredClone(response.proofAuthorization.authorization)};
  if(chain==='ethereum'){
   const r={...common,version:18,provider:'hinkal-lifi-1inch',action:'hinkal-swap',chain,network:chain,tokenIn:'ETH',tokenOut:'USDC',quotedOutput:c.quotedOutput,minimumOutput:c.minimumOutput,slippageBps:c.slippageBps,maximumFee:'30000000000000',contractCodeHash:HINKAL_PIN.ethereumCodeHash,externalCodeHash:require('../../dist/hinkal-evm-swap-proof.cjs').HINKAL_NATIVE_SWAP.external.codeHash,unsignedTransaction:Transaction.from({type:2,chainId:1,nonce:seed.nonce,to:HINKAL_PIN.ethereumContract,value:0n,data:result.proof.data,gasLimit:300000n,maxFeePerGas:100000000n,maxPriorityFeePerGas:0n}).unsignedSerialized};r.fingerprint=hinkalEvmSwapFingerprint(r);return validateHinkalEvmSwap(r,at);
  }
  const r={...common,version:21,provider:'hinkal',action:'hinkal-swap',chain,network:chain,asset:'SOL',tokenOut:'USDC',minimumOutput:c.proposal.bounds.minimumOutput,maximumFee:'5000',accountRent:'10000000',blockhash:seed.chainContext.blockhash,lastValidBlockHeight:seed.chainContext.lastValidBlockHeight,merkleMIndex:seed.merkleMIndex,programDataSha256:HINKAL_SOLANA.pin.programDataSha256,unsignedTransaction:buildHinkalSolanaSwapWire(seed,result.proof.solanaArgs).unsignedTransaction};r.fingerprint=hinkalSolanaSwapFingerprint(r);return validateHinkalSolanaSwap(r,at);
 }
 return {wallet:f.vault.public,document,chainRequest,
  signEnvelope:(request,fingerprint=request.fingerprint,now=Date.now())=>require('../../dist/hinkal-product-chain-signer.cjs').signProductChain(f.vault,f.password,request,fingerprint,now),
  recoverEnvelope:(request,response)=>require('./hinkal-proof-session.cjs').child('worker.cjs',{action:'verify-saved',vault:f.vault,request,response})};
}
module.exports={admissionFixture};
