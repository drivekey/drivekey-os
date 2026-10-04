import { access, readFile, readdir } from "node:fs/promises";
import { networkInterfaces, platform } from "node:os";
import { assertOfflineClock } from './clock';

export async function assertOfflineEnvironment(): Promise<void> {
  if (platform() !== "linux") throw new Error("Real vault setup/signing is available only in the booted offline Linux environment, not Windows.");
  await access("/etc/drivekey-live").catch(() => { throw new Error("Boot the DriveKey live image before creating or unlocking a real vault."); });
  await assertOfflineClock();
  if (Object.values(networkInterfaces()).flat().some(i => i && !i.internal)) throw new Error("Network addresses detected. Signing is disabled.");
  for (const name of await readdir("/sys/class/net")) {
    if (name !== "lo" && (await readFile(`/sys/class/net/${name}/operstate`, "utf8")).trim() !== "down") throw new Error("An active network interface was detected. Signing is disabled.");
  }
  if ((await readFile("/proc/swaps", "utf8")).trim().split("\n").length > 1) throw new Error("Swap must be disabled before unlocking a vault.");
}
