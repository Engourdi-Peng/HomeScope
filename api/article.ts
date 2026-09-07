/**
 * Vercel Serverless Function - Blog Article SEO HTML Renderer
 *
 * Rewrites (see vercel.json):
 *   /blog/:slug  ->  /api/article?slug=:slug
 *
 * Fetches published article via Supabase service_role, builds a render-ready
 * HTML payload (title, description, OG, JSON-LD, breadcrumbs) and rewrites
 * /index.html so the React app can hydrate on top. Returns 404 with noindex
 * if the slug is missing, archived, or marked noindex.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  articleJsonLd,
  breadcrumbJsonLd,
  buildNotFoundHtml,
  injectSeoTags,
} from '../shared/seoHtml.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

const ARTICLE_SELECT =
  'id,slug,title,excerpt,content_html,cover_image_url,cover_alt,category_id,tags,author_name,status,published_at,content_updated_at,updated_at,reading_time_minutes,seo_title,seo_description,canonical_url,og_image_url,noindex';

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_html: string;
  cover_image_url: string | null;
  cover_alt: string | null;
  category_id: string | null;
  tags: string[];
  author_name: string;
  status: string;
  published_at: string | null;
  content_updated_at: string | null;
  updated_at: string;
  reading_time_minutes: number;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  og_image_url: string | null;
  noindex: boolean;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
}

function escapeHtml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchArticle(slug: string): Promise<ArticleRow | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set('slug', `eq.${encodeURIComponent(slug)}`);
  url.searchParams.set('status', 'eq.published');
  url.searchParams.set('noindex', 'eq.false');
  url.searchParams.set('select', ARTICLE_SELECT);
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const rows = (await res.json()) as ArticleRow[];
  return rows[0] ?? null;
}

async function fetchRedirect(slug: string): Promise<string | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_redirects`);
  url.searchParams.set('old_slug', `eq.${encodeURIComponent(slug)}`);
  url.searchParams.set('select', 'new_slug');
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ new_slug: string }>;
  return rows[0]?.new_slug ?? null;
}

async function fetchCategory(id: string): Promise<CategoryRow | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_categories`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('select', 'id,slug,name');
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as CategoryRow[];
  return rows[0] ?? null;
}

/** Strip HTML to plain text for description / noscript summary fallback. */
function stripHtml(input: string): string {
  return (input || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSlug(req: VercelRequest): string {
  const raw = req.query?.slug;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const slug = readSlug(req);
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  let article = await fetchArticle(slug);
  if (!article) {
    const redirectSlug = await fetchRedirect(slug);
    if (redirectSlug) article = await fetchArticle(redirectSlug);
  }
  if (!article) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
    return res.status(404).send(buildNotFoundHtml('Article not found or no longer published.'));
  }

  const category = article.category_id ? await fetchCategory(article.category_id) : null;

  const canonical = article.canonical_url || `${SITE_URL}/blog/${article.slug}`;
  const description = (article.seo_description || article.excerpt || stripHtml(article.content_html)).slice(0, 220);
  const ogImage = article.og_image_url || article.cover_image_url || `${SITE_URL}/og-default.png`;

  const extraHead = [
    articleJsonLd({
      title: article.title,
      description,
      url: canonical,
      imageUrl: ogImage,
      datePublished:
        article.published_at ||
        article.content_updated_at ||
        article.updated_at,
      dateModified:
        article.content_updated_at ||
        article.published_at ||
        article.updated_at,
      authorName: article.author_name,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: `${SITE_URL}/` },
      { name: 'Blog', url: `${SITE_URL}/blog` },
      ...(category ? [{ name: category.name, url: `${SITE_URL}/blog/category/${category.slug}` } as { name: string; url: string }] : []),
      { name: article.title, url: canonical },
    ]),
  ].join('\n');

  const summaryHtml = `<article>
    <h1>${escapeHtml(article.title)}</h1>
    ${article.excerpt ? `<p>${escapeHtml(article.excerpt)}</p>` : ''}
    ${article.cover_image_url ? `<img src="${escapeHtml(article.cover_image_url)}" alt="${escapeHtml(article.cover_alt || article.title)}" />` : ''}
  </article>`;

  try {
    const indexResponse = await fetch(`${SITE_URL}/index.html`);
    if (!indexResponse.ok) throw new Error(`index.html ${indexResponse.status}`);
    const html = await indexResponse.text();

    const finalHtml = injectSeoTags(html, {
      title: article.seo_title || `${article.title} | HomeScope`,
      description,
      canonicalUrl: canonical,
      ogImage,
      ogType: 'article',
      robots: 'index,follow',
      extraHead,
      mainHtml: summaryHtml,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(finalHtml);
  } catch (error) {
    console.error('article HTML error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}