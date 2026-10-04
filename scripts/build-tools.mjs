import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "outputs", "tools-v2");
await mkdir(output, { recursive: true });
await build({ entryPoints: [join(root, "offline-signer/cli.ts")], bundle: true, platform: "node", target: "node22", format: "cjs", outfile: join(output, "drivekey-signer.cjs"), define: { "process.env.NODE_ENV": '"production"' } });
await build({ entryPoints: [join(root, "offline-signer/gui-worker.ts")], bundle: true, platform: "node", target: "node22", format: "cjs", outfile: join(output, "drivekey-gui-worker.cjs") });
await build({ entryPoints: [join(root, "companion/cli.ts")], bundle: true, platform: "node", target: "node22", format: "cjs", outfile: join(output, "drivekey-companion.cjs") });
if (process.platform === "win32") {
  const compiler = join(process.env.WINDIR || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  execFileSync(compiler, ["/nologo", "/target:exe", "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll", `/out:${join(output, "VolumeWatcher.exe")}`, join(root, "companion/VolumeWatcher.cs")], { stdio: "inherit", windowsHide: true });
  await copyFile(process.execPath, join(output, "node.exe"));
}
console.log("Bundled offline signer and companion in outputs/tools-v2. No disks or wallets were opened.");
