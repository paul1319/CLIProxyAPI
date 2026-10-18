import { useTranslation } from 'react-i18next';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import styles from './ProviderGlyph.module.scss';

export type ProviderGlyphProps = {
  provider: string;
  resolvedTheme: ResolvedTheme;
  size?: 'sm' | 'md';
  /** When true the glyph carries the provider name for assistive tech. */
  labelled?: boolean;
};

/** Provider identity tile: brand color lives only inside this glyph. */
export function ProviderGlyph({
  provider,
  resolvedTheme,
  size = 'md',
  labelled = false,
}: ProviderGlyphProps) {
  const { t } = useTranslation();
  const label = getTypeLabel(t, provider || 'unknown');
  const icon = provider ? getAuthFileIcon(provider, resolvedTheme) : null;
  const surface = isThemeSurfaceIconProvider(provider)
    ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
    : undefined;
  return (
    <span
      className={`${styles.glyph} ${size === 'sm' ? styles.sm : ''}`}
      style={surface}
      title={label}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {icon ? (
        <img src={icon} alt="" className={styles.icon} />
      ) : (
        <span className={styles.fallback}>{label.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
