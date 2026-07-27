import type { MetadataRoute } from 'next';

/**
 * Crawl policy.
 *
 * /i/ and /api/ are DISALLOWED deliberately, not incidentally. /i/[token]
 * serves capability-token tracking pages: a crawled token URL would publish
 * a live incident location into a search index. Do not relax this.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/i/', '/api/'],
    },
    sitemap: 'https://opasafety.com/sitemap.xml',
    host: 'https://opasafety.com',
  };
}
