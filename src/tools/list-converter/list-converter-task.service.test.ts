import { describe, expect, it, vi } from 'vitest';
import { taskLimits } from '@/task-runner/task-runner.types';
import { createDefaultConvertOptions } from './list-converter.types';
import { convert } from './list-converter.models';
import { executeListConverterTask } from './list-converter-task.service';

function createRequest(value: string, options = createDefaultConvertOptions(), maxOutputBytes = taskLimits.listConverter.maxOutputBytes) {
  return {
    id: 4,
    inputVersion: 7,
    task: { kind: 'list-convert' as const, value, options },
    maxOutputBytes,
  };
}

describe('List Converter task service', () => {
  it('preserves sorting, trimming, duplicate removal, wrapping, and line breaks', () => {
    const options = {
      ...createDefaultConvertOptions(),
      itemPrefix: '<li>',
      itemSuffix: '</li>',
      listPrefix: '<ul>',
      listSuffix: '</ul>',
      keepLineBreaks: true,
      sortList: 'asc' as const,
      separator: '',
    };
    expect(executeListConverterTask(createRequest('b\na\nb', options))).toEqual({
      id: 4,
      inputVersion: 7,
      ok: true,
      result: {
        kind: 'list-convert',
        valid: true,
        output: '<ul>\n<li>a</li>\n<li>b</li>\n</ul>',
      },
    });
  });

  it('rejects input above the byte and line limits', () => {
    expect(executeListConverterTask(createRequest('x'.repeat(taskLimits.listConverter.maxInputBytes + 1)))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
    expect(executeListConverterTask(createRequest('x\n'.repeat(taskLimits.listConverter.maxLines)))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
  });

  it('rejects wrapper expansion before allocating the converted output', () => {
    const converter = vi.fn(convert);
    const options = { ...createDefaultConvertOptions(), itemPrefix: 'x'.repeat(300_000) };
    const result = executeListConverterTask(createRequest('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', options), converter);

    expect(result).toMatchObject({ ok: false, code: 'output-limit' });
    expect(converter).not.toHaveBeenCalled();
  });

  it('enforces both the requested output limit and the host ceiling', () => {
    expect(executeListConverterTask(createRequest('one', createDefaultConvertOptions(), 1))).toMatchObject({
      ok: false,
      code: 'output-limit',
    });

    const oversizedConverter: typeof convert = () => 'x'.repeat(taskLimits.listConverter.maxOutputBytes);
    expect(executeListConverterTask(
      createRequest('one', createDefaultConvertOptions(), taskLimits.listConverter.maxOutputBytes + 1),
      oversizedConverter,
    )).toMatchObject({ ok: false, code: 'output-limit' });
  });

  it('rejects task kinds that are not supported by this Worker', () => {
    const request = { ...createRequest('one'), task: { kind: 'json-minify' as const, value: '{}' } };
    expect(executeListConverterTask(request)).toMatchObject({ ok: false, code: 'error' });
  });
});
