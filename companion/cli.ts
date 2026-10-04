import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { CompanionEngine } from "./engine";
import { createCompanionServer, validateOrigin } from "./server";

async function main() {
  if (process.platform !== "win32") throw new Error("This companion requires Windows. No platform fallback pretends to observe USB events.");
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const directory = dirname(resolve(process.argv[1]));
  let origin = option("--origin");
  if (!origin) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    origin = (await rl.question("Paste the exact DriveKey website origin (https://... or http://127.0.0.1:3000): ")).trim(); rl.close();
  }
  validateOrigin(origin);
  const engine = new CompanionEngine(option("--state-dir") ?? join(directory, "state"));
  await engine.restore();
  console.log(`DriveKey companion v2\nPaired website origin: ${origin}\nOnly public metadata and transaction exchange files are accessed.\nNo private keys, vault unlock, or network broadcasts.\nKeep this program running outside your USB drive.\n`);
  const { server, enqueue } = createCompanionServer(engine, origin, 47831, code => console.log(`Website pairing code (valid 5 minutes): ${code}`));
  server.listen(47831, "127.0.0.1", () => console.log("Listening on loopback 127.0.0.1:47831. Windows may request local-network browser permission."));
  server.on("error", () => { console.error("Local port unavailable. Close the other companion instance and retry."); watcher.kill(); process.exitCode = 1; });
  const watcher = spawn(join(directory, "VolumeWatcher.exe"), [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let input = "";
  const generations = new Map<string, number>();
  watcher.stdout.on("data", bytes => {
    input += bytes.toString("utf8");
    if (input.length > 32_768) { input = ""; engine.nativeReady = false; return; }
    let end: number;
    while ((end = input.indexOf("\n")) >= 0) {
      const line = input.slice(0, end); input = input.slice(end + 1);
      try {
        const event = JSON.parse(line) as { type: string; roots: string[] };
        if (!["scan", "arrived", "removed"].includes(event.type) || !Array.isArray(event.roots) || event.roots.some(r => !/^[A-Z]:\\$/.test(r))) continue;
        engine.nativeReady = true;
        const type = event.type as "scan" | "arrived" | "removed";
        for (const root of event.roots) {
          const generation = (generations.get(root) ?? 0) + 1; generations.set(root, generation);
          const processEvent = () => enqueue(async () => { if (generations.get(root) === generation) await engine.event(type, [root]); }).catch(() => { console.error("Volume processing stopped; reconnect after checking your drive."); });
          void processEvent();
          // Retry mounting, not physical presence. A later removal cancels these retries.
          if (type !== "removed") for (const delay of [300, 900, 2000, 4000]) setTimeout(processEvent, delay);
        }
      } catch { engine.nativeReady = false; }
    }
  });
  watcher.on("error", () => { engine.nativeReady = false; console.error("Native observer could not start. Re-extract the complete companion package."); });
  watcher.on("exit", () => { engine.nativeReady = false; console.error("Native observer stopped. USB-triggered actions are unavailable."); });
  process.on("SIGINT", () => { watcher.kill(); server.close(); });
  process.on("SIGTERM", () => { watcher.kill(); server.close(); });
}
main().catch(() => { console.error("Companion did not start. Check the website origin, package files, and local write permissions."); process.exitCode = 1; });
