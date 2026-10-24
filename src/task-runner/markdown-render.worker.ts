import { executeMarkdownRenderTask } from '@/tools/markdown-to-html/markdown-render.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = ({ data }) => {
  workerScope.postMessage(executeMarkdownRenderTask(data));
};
