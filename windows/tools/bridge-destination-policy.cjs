'use strict';
const {digest} = require('./acceptance-policy.cjs');
const {authorizeBridgeDestination} = require('./bridge-acceptance-policy.cjs');

function authorizeBoundBridgeDestination(manifest, sourceManifest, sourceResponse, operation, state, identity, validators, now = Date.now()) {
  const request = manifest.request;
  const proof = manifest.sourceFinality;
  if (operation.destination !== undefined) throw Error('A destination intent is already reserved. Recover its exact response.');
  if (manifest.sourceFingerprint !== identity.sourceFingerprint || manifest.sourceFingerprint !== state.sourceFingerprint || manifest.sourceFingerprint !== sourceManifest.sourceFingerprint || digest(manifest.binaryHashes) !== digest(sourceManifest.binaryHashes)) throw Error('Destination and source qualification differ.');
  if (!operation.sourceProofHash || !operation.sourceMessageHash || !Number.isSafeInteger(operation.sourceSlot) || request?.sourceSlot !== operation.sourceSlot || request.sourceMessage !== operation.sourceMessage || validators.cctpMessageHash(request.sourceMessage) !== operation.sourceMessageHash || proof?.sourceSlot !== operation.sourceSlot || proof.sourceMessageHash !== operation.sourceMessageHash || proof.sourceProofHash !== operation.sourceProofHash) throw Error('Destination is not bound to the recorded finalized source message.');
  return authorizeBridgeDestination(manifest, sourceManifest, sourceResponse, operation, state, identity, validators, now);
}
module.exports = {authorizeBoundBridgeDestination};
