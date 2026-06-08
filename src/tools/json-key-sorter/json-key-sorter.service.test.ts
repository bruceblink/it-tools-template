import { describe, expect, it } from 'vitest';
import { sortJsonKeys, sortJsonText } from './json-key-sorter.service';

describe('json-key-sorter service', () => {
  it('sorts object keys recursively by default', () => {
    expect(sortJsonKeys({
      z: 1,
      a: {
        c: 3,
        b: 2,
      },
    })).toEqual({
      a: {
        b: 2,
        c: 3,
      },
      z: 1,
    });
  });

  it('preserves array order while sorting objects inside arrays', () => {
    expect(sortJsonKeys([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toEqual([{ a: 1, b: 2 }, { c: 3, d: 4 }]);
  });

  it('can sort only the top-level object', () => {
    expect(sortJsonKeys({ z: 1, a: { c: 3, b: 2 } }, { recursive: false })).toEqual({
      a: { c: 3, b: 2 },
      z: 1,
    });
  });

  it('supports descending order and indentation', () => {
    expect(sortJsonText('{a:1,c:{a:1,b:2},b:2}', { descending: true, indentSize: 4 })).toMatchInlineSnapshot(`
      "{
          "c": {
              "b": 2,
              "a": 1
          },
          "b": 2,
          "a": 1
      }"
    `);
  });
});
