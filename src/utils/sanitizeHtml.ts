import DomPurify from 'dompurify';

const sanitizerBaseUrl = 'https://html-sanitizer.invalid/';
const safeProtocols = new Set(['http:', 'https:', 'ftp:', 'mailto:', 'tel:']);
const safeRasterDataImage = /^data:image\/(?:gif|png|jpeg|webp);base64,/i;
const forbiddenTags = ['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object', 'script', 'style'];

function isSafeUrl(value: string, attributeName: string) {
  const normalized = value.replace(/[\u0000-\u0020\u007f]/g, '');

  if (normalized === '') {
    return true;
  }

  if (attributeName === 'src' && safeRasterDataImage.test(normalized)) {
    return true;
  }

  try {
    const url = new URL(normalized, sanitizerBaseUrl);
    return safeProtocols.has(url.protocol);
  } catch {
    return false;
  }
}

function isSafeMarkdownStyle(value: string) {
  return /^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$/i.test(value);
}

/** Sanitizes HTML before the application inserts it into a rendered document. */
export function sanitizeHtmlForRender(markup: string) {
  const fragment = DomPurify.sanitize(markup, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: forbiddenTags,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;

  // Keep only the URL and style forms emitted by Markdown, and secure new-tab links.
  for (const element of fragment.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();

      if (name.startsWith('on') || name === 'ping' || name === 'srcset') {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === 'href' || name === 'src') && !isSafeUrl(attribute.value, name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'style' && !isSafeMarkdownStyle(attribute.value)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'target') {
        if (attribute.value.toLowerCase() !== '_blank') {
          element.removeAttribute(attribute.name);
        } else {
          element.setAttribute('target', '_blank');
        }
      }
    }

    if (element.tagName.toLowerCase() === 'a' && element.getAttribute('target') === '_blank') {
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }

  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
