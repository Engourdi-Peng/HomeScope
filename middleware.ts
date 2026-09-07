/**
 * Vercel Edge Middleware - Dynamic SEO for Share Pages
 *
 * Intercepts /share/* requests and injects dynamic meta tags
 * by fetching SEO data from Supabase at request time.
 *
 * Uses Web Fetch APIs + @vercel/functions (not next/server — Vite SPA).
 */

import { next } from '@vercel/functions';
import { parseAddress } from './shared/address/index.js';
import { buildNotFoundHtml, injectSeoTags } from './shared/seoHtml.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

/**
 * Extract suburb from a US-style address format.
 * @deprecated Use parseAddress from shared/address instead
 */
function extractSuburbFromAddress(address: string | null | undefined): string | null {
  return parseAddress(address).suburb;
}

function generateSEOTitle(suburb: string | null, bedrooms: number | null): string {
  if (suburb && bedrooms) {
    return `Is this rental worth it in ${suburb}? ${bedrooms} bedroom analysis | HomeScope`;
  } else if (suburb) {
    return `Is this rental worth it in ${suburb}? Rental analysis | HomeScope`;
  }
  return 'Is this rental worth it? Rental analysis | HomeScope';
}

function generateSEODescription(suburb: string | null, bedrooms: number | null): string {
  if (suburb && bedrooms) {
    return `AI rental analysis of a ${bedrooms}-bedroom property in ${suburb}. Discover pros, cons, hidden risks and whether it's worth applying.`;
  } else if (bedrooms) {
    return `AI rental analysis of a ${bedrooms}-bedroom property. Discover pros, cons, hidden risks and whether it's worth applying.`;
  }
  return 'AI-powered rental property analysis. Discover pros, cons, hidden risks and whether it\'s worth applying.';
}

async function fetchSEOData(slug: string): Promise<{
  title: string;
  description: string;
  suburb: string | null;
  bedrooms: number | null;
  exists: boolean;
} | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/analyses?share_slug=eq.${encodeURIComponent(slug)}&is_public=eq.true&select=address,seo_title,seo_description,summary,full_result`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!response.ok) return null;

    const analyses = await response.json();
    if (!analyses || analyses.length === 0) return null;

    const analysis = analyses[0];

    let title = analysis.seo_title || null;
    let description = analysis.seo_description || null;
    const suburb = extractSuburbFromAddress(analysis.address);

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

    if (!title) title = generateSEOTitle(suburb, bedrooms);
    if (!description) description = generateSEODescription(suburb, bedrooms);

    return { title, description, suburb, bedrooms, exists: true };
  } catch (error) {
    console.error('Error fetching SEO data:', error);
    return null;
  }
}

export const config = {
  matcher: ['/share/:slug*', '/tools/realestate-com-au', '/tools/realestate-com-au/:path*'],
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method !== 'GET') return next();

  // 301 redirect: /tools/realestate-com-au -> /tools/zillow
  if (pathname === '/tools/realestate-com-au' || pathname.startsWith('/tools/realestate-com-au/')) {
    return Response.redirect(new URL('/tools/zillow', url.origin), 301);
  }

  const match = pathname.match(/^\/share\/(.+?)(\/.*)?$/);
  if (!match) return next();

  const slug = match[1];
  const seoData = await fetchSEOData(slug);

  // Hard 404 with explicit noindex when the slug is missing — this prevents
  // soft-404s from being treated as indexable empty pages by search engines.
  if (!seoData || !seoData.exists) {
    return new Response(
      buildNotFoundHtml('Property report not found or no longer public.'),
      {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow',
          'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=600',
        },
      }
    );
  }

  const indexUrl = new URL('/index.html', url.origin).toString();
  const response = await fetch(indexUrl);
  const html = await response.text();

  const modifiedHtml = injectSeoTags(html, {
    title: seoData.title,
    description: seoData.description,
    canonicalUrl: `${SITE_URL}/share/${slug}`,
    ogType: 'article',
    robots: 'index,follow',
  });

  return new Response(modifiedHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  });
}