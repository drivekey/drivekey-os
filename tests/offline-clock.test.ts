import { describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { assertOfflineClock, validateBootClock } from '../offline-signer/clock';
vi.mock('node:fs/promises', () => ({lstat: vi.fn(), readFile: vi.fn()}));
const epoch = 1791101909;
const state = {version:1,rtcZone:'Europe/Warsaw',bootId:'this-boot',epoch,uptime:10};
afterEach(() => vi.restoreAllMocks());
describe('offline boot clock guard', () => {
  it('accepts elapsed actual UTC, including after suspend', () => {
    expect(() => validateBootClock(state,'this-boot',3610,epoch+3600)).not.toThrow();
  });
  it.each([null, {}, {...state,bootId:'older-boot'}, {...state,rtcZone:'UTC'}, {...state,epoch:NaN}, {...state,uptime:-1}])('rejects absent, stale or invalid initialization %j', bad => {
    expect(() => validateBootClock(bad,'this-boot',20,epoch+10)).toThrow(/Clock initialization/);
  });
  it.each([-7200,-3600,-6,6,3600,7200])('rejects clock jump of %s seconds', delta => {
    expect(() => validateBootClock(state,'this-boot',20,epoch+10+delta)).toThrow(/Signing is locked/);
  });
  it('rejects a boot record from later uptime', () => {
    expect(() => validateBootClock(state,'this-boot',9,epoch-1)).toThrow();
  });
  it.each([{uid:1000,mode:0o644},{uid:0,mode:0o666},{uid:0,mode:0o664}])('rejects untrusted file ownership or permissions %j', info => {
    vi.mocked(fs.lstat).mockResolvedValue({isFile:()=>true,...info} as never);
    return expect(assertOfflineClock()).rejects.toThrow(/Clock initialization/);
  });
  it('rejects a symlink or missing record', async () => {
    vi.mocked(fs.lstat).mockResolvedValue({isFile:()=>false,uid:0,mode:0o644} as never);
    await expect(assertOfflineClock()).rejects.toThrow();
    vi.mocked(fs.lstat).mockRejectedValue(new Error('ENOENT'));
    await expect(assertOfflineClock()).rejects.toThrow();
  });
});
