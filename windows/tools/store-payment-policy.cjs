'use strict';

const notice = 'This Windows release supports direct ETH, SOL and USDC payments.';
const chains = new Map([
  ['ethereum', {network: 'ethereum', native: 'ETH'}],
  ['sepolia', {network: 'ethereum', native: 'ETH'}],
  ['solana', {network: 'solana', native: 'SOL'}],
  ['devnet', {network: 'solana', native: 'SOL'}],
]);
const reconciliation = new Set([
  'reconcile', 'uniswap-v3-reconcile', 'lifi-evm-reconcile', 'lifi-solana-reconcile',
  'lifi-relay-source-reconcile', 'lifi-relay-destination-reconcile',
  'lifi-mayan-evm-source-reconcile', 'lifi-mayan-solana-destination-reconcile',
  'mayan-evm-redeem-reconcile', 'mayan-solana-source-reconcile',
  'hinkal-direct-reconcile', 'hinkal-solana-reconcile', 'hinkal-solana-spend-reconcile',
  'hinkal-evm-swap-reconcile', 'hinkal-solana-swap-reconcile',
]);
const blockedIpc = new Set(['import-prepared-private', 'import-prepared-bridge', 'hinkal-discover',
  'import-product-proof','review-product-proof','sign-product-proof','export-product-proof']);

function assertChain(chain) {
  if (!chains.has(chain)) throw Error(notice);
}

function validAsset(chain, asset) {
  const policy = chains.get(chain);
  return !!policy && (asset === policy.native || asset === 'USDC');
}

function assertPaymentInput(input) {
  if (!validAsset(input?.chain, input?.asset)) throw Error(notice);
}

function allowedIntent(request) {
  return request?.version === 8 && request.action === 'payment' && validAsset(request.chain, request.asset) &&
    chains.get(request.chain).network === request.network;
}

function assertIntent(request) {
  if (!allowedIntent(request)) throw Error(notice);
}

// Product proof signing requires its own release qualification. A new request
// format or a valid circuit signature never enables this release implicitly.
function assertProductProof() { throw Error(notice); }

function assertOnlineJob(job) {
  switch (job?.action) {
    case 'prepare': assertPaymentInput(job.input); return;
    case 'balance':
    case 'observed-balance': assertPaymentInput(job); return;
    case 'preflight':
    case 'broadcast': assertIntent(job.request); return;
    default: if (!reconciliation.has(job?.action)) throw Error(notice);
  }
}

function assertIpcChannel(channel) {
  if ((channel.startsWith('prepare-') && channel !== 'prepare-payment') || blockedIpc.has(channel)) throw Error(notice);
}

module.exports = {notice, assertChain, assertPaymentInput, allowedIntent, assertIntent, assertProductProof, assertOnlineJob, assertIpcChannel};
