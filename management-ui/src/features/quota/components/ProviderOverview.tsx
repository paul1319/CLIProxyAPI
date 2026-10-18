/**
 * Provider overview strip: one column per provider with its focal window summed
 * across credentials, one meter segment per credential, and when capacity next
 * comes back. A column doubles as the provider filter.
 */

import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { ActionMenu } from '@/features/authFiles/components/ActionMenu';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ProviderSummary } from '../providerSummary';
import type { QuotaProviderType } from '../providers/types';
import { formatCompactDuration, formatFullInstant, formatResetClock } from '../format';
import { toneForPercent } from '../windowRows';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './ProviderOverview.module.scss';

/** Secondary windows listed under the focal one. */
const OTHER_WINDOWS = 2;

interface ProviderOverviewProps {
  summaries: readonly ProviderSummary[];
  /** The provider the table is filtered to, or null for all. */
  selected: QuotaProviderType | null;
  /** Filtering needs more than one provider. */
  filterable: boolean;
  now: number;
  onSelect: (type: QuotaProviderType) => void;
  onFocalChange: (type: QuotaProviderType, windowId: string) => void;
}

export function ProviderOverview({
  summaries,
  selected,
  filterable,
  now,
  onSelect,
  onFocalChange,
}: ProviderOverviewProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.strip} aria-label={t('quota_management.overview_label')}>
      {summaries.map((summary) => (
        <ProviderColumn
          key={summary.type}
          summary={summary}
          selected={selected === summary.type}
          filterable={filterable}
          now={now}
          onSelect={onSelect}
          onFocalChange={onFocalChange}
        />
      ))}
    </section>
  );
}

interface ProviderColumnProps {
  summary: ProviderSummary;
  selected: boolean;
  filterable: boolean;
  now: number;
  onSelect: (type: QuotaProviderType) => void;
  onFocalChange: (type: QuotaProviderType, windowId: string) => void;
}

function ProviderColumn({
  summary,
  selected,
  filterable,
  now,
  onSelect,
  onFocalChange,
}: ProviderColumnProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const { focal, type } = summary;
  const label = getTypeLabel(t, type);
  const others = summary.windows
    .filter((window) => window.id !== focal?.id)
    .slice(0, OTHER_WINDOWS);
  const hasFooter =
    others.length > 0 || summary.resets > 0 || summary.cooling > 0 || summary.failing > 0;

  return (
    <div className={styles.column} data-selected={selected || undefined}>
      {filterable && (
        <button
          type="button"
          className={styles.select}
          aria-pressed={selected}
          aria-label={
            selected
              ? t('quota_management.filter_all')
              : t('quota_management.filter_only', { provider: label })
          }
          onClick={() => onSelect(type)}
        />
      )}

      <div className={styles.head}>
        <ProviderGlyph type={type} />
        <span className={styles.name}>{label}</span>
        <span className={styles.count}>
          {t('quota_management.accounts', { count: summary.count })}
        </span>
      </div>

      {focal && summary.windows.length > 1 ? (
        <ActionMenu
          items={summary.windows.map((window) => ({
            id: window.id,
            label: window.label,
            hint: `${Math.round(window.remaining)}%`,
            checked: window.id === focal.id,
            onSelect: () => onFocalChange(type, window.id),
          }))}
          label={t('quota_management.focal_label')}
          align="start"
          minWidth={220}
          triggerClassName={styles.focal}
          trigger={
            <>
              <span className={styles.focalLabel}>{focal.label}</span>
              <IconChevronDown size={12} className={styles.focalIcon} aria-hidden="true" />
            </>
          }
        />
      ) : (
        <span className={styles.focalStatic}>{focal?.label ?? '—'}</span>
      )}

      <p className={styles.figure}>
        <span className={styles.figureValue} data-empty={focal ? undefined : true}>
          {focal ? `${Math.round(focal.remaining)}%` : '—'}
        </span>
        <span className={styles.figureTotal}>
          {t('quota_management.of_capacity', {
            total: focal ? focal.capacity : summary.count * 100,
          })}
        </span>
      </p>

      <div className={styles.segments} aria-hidden="true">
        {summary.segments.map((segment) => (
          <span
            key={segment.key}
            className={styles.segment}
            data-tone={toneForPercent(segment.remaining)}
          >
            {segment.remaining !== null && (
              <span
                className={styles.segmentFill}
                style={{
                  transform: `scaleX(${Math.min(100, Math.max(0, segment.remaining)) / 100})`,
                }}
              />
            )}
          </span>
        ))}
      </div>

      {!focal ? (
        <p className={styles.when} data-quiet="true">
          {t('quota_management.no_data')}
        </p>
      ) : summary.nextReturnAtMs !== null ? (
        <p className={styles.when} title={formatFullInstant(summary.nextReturnAtMs, locale)}>
          {t('quota_management.back_in', {
            duration: formatCompactDuration(t, summary.nextReturnAtMs - now),
          })}
          <span className={styles.clock}>
            {' · '}
            {formatResetClock(summary.nextReturnAtMs, now, locale)}
          </span>
        </p>
      ) : (
        <p className={styles.when} data-quiet="true">
          {t('quota_management.no_reset_pending')}
        </p>
      )}

      {hasFooter && (
        <div className={styles.foot}>
          {others.map((window) => (
            <span key={window.id} className={styles.fact} title={window.label}>
              <span className={styles.factLabel}>{window.label}</span>
              <strong>{Math.round(window.remaining)}%</strong>
            </span>
          ))}
          {summary.resets > 0 && (
            <span className={styles.fact}>
              <span className={styles.factLabel}>{t('quota_management.manual_resets')}</span>
              <strong>{summary.resets}</strong>
            </span>
          )}
          {(summary.cooling > 0 || summary.failing > 0) && (
            <span className={styles.attention}>
              {summary.cooling > 0 && (
                <span className={styles.fact}>
                  <StatusLamp state="warn" size={6} />
                  {t('quota_management.meta_cooling', { count: summary.cooling })}
                </span>
              )}
              {summary.failing > 0 && (
                <span className={styles.fact}>
                  <StatusLamp state="fault" size={6} />
                  {t('quota_management.meta_failing', { count: summary.failing })}
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
