/**
 * One credential in a provider section of the quota table.
 *
 * Identity · one cell per section column · actions. Cells line up across the
 * section through subgrid; a row without observed data replaces its cells with
 * one status line. Windows past the section's columns, spend caps and notes
 * open below the row.
 */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { Meter } from '@/components/ui/Meter';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { getCredentialLampState } from '@/components/layout/poolRail';
import { useNow } from '@/hooks/useNow';
import type { CodexQuotaState } from '@/types';
import { getQuotaCacheKey, getQuotaCardTitle } from '@/utils/quota/identity';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { nearestResetExpiry, type AccountLimit, type AccountOverview } from '../accountCardModel';
import { limitLabel } from '../providerSummary';
import { hiddenLimits, pickColumnLimit, type WindowColumn } from '../tableColumns';
import {
  classifyQuotaError,
  describeQuotaError,
  formatAge,
  formatCompactDuration,
  formatFullInstant,
  formatResetClock,
} from '../format';
import { percentToFraction, toneForPercent } from '../windowRows';
import styles from './QuotaTable.module.scss';

export type QuotaRowProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  /** Overview of visible data; null while nothing has been observed. */
  overview: AccountOverview | null;
  columns: readonly WindowColumn[];
  /** The section shows a manual-resets column. */
  showResets: boolean;
  /** Routing cooldown on this credential, from the credential list snapshot. */
  cooldown: { credentialSeconds: number; modelCount: number } | null;
  /** Names stay blurred until the operator reveals them. */
  revealed: boolean;
  onToggleName: () => void;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => Promise<void> | void;
  onReset: () => void;
  /** Reports manual resets so the page can count them (Claude reads them per row). */
  onResetCount?: (key: string, count: number | null) => void;
};

/** The credential lamp is the same on every page; capacity lives in the cells. */
const LAMP_LABEL: Record<LampState, string> = {
  ok: 'quota_management.state_available',
  warn: 'quota_management.state_cooling',
  fault: 'quota_management.state_failing',
  idle: 'quota_management.state_disabled',
};

