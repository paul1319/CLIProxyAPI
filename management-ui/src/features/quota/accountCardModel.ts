import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';
import { normalizePlanType, parseIsoToMs, resolveResetMs } from '@/utils/quota';
import type { QuotaProviderType } from './providers/types';
import type { QuotaCardState } from './providers';
import {
  resolveAntigravityBucketLabelKey,
  resolveAntigravityGroupLabelKey,
} from './providers/antigravity/labels';

/**
 * How far a window's exhaustion reaches.
 *
 * - `gating`: the account stops serving when it runs out (Codex 5-hour/weekly,
 *   Claude 5-hour/7-day, every Antigravity bucket, Devin/Kimi/Meta rows).
 * - `scoped`: only one model or feature stops (code review, Spark, Sonnet, Opus…).
 * - `spend`: a money cap (extra usage, pay-as-you-go), never a rate limit.
 */
export type LimitScope = 'gating' | 'scoped' | 'spend';

export interface AccountLimit {
  id: string;
  label: string;
  remaining: number | null;
  resetAtMs: number | null;
  resetLabel?: string;
  amount?: string;
  scope: LimitScope;
  /** Model pool sharing this window (Antigravity/plugin groups). */
  pool?: string;
}
export interface AccountOverview {
  plan: string | null;
  credits: { label: string; value: string; resetAtMs?: number | null; detail?: string }[];
  renewalAtMs: number | null;
  limits: AccountLimit[];
  notes: string[];
  /** The most constrained gating window — the card's focal figure. */
  heroLimitId: string | null;
  /**
   * Whether the account can serve right now according to its gating windows.
   * Pooled providers serve while any pool has capacity. Null when no gating
   * window reports a value.
   */
  available: boolean | null;
}

/** Codex windows that stop the whole account; everything else is model- or feature-scoped. */
const CODEX_GATING_IDS = new Set(['five-hour', 'weekly', 'monthly']);
/** Claude windows that stop the whole account; per-model 7-day windows are scoped. */
const CLAUDE_GATING_IDS = new Set(['five-hour', 'seven-day']);
const POOLED_PROVIDERS = new Set<QuotaProviderType>(['antigravity', 'plugin']);

/**
 * Pick the window that best answers "how much can this account still do".
 *
 * Only gating windows qualify. The lowest remaining value wins; among
 * exhausted windows the one that resets last wins, because the account only
 * serves again once every exhausted window has reset. Remaining ties otherwise
 * keep list order, which puts the shorter window first.
 */
export function pickHeroLimit(limits: readonly AccountLimit[]): AccountLimit | null {
  let best: AccountLimit | null = null;
  for (const limit of limits) {
    if (limit.scope !== 'gating' || limit.remaining === null) continue;
    if (best === null || best.remaining === null || limit.remaining < best.remaining) {
      best = limit;
      continue;
    }
    if (
      limit.remaining === best.remaining &&
      limit.remaining <= 0 &&
      (limit.resetAtMs ?? -Infinity) > (best.resetAtMs ?? -Infinity)
    ) {
      best = limit;
    }
  }
  return best;
}

/** Serving state from gating windows; pooled providers serve while any pool has room. */
export function resolveAvailability(
  type: QuotaProviderType,
  limits: readonly AccountLimit[]
): boolean | null {
  const gating = limits.filter((limit) => limit.scope === 'gating' && limit.remaining !== null);
  if (gating.length === 0) return null;
  if (!POOLED_PROVIDERS.has(type)) return gating.every((limit) => (limit.remaining ?? 0) > 0);
  const pools = new Map<string, boolean>();
  for (const limit of gating) {
    const key = limit.pool ?? '';
    pools.set(key, (pools.get(key) ?? true) && (limit.remaining ?? 0) > 0);
  }
  return [...pools.values()].some(Boolean);
}

const finalize = (type: QuotaProviderType, overview: AccountOverview): AccountOverview => {
  overview.heroLimitId = pickHeroLimit(overview.limits)?.id ?? null;
  overview.available = resolveAvailability(type, overview.limits);
  return overview;
};

/** Presentation only: provider adapters continue to own upstream normalization. */
export function buildAccountOverview(
  type: QuotaProviderType,
  state: QuotaCardState | undefined,
  t: TFunction,
  locale?: string
): AccountOverview {
  const result: AccountOverview = {
    plan: null,
    credits: [],
    renewalAtMs: null,
    limits: [],
    notes: [],
    heroLimitId: null,
    available: null,
  };
  if (!state) return result;
  buildLimits(type, state, t, locale, result);
  return finalize(type, result);
}

