import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { scrollProviderTabs } from '@/features/authFiles/components/providerTabsWheel';
import { readStripOverflow, type StripOverflow } from './providerTabsOverflow';
import styles from './ProviderTabs.module.scss';

/** Extra scroll past the selected tab so it clears the edge fade. */
const REVEAL_MARGIN_PX = 32;

export type ProviderTabsProps = {
  types: string[];
  counts: Record<string, number>;
  active: string;
  resolvedTheme: ResolvedTheme;
  onChange: (type: string) => void;
};

/**
 * Provider filter as underline tabs (13px/500, ink-3 → ink, 2px ink underline,
 * mono counts). The strip scrolls horizontally with the wheel and touch; a fade
 * on the clipped edge shows that more providers are off screen. Brand color only
 * appears inside the provider glyphs.
 */
export function ProviderTabs({
  types,
  counts,
  active,
  resolvedTheme,
  onChange,
}: ProviderTabsProps) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<StripOverflow>({ start: false, end: false });

  const syncOverflow = useCallback(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const next = readStripOverflow(strip);
    setOverflow((previous) =>
      previous.start === next.start && previous.end === next.end ? previous : next
    );
  }, []);

  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // React delegates wheel events passively; use a local listener to prevent page scrolling.
    strip.addEventListener('wheel', onWheel, { passive: false });
    strip.addEventListener('scroll', syncOverflow, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncOverflow);
    observer?.observe(strip);
    syncOverflow();
    return () => {
      strip.removeEventListener('wheel', onWheel);
      strip.removeEventListener('scroll', syncOverflow);
      observer?.disconnect();
    };
  }, [syncOverflow]);

  // Tabs appear and disappear with the account list; re-measure after each change.
  useEffect(() => {
    syncOverflow();
  }, [syncOverflow, types]);

  // Keep the selected provider visible when it sits past a clipped edge.
  useEffect(() => {
    const strip = tabsRef.current;
    const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !selected) return;
    const bounds = strip.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    if (rect.left < bounds.left) strip.scrollLeft -= bounds.left - rect.left + REVEAL_MARGIN_PX;
    else if (rect.right > bounds.right) {
      strip.scrollLeft += rect.right - bounds.right + REVEAL_MARGIN_PX;
    }
  }, [active]);

  return (
    <div
      ref={tabsRef}
      className={styles.tabs}
      role="group"
      aria-label={t('quota_management.provider_filter')}
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
    >
      {types.map((type) => {
        const isActive = active === type;
        const label = type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);
        const iconSrc = type === 'all' ? null : getAuthFileIcon(type, resolvedTheme);

        return (
          <button
            key={type}
            type="button"
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-pressed={isActive}
            onClick={() => onChange(type)}
          >
            {type !== 'all' && (
              <span
                className={styles.glyph}
                style={
                  // Same as the provider list: the Kimi glyph base follows the theme surface.
                  isThemeSurfaceIconProvider(type)
                    ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                    : undefined
                }
                aria-hidden="true"
              >
                {iconSrc ? (
                  <img src={iconSrc} alt="" />
                ) : (
                  <span className={styles.glyphFallback}>{label.slice(0, 1).toUpperCase()}</span>
                )}
              </span>
            )}
            {label}
            <span className={styles.count}>{counts[type] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
