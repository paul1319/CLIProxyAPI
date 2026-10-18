import { parseLogLine } from '@/features/logs/model/logParsing';
import {
  resolveStatusGroup,
  type ParsedLogLine,
  type HttpMethod,
  type LogLevel,
  type StatusGroup,
} from '@/features/logs/model/logTypes';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import type { LogBuffer } from './logBuffer';

export type LogEntry = ParsedLogLine & { id: number };

/** Cache only the current buffer. Repeated text remains separate records. */
export function createLogParserCache() {
  let cache = new Map<number, LogEntry>();
  return (buffer: LogBuffer): LogEntry[] => {
    const next = new Map<number, LogEntry>();
    const entries = buffer.buffer.map((raw, index) => {
      const id = buffer.bufferStart + index;
      const previous = cache.get(id);
      const entry = previous?.raw === raw ? previous : { ...parseLogLine(raw), id };
      next.set(id, entry);
      return entry;
    });
    cache = next;
    return entries;
  };
}

export function searchLogEntries(
  entries: LogEntry[],
  query: string,
  hideManagement: boolean
): LogEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const path = entry.path?.split('?')[0];
    if (
      hideManagement &&
      path &&
      (path === MANAGEMENT_API_PREFIX || path.startsWith(`${MANAGEMENT_API_PREFIX}/`))
    )
      return false;
    return !needle || entry.raw.toLowerCase().includes(needle);
  });
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/** Severity threshold: `warn` keeps warn, error and fatal. Lines without a level never match. */
export function meetsMinLevel(level: LogLevel | undefined, minLevel: LogLevel | ''): boolean {
  if (!minLevel) return true;
  return level !== undefined && LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

export function filterLogEntries(
  entries: LogEntry[],
  filters: {
    methods: Set<HttpMethod>;
    statuses: Set<StatusGroup>;
    paths: Set<string>;
    minLevel: LogLevel | '';
  }
): LogEntry[] {
  return entries.filter((entry) => {
    if (!meetsMinLevel(entry.level, filters.minLevel)) return false;
    if (filters.methods.size && (!entry.method || !filters.methods.has(entry.method))) return false;
    const group = resolveStatusGroup(entry.statusCode);
    if (filters.statuses.size && (!group || !filters.statuses.has(group))) return false;
    return !filters.paths.size || Boolean(entry.path && filters.paths.has(entry.path));
  });
}
