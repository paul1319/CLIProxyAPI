import { QUOTA_REFRESH_INTERVAL_MS, type QuotaReadOptions } from '@/services/api/quota';

interface RefreshDependencies {
  load: (options: QuotaReadOptions) => Promise<void>;
  visible: () => boolean;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number | undefined) => void;
}

/** Schedule from completion so an upstream round trip cannot turn a 300s TTL into 600s polling. */
export function startQuotaRefresh(deps: RefreshDependencies) {
  let stopped = false;
  let busy = false;
  let timer: number | undefined;
  const refresh = async (restore: boolean) => {
    if (stopped || busy || !deps.visible()) return;
    busy = true;
    try {
      if (restore) await deps.load({ mode: 'cached', automatic: true });
      if (!stopped && deps.visible()) await deps.load({ mode: 'refresh', automatic: true });
    } finally {
      busy = false;
      if (!stopped && deps.visible())
        timer = deps.schedule(() => {
          void refresh(false);
        }, QUOTA_REFRESH_INTERVAL_MS);
    }
  };
  void refresh(true);
  return {
    visibilityChanged() {
      deps.cancel(timer);
      if (deps.visible()) void refresh(true);
    },
    stop() {
      stopped = true;
      deps.cancel(timer);
    },
  };
}
