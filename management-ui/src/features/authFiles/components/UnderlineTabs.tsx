import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { tabId, tabPanelId } from './underlineTabIds';
import styles from './UnderlineTabs.module.scss';

export type UnderlineTab<T extends string> = { id: T; label: ReactNode; count?: number };

export type UnderlineTabsProps<T extends string> = {
  tabs: UnderlineTab<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Prefix for tab/panel ids; panels use `${idPrefix}-panel-${id}`. */
  idPrefix: string;
  className?: string;
};

/** Underline tabs (13px/500, ink-3 → ink with a 2px ink underline) with arrow-key roving focus. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: UnderlineTabsProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(idPrefix, tabs[next].id))}`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={className ? `${styles.tabs} ${className}` : styles.tabs}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={tabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            className={`${styles.tab} ${selected ? styles.tabActive : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && <span className={styles.count}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
