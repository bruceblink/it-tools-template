import { describe, expect, it } from 'vitest';
import {
  executeExternalExtensionWasmCommand,
  externalExtensionWasmLimits,
  ExternalExtensionWasmError,
} from './external-extension-wasm';

describe('external extension WASM runner', () => {
  it('passes command input as UTF-8 JSON and returns JSON from the bounded memory', () => {
    const result = executeExternalExtensionWasmCommand(
      createModule({ executeBody: echoRequestBody() }),
      'org.example.echo/run',
      { text: 'hello' },
    );

    expect(result).toEqual({
      commandId: 'org.example.echo/run',
      input: { text: 'hello' },
    });
  });

  it('rejects function imports and other host functions', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ extraFunctionImport: true }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'unsupported-import' }));
  });

  it('rejects a memory declared inside the module', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ definedMemory: true }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a module that requires more than the host memory limit', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ memoryMinimum: externalExtensionWasmLimits.memoryPages + 1 }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a result pointer that escapes the fixed memory', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ resultPointer: 16 * 65_536 - 4, resultLength: 8 }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a result that exceeds the protocol byte limit', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ resultPointer: 4096, resultLength: externalExtensionWasmLimits.maximumResponseBytes + 1 }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'resource-limit' }));
  });

  it('rejects invalid UTF-8 JSON returned by the module', () => {
    const invalidJson = new TextEncoder().encode('not-json');
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ resultPointer: 4096, resultBytes: invalidJson }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-result' }));
  });

  it('rejects an input larger than the protocol byte limit', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createModule({ executeBody: echoRequestBody() }),
      'org.example.echo/run',
      { text: 'x'.repeat(externalExtensionWasmLimits.maximumRequestBytes) },
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'resource-limit' }));
  });
});

interface TestModuleOptions {
  readonly executeBody?: readonly number[];
  readonly extraFunctionImport?: boolean;
  readonly resultPointer?: number;
  readonly resultLength?: number;
  readonly resultBytes?: Uint8Array;
  readonly definedMemory?: boolean;
  readonly memoryMinimum?: number;
}

/** 在测试中构造一个只导入内存的真实 WASM 二进制模块。 */
function createModule(options: TestModuleOptions = {}): Uint8Array {
  const memoryPointer = 1024;
  const resultBytes = options.resultBytes;
  const resultPointer = options.resultPointer ?? memoryPointer;
  const resultLength = options.resultLength ?? resultBytes?.byteLength ?? 0;
  const packedResult = (BigInt(resultPointer) << 32n) | BigInt(resultLength);
  const typeEntries = [
    functionType([], [0x7f]),
    functionType([0x7f, 0x7f], [0x7e]),
    functionType([0x7f, 0x7f], []),
    ...(options.extraFunctionImport ? [functionType([], [0x7f])] : []),
  ];
  const imports = [
    [...wasmString('env'), ...wasmString('memory'), 0x02, 0x01, ...unsignedLeb(options.memoryMinimum ?? 16), ...unsignedLeb(Math.max(options.memoryMinimum ?? 16, 256))],
    ...(options.extraFunctionImport
      ? [[...wasmString('env'), ...wasmString('clock'), 0x00, ...unsignedLeb(3)]]
      : []),
  ];
  const functionBase = options.extraFunctionImport ? 1 : 0;
  const exports = [
    [...wasmString('alloc'), 0x00, ...unsignedLeb(functionBase)],
    [...wasmString('execute'), 0x00, ...unsignedLeb(functionBase + 1)],
    [...wasmString('free'), 0x00, ...unsignedLeb(functionBase + 2)],
  ];
  const executeBody = options.executeBody ?? constantI64Body(packedResult);
  const bodies = [
    functionBody([...i32Const(memoryPointer)]),
    functionBody(executeBody),
    functionBody([]),
  ];
  const sections = [
    wasmSection(1, vector(typeEntries)),
    wasmSection(2, vector(imports)),
    wasmSection(3, vector([unsignedLeb(0), unsignedLeb(1), unsignedLeb(2)])),
    ...(options.definedMemory ? [wasmSection(5, vector([[0x01, ...unsignedLeb(1), ...unsignedLeb(16)]]))] : []),
    wasmSection(7, vector(exports)),
    wasmSection(10, vector(bodies)),
    ...(resultBytes === undefined ? [] : [wasmSection(11, vector([[
      0x00,
      ...i32Const(resultPointer),
      0x0b,
      ...unsignedLeb(resultBytes.byteLength),
      ...resultBytes,
    ]]))]),
  ];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...sections.flat(),
  ]);
}

function echoRequestBody(): number[] {
  return [
    0x20, 0x00, // local.get 0
    0xad, // i64.extend_i32_u
    0x42, 0x20, // i64.const 32
    0x86, // i64.shl
    0x20, 0x01, // local.get 1
    0xad, // i64.extend_i32_u
    0x84, // i64.or
  ];
}

function constantI64Body(value: bigint): number[] {
  return [0x42, ...signedLeb(value)];
}

function functionBody(instructions: readonly number[]): number[] {
  const body = [0x00, ...instructions, 0x0b];
  return [...unsignedLeb(body.length), ...body];
}

function functionType(parameters: readonly number[], results: readonly number[]): number[] {
  return [0x60, ...vector(parameters.map(value => [value])), ...vector(results.map(value => [value]))];
}

function wasmSection(id: number, payload: readonly number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload];
}

function vector(values: readonly (readonly number[])[]): number[] {
  return [...unsignedLeb(values.length), ...values.flat()];
}

function wasmString(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...unsignedLeb(bytes.length), ...bytes];
}

function i32Const(value: number): number[] {
  return [0x41, ...signedLeb(BigInt(value))];
}

function unsignedLeb(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

function signedLeb(value: bigint): number[] {
  const bytes: number[] = [];
  let remaining = value;
  let more = true;
  while (more) {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    more = !((remaining === 0n && !signBit) || (remaining === -1n && signBit));
    if (more) {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}
