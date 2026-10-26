import {
  isPluginSettingKey,
  isPluginSettingValue,
  pluginSettingsLimits,
} from './plugin-settings-store';
import type { PluginSettingValue } from './plugin-settings-store';

export const PLUGIN_CAPABILITY_API_PATH = '/__it_tools/v1/call';

export const pluginCapabilityLimits = Object.freeze({
  maximumRequestBytes: 16 * 1024,
  maximumResponseBytes: 16 * 1024,
  maximumClipboardTextCharacters: 16 * 1024,
  maximumSettingsKeyCharacters: pluginSettingsLimits.maximumKeyCharacters,
  maximumSettingsStringCharacters: pluginSettingsLimits.maximumStringCharacters,
  maximumRequestsPerMinute: 30,
  maximumConcurrentRequests: 4,
});

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const requestIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const supportedCapabilities = new Set(['runtime.info', 'clipboard.write', 'settings.read', 'settings.write']);

class RequestBodyTooLargeError extends Error {}

export type PluginCapability = 'runtime.info' | 'clipboard.write' | 'settings.read' | 'settings.write';

/** Return whether the current host can execute a declared plugin capability. */
export function isSupportedPluginCapability(value: string): value is PluginCapability {
  return supportedCapabilities.has(value);
}

/** Keep package declarations compatible with the capability API exposed by this host. */
export function filterSupportedPluginCapabilities(
  capabilities: readonly string[],
): PluginCapability[] {
  return capabilities.filter(isSupportedPluginCapability);
}

export type PluginCapabilityCall =
  | { id: string; capability: 'runtime.info'; operation: 'read'; input: Record<string, never> }
  | { id: string; capability: 'clipboard.write'; operation: 'writeText'; input: { text: string } }
  | { id: string; capability: 'settings.read'; operation: 'get'; input: { key: string } }
  | { id: string; capability: 'settings.write'; operation: 'set'; input: { key: string; value: PluginSettingValue } }
  | { id: string; capability: 'settings.write'; operation: 'delete'; input: { key: string } };

export type PluginCapabilityExecutor = (call: PluginCapabilityCall) => Promise<unknown> | unknown;

export interface PluginCapabilityBrokerOptions {
  pluginId: string;
  requestedCapabilities: readonly string[];
  grantedCapabilities: readonly string[];
  execute: PluginCapabilityExecutor;
  now?: () => number;
}

export interface PluginCapabilityBroker {
  handle(request: Request): Promise<Response>;
  revoke(): void;
}

type ElectronProtocolRequest = Request & { initiatorOrigin?: string | null };

