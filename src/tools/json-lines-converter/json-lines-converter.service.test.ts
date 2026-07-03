import { describe, expect, it } from 'vitest';
import {
  JsonLinesConversionError,
  convertJsonLines,
  convertJsonLinesToJson,
  convertJsonToJsonLines,
  summarizeJsonLines,
} from './json-lines-converter.service';

describe('json-lines-converter service', () => {
  it('converts a JSON array into compact JSON lines', () => {
    expect(convertJsonToJsonLines(`[
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]`)).toMatchInlineSnapshot(`
      "{"id":1,"name":"Alice"}
      {"id":2,"name":"Bob"}"
    `);
  });

  it('wraps a single JSON object as one JSON line', () => {
    expect(convertJsonToJsonLines('{ id: 1, active: true }')).toBe('{"id":1,"active":true}');
  });

  it('rejects primitive JSON values when converting to JSON lines', () => {
    expect(() => convertJsonToJsonLines('"hello"')).toThrow(JsonLinesConversionError);
  });

  it('converts JSON lines into a formatted JSON array', () => {
    expect(convertJsonLinesToJson('{"id":1}\n{"id":2}', { indentSize: 4 })).toMatchInlineSnapshot(`
      "[
          {
              "id": 1
          },
          {
              "id": 2
          }
      ]"
    `);
  });

  it('ignores empty lines by default', () => {
    expect(convertJsonLinesToJson('{"id":1}\n\n{"id":2}')).toMatchInlineSnapshot(`
      "[
        {
          "id": 1
        },
        {
          "id": 2
        }
      ]"
    `);
  });

  it('can reject empty lines', () => {
    expect(() => convertJsonLinesToJson('{"id":1}\n\n{"id":2}', { ignoreEmptyLines: false }))
      .toThrow('Line 2 is empty.');
  });

  it('adds line numbers to JSONL parse errors', () => {
    expect(() => convertJsonLinesToJson('{"id":1}\n{broken}', { ignoreEmptyLines: true }))
      .toThrow(/Line 2 is not valid JSON:/);
  });

  it('requires each JSONL line to be strict JSON', () => {
    expect(() => convertJsonLinesToJson('{id:1}')).toThrow(/Line 1 is not valid JSON:/);
  });

  it('dispatches by conversion direction', () => {
    expect(convertJsonLines('[{a:1}]', 'json-to-jsonl')).toBe('{"a":1}');
    expect(convertJsonLines('{"a":1}', 'jsonl-to-json', { indentSize: 0 })).toBe('[{"a":1}]');
  });

  it('summarizes JSON Lines input', () => {
    expect(summarizeJsonLines('{"id":1}\n\n{"id":2}', 'jsonl-to-json')).toEqual({
      inputLines: 3,
      outputValues: 2,
      emptyLines: 1,
    });
  });

  it('summarizes JSON input output line count', () => {
    expect(summarizeJsonLines('[{id:1},{id:2}]', 'json-to-jsonl')).toEqual({
      inputLines: 1,
      outputValues: 2,
      emptyLines: 0,
    });
  });
});
