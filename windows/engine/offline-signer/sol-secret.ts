/** Pinned web3.js 1.98.4: secretKey returns a copy, not retained storage. */
export function retainedSolSecret(keypair: object): Uint8Array {
  const storage = Object.getOwnPropertyDescriptor(keypair, '_keypair')?.value;
  const secret = storage && Object.getOwnPropertyDescriptor(storage, 'secretKey')?.value;
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 64) throw Error('Unsupported key storage.');
  return secret;
}
export function wipeSolSecret(keypair: object): void { retainedSolSecret(keypair).fill(0); }
