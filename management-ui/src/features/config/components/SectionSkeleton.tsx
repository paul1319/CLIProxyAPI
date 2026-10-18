import { Skeleton } from '@/components/ui/Skeleton';
import styles from './SectionSkeleton.module.scss';

const GROUPS = [4, 3];

/** Placeholder rows while the configuration loads for the first time. */
export function SectionSkeleton() {
  return (
    <div className={styles.root} aria-hidden="true">
      {GROUPS.map((rows, groupIndex) => (
        <div key={groupIndex} className={styles.group}>
          <Skeleton width={120} height={14} rounded={4} />
          <div className={styles.list}>
            {Array.from({ length: rows }, (_, rowIndex) => (
              <div key={rowIndex} className={styles.row}>
                <div className={styles.copy}>
                  <Skeleton width={rowIndex % 2 ? 140 : 180} height={12} rounded={4} />
                  <Skeleton width={rowIndex % 2 ? 260 : 220} height={10} rounded={4} />
                </div>
                <Skeleton
                  width={rowIndex % 3 === 0 ? 32 : 200}
                  height={rowIndex % 3 === 0 ? 18 : 32}
                  rounded={6}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
