import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch } from '@/components/ui/icons';
import { configSectionNavKey } from '../groups';
import { searchConfigFields, type ConfigFieldSearchEntry } from '../searchIndex';
import styles from './ConfigSearch.module.scss';

export type ConfigSearchProps = {
  disabled?: boolean;
  /** Keyboard hint shown inside the box (e.g. "⌘K"); the page owns the shortcut. */
  shortcutLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** A result was chosen: the page switches section and scrolls/pulses the field (useFieldJump). */
  onJump: (entry: ConfigFieldSearchEntry) => void;
};

/**
 * Settings search combobox (label / YAML key / keywords) with keyboard navigation.
 * After a jump the query stays in the box and only the results close, so it can be refined.
 */
export function ConfigSearch({
  disabled = false,
  shortcutLabel,
  inputRef,
  onJump,
}: ConfigSearchProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  // Dropdown visibility is tracked separately from the query text so a jump can close the
  // results while leaving the typed text in the box for further editing.
  const [searchOpen, setSearchOpen] = useState(false);
  // Highlighted option for keyboard navigation of the results listbox (-1 = none).
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchListboxId = useId();
  const searchResultsRef = useRef<HTMLDivElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  const searchResults = useMemo(() => searchConfigFields(searchQuery, t), [searchQuery, t]);
  // The results popup is visible only when the box is open AND there's a (trimmed) query.
  const isResultsOpen = searchOpen && Boolean(searchQuery.trim());
  // Clamp the highlighted index to the current result set so a stale index (e.g. after the
  // query narrows the list) never points past the end or at an option that no longer exists.
  const effectiveActiveIndex =
    searchResults.length > 0
      ? Math.min(Math.max(activeResultIndex, 0), searchResults.length - 1)
      : -1;

  const handleResultJump = (entry: ConfigFieldSearchEntry) => {
    // Keep the query text so the user can tweak it; just close the results dropdown.
    setSearchOpen(false);
    onJump(entry);
  };

  // Close the results dropdown (keeping the query) when clicking outside the search box.
  useEffect(() => {
    if (!searchOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [searchOpen]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!isResultsOpen || effectiveActiveIndex < 0) return;
    const node = searchResultsRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${effectiveActiveIndex}"]`
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [effectiveActiveIndex, isResultsOpen]);

  return (
    <div className={styles.searchBox} ref={searchBoxRef}>
      <IconSearch size={14} className={styles.searchIcon} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className={`input ${styles.searchControl}`}
        placeholder={t('config_management.visual.search.placeholder_short')}
        aria-label={t('config_management.visual.search.placeholder')}
        title={t('config_management.visual.search.placeholder')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isResultsOpen}
        aria-controls={isResultsOpen ? searchListboxId : undefined}
        aria-activedescendant={
          isResultsOpen && effectiveActiveIndex >= 0
            ? `${searchListboxId}-opt-${effectiveActiveIndex}`
            : undefined
        }
        value={searchQuery}
        disabled={disabled}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setSearchOpen(true);
          setActiveResultIndex(0);
        }}
        onFocus={() => setSearchOpen(true)}
        onKeyDown={(e) => {
          // Ignore keys fired while an IME is composing (e.g. picking a Chinese
          // candidate) — otherwise candidate selection triggers navigation/jump.
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            setSearchOpen(false);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isResultsOpen) {
              setSearchOpen(true);
              return;
            }
            if (searchResults.length === 0) return;
            setActiveResultIndex((effectiveActiveIndex + 1) % searchResults.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isResultsOpen) {
              setSearchOpen(true);
              return;
            }
            if (searchResults.length === 0) return;
            setActiveResultIndex(
              effectiveActiveIndex <= 0 ? searchResults.length - 1 : effectiveActiveIndex - 1
            );
            return;
          }
          if (e.key === 'Enter' && isResultsOpen && searchResults.length > 0) {
            e.preventDefault();
            handleResultJump(searchResults[effectiveActiveIndex] ?? searchResults[0]);
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {shortcutLabel && !searchQuery ? (
        <kbd className={styles.shortcut} aria-hidden="true">
          {shortcutLabel}
        </kbd>
      ) : null}
      {isResultsOpen ? (
        <div
          className={styles.searchResults}
          role="listbox"
          id={searchListboxId}
          aria-label={t('config_management.visual.search.placeholder')}
          ref={searchResultsRef}
        >
          {searchResults.length > 0 ? (
            searchResults.map((entry, index) => (
              <button
                key={entry.fieldId}
                type="button"
                role="option"
                id={`${searchListboxId}-opt-${index}`}
                data-result-index={index}
                tabIndex={-1}
                aria-selected={index === effectiveActiveIndex}
                className={`${styles.searchResultItem} ${
                  index === effectiveActiveIndex ? styles.searchResultItemActive : ''
                }`}
                onMouseEnter={() => setActiveResultIndex(index)}
                onClick={() => handleResultJump(entry)}
              >
                <span className={styles.searchResultCopy}>
                  <span className={styles.searchResultLabel}>
                    {t(entry.labelKey)}
                    {entry.qualifierKey ? (
                      <span className={styles.searchResultQualifier}>{t(entry.qualifierKey)}</span>
                    ) : null}
                  </span>
                  {entry.yamlKeys?.length ? (
                    <span className={styles.searchResultKey}>{entry.yamlKeys.join('.')}</span>
                  ) : null}
                </span>
                <span className={styles.searchResultSection}>
                  {t(configSectionNavKey(entry.sectionId))}
                </span>
              </button>
            ))
          ) : (
            <div className={styles.searchEmpty}>
              {t('config_management.visual.search.no_results')}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
