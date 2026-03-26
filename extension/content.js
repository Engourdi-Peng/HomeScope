/**
 * HomeScope Content Script
 *
 * EXTRACTION POLICY: User-triggered only.
 * - No automatic image collection on page load, DOM mutation, tab activation, or side panel open.
 * - Gallery image extraction is ONLY permitted via the START_USER_EXTRACTION message handler.
 * - EXTRACT_LISTING / GET_PAGE_STATE only perform lightweight page sensing.
 *
 * Auth bridge (ONLY auth-related code in this file):
 *   - Listens for HOMESCOPE_PUSH_SESSION_TO_EXTENSION messages from AuthCallback.tsx
 *   - Forwards the session payload to background via sync_session_from_site
 */

// ===== Injected config (replaced by vite at build time) =====
const AUTH_BRIDGE_SOURCE = __AUTH_BRIDGE_SOURCE__;

// ── Auth bridge: forward session from website to background ──
console.log('[HomeScope CS] Content script loaded, page URL:', window.location.href, 'origin:', window.location.origin);

window.addEventListener('message', (event) => {
  console.log('[HomeScope CS] window.message event received:');
  console.log('[HomeScope CS]   event.origin:', event.origin);
  console.log('[HomeScope CS]   event.data:', JSON.stringify(event.data));
  console.log('[HomeScope CS]   event.source === window:', event.source === window);

  if (event.source !== window) {
    console.log('[HomeScope CS]   → filtered: event.source !== window (not from same frame)');
    return;
  }

  const d = event.data;
  if (!d) {
    console.log('[HomeScope CS]   → filtered: no event.data');
    return;
  }

  if (d.source !== AUTH_BRIDGE_SOURCE) {
    console.log('[HomeScope CS]   → filtered: wrong source, expected:', AUTH_BRIDGE_SOURCE, 'got:', d.source);
    return;
  }

  if (d.type !== 'HOMESCOPE_PUSH_SESSION_TO_EXTENSION') {
    console.log('[HomeScope CS]   → filtered: wrong type, expected: HOMESCOPE_PUSH_SESSION_TO_EXTENSION');
    return;
  }

  console.log('[HomeScope CS] ✓ MATCHED: HOMESCOPE_PUSH_SESSION_TO_EXTENSION, forwarding to background...');
  console.log('[HomeScope CS]   payload access_token exists:', !!(d.payload && d.payload.access_token));
  console.log('[HomeScope CS]   payload user exists:', !!(d.payload && d.payload.user));

  chrome.runtime.sendMessage(
    { action: 'sync_session_from_site', payload: d.payload },
    (response) => {
      if (response?.success) {
        console.log('[HomeScope CS] sync_session_from_site: SUCCESS, userId=', response.user?.id);
      } else {
        console.error('[HomeScope CS] sync_session_from_site: FAILED —', response?.error);
      }
    }
  );
});

// ─────────────────────────────────────────────────────────────
// User-triggered extraction session state
// ─────────────────────────────────────────────────────────────

let isReady = false;
let pageData = null;
let propertySignals = null;

/**
 * Extraction session lock — prevents concurrent extraction sessions.
 * Only START_USER_EXTRACTION can hold this lock.
 */
let _extractionLock = false;

/**
 * In-memory URL result cache (key=listingUrl).
 * Stores the last extraction result for the current URL for SESSION_CACHE_TTL_MS.
 * Enables "reuse last result" when the same URL is re-analysed without re-crawling.
 */
const _sessionCache = new Map();
const SESSION_CACHE_TTL_MS = 20 * 1000;

// ─────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;
  switch (action) {
    case 'PONG':
      sendResponse({ ready: true, url: window.location.href, title: document.title });
      break;

    case 'GET_PAGE_STATE':
      // Lightweight page sensing only — never triggers gallery extraction.
      sendResponse(getPageState());
      break;

    case 'EXTRACT_LISTING':
      // Lightweight extraction: title/address/price/rooms/description only, NO gallery images.
      extractListingDataLight().then(({ listing, detection }) => {
        pageData = listing;
        sendResponse({ data: listing, error: null, detection });
      })
        .catch((err) => { sendResponse({ data: null, error: err.message, detection: null }); });
      return true;

    case 'START_USER_EXTRACTION':
      // EXCLUSIVE gateway for full gallery extraction.
      // Only one session can run at a time (locked by _extractionLock).
      startUserExtraction(message.bypassCache).then(({ listing, detection }) => {
        pageData = listing;
        sendResponse({ success: true, data: listing, detection });
      })
        .catch((err) => {
          sendResponse({ success: false, error: err.message, code: err.code || 'EXTRACTION_ERROR' });
        });
      return true;

    case 'GET_CACHED_DATA':
      sendResponse({ success: true, data: pageData });
      break;

    default:
      sendResponse({ success: false, error: 'UNKNOWN_ACTION' });
  }
});

// ─────────────────────────────────────────────────────────────
// User-triggered extraction entry point
// ─────────────────────────────────────────────────────────────

/**
 * Full user-triggered extraction session.
 * This is the ONLY function that opens PhotoSwipe and collects gallery images.
 *
 * Flow:
 *   1. Check _extractionLock → reject if already running
 *   2. Check in-memory URL cache → return cached result if fresh and bypassCache=false
 *   3. Extract lightweight data (title/address/price/rooms/description)
 *   4. Open PhotoSwipe gallery
 *   5. Collect all images via PhotoSwipe paging
 *   6. Assemble complete listing payload
 *   7. Store in _sessionCache (TTL = SESSION_CACHE_TTL_MS)
 *   8. Release lock and return result
 *
 * @param {boolean} bypassCache - If true, ignore the in-memory URL cache and re-extract.
 * @returns {Promise<{listing: object, detection: object}>}
 */