function buildLimits(
  type: QuotaProviderType,
  state: QuotaCardState,
  t: TFunction,
  locale: string | undefined,
  result: AccountOverview
): void {
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const money = (value: number | null, currency = 'USD') =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  const remaining = (used: number | null) =>
    used === null ? null : Math.max(0, Math.min(100, 100 - used));
  if (type === 'codex' || type === 'claude') {
    const quota = state as CodexQuotaState | ClaudeQuotaState;
    const gatingIds = type === 'codex' ? CODEX_GATING_IDS : CLAUDE_GATING_IDS;
    result.limits = (quota.windows ?? []).map((window): AccountLimit => ({
      id: window.id,
      label: window.labelKey
        ? t(window.labelKey, ('labelParams' in window ? window.labelParams : {}) ?? {})
        : window.label,
      remaining: remaining(window.usedPercent),
      resetAtMs: window.resetAtMs ?? null,
      resetLabel: window.resetLabel,
      scope: gatingIds.has(String(window.id).replace(/_/g, '-')) ? 'gating' : 'scoped',
    }));
    if (type === 'codex') {
      const codex = state as CodexQuotaState;
      const plan = normalizePlanType(codex.planType);
      const keys: Record<string, string> = {
        pro: 'plan_pro',
        prolite: 'plan_prolite',
        'pro-lite': 'plan_prolite',
        pro_lite: 'plan_prolite',
        plus: 'plan_plus',
        team: 'plan_team',
        free: 'plan_free',
        self_serve_business_prolite: 'plan_business_premium',
      };
      result.plan = plan
        ? keys[plan]
          ? t(`codex_quota.${keys[plan]}`)
          : (codex.planType ?? null)
        : null;
      result.renewalAtMs = resolveResetMs([codex.subscriptionActiveUntil]);
      const balance = codex.creditBalance;
      if (codex.creditsUnlimited || (balance !== null && balance !== undefined)) {
        const numeric = balance == null || balance.trim() === '' ? NaN : Number(balance);
        result.credits.push({
          label: t('account_quota.credits'),
          value: codex.creditsUnlimited
            ? t('codex_quota.credit_unlimited')
            : Number.isFinite(numeric)
              ? number(numeric)
              : (balance ?? '—'),
        });
      }
    } else {
      const claude = state as ClaudeQuotaState;
      result.plan = claude.planType
        ? t(`claude_quota.${claude.planType}`, { defaultValue: claude.planType })
        : null;
      for (const balance of claude.dollarWindows ?? []) {
        result.credits.push({
          // Upstream keys are internal code names; only the known one gets a specific label.
          label:
            balance.key === 'iguana_necktie'
              ? t('claude_quota.cloud_session_credits')
              : t('account_quota.credits'),
          value: money(balance.remainingDollars),
          detail: t('claude_quota.usage_spent_limit', {
            spent: money(balance.usedDollars),
            limit: money(balance.limitDollars),
          }),
          resetAtMs: parseIsoToMs(balance.resetsAt),
        });
      }
      const extra = claude.extraUsage;
      if (extra) {
        // An enabled cap already shows up as its own row; only a disabled one needs words.
        if (extra.isEnabled === false)
          result.notes.push(
            `${t('claude_quota.extra_usage_label')}: ${t('claude_quota.extra_usage_disabled')}`
          );
        if (extra.userDisabled) result.notes.push(t('claude_quota.extra_usage_user_disabled'));
        if (extra.spendLimitReached)
          result.notes.push(t('claude_quota.extra_usage_spend_limit_reached'));
        if (extra.disabledReason)
          result.notes.push(
            t('claude_quota.extra_usage_disabled_reason', { reason: extra.disabledReason })
          );
        if (extra.monthlyLimit !== null || extra.usedCredits !== null) {
          result.limits.push({
            id: 'extra-usage',
            label: t('claude_quota.extra_usage_label'),
            remaining: remaining(extra.utilization),
            resetAtMs: null,
            scope: 'spend',
            amount: t('claude_quota.usage_spent_limit', {
              spent: money(
                extra.usedCredits === null ? null : extra.usedCredits / 100,
                extra.currency ?? 'USD'
              ),
              limit: money(
                extra.monthlyLimit === null ? null : extra.monthlyLimit / 100,
                extra.currency ?? 'USD'
              ),
            }),
          });
        }
      }
    }
  } else if (type === 'xai') {
    const billing = (state as XaiQuotaState).billing;
    if (!billing) return;
    result.plan =
      billing.planLabel ??
      (billing.mode === 'paid-health'
        ? t('xai_quota.plan_paid')
        : billing.monthlyLimitCents === 150000
          ? t('xai_quota.plan_supergrok_heavy')
          : billing.monthlyLimitCents === 15000
            ? t('xai_quota.plan_supergrok')
            : null);
    result.renewalAtMs = parseIsoToMs(billing.billingPeriodEnd);
    if (billing.prepaidBalanceCents != null)
      result.credits.push({
        label: t('account_quota.credits'),
        value: money(billing.prepaidBalanceCents / 100),
      });
    if (billing.mode === 'paid-health') result.notes.push(t('xai_quota.paid_health'));
    else {
      if (billing.periodType === 'weekly' || billing.monthlyLimitCents === null) {
        result.limits.push({
          id: 'xai-period',
          label: t(
            billing.periodType === 'weekly' ? 'xai_quota.weekly_limit' : 'xai_quota.monthly_credits'
          ),
          remaining: remaining(billing.usagePercent),
          resetAtMs: billing.resetAtMs ?? null,
          scope: 'gating',
        });
      }
      if (billing.monthlyLimitCents !== null)
        result.limits.push({
          id: 'xai-monthly',
          label: t('xai_quota.monthly_credits'),
          remaining: remaining(billing.usedPercent),
          resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
          scope: 'gating',
          amount: t('claude_quota.usage_spent_limit', {
            spent: money(
              billing.includedUsedCents === null ? null : billing.includedUsedCents / 100
            ),
            limit: money(billing.monthlyLimitCents / 100),
          }),
        });
      if ((billing.onDemandCapCents ?? 0) > 0 || (billing.onDemandUsedCents ?? 0) > 0)
        result.limits.push({
          id: 'xai-on-demand',
          label: t('xai_quota.pay_as_you_go_label'),
          remaining: remaining(billing.onDemandUsedPercent),
          resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
          scope: 'spend',
          amount: t('claude_quota.usage_spent_limit', {
            spent: money(
              billing.onDemandUsedCents === null ? null : billing.onDemandUsedCents / 100
            ),
            limit: money(billing.onDemandCapCents === null ? null : billing.onDemandCapCents / 100),
          }),
        });
      for (const product of billing.productUsage ?? [])
        result.notes.push(
          `${product.product}: ${product.usagePercent === null ? '—' : number(product.usagePercent)}%`
        );
    }
  } else if (type === 'antigravity' || type === 'plugin') {
    const quota = state as AntigravityQuotaState;
    const subscription = quota.subscription;
    result.plan = subscription?.tierName || subscription?.tierId || subscription?.plan || null;
    result.limits = (quota.groups ?? []).flatMap((group) => {
      const groupKey = type === 'antigravity' ? resolveAntigravityGroupLabelKey(group.label) : null;
      const pool = groupKey ? t(`antigravity_quota.${groupKey}`) : group.label;
      return group.buckets.map((bucket): AccountLimit => {
        const bucketKey =
          type === 'antigravity'
            ? resolveAntigravityBucketLabelKey(bucket.label, bucket.window)
            : null;
        return {
          id: `${group.id}:${bucket.id}`,
          label: bucketKey ? t(`antigravity_quota.${bucketKey}`) : bucket.label,
          remaining: Math.max(0, Math.min(100, bucket.remainingFraction * 100)),
          resetAtMs: bucket.resetAtMs ?? parseIsoToMs(bucket.resetTime),
          scope: 'gating',
          pool,
        };
      });
    });
    if (type === 'plugin')
      for (const metric of (state as PluginQuotaState).summary ?? [])
        result.credits.push({
          label: metric.label,
          value: `${metric.format === 'currency' && metric.currency ? money(metric.value, metric.currency) : number(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`,
        });
  } else if (type === 'devin') {
    const quota = state as DevinQuotaState;
    result.plan = quota.plan;
    result.renewalAtMs = quota.planEndMs;
    result.limits = quota.windows.map((window) => ({
      id: window.id,
      label: t(`devin_quota.${window.id}`),
      remaining: window.remainingPercent,
      resetAtMs: window.resetAtMs,
      scope: 'gating',
    }));
  } else if (type === 'kimi') {
    result.limits = (state as KimiQuotaState).rows.map((row) => ({
      id: row.id,
      label: row.labelKey ? t(row.labelKey, row.labelParams ?? {}) : (row.label ?? row.id),
      remaining: row.limit > 0 ? remaining((row.used / row.limit) * 100) : row.used > 0 ? 0 : null,
      resetAtMs: row.resetAtMs ?? null,
      resetLabel: row.resetHint,
      amount: `${number(row.used)} / ${number(row.limit)}`,
      scope: 'gating',
    }));
  } else if (type === 'meta') {
    const data = (state as MetaQuotaState).data;
    result.plan = data?.planName ?? null;
    result.limits = (data?.windows ?? []).map((window) => ({
      id: window.id,
      label: t(`meta_quota.${window.id === 'weekly' ? 'weekly' : 'window'}`),
      remaining: remaining(window.usedPercent),
      resetAtMs: window.resetAt == null ? null : window.resetAt * 1000,
      scope: 'gating',
    }));
  }
}

/** Expired and spent credits must not supply the nearest expiry. */
export function nearestResetExpiry(
  credits: readonly {
    status?: string;
    expiresAt?: string;
    endsAt?: string | null;
    resetsLeft?: number;
  }[],
  now: number
): number | null {
  const times = credits
    .filter((credit) =>
      credit.status !== undefined ? credit.status === 'available' : (credit.resetsLeft ?? 0) > 0
    )
    .map((credit) => parseIsoToMs(credit.expiresAt ?? credit.endsAt))
    .filter((value): value is number => value !== null && value > now);
  return times.length ? Math.min(...times) : null;
}
