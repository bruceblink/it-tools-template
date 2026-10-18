import type { RegexMatch, RegexMatchSummary } from '@/tools/regex-tester/regex-tester.service';
import type { TextDiffRow } from '@/tools/text-diff/text-diff.service';
import type { CsvToJsonOptions } from '@/tools/csv-to-json/csv-to-json.service';
import type { JsonKeySorterOptions } from '@/tools/json-key-sorter/json-key-sorter.service';
import type { Difference } from '@/tools/json-diff/json-diff.types';
import type { JsonLinesConverterOptions, JsonLinesDirection, JsonLinesSummary } from '@/tools/json-lines-converter/json-lines-converter.service';

export interface JsonLinesTaskOptions extends JsonLinesConverterOptions {
  direction: JsonLinesDirection
}

export interface XmlFormatTaskOptions {
  indentSize: number
  collapseContent: boolean
}

export type WorkerTask =
  | { kind: 'regex'; regex: string; text: string; flags: string }
  | { kind: 'text-diff'; originalText: string; modifiedText: string; ignoreWhitespace: boolean }
  | { kind: 'json-viewer'; value: string; sortKeys: boolean; indentSize: number }
  | { kind: 'json-key-sorter'; value: string; options: JsonKeySorterOptions }
  | { kind: 'json-path-extractor'; value: string; path: string }
  | { kind: 'json-diff'; leftValue: string; rightValue: string; onlyShowDifferences: boolean }
  | { kind: 'yaml-viewer'; value: string; sortKeys: boolean; indentSize: number }
  | { kind: 'json-minify'; value: string }
  | { kind: 'csv-to-json'; value: string; options: CsvToJsonOptions }
  | { kind: 'json-to-csv'; value: string }
  | { kind: 'json-lines'; value: string; direction: JsonLinesDirection; options: JsonLinesConverterOptions }
  | { kind: 'xml-format'; value: string; options: XmlFormatTaskOptions }
  | { kind: 'xml-to-json'; value: string }
  | { kind: 'json-to-xml'; value: string }
  | { kind: 'yaml-to-json'; value: string }
  | { kind: 'json-to-yaml'; value: string }
  | { kind: 'toml-to-json'; value: string }
  | { kind: 'toml-to-yaml'; value: string }
  | { kind: 'json-to-toml'; value: string }
  | { kind: 'yaml-to-toml'; value: string };

export type WorkerTaskResult =
  | { kind: 'regex'; matches: RegexMatch[]; summary: RegexMatchSummary; sample: string }
  | { kind: 'text-diff'; rows: TextDiffRow[] }
  | { kind: 'json-viewer' | 'json-key-sorter' | 'json-path-extractor' | 'yaml-viewer' | 'json-minify' | 'csv-to-json' | 'json-to-csv'; valid: boolean; output: string; errorMessage?: string }
  | { kind: 'json-diff'; leftValid: boolean; rightValid: boolean; result?: Difference }
  | { kind: 'json-lines'; valid: boolean; output: string; summary: JsonLinesSummary; errorMessage?: string }
  | { kind: 'xml-format' | 'xml-to-json' | 'json-to-xml' | 'yaml-to-json' | 'json-to-yaml' | 'toml-to-json' | 'toml-to-yaml' | 'json-to-toml' | 'yaml-to-toml'; valid: boolean; output: string; errorMessage?: string };

export type WorkerFailureCode = 'input-limit' | 'output-limit' | 'error';

export interface TaskLimits {
  timeoutMs: number
  maxInputBytes: number
  maxOutputBytes: number
  maxPatternCharacters?: number
  maxMatches?: number
  maxLines?: number
}

export interface WorkerRequest {
  id: number
  inputVersion: number
  task: WorkerTask
  maxOutputBytes: number
}

export type WorkerResponse =
  | { id: number; inputVersion: number; ok: true; result: WorkerTaskResult }
  | { id: number; inputVersion: number; ok: false; code: WorkerFailureCode };

export type TaskOutcome<T> =
  | { status: 'success'; result: T }
  | { status: 'cancelled' }
  | { status: 'input-limit' }
  | { status: 'output-limit' }
  | { status: 'timeout' }
  | { status: 'error' };

export const taskLimits = {
  regex: {
    timeoutMs: 1_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 1024 * 1024,
    maxPatternCharacters: 4_096,
    maxMatches: 5_000,
  },
  textDiff: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
    maxLines: 20_000,
  },
  jsonViewer: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  jsonKeySorter: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  jsonPathExtractor: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  jsonDiff: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  yamlViewer: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  jsonMinify: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  csvToJson: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  jsonToCsv: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  jsonLines: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  formatConversion: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
  tomlConversion: {
    timeoutMs: 10_000,
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
  },
} satisfies Record<'regex' | 'textDiff' | 'jsonViewer' | 'jsonKeySorter' | 'jsonPathExtractor' | 'jsonDiff' | 'yamlViewer' | 'jsonMinify' | 'csvToJson' | 'jsonToCsv' | 'jsonLines' | 'formatConversion' | 'tomlConversion', TaskLimits>;
