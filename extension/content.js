/**
 * HomeScope Content Script
 *
 * EXTRACTION POLICY: User-triggered only.
 * - No automatic image collection on page load, DOM mutation, tab activation, or side panel open.
 * - Gallery image extraction is ONLY permitted via the START_USER_EXTRACTION message handler.
 * - EXTRACT_LISTING / GET_PAGE_STATE only perform lightweight page sensing.
 *
 * Auth bridge (ONLY auth-related code in this file):
 *   - Exposes window.__HOMESCOPE_SYNC_SESSION__(payload, callback) for injected <script> from AuthCallback.tsx
 *   - Calls chrome.runtime.sendMessage → background sync_session_from_site handler
 */

// ===== Global guard to prevent double-injection in same tab =====
if (window.__HOMESCOPE_CS_LOADED__) {
  console.log('[HomeScope CS] Already loaded, skip.');
  return;
}

// ── Auth bridge: expose sync function on window ──
  // Called by injected <script> from AuthCallback.tsx (which runs in the web page world,
  // cannot access chrome.* APIs directly). The function body runs HERE in the content script
  // world, so it CAN call chrome.runtime.sendMessage.
  window.__HOMESCOPE_SYNC_SESSION__ = function(sessionPayload, callback) {
    console.log('[HomeScope CS] __HOMESCOPE_SYNC_SESSION__ called, userId=' + (sessionPayload.user ? sessionPayload.user.id : 'unknown'));
    chrome.runtime.sendMessage(
      { action: 'sync_session_from_site', payload: sessionPayload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[HomeScope CS] __HOMESCOPE_SYNC_SESSION__: chrome.runtime.lastError=', chrome.runtime.lastError.message);
          callback(false, chrome.runtime.lastError.message);
          return;
        }
        console.log('[HomeScope CS] __HOMESCOPE_SYNC_SESSION__: background responded:', JSON.stringify(response));
        callback(response?.success !== false, response?.error || null);
      }
    );
  };

  console.log('[HomeScope CS] Content script loaded, page URL:', window.location.href, 'origin:', window.location.origin);

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
 * Parse translateX value from a CSS transform matrix or matrix3d.
 * Returns the e/4th value from matrix() or t4 from matrix3d().
 * Returns 0 for 'none' or unparseable values.
 */
function parseTranslateX(transform) {
  if (!transform || transform === 'none') return 0;
  const m3d = transform.match(/matrix3d\(([^)]+)\)/);
  if (m3d) {
    const nums = m3d[1].split(',').map(Number);
    return nums[3] || 0;
  }
  const m2d = transform.match(/matrix\(([^)]+)\)/);
  if (m2d) {
    const nums = m2d[1].split(',').map(Number);
    return nums[4] || 0;
  }
  return 0;
}

/**
 * Find the .pswp__item whose transform translateX is closest to 0
 * (i.e., the currently visible/active slide in the carousel).
 * Returns { item, index, tx } or null if no items exist.
 */
function findActivePswpItem() {
  const dbg = (...args) => console.log('[paging] [findActivePswpItem] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  const items = Array.from(document.querySelectorAll('.pswp__item'));
  if (items.length === 0) return null;

  let best = null;
  let bestAbsTx = Infinity;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const style = window.getComputedStyle(item);
    const tx = parseTranslateX(style.transform);
    const absTx = Math.abs(tx);

    dbg('item[' + i + '] tx=' + tx + ' absTx=' + absTx + ' aria=' + item.getAttribute('aria-hidden') + ' hasActive=' + item.classList.contains('pswp--active'));

    if (absTx < bestAbsTx) {
      bestAbsTx = absTx;
      best = { item, index: i, tx };
    }
  }

  dbg('WINNER: index=' + (best ? best.index : 'null') + ' tx=' + (best ? best.tx : 'N/A'));
  return best;
}

/**
 * Within a pswp__item, find the best real image.
 * - Skips imgs with empty src, data: URLs, blob: URLs.
 * - Prioritises naturalWidth > 0 (loaded real image).
 * - Falls back to largest clientWidth * clientHeight (may be placeholder/scaled).
 * - Global fallback: scans all .pswp__img if no valid img in this item.
 *
 * Returns { img, source: 'item-best'|'global-best' } or null.
 */
