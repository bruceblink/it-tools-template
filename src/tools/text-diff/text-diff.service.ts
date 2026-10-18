import { diffLines } from 'diff';

export type TextDiffRowKind = 'equal' | 'added' | 'removed' | 'changed';

export interface TextDiffSide {
  lineNumber: number;
  text: string;
}

export interface TextDiffRow {
  id: number;
  kind: TextDiffRowKind;
  original?: TextDiffSide;
  modified?: TextDiffSide;
}

function splitLines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function displayLine(value: string): string {
  return value.replace(/\r?\n$/, '');
}

/**
 * Convert jsdiff's operation groups into rows with paired line numbers.
 * The full text stays in the inputs; these rows are display-only and preserve source line content.
 */
export function diffTextLines(originalText: string, modifiedText: string, ignoreTrimWhitespace = false): TextDiffRow[] {
  const originalLines = splitLines(originalText);
  const modifiedLines = splitLines(modifiedText);
  const changes = diffLines(originalText, modifiedText, {
    ignoreWhitespace: ignoreTrimWhitespace,
    stripTrailingCr: true,
  });
  const rows: TextDiffRow[] = [];
  let originalIndex = 0;
  let modifiedIndex = 0;
  let id = 0;
  let changeIndex = 0;

  while (changeIndex < changes.length) {
    const change = changes[changeIndex];
    if (!change) {
      break;
    }
    if (!change.added && !change.removed) {
      const count = splitLines(change.value).length;
      for (let line = 0; line < count; line++) {
        const original = originalLines[originalIndex] ?? '';
        const modified = modifiedLines[modifiedIndex] ?? '';
        rows.push({
          id: id++,
          kind: 'equal',
          original: { lineNumber: originalIndex + 1, text: displayLine(original) },
          modified: { lineNumber: modifiedIndex + 1, text: displayLine(modified) },
        });
        originalIndex++;
        modifiedIndex++;
      }
      changeIndex++;
      continue;
    }

    const removed: TextDiffSide[] = [];
    const added: TextDiffSide[] = [];
    while (changeIndex < changes.length) {
      const operation = changes[changeIndex];
      if (!operation || (!operation.added && !operation.removed)) {
        break;
      }
      const count = splitLines(operation.value).length;
      if (operation.removed) {
        for (let line = 0; line < count; line++) {
          removed.push({ lineNumber: originalIndex + 1, text: displayLine(originalLines[originalIndex] ?? '') });
          originalIndex++;
        }
      }
      else {
        for (let line = 0; line < count; line++) {
          added.push({ lineNumber: modifiedIndex + 1, text: displayLine(modifiedLines[modifiedIndex] ?? '') });
          modifiedIndex++;
        }
      }
      changeIndex++;
    }

    for (let line = 0; line < Math.max(removed.length, added.length); line++) {
      const original = removed[line];
      const modified = added[line];
      rows.push({
        id: id++,
        kind: original && modified ? 'changed' : original ? 'removed' : 'added',
        ...(original ? { original } : {}),
        ...(modified ? { modified } : {}),
      });
    }
  }

  return rows;
}
