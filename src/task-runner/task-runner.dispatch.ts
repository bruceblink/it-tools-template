import RandExp from 'randexp';
import JSON5 from 'json5';
import { diffTextLines } from '@/tools/text-diff/text-diff.service';
import { convertCsvToJson } from '@/tools/csv-to-json/csv-to-json.service';
import { convertCsvToMarkdownTable } from '@/tools/csv-to-markdown-table/csv-to-markdown-table.service';
import { extractJsonPath } from '@/tools/json-path-extractor/json-path-extractor.service';
import { diff as diffJson } from '@/tools/json-diff/json-diff.models';
import { convertArrayToCsv } from '@/tools/json-to-csv/json-to-csv.service';
import { convertJsonLines, JsonLinesConversionError } from '@/tools/json-lines-converter/json-lines-converter.service';
import { sortJsonText } from '@/tools/json-key-sorter/json-key-sorter.service';
import { formatJson } from '@/tools/json-viewer/json.models';
import { formatYaml } from '@/tools/yaml-viewer/yaml-models';
import { formatEnvVarsResult, parseEnvVars } from '@/tools/env-vars-parser/env-vars-parser.service';
import { matchRegex, summarizeRegexMatches } from '@/tools/regex-tester/regex-tester.service';
import { executeConversionTask } from './conversion-tasks';
import { taskLimits } from './task-runner.types';
import type { WorkerFailureCode, WorkerTask, WorkerTaskResult } from './task-runner.types';

const maxRegexSampleCharacters = 4_096;
const maxRegexSampleRepeat = 256;

export class TaskExecutionError extends Error {
  constructor(readonly code: Exclude<WorkerFailureCode, 'error'>) {
    super(code === 'input-limit' ? 'Task input exceeds its limit.' : 'Task output exceeds its limit.');
  }
}

function countLines(text: string): number {
  return text.split(/\r\n|\r|\n/).length;
}

function hasLargeRepeat(pattern: string): boolean {
  const repeats = pattern.matchAll(/\{\s*(\d+)(?:\s*,\s*(\d*)\s*)?\}/g);
  for (const repeat of repeats) {
    const minimum = Number(repeat[1]);
    const maximum = repeat[2] ? Number(repeat[2]) : minimum;
    if (minimum > maxRegexSampleRepeat || maximum > maxRegexSampleRepeat) {
      return true;
    }
  }
  return false;
}

