import { quotaApi as apiCallApi } from '@/services/api/quota';
import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  CODEX_CONFIG,
  buildCodexQuotaWindows,
  normalizeCodexAccountCredits,
} from '@/features/quota/providers/codex/data';
import type { CodexQuotaState, CodexUsagePayload } from '@/types';
import { type ApiCallResult } from '@/services/api';
import { normalizeCodexResetCreditsPayload, parseCodexUsagePayload } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const originalApiCallRequest = apiCallApi.read;

const result = (statusCode: number, body: unknown = null): ApiCallResult => ({
  statusCode,
  header: {},
  bodyText: body === null ? '' : JSON.stringify(body),
  body,
});

const CURRENT_CODEX_USAGE_PAYLOAD: CodexUsagePayload = {
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 1,
      limit_window_seconds: 604800,
      reset_after_seconds: 601888,
      reset_at: 1785902974,
    },
    secondary_window: null,
  },
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark',
      metered_feature: 'codex_bengalfox',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 604800,
          reset_after_seconds: 602111,
          reset_at: 1785903197,
        },
        secondary_window: null,
      },
    },
  ],
  rate_limit_reset_credits: {
    available_count: 1,
    applicable_available_count: 0,
  },
};

afterEach(() => {
  apiCallApi.read = originalApiCallRequest;
});

describe('Codex current usage payload', () => {
  test('parses the proxied JSON body and classifies both primary weekly windows', () => {
    const payload = parseCodexUsagePayload(JSON.stringify(CURRENT_CODEX_USAGE_PAYLOAD));
    expect(payload).not.toBeNull();

    const windows = buildCodexQuotaWindows(payload!, t);

    expect(windows.map(({ id }) => id)).toEqual(['weekly', 'gpt-5-3-codex-spark-weekly-0']);
    expect(windows.map(({ labelKey }) => labelKey)).toEqual([
      'codex_quota.secondary_window',
      'codex_quota.additional_secondary_window',
    ]);
    expect(windows.map(({ usedPercent }) => usedPercent)).toEqual([1, 0]);
    expect(windows[1]?.labelParams).toEqual({ name: 'GPT-5.3-Codex-Spark' });
  });

  // Like the Codex CLI, the backend decides on redemption whether anything needs a reset.
  test('shows reset support when total credits remain but none currently apply', () => {
    const summary = normalizeCodexResetCreditsPayload(
      CURRENT_CODEX_USAGE_PAYLOAD.rate_limit_reset_credits
    );

    expect(summary.invalidPayload).toBeFalse();
    expect(summary.availableCount).toBe(1);

    const quota: CodexQuotaState = {
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: summary.availableCount,
    };
    expect(CODEX_CONFIG.canResetQuota?.(quota)).toBeTrue();
  });
});

describe('Codex account credits', () => {
  test('normalizes remaining balance without confusing it with manual resets', () => {
    expect(
      normalizeCodexAccountCredits({ has_credits: false, unlimited: false, balance: '0' })
    ).toEqual({ balance: '0', unlimited: false });
    expect(
      normalizeCodexAccountCredits({ has_credits: true, unlimited: false, balance: ' 12.50 ' })
    ).toEqual({ balance: '12.50', unlimited: false });
    expect(normalizeCodexAccountCredits({ unlimited: true, balance: null })).toEqual({
      balance: null,
      unlimited: true,
    });
    expect(normalizeCodexAccountCredits(null)).toEqual({ balance: null, unlimited: false });
    expect(normalizeCodexAccountCredits({ balance: 'not available' })).toEqual({
      balance: null,
      unlimited: false,
    });
    expect(normalizeCodexAccountCredits({ balance: -1 })).toEqual({
      balance: null,
      unlimited: false,
    });
  });

  test('reads credits from the existing usage request and forwards them into quota state', async () => {
    const requests: Array<{ authIndex: string; resource: string }> = [];
    apiCallApi.read = async (authIndex, resource) => {
      const payload = { authIndex, resource };
      requests.push(payload);
      if (payload.resource === 'usage') {
        return result(200, {
          ...CURRENT_CODEX_USAGE_PAYLOAD,
          credits: { has_credits: true, unlimited: false, balance: '8.75' },
        });
      }
      if (payload.resource === 'reset_credits') {
        return result(200, { available_count: 1, credits: [] });
      }
      throw new Error(`Unexpected resource: ${payload.resource}`);
    };

    const data = await CODEX_CONFIG.fetchQuota(
      { name: 'codex.json', type: 'codex', auth_index: 'codex:1' },
      t
    );
    const state = CODEX_CONFIG.buildSuccessState(data);
    expect(state.creditBalance).toBe('8.75');
    expect(state.creditsUnlimited).toBeFalse();
    expect(state.rateLimitResetCreditsAvailableCount).toBe(1);
    expect(requests.filter((request) => request.resource === 'usage')).toHaveLength(1);
  });
});

describe('Codex live subscription renewal', () => {
  test('prefers live active_until and identifies the credential to the quota service', async () => {
    const requests: Array<{ authIndex: string; resource: string }> = [];
    apiCallApi.read = async (authIndex, resource) => {
      const payload = { authIndex, resource };
      requests.push(payload);
      if (payload.resource === 'usage') return result(200, CURRENT_CODEX_USAGE_PAYLOAD);
      if (payload.resource === 'reset_credits') {
        return result(200, { available_count: 0, credits: [] });
      }
      if (payload.resource === 'subscription') {
        return result(200, { active_until: '2026-10-03T13:27:01Z' });
      }
      throw new Error(`Unexpected resource: ${payload.resource}`);
    };

    const quota = await CODEX_CONFIG.fetchQuota(
      {
        name: 'codex.json',
        type: 'codex',
        auth_index: 'codex:1',
        metadata: { chatgpt_account_id: 'account/id + space' },
        chatgpt_subscription_active_until: '2026-09-03T13:27:01Z',
      },
      t
    );

    expect(quota.subscriptionActiveUntil).toBe('2026-10-03T13:27:01Z');
    expect(requests.find((request) => request.resource === 'subscription')).toEqual({
      authIndex: 'codex:1',
      resource: 'subscription',
    });
  });

  test('falls back to the credential date when the subscription probe fails', async () => {
    apiCallApi.read = async (authIndex, resource) => {
      const payload = { authIndex, resource };
      if (payload.resource === 'usage') return result(200, CURRENT_CODEX_USAGE_PAYLOAD);
      if (payload.resource === 'reset_credits') {
        return result(200, { available_count: 0, credits: [] });
      }
      if (payload.resource === 'subscription') {
        return result(503, { error: 'temporarily unavailable' });
      }
      throw new Error(`Unexpected resource: ${payload.resource}`);
    };

    const quota = await CODEX_CONFIG.fetchQuota(
      {
        name: 'codex.json',
        type: 'codex',
        auth_index: 'codex:2',
        chatgpt_account_id: 'account-2',
        chatgpt_subscription_active_until: '2026-09-03T13:27:01Z',
      },
      t
    );

    expect(quota.subscriptionActiveUntil).toBe('2026-09-03T13:27:01Z');
  });
});
