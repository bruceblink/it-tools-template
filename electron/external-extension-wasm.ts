import type { ExternalExtensionRpcJsonValue } from '../src/shared/desktop-services/external-extension-rpc';

export const externalExtensionWasmLimits = Object.freeze({
  maximumModuleBytes: 16 * 1024 * 1024,
  memoryPages: 256,
  initialMemoryPages: 16,
  maximumRequestBytes: 16 * 1024,
  maximumResponseBytes: 16 * 1024,
  maximumJsonDepth: 16,
});

export const externalExtensionWasmAbi = Object.freeze({
  importModule: 'env',
  memoryImport: 'memory',
  allocateExport: 'alloc',
  executeExport: 'execute',
  freeExport: 'free',
});

export type ExternalExtensionWasmErrorCode =
  | 'invalid-module'
  | 'unsupported-import'
  | 'invalid-abi'
  | 'resource-limit'
  | 'invalid-input'
  | 'invalid-result'
  | 'execution-failed';

export class ExternalExtensionWasmError extends Error {
  constructor(readonly code: ExternalExtensionWasmErrorCode, message: string = code, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExternalExtensionWasmError';
  }
}

interface ExternalExtensionWasmExports extends WebAssembly.Exports {
  alloc: (size: number) => number;
  execute: (pointer: number, length: number) => bigint;
  free: (pointer: number, length: number) => void;
}

/**
 * 执行只导入 `env.memory` 的模块。ABI 使用 UTF-8 JSON；`alloc(size)` 返回请求缓冲区，
 * `execute(ptr, len)` 返回 i64（高 32 位为结果指针，低 32 位为字节长度），`free(ptr, len)` 释放缓冲区。
 * WebAssembly 调用是同步的；主进程必须能在超时后终止承载它的 utility process。
 */
export function executeExternalExtensionWasmCommand(
  moduleBytes: Uint8Array,
  commandId: string,
  input: ExternalExtensionRpcJsonValue,
): ExternalExtensionRpcJsonValue {
  const requestBytes = encodeRequest(commandId, input);
  if (moduleBytes.byteLength === 0 || moduleBytes.byteLength > externalExtensionWasmLimits.maximumModuleBytes) {
    throw new ExternalExtensionWasmError('resource-limit', 'The WASM module exceeds its byte limit.');
  }
  validateNoDefinedMemory(moduleBytes);
  const module = compileModule(moduleBytes);
  validateImports(module);
  const memory = createMemory();
  const exports = instantiateModule(module, memory);
  const requestPointer = allocateRequest(exports, memory, requestBytes);
  try {
    let resultDescriptor: { readonly pointer: number; readonly length: number } | undefined;
    try {
      resultDescriptor = executeCommand(exports, requestPointer, requestBytes.byteLength);
      return readResult(memory, resultDescriptor);
    }
    finally {
      if (resultDescriptor && resultDescriptor.pointer !== requestPointer) {
        releaseMemory(exports, memory, resultDescriptor.pointer, resultDescriptor.length);
      }
    }
  }
  finally {
    releaseMemory(exports, memory, requestPointer, requestBytes.byteLength);
  }
}

function encodeRequest(commandId: string, input: ExternalExtensionRpcJsonValue): Uint8Array {
  if (!commandId || !isJsonValue(input)) {
    throw new ExternalExtensionWasmError('invalid-input');
  }
  const encoded = new TextEncoder().encode(JSON.stringify({ commandId, input }));
  if (encoded.byteLength > externalExtensionWasmLimits.maximumRequestBytes) {
    throw new ExternalExtensionWasmError('resource-limit', 'The WASM command input exceeds its byte limit.');
  }
  return encoded;
}

function compileModule(moduleBytes: Uint8Array): WebAssembly.Module {
  try {
    const bytes = new Uint8Array(moduleBytes.byteLength);
    bytes.set(moduleBytes);
    return new WebAssembly.Module(bytes);
  }
  catch (error) {
    throw new ExternalExtensionWasmError('invalid-module', 'The WASM module is invalid.', { cause: error });
  }
}

function validateNoDefinedMemory(moduleBytes: Uint8Array): void {
  if (moduleBytes.byteLength < 8) {
    throw new ExternalExtensionWasmError('invalid-module');
  }
  let offset = 8;
  while (offset < moduleBytes.byteLength) {
    const sectionId = moduleBytes[offset]!;
    const sectionSize = readUnsignedLeb(moduleBytes, offset + 1);
    const sectionStart = sectionSize.nextOffset;
    const sectionEnd = sectionStart + sectionSize.value;
    if (sectionEnd > moduleBytes.byteLength) {
      throw new ExternalExtensionWasmError('invalid-module', 'The WASM section exceeds the module boundary.');
    }
    if (sectionId === 5 && sectionSize.value > 0) {
      throw new ExternalExtensionWasmError('invalid-abi', 'The WASM module must use only the imported host memory.');
    }
    offset = sectionEnd;
  }
}

function readUnsignedLeb(bytes: Uint8Array, offset: number): { readonly value: number; readonly nextOffset: number } {
  let value = 0;
  let shift = 0;
  let currentOffset = offset;
  while (currentOffset < bytes.byteLength && shift < 35) {
    const byte = bytes[currentOffset++]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, nextOffset: currentOffset };
    }
    shift += 7;
  }
  throw new ExternalExtensionWasmError('invalid-module', 'The WASM section length is invalid.');
}