function createRegexSample(pattern: string): string {
  if (hasLargeRepeat(pattern)) {
    return '';
  }
  try {
    const compatiblePattern = pattern.replace(/\(\?\<[\^>]*\>/g, '(?:');
    const generator = new RandExp(new RegExp(compatiblePattern));
    generator.max = maxRegexSampleRepeat;
    const sample = generator.gen();
    return sample.length <= maxRegexSampleCharacters ? sample : '';
  }
  catch {
    return '';
  }
}

/** Execute a pure task in a worker and reject inputs or outputs outside the per-tool limits. */
export function executeWorkerTask(task: WorkerTask): WorkerTaskResult {
  if (task.kind === 'xml-format' || task.kind === 'xml-to-json' || task.kind === 'json-to-xml' || task.kind === 'yaml-to-json' || task.kind === 'json-to-yaml' || task.kind === 'toml-to-json' || task.kind === 'toml-to-yaml' || task.kind === 'json-to-toml' || task.kind === 'yaml-to-toml') {
    return executeConversionTask(task);
  }

  if (task.kind === 'json-minify') {
    try {
      const output = JSON.stringify(JSON5.parse(task.value), null, 0);
      return { kind: 'json-minify', valid: true, output: output ?? '' };
    }
    catch {
      return { kind: 'json-minify', valid: false, output: '' };
    }
  }

  if (task.kind === 'env-vars-parser') {
    if (countLines(task.value) > (taskLimits.envVarsParser.maxLines ?? Number.MAX_SAFE_INTEGER)) {
      throw new TaskExecutionError('input-limit');
    }
    const result = parseEnvVars(task.value);
    return {
      kind: 'env-vars-parser',
      result,
      output: formatEnvVarsResult(result, task.outputFormat),
    };
  }

  if (task.kind === 'json-viewer') {
    try {
      return {
        kind: 'json-viewer',
        valid: true,
        output: formatJson({ rawJson: task.value, sortKeys: task.sortKeys, indentSize: task.indentSize }),
      };
    }
    catch {
      return { kind: 'json-viewer', valid: false, output: '' };
    }
  }

  if (task.kind === 'json-key-sorter') {
    try {
      return { kind: 'json-key-sorter', valid: true, output: sortJsonText(task.value, task.options) };
    }
    catch {
      return { kind: 'json-key-sorter', valid: false, output: '' };
    }
  }

  if (task.kind === 'json-path-extractor') {
    try {
      return { kind: 'json-path-extractor', valid: true, output: extractJsonPath(task.value, task.path) };
    }
    catch {
      return { kind: 'json-path-extractor', valid: false, output: '' };
    }
  }

  if (task.kind === 'json-diff') {
    let leftValue: unknown;
    let rightValue: unknown;
    let leftValid = true;
    let rightValid = true;
    try {
      leftValue = JSON5.parse(task.leftValue);
    }
    catch {
      leftValid = false;
    }
    try {
      rightValue = JSON5.parse(task.rightValue);
    }
    catch {
      rightValid = false;
    }
    if (!leftValid || !rightValid) {
      return { kind: 'json-diff', leftValid, rightValid };
    }
    return {
      kind: 'json-diff',
      leftValid,
      rightValid,
      result: diffJson(leftValue, rightValue, { onlyShowDifferences: task.onlyShowDifferences }),
    };
  }

  if (task.kind === 'yaml-viewer') {
    try {
      return {
        kind: 'yaml-viewer',
        valid: true,
        output: formatYaml({ rawYaml: task.value, sortKeys: task.sortKeys, indentSize: task.indentSize }),
      };
    }
    catch {
      return { kind: 'yaml-viewer', valid: false, output: '' };
    }
  }

  if (task.kind === 'csv-to-json') {
    try {
      return { kind: 'csv-to-json', valid: true, output: convertCsvToJson(task.value, task.options) };
    }
    catch {
      return { kind: 'csv-to-json', valid: false, output: '' };
    }
  }

  if (task.kind === 'csv-to-markdown') {
    try {
      return { kind: 'csv-to-markdown', valid: true, output: convertCsvToMarkdownTable(task.value, task.options) };
    }
    catch {
      return { kind: 'csv-to-markdown', valid: false, output: '', errorMessage: 'Provided CSV is not valid.' };
    }
  }

  if (task.kind === 'json-to-csv') {
    try {
      const array = JSON5.parse(task.value) as Record<string, unknown>[];
      return { kind: 'json-to-csv', valid: true, output: convertArrayToCsv({ array }) };
    }
    catch {
      return { kind: 'json-to-csv', valid: false, output: '' };
    }
  }

  if (task.kind === 'json-lines') {
    const emptySummary = { inputLines: 0, outputValues: 0, emptyLines: 0 };
    try {
      const output = convertJsonLines(task.value, task.direction, task.options);
      if (task.value.trim() === '') {
        return { kind: 'json-lines', valid: true, output: '', summary: emptySummary };
      }
      const inputLines = task.value.split(/\r?\n/);
      const emptyLines = inputLines.filter(line => line.trim() === '').length;
      const outputValues = task.direction === 'json-to-jsonl'
        ? output === '' ? 0 : output.split(/\r?\n/).length
        : inputLines.filter(line => line.trim() !== '').length;
      return {
        kind: 'json-lines',
        valid: true,
        output,
        summary: { inputLines: inputLines.length, outputValues, emptyLines },
      };
    }
    catch (error) {
      return {
        kind: 'json-lines',
        valid: false,
        output: '',
        summary: emptySummary,
        errorMessage: error instanceof JsonLinesConversionError ? error.message : 'Input is not valid for the selected conversion.',
      };
    }
  }

  if (task.kind === 'text-diff') {
    if (countLines(task.originalText) + countLines(task.modifiedText) > (taskLimits.textDiff.maxLines ?? Number.MAX_SAFE_INTEGER)) {
      throw new TaskExecutionError('input-limit');
    }
    return {
      kind: 'text-diff',
      rows: diffTextLines(task.originalText, task.modifiedText, task.ignoreWhitespace),
    };
  }

  if (task.kind !== 'regex') {
    throw new Error('This task must use a dedicated worker.');
  }

  if (task.regex.length > (taskLimits.regex.maxPatternCharacters ?? Number.MAX_SAFE_INTEGER)) {
    throw new TaskExecutionError('input-limit');
  }
  const maxMatches = taskLimits.regex.maxMatches ?? Number.MAX_SAFE_INTEGER;
  const matches = matchRegex(task.regex, task.text, task.flags, maxMatches + 1);
  if (matches.length > maxMatches) {
    throw new TaskExecutionError('output-limit');
  }
  return {
    kind: 'regex',
    matches,
    summary: summarizeRegexMatches(matches, task.text),
    sample: createRegexSample(task.regex),
  };
}

/** Measure the structured-clone result before sending it across the worker boundary. */
export function assertWorkerOutputSize(result: WorkerTaskResult, maxOutputBytes: number): void {
  const outputBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (outputBytes > maxOutputBytes) {
    throw new TaskExecutionError('output-limit');
  }
}
