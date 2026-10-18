import { type Ref, computed, onScopeDispose, ref } from 'vue';

export { useMediaRecorder };

function useMediaRecorder({ stream }: { stream: Ref<MediaStream | undefined> }): {
  isRecordingSupported: Ref<boolean>
  recordingState: Ref<'stopped' | 'recording' | 'paused' | 'stopping'>
  startRecording: () => void
  stopRecording: () => void
  pauseRecording: () => void
  resumeRecording: () => void
  onRecordAvailable: (cb: (url: string) => void) => void
} {
  const isRecordingSupported = computed(() => MediaRecorder.isTypeSupported('video/webm'));
  const mediaRecorder = ref<MediaRecorder | null>(null);
  const recordedChunks = ref<Blob[]>([]);
  const recordAvailable = createEventHook();
  const recordingState = ref<'stopped' | 'recording' | 'paused' | 'stopping'>('stopped');

  const createVideo = () => {
    const blob = new Blob(recordedChunks.value, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    recordedChunks.value = [];
    return url;
  };

  const startRecording = () => {
    if (!isRecordingSupported.value) {
      return;
    }
    if (!stream.value) {
      return;
    }
    if (recordingState.value !== 'stopped') {
      return;
    }

    const recorder = new MediaRecorder(stream.value, { mimeType: 'video/webm' });
    mediaRecorder.value = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.value.push(e.data);
      }
    };

    recorder.onstop = () => {
      mediaRecorder.value = null;
      recordingState.value = 'stopped';
      recordAvailable.trigger(createVideo());
    };

    if (recorder.state !== 'inactive') {
      mediaRecorder.value = null;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      return;
    }

    recorder.start();
    recordingState.value = 'recording';
  };

  const stopRecording = () => {
    if (!isRecordingSupported.value) {
      return;
    }
    if (!mediaRecorder.value) {
      return;
    }
    if (recordingState.value === 'stopped' || recordingState.value === 'stopping') {
      return;
    }

    const recorder = mediaRecorder.value;
    const previousState = recordingState.value;
    recordingState.value = 'stopping';
    try {
      recorder.stop();
    }
    catch (error) {
      recordingState.value = previousState;
      throw error;
    }
  };

  const pauseRecording = () => {
    if (!isRecordingSupported.value) {
      return;
    }
    if (!mediaRecorder.value) {
      return;
    }
    if (recordingState.value !== 'recording') {
      return;
    }

    mediaRecorder.value.pause();
    recordingState.value = 'paused';
  };

  const resumeRecording = () => {
    if (!isRecordingSupported.value) {
      return;
    }
    if (!mediaRecorder.value) {
      return;
    }

    if (recordingState.value !== 'paused') {
      return;
    }

    mediaRecorder.value.resume();
    recordingState.value = 'recording';
  };

  // Stop active capture and discard unfinished chunks when the owning tool scope closes.
  const dispose = () => {
    const recorder = mediaRecorder.value;
    mediaRecorder.value = null;
    recordingState.value = 'stopped';
    recordedChunks.value = [];
    if (!recorder) {
      return;
    }

    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  };
  onScopeDispose(dispose);

  return {
    isRecordingSupported,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    recordingState,

    onRecordAvailable: recordAvailable.on,
  };
}
