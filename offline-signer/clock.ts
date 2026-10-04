import { lstat, readFile } from 'node:fs/promises';

export function validateBootClock(state: unknown, bootId: string, uptime: number, now: number) {
  const s = state as Record<string, unknown> | null;
  if (!s || s.version !== 1 || s.rtcZone !== 'Europe/Warsaw' || s.bootId !== bootId
      || typeof s.epoch !== 'number' || !Number.isFinite(s.epoch)
      || s.epoch < 946684800 || s.epoch > 4133980800
      || typeof s.uptime !== 'number' || !Number.isFinite(s.uptime)
      || !Number.isFinite(uptime) || !Number.isFinite(now)
      || s.uptime < 0 || uptime < s.uptime
      || Math.abs(now - (s.epoch + uptime - s.uptime)) > 5) {
    throw new Error('Clock initialization is missing, stale or the system clock changed. Signing is locked.');
  }
}

export async function assertOfflineClock() {
  try {
    for (const file of ['/etc/drivekey-rtc-zone', '/run/drivekey-clock.json']) {
      const info = await lstat(file);
      if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022)) throw new Error('Untrusted clock record');
    }
    if ((await readFile('/etc/drivekey-rtc-zone', 'utf8')).trim() !== 'Europe/Warsaw') throw new Error('Wrong clock profile');
    const state: unknown = JSON.parse(await readFile('/run/drivekey-clock.json', 'utf8'));
    const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    const uptime = Number((await readFile('/proc/uptime', 'utf8')).trim().split(/\s+/)[0]);
    validateBootClock(state, bootId, uptime, Date.now() / 1000);
  } catch {
    throw new Error('Clock initialization is missing, stale or the system clock changed. Signing is locked.');
  }
}
