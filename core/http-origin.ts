// NextURL normalizes 127.0.0.1 to localhost. Compare the browser's Origin with
// the actual Host header, keeping exact ports/protocol; never trust forwarded hosts.
export function sameRequestOrigin(origin: string | null, host: string | null, protocol: string): boolean {
  if (!origin) return true; // Non-browser API clients: no cookie/session authority on this stateless API.
  if (!host) return false;
  try {
    const value=new URL(origin);
    return value.origin===origin && value.host===host && value.protocol===protocol && ['http:','https:'].includes(protocol);
  } catch { return false; }
}