function validateImports(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 1
    || imports[0]?.module !== externalExtensionWasmAbi.importModule
    || imports[0]?.name !== externalExtensionWasmAbi.memoryImport
    || imports[0]?.kind !== 'memory') {
    throw new ExternalExtensionWasmError('unsupported-import', 'The WASM module may only import env.memory.');
  }
}

function createMemory(): WebAssembly.Memory {
  try {
    return new WebAssembly.Memory({
      initial: externalExtensionWasmLimits.initialMemoryPages,
      maximum: externalExtensionWasmLimits.memoryPages,
    });
  }
  catch (error) {
    throw new ExternalExtensionWasmError('resource-limit', 'The host could not allocate the bounded WASM memory.', { cause: error });
  }
}

function instantiateModule(module: WebAssembly.Module, memory: WebAssembly.Memory): ExternalExtensionWasmExports {
  let instance: WebAssembly.Instance;
  try {
    instance = new WebAssembly.Instance(module, {
      [externalExtensionWasmAbi.importModule]: {
        [externalExtensionWasmAbi.memoryImport]: memory,
      },
    });
  }
  catch (error) {
    throw new ExternalExtensionWasmError('invalid-abi', 'The WASM module does not accept the bounded host memory.', { cause: error });
  }

  const exports = instance.exports;
  if (!hasExactExports(exports)
    || typeof exports.alloc !== 'function'
    || typeof exports.execute !== 'function'
    || typeof exports.free !== 'function') {
    throw new ExternalExtensionWasmError('invalid-abi', 'The WASM module must export alloc, execute, and free functions only.');
  }
  return exports as ExternalExtensionWasmExports;
}

function hasExactExports(exports: WebAssembly.Exports): boolean {
  const keys = Object.keys(exports).sort();
  return keys.length === 3
    && keys[0] === externalExtensionWasmAbi.allocateExport
    && keys[1] === externalExtensionWasmAbi.executeExport
    && keys[2] === externalExtensionWasmAbi.freeExport;
}

function allocateRequest(
  exports: ExternalExtensionWasmExports,
  memory: WebAssembly.Memory,
  requestBytes: Uint8Array,
): number {
  try {
    const pointer = exports.alloc(requestBytes.byteLength);
    assertMemoryRange(memory, pointer, requestBytes.byteLength);
    new Uint8Array(memory.buffer, pointer, requestBytes.byteLength).set(requestBytes);
    return pointer;
  }
  catch (error) {
    if (error instanceof ExternalExtensionWasmError) {
      throw error;
    }
    throw new ExternalExtensionWasmError('execution-failed', 'The WASM allocator failed.', { cause: error });
  }
}

function executeCommand(
  exports: ExternalExtensionWasmExports,
  pointer: number,
  length: number,
): { readonly pointer: number; readonly length: number } {
  try {
    const descriptor = exports.execute(pointer, length);
    if (typeof descriptor !== 'bigint' || descriptor < 0n || descriptor > 0xffff_ffff_ffff_ffffn) {
      throw new ExternalExtensionWasmError('invalid-result', 'The WASM execute function returned an invalid descriptor.');
    }
    return {
      pointer: Number((descriptor >> 32n) & 0xffff_ffffn),
      length: Number(descriptor & 0xffff_ffffn),
    };
  }
  catch (error) {
    if (error instanceof ExternalExtensionWasmError) {
      throw error;
    }
    throw new ExternalExtensionWasmError('execution-failed', 'The WASM execute function failed.', { cause: error });
  }
}

function readResult(
  memory: WebAssembly.Memory,
  descriptor: { readonly pointer: number; readonly length: number },
): ExternalExtensionRpcJsonValue {
  if (descriptor.length > externalExtensionWasmLimits.maximumResponseBytes) {
    throw new ExternalExtensionWasmError('resource-limit', 'The WASM result exceeds its byte limit.');
  }
  assertMemoryRange(memory, descriptor.pointer, descriptor.length);
  let parsed: unknown;
  try {
    const bytes = new Uint8Array(memory.buffer, descriptor.pointer, descriptor.length);
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  }
  catch (error) {
    throw new ExternalExtensionWasmError('invalid-result', 'The WASM result is not valid UTF-8 JSON.', { cause: error });
  }
  if (!isJsonValue(parsed)) {
    throw new ExternalExtensionWasmError('invalid-result', 'The WASM result is outside the supported JSON value boundary.');
  }
  return parsed;
}

function assertMemoryRange(memory: WebAssembly.Memory, pointer: number, length: number): void {
  if (!Number.isInteger(pointer)
    || !Number.isInteger(length)
    || pointer < 0
    || length < 0
    || pointer + length > memory.buffer.byteLength) {
    throw new ExternalExtensionWasmError('invalid-abi', 'The WASM module returned a memory range outside its allocation.');
  }
}

function releaseMemory(
  exports: ExternalExtensionWasmExports,
  memory: WebAssembly.Memory,
  pointer: number,
  length: number,
): void {
  try {
    assertMemoryRange(memory, pointer, length);
  }
  catch {
    return;
  }
  try {
    exports.free(pointer, length);
  }
  catch {
    // 清理失败不覆盖已经取得的执行结果或原始错误。
  }
}

function isJsonValue(value: unknown, depth = 0): value is ExternalExtensionRpcJsonValue {
  if (depth > externalExtensionWasmLimits.maximumJsonDepth) {
    return false;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(item => isJsonValue(item, depth + 1));
  }
  if (typeof value !== 'object') {
    return false;
  }
  return Object.values(value).every(item => isJsonValue(item, depth + 1));
}
