/**
 * "Needs attention" rows: credentials that are failing or cooling down, with the reason
 * the server reported. Pure and clock-free — `nowMs` is passed in by the caller.
 */

import { getCredentialLampState } from '@/components/layout/poolRail';
import type { LampState } from '@/components/ui/StatusLamp';
import { getAuthFileStatusMessage } from '@/features/authFiles/constants';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types/authFile';
import { providerIdOfAuthFile } from './utils';

export interface AttentionCooldown {
  /** The whole credential is benched, not just some models. */
  credentialWide: boolean;
  /** Models with an active cooldown. */
  modelCount: number;
  /** Seconds until the earliest active timer ends; 0 when every timer has elapsed. */
  earliestSeconds: number;
  /** Seconds left on the most relevant record (credential-wide first); 0 once elapsed. */
  remainingSeconds: number;
  /** Server reason key of the most relevant record (credential-wide first). */
  reason: string | null;
  httpStatus?: number;
}

export interface AttentionItem {
  id: string;
  /** Account identity (email → project id → file name). */
  label: string;
  /** True when `label` is a file name and should render in mono. */
  mono: boolean;
  provider: string;
  /** Severity of the issue, used for ordering and the reason text tone. */
  state: 'fault' | 'warn';
  /** The credential's lamp — identical to the Credentials row and the pool rail. */
  lamp: LampState;
  /** Status message reported by the server; empty when none. */
  message: string;
  cooldown: AttentionCooldown | null;
  /** Where the operator fixes it. */
  to: '/auth-files' | '/quota';
}

const QUOTA_REASONS = new Set(['quota', 'credential_quota']);

function readCooldown(file: AuthFileItem, nowMs: number): AttentionCooldown | null {
  const snapshot = file.cooldownSnapshot;
  if (!snapshot?.records || snapshot.records.length === 0) return null;
  const { rows, modelCount, credentialWide, earliestSeconds } = summarizeCooldowns(snapshot, nowMs);
  const active = rows.filter((row) => row.remainingSeconds > 0);
  const pool = active.length > 0 ? active : rows;
  const primary =
    pool.find((row) => row.record.scope === 'credential') ??
    [...pool].sort((a, b) => a.remainingSeconds - b.remainingSeconds)[0];
  return {
    credentialWide:
      credentialWide ||
      (active.length === 0 && rows.some((row) => row.record.scope === 'credential')),
    modelCount,
    earliestSeconds,
    remainingSeconds: primary?.remainingSeconds ?? 0,
    reason: primary?.record.reason ?? null,
    httpStatus: primary?.record.httpStatus,
  };
}

export function buildAttentionItems(files: AuthFileItem[], nowMs: number): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const file of files) {
    const lamp = getCredentialLampState(file);
    if (lamp === 'idle') continue;
    const cooldown = readCooldown(file, nowMs);
    const hasModelCooldown = cooldown !== null && cooldown.modelCount > 0;
    if (lamp === 'ok' && !hasModelCooldown) continue;

    const identity = deriveAuthFileIdentity(file);
    const isQuota =
      cooldown !== null &&
      (QUOTA_REASONS.has(cooldown.reason ?? '') || cooldown.httpStatus === 429);
    items.push({
      id: file.name,
      label: identity.primary || file.name,
      mono: identity.kind === 'fileName',
      provider: providerIdOfAuthFile(file),
      state: lamp === 'fault' ? 'fault' : 'warn',
      lamp,
      message: getAuthFileStatusMessage(file),
      cooldown,
      to: lamp !== 'fault' && isQuota ? '/quota' : '/auth-files',
    });
  }

  return items.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'fault' ? -1 : 1;
    const aSeconds = a.cooldown?.earliestSeconds ?? Number.POSITIVE_INFINITY;
    const bSeconds = b.cooldown?.earliestSeconds ?? Number.POSITIVE_INFINITY;
    return aSeconds - bSeconds || a.label.localeCompare(b.label);
  });
}
