/** Provider icon tile shared by the overview strip and the section headers. */

import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import styles from './ProviderGlyph.module.scss';

export function ProviderGlyph({ type }: { type: QuotaProviderType }) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const icon = type === 'plugin' ? null : getAuthFileIcon(type, resolvedTheme);
  return (
    <span
      className={styles.glyph}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
      aria-hidden="true"
    >
      {icon ? <img src={icon} alt="" /> : getTypeLabel(t, type).slice(0, 1).toUpperCase()}
    </span>
  );
}
