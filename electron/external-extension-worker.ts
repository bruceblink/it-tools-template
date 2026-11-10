import {
  parseExternalExtensionRpcRequest,
  type ExternalExtensionRpcJsonValue,
  type ExternalExtensionRpcRequest,
  type ExternalExtensionRpcResponse,
} from '../src/shared/desktop-services/external-extension-rpc';

const parentPort = process.parentPort;
let pluginId: string | undefined;
let active = false;
let disposed = false;

if (!parentPort) {
  process.exit(1);
}

/** 只提供进程生命周期和协议握手骨架；真正的插件执行器由后续包运行时接入。 */
parentPort.on('message', (event) => {
  void handleMessage(event.data);
});

async function handleMessage(value: unknown): Promise<void> {
  const request = parseExternalExtensionRpcRequest(value);
  if (!request) {
    return;
  }
  const response = handleRequest(request);
  parentPort?.postMessage(response);
  if (request.method === 'dispose') {
    process.exit(0);
  }
}

function handleRequest(request: ExternalExtensionRpcRequest): ExternalExtensionRpcResponse {
  if (disposed) {
    return failure(request, 'disposed');
  }
  if (pluginId !== undefined && request.pluginId !== pluginId) {
    return failure(request, 'invalid-request');
  }
  if (request.method === 'activate') {
    pluginId = request.pluginId;
    active = true;
    return success(request, { ready: true, runtime: 'isolated-utility-process' });
  }
  if (request.method === 'dispose') {
    active = false;
    disposed = true;
    return success(request, true);
  }
  if (request.method === 'cancel') {
    return success(request, true);
  }
  if (!active) {
    return failure(request, 'not-active');
  }
  return failure(request, 'extension-failed');
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

function failure(request: ExternalExtensionRpcRequest, error: 'invalid-request' | 'not-active' | 'extension-failed' | 'disposed'): ExternalExtensionRpcResponse {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    pluginId: request.pluginId,
    ok: false,
    error,
  };
}
