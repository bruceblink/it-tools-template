import { describe, expect, it } from 'vitest';
import { diffTextLines } from './text-diff.service';

describe('text diff service', () => {
  it('pairs equal and changed lines while preserving their line numbers', () => {
    expect(diffTextLines('first\nold value\nlast', 'first\nnew value\nlast')).toEqual([
      { id: 0, kind: 'equal', original: { lineNumber: 1, text: 'first' }, modified: { lineNumber: 1, text: 'first' } },
      { id: 1, kind: 'changed', original: { lineNumber: 2, text: 'old value' }, modified: { lineNumber: 2, text: 'new value' } },
      { id: 2, kind: 'equal', original: { lineNumber: 3, text: 'last' }, modified: { lineNumber: 3, text: 'last' } },
    ]);
  });

  it('shows inserted and deleted lines in separate rows', () => {
    expect(diffTextLines('first\nlast', 'first\ninserted\nlast')).toEqual([
      { id: 0, kind: 'equal', original: { lineNumber: 1, text: 'first' }, modified: { lineNumber: 1, text: 'first' } },
      { id: 1, kind: 'added', modified: { lineNumber: 2, text: 'inserted' } },
      { id: 2, kind: 'equal', original: { lineNumber: 2, text: 'last' }, modified: { lineNumber: 3, text: 'last' } },
    ]);
    expect(diffTextLines('first\ndeleted\nlast', 'first\nlast')[1]).toMatchObject({
      kind: 'removed',
      original: { lineNumber: 2, text: 'deleted' },
    });
  });

  it('keeps source whitespace in equal rows when trimming is ignored', () => {
    expect(diffTextLines('  value  \n', 'value\n', true)).toEqual([
      { id: 0, kind: 'equal', original: { lineNumber: 1, text: '  value  ' }, modified: { lineNumber: 1, text: 'value' } },
    ]);
    expect(diffTextLines('  value  \n', 'value\n', false)[0]?.kind).toBe('changed');
  });

  it('normalizes CRLF for display without changing the source inputs', () => {
    expect(diffTextLines('first\r\nsecond\r\n', 'first\r\nsecond changed\r\n')).toMatchObject([
      { kind: 'equal', original: { text: 'first' }, modified: { text: 'first' } },
      { kind: 'changed', original: { text: 'second' }, modified: { text: 'second changed' } },
    ]);
  });

  it('handles empty and identical input', () => {
    expect(diffTextLines('', '')).toEqual([]);
    expect(diffTextLines('same\ntext', 'same\ntext').every(row => row.kind === 'equal')).toBe(true);
  });
});
