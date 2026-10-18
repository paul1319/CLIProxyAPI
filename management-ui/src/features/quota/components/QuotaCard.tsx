/**
 * One account on the quota page.
 *
 * Fixed structure — header, hero, windows, footer — so cards in a provider
 * section share subgrid rows and nothing shifts when a refresh lands. The hero
 * is the remaining capacity of the most constrained gating window; every other
 * window is one line below it. Slots a provider cannot fill are omitted.
 */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { getCredentialLampState } from '@/components/layout/poolRail';
import { useNow } from '@/hooks/useNow';
import type { CodexQuotaState } from '@/types';
import { getQuotaCacheKey, getQuotaCardTitle } from '@/utils/quota/identity';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { nearestResetExpiry, type AccountOverview } from '../accountCardModel';
import type { AccountSnapshot } from '../poolSummary';
import {
  classifyQuotaError,
  describeQuotaError,
  formatAge,
  formatCompactDuration,
  formatFullInstant,
  formatResetClock,
} from '../format';
import { QuotaWindows } from './QuotaWindows';
import { toneForPercent } from '../windowRows';
import styles from './QuotaCard.module.scss';

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  /** Overview of visible data; null while nothing has been observed. */
  overview: AccountOverview | null;
  snapshot: AccountSnapshot;
  /** Routing cooldown on this credential, from the credential list snapshot. */
  cooldown: { credentialSeconds: number; modelCount: number } | null;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => Promise<void> | void;
  onReset: () => void;
  /** Reports manual resets so the page summary can count them (Claude reads them per card). */
  onResetCount?: (key: string, count: number | null) => void;
};

/** The credential lamp is the same on every page; capacity lives in the hero and meters. */
const LAMP_LABEL: Record<LampState, string> = {
  ok: 'quota_management.state_available',
  warn: 'quota_management.state_cooling',
  fault: 'quota_management.state_failing',
  idle: 'quota_management.state_disabled',
};

