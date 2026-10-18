import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { CONFIG_TAB_IDS, configPanelDomId, configTabDomId, type ConfigTabId } from '../constants';
import { CONFIG_SECTION_GROUPS, configSectionNavKey } from '../groups';
import styles from './SectionNav.module.scss';

export type SectionNavProps = {
  active: ConfigTabId;
  /** Validation errors per section (uiState.countSectionErrors). */
  errorCounts: Partial<Record<ConfigTabId, number>>;
  /** Sections with unsaved changes (uiState.resolveDirtyTabs). */
  dirtyTabs: ReadonlySet<ConfigTabId>;
  /** Field ids with unsaved changes / errors, for the group markers of the active section. */
  dirtyFieldIds?: ReadonlySet<string>;
  errorFieldIds?: ReadonlySet<string>;
  /** Group of the active section currently at the top of the viewport (scroll spy). */
  activeGroup?: string | null;
  disabled?: boolean;
  onChange: (id: ConfigTabId) => void;
  onGroupJump?: (groupId: string) => void;
};

function useSectionLabels() {
  const { t } = useTranslation();
  return (id: ConfigTabId, errorCount: number, isDirty: boolean) => {
    const label = t(configSectionNavKey(id));
    const accessibleLabel = [
      label,
      errorCount > 0 ? t('config_management.save_bar.errors', { count: errorCount }) : null,
      isDirty ? t('config_management.status_dirty_short') : null,
    ]
      .filter(Boolean)
      .join(', ');
    return { label, accessibleLabel };
  };
}

/**
 * Left section index: one entry per section with an unsaved dot and an error count; the active
 * section lists its groups as in-page anchors. Only one section is mounted at a time.
 */
export function SectionNav({
  active,
  errorCounts,
  dirtyTabs,
  dirtyFieldIds,
  errorFieldIds,
  activeGroup,
  disabled = false,
  onChange,
  onGroupJump,
}: SectionNavProps) {
  const { t } = useTranslation();
  const labelsFor = useSectionLabels();

  return (
    <nav className={styles.nav} aria-label={t('config_management.nav_label')}>
      <ul className={styles.list}>
        {CONFIG_TAB_IDS.map((id) => {
          const isActive = id === active;
          const errorCount = errorCounts[id] ?? 0;
          const isDirty = dirtyTabs.has(id);
          const { label, accessibleLabel } = labelsFor(id, errorCount, isDirty);
          const groups = CONFIG_SECTION_GROUPS[id];
          return (
            <li key={id}>
              <button
                type="button"
                id={configTabDomId(id)}
                className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                aria-current={isActive ? 'true' : undefined}
                aria-controls={isActive ? configPanelDomId(id) : undefined}
                aria-label={accessibleLabel}
                disabled={disabled}
                onClick={() => onChange(id)}
              >
                <span className={styles.itemLabel}>{label}</span>
                <span className={styles.itemMarkers} aria-hidden="true">
                  {isDirty ? <span className={styles.dirtyDot} /> : null}
                  {errorCount > 0 ? <span className={styles.errorCount}>{errorCount}</span> : null}
                </span>
              </button>
              {isActive && groups.length > 1 ? (
                <ul className={styles.groups}>
                  {groups.map((group) => {
                    const groupDirty = group.fields.some((field) => dirtyFieldIds?.has(field));
                    const groupError = group.fields.some((field) => errorFieldIds?.has(field));
                    const isCurrent = activeGroup === group.id;
                    return (
                      <li key={group.id}>
                        <button
                          type="button"
                          className={`${styles.groupLink} ${isCurrent ? styles.groupLinkActive : ''}`}
                          onClick={() => onGroupJump?.(group.id)}
                        >
                          <span className={styles.groupLabel}>{t(group.titleKey)}</span>
                          {groupError ? (
                            <span
                              className={styles.groupErrorDot}
                              role="img"
                              aria-label={t('config_management.save_bar.errors', { count: 1 })}
                            />
                          ) : groupDirty ? (
                            <span
                              className={styles.dirtyDot}
                              role="img"
                              aria-label={t('config_management.status_dirty_short')}
                            />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Compact section picker for narrow layouts (replaces the left index). */
export function SectionSelect({
  active,
  errorCounts,
  dirtyTabs,
  disabled = false,
  onChange,
}: Pick<SectionNavProps, 'active' | 'errorCounts' | 'dirtyTabs' | 'disabled' | 'onChange'>) {
  const { t } = useTranslation();
  const labelsFor = useSectionLabels();
  const options = CONFIG_TAB_IDS.map((id) => {
    const errorCount = errorCounts[id] ?? 0;
    const isDirty = dirtyTabs.has(id);
    const { label } = labelsFor(id, errorCount, isDirty);
    const markers = [
      isDirty ? t('config_management.status_dirty_short') : null,
      errorCount > 0 ? t('config_management.save_bar.errors', { count: errorCount }) : null,
    ].filter(Boolean);
    return { value: id, label: markers.length ? `${label} · ${markers.join(' · ')}` : label };
  });
  return (
    <div className={styles.select}>
      <Select
        value={active}
        options={options}
        disabled={disabled}
        fullWidth
        ariaLabel={t('config_management.nav_label')}
        onChange={(next) => onChange(next as ConfigTabId)}
      />
    </div>
  );
}