async function startUserExtraction(bypassCache = false) {
  if (_extractionLock) {
    const err = new Error('Extraction already in progress');
    err.code = 'EXTRACTION_IN_PROGRESS';
    throw err;
  }

  _extractionLock = true;

  try {
    const listingUrl = window.location.href;

    // ── Step: Check in-memory URL cache ──
    if (!bypassCache) {
      const cached = _sessionCache.get(listingUrl);
      if (cached && Date.now() - cached._cachedAt < SESSION_CACHE_TTL_MS) {
        console.log('[HomeScope CS] startUserExtraction: cache hit for', listingUrl);
        return cached;
      }
    }

    // ── Step: Extract lightweight data (no gallery images) ──
    const { listing: lightListing, detection: lightDetection } = await extractListingDataLight();

    // ── Step: Open PhotoSwipe gallery ──
    console.log('[HomeScope CS] startUserExtraction: opening gallery...');
    const opened = await openGallery();
    if (!opened) {
      console.log('[HomeScope CS] startUserExtraction: gallery open failed, returning without images');
      // No gallery available — return listing with empty images
      const result = { listing: { ...lightListing, imageUrls: [] }, detection: lightDetection };
      _sessionCache.set(listingUrl, result);
      return result;
    }

    // ── Step: Collect images via PhotoSwipe paging ──
    console.log('[HomeScope CS] startUserExtraction: collecting photos via PhotoSwipe...');
    const imageUrls = await collectByPhotoSwipePaging();
    console.log('[HomeScope CS] startUserExtraction: collected', imageUrls.length, 'photos');

    // ── Step: Build complete listing ──
    const listing = {
      ...lightListing,
      imageUrls,
    };
    const detection = buildPropertyDetection(propertySignals, listing);
    const result = { listing, detection };

    // ── Step: Store in session cache ──
    result._cachedAt = Date.now();
    _sessionCache.set(listingUrl, result);

    return result;
  } finally {
    _extractionLock = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Lightweight extraction (no gallery access)
// ─────────────────────────────────────────────────────────────

/**
 * Extracts listing metadata only — title, address, price, rooms, description.
 * Does NOT open PhotoSwipe or collect any gallery images.
 */
async function extractListingDataLight() {
  const signals = detectPropertySignals();
  propertySignals = signals;
  const title = extractTitle();
  const address = extractAddress();
  const price = extractPrice();
  const rooms = extractRooms();
  const description = extractDescription();

  // NOTE: imageUrls is intentionally empty here — gallery collection is
  // only done via startUserExtraction() triggered by the user.
  let confidence = 0;
  if (title) confidence += 0.2;
  if (address) confidence += 0.2;
  if (price) confidence += 0.2;
  if (rooms.bedrooms) confidence += 0.15;
  if (description) confidence += 0.15;
  const pricePeriod = inferPricePeriod(price);

  const listing = {
    source: { url: window.location.href, domain: window.location.hostname, parserType: 'generic' },
    title, address,
    price: price || '',
    priceText: price,
    pricePeriod,
    bedrooms: rooms.bedrooms,
    bathrooms: rooms.bathrooms,
    parking: rooms.parking,
    description,
    imageUrls: [],   // gallery images only collected on user request
    extractionConfidence: confidence,
  };
  const detection = buildPropertyDetection(signals, listing);
  return { listing, detection };
}

// ─────────────────────────────────────────────────────────────
// Page state (lightweight sensing — no gallery access)
// ─────────────────────────────────────────────────────────────

function getPageState() {
  const signals = detectPropertySignals();
  propertySignals = signals;
  const detection = buildPropertyDetection(signals, {
    title: document.title,
    imageCount: signals.imageCount,
    address: signals.hasAddress,
    price: signals.hasPrice,
  });
  return {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    isPropertyLike: signals.confidence > 0.3,
    extractionStage: 'initial',
    basicSignals: signals,
    basicDetectedSignals: signals,
    detection,
  };
}

// ─────────────────────────────────────────────────────────────
// Property signal detection (lightweight DOM scan)
// ─────────────────────────────────────────────────────────────

function detectPropertySignals() {
  const signals = [];
  let confidence = 0;
  const images = document.querySelectorAll('img');
  const propertyImages = Array.from(images).filter((img) => {
    const src = img.src || img.dataset.src || '';
    return src && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar');
  });
  if (propertyImages.length >= 3) { signals.push('images'); confidence += 0.25; }
  else if (propertyImages.length >= 1) confidence += 0.1;
  const pricePatterns = [/\$\d+/, /\d+[\d,]*\s*(?:per|weekly|week|pw|pcm|month)/i, /(?:price|cost|rent)/i];
  const hasPrice = pricePatterns.some((p) => document.body.innerText.match(p));
  if (hasPrice) { signals.push('price'); confidence += 0.2; }
  const addressPatterns = [/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s*[A-Z]{2,4}\s*\d{4}/, /\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/];
  const hasAddress = addressPatterns.some((p) => document.body.innerText.match(p));
  if (hasAddress) { signals.push('address'); confidence += 0.2; }
  const roomPatterns = [/\d+\s*(?:bed|bedroom|bedrooms)/i, /\d+\s*(?:bath|bathroom|bathrooms)/i, /\d+\s*(?:car|parking|garage)/i];
  const roomMatches = roomPatterns.reduce((count, p) => { return count + (document.body.innerText.match(p) ? 1 : 0); }, 0);
  if (roomMatches >= 2) { signals.push('rooms'); confidence += 0.2; }
  else if (roomMatches >= 1) confidence += 0.1;
  const descSelectors = ['[class*="description"]', '[class*="detail"]', '[class*="content"]', 'p'];
  let hasDescription = false;
  for (const sel of descSelectors) { const el = document.querySelector(sel); if (el && el.textContent.length > 100) { hasDescription = true; break; } }
  if (hasDescription) { signals.push('description'); confidence += 0.15; }
  let tier = 'low';
  if (confidence >= 0.6) tier = 'high';
  else if (confidence >= 0.4) tier = 'medium';
  else if (confidence >= 0.2) tier = 'partial';
  return {
    imageCount: propertyImages.length,
    hasPrice, hasAddress,
    hasBedrooms: roomPatterns[0].test(document.body.innerText),
    hasBathrooms: roomPatterns[1].test(document.body.innerText),
    hasParking: roomPatterns[2].test(document.body.innerText),
    hasDescription,
    confidence, tier, signals,
  };
}

function buildPropertyDetection(signals, listing) {
  let score = signals.confidence;
  if (listing?.title && String(listing.title).trim().length > 8) score += 0.08;
  if (listing?.address) score += 0.08;
  if (listing?.price) score += 0.12;
  const nImg =
    typeof listing?.imageCount === 'number'
      ? listing.imageCount
      : (listing?.imageUrls?.length ?? 0);
  if (nImg >= 1) score += 0.05;
  if (nImg >= 3) score += 0.08;
  score = Math.min(score, 0.99);
  let tier = 'none';
  if (score >= 0.45) tier = 'full';
  else if (score >= 0.22) tier = 'partial';
  const canAnalyze =
    score >= 0.3 &&
    !!(listing?.title || listing?.address || listing?.price || nImg >= 1 || signals.hasPrice || signals.imageCount >= 1);
  return { score, signals: signals.signals, tier, canAnalyze };
}

// ─────────────────────────────────────────────────────────────
// Text extractors (used by both light and full extraction)
// ─────────────────────────────────────────────────────────────

function extractTitle() {
  const selectors = ['h1', '[class*="title"]', '[class*="heading"]', 'meta[property="og:title"]', 'meta[name="title"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = sel.includes('meta') ? el.getAttribute('content') : el.textContent;
      if (text && text.trim().length > 5) return text.trim();
    }
  }
  return document.title;
}

function extractAddress() {
  const addressPatterns = [/(\d+[\s,]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3},\s*[A-Z]{2,4}\s*\d{4})/, /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s*[A-Z]{2,4})/];
  for (const pattern of addressPatterns) {
    const match = document.body.innerText.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

function extractPrice() {
  const raw = document.body.innerText;
  const pricePatterns = [
    /[\u0024\uff04]\s*[\d,]+(?:\.\d+)?\s*(?:per\s+)?(?:week|weekly|pw|w\/k)/gi,
    /[\u0024\uff04]\s*[\d,]+(?:\.\d+)?\s*(?:per\s+)?(?:month|pcm|mth)/gi,
    /[\u0024\uff04]\s*[\d,]+(?:\.\d+)?\s*(?:per\s+)?(?:week|pw|pcm|month)?/gi,
    /[\d,]+(?:\.\d+)?\s*(?:per\s+)?(?:week|weekly|pw|pcm|month)/gi,
  ];
  const rentHints = /rent|lease|p\.?w\.?|per\s*week/i;
  for (const pattern of pricePatterns) {
    const matches = raw.match(pattern);
    if (!matches || !matches.length) continue;
    const withHint = matches.find((m) => rentHints.test(m));
    if (withHint) return withHint.trim();
    return matches[0].trim();
  }
  return null;
}

function extractRooms() {
  const text = document.body.innerText;
  const result = { bedrooms: null, bathrooms: null, parking: null };
  const bedMatch = text.match(/(\d+)\s*(?:bed|bedroom|bedrooms)/i);
  if (bedMatch) result.bedrooms = parseInt(bedMatch[1], 10);
  const bathMatch = text.match(/(\d+)\s*(?:bath|bathroom|bathrooms)/i);
  if (bathMatch) result.bathrooms = parseInt(bathMatch[1], 10);
  const carRe = /(\d+)\s*(?:car(?:port|space)?s?|parking|garage)\b/gi;
  const carVals = [];
  let cm;
  while ((cm = carRe.exec(text)) !== null) { const n = parseInt(cm[1], 10); if (n >= 1 && n <= 20) carVals.push(n); }
  if (carVals.length) result.parking = Math.max(...carVals);
  return result;
}

function extractDescription() {
  const descSelectors = ['[class*="description"]', '[class*="detail"]', '[class*="about"]', '[class*="content"]', 'article', 'main p'];
  for (const sel of descSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.length > 80) {
      const text = el.textContent.trim();
      if (text.length > 80 && !text.toLowerCase().includes('cookie') && !text.toLowerCase().includes('sign in') && !text.toLowerCase().includes('login')) {
        return text.slice(0, 5000);
      }
    }
  }
  return null;
}

