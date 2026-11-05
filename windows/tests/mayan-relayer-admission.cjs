'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {qualifyDestinationVm} = require('./mayan-solana-destination-vm.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = JSON.parse(fs.readFileSync(path.join(root, 'verification/LIFI-MAYAN-EVM-SOURCE-FORK.json')));
  const build = JSON.parse(fs.readFileSync(path.join(root, 'BUILD-MANIFEST.json')));
  assert.equal(source.passed, true);
  assert.equal(source.source.fingerprint, build.sourceFingerprint);
  assert.equal(source.mainnetSubmissions, 0);
  const bridge = source.cases.find(item => item.request.action === 'bridge');
  assert.ok(bridge);
  const result = await qualifyDestinationVm({request: bridge.request, response: bridge.response, sourceMessage: source.sourceMessage});
  assert.equal(result.passed, false);
  assert.equal(result.localSignerRejectedAsExpected, true);
  assert.equal(result.designatedRelayerSigningKeyAvailable, false);
  assert.equal(result.destinationExecutionVerified, false);
  const report = {
    at: new Date().toISOString(),
    sourceFingerprint: build.sourceFingerprint,
    scope: 'Negative local VM control. An unrelated signer must not impersonate the required provider relayer.',
    negativeControlPassed: true,
    positiveDestinationExecutionVerified: false,
    liveDestinationExecutionVerified: false,
    mainnetSubmissions: 0,
    evidence: result,
  };
  fs.writeFileSync(path.join(root, 'verification/MAYAN-RELAYER-ADMISSION.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({negativeControlPassed: true, positiveDestinationExecutionVerified: false, mainnetSubmissions: 0}));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
