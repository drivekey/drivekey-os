import {createVault, inspectVault, verifyVault, reviewRequest, signReviewed, verifySavedSignature} from './signer';
const paymentPolicy = require('./tools/store-payment-policy.cjs');
const MAX = 1024 * 1024;
let bytes = 0, chunks: Buffer[] = [];
const clearChunks = () => { chunks.forEach(b => b.fill(0)); chunks = []; };
process.stdin.on('data', (chunk: Buffer) => {
  bytes += chunk.length;
  if (bytes > MAX) { chunk.fill(0); clearChunks(); process.exit(2); }
  chunks.push(chunk);
});
process.stdin.on('end', async () => {
  let job: any;
  try {
    const raw = Buffer.concat(chunks); clearChunks();
    try { job = JSON.parse(raw.toString('utf8')); } finally { raw.fill(0); }
    let result: unknown;
    switch(job.action) {
      case 'create': result = await createVault(job.password); break;
      case 'inspect': result = inspectVault(job.vault); break;
      case 'verify': result = await verifyVault(job.vault,job.password); break;
      case 'review': paymentPolicy.assertIntent(job.request); result = reviewRequest(job.request,job.vault); break;
      case 'sign': paymentPolicy.assertIntent(job.request); result = await signReviewed(job.vault,job.password,job.request,job.fingerprint); break;
      case 'verify-saved': result = verifySavedSignature(job.vault,job.request,job.response); break;
      default: throw Error('Unsupported operation.');
    }
    job.password = undefined; job = undefined;
    process.stdout.write(JSON.stringify({ok:true,result}), () => process.exit(0));
  } catch {
    // Library/validation exceptions can contain user input or secret material.
    // Never serialize a key-bearing worker's exception across the IPC boundary.
    if(job && typeof job === 'object')job.password = undefined;
    job = undefined; clearChunks();
    process.stdout.write(JSON.stringify({ok:false,error:'Local signer rejected the operation. Check the passphrase, vault and reviewed request.'}), () => process.exit(1));
  }
});
process.stdin.on('error', () => { clearChunks(); process.exit(2); });
