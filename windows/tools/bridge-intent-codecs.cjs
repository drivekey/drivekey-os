'use strict';
// Shared desktop dispatch. This module has no Electron, networking or secrets.
const a=require('../dist/lifi-mayan-evm.cjs'),b=require('../dist/mayan-solana.cjs'),c=require('../dist/mayan-evm-redeem.cjs');
const relay=require('../dist/lifi-relay.cjs'),relayCodec={validate:relay.validateLifiRelay,review:relay.lifiRelayReview,verify:relay.verifyLifiRelayResponse,assertWallet:relay.assertLifiRelayWallet,action:'lifi-relay-source-'};
const codecs=new Map([
 [25,relayCodec],[26,relayCodec],
 [22,{validate:a.validateLifiMayanEvm,review:a.lifiMayanEvmReview,verify:a.verifyLifiMayanEvmResponse,assertWallet:a.assertLifiMayanEvmWallet,action:'lifi-mayan-evm-source-'}],
 [23,{validate:b.validateMayanSolana,review:b.mayanSolanaReview,verify:b.verifyMayanSolanaResponse,assertWallet:b.assertMayanSolanaWallet,action:'mayan-solana-source-'}],
 [24,{validate:c.validateMayanEvmRedeem,review:c.mayanEvmRedeemReview,verify:c.verifyMayanEvmRedeemResponse,assertWallet:c.assertMayanEvmRedeemWallet,action:'mayan-evm-redeem-'}]
]);
const bridgeCodec=r=>codecs.get(r?.version);
module.exports={bridgeCodec};
