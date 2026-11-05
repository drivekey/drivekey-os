import { Transaction } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { unlockMultiVault } from './multi-vault';
import { retainedSolSecret, wipeSolSecret } from './sol-secret';
import { validatePayment, assertPaymentWallet, solPayment, paymentApproval, verifyPaymentResponse } from '../core/payment-intent';
export async function signPayment(vault: any, password: string, input: unknown, fingerprint: string, now = Date.now()) {
  const r = validatePayment(JSON.parse(JSON.stringify(input)), now); assertPaymentWallet(r, vault.public);
  if (r.fingerprint !== fingerprint) throw Error('Payment fingerprint changed since review.');
  const start = performance.now(), clock = () => now + Math.floor(performance.now() - start);
  const keys = await unlockMultiVault(vault, password);
  try {
    validatePayment(r, clock());
    const approvalSignature = r.network === 'ethereum' ? await keys.evm.signMessage(paymentApproval(r)) :
      bs58.encode(nacl.sign.detached(new TextEncoder().encode(paymentApproval(r)), retainedSolSecret(keys.sol)));
    // Admission is checked after approvals and immediately before transferable
    // signing. Completion after expiry must retain the original signed bytes.
    const signingAt = clock(); validatePayment(r, signingAt);
    let rawSignedTransaction: string, transactionHash: string;
    if (r.network === 'ethereum') {
      rawSignedTransaction = await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));
      transactionHash = Transaction.from(rawSignedTransaction).hash!;
    } else {
      const tx = solPayment(r); tx.sign(keys.sol); rawSignedTransaction = tx.serialize().toString('base64'); transactionHash = bs58.encode(tx.signature!);
    }
    return verifyPaymentResponse({ version: 8, deviceId: r.deviceId, requestId: r.requestId, fingerprint: r.fingerprint, signedAt: new Date(signingAt).toISOString(), rawSignedTransaction, transactionHash, approvalSignature }, r, vault.public, clock(), false);
  } finally { wipeSolSecret(keys.sol); }
}
