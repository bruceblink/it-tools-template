import { pluginSettingsLimits } from './plugin-settings-store';

export const pluginRendererApiVersion = '1.2.0';
export const pluginHostApiVersion = '1.3.0';
export const pluginApiMaximumClipboardTextCharacters = 16_384;

/** Install the stable renderer client without exposing preload or Node APIs. */
export function getPluginApiV1Script(): string {
  return `(() => {
  const globalName = 'itTools';
  if (Object.prototype.hasOwnProperty.call(globalThis, globalName)) {
    throw new Error('The IT Tools plugin API global is already defined.');
  }

  const apiEndpoint = '/__it_tools/v1/call';
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const maximumClipboardTextCharacters = ${pluginApiMaximumClipboardTextCharacters};
  const maximumSettingsKeyCharacters = ${pluginSettingsLimits.maximumKeyCharacters};
  const maximumSettingsStringCharacters = ${pluginSettingsLimits.maximumStringCharacters};
  const settingKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  const errorCodePattern = /^[a-z0-9-]{1,64}$/;
  let requestSequence = 0;

  function getToolId() {
    const hash = typeof globalThis.location?.hash === 'string' ? globalThis.location.hash : '';
    if (!hash.startsWith('#tool=')) {
      return undefined;
    }
    try {
      const value = decodeURIComponent(hash.slice('#tool='.length));
      return value.length > 0 ? value : undefined;
    }
    catch {
      return undefined;
    }
  }

  class PluginApiError extends Error {
    constructor(code, status) {
      super(code);
      this.name = 'PluginApiError';
      this.code = code;
      this.status = status;
    }
  }

  async function request(capability, operation, input) {
    const id = 'plugin-api-' + (++requestSequence).toString(36);
    let response;
    try {
      response = await nativeFetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, capability, operation, input }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
    }
    catch {
      throw new PluginApiError('transport-error', 0);
    }

    let payload;
    try {
      payload = await response.json();
    }
    catch {
      throw new PluginApiError('invalid-response', response.status);
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
      || (payload.id !== undefined && payload.id !== id)) {
      throw new PluginApiError('invalid-response', response.status);
    }
    if (!response.ok || payload.ok !== true) {
      const code = typeof payload.error === 'string' && errorCodePattern.test(payload.error)
        ? payload.error
        : 'request-failed';
      throw new PluginApiError(code, response.status);
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
      throw new PluginApiError('invalid-response', response.status);
    }
    return payload.result;
  }

  Object.freeze(PluginApiError.prototype);
  Object.freeze(PluginApiError);
  const capabilities = Object.freeze({
    runtime: Object.freeze({
      getInfo: () => request('runtime.info', 'read', {}),
    }),
    clipboard: Object.freeze({
      writeText(text) {
        if (typeof text !== 'string' || text.length > maximumClipboardTextCharacters) {
          return Promise.reject(new PluginApiError('invalid-input', 0));
        }
        return request('clipboard.write', 'writeText', { text });
      },
    }),
    settings: Object.freeze({
      get(key) {
        if (typeof key !== 'string' || key.length > maximumSettingsKeyCharacters || !settingKeyPattern.test(key)) {
          return Promise.reject(new PluginApiError('invalid-input', 0));
        }
        return request('settings.read', 'get', { key }).then((result) => {
          if (typeof result !== 'object' || result === null || Array.isArray(result) || typeof result.found !== 'boolean') {
            throw new PluginApiError('invalid-response', 200);
          }
          return result.found ? result.value : undefined;
        });
      },
      set(key, value) {
        if (
          typeof key !== 'string'
          || key.length > maximumSettingsKeyCharacters
          || !settingKeyPattern.test(key)
          || !isValidSettingValue(value, maximumSettingsStringCharacters)
        ) {
          return Promise.reject(new PluginApiError('invalid-input', 0));
        }
        return request('settings.write', 'set', { key, value });
      },
      delete(key) {
        if (typeof key !== 'string' || key.length > maximumSettingsKeyCharacters || !settingKeyPattern.test(key)) {
          return Promise.reject(new PluginApiError('invalid-input', 0));
        }
        return request('settings.write', 'delete', { key });
      },
    }),
  });
  const api = Object.freeze({
    apiVersion: '${pluginRendererApiVersion}',
    hostApiVersion: '${pluginHostApiVersion}',
    toolId: getToolId(),
    capabilities,
    PluginApiError,
  });
  Object.defineProperty(globalThis, globalName, {
    value: api,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  function isValidSettingValue(value, maximumStringLength) {
    return value === null
      || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && value.length <= maximumStringLength);
  }
})();`;
}
