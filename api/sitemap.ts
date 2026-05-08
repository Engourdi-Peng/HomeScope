/**
 * Vercel Serverless Function - SEO Sitemap
 *
 * Exposed at: https://www.tryhomescope.com/sitemap.xml
 * via vercel.json rewrite: /sitemap.xml -> /api/sitemap
 *
 * Generates a standard XML sitemap that Google and other search
 * engines can crawl without authentication.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const API_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

/**
 * Patterns used to detect test / draft / garbage slugs
 * that should be excluded from the public sitemap.
 */
const TEST_SLUG_PATTERNS = [
  /test/i,
  /draft/i,
  /demo/i,
  /sample/i,
  /^foo/i,
  /^bar/i,
  /^baz/i,
  /lorem/i,
  /ipsum/i,
  /^fake/i,
  /^xxx/i,
  /dev-/i,
  /-dev$/i,
  /staging/i,
  /^temp/i,
];

function isTestSlug(slug: string): boolean {
  return TEST_SLUG_PATTERNS.some((p) => p.test(slug));
}

interface SitemapRow {
  share_slug: string;
  shared_at: string | null;
  updated_at: string;
}

/**
 * Fetch public analyses from Supabase REST API.
 * Uses SERVICE_ROLE_KEY so we bypass RLS — only SELECT is performed (read-only).
 */
async function fetchPublicAnalyses(): Promise<SitemapRow[]> {
  const query = new URL(`${SUPABASE_URL}/rest/v1/analyses`);
  query.searchParams.set('is_public', 'eq.true');
  query.searchParams.set('share_slug', 'not.is.null');
  query.searchParams.set('status', 'eq.done');
  query.searchParams.set('select', 'share_slug,shared_at,updated_at');
  query.searchParams.set('order', 'shared_at.desc.nullslast');

  const response = await fetch(query.toString(), {
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch analyses: ${response.status} ${body}`);
  }

  return response.json() as Promise<SitemapRow[]>;
}

/**
 * Deduplicate rows by share_slug, keeping the one with the latest shared_at.
 * Also filters out test/draft slugs.
 */
function dedupeAndFilter(rows: SitemapRow[]): SitemapRow[] {
  const seen = new Map<string, SitemapRow>();

  for (const row of rows) {
    if (!row.share_slug || isTestSlug(row.share_slug)) continue;

    // Prefer rows that have a shared_at timestamp
    const existing = seen.get(row.share_slug);
    if (!existing) {
      seen.set(row.share_slug, row);
    } else {
      const existingShared = existing.shared_at ? new Date(existing.shared_at).getTime() : 0;
      const rowShared = row.shared_at ? new Date(row.shared_at).getTime() : 0;
      if (rowShared > existingShared) {
        seen.set(row.share_slug, row);
      }
    }
  }

  return [...seen.values()];
}

/** Format a date string as YYYY-MM-DD, or today's date as fallback. */
function formatDate(isoString: string | null | undefined): string {
  if (isoString) {
    const d = new Date(isoString);
    if (Number.isFinite(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  return new Date().toISOString().split('T')[0];
}

/** Static pages to include in the sitemap. */
const STATIC_PAGES = [
  { loc: `${SITE_URL}/`, changefreq: 'weekly', priority: '1.0' },
  { loc: `${SITE_URL}/tools/realestate-com-au`, changefreq: 'monthly', priority: '0.8' },
  { loc: `${SITE_URL}/pricing`, changefreq: 'monthly', priority: '0.7' },
  { loc: `${SITE_URL}/privacy`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE_URL}/terms`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE_URL}/support`, changefreq: 'monthly', priority: '0.5' },
  { loc: `${SITE_URL}/contact`, changefreq: 'yearly', priority: '0.4' },
];

function buildXml(shareRows: SitemapRow[]): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];

  // Static pages
  for (const page of STATIC_PAGES) {
    lines.push(`  <url>`);
    lines.push(`    <loc>${page.loc}</loc>`);
    lines.push(`    <changefreq>${page.changefreq}</changefreq>`);
    lines.push(`    <priority>${page.priority}</priority>`);
    lines.push(`  </url>`);
  }

  // Share pages
  for (const row of shareRows) {
    const lastmod = formatDate(row.shared_at ?? row.updated_at);
    lines.push(`  <url>`);
    lines.push(`    <loc>${SITE_URL}/share/${encodeURIComponent(row.share_slug)}</loc>`);
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push(`    <changefreq>weekly</changefreq>`);
    lines.push(`    <priority>0.8</priority>`);
    lines.push(`  </url>`);
  }

  lines.push(`</urlset>`);
  return lines.join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET — sitemap should never be POSTed
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).end();
    return;
  }

  try {
    const rows = await fetchPublicAnalyses();
    const filtered = dedupeAndFilter(rows);
    const xml = buildXml(filtered);

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap] Error generating sitemap:', err);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(500).send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<error>Sitemap temporarily unavailable. Please try again later.</error>`
    );
  }
}
