/**
 * Vercel Serverless Function - Dynamic Share Page SEO
 * 
 * Handles requests with slug as query parameter
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseAddress } from '../shared/address/index.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
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

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

async function fetchSEOData(slug: string): Promise<SEOData | null> {
  try {
    // Query by share_slug field
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/analyses?share_slug=eq.${encodeURIComponent(slug)}&is_public=eq.true&select=address,seo_title,seo_description,cover_image_url,summary,full_result`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'application/json',
        },
      }
    );
    if (!response.ok) return null;
    const analyses = await response.json();
    if (!analyses || analyses.length === 0) return null;

    const analysis = analyses[0];
    const parsed = parseAddress(analysis.address);
    const suburb = parsed.suburb;
    const title = analysis.seo_title || null;
    const description = analysis.seo_description || null;

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

    const finalTitle = title || generateTitle(suburb, bedrooms);
    const finalDesc = description || generateDescription(suburb, bedrooms);

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

function buildSEOHtml(defaultHtml: string, seo: SEOData, slug: string): string {
  const { title, description, ogImage } = seo;
  const escapedTitle = escapeHtml(title);
  const escapedDesc = escapeHtml(description);
  const canonicalUrl = `${SITE_URL}/share/${slug}`;
  const escapedCanonical = escapeHtml(canonicalUrl);
  const ogImageUrl = ogImage || `${SITE_URL}/og-default.png`;
  const escapedOgImage = escapeHtml(ogImageUrl);

  let html = defaultHtml;

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapedTitle}</title>`);
  html = html.replace(
    /<meta\s+name=["']description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="description" content="${escapedDesc}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:title["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:title" content="${escapedTitle}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:description" content="${escapedDesc}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:image["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:image" content="${escapedOgImage}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:url["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:url" content="${escapedCanonical}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:type["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:type" content="article" />`
  );
  html = html.replace(
    /<meta\s+name=["']twitter:title["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:title" content="${escapedTitle}" />`
  );
  html = html.replace(
    /<meta\s+name=["']twitter:description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:description" content="${escapedDesc}" />`
  );
  html = html.replace(
    /<meta\s+name=["']twitter:image["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:image" content="${escapedOgImage}" />`
  );
  if (!html.includes('rel="canonical"')) {
    html = html.replace('</head>', `<link rel="canonical" href="${escapedCanonical}" /></head>`);
  }
  if (!html.includes('name="robots"')) {
    html = html.replace('</head>', `<meta name="robots" content="index,follow" /></head>`);
  }

  return html;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Support both query param and route param
  const slugParam = req.query?.slug;
  const slug = typeof slugParam === 'string' ? slugParam : String(slugParam || '');
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }

  console.log('Fetching SEO data for slug:', slug);

  const seoData = await fetchSEOData(slug);

  if (!seoData || !seoData.exists) {
    console.log('SEO data not found for slug:', slug);
    return res.status(404).json({ error: 'Analysis not found' });
  }

  try {
    console.log('Fetching index.html from:', `${SITE_URL}/index.html`);
    const indexResponse = await fetch(`${SITE_URL}/index.html`);
    let html = await indexResponse.text();
    html = buildSEOHtml(html, seoData, slug);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
