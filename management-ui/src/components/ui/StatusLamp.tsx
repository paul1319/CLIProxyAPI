import styles from './StatusLamp.module.scss';

export type LampState = 'ok' | 'warn' | 'fault' | 'idle';

interface StatusLampProps {
  state: LampState;
  /** Accessible label; when omitted the lamp is decorative. */
  label?: string;
  /** Soft pulse for live/streaming signals. */
  live?: boolean;
  size?: 6 | 8 | 10;
  className?: string;
}

export function StatusLamp({ state, label, live = false, size = 8, className }: StatusLampProps) {
  const classes = [styles.lamp, styles[state], live ? styles.live : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={classes}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    />
  );
}
