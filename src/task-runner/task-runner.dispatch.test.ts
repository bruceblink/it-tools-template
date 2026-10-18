import { describe, expect, it } from 'vitest';
import { assertWorkerOutputSize, executeWorkerTask, TaskExecutionError } from './task-runner.dispatch';

function expectTaskFailure(run: () => void, code: TaskExecutionError['code']): void {
  let failure: unknown;
  try {
    run();
  }
  catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(TaskExecutionError);
  expect(failure).toHaveProperty('code', code);
}

describe('task runner worker dispatch', () => {
  it('returns regex matches, captures, summary, and a bounded sample', () => {
    const result = executeWorkerTask({ kind: 'regex', regex: '(?<letter>a)', text: 'aba', flags: 'dgu' });

    expect(result.kind).toBe('regex');
    if (result.kind !== 'regex') {return;}
    expect(result.matches.map(match => match.value)).toEqual(['a', 'a']);
    expect(result.summary.matchCount).toBe(2);
    expect(result.sample.length).toBeLessThanOrEqual(4_096);
  });

  it('returns line differences from the text diff task', () => {
    const result = executeWorkerTask({
      kind: 'text-diff',
      originalText: 'before\n',
      modifiedText: 'after\n',
      ignoreWhitespace: false,
    });

    expect(result).toMatchObject({
      kind: 'text-diff',
      rows: [{ kind: 'changed', original: { text: 'before' }, modified: { text: 'after' } }],
    });
  });

  it('minifies JSON5 in the worker and reports parse failures without throwing', () => {
    expect(executeWorkerTask({ kind: 'json-minify', value: '{ unquoted: 1, // comment\n }' })).toEqual({
      kind: 'json-minify',
      valid: true,
      output: '{"unquoted":1}',
    });
    expect(executeWorkerTask({ kind: 'json-minify', value: '{ invalid' })).toEqual({
      kind: 'json-minify',
      valid: false,
      output: '',
    });
  });

  it('converts CSV and JSON to CSV in the worker', () => {
    expect(executeWorkerTask({
      kind: 'csv-to-json',
      value: 'name;age\nAlice;30',
      options: { delimiter: ';', hasHeader: true, inferTypes: true, expandDotNotation: false },
    })).toEqual({
      kind: 'csv-to-json',
      valid: true,
      output: '[\n  {\n    "name": "Alice",\n    "age": 30\n  }\n]',
    });
    expect(executeWorkerTask({
      kind: 'json-to-csv',
      value: '[{ name: "Alice", age: 30 }]',
    })).toEqual({
      kind: 'json-to-csv',
      valid: true,
      output: 'name,age\nAlice,30',
    });
  });

  it('converts JSON Lines and returns its summary in the worker', () => {
    expect(executeWorkerTask({
      kind: 'json-lines',
      value: '{"id":1}\n\n{"id":2}',
      direction: 'jsonl-to-json',
      options: { ignoreEmptyLines: true, indentSize: 2 },
    })).toEqual({
      kind: 'json-lines',
      valid: true,
      output: '[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]',
      summary: { inputLines: 3, outputValues: 2, emptyLines: 1 },
    });

    expect(executeWorkerTask({
      kind: 'json-lines',
      value: '{ id: 1 }',
      direction: 'json-to-jsonl',
      options: {},
    })).toMatchObject({
      kind: 'json-lines',
      valid: true,
      output: '{"id":1}',
      summary: { outputValues: 1 },
    });
  });

  it('runs XML and YAML conversions in the worker and returns safe validation errors', () => {
    expect(executeWorkerTask({
      kind: 'xml-format',
      value: '<foo><bar>baz</bar></foo>',
      options: { indentSize: 2, collapseContent: true },
    })).toMatchObject({ kind: 'xml-format', valid: true, output: '<foo>\n  <bar>baz</bar>\n</foo>' });
    expect(executeWorkerTask({ kind: 'xml-to-json', value: '<foo><bar>baz</bar></foo>' })).toMatchObject({
      kind: 'xml-to-json',
      valid: true,
      output: '{\n  "foo": {\n    "bar": {\n      "_text": "baz"\n    }\n  }\n}',
    });
    expect(executeWorkerTask({ kind: 'json-to-xml', value: '{ foo: { _attributes: { id: 1 }, _text: "bar" } }' })).toEqual({
      kind: 'json-to-xml',
      valid: true,
      output: '<foo id="1">bar</foo>',
    });
    expect(executeWorkerTask({ kind: 'yaml-to-json', value: 'foo: bar\nlist:\n  - item' })).toMatchObject({
      kind: 'yaml-to-json',
      valid: true,
      output: '{\n   "foo": "bar",\n   "list": [\n      "item"\n   ]\n}',
    });
    expect(executeWorkerTask({ kind: 'json-to-yaml', value: '{ foo: "bar", list: ["item"] }' })).toEqual({
      kind: 'json-to-yaml',
      valid: true,
      output: 'foo: bar\nlist:\n  - item\n',
    });
    expect(executeWorkerTask({ kind: 'xml-format', value: 'not xml', options: { indentSize: 2, collapseContent: true } }))
      .toMatchObject({ kind: 'xml-format', valid: false, output: '', errorMessage: 'Provided XML is not valid.' });
    expect(executeWorkerTask({ kind: 'yaml-to-json', value: 'foo: [' }))
      .toMatchObject({ kind: 'yaml-to-json', valid: false, output: '', errorMessage: 'Provided YAML is not valid.' });
    expect(executeWorkerTask({ kind: 'json-to-yaml', value: 'not JSON' }))
      .toMatchObject({ kind: 'json-to-yaml', valid: false, output: '', errorMessage: 'Provided JSON is not valid.' });
  });

  it('runs all TOML conversions in the worker and preserves their output formats', () => {
    const toml = 'foo = "bar"\n\n[list]\nname = "item"\n\n  [list.another]\n  key = "value"';
    expect(executeWorkerTask({ kind: 'toml-to-json', value: toml })).toEqual({
      kind: 'toml-to-json',
      valid: true,
      output: '{\n   "foo": "bar",\n   "list": {\n      "name": "item",\n      "another": {\n         "key": "value"\n      }\n   }\n}',
    });
    expect(executeWorkerTask({ kind: 'toml-to-yaml', value: toml })).toEqual({
      kind: 'toml-to-yaml',
      valid: true,
      output: 'foo: bar\nlist:\n  name: item\n  another:\n    key: value\n',
    });
    expect(executeWorkerTask({ kind: 'json-to-toml', value: '{ foo: "bar", list: { name: "item" } }' })).toEqual({
      kind: 'json-to-toml',
      valid: true,
      output: 'foo = "bar"\n\n[list]\nname = "item"',
    });
    expect(executeWorkerTask({ kind: 'yaml-to-toml', value: 'foo: bar\nlist:\n  name: item' })).toEqual({
      kind: 'yaml-to-toml',
      valid: true,
      output: 'foo = "bar"\n\n[list]\nname = "item"',
    });
  });

  it('returns safe TOML conversion errors without leaking parser details', () => {
    expect(executeWorkerTask({ kind: 'toml-to-json', value: 'foo =' })).toMatchObject({
      kind: 'toml-to-json',
      valid: false,
      output: '',
      errorMessage: 'Provided TOML is not valid.',
    });
    expect(executeWorkerTask({ kind: 'json-to-toml', value: '{ invalid' })).toMatchObject({
      kind: 'json-to-toml',
      valid: false,
      output: '',
      errorMessage: 'Provided JSON is not valid.',
    });
    expect(executeWorkerTask({ kind: 'yaml-to-toml', value: 'foo: [' })).toMatchObject({
      kind: 'yaml-to-toml',
      valid: false,
      output: '',
      errorMessage: 'Provided YAML is not valid.',
    });
  });

  it('returns JSON Lines validation errors as worker results', () => {
    expect(executeWorkerTask({
      kind: 'json-lines',
      value: '{ invalid json }',
      direction: 'jsonl-to-json',
      options: {},
    })).toMatchObject({
      kind: 'json-lines',
      valid: false,
      output: '',
      summary: { inputLines: 0, outputValues: 0, emptyLines: 0 },
      errorMessage: expect.stringContaining('Line 1 is not valid JSON'),
    });
  });

  it('rejects oversized patterns and text line counts', () => {
    expectTaskFailure(() => executeWorkerTask({
      kind: 'regex',
      regex: 'a'.repeat(4_097),
      text: '',
      flags: 'd',
    }), 'input-limit');

    expectTaskFailure(() => executeWorkerTask({
      kind: 'text-diff',
      originalText: Array.from({ length: 20_001 }, () => 'line').join('\n'),
      modifiedText: '',
      ignoreWhitespace: false,
    }), 'input-limit');
  });

  it('stops collecting matches after the output limit', () => {
    expectTaskFailure(() => executeWorkerTask({
      kind: 'regex',
      regex: 'a',
      text: 'a'.repeat(5_001),
      flags: 'dg',
    }), 'output-limit');
  });

  it('rejects serialized results above the byte limit', () => {
    expectTaskFailure(() => assertWorkerOutputSize({
      kind: 'regex',
      matches: [],
      summary: { matchCount: 0, captureCount: 0, groupCount: 0, coveredCharacters: 0, coveragePercent: 0 },
      sample: 'large'.repeat(100),
    }, 100), 'output-limit');
  });
});
