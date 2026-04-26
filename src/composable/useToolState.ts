export { useToolState };

function useToolState<T>() {
  const isLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  const result = ref<T | null>(null) as Ref<T | null>;

  async function run(fn: () => T | Promise<T>) {
    isLoading.value = true;
    errorMessage.value = null;
    try {
      result.value = await fn();
    }
    catch (e) {
      errorMessage.value = e instanceof Error ? e.message : String(e);
      result.value = null;
    }
    finally {
      isLoading.value = false;
    }
  }

  function reset() {
    isLoading.value = false;
    errorMessage.value = null;
    result.value = null;
  }

  return { isLoading, errorMessage, result, run, reset };
}
