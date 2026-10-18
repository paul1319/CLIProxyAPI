import { describe, expect, test } from 'bun:test';
import { startQuotaRefresh } from '@/features/quota/quotaRefresh';
import { QUOTA_REFRESH_INTERVAL_MS, type QuotaReadOptions } from '@/services/api/quota';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('visible quota refresh lifecycle', () => {
  test('restores before refreshing, waits 300 seconds after completion and pauses while hidden', async () => {
    let visible = true;
    let pending: (() => void) | undefined;
    const calls: QuotaReadOptions[] = [];
    const intervals: number[] = [];
    const loop = startQuotaRefresh({
      visible: () => visible,
      load: async (options) => {
        calls.push(options);
      },
      schedule: (callback, delay) => {
        pending = callback;
        intervals.push(delay);
        return 1;
      },
      cancel: () => {
        pending = undefined;
      },
    });
    await flush();
    expect(calls.map((call) => call.mode)).toEqual(['cached', 'refresh']);
    expect(intervals).toEqual([300_000]);
    pending!();
    await flush();
    expect(calls.map((call) => call.mode)).toEqual(['cached', 'refresh', 'refresh']);
    expect(intervals.at(-1)).toBe(QUOTA_REFRESH_INTERVAL_MS);
    visible = false;
    loop.visibilityChanged();
    expect(pending).toBeUndefined();
    expect(calls).toHaveLength(3);
    visible = true;
    loop.visibilityChanged();
    await flush();
    expect(calls.map((call) => call.mode)).toEqual([
      'cached',
      'refresh',
      'refresh',
      'cached',
      'refresh',
    ]);
    loop.stop();
    expect(pending).toBeUndefined();
  });

  test('does not start a provider refresh after unmount during snapshot restore', async () => {
    let resolve!: () => void;
    const restore = new Promise<void>((done) => {
      resolve = done;
    });
    const calls: QuotaReadOptions[] = [];
    const loop = startQuotaRefresh({
      visible: () => true,
      load: (options) => {
        calls.push(options);
        return restore;
      },
      schedule: () => {
        throw new Error('scheduled after stop');
      },
      cancel: () => {},
    });
    loop.stop();
    resolve();
    await flush();
    expect(calls.map((call) => call.mode)).toEqual(['cached']);
  });
});
