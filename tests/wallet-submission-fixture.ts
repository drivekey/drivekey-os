import type {WalletSubmissionClaim,WalletSubmissionStore} from '../core/wallet-submission-ledger';
// Single-process unit fixture only; production uses the SQL claim store.
export function walletSubmissionFixture():WalletSubmissionStore{
 const claims:WalletSubmissionClaim[]=[];
 return {
  async read(id){return claims.find(r=>r.kind==='evm'&&id.family==='evm'&&r.chainId===id.chainId&&r.hash===id.hash)??null;},
  async claim(r){if(r.kind!=='evm')throw Error('EVM fixture only');if(claims.some(v=>v.kind==='evm'&&v.chainId===r.chainId&&(v.hash===r.hash||(v.from===r.from&&v.nonce===r.nonce))))return false;claims.push({...r});return true;},
 };
}
