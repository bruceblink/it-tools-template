import { generateMeta } from '@it-tools/oggen';
import type { MetadataConfig } from '@it-tools/oggen';

const htmlAttributeEscapes: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

// oggen@1.3.0 emits unescaped values. Escape before generation so quotes cannot
// change the generated attribute boundary.
function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&"'<>]/g, character => htmlAttributeEscapes[character] ?? character);
}

function escapeMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return escapeHtmlAttribute(value);
  }

  if (Array.isArray(value)) {
    return value.map(escapeMetadataValue);
  }

  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, escapeMetadataValue(nestedValue)]),
    );
  }

  return value;
}

function escapeMetadata(metadata: Record<string, unknown>): MetadataConfig {
  return escapeMetadataValue(metadata) as MetadataConfig;
}

// oggen@1.3.0 uses `value` for every generated meta tag. The HTML standard
// uses `content` for both property-based and name-based metadata.
function replaceValueAttributeWithContent(html: string): string {
  return html.replace(/(<meta\b[^>]*?)\svalue=/g, '$1 content=');
}

export function generateMetaTags(metadata: Record<string, unknown>): string {
  const twitterMetadata = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => key.startsWith('twitter:'))
      .map(([key, value]) => [key.replace(/^twitter:/, ''), value]),
  );
  const openGraphMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !key.startsWith('twitter:')),
  );

  const generated = generateMeta(
    escapeMetadata({ ...openGraphMetadata, twitter: twitterMetadata }),
    { generateTwitterCompatibleMeta: true },
  );

  return replaceValueAttributeWithContent(generated);
}
