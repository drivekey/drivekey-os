// Retired v4 key entry point. A stale caller must fail before decrypting a vault.
export async function signJupiterFrame(frame:Buffer):Promise<Buffer>{
 frame.fill(0);throw Error('Legacy Jupiter v4 signing is retired. A reviewed on-chain-expiry release is required.');
}
