import MarkdownIt from 'markdown-it';
import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';

const markdownRenderer = new MarkdownIt();
const textEncoder = new TextEncoder();

/** Render bounded Markdown in a dedicated Worker and keep the default escaped-HTML behavior. */
export function executeMarkdownRenderTask(request: WorkerRequest): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'markdown-render') {
    return { ...response, ok: false, code: 'error' };
  }

  if (textEncoder.encode(request.task.value).byteLength > taskLimits.markdownRender.maxInputBytes) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  try {
    const output = markdownRenderer.render(request.task.value);
    const outputLimit = Number.isSafeInteger(request.maxOutputBytes) && request.maxOutputBytes >= 0
      ? Math.min(request.maxOutputBytes, taskLimits.markdownRender.maxOutputBytes)
      : 0;
    if (textEncoder.encode(output).byteLength > outputLimit) {
      return { ...response, ok: false, code: 'output-limit' };
    }

    return { ...response, ok: true, result: { kind: 'markdown-render', output } };
  }
  catch {
    return { ...response, ok: false, code: 'error' };
  }
}
