import {readBoundedPipe} from '../../offline-signer/bounded-pipe';
import {PUBLIC_STATE_PROOF_LIMITS, verifyPublicStateProofEnvelope} from './state-protocol';

async function main() {
  if (process.argv.length !== 2) throw Error('Unsupported proof worker invocation.');
  const raw = await readBoundedPipe(process.stdin, PUBLIC_STATE_PROOF_LIMITS.inputBytes);
  process.stdout.write(await verifyPublicStateProofEnvelope(raw));
}
main().catch(() => {process.stderr.write('Public proof rejected.'); process.exitCode = 1;});
