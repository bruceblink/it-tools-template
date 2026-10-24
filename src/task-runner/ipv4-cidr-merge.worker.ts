import { executeIpv4CidrMergeTask } from '@/tools/ipv4-cidr-merge/ipv4-cidr-merge-task.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = ({ data }) => {
  workerScope.postMessage(executeIpv4CidrMergeTask(data));
};
