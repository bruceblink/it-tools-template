import { describe, expect, it } from 'vitest';
import { getCheckedMediaType, getRequestedMediaTypes } from './media-permissions';

const trustedUrl = 'app://bundle/';
const cameraUrl = 'app://bundle/camera-recorder';

describe('Electron camera recorder permission boundary', () => {
  it('accepts camera and microphone requests from the trusted main frame on the camera tool', () => {
    expect(getRequestedMediaTypes('media', {
      isMainFrame: true,
      mediaTypes: ['video', 'audio'],
      requestingUrl: cameraUrl,
      securityOrigin: 'app://bundle',
    }, trustedUrl, cameraUrl)).toEqual(['video', 'audio']);
  });

  it('returns only known camera and microphone permission checks for a trusted request', () => {
    const details = {
      isMainFrame: true,
      requestingUrl: cameraUrl,
      securityOrigin: 'app://bundle',
    };

    expect(getCheckedMediaType('media', 'app://bundle', { ...details, mediaType: 'video' }, trustedUrl, cameraUrl)).toBe('video');
    expect(getCheckedMediaType('media', 'app://bundle', { ...details, mediaType: 'audio' }, trustedUrl, cameraUrl)).toBe('audio');
    expect(getCheckedMediaType('media', 'app://bundle', { ...details, mediaType: 'unknown' }, trustedUrl, cameraUrl)).toBeNull();
    expect(getCheckedMediaType('display-capture', 'app://bundle', { ...details, mediaType: 'video' }, trustedUrl, cameraUrl)).toBeNull();
  });

  it('denies requests from other routes, frames, origins, or stale documents', () => {
    const requests = [
      { requestingUrl: 'app://bundle/json-minify', currentUrl: 'app://bundle/json-minify', isMainFrame: true, securityOrigin: 'app://bundle' },
      { requestingUrl: cameraUrl, currentUrl: cameraUrl, isMainFrame: false, securityOrigin: 'app://bundle' },
      { requestingUrl: 'https://attacker.example/camera-recorder', currentUrl: 'https://attacker.example/camera-recorder', isMainFrame: true, securityOrigin: 'https://attacker.example' },
      { requestingUrl: cameraUrl, currentUrl: 'app://bundle/json-minify', isMainFrame: true, securityOrigin: 'app://bundle' },
      { requestingUrl: cameraUrl, currentUrl: cameraUrl, isMainFrame: true, securityOrigin: 'app://other' },
    ];

    for (const request of requests) {
      expect(getRequestedMediaTypes('media', { ...request, mediaTypes: ['video'] }, trustedUrl, request.currentUrl)).toEqual([]);
    }
  });

  it('denies empty and unsupported media requests', () => {
    const frame = {
      isMainFrame: true,
      requestingUrl: cameraUrl,
      securityOrigin: 'app://bundle',
    };

    expect(getRequestedMediaTypes('media', { ...frame, mediaTypes: [] }, trustedUrl, cameraUrl)).toEqual([]);
    expect(getRequestedMediaTypes('media', { ...frame, mediaTypes: ['video', 'screen'] }, trustedUrl, cameraUrl)).toEqual([]);
  });
});
