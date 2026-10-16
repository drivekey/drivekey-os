// Offline-only setup proofs. Cannot sign a savings action or any transaction.
import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseSavingsSetupBytes,parseEncryptedVaultBytes,isolatedSetupSignature} from './savings-isolation';
import {validateSavingsSetup, setupFingerprint, setupApprovalFingerprint, setupProofMessage, setupPurpose, verifySetupProof} from '../core/savings-setup';

const command = z.discriminatedUnion('action', [
  z.object({scope:z.literal('savings-setup'), action:z.literal('review'), purpose:setupPurpose}).strict(),
  z.object({scope:z.literal('savings-setup'), action:z.literal('prove'), purpose:setupPurpose,
    fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/), consent:z.literal(true), password:z.string().max(256)}).strict(),
]);
export async function savingsSetupOfflineAction(input: unknown, directory: string) {
  const c = command.parse(input);
  await assertOfflineEnvironment();
  const setupBytes=await readBoundedExchangeBytes(directory,'savings-setup-request.json');
  const setup = validateSavingsSetup(await parseSavingsSetupBytes(setupBytes));
  // A restore proof must unlock the actual encrypted backup, never the active file.
  const filename = c.purpose === 'restore' ? 'vault-multi-backup.json' : 'vault-multi-encrypted.json';
  const vaultBytes=await readBoundedExchangeBytes(directory,filename);
  const vault = await parseEncryptedVaultBytes(vaultBytes);
  const signer = vault.public.evmAddress, fingerprint = setupFingerprint(setup);
  const approvalFingerprint = setupApprovalFingerprint(setup,c.purpose,signer);
  const message = setupProofMessage(setup, c.purpose, signer);
  if (c.action === 'review') return {setup, signer, fingerprint:approvalFingerprint, message,
    warning:'Unfunded setup proof only. This does not prove physical device independence or authorize funds.'};
  if (c.fingerprint !== approvalFingerprint) throw Error('Setup, signer or proof purpose changed since review.');
  const unchanged=async()=>{
    if(!setupBytes.equals(await readBoundedExchangeBytes(directory,'savings-setup-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,filename)))throw Error('Setup or encrypted vault changed during approval.');
    validateSavingsSetup(setup);
  };
  await unchanged();await assertOfflineEnvironment();
  // The isolated key process must exit before any further media parsing or writes.
  const signature=await isolatedSetupSignature(setup,vault,c.purpose,approvalFingerprint,c.password);
  const proof=verifySetupProof({kind:'drivekey-savings-setup-proof',version:1,fingerprint,purpose:c.purpose,signer,signature},setup);
  await assertOfflineEnvironment();await unchanged();
  await writeBoundedExchangeBytes(directory,'savings-setup-proof.json',Buffer.from(JSON.stringify(proof,null,2)+'\n'));
  return {proof,message:'Setup proof saved. No transaction signed or submitted.'};
}
