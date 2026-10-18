import { Suspense, lazy, useLayoutEffect, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp, IconSearch } from '@/components/ui/icons';
import { scrollParentOf } from '../dom';
import type { UseSourceSearchResult } from '../hooks/useSourceSearch';
import styles from './SourcePanel.module.scss';

const LazyConfigSourceEditor = lazy(() => import('./ConfigSourceEditor'));

export type SourceSearchBarProps = {
  search: UseSourceSearchResult;
  disabled: boolean;
  shortcutLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
};

/** The only YAML search UI: lives in the header where the settings search sits in visual mode. */
export function SourceSearchBar({
  search,
  disabled,
  shortcutLabel,
  inputRef,
}: SourceSearchBarProps) {
  const { t } = useTranslation();
  const {
    searchQuery,
    searchResults,
    lastSearchedQuery,
    handleSearchChange,
    executeSearch,
    handleSearchKeyDown,
    handlePrevMatch,
    handleNextMatch,
  } = search;
  const searched = Boolean(searchQuery) && lastSearchedQuery === searchQuery;
  // Before the first Enter the arrows run the search; afterwards they step through matches.
  const navDisabled = disabled || !searchQuery || (searched && searchResults.total === 0);

  return (
    <div className={styles.searchBar} role="search">
      <IconSearch size={14} className={styles.searchIcon} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className={`input ${styles.searchInput}`}
        value={searchQuery}
        onChange={(event) => handleSearchChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            search.editorRef.current?.view?.focus();
            return;
          }
          handleSearchKeyDown(event);
        }}
        placeholder={t('config_management.search_placeholder')}
        aria-label={t('config_management.search_placeholder')}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <span className={styles.searchMeta} aria-live="polite">
        {searched ? (
          <span className={styles.searchCount}>
            {searchResults.total > 0
              ? `${searchResults.current}/${searchResults.total}`
              : t('config_management.search_no_results')}
          </span>
        ) : shortcutLabel && !searchQuery ? (
          <kbd className={styles.shortcut} aria-hidden="true">
            {shortcutLabel}
          </kbd>
        ) : null}
        <button
          type="button"
          className={styles.navButton}
          onClick={() => (searched ? handlePrevMatch() : executeSearch('prev'))}
          disabled={navDisabled}
          aria-label={t('config_management.search_prev')}
          title={t('config_management.search_prev')}
        >
          <IconChevronUp size={14} />
        </button>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => (searched ? handleNextMatch() : executeSearch('next'))}
          disabled={navDisabled}
          aria-label={t('config_management.search_next')}
          title={t('config_management.search_next')}
        >
          <IconChevronDown size={14} />
        </button>
      </span>
    </div>
  );
}

export type SourcePanelProps = {
  search: UseSourceSearchResult;
  value: string;
  onChange: (value: string) => void;
  theme: 'light' | 'dark';
  editable: boolean;
  onFindShortcut?: () => void;
};

/**
 * YAML editor panel: lazy CodeMirror filling the remaining viewport height. The editor's offset
 * from the top of the scroll area is measured into --source-top; CSS subtracts it and the save bar.
 */
export function SourcePanel({
  search,
  value,
  onChange,
  theme,
  editable,
  onFindShortcut,
}: SourcePanelProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const update = () => {
      const scroller = scrollParentOf(element);
      const top = scroller
        ? element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
        : element.getBoundingClientRect().top + window.scrollY;
      element.style.setProperty('--source-top', `${Math.max(0, Math.round(top))}px`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div ref={wrapperRef} className={styles.editorWrapper}>
      <Suspense fallback={null}>
        <LazyConfigSourceEditor
          editorRef={search.editorRef}
          value={value}
          onChange={onChange}
          theme={theme}
          editable={editable}
          placeholder={t('config_management.editor_placeholder')}
          onFindShortcut={onFindShortcut}
        />
      </Suspense>
    </div>
  );
}
