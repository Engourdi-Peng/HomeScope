/**
 * HomeScope Content Script
 *
 * EXTRACTION POLICY: User-triggered only.
 * - No automatic image collection on page load, DOM mutation, tab activation, or side panel open.
 * - Gallery image extraction is ONLY permitted via the START_USER_EXTRACTION message handler.
 * - EXTRACT_LISTING / GET_PAGE_STATE only perform lightweight page sensing.
 *
 * Auth bridge (ONLY auth-related code in this file):
 *   - Listens for window.postMessage from web pages (source: 'homescope-auth-bridge')
 *   - Forwards session data to background via chrome.runtime.sendMessage
 *   - Sends ACK back to page via postMessage
 */

;(function() {
  'use strict';

  // ===== Global guard to prevent double-injection in same tab =====
  if (window.__HOMESCOPE_CS_LOADED__) {
    console.log('[HomeScope CS] Already loaded, skip.');
    return;
  }
  window.__HOMESCOPE_CS_LOADED__ = true;

// ── Auth bridge: listen for postMessage from page world ──
// Pages in the web world cannot access content script's window object directly.
// They send messages via window.postMessage, which we listen for here.
window.addEventListener('message', (event) => {
  // Only accept messages from the page (same window instance)
  if (event.source !== window) return;

  // Validate message source
  if (event.data?.source !== 'homescope-auth-bridge') return;

  if (event.data?.type === 'HOMESCOPE_SYNC_SESSION') {
    console.log('[HomeScope CS] Received HOMESCOPE_SYNC_SESSION from page, userId=' +
      (event.data.payload?.user?.id || 'unknown'));

    chrome.runtime.sendMessage(
      { action: 'sync_session_from_site', payload: event.data.payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[HomeScope CS] sync_session_from_site: chrome.runtime.lastError=',
            chrome.runtime.lastError.message);
          event.source.postMessage({
            source: 'homescope-auth-bridge',
            type: 'HOMESCOPE_SESSION_ACK',
            success: false,
            error: chrome.runtime.lastError.message
          }, event.origin);
          return;
        }
        console.log('[HomeScope CS] sync_session_from_site: background responded:', JSON.stringify(response));
        event.source.postMessage({
          source: 'homescope-auth-bridge',
          type: 'HOMESCOPE_SESSION_ACK',
          success: response?.success !== false,
          error: response?.error || null
        }, event.origin);
      }
    );
  }
});

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
// ─────────────────────────────────────────────────────────────
// JSON-LD / Schema.org structured data extraction
// ─────────────────────────────────────────────────────────────

/**
 * Parse all <script type="application/ld+json"> tags and return the first
 * structured object that looks like a real-estate listing.
 * Falls back to null if none are found.
 */
function parseJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const raw = script.textContent || '';
      const data = JSON.parse(raw);
      // Handle @graph arrays (Google SDTT format)
      const candidates = Array.isArray(data)
        ? data
        : (data['@graph'] ? data['@graph'] : [data]);
      for (const item of candidates) {
        const type = (item['@type'] || '').toLowerCase();
        const isListing =
          type.includes('realestate') ||
          type.includes('residence') ||
          type.includes('house') ||
          type.includes('apartment') ||
          type.includes('accommodation') ||
          type.includes(' lodging') ||
          type.includes('offer') ||
          (type === 'product' && item.name); // some sites use Product for listings
        if (isListing) return item;
      }
    } catch {
      // Malformed JSON — skip
    }
  }
  return null;
}

/**
 * Extract structured property fields from a JSON-LD object.
 * Returns null for each field that cannot be resolved.
 */
function extractListingFromJsonLd(json) {
  if (!json) return null;

  // ---- Title ----
  let title = null;
  if (json.name) title = String(json.name).trim();
  if (!title && json.headline) title = String(json.headline).trim();

  // ---- Address ----
  let address = null;
  const addr = json.address || json.location || null;
  if (addr) {
    if (typeof addr === 'string') {
      address = addr.trim();
    } else if (typeof addr === 'object') {
      const parts = [
        addr.streetAddress,
        addr.addressLocality,
        addr.addressRegion,
        addr.postalCode,
        addr.addressCountry,
      ].filter(Boolean).map(s => String(s).trim());
      if (parts.length > 0) address = parts.join(', ');
    }
  }
  // Fallback: description sometimes contains an address
  if (!address && json.description) {
    const ad = extractAddressFromText(json.description);
    if (ad) address = ad;
  }

  // ---- Price ----
  let price = null;
  const offer = json.offers || json.aggregateOffer || null;
  if (offer) {
    const rawPrice = offer.price || offer.lowPrice || null;
    if (rawPrice != null) {
      const priceCurrency = offer.priceCurrency || offer.priceCurrency || '';
      const formatted = String(rawPrice);
      if (priceCurrency) {
        price = priceCurrency + formatted;
      } else {
        price = '$' + formatted;
      }
      if (offer.unitCode && !price.includes('/')) {
        price += ' /' + String(offer.unitCode).replace(/^https?:\/\/schema\.org\//, '').toLowerCase();
      } else if (offer.unitText) {
        price += ' ' + String(offer.unitText);
      }
    }
  }

  // ---- Rooms (bedrooms / bathrooms) ----
  const rooms = { bedrooms: null, bathrooms: null, parking: null };
  const amenityList = (json.amenityFeature || json.features || [])
    .concat(json.propertyFeature || [])
    .filter(Boolean);

  function amenityValue(key) {
    for (const a of amenityList) {
      const name = (a.name || a.propertyID || '').toLowerCase();
      if (name.includes(key)) {
        const val = a.value || a.valueReference;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const n = parseInt(val, 10);
          if (!isNaN(n)) return n;
        }
        return null;
      }
    }
    return null;
  }

  if (rooms.bedrooms == null) rooms.bedrooms = amenityValue('bed');
  if (rooms.bathrooms == null) rooms.bathrooms = amenityValue('bath');
  if (rooms.parking == null) rooms.parking = amenityValue('parking') || amenityValue('garage') || amenityValue('car');

  // Also check floorPlan / numberOfRooms for structured room counts
  if (rooms.bedrooms == null && json.numberOfBedrooms != null) {
    rooms.bedrooms = parseInt(String(json.numberOfBedrooms), 10) || null;
  }
  if (rooms.bathrooms == null && json.numberOfBathroomsTotal != null) {
    rooms.bathrooms = parseInt(String(json.numberOfBathroomsTotal), 10) || null;
  }

  // ---- Description ----
  let description = null;
  if (json.description) {
    const d = String(json.description).trim();
    if (d.length > 50) description = d.slice(0, 5000);
  }

  return { title, address, price, rooms, description };
}

