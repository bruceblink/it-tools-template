import { describe, expect, it } from 'vitest';
import { parseRobotsTxt, testRobotsTxt } from './robots-txt-tester.service';

const robotsTxt = `User-agent: *
Disallow: /admin/
Allow: /admin/help$
Sitemap: https://example.com/sitemap.xml

User-agent: Googlebot
Disallow: /private/
Allow: /private/public/
Crawl-delay: 5`;

describe('robots-txt-tester service', () => {
  it('parses groups, rules, crawl delay, and sitemaps', () => {
    expect(parseRobotsTxt(robotsTxt)).toMatchObject({
      sitemaps: ['https://example.com/sitemap.xml'],
      groups: [
        {
          agents: ['*'],
          rules: [
            { directive: 'disallow', pattern: '/admin/', lineNumber: 2 },
            { directive: 'allow', pattern: '/admin/help$', lineNumber: 3 },
          ],
        },
        {
          agents: ['Googlebot'],
          crawlDelay: '5',
        },
      ],
    });
  });

  it('allows by default when no rule matches', () => {
    expect(testRobotsTxt(robotsTxt, 'https://example.com/docs/', '*')).toMatchObject({
      allowed: true,
      path: '/docs/',
      matchedRule: undefined,
    });
  });

  it('uses the longest matching allow or disallow rule', () => {
    expect(testRobotsTxt(robotsTxt, 'https://example.com/admin/settings', '*')).toMatchObject({
      allowed: false,
      matchedRule: { directive: 'disallow', pattern: '/admin/' },
    });

    expect(testRobotsTxt(robotsTxt, 'https://example.com/admin/help', '*')).toMatchObject({
      allowed: true,
      matchedRule: { directive: 'allow', pattern: '/admin/help$' },
    });
  });

  it('uses the most specific user-agent group', () => {
    const analysis = testRobotsTxt(robotsTxt, 'https://example.com/private/public/page', 'Mozilla Googlebot');

    expect(analysis).toMatchObject({
      allowed: true,
      matchedAgents: ['Googlebot'],
      crawlDelay: '5',
      matchedRule: { directive: 'allow', pattern: '/private/public/' },
    });
  });

  it('supports wildcards and query strings', () => {
    const analysis = testRobotsTxt('User-agent: *\nDisallow: /*?token=', '/download?token=secret', '*');

    expect(analysis).toMatchObject({
      allowed: false,
      matchedRule: { pattern: '/*?token=' },
    });
  });

  it('rejects invalid relative URLs', () => {
    expect(() => testRobotsTxt('', 'docs', '*')).toThrow('URL must be absolute');
  });
});
