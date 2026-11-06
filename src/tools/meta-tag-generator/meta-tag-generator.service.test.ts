import { describe, expect, it } from 'vitest';
import { generateMetaTags } from './meta-tag-generator.service';

describe('meta tag generator', () => {
  it('uses content attributes for Open Graph and Twitter metadata', () => {
    const result = generateMetaTags({
      type: 'music.song',
      title: 'Song title',
      'twitter:card': 'summary_large_image',
      'twitter:site': '@ittoolsdottech',
    });

    expect(result).toContain('<meta property="og:type" content="music.song" />');
    expect(result).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(result).toContain('<meta name="twitter:site" content="@ittoolsdottech" />');
    expect(result).not.toContain(' value=');
  });

  it('escapes special characters in scalar and repeated metadata values', () => {
    const result = generateMetaTags({
      title: 'A & <B> "quoted" \'single\'',
      image: { alt: 'Image > description & details' },
      'twitter:description': 'Twitter <description>',
    });

    expect(result).toContain('content="A &amp; &lt;B&gt; &quot;quoted&quot; &#39;single&#39;"');
    expect(result).toContain('content="Image &gt; description &amp; details"');
    expect(result).toContain('content="Twitter &lt;description&gt;"');
  });

  it('keeps generated metadata valid when values are arrays', () => {
    const result = generateMetaTags({
      music: { tag: ['A & B', '<C>'] },
    });

    expect(result).toContain('<meta property="og:music:tag" content="A &amp; B" />');
    expect(result).toContain('<meta property="og:music:tag" content="&lt;C&gt;" />');
  });
});
