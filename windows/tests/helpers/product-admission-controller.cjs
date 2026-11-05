'use strict';
// Dialog/online preparation answers are explicit fixtures. These are not native
// approval, provider preflight, separate-device or mainnet acceptance checks.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {TransactionStore}=require('../../transaction-store.cjs'),{SignatureStore}=require('../../signature-store.cjs'),{createRecoveryStorage}=require('../../tools/recovery-storage.cjs'),{installProductAdmission}=require('../../tools/native-product-admission.cjs');
const productChain=require('../../dist/hinkal-product-chain.cjs');
const {prepareProductChain}=require('../../dist/hinkal-product-admission.cjs'),{validateHinkalEvmSwap,hinkalEvmSwapReview,assertHinkalEvmSwapWallet}=require('../../dist/hinkal-evm-swap.cjs'),{validateHinkalSolanaSwap,hinkalSolanaSwapReview,assertHinkalSolanaSwapWallet}=require('../../dist/hinkal-solana-swap.cjs');
async function admissionController(f,existing){
 const directory=existing||await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-product-admission-')),file=path.join(directory,'proof-package.json');
 try{await fs.writeFile(file,JSON.stringify(f.document),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 const storage=createRecoveryStorage(directory,{}),handlers=new Map(),window={isDestroyed:()=>false},state={wallet:structuredClone(f.wallet),offline:false,cancel:false,onlineCalls:0,pickerCalls:0,pending:null};let ui;
 const c={register:(name,fn)=>handlers.set(name,fn),getPublic:()=>state.wallet,getWindow:()=>window,getVaultHash:()=>null,isOffline:()=>state.offline,
  clearPending:()=>{state.pending=null;ui?.clear();},setPending:p=>{state.pending=p;},policy:{assertProductProof:()=>{}},dialog:{showOpenDialog:async()=>{state.pickerCalls++;return {canceled:state.cancel,filePaths:[file]};}},
  transactionStore:new TransactionStore(path.join(directory,'transactions-v1'),storage.forJournal('transactions')),
  authorizationStore:new SignatureStore(path.join(directory,'proofs-v1'),storage.forJournal('proofs')),
  resultStore:new SignatureStore(path.join(directory,'proof-results-v1'),storage.forJournal('proof-results')),
  online:async job=>{state.onlineCalls++;if(job.action!=='hinkal-product-proof-prepare')throw Error('Unexpected fixture online action');return prepareProductChain(async()=>f.chainRequest(),job.input,job.wallet);},
  validateIntent:r=>r.version===29?productChain.validateProductChain(r):r.version===18?validateHinkalEvmSwap(r):validateHinkalSolanaSwap(r),assertIntentWallet:(r,w)=>r.version===29?productChain.assertProductChainWallet(r,w):r.version===18?assertHinkalEvmSwapWallet(r,w):assertHinkalSolanaSwapWallet(r,w),reviewIntent:r=>r.version===29?productChain.productChainReview(r):r.version===18?hinkalEvmSwapReview(r):hinkalSolanaSwapReview(r)
 };ui=installProductAdmission(c);return {c,state,ui,directory,file,invoke:()=>handlers.get('import-product-proof-package')()};
}
module.exports={admissionController};
