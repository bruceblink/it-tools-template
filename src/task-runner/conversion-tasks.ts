import JSON5 from 'json5';
import convertXml, { type Element, type ElementCompact } from 'xml-js';
import { parse as parseToml, stringify as stringifyToml } from 'iarna-toml-esm';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { formatXmlResult, isValidXML } from '@/tools/xml-formatter/xml-formatter.service';
import type { WorkerTask, WorkerTaskResult } from './task-runner.types';

type ConversionTask = Extract<WorkerTask, { kind: 'xml-format' | 'xml-to-json' | 'json-to-xml' | 'yaml-to-json' | 'json-to-yaml' | 'toml-to-json' | 'toml-to-yaml' | 'json-to-toml' | 'yaml-to-toml' }>;
type ConversionResult = Extract<WorkerTaskResult, { kind: ConversionTask['kind'] }>;

function invalidResult(kind: ConversionTask['kind'], errorMessage: string): ConversionResult {
  return { kind, valid: false, output: '', errorMessage };
}

/** The TOML package references Node's `global`; define the worker-safe alias before calling it. */
function ensureTomlWorkerGlobals(): void {
  const workerGlobal = globalThis as typeof globalThis & { global?: typeof globalThis };
  workerGlobal.global ??= globalThis;
}

/** Run expensive format parsing in the worker and expose only bounded text results. */
export function executeConversionTask(task: ConversionTask): ConversionResult {
  if (task.kind === 'xml-format') {
    const indentationSize = Math.max(0, Math.min(10, Math.floor(task.options.indentSize || 0)));
    const result = formatXmlResult(task.value, {
      indentation: ' '.repeat(indentationSize),
      collapseContent: task.options.collapseContent,
      lineSeparator: '\n',
    });
    return result.valid
      ? { kind: task.kind, valid: true, output: result.output }
      : invalidResult(task.kind, 'Provided XML is not valid.');
  }

  if (task.kind === 'xml-to-json') {
    if (!isValidXML(task.value)) {
      return invalidResult(task.kind, 'Provided XML is not valid.');
    }
    try {
      return { kind: task.kind, valid: true, output: JSON.stringify(convertXml.xml2js(task.value, { compact: true }), null, 2) ?? '' };
    }
    catch {
      return { kind: task.kind, valid: true, output: '' };
    }
  }

  if (task.kind === 'json-to-xml') {
    let parsed: unknown;
    try {
      parsed = JSON5.parse(task.value);
    }
    catch {
      return invalidResult(task.kind, 'Provided JSON is not valid.');
    }
    try {
      return { kind: task.kind, valid: true, output: convertXml.js2xml(parsed as Element | ElementCompact, { compact: true }) };
    }
    catch {
      return { kind: task.kind, valid: true, output: '' };
    }
  }

  if (task.kind === 'yaml-to-json') {
    try {
      const parsed = parseYaml(task.value, { merge: true });
      return { kind: task.kind, valid: true, output: parsed ? JSON.stringify(parsed, null, 3) ?? '' : '' };
    }
    catch {
      return invalidResult(task.kind, 'Provided YAML is not valid.');
    }
  }

  if (task.kind === 'json-to-yaml') {
    try {
      return { kind: task.kind, valid: true, output: stringifyYaml(JSON5.parse(task.value)) };
    }
    catch {
      return invalidResult(task.kind, 'Provided JSON is not valid.');
    }
  }

  if (task.kind === 'toml-to-json') {
    try {
      ensureTomlWorkerGlobals();
      return { kind: task.kind, valid: true, output: task.value === '' ? '' : JSON.stringify(parseToml(task.value), null, 3) ?? '' };
    }
    catch {
      return invalidResult(task.kind, 'Provided TOML is not valid.');
    }
  }

  if (task.kind === 'toml-to-yaml') {
    if (task.value.trim() === '') {
      return { kind: task.kind, valid: true, output: '' };
    }
    try {
      ensureTomlWorkerGlobals();
      return { kind: task.kind, valid: true, output: stringifyYaml(parseToml(task.value)) };
    }
    catch {
      return invalidResult(task.kind, 'Provided TOML is not valid.');
    }
  }

  if (task.kind === 'json-to-toml') {
    if (task.value.trim() === '') {
      return { kind: task.kind, valid: true, output: '' };
    }
    let parsed: unknown;
    try {
      parsed = JSON5.parse(task.value);
    }
    catch {
      return invalidResult(task.kind, 'Provided JSON is not valid.');
    }
    try {
      ensureTomlWorkerGlobals();
      return { kind: task.kind, valid: true, output: [stringifyToml(parsed)].flat().join('\n').trim() };
    }
    catch {
      return { kind: task.kind, valid: true, output: '' };
    }
  }

  if (task.value.trim() === '') {
    return { kind: task.kind, valid: true, output: '' };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(task.value);
  }
  catch {
    return invalidResult(task.kind, 'Provided YAML is not valid.');
  }
  try {
    ensureTomlWorkerGlobals();
    return { kind: task.kind, valid: true, output: [stringifyToml(parsed)].flat().join('\n').trim() };
  }
  catch {
    return { kind: task.kind, valid: true, output: '' };
  }
}
