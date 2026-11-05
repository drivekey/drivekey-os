'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {digest} = require('./acceptance-policy.cjs');
const {authorizeBridgeSource} = require('./bridge-acceptance-policy.cjs');
const {authorizeBoundBridgeDestination} = require('./bridge-destination-policy.cjs');
const {bridgeSourceCost, holdBridgeSource, bridgeRouteCost} = require('./bridge-settlement-cost.cjs');
const {validateLifiMayanEvm, MAYAN_EVM_PINS} = require('../dist/lifi-mayan-evm.cjs');
const {validateMayanSolana} = require('../dist/mayan-solana.cjs');
const {validateMayanEvmRedeem} = require('../dist/mayan-evm-redeem.cjs');
const {MAYAN_SOLANA} = require('../dist/mayan-solana-wire.cjs');
const {MAYAN_SOLANA_DESTINATION} = require('../dist/lifi-mayan-evm-source.cjs');
const {keccak256: cctpMessageHash} = require('ethers');
const validators = {validateLifiMayanEvm, validateMayanSolana, validateMayanEvmRedeem, cctpMessageHash,
  mayanSolanaProgram: MAYAN_SOLANA.program, lifiMayanSpender: MAYAN_EVM_PINS.diamond.address,
  mayanSolanaRelayer: MAYAN_SOLANA_DESTINATION.authorizedRelayer};
const actions = new Set(['sign-mayan-source', 'record-mayan-source', 'sign-mayan-destination', 'recover-mayan-destination', 'take-mayan-destination-submission', 'take-fixture-mayan-destination-submission', 'record-mayan-route']);

