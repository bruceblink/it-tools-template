import { executeIpv4CidrContainmentTask } from '@/tools/ipv4-cidr-containment-checker/ipv4-cidr-containment-task.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = ({ data }) => {
  workerScope.postMessage(executeIpv4CidrContainmentTask(data));
};
