import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ClaudeQuotaState, CodexQuotaState, ResolvedTheme } from '@/types';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { useNow } from '@/hooks/useNow';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { hasClaudeUsageData } from '../providers/claude/data';
import { buildAccountOverview, nearestResetExpiry } from '../accountCardModel';
import styles from './QuotaCard.module.scss';

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resetting: boolean;
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
};

export function QuotaCard({
  entry,
  quota,
  resolvedTheme,
  canRefresh,
  resetting,
  entranceDelayMs,
  onRefresh,
  onReset,
}: QuotaCardProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const { file } = entry;
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const retained =
    entry.type === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);
  const showData = status === 'success' || retained;
  const [delay] = useState(entranceDelayMs ?? null);
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const provider =
    entry.type === 'plugin'
      ? String(file.quotaProvider ?? file.provider ?? file.type ?? 'plugin')
      : entry.type;
  const typeLabel = getTypeLabel(t, provider);
  const icon = getAuthFileIcon(provider, resolvedTheme);
  const displayName =
    file.email?.trim() ||
    getQuotaDisplayName(file)
      .replace(/\.json$/i, '')
      .replace(/^(?:claude|codex|xai)-[a-f\d]{8}-/i, '');
  const overview = buildAccountOverview(
    entry.type,
    showData ? quota : undefined,
    t,
    i18n.resolvedLanguage
  );
  const codex = entry.type === 'codex' ? (quota as CodexQuotaState | undefined) : undefined;
  const supportsReset = entry.type === 'claude' || Boolean(adapter.resetQuota);
  const resetCount =
    entry.type === 'claude'
      ? claudeReset.count
      : (codex?.rateLimitResetCreditsAvailableCount ?? null);
  const expiry = nearestResetExpiry(
    entry.type === 'claude' ? claudeReset.grants : (codex?.rateLimitResetCredits ?? []),
    now
  );
  const resetBlocked =
    entry.type === 'claude'
      ? claudeReset.blocked
      : !canRefresh ||
        loading ||
        resetting ||
        status !== 'success' ||
        !quota ||
        !adapter.canResetQuota?.(quota) ||
        codex?.rateLimitResetCreditsApplicableAvailableCount === 0;
  const resetBusy = resetting || claudeReset.busy;
  const date = (atMs: number | null | undefined, fallback?: string) => {
    const display = buildResetDisplay(fallback ?? null, atMs, now, i18n.resolvedLanguage);
    return display ? (
      <span className={styles.date}>
        <span>{display.absolute}</span>
        {display.relative && <span className={styles.relative}>{display.relative}</span>}
      </span>
    ) : (
      <span className={styles.muted}>{t('account_quota.not_reported')}</span>
    );
  };

  return (
    <article
      className={`${styles.card} ${delay === null ? '' : styles.cardEnter}`}
      style={delay === null ? undefined : ({ '--card-delay': `${delay}ms` } as CSSProperties)}
    >
      <header className={styles.head}>
        <span className={styles.iconWrap}>
          {icon ? <img src={icon} alt="" className={styles.icon} /> : typeLabel.slice(0, 1)}
        </span>
        <div className={styles.identity}>
          <span className={styles.provider}>{typeLabel}</span>
          <h2 className={styles.fileName} title={file.name}>
            {displayName}
          </h2>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetBusy)}
          aria-label={t('auth_files.quota_refresh_single')}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw size={16} className={loading ? styles.spinning : undefined} />
        </button>
      </header>

      <dl className={styles.overview}>
        <div>
          <dt>{t('account_quota.plan')}</dt>
          <dd className={styles.plan}>{overview.plan ?? t('account_quota.not_reported')}</dd>
        </div>
        <div>
          <dt>{t('account_quota.credits')}</dt>
          <dd className={styles.balance}>
            {overview.credits.length ? (
              overview.credits.map((credit) => (
                <span key={credit.label} title={credit.label}>
                  {credit.value}
                  {credit.detail && <small className={styles.creditDetail}>{credit.detail}</small>}
                </span>
              ))
            ) : (
              <span className={styles.unavailable}>{t('account_quota.not_reported')}</span>
            )}
          </dd>
        </div>
      </dl>
      <div className={styles.scheduleBlock}>
        {overview.credits
          .filter((credit) => credit.resetAtMs != null)
          .map((credit) => (
            <div key={credit.label} className={styles.schedule}>
              <span className={styles.muted}>{t('account_quota.resets')}</span>
              {date(credit.resetAtMs)}
            </div>
          ))}
        {overview.renewalAtMs !== null && (
          <div className={styles.schedule}>
            <span className={styles.muted}>{t('account_quota.renewal')}</span>
            {date(overview.renewalAtMs)}
          </div>
        )}

        {status === 'error' && (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, {
              message: resolveQuotaErrorMessage(
                t,
                quota?.errorStatus,
                quota?.error || t('common.unknown_error')
              ),
            })}
          </div>
        )}
        {status === 'idle' && (
          <button
            type="button"
            className={styles.idleBody}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            {t(`${adapter.i18nPrefix}.idle`)}
          </button>
        )}
        {loading && (
          <div role="status" className={styles.muted} aria-busy="true">
            {t(`${adapter.i18nPrefix}.loading`)}
          </div>
        )}
      </div>

      <section className={styles.limits} aria-label={t('account_quota.limits')}>
        <div className={styles.sectionHead}>
          <h3>{t('account_quota.limits')}</h3>
          <span>{t('account_quota.remaining')}</span>
        </div>
        {overview.limits.length ? (
          overview.limits.map((limit) => (
            <div className={styles.limit} key={limit.id}>
              <div className={styles.limitHead}>
                <span>{limit.label}</span>
                <strong>
                  {limit.remaining === null ? '—' : `${Math.round(limit.remaining)}%`}
                </strong>
              </div>
              <div
                className={styles.meter}
                role={limit.remaining === null ? undefined : 'meter'}
                aria-label={limit.remaining === null ? undefined : limit.label}
                aria-valuemin={limit.remaining === null ? undefined : 0}
                aria-valuemax={limit.remaining === null ? undefined : 100}
                aria-valuenow={limit.remaining ?? undefined}
              >
                <span
                  data-level={
                    limit.remaining === null
                      ? 'unknown'
                      : limit.remaining < 30
                        ? 'low'
                        : limit.remaining < 70
                          ? 'medium'
                          : 'high'
                  }
                  style={{ width: `${Math.max(0, Math.min(100, limit.remaining ?? 0))}%` }}
                />
              </div>
              {limit.amount && <div className={styles.muted}>{limit.amount}</div>}
              <div className={styles.resetDate}>
                <span>{t('account_quota.resets')}</span>
                {date(limit.resetAtMs, limit.resetLabel)}
              </div>
            </div>
          ))
        ) : (
          <p className={styles.muted}>{t('account_quota.not_reported')}</p>
        )}
      </section>
      <div className={styles.notes}>
        {overview.notes.map((note, index) => (
          <p key={index}>{note}</p>
        ))}
      </div>

      <footer className={styles.resets}>
        <div className={styles.resetHeading}>
          <h3>{t('account_quota.manual_resets')}</h3>
          <span className={styles.count}>{supportsReset ? (resetCount ?? '—') : '—'}</span>
        </div>
        <div className={styles.expiry}>
          <span className={styles.muted}>
            {t('account_quota.nearest_expiry', { timezone: resolveTimeZoneLabel() })}
          </span>
          {expiry !== null ? (
            date(expiry)
          ) : (
            <span className={styles.muted}>
              {supportsReset && resetCount === 0 ? '—' : t('account_quota.not_reported')}
            </span>
          )}
        </div>
        <div className={styles.resetFeedback}>
          {entry.type === 'claude' && claudeReset.message && (
            <p role="status" className={styles.errorText}>
              {t(`claude_reset.${claudeReset.message}`)}
            </p>
          )}
          {codex?.rateLimitResetCreditsError && (
            <p role="status" className={styles.errorText}>
              {t('codex_quota.reset_credits_expiry_failed', {
                message: codex.rateLimitResetCreditsError,
              })}
            </p>
          )}
        </div>
        <div className={styles.resetAction}>
          <button
            type="button"
            className={styles.resetButton}
            disabled={!supportsReset || resetBlocked}
            onClick={entry.type === 'claude' ? claudeReset.confirm : onReset}
          >
            <IconRefreshCw size={15} className={resetBusy ? styles.spinning : undefined} />
            {entry.type === 'claude' && claudeReset.buttonLabel === 'retry'
              ? t('claude_reset.retry')
              : t('account_quota.use_reset')}
          </button>
          {!supportsReset && (
            <span className={styles.muted}>{t('account_quota.reset_unsupported')}</span>
          )}
        </div>
      </footer>
    </article>
  );
}
