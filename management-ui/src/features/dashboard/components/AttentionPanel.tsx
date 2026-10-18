import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { IconArrowRight } from '@/components/ui/icons';
import { formatCooldownLine } from '@/features/authFiles/cooldowns';
import type { AttentionItem } from '../attention';
import { providerLabel } from '../utils';
import styles from '../dashboard.module.scss';

interface AttentionPanelProps {
  items: AttentionItem[];
}

export function AttentionPanel({ items }: AttentionPanelProps) {
  const { t, i18n } = useTranslation();
  const unknownProvider = t('dashboard.provider_unknown');

  // Same wording as the Credentials row status line.
  const describe = (item: AttentionItem): string => {
    if (item.state === 'fault') return item.message || t('dashboard.attention_unavailable');
    return item.cooldown ? formatCooldownLine(t, item.cooldown, i18n.resolvedLanguage) : '';
  };

  return (
    <section className={styles.panel} aria-labelledby="overview-attention-title">
      <header className={styles.panelHeader}>
        <h2 id="overview-attention-title" className={styles.panelTitle}>
          {t('dashboard.attention_title')}
          <span className={styles.titleCount}>{items.length}</span>
        </h2>
      </header>
      <ul className={styles.attentionList}>
        {items.map((item) => {
          const why = describe(item);
          return (
            <li key={item.id}>
              <Link to={item.to} className={styles.attentionRow}>
                <StatusLamp state={item.lamp} size={8} className={styles.attentionLamp} />
                <span className={styles.attentionWho}>
                  <span
                    className={`${styles.attentionName} ${item.mono ? styles.mono : ''}`}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                  <span className={styles.attentionProvider}>
                    {providerLabel(item.provider, unknownProvider)}
                  </span>
                </span>
                <span
                  className={`${styles.attentionWhy} ${
                    item.state === 'fault' ? styles.attentionWhyFault : styles.attentionWhyWarn
                  }`}
                  title={why}
                >
                  {why}
                </span>
                <IconArrowRight size={14} className={styles.attentionArrow} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
