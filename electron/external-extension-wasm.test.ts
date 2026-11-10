import { describe, expect, it } from 'vitest';
import {
  executeExternalExtensionWasmCommand,
  externalExtensionWasmLimits,
  ExternalExtensionWasmError,
} from './external-extension-wasm';
import { createWasmModuleFixture } from './test-helpers/wasm-module-fixtures';

describe('external extension WASM runner', () => {
  it('passes command input as UTF-8 JSON and returns JSON from the bounded memory', () => {
    const result = executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ executeBody: echoRequestBody() }),
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
      createWasmModuleFixture({ extraFunctionImport: true }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'unsupported-import' }));
  });

  it('rejects a memory declared inside the module', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ definedMemory: true }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a table declared inside the module', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ definedTable: true }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a module that requires more than the host memory limit', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ memoryMinimum: externalExtensionWasmLimits.memoryPages + 1 }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a result pointer that escapes the fixed memory', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ resultPointer: 16 * 65_536 - 4, resultLength: 8 }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-abi' }));
  });

  it('rejects a result that exceeds the protocol byte limit', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ resultPointer: 4096, resultLength: externalExtensionWasmLimits.maximumResponseBytes + 1 }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'resource-limit' }));
  });

  it('rejects invalid UTF-8 JSON returned by the module', () => {
    const invalidJson = new TextEncoder().encode('not-json');
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ resultPointer: 4096, resultBytes: invalidJson }),
      'org.example.echo/run',
      {},
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'invalid-result' }));
  });

  it('rejects an input larger than the protocol byte limit', () => {
    expect(() => executeExternalExtensionWasmCommand(
      createWasmModuleFixture({ executeBody: echoRequestBody() }),
      'org.example.echo/run',
      { text: 'x'.repeat(externalExtensionWasmLimits.maximumRequestBytes) },
    )).toThrowError(expect.objectContaining<Partial<ExternalExtensionWasmError>>({ code: 'resource-limit' }));
  });
});

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