/**
 * Fallback regex-based address extractor from raw text.
 * Works for western and mixed-format addresses.
 */
function extractAddressFromText(text) {
  const patterns = [
    /\d+\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4},\s*[A-Z]{2,4}\s*\d{4,}/,
    /\d+\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4},\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/,
    /[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3},\s*[A-Z]{2,4}\s*\d{4,}/,
    // Chinese-style: Unit 123, Street Name, Suburb, City 123456
    /[\u4e00-\u9fa5]{2,}[\s\S]{0,40}?\d{6}/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

async function extractListingDataLight() {
  const signals = detectPropertySignals();
  propertySignals = signals;

  // Priority 1: JSON-LD structured data
  const jsonLd = parseJsonLd();
  const fromJsonLd = extractListingFromJsonLd(jsonLd);

  // Priority 2: DOM-based extraction (fallback)
  const domTitle = extractTitle();
  const domAddress = extractAddress();
  const domPrice = extractPrice();
  const domRooms = extractRooms();
  const domDescription = extractDescription();

  // Merge: prefer JSON-LD, fall back to DOM
  const title = fromJsonLd?.title || domTitle || null;
  const address = fromJsonLd?.address || domAddress || null;
  const price = fromJsonLd?.price || domPrice || null;
  const rooms = {
    bedrooms: fromJsonLd?.rooms?.bedrooms ?? domRooms.bedrooms,
    bathrooms: fromJsonLd?.rooms?.bathrooms ?? domRooms.bathrooms,
    parking: fromJsonLd?.rooms?.parking ?? domRooms.parking,
  };
  const description = fromJsonLd?.description || domDescription || null;

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
 * - Priority 1: img with currentSrc containing "reastatic" (real CDN image)
 * - Priority 2: naturalWidth > 0 (loaded real image)
 * - Priority 3: largest clientWidth * clientHeight (may be placeholder/scaled)
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
    const isReastatic = /reastatic\.(net|com\.au)/i.test(effectiveSrc);

    dbg('  img[' + i + '] src=\"' + (src ? src.substring(0, 60) : '(empty)') + '\" currentSrc=\"' + (currentSrc ? currentSrc.substring(0, 60) : '(empty)') + '\" nw=' + nw + ' cw=' + cw + ' ch=' + ch + ' area=' + area + ' placeholder=' + isPlaceholder + ' loaded=' + isLoaded + ' reastatic=' + isReastatic);

    if (!isPlaceholder) {
      candidates.push({ img, nw, area, index: i, isReastatic });
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

  // Priority 1: reastatic CDN image (real high-res photo)
  const reastatic = candidates.filter(c => c.isReastatic);
  if (reastatic.length > 0) {
    reastatic.sort((a, b) => b.nw - a.nw || b.area - a.area);
    dbg('  WINNER (reastatic, max naturalWidth): img[' + reastatic[0].index + '] nw=' + reastatic[0].nw);
    return { img: reastatic[0].img, source: 'item-best' };
  }

  // Priority 2: loaded images (naturalWidth > 0) sorted by nw desc
  const loaded = candidates.filter(c => c.nw > 0);
  if (loaded.length > 0) {
    loaded.sort((a, b) => b.nw - a.nw);
    dbg('  WINNER (loaded, max naturalWidth): img[' + loaded[0].index + '] nw=' + loaded[0].nw);
    return { img: loaded[0].img, source: 'item-best' };
  }

  // Priority 3: fallback to largest client area
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
 * Attempt to extract all gallery image URLs directly from PhotoSwipe's internal items array.
 * This bypasses the need for paging/interaction and is the preferred strategy.
 * Returns null if no PhotoSwipe instance is accessible.
 *
 * Tries (in order):
 *   1. window.pswp.items         (PhotoSwipe v5 global)
 *   2. pswpEl.__pswp.items       (PhotoSwipe v4 element property)
 *   3. window.pswp.instances.get(uid).items (PhotoSwipe v5 keyed instances)
 *
 * @returns {Promise<Array<{url: string, width: number, id: string|null}>|null>}
 */
async function tryExtractPhotoSwipeItems() {
  const log = (msg, data) => console.log('[paging] [tryExtractPhotoSwipeItems] ' + msg, data);

  const pswpEl = document.querySelector('.pswp');
  if (!pswpEl) {
    log('no .pswp element found');
    return null;
  }

  // Helper: extract fields from a PhotoSwipe item object
  function extractItem(item) {
    if (!item) return null;
    const src = item.src || item.originalSrc || item.thumbnailSrc || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
    const norm = normalizeUrl(src);
    const cid = extractContentId(norm);
    const width = item.w || item.width || extractWidthFromUrl(src);
    return { url: norm, width, id: cid };
  }

  // Strategy 1: window.pswp.items  (PhotoSwipe v5 global)
  if (Array.isArray(window.pswp?.items) && window.pswp.items.length > 0) {
    const items = window.pswp.items.map(extractItem).filter(Boolean);
    log('Strategy 1 (window.pswp.items): ' + items.length + ' images');
    return items;
  }

  // Strategy 2: pswpEl.__pswp.items  (PhotoSwipe v4)
  if (pswpEl.__pswp && Array.isArray(pswpEl.__pswp.items) && pswpEl.__pswp.items.length > 0) {
    const items = pswpEl.__pswp.items.map(extractItem).filter(Boolean);
    log('Strategy 2 (__pswp.items): ' + items.length + ' images');
    return items;
  }

  // Strategy 3: PhotoSwipe v5 keyed instances via dataset.pswpUid
  const uid = pswpEl.dataset?.pswpUid;
  if (uid && window.pswp?.instances instanceof Map) {
    const instance = window.pswp.instances.get(Number(uid));
    if (instance && Array.isArray(instance.items) && instance.items.length > 0) {
      const items = instance.items.map(extractItem).filter(Boolean);
      log('Strategy 3 (pswp.instances.get(uid)): ' + items.length + ' images');
      return items;
    }
  }

  // Strategy 4: try reading items from the UI DOM (fallback)
  // PhotoSwipe renders .pswp__item elements; scan all of them for images
  const pswpItems = Array.from(pswpEl.querySelectorAll('.pswp__item'));
  if (pswpItems.length > 0) {
    // Collect all images from all slots (each slot may have multiple imgs: placeholder + real)
    const allImgs = Array.from(pswpEl.querySelectorAll('.pswp__img'));
    const collected = [];
    for (const img of allImgs) {
      const src = (img.currentSrc || img.src || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      if (isPlaceholderUrl(src)) continue;
      const norm = normalizeUrl(src);
      const cid = extractContentId(norm);
      collected.push({ url: norm, width: extractWidthFromUrl(src), id: cid });
    }
    if (collected.length > 0) {
      log('Strategy 4 (DOM scan all .pswp__img): ' + collected.length + ' images');
      return collected;
    }
  }

  // Strategy 5: Scan list-page thumbnail images for full-res URLs
  // Many real estate sites embed the full gallery in the list view as data attributes or href links
  const galleryUrlsFromList = scanGalleryFromListView();
  if (galleryUrlsFromList && galleryUrlsFromList.length > 0) {
    log('Strategy 5 (galleryFromList): ' + galleryUrlsFromList.length + ' images');
    return galleryUrlsFromList;
  }

  // Strategy 6: Try __NEXT_DATA__, window.__INITIAL_STATE__, or similar React/SSR data
  const galleryUrlsFromSsr = scanGalleryFromSsrData();
  if (galleryUrlsFromSsr && galleryUrlsFromSsr.length > 0) {
    log('Strategy 6 (ssrData): ' + galleryUrlsFromSsr.length + ' images');
    return galleryUrlsFromSsr;
  }

  // Strategy 7: Scan window for gallery/image arrays (common patterns)
  const galleryUrlsFromWindow = scanGalleryFromWindow();
  if (galleryUrlsFromWindow && galleryUrlsFromWindow.length > 0) {
    log('Strategy 7 (windowScan): ' + galleryUrlsFromWindow.length + ' images');
    return galleryUrlsFromWindow;
  }

  log('no PhotoSwipe items accessible via any strategy');
  return null;
}

/**
 * Strategy 5: Scan list-page DOM for gallery images.
 * Many sites put the full-res URL in:
 *   - <img> data-full-src / data-src / data-zoom-src / data-high-res-src attributes
 *   - <a> href pointing to full-res image
 *   - JSON data attributes on containers (data-images, data-gallery, etc.)
 *   - OEmbed / meta tags
 */
function scanGalleryFromListView() {
  const log = (msg) => console.log('[paging] [scanGalleryFromListView] ' + msg);
  const collected = [];

  // Patterns for full-res image attributes on <img> elements
  const imgFullResAttrs = [
    'data-full-src', 'data-full', 'data-zoom-src', 'data-zoom',
    'data-high-res-src', 'data-highres', 'data-hires', 'data-hd-src',
    'data-src-full', 'data-original', 'data-ghost', 'data-lazy-src',
    'data-expand', 'data-bg-src', 'data-img-src',
    // Common realestate site patterns
    'data-url', 'data-srcset',
  ];

  for (const img of document.querySelectorAll('img')) {
    for (const attr of imgFullResAttrs) {
      const val = img.getAttribute(attr);
      if (val && isValidImageUrl(val)) {
        const norm = normalizeUrl(val);
        const cid = extractContentId(norm);
        collected.push({ url: norm, width: extractWidthFromUrl(norm), id: cid });
        break;
      }
    }
  }

  // Patterns for <a href> pointing to full-res images
  const linkSelectors = [
    'a[href*=".jpg"]', 'a[href*=".jpeg"]', 'a[href*=".png"]', 'a[href*=".webp"]',
    'a[data-src]', 'a[data-href]', 'a[data-url]', 'a[data-image]',
  ];
  for (const selector of linkSelectors) {
    for (const a of document.querySelectorAll(selector)) {
      const href = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url') || a.getAttribute('data-image');
      if (href && isValidImageUrl(href)) {
        const norm = normalizeUrl(href);
        const cid = extractContentId(norm);
        if (!collected.find(x => x.url === norm)) {
          collected.push({ url: norm, width: extractWidthFromUrl(norm), id: cid });
        }
      }
    }
  }

  // Scan for JSON data attributes on containers
  const dataContainerSelectors = [
    '[data-images]', '[data-gallery]', '[data-photos]', '[data-media]',
    '[data-image-list]', '[data-photo-gallery]', '[data-slideshow]',
    '[data-json]', '[data-config]', '[data-props]', '[data-listing]',
  ];
  for (const container of document.querySelectorAll(dataContainerSelectors.join(','))) {
    for (const attr of container.attributes) {
      const val = attr.value;
      if (!val || val.length < 10) continue;
      try {
        if (val.startsWith('[') || val.startsWith('{')) {
          const parsed = JSON.parse(val);
          const urls = extractUrlsFromParsed(parsed);
          for (const url of urls) {
            const norm = normalizeUrl(url);
            const cid = extractContentId(norm);
            if (!collected.find(x => x.url === norm)) {
              collected.push({ url: norm, width: extractWidthFromUrl(norm), id: cid });
            }
          }
        }
      } catch (_) {}
    }
  }

  if (collected.length > 0) {
    log('Found ' + collected.length + ' images from list view');
  }
  return collected.length > 0 ? collected : null;
}

/**
 * Strategy 6: Scan SSR/RWT data blocks (NEXT_DATA, redux state, etc.)
 */
function scanGalleryFromSsrData() {
  const log = (msg) => console.log('[paging] [scanGalleryFromSsrData] ' + msg);
  const collected = [];

  // Common SSR data script tags
  const ssrSelectors = [
    '#__NEXT_DATA__',
    'script[data-reactstate]',
    'script[data-redux-state]',
    'script[data-page-context]',
    'script[id="__NEXT_DATA__"]',
    '#__PRELOADED_STATE__',
    'script[data-initial-state]',
  ];

  const ssrSources = [];
  for (const sel of ssrSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      ssrSources.push(el.textContent || el.innerText || '');
    }
  }

  // Also check window globals
  const windowKeys = [
    '__INITIAL_STATE__', '__PRELOADED_STATE__', '__STATE__',
    '__REDUX_STATE__', '__NEXT_REDUX_WRAPPER_STORE__',
    '__pageData__', '__INITIAL_PROPS__',
  ];
  for (const key of windowKeys) {
    try {
      if (window[key]) {
        ssrSources.push(JSON.stringify(window[key]));
      }
    } catch (_) {}
  }

  for (const src of ssrSources) {
    if (!src || src.length < 50) continue;
    try {
      const parsed = JSON.parse(src);
      const urls = extractUrlsFromParsed(parsed);
      for (const url of urls) {
        if (isValidImageUrl(url)) {
          const norm = normalizeUrl(url);
          const cid = extractContentId(norm);
          if (!collected.find(x => x.url === norm)) {
            collected.push({ url: norm, width: extractWidthFromUrl(norm), id: cid });
          }
        }
      }
    } catch (_) {}
  }

  if (collected.length > 0) {
    log('Found ' + collected.length + ' images from SSR data');
  }
  return collected.length > 0 ? collected : null;
}

/**
 * Strategy 7: Scan window object for gallery/image arrays.
 * Common patterns: window.images, window.gallery, window.photos, window.mediaItems, etc.
 */
function scanGalleryFromWindow() {
  const log = (msg) => console.log('[paging] [scanGalleryFromWindow] ' + msg);
  const collected = [];

  const candidates = [
    window.images, window.gallery, window.photos, window.mediaItems,
    window.imageUrls, window.imageList, window.galleryImages,
    window.listingImages, window.propertyImages, window.photoGallery,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const arr = Array.isArray(candidate) ? candidate : [candidate];
      for (const item of arr) {
        const url = typeof item === 'string' ? item : (item?.src || item?.url || item?.href || item?.image || item?.photo);
        if (url && isValidImageUrl(url)) {
          const norm = normalizeUrl(url);
          const cid = extractContentId(norm);
          if (!collected.find(x => x.url === norm)) {
            collected.push({ url: norm, width: extractWidthFromUrl(norm), id: cid });
          }
        }
      }
    } catch (_) {}
  }

  if (collected.length > 0) {
    log('Found ' + collected.length + ' images from window globals');
  }
  return collected.length > 0 ? collected : null;
}

/**
 * Recursively extract image URLs from a parsed object/array.
 */
function extractUrlsFromParsed(obj, depth = 0) {
  if (depth > 8) return [];
  const urls = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      urls.push(...extractUrlsFromParsed(item, depth + 1));
    }
  } else if (obj && typeof obj === 'object') {
    // Check common image URL fields
    const urlFields = ['src', 'url', 'href', 'original', 'full', 'large', 'high', 'hd', 'zoom', 'photo', 'image', 'media'];
    for (const field of urlFields) {
      const val = obj[field];
      if (typeof val === 'string' && isValidImageUrl(val)) {
        urls.push(val);
      } else if (typeof val === 'object' && val !== null) {
        urls.push(...extractUrlsFromParsed(val, depth + 1));
      }
    }
    // Recurse into all values
    for (const key of Object.keys(obj)) {
      if (!urlFields.includes(key) && typeof obj[key] === 'object' && obj[key] !== null) {
        urls.push(...extractUrlsFromParsed(obj[key], depth + 1));
      }
    }
  }
  return urls;
}

