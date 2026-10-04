// Public transaction evidence only. A receipt alone cannot establish exact execution.
import { Transaction } from 'ethers';
import { VersionedTransaction, type Connection } from '@solana/web3.js';
import type { Rpc } from './protocol';

const quantity = (value: unknown) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw Error('Invalid evidence quantity.');
  return BigInt(value);
};
const equal = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
export async function evmEvidence(hash: string, raw: string, rpc: Rpc, sender?: string) {
  const expected = Transaction.from(raw);
  if (expected.signature ? expected.hash !== hash : !sender) throw Error('Invalid approved transaction identity.');
  const actual = await rpc('eth_getTransactionByHash', [hash]) as Record<string, unknown> | null;
  const receipt = await rpc('eth_getTransactionReceipt', [hash]) as Record<string, unknown> | null;
  if (!actual) return { state: receipt ? 'submitted' : 'unknown', hash, finality: 'unverified' };
  if (!equal(actual.hash, hash) || !equal(actual.from, (expected.from ?? sender)!) || !equal(actual.to, expected.to!) ||
      !equal(actual.input, expected.data) || quantity(actual.value) !== expected.value ||
      quantity(actual.nonce) !== BigInt(expected.nonce) || quantity(actual.chainId) !== expected.chainId ||
      quantity(actual.type) !== BigInt(expected.type!) || quantity(actual.gas) !== expected.gasLimit ||
      quantity(actual.maxFeePerGas) !== expected.maxFeePerGas || quantity(actual.maxPriorityFeePerGas) !== expected.maxPriorityFeePerGas ||
      JSON.stringify(actual.accessList ?? []) !== JSON.stringify(expected.accessList ?? [])) throw Error('Chain transaction does not match exact approved bytes.');
  if (!receipt) return { state: 'submitted', hash, finality: 'pending' };
  if (!equal(receipt.transactionHash, hash) || !['0x0', '0x1'].includes(String(receipt.status)) ||
      typeof receipt.blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) ||
      !equal(actual.blockHash, receipt.blockHash) || quantity(actual.blockNumber) !== quantity(receipt.blockNumber)) throw Error('Conflicting transaction and receipt evidence.');
  const canonical = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]) as {hash?: string} | null;
  if (!canonical || !equal(canonical.hash, receipt.blockHash)) throw Error('Receipt block is not canonical.');
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]) as {number?: string} | null;
  if (!finalized || quantity(finalized.number) < quantity(receipt.blockNumber)) return {state:'submitted',hash,finality:'confirmed'};
  return {state:receipt.status === '0x1' ? 'confirmed' : 'failed',hash,finality:'finalized',evidenceBlockHash:receipt.blockHash,evidenceBlockNumber:String(receipt.blockNumber)};
}

export async function solanaEvidence(hash: string, raw: string, connection: Connection) {
  const status = (await connection.getSignatureStatuses([hash], {searchTransactionHistory:true})).value[0];
  if (!status) return {state:'unknown',hash,finality:'unverified'};
  if (status.confirmationStatus !== 'finalized') return {state:'submitted',hash,finality:status.confirmationStatus ?? 'processed'};
  const actual = await connection.getTransaction(hash, {commitment:'finalized',maxSupportedTransactionVersion:0});
  if (!actual?.meta) return {state:'submitted',hash,finality:'unverified'};
  const expected = VersionedTransaction.deserialize(Buffer.from(raw,'base64'));
  if (actual.transaction.signatures[0] !== hash || actual.slot !== status.slot ||
      !Buffer.from(actual.transaction.message.serialize()).equals(Buffer.from(expected.message.serialize())) ||
      JSON.stringify(actual.meta.err) !== JSON.stringify(status.err)) throw Error('Finalized transaction does not match exact approved message and status.');
  return {state:actual.meta.err ? 'failed' : 'confirmed',hash,finality:'finalized'};
}