function findBestImgInItem(item, allPswpImgs) {
  const dbg = (...args) => console.log('[paging] [findBestImgInItem] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));

  const imgs = Array.from(item.querySelectorAll('.pswp__img'));
  dbg('item has ' + imgs.length + ' pswp__img nodes');

  // Inspect all imgs in this item
  const candidates = [];
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const src = (img.src || '').trim();
    const currentSrc = (img.currentSrc || '').trim();
    const effectiveSrc = currentSrc || src;
    const nw = img.naturalWidth || 0;
    const cw = img.clientWidth || 0;
    const ch = img.clientHeight || 0;
    const area = cw * ch;
    const isPlaceholder = !effectiveSrc || effectiveSrc.startsWith('data:') || effectiveSrc.startsWith('blob:');
    const isLoaded = nw > 0;

    dbg('  img[' + i + '] src=\"' + (src ? src.substring(0, 60) : '(empty)') + '\" currentSrc=\"' + (currentSrc ? currentSrc.substring(0, 60) : '(empty)') + '\" nw=' + nw + ' cw=' + cw + ' ch=' + ch + ' area=' + area + ' placeholder=' + isPlaceholder + ' loaded=' + isLoaded);

    if (!isPlaceholder) {
      candidates.push({ img, nw, area, index: i });
    }
  }

  if (candidates.length === 0) {
    dbg('  No valid candidates in this item — falling back to global .pswp__img');
    // Global fallback: pick largest area
    let globalBest = null, globalBestArea = 0;
    for (let i = 0; i < allPswpImgs.length; i++) {
      const img = allPswpImgs[i];
      const src = (img.currentSrc || img.src || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      const area = (img.clientWidth || 0) * (img.clientHeight || 0);
      if (area > globalBestArea) { globalBestArea = area; globalBest = img; }
    }
    if (globalBest) {
      dbg('  Global fallback WINNER: nw=' + globalBest.naturalWidth + ' area=' + globalBestArea);
      return { img: globalBest, source: 'global-best' };
    }
    return null;
  }

  // Priority 1: loaded images (naturalWidth > 0) sorted by nw desc
  const loaded = candidates.filter(c => c.nw > 0);
  if (loaded.length > 0) {
    loaded.sort((a, b) => b.nw - a.nw);
    dbg('  WINNER (loaded, max naturalWidth): img[' + loaded[0].index + '] nw=' + loaded[0].nw);
    return { img: loaded[0].img, source: 'item-best' };
  }

  // Priority 2: fallback to largest client area
  candidates.sort((a, b) => b.area - a.area);
  dbg('  WINNER (max client area): img[' + candidates[0].index + '] area=' + candidates[0].area);
  return { img: candidates[0].img, source: 'item-best' };
}

/**
 * Get the currently active slide's main image element.
 * PRIMARY STRATEGY: find .pswp__item with translateX closest to 0, then pick
 * the best real img inside it (loaded, or largest area).
 * Falls back to .pswp--active class → aria-hidden=false → global area fallback.
 */
function getVisiblePhotoSwipeImage() {
  const allPswpImgs = Array.from(document.querySelectorAll('.pswp__img'));

  // Strategy 1: transform-based — find item with translateX closest to 0
  const activeItem = findActivePswpItem();
  if (activeItem) {
    const best = findBestImgInItem(activeItem.item, allPswpImgs);
    if (best) return best.img;
  }

  // Strategy 2: .pswp__item.pswp--active
  const activeItems = document.querySelectorAll('.pswp__item.pswp--active');
  if (activeItems.length === 1) {
    const best = findBestImgInItem(activeItems[0], allPswpImgs);
    if (best) return best.img;
  }

  // Strategy 3: aria-hidden="false"
  for (const item of document.querySelectorAll('.pswp__item')) {
    if (item.getAttribute('aria-hidden') === 'false') {
      const best = findBestImgInItem(item, allPswpImgs);
      if (best) return best.img;
    }
  }

  // Strategy 4: global fallback — area/opacity (last resort)
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  if (!allPswpImgs.length) return null;

  return allPswpImgs
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
    if (el.id) { name += '#' + el.id; }
    else if (el.className && typeof el.className === 'string' && el.className.trim()) {
      const cls = el.className.trim().split(/\s+/)[0].substring(0, 20);
      name += '.' + cls;
    }
    parts.unshift(name);
    // Traverse parent before we potentially null-out el below
    if (el.id) { break; }
    const parent = el.parentElement;
    if (parent && parent.tagName !== 'HTML') { el = parent; }
    else { break; }
  }
  return parts.join(' > ');
}

/**
 * Poll until .pswp.pswp--open is confirmed, or timeout.
 * Returns true if PhotoSwipe opened successfully within timeoutMs.
 */
async function waitForPhotoSwipe(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pswp = document.querySelector('.pswp');
    if (pswp && pswp.classList.contains('pswp--open')) return true;
    await new Promise(r => setTimeout(r, 120));
  }
  return false;
}

/**
 * Strategy 1: Click the first listing image (most stable).
 * Skips tiny images (icons/logos), finds clickable ancestor,
 * clicks it, then waits for PhotoSwipe to open.
 */
