import { describe, expect, it } from 'vitest';
import { TaskRunner, type TaskWorker } from './task-runner';
import type { WorkerRequest, WorkerResponse, WorkerTaskResult } from './task-runner.types';
import { taskLimits } from './task-runner.types';

class FakeTaskWorker implements TaskWorker {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: WorkerRequest | null = null;
  terminated = false;

  postMessage(message: WorkerRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(result: WorkerTaskResult): void {
    if (!this.request) {throw new Error('No task was posted to the worker.');}
    this.onmessage?.({
      data: {
        id: this.request.id,
        inputVersion: this.request.inputVersion,
        ok: true,
        result,
      },
    });
  }
}

function createHarness(maxWorkers = 2) {
  const workers: FakeTaskWorker[] = [];
  const runner = new TaskRunner(() => {
    const worker = new FakeTaskWorker();
    workers.push(worker);
    return worker;
  }, maxWorkers);
  return { runner, workers };
}

function textDiffTask(text: string) {
  return { kind: 'text-diff' as const, originalText: text, modifiedText: text, ignoreWhitespace: false };
}

const emptyDiffResult: WorkerTaskResult = { kind: 'text-diff', rows: [] };

describe('TaskRunner', () => {
  it('runs at most two tasks and schedules the next task when a worker finishes', async () => {
    const { runner, workers } = createHarness(2);
    const first = runner.run('first', 1, textDiffTask('one'), taskLimits.textDiff);
    const second = runner.run('second', 1, textDiffTask('two'), taskLimits.textDiff);
    const third = runner.run('third', 1, textDiffTask('three'), taskLimits.textDiff);

    expect(workers).toHaveLength(2);
    workers[0]?.reply(emptyDiffResult);
    await expect(first).resolves.toEqual({ status: 'success', result: emptyDiffResult });
    expect(workers).toHaveLength(3);
    expect(workers[2]?.request?.inputVersion).toBe(1);

    workers[1]?.reply(emptyDiffResult);
    workers[2]?.reply(emptyDiffResult);
    await expect(second).resolves.toMatchObject({ status: 'success' });
    await expect(third).resolves.toMatchObject({ status: 'success' });
  });

  it('keeps one latest pending task per tool', async () => {
    const { runner, workers } = createHarness(2);
    const first = runner.run('first', 1, textDiffTask('one'), taskLimits.textDiff);
    runner.run('second', 1, textDiffTask('two'), taskLimits.textDiff);
    const replaced = runner.run('queued-tool', 1, textDiffTask('old'), taskLimits.textDiff);
    const latest = runner.run('queued-tool', 2, textDiffTask('latest'), taskLimits.textDiff);

    await expect(replaced).resolves.toEqual({ status: 'cancelled' });
    expect(workers).toHaveLength(2);
    workers[0]?.reply(emptyDiffResult);
    await expect(first).resolves.toMatchObject({ status: 'success' });
    expect(workers).toHaveLength(3);
    expect(workers[2]?.request?.inputVersion).toBe(2);
    workers[1]?.reply(emptyDiffResult);
    workers[2]?.reply(emptyDiffResult);
    await expect(latest).resolves.toMatchObject({ status: 'success' });
  });

  it('terminates an active task when a newer input replaces it', async () => {
    const { runner, workers } = createHarness();
    const previous = runner.run('text-diff', 1, textDiffTask('old'), taskLimits.textDiff);
    const next = runner.run('text-diff', 2, textDiffTask('new'), taskLimits.textDiff);

    await expect(previous).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.inputVersion).toBe(2);
    workers[1]?.reply(emptyDiffResult);
    await expect(next).resolves.toMatchObject({ status: 'success' });
  });

  it('runs Markdown renders in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('markdown-to-html', 1, { kind: 'markdown-render', value: 'old' }, taskLimits.markdownRender);
    const latest = runner.run('markdown-to-html', 2, { kind: 'markdown-render', value: 'latest' }, taskLimits.markdownRender);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.inputVersion).toBe(2);
    workers[1]?.reply({ kind: 'markdown-render', output: '<p>latest</p>\n' });
    await expect(latest).resolves.toMatchObject({
      status: 'success',
      result: { kind: 'markdown-render', output: '<p>latest</p>\n' },
    });
  });

  it('rejects oversized Markdown before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('markdown-to-html', 1, {
      kind: 'markdown-render',
      value: 'x'.repeat(taskLimits.markdownRender.maxInputBytes + 1),
    }, taskLimits.markdownRender);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('terminates a task at its deadline', async () => {
    const { runner, workers } = createHarness();
    const timed = runner.run('regex-tester', 1, { kind: 'regex', regex: 'a', text: 'a', flags: 'd' }, {
      ...taskLimits.regex,
      timeoutMs: 1,
    });

    await expect(timed).resolves.toEqual({ status: 'timeout' });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('rejects oversized inputs before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('text-diff', 1, textDiffTask('too large'), {
      ...taskLimits.textDiff,
      maxInputBytes: 1,
    });

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the format conversion input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('yaml-tool', 1, { kind: 'yaml-to-json', value: 'x'.repeat(taskLimits.formatConversion.maxInputBytes + 1) }, taskLimits.formatConversion);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the JSON viewer input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('json-viewer', 1, {
      kind: 'json-viewer',
      value: ' '.repeat(taskLimits.jsonViewer.maxInputBytes + 1),
      sortKeys: true,
      indentSize: 3,
    }, taskLimits.jsonViewer);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the JSON key sorter input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('json-key-sorter', 1, {
      kind: 'json-key-sorter',
      value: ' '.repeat(taskLimits.jsonKeySorter.maxInputBytes + 1),
      options: { recursive: true, descending: false, indentSize: 2 },
    }, taskLimits.jsonKeySorter);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the JSONPath extractor input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('json-path-extractor', 1, {
      kind: 'json-path-extractor',
      value: ' '.repeat(taskLimits.jsonPathExtractor.maxInputBytes + 1),
      path: '$.values[*]',
    }, taskLimits.jsonPathExtractor);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the JSON diff combined input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('json-diff', 1, {
      kind: 'json-diff',
      leftValue: ' '.repeat(taskLimits.jsonDiff.maxInputBytes),
      rightValue: ' ',
      onlyShowDifferences: false,
    }, taskLimits.jsonDiff);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the YAML viewer input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('yaml-viewer', 1, {
      kind: 'yaml-viewer',
      value: ' '.repeat(taskLimits.yamlViewer.maxInputBytes + 1),
      sortKeys: false,
      indentSize: 2,
    }, taskLimits.yamlViewer);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the SQL formatter input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('sql-prettify', 1, {
      kind: 'sql-format',
      value: 'x'.repeat(taskLimits.sqlFormatter.maxInputBytes + 1),
      options: { keywordCase: 'upper', useTabs: false, language: 'sql', indentStyle: 'standard' },
    }, taskLimits.sqlFormatter);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the environment parser input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('env-vars-parser', 1, {
      kind: 'env-vars-parser',
      value: 'x'.repeat(taskLimits.envVarsParser.maxInputBytes + 1),
      outputFormat: 'json',
    }, taskLimits.envVarsParser);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the bcrypt hash input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('bcrypt-hash', 1, {
      kind: 'bcrypt-hash',
      value: 'x'.repeat(taskLimits.bcryptHash.maxInputBytes + 1),
      saltRounds: 10,
    }, taskLimits.bcryptHash);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the math evaluator input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('math-evaluator', 1, {
      kind: 'math-evaluate',
      value: 'x'.repeat(taskLimits.mathEvaluator.maxInputBytes + 1),
    }, taskLimits.mathEvaluator);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('applies the TOML conversion input cap before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('toml-tool', 1, {
      kind: 'yaml-to-toml',
      value: 'x'.repeat(taskLimits.tomlConversion.maxInputBytes + 1),
    }, taskLimits.tomlConversion);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });
});
