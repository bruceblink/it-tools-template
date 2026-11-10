export interface ExternalPluginV2CommandIdentity {
  readonly pluginId: string;
  readonly version: string;
}

export interface ActiveExternalPluginV2Command extends ExternalPluginV2CommandIdentity {
  readonly controller: AbortController;
}

/** 跟踪 v2 命令请求，使取消、卸载和窗口关闭可以撤销对应执行。 */
export class ExternalPluginV2CommandRequests {
  private readonly active = new Map<string, ActiveExternalPluginV2Command>();

  register(requestId: string, identity: ExternalPluginV2CommandIdentity): ActiveExternalPluginV2Command | undefined {
    if (this.active.has(requestId)) {
      return undefined;
    }
    const request = {
      pluginId: identity.pluginId,
      version: identity.version,
      controller: new AbortController(),
    };
    this.active.set(requestId, request);
    return request;
  }

  cancel(requestId: string): boolean {
    const request = this.active.get(requestId);
    if (!request) {
      return false;
    }
    request.controller.abort();
    return true;
  }

  abortPackage(pluginId: string, version: string): void {
    this.abortWhere(request => request.pluginId === pluginId && request.version === version);
  }

  abortAll(): void {
    this.abortWhere(() => true);
  }

  release(requestId: string, request: ActiveExternalPluginV2Command): void {
    if (this.active.get(requestId) === request) {
      this.active.delete(requestId);
    }
  }

  private abortWhere(predicate: (request: ActiveExternalPluginV2Command) => boolean): void {
    for (const request of this.active.values()) {
      if (predicate(request)) {
        request.controller.abort();
      }
    }
  }
}