function inferPricePeriod(priceStr) {
  if (!priceStr) return 'unknown';
  const t = String(priceStr).toLowerCase();
  if (t.includes('week') || t.includes('pw') || t.includes('/w')) return 'week';
  if (t.includes('month') || t.includes('pcm') || t.includes('/m')) return 'month';
  if (t.includes('year') || t.includes('annum') || t.includes('/y')) return 'year';
  return 'unknown';
}

// ════════════════════════════════════════════════════════
// PhotoSwipe helper functions
// ════════════════════════════════════════════════════════

/**
 * Poll until PhotoSwipe is detected or timeout.
 */
async function waitForPhotoSwipe(timeoutMs = 3000) {
  const start = Date.now();
  const poll = () => {
    if (
      document.querySelector('.pswp') ||
      document.querySelector('.pswp__img') ||
      document.querySelector('[style*="position:fixed"][style*=".pswp__container"]')
    ) return true;
    return false;
  };
  while (Date.now() - start < timeoutMs) {
    if (poll()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

/**
 * Extract contentId from reastatic CDN URL.
 */
function extractContentId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/([a-f0-9]{8,})\/image\.(?:jpg|jpeg|webp|png)/i);
  if (m) return m[1];
  const m2 = url.match(/\/([a-f0-9]{6,})\//);
  if (m2) return m2[1];
  return null;
}

/**
 * Check if URL is a placeholder/invalid image.
 */
function isPlaceholderUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const u = url.toLowerCase();
  const patterns = [
    'placeholder', '.svg', '/logo', '/icon', '/avatar', '200x200-crop',
    '/main.png', 'blank.gif', 'data:image',
    '/360x270/', '/340x64/', '/doraexplorer',
  ];
  return patterns.some(p => u.includes(p));
}

/**
 * Get the currently active slide's main image element.
 * Uses .pswp__item with .pswp--active (or aria-hidden="false") as the anchor.
 * Falls back to the largest non-placeholder visible img if no active slide found.
 */
function getVisiblePhotoSwipeImage() {
  // Strategy 1: find the active slide container via .pswp--active class
  const activeItems = document.querySelectorAll('.pswp__item.pswp--active');
  if (activeItems.length === 1) {
    const imgs = activeItems[0].querySelectorAll('.pswp__img');
    if (imgs.length) return imgs[0];
  }

  // Strategy 2: find the item NOT hidden by aria-hidden
  const allItems = document.querySelectorAll('.pswp__item');
  for (const item of allItems) {
    const aria = item.getAttribute('aria-hidden');
    if (aria === 'false') {
      const imgs = item.querySelectorAll('.pswp__img');
      if (imgs.length) return imgs[0];
    }
  }

  // Strategy 3: fallback — largest visible img
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const imgs = Array.from(document.querySelectorAll('.pswp__img'));
  if (!imgs.length) return null;

  return imgs
    .map(img => {
      const style = window.getComputedStyle(img);
      const opacity = parseFloat(style.opacity);
      const rect = img.getBoundingClientRect();
      const visible = opacity > 0 && rect.width >= 24 && rect.height >= 24;
      const inViewport = rect.left < viewportW && rect.right > 0 &&
                          rect.top < viewportH && rect.bottom > 0;
      const area = rect.width * rect.height;
      return { img, visible, inViewport, opacity, area, rect };
    })
    .sort((a, b) => {
      if (a.visible !== b.visible) return a.visible ? -1 : 1;
      if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
      if (a.opacity !== b.opacity) return b.opacity - a.opacity;
      return b.area - a.area;
    })[0]?.img || null;
}

/**
 * Get DOM path for a given element (for logging).
 */
function getElementPath(el) {
  if (!el || !el.tagName) return '';
  const parts = [];
  while (el && el.tagName) {
    let name = el.tagName.toLowerCase();
    if (el.id) { name += '#' + el.id; el = null; }
    else if (el.className && typeof el.className === 'string' && el.className.trim()) {
      const cls = el.className.trim().split(/\s+/)[0].substring(0, 20);
      name += '.' + cls;
    }
    parts.unshift(name);
    if (el.parentElement && el.parentElement.tagName !== 'HTML') {
      el = el.parentElement;
    } else { break; }
  }
  return parts.join(' > ');
}

/**
 * Find gallery button candidates (button/a/[role="button"] containing "photo" or "+N").
 */
function collectGalleryButtonCandidates() {
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const hits = [];
  for (const el of nodes) {
    const text = (el.innerText || '').trim();
    const aria = (el.getAttribute('aria-label') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    if (
      /photo/i.test(text) ||
      /photo/i.test(aria) ||
      /photo/i.test(title) ||
      /^\+\d+$/.test(text)
    ) {
      hits.push({ el, tagName: el.tagName.toLowerCase(), text, aria, title, className: (el.className || '').toString().substring(0, 80) });
    }
  }
  return hits;
}

/**
 * Open PhotoSwipe gallery by clicking gallery button candidates.
 * Returns true if PhotoSwipe is opened, false otherwise.
 */
async function openGallery() {
  const log = (msg, data) => console.log('[openGallery] ' + msg, typeof data === 'object' ? JSON.stringify(data) : data);

  if (document.querySelector('.pswp')) {
    log('PhotoSwipe already open, skipping');
    return true;
  }

  const hits = collectGalleryButtonCandidates();
  log('hits count: ' + hits.length);

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    log('click candidate #' + i + ' text="' + h.text + '"');

    try { h.el.click(); } catch (_) {
      try { h.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
    }

    await new Promise(r => setTimeout(r, 1200));

    if (document.querySelector('.pswp') || document.querySelector('.pswp__img')) {
      log('PhotoSwipe opened');
      return true;
    }
  }

  log('PhotoSwipe not opened');
  return false;
}

/**
 * Extract width number from URL (e.g. "/1200x800/").
 */
function extractWidthFromUrl(url) {
  if (!url) return 0;
  const m = url.match(/\/(\d+)x\d+(?:-resize|,\w+)?\//);
  if (m) return parseInt(m[1], 10);
  const m2 = url.match(/\/(\d+)px\//);
  if (m2) return parseInt(m2[1], 10);
  return 0;
}

function normalizeUrl(url) {
  try {
    return new URL(String(url || '').trim(), document.baseURI).href;
  } catch (_) {
    return String(url || '').trim();
  }
}

/**
 * Get reastatic CDN URL from an img element (handles srcset + lazy load).
 */
function getImgReastaticUrl(img) {
  if (!img || img.tagName !== 'IMG') return '';
  const u = (img.currentSrc || img.src || img.getAttribute('data-src') || '').trim();
  if (/reastatic\.(net|com\.au)/i.test(u)) return u;
  const ss = img.getAttribute('srcset');
  if (ss) {
    const parts = ss.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    for (const p of parts) {
      if (/reastatic\.(net|com\.au)/i.test(p)) return normalizeUrl(p);
    }
  }
  return '';
}

/**
 * Verify image URL resolves with real dimensions.
 */
function verifyImageUrl(url, _tag) {
  return new Promise((resolve) => {
    const u = normalizeUrl(url);
    if (!u || u.startsWith('data:') || u.startsWith('blob:')) {
      resolve({ ok: false });
      return;
    }
    const img = new Image();
    const done = (ok, naturalW, naturalH) => {
      clearTimeout(t);
      resolve(ok ? { ok: true, url: u, naturalW, naturalH } : { ok: false });
    };
    const t = setTimeout(() => done(false), 4500);
    img.onload = () => done(true, img.naturalWidth || 0, img.naturalHeight || 0);
    img.onerror = () => done(false);
    img.src = u;
  });
}

/**
 * Extract page address text (used for gallery anchoring).
 */
function extractPageAddress() {
  const selectors = [
    'h1', '[class*="address"]', '[class*="headline"]',
    'meta[property="og:title"]', 'meta[name="title"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const text = sel.includes('meta') ? (el.getAttribute('content') || '') : (el.textContent || '');
    const cleaned = text.trim().toLowerCase();
    if (cleaned.length > 10) return cleaned;
  }
  return null;
}

/**
 * realestate.com.au: find the main hero banner root containing reastatic images.
 */
function findRealestateBannerRoot() {
  const allImgs = document.querySelectorAll('picture img, img');
  let heroImg = null;
  let maxArea = 0;
  for (const img of allImgs) {
    const url = getImgReastaticUrl(img);
    if (!url) continue;
    const r = img.getBoundingClientRect();
    if (r.top < 0 || r.top > 1200) continue;
    const area = r.width * r.height;
    if (area > maxArea) { maxArea = area; heroImg = img; }
  }
  if (!heroImg) return null;

  let best = null;
  let el = heroImg;
  for (let i = 0; i < 18 && el; el = el.parentElement, i++) {
    const cls = (el.className || '').toLowerCase();
    if (!cls.includes('mosaic') && !cls.includes('hero') &&
        !cls.includes('gallery') && !cls.includes('media')) continue;
    const pics = el.querySelectorAll('picture img, img');
    let count = 0;
    for (const p of pics) { if (getImgReastaticUrl(p)) count++; }
    if (count < 3) continue;
    if (isInBlacklistAncestry(el)) continue;
    best = el;
  }
  return best;
}

/**
 * Find the main listing gallery root container.
 */
function findGalleryRoot() {
  // ── Anchor RE (highest priority): realestate.com.au banner ──
  if (/realestate\.com\.au/i.test(window.location.hostname)) {
    const bannerRoot = findRealestateBannerRoot();
    if (bannerRoot) return bannerRoot;
  }

  // ── Anchor RE (legacy fallback): hero/mosaic parent container ──
  const allImgs = document.querySelectorAll('picture img, img');
  const reastaticImgs = Array.from(allImgs).filter(img => !!getImgReastaticUrl(img));
  for (const img of reastaticImgs) {
    let el = img;
    for (let i = 0; i < 4 && el; el = el.parentElement, i++) {
      const cls = (el.className || '').toLowerCase();
      if (
        cls.includes('hero') ||
        cls.includes('mosaic') ||
        cls.includes('gallery__main') ||
        cls.includes('main-image') ||
        cls.includes('photo-gallery') ||
        cls.includes('listing-gallery') ||
        cls.includes('property-gallery')
      ) {
        if (!isInBlacklistAncestry(el)) return el;
      }
    }
  }

  // ── Anchor 1: button/link containing "N Images" or "+N" ──
  const photoBtnCandidates = document.querySelectorAll('button, a, [role="button"]');
  for (const el of photoBtnCandidates) {
    const text = (el.innerText || '').trim();
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (/^\d+\s*images?$/i.test(text) || /^\+\d+$/.test(text)) {
      const gallery = el.closest('[class*="gallery"], [class*="photo"], section, article, main');
      if (gallery) return gallery;
    }
    if (/image\s+\d+\s+of\s+\d+/i.test(aria)) {
      const gallery = el.closest('[class*="gallery"], [class*="photo"], section, article, main');
      if (gallery) return gallery;
    }
  }

  // ── Anchor 2: "image X of Y" text node ──
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (/image\s+\d+\s+of\s+\d+/i.test(node.textContent || '')) {
      const gallery = node.parentElement?.closest('[class*="gallery"], [class*="photo"], section, article, main');
      if (gallery) return gallery;
    }
  }

  // ── Anchor 3: "N Images" text node ──
  const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker2.nextNode()) {
    const node = walker2.currentNode;
    const t = (node.textContent || '').trim();
    if (/^\d+\s*images?$/i.test(t) && t.length < 30) {
      const gallery = node.parentElement?.closest('[class*="gallery"], [class*="photo"], section, article, main');
      if (gallery) return gallery;
    }
  }

  // ── Anchor 4: reastatic hero img ancestor ──
  const imgs = document.querySelectorAll('img[src]');
  for (const img of imgs) {
    const src = img.currentSrc || img.src || '';
    if (!/reastatic\.(net|com\.au)/.test(src)) continue;
    const area = img.getBoundingClientRect().width * img.getBoundingClientRect().height;
    if (area < 20000) continue;
    const gallery = img.closest('[class*="gallery"], [class*="photo"], section, article, main');
    if (gallery) return gallery;
  }

  // ── Fallback: section with "photos" class ──
  const sections = document.querySelectorAll('section[class*="photo"], [class*="gallery"]');
  for (const sec of sections) {
    const rect = sec.getBoundingClientRect();
    if (rect.width >= 300 && rect.height >= 200) return sec;
  }

  // ── Anchor 5: section with ≥4 reastatic large images ──
  const allSections = document.querySelectorAll('section, article, main, [class*="gallery"], [class*="photo"]');
  for (const sec of allSections) {
    const imgs = sec.querySelectorAll('img[src]');
    const realEstateImgs = Array.from(imgs).filter(img => {
      const src = img.currentSrc || img.src || '';
      return /reastatic\.(net|com\.au)/.test(src);
    });
    const largeOnes = realEstateImgs.filter(img => {
      const r = img.getBoundingClientRect();
      return r.width * r.height >= 20000;
    });
    if (largeOnes.length >= 4) {
      if (!isInBlacklistAncestry(sec)) return sec;
    }
  }

  // ── Anchor 6: aria-label container ──
  const ariaCandidates = document.querySelectorAll('[aria-label*="gallery" i], [aria-label*="photos" i], [aria-label*="photo gallery" i], [aria-live*="gallery" i]');
  for (const el of ariaCandidates) {
    const gallery = el.closest('section, article, main, [class*="gallery"], [class*="photo"]');
    if (gallery && !isInBlacklistAncestry(gallery)) {
      const rect = gallery.getBoundingClientRect();
      if (rect.width >= 300 && rect.height >= 200) return gallery;
    }
  }

  return null;
}

/**
 * Check if element is in a blacklisted recommendation/footer/ads area.
 */
function isInBlacklistAncestry(el) {
  if (!el || !el.className || typeof el.className !== 'string') return false;
  const cls = el.className.toLowerCase();
  const blacklist = [
    'footer-carousel', 'carousel-card', 'similar', 'recommended',
    'more-properties', 'agent-info', 'agency', 'enquiry', 'advertisement',
    'sponsored', 'promo', 'promotion',
  ];
  if (blacklist.some(k => cls.includes(k))) return true;

  let parent = el.parentElement;
  for (let i = 0; i < 6 && parent; i++, parent = parent.parentElement) {
    const pt = (parent.innerText || '').toLowerCase();
    const textAnchors = ['more properties from', 'discover insights', 'explore more', 'you may also like'];
    if (textAnchors.some(a => pt.includes(a))) return true;
  }
  return false;
}

/**
 * Decide if an image is worth keeping for the listing.
 */
function shouldKeepImage(img, pageAddress) {
  const cls = (img.className || '').toString();
  const src = getImgReastaticUrl(img);
  if (!src) return { keep: false, reason: 'empty-src' };
  if (isPlaceholderUrl(src)) return { keep: false, reason: 'placeholder' };

  const uiPatterns = ['branding', 'avatar', 'phone__link', 'doraexplorer'];
  if (uiPatterns.some(k => cls.includes(k))) return { keep: false, reason: 'ui-element' };

  if (isInBlacklistAncestry(img)) return { keep: false, reason: 'blacklist-ancestry' };

  const rect = img.getBoundingClientRect();
  if (rect.width < 64 || rect.height < 48) return { keep: false, reason: 'too-small' };

  const alt = (img.getAttribute('alt') || '').toLowerCase();
  const aria = (img.getAttribute('aria-label') || '').toLowerCase();
  const title = (img.getAttribute('title') || '').toLowerCase();
  const metaText = alt + aria + title;
  if (/image\s+\d+\s+of\s+\d+/i.test(metaText)) return { keep: true, reason: 'aria-image-of' };
  if (pageAddress && (alt.includes(pageAddress) || aria.includes(pageAddress))) return { keep: true, reason: 'address-match' };

  return { keep: true, reason: 'gallery-root' };
}

/**
 * Lightweight DOM gallery extraction (NO PhotoSwipe, NO webRequest).
 * Used as a fallback when gallery cannot be opened.
 */
function extractLightImageUrls() {
  const log = (msg, data) => console.log('[HomeScope Img] ' + msg, typeof data === 'object' ? JSON.stringify(data) : data);

  const out = [];
  const seen = new Set();
  const push = (raw, reason) => {
    const u = normalizeUrl(raw);
    if (!u || isPlaceholderUrl(u) || seen.has(u)) return false;
    seen.add(u);
    out.push({ url: u, reason });
    log('  keep: ' + (reason || '?') + ' -> ' + u.substring(0, 80));
    return true;
  };

  // og:image
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]']) {
    const m = document.querySelector(sel);
    const c = m?.getAttribute('content');
    if (c) push(c, 'og-image');
  }

  // Gallery root DOM scan
  const pageAddress = extractPageAddress();
  const galleryRoot = findGalleryRoot();

  if (galleryRoot) {
    log('galleryRoot found: ' + getElementPath(galleryRoot));
    log('pageAddress anchor: ' + (pageAddress || '(none)'));
  } else {
    log('galleryRoot not found, falling back to full-page scan');
  }

  const rootImgs = galleryRoot
    ? Array.from(galleryRoot.querySelectorAll('picture img, img')).filter(img => !!getImgReastaticUrl(img))
    : Array.from(document.querySelectorAll('picture img, img')).filter(img => !!getImgReastaticUrl(img));

  const scored = [];
  for (const img of rootImgs) {
    const { keep, reason } = shouldKeepImage(img, pageAddress);
    if (!keep) continue;
    const src = getImgReastaticUrl(img);
    const rect = img.getBoundingClientRect();
    scored.push({ src, area: rect.width * rect.height, reason });
  }

  scored.sort((a, b) => b.area - a.area);
  scored.filter(s => push(s.src, s.reason));

  log('=== extractLightImageUrls final: ' + out.length + ' images ===');
  return out.map(o => o.url).slice(0, 20);
}

