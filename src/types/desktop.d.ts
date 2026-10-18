export {};

declare global {
  type DesktopPluginCapability = 'runtime.info' | 'clipboard.write';
  type DesktopPluginOperationResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

  interface DesktopPluginSnapshot {
    pluginId: string;
    name: string;
    version: string;
    requestedCapabilities: readonly string[];
    grantedCapabilities: readonly DesktopPluginCapability[];
    status: 'installed' | 'active' | 'invalid';
    errorCode?: string;
  }

  interface DesktopPluginSignerSnapshot {
    keyId: string;
    fingerprint: string;
    allowedPluginIds: readonly string[];
  }

  interface DesktopPluginSignerInput {
    keyId: string;
    publicKey: string;
    allowedPluginIds: readonly string[];
  }

  interface Window {
    itToolsDesktop?: {
      getRuntimeInfo(): Promise<{
        platform: string;
        version: string;
      }>;
      listPlugins?(): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot[]>>;
      installPluginPackage?(): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot | null>>;
      activatePlugin?(
        pluginId: string,
        version: string,
        grantedCapabilities: readonly DesktopPluginCapability[],
      ): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot | null>>;
      disablePlugin?(pluginId: string): Promise<DesktopPluginOperationResult<boolean>>;
      uninstallPlugin?(pluginId: string, version: string): Promise<DesktopPluginOperationResult<boolean>>;
      listTrustedPluginSigners?(): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot[]>>;
      previewPluginSigner?(input: DesktopPluginSignerInput): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot>>;
      trustPluginSigner?(
        input: DesktopPluginSignerInput,
        confirmedFingerprint: string,
      ): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot | null>>;
      revokePluginSigner?(keyId: string): Promise<DesktopPluginOperationResult<boolean>>;
    };
  }
}