/** Bind capability execution to one plugin origin and one host-approved grant set. */
export function createPluginCapabilityBroker(options: PluginCapabilityBrokerOptions): PluginCapabilityBroker {
  if (!pluginIdPattern.test(options.pluginId) || options.pluginId.length > 128) {
    throw new Error('The plugin ID is invalid for capability requests.');
  }
  if (typeof options.execute !== 'function') {
    throw new Error('The plugin capability executor is required.');
  }

  const requested = new Set(options.requestedCapabilities);
  const granted = new Set(options.grantedCapabilities);
  if ([...requested].some(capability => !isSupportedPluginCapability(capability))) {
    throw new Error('The plugin requested a capability that this host API does not support.');
  }
  if ([...granted].some(capability => !requested.has(capability) || !isSupportedPluginCapability(capability))) {
    throw new Error('The host cannot grant a capability that the plugin did not request.');
  }

  const pluginOrigin = `it-plugin://${options.pluginId}`;
  const timestamps: number[] = [];
  const now = options.now ?? Date.now;
  let activeRequests = 0;
  let active = true;

  return {
    async handle(request) {
      if (!active) {
        return jsonResponse(410, { ok: false, error: 'plugin-inactive' });
      }

      const url = parseUrl(request.url);
      if (!url || url.protocol !== 'it-plugin:' || url.hostname !== options.pluginId || url.pathname !== PLUGIN_CAPABILITY_API_PATH) {
        return jsonResponse(404, { ok: false, error: 'not-found' });
      }
      if (request.method !== 'POST') {
        return jsonResponse(405, { ok: false, error: 'method-not-allowed' }, { Allow: 'POST' });
      }

      const protocolRequest = request as ElectronProtocolRequest;
      if (protocolRequest.initiatorOrigin !== pluginOrigin) {
        return jsonResponse(403, { ok: false, error: 'untrusted-initiator' });
      }
      const originHeader = request.headers.get('origin');
      if (originHeader !== null && originHeader !== 'null' && originHeader !== pluginOrigin) {
        return jsonResponse(403, { ok: false, error: 'untrusted-origin-header' });
      }
      if (!isJsonContentType(request.headers.get('content-type'))) {
        return jsonResponse(415, { ok: false, error: 'content-type-required' });
      }
      if (hasOversizedContentLength(request.headers.get('content-length'))) {
        return jsonResponse(413, { ok: false, error: 'request-too-large' });
      }

      const timestamp = now();
      while (timestamps.length > 0 && timestamp - timestamps[0]! >= 60_000) {
        timestamps.shift();
      }
      if (timestamps.length >= pluginCapabilityLimits.maximumRequestsPerMinute) {
        return jsonResponse(429, { ok: false, error: 'rate-limit-exceeded' });
      }
      if (activeRequests >= pluginCapabilityLimits.maximumConcurrentRequests) {
        return jsonResponse(429, { ok: false, error: 'too-many-requests' });
      }
      timestamps.push(timestamp);
      activeRequests += 1;

      try {
        let bytes: Uint8Array;
        try {
          bytes = await readBoundedBody(request, pluginCapabilityLimits.maximumRequestBytes);
        }
        catch (error) {
          if (error instanceof RequestBodyTooLargeError) {
            return jsonResponse(413, { ok: false, error: 'request-too-large' });
          }
          throw error;
        }
        const call = parseCapabilityCall(bytes);
        if (!call) {
          return jsonResponse(400, { ok: false, error: 'invalid-request' });
        }
        if (!requested.has(call.capability)) {
          return jsonResponse(403, { id: call.id, ok: false, error: 'capability-not-requested' });
        }
        if (!granted.has(call.capability)) {
          return jsonResponse(403, { id: call.id, ok: false, error: 'permission-denied' });
        }

        const result = await options.execute(call);
        if (!active) {
          return jsonResponse(410, { id: call.id, ok: false, error: 'plugin-inactive' });
        }
        const serializedResult = JSON.stringify(result);
        if (serializedResult === undefined) {
          return jsonResponse(500, { id: call.id, ok: false, error: 'response-too-large' });
        }
        const serializedResponse = JSON.stringify({
          id: call.id,
          ok: true,
          result: JSON.parse(serializedResult) as unknown,
        });
        if (Buffer.byteLength(serializedResponse, 'utf8') > pluginCapabilityLimits.maximumResponseBytes) {
          return jsonResponse(500, { id: call.id, ok: false, error: 'response-too-large' });
        }
        return jsonResponseBody(200, serializedResponse);
      }
      catch {
        return jsonResponse(500, { ok: false, error: active ? 'capability-failed' : 'plugin-inactive' });
      }
      finally {
        activeRequests -= 1;
      }
    },
    revoke() {
      active = false;
      granted.clear();
    },
  };
}

function parseCapabilityCall(bytes: Uint8Array): PluginCapabilityCall | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  }
  catch {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'capability', 'operation', 'input'])) {
    return null;
  }
  if (typeof value.id !== 'string' || !requestIdPattern.test(value.id) || !isRecord(value.input)) {
    return null;
  }

  if (value.capability === 'runtime.info' && value.operation === 'read' && hasExactKeys(value.input, [])) {
    return { id: value.id, capability: 'runtime.info', operation: 'read', input: {} };
  }
  if (
    value.capability === 'clipboard.write'
    && value.operation === 'writeText'
    && hasExactKeys(value.input, ['text'])
    && typeof value.input.text === 'string'
    && value.input.text.length <= pluginCapabilityLimits.maximumClipboardTextCharacters
  ) {
    return {
      id: value.id,
      capability: 'clipboard.write',
      operation: 'writeText',
      input: { text: value.input.text },
    };
  }
  if (
    value.capability === 'settings.read'
    && value.operation === 'get'
    && hasExactKeys(value.input, ['key'])
    && isPluginSettingKey(value.input.key)
  ) {
    return {
      id: value.id,
      capability: 'settings.read',
      operation: 'get',
      input: { key: value.input.key },
    };
  }
  if (
    value.capability === 'settings.write'
    && value.operation === 'set'
    && hasExactKeys(value.input, ['key', 'value'])
    && isPluginSettingKey(value.input.key)
    && isPluginSettingValue(value.input.value)
  ) {
    return {
      id: value.id,
      capability: 'settings.write',
      operation: 'set',
      input: { key: value.input.key, value: value.input.value },
    };
  }
  if (
    value.capability === 'settings.write'
    && value.operation === 'delete'
    && hasExactKeys(value.input, ['key'])
    && isPluginSettingKey(value.input.key)
  ) {
    return {
      id: value.id,
      capability: 'settings.write',
      operation: 'delete',
      input: { key: value.input.key },
    };
  }
  return null;
}

async function readBoundedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError('The plugin capability request exceeds its body limit.');
      }
      chunks.push(value);
    }
  }
  finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function jsonResponse(status: number, value: unknown, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponseBody(status, JSON.stringify(value), extraHeaders);
}

function jsonResponseBody(status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...extraHeaders,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function hasOversizedContentLength(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  if (!/^\d+$/.test(value)) {
    return true;
  }
  const length = Number(value);
  return !Number.isSafeInteger(length) || length > pluginCapabilityLimits.maximumRequestBytes;
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function parseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  }
  catch {
    return null;
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
