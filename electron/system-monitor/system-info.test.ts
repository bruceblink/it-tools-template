import { describe, expect, it } from 'vitest';
import {
  normalizeDiskSnapshot,
  normalizeNetworkSnapshot,
} from './system-info';

describe('system monitor storage and network normalization', () => {
  it('bounds disk rows and preserves capacity and aggregate rates', () => {
    const snapshot = normalizeDiskSnapshot([
      {
        fs: 'C:',
        type: 'NTFS',
        size: 1_000,
        used: 250,
        available: 750,
        use: 25,
        mount: 'C:\\',
      },
    ], { rx_sec: 1_024, wx_sec: 2_048 });

    expect(snapshot.status).toBe('ok');
    expect(snapshot.filesystems).toMatchObject([{
      id: 'C:\\|C:',
      sizeBytes: 1_000,
      usedBytes: 250,
      availableBytes: 750,
      usedPercent: { value: 25, unit: 'percent', status: 'ok' },
    }]);
    expect(snapshot.readBytesPerSecond.value).toBe(1_024);
    expect(snapshot.writeBytesPerSecond.value).toBe(2_048);
    expect(snapshot.truncated).toBe(false);
  });

  it('marks invalid disk values and caps the filesystem list', () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({
      fs: `fs-${index}`,
      type: 'unknown',
      size: 100,
      used: 200,
      available: -1,
      use: Number.NaN,
      mount: `/mnt/${index}`,
    }));
    const snapshot = normalizeDiskSnapshot(rows, null);

    expect(snapshot.filesystems).toHaveLength(64);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.status).toBe('failed');
    expect(snapshot.filesystems[0]?.status).toBe('failed');
    expect(snapshot.filesystems[0]?.usedPercent.value).toBeNull();
  });

  it('bounds network interfaces and rejects invalid rates', () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({
      iface: `eth-${index}`,
      operstate: 'up',
      rx_bytes: index * 100,
      tx_bytes: index * 200,
      rx_sec: index === 0 ? Number.NaN : 100,
      tx_sec: 200,
    }));
    const snapshot = normalizeNetworkSnapshot(rows);

    expect(snapshot.interfaces).toHaveLength(64);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.status).toBe('failed');
    expect(snapshot.receivedBytesPerSecond.value).toBeNull();
    expect(snapshot.interfaces[0]?.status).toBe('failed');
    expect(snapshot.interfaces[1]?.receivedBytesPerSecond.value).toBe(100);
  });
});
