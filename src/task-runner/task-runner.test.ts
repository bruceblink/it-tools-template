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

  it('runs cURL generation in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('curl-code-generator', 1, {
      kind: 'curl-code-generator',
      value: 'curl https://example.com/old',
      outputFormat: 'fetch',
    }, taskLimits.curlCodeGenerator);
    const latest = runner.run('curl-code-generator', 2, {
      kind: 'curl-code-generator',
      value: 'curl https://example.com/latest',
      outputFormat: 'axios',
    }, taskLimits.curlCodeGenerator);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.task).toEqual({
      kind: 'curl-code-generator',
      value: 'curl https://example.com/latest',
      outputFormat: 'axios',
    });
    const result: WorkerTaskResult = {
      kind: 'curl-code-generator',
      valid: true,
      request: { url: 'https://example.com/latest', method: 'GET', headers: [], data: '', compressed: false, warnings: [] },
      output: 'const response = await axios({',
    };
    workers[1]?.reply(result);
    await expect(latest).resolves.toEqual({ status: 'success', result });
  });

  it('runs IPv4 CIDR merges in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('ipv4-cidr-merge', 1, { kind: 'ipv4-cidr-merge', value: 'old' }, taskLimits.ipv4CidrMerge);
    const latest = runner.run('ipv4-cidr-merge', 2, { kind: 'ipv4-cidr-merge', value: 'latest' }, taskLimits.ipv4CidrMerge);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.inputVersion).toBe(2);
    workers[1]?.reply({ kind: 'ipv4-cidr-merge', valid: false, output: '', errorMessage: 'Line 1: invalid' });
    await expect(latest).resolves.toMatchObject({
      status: 'success',
      result: { kind: 'ipv4-cidr-merge', valid: false, errorMessage: 'Line 1: invalid' },
    });
  });

  it('rejects oversized IPv4 CIDR input before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('ipv4-cidr-merge', 1, {
      kind: 'ipv4-cidr-merge',
      value: 'x'.repeat(taskLimits.ipv4CidrMerge.maxInputBytes + 1),
    }, taskLimits.ipv4CidrMerge);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('runs IPv4 CIDR overlap reports in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('ipv4-cidr-overlap', 1, { kind: 'ipv4-cidr-overlap', value: 'old' }, taskLimits.ipv4CidrOverlap);
    const latest = runner.run('ipv4-cidr-overlap', 2, { kind: 'ipv4-cidr-overlap', value: 'latest' }, taskLimits.ipv4CidrOverlap);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.inputVersion).toBe(2);
    workers[1]?.reply({ kind: 'ipv4-cidr-overlap', valid: false, errorMessage: 'too many overlaps' });
    await expect(latest).resolves.toMatchObject({
      status: 'success',
      result: { kind: 'ipv4-cidr-overlap', valid: false, errorMessage: 'too many overlaps' },
    });
  });

  it('rejects oversized IPv4 CIDR overlap input before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('ipv4-cidr-overlap', 1, {
      kind: 'ipv4-cidr-overlap',
      value: 'x'.repeat(taskLimits.ipv4CidrOverlap.maxInputBytes + 1),
    }, taskLimits.ipv4CidrOverlap);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('runs IPv4 CIDR containment reports in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('ipv4-cidr-containment', 1, { kind: 'ipv4-cidr-containment', rules: 'old', targets: '' }, taskLimits.ipv4CidrContainment);
    const latest = runner.run('ipv4-cidr-containment', 2, { kind: 'ipv4-cidr-containment', rules: 'latest', targets: 'target' }, taskLimits.ipv4CidrContainment);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.inputVersion).toBe(2);
    workers[1]?.reply({ kind: 'ipv4-cidr-containment', valid: false, errorMessage: 'invalid target' });
    await expect(latest).resolves.toMatchObject({
      status: 'success',
      result: { kind: 'ipv4-cidr-containment', valid: false, errorMessage: 'invalid target' },
    });
  });

  it('rejects IPv4 CIDR containment inputs above the byte limit before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('ipv4-cidr-containment', 1, {
      kind: 'ipv4-cidr-containment',
      rules: 'x'.repeat(taskLimits.ipv4CidrContainment.maxInputBytes),
      targets: 'y',
    }, taskLimits.ipv4CidrContainment);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
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

  it('runs CSV to Markdown conversions in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('csv-to-markdown-table', 1, {
      kind: 'csv-to-markdown',
      value: 'name,age\nAlice,30',
      options: { delimiter: ',', hasHeader: true },
    }, taskLimits.csvToMarkdown);
    const latest = runner.run('csv-to-markdown-table', 2, {
      kind: 'csv-to-markdown',
      value: 'name;age\nBob;25',
      options: { delimiter: ';', hasHeader: true },
    }, taskLimits.csvToMarkdown);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.inputVersion).toBe(2);
    workers[1]?.reply({ kind: 'csv-to-markdown', valid: true, output: '| name | age |\n| --- | --- |\n| Bob | 25 |' });
    await expect(latest).resolves.toMatchObject({
      status: 'success',
      result: { kind: 'csv-to-markdown', valid: true, output: '| name | age |\n| --- | --- |\n| Bob | 25 |' },
    });
  });

  it('rejects oversized CSV to Markdown input before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('csv-to-markdown-table', 1, {
      kind: 'csv-to-markdown',
      value: 'x'.repeat(taskLimits.csvToMarkdown.maxInputBytes + 1),
      options: { delimiter: ',', hasHeader: true },
    }, taskLimits.csvToMarkdown);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('runs Docker Run to Compose conversions in a replaceable worker task', async () => {
    const { runner, workers } = createHarness();
    const first = runner.run('docker-run-to-compose', 1, {
      kind: 'docker-run-to-compose',
      value: 'docker run --name old nginx',
    }, taskLimits.dockerRunToCompose);
    const latest = runner.run('docker-run-to-compose', 2, {
      kind: 'docker-run-to-compose',
      value: 'docker run --name web nginx',
    }, taskLimits.dockerRunToCompose);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.request?.task).toEqual({ kind: 'docker-run-to-compose', value: 'docker run --name web nginx' });
    const result: WorkerTaskResult = {
      kind: 'docker-run-to-compose',
      yaml: "version: '3.9'\nservices:\n    nginx:\n        image: nginx\n        container_name: web\n",
      messages: [],
    };
    workers[1]?.reply(result);
    await expect(latest).resolves.toEqual({ status: 'success', result });
  });

  it('rejects oversized Docker Run to Compose input before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('docker-run-to-compose', 1, {
      kind: 'docker-run-to-compose',
      value: 'x'.repeat(taskLimits.dockerRunToCompose.maxInputBytes + 1),
    }, taskLimits.dockerRunToCompose);

    expect(result).toEqual({ status: 'input-limit' });
    expect(workers).toHaveLength(0);
  });

  it('runs List Converter tasks in a replaceable worker', async () => {
    const { runner, workers } = createHarness();
    const options = {
      lowerCase: false,
      trimItems: true,
      itemPrefix: '',
      itemSuffix: '',
      listPrefix: '',
      listSuffix: '',
      reverseList: false,
      sortList: null,
      removeDuplicates: true,
      separator: ', ',
      keepLineBreaks: false,
    };
    const first = runner.run('list-converter', 1, { kind: 'list-convert', value: 'old', options }, taskLimits.listConverter);
    const latest = runner.run('list-converter', 2, { kind: 'list-convert', value: 'one\ntwo', options }, taskLimits.listConverter);

    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    const result: WorkerTaskResult = { kind: 'list-convert', valid: true, output: 'one, two' };
    workers[1]?.reply(result);
    await expect(latest).resolves.toEqual({ status: 'success', result });
  });

  it('rejects oversized List Converter input before creating a worker', async () => {
    const { runner, workers } = createHarness();
    const result = await runner.run('list-converter', 1, {
      kind: 'list-convert',
      value: 'x'.repeat(taskLimits.listConverter.maxInputBytes + 1),
      options: {
        lowerCase: false,
        trimItems: true,
        itemPrefix: '',
        itemSuffix: '',
        listPrefix: '',
        listSuffix: '',
        reverseList: false,
        sortList: null,
        removeDuplicates: true,
        separator: ', ',
        keepLineBreaks: false,
      },
    }, taskLimits.listConverter);

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