async function clickFirstListingImage() {
  const imgs = Array.from(document.querySelectorAll('img'));
  for (const img of imgs) {
    const rect = img.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 80) continue;
    const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
    if (!src) continue;

    const clickable =
      img.closest('button') ||
      img.closest('a') ||
      img.closest('[role="button"]') ||
      img.closest('[data-testid*="gallery"]') ||
      img.closest('[data-testid*="photo"]') ||
      img.closest('[class*="gallery"]') ||
      img;

    console.log('[openGallery] strategy=main-image img=' + getElementPath(img) + ' clickable=' + clickable.tagName);
    try { clickable.click(); } catch (_) {
      try { clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
    }

    if (await waitForPhotoSwipe(3000)) {
      console.log('[openGallery] ✓ PhotoSwipe opened via main-image');
      return true;
    }
  }
  return false;
}

/**
 * Strategy 2: Click gallery container / overlay / grid elements directly.
 */
async function clickGalleryContainer() {
  const galleryEl =
    document.querySelector('[data-testid="gallery"]') ||
    document.querySelector('[data-testid*="photo"]') ||
    document.querySelector('[class*="gallery"][class*="container"]') ||
    document.querySelector('[class*="photo"][class*="grid"]') ||
    document.querySelector('[class*="photo"][class*="viewer"]') ||
    document.querySelector('[class*="listing"][class*="photo"]') ||
    document.querySelector('[class*="media"][class*="gallery"]');

  if (!galleryEl) return false;

  console.log('[openGallery] strategy=gallery-container el=' + getElementPath(galleryEl));
  try { galleryEl.click(); } catch (_) {
    try { galleryEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
  }

  if (await waitForPhotoSwipe(3000)) {
    console.log('[openGallery] ✓ PhotoSwipe opened via gallery-container');
    return true;
  }
  return false;
}

/**
 * Find gallery button candidates (button/a/[role="button"] with "photo" or "+N").
 */
function collectGalleryButtonCandidates() {
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], div[tabindex]'));
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
      hits.push({ el, tagName: el.tagName.toLowerCase(), text, aria, title });
    }
  }
  return hits;
}

/**
 * Open PhotoSwipe gallery using multi-strategy fallback.
 * Returns true if PhotoSwipe is opened, false otherwise.
 */
