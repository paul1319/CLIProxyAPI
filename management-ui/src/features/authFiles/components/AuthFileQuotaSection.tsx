import { useCallback, useMemo, useState } from 'react';
import { useQuotaAutoRefresh } from '@/features/quota/hooks/useQuotaAutoRefresh';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { buildAccountOverview, type AccountOverview } from '@/features/quota/accountCardModel';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import { hasClaudeUsageData } from '@/features/quota/providers/claude/data';
import { QuotaFreshness } from '@/features/quota/components/QuotaFreshness';
import { QuotaWindows } from '@/features/quota/components/QuotaWindows';
import { formatFullInstant } from '@/features/quota/format';
import { forceRefreshAuthFileQuota } from '@/features/authFiles/quotaActions';
import styles from './AuthFileQuota.module.scss';

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
  /** The credentials list already runs one shared refresh loop for visible rows. */
  autoRefresh?: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls, autoRefresh = true } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);
  const adapter = QUOTA_ADAPTERS[quotaType];
  const cacheKey = getQuotaCacheKey(file);
  const { loadQuota } = useQuotaBatchLoader();
  const autoRefreshEntries = useMemo(() => [{ file, type: quotaType }], [file, quotaType]);
  useQuotaAutoRefresh(
    autoRefreshEntries,
    !autoRefresh || disableControls || Boolean(file.disabled),
    loadQuota
  );

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.antigravityQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'claude') return state.claudeQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'codex') return state.codexQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'devin') return state.devinQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'kimi') return state.kimiQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'meta') return state.metaQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'plugin') return state.pluginQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'xai') return state.xaiQuota[cacheKey] as QuotaCardState | undefined;
    return assertNever(quotaType);
  });
  const retainedClaudeUsage =
    Boolean(quota?.hasData) ||
    (quotaType === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined));
  // Same presentation model as the Quota page card, shown whenever data is visible.
  const overview = useMemo(
    () =>
      quota && (quota.status === 'success' || retainedClaudeUsage)
        ? buildAccountOverview(quotaType, quota, t, locale)
        : null,
    [locale, quota, quotaType, retainedClaudeUsage, t]
  );

  const updateQuotaState = useQuotaStore(
    (state) => state[adapter.storeSetter] as unknown as QuotaMapUpdater
  );

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading' || resettingQuota) return;
    await forceRefreshAuthFileQuota(file, quotaType, t, showNotification);
  }, [disableControls, file, quota?.status, quotaType, resettingQuota, showNotification, t]);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const resetQuota = adapter.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        const cacheGeneration = captureQuotaCacheGeneration(file.name);
        setResettingQuota(true);
        try {
          const data = await resetQuota(file, t);
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            updateQuotaState((prev) => ({
              ...prev,
              [cacheKey]: adapter.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          });
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled && !resettingQuota;
  const canUseResetQuota = canRefreshQuota && quotaStatus !== 'loading';
  // Idle state already renders a clickable "click to refresh" prompt; only offer the
  // explicit refresh button once quota has been requested so it can be refreshed again.
  const showRefreshQuotaAction = quotaStatus !== 'idle';
  const showResetQuotaAction = quota !== undefined && Boolean(adapter.canResetQuota?.(quota));
  const resetQuotaAction =
    adapter.resetQuota && showResetQuotaAction ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={() => resetQuotaForFile()}
        disabled={!canUseResetQuota}
        loading={resettingQuota}
        title={t('codex_quota.reset_button')}
        aria-label={t('codex_quota.reset_button')}
      >
        {!resettingQuota && <IconRefreshCw size={14} />}
        {t('codex_quota.reset_button')}
      </Button>
    ) : undefined;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      <div className={styles.quotaSectionHead}>
        <div className={styles.quotaFreshness}>
          <QuotaFreshness quota={quota} />
        </div>
        {(showRefreshQuotaAction || resetQuotaAction) && (
          <div className={styles.quotaCardActions}>
            {resetQuotaAction}
            {showRefreshQuotaAction && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={styles.quotaResetCreditButton}
                onClick={() => void refreshQuotaForFile()}
                disabled={!canRefreshQuota || quotaStatus === 'loading'}
                loading={quotaStatus === 'loading'}
                title={t('auth_files.quota_refresh_hint')}
              >
                {quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
                {t('auth_files.quota_refresh_single')}
              </Button>
            )}
          </div>
        )}
      </div>
      {quotaStatus === 'loading' ? (
        // Retained rows stay in place while a refresh runs; the button carries the spinner.
        overview ? null : (
          <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>
        )
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          <IconRefreshCw size={14} />
          {t('credentials.quota_idle')}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError} role="alert">
          {t(`${adapter.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : !overview ? (
        <div className={styles.quotaMessage}>{t('credentials.quota_idle')}</div>
      ) : null}
      {overview && <QuotaOverview overview={overview} />}
    </div>
  );
}

/**
 * One-line window rows (label · meter · % · countdown) shared with the Quota page card,
 * then plan / credits / renewal as a compact key–value list.
 */
function QuotaOverview({ overview }: { overview: AccountOverview }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const now = useNow();

  const facts: Array<{
    key: string;
    label: string;
    value: string;
    detail?: string;
    title?: string;
  }> = [];
  if (overview.plan) {
    facts.push({ key: 'plan', label: t('account_quota.plan'), value: overview.plan });
  }
  overview.credits.forEach((credit, index) => {
    facts.push({
      key: `credit:${index}`,
      label: credit.label,
      value: credit.value,
      detail: credit.detail,
    });
  });
  if (overview.renewalAtMs) {
    facts.push({
      key: 'renewal',
      label: t('account_quota.renewal'),
      value: new Date(overview.renewalAtMs).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
      }),
      title: formatFullInstant(overview.renewalAtMs, locale),
    });
  }

  const hasLimits = overview.limits.length > 0;

  return (
    <>
      {hasLimits ? (
        <div className={styles.quotaWindows}>
          <QuotaWindows limits={overview.limits} heroId={overview.heroLimitId} now={now} />
        </div>
      ) : overview.notes.length === 0 ? (
        <p className={styles.quotaEmpty}>{t('quota_management.hero_no_limits')}</p>
      ) : null}
      {overview.notes.map((note, index) => (
        <p key={index} className={styles.quotaNote}>
          {note}
        </p>
      ))}
      {facts.length > 0 && (
        <dl className={styles.quotaFacts}>
          {facts.map((fact) => (
            <div key={fact.key} className={styles.quotaFact}>
              <dt>{fact.label}</dt>
              <dd title={fact.title}>
                <span className={styles.quotaFactValue}>{fact.value}</span>
                {fact.detail && <span className={styles.quotaFactDetail}>{fact.detail}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
