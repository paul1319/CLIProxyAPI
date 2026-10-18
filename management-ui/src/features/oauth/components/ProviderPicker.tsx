import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { IconArrowRight, IconExternalLink } from '@/components/ui/icons';
import { BrandGlyph } from './BrandGlyph';
import styles from './ProviderPicker.module.scss';

/** Live flow status shown in a row while a sign-in is running, finished or failed. */
export interface RowStatus {
  lamp: LampState;
  text: string;
  live?: boolean;
  /** Full detail (e.g. the backend error) for the tooltip. */
  title?: string;
}

/** One picker group: an overline heading above a hairline-row panel. */
export function PickerGroup({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className={styles.group} aria-labelledby={titleId}>
      <h2 className={styles.groupTitle} id={titleId}>
        {title}
      </h2>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

function Glyph({ icon }: { icon: string | ReactNode }) {
  return (
    <span className={styles.glyph} aria-hidden="true">
      {typeof icon === 'string' ? (
        <BrandGlyph src={icon} size={18} className={styles.glyphImage} />
      ) : (
        icon
      )}
    </span>
  );
}

/** `null` = counts unavailable (load failed or still loading) → the cell stays empty. */
function ConnectedCount({ count, title }: { count: number | null | undefined; title?: string }) {
  const { t } = useTranslation();
  if (count === null || count === undefined) return <span className={styles.count} />;
  return (
    <span className={styles.count} data-zero={count === 0} title={title}>
      {t('auth_login.connected_count', { count })}
    </span>
  );
}

function StatusCell({ status, id }: { status?: RowStatus; id?: string }) {
  return (
    <span className={styles.status} id={id} title={status?.title}>
      {status && (
        <>
          <StatusLamp state={status.lamp} live={status.live} size={8} />
          <span className={styles.statusText} data-lamp={status.lamp}>
            {status.text}
          </span>
        </>
      )}
    </span>
  );
}

export type RowAction =
  | { kind: 'dialog'; label: string; onClick: () => void }
  | { kind: 'link'; label: string; to: string };

export interface ProviderRowProps {
  icon: string | ReactNode;
  name: string;
  caption: string;
  count?: number | null;
  status?: RowStatus;
  action: RowAction;
}

/**
 * Picker row: glyph · name/method · live status · connected count · one action.
 * The action's accessible name is "<action> <provider>" (e.g. "Connect Codex") via
 * aria-labelledby, so the visible label stays a short verb.
 */
export function ProviderRow({ icon, name, caption, count, status, action }: ProviderRowProps) {
  const nameId = useId();
  const actionId = useId();
  const statusId = useId();
  const captionId = useId();

  return (
    <li className={styles.row} data-status={status?.lamp ?? 'idle'}>
      <Glyph icon={icon} />
      <span className={styles.main}>
        <span className={styles.name} id={nameId}>
          {name}
        </span>
        <span className={styles.caption} id={captionId}>
          {caption}
        </span>
      </span>
      <StatusCell status={status} id={statusId} />
      <ConnectedCount count={count} />
      <span className={styles.action}>
        {action.kind === 'dialog' ? (
          <button
            type="button"
            id={actionId}
            className={`btn btn-secondary btn-sm ${styles.actionButton}`}
            onClick={action.onClick}
            aria-haspopup="dialog"
            aria-labelledby={`${actionId} ${nameId}`}
            aria-describedby={status ? `${statusId} ${captionId}` : captionId}
          >
            {action.label}
          </button>
        ) : (
          <Link
            id={actionId}
            to={action.to}
            className={`btn btn-ghost btn-sm ${styles.actionButton}`}
            aria-describedby={captionId}
          >
            {action.label}
            <IconArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </span>
    </li>
  );
}

export interface SponsorSiteEntry {
  id: string;
  /** Full site name ("Kimi China"): the button's accessible name. */
  name: string;
  /** Visible short name ("China"); a substring of `name` (label-in-name). */
  region: string;
  status?: RowStatus;
  signUpUrl: string;
}

export interface SponsorRowProps {
  icon: string;
  title: string;
  caption: string;
  sponsoredLabel: string;
  signUpLabel: string;
  sites: SponsorSiteEntry[];
  count?: number | null;
  countTitle?: string;
  onOpen: (siteId: string) => void;
}

/**
 * Sponsored provider with several sites (Kimi China / International): one row, one sign-in
 * button per site, and a quiet "Sponsored · Join Open Platform" line with per-site links.
 * Static on purpose — the sponsor is labelled, not animated.
 */
export function SponsorRow({
  icon,
  title,
  caption,
  sponsoredLabel,
  signUpLabel,
  sites,
  count,
  countTitle,
  onOpen,
}: SponsorRowProps) {
  const titleId = useId();
  const statusId = useId();
  const active = sites.find((site) => site.status);
  const status: RowStatus | undefined = active?.status
    ? { ...active.status, text: `${active.region} · ${active.status.text}` }
    : undefined;

  return (
    <li
      className={`${styles.row} ${styles.sponsorRow}`}
      data-status={status?.lamp ?? 'idle'}
      role="group"
      aria-labelledby={titleId}
    >
      <Glyph icon={icon} />
      <span className={styles.main}>
        <span className={styles.nameLine}>
          <span className={styles.name} id={titleId}>
            {title}
          </span>
          <span className={styles.sponsoredTag}>{sponsoredLabel}</span>
        </span>
        <span className={styles.caption}>{caption}</span>
        <span className={styles.sponsorLine}>
          <span>{signUpLabel}</span>
          {sites.map((site) => (
            <a
              key={site.id}
              className={styles.sponsorLink}
              href={site.signUpUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${signUpLabel} · ${site.name}`}
            >
              {site.region}
              <IconExternalLink size={11} aria-hidden="true" />
            </a>
          ))}
        </span>
      </span>
      <StatusCell status={status} id={statusId} />
      <ConnectedCount count={count} title={countTitle} />
      <span className={`${styles.action} ${styles.siteActions}`}>
        {sites.map((site) => (
          <button
            key={site.id}
            type="button"
            className={`btn btn-secondary btn-sm ${styles.actionButton}`}
            onClick={() => onOpen(site.id)}
            aria-label={site.name}
            aria-haspopup="dialog"
            aria-describedby={site.status ? statusId : undefined}
            data-status={site.status?.lamp ?? 'idle'}
          >
            {site.status && (
              <StatusLamp state={site.status.lamp} live={site.status.live} size={6} />
            )}
            {site.region}
          </button>
        ))}
      </span>
    </li>
  );
}
