// Unified diff (3 lines of context) between the server YAML and the draft YAML, rendered by the
// save review dialog. Pure; covered by tests/configUnifiedDiff.test.ts.

import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';

export type UnifiedLineType = 'context' | 'addition' | 'deletion';

export type UnifiedLine = {
  type: UnifiedLineType;
  oldNum: number | null;
  newNum: number | null;
  text: string;
};

export type DiffHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedLine[];
};

export type DiffResult = {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

const DIFF_CONTEXT_LINES = 3;

const clampPos = (doc: Text, pos: number) => Math.max(0, Math.min(pos, doc.length));

export function computeUnifiedDiff(original: string, modified: string): DiffResult {
  const oldDoc = Text.of(original.split('\n'));
  const newDoc = Text.of(modified.split('\n'));
  const chunks = Chunk.build(oldDoc, newDoc);

  let totalAdditions = 0;
  let totalDeletions = 0;

  const hunks: DiffHunk[] = chunks.map((chunk: Chunk) => {
    const lines: UnifiedLine[] = [];

    const hasDel = chunk.fromA < chunk.toA;
    const hasAdd = chunk.fromB < chunk.toB;

    // Collect deleted lines from old doc
    const delLines: { num: number; text: string }[] = [];
    if (hasDel) {
      const startLine = oldDoc.lineAt(chunk.fromA).number;
      const endLine = oldDoc.lineAt(chunk.toA - 1).number;
      for (let i = startLine; i <= endLine; i++) {
        delLines.push({ num: i, text: oldDoc.line(i).text });
      }
    }

    // Collect added lines from new doc
    const addLines: { num: number; text: string }[] = [];
    if (hasAdd) {
      const startLine = newDoc.lineAt(chunk.fromB).number;
      const endLine = newDoc.lineAt(chunk.toB - 1).number;
      for (let i = startLine; i <= endLine; i++) {
        addLines.push({ num: i, text: newDoc.line(i).text });
      }
    }

    totalDeletions += delLines.length;
    totalAdditions += addLines.length;

    // Compute context boundaries
    let ctxBeforeEndOld: number;
    let ctxAfterStartOld: number;
    let ctxBeforeEndNew: number;
    let ctxAfterStartNew: number;

    if (hasDel) {
      ctxBeforeEndOld = delLines[0].num - 1;
      ctxAfterStartOld = delLines[delLines.length - 1].num + 1;
    } else {
      const anchorPos = clampPos(oldDoc, chunk.fromA);
      const lineInfo = oldDoc.lineAt(anchorPos);
      if (chunk.fromA === lineInfo.from) {
        ctxBeforeEndOld = lineInfo.number - 1;
        ctxAfterStartOld = lineInfo.number;
      } else {
        ctxBeforeEndOld = lineInfo.number;
        ctxAfterStartOld = lineInfo.number + 1;
      }
    }

    if (hasAdd) {
      ctxBeforeEndNew = addLines[0].num - 1;
      ctxAfterStartNew = addLines[addLines.length - 1].num + 1;
    } else {
      const anchorPos = clampPos(newDoc, chunk.fromB);
      const lineInfo = newDoc.lineAt(anchorPos);
      if (chunk.fromB === lineInfo.from) {
        ctxBeforeEndNew = lineInfo.number - 1;
        ctxAfterStartNew = lineInfo.number;
      } else {
        ctxBeforeEndNew = lineInfo.number;
        ctxAfterStartNew = lineInfo.number + 1;
      }
    }

    // Context before
    const ctxBeforeCount = Math.min(
      DIFF_CONTEXT_LINES,
      Math.max(0, ctxBeforeEndOld),
      Math.max(0, ctxBeforeEndNew)
    );

    for (let i = ctxBeforeCount; i > 0; i--) {
      const oldNum = ctxBeforeEndOld - i + 1;
      const newNum = ctxBeforeEndNew - i + 1;
      if (oldNum >= 1 && newNum >= 1 && oldNum <= oldDoc.lines) {
        lines.push({
          type: 'context',
          oldNum,
          newNum,
          text: oldDoc.line(oldNum).text,
        });
      }
    }

    // Deletions
    for (const del of delLines) {
      lines.push({ type: 'deletion', oldNum: del.num, newNum: null, text: del.text });
    }

    // Additions
    for (const add of addLines) {
      lines.push({ type: 'addition', oldNum: null, newNum: add.num, text: add.text });
    }

    // Context after
    const ctxAfterCountOld = Math.max(
      0,
      Math.min(DIFF_CONTEXT_LINES, oldDoc.lines - ctxAfterStartOld + 1)
    );
    const ctxAfterCountNew = Math.max(
      0,
      Math.min(DIFF_CONTEXT_LINES, newDoc.lines - ctxAfterStartNew + 1)
    );
    const ctxAfterCount = Math.min(ctxAfterCountOld, ctxAfterCountNew);

    for (let i = 0; i < ctxAfterCount; i++) {
      const oldNum = ctxAfterStartOld + i;
      const newNum = ctxAfterStartNew + i;
      if (oldNum >= 1 && oldNum <= oldDoc.lines && newNum >= 1 && newNum <= newDoc.lines) {
        lines.push({
          type: 'context',
          oldNum,
          newNum,
          text: oldDoc.line(oldNum).text,
        });
      }
    }

    // Compute hunk header values
    const firstOld = lines.find((l) => l.oldNum !== null)?.oldNum ?? 1;
    const firstNew = lines.find((l) => l.newNum !== null)?.newNum ?? 1;
    const oldCount = lines.filter((l) => l.type !== 'addition').length;
    const newCount = lines.filter((l) => l.type !== 'deletion').length;

    return { oldStart: firstOld, oldCount, newStart: firstNew, newCount, lines };
  });

  return { hunks, additions: totalAdditions, deletions: totalDeletions };
}