/**
 * Check if a URL is a valid image URL (not placeholder, not data:, not blob:).
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return false;
  if (isPlaceholderUrl(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  return lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp') || lower.includes('.gif') || lower.includes('.avif') || lower.includes('.svg');
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW GALLERY EXTRACTION MODULE — Signature-based approach
// Key principles:
// - Don't wait for fully loaded images
// - Use signature (canonicalized URL) as unique image key
// - Stop when no new signatures found after N consecutive attempts
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Canonicalize an image URL to a stable signature key.
 * Strips dimensions/resize parameters that vary but don't indicate different images.
 * Keeps the content hash portion which identifies the actual image.
 *
 * Strategy: Extract all hex strings >= 16 chars from path, take the LAST one.
 * This is more stable than regex patterns that might match path fragments.
 * Realestate image hashes are typically 40+ hex chars and appear near the end of URL path.
 */
function canonicalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim();
  if (!u.startsWith('http')) return u.toLowerCase();
  try {
    const parsed = new URL(u);
    const path = parsed.pathname;

    // Extract ALL hex strings >= 16 chars, take the LAST one as the true image hash
    // This avoids matching resize dimensions (e.g., "680x1176") or short path fragments
    const allHexMatches = path.match(/[a-f0-9]{16,}/gi);
    let sig = path;  // fallback to full path
    if (allHexMatches && allHexMatches.length > 0) {
      // Take the last match — realestate image hash is always near the end
      sig = allHexMatches[allHexMatches.length - 1].toLowerCase();
    }

    // Remove query params
    parsed.search = '';
    // Return just the signature + domain as key
    return parsed.hostname + ':' + sig;
  } catch (_) {
    return u.split('?')[0].toLowerCase();
  }
}

