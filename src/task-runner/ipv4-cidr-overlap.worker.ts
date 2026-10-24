import { executeIpv4CidrOverlapTask } from '@/tools/ipv4-cidr-overlap-checker/ipv4-cidr-overlap-task.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = ({ data }) => {
  workerScope.postMessage(executeIpv4CidrOverlapTask(data));
};
