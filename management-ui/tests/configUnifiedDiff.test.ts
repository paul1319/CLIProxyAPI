import { describe, expect, test } from 'bun:test';
import { computeUnifiedDiff } from '@/features/config/unifiedDiff';

const lines = (count: number, prefix = 'line') =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

describe('computeUnifiedDiff', () => {
  test('identical documents produce no hunks', () => {
    const yaml = lines(5).join('\n');
    expect(computeUnifiedDiff(yaml, yaml)).toEqual({ hunks: [], additions: 0, deletions: 0 });
  });

  test('a changed line gets three lines of context on each side', () => {
    const before = lines(10);
    const after = [...before];
    after[4] = 'changed';
    const diff = computeUnifiedDiff(before.join('\n'), after.join('\n'));
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.hunks).toHaveLength(1);
    const [hunk] = diff.hunks;
    expect(hunk.lines.map((line) => line.type)).toEqual([
      'context',
      'context',
      'context',
      'deletion',
      'addition',
      'context',
      'context',
      'context',
    ]);
    expect(hunk.lines[3]).toEqual({ type: 'deletion', oldNum: 5, newNum: null, text: 'line-5' });
    expect(hunk.lines[4]).toEqual({ type: 'addition', oldNum: null, newNum: 5, text: 'changed' });
    expect(hunk).toMatchObject({ oldStart: 2, oldCount: 7, newStart: 2, newCount: 7 });
  });

  test('lines appended to a newline-terminated document are pure additions', () => {
    const before = lines(3);
    const after = [...before, 'added-1', 'added-2'];
    const diff = computeUnifiedDiff(`${before.join('\n')}\n`, `${after.join('\n')}\n`);
    expect(diff.deletions).toBe(0);
    expect(diff.additions).toBe(2);
    const added = diff.hunks.flatMap((hunk) => hunk.lines).filter((l) => l.type === 'addition');
    expect(added.map((line) => line.text)).toEqual(['added-1', 'added-2']);
    expect(added.map((line) => line.newNum)).toEqual([4, 5]);
  });

  test('distant changes produce separate hunks', () => {
    const before = lines(30);
    const after = [...before];
    after[1] = 'early';
    after[27] = 'late';
    const diff = computeUnifiedDiff(before.join('\n'), after.join('\n'));
    expect(diff.hunks).toHaveLength(2);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
  });
});
