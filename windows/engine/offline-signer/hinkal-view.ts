import {unlockMultiVault} from './multi-vault';
import {retainedSolSecret,wipeSolSecret} from './sol-secret';
import {HINKAL_PIN} from '../core/hinkal-intent';
import {validateViewRequest,assertViewWallet,viewResponseMessage,verifyViewResponse} from '../core/hinkal-view';
import {sealPrivateView} from '../core/hinkal-view-crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs');
export async function authorizePrivateView(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateViewRequest(JSON.parse(JSON.stringify(input)),now);assertViewWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Private view review changed.');
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),keys=await unlockMultiVault(vault,password);let login:Uint8Array|undefined,view:any;
 try{await preProcessing();const signingAt=clock();validateViewRequest(r,signingAt);let identity;
  if(r.context.chain==='ethereum')identity=new UserKeys(await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage));
  else{login=nacl.sign.detached(Buffer.from(HINKAL_PIN.sdkLoginMessage),retainedSolSecret(keys.sol));identity=new UserKeys('0x'+Buffer.from(login).toString('hex'));}
  view={version:1,chain:r.context.chain,address:r.context.from,nullifyingKey:identity.getShieldedPrivateKey(),spendingPublicKey:identity.getSpendingKeyPair().pubSpendingBJJPoint.map(String),readOnly:true};
  const response={version:30,kind:'drivekey-hinkal-view-response',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,authorizedAt:new Date(signingAt).toISOString(),sealed:sealPrivateView(r,view),walletAuthorization:'',blockchainTransactionSigned:false,submitted:false};
  const message=viewResponseMessage(r,response);response.walletAuthorization=r.context.chain==='ethereum'?await keys.evm.signMessage(message):bs58.encode(nacl.sign.detached(Buffer.from(message),retainedSolSecret(keys.sol)));
  return verifyViewResponse(r,response,clock(),false);
 }finally{login?.fill(0);if(view)view.nullifyingKey=undefined;wipeSolSecret(keys.sol);}
}