export function QuotaRow({
  entry,
  quota,
  overview,
  columns,
  showResets,
  cooldown,
  revealed,
  onToggleName,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
  onResetCount,
}: QuotaRowProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const now = useNow();
  const detailId = useId();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const { file } = entry;
  const cacheKey = getQuotaCacheKey(file);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const [manualPending, setManualPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const busy = loading || manualPending;

  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );

  const handleRefresh = () => {
    if (manualPending) return;
    setManualPending(true);
    void Promise.resolve(onRefresh()).finally(() => setManualPending(false));
  };

  const lamp = getCredentialLampState(file);
  const coolingDown = Boolean(
    cooldown && (cooldown.credentialSeconds > 0 || cooldown.modelCount > 0)
  );

  /* Manual resets (Claude grants or Codex credits). */
  const codex = entry.type === 'codex' ? (quota as CodexQuotaState | undefined) : undefined;
  const supportsReset = entry.type === 'claude' || Boolean(adapter.resetQuota);
  const resetCount = !supportsReset
    ? null
    : entry.type === 'claude'
      ? claudeReset.count
      : (codex?.rateLimitResetCreditsAvailableCount ?? null);
  useEffect(() => {
    onResetCount?.(cacheKey, resetCount);
  }, [cacheKey, onResetCount, resetCount]);
  const resetExpiry = supportsReset
    ? nearestResetExpiry(
        entry.type === 'claude' ? claudeReset.grants : (codex?.rateLimitResetCredits ?? []),
        now
      )
    : null;
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
  const claudeRetry = entry.type === 'claude' && claudeReset.buttonLabel === 'retry';
  const showResetAction = supportsReset && ((resetCount ?? 0) > 0 || claudeRetry);
  const resetFeedback: string[] = [];
  if (entry.type === 'claude' && claudeReset.message)
    resetFeedback.push(t(`claude_reset.${claudeReset.message}`));
  if (codex?.rateLimitResetCreditsError)
    resetFeedback.push(
      t('codex_quota.reset_credits_expiry_failed', { message: codex.rateLimitResetCreditsError })
    );

  /* Identity line: plan · renewal · credits · cooldown. */
  const facts: ReactNode[] = [];
  if (overview?.plan) {
    facts.push(
      <span key="plan" className={styles.plan}>
        {overview.plan}
      </span>
    );
  }
  if (overview?.renewalAtMs) {
    const renewal = t('quota_management.foot_renews', {
      date: new Date(overview.renewalAtMs).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
      }),
    });
    facts.push(
      <span key="renewal" title={formatFullInstant(overview.renewalAtMs, locale)}>
        {overview.renewalAtMs > now
          ? `${renewal} · ${t('quota_management.reset_in', {
              duration: formatCompactDuration(t, overview.renewalAtMs - now, { coarse: true }),
            })}`
          : renewal}
      </span>
    );
  }
  const genericCreditLabel = t('account_quota.credits');
  overview?.credits.forEach((credit) => {
    facts.push(
      <span key={`credit:${credit.label}`} title={credit.detail}>
        {/* The generic "Available credits" label is shortened; specific balances keep theirs. */}
        {credit.label === genericCreditLabel
          ? t('quota_management.foot_credits')
          : credit.label}{' '}
        <strong>{credit.value}</strong>
      </span>
    );
  });
  if (cooldown && coolingDown) {
    facts.push(
      <span key="cooldown" className={styles.cooldown} title={t('quota_management.cooldown_title')}>
        {cooldown.credentialSeconds > 0
          ? t('quota_management.cooldown_credential', {
              duration: formatCompactDuration(t, cooldown.credentialSeconds * 1000),
            })
          : t('auth_files.cooldown_models', { count: cooldown.modelCount })}
      </span>
    );
  }

  /* Cells, or one status line while nothing is observed. */
  const rateLimitCount = overview?.limits.filter((limit) => limit.scope !== 'spend').length ?? 0;
  const hidden = overview ? hiddenLimits(columns, overview) : [];
  const notes = overview?.notes ?? [];
  const moreCount = hidden.length + notes.length;
  const title = getQuotaCardTitle(file);
  const observedAtMs = quota?.observedAt ? Date.parse(quota.observedAt) : NaN;
  const refreshTitle = Number.isFinite(observedAtMs)
    ? `${t('auth_files.quota_refresh_hint')} · ${t('quota_management.snapshot_updated', {
        time: formatFullInstant(observedAtMs, locale),
      })}`
    : t('auth_files.quota_refresh_hint');

  return (
    <li className={styles.row} aria-busy={busy}>
      <div className={styles.identity}>
        <StatusLamp state={lamp} label={t(LAMP_LABEL[lamp])} className={styles.lamp} />
        <div className={styles.identityText}>
          <button
            type="button"
            className={styles.name}
            data-hidden={revealed ? undefined : true}
            aria-pressed={revealed}
            aria-label={revealed ? undefined : t('quota_management.name_show')}
            title={revealed ? file.name : t('quota_management.name_show')}
            onClick={onToggleName}
          >
            <span className={styles.nameText}>{title}</span>
          </button>
          {facts.length > 0 && <p className={styles.facts}>{facts}</p>}
        </div>
      </div>

      <div className={styles.cells}>
        {overview && rateLimitCount > 0 ? (
          <>
            {columns.map((column) => {
              const limit = pickColumnLimit(column, overview);
              return limit ? (
                <WindowCell key={column.id} limit={limit} now={now} />
              ) : (
                <EmptyCell key={column.id} label={column.label} />
              );
            })}
            {showResets && (
              <div className={styles.cell}>
                <div className={styles.cellHead}>
                  <span className={styles.cellLabel}>{t('quota_management.manual_resets')}</span>
                </div>
                <p className={styles.resetsValue}>
                  <strong>{resetCount ?? '—'}</strong>
                  {resetCount !== null && ` ${t('quota_management.resets_available')}`}
                </p>
                <p
                  className={styles.cellReset}
                  title={resetExpiry !== null ? formatFullInstant(resetExpiry, locale) : undefined}
                >
                  {/* Expiry is weeks out; the exact instant lives in the tooltip. */}
                  {resetExpiry !== null &&
                    (resetCount ?? 0) > 0 &&
                    t('quota_management.resets_next_expiry', {
                      duration: formatCompactDuration(t, resetExpiry - now, { coarse: true }),
                    })}
                </p>
              </div>
            )}
          </>
        ) : (
          <RowStatus
            overview={overview}
            quota={quota}
            now={now}
            canRefresh={canRefresh}
            busy={busy}
            onRetry={handleRefresh}
          />
        )}
      </div>

      <div className={styles.actions}>
        <Freshness quota={quota} now={now} />
        {showResetAction && (
          <Button
            variant={overview?.available === false ? 'secondary' : 'ghost'}
            size="sm"
            disabled={resetBlocked}
            onClick={entry.type === 'claude' ? claudeReset.confirm : onReset}
            title={
              resetBlocked && entry.type === 'claude' && !claudeRetry
                ? t('quota_management.reset_needs_limit')
                : undefined
            }
          >
            <IconRefreshCw size={13} className={resetBusy ? styles.spinning : undefined} />
            {claudeRetry ? t('claude_reset.retry') : t('quota_management.use_reset')}
          </Button>
        )}
        {moreCount > 0 && (
          <button
            type="button"
            className={styles.more}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t('quota_management.window_less')
              : t('quota_management.window_more', { count: moreCount })}
          </button>
        )}
        <button
          type="button"
          className={styles.refresh}
          onClick={handleRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, busy, resetBusy)}
          aria-label={t('auth_files.quota_refresh_single')}
          title={refreshTitle}
        >
          <IconRefreshCw size={14} className={busy ? styles.spinning : undefined} />
        </button>
      </div>

      {expanded && moreCount > 0 && (
        <div id={detailId} className={styles.detail}>
          {hidden.length > 0 && (
            <div className={styles.detailCells}>
              {hidden.map((limit) => (
                <WindowCell key={limit.id} limit={limit} now={now} />
              ))}
            </div>
          )}
          {notes.map((note, index) => (
            <p key={index} className={styles.note}>
              {note}
            </p>
          ))}
        </div>
      )}

      {resetFeedback.length > 0 && (
        <div className={styles.feedback} role="status">
          {resetFeedback.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </li>
  );
}

/** Label and percent, a meter, then when the window resets. */
function WindowCell({ limit, now }: { limit: AccountLimit; now: number }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const label = limitLabel(limit);
  const tone = toneForPercent(limit.remaining);
  const percent = limit.remaining === null ? null : Math.round(limit.remaining);
  const exhausted = limit.remaining !== null && limit.remaining <= 0;

  let reset: ReactNode = null;
  if (limit.resetAtMs !== null && limit.resetAtMs > now) {
    reset = (
      <>
        {/* An exhausted cell is already red; "in" keeps the countdown as short as its neighbours. */}
        {t('quota_management.reset_in', {
          duration: formatCompactDuration(t, limit.resetAtMs - now),
        })}
        <span className={styles.clock}>
          {' · '}
          {formatResetClock(limit.resetAtMs, now, locale)}
        </span>
      </>
    );
  } else if (limit.resetLabel) {
    reset = limit.resetLabel;
  } else if (limit.amount) {
    reset = limit.amount;
  } else if (limit.remaining !== null && limit.remaining >= 100) {
    reset = t('quota_management.no_reset_pending');
  }

  return (
    <div className={styles.cell} data-scope={limit.scope}>
      <div className={styles.cellHead}>
        <span
          className={styles.cellLabel}
          title={limit.amount ? `${label} · ${limit.amount}` : label}
        >
          {label}
        </span>
        <span className={styles.cellValue} data-tone={tone}>
          {percent === null ? '—' : `${percent}%`}
        </span>
      </div>
      <Meter value={percentToFraction(limit.remaining)} tone={tone} ariaLabel={label} />
      <p
        className={styles.cellReset}
        data-tone={exhausted ? 'fault' : undefined}
        data-quiet={
          limit.resetAtMs === null && !limit.resetLabel && !limit.amount ? true : undefined
        }
        title={
          limit.resetAtMs !== null
            ? t('quota_management.window_reset_title', {
                time: formatFullInstant(limit.resetAtMs, locale),
              })
            : undefined
        }
      >
        {reset}
      </p>
    </div>
  );
}

/** A section column this credential does not report. */
function EmptyCell({ label }: { label: string }) {
  return (
    <div className={styles.cell} data-empty="true">
      <div className={styles.cellHead}>
        <span className={styles.cellLabel}>{label}</span>
        <span className={styles.cellValue}>—</span>
      </div>
      <Meter value={null} tone="idle" ariaLabel={label} />
    </div>
  );
}

interface RowStatusProps {
  overview: AccountOverview | null;
  quota?: QuotaCardState;
  now: number;
  canRefresh: boolean;
  busy: boolean;
  onRetry: () => void;
}

/** Spans the cells while there is nothing to put in them. Observed data always wins. */
function RowStatus({ overview, quota, now, canRefresh, busy, onRetry }: RowStatusProps) {
  const { t, i18n } = useTranslation();
  const status = quota?.status ?? 'idle';

  if (overview) {
    return <p className={styles.status}>{t('quota_management.hero_no_limits')}</p>;
  }

  if (status === 'error') {
    const kind = classifyQuotaError(quota?.errorStatus);
    const retryAtMs = quota?.retryAt ? Date.parse(quota.retryAt) : NaN;
    return (
      <div className={styles.status} data-tone="fault">
        <span className={styles.statusText} title={quota?.error}>
          {describeQuotaError(t, quota?.errorStatus)}
          {Number.isFinite(retryAtMs) && retryAtMs > now && (
            <>
              {' · '}
              {t('quota_management.error_retry_at', {
                time: formatResetClock(retryAtMs, now, i18n.resolvedLanguage),
              })}
            </>
          )}
        </span>
        <span className={styles.statusActions}>
          <button
            type="button"
            className={styles.textAction}
            onClick={onRetry}
            disabled={!canRefresh || busy}
          >
            {t('quota_management.retry')}
          </button>
          {(kind === 'auth' || kind === 'denied') && (
            <Link to="/oauth" className={styles.textAction}>
              {t('quota_management.relogin')}
            </Link>
          )}
        </span>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <p className={styles.status} role="status">
        {t('quota_management.loading')}
      </p>
    );
  }

  return (
    <div className={styles.status}>
      <button
        type="button"
        className={styles.textAction}
        onClick={onRetry}
        disabled={!canRefresh || busy}
      >
        {t('quota_management.load_quota')}
      </button>
    </div>
  );
}

/**
 * Age of the last observation, shown only when it needs attention: amber when
 * stale, red with the status when the last read failed. Fresh data says when it
 * was read in the refresh button's tooltip instead.
 */
function Freshness({ quota, now }: { quota?: QuotaCardState; now: number }) {
  const { t, i18n } = useTranslation();
  const observedAt = quota?.observedAt ? Date.parse(quota.observedAt) : NaN;
  if (!Number.isFinite(observedAt)) return null;
  const failing = quota?.status === 'error';
  const tone = failing ? 'fault' : quota?.stale ? 'warn' : 'none';
  if (tone === 'none' && !quota?.persistenceError) return null;
  const age = formatAge(t, now - observedAt);
  const updated = t(
    quota?.stale ? 'quota_management.snapshot_stale' : 'quota_management.snapshot_updated',
    {
      time: formatFullInstant(observedAt, i18n.resolvedLanguage),
    }
  );
  const titleParts = [failing ? describeQuotaError(t, quota?.errorStatus) : null, updated];
  if (quota?.persistenceError) titleParts.push(t('quota_management.snapshot_save_failed'));
  return (
    <span className={styles.fresh} data-tone={tone} title={titleParts.filter(Boolean).join(' · ')}>
      {failing && quota?.errorStatus ? `${quota.errorStatus} · ${age}` : age}
    </span>
  );
}
