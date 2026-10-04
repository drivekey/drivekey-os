import { guiAction, safeGuiError } from "./gui-service";
import { multiOfflineAction } from "./multi-service";
import { offlineDashboard } from "./dashboard";
import { readJsonFile } from "../core/files";
import { FILES, validateRequest } from "../core/protocol";
import { inspectRequest } from "./inspection";
import { tradeOfflineAction } from './trade-service';
import { rulesOfflineAction } from './rules-service';
// The GUI sends bounded JSON over an anonymous pipe, never arguments or the environment.
// Fixed path: the guarded launcher mounts this USB exchange directory.
async function main() {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 65536) throw new Error("Oversized command");
    chunks.push(Buffer.from(chunk));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (input?.scope === 'rules') { process.stdout.write(JSON.stringify({ok:true,...await rulesOfflineAction(input,'/mnt/drivekey/DriveKey')})); return; }
  if (input?.scope === 'trade') { process.stdout.write(JSON.stringify({ok:true,...await tradeOfflineAction(input,'/mnt/drivekey/DriveKey')})); return; }
  if (input?.action === "inspect") {
    if (Object.keys(input).some(k=>k!=="action"&&k!=="scope") || (input.scope!==undefined&&input.scope!=="multi")) throw new Error("Invalid inspection command");
    process.stdout.write(JSON.stringify({ok:true,inspection:await inspectRequest("/mnt/drivekey/DriveKey",input.scope==="multi")}));return;
  }
  if (input && input.action === "dashboard") {
    if (Object.keys(input).length !== 1) throw new Error("Invalid dashboard command");
    process.stdout.write(JSON.stringify({ok:true,...await offlineDashboard("/mnt/drivekey/DriveKey")}));
    return;
  }
  let result;
  try { result = input.scope === "multi" ? await multiOfflineAction(input, "/mnt/drivekey/DriveKey") : await guiAction(input, "/mnt/drivekey/DriveKey"); }
  catch (error) {
    if (input.scope !== "multi" && input.action === "review" && error instanceof Error && /expired|clock/.test(error.message)) {
      const request = validateRequest(await readJsonFile("/mnt/drivekey/DriveKey", FILES.request), Date.now(), false);
      process.stdout.write(JSON.stringify({ok:false,error:safeGuiError(error),clock:{now:new Date().toISOString(),created:request.createdAt,expires:request.expiresAt}}));
      process.exitCode=1; return;
    }
    throw error;
  }
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
}
main().catch(error => { process.stdout.write(JSON.stringify({ ok: false, error: safeGuiError(error) })); process.exitCode = 1; });
