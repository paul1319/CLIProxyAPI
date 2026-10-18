import { resolveStatusGroup, type LogLevel, type ParsedLogLine } from './logTypes';

export type LogTone = 'quiet' | 'warn' | 'fault';

/** Level filter options shown in the toolbar: a severity threshold, not an exact level. */
export const LEVEL_THRESHOLDS = ['', 'warn', 'error'] as const;
export type LevelThreshold = (typeof LEVEL_THRESHOLDS)[number];

/** `2026-10-18 06:35:26.123` → `06:35:26`; unknown shapes are returned unchanged. */
export function formatLogClock(timestamp?: string): string {
  if (!timestamp) return '';
  const match = timestamp.match(/(?:^|[ T])(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : timestamp;
}

/** Wall-clock time of the last successful read, 24h `07:48:36`. */
export function formatUpdatedClock(epochMs: number | undefined, locale: string): string {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Access-log lines get the column layout; everything else is a plain message.
 * Plain lines can still contain values the parser picks up heuristically (an
 * `interval=3h0m0s` reads as latency), so method + path is the deciding signal.
 */
export function isRequestLine(line: ParsedLogLine): boolean {
  return Boolean(line.method && line.path) || line.raw.includes('|');
}

export function levelTone(level?: LogLevel): LogTone | 'dim' {
  if (level === 'error' || level === 'fatal') return 'fault';
  if (level === 'warn') return 'warn';
  if (level === 'debug' || level === 'trace') return 'dim';
  return 'quiet';
}

/** Success stays quiet; only client and server failures carry color. */
export function statusTone(statusCode?: number): LogTone {
  const group = resolveStatusGroup(statusCode);
  if (group === '5xx') return 'fault';
  if (group === '4xx') return 'warn';
  return 'quiet';
}

/** Rows that explain a failure get a faint fault tint. */
export function isFaultRow(line: ParsedLogLine): boolean {
  if (line.level === 'error' || line.level === 'fatal') return true;
  return isRequestLine(line) && statusTone(line.statusCode) === 'fault';
}

export type HighlightSegment = { text: string; match: boolean };

/** Case-insensitive literal split used to mark search hits inside a cell. */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** Compact byte size for file tables: `812 B`, `12.4 KB`, `3.1 MB`. */
export function formatLogFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
