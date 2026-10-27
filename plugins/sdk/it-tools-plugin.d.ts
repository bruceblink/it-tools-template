import type {
  PluginCapabilityId,
  PluginHostCapability,
} from './plugin-capabilities';
import type { PluginApiV1Version } from './plugin-api-version';
import type {
  PluginToolCapability,
  PluginToolDataProcessing,
  PluginToolOfflineSupport,
} from './it-tools-plugin-package';

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

/** Read-only capability metadata for rendering plugin permission state. */
export interface PluginPermissionSnapshot {
  /** Capabilities declared by the signed package manifest. */
  readonly requestedCapabilities: readonly PluginCapabilityId[];
  /** Capabilities executable by this host implementation. */
  readonly supportedCapabilities: readonly PluginHostCapability[];
  /** Capabilities granted to this isolated window for its current launch. */
  readonly grantedCapabilities: readonly PluginHostCapability[];
}

/** Signed metadata for the tool contribution that selected this plugin window. */
export interface PluginToolContext {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly dataProcessing: PluginToolDataProcessing;
  readonly offline: PluginToolOfflineSupport;
  readonly capabilities: readonly PluginToolCapability[];
}

export interface ITToolsPluginApiV1 {
  readonly apiVersion: PluginApiV1Version;
  readonly hostApiVersion: PluginApiV1Version;
  /** The host-verified contribution ID selected when this plugin window was opened. */
  readonly toolId: string | undefined;
  /** The host-verified contribution metadata selected when this plugin window was opened. */
  readonly tool: PluginToolContext | undefined;
  /** Capability metadata only; this object never grants or revokes a capability. */
  readonly permissions: PluginPermissionSnapshot;
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