async function openGallery() {
  const log = (msg, data) => console.log('[openGallery] ' + msg, typeof data === 'object' ? JSON.stringify(data) : data);

  const existing = document.querySelector('.pswp');
  if (existing && existing.classList.contains('pswp--open')) {
    log('PhotoSwipe already open');
    return true;
  }

  // Strategy 1: Click first listing image
  log('Trying strategy 1: clickFirstListingImage');
  if (await clickFirstListingImage()) return true;

  // Strategy 2: Click gallery container
  log('Trying strategy 2: clickGalleryContainer');
  if (await clickGalleryContainer()) return true;

  // Strategy 3: Click button candidates (existing logic, refined)
  log('Trying strategy 3: button-candidates');
  const hits = collectGalleryButtonCandidates();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const clickTarget =
      h.el.closest('button') ||
      h.el.closest('a') ||
      h.el.closest('[role="button"]') ||
      h.el;
    log('  candidate #' + i + ' text="' + h.text + '" target=' + clickTarget.tagName + ' path=' + getElementPath(clickTarget));
    try { clickTarget.click(); } catch (_) {
      try { clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
    }
    if (await waitForPhotoSwipe(3000)) {
      log('✓ PhotoSwipe opened via button-candidate #' + i);
      return true;
    }
  }

  log('✗ All strategies failed — PhotoSwipe not opened');
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

      // Must be declared before any dbg() call (const TDZ — "Cannot access 'dbg' before initialization")
      const DEBUG = true;
      const dbg = (...args) => { if (DEBUG) console.log('[paging] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')); };

      // ── Diagnostic: log gallery root structure ──
      const pswp = document.querySelector('.pswp');
      const pswpItems = pswp ? Array.from(pswp.querySelectorAll('.pswp__item')) : [];
      const allImgs = pswp ? Array.from(pswp.querySelectorAll('.pswp__img')) : [];

      // ── DEBUG: snapshot ALL pswp__item states ──
      dbg('[INIT] pswp__item count: ' + pswpItems.length + ', pswp__img count: ' + allImgs.length);
      for (let ii = 0; ii < pswpItems.length; ii++) {
        const item = pswpItems[ii];
        const imgs = Array.from(item.querySelectorAll('.pswp__img'));
        const aria = item.getAttribute('aria-hidden');
        const hasActive = item.classList.contains('pswp--active');
        const firstImg = imgs[0];
        const firstImgSrc = firstImg ? (firstImg.currentSrc || firstImg.src || '').trim() : '(no img)';
        const rect = firstImg ? firstImg.getBoundingClientRect() : null;
        const area = rect ? Math.round(rect.width * rect.height) : 0;
        dbg('[INIT]   pswp__item[' + ii + '] aria=' + aria + ' activeClass=' + hasActive + ' imgs=' + imgs.length + ' firstSrc=' + (firstImgSrc ? firstImgSrc.substring(0, 80) : '(empty)') + ' area=' + area + 'px');
      }

      // ── DEBUG: snapshot ALL .pswp__img with currentSrc ──
      allImgs.forEach((img, ii) => {
        const src = (img.currentSrc || img.src || '').trim();
        const rect = img.getBoundingClientRect();
        const area = Math.round(rect.width * rect.height);
        const style = window.getComputedStyle(img);
        dbg('[INIT]   pswp__img[' + ii + '] src=' + (src ? src.substring(0, 80) : '(empty)') + ' area=' + area + ' opacity=' + style.opacity);
      });

      // ── DEBUG: check dataset.pswpIndex ──
      dbg('[INIT] dataset.pswpIndex=' + (pswp ? pswp.dataset.pswpIndex : 'N/A'));

      // ── State ──
      const seenUrls = new Map();
      const seenIds  = new Map();
      let firstIndex = -1;
      let consecutiveNoImgReady = 0;
      const MAX_ITER = 30;
      const NO_READY_THRESHOLD = 4;

      /**
       * Extract image URL from the active slide using the best img strategy.
       * Returns { src, check, source }.
       */
      function getActiveImageSrcWithCheck() {
        const allPswpImgs = Array.from(document.querySelectorAll('.pswp__img'));

        // Check 1: transform-based
        const activeItem = findActivePswpItem();
        if (activeItem) {
          const best = findBestImgInItem(activeItem.item, allPswpImgs);
          if (best) {
            const src = (best.img.currentSrc || best.img.src || '').trim();
            if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
              return { src, check: 'transform', source: best.source };
            }
          }
        }
        // Check 2: .pswp--active class
        const activeItems = document.querySelectorAll('.pswp__item.pswp--active');
        if (activeItems.length === 1) {
          const best = findBestImgInItem(activeItems[0], allPswpImgs);
          if (best) {
            const src = (best.img.currentSrc || best.img.src || '').trim();
            if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
              return { src, check: 'active-class', source: best.source };
            }
          }
        }
        // Check 3: aria-hidden="false"
        for (const item of document.querySelectorAll('.pswp__item')) {
          if (item.getAttribute('aria-hidden') === 'false') {
            const best = findBestImgInItem(item, allPswpImgs);
            if (best) {
              const src = (best.img.currentSrc || best.img.src || '').trim();
              if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
                return { src, check: 'aria', source: best.source };
              }
            }
          }
        }
        // Check 4: global area fallback
        const fallback = getVisiblePhotoSwipeImage();
        if (fallback) {
          const src = (fallback.currentSrc || fallback.src || '').trim();
          if (src) return { src, check: 'area', source: 'global-fallback' };
        }
        return { src: '', check: 'empty', source: 'none' };
      }

      /**
       * Determine the current active slide index from PhotoSwipe state.
       * Returns { index, strategy: 'transform'|'dataset'|'aria'|'area' }
       */
      function getCurrentSlideIndexWithStrategy() {
        // Strategy 0 (NEW): PhotoSwipe API — most reliable when available
        const pswp = document.querySelector('.pswp');
        if (pswp) {
          const pswpUid = pswp.dataset?.pswpUid;
          if (pswpUid && window.pswp?.instances instanceof Map) {
            const instance = window.pswp.instances.get(Number(pswpUid));
            if (instance && typeof instance.currIndex === 'number') {
              return { index: instance.currIndex, strategy: 'pswp-api' };
            }
          }
          // Fallback: direct instance from element property
          if (pswp.__pswp && typeof pswp.__pswp.currIndex === 'number') {
            return { index: pswp.__pswp.currIndex, strategy: 'pswp-el-api' };
          }
        }
        // Strategy 1: transform — find item with translateX closest to 0
        const activeItem = findActivePswpItem();
        if (activeItem) {
          return { index: activeItem.index, strategy: 'transform' };
        }
        // Strategy 2: dataset.pswpIndex
        if (pswp && typeof pswp.dataset.pswpIndex !== 'undefined' && pswp.dataset.pswpIndex !== '') {
          return { index: parseInt(pswp.dataset.pswpIndex, 10), strategy: 'dataset' };
        }
        // Strategy 3: aria-hidden=false
        const items = document.querySelectorAll('.pswp__item');
        for (let i = 0; i < items.length; i++) {
          if (items[i].getAttribute('aria-hidden') === 'false') return { index: i, strategy: 'aria' };
        }
        // Strategy 4: area-based (last resort)
        const allImgs = Array.from(document.querySelectorAll('.pswp__img'));
        if (!allImgs.length) return { index: 0, strategy: 'area-none' };
        let best = allImgs[0], bestArea = 0;
        for (const img of allImgs) {
          const r = img.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea) { bestArea = area; best = img; }
        }
        const idx = Array.from(document.querySelectorAll('.pswp__img')).indexOf(best);
        return { index: idx >= 0 ? idx : 0, strategy: 'area' };
      }

      /**
       * Try to advance to the next slide.
       * Returns { used, clicked, prevIndex, success }.
       */
      function clickNext() {
        // Capture prevIndex before any action so callers can compare with post-click index.
        const prevIndex = (() => {
          const ii = getCurrentSlideIndexWithStrategy();
          return ii.index;
        })();

        // Priority 0 (NEW): Direct PhotoSwipe API — bypasses synthetic event issues entirely
        const pswpRoot = document.querySelector('.pswp');
        if (pswpRoot) {
          // Try PhotoSwipe v5 keyed-by-uid instance access
          const pswpUid = pswpRoot.dataset?.pswpUid;
          if (pswpUid && window.pswp?.instances instanceof Map) {
            const instance = window.pswp.instances.get(Number(pswpUid));
            if (instance && typeof instance.next === 'function') {
              instance.next();
              dbg('[clickNext] used=pswp-api uid=' + pswpUid + ' prevIndex=' + prevIndex);
              return { used: 'pswp-api', clicked: true, prevIndex, success: true };
            }
          }
          // Fallback: direct instance from a known class property (PhotoSwipe v4 / some builds)
          const pswpEl = document.querySelector('.pswp');
          if (pswpEl && pswpEl.__pswp) {
            const inst = pswpEl.__pswp;
            if (typeof inst.next === 'function') {
              inst.next();
              dbg('[clickNext] used=pswp-el-api prevIndex=' + prevIndex);
              return { used: 'pswp-el-api', clicked: true, prevIndex, success: true };
            }
          }
        }

        // Priority 1: .pswp__button--arrow--right  (PhotoSwipe v5+)
        // Priority 2: .pswp__button--arrow--next   (older PhotoSwipe)
        // Priority 3: any button with "arrow" + "right" in className (generics)
        const btn =
          document.querySelector('.pswp__button--arrow--right') ||
          document.querySelector('.pswp__button--arrow--next') ||
          document.querySelector('[class*="arrow"][class*="right"]');

        if (btn && !btn.disabled && getComputedStyle(btn).display !== 'none') {
          btn.focus();                            // ← must focus before click for keyboard events to propagate
          const clicked = triggerClick(btn);
          dbg('[clickNext] used=button prevIndex=' + prevIndex + ' clicked=' + clicked + ': ' + getElementPath(btn));
          return { used: 'button', clicked, prevIndex, success: clicked };
        }

        // Priority 4: generic class-based next button fallback
        const fallbackBtn = document.querySelector('[class*="pswp__button"][class*="next"]');
        if (fallbackBtn) {
          fallbackBtn.focus();
          const clicked = triggerClick(fallbackBtn);
          dbg('[clickNext] used=fallback-btn prevIndex=' + prevIndex + ' clicked=' + clicked + ': ' + getElementPath(fallbackBtn));
          return { used: 'fallback-btn', clicked, prevIndex, success: clicked };
        }

        // Priority 5: keyboard event on pswp root (requires focus first)
        if (pswpRoot) {
          pswpRoot.focus();                       // ← focus is required for PhotoSwipe to receive keyboard events
          dbg('[clickNext] used=keyboard-pswp prevIndex=' + prevIndex);
          pswpRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          return { used: 'keyboard-pswp', clicked: true, prevIndex, success: true };
        }

        // Priority 6: global keyboard fallback
        dbg('[clickNext] used=keyboard-global prevIndex=' + prevIndex);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        return { used: 'keyboard-global', clicked: true, prevIndex, success: true };
      }

      function triggerClick(el) {
        try { el.click(); return true; } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; } catch (_) {}
        return false;
      }

      /**
       * Get the current active img element (fresh DOM query each call).
       * Picks the best real img inside the active item using findBestImgInItem.
       * Returns { img, index, tx, strategy, source } or null.
       */
      function getActiveImgInfo() {
        const allPswpImgs = Array.from(document.querySelectorAll('.pswp__img'));

        // Strategy 1: transform-based
        const activeItem = findActivePswpItem();
        if (activeItem) {
          const best = findBestImgInItem(activeItem.item, allPswpImgs);
          if (best) return { img: best.img, index: activeItem.index, tx: activeItem.tx, strategy: 'transform', source: best.source };
        }

        // Strategy 2: .pswp--active class
        const activeItems = document.querySelectorAll('.pswp__item.pswp--active');
        if (activeItems.length === 1) {
          const best = findBestImgInItem(activeItems[0], allPswpImgs);
          if (best) return { img: best.img, index: -1, tx: 0, strategy: 'active-class', source: best.source };
        }

        // Strategy 3: aria-hidden="false"
        for (const item of document.querySelectorAll('.pswp__item')) {
          if (item.getAttribute('aria-hidden') === 'false') {
            const best = findBestImgInItem(item, allPswpImgs);
            if (best) return { img: best.img, index: -1, tx: 0, strategy: 'aria', source: best.source };
          }
        }

        return null;
      }

      /**
       * Wait for the img element to be fully loaded.
       * Criteria: src/currentSrc non-empty, img.complete === true, naturalWidth > 0.
       * Returns { ready, img, src, currentSrc, complete, naturalWidth } after each poll.
       */
      async function waitForImageReady(img, timeoutMs = 3000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const src = (img.src || '').trim();
          const currentSrc = (img.currentSrc || '').trim();
          const complete = img.complete;
          const naturalWidth = img.naturalWidth || 0;
          const ready = complete && naturalWidth > 0 && !!(currentSrc || src);

          dbg('[waitForImageReady] poll complete=' + complete + ' nw=' + naturalWidth + ' src=\"' + (src ? src.substring(0, 60) : '(empty)') + '\" currentSrc=\"' + (currentSrc ? currentSrc.substring(0, 60) : '(empty)') + '\" ready=' + ready);

          if (ready) {
            return { ready: true, img, src: currentSrc || src, currentSrc, complete, naturalWidth };
          }
          await new Promise(r => setTimeout(r, 120));
        }
        // Final check after timeout
        const src = (img.src || '').trim();
        const currentSrc = (img.currentSrc || '').trim();
        const complete = img.complete;
        const naturalWidth = img.naturalWidth || 0;
        dbg('[waitForImageReady] TIMEOUT after ' + timeoutMs + 'ms | complete=' + complete + ' nw=' + naturalWidth + ' currentSrc=\"' + (currentSrc ? currentSrc.substring(0, 60) : '(empty)') + '\"');
        return { ready: complete && naturalWidth > 0 && !!(currentSrc || src), img, src: currentSrc || src, currentSrc, complete, naturalWidth };
      }

      /**
       * Wait for the slide index to change (using transform).
       * Primary signal: indexChanged (NOT urlChanged).
       * Also handles loop-back detection.
       * Returns { changed, indexChanged, newIndex, newIndexStrategy, newImgInfo, loopBack, pollCount, timedOut }.
       * newImgInfo contains the fresh img element for subsequent waitForImageReady.
       */
      /**
       * Directly manipulate PhotoSwipe slides via transform, bypassing PhotoSwipe's event system.
       * This is the fallback when synthetic clicks/keyboard events are ignored by PhotoSwipe.
       */
      function forceTransformSlide(targetIndex) {
        const items = Array.from(document.querySelectorAll('.pswp__item'));
        if (!items.length) return false;
        const clampedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));
        // tx = -clampedIndex * 100 positions the target slide at the "visible" slot (tx ≈ 0)
        const tx = -clampedIndex * 100;
        items.forEach((item, i) => {
          item.style.transform = `translateX(${tx + (i - clampedIndex) * 100}%)`;
        });
        dbg('[forceTransformSlide] forced index=' + clampedIndex + ' tx=' + tx + '% (' + items.length + ' items)');
        return true;
      }

      async function waitForSlideChange(prevIndex, timeoutMs = 3000) {
        const start = Date.now();
        let pollCount = 0;
        let prevIdxInfo = null;
        const FORCE_THRESHOLD_MS = 1500; // wait this long before taking over via transform
        // Grab items reference once at function entry (items are static during a single transition)
        let items = Array.from(document.querySelectorAll('.pswp__item'));

        while (Date.now() - start < timeoutMs) {
          pollCount++;

          // Always re-fetch active item from live DOM (never cache DOM references)
          const imgInfo = getActiveImgInfo();
          const idxInfo = getCurrentSlideIndexWithStrategy();
          const currentIndex = idxInfo.index;
          const currentSrc = imgInfo ? ((imgInfo.img.currentSrc || imgInfo.img.src || '').trim()) : '';
          const elapsed = Date.now() - start;

          // Primary signal: index changed
          const indexChanged = prevIdxInfo !== null && currentIndex !== prevIdxInfo;

          dbg('[waitForSlideChange] poll=' + pollCount
            + ' elapsed=' + elapsed + 'ms'
            + ' index=' + currentIndex + '(strategy=' + idxInfo.strategy + ')'
            + ' prevIdx=' + prevIdxInfo
            + ' indexChanged=' + indexChanged
            + ' source=' + (imgInfo ? imgInfo.source : 'none')
            + ' imgComplete=' + (imgInfo ? imgInfo.img.complete : 'N/A')
            + ' imgNW=' + (imgInfo ? imgInfo.img.naturalWidth : 'N/A')
            + ' currentSrc=\"' + (currentSrc ? currentSrc.substring(0, 60) : '(empty)') + '\"'
          );

          if (indexChanged) {
            dbg('[waitForSlideChange] ✓ INDEX CHANGED at poll=' + pollCount + ' newIndex=' + currentIndex + ' strategy=' + idxInfo.strategy);
            return {
              changed: true,
              indexChanged: true,
              newIndex: currentIndex,
              newIndexStrategy: idxInfo.strategy,
              newImgInfo: imgInfo,
              loopBack: false,
              pollCount,
              timedOut: false,
              forced: false,
            };
          }

          // Mid-polling force: if PhotoSwipe hasn't responded after FORCE_THRESHOLD_MS, take over via transform
          if (elapsed >= FORCE_THRESHOLD_MS && idxInfo.strategy === 'transform') {
            const nextIndex = (prevIndex + 1) % items.length;
            const forced = forceTransformSlide(nextIndex);
            if (forced) {
              dbg('[waitForSlideChange] ⚡ FORCED mid-poll at elapsed=' + elapsed + 'ms -> nextIndex=' + nextIndex);
              // Wait a tick for the DOM to settle then confirm
              await new Promise(r => setTimeout(r, 200));
              const postIdxInfo = getCurrentSlideIndexWithStrategy();
              const postImgInfo = getActiveImgInfo();
              return {
                changed: true,
                indexChanged: true,
                newIndex: nextIndex,
                newIndexStrategy: 'forced-transform',
                newImgInfo: postImgInfo,
                loopBack: false,
                pollCount,
                timedOut: false,
                forced: true,
              };
            }
          }

          // Loop detection: back to index 0
          if (prevIndex === 0 && currentIndex === 0 && pollCount > 2) {
            dbg('[waitForSlideChange] loopBack detected at poll=' + pollCount);
            return {
              changed: false,
              indexChanged: false,
              newIndex: currentIndex,
              newIndexStrategy: idxInfo.strategy,
              newImgInfo: imgInfo,
              loopBack: true,
              pollCount,
              timedOut: false,
              forced: false,
            };
          }

          prevIdxInfo = currentIndex;
          await new Promise(r => setTimeout(r, 120));
        }

        // Timeout: last-resort force via transform before giving up
        const finalIdxInfo = getCurrentSlideIndexWithStrategy();
        const finalImgInfo = getActiveImgInfo();
        const nextIndex = (prevIndex + 1) % (items.length || 1);
        const forced = forceTransformSlide(nextIndex);
        dbg('[waitForSlideChange] TIMEOUT after ' + timeoutMs + 'ms | final index=' + finalIdxInfo.index + ' strategy=' + finalIdxInfo.strategy + ' | polls=' + pollCount + ' | forced=' + forced + ' (nextIndex=' + nextIndex + ')');
        return {
          changed: forced,
          indexChanged: forced,
          newIndex: forced ? nextIndex : finalIdxInfo.index,
          newIndexStrategy: forced ? 'forced-transform-timeout' : finalIdxInfo.strategy,
          newImgInfo: finalImgInfo,
          loopBack: false,
          pollCount,
          timedOut: true,
          forced: forced,
        };
      }

      // ── Main paging loop ──
      for (let i = 0; i < MAX_ITER; i++) {
        const imgInfo = getActiveImgInfo();
        const idxInfo = getCurrentSlideIndexWithStrategy();
        const slideIndex = idxInfo.index;
        const strategy = idxInfo.strategy;

        if (firstIndex === -1) firstIndex = slideIndex;

        if (!imgInfo) {
          dbg('>>> ITER ' + i + ' | index=' + slideIndex + '(strategy=' + strategy + ') | source=NONE | NO ACTIVE IMG | result so far: ' + result.length);
          dbg('    RESULT: skipped (no active img found)');
          consecutiveNoImgReady++;
          if (consecutiveNoImgReady >= NO_READY_THRESHOLD) { dbg('    STOP: ' + NO_READY_THRESHOLD + ' consecutive no-active-img'); break; }
          clickNext();
          await waitForSlideChange(slideIndex);
          continue;
        }

        const img = imgInfo.img;
        const src = (img.currentSrc || img.src || '').trim();
        dbg('>>> ITER ' + i + ' | index=' + slideIndex + '(strategy=' + strategy + ')' + ' | source=' + imgInfo.source + ' | img.complete=' + img.complete + ' nw=' + img.naturalWidth + ' | src=\"' + (src ? src.substring(0, 60) : '(empty)') + '\"' + ' | firstIndex=' + firstIndex + ' | result so far: ' + result.length);

        if (i > 0 && slideIndex === firstIndex) {
          dbg('    REASON: loop-back to firstIndex | STOP');
          break;
        }

        if (!img.complete || img.naturalWidth === 0 || !src) {
          dbg('    img not ready — waiting for load...');
          const readyResult = await waitForImageReady(img);
          dbg('    waitForImageReady: ready=' + readyResult.ready + ' complete=' + readyResult.complete + ' nw=' + readyResult.naturalWidth + ' src=\"' + (readyResult.src ? readyResult.src.substring(0, 80) : '(still empty)') + '\"');
          if (!readyResult.ready) {
            consecutiveNoImgReady++;
            if (consecutiveNoImgReady >= NO_READY_THRESHOLD) { dbg('    STOP: ' + NO_READY_THRESHOLD + ' consecutive no-img-ready'); break; }
            clickNext();
            await waitForSlideChange(slideIndex);
            continue;
          }
          const loadedSrc = readyResult.src;
          const loadedNorm = normalizeUrl(loadedSrc);
          const loadedCid = extractContentId(loadedNorm);
          if (seenUrls.has(loadedNorm)) { dbg('    loaded URL duplicate | STOP'); }
          else if (loadedCid && seenIds.has(loadedCid)) { dbg('    loaded cid duplicate | STOP'); }
          else {
            seenUrls.set(loadedNorm, true);
            if (loadedCid) seenIds.set(loadedCid, true);
            result.push({ url: loadedSrc, width: extractWidthFromUrl(loadedSrc), id: loadedCid });
            consecutiveNoImgReady = 0;
            dbg('    RESULT: RECORDED (post-load) [' + result.length + '] | id=' + loadedCid + ' | src=' + loadedSrc.substring(0, 80));
          }
          clickNext();
          await waitForSlideChange(slideIndex);
          continue;
        }

        const norm = normalizeUrl(src);
        const cid = extractContentId(norm);
        if (seenUrls.has(norm)) { dbg('    duplicate URL | norm=' + norm.substring(0, 80) + ' | STOP'); break; }
        if (cid && seenIds.has(cid)) { dbg('    duplicate cid | STOP'); break; }

        if (cid) {
          seenUrls.set(norm, true);
          seenIds.set(cid, true);
          result.push({ url: src, width: extractWidthFromUrl(norm), id: cid });
          dbg('    RESULT: RECORDED [' + result.length + '] | id=' + cid + ' | src=' + src.substring(0, 80));
        } else {
          seenUrls.set(norm, true);
          result.push({ url: src, width: extractWidthFromUrl(norm), id: null });
          dbg('    RESULT: RECORDED [' + result.length + '] (no cid) | src=' + src.substring(0, 80));
        }
        consecutiveNoImgReady = 0;

        const clickRes = clickNext();
        const waitRes = await waitForSlideChange(slideIndex);
        dbg('    clickNext used=' + clickRes.used
          + ' | prevIndex=' + clickRes.prevIndex
          + ' | newIndex=' + waitRes.newIndex
          + ' | indexChanged=' + waitRes.indexChanged
          + ' | loopBack=' + waitRes.loopBack
          + ' | polls=' + waitRes.pollCount
          + ' | timedOut=' + waitRes.timedOut
        );
        if (!waitRes.indexChanged) {
          dbg('    [clickNext] ❌ next click failed — index unchanged: ' + clickRes.prevIndex + ' → ' + waitRes.newIndex);
        }
        if (waitRes.loopBack) { dbg('    STOP: loop-back'); break; }
        if (waitRes.timedOut && !waitRes.indexChanged) {
          consecutiveNoImgReady++;
          if (consecutiveNoImgReady >= NO_READY_THRESHOLD) { dbg('    STOP: ' + NO_READY_THRESHOLD + ' consecutive no-img-ready'); break; }
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
          dbg('[FINAL-KEEP] ' + item.url.substring(0, 100) + ' (id=' + item.id + ')');
        } else {
          dbg('[FINAL-DROP] duplicate key: ' + item.url.substring(0, 100) + ' (id=' + item.id + ')');
        }
      }
      deduped.sort((a, b) => {
        const wa = extractWidthFromUrl(a);
        const wb = extractWidthFromUrl(b);
        return wb - wa;
      });

      dbg('[FINAL] result before dedup: ' + result.length + ' | after dedup: ' + deduped.length + ' | dedup drops: ' + (result.length - deduped.length));
      result = deduped;
    }
  } finally {
    _pagingLock = false;
  }
  return result;
}


// ── Mark as ready ──
isReady = true;
console.log('[HomeScope] Content script loaded — user-triggered extraction mode');

