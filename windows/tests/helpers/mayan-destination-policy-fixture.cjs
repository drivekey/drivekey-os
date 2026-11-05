'use strict';
const {Transaction, keccak256} = require('ethers');
const {digest} = require('../../tools/acceptance-policy.cjs');
const fixture = require('../fixtures/mayan-evm-redeem-local.json');
function setup() {
  const request = structuredClone(fixture.request);
  const source = request.sourceRequest;
  const now = Date.parse(request.createdAt) + 1000;
  const fingerprint = 'a'.repeat(64);
  const endpoints = ['https://one.example', 'https://two.example'];
  const identity = {sourceFingerprint: fingerprint, source: {deviceId: request.deviceId, evmAddress: request.from, solanaAddress: source.from}};
  const state = {sessionId: '8e6394cc-f233-49e1-b531-2fd56340bb16', sourceFingerprint: fingerprint, operations: []};
  const sourceManifest = {request: source, sourceFingerprint: fingerprint, binaryHashes: {'worker.cjs': 'b'.repeat(64)}};
  const operation = {kind: 'bridge', state: 'bridge-destination-pending', sourceVersion: 23, fingerprint: source.fingerprint,
    manifestHash: digest(sourceManifest), routeId: 'mayan-solana-ethereum', transactionHash: request.sourceResponse.transactionHash,
    sourceProofHash: 'c'.repeat(64), sourceMessage: request.sourceMessage, sourceMessageHash: keccak256(request.sourceMessage), sourceSlot: request.sourceSlot,
    actualSourceUsdMicros: '1163432', reservedUsdMicros: '1900000', destinationReservedUsdMicros: '300000'};
  state.operations.push(operation);
  const transaction = Transaction.from(request.unsignedTransaction);
  const manifest = {version: 1, kind: 'disposable-bridge-destination-authorization', sessionId: state.sessionId,
    sourceFingerprint: fingerprint, binaryHashes: sourceManifest.binaryHashes, request, requestFingerprint: request.fingerprint,
    parentFingerprint: operation.fingerprint, parentManifestHash: operation.manifestHash, routeId: operation.routeId,
    source: request.from, destination: request.recipient, chainId: 1, contractTarget: transaction.to,
    minimumOutput: request.minimumOutput, maximumFee: request.maximumFee, nonce: transaction.nonce, deadline: request.expiresAt,
    sourceTransactionHash: operation.transactionHash, destinationMessageHash: keccak256(request.attestedMessage),
    valuation: {observedAt: now, sources: endpoints, usdcUsdMicros: '1000000', ethereumUsdMicros: '3000000000', solanaUsdMicros: '100000000', solanaLowerUsdMicros: '99000000'},
    simulation: {passed: true, fingerprint: request.fingerprint, observedAt: now, endpoints},
    sourceFinality: {transactionHash: operation.transactionHash, finalized: true, observedAt: now, endpoints,
      sourceSlot: operation.sourceSlot, sourceMessageHash: operation.sourceMessageHash, sourceProofHash: operation.sourceProofHash},
    nativeReserve: '100000000000000', nativeBalance: '1000000000000000000'};
  return {manifest, sourceManifest, sourceResponse: request.sourceResponse, operation, state, identity, now};
}
module.exports = {setup};
