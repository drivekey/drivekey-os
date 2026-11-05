import {SOLANA_LIFI} from './lifi-solana-inspect';

// Only these private CPI routes have execution qualification.
// Historical signature verification does not create new signing authority.
export function assertHinkalSolanaRouteQualified(review: {ammPrograms: string[]; routeVariant?: string}) {
  const permitted = new Set<string>([
    SOLANA_LIFI.amms.GoonFiV3,
    SOLANA_LIFI.amms.RaydiumClmm,
    ...(review.routeVariant === 'shared_accounts_route_v2' ? [SOLANA_LIFI.amms.WhirlpoolSwapV2] : []),
  ]);
  if (!review.ammPrograms.length || review.ammPrograms.some(program => !permitted.has(program))) {
    throw Error('Private PDA execution is not qualified for this AMM route.');
  }
}
