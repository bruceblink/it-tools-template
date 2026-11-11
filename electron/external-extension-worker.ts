import { createHash } from 'node:crypto';
import { open, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  parseExternalExtensionRpcRequest,
  type ExternalExtensionRpcJsonValue,
  type ExternalExtensionRpcRequest,
  type ExternalExtensionRpcResponse,
} from '../src/shared/desktop-services/external-extension-rpc';
import { executeExternalExtensionWasmCommand, ExternalExtensionWasmError, externalExtensionWasmLimits } from './external-extension-wasm';
import {
  parseExternalExtensionWorkerLaunchArguments,
  type ExternalExtensionWorkerLaunchConfig,
} from './external-extension-worker-launch';

type WorkerFailureCode = Extract<ExternalExtensionRpcResponse, { ok: false }>['error'];

/** 只在隔离 utility process 中加载已校验的 WASM 字节并处理命令请求。 */
export class ExternalExtensionWorkerRuntime {
  private active = false;
  private disposed = false;
  private moduleBytes: Uint8Array | undefined;
  /** 本次命令进程只保存已批准的 runtime.info 授权，dispose 时清空。 */
  private readonly grantedCapabilities = new Set<string>();

  constructor(private readonly launchConfig: ExternalExtensionWorkerLaunchConfig | undefined) {}

  async handle(value: unknown): Promise<ExternalExtensionRpcResponse | undefined> {
    const request = parseExternalExtensionRpcRequest(value);
    if (!request) {
      return undefined;
    }
    return this.handleRequest(request);
  }

  async handleRequest(request: ExternalExtensionRpcRequest): Promise<ExternalExtensionRpcResponse> {
    if (this.disposed) {
      return failure(request, 'disposed');
    }
    if (!this.launchConfig || request.pluginId !== this.launchConfig.pluginId) {
      return failure(request, 'invalid-request');
    }
    if (request.method === 'activate') {
      return this.activate(request);
    }
    if (request.method === 'dispose') {
      this.active = false;
      this.moduleBytes = undefined;
      this.grantedCapabilities.clear();
      this.disposed = true;
      return success(request, true);
    }
    if (request.method === 'cancel') {
      // 同步 WASM 计算期间 worker 无法处理消息；主进程必须直接终止 utility process。
      return success(request, true);
    }
    if (!this.active) {
      return failure(request, 'not-active');
    }
    if (request.method === 'executeCommand') {
      return this.executeCommand(request);
    }
    return failure(request, 'unsupported-method');
  }

  private async activate(
    request: Extract<ExternalExtensionRpcRequest, { method: 'activate' }>,
  ): Promise<ExternalExtensionRpcResponse> {
    if (request.payload.version !== this.launchConfig?.version) {
      return failure(request, 'invalid-request');
    }
    if (request.payload.grantedCapabilities.some(capability => capability !== 'runtime.info')) {
      return failure(request, 'permission-denied');
    }
    if (this.active) {
      const grantsMatch = request.payload.grantedCapabilities.length === this.grantedCapabilities.size
        && request.payload.grantedCapabilities.every(capability => this.grantedCapabilities.has(capability));
      return grantsMatch
        ? success(request, { ready: true, runtime: 'wasm' })
        : failure(request, 'permission-denied');
    }
    try {
      const moduleBytes = await readVerifiedWasmEntrypoint(this.launchConfig);
      this.moduleBytes = moduleBytes;
      for (const capability of request.payload.grantedCapabilities) {
        this.grantedCapabilities.add(capability);
      }
      this.active = true;
      return success(request, { ready: true, runtime: 'wasm' });
    }
    catch {
      this.moduleBytes = undefined;
      this.grantedCapabilities.clear();
      this.active = false;
      return failure(request, 'extension-failed');
    }
  }

  private executeCommand(
    request: Extract<ExternalExtensionRpcRequest, { method: 'executeCommand' }>,
  ): ExternalExtensionRpcResponse {
    if (request.payload.requiredCapabilities.some(capability => (
      capability !== 'runtime.info' || !this.grantedCapabilities.has(capability)
    ))) {
      return failure(request, 'permission-denied');
    }
    if (request.payload.requiredCapabilities.includes('runtime.info') !== (request.payload.capabilityContext !== undefined)) {
      return failure(request, 'permission-denied');
    }
    if (!this.moduleBytes) {
      return failure(request, 'not-active');
    }
    try {
      const result = executeExternalExtensionWasmCommand(
        this.moduleBytes,
        request.payload.commandId,
        request.payload.input,
        request.payload.capabilityContext,
      );
      if (!isPluginToolCommandResult(result)) {
        return failure(request, 'extension-failed');
      }
      return success(request, result);
    }
    catch (error) {
      return failure(request, mapWasmError(error));
    }
  }
}

