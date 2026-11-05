import {signLifiMayanEvm} from './engine/offline-signer/lifi-mayan-evm';
import {signLifiRelay} from './engine/offline-signer/lifi-relay';
import {validateLifiRelay,assertLifiRelayWallet,lifiRelayReview,verifyLifiRelayResponse} from './engine/core/lifi-relay-intent';
import {validateLifiMayanEvm,assertLifiMayanEvmWallet,lifiMayanEvmReview,verifyLifiMayanEvmResponse} from './engine/core/lifi-mayan-evm-intent';
import {signMayanEvmRedeem} from './engine/offline-signer/mayan-evm-redeem';
import {validateMayanEvmRedeem,assertMayanEvmRedeemWallet,mayanEvmRedeemReview,verifyMayanEvmRedeemResponse} from './engine/core/mayan-evm-redeem-intent';
import {signMayanSolana} from './engine/offline-signer/mayan-solana';
import {validateMayanSolana,assertMayanSolanaWallet,mayanSolanaReview,verifyMayanSolanaResponse} from './engine/core/mayan-solana-intent';
import {signHinkalSolanaSwap} from './engine/offline-signer/hinkal-solana-swap';
import {validateHinkalSolanaSwap,assertHinkalSolanaSwapWallet,hinkalSolanaSwapReview,verifyHinkalSolanaSwapResponse} from './engine/core/hinkal-solana-swap';
import {signHinkalEvmSwap} from './engine/offline-signer/hinkal-evm-swap';
import {validateHinkalEvmSwap,assertHinkalEvmSwapWallet,hinkalEvmSwapReview,verifyHinkalEvmSwapResponse} from './engine/core/hinkal-evm-swap-intent';
import {signHinkalSolanaSpend} from './engine/offline-signer/hinkal-solana-spend';
import {validateHinkalSolanaSpend,assertHinkalSolanaSpendWallet,hinkalSolanaSpendReview,verifyHinkalSolanaSpendResponse} from './engine/core/hinkal-solana-spend';
import {signHinkalSolana} from './engine/offline-signer/hinkal-solana';
import {validateHinkalSolana,assertHinkalSolanaWallet,hinkalSolanaReview,verifyHinkalSolanaResponse} from './engine/core/hinkal-solana-intent';
/**
 * Experimental SAME-HOST signer. This is deliberately separate from DriveKey's
 * booted offline services: it does not claim their OS/network isolation.
 * Run each secret-bearing call in a fresh worker and terminate that worker.
 */
import { Transaction, formatUnits, getAddress } from 'ethers';
import {validatePayment, assertPaymentWallet, paymentReview, verifyPaymentResponse} from './engine/core/payment-intent';
import {signPayment} from './engine/offline-signer/payment';
import {signSwap} from './engine/offline-signer/swap';
import {signLifiEvm} from './engine/offline-signer/lifi-evm';
import {signLifiSolana} from './engine/offline-signer/lifi-solana';
import {validateLifiSolana,assertLifiSolanaWallet,lifiSolanaReview,verifyLifiSolanaResponse} from './engine/core/lifi-solana-intent';
import {validateLifiEvm,assertLifiEvmWallet,lifiEvmReview,verifyLifiEvmResponse} from './engine/core/lifi-evm-intent';
import {signHinkal} from './engine/offline-signer/hinkal';
import {validateHinkal,assertHinkalWallet,hinkalReview,verifyHinkalResponse} from './engine/core/hinkal-intent';
import {validateSwap,assertSwapWallet,swapReview,verifySwapResponse} from './engine/core/swap-intent';
import {
  createMultiVault, unlockMultiVault, signMultiVault,
} from './engine/offline-signer/multi-vault';
import { multiVaultSchema, type MultiVault } from './engine/offline-signer/multi-vault-format';
import { retainedSolSecret } from './engine/offline-signer/sol-secret';
import {
  validateMultiRequest, verifyMultiResponse, type MultiRequest,
} from './engine/core/multi-protocol';
import {
  validateTrade, tradeApproval, verifyTradeResponse, type TradeRequest,
} from './engine/core/trade-protocol';

