import { mountSharedApp } from '../src/app';

void mountSharedApp().catch((error: unknown) => {
  console.error('[app] Failed to mount the shared interface.', error);
});
