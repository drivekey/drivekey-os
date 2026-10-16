import {getAddress} from 'ethers';
import {multiPublicSchema} from './multi-protocol';
import {validateLifiRequest} from './lifi-protocol';

/** Public exchange format already consumed by the native PublicSession decoder.
 * This carries inputs, never a cached validation, approval or submission result.
 * The Mac must independently revalidate it through its confined validator.
 */
export function createMacPublicSession(wallet: unknown, request: unknown, now = Date.now()) {
  const publicWallet = multiPublicSchema.parse(wallet);
  const publicRequest = validateLifiRequest(request, now);
  if (publicWallet.deviceId !== publicRequest.deviceId ||
      getAddress(publicWallet.evmAddress) !== getAddress(publicRequest.from)) {
    throw Error('Request belongs to a different public wallet or device.');
  }
  const session = {format: 'drivekey-public-session-v1' as const, wallet: publicWallet, request: publicRequest};
  if (new TextEncoder().encode(JSON.stringify(session, null, 2)).length > 65_536 ||
      new TextEncoder().encode(JSON.stringify(publicRequest, null, 2)).length > 32_768) {
    throw Error('Public session exceeds the Mac import limit.');
  }
  return session;
}
