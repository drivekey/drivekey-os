// Candidate-only binary boundary. No raw JSON, private-key handling or signing.
// Fixed layouts preserve exact integers; schemas are reapplied after decoding.
import {getAddress, ZeroAddress} from 'ethers';
import {savingsReviewExpectationSchema, savingsActionReviewRequestSchema,
  type SavingsReviewExpectation, type SavingsActionReviewRequest} from '../core/savings-action-review';
import {type SavingsAction, type SavingsConfig, type SavingsProtection} from '../core/savings-protocol';
import {encodeVaultFrame, decodeVaultFrame, MAX_PUBLIC_FRAME} from './savings-boundary-codec';

export const MAX_SAVINGS_EXPECTATION_FRAME = 160;
export const MAX_SAVINGS_ACTION_REQUEST_FRAME = 512;
export const MAX_SAVINGS_ACTION_SIGNING_FRAME = 3072;
export const SAVINGS_ACTION_SIGNATURE_FRAME_BYTES = 73;
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const maxCounter = BigInt(Number.MAX_SAFE_INTEGER);
class Writer {
  private chunks: Buffer[] = [];
  bytes(value: Uint8Array) {this.chunks.push(Buffer.from(value));}
  byte(value: number) {this.bytes(Buffer.from([value]));}
  short(value: number) {const b = Buffer.alloc(2); b.writeUInt16BE(value); this.bytes(b);}
  counter(value: number) {const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); this.bytes(b);}
  integer(value: string) {this.bytes(Buffer.from(BigInt(value).toString(16).padStart(64, '0'), 'hex'));}
  address(value: string) {this.bytes(Buffer.from(value.slice(2), 'hex'));}
  hash(value: string) {this.bytes(Buffer.from(value.slice(2), 'hex'));}
  nested(value: Buffer) {this.short(value.length); this.bytes(value);}
  finish(max: number) {
    const b = Buffer.concat(this.chunks); for (const chunk of this.chunks) chunk.fill(0); this.chunks = [];
    if (b.length > max) {b.fill(0); throw Error('Savings frame exceeds limit.');} return b;
  }
}
class Reader {
  private at = 0;
  constructor(private frame: Buffer, max: number) {if (!Buffer.isBuffer(frame) || frame.length > max) throw Error('Invalid or oversized savings frame.');}
  bytes(count: number) {if (!Number.isSafeInteger(count) || count < 0 || count > this.frame.length - this.at) throw Error('Truncated savings frame.'); const b = this.frame.subarray(this.at, this.at + count); this.at += count; return b;}
  byte() {return this.bytes(1)[0];}
  flag() {const n = this.byte(); if (n !== 0 && n !== 1) throw Error('Invalid savings flag.'); return n === 1;}
  short() {return this.bytes(2).readUInt16BE();}
  counter() {const n = this.bytes(8).readBigUInt64BE(); if (n > maxCounter) throw Error('Savings counter is not exact.'); return Number(n);}
  integer() {return BigInt('0x' + this.bytes(32).toString('hex')).toString();}
  address() {return getAddress('0x' + this.bytes(20).toString('hex'));}
  hash() {return '0x' + this.bytes(32).toString('hex');}
  nested(max: number) {const size = this.short(); if (size > max) throw Error('Nested savings frame exceeds limit.'); return this.bytes(size);}
  magic(value: string) {if (!this.bytes(8).equals(Buffer.from(value, 'ascii'))) throw Error('Wrong savings boundary purpose or version.');}
  end() {if (this.at !== this.frame.length) throw Error('Trailing savings boundary data.');}
}
function writeConfiguration(w: Writer, c: SavingsConfig) {w.byte(c.preset); w.byte(c.signers.length); for (const s of c.signers) w.address(s);}
function readConfiguration(r: Reader): SavingsConfig {
  const preset = r.byte(); if (preset !== 0 && preset !== 1) throw Error('Unsupported savings preset.');
  const count = r.byte(); if (count !== (preset === 0 ? 1 : 3)) throw Error('Invalid savings signer count.');
  return {preset, signers: Array.from({length: count}, () => r.address())};
}
function writeAction(w: Writer, a: SavingsAction) {
  w.byte(a.kind); w.address(a.asset); w.address(a.recipient); w.integer(a.amount); w.integer(a.nonce);
  w.counter(a.expiry); w.counter(a.epoch); w.hash(a.currentConfigHash); w.hash(a.newConfigHash);
}
function readAction(r: Reader): SavingsAction {
  const kind = r.byte(); if (kind > 2) throw Error('Unsupported savings action.');
  return {kind: kind as SavingsAction['kind'], asset: r.address(), recipient: r.address(), amount: r.integer(), nonce: r.integer(),
    expiry: r.counter(), epoch: r.counter(), currentConfigHash: r.hash(), newConfigHash: r.hash()};
}
type Details = {action: SavingsAction; newConfiguration: SavingsConfig | null};
function writeDetails(w: Writer, d: Details) {writeAction(w, d.action); w.byte(d.newConfiguration === null ? 0 : 1); if (d.newConfiguration) writeConfiguration(w, d.newConfiguration);}
function readDetails(r: Reader): Details {return {action: readAction(r), newConfiguration: r.flag() ? readConfiguration(r) : null};}
function writeProtection(w: Writer, p: SavingsProtection) {w.byte(p.kind); w.hash(p.actionId); w.integer(p.nonce); w.counter(p.expiry); w.counter(p.epoch); w.hash(p.currentConfigHash);}
function readProtection(r: Reader): SavingsProtection {
  const kind = r.byte(); if (kind > 1) throw Error('Unsupported savings protection.');
  return {kind: kind as SavingsProtection['kind'], actionId: r.hash(), nonce: r.integer(), expiry: r.counter(), epoch: r.counter(), currentConfigHash: r.hash()};
}
function canonical(frame: Buffer, rebuilt: Buffer) {if (!frame.equals(rebuilt)) throw Error('Noncanonical savings frame.');}