export const TRUST_MODEL = 'same-host-local-signing' as const;
export const MAX_INPUT_BYTES = 64 * 1024;
export const SIGNING_WARNING = 'Signing runs on this computer. Host malware can observe or alter this session. This is not the booted offline signer. Signed transactions can remain valid after the application deadline.';

/** Make a bounded private snapshot so callers cannot replace the reviewed intent
 * while a KDF or signature operation is in flight. No original object is retained. */
function snapshot(value: unknown): any {
  let json: string;
  try { json = JSON.stringify(value); } catch { throw Error('Expected bounded JSON input.'); }
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_INPUT_BYTES) {
    throw Error('JSON input exceeds the 64 KiB limit.');
  }
  return JSON.parse(json);
}

function vaultSnapshot(value: unknown): MultiVault {
  return multiVaultSchema.parse(snapshot(value));
}

function password(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
    throw Error('Use a unique passphrase of 16–256 characters.');
  }
}

function checkedTime(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid current time.');
  return now;
}

// web3.js 1.98.4's public secretKey getter returns a COPY. Clear the pinned
// implementation's retained bytes, as DriveKey's existing key workers do.

type Supported = { route: 'multi'; request: MultiRequest } | { route: 'ethereum-native'; request: TradeRequest };

function requestSnapshot(value: unknown, vault: MultiVault, now: number): Supported {
  const input = snapshot(value);
  checkedTime(now);
  if (input?.network === 'robinhood' || input?.network === 'solana') {
    const r = validateMultiRequest(input, now, true);
    if (r.deviceId !== vault.public.deviceId ||
      (r.network === 'solana' ? r.from !== vault.public.solanaAddress : getAddress(r.from) !== getAddress(vault.public.evmAddress))) {
      throw Error('Request belongs to a different vault.');
    }
    return { route: 'multi', request: r };
  }
  if (input?.network === 'ethereum') {
    const r = validateTrade(input, now, true);
    // Keep this preview intentionally narrow. Token approval and swap UI needs
    // separate contract identity/allowance review before it can be supported.
    if (r.kind !== 'payment' || r.tokenIn !== 'ETH') {
      throw Error('This preview supports native ETH payments only on Ethereum.');
    }
    if (r.deviceId !== vault.public.deviceId || getAddress(r.from) !== getAddress(vault.public.evmAddress)) {
      throw Error('Request belongs to a different vault.');
    }
    return { route: 'ethereum-native', request: r };
  }
  throw Error('Unsupported request format or network.');
}

export function inspectVault(input: unknown) {
  const v = vaultSnapshot(input);
  return { version: v.version, kind: v.kind, public: v.public, trustModel: TRUST_MODEL };
}

/** Re-export is verification of an existing signature, never new signing.
 * An application deadline does not revoke an Ethereum or durable-nonce signature. */
