import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  getPluginWorkerGuardScript,
  injectPluginWorkerGuard,
  pluginWorkerConcurrencyLimit,
  pluginWorkerLifetimeMs,
} from './plugin-worker-guard';

class TestWorker extends EventTarget {
  terminated = false;

  constructor(readonly url: string) {
    super();
  }

  terminate(): void {
    this.terminated = true;
  }
}

class TestSharedWorker {}

class TestServiceWorkerContainer {
  register(): Promise<void> {
    return Promise.resolve();
  }
}

describe('plugin worker guard', () => {
  it('injects the host script before plugin code and removes response-policy meta tags', () => {
    const original = '\uFEFF<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="worker-src \'self\'"><script src="/plugin.js"></script></head></html>';
    const transformed = injectPluginWorkerGuard(original, '/__it_tools/v1/call?__it_tools_internal=plugin-bootstrap');

    expect(transformed).toContain('<!doctype html><script src="/__it_tools/v1/call?__it_tools_internal=plugin-bootstrap"></script>');
    expect(transformed).not.toContain('http-equiv');
    expect(transformed.indexOf('__it_tools_internal=plugin-bootstrap')).toBeLessThan(transformed.indexOf('/plugin.js'));
    expect(original).toContain('http-equiv');
  });

  it('skips meta-like text in comments and script bodies while removing http-equiv tags', () => {
    const original = '<!doctype html><!-- <meta http-equiv="refresh"> --><script>const example = "<meta http-equiv=refresh>";</script><meta http-equiv=refresh content="0;url=https://example.invalid"><p>Plugin</p>';
    const transformed = injectPluginWorkerGuard(original, '/guard.js');

    expect(transformed).toContain('<!-- <meta http-equiv="refresh"> -->');
    expect(transformed).toContain('const example = "<meta http-equiv=refresh>";');
    expect(transformed).not.toContain('content="0;url=https://example.invalid"');
    expect(transformed).toContain('<p>Plugin</p>');
  });

  it('limits workers, closes constructor escape hatches, releases slots, and expires workers', async () => {
    const timers = new Map<number, { callback: () => void; delay: number }>();
    const windowEvents = new Map<string, () => void>();
    let nextTimerId = 0;
    const context = {
      Worker: TestWorker,
      SharedWorker: TestSharedWorker,
      navigator: { serviceWorker: new TestServiceWorkerContainer() },
      setTimeout(callback: () => void, delay: number) {
        const id = ++nextTimerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id: number) {
        timers.delete(id);
      },
      addEventListener(name: string, callback: () => void) {
        windowEvents.set(name, callback);
      },
      DOMException: class TestDomException extends Error {
        constructor(message: string, name: string) {
          super(message);
          this.name = name;
        }
      },
    };
    runInNewContext(getPluginWorkerGuardScript(25), context);

    const GuardedWorker = (context as unknown as { Worker: typeof TestWorker }).Worker;
    const first = new GuardedWorker('/first.js');
    const workerConstructor = GuardedWorker.prototype.constructor as unknown as typeof TestWorker;
    const second = new workerConstructor('/second.js');
    expect(() => new GuardedWorker('/overflow.js')).toThrow(expect.objectContaining({ name: 'QuotaExceededError' }));
    expect(Object.getPrototypeOf(GuardedWorker)).toBeNull();
    expect(GuardedWorker.prototype.constructor).toBe(GuardedWorker);
    expect((context as unknown as { SharedWorker: unknown }).SharedWorker).toBeUndefined();
    await expect((context as unknown as { navigator: { serviceWorker: TestServiceWorkerContainer } }).navigator.serviceWorker.register()).rejects.toMatchObject({ name: 'NotAllowedError' });

    first.terminate();
    expect(first.terminated).toBe(true);
    const replacement = new GuardedWorker('/replacement.js');
    const secondTimer = [...timers.entries()].find(([, timer]) => timer.delay === 25);
    expect(secondTimer).toBeDefined();
    if (!secondTimer) {
      throw new Error('The worker timeout was not registered.');
    }
    timers.delete(secondTimer[0]);
    secondTimer[1].callback();
    expect(second.terminated).toBe(true);
    expect(() => new GuardedWorker('/after-timeout.js')).not.toThrow();

    windowEvents.get('pagehide')?.();
    expect(replacement.terminated).toBe(true);
    expect(pluginWorkerConcurrencyLimit).toBe(2);
    expect(pluginWorkerLifetimeMs).toBe(30_000);
  });

  it('rejects invalid worker lifetime overrides', () => {
    expect(() => getPluginWorkerGuardScript(0)).toThrow(RangeError);
    expect(() => getPluginWorkerGuardScript(60_001)).toThrow(RangeError);
  });
});
