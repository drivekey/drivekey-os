import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Transaction } from 'ethers';
import { Keypair } from '@solana/web3.js';
import { createVault, inspectVault, verifyVault, reviewRequest, signReviewed, verifySavedSignature, MAX_INPUT_BYTES } from '../signer';
import { retainedSolSecret, wipeSolSecret } from '../engine/offline-signer/sol-secret';
import { createMultiVault, unlockMultiVault, signMultiVault } from '../engine/offline-signer/multi-vault';
import { tradeFingerprint, verifyTradeResponse } from '../engine/core/trade-protocol';
import { multiFingerprint, canonicalSolTransaction, encodeSolUnsigned, verifyMultiResponse, SOLANA_GENESIS, MULTI_TTL, ERC20 } from '../engine/core/multi-protocol';
import { CHAIN_ID } from '../engine/core/protocol';

const pass = 'Disposable test vault passphrase 2026!';
let vault: Awaited<ReturnType<typeof createVault>>;
const now = Math.floor(Date.now() / 1000) * 1000;
const recipient = '0x1111111111111111111111111111111111111111';

before(async () => { vault = await createVault(pass); });

function ethRequest() {
  const r: any = {
    version: 4, network: 'ethereum', chainId: 1, kind: 'payment', requestId: randomUUID(), deviceId: vault.public.deviceId,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60_000).toISOString(),
    from: vault.public.evmAddress, recipient, tokenIn: 'ETH', tokenOut: null,
    amount: '1000000000000', minimumOutput: '0', quotedOutput: '0', slippageBps: 0, poolFee: 500,
    unsignedTransaction: Transaction.from({ type: 2, chainId: 1, nonce: 0, to: recipient, value: 1000000000000n, data: '0x', gasLimit: 21000, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }).unsignedSerialized,
  };
  r.fingerprint = tradeFingerprint(r);
  return r;
}

function solRequest() {
  const r: any = {
    version: 3, network: 'solana', requestId: randomUUID(), deviceId: vault.public.deviceId,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MULTI_TTL).toISOString(),
    genesisHash: SOLANA_GENESIS, standard: 'native', from: vault.public.solanaAddress,
    recipient: Keypair.generate().publicKey.toBase58(), token: 'native', amount: '1000', decimals: 9,
    nonceAccount: Keypair.generate().publicKey.toBase58(), nonceValue: Keypair.generate().publicKey.toBase58(),
    maximumFee: '5000', accountRent: '0', createRecipientAccount: false,
  };
  r.unsignedTransaction = encodeSolUnsigned(canonicalSolTransaction(r));
  r.fingerprint = multiFingerprint(r);
  return r;
}

function robinhoodRequest() {
  const token = '0x2222222222222222222222222222222222222222';
  const r: any = {
    version: 3, network: 'robinhood', chainId: CHAIN_ID, standard: 'erc20', requestId: randomUUID(), deviceId: vault.public.deviceId,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MULTI_TTL).toISOString(), from: vault.public.evmAddress,
    recipient, token, amount: '1234567', decimals: 6, codeHash: '0x' + '3'.repeat(64),
    unsignedTransaction: Transaction.from({ type: 2, chainId: CHAIN_ID, nonce: 0, to: token, value: 0, data: ERC20.encodeFunctionData('transfer', [recipient, '1234567']), gasLimit: 100000, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }).unsignedSerialized,
  };
  r.fingerprint = multiFingerprint(r);
  return r;
}

test('create and verify an encrypted v3 vault without returning secrets', async () => {
  assert.equal(vault.kind, 'drivekey-multi-vault');
  assert.equal(vault.kdf, 'scrypt-131072-8-1');
  assert.equal((await verifyVault(vault, pass)).verified, true);
  const inspected = inspectVault(vault);
  assert.equal(inspected.public.evmAddress, vault.public.evmAddress);
  assert.equal(inspected.trustModel, 'same-host-local-signing');
  assert.equal('ciphertext' in inspected, false);
  await assert.rejects(() => verifyVault(vault, 'Incorrect disposable passphrase'), /Incorrect passphrase|damaged/);
});

