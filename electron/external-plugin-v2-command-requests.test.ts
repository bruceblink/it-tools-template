import { describe, expect, it } from 'vitest';
import { ExternalPluginV2CommandRequests } from './external-plugin-v2-command-requests';

describe('ExternalPluginV2CommandRequests', () => {
  it('cancels only an active request and releases it after completion', () => {
    const requests = new ExternalPluginV2CommandRequests();
    const identity = { pluginId: 'org.example.demo', version: '1.0.0', input: { secret: 'never retain' } };
    const active = requests.register('request-1', identity);

    expect(active).toBeDefined();
    expect(active).not.toHaveProperty('input');
    expect(requests.register('request-1', { pluginId: 'org.example.demo', version: '1.0.0' })).toBeUndefined();
    expect(requests.cancel('request-1')).toBe(true);
    expect(active!.controller.signal.aborted).toBe(true);

    requests.release('request-1', active!);
    expect(requests.cancel('request-1')).toBe(false);
  });

  it('aborts one package or all active requests without affecting other packages', () => {
    const requests = new ExternalPluginV2CommandRequests();
    const first = requests.register('request-1', { pluginId: 'org.example.demo', version: '1.0.0' })!;
    const second = requests.register('request-2', { pluginId: 'org.example.demo', version: '2.0.0' })!;
    const other = requests.register('request-3', { pluginId: 'org.example.other', version: '1.0.0' })!;

    requests.abortPackage('org.example.demo', '1.0.0');
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(false);
    expect(other.controller.signal.aborted).toBe(false);

    requests.abortAll();
    expect(second.controller.signal.aborted).toBe(true);
    expect(other.controller.signal.aborted).toBe(true);

    requests.release('request-1', first);
    requests.release('request-2', second);
    requests.release('request-3', other);
    expect(requests.cancel('request-1')).toBe(false);
  });
});
