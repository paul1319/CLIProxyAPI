import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from '@/components/ui/icons';
import styles from './ActionMenu.module.scss';

export type ActionMenuItem =
  | {
      type?: 'item';
      id: string;
      label: ReactNode;
      icon?: ReactNode;
      /** Right-aligned secondary text, e.g. a count. */
      hint?: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** Renders the item as a radio option (menuitemradio). */
      checked?: boolean;
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: ReactNode };

export type ActionMenuProps = {
  items: ActionMenuItem[];
  /** Accessible name for the trigger and the menu. */
  label: string;
  /** Visible trigger content; defaults to nothing (icon-only triggers pass an icon). */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Icon-only triggers get `label` as their accessible name and tooltip. */
  iconOnly?: boolean;
  title?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  /** Minimum popover width in px (defaults to the trigger width or 180). */
  minWidth?: number;
};

const VIEWPORT_MARGIN = 8;
const OFFSET = 4;

/**
 * Small accessible popover menu: role="menu" with roving focus, Escape/Tab/outside-click
 * dismissal and focus return. Local to the credentials feature (no shared menu exists yet).
 */
export function ActionMenu({
  items,
  label,
  trigger,
  triggerClassName,
  iconOnly = false,
  title,
  align = 'end',
  disabled = false,
  minWidth,
}: ActionMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setStyle(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const focusItem = useCallback((target: 'first' | 'last' | 'next' | 'prev') => {
    const menu = menuRef.current;
    if (!menu) return;
    const enabled = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)')
    );
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      target === 'first'
        ? 0
        : target === 'last'
          ? enabled.length - 1
          : target === 'next'
            ? (index + 1) % enabled.length
            : (index - 1 + enabled.length) % enabled.length;
    enabled[next]?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const triggerEl = triggerRef.current;
    const menuEl = menuRef.current;
    if (!triggerEl || !menuEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const width = Math.max(minWidth ?? 0, menuEl.offsetWidth);
    const height = menuEl.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rawLeft = align === 'end' ? rect.right - width : rect.left;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rawLeft),
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
    );
    const fitsBelow = rect.bottom + OFFSET + height <= viewportHeight - VIEWPORT_MARGIN;
    const top = fitsBelow
      ? rect.bottom + OFFSET
      : Math.max(VIEWPORT_MARGIN, rect.top - OFFSET - height);
    setStyle({ top, left, minWidth: minWidth ?? Math.max(180, rect.width) });
  }, [align, minWidth, open]);

  useEffect(() => {
    if (!open || !style) return;
    focusItem('first');
  }, [focusItem, open, style]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const handleViewportChange = () => close(false);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [close, open]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem('next');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem('prev');
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem('first');
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem('last');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className={`${styles.menu} ${style ? styles.menuVisible : ''}`}
      style={style ?? { top: -9999, left: -9999 }}
      onKeyDown={handleMenuKeyDown}
    >
      {items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.id} role="separator" className={styles.separator} />;
        }
        if (item.type === 'label') {
          return (
            <div key={item.id} className={styles.groupLabel} role="presentation">
              {item.label}
            </div>
          );
        }
        const isRadio = item.checked !== undefined;
        return (
          <button
            key={item.id}
            type="button"
            data-menu-item
            role={isRadio ? 'menuitemradio' : 'menuitem'}
            aria-checked={isRadio ? item.checked : undefined}
            className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
            disabled={item.disabled}
            tabIndex={-1}
            onClick={() => {
              close(true);
              item.onSelect();
            }}
          >
            {isRadio ? (
              <span className={styles.check} aria-hidden="true">
                {item.checked ? <IconCheck size={14} /> : null}
              </span>
            ) : item.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className={styles.label}>{item.label}</span>
            {item.hint !== undefined && <span className={styles.hint}>{item.hint}</span>}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={iconOnly ? label : undefined}
        title={title ?? (iconOnly ? label : undefined)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={handleTriggerKeyDown}
      >
        {trigger}
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </>
  );
}
