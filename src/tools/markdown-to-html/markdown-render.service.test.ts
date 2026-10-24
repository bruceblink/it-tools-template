import { describe, expect, it } from 'vitest';
import { executeMarkdownRenderTask } from './markdown-render.service';
import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest } from '@/task-runner/task-runner.types';

function createRequest(value: string, maxOutputBytes = taskLimits.markdownRender.maxOutputBytes): WorkerRequest {
  return {
    id: 1,
    inputVersion: 3,
    task: { kind: 'markdown-render', value },
    maxOutputBytes,
  };
}

describe('executeMarkdownRenderTask', () => {
  it('preserves Markdown output and escapes raw HTML', () => {
    const response = executeMarkdownRenderTask(createRequest('# Title\n\n**bold** <script>alert(1)</script>'));

    expect(response).toMatchObject({
      id: 1,
      inputVersion: 3,
      ok: true,
      result: {
        kind: 'markdown-render',
        output: '<h1>Title</h1>\n<p><strong>bold</strong> &lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
      },
    });
  });

  it('rejects input above the UTF-8 byte limit', () => {
    const response = executeMarkdownRenderTask(createRequest('x'.repeat(taskLimits.markdownRender.maxInputBytes + 1)));

    expect(response).toMatchObject({ ok: false, code: 'input-limit' });
  });

  it('rejects rendered output above the response budget', () => {
    const response = executeMarkdownRenderTask(createRequest('# Title', 1));

    expect(response).toMatchObject({ ok: false, code: 'output-limit' });
  });

  it('counts UTF-8 bytes rather than JavaScript code units', () => {
    const value = '🙂'.repeat(Math.ceil(taskLimits.markdownRender.maxInputBytes / 4));
    const response = executeMarkdownRenderTask(createRequest(value));

    expect(response).toMatchObject({ ok: true, result: { kind: 'markdown-render' } });
  });
});
