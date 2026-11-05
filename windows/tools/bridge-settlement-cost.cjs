'use strict';
const {Transaction} = require('ethers');
const {cost, digest} = require('./acceptance-policy.cjs');
const {independent} = require('./independent-sources.cjs');
const {lifiMayanEvmSourceSettlement} = require('../dist/lifi-mayan-evm-source.cjs');
const {mayanSolanaSourceSettlement} = require('../dist/mayan-solana-settlement.cjs');
const {mayanEvmRedeemSettlement} = require('../dist/mayan-evm-redeem-settlement.cjs');
const {lifiMayanSolanaSettlement} = require('../dist/lifi-mayan-solana-settlement.cjs');
const {bindCctpSolanaReceipt} = require('../dist/cctp-solana-receipt.cjs');
const {verifyCctpSolanaLookups} = require('../dist/cctp-solana-lookups.cjs');

function observationsRequired(observations, now) {
  if (!Array.isArray(observations) || observations.length !== 2 || !independent(observations.map(item => item.endpoint)) || observations.some(item => !Number.isSafeInteger(item.observedAt) || item.observedAt > now || now - item.observedAt > 120000 || !item.result)) throw Error('Two fresh independent bridge observations are required.');
}
function ethereumFinality(value, response) {
  const hash = response.transactionHash;
  const {receipt, canonicalBlock, previousBlock, finalizedBlock} = value;
  if (value.finalityVerified !== true || !receipt || receipt.transactionHash !== hash || receipt.status !== '0x1' || !canonicalBlock || canonicalBlock.hash !== receipt.blockHash || BigInt(canonicalBlock.number) !== BigInt(receipt.blockNumber) || !Array.isArray(canonicalBlock.transactions) || !canonicalBlock.transactions.includes(hash) || !finalizedBlock || BigInt(finalizedBlock.number) < BigInt(receipt.blockNumber) || previousBlock?.hash !== canonicalBlock.parentHash || BigInt(previousBlock.number) + 1n !== BigInt(canonicalBlock.number)) throw Error('Canonical finalized Ethereum bridge inclusion differs.');
  const transaction = value.observedTransaction;
  if (transaction?.type !== '0x2') throw Error('Observed bridge transaction type differs.');
  const nonce = Number(BigInt(transaction.nonce));
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw Error('Unsafe bridge nonce.');
  const reconstructed = Transaction.from({type: 2, chainId: BigInt(transaction.chainId), nonce,
    gasLimit: BigInt(transaction.gas), maxFeePerGas: BigInt(transaction.maxFeePerGas), maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
    to: transaction.to, value: BigInt(transaction.value), data: transaction.input, accessList: transaction.accessList || [],
    signature: {r: transaction.r, s: transaction.s, yParity: Number(BigInt(transaction.yParity ?? transaction.v))}});
  const approved = Transaction.from(response.rawSignedTransaction);
  if (reconstructed.serialized !== response.rawSignedTransaction || BigInt(receipt.gasUsed) < 21000n || BigInt(receipt.gasUsed) > approved.gasLimit || BigInt(receipt.effectiveGasPrice) < 0n || BigInt(receipt.effectiveGasPrice) > approved.maxFeePerGas) throw Error('Observed bridge signature, gas usage or effective fee differs.');
}
function solanaFinality(value) {
  const status = value.finalizedStatus;
  if (value.finalityVerified !== true || status?.confirmationStatus !== 'finalized' || status.err !== null || !Number.isSafeInteger(value.receipt?.slot) || value.receipt.slot < 1 || status.slot !== value.receipt.slot) throw Error('Finalized Solana bridge inclusion differs.');
}
function sourceValue(request, response, value) {
  if (value.sourceState !== 'confirmed') throw Error('Bridge source is not confirmed.');
  if (request.version === 22) {
    ethereumFinality(value, response);
    if (value.allowance !== '0') throw Error('Exact source bridge allowance was not consumed.');
    const settled = lifiMayanEvmSourceSettlement(request, response, value.receipt, value.observedTransaction);
    if (BigInt(value.sourceNativeBalanceBefore) - BigInt(value.sourceNativeBalanceAfter) !== BigInt(settled.actualFeeBaseUnits) || BigInt(value.sourceUsdcBefore) - BigInt(value.sourceUsdcAfter) !== BigInt(request.amount)) throw Error('Bridge source balance interval differs.');
    return {...settled, sourceBlockHash: value.receipt.blockHash, sourceBlockNumber: value.receipt.blockNumber, actualGrossAccountFundingBaseUnits: '0'};
  }
  if (request.version !== 23) throw Error('Unknown bridge source version.');
  solanaFinality(value);
  if (!Number.isSafeInteger(value.messageAccountContextSlot) || value.messageAccountContextSlot < value.receipt.slot) throw Error('Source message account lacks finalized execution context.');
  const settled = mayanSolanaSourceSettlement(request, response, value.receipt, value.messageAccount);
  return {...settled, sourceTransactionHash: response.transactionHash, sourceSlot: value.receipt.slot};
}
function bridgeSourceCost(request, response, observations, valuation, now = Date.now()) {
  observationsRequired(observations, now);
  const values = observations.map(item => sourceValue(request, response, item.result.source || item.result));
  const stable = value => ({sourceTransactionHash: value.sourceTransactionHash, sourceMessage: value.sourceMessage, sourceMessageHash: value.sourceMessageHash, sourceSlot: value.sourceSlot, sourceBlockHash: value.sourceBlockHash, sourceBlockNumber: value.sourceBlockNumber, actualFeeBaseUnits: value.actualFeeBaseUnits, actualGrossAccountFundingBaseUnits: value.actualGrossAccountFundingBaseUnits});
  const first = stable(values[0]);
  if (digest(first) !== digest(stable(values[1]))) throw Error('Independent bridge source proofs disagree.');
  const nativePrice = request.version === 22 ? valuation.ethereumUsdMicros : valuation.solanaUsdMicros;
  const nativeDecimals = request.version === 22 ? 18 : 9;
  const nativeDebit = BigInt(first.actualFeeBaseUnits) + BigInt(first.actualGrossAccountFundingBaseUnits);
  const actual = cost(request.amount, valuation.usdcUsdMicros, 6) + cost(nativeDebit.toString(), nativePrice, nativeDecimals);
  return {...first, actualSourceUsdMicros: actual.toString(), sourceProofHash: digest({fingerprint: request.fingerprint, amount: request.amount, ...first}), sourceState: 'confirmed', completeRoute: false};
}
function holdBridgeSource(operation, actual) {
  if (operation.kind !== 'bridge' || !['submitting', 'pending', 'uncertain', 'fixture-gate-consumed', 'bridge-destination-pending'].includes(operation.state) || operation.actualUsdMicros !== undefined || BigInt(actual.actualSourceUsdMicros) > BigInt(operation.sourceMaximumUsdMicros) || BigInt(actual.actualSourceUsdMicros) > BigInt(operation.reservedUsdMicros) || operation.sourceProofHash && operation.sourceProofHash !== actual.sourceProofHash) throw Error('Source-only settlement cannot release or change the bridge reservation.');
  return {...operation, ...actual, state: 'bridge-destination-pending', completeRoute: false};
}
async function providerDestination(request, response, source, observation) {
  const value = observation.result;
  const destination = value.destination;
  if (value.state !== 'confirmed' || value.completeRoute !== true || value.sourceTransactionHash !== response.transactionHash || !destination) throw Error('Provider status or source inclusion cannot settle the destination.');
  solanaFinality(destination);
  const bound = bindCctpSolanaReceipt(destination.receipt, value.destinationTransactionHash, value.attestedMessage, value.attestation);
  const snapshots = destination.lookupAccountSnapshots;
  if (!Array.isArray(snapshots)) throw Error('Destination lookup account evidence is absent.');
  await verifyCctpSolanaLookups({rpc: async (chain, method, params) => {
    if (chain !== 'solana' || method !== 'getAccountInfo') throw Error('Unexpected offline lookup verification request.');
    const matches = snapshots.filter(item => item.address === params[0]);
    if (matches.length !== 1) throw Error('Missing or duplicate finalized lookup account.');
    return matches[0].response;
  }}, bound, destination.receipt.slot);
  if (!Number.isSafeInteger(destination.nonceAccountContextSlot) || destination.nonceAccountContextSlot < destination.receipt.slot) throw Error('Destination used nonce lacks finalized execution context.');
  const settled = lifiMayanSolanaSettlement(request, response, source.sourceMessage, value.attestedMessage, value.attestation, value.attesterState, destination.receipt, value.destinationTransactionHash, destination.nonceAccount);
  return {destinationTransactionHash: settled.transactionHash, output: settled.output, recipient: settled.recipient, attestedMessageHash: settled.attestedMessageHash, destinationSlot: settled.slot, actualDestinationFeeBaseUnits: '0', providerPaidFeeBaseUnits: settled.destinationNetworkFeeBaseUnits};
}
function selfDestination(request, response, source, parentRequest, parentResponse, observation) {
  const value = observation.result;
  if (request?.version !== 24 || value.state !== 'confirmed' || value.completeRoute !== true || digest(request.sourceRequest) !== digest(parentRequest) || digest(request.sourceResponse) !== digest(parentResponse) || request.sourceMessage !== source.sourceMessage || request.sourceSlot !== source.sourceSlot) throw Error('Redemption is not bound to the held source proof.');
  ethereumFinality(value, response);
  const settled = mayanEvmRedeemSettlement(request, response, value.receipt, value.observedTransaction, value.recipientBalanceBefore, value.recipientBalanceAfter);
  if (BigInt(value.sourceNativeBalanceBefore) - BigInt(value.sourceNativeBalanceAfter) !== BigInt(settled.actualFeeBaseUnits)) throw Error('Redemption native fee debit differs.');
  return {destinationTransactionHash: settled.destinationTransactionHash, output: settled.output, recipient: settled.recipient, attestedMessageHash: settled.attestedMessageHash, destinationBlockHash: value.receipt.blockHash, actualDestinationFeeBaseUnits: settled.actualFeeBaseUnits};
}
async function bridgeRouteCost({sourceRequest, sourceResponse, sourceObservations, sourceValuation, destinationRequest, destinationResponse, destinationObservations, destinationValuation}, now = Date.now()) {
  const source = bridgeSourceCost(sourceRequest, sourceResponse, sourceObservations, sourceValuation, now);
  observationsRequired(destinationObservations, now);
  const values = await Promise.all(destinationObservations.map(item => sourceRequest.version === 22
    ? providerDestination(sourceRequest, sourceResponse, source, item)
    : selfDestination(destinationRequest, destinationResponse, source, sourceRequest, sourceResponse, item)));
  if (digest(values[0]) !== digest(values[1])) throw Error('Independent destination settlement proofs disagree.');
  const destination = values[0];
  const destinationCost = sourceRequest.version === 23 ? cost(destination.actualDestinationFeeBaseUnits, destinationValuation.ethereumUsdMicros, 18) : 0n;
  return {...source, ...destination, actualDestinationUsdMicros: destinationCost.toString(), actualUsdMicros: (BigInt(source.actualSourceUsdMicros) + destinationCost).toString(), completeRoute: true, sourceFinalityVerified: true, destinationFinalityVerified: true, providerStatusUsedAsSettlement: false};
}
module.exports = {bridgeSourceCost, holdBridgeSource, bridgeRouteCost};
