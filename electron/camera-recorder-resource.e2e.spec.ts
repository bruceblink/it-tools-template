import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface CameraRecorderTestWindow extends Window {
  __cameraRecorderStreams?: MediaStream[];
  __cameraRecorderCreatedUrls?: string[];
  __cameraRecorderRevokedUrls?: string[];
}

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-camera-recorder-e2e-'));
  electronApp = await _electron.launch({
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--user-data-dir=${userDataDirectory}`,
      '.',
    ],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async () => ({ response: 0 }),
    });
  });
  await page.addInitScript(instrumentCameraResources);
});

test.afterAll(async () => {
  try {
    await electronApp?.close();
  }
  finally {
    if (userDataDirectory) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    }
  }
});

test('releases a fake camera stream and recording URL when leaving the tool', async () => {
  test.setTimeout(90_000);
  await page.goto('app://bundle/camera-recorder');
  await page.getByRole('button', { name: 'Grant permission' }).click();
  await expect(page.getByRole('button', { name: 'Start webcam' })).toBeVisible();

  await page.getByRole('button', { name: 'Start webcam' }).click();
  const preview = page.locator('video[autoplay]');
  await expect.poll(() => preview.evaluate(element => (element as HTMLVideoElement).srcObject !== null)).toBe(true);

  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Stop' }).click();

  const recording = page.locator('video[src^="blob:"]');
  await expect(recording).toHaveCount(1);
  const recordingUrl = await recording.getAttribute('src');
  if (!recordingUrl) {
    throw new Error('The recorder did not create a Blob URL for the saved video.');
  }

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL('app://bundle/');
  const cleanup = await page.evaluate((url) => {
    const state = window as CameraRecorderTestWindow;
    return {
      recordingUrlRevoked: state.__cameraRecorderRevokedUrls?.includes(url) ?? false,
      createdRecordingUrl: state.__cameraRecorderCreatedUrls?.includes(url) ?? false,
      trackStates: state.__cameraRecorderStreams?.flatMap(stream => stream.getTracks().map(track => track.readyState)) ?? [],
    };
  }, recordingUrl);

  expect(cleanup.createdRecordingUrl).toBe(true);
  expect(cleanup.recordingUrlRevoked).toBe(true);
  expect(cleanup.trackStates.length).toBeGreaterThan(0);
  expect(cleanup.trackStates.every(state => state === 'ended')).toBe(true);
});

function instrumentCameraResources() {
  const state = window as CameraRecorderTestWindow;
  state.__cameraRecorderStreams = [];
  state.__cameraRecorderCreatedUrls = [];
  state.__cameraRecorderRevokedUrls = [];

  const mediaDevices = navigator.mediaDevices;
  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  mediaDevices.getUserMedia = async (constraints) => {
    const stream = await originalGetUserMedia(constraints);
    state.__cameraRecorderStreams?.push(stream);
    return stream;
  };

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = originalCreateObjectURL(object);
    state.__cameraRecorderCreatedUrls?.push(url);
    return url;
  };

  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    state.__cameraRecorderRevokedUrls?.push(url);
    originalRevokeObjectURL(url);
  };
}