export function encodeSavingsExpectationFrame(input: unknown) {
  const e = savingsReviewExpectationSchema.parse(input), w = new Writer(); w.bytes(Buffer.from('DKSAEXP1'));
  w.address(e.vault); w.hash(e.runtimeCodeHash); writeConfiguration(w, e.configuration); w.counter(e.epoch); w.byte(e.paused ? 1 : 0);
  return w.finish(MAX_SAVINGS_EXPECTATION_FRAME);
}
export function decodeSavingsExpectationFrame(frame: Buffer): SavingsReviewExpectation {
  const r = new Reader(frame, MAX_SAVINGS_EXPECTATION_FRAME); r.magic('DKSAEXP1');
  const e = savingsReviewExpectationSchema.parse({kind: 'drivekey-savings-review-expectation', version: 1, chainId: 1, contractVersion: 1,
    vault: r.address(), runtimeCodeHash: r.hash(), configuration: readConfiguration(r), epoch: r.counter(), paused: r.flag()});
  r.end(); canonical(frame, encodeSavingsExpectationFrame(e)); return e;
}
export function encodeSavingsActionRequestFrame(input: unknown) {
  const q = savingsActionReviewRequestSchema.parse(input), w = new Writer(); w.bytes(Buffer.from('DKSAREQ1')); w.address(q.vault); w.hash(q.runtimeCodeHash);
  const o = q.operation;
  if (o.kind === 'queue' || o.kind === 'execute') {
    w.byte(o.kind === 'queue' ? 0 : 1); writeDetails(w, o.details);
    if (o.kind === 'execute') {w.hash(o.queue.actionId); w.counter(o.queue.queuedAt); w.counter(o.queue.readyAt); w.counter(o.queue.expiry); w.counter(o.queue.epoch);}
  } else {
    w.byte(o.kind === 'protect' ? 2 : 3); writeProtection(w, o.protection);
    if (o.kind === 'protect') {w.byte(o.target === null ? 0 : 1); if (o.target) writeDetails(w, o.target);}
    else writeDetails(w, o.target);
  }
  return w.finish(MAX_SAVINGS_ACTION_REQUEST_FRAME);
}
export function decodeSavingsActionRequestFrame(frame: Buffer): SavingsActionReviewRequest {
  const r = new Reader(frame, MAX_SAVINGS_ACTION_REQUEST_FRAME); r.magic('DKSAREQ1'); const vault = r.address(), runtimeCodeHash = r.hash(), kind = r.byte();
  let operation: SavingsActionReviewRequest['operation'];
  if (kind === 0) operation = {kind: 'queue', details: readDetails(r)};
  else if (kind === 1) operation = {kind: 'execute', details: readDetails(r), queue: {provenance: 'host-rpc', actionId: r.hash(), queuedAt: r.counter(), readyAt: r.counter(), expiry: r.counter(), epoch: r.counter(), status: 'queued'}};
  else if (kind === 2) operation = {kind: 'protect', protection: readProtection(r), target: r.flag() ? readDetails(r) : null};
  else if (kind === 3) operation = {kind: 'cancel-configuration', protection: readProtection(r), target: readDetails(r)};
  else throw Error('Unsupported savings request purpose.');
  r.end(); const q = savingsActionReviewRequestSchema.parse({kind: 'drivekey-savings-action-review-request', version: 1, chainId: 1, contractVersion: 1, vault, runtimeCodeHash, operation});
  canonical(frame, encodeSavingsActionRequestFrame(q)); return q;
}
function selectedSigner(input: string) {
  if (typeof input !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(input)) throw Error('Invalid selected savings signer.');
  const signer = getAddress(input); if (signer === ZeroAddress) throw Error('Zero selected savings signer.'); return signer;
}
function passwordBytes(password: string) {
  if (typeof password !== 'string' || password.length > 256) throw Error('Savings passphrase exceeds limit.');
  const b = Buffer.from(password, 'utf8');
  if (b.length > 1024 || decoder.decode(b) !== password) {b.fill(0); throw Error('Passphrase is not exact bounded UTF-8.');}
  return b;
}
/** Carries only public request fields, encrypted vault and a bounded passphrase.
 * This is not approval: the key core must rebuild review and match fingerprint. */
