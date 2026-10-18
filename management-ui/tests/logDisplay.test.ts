import { describe, expect, test } from 'bun:test';
import { parseLogLine } from '../src/features/logs/model/logParsing';
import {
  formatLogClock,
  formatLogFileSize,
  isFaultRow,
  isRequestLine,
  levelTone,
  splitHighlight,
  statusTone,
} from '../src/features/logs/model/logDisplay';

const access = (status: number, level = 'info ') =>
  `[2026-10-18 06:35:26] [6148c79a] [${level}] [gin_logger.go:106] ${status} |            0s |       127.0.0.1 | GET     "/v1/models"`;
const plain =
  '[2026-10-18 06:09:42] [--------] [info ] [antigravity_version.go:62] periodic antigravity version refresh started (interval=3h0m0s)';

describe('log row display helpers', () => {
  test('time column shows the clock; the full timestamp stays available', () => {
    expect(formatLogClock('2026-10-18 06:35:26')).toBe('06:35:26');
    expect(formatLogClock('2026-10-18T06:35:26.123')).toBe('06:35:26');
    expect(formatLogClock(undefined)).toBe('');
    expect(formatLogClock('yesterday')).toBe('yesterday');
  });

  test('access-log lines use request columns; plain messages span them', () => {
    expect(isRequestLine(parseLogLine(access(200)))).toBe(true);
    // The interval looks like a latency to the parser, but this is not a request.
    expect(isRequestLine(parseLogLine(plain))).toBe(false);
  });

  test('success stays quiet while client and server failures carry color', () => {
    expect(statusTone(200)).toBe('quiet');
    expect(statusTone(304)).toBe('quiet');
    expect(statusTone(401)).toBe('warn');
    expect(statusTone(502)).toBe('fault');
    expect(statusTone(undefined)).toBe('quiet');
    expect(levelTone('info')).toBe('quiet');
    expect(levelTone('warn')).toBe('warn');
    expect(levelTone('fatal')).toBe('fault');
    expect(levelTone('debug')).toBe('dim');
  });

  test('only error-level lines and 5xx requests get the fault tint', () => {
    expect(isFaultRow(parseLogLine(access(200)))).toBe(false);
    expect(isFaultRow(parseLogLine(access(401, 'warn ')))).toBe(false);
    expect(isFaultRow(parseLogLine(access(502)))).toBe(true);
    expect(
      isFaultRow(parseLogLine('[2026-10-18 06:09:42] [--------] [error] [refresh.go:1] failed'))
    ).toBe(true);
  });

  test('search highlighting is a literal, case-insensitive split', () => {
    expect(splitHighlight('/v1/Models/models', 'models')).toEqual([
      { text: '/v1/', match: false },
      { text: 'Models', match: true },
      { text: '/', match: false },
      { text: 'models', match: true },
    ]);
    expect(splitHighlight('a.b', '.')).toEqual([
      { text: 'a', match: false },
      { text: '.', match: true },
      { text: 'b', match: false },
    ]);
    expect(splitHighlight('text', '  ')).toEqual([{ text: 'text', match: false }]);
  });

  test('file sizes are compact', () => {
    expect(formatLogFileSize(812)).toBe('812 B');
    expect(formatLogFileSize(18432)).toBe('18.0 KB');
    expect(formatLogFileSize(3 * 1024 * 1024 + 200000)).toBe('3.2 MB');
    expect(formatLogFileSize(undefined)).toBe('');
  });
});
