import type {
  DesktopPluginMarketplaceInstallInput,
  DesktopPluginMarketplaceInstallProgress,
} from '../src/shared/desktop-services/plugins';
import {
  installPluginMarketplaceRelease,
  PluginMarketplaceInstallError,
  type PluginMarketplaceInstallDependencies,
  type PluginMarketplaceInstallResult,
  type PluginMarketplaceRepositoryInput,
} from './plugin-marketplace-installer';

interface ActiveInstallation<TSnapshot> {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly operation: Promise<PluginMarketplaceInstallResult<TSnapshot>>;
}

export interface PluginMarketplaceInstallControllerDependencies<TSnapshot>
  extends Omit<PluginMarketplaceInstallDependencies<TSnapshot>, 'signal' | 'onProgress'> {}

/** Owns one marketplace install at a time and provides a narrow cancellation boundary. */
export class PluginMarketplaceInstallController<TSnapshot> {
  private active: ActiveInstallation<TSnapshot> | undefined;

  constructor(private readonly dependencies: PluginMarketplaceInstallControllerDependencies<TSnapshot>) {}

  start(
    input: DesktopPluginMarketplaceInstallInput,
    onProgress: (progress: DesktopPluginMarketplaceInstallProgress) => void,
  ): Promise<PluginMarketplaceInstallResult<TSnapshot>> {
    if (this.active) {
      throw new PluginMarketplaceInstallError('marketplace-busy', 'Another plugin marketplace installation is already running.');
    }
    const controller = new AbortController();
    const emit = (progress: Omit<DesktopPluginMarketplaceInstallProgress, 'requestId'>) => {
      try {
        onProgress({ requestId: input.requestId, ...progress });
      }
      catch {
        // Renderer notification failure must not turn a valid installation into an error.
      }
    };
    const repository: PluginMarketplaceRepositoryInput = { owner: input.owner, name: input.name };
    const operation = installPluginMarketplaceRelease(repository, {
      ...this.dependencies,
      signal: controller.signal,
      onProgress: emit,
    });
    const tracked: ActiveInstallation<TSnapshot> = {
      requestId: input.requestId,
      controller,
      operation: operation
        .catch((error) => {
          if (error instanceof PluginMarketplaceInstallError && error.code === 'marketplace-cancelled') {
            emit({ phase: 'cancelled' });
          }
          throw error;
        })
        .finally(() => {
          if (this.active === tracked) {
            this.active = undefined;
          }
        }),
    };
    this.active = tracked;
    return tracked.operation;
  }

  cancel(requestId: string): boolean {
    if (!this.active || this.active.requestId !== requestId) {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  async dispose(): Promise<void> {
    const active = this.active;
    if (!active) {
      return;
    }
    active.controller.abort();
    await active.operation.catch(() => {});
  }
}