export function QuotaCard({
  entry,
  quota,
  overview,
  snapshot,
  cooldown,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
  onResetCount,
}: QuotaCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const now = useNow();
  const titleId = useId();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const { file } = entry;
  const cacheKey = getQuotaCacheKey(file);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const [manualPending, setManualPending] = useState(false);
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

  const title = getQuotaCardTitle(file);
  const coolingDown = Boolean(
    cooldown && (cooldown.credentialSeconds > 0 || cooldown.modelCount > 0)
  );
  const hero = snapshot.hero;
  const lamp = getCredentialLampState(file);

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

  /* Footer facts — only what the provider actually reports. */
  const facts: ReactNode[] = [];
  const genericCreditLabel = t('account_quota.credits');
  overview?.credits.forEach((credit) => {
    facts.push(
      <span key={`credit:${credit.label}`} className={styles.fact} title={credit.detail}>
        {/* The generic "Available credits" label is shortened; specific balances keep theirs. */}
        {credit.label === genericCreditLabel
          ? t('quota_management.foot_credits')
          : credit.label}{' '}
        <strong>{credit.value}</strong>
      </span>
    );
  });
  if (overview?.renewalAtMs) {
    facts.push(
      <span
        key="renewal"
        className={styles.fact}
        title={formatFullInstant(overview.renewalAtMs, locale)}
      >
        {t('quota_management.foot_renews', {
          date: new Date(overview.renewalAtMs).toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          }),
        })}
      </span>
    );
  }
  // Manual resets sit on their own line, next to the action that spends them.
  const resetSummary =
    supportsReset && resetCount !== null && resetCount > 0
      ? [
          t('quota_management.foot_resets', { count: resetCount }),
          resetExpiry !== null
            ? t('quota_management.foot_resets_expiry', {
                duration: formatCompactDuration(t, resetExpiry - now, { coarse: true }),
              })
            : null,
        ].filter((part): part is string => Boolean(part))
      : null;
  const hasFooter =
    facts.length > 0 || showResetAction || Boolean(resetSummary) || resetFeedback.length > 0;

  return (
    <article className={styles.card} aria-labelledby={titleId} aria-busy={busy}>
      <header className={styles.head}>
        <StatusLamp state={lamp} label={t(LAMP_LABEL[lamp])} />
        <h3 id={titleId} className={styles.title} title={file.name}>
          {title}
        </h3>
        <Freshness quota={quota} now={now} />
        <button
          type="button"
          className={styles.refresh}
          onClick={handleRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, busy, resetBusy)}
          aria-label={t('auth_files.quota_refresh_single')}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw size={14} className={busy ? styles.spinning : undefined} />
        </button>
      </header>

      <div className={styles.hero}>
        <HeroBody
          overview={overview}
          quota={quota}
          hero={hero}
          now={now}
          canRefresh={canRefresh}
          busy={busy}
          onRetry={handleRefresh}
          idleLabel={t('quota_management.load_quota')}
        />
        {(overview?.plan || coolingDown) && (
          <div className={styles.badges}>
            {overview?.plan && (
              <span className={styles.plan} title={overview.plan}>
                {overview.plan}
              </span>
            )}
            {cooldown && coolingDown && (
              <span className={styles.cooldown} title={t('quota_management.cooldown_title')}>
                {cooldown.credentialSeconds > 0
                  ? t('quota_management.cooldown_credential', {
                      duration: formatCompactDuration(t, cooldown.credentialSeconds * 1000),
                    })
                  : t('auth_files.cooldown_models', { count: cooldown.modelCount })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className={styles.windows}>
        {overview && <QuotaWindows limits={overview.limits} heroId={hero?.id ?? null} now={now} />}
        {overview?.notes.map((note, index) => (
          <p key={index} className={styles.note}>
            {note}
          </p>
        ))}
      </div>

      <footer className={hasFooter ? styles.foot : styles.footEmpty}>
        {facts.length > 0 && <div className={styles.facts}>{facts}</div>}
        {(resetSummary || showResetAction) && (
          <div className={styles.resetLine}>
            <span
              className={styles.resetSummary}
              title={resetExpiry !== null ? formatFullInstant(resetExpiry, locale) : undefined}
            >
              {resetSummary?.join(' · ')}
            </span>
            {showResetAction && (
              <Button
                variant={overview?.available === false ? 'secondary' : 'ghost'}
                size="sm"
                className={styles.resetButton}
                disabled={resetBlocked}
                onClick={entry.type === 'claude' ? claudeReset.confirm : onReset}
                title={
                  resetBlocked && entry.type === 'claude' && !claudeRetry
                    ? t('quota_management.reset_needs_limit')
                    : undefined
                }
              >
                <IconRefreshCw size={13} className={resetBusy ? styles.spinning : undefined} />
                {claudeRetry ? t('claude_reset.retry') : t('account_quota.use_reset')}
              </Button>
            )}
          </div>
        )}
        {resetFeedback.map((message) => (
          <p key={message} role="status" className={styles.feedback}>
            {message}
          </p>
        ))}
      </footer>
    </article>
  );
}

interface HeroBodyProps {
  overview: AccountOverview | null;
  quota?: QuotaCardState;
  hero: AccountSnapshot['hero'];
  now: number;
  canRefresh: boolean;
  busy: boolean;
  onRetry: () => void;
  idleLabel: string;
}

function HeroBody({
  overview,
  quota,
  hero,
  now,
  canRefresh,
  busy,
  onRetry,
  idleLabel,
}: HeroBodyProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const status = quota?.status ?? 'idle';

  if (overview) {
    if (!hero || hero.remaining === null) {
      return (
        <div className={styles.heroMain}>
          <span className={styles.heroFigure} data-tone="none">
            —
          </span>
          <p className={styles.heroCaption}>{t('quota_management.hero_no_limits')}</p>
        </div>
      );
    }
    const percent = Math.round(hero.remaining);
    const tone = toneForPercent(hero.remaining);
    const label = hero.pool ? `${hero.pool} · ${hero.label}` : hero.label;
    const resetTitle =
      hero.resetAtMs !== null ? formatFullInstant(hero.resetAtMs, locale) : undefined;
    let caption: string;
    if (hero.remaining <= 0) {
      // A pooled account that still serves other models names the empty pool.
      const parts = [
        hero.pool && overview.available ? hero.pool : null,
        t('quota_management.hero_exhausted'),
        hero.resetAtMs !== null
          ? t('quota_management.hero_back', { time: formatResetClock(hero.resetAtMs, now, locale) })
          : null,
      ];
      caption = parts.filter(Boolean).join(' · ');
    } else if (hero.resetAtMs !== null) {
      caption = `${label} · ${t('quota_management.hero_resets_in', {
        duration: formatCompactDuration(t, hero.resetAtMs - now),
      })}`;
    } else {
      caption = label;
    }
    return (
      <div className={styles.heroMain}>
        <span className={styles.heroFigure} data-tone={tone}>
          {percent}
          <span className={styles.heroUnit}>%</span>
        </span>
        <p
          className={styles.heroCaption}
          data-tone={hero.remaining <= 0 ? 'fault' : undefined}
          title={resetTitle ? `${label} · ${resetTitle}` : label}
        >
          {caption}
        </p>
      </div>
    );
  }

  if (status === 'error') {
    const kind = classifyQuotaError(quota?.errorStatus);
    const retryAtMs = quota?.retryAt ? Date.parse(quota.retryAt) : NaN;
    return (
      <div className={styles.heroMain}>
        <span className={styles.heroFigure} data-tone="none">
          —
        </span>
        <p className={styles.heroCaption} title={quota?.error}>
          <span className={styles.errorText}>{describeQuotaError(t, quota?.errorStatus)}</span>
          {Number.isFinite(retryAtMs) && retryAtMs > now && (
            <>
              {' · '}
              {t('quota_management.error_retry_at', {
                time: formatResetClock(retryAtMs, now, locale),
              })}
            </>
          )}
        </p>
        <div className={styles.errorActions}>
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
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className={styles.heroMain}>
        <span className={styles.heroFigure} data-tone="none">
          —
        </span>
        <p className={styles.heroCaption} role="status">
          {t('quota_management.loading')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.heroMain}>
      <span className={styles.heroFigure} data-tone="none">
        —
      </span>
      <button
        type="button"
        className={styles.textAction}
        onClick={onRetry}
        disabled={!canRefresh || busy}
      >
        {idleLabel}
      </button>
    </div>
  );
}

/** "3m" since the last observation; amber when stale, red with the status when the last read failed. */
function Freshness({ quota, now }: { quota?: QuotaCardState; now: number }) {
  const { t, i18n } = useTranslation();
  const observedAt = quota?.observedAt ? Date.parse(quota.observedAt) : NaN;
  if (!Number.isFinite(observedAt)) return null;
  const failing = quota?.status === 'error';
  const tone = failing ? 'fault' : quota?.stale ? 'warn' : 'none';
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
      {tone !== 'none' && <span className={styles.freshDot} aria-hidden="true" />}
      {failing && quota?.errorStatus ? `${quota.errorStatus} · ${age}` : age}
    </span>
  );
}
