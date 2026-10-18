import type { LampState } from '@/components/ui/StatusLamp';
import { isProblemAuthFile } from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';

/** Lamp state for one credential in the pool rail. */
export function getCredentialLampState(file: AuthFileItem): LampState {
  const status = typeof file.status === 'string' ? file.status.trim().toLowerCase() : '';
  if (file.disabled === true || status === 'disabled') return 'idle';
  if (isProblemAuthFile(file)) return 'fault';
  const records = file.cooldownSnapshot?.records;
  if (Array.isArray(records) && records.some((record) => record.scope === 'credential')) {
    return 'warn';
  }
  return 'ok';
}

export interface PoolSummary {
  total: number;
  serving: number;
  cooling: number;
  failing: number;
  disabled: number;
  lamps: Array<{ id: string; label: string; state: LampState }>;
}

const LAMP_ORDER: Record<LampState, number> = { ok: 0, warn: 1, fault: 2, idle: 3 };

export function summarizePool(files: AuthFileItem[]): PoolSummary {
  const lamps = files.map((file) => ({
    id: file.name,
    label: (typeof file.email === 'string' && file.email) || file.name,
    state: getCredentialLampState(file),
  }));
  lamps.sort((a, b) => LAMP_ORDER[a.state] - LAMP_ORDER[b.state]);
  return {
    total: files.length,
    serving: lamps.filter((lamp) => lamp.state === 'ok').length,
    cooling: lamps.filter((lamp) => lamp.state === 'warn').length,
    failing: lamps.filter((lamp) => lamp.state === 'fault').length,
    disabled: lamps.filter((lamp) => lamp.state === 'idle').length,
    lamps,
  };
}

/** Worst state across the pool, used for the collapsed rail and mobile bar. */
export function getPoolLampState(summary: PoolSummary): LampState {
  if (summary.total === 0) return 'idle';
  if (summary.failing > 0) return 'fault';
  if (summary.cooling > 0) return 'warn';
  return summary.serving > 0 ? 'ok' : 'idle';
}
