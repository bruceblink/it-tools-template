import {
  API_MAX_BODY_BYTES,
  API_MAX_HEADERS_JSON_BYTES,
  API_MAX_URL_LENGTH,
  utf8ByteLengthWithinLimit,
} from '@/shared/desktop-services/api';

export type ApiClientInputError = 'headers-too-large' | 'url-too-large' | 'body-too-large';

// Run these bounded checks before JSON parsing or sending strings through Electron IPC.
export function validateApiClientInput(
  url: string,
  headersText: string,
  bodyText: string,
): ApiClientInputError | null {
  if (utf8ByteLengthWithinLimit(headersText, API_MAX_HEADERS_JSON_BYTES) === null) {
    return 'headers-too-large';
  }
  if (utf8ByteLengthWithinLimit(url, API_MAX_URL_LENGTH) === null) {
    return 'url-too-large';
  }
  if (utf8ByteLengthWithinLimit(bodyText, API_MAX_BODY_BYTES) === null) {
    return 'body-too-large';
  }
  return null;
}