export function encodeSavingsActionSigningFrame(expectation: unknown, request: unknown, vault: unknown, signerInput: string, fingerprint: string, password: string) {
  const signer = selectedSigner(signerInput);
  if (typeof fingerprint !== 'string' || !/^0x[0-9a-f]{64}$/.test(fingerprint)) throw Error('Invalid savings review fingerprint.');
  const e = encodeSavingsExpectationFrame(expectation), q = encodeSavingsActionRequestFrame(request), v = encodeVaultFrame(vault), p = passwordBytes(password), w = new Writer();
  try {
    w.bytes(Buffer.from('DKSASIG1')); w.address(signer); w.hash(fingerprint); w.nested(e); w.nested(q); w.nested(v); w.nested(p);
    return w.finish(MAX_SAVINGS_ACTION_SIGNING_FRAME);
  } finally {p.fill(0);}
}
export function decodeSavingsActionSigningFrame(frame: Buffer) {
  const r = new Reader(frame, MAX_SAVINGS_ACTION_SIGNING_FRAME); r.magic('DKSASIG1'); const signer = selectedSigner(r.address()), fingerprint = r.hash();
  const expectation = decodeSavingsExpectationFrame(r.nested(MAX_SAVINGS_EXPECTATION_FRAME)), request = decodeSavingsActionRequestFrame(r.nested(MAX_SAVINGS_ACTION_REQUEST_FRAME));
  const vaultBytes = r.nested(MAX_PUBLIC_FRAME), vault = decodeVaultFrame(vaultBytes); canonical(vaultBytes, encodeVaultFrame(vault));
  const rawPassword = r.nested(1024), password = decoder.decode(rawPassword); r.end();
  const checkedPassword = passwordBytes(password); try {canonical(rawPassword, checkedPassword);} finally {checkedPassword.fill(0);}
  return {expectation, request, vault, signer, fingerprint, password};
}
const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
function canonicalSignature(signature: string) {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{128}(1b|1c)$/i.test(signature)) throw Error('Expected canonical savings signature.');
  const r = BigInt('0x' + signature.slice(2, 66)), s = BigInt('0x' + signature.slice(66, 130));
  if (r === 0n || r >= order || s === 0n || s > order / 2n) throw Error('Savings signature scalar out of range.'); return signature.toLowerCase();
}
export function encodeSavingsActionSignature(signature: string) {return Buffer.concat([Buffer.from('DKSAOUT1'), Buffer.from(canonicalSignature(signature).slice(2), 'hex')]);}
export function decodeSavingsActionSignature(frame: Buffer) {
  const r = new Reader(frame, SAVINGS_ACTION_SIGNATURE_FRAME_BYTES); r.magic('DKSAOUT1'); const signature = canonicalSignature('0x' + r.bytes(65).toString('hex')); r.end(); return signature;
}
