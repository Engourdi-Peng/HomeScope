/**
 * Vercel Edge Middleware - Dynamic SEO for Share Pages
 * 
 * Intercepts /share/* requests and injects dynamic meta tags
 * by fetching SEO data from Supabase at request time.
 * 
 * This solves the SPA SEO problem where static index.html
 * doesn't include dynamic titles for each share page.
 * 
 * Uses Web Fetch APIs + @vercel/functions (not next/server — Vite SPA).
 */

import { next } from '@vercel/functions';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://www.tryhomescope.com';

/**
 * Extract suburb from Australian address format
 * e.g., "6 Edinburgh Street, Richmond, VIC 3121, AU" → "Richmond"
 */
function extractSuburbFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    const suburbCandidate = parts[1];
    if (suburbCandidate && /[a-zA-Z]/.test(suburbCandidate)) {
      const statePattern = /^(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s*\d{4}$/i;
      if (!statePattern.test(suburbCandidate)) {
        return suburbCandidate;
      }
    }
  }
  return null;
}

/**
 * Generate SEO title based on available data
 */
function generateSEOTitle(suburb: string | null, bedrooms: number | null): string {
  if (suburb && bedrooms) {
    return `Is this rental worth it in ${suburb}? ${bedrooms} bedroom analysis | HomeScope`;
  } else if (suburb) {
    return `Is this rental worth it in ${suburb}? Rental analysis | HomeScope`;
  }
  return 'Is this rental worth it? Rental analysis | HomeScope';
}

/**
 * Generate SEO description based on available data
 */
function generateSEODescription(suburb: string | null, bedrooms: number | null): string {
  if (suburb && bedrooms) {
    return `AI rental analysis of a ${bedrooms}-bedroom property in ${suburb}. Discover pros, cons, hidden risks and whether it's worth applying.`;
  } else if (bedrooms) {
    return `AI rental analysis of a ${bedrooms}-bedroom property. Discover pros, cons, hidden risks and whether it's worth applying.`;
  }
  return "AI-powered rental property analysis. Discover pros, cons, hidden risks and whether it's worth applying.";
}

/**
 * Fetch SEO data from Supabase for a given share slug
 */
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

    if (!response.ok) {
      return null;
    }

    const analyses = await response.json();
    if (!analyses || analyses.length === 0) {
      return null;
    }

    const analysis = analyses[0];
    
    // Try to use stored SEO data first
    let title = analysis.seo_title || null;
    let description = analysis.seo_description || null;
    
    // Extract from address if SEO fields not set
    const suburb = extractSuburbFromAddress(analysis.address);
    
    // Extract bedrooms from summary or full_result
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
    
    // Generate if not stored
    if (!title) {
      title = generateSEOTitle(suburb, bedrooms);
    }
    if (!description) {
      description = generateSEODescription(suburb, bedrooms);
    }

    return { title, description, suburb, bedrooms, exists: true };
  } catch (error) {
    console.error('Error fetching SEO data:', error);
    return null;
  }
}

/**
 * Escape HTML special characters
 */
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

/**
 * Inject dynamic meta tags into HTML response
 */
function injectMetaTags(html: string, title: string, description: string, url: string): string {
  // Replace title
  html = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(title)}</title>`
  );
  
  // Replace description meta tag
  html = html.replace(
    /<meta\s+name=["']description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="description" content="${escapeHtml(description)}" />`
  );
  
  // Replace og:title
  html = html.replace(
    /<meta\s+property=["']og:title["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(title)}" />`
  );
  
  // Replace og:description
  html = html.replace(
    /<meta\s+property=["']og:description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(description)}" />`
  );
  
  // Replace twitter:title if exists
  html = html.replace(
    /<meta\s+name=["']twitter:title["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`
  );
  
  // Replace twitter:description if exists
  html = html.replace(
    /<meta\s+name=["']twitter:description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`
  );
  
  // Add robots index,follow for share pages
  if (!html.includes('name="robots"')) {
    html = html.replace(
      '</head>',
      `<meta name="robots" content="index,follow" /></head>`
    );
  }

  if (!html.includes('rel="canonical"')) {
    html = html.replace(
      '</head>',
      `<link rel="canonical" href="${escapeHtml(url)}" /></head>`
    );
  }

  return html;
}

export const config = {
  matcher: '/share/:slug*',
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Only process GET requests
  if (request.method !== 'GET') {
    return next();
  }

  // Extract slug from /share/{slug}
  const match = pathname.match(/^\/share\/(.+?)(\/.*)?$/);
  if (!match) {
    return next();
  }

  const slug = match[1];

  // Fetch SEO data from Supabase
  const seoData = await fetchSEOData(slug);

  // If no SEO data found, let the page handle it (will show error)
  if (!seoData || !seoData.exists) {
    return next();
  }

  // Build the absolute URL for fetching index.html
  const indexUrl = new URL('/index.html', url.origin).toString();

  // Fetch the static index.html
  const response = await fetch(indexUrl);
  const html = await response.text();

  // Inject dynamic meta tags
  const modifiedHtml = injectMetaTags(
    html,
    seoData.title,
    seoData.description,
    `${SITE_URL}/share/${slug}`
  );

  // Return modified HTML response with caching headers
  return new Response(modifiedHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
