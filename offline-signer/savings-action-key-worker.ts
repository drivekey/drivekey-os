import {readBoundedPipe} from './bounded-pipe';
import {MAX_SAVINGS_ACTION_SIGNING_FRAME} from './savings-action-codec';
import {signSavingsActionFrame} from './savings-action-key-core';
async function main() {
  if (process.argv.length !== 2) throw Error('Invalid signing entry point.');
  const frame = await readBoundedPipe(process.stdin, MAX_SAVINGS_ACTION_SIGNING_FRAME);
  try {process.stdout.write(await signSavingsActionFrame(frame));}
  finally {frame.fill(0);}
}
main().catch(() => {process.stderr.write('Savings action signing rejected.'); process.exitCode = 1;});
