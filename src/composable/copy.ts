import { useMessage } from 'naive-ui';
import type { MaybeRefOrGetter } from 'vue';
import { computed, onScopeDispose, ref, toValue } from 'vue';

export function useCopy({ source, text = 'Copied to the clipboard', createToast = true }: { source?: MaybeRefOrGetter<string>; text?: string; createToast?: boolean } = {}) {
  const message = useMessage();
  const copied = ref(false);
  let resetCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  onScopeDispose(() => {
    if (resetCopiedTimer) {
      clearTimeout(resetCopiedTimer);
    }
  });

  return {
    isJustCopied: computed(() => copied.value),
    async copy(content?: string, { notificationMessage }: { notificationMessage?: string } = {}) {
      const value = source === undefined ? content ?? '' : toValue(source);
      let result: Awaited<ReturnType<typeof import('@/platform-adapter').writeTextToClipboard>>;
      try {
        const { writeTextToClipboard } = await import('@/platform-adapter');
        result = await writeTextToClipboard(value);
      }
      catch {
        result = { status: 'failed' };
      }
      if (result.status !== 'success') {
        copied.value = false;
        const errorMessage = result.status === 'unsupported'
          ? 'Clipboard writing is not supported in this context.'
          : result.status === 'denied'
            ? 'Clipboard access was denied. Check browser or operating system permissions.'
            : 'Could not copy to the clipboard.';
        message.error(errorMessage);
        return false;
      }

      copied.value = true;
      if (resetCopiedTimer) {
        clearTimeout(resetCopiedTimer);
      }
      resetCopiedTimer = setTimeout(() => copied.value = false, 1_500);
      if (createToast) {
        message.success(notificationMessage ?? text);
      }
      return true;
    },
  };
}
