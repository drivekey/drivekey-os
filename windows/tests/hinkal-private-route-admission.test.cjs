const {test}=require('node:test'),assert=require('node:assert/strict'),{assertHinkalSolanaRouteQualified}=require('../dist/hinkal-solana-swap-proposal.cjs'),{SOLANA_LIFI}=require('../dist/lifi-solana-inspect.cjs');
test('private CPI admission is narrower than public routing and admits only fully VM-qualified venues',()=>{
 for(const name of ['GoonFiV3','RaydiumClmm'])assert.doesNotThrow(()=>assertHinkalSolanaRouteQualified({ammPrograms:[SOLANA_LIFI.amms[name]]}));
 for(const name of ['Mercurial','KipseliV3','TesseraVV2','MeteoraDlmm','Whirlpool'])assert.throws(()=>assertHinkalSolanaRouteQualified({ammPrograms:[SOLANA_LIFI.amms[name]]}),/not qualified/);
 assert.throws(()=>assertHinkalSolanaRouteQualified({ammPrograms:[]}),/not qualified/);
 assert.throws(()=>assertHinkalSolanaRouteQualified({ammPrograms:[SOLANA_LIFI.amms.GoonFiV3,SOLANA_LIFI.amms.KipseliV3]}),/not qualified/);
});

test('shared-account Whirlpool routes require the explicitly qualified shared format',()=>{assert.doesNotThrow(()=>assertHinkalSolanaRouteQualified({ammPrograms:[SOLANA_LIFI.amms.WhirlpoolSwapV2,SOLANA_LIFI.amms.RaydiumClmm],routeVariant:'shared_accounts_route_v2'}));assert.throws(()=>assertHinkalSolanaRouteQualified({ammPrograms:[SOLANA_LIFI.amms.KipseliV3],routeVariant:'shared_accounts_route_v2'}),/not qualified/);});