test('review displays full Ethereum intent and real signatures verify against exact bytes', async () => {
  const r = ethRequest(), review = reviewRequest(r, vault, now);
  assert.equal(review.from, vault.public.evmAddress);
  assert.equal(review.recipient, recipient);
  assert.equal(review.maximumFeeBaseUnits, '42000000000000');
  const response = await signReviewed(vault, pass, r, r.fingerprint, now);
  assert.equal(verifyTradeResponse(response, r, vault.public, now).transactionHash, response.transactionHash);
  assert.equal(Transaction.from(response.rawSignedTransaction).from, vault.public.evmAddress);
});

test('legacy Solana durable-nonce recovery verifies; new legacy signing and extra instructions are rejected', async () => {
  const r = solRequest(), review = reviewRequest(r, vault, now);
  assert.equal(review.network, 'Solana mainnet-beta');
  assert.equal(review.nonceAccount, r.nonceAccount);
  await assert.rejects(()=>signReviewed(vault,pass,r,r.fingerprint,now),/recovery-only/);
  const response = await signMultiVault(vault, pass, r, now);
  assert.equal(verifyMultiResponse(response, r, vault.public, now).transactionHash, response.transactionHash);
  const altered = { ...r, unsignedTransaction: r.unsignedTransaction.slice(0, -4) + 'AAAA' };
  altered.fingerprint = multiFingerprint(altered);
  assert.throws(() => reviewRequest(altered, vault, now));
});

test('legacy Robinhood ERC20 recovery binds recipient and token while new signing is disabled', async () => {
  const r = robinhoodRequest(), review = reviewRequest(r, vault, now);
  assert.equal(review.tokenContract, r.token);
  assert.equal(review.baseUnits, r.amount);
  await assert.rejects(()=>signReviewed(vault,pass,r,r.fingerprint,now),/recovery-only/);
  const response = await signMultiVault(vault, pass, r, now);
  assert.equal(verifyMultiResponse(response, r, vault.public, now).transactionHash, response.transactionHash);
});

test('wrong fingerprint, wrong vault, expiry and changed transaction fail closed', async () => {
  const r = ethRequest();
  await assert.rejects(() => signReviewed(vault, pass, r, '0x' + '0'.repeat(64), now), /fingerprint changed/);
  const wrongVault = { ...vault, public: { ...vault.public, deviceId: randomUUID() } };
  await assert.rejects(() => signReviewed(wrongVault, pass, r, r.fingerprint, now), /different vault/);
  await assert.rejects(() => signReviewed(vault, pass, r, r.fingerprint, Date.parse(r.expiresAt)), /expired/);
  const bytes = Transaction.from(r.unsignedTransaction); bytes.to = '0x4444444444444444444444444444444444444444';
  const mutated = { ...r, unsignedTransaction: bytes.unsignedSerialized };
  mutated.fingerprint = tradeFingerprint(mutated);
  assert.throws(() => reviewRequest(mutated, vault, now), /bytes do not match/);
});

test('unsupported versions, oversized input and damaged encrypted identity are rejected', async () => {
  assert.throws(() => inspectVault({ ...vault, version: 99 }));
  assert.throws(() => reviewRequest({ padding: 'x'.repeat(MAX_INPUT_BYTES) }, vault, now), /64 KiB/);
  assert.throws(() => reviewRequest({ ...ethRequest(), version: 99 }, vault, now));
  const damaged = { ...vault, public: { ...vault.public, evmAddress: recipient } };
  await assert.rejects(() => verifyVault(damaged, pass), /Incorrect passphrase|damaged/);
  await assert.rejects(() => createVault('short'), /16–256/);
});

