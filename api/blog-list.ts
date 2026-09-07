/**
 * Vercel Serverless Function - Blog List & Category SEO HTML Renderer
 *
 * /blog  -> /api/blog-list
 * /blog/category/:slug -> /api/blog-list?category=:slug
 *
 * Returns a server-rendered HTML shell so search engines can index the
 * first page of articles even when JavaScript hasn't loaded yet.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  breadcrumbJsonLd,
  buildNotFoundHtml,
  injectSeoTags,
} from '../shared/seoHtml.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  cover_alt: string | null;
  published_at: string | null;
  reading_time_minutes: number;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

function escapeHtml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function listArticles(opts: { categoryId?: string; limit: number }) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
  url.searchParams.set('status', 'eq.published');
  url.searchParams.set('noindex', 'eq.false');
  url.searchParams.set(
    'select',
    'id,slug,title,excerpt,cover_image_url,cover_alt,published_at,reading_time_minutes'
  );
  url.searchParams.set('order', 'published_at.desc');
  url.searchParams.set('limit', String(opts.limit));
  if (opts.categoryId) url.searchParams.set('category_id', `eq.${opts.categoryId}`);
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return [] as ArticleRow[];
  return (await res.json()) as ArticleRow[];
}

async function fetchCategory(slug: string): Promise<CategoryRow | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/article_categories`);
  url.searchParams.set('slug', `eq.${slug}`);
  url.searchParams.set('is_active', 'eq.true');
  url.searchParams.set('select', 'id,slug,name,description,seo_title,seo_description');
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

function renderArticleList(articles: ArticleRow[]): string {
  if (articles.length === 0) {
    return '<p>No articles published yet.</p>';
  }
  const items = articles
    .map((a) => {
      const date = formatDate(a.published_at);
      return `<li>
        <a href="${SITE_URL}/blog/${escapeHtml(a.slug)}">
          ${a.cover_image_url ? `<img src="${escapeHtml(a.cover_image_url)}" alt="${escapeHtml(a.cover_alt || a.title)}" />` : ''}
          <h2>${escapeHtml(a.title)}</h2>
          ${a.excerpt ? `<p>${escapeHtml(a.excerpt)}</p>` : ''}
          <small>${escapeHtml(date)}${a.reading_time_minutes ? ` · ${a.reading_time_minutes} min read` : ''}</small>
        </a>
      </li>`;
    })
    .join('\n');
  return `<ul class="article-list">${items}</ul>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const categorySlug = typeof req.query?.category === 'string' ? req.query.category : '';
  let category: CategoryRow | null = null;
  if (categorySlug) {
    category = await fetchCategory(categorySlug);
    if (!category) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
      return res.status(404).send(buildNotFoundHtml('Category not found.'));
    }
  }

  const articles = await listArticles({ categoryId: category?.id, limit: 24 });

  const title = category
    ? category.seo_title || `${category.name} | HomeScope Blog`
    : 'HomeScope Blog — Insights on Listings, Buying, and Renting Smarter';
  const description = category
    ? category.seo_description || category.description || `Articles in ${category.name}.`
    : 'Practical guides for reviewing Zillow listings, comparing homes, and asking the right questions before you tour.';
  const canonical = category
    ? `${SITE_URL}/blog/category/${category.slug}`
    : `${SITE_URL}/blog`;

  const extraHead = breadcrumbJsonLd([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: 'Blog', url: `${SITE_URL}/blog` },
    ...(category ? [{ name: category.name, url: canonical } as { name: string; url: string }] : []),
  ]);

  try {
    const indexResponse = await fetch(`${SITE_URL}/index.html`);
    if (!indexResponse.ok) throw new Error(`index.html ${indexResponse.status}`);
    const html = await indexResponse.text();

    const finalHtml = injectSeoTags(html, {
      title,
      description,
      canonicalUrl: canonical,
      ogType: 'website',
      robots: 'index,follow',
      extraHead,
      mainHtml: `<section class="article-list-section"><h1>${escapeHtml(category ? category.name : 'HomeScope Blog')}</h1>${renderArticleList(articles)}</section>`,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(finalHtml);
  } catch (error) {
    console.error('blog-list HTML error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}