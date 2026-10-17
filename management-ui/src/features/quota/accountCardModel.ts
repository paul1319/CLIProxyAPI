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

export interface AccountLimit {
  id: string;
  label: string;
  remaining: number | null;
  resetAtMs: number | null;
  resetLabel?: string;
  amount?: string;
}
export interface AccountOverview {
  plan: string | null;
  credits: { label: string; value: string; resetAtMs?: number | null; detail?: string }[];
  renewalAtMs: number | null;
  limits: AccountLimit[];
  notes: string[];
}

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
  };
  if (!state) return result;
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
    result.limits = (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: window.labelKey
        ? t(window.labelKey, ('labelParams' in window ? window.labelParams : {}) ?? {})
        : window.label,
      remaining: remaining(window.usedPercent),
      resetAtMs: window.resetAtMs ?? null,
      resetLabel: window.resetLabel,
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
          label: balance.key.replace(/_/g, ' '),
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
        result.notes.push(
          `${t('claude_quota.extra_usage_label')}: ${t(extra.isEnabled === null ? 'claude_quota.plan_unknown' : extra.isEnabled ? 'claude_quota.extra_usage_enabled' : 'claude_quota.extra_usage_disabled')}`
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
      if (claude.stale)
        result.notes.push(
          t('claude_quota.stale_snapshot', {
            time: claude.observedAt ? new Date(claude.observedAt).toLocaleString(locale) : '—',
          })
        );
    }
  } else if (type === 'xai') {
    const billing = (state as XaiQuotaState).billing;
    if (!billing) return result;
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
        });
      }
      if (billing.monthlyLimitCents !== null)
        result.limits.push({
          id: 'xai-monthly',
          label: t('xai_quota.monthly_credits'),
          remaining: remaining(billing.usedPercent),
          resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
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
    result.limits = (quota.groups ?? []).flatMap((group) =>
      group.buckets.map((bucket) => ({
        id: `${group.id}:${bucket.id}`,
        label: `${group.label} · ${bucket.label}`,
        remaining: Math.max(0, Math.min(100, bucket.remainingFraction * 100)),
        resetAtMs: bucket.resetAtMs ?? parseIsoToMs(bucket.resetTime),
      }))
    );
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
    }));
  } else if (type === 'kimi') {
    result.limits = (state as KimiQuotaState).rows.map((row) => ({
      id: row.id,
      label: row.labelKey ? t(row.labelKey, row.labelParams ?? {}) : (row.label ?? row.id),
      remaining: row.limit > 0 ? remaining((row.used / row.limit) * 100) : row.used > 0 ? 0 : null,
      resetAtMs: row.resetAtMs ?? null,
      resetLabel: row.resetHint,
      amount: `${number(row.used)} / ${number(row.limit)}`,
    }));
  } else if (type === 'meta') {
    const data = (state as MetaQuotaState).data;
    result.plan = data?.planName ?? null;
    result.limits = (data?.windows ?? []).map((window) => ({
      id: window.id,
      label: t(`meta_quota.${window.id === 'weekly' ? 'weekly' : 'window'}`),
      remaining: remaining(window.usedPercent),
      resetAtMs: window.resetAt == null ? null : window.resetAt * 1000,
    }));
  }
  return result;
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
