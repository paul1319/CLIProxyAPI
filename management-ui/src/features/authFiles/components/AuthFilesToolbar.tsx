import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconArrowUpDown,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconFilterAll,
  IconRows3,
  IconRows4,
  IconSearch,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { getTypeLabel, type ResolvedTheme } from '@/features/authFiles/constants';
import {
  AUTH_FILES_SORT_MODES,
  type AuthFilesSortMode,
  type AuthFilesStatusFilterMode,
} from '@/features/authFiles/uiState';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { ProviderGlyph } from './ProviderGlyph';
import styles from './AuthFilesToolbar.module.scss';

export type ProviderFilterOption = { key: string; count: number };

export type AuthFilesToolbarProps = {
  resolvedTheme: ResolvedTheme;
  providers: ProviderFilterOption[];
  providerTotal: number;
  provider: string;
  onProviderChange: (provider: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  status: AuthFilesStatusFilterMode;
  statusCounts: Record<AuthFilesStatusFilterMode, number>;
  onStatusChange: (mode: AuthFilesStatusFilterMode) => void;
  sortMode: AuthFilesSortMode;
  onSortModeChange: (mode: AuthFilesSortMode) => void;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  /** Mobile only: checkboxes appear in "Select" mode. */
  selectionMode: boolean;
  onSelectionModeChange: (value: boolean) => void;
  selectedCount: number;
  matchingSelectableCount: number;
  onSelectAllMatching: () => void;
  onClearSelection: () => void;
  disableControls: boolean;
  batchStatusDisabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onDownload: () => void;
  onDelete: () => void;
};

const STATUS_ORDER: AuthFilesStatusFilterMode[] = ['all', 'enabled', 'problem', 'disabled'];
const STATUS_LABEL_KEYS: Record<AuthFilesStatusFilterMode, string> = {
  all: 'credentials.status_all',
  enabled: 'credentials.status_serving',
  problem: 'credentials.status_problem',
  disabled: 'credentials.status_disabled',
};
const SORT_LABEL_KEYS: Record<AuthFilesSortMode, string> = {
  default: 'credentials.sort_provider',
  az: 'credentials.sort_account',
  priority: 'credentials.sort_priority',
};

/**
 * Accounts toolbar. With a selection it becomes the contextual bulk-action bar in place,
 * so bulk actions always sit next to the filter that scopes them.
 */
export function AuthFilesToolbar(props: AuthFilesToolbarProps) {
  const { t } = useTranslation();
  const {
    resolvedTheme,
    providers,
    providerTotal,
    provider,
    onProviderChange,
    search,
    onSearchChange,
    status,
    statusCounts,
    onStatusChange,
    sortMode,
    onSortModeChange,
    compact,
    onCompactChange,
    selectionMode,
    onSelectionModeChange,
    selectedCount,
    matchingSelectableCount,
    onSelectAllMatching,
    onClearSelection,
    disableControls,
    batchStatusDisabled,
    onEnable,
    onDisable,
    onDownload,
    onDelete,
  } = props;

  if (selectedCount > 0) {
    return (
      <div
        className={`${styles.toolbar} ${styles.selectionBar}`}
        role="toolbar"
        aria-label={t('auth_files.batch_toolbar_label')}
      >
        <div className={styles.selectionInfo}>
          <span className={styles.selectionCount} aria-live="polite">
            {t('auth_files.batch_selected', { count: selectedCount })}
          </span>
          {selectedCount < matchingSelectableCount && (
            <button type="button" className={styles.linkButton} onClick={onSelectAllMatching}>
              {t('credentials.select_all_matching', { count: matchingSelectableCount })}
            </button>
          )}
          <button type="button" className={styles.linkButton} onClick={onClearSelection}>
            {t('credentials.clear_selection')}
          </button>
        </div>
        <div className={styles.selectionActions}>
          <Button variant="secondary" size="sm" onClick={onEnable} disabled={batchStatusDisabled}>
            {t('auth_files.batch_enable')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDisable} disabled={batchStatusDisabled}>
            {t('auth_files.batch_disable')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDownload} disabled={disableControls}>
            <IconDownload size={14} />
            {t('auth_files.download_button')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={styles.deleteButton}
            onClick={onDelete}
            disabled={disableControls}
          >
            <IconTrash2 size={14} />
            {t('common.delete')}
          </Button>
        </div>
      </div>
    );
  }

  const activeProvider = providers.find((option) => option.key === provider);
  const providerItems: ActionMenuItem[] = [
    {
      id: 'all',
      label: t('credentials.provider_all'),
      hint: providerTotal,
      checked: provider === 'all',
      onSelect: () => onProviderChange('all'),
    },
    ...providers.map<ActionMenuItem>((option) => ({
      id: option.key,
      label: (
        <>
          <ProviderGlyph provider={option.key} resolvedTheme={resolvedTheme} size="sm" />
          {getTypeLabel(t, option.key)}
        </>
      ),
      hint: option.count,
      checked: provider === option.key,
      onSelect: () => onProviderChange(option.key),
    })),
  ];

  const sortItems: ActionMenuItem[] = AUTH_FILES_SORT_MODES.map((mode) => ({
    id: mode,
    label: t(SORT_LABEL_KEYS[mode]),
    checked: sortMode === mode,
    onSelect: () => onSortModeChange(mode),
  }));

  return (
    <div className={styles.toolbar}>
      <div className={styles.primaryGroup}>
        <ActionMenu
          items={providerItems}
          label={t('credentials.provider_filter')}
          align="start"
          minWidth={220}
          triggerClassName={`${styles.control} ${styles.providerTrigger} ${
            provider !== 'all' ? styles.controlActive : ''
          }`}
          trigger={
            <>
              {activeProvider ? (
                <ProviderGlyph
                  provider={activeProvider.key}
                  resolvedTheme={resolvedTheme}
                  size="sm"
                />
              ) : (
                <IconFilterAll size={14} className={styles.controlIcon} />
              )}
              <span className={styles.controlLabel}>
                {activeProvider
                  ? getTypeLabel(t, activeProvider.key)
                  : t('credentials.provider_all')}
              </span>
              <span className={styles.controlCount}>{activeProvider?.count ?? providerTotal}</span>
              <IconChevronDown size={14} className={styles.controlChevron} />
            </>
          }
        />

        <div className={styles.search}>
          <IconSearch size={14} className={styles.searchIcon} />
          <input
            type="search"
            className={`input ${styles.searchInput}`}
            value={search}
            placeholder={t('credentials.search_placeholder')}
            aria-label={t('auth_files.search_label')}
            title={t('credentials.search_hint')}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onSearchChange('')}
              aria-label={t('credentials.search_clear')}
              title={t('credentials.search_clear')}
            >
              <IconX size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`${styles.control} ${styles.selectModeButton} ${
            selectionMode ? styles.controlActive : ''
          }`}
          aria-pressed={selectionMode}
          onClick={() => onSelectionModeChange(!selectionMode)}
        >
          {selectionMode ? <IconCheck size={14} /> : null}
          {t('credentials.select_mode')}
        </button>
      </div>

      <div className={styles.secondaryGroup}>
        <div
          className={styles.segmented}
          role="group"
          aria-label={t('auth_files.problem_filter_label')}
        >
          {STATUS_ORDER.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.segment} ${status === mode ? styles.segmentActive : ''}`}
              aria-pressed={status === mode}
              onClick={() => onStatusChange(mode)}
            >
              {t(STATUS_LABEL_KEYS[mode])}
              <span className={styles.segmentCount}>{statusCounts[mode]}</span>
            </button>
          ))}
        </div>

        <div className={styles.viewGroup}>
          <ActionMenu
            items={sortItems}
            label={t('auth_files.sort_label')}
            align="end"
            triggerClassName={`${styles.control} ${styles.sortTrigger}`}
            trigger={
              <>
                <IconArrowUpDown size={14} className={styles.controlIcon} />
                <span className={styles.sortLabel}>
                  {t('credentials.sort_by', { mode: t(SORT_LABEL_KEYS[sortMode]) })}
                </span>
                <IconChevronDown size={14} className={styles.controlChevron} />
              </>
            }
          />
          <div className={styles.density} role="group" aria-label={t('credentials.density')}>
            <button
              type="button"
              className={`${styles.densityButton} ${!compact ? styles.densityActive : ''}`}
              aria-pressed={!compact}
              title={t('credentials.density_comfortable')}
              aria-label={t('credentials.density_comfortable')}
              onClick={() => onCompactChange(false)}
            >
              <IconRows3 size={14} />
            </button>
            <button
              type="button"
              className={`${styles.densityButton} ${compact ? styles.densityActive : ''}`}
              aria-pressed={compact}
              title={t('credentials.density_compact')}
              aria-label={t('credentials.density_compact')}
              onClick={() => onCompactChange(true)}
            >
              <IconRows4 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