export function verifySavedSignature(vaultInput: unknown, requestInput: unknown, responseInput: unknown, now = Date.now()) {
  const v = vaultSnapshot(vaultInput), response = snapshot(responseInput);
  const signedAt = Date.parse(response?.signedAt);
  checkedTime(now); checkedTime(signedAt);
  if([25,26].includes((requestInput as any)?.version)){const r=validateLifiRelay(snapshot(requestInput),signedAt,false);assertLifiRelayWallet(r,v.public);return {response:verifyLifiRelayResponse(response,r,v.public,now,false),review:lifiRelayReview(r,signedAt,false),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===22){const r=validateLifiMayanEvm(snapshot(requestInput),signedAt,false);assertLifiMayanEvmWallet(r,v.public);return {response:verifyLifiMayanEvmResponse(response,r,v.public,now,false),review:lifiMayanEvmReview(r,signedAt,false),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===24){const r=validateMayanEvmRedeem(snapshot(requestInput),signedAt);assertMayanEvmRedeemWallet(r,v.public);return {response:verifyMayanEvmRedeemResponse(response,r,v.public,now,false),review:mayanEvmRedeemReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===23){const r=validateMayanSolana(snapshot(requestInput),signedAt);assertMayanSolanaWallet(r,v.public);return {response:verifyMayanSolanaResponse(response,r,v.public,now,false),review:mayanSolanaReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===21){const r=validateHinkalSolanaSwap(snapshot(requestInput),signedAt,false);assertHinkalSolanaSwapWallet(r,v.public);return {response:verifyHinkalSolanaSwapResponse(response,r,v.public,now,false),review:hinkalSolanaSwapReview(r,signedAt,false),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===18){const r=validateHinkalEvmSwap(snapshot(requestInput),signedAt,false);assertHinkalEvmSwapWallet(r,v.public);return {response:verifyHinkalEvmSwapResponse(response,r,v.public,now,false),review:hinkalEvmSwapReview(r,signedAt,false),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===16){const r=validateHinkalSolanaSpend(snapshot(requestInput),signedAt);assertHinkalSolanaSpendWallet(r,v.public);return {response:verifyHinkalSolanaSpendResponse(response,r,v.public,now,false),review:hinkalSolanaSpendReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===14){const r=validateHinkalSolana(snapshot(requestInput),signedAt);assertHinkalSolanaWallet(r,v.public);return {response:verifyHinkalSolanaResponse(response,r,v.public,now,false),review:hinkalSolanaReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===11){const r=validateLifiSolana(snapshot(requestInput),signedAt);assertLifiSolanaWallet(r,v.public);return {response:verifyLifiSolanaResponse(response,r,v.public,now,false),review:lifiSolanaReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===12){const r=validateLifiEvm(snapshot(requestInput),signedAt,false);assertLifiEvmWallet(r,v.public);return {response:verifyLifiEvmResponse(response,r,v.public,now,false),review:lifiEvmReview(r,signedAt,false),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===10){const r=validateHinkal(snapshot(requestInput),signedAt);assertHinkalWallet(r,v.public);return {response:verifyHinkalResponse(response,r,v.public,now,false),review:hinkalReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if((requestInput as any)?.version===9){const r=validateSwap(snapshot(requestInput),signedAt);assertSwapWallet(r,v.public);return {response:verifySwapResponse(response,r,v.public,now,false),review:swapReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};}
  if ((requestInput as any)?.version === 8) {
    const r=validatePayment(snapshot(requestInput),signedAt);assertPaymentWallet(r,v.public);
    return {response:verifyPaymentResponse(response,r,v.public,now,false),review:paymentReview(r,signedAt),applicationDeadlinePassed:now>=Date.parse(r.expiresAt)};
  }
  const selected = requestSnapshot(requestInput, v, signedAt);
  const verified = selected.route === 'multi'
    ? verifyMultiResponse(response, selected.request, v.public, now, false)
    : verifyTradeResponse(response, selected.request, v.public, now, false);
  return { response: verified, review: reviewRequest(selected.request, v, signedAt), applicationDeadlinePassed: now >= Date.parse(selected.request.expiresAt) };
}

export async function createVault(passphrase: string) {
  password(passphrase);
  return createMultiVault(passphrase);
}

export async function verifyVault(input: unknown, passphrase: string) {
  password(passphrase);
  const v = vaultSnapshot(input);
  const keys = await unlockMultiVault(v, passphrase);
  const secret = retainedSolSecret(keys.sol);
  try {
    if (getAddress(keys.evm.address) !== getAddress(v.public.evmAddress) || keys.sol.publicKey.toBase58() !== v.public.solanaAddress) {
      throw Error('Unlocked wallet differs from the encrypted vault identity.');
    }
    return { verified: true, public: v.public, trustModel: TRUST_MODEL };
  } finally { secret.fill(0); }
}

export function reviewRequest(input: unknown, vaultInput: unknown, now = Date.now()): Record<string, string> {
  const v = vaultSnapshot(vaultInput);
  if([25,26].includes((input as any)?.version)){const r=validateLifiRelay(snapshot(input),now);assertLifiRelayWallet(r,v.public);return lifiRelayReview(r,now);}
  if((input as any)?.version===22){const r=validateLifiMayanEvm(snapshot(input),now);assertLifiMayanEvmWallet(r,v.public);return lifiMayanEvmReview(r,now);}
  if((input as any)?.version===24){const r=validateMayanEvmRedeem(snapshot(input),now);assertMayanEvmRedeemWallet(r,v.public);return mayanEvmRedeemReview(r,now);}
  if((input as any)?.version===23){const r=validateMayanSolana(snapshot(input),now);assertMayanSolanaWallet(r,v.public);return mayanSolanaReview(r,now);}
  if((input as any)?.version===21){const r=validateHinkalSolanaSwap(snapshot(input),now);assertHinkalSolanaSwapWallet(r,v.public);return hinkalSolanaSwapReview(r,now);}
  if((input as any)?.version===18){const r=validateHinkalEvmSwap(snapshot(input),now);assertHinkalEvmSwapWallet(r,v.public);return hinkalEvmSwapReview(r,now);}
  if((input as any)?.version===16){const r=validateHinkalSolanaSpend(snapshot(input),now);assertHinkalSolanaSpendWallet(r,v.public);return hinkalSolanaSpendReview(r,now);}
  if((input as any)?.version===14){const r=validateHinkalSolana(snapshot(input),now);assertHinkalSolanaWallet(r,v.public);return hinkalSolanaReview(r,now);}
  if((input as any)?.version===11){const r=validateLifiSolana(snapshot(input),now);assertLifiSolanaWallet(r,v.public);return lifiSolanaReview(r,now);}
  if((input as any)?.version===12){const r=validateLifiEvm(snapshot(input),now);assertLifiEvmWallet(r,v.public);return lifiEvmReview(r,now);}
  if((input as any)?.version===10){const r=validateHinkal(snapshot(input),now);assertHinkalWallet(r,v.public);return hinkalReview(r,now);}
  if((input as any)?.version===9){const r=validateSwap(snapshot(input),now);assertSwapWallet(r,v.public);return swapReview(r,now);}
  if ((input as any)?.version === 8) {const r=validatePayment(snapshot(input),now);assertPaymentWallet(r,v.public);return paymentReview(r,now);}
  const selected = requestSnapshot(input, v, now), r = selected.request;
  const common = {
    requestId: r.requestId, deviceId: r.deviceId, from: r.from,
    recipient: r.recipient, baseUnits: r.amount, deadlineUTC: r.expiresAt,
    fingerprint: r.fingerprint, trustModel: TRUST_MODEL, warning: SIGNING_WARNING,
  };
  if (selected.route === 'ethereum-native') {
    const tx = Transaction.from(r.unsignedTransaction);
    return {
      ...common, action: 'Native transfer', network: 'Ethereum mainnet / chain 1',
      asset: 'ETH', tokenContract: 'Native ETH', amount: formatUnits(r.amount, 18) + ' ETH',
      transactionTarget: tx.to!, nonce: String(tx.nonce),
      maximumFee: formatUnits(tx.gasLimit * tx.maxFeePerGas!, 18) + ' ETH',
      maximumFeeBaseUnits: (tx.gasLimit * tx.maxFeePerGas!).toString(),
    };
  }
  const m = selected.request as MultiRequest;
  if (m.network === 'robinhood') {
    const tx = Transaction.from(m.unsignedTransaction);
    return {
      ...common, action: 'ERC20 transfer', network: 'Robinhood Chain / chain ' + m.chainId,
      asset: 'ERC20 (contract shown below)', tokenContract: m.token,
      amount: formatUnits(m.amount, m.decimals) + ' token units', decimals: String(m.decimals),
      transactionTarget: tx.to!, tokenCodeHash: m.codeHash, nonce: String(tx.nonce),
      ...(m.version === 6 ? { implementation: m.implementation, implementationCodeHash: m.implementationCodeHash } : {}),
      maximumFee: formatUnits(tx.gasLimit * tx.maxFeePerGas!, 18) + ' ETH',
      maximumFeeBaseUnits: (tx.gasLimit * tx.maxFeePerGas!).toString(),
      chainStateWarning: 'This signer does not query live token code or balances. Verify the token contract and decimals independently; the dapp must recheck chain state before submitting.',
    };
  }
  return {
    ...common, action: m.standard === 'native' ? 'Native transfer' : 'SPL transfer',
    network: 'Solana mainnet-beta', genesisHash: m.genesisHash,
    asset: m.standard === 'native' ? 'SOL' : 'SPL (mint shown below)',
    tokenContract: m.token, decimals: String(m.decimals),
    amount: formatUnits(m.amount, m.decimals) + (m.standard === 'native' ? ' SOL' : ' token units'),
    maximumFee: formatUnits(m.maximumFee, 9) + ' SOL', maximumFeeBaseUnits: m.maximumFee,
    recipientAccountRent: formatUnits(m.accountRent, 9) + ' SOL',
    createRecipientAccount: m.createRecipientAccount ? 'Yes' : 'No',
    nonceAccount: m.nonceAccount, nonceValue: m.nonceValue,
    chainStateWarning: 'This signer does not query live nonce, mint, balance or fee state. The dapp must recheck these before submitting.',
  };
}

/** Returns only an existing DriveKey response object. It never broadcasts.
 * now is for tests/integration; the worker API must use its own current clock. */
export async function signReviewed(vaultInput: unknown, passphrase: string, requestInput: unknown, expectedFingerprint: string, now = Date.now()) {
  password(passphrase);
  if([25,26].includes((requestInput as any)?.version))return signLifiRelay(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===22)return signLifiMayanEvm(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===24)return signMayanEvmRedeem(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===23)return signMayanSolana(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===21)return signHinkalSolanaSwap(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===18)return signHinkalEvmSwap(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===16)return signHinkalSolanaSpend(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===14)return signHinkalSolana(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===11)return signLifiSolana(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===12)return signLifiEvm(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===10)return signHinkal(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if((requestInput as any)?.version===9)return signSwap(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  if ((requestInput as any)?.version === 8) return signPayment(vaultSnapshot(vaultInput),passphrase,snapshot(requestInput),expectedFingerprint,now);
  const v = vaultSnapshot(vaultInput), selected = requestSnapshot(requestInput, v, now);
  if(selected.route==='multi')throw Error('Legacy multi-chain requests are recovery-only in this release. Prepare a version 8 Ethereum or Solana payment.');
  const started = performance.now();
  const currentTime = () => checkedTime(now + Math.max(0, Math.floor(performance.now() - started)));
  if (typeof expectedFingerprint !== 'string' || !/^0x[0-9a-f]{64}$/.test(expectedFingerprint) || selected.request.fingerprint !== expectedFingerprint) {
    throw Error('Request fingerprint changed since review.');
  }
  // Re-validate the private snapshot immediately before entering key handling.
  requestSnapshot(selected.request, v, currentTime());
  const r = selected.request, keys = await unlockMultiVault(v, passphrase);
  const secret = retainedSolSecret(keys.sol);
  try {
    validateTrade(r, currentTime(), true);
    if (getAddress(keys.evm.address) !== getAddress(r.from)) throw Error('Unlocked signer differs from reviewed sender.');
    const rawSignedTransaction = await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));
    const response = {
      version: r.version, requestId: r.requestId, deviceId: r.deviceId, fingerprint: r.fingerprint,
      signedAt: new Date(currentTime()).toISOString(), rawSignedTransaction,
      approvalSignature: await keys.evm.signMessage(tradeApproval(r)),
      transactionHash: Transaction.from(rawSignedTransaction).hash!,
    };
    return verifyTradeResponse(response, r, v.public, currentTime(), true);
  } finally { secret.fill(0); }
}