const launchConfig = parseExternalExtensionWorkerLaunchArguments(process.argv);
const parentPort = process.parentPort;
if (parentPort) {
  const runtime = new ExternalExtensionWorkerRuntime(launchConfig);
  parentPort.on('message', event => {
    void runtime.handle(event.data).then(response => {
      if (response) {
        parentPort.postMessage(response);
      }
      if (response?.ok && isDisposeRequest(event.data)) {
        process.exit(0);
      }
    });
  });
}

async function readVerifiedWasmEntrypoint(config: ExternalExtensionWorkerLaunchConfig): Promise<Uint8Array> {
  if (!isAbsolute(config.packageRoot) || !/^[a-f0-9]{64}$/.test(config.entrypointSha256)) {
    throw new Error('The WASM launch configuration is invalid.');
  }
  const rootMetadata = await lstat(config.packageRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('The WASM package root must be a real directory.');
  }
  const packageRoot = await realpath(config.packageRoot);
  if (resolve(config.packageRoot) !== packageRoot) {
    throw new Error('The WASM package root must be canonical.');
  }
  const entrypointPath = resolve(packageRoot, ...config.entrypoint.split('/'));
  if (!isContainedPath(packageRoot, entrypointPath)) {
    throw new Error('The WASM entrypoint escaped its package root.');
  }
  const entrypointMetadata = await lstat(entrypointPath);
  if (!entrypointMetadata.isFile() || entrypointMetadata.isSymbolicLink()) {
    throw new Error('The WASM entrypoint must be a regular file.');
  }
  const canonicalEntrypoint = await realpath(entrypointPath);
  if (!isContainedPath(packageRoot, canonicalEntrypoint)
    || !entrypointMetadata.isFile()
    || entrypointMetadata.size > externalExtensionWasmLimits.maximumModuleBytes) {
    throw new Error('The WASM entrypoint is outside its package or exceeds the module limit.');
  }

  const file = await open(canonicalEntrypoint, 'r');
  let bytes: Buffer;
  try {
    const openedMetadata = await file.stat();
    if (!openedMetadata.isFile()
      || openedMetadata.dev !== entrypointMetadata.dev
      || openedMetadata.ino !== entrypointMetadata.ino) {
      throw new Error('The WASM entrypoint changed before it was read.');
    }
    const boundedBuffer = Buffer.alloc(externalExtensionWasmLimits.maximumModuleBytes + 1);
    let bytesRead = 0;
    while (bytesRead < boundedBuffer.byteLength) {
      const result = await file.read(boundedBuffer, bytesRead, boundedBuffer.byteLength - bytesRead, bytesRead);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    const finalMetadata = await file.stat();
    if (bytesRead === 0
      || bytesRead > externalExtensionWasmLimits.maximumModuleBytes
      || finalMetadata.size !== bytesRead) {
      throw new Error('The WASM entrypoint size is invalid.');
    }
    bytes = boundedBuffer.subarray(0, bytesRead);
  }
  finally {
    await file.close();
  }

  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== config.entrypointSha256) {
    throw new Error('The WASM entrypoint does not match its signed hash.');
  }
  return new Uint8Array(bytes);
}

function mapWasmError(error: unknown): WorkerFailureCode {
  if (!(error instanceof ExternalExtensionWasmError)) {
    return 'extension-failed';
  }
  return error.code === 'resource-limit' ? 'payload-too-large' : 'extension-failed';
}

function isPluginToolCommandResult(value: ExternalExtensionRpcJsonValue): value is ExternalExtensionRpcJsonValue & {
  kind: 'text' | 'json' | 'table';
  value: ExternalExtensionRpcJsonValue;
} {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'text') {
    return typeof value.value === 'string';
  }
  if (value.kind === 'json') {
    return isJsonValue(value.value);
  }
  if (value.kind !== 'table' || !isRecord(value.value)) {
    return false;
  }
  return isJsonValue(value.value);
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
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(item => isJsonValue(item, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function success(request: ExternalExtensionRpcRequest, result: ExternalExtensionRpcJsonValue): ExternalExtensionRpcResponse {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    pluginId: request.pluginId,
    ok: true,
    result,
  };
}

function failure(request: ExternalExtensionRpcRequest, error: WorkerFailureCode): ExternalExtensionRpcResponse {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    pluginId: request.pluginId,
    ok: false,
    error,
  };
}

function isDisposeRequest(value: unknown): value is ExternalExtensionRpcRequest & { method: 'dispose' } {
  return isRecord(value) && value.method === 'dispose';
}