// ════════════════════════════════════════════════════════
// PhotoSwipe image collection
// Only called from startUserExtraction() (user-triggered)
// ════════════════════════════════════════════════════════

let _pagingLock = false;

/**
 * Collect all gallery images via PhotoSwipe paging.
 * This function is ONLY reachable through the START_USER_EXTRACTION flow.
 *
 * @returns {Promise<string[]>} Deduplicated image URL array
 */
async function collectByPhotoSwipePaging() {
  if (_pagingLock) {
    console.log('[paging] Skipped (paging lock held)');
    return [];
  }
  _pagingLock = true;

  let result = [];
  try {
    const log = (msg, data) => console.log('[paging] ' + msg, typeof data === 'object' ? JSON.stringify(data) : data);

    if (!document.querySelector('.pswp')) {
      log('PhotoSwipe not open, returning empty');
      result = [];
    } else {
      log('Starting PhotoSwipe paging...');

      // ── Diagnostic: log gallery root structure ──
      const pswp = document.querySelector('.pswp');
      const pswpItems = pswp ? Array.from(pswp.querySelectorAll('.pswp__item')) : [];
      const allImgs = pswp ? Array.from(pswp.querySelectorAll('.pswp__img')) : [];
      log('pswp root: ' + (pswp ? getElementPath(pswp) : 'NOT FOUND'));
      log('pswp__item count: ' + pswpItems.length + ', pswp__img count: ' + allImgs.length);
      if (allImgs.length) {
        log('gallery img srcs: ' + allImgs.map(img => {
          const s = img.currentSrc || img.src || '';
          return s.substring(0, 120);
        }).join('\n  '));
      }

      // ── State ──
      const seenUrls = new Map();  // normalizedUrl -> true (for URL-based dedup)
      const seenIds  = new Map();  // contentId     -> true (for ID-based dedup)
      let firstUrl   = null;
      let prevUrl    = null;
      let consecutiveNoChange = 0;
      const MAX_ITER = 30;
      const NO_CHANGE_THRESHOLD = 3;  // stop only after 3 consecutive no-change

      /**
       * Extract image URL from the active slide.
       * Priority: active slide → active pswp__item → largest visible img.
       */
      function getActiveImageSrc() {
        // Check 1: .pswp__item.pswp--active
        const activeItems = document.querySelectorAll('.pswp__item.pswp--active');
        if (activeItems.length === 1) {
          const imgs = activeItems[0].querySelectorAll('.pswp__img');
          if (imgs.length) {
            const src = (imgs[0].currentSrc || imgs[0].src || '').trim();
            if (src && !src.startsWith('data:') && !src.startsWith('blob:')) return src;
          }
        }
        // Check 2: aria-hidden="false" item
        for (const item of document.querySelectorAll('.pswp__item')) {
          if (item.getAttribute('aria-hidden') === 'false') {
            const imgs = item.querySelectorAll('.pswp__img');
            if (imgs.length) {
              const src = (imgs[0].currentSrc || imgs[0].src || '').trim();
              if (src && !src.startsWith('data:') && !src.startsWith('blob:')) return src;
            }
          }
        }
        // Check 3: fallback to getVisiblePhotoSwipeImage (sorted by area/opacity)
        const fallback = getVisiblePhotoSwipeImage();
        return fallback ? ((fallback.currentSrc || fallback.src || '').trim()) : '';
      }

      /**
       * Determine the current active slide index from PhotoSwipe state.
       * Falls back to extracting from the DOM.
       */
      function getCurrentSlideIndex() {
        // PhotoSwipe stores its state on the DOM root
        const pswp = document.querySelector('.pswp');
        if (pswp && typeof pswp.dataset.pswpIndex !== 'undefined') {
          return parseInt(pswp.dataset.pswpIndex, 10);
        }
        // Fallback: count aria-hidden=false
        const items = document.querySelectorAll('.pswp__item');
        for (let i = 0; i < items.length; i++) {
          if (items[i].getAttribute('aria-hidden') === 'false') return i;
        }
        // Fallback: opacity sort
        const allImgs = Array.from(document.querySelectorAll('.pswp__img'));
        if (!allImgs.length) return 0;
        let best = allImgs[0], bestArea = 0;
        for (const img of allImgs) {
          const r = img.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea) { bestArea = area; best = img; }
        }
        const idx = Array.from(pswp.querySelectorAll('.pswp__img')).indexOf(best);
        return idx >= 0 ? idx : 0;
      }

      /**
       * Try to advance to the next slide.
       * Returns true if a next button/keyboard event was dispatched.
       */
      function clickNext() {
        // Priority 1: explicit next button
        const btn = document.querySelector('.pswp__button--arrow--next');
        if (btn && !btn.disabled && getComputedStyle(btn).display !== 'none') {
          log('clicking next button: ' + getElementPath(btn));
          btn.click();
          return true;
        }
        // Priority 2: any button with "next" in class
        const fallbackBtn = document.querySelector('[class*="pswp__button"][class*="next"]');
        if (fallbackBtn) {
          log('clicking fallback next button: ' + getElementPath(fallbackBtn));
          fallbackBtn.click();
          return true;
        }
        // Priority 3: keyboard ArrowRight on pswp root
        const pswpRoot = document.querySelector('.pswp');
        if (pswpRoot) {
          log('dispatching keyboard ArrowRight');
          pswpRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          return true;
        }
        // Priority 4: global keyboard fallback
        log('dispatching global keyboard ArrowRight');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        return true;
      }

      /**
       * Wait for the slide to actually change.
       * Polls until currentUrl changes OR slideIndex changes OR timeout.
       */
      async function waitForSlideChange(prevUrl, prevIndex, timeoutMs = 3000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const currentUrl = getActiveImageSrc();
          const currentIndex = getCurrentSlideIndex();
          if (currentUrl && currentUrl !== prevUrl) {
            log('slide changed: index ' + prevIndex + '→' + currentIndex + ', src updated');
            return { changed: true, newUrl: currentUrl, newIndex: currentIndex };
          }
          // Also detect loop-back to first image
          if (firstUrl && currentUrl === firstUrl && currentIndex === 0) {
            log('loop detected: back to first image (index=0)');
            return { changed: false, newUrl: currentUrl, newIndex: currentIndex, loopBack: true };
          }
          await new Promise(r => setTimeout(r, 120));
        }
        log('waitForSlideChange: TIMEOUT after ' + timeoutMs + 'ms, currentUrl=' + getActiveImageSrc());
        return { changed: false, newUrl: getActiveImageSrc(), newIndex: getCurrentSlideIndex() };
      }

      // ── Main paging loop ──
      for (let i = 0; i < MAX_ITER; i++) {
        const slideIndex = getCurrentSlideIndex();
        const url = getActiveImageSrc();
        log('--- iter ' + i + ' --- activeSlide=' + slideIndex + ', src=' + (url ? url.substring(0, 100) : '(empty)'));

        if (!url || url.startsWith('data:') || url.startsWith('blob:') || isPlaceholderUrl(url)) {
          log('current image is empty/placeholder, waiting for load...');
          await new Promise(r => setTimeout(r, 600));
          const recheckUrl = getActiveImageSrc();
          if (!recheckUrl || recheckUrl === url) {
            log('still empty after wait, skipping this iteration');
            consecutiveNoChange++;
            if (consecutiveNoChange >= NO_CHANGE_THRESHOLD) {
              log('STOP: ' + NO_CHANGE_THRESHOLD + ' consecutive no-change, breaking');
              break;
            }
            clickNext();
            await new Promise(r2 => setTimeout(r2, 600));
            continue;
          }
        }

        const norm = normalizeUrl(url);
        const cid  = extractContentId(norm);

        if (!firstUrl) firstUrl = norm;

        // Loop detection: back to first image
        if (firstUrl && norm === firstUrl && i > 0) {
          log('STOP: loop back to first image, i=' + i);
          break;
        }

        // URL-based dedup
        if (seenUrls.has(norm)) {
          log('duplicate URL skipped: ' + norm.substring(0, 80));
          consecutiveNoChange++;
          if (consecutiveNoChange >= NO_CHANGE_THRESHOLD) {
            log('STOP: ' + NO_CHANGE_THRESHOLD + ' consecutive no-new (URL dup), breaking');
            break;
          }
        } else {
          // ID-based dedup (if available) OR record by URL
          if (cid) {
            if (seenIds.has(cid)) {
              log('duplicate contentId skipped: ' + cid);
              consecutiveNoChange++;
              if (consecutiveNoChange >= NO_CHANGE_THRESHOLD) {
                log('STOP: ' + NO_CHANGE_THRESHOLD + ' consecutive no-new (id dup), breaking');
                break;
              }
            } else {
              seenUrls.set(norm, true);
              seenIds.set(cid, true);
              const w = extractWidthFromUrl(norm);
              result.push({ url: norm, width: w, id: cid });
              consecutiveNoChange = 0;
              log('RECORDED [' + result.length + ']: id=' + cid + ', width=' + w + ', url=' + norm.substring(0, 80));
            }
          } else {
            // No contentId — record by URL directly (fixes the null-cid dropping issue)
            seenUrls.set(norm, true);
            const w = extractWidthFromUrl(norm);
            result.push({ url: norm, width: w, id: null });
            consecutiveNoChange = 0;
            log('RECORDED [' + result.length + '] (no id): width=' + w + ', url=' + norm.substring(0, 80));
          }
        }

        // Navigate next
        prevUrl = url;
        clickNext();

        // Wait for slide to actually change
        const { changed, newUrl, loopBack } = await waitForSlideChange(prevUrl, slideIndex);
        if (loopBack) {
          log('STOP: loop-back detected after navigating');
          break;
        }
        if (!changed) {
          log('slide did NOT change after clickNext, consecutiveNoChange=' + (consecutiveNoChange + 1));
          // Don't increment again — already incremented above if dup
        }
      }

      // ── Build final result ──
      const deduped = [];
      const finalSeen = new Set();
      for (const item of result) {
        const key = item.url.split('?')[0].toLowerCase();
        if (!finalSeen.has(key)) {
          finalSeen.add(key);
          deduped.push(item.url);
        }
      }
      deduped.sort((a, b) => {
        const wa = extractWidthFromUrl(a);
        const wb = extractWidthFromUrl(b);
        return wb - wa;
      });

      log('=== FINAL RESULT: ' + deduped.length + ' unique images ===');
      log('URLs:\n' + deduped.map(u => '  ' + u.substring(0, 120)).join('\n'));
      result = deduped;
    }
  } finally {
    _pagingLock = false;
  }
  return result;
}

// ── NOTE: No automatic REGISTER_LISTING_FROM_CS on load ──
// Background tab→URL mapping is now set by the side panel when the user
// initiates analysis (REGISTER_LISTING_TAB message), not by auto-injection.
// This prevents silent background activity.

// ── Mark as ready ──
isReady = true;
console.log('[HomeScope] Content script loaded — user-triggered extraction mode');
