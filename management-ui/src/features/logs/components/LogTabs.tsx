import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOG_TABS, logPanelDomId, logTabDomId, type LogTab } from '../model/logTabs';
import styles from './LogTabs.module.scss';

interface LogTabsProps {
  active: LogTab;
  onChange: (tab: LogTab) => void;
  errorFileCount?: number;
}

export function LogTabs({ active, onChange, errorFileCount }: LogTabsProps) {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<LogTab, HTMLButtonElement | null>>>({});

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = LOG_TABS.indexOf(active);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % LOG_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + LOG_TABS.length) % LOG_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = LOG_TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const tab = LOG_TABS[next];
    onChange(tab);
    refs.current[tab]?.focus();
  };

  const labels: Record<LogTab, string> = {
    live: t('logs.tab_live'),
    errors: t('logs.tab_errors'),
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label={t('nav.logs')}>
      {LOG_TABS.map((tab) => {
        const selected = tab === active;
        const count = tab === 'errors' ? errorFileCount : undefined;
        return (
          <button
            key={tab}
            ref={(node) => {
              refs.current[tab] = node;
            }}
            type="button"
            role="tab"
            id={logTabDomId(tab)}
            aria-selected={selected}
            aria-controls={logPanelDomId(tab)}
            tabIndex={selected ? 0 : -1}
            className={selected ? `${styles.tab} ${styles.active}` : styles.tab}
            onClick={() => onChange(tab)}
            onKeyDown={handleKeyDown}
          >
            {labels[tab]}
            {count ? <span className={styles.count}>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