/**
 * Get PhotoSwipe instance if available.
 * Returns { instance, uid, totalSlides } or null.
 * Does NOT throw on failure.
 */
function getPhotoSwipeInstance() {
  try {
    const pswpRoot = document.querySelector('.pswp');
    if (!pswpRoot) return null;

    const uid = pswpRoot.dataset?.pswpUid;
    if (uid && window.pswp?.instances instanceof Map) {
      const inst = window.pswp.instances.get(Number(uid));
      if (inst) {
        let totalSlides = 0;
        if (typeof inst.getNumItems === 'function') {
          totalSlides = inst.getNumItems();
        } else if (Array.isArray(inst.items)) {
          totalSlides = inst.items.length;
        }
        return { instance: inst, uid: String(uid), totalSlides };
      }
    }
    if (pswpRoot.__pswp) {
      const inst = pswpRoot.__pswp;
      let totalSlides = 0;
      if (typeof inst.getNumItems === 'function') {
        totalSlides = inst.getNumItems();
      } else if (Array.isArray(inst.items)) {
        totalSlides = inst.items.length;
      }
      return { instance: inst, uid: 'el', totalSlides };
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Wait for gallery to enter "URL readable" state.
 * Success criteria: at least one .pswp__img with a valid http(s) src or currentSrc.
 */
async function waitForGalleryReady(timeoutMs = 3000) {
  const start = Date.now();
  let polls = 0;
  while (Date.now() - start < timeoutMs) {
    polls++;
    const pswp = document.querySelector('.pswp.pswp--open');
    if (!pswp) {
      await new Promise(r => setTimeout(r, 120));
      continue;
    }
    const imgs = Array.from(pswp.querySelectorAll('.pswp__img'));
    for (const img of imgs) {
      const src = (img.currentSrc || img.src || '').trim();
      if (src && src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('blob:')) {
        console.log('[gallery] waitForGalleryReady success at poll ' + polls + ' after ' + (Date.now() - start) + 'ms');
        return { ready: true, pollCount: polls };
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('[gallery] waitForGalleryReady TIMEOUT after ' + polls + ' polls');
  return { ready: false, pollCount: polls };
}

/**
 * Check if URL is a valid reastatic image URL.
 * Filters out placeholders, data:, blob:, and non-reastatic URLs.
 */
function isValidReastaticUrl(src) {
  if (!src || !src.startsWith('http')) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;
  // Must be from reastatic CDN
  return /reastatic\.(net|com\.au)/i.test(src);
}

/**
 * Get a snapshot of the current active slide.
 * Priority: PhotoSwipe API > transform-based > aria > area.
 */
function getActiveSlideSnapshot() {
  const pswp = document.querySelector('.pswp');
  if (!pswp) return { isValid: false };

  // Strategy A: PhotoSwipe API
  const pswpInfo = getPhotoSwipeInstance();
  if (pswpInfo) {
    try {
      const currIndex = pswpInfo.instance.currIndex;
      const items = pswpInfo.instance.items || [];
      const item = items[currIndex];
      if (item) {
        const rawSrc = item.src || item.thumb || '';
        const signature = canonicalizeImageUrl(rawSrc);
        return {
          currIndex,
          strategy: 'pswp-api',
          signature,
          rawSrc,
          isValid: isValidReastaticUrl(rawSrc),
        };
      }
    } catch (_) {}
  }

  // Strategy B: find the center-most slide by transform
  const items = Array.from(pswp.querySelectorAll('.pswp__item'));
  let bestItem = null, bestAbsTx = Infinity, bestSlotIndex = -1;
  for (let i = 0; i < items.length; i++) {
    const style = window.getComputedStyle(items[i]);
    const tx = parseTranslateX(style.transform);
    const absTx = Math.abs(tx);
    if (absTx < bestAbsTx) {
      bestAbsTx = absTx;
      bestItem = items[i];
      bestSlotIndex = i;
    }
  }

  if (bestItem) {
    const imgs = Array.from(bestItem.querySelectorAll('.pswp__img'));
    let bestImg = null;
    for (const img of imgs) {
      const src = (img.currentSrc || img.src || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      bestImg = img;
      // Prefer realastatic images without waiting for load
      if (/reastatic\.(net|com\.au)/i.test(src)) break;
    }
    if (!bestImg) {
      bestImg = imgs.find(img => {
        const src = (img.currentSrc || img.src || '').trim();
        return src.startsWith('http');
      });
    }
    if (bestImg) {
      const rawSrc = (bestImg.currentSrc || bestImg.src || '').trim();
      const signature = canonicalizeImageUrl(rawSrc);
      return {
        currIndex: bestSlotIndex,
        strategy: 'transform-slot',
        slotIndex: bestSlotIndex,
        transformX: -bestAbsTx,
        imgEl: bestImg,
        rawSrc,
        signature,
        isValid: isValidReastaticUrl(rawSrc),
      };
    }
  }

  // Strategy C: aria-hidden=false
  for (const item of items) {
    if (item.getAttribute('aria-hidden') === 'false') {
      const imgs = Array.from(item.querySelectorAll('.pswp__img'));
      for (const img of imgs) {
        const src = (img.currentSrc || img.src || '').trim();
        if (isValidReastaticUrl(src)) {
          const signature = canonicalizeImageUrl(src);
          return { strategy: 'aria', signature, rawSrc: src, isValid: true, imgEl: img };
        }
      }
    }
  }

  // Strategy D: largest visible img
  const allImgs = Array.from(pswp.querySelectorAll('.pswp__img'));
  let bestArea = 0, bestVisibleImg = null;
  for (const img of allImgs) {
    const src = (img.currentSrc || img.src || '').trim();
    if (!isValidReastaticUrl(src)) continue;
    const r = img.getBoundingClientRect();
    const visible = r.width > 10 && r.height > 10;
    const area = r.width * r.height;
    if (visible && area > bestArea) {
      bestArea = area;
      bestVisibleImg = img;
    }
  }
  if (bestVisibleImg) {
    const rawSrc = (bestVisibleImg.currentSrc || bestVisibleImg.src || '').trim();
    const signature = canonicalizeImageUrl(rawSrc);
    return { strategy: 'area', signature, rawSrc, isValid: true, imgEl: bestVisibleImg };
  }

  return { isValid: false, strategy: 'none' };
}

/**
 * Wait for a real slide change to occur.
 * Success conditions:
 *   A. PhotoSwipe API: currIndex changed AND signature changed (双重确认)
 *   B. No PhotoSwipe API: signature changed (唯一判断依据)
 *
 * 不会因为 currIndex 变了但图片没变就返回成功
 */
async function waitForRealSlideChange(prevSnapshot, prevCurrIndex, timeoutMs = 4000) {
  const start = Date.now();
  let polls = 0;
  let lastSnapshot = prevSnapshot;

  while (Date.now() - start < timeoutMs) {
    polls++;
    await new Promise(r => setTimeout(r, 150));

    const pswpInfo = getPhotoSwipeInstance();
    const snapshot = getActiveSlideSnapshot();
    lastSnapshot = snapshot;

    // Strategy A: PhotoSwipe API available — 需要 currIndex 和 signature 双重确认
    if (pswpInfo) {
      const newCurrIndex = pswpInfo.instance.currIndex;
      if (newCurrIndex !== prevCurrIndex) {
        // currIndex 变了，必须再确认 signature 也变了才算成功
        if (snapshot.isValid && snapshot.signature && snapshot.signature !== prevSnapshot?.signature) {
          console.log('[gallery] waitForRealSlideChange: A-success pswp-api+signature ' + prevCurrIndex + ' -> ' + newCurrIndex + ', sig changed (' + polls + ' polls, ' + (Date.now() - start) + 'ms)');
          return { changed: true, newSnapshot: snapshot, prevSnapshot, reason: 'pswp-api+signature', newCurrIndex, polls };
        }
        // currIndex 变了但 signature 没变 = PhotoSwipe 内部 glitch，继续等待
        console.log('[gallery] waitForRealSlideChange: A-glitch currIndex changed but sig same, continue polling');
      }
    }

    // Strategy B: signature changed (fallback 或无 API 时的唯一判断)
    if (snapshot.isValid && snapshot.signature && snapshot.signature !== prevSnapshot?.signature) {
      const reason = pswpInfo ? 'signature-only(no-pswp-index)' : 'signature';
      console.log('[gallery] waitForRealSlideChange: B-success ' + reason + ' ' + (prevSnapshot?.signature || 'null') + ' -> ' + snapshot.signature + ' (' + polls + ' polls, ' + (Date.now() - start) + 'ms)');
      return { changed: true, newSnapshot: snapshot, prevSnapshot, reason, polls };
    }
  }

  console.log('[gallery] waitForRealSlideChange: TIMEOUT after ' + polls + ' polls, ' + (Date.now() - start) + 'ms, prevSignature=' + (prevSnapshot?.signature || 'null') + ', currSignature=' + (lastSnapshot?.signature || 'null'));
  return { changed: false, newSnapshot: lastSnapshot, prevSnapshot, reason: 'timeout', polls };
}

/**
 * Advance to next slide. Priority: pswp API > button click > keyboard.
 */
function advanceToNextSlide() {
  const pswpInfo = getPhotoSwipeInstance();
  if (pswpInfo) {
    try {
      pswpInfo.instance.next();
      console.log('[gallery] advanceToNextSlide: used=pswp-api');
      return { used: 'pswp-api', success: true };
    } catch (_) {}
  }

  const btn =
    document.querySelector('.pswp__button--arrow--right') ||
    document.querySelector('.pswp__button--arrow--next') ||
    document.querySelector('[class*="arrow"][class*="right"]');

  if (btn && !btn.disabled) {
    try { btn.click(); } catch (_) { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    console.log('[gallery] advanceToNextSlide: used=button');
    return { used: 'button', success: true };
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  console.log('[gallery] advanceToNextSlide: used=keyboard');
  return { used: 'keyboard', success: true };
}

/**
 * Close the PhotoSwipe gallery if it is open.
 * Uses user-behavior simulation (close button → ESC → DOM removal) for maximum compatibility.
 * Safe to call redundantly — does nothing if gallery is not open.
 */
function closeGallery() {
  try {
    const pswpRoot = document.querySelector('.pswp.pswp--open');
    if (!pswpRoot) return;

    console.log('[gallery] Attempting to close PhotoSwipe...');

    // 1️⃣ Try clicking the close button (most stable)
    const closeBtn = pswpRoot.querySelector('.pswp__button--close');
    if (closeBtn) {
      closeBtn.click();
      console.log('[gallery] closed via close button');
      return;
    }

    // 2️⃣ Simulate ESC key
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
      })
    );
    console.log('[gallery] dispatched ESC');

    // 3️⃣ Fallback: force-remove DOM after animation settles
    setTimeout(() => {
      const stillOpen = document.querySelector('.pswp.pswp--open');
      if (stillOpen) {
        stillOpen.remove();
        console.log('[gallery] force removed pswp DOM');
      }
    }, 300);
  } catch (err) {
    console.warn('[gallery] closeGallery error:', err);
  }
}

/**
 * NEW PhotoSwipe gallery extraction using signature-based approach.
 *
 * @returns {Promise<string[]>} Deduplicated image URL array
 */
async function collectByPhotoSwipePaging() {
  if (_pagingLock) {
    console.log('[gallery] collectByPhotoSwipePaging: skipped (lock held)');
    return [];
  }
  _pagingLock = true;

  const result = [];
  try {
    console.log('[gallery] ====== START PhotoSwipe extraction ======');

    const pswp = document.querySelector('.pswp.pswp--open');
    if (!pswp) {
      console.log('[gallery] PhotoSwipe not open, returning empty');
      return [];
    }

    // Wait for gallery to be ready
    const ready = await waitForGalleryReady(3000);
    if (!ready.ready) {
      console.log('[gallery] Gallery not ready, returning empty');
      return [];
    }

    // Get PhotoSwipe instance info
    const pswpInfo = getPhotoSwipeInstance();
    const totalSlides = pswpInfo?.totalSlides || 0;
    console.log('[gallery] Gallery ready, totalSlides=' + totalSlides);

    // Get initial snapshot
    const initialSnapshot = getActiveSlideSnapshot();
    console.log('[gallery] Initial snapshot: strategy=' + initialSnapshot.strategy + ', signature=' + (initialSnapshot.signature || 'null') + ', rawSrc=' + (initialSnapshot.rawSrc?.substring(0, 60) || 'null'));

    if (!initialSnapshot.isValid) {
      console.log('[gallery] Cannot read any image URL from initial snapshot');
      return [];
    }

    // ── Snapshot vs Result Item ─────────────────────────────────────────
    // snapshot: 翻页判断用，包含 signature/rawSrc/slotIndex 等元数据
    //   字段: { isValid, strategy, signature, rawSrc, currIndex, slotIndex, transformX, imgEl }
    // result item: 最终输出用，只包含签名和 URL
    //   字段: { signature, url }
    // ───────────────────────────────────────────────────────────────────

    // Record first image (result item)
    const firstSignature = initialSnapshot.signature;
    const firstSrc = initialSnapshot.rawSrc;
    if (firstSignature && firstSrc) {
      result.push({ signature: firstSignature, url: firstSrc });
      console.log('[gallery] RECORDED [0]: signature=' + firstSignature + ', url=' + firstSrc.substring(0, 80));
    }

    // Maintain currentSnapshot for next comparison (snapshot, not result item)
    let currentSnapshot = initialSnapshot;

    // Main loop
    const seenSignatures = new Set([firstSignature]);
    let consecutiveNoNew = 0;
    let totalAttempts = 0;
    const MAX_NO_NEW = 3;
    const MAX_TOTAL = 60;

    while (totalAttempts < MAX_TOTAL) {
      totalAttempts++;

      // Re-fetch pswpInfo each iteration (DOM may have changed)
      const pswpInfoNow = getPhotoSwipeInstance();
      const totalSlidesNow = pswpInfoNow?.totalSlides || 0;
      const prevCurrIndex = pswpInfoNow?.instance?.currIndex ?? 0;

      if (totalSlidesNow > 0 && result.length >= totalSlidesNow) {
        console.log('[gallery] Reached totalSlides limit (' + totalSlidesNow + '), stopping');
        break;
      }

      // Advance to next slide
      advanceToNextSlide();

      // Wait for slide to change — pass full snapshot (not result item)
      const waitResult = await waitForRealSlideChange(
        currentSnapshot,  // Always pass the current full snapshot
        prevCurrIndex,
        4000
      );

      if (!waitResult.changed) {
        consecutiveNoNew++;
        console.log('[gallery] ITER ' + totalAttempts + ': no change (reason=' + waitResult.reason + '), consecutiveNoNew=' + consecutiveNoNew + '/' + MAX_NO_NEW);
        if (consecutiveNoNew >= MAX_NO_NEW) {
          console.log('[gallery] STOP: ' + MAX_NO_NEW + ' consecutive attempts with no new images');
          break;
        }
        continue;
      }

      consecutiveNoNew = 0;

      // Get new snapshot from wait result (full snapshot, not result item)
      const newSnapshot = waitResult.newSnapshot;

      // Update currentSnapshot for next iteration
      currentSnapshot = newSnapshot;

      if (!newSnapshot.isValid) {
        console.log('[gallery] ITER ' + totalAttempts + ': new snapshot invalid, skipping');
        continue;
      }

      const newSignature = newSnapshot.signature;
      const newSrc = newSnapshot.rawSrc;

      if (seenSignatures.has(newSignature)) {
        console.log('[gallery] ITER ' + totalAttempts + ': LOOP-BACK detected, signature=' + newSignature + ' already seen');
        if (result.length >= 3) {
          console.log('[gallery] STOP: loop-back with ' + result.length + ' images collected');
          break;
        }
        console.log('[gallery] loop-back but only ' + result.length + ' images, trying one more...');
        continue;
      }

      // Record new image (result item — signature + url only)
      seenSignatures.add(newSignature);
      result.push({ signature: newSignature, url: newSrc });
      console.log('[gallery] ITER ' + totalAttempts + ': RECORDED [' + (result.length - 1) + ']: signature=' + newSignature + ', reason=' + waitResult.reason + ', polls=' + waitResult.polls);
    }

    // Build final result (NEVER return empty if we have results)
    const finalUrls = [];
    const finalSeen = new Set();
    for (const item of result) {
      if (!item.signature && !item.url) continue;
      const key = item.signature || item.url.split('?')[0].toLowerCase();
      if (!finalSeen.has(key)) {
        finalSeen.add(key);
        finalUrls.push(item.url);
        console.log('[gallery] FINAL-KEEP: ' + item.url.substring(0, 80));
      } else {
        console.log('[gallery] FINAL-DROP: ' + item.url.substring(0, 80));
      }
    }

    finalUrls.sort((a, b) => extractWidthFromUrl(b) - extractWidthFromUrl(a));

    console.log('[gallery] ====== FINISH ======');
    console.log('[gallery] Total: ' + result.length + ' collected, ' + finalUrls.length + ' unique after dedup');

    // Return what we have, even if less than expected
    return finalUrls.length > 0 ? finalUrls : [];

  } catch (err) {
    console.error('[gallery] Error during extraction:', err);
    // Return whatever we collected, don't lose results due to mid-flow errors
    const finalUrls = result
      .filter(item => item.signature || item.url)
      .map(item => item.url)
      .filter((url, idx, arr) => arr.indexOf(url) === idx);
    console.log('[gallery] Returning ' + finalUrls.length + ' photos despite error');
    return finalUrls;
  } finally {
    _pagingLock = false;
    closeGallery();
  }
}


// ── Mark as ready ──
isReady = true;
console.log('[HomeScope] Content script loaded — user-triggered extraction mode');

})(); // End of IIFE

