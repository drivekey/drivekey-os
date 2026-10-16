import {runSandbox} from './sandbox-process';
import {encodeSavingsActionSigningFrame, decodeSavingsActionSignature,
  decodeSavingsExpectationFrame, decodeSavingsActionRequestFrame,
  MAX_SAVINGS_EXPECTATION_FRAME, MAX_SAVINGS_ACTION_REQUEST_FRAME, MAX_SAVINGS_ACTION_SIGNING_FRAME} from './savings-action-codec';
const node = '/opt/drivekey/node/bin/node';
const parser = '/opt/drivekey/drivekey-savings-public-parser.cjs';
const signer = '/opt/drivekey/drivekey-savings-action-key-worker.cjs';
export async function parseSavingsExpectationBytes(bytes: Buffer) {
  return decodeSavingsExpectationFrame(await runSandbox({node, program: parser, args: ['expectation'], inputLimit: 16384,
    outputLimit: MAX_SAVINGS_EXPECTATION_FRAME, timeoutMs: 10000, heapMb: 64}, bytes));
}
export async function parseSavingsActionBytes(bytes: Buffer) {
  return decodeSavingsActionRequestFrame(await runSandbox({node, program: parser, args: ['action'], inputLimit: 16384,
    outputLimit: MAX_SAVINGS_ACTION_REQUEST_FRAME, timeoutMs: 10000, heapMb: 64}, bytes));
}
export async function isolatedSavingsActionSignature(expectation: unknown, request: unknown, vault: unknown, localSigner: string, fingerprint: string, password: string) {
  const frame = encodeSavingsActionSigningFrame(expectation, request, vault, localSigner, fingerprint, password);
  try {return decodeSavingsActionSignature(await runSandbox({node, program: signer, args: [], inputLimit: MAX_SAVINGS_ACTION_SIGNING_FRAME,
    outputLimit: 73, timeoutMs: 90000, heapMb: 128}, frame));}
  finally {frame.fill(0);}
}
