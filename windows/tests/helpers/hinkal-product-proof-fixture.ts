// Unfunded local cryptography only. Never print keys, views, vault unlock data or
// transferable responses. This one-leaf witness does not claim on-chain state.
import {randomBytes,randomUUID} from 'node:crypto';
import {createMultiVault,unlockMultiVault} from '../../engine/offline-signer/multi-vault';
import {wipeSolSecret} from '../../engine/offline-signer/sol-secret';
import {HINKAL_PIN} from '../../engine/core/hinkal-intent';
import {LIFI_EVM,LIFI_ROUTER} from '../../engine/core/lifi-evm-intent';
import {prepareLocalHinkalEvmSwap} from '../../engine/offline-signer/hinkal-local-evm-swap';
import {hinkalLocalEvmSwapFingerprint} from '../../engine/core/hinkal-local-evm-swap';
import {createProductProof} from '../../engine/core/hinkal-product-proof';
const fixture=require('../fixtures/hinkal-local-evm-authorization.json');
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),
 {UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs'),
 {Utxo}=require('../../node_modules/@hinkal/common/common/src/data-structures/utxo/Utxo.cjs'),
 math=require('../../node_modules/@hinkal/common/common/src/functions/snarkjs/common.snarkjs.cjs');
export async function productProofFixture(){
 const password='Unfunded proof fixture '+randomBytes(24).toString('hex'),vault=await createMultiVault(password),keys=await unlockMultiVault(vault,password);
 let user:any;
 try{await preProcessing();user=new UserKeys(await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage));}finally{wipeSolSecret(keys.sol);}
 const c=structuredClone(fixture.seed.job.context),now=Date.now();
 const parsed=LIFI_ROUTER.parseTransaction({data:c.routeData})!,args=parsed.args.toArray(true);
 args[5][0][0]=args[5][0][1]=LIFI_EVM.feeForwarder.address;c.routeData=LIFI_ROUTER.encodeFunctionData(parsed.fragment,args);
 c.from=c.recipient=vault.public.evmAddress;c.quoteCreatedAt=new Date(now).toISOString();c.quoteExpiresAt=new Date(now+150000).toISOString();c.pendingLeaves=[];
 const note=new Utxo({amount:BigInt(c.amount)*2n,erc20TokenAddress:'0x0000000000000000000000000000000000000000',timeStamp:String(Math.floor(now/1000)),
  nullifyingKey:user.getShieldedPrivateKey(),spendingPublicKey:user.getSpendingKeyPair().pubSpendingBJJPoint,
  randomization:UserKeys.findCorrectRandomization(123456789n,user.getShieldedPrivateKey())});
 c.inputNotes=[math.calcEncryptedOutputs([[note]])[0][0]];
 const spendingPublicKey=user.getSpendingKeyPair().pubSpendingBJJPoint.map(String),view={testOnly:true,readOnly:true,chain:'ethereum',address:vault.public.evmAddress,
  nullifyingKey:user.getShieldedPrivateKey(),spendingPublicKey};
 const commitment=BigInt(note.getCommitment()).toString(),index=(1n<<199n).toString(),merkleWitness={root:commitment,rootIndex:index,
  paths:[{commitment,index,siblings:Array(25).fill('0'),sides:Array(25).fill('0')}]};
 const job=await prepareLocalHinkalEvmSwap({context:c,view,merkleWitness}),createdAt=new Date().toISOString();
 const seed:any={version:19,kind:'hinkal-local-evm-swap-authorization',testOnly:true,requestId:randomUUID(),deviceId:vault.public.deviceId,
  createdAt,expiresAt:c.quoteExpiresAt,nonce:0,maximumFee:'100000000000000',job};seed.fingerprint=hinkalLocalEvmSwapFingerprint(seed);
 const request=createProductProof(seed,vault.public,spendingPublicKey as [string,string]);
 return {vault,password,request,view,now:Date.now()};
}
