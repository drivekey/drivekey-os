import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_JSON_BYTES, parseJson } from "./protocol";
type JsonLimit = typeof MAX_JSON_BYTES | 131072;
function boundedJson(text:string,maxBytes:JsonLimit){
  if(![MAX_JSON_BYTES,131072].includes(maxBytes)||Buffer.byteLength(text,'utf8')>maxBytes)throw new Error('JSON exceeds its bounded file limit.');
  return maxBytes===MAX_JSON_BYTES?parseJson(text):JSON.parse(text);
}

export async function safeDirectory(directory: string): Promise<string> {
  const path = resolve(directory);
  if ((await lstat(path)).isSymbolicLink() || !(await lstat(path)).isDirectory()) throw new Error("Exchange path must be a real directory, not a link.");
  const actual = await realpath(path);
  if (process.platform === "win32" ? actual.toLowerCase() !== path.toLowerCase() : actual !== path) throw new Error("Linked exchange paths are not permitted.");
  return path;
}

export async function readJsonFile(directory: string, filename: string, maxBytes:JsonLimit=MAX_JSON_BYTES): Promise<unknown> {
  if (!/^[a-z0-9-]+\.json$/.test(filename)) throw new Error("Invalid exchange filename.");
  const path = join(await safeDirectory(directory), filename);
  const before = await lstat(path);
  if (![MAX_JSON_BYTES,131072].includes(maxBytes)||before.isSymbolicLink() || !before.isFile() || before.size > maxBytes) throw new Error("Exchange file is linked, oversized, or not a regular file.");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes || before.ino !== stat.ino || before.dev !== stat.dev) throw new Error("Exchange file changed while opening.");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error("Exchange file is too large.");
    return boundedJson(buffer.subarray(0, bytesRead).toString("utf8"),maxBytes);
  } finally { await file.close(); }
}

export async function writeJsonFile(directory: string, filename: string, value: unknown, replace = false, maxBytes:JsonLimit=MAX_JSON_BYTES): Promise<void> {
  if (!/^[a-z0-9-]+\.json$/.test(filename)) throw new Error("Invalid exchange filename.");
  const dir = await safeDirectory(directory), target = join(dir, filename);
  const text = JSON.stringify(value, null, 2) + "\n";
  boundedJson(text,maxBytes);
  if (!replace) {
    // Exclusive creation never replaces an existing vault. Metadata is published last.
    const file = await open(target, "wx", 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  } else {
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Refusing to replace a linked file."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temp = join(dir, `.drivekey-${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    try { await rename(temp, target); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  }
  if (process.platform !== "win32") {
    const directoryHandle = await open(dir, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
  if (JSON.stringify(await readJsonFile(dir, filename,maxBytes)) !== JSON.stringify(value)) throw new Error("USB read-back verification failed. Do not eject yet.");
}
