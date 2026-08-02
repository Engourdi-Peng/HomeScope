/**
 * URL / identity utilities for Zillow listings.
 *
 * Strict separation of concerns:
 *   - normalizePath: lowercase, decoded, query/hash-stripped — used ONLY for internal
 *     comparison and listing identity matching. NEVER for canonical URLs.
 *   - getCanonicalListingUrl: returns the full origin + decoded pathname, stripped of
 *     query/hash and trailing slash. Preserves original URL case. NEVER lowercased.
 *   - extractZpidFromUrl: matches `/<digits>_zpid(/|$)` and tolerates trailing slashes.
 *   - extractApartmentTailId: matches `/apartments/<city>-<state>/<slug>/<id>/`.
 *   - buildListingIdentity: priority zpid → buildingId → apartment tail → normalized path.
 */

export function normalizePath(url: string): string {
  try {
    const parsed = new URL(url);
    let path = decodeURIComponent(parsed.pathname).replace(/\/+$/, '').toLowerCase();
    return path || '/';
  } catch {
    return '';
  }
}

export function extractZpidFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    return pathname.match(/\/(\d+)_zpid(?:\/|$)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Apartments use `/apartments/<city>-<state>/<slug>/<id>/` where `<id>` is the
 * stable Zillow apartment building ID (e.g. `CgzFQT`). Fallback for URL forms
 * without an explicit zpid or _rpid segment.
 */
export function extractApartmentTailId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\/apartments\/[^/]+\/[^/]+\/([^/]+)\/?$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the building ID from a /b/<buildingId>/ URL.
 * /b/ URLs use a shorter alphanumeric building identifier (e.g. "CgzFQT").
 */
export function extractBuildingIdFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/^\/b\/([^/]+)\/?$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Canonical listing URL — origin + decoded pathname, no query/hash, no trailing slash.
 * Preserves the original case of the pathname (does NOT lowercase). Returns '' on parse failure.
 * Use this for `listingUrl` in StandardizedListingData and for backend persistence.
 */
export function getCanonicalListingUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

export function buildListingIdentity(ctx: {
  url: string;
  zpid?: string | null;
  buildingId?: string | null;
}): string {
  const zpid = ctx.zpid ?? extractZpidFromUrl(ctx.url);
  const aptId = extractApartmentTailId(ctx.url) ?? extractBuildingIdFromUrl(ctx.url);
  const norm = normalizePath(ctx.url);
  const id = zpid ?? ctx.buildingId ?? aptId ?? norm ?? 'unknown';
  return `zillow:${id}`;
}