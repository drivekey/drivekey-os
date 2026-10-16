import {readBoundedPipe} from '../../offline-signer/bounded-pipe';
import {PUBLIC_RECEIPT_PROOF_LIMITS, verifyPublicReceiptProofEnvelope} from './receipt-protocol';
async function main() {
  if (process.argv.length !== 2) throw Error('Unsupported receipt proof worker invocation.');
  const raw = await readBoundedPipe(process.stdin, PUBLIC_RECEIPT_PROOF_LIMITS.inputBytes);
  process.stdout.write(await verifyPublicReceiptProofEnvelope(raw));
}
main().catch(() => {process.stderr.write('Public receipt proof rejected.'); process.exitCode = 1;});
