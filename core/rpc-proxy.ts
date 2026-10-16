const METHODS = new Set(['eth_chainId', 'eth_getBalance', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_getBlockByNumber', 'eth_maxPriorityFeePerGas', 'eth_gasPrice', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
class BodyTooLarge extends Error {}
async function boundedJson(message: Request | Response, maximum: number): Promise<unknown> {
  const reader = message.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let size = 0, text = '';
  try {
    if (Number(message.headers.get('content-length')) > maximum) throw new BodyTooLarge();
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new BodyTooLarge();
      text += decoder.decode(value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
// Internal transport only. Callers must enforce their own method/release policy.
export async function boundedRpcCall(endpoint:string,method:string,params:unknown[]=[],fetcher:typeof fetch=fetch):Promise<unknown>{
  try{
    const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok){await response.body?.cancel();throw Error();}
    const payload=await boundedJson(response,250_000);
    if(!record(payload)||payload.jsonrpc!=='2.0'||payload.id!==1||!Object.prototype.hasOwnProperty.call(payload,'result')||Object.prototype.hasOwnProperty.call(payload,'error'))throw Error();
    return payload.result;
  }catch{throw Error('RPC could not verify the operation. Reconcile any saved transaction before submitting again.');}
}
function validParams(method: string, params: unknown[]): boolean {
  if (['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(method)) return params.length === 1 && typeof params[0] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(params[0]);
  if (method === 'eth_getBalance' || method === 'eth_getTransactionCount') return params.length === 2 && typeof params[0] === 'string' && /^0x[0-9a-fA-F]{40}$/.test(params[0]) && ['latest', 'pending'].includes(String(params[1]));
  if (method === 'eth_estimateGas') {
    const p = params[0];
    return params.length === 1 && record(p) && typeof p.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(p.from) && typeof p.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(p.to) && typeof p.value === 'string' && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(p.value);
  }
  if (method === 'eth_getBlockByNumber') return params.length === 2 && params[0] === 'latest' && params[1] === false;
  return params.length === 0;
}
// Per-instance backstop; deployment-wide quotas require an external shared limiter.
export class RpcRateLimit {
  private readonly hits = new Map<string, {count: number; reset: number}>();
  constructor(private readonly capacity = 10_000, private readonly allowance = 60, private readonly windowMs = 60_000) {}
  accept(ip: string, now: number): boolean {
    for (const [key, slot] of this.hits) if (now >= slot.reset) this.hits.delete(key);
    if (ip.length > 128) return false;
    const slot = this.hits.get(ip);
    if (slot) return ++slot.count <= this.allowance;
    if (this.hits.size >= this.capacity) return false;
    this.hits.set(ip, {count: 1, reset: now + this.windowMs});
    return true;
  }
}
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const failure = (id: number | null, code: number, message: string, status: number) => reply({jsonrpc: '2.0', id, error: {code, message}}, status);
export function createRpcProxy(endpoint: string, options: {fetcher?: typeof fetch; limiter?: RpcRateLimit; now?: () => number; admit?: (id:number)=>Promise<Response|null>} = {}) {
  const fetcher = options.fetcher ?? fetch, limiter = options.limiter ?? new RpcRateLimit(), now = options.now ?? Date.now;
  return async function POST(request: Request): Promise<Response> {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (!limiter.accept(ip, now())) return failure(null, -32005, 'Rate limit exceeded', 429);
    let body: unknown;
    try { body = await boundedJson(request, 300_000); }
    catch (error) { return error instanceof BodyTooLarge ? failure(null, -32600, 'Request too large', 413) : failure(null, -32700, 'Invalid JSON', 400); }
    const value = record(body) ? body : {}, id = typeof value.id === 'number' && Number.isSafeInteger(value.id) ? value.id : null;
    const method = value.method, params = value.params ?? [];
    if (value.jsonrpc !== '2.0' || id === null || typeof method !== 'string' || !Array.isArray(params) || !METHODS.has(method) || !validParams(method, params)) return failure(id, -32600, 'Invalid or disallowed request', 400);
    if(options.admit){try{const refused=await options.admit(id);if(refused)return refused;}catch{return failure(id,-32000,'RPC admission unavailable',503);}}
    try {
      const upstream = await fetcher(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id, method, params}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000)});
      if (!upstream.ok) { await upstream.body?.cancel(); throw new Error('Upstream unavailable'); }
      const payload = await boundedJson(upstream, 1_000_000);
      if (!record(payload) || payload.jsonrpc !== '2.0' || payload.id !== id || !Object.prototype.hasOwnProperty.call(payload, 'result') || Object.prototype.hasOwnProperty.call(payload, 'error')) throw new Error('Invalid upstream response');
      // Never forward provider error messages, diagnostic fields or connection details.
      return reply({jsonrpc: '2.0', id, result: payload.result});
    } catch { return failure(id, -32000, 'RPC upstream unavailable', 502); }
  };
}
