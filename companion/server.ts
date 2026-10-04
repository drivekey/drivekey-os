import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseJson, MAX_JSON_BYTES } from "../core/protocol";
import { CompanionEngine } from "./engine";

export function validateOrigin(value: string): string {
  const u = new URL(value);
  if (u.origin !== value || u.username || u.password || (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)))) throw new Error("Use an exact HTTPS website origin, or localhost for development.");
  return u.origin;
}

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new Error("JSON Content-Type required.");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > MAX_JSON_BYTES) throw new Error("Request too large."); chunks.push(bytes); }
  return parseJson(Buffer.concat(chunks).toString("utf8"));
}

export function createCompanionServer(engine: CompanionEngine, origin: string, port = 47831, onPairCode: (code: string) => void = () => {}) {
  validateOrigin(origin);
  let code = String(randomInt(10_000_000, 100_000_000));
  let codeExpiry = Date.now() + 5 * 60_000, attempts = 0, rateReset = Date.now() + 60_000;
  const sessions = new Map<string, number>();
  let sequence: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => { const next = sequence.then(action, action); sequence = next.catch(() => {}); return next; };
  const rotate = () => { code = String(randomInt(10_000_000, 100_000_000)); codeExpiry = Date.now() + 5 * 60_000; onPairCode(code); };
  onPairCode(code);
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Content-Type", "application/json");
    const reply = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (req.headers.host !== `127.0.0.1:${port}`) return reply(403, { error: "Invalid local host." });
    if (req.url === "/health" && req.method === "GET" && !req.headers.origin) return reply(200, { version: 2, nativeReady: engine.nativeReady });
    if (req.headers.origin !== origin) return reply(403, { error: "Website is not locally paired. Restart the companion for the intended website origin." });
    res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true"); return reply(204, undefined);
    }
    try {
      if (req.url === "/v1/pair" && req.method === "POST") {
        if (Date.now() > rateReset) { attempts = 0; rateReset = Date.now() + 60_000; }
        if (++attempts > 5) return reply(429, { error: "Too many pairing attempts. Wait one minute." });
        const input = z.object({ code: z.string().regex(/^\d{8}$/) }).strict().parse(await body(req));
        if (Date.now() > codeExpiry) { rotate(); return reply(403, { error: "Pairing code expired. Use the new code shown in the companion." }); }
        if (!timingSafeEqual(Buffer.from(code), Buffer.from(input.code))) return reply(403, { error: "Incorrect pairing code." });
        for (const [token, expiry] of sessions) if (Date.now() >= expiry) sessions.delete(token);
        if (sessions.size >= 4) return reply(409, { error: "Close old sessions and restart the companion before pairing more browsers." });
        const token = randomBytes(32).toString("hex"); sessions.set(token, Date.now() + 24 * 60 * 60_000); rotate();
        return reply(200, { token, version: 2 });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!sessions.has(token) || Date.now() >= sessions.get(token)!) return reply(401, { error: "Pair the website with the running companion." });
      if (req.url === "/v1/status" && req.method === "GET") return reply(200, engine.status());
      if (req.method !== "POST") return reply(405, { error: "Method not supported." });
      const input = await body(req);
      await enqueue(async () => {
        if (req.url === "/v1/select") engine.select(z.object({ deviceId: z.string().uuid() }).strict().parse(input).deviceId);
        else if (req.url === "/v1/prepare") await engine.prepare(z.object({ request: z.unknown(), consent: z.literal(true) }).strict().parse(input).request, token);
        else if (req.url === "/v1/resume") { z.object({ consent: z.literal(true) }).strict().parse(input); await engine.resume(token); }
        else if (req.url === "/v1/cancel") { z.object({}).strict().parse(input); await engine.cancel(token); }
        else throw new Error("Endpoint not supported.");
      });
      reply(200, engine.status());
    } catch (error) { reply(400, { error: error instanceof z.ZodError ? "Malformed request." : error instanceof Error ? error.message : "Operation stopped." }); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.maxHeadersCount = 32;
  return { server, enqueue };
}