test('saved signatures verify after the application deadline without allowing new signing', async () => {
  const r=ethRequest(),response=await signReviewed(vault,pass,r,r.fingerprint,now);
  const later=Date.parse(r.expiresAt)+60_000;
  const recovered=verifySavedSignature(vault,r,response,later);
  assert.equal(recovered.applicationDeadlinePassed,true);
  assert.deepEqual(recovered.response,response);
  await assert.rejects(()=>signReviewed(vault,pass,r,r.fingerprint,later),/expired/);
  assert.throws(()=>verifySavedSignature({...vault,public:{...vault.public,deviceId:randomUUID()}},r,response,later),/different vault/);
  assert.throws(()=>verifySavedSignature(vault,r,{...response,transactionHash:'0x'+'0'.repeat(64)},later),/does not match/);
});

test('Solana cleanup wipes retained secret storage, not the public getter copy',()=>{
  const key=Keypair.generate(),storage=retainedSolSecret(key),copy=key.secretKey;
  copy.fill(0);assert.ok(storage.some(byte=>byte!==0));wipeSolSecret(key);assert.ok(storage.every(byte=>byte===0));
});

test('vault creation, verification and multi-signing wipe all retained Solana secrets',async()=>{
  const original=Keypair.fromSeed,retained:Uint8Array[]=[];
  Keypair.fromSeed=function(seed){const key=original.call(this,seed);retained.push(retainedSolSecret(key));return key;};
  try{
    await createMultiVault(pass);await verifyVault(vault,pass);
    const r=solRequest();await signMultiVault(vault,pass,r,now);
    assert.ok(retained.length>=3);assert.ok(retained.every(bytes=>bytes.every(byte=>byte===0)));
  }finally{Keypair.fromSeed=original;}
});

test('an unlocked Solana identity is wiped when identity validation fails',async()=>{
  const original=Keypair.fromSeed,wrong=Keypair.generate(),storage=retainedSolSecret(wrong);
  Keypair.fromSeed=()=>wrong;
  try{await assert.rejects(()=>unlockMultiVault(vault,pass),/Incorrect passphrase|damaged/);assert.ok(storage.every(byte=>byte===0));}
  finally{Keypair.fromSeed=original;wipeSolSecret(wrong);}
});

for(const damaged of [false,true])test(`GCM intermediate plaintext and key are wiped after ${damaged?'authentication failure':'successful unlock'}`,async()=>{
  const crypto=require('node:crypto'),original=crypto.createDecipheriv,observed:Buffer[]=[],keys:Buffer[]=[];
  crypto.createDecipheriv=function(...args:any[]){
    keys.push(args[1]);const cipher=original(...args),update=cipher.update.bind(cipher),final=cipher.final.bind(cipher);
    cipher.update=(...input:any[])=>{const b=update(...input);observed.push(b);return b;};
    cipher.final=(...input:any[])=>{const b=final(...input);observed.push(b);return b;};return cipher;
  };
  try{
    if(damaged){const bad={...vault,tag:(vault.tag[0]==='0'?'1':'0')+vault.tag.slice(1)};await assert.rejects(()=>unlockMultiVault(bad,pass),/damaged/);}
    else{const unlocked=await unlockMultiVault(vault,pass);wipeSolSecret(unlocked.sol);}
    assert.ok(observed.length>0);assert.ok(observed.every(b=>b.every(n=>n===0)));assert.ok(keys.every(b=>b.every(n=>n===0)));
  }finally{crypto.createDecipheriv=original;}
});

test('vault creation wipes generated Solana storage when encryption initialization fails',async()=>{
  const crypto=require('node:crypto'),create=crypto.createCipheriv,fromSeed=Keypair.fromSeed,retained:Uint8Array[]=[];
  crypto.createCipheriv=()=>{throw Error('Injected encryption failure');};
  Keypair.fromSeed=function(seed){const key=fromSeed.call(this,seed);retained.push(retainedSolSecret(key));return key;};
  try{await assert.rejects(()=>createMultiVault(pass),/Injected encryption failure/);assert.equal(retained.length,1);assert.ok(retained[0].every(n=>n===0));}
  finally{crypto.createCipheriv=create;Keypair.fromSeed=fromSeed;}
});
