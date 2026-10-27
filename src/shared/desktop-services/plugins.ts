/** Stable error codes returned by the trusted desktop plugin bridge. */
export const desktopPluginErrorCodes = Object.freeze([
  'invalid-package',
  'invalid-archive',
  'unsafe-archive-entry',
  'resource-limit',
  'untrusted-signature',
  'file-hash-mismatch',
  'already-installed',
  'not-installed',
  'active-limit',
  'contribution-not-found',
  'unsupported-capability',
  'activation-failed',
  'activation-rollback-failed',
  'window-close-timeout',
  'store-unavailable',
  'invalid-store',
  'invalid-key',
  'already-trusted',
  'trust-confirmation-required',
  'trust-key-not-found',
  'invalid-request',
  'untrusted-renderer',
  'window-unavailable',
  'operation-failed',
] as const);

export type DesktopPluginErrorCode = typeof desktopPluginErrorCodes[number];

/** Runtime failure codes attached to an installed package or tool contribution snapshot. */
export const desktopPluginRuntimeFailureCodes = Object.freeze([
  'renderer-crashed',
  'renderer-unresponsive',
  'window-closed',
] as const);

export type DesktopPluginRuntimeFailureCode = typeof desktopPluginRuntimeFailureCodes[number];

/** Result envelope shared by every renderer-facing plugin management operation. */
export type DesktopPluginOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopPluginErrorCode };
