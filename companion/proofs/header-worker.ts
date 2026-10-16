import {readBoundedPipe} from '../../offline-signer/bounded-pipe';
import {PUBLIC_HEADER_PROOF_LIMITS, verifyPublicHeaderProofEnvelope} from './header-protocol';
async function main() {
  if (process.argv.length !== 2) throw Error('Unsupported public header proof invocation.');
  const input = await readBoundedPipe(process.stdin, PUBLIC_HEADER_PROOF_LIMITS.inputBytes);
  process.stdout.write(await verifyPublicHeaderProofEnvelope(input));
}
main().catch(() => {process.stderr.write('Public header proof rejected.'); process.exitCode = 1;});
