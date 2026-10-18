import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconPlus, IconX } from '@/components/ui/icons';
import { makeClientId } from '@/types/visualConfig';
import { ExpandableInput } from './ExpandableInput';
import styles from './Blocks.module.scss';

export const StringListEditor = memo(function StringListEditor({
  value,
  disabled,
  placeholder,
  inputAriaLabel,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  placeholder?: string;
  inputAriaLabel?: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const items = value.length ? value : [];
  const [itemIds, setItemIds] = useState(() => items.map(() => makeClientId()));
  const renderItemIds = useMemo(() => {
    if (itemIds.length === items.length) return itemIds;
    if (itemIds.length > items.length) return itemIds.slice(0, items.length);
    return [
      ...itemIds,
      ...Array.from({ length: items.length - itemIds.length }, () => makeClientId()),
    ];
  }, [itemIds, items.length]);

  const updateItem = (index: number, nextValue: string) =>
    onChange(items.map((item, i) => (i === index ? nextValue : item)));
  const addItem = () => {
    setItemIds([...renderItemIds, makeClientId()]);
    onChange([...items, '']);
  };
  const removeItem = (index: number) => {
    setItemIds(renderItemIds.filter((_, i) => i !== index));
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.stringList}>
      {items.map((item, index) => (
        <div key={renderItemIds[index] ?? `item-${index}`} className={styles.stringListRow}>
          <ExpandableInput
            placeholder={placeholder}
            ariaLabel={inputAriaLabel ?? placeholder}
            value={item}
            onChange={(nextValue) => updateItem(index, nextValue)}
            disabled={disabled}
          />
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => removeItem(index)}
            disabled={disabled}
            aria-label={`${t('config_management.visual.common.delete')}: ${item || inputAriaLabel || index + 1}`}
            title={t('config_management.visual.common.delete')}
          >
            <IconX size={14} />
          </button>
        </div>
      ))}
      <div className={styles.actionRow}>
        <Button variant="ghost" size="sm" onClick={addItem} disabled={disabled}>
          <span className={styles.buttonIconLabel}>
            <IconPlus size={14} aria-hidden="true" />
            {t('config_management.visual.common.add')}
          </span>
        </Button>
      </div>
    </div>
  );
});
