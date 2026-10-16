import { isTrustedRendererUrl } from './security';

export type MediaDeviceType = 'audio' | 'video';

interface MediaPermissionFrameDetails {
  isMainFrame: boolean;
  mediaType?: unknown;
  mediaTypes?: unknown;
  requestingUrl?: string;
  securityOrigin?: string;
}

function getOrigin(candidate: string) {
  try {
    return new URL(candidate).origin;
  }
  catch {
    return null;
  }
}

function isCameraRecorderPage(candidate: string, trustedRendererUrl: string) {
  if (!isTrustedRendererUrl(candidate, trustedRendererUrl)) {
    return false;
  }

  try {
    return ['/camera-recorder', '/camera-recorder/'].includes(new URL(candidate).pathname);
  }
  catch {
    return false;
  }
}

// Bind consent to the trusted camera route in both the requesting frame and the current main document.
function isTrustedCameraRecorderRequest(
  permission: string,
  requestingOrigin: string,
  details: MediaPermissionFrameDetails,
  trustedRendererUrl: string,
  currentUrl: string,
) {
  const { requestingUrl, securityOrigin } = details;
  if (permission !== 'media'
    || !details.isMainFrame
    || !requestingUrl
    || !securityOrigin
    || !isTrustedRendererUrl(requestingOrigin, trustedRendererUrl)
    || !isTrustedRendererUrl(securityOrigin, trustedRendererUrl)
    || !isCameraRecorderPage(requestingUrl, trustedRendererUrl)
    || !isCameraRecorderPage(currentUrl, trustedRendererUrl)) {
    return false;
  }

  const origin = getOrigin(requestingOrigin);
  return origin !== null
    && getOrigin(securityOrigin) === origin
    && getOrigin(requestingUrl) === origin
    && getOrigin(currentUrl) === origin;
}

// Permission checks can reach Electron before the matching request callback; keep the same frame and route rules for both.
export function getCheckedMediaType(
  permission: string,
  requestingOrigin: string,
  details: MediaPermissionFrameDetails,
  trustedRendererUrl: string,
  currentUrl: string,
): MediaDeviceType | null {
  if (!isTrustedCameraRecorderRequest(permission, requestingOrigin, details, trustedRendererUrl, currentUrl)) {
    return null;
  }

  return details.mediaType === 'audio' || details.mediaType === 'video' ? details.mediaType : null;
}

export function getRequestedMediaTypes(
  permission: string,
  details: MediaPermissionFrameDetails,
  trustedRendererUrl: string,
  currentUrl: string,
): MediaDeviceType[] {
  const requestingOrigin = details.securityOrigin ?? '';
  if (!isTrustedCameraRecorderRequest(permission, requestingOrigin, details, trustedRendererUrl, currentUrl)
    || !Array.isArray(details.mediaTypes)
    || details.mediaTypes.length === 0
    || details.mediaTypes.some(type => type !== 'audio' && type !== 'video')) {
    return [];
  }

  return [...new Set(details.mediaTypes as MediaDeviceType[])];
}