// All calls run under the same protected-profile lock as existing operations.
// Context functions are the existing DPAPI, qualified package and worker boundary.
async function handleBridgeAction(job, context) {
  const {dir, identity, lock, json, write, dpapi, worker, verifySigned, persistSignedResponse, qualifiedManifest, assertEvidenceClass} = context;
  if (!actions.has(job.action)) throw Error('Unknown protected bridge action.');
  const unlock = await lock(dir);
  try {
    const ledgerFile = path.join(dir, 'ledger.json');
    const state = json(ledgerFile);
    const save = () => write(ledgerFile, JSON.stringify(state));
    const responseAt = base => {
      const bytes = dpapi('unprotect', fs.readFileSync(base + '.response.dpapi'));
      try {return JSON.parse(bytes);} finally {bytes.fill(0);}
    };
    const sourceRecord = fingerprint => {
      const operation = state.operations.find(value => value.fingerprint === fingerprint);
      if (operation?.kind !== 'bridge') throw Error('No held bridge source reservation.');
      const base = path.join(dir, operation.fingerprint.slice(2));
      const manifest = json(base + '.manifest.json');
      if (digest(manifest) !== operation.manifestHash) throw Error('Protected source manifest changed.');
      const response = responseAt(base);
      verifySigned(response, manifest.request, identity.source, false);
      if (response.transactionHash !== operation.transactionHash) throw Error('Protected source hash differs from its ledger.');
      return {operation, manifest, response};
    };
    const destinationRecord = operation => {
      const destination = operation.destination;
      if (!destination || !/^0x[0-9a-f]{64}$/.test(destination.fingerprint)) throw Error('No reserved destination intent.');
      const base = path.join(dir, destination.fingerprint.slice(2));
      const manifest = json(base + '.manifest.json');
      if (digest(manifest) !== destination.manifestHash || manifest.parentFingerprint !== operation.fingerprint || manifest.parentManifestHash !== operation.manifestHash) throw Error('Protected destination manifest changed.');
      const response = responseAt(base);
      verifySigned(response, manifest.request, identity.source, false);
      if (destination.transactionHash && response.transactionHash !== destination.transactionHash) throw Error('Protected destination hash differs from its ledger.');
      return {destination, manifest, response};
    };
    const sign = (manifest, base) => {
      if (identity.fixtureOnly !== true) require('./packaged-test-worker.cjs').packagedTestWorker(path.resolve(__dirname, '..'));
      const key = dpapi('unprotect', fs.readFileSync(path.join(dir, 'source.unlock.dpapi')));
      let response;
      const execution = {};
      try {
        response = worker({action: 'sign', vault: json(path.join(dir, 'source.vault.json')), password: key.toString('utf8'), request: manifest.request, fingerprint: manifest.request.fingerprint}, 'worker.cjs', identity.fixtureOnly !== true, base + '.execution.json', execution);
      } finally {key.fill(0);}
      verifySigned(response, manifest.request, identity.source, false);
      persistSignedResponse(base, response, execution);
      return response;
    };

    if (job.action === 'sign-mayan-source') {
      assertEvidenceClass(job.manifest, identity);
      await qualifiedManifest(job.manifest, identity);
      const operation = authorizeBridgeSource(job.manifest, state, identity, validators);
      const base = path.join(dir, operation.fingerprint.slice(2));
      if (fs.existsSync(base + '.manifest.json') || fs.existsSync(base + '.response.dpapi')) throw Error('Source signature artifacts already exist. Recover them.');
      // Generic source recovery understands this state. The bridge kind keeps
      // generic settlement from releasing the parent reservation.
      operation.state = 'reserved';
      write(base + '.manifest.json', JSON.stringify(job.manifest));
      state.operations.push(operation);
      save();
      const response = sign(job.manifest, base);
      operation.state = 'signed';
      operation.transactionHash = response.transactionHash;
      save();
      return {transactionHash: response.transactionHash, fingerprint: operation.fingerprint, reservedUsdMicros: operation.reservedUsdMicros, responsePersisted: true};
    }

    if (job.action === 'record-mayan-source') {
      assertEvidenceClass({fixtureOnly: job.fixtureOnly, preflight: {synthetic: job.synthetic}}, identity);
      const {operation, manifest, response} = sourceRecord(job.fingerprint);
      if (!['submitting', 'pending', 'uncertain', 'fixture-gate-consumed', 'bridge-destination-pending', 'settled'].includes(operation.state)) throw Error('Source has no consumed submission capability.');
      const actual = bridgeSourceCost(manifest.request, response, job.observations, manifest.valuation);
      if (operation.sourceProofHash) {
        if (Object.entries(actual).some(([key, value]) => key !== 'completeRoute' && operation[key] !== value) || operation.sourceProofHash !== actual.sourceProofHash) throw Error('Previously recorded source proof changed.');
        return operation;
      }
      Object.assign(operation, holdBridgeSource(operation, actual), {sourceFinality: job.observations, sourceConfirmedAt: new Date().toISOString()});
      if (manifest.request.version === 22) state.permissions = (state.permissions || []).filter(permission => permission.routeId !== operation.routeId || permission.spender.toLowerCase() !== validators.lifiMayanSpender.toLowerCase());
      save();
      return operation;
    }

    if (job.action === 'sign-mayan-destination') {
      assertEvidenceClass(job.manifest, identity);
      await qualifiedManifest(job.manifest, identity);
      const {operation, manifest, response} = sourceRecord(job.manifest.parentFingerprint);
      const authorized = authorizeBoundBridgeDestination(job.manifest, manifest, response, operation, state, identity, validators);
      const base = path.join(dir, authorized.destinationFingerprint.slice(2));
      if (fs.existsSync(base + '.manifest.json') || fs.existsSync(base + '.response.dpapi')) throw Error('Destination artifacts already exist. Recover them.');
      write(base + '.manifest.json', JSON.stringify(job.manifest));
      operation.destination = {fingerprint: authorized.destinationFingerprint, manifestHash: authorized.destinationManifestHash, remainingMaximumUsdMicros: authorized.remainingMaximumUsdMicros, state: 'reserved', reservedAt: new Date().toISOString()};
      save();
      const signed = sign(job.manifest, base);
      operation.destination.state = 'signed';
      operation.destination.transactionHash = signed.transactionHash;
      save();
      return {transactionHash: signed.transactionHash, fingerprint: authorized.destinationFingerprint, parentFingerprint: operation.fingerprint, responsePersisted: true};
    }

    if (['recover-mayan-destination', 'take-mayan-destination-submission', 'take-fixture-mayan-destination-submission'].includes(job.action)) {
      const operation = state.operations.find(value => value.kind === 'bridge' && value.destination?.fingerprint === job.fingerprint);
      if (!operation) throw Error('No protected destination reservation.');
      const record = destinationRecord(operation);
      const destination = record.destination;
      if (destination.state === 'reserved') {
        if (destination.transactionHash || destination.broadcastAttempts || destination.fixtureSubmissionAttempts) throw Error('Ambiguous destination signature. Reconcile without signing.');
        destination.state = 'signed';
        destination.transactionHash = record.response.transactionHash;
        destination.recoveredDurableResponseAt = new Date().toISOString();
        save();
      }
      if (job.action !== 'recover-mayan-destination') {
        const fixtureGate = job.action === 'take-fixture-mayan-destination-submission';
        if (fixtureGate !== (identity.fixtureOnly === true)) throw Error('Destination gate classification differs.');
        assertEvidenceClass(record.manifest, identity);
        await qualifiedManifest(record.manifest, identity);
        verifySigned(record.response, record.manifest.request, identity.source, true);
        if (destination.state !== 'signed' || operation.state !== 'bridge-destination-pending') throw Error('Destination submission gate was consumed. Reconcile only.');
        destination.state = fixtureGate ? 'fixture-gate-consumed' : 'submitting';
        destination[fixtureGate ? 'fixtureSubmissionAttempts' : 'broadcastAttempts'] = 1;
        destination.submittingAt = new Date().toISOString();
        save();
      }
      return {...record, request: record.manifest.request, operation: destination, parentFingerprint: operation.fingerprint, networkBroadcastAllowed: job.action === 'take-mayan-destination-submission' && identity.fixtureOnly !== true};
    }

    assertEvidenceClass({fixtureOnly: job.fixtureOnly, preflight: {synthetic: job.synthetic}}, identity);
    const {operation, manifest, response} = sourceRecord(job.fingerprint);
    if (!['bridge-destination-pending', 'settled'].includes(operation.state) || !operation.sourceProofHash) throw Error('Complete-route recording requires its finalized source hold.');
    const destination = manifest.request.version === 23 ? destinationRecord(operation) : undefined;
    if (destination && !['submitting', 'fixture-gate-consumed', 'settled'].includes(destination.destination.state)) throw Error('Destination submission capability was not consumed.');
    const actual = await bridgeRouteCost({sourceRequest: manifest.request, sourceResponse: response,
      sourceObservations: job.sourceObservations, sourceValuation: manifest.valuation,
      destinationRequest: destination?.manifest.request, destinationResponse: destination?.response,
      destinationObservations: job.destinationObservations, destinationValuation: destination?.manifest.valuation});
    if (actual.sourceProofHash !== operation.sourceProofHash || BigInt(actual.actualUsdMicros) > BigInt(operation.reservedUsdMicros) || BigInt(actual.actualSourceUsdMicros) > BigInt(operation.sourceMaximumUsdMicros) || BigInt(actual.actualDestinationUsdMicros) > BigInt(operation.destinationReservedUsdMicros)) throw Error('Complete route differs from its held proof or budget.');
    if (operation.state === 'settled') {
      if (Object.entries(actual).some(([key, value]) => operation[key] !== value)) throw Error('Previously settled bridge evidence changed.');
      return operation;
    }
    Object.assign(operation, actual, {state: 'settled', sourceFinality: job.sourceObservations, destinationFinality: job.destinationObservations, recoveredInSeparateProcess: true, settledAt: new Date().toISOString()});
    if (operation.destination) operation.destination.state = 'settled';
    save();
    return operation;
  } finally {await unlock();}
}
module.exports = {bridgeProfileActions: actions, handleBridgeAction};
