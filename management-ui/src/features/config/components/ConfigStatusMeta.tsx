import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { MetaDot } from '@/components/common/PageHeader';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import type { HeaderMetaSegment } from '../uiState';
import styles from './ConfigStatusMeta.module.scss';

const SEGMENT_CLASS: Record<HeaderMetaSegment['tone'], string> = {
  muted: styles.muted,
  warning: styles.warning,
  error: styles.error,
  ok: styles.muted,
};

/**
 * Page header meta line: one lamp for the overall state, then "In sync" or
 * "3 unsaved · 1 error" (segments from uiState.buildHeaderMeta, without the field count).
 */
export function ConfigStatusMeta({
  segments,
  busy,
}: {
  segments: HeaderMetaSegment[];
  busy: boolean;
}) {
  const { t } = useTranslation();
  const visible = segments.filter((segment) => segment.key !== 'fields');
  const lamp: LampState = visible.some((segment) => segment.tone === 'error')
    ? 'fault'
    : visible.some((segment) => segment.tone === 'warning')
      ? 'warn'
      : visible.some((segment) => segment.tone === 'ok')
        ? 'ok'
        : 'idle';

  return (
    <span className={styles.meta} aria-live="polite">
      <StatusLamp state={lamp} live={busy} />
      {visible.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? <MetaDot /> : null}
          <span className={SEGMENT_CLASS[segment.tone]}>
            {segment.key === 'errors'
              ? t('config_management.save_bar.errors', { count: segment.count ?? 0 })
              : segment.count !== undefined
                ? t(segment.labelKey, { count: segment.count })
                : t(segment.labelKey)}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
