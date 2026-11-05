'use strict';

const {Transaction} = require('ethers');
const {buildLifiRelayEvmData, lifiRelayFingerprint} = require('../../dist/lifi-relay.cjs');

// Re-encode only the forwarding target in this unsigned fixture. The provider's
// signed order and the original historical fixture remain byte-for-byte intact.
function currentRelayRequest(input) {
  const request = structuredClone(input);
  if (request.version === 26) {
    const transaction = Transaction.from(request.unsignedTransaction);
    transaction.data = buildLifiRelayEvmData(request);
    request.unsignedTransaction = transaction.unsignedSerialized;
    request.fingerprint = lifiRelayFingerprint(request);
  }
  return request;
}

module.exports = {currentRelayRequest};
