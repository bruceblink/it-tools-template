import { describe, expect, it } from 'vitest';
import { sanitizeHtmlForRender } from './sanitizeHtml';

function parseHtml(markup: string) {
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
}

describe('sanitizeHtmlForRender', () => {
  it('removes active elements and event handler attributes', () => {
    const html = sanitizeHtmlForRender(
      '<script>alert(1)</script><iframe src="https://example.test"></iframe><img src="x" onerror="alert(2)">',
    );
    const container = parseHtml(html);

    expect(container.querySelector('script, iframe')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('removes dangerous and unsupported URLs while preserving safe links and raster images', () => {
    const html = sanitizeHtmlForRender(
      '<a href="java&#x09;script:alert(1)">bad</a>' +
        '<a href="https://example.test">safe</a>' +
        '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="svg">' +
        '<img src="data:image/png;base64,aGVsbG8=" alt="png">',
    );
    const container = parseHtml(html);
    const links = container.querySelectorAll('a');
    const images = container.querySelectorAll('img');

    expect(links[0]?.hasAttribute('href')).toBe(false);
    expect(links[1]?.getAttribute('href')).toBe('https://example.test');
    expect(images[0]?.hasAttribute('src')).toBe(false);
    expect(images[1]?.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('adds noopener and noreferrer to new-tab links', () => {
    const html = sanitizeHtmlForRender(
      '<a href="https://example.test" target="_blank" rel="opener">safe</a>' +
        '<a href="https://other.test" target="_BLANK">upper case target</a>',
    );
    const links = parseHtml(html).querySelectorAll('a');

    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1]?.getAttribute('target')).toBe('_blank');
    expect(links[1]?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('preserves normal Markdown markup and table alignment but removes arbitrary styles', () => {
    const html = sanitizeHtmlForRender(
      '<h1>Heading</h1><p><strong>bold</strong> <a href="/about">link</a></p>' +
        '<table><tr><td style="text-align: center">center</td>' +
        '<td style="background-image: url(https://tracker.test/x)">unsafe</td></tr></table>',
    );
    const container = parseHtml(html);

    expect(container.querySelector('h1')?.textContent).toBe('Heading');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/about');
    const alignmentCell = container.querySelector('td');
    expect(alignmentCell?.textContent).toBe('center');
    expect(alignmentCell?.getAttribute('style')).toMatch(/^text-align:\s*center;?$/);
    expect(container.querySelector('td[style*="url"]')).toBeNull();
  });
});
