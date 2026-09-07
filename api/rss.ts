/**
 * Vercel Serverless Function - RSS feed for published articles.
 *
 * Exposed at /rss.xml via vercel.json rewrite.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

function escapeXml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(input: string): string {
  return (input || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set('status', 'eq.published');
  url.searchParams.set('noindex', 'eq.false');
  url.searchParams.set(
    'select',
    'slug,title,excerpt,content_html,published_at,updated_at,author_name'
  );
  url.searchParams.set('order', 'published_at.desc');
  url.searchParams.set('limit', '50');

  const supaRes = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
    },
  });

  let articles: any[] = [];
  if (supaRes.ok) articles = await supaRes.json();

  const lastBuild = new Date().toUTCString();
  const items = articles
    .map((a) => {
      const link = `${SITE_URL}/blog/${a.slug}`;
      const pub = a.published_at ? new Date(a.published_at).toUTCString() : lastBuild;
      const description = (a.excerpt || stripHtml(a.content_html)).slice(0, 400);
      return `<item>
  <title>${escapeXml(a.title)}</title>
  <link>${escapeXml(link)}</link>
  <guid isPermaLink="true">${escapeXml(link)}</guid>
  <pubDate>${escapeXml(pub)}</pubDate>
  <description>${escapeXml(description)}</description>
  ${a.author_name ? `<dc:creator>${escapeXml(a.author_name)}</dc:creator>` : ''}
</item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>HomeScope Blog</title>
  <link>${escapeXml(SITE_URL)}/blog</link>
  <description>Practical guides for reviewing Zillow listings.</description>
  <language>en-us</language>
  <lastBuildDate>${escapeXml(lastBuild)}</lastBuildDate>
${items}
</channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=1800, stale-while-revalidate=86400');
  return res.status(200).send(xml);
}