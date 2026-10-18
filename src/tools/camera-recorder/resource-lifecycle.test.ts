// @vitest-environment jsdom
import { effectScope, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraMediaCollection } from './media-resource';
import { useMediaRecorder } from './useMediaRecorder';

class TestMediaRecorder {
  static instances: TestMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  stopCalls = 0;

  constructor(readonly stream: MediaStream, readonly options?: MediaRecorderOptions) {
    TestMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.stopCalls += 1;
    this.state = 'inactive';
  }

  emitData(value: string): void {
    this.ondataavailable?.({ data: new Blob([value]) } as BlobEvent);
  }

  emitStop(): void {
    this.onstop?.(new Event('stop'));
  }
}

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  }
  else {
    Reflect.deleteProperty(target, key);
  }
}

describe('camera recorder resource lifecycle', () => {
  beforeEach(() => {
    TestMediaRecorder.instances = [];
    TestMediaRecorder.isTypeSupported.mockReturnValue(true);
    vi.stubGlobal('MediaRecorder', TestMediaRecorder);
  });

  afterEach(() => {
    restoreProperty(URL, 'createObjectURL', originalCreateObjectUrl);
    restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not start a second recording before the stop event releases the first recorder', () => {
    let recordedBlob: Blob | undefined;
    const createObjectUrl = vi.fn((blob: Blob) => {
      recordedBlob = blob;
      return 'blob:camera/recording-1';
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    const scope = effectScope();
    let recorderApi!: ReturnType<typeof useMediaRecorder>;
    const recordAvailable = vi.fn();
    scope.run(() => {
      recorderApi = useMediaRecorder({ stream: ref({} as MediaStream) });
      recorderApi.onRecordAvailable(recordAvailable);
    });

    recorderApi.startRecording();
    const recorder = TestMediaRecorder.instances[0]!;
    recorder.emitData('first chunk');
    recorderApi.stopRecording();

    expect(recorderApi.recordingState.value).toBe('stopping');
    recorderApi.startRecording();
    expect(TestMediaRecorder.instances).toHaveLength(1);

    recorder.emitData('final chunk');
    recorder.emitStop();
    expect(recorderApi.recordingState.value).toBe('stopped');
    expect(recordAvailable).toHaveBeenCalledOnce();
    expect(recordAvailable).toHaveBeenCalledWith('blob:camera/recording-1');
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(recordedBlob?.size).toBe('first chunk'.length + 'final chunk'.length);
    scope.stop();
  });

  it('stops capture and discards unfinished recording data when the tool scope closes', () => {
    const createObjectUrl = vi.fn(() => 'blob:camera/discarded');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    const scope = effectScope();
    let recorderApi!: ReturnType<typeof useMediaRecorder>;
    const recordAvailable = vi.fn();
    scope.run(() => {
      recorderApi = useMediaRecorder({ stream: ref({} as MediaStream) });
      recorderApi.onRecordAvailable(recordAvailable);
    });

    recorderApi.startRecording();
    const recorder = TestMediaRecorder.instances[0]!;
    recorder.emitData('unfinished chunk');
    scope.stop();

    expect(recorder.stopCalls).toBe(1);
    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(recorderApi.recordingState.value).toBe('stopped');
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(recordAvailable).not.toHaveBeenCalled();
  });

  it('revokes video Blob URLs when media is removed and when the tool scope closes', () => {
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const scope = effectScope();
    const collection = scope.run(() => useCameraMediaCollection());
    if (!collection) {
      throw new Error('The camera media collection did not start in an active scope.');
    }

    collection.addMedia({ type: 'video', value: 'blob:camera/recording-1', createdAt: new Date(1) });
    collection.addMedia({ type: 'image', value: 'data:image/png;base64,AA==', createdAt: new Date(2) });
    collection.removeMedia(1);
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:camera/recording-1');

    collection.addMedia({ type: 'video', value: 'blob:camera/recording-2', createdAt: new Date(3) });
    scope.stop();

    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenLastCalledWith('blob:camera/recording-2');
  });
});
