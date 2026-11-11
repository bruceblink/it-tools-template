import { describe, expect, it } from 'vitest';
import { isPluginToolCommandResult } from './plugin-tool-workbench';

describe('plugin tool table result validation', () => {
  it('accepts bounded rows with declared columns', () => {
    expect(isPluginToolCommandResult({
      kind: 'table',
      value: {
        columns: [{ id: 'name', label: 'Name' }, { id: 'count', label: 'Count' }],
        rows: [['alpha', 2], ['beta', null]],
      },
    })).toBe(true);
  });

  it.each([
    {
      name: 'duplicate columns',
      value: { columns: [{ id: 'name', label: 'Name' }, { id: 'name', label: 'Other' }], rows: [['alpha', 'beta']] },
    },
    {
      name: 'row width mismatch',
      value: { columns: [{ id: 'name', label: 'Name' }], rows: [[]] },
    },
    {
      name: 'unknown column field',
      value: { columns: [{ id: 'name', label: 'Name', format: 'text' }], rows: [['alpha']] },
    },
    {
      name: 'non-finite cell',
      value: { columns: [{ id: 'count', label: 'Count' }], rows: [[Number.NaN]] },
    },
  ])('rejects $name', ({ value }) => {
    expect(isPluginToolCommandResult({ kind: 'table', value })).toBe(false);
  });
});
