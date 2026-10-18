import {z} from 'zod';
import {getAddress, keccak256, toUtf8Bytes, verifyMessage, ZeroAddress} from 'ethers';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a public Ethereum address.').transform(v => getAddress(v)).refine(v => v !== ZeroAddress, 'Zero address is not a signer.');
export const savingsSetupSchema = z.object({
  kind: z.literal('drivekey-savings-setup'), version: z.literal(1), chainId: z.literal(1),
  sessionId: z.string().uuid(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  challenge: z.string().regex(/^0x[0-9a-f]{64}$/), preset: z.enum(['standard','strong']),
  spendingAccount: address, signers: z.array(address).min(1).max(3),
}).strict().superRefine((v, ctx) => {
  if (v.signers.length !== (v.preset === 'standard' ? 1 : 3) || new Set(v.signers.map(s => s.toLowerCase())).size !== v.signers.length)
    ctx.addIssue({code: 'custom', message: 'Standard requires one signer; Strong requires three distinct signers.'});
  if (v.signers.some(s => s === v.spendingAccount)) ctx.addIssue({code: 'custom', message: 'Use separate keys for spending and savings.'});
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.createdAt);
  if (lifetime <= 0 || lifetime > 86400000) ctx.addIssue({code: 'custom', message: 'Setup challenges last at most 24 hours.'});
});
export type SavingsSetup = z.infer<typeof savingsSetupSchema>;
export const setupPurpose = z.enum(['register','restore','quorum']);
export type SetupPurpose = z.infer<typeof setupPurpose>;
export function validateSavingsSetup(input: unknown, now = Date.now()): SavingsSetup {
  const setup = savingsSetupSchema.parse(input);
  if (!Number.isSafeInteger(now) || Date.parse(setup.createdAt) > now + 60000 || now >= Date.parse(setup.expiresAt)) throw Error('Setup challenge expired or clock differs. Create a fresh session.');
  return setup;
}
export function setupFingerprint(input: unknown): string {
  const s = savingsSetupSchema.parse(input);
  return keccak256(toUtf8Bytes(JSON.stringify(s)));
}
export function setupProofMessage(input: unknown, purpose: SetupPurpose, signer: string): string {
  const setup = savingsSetupSchema.parse(input), who = getAddress(signer);
  setupPurpose.parse(purpose);
  if (!setup.signers.includes(who)) throw Error('Signer is not part of this setup.');
  return ['DriveKey savings setup proof v1 — NO TRANSACTION AUTHORITY',
    `Purpose: ${purpose}`, `Signer: ${who}`, `Ethereum chain: 1`,
    `Setup fingerprint: ${setupFingerprint(setup)}`,
    'This proves key control for an unfunded setup exercise only. It cannot authorize a vault action.'].join('\n');
}
export function setupApprovalFingerprint(input: unknown, purpose: SetupPurpose, signer: string): string {
  return keccak256(toUtf8Bytes(setupProofMessage(input,purpose,signer)));
}
export const setupProofSchema = z.object({
  kind: z.literal('drivekey-savings-setup-proof'), version: z.literal(1),
  fingerprint: z.string().regex(/^0x[0-9a-f]{64}$/), purpose: setupPurpose,
  signer: address, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();
export type SetupProof = z.infer<typeof setupProofSchema>;
export function verifySetupProof(input: unknown, setupInput: unknown, now = Date.now()): SetupProof {
  const setup = validateSavingsSetup(setupInput, now), proof = setupProofSchema.parse(input);
  if (proof.fingerprint !== setupFingerprint(setup) || getAddress(verifyMessage(setupProofMessage(setup, proof.purpose, proof.signer), proof.signature)) !== proof.signer)
    throw Error('Setup proof does not match this signer and session.');
  return proof;
}
export function savingsSetupProgress(setupInput: unknown, inputs: unknown[], now = Date.now()) {
  const setup = validateSavingsSetup(setupInput, now);
  if (inputs.length > 9) throw Error('Too many setup proofs.');
  const proofs = inputs.map(p => verifySetupProof(p, setup, now));
  const count = (purpose: SetupPurpose) => new Set(proofs.filter(p => p.purpose === purpose).map(p => p.signer)).size;
  const registered = count('register'), restored = count('restore'), quorum = count('quorum');
  return {registered, restored, quorum, requiredSigners: setup.signers.length,
    requiredQuorum: setup.preset === 'strong' ? 2 : 1,
    ceremonyVerified: registered === setup.signers.length && restored === setup.signers.length && quorum >= (setup.preset === 'strong' ? 2 : 1),
    deploymentReady: false as const};
}
