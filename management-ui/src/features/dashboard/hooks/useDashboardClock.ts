import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { createSharedClock } from '@/utils/time/sharedClock';
import { splitDuration } from '../utils';

/**
 * One timer for every relative time on the overview ("updated 1 min ago", cooldown and
 * reset countdowns). Fifteen seconds is precise enough for minute-level labels.
 */
const clock = createSharedClock({ intervalMs: 15_000 });

export function useDashboardNow(): number {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}

/** Compact countdown formatter: "<1m", "42m", "2h 14m", "3d 9h". */
export function useDurationFormatter() {
  const { t } = useTranslation();
  return useCallback(
    (ms: number): string => {
      const { days, hours, minutes } = splitDuration(ms);
      if (days > 0) {
        return hours > 0
          ? t('dashboard.window_dh', { days, hours })
          : t('dashboard.window_d', { days });
      }
      if (hours > 0) {
        return minutes > 0
          ? t('dashboard.window_hm', { hours, minutes })
          : t('dashboard.window_h', { hours });
      }
      if (minutes > 0) return t('dashboard.window_m', { minutes });
      return t('dashboard.duration_under_minute');
    },
    [t]
  );
}
