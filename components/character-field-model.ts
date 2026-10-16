import { LOGO_MASK } from './character-logo-mask';
// Decorative data only: never read wallet state, transaction data or user input.
export const FIELD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>/{}[]:;?.';
export const LOGO_WIDTH = Math.max(...LOGO_MASK.map(row => row.length));
export const LOGO_HEIGHT = LOGO_MASK.length;
export const LOGO_GAP = 14;
export function wrap(value: number, size: number) { return ((value % size) + size) % size; }
function hash(value: number) {
  let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
export function fieldGlyph(column: number, row: number, seconds: number) {
  const seed = hash(column * 18397 + row * 7907 + 41);
  const period = .24 + (seed % 800) / 1000;
  const tick = Math.floor(seconds / period + (seed % 97) / 97);
  return FIELD_ALPHABET[wrap(seed + tick * (1 + seed % (FIELD_ALPHABET.length - 1)), FIELD_ALPHABET.length)];
}
export function fieldShade(column: number, row: number) { return hash(column * 313 + row * 7919) % 4; }

export function logoColumn(columns: number, band: number, seconds: number) {
  return wrap(LOGO_WIDTH + 4 + band * 31 + Math.floor(seconds * 8), columns + LOGO_WIDTH) - LOGO_WIDTH;
}
export function logoGlyph(column: number, row: number, columns: number, seconds: number): string | null {
  const bandHeight = LOGO_HEIGHT + LOGO_GAP;
  const localRow = row % bandHeight;
  if (localRow >= LOGO_HEIGHT) return null;
  const left = logoColumn(columns, Math.floor(row / bandHeight), seconds);
  const localColumn = column - left;
  if (localColumn < 0 || localColumn >= LOGO_WIDTH) return null;
  const glyph = LOGO_MASK[localRow][localColumn];
  // Transparent holes remain live noise, not a rectangular image overlay.
  return glyph && glyph !== ' ' ? glyph : null;
}
export function composedGlyph(column: number, row: number, columns: number, seconds: number) {
  return logoGlyph(column, row, columns, seconds) ?? fieldGlyph(column, row, seconds);
}
