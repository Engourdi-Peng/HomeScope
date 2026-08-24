/**
 * Vercel Serverless Function - Share Page SEO HTML Renderer
 *
 * Hits:
 *   - GET /api/share?slug=<slug>     (current rewrite)
 *   - GET /api/share/<slug>           (future rewrite if added)
 *
 * Fetches analysis data from Supabase and renders the SPA shell with
 * injected dynamic meta tags. Returns a hard 404 when the slug is not
 * found, so search engines don't index soft-404 pages.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseAddress } from '../shared/address/index.js';
import { buildNotFoundHtml, injectSeoTags } from '../shared/seoHtml.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

interface SEOData {
  title: string;
  description: string;
  ogImage: string | null;
  suburb: string | null;
  bedrooms: number | null;
  exists: boolean;
}

function generateTitle(suburb: string | null, bedrooms: number | null): string {
  if (suburb && bedrooms) {
    return `Is this rental worth it in ${suburb}? ${bedrooms} bedroom analysis | HomeScope`;
  } else if (suburb) {
    return `Is this rental worth it in ${suburb}? Rental analysis | HomeScope`;
  } else if (bedrooms) {
    return `Is this rental worth it? ${bedrooms} bedroom analysis | HomeScope`;
  }
  return 'Is this rental worth it? Rental analysis | HomeScope';
}

function generateDescription(suburb: string | null, bedrooms: number | null): string {
  if (suburb && bedrooms) {
    return `AI rental analysis of a ${bedrooms}-bedroom property in ${suburb}. Discover pros, cons, hidden risks and whether it's worth applying.`;
  } else if (bedrooms) {
    return `AI rental analysis of a ${bedrooms}-bedroom property. Discover pros, cons, hidden risks and whether it's worth applying.`;
  }
  return "AI-powered rental property analysis. Discover pros, cons, hidden risks and whether it's worth applying.";
}

async function fetchSEOData(slug: string): Promise<SEOData | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/analyses?share_slug=eq.${encodeURIComponent(slug)}&is_public=eq.true&select=address,seo_title,seo_description,cover_image_url,summary,full_result`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) return null;
    const analyses = await response.json();
    if (!analyses || analyses.length === 0) return null;

    const analysis = analyses[0];
    const parsed = parseAddress(analysis.address);
    const suburb = parsed.suburb;

    let bedrooms: number | null = null;
    const summary = analysis.summary || {};
    const fullResult = analysis.full_result || {};

    if (summary.bedrooms) {
      const match = String(summary.bedrooms).match(/(\d+)/);
      if (match) bedrooms = parseInt(match[1], 10);
    }
    if (!bedrooms && fullResult.roomCounts) {
      const count = fullResult.roomCounts['bedroom'] || fullResult.roomCounts['bedrooms'];
      if (count) bedrooms = count;
    }

    const finalTitle = analysis.seo_title || generateTitle(suburb, bedrooms);
    const finalDesc = analysis.seo_description || generateDescription(suburb, bedrooms);

    return {
      title: finalTitle,
      description: finalDesc,
      ogImage: analysis.cover_image_url || null,
      suburb,
      bedrooms,
      exists: true,
    };
  } catch (error) {
    console.error('Error fetching SEO data:', error);
    return null;
  }
}

function readSlug(req: VercelRequest): string {
  const param = req.query?.slug;
  if (typeof param === 'string') return param;
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0];
  return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const slug = readSlug(req);
  if (!slug) return res.status(400).json({ error: 'Missing slug' });

  const seoData = await fetchSEOData(slug);
  if (!seoData || !seoData.exists) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
    return res.status(404).send(buildNotFoundHtml('Property report not found or no longer public.'));
  }

  try {
    const indexResponse = await fetch(`${SITE_URL}/index.html`);
    if (!indexResponse.ok) throw new Error(`index.html ${indexResponse.status}`);
    const html = await indexResponse.text();

    const finalHtml = injectSeoTags(html, {
      title: seoData.title,
      description: seoData.description,
      canonicalUrl: `${SITE_URL}/share/${slug}`,
      ogImage: seoData.ogImage ?? undefined,
      ogType: 'article',
      robots: 'index,follow',
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(finalHtml);
  } catch (error) {
    console.error('Error rendering share HTML:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}