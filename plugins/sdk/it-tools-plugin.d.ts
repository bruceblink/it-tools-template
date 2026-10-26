export interface PluginRuntimeInfo {
  readonly platform: string;
  readonly version: string;
}

export interface PluginClipboardWriteResult {
  readonly written: true;
}

export type PluginSettingValue = string | number | boolean | null;

export interface PluginSettingWriteResult {
  readonly written: true;
}

export interface PluginSettingDeleteResult {
  readonly deleted: boolean;
}

export type PluginApiErrorCode =
  | 'invalid-input'
  | 'transport-error'
  | 'invalid-response'
  | 'request-failed'
  | 'not-found'
  | 'method-not-allowed'
  | 'untrusted-initiator'
  | 'untrusted-origin-header'
  | 'plugin-inactive'
  | 'content-type-required'
  | 'request-too-large'
  | 'rate-limit-exceeded'
  | 'too-many-requests'
  | 'invalid-request'
  | 'capability-not-requested'
  | 'permission-denied'
  | 'capability-failed'
  | 'response-too-large';

export class PluginApiError extends Error {
  readonly code: PluginApiErrorCode;
  readonly status: number;
}

export interface ITToolsPluginApiV1 {
  readonly apiVersion: '1.1.0';
  readonly hostApiVersion: '1.3.0';
  readonly capabilities: {
    readonly runtime: {
      getInfo(): Promise<PluginRuntimeInfo>;
    };
    readonly clipboard: {
      writeText(text: string): Promise<PluginClipboardWriteResult>;
    };
    readonly settings: {
      get(key: string): Promise<PluginSettingValue | undefined>;
      set(key: string, value: PluginSettingValue): Promise<PluginSettingWriteResult>;
      delete(key: string): Promise<PluginSettingDeleteResult>;
    };
  };
  readonly PluginApiError: typeof PluginApiError;
}

declare global {
  interface Window {
    readonly itTools: ITToolsPluginApiV1;
  }
}

export {};
