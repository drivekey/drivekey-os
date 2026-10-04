// Display only: never changes request timestamps, the system clock or expiry rules.
export function formatUtc(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

export function validTimeZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(0); return true; }
  catch { return false; }
}

// Intl applies the selected zone's offset at this instant, including DST.
export function formatZonedTime(value: string | number, zone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !validTimeZone(zone)) return 'Unavailable';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  const offset=part('timeZoneName').replace('GMT', 'UTC').replace('UTC+00:00','UTC');
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} ${offset}`;
}
