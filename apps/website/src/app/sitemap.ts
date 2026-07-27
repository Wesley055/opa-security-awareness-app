import type { MetadataRoute } from 'next';

const BASE = 'https://opasafety.com';

/**
 * Public marketing routes only.
 *
 * /i/[token] is intentionally absent - those pages are private by
 * capability token and must never be enumerated. /api is likewise absent.
 */
const ROUTES = [
  { path: '', priority: 1.0 },
  { path: '/about', priority: 0.8 },
  { path: '/hospitals', priority: 0.8 },
  { path: '/contact', priority: 0.7 },
  { path: '/careers', priority: 0.5 },
  { path: '/privacy', priority: 0.3 },
  { path: '/terms', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return ROUTES.map((route) => ({
    url: BASE + route.path,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: route.priority,
  }));
}
