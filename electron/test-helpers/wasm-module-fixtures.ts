/** WASM 二进制测试样例选项。测试使用真实 WebAssembly.Module，不需要外部编译器。 */
export interface WasmModuleFixtureOptions {
  readonly executeBody?: readonly number[];
  readonly extraFunctionImport?: boolean;
  readonly resultPointer?: number;
  readonly resultLength?: number;
  readonly resultBytes?: Uint8Array;
  readonly definedMemory?: boolean;
  readonly definedTable?: boolean;
  readonly memoryMinimum?: number;
  readonly commandId?: string;
  readonly spinOnTrueField?: string;
}

/** 构造仅供测试使用的 WASM 模块；可注入无效资源和同步死循环。 */
export function createWasmModuleFixture(options: WasmModuleFixtureOptions = {}): Uint8Array {
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
  const executeBody = options.executeBody
    ?? (options.spinOnTrueField
      ? spinOnTrueFieldBody(options.spinOnTrueField, options.commandId ?? 'org.example.echo/run', packedResult)
      : constantI64Body(packedResult));
  const bodies = [
    functionBody([...i32Const(memoryPointer)]),
    functionBody(executeBody),
    functionBody([]),
  ];
  const sections = [
    wasmSection(1, vector(typeEntries)),
    wasmSection(2, vector(imports)),
    wasmSection(3, vector([unsignedLeb(0), unsignedLeb(1), unsignedLeb(2)])),
    ...(options.definedTable ? [wasmSection(4, vector([[0x70, 0x00, ...unsignedLeb(1)]]))] : []),
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

export interface StoredZipEntry {
  readonly path: string;
  readonly contents: Uint8Array | string;
}

/** 构造无压缩 ZIP；仅供签名扩展包测试使用。 */
export function createStoredZip(entries: readonly StoredZipEntry[]): Buffer {
  const records = entries.map(({ path, contents }) => {
    const name = Buffer.from(path, 'utf8');
    const body = Buffer.from(contents);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name, body]);
  });
  const central = entries.map(({ path, contents }, index) => {
    const name = Buffer.from(path, 'utf8');
    const body = Buffer.from(contents);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(crc32(body), 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(body.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entries.slice(0, index).reduce((total, entry) => (
      total + 30 + Buffer.byteLength(entry.path) + Buffer.byteLength(entry.contents)
    ), 0), 42);
    return Buffer.concat([header, name]);
  });
  const localBytes = records.reduce((total, record) => total + record.length, 0);
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes, 16);
  return Buffer.concat([...records, centralBytes, end]);
}

/** 生成只在布尔输入为 true 时循环的模块，用于测试主进程超时终止。 */
function spinOnTrueFieldBody(field: string, commandId: string, result: bigint): number[] {
  const sample = new TextEncoder().encode(JSON.stringify({ commandId, input: { [field]: true } }));
  const marker = new TextEncoder().encode(`"${field}":true`);
  const markerStart = findBytes(sample, marker);
  if (markerStart < 0) {
    throw new Error('The WASM test input marker could not be located.');
  }
  const valuePointer = markerStart + marker.byteLength - 4;
  return [
    0x20, 0x00,
    0x41, ...signedLeb(BigInt(valuePointer)),
    0x6a,
    0x2d, 0x00, 0x00,
    0x41, ...signedLeb(BigInt('t'.charCodeAt(0))),
    0x46,
    0x04, 0x7e,
    0x03, 0x40, 0x0c, 0x00, 0x0b,
    0x00,
    0x05,
    0x42, ...signedLeb(result),
    0x0b,
  ];
}

function findBytes(source: Uint8Array, target: Uint8Array): number {
  for (let start = 0; start <= source.byteLength - target.byteLength; start += 1) {
    if (target.every((byte, offset) => source[start + offset] === byte)) {
      return start;
    }
  }
  return -1;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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

function constantI64Body(value: bigint): number[] {
  return [0x42, ...signedLeb(value)];
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
