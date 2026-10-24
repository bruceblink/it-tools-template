import type {
  ApiErrorCode,
  ApiBridgeResult,
  ApiRequestInput,
  ApiResponse,
} from '@/shared/desktop-services/api';

export type ApiOperation<T> =
  | { status: 'success'; value: T }
  | { status: 'unsupported' }
  | { status: 'failed'; error: ApiErrorCode };

async function callApi<T>(
  operation: ((bridge: NonNullable<Window['itToolsDesktop']>) => Promise<ApiBridgeResult<T>> | undefined) | undefined,
): Promise<ApiOperation<T>> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge || !operation) {
    return { status: 'unsupported' };
  }
  try {
    const result = await operation(bridge);
    if (!result) {
      return { status: 'unsupported' };
    }
    return result.ok ? { status: 'success', value: result.value } : { status: 'failed', error: result.error };
  }
  catch {
    return { status: 'failed', error: 'service-unavailable' };
  }
}

export function runApiRequest(input: ApiRequestInput): Promise<ApiOperation<ApiResponse>> {
  return callApi(bridge => bridge.runApiRequest?.(input));
}

export function cancelApiRequest(requestId: string): Promise<ApiOperation<boolean>> {
  return callApi(bridge => bridge.cancelApiRequest?.(requestId));
}
