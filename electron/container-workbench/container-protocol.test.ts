import { describe, expect, it } from 'vitest';
import { CONTAINER_MAX_ITEMS, CONTAINER_MAX_OUTPUT_BYTES } from '../../src/shared/desktop-services/container-workbench';
import { parseContainerListRequest, parseDockerContainerList } from './container-protocol';

describe('container workbench protocol', () => {
  it('accepts only a version 4 request identifier', () => {
    expect(parseContainerListRequest({ requestId: '123e4567-e89b-42d3-a456-426614174000' })).toEqual({
      requestId: '123e4567-e89b-42d3-a456-426614174000',
    });
    expect(parseContainerListRequest({ requestId: 'x', containerId: '0123456789ab' })).toBeNull();
    expect(parseContainerListRequest({ requestId: '123e4567-e89b-12d3-a456-426614174000' })).toBeNull();
  });

  it('parses only the approved metadata fields and maps future states safely', () => {
    expect(
      parseDockerContainerList(
        [
          '0123456789ab|api|example/api:1|running|Up 2 minutes|127.0.0.1:8080->80/tcp',
          'abcdef012345|worker|example/worker:1|future-state|Exited (0)|',
        ].join('\n'),
      ),
    ).toEqual([
      {
        id: '0123456789ab',
        name: 'api',
        image: 'example/api:1',
        state: 'running',
        status: 'Up 2 minutes',
        ports: '127.0.0.1:8080->80/tcp',
      },
      {
        id: 'abcdef012345',
        name: 'worker',
        image: 'example/worker:1',
        state: 'unknown',
        status: 'Exited (0)',
        ports: '',
      },
    ]);
  });

  it('rejects malformed rows, control characters, oversized output, and excessive records', () => {
    expect(parseDockerContainerList('0123456789ab|api|example/api:1|running|Up|80/tcp|extra')).toBeNull();
    expect(parseDockerContainerList('0123456789ab|api\t|example/api:1|running|Up|80/tcp')).toBeNull();
    expect(parseDockerContainerList('x'.repeat(CONTAINER_MAX_OUTPUT_BYTES + 1))).toBeNull();
    const excessive = Array.from({ length: CONTAINER_MAX_ITEMS + 1 }, (_, index) =>
      `${index.toString(16).padStart(12, '0')}|api|example/api:1|running|Up|`,
    ).join('\n');
    expect(parseDockerContainerList(excessive)).toBeNull();
  });
});
