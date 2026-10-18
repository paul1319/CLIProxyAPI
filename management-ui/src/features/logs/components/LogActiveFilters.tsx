import { useTranslation } from 'react-i18next';
import { IconX } from '@/components/ui/icons';
import type { HttpMethod } from '../model/logTypes';
import styles from './LogToolbar.module.scss';

interface LogActiveFiltersProps {
  methods: HttpMethod[];
  paths: string[];
  onRemoveMethod: (method: HttpMethod) => void;
  onRemovePath: (path: string) => void;
  onClearAll: () => void;
}

/** Filters that live in the "More" popover stay visible (and removable) while active. */
export function LogActiveFilters({
  methods,
  paths,
  onRemoveMethod,
  onRemovePath,
  onClearAll,
}: LogActiveFiltersProps) {
  const { t } = useTranslation();
  if (methods.length === 0 && paths.length === 0) return null;

  const chips = [
    ...methods.map((method) => ({
      key: `m:${method}`,
      label: method,
      onRemove: () => onRemoveMethod(method),
    })),
    ...paths.map((path) => ({ key: `p:${path}`, label: path, onRemove: () => onRemovePath(path) })),
  ];

  return (
    <div className={styles.activeFilters} role="group" aria-label={t('logs.active_filters')}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={styles.activeChip}
          onClick={chip.onRemove}
          title={t('logs.remove_filter', { value: chip.label })}
          aria-label={t('logs.remove_filter', { value: chip.label })}
        >
          <span className={styles.chipText}>{chip.label}</span>
          <IconX size={12} />
        </button>
      ))}
      <button type="button" className={styles.textButton} onClick={onClearAll}>
        {t('logs.clear_filters')}
      </button>
    </div>
  );
}
