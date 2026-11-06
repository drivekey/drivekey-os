'use strict';
const publicHistoryQualification=require('./public-history-qualification.cjs').qualificationFromPackage(require('../package.json'));
const qualificationNotice='Public-history qualification build: wallet access, signing and submissions are disabled.';
const qualificationChannels=new Set(['application-mode','interface-settings','set-interface-zoom','list-wallets','list-updates','clear-session','start-public-history','advance-public-history','list-public-histories','cancel-public-history','public-history-progress','export-public-history','import-public-history']);

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
  'hinkal-evm-swap-reconcile', 'hinkal-solana-swap-reconcile', 'hinkal-product-chain-reconcile',
]);
const blockedIpc = new Set(['import-prepared-private', 'import-prepared-bridge', 'hinkal-discover',
  'import-provider-proof-authorization','finalize-provider-proof','export-provider-proof-result','import-private-view-request','authorize-private-view','create-private-view','export-private-view-request','export-private-view-response','import-private-view-response','prepare-private-view-job','export-private-view-job','observe-private-view-inputs','list-private-input-observations','cancel-private-input-observation','import-product-proof','review-product-proof','sign-product-proof','export-product-proof','prove-product-proof','export-product-proof-result','import-product-proof-package']);

function assertChain(chain) {
  if(publicHistoryQualification)throw Error(qualificationNotice);
  if (!chains.has(chain)) throw Error(notice);
}

function validAsset(chain, asset) {
  const policy = chains.get(chain);
  return !!policy && (asset === policy.native || asset === 'USDC');
}

function assertPaymentInput(input) {
  if(publicHistoryQualification)throw Error(qualificationNotice);
  if (!validAsset(input?.chain, input?.asset)) throw Error(notice);
}

function allowedIntent(request) {
  if(publicHistoryQualification)return false;
  return request?.version === 8 && request.action === 'payment' && validAsset(request.chain, request.asset) &&
    chains.get(request.chain).network === request.network;
}

function assertIntent(request) {
  if (!allowedIntent(request)) throw Error(notice);
}

// Product proof signing requires its own release qualification. A new request
// format or a valid circuit signature never enables this release implicitly.
function assertProductProof() { throw Error(notice); }
function assertPrivateView() { throw Error(notice); }
function assertPublicHistory(){if(!publicHistoryQualification)throw Error('Public ciphertext history is not qualified in this release.');}

function assertOnlineJob(job) {
  if(publicHistoryQualification)throw Error(qualificationNotice);
  switch (job?.action) {
    case 'hinkal-product-proof-prepare': assertProductProof(job.input?.request); return;
    case 'prepare': assertPaymentInput(job.input); return;
    case 'balance':
    case 'observed-balance': assertPaymentInput(job); return;
    case 'preflight':
    case 'broadcast': assertIntent(job.request); return;
    default: if (!reconciliation.has(job?.action)) throw Error(notice);
  }
}

function assertIpcChannel(channel) {
  if(publicHistoryQualification){if(!qualificationChannels.has(channel))throw Error(qualificationNotice);return;}
  if ((channel.startsWith('prepare-') && channel !== 'prepare-payment') || blockedIpc.has(channel)) throw Error(notice);
}

module.exports = {notice, qualificationNotice, publicHistoryQualification, assertPublicHistory, assertChain, assertPaymentInput, allowedIntent, assertIntent, assertProductProof, assertPrivateView, assertOnlineJob, assertIpcChannel};
