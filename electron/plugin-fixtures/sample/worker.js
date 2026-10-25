postMessage('worker-ready');

self.addEventListener('message', async (event) => {
  if (event.data?.kind === 'echo') {
    postMessage('echoed');
    return;
  }

  if (event.data?.kind === 'nested') {
    try {
      const worker = new Worker('/nested-worker.js');
      worker.addEventListener('message', () => postMessage('nested-allowed'), { once: true });
      worker.addEventListener('error', (error) => {
        error.preventDefault();
        postMessage('nested-blocked');
      }, { once: true });
    }
    catch {
      postMessage('nested-blocked');
    }
    return;
  }

  if (event.data?.kind === 'fetch') {
    try {
      await fetch(event.data.url, { cache: 'no-store' });
      postMessage('network-allowed');
    }
    catch {
      postMessage('network-blocked');
    }
  }
});
