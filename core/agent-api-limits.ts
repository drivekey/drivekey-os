import {createHash} from 'node:crypto';
import {RpcRateLimit} from './rpc-proxy';

// Scope quotas to authenticated roles rather than attacker-controlled IPs.
// Stop is deliberately outside the ordinary RPC quota: polling or invalid requests
// must not consume the operator's ability to pause spending.
export class AgentApiLimits {
  private readonly authenticated = new RpcRateLimit(2, 60);
  private readonly rejected = new RpcRateLimit(10_000, 30);
  authenticatedAction(action: string, role: 'agent' | 'operator', now = Date.now()) {
    return action === 'stop' || this.authenticated.accept(role, now);
  }
  rejectedRequest(ip: string, now = Date.now()) {
    // Retain neither credentials nor arbitrary client-controlled header strings.
    return this.rejected.accept(createHash('sha256').update(ip.slice(0,256)).digest('hex'), now);
  }
}
