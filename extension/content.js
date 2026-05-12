/**
 * HomeScope Content Script
 * Handles page extraction and gallery image collection (user-triggered only).
 */

;(function() {
  'use strict';

  const noop = (..._args) => {};

// ===== Deep query function that traverses Shadow DOM =====
function queryDeep(root, selector) {
  let result = root.querySelector(selector);
  if (!result) {
    // Traverse Shadow DOM
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        result = queryDeep(el.shadowRoot, selector);
        if (result) break;
      }
    }
  }
  return result;
}

// ===== Hidden price patterns (Price on Application) =====
const HIDDEN_PRICE_PATTERNS = [
  /contact\s+agent/i,
  /price\s+on\s+application/i,
  /\bpoa\b/i,
  /\bPOA\b/i,
  /enquire\s+for\s+price/i,
  /ask\s+for\s+price/i,
  /price\s+upon\s+request/i,
  /tba\b/i,
  /tbd\b/i,
  /to\s+be\s+advised/i,
  /to\s+be\s+announced/i,
  /auction\s+guide/i,
  /^$\s*contact\s+agent/i,
];

function isHiddenPrice(text) {
  if (!text) return false;
  const normalized = text.replace(/\$[\d,]+/g, '').trim();
  return HIDDEN_PRICE_PATTERNS.some(p => p.test(normalized));
}

// ===== Extract data from window.__NEXT_DATA__ or window.__RE_STATE__ =====
function extractFromWindowState() {
  const result = { price: null, title: null, address: null };

  // Method 1: window.__NEXT_DATA__ (Next.js App Router)
  if (window.__NEXT_DATA__) {
    try {
      const pageProps = window.__NEXT_DATA__.props?.pageProps;
      if (pageProps) {
        const price = deepFindPrice(pageProps);
        if (price) result.price = price;
      }
    } catch (_) {}
  }

  // Method 2: window.__RE_STATE__ (Realestate.com.au Redux-like state)
  if (window.__RE_STATE__) {
    try {
      const stateStr = JSON.stringify(window.__RE_STATE__);
      const priceMatch = stateStr.match(/\$\s*[\d,]+(?:\.\d+)?/);
      if (priceMatch) result.price = priceMatch[0];
    } catch (_) {}
  }

  // Method 3: window.__INITIAL_STATE__ or window.__PRELOADED_STATE__
  const stateKeys = ['__INITIAL_STATE__', '__PRELOADED_STATE__', '__STATE__'];
  for (const key of stateKeys) {
    if (window[key]) {
      try {
        const price = deepFindPrice(window[key]);
        if (price) result.price = price;
      } catch (_) {}
    }
  }

  return result;
}

// ===== Deep search for price in nested objects =====
function deepFindPrice(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  // Check if this object has price-related fields
  if (obj.price != null || obj.askingPrice != null || obj.lowPrice != null) {
    const price = obj.price ?? obj.askingPrice ?? obj.lowPrice;
    if (typeof price === 'number' || (typeof price === 'string' && /^\$?[\d,]+/.test(price))) {
      const priceStr = String(price);
      const currency = obj.priceCurrency || obj.currency || 'AUD';
      if (priceStr.startsWith('$')) return priceStr;
      return currency === 'AUD' || currency === 'USD' ? `$${priceStr}` : `${currency}${priceStr}`;
    }
  }

  // Check for currency: "AUD" with price field
  if (obj.currency === 'AUD' && obj.price != null) {
    return `$${obj.price}`;
  }

  // Recursively search in array items and object values
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindPrice(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key === '__reactFiber' || key === '__reactFiber' || key.startsWith('__')) continue;
      const found = deepFindPrice(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// ===== Recursive JSON-LD scanner for nested @graph arrays =====
function recursiveJsonLdScan(obj, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return [];

  const results = [];

  // Check if this is a listing-like object
  if (obj['@type'] === 'Residence' || obj['@type'] === 'House' || obj['@type'] === 'Apartment' ||
      obj['@type'] === 'SingleFamilyResidence' || obj['@type'] === 'RealEstateListing' ||
      obj['@type'] === 'Product') {
    results.push(obj);
  }

  // Scan nested @graph arrays
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) {
      results.push(...recursiveJsonLdScan(item, depth + 1));
    }
  }

  // Scan children
  for (const key of Object.keys(obj)) {
    if (key === '@graph' || key === '@context') continue;
    if (Array.isArray(obj[key])) {
      for (const item of obj[key]) {
        if (typeof item === 'object') {
          results.push(...recursiveJsonLdScan(item, depth + 1));
        }
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      results.push(...recursiveJsonLdScan(obj[key], depth + 1));
    }
  }

  return results;
}

// ===== MutationObserver-based extraction with retry =====
async function waitForPriceExtraction(maxWaitMs = 8000, intervalMs = 300) {
  // First, try immediately (React might have already rendered)
  const immediatePrice = extractPriceWithNewLogic();
  if (immediatePrice && !isHiddenPrice(immediatePrice)) {
    return { price: immediatePrice, hidden: false };
  }
  if (immediatePrice && isHiddenPrice(immediatePrice)) {
    return { price: immediatePrice, hidden: true };
  }

  // If no immediate price, use polling (MutationObserver may not catch React's rendering)
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = Math.floor(maxWaitMs / intervalMs);

    const tryExtract = () => {
      attempts++;
      const price = extractPriceWithNewLogic();
      if (price) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve({ price, hidden: isHiddenPrice(price) });
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve({ price: null, hidden: false, timedOut: true });
      }
    };

    // Polling interval - this is more reliable than MutationObserver for React apps
    const interval = setInterval(tryExtract, intervalMs);

    // Timeout fallback
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve({ price: null, hidden: false, timedOut: true });
    }, maxWaitMs);
  });
}

// ===== New unified price extraction logic (P0-P4 priority stack) =====
function extractPriceWithNewLogic() {
  // P0: Check window state (Next.js / Redux)
  const windowState = extractFromWindowState();
  if (windowState.price) return windowState.price;

  // P1: JSON-LD recursive scan
  const price = extractPriceFromJsonLdDeep();
  if (price) return price;

  // P2: semantic class names + data-testid
  const dataTestIdPrice = extractPriceFromDataTestId();
  if (dataTestIdPrice) return dataTestIdPrice;

  // P3: Shadow DOM traversal
  const shadowPrice = extractPriceFromShadowDOM();
  if (shadowPrice) return shadowPrice;

  // P4: Last resort - text search
  return extractPriceFromTextSearch();
}

function extractPriceFromJsonLdDeep() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const raw = script.textContent || '';
      const data = JSON.parse(raw);

      // Scan all nested objects recursively
      const listings = recursiveJsonLdScan(data);
      for (const listing of listings) {
        const offer = listing.offers || listing.aggregateOffer || {};
        if (offer.price != null || offer.lowPrice != null) {
          const priceVal = offer.price ?? offer.lowPrice;
          const currency = offer.priceCurrency || offer.priceCurrency || 'AUD';
          const formatted = currency === 'AUD' || currency === 'USD' ? `$${priceVal}` : `${currency}${priceVal}`;
          if (offer.unitText) {
            return `${formatted} ${offer.unitText}`;
          }
          return formatted;
        }
      }
    } catch (_) {}
  }
  return null;
}

function extractPriceFromDataTestId() {
  // P2a: Realestate semantic class names (most stable for this site)
  const semanticSelectors = [
    '.property-info__price',           // Realestate main price container
    '.property-price',                 // Realestate price element
    '[class*="property-info__price"]', // Partial match fallback
    '[class*="property-price"]',       // Partial match fallback
  ];

  for (const sel of semanticSelectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const text = el.textContent?.trim() || '';
      if (/\$[\d,]+/.test(text)) {
        const parent = el.closest('.property-info__middle-content, .listing-details, main, article, [class*="main-listing"]');
        if (parent || els.length === 1) {
          return text;
        }
      }
    }
  }

  // P2b: data-testid selectors
  const selectors = [
    '[data-testid="price"]',
    '[data-testid="listing-price"]',
    '[data-testid="property-price"]',
    '[data-testid="search-result-price"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent?.trim() || '';
      if (/\$[\d,]+/.test(text)) {
        return text;
      }
    }
  }

  // P2c: Search all data-testid elements
  const allDataTestId = document.querySelectorAll('[data-testid]');
  for (const el of allDataTestId) {
    const text = el.textContent?.trim() || '';
    const match = text.match(/\$[\d,]+(?:\.\d+)?\s*(?:\/\s*(?:week|month|annum))?/i);
    if (match) {
      return match[0].trim();
    }
  }

  return null;
}

function extractPriceFromShadowDOM() {
  const selectors = [
    // Semantic selectors first (most likely to be stable)
    '.property-info__price',
    '.property-price',
    '[class*="property-info__price"]',
    '[class*="property-price"]',
    // data-testid as fallback
    '[data-testid="price"]',
    '[data-testid="listing-price"]',
  ];

  for (const sel of selectors) {
    const result = queryDeep(document, sel);
    if (result) {
      const text = result.textContent?.trim() || '';
      if (/\$[\d,]+/.test(text)) {
        return text;
      }
    }
  }

  return null;
}

function extractPriceFromTextSearch() {
  // Search page text for price patterns
  const text = document.body.innerText;
  const patterns = [
    /\$\s*[\d,]+(?:\.\d+)?\s*(?:\/\s*(?:week|weekly|pw|w\/k|month|pcm|annum|year))?/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const validPrices = matches.filter(m => {
        const num = parseFloat(m.replace(/[^\d.]/g, ''));
        return num >= 100;
      });
      if (validPrices.length > 0) {
        return validPrices[0].trim();
      }
    }
  }

  // P5: Aggressive scan for elements with "price" in class
  const priceElements = document.querySelectorAll('[class*="price"]');
  for (const el of priceElements) {
    const text = el.textContent?.trim() || '';
    const match = text.match(/\$[\d,]+(?:\.\d+)?/);
    if (match) {
      return text;
    }
  }

  return null;
}

// ===== Content script instance ID (for debugging multi-injection) =====
const INSTANCE_ID = Math.random().toString(36).slice(2, 9);

  // ===== Define handlers FIRST (before any messages can arrive) =====

  // ── Auth bridge handler ──
  function handleAuthBridge(event) {
    // Only accept messages from the page (same window instance)
    if (event.source !== window) {
      return;
    }

    // Validate message source
    if (event.data?.source !== 'homescope-auth-bridge') {
      return;
    }

    if (event.data?.type === 'HOMESCOPE_SYNC_SESSION') {
      chrome.runtime.sendMessage(
        { action: 'sync_session_from_site', payload: event.data.payload },
        (response) => {
          if (chrome.runtime.lastError) {
            event.source.postMessage({
              source: 'homescope-auth-bridge',
              type: 'HOMESCOPE_SESSION_ACK',
              success: false,
              error: chrome.runtime.lastError.message
            }, event.origin);
            return;
          }
          event.source.postMessage({
            source: 'homescope-auth-bridge',
            type: 'HOMESCOPE_SESSION_ACK',
            success: response?.success !== false,
            error: response?.error || null
          }, event.origin);
        }
      );
    }
  }

  // ── Message handler ──
  function handleMessage(message, sender, sendResponse) {
    const { action } = message;
    switch (action) {
      case 'PONG':
        // Always respond with this instance's ID
        sendResponse({ ready: true, instanceId: INSTANCE_ID, url: window.location.href, title: document.title });
        break;

      case 'GET_PAGE_STATE':
        sendResponse(getPageState());
        break;

      case 'EXTRACT_LISTING':
        extractListingDataLight().then(({ listing, detection }) => {
          pageData = listing;
          sendResponse({ data: listing, error: null, detection });
        }).catch((err) => {
          sendResponse({ data: null, error: err.message, detection: null });
        });
        return true;

      case 'START_USER_EXTRACTION':
        startUserExtraction(message.bypassCache).then(({ listing, detection }) => {
          pageData = listing;
          sendResponse({ success: true, data: listing, detection });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message, code: err.code || 'EXTRACTION_ERROR' });
        });
        return true;

      case 'GET_CACHED_DATA':
        sendResponse({ success: true, data: pageData });
        break;

      default:
        sendResponse({ success: false, error: 'UNKNOWN_ACTION' });
    }
  }

  // ===== Register listeners =====
  chrome.runtime.onMessage.addListener(handleMessage);
  window.addEventListener('message', handleAuthBridge);

  // ===== User-triggered extraction session state =====

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
        _extractionLock = false;
        return cached;
      }
    }

    // ── Step: Extract lightweight data ──
    const { listing: lightListing, detection: lightDetection } = await extractListingDataLight();
    noop('[DIAG] Light extraction result:', JSON.stringify({
      title: lightListing.title?.substring(0, 50),
      address: lightListing.address?.substring(0, 50),
      price: lightListing.price?.substring(0, 30),
      imageUrlsLen: (lightListing.imageUrls || []).length,
      descriptionLen: lightListing.description?.length || 0
    }));

    // ── Step: Open PhotoSwipe gallery ──
    noop('[DIAG] Attempting to open PhotoSwipe gallery...');
    const opened = await openGallery();
    noop('[DIAG] openGallery returned:', opened);

    // ── Step: Collect images via PhotoSwipe paging ──
    let imageUrls = [];
    if (opened) {
      noop('[DIAG] PhotoSwipe gallery opened, starting to collect images...');
      imageUrls = await collectByPhotoSwipePaging();
      noop('[DIAG] collectByPhotoSwipePaging returned:', imageUrls.length, 'images');
    } else {
      noop('[DIAG] PhotoSwipe gallery failed to open — returning listing with empty images');
    }

    // ── Step: Build complete listing ──
    const listing = {
      ...lightListing,
      imageUrls,
    };

    noop('[DIAG] Final extraction result:', JSON.stringify({
      imageUrlsCount: listing.imageUrls.length,
      descriptionLen: listing.description?.length || 0
    }));

    // ── Step: Ensure we have either images OR description ──
    if (listing.imageUrls.length === 0 && !listing.description) {
      const fallbackParts = [listing.title, listing.address].filter(Boolean);
      listing.description = fallbackParts.join(' — ') || 'Property listing';
    }

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
/**
 * Parse all <script type="application/ld+json"> tags and return ALL structured objects
 * that look like a real-estate listing.
 * Sites may have multiple JSON-LD blocks with partial data, so we collect all to merge.
 */
function parseJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const results = [];
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
          (type === 'product' && item.name);
        if (isListing) {
          results.push(item);
        }
      }
    } catch (_) {
      // Malformed JSON — skip
    }
  }
  return results;
}

/**
 * Extract structured property fields from a SINGLE JSON-LD object.
 * Returns null for each field that cannot be resolved.
 */
function extractFromSingleJsonLd(json) {
  if (!json) return null;

  try {
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
  } catch (_) {
    return { title: null, address: null, price: null, rooms: { bedrooms: null, bathrooms: null, parking: null }, description: null };
  }
}

/**
 * Extract and merge structured property fields from MULTIPLE JSON-LD objects.
 * Different JSON-LD blocks may contain different fields, so we merge them
 * to get the most complete data possible.
 *
 * @param {Array} jsonLdArray - Array of JSON-LD objects from parseJsonLd()
 * @returns {Object} Merged listing data
 */
function extractListingFromJsonLd(jsonLdArray) {
  if (!jsonLdArray || !Array.isArray(jsonLdArray) || jsonLdArray.length === 0) {
    return null;
  }

  try {
    let mergedTitle = null;
    let mergedAddress = null;
    let mergedPrice = null;
    let mergedDescription = null;
    let mergedRooms = { bedrooms: null, bathrooms: null, parking: null };

    // Score each JSON-LD to find the best one for title/address (usually the Residence type)
    let bestForTitle = null;
    let bestForTitleScore = 0;
    let bestForDetails = null; // The one with most complete price/description
    let bestForDetailsScore = 0;

  for (const json of jsonLdArray) {
    const single = extractFromSingleJsonLd(json);
    if (!single) continue;

    // Score for title/address (prefer complete addresses)
    let titleScore = 0;
    if (single.title) titleScore += 1;
    if (single.address) {
      const addrLen = single.address.split(',').length;
      titleScore += addrLen; // More parts = more complete address
    }

    if (titleScore > bestForTitleScore) {
      bestForTitleScore = titleScore;
      bestForTitle = single;
    }

    // Score for details (price, description, rooms)
    let detailsScore = 0;
    if (single.price) detailsScore += 3;
    if (single.description) detailsScore += 3;
    if (single.rooms.bedrooms) detailsScore += 1;
    if (single.rooms.bathrooms) detailsScore += 1;
    if (single.rooms.parking) detailsScore += 1;

    if (detailsScore > bestForDetailsScore) {
      bestForDetailsScore = detailsScore;
      bestForDetails = single;
    }
  }

  // Merge: use bestForTitle for title/address, bestForDetails for price/description/rooms
  if (bestForTitle) {
    mergedTitle = bestForTitle.title;
    mergedAddress = bestForTitle.address;
  }

  if (bestForDetails) {
    mergedPrice = bestForDetails.price;
    mergedDescription = bestForDetails.description;
    if (bestForDetails.rooms.bedrooms != null) mergedRooms.bedrooms = bestForDetails.rooms.bedrooms;
    if (bestForDetails.rooms.bathrooms != null) mergedRooms.bathrooms = bestForDetails.rooms.bathrooms;
    if (bestForDetails.rooms.parking != null) mergedRooms.parking = bestForDetails.rooms.parking;
  }

  return {
    title: mergedTitle,
    address: mergedAddress,
    price: mergedPrice,
    rooms: mergedRooms,
    description: mergedDescription
  };
  } catch (_) {
    return null;
  }
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

/**
 * 自动检测房源类型：买房(sale)还是租房(rent)
 * 用于 realestate.com.au 页面
 * 
 * 判断优先级：
 * 1. URL 路径（最可靠）
 * 2. 价格格式（per week = 租房，大数字总价 = 买房）
 * 3. 页面特定元素（Bond、Available 日期、土地面积、按钮文案）
 * 
 * @param {Object} listing - 提取的房源数据
 * @param {string} url - 当前页面 URL
 * @returns {'sale' | 'rent'}
 */
function detectReportMode(listing, url) {
  const urlLower = url.toLowerCase();
  const priceText = (listing.priceText || '').toLowerCase();
  const bodyText = document.body.innerText || '';
  
  // ========== 第一优先级：URL ==========
  // 租房 URL (通用)
  if (urlLower.includes('/rent/') || 
      urlLower.includes('/rental/') ||
      urlLower.includes('/to-rent/')) {
    return 'rent';
  }
  
  // 买房 URL (通用)
  if (urlLower.includes('/buy/') || 
      urlLower.includes('/for-sale/') ||
      urlLower.includes('/sale/') ||
      urlLower.includes('/sold/')) {
    return 'sale';
  }
  
  // ========== Zillow 特定检测 ==========
  if (isZillowPage()) {
    // Zillow rent URL
    if (urlLower.includes('zillow.com/rent') || urlLower.includes('for-rent')) {
      return 'rent';
    }
    
    // Zillow for sale URL patterns
    if (urlLower.includes('homedetails') || 
        urlLower.includes('/condo/') || 
        urlLower.includes('/townhouse/') ||
        urlLower.includes('/lot/') ||
        urlLower.includes('for-sale')) {
      return 'sale';
    }
    
    // Zillow 特有特征
    // 租房：Rent Zestimate 显示
    if (/\bRent\s*Zestimate\b/i.test(bodyText)) {
      return 'rent';
    }
    
    // 买房：Zestimate 显示
    if (/\bZestimate\b/i.test(bodyText)) {
      return 'sale';
    }
  }
  
  // ========== 第二优先级：价格格式 ==========
  // 租房特征：per week / pw / p/w
  if (/\b(per\s*week|pw|p\/w|weekly)\b/i.test(priceText)) {
    return 'rent';
  }
  
  // 租房特征：Bond + 金额（澳洲租房押金通常是 4 周房租）
  // 匹配 "Bond $2,000" 或 "Bond: 2000" 等格式
  if (/\bBond\b[:\s]*\$?\d+/i.test(bodyText)) {
    return 'rent';
  }
  
  // 买房特征：大数字（>=50万）且无周期单位
  const priceNum = parseFloat(priceText.replace(/[^\d]/g, ''));
  if (priceNum >= 500000 && !/\b(per|pw|p\/w|weekly|month)\b/i.test(priceText)) {
    return 'sale';
  }
  
  // ========== 第三优先级：页面特定元素 ==========
  // 租房特征：Available + 日期（如 "Available 15 May"）
  if (/\bAvailable\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(bodyText)) {
    return 'rent';
  }
  
  // 买房特征：土地面积（m² 或 sqm）
  if (/\d+\s*(m²|sqm|sq\.?m|square\s*met)/i.test(bodyText)) {
    return 'sale';
  }
  
  // 买房特征：Get Contract 按钮
  if (/\b(Get\s*Contract|Buy\s*Now|Submit\s*EOI)\b/i.test(bodyText)) {
    return 'sale';
  }
  
  // 租房特征：Apply Now 按钮
  if (/\b(Apply\s*Now|Tenant\s*Application)\b/i.test(bodyText)) {
    return 'rent';
  }
  
  // ========== 默认值：Sale（买房模式） ==========
  return 'sale';
}

// ─────────────────────────────────────────────────────────────
// Zillow-specific extraction functions
// ─────────────────────────────────────────────────────────────

/**
 * Check if current page is a Zillow listing page
 */
function isZillowPage() {
  const hostname = window.location.hostname || '';
  return hostname.includes('zillow.com');
}

/**
 * Extract Zillow-specific data from __NEXT_DATA__ or page scripts
 * Returns standardized data with source: 'zillow'
 */
function extractZillowData() {
  const data = {
    source: 'zillow',
    zestimate: null,
    rentZestimate: null,
    yearBuilt: null,
    lotSize: null,
    hoaFee: null,
    propertyTax: null,
    sqft: null,
    daysOnZillow: null,
    schoolRatings: [],
  };

  try {
    // Method 1: __NEXT_DATA__ (most reliable)
    const nextDataScript = document.querySelector('script#__NEXT_DATA__');
    if (nextDataScript) {
      const nextData = JSON.parse(nextDataScript.textContent);
      const props = nextData?.props?.pageProps ?? nextData?.props ?? nextData;
      
      // Deep search for property data
      const propertyData = findPropertyDataInObject(props);
      if (propertyData) {
        Object.assign(data, extractFieldsFromPropertyData(propertyData));
      }
    }

    // Method 2: Look for JSON in script tags
    if (!data.zestimate) {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const script of scripts) {
        const id = script.id?.toLowerCase() || '';
        if (id.includes('hdp') || id.includes('apollo') || id.includes('data')) {
          try {
            const scriptData = JSON.parse(script.textContent);
            const propertyData = findPropertyDataInObject(scriptData);
            if (propertyData) {
              Object.assign(data, extractFieldsFromPropertyData(propertyData));
              if (data.zestimate) break;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    // Method 3: DOM-based extraction (fallback)
    if (!data.zestimate) {
      const bodyText = document.body.innerText || '';
      
      // Extract Zestimate
      const zestimateMatch = bodyText.match(/Zestimate[\s:]*\$?([\d,]+)/i);
      if (zestimateMatch) {
        data.zestimate = '$' + zestimateMatch[1].replace(/,/g, '');
      }
      
      // Extract Rent Zestimate
      const rentZestimateMatch = bodyText.match(/Rent Zestimate[\s:]*\$?([\d,]+)/i);
      if (rentZestimateMatch) {
        data.rentZestimate = '$' + rentZestimateMatch[1].replace(/,/g, '');
      }
      
      // Extract Year Built
      const yearMatch = bodyText.match(/Year Built[\s:]*(\d{4})/i);
      if (yearMatch) {
        data.yearBuilt = parseInt(yearMatch[1]);
      }
      
      // Extract Lot Size
      const lotMatch = bodyText.match(/Lot Size[\s:]*([\d,\.]+\s*(?:sqft|acres?|sq\.?\s*ft))/i);
      if (lotMatch) {
        data.lotSize = lotMatch[1].trim();
      }
      
      // Extract HOA Fee
      const hoaMatch = bodyText.match(/HOA[\s:]*\$?([\d,]+(?:\/mo|\/month)?)/i);
      if (hoaMatch) {
        data.hoaFee = '$' + hoaMatch[1];
      }
      
      // Extract Property Tax
      const taxMatch = bodyText.match(/Property Tax[\s:]*\$?([\d,]+(?:\/yr|\/year)?)/i);
      if (taxMatch) {
        data.propertyTax = '$' + taxMatch[1];
      }
      
      // Extract Days on Zillow
      const daysMatch = bodyText.match(/(\d+)\s*days?\s*on\s*Zillow/i);
      if (daysMatch) {
        data.daysOnZillow = parseInt(daysMatch[1]);
      }
    }
  } catch (e) {
    // Silently handle errors
  }

  return data;
}

/**
 * Recursively search for property data in nested objects
 */
function findPropertyDataInObject(obj, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return null;
  
  // Check if this looks like property data
  if (obj && typeof obj === 'object') {
    if (obj.zpid || obj.zestimate || obj.price) {
      return obj;
    }
    if (obj.homeStatus || obj.home_type || obj.propertyType) {
      return obj;
    }
  }
  
  // Search in arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findPropertyDataInObject(item, depth + 1);
      if (found) return found;
    }
  }
  
  // Search in object values
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('__') || key.startsWith('$')) continue;
      const found = findPropertyDataInObject(obj[key], depth + 1);
      if (found) return found;
    }
  }
  
  return null;
}

/**
 * Extract relevant fields from Zillow property data object
 */
function extractFieldsFromPropertyData(data) {
  const result = {};
  
  if (!data) return result;
  
  // Zestimate
  if (data.zestimate) {
    result.zestimate = typeof data.zestimate === 'number' 
      ? '$' + data.zestimate.toLocaleString()
      : String(data.zestimate);
  }
  
  // Rent Zestimate
  if (data.rentZestimate) {
    result.rentZestimate = typeof data.rentZestimate === 'number'
      ? '$' + data.rentZestimate.toLocaleString()
      : String(data.rentZestimate);
  }
  
  // Year Built
  if (data.yearBuilt || data.year_built) {
    result.yearBuilt = data.yearBuilt || data.year_built;
  }
  
  // Lot Size
  if (data.lotSize || data.lot_size || data.lotSizeValue) {
    result.lotSize = String(data.lotSize || data.lot_size || data.lotSizeValue);
  }
  
  // HOA Fee
  if (data.hoaFee || data.hoa_fee) {
    const hoaVal = data.hoaFee || data.hoa_fee;
    result.hoaFee = typeof hoaVal === 'number'
      ? '$' + hoaVal.toLocaleString() + '/mo'
      : String(hoaVal);
  }
  
  // Property Tax
  if (data.annualTax || data.propertyTax || data.taxAssessment) {
    const taxVal = data.annualTax || data.propertyTax || data.taxAssessment;
    result.propertyTax = typeof taxVal === 'number'
      ? '$' + taxVal.toLocaleString() + '/yr'
      : String(taxVal);
  }
  
  // Living Area (sqft)
  if (data.livingArea || data.sqft || data.area) {
    result.sqft = data.livingArea || data.sqft || data.area;
  }
  
  // Days on Zillow
  if (data.daysOnZillow || data.listingAge || data.daysOnMarket) {
    result.daysOnZillow = data.daysOnZillow || data.listingAge || data.daysOnMarket;
  }
  
  return result;
}

/**
 * Extract address from Zillow page
 */
function extractAddressZillow() {
  // Method 1: data-testid selectors
  const selectors = [
    '[data-testid="address"]',
    'h1[data-testid="address"]',
    'address[data-testid="street-address"]',
    '[class*="address"]',
  ];
  
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent?.trim() || '';
      if (text.length > 5 && text.length < 300) {
        return text;
      }
    }
  }
  
  // Method 2: h1 fallback
  const h1 = document.querySelector('h1');
  if (h1) {
    const text = h1.textContent?.trim() || '';
    // Zillow addresses typically start with numbers
    if (/^\d+\s+/.test(text)) {
      return text;
    }
  }
  
  return null;
}

/**
 * Extract rooms info from Zillow page (beds, baths, sqft)
 */
function extractRoomsZillow() {
  const result = { bedrooms: null, bathrooms: null, sqft: null };
  
  // Method 1: data-testid bed-bath-sqft container
  const bedBathEl = document.querySelector('[data-testid="bed-bath-beyond"]') || 
                    document.querySelector('[data-testid="bed-bath-sqft"]') ||
                    document.querySelector('[data-testid="hdp-property-details"]');
  
  if (bedBathEl) {
    const text = bedBathEl.textContent || '';
    
    const bedMatch = text.match(/(\d+)\s*bed/);
    const bathMatch = text.match(/(\d+(?:\.\d+)?)\s*bath/);
    const sqftMatch = text.match(/([\d,]+)\s*sq\s*ft|([\d,]+)\s*sqft/);
    
    if (bedMatch) result.bedrooms = parseInt(bedMatch[1]);
    if (bathMatch) result.bathrooms = parseFloat(bathMatch[1]);
    if (sqftMatch) result.sqft = parseInt((sqftMatch[1] || sqftMatch[2]).replace(/,/g, ''));
  }
  
  // Method 2: Individual data-testid elements
  if (!result.bedrooms) {
    const bedEl = document.querySelector('[data-testid="bedrooms"]');
    if (bedEl) {
      const match = bedEl.textContent?.match(/(\d+)/);
      if (match) result.bedrooms = parseInt(match[1]);
    }
  }
  
  if (!result.bathrooms) {
    const bathEl = document.querySelector('[data-testid="bathrooms"]');
    if (bathEl) {
      const match = bathEl.textContent?.match(/(\d+(?:\.\d+)?)/);
      if (match) result.bathrooms = parseFloat(match[1]);
    }
  }
  
  // Method 3: Body text regex fallback
  if (!result.bedrooms || !result.bathrooms) {
    const bodyText = document.body.innerText || '';
    
    if (!result.bedrooms) {
      const bedMatch = bodyText.match(/(\d+)\s*(?:bed(?:s|room)?|bd)/i);
      if (bedMatch) result.bedrooms = parseInt(bedMatch[1]);
    }
    
    if (!result.bathrooms) {
      const bathMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:s|room)?|ba)/i);
      if (bathMatch) result.bathrooms = parseFloat(bathMatch[1]);
    }
    
    if (!result.sqft) {
      const sqftMatch = bodyText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|square\s*feet)/i);
      if (sqftMatch) result.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
    }
  }
  
  return result;
}

async function extractListingDataLight() {
  const signals = detectPropertySignals();
  propertySignals = signals;

  // Use new MutationObserver-based price extraction
  const priceResult = await waitForPriceExtraction(5000, 200);
  const extractedPrice = priceResult.price;
  const priceHidden = priceResult.hidden;

  // JSON-LD for other fields (title, address, description)
  const jsonLdArray = parseJsonLd();
  const fromJsonLd = extractListingFromJsonLd(jsonLdArray);

  // DOM fallback for other fields
  const domTitle = extractTitle();
  const domAddress = extractAddress();
  const domRooms = extractRooms();
  const domDescription = extractDescription();

  // Merge: prefer new extraction > JSON-LD > DOM
  const title = fromJsonLd?.title || domTitle || null;
  const address = fromJsonLd?.address || domAddress || null;
  const price = extractedPrice || fromJsonLd?.price || null;
  const rooms = {
    bedrooms: fromJsonLd?.rooms?.bedrooms ?? domRooms.bedrooms,
    bathrooms: fromJsonLd?.rooms?.bathrooms ?? domRooms.bathrooms,
    parking: fromJsonLd?.rooms?.parking ?? domRooms.parking,
  };
  const description = fromJsonLd?.description || domDescription || null;
  
  // Zillow-specific data
  let zillowData = { source: 'zillow' };
  if (isZillowPage()) {
    // Use Zillow-specific rooms extraction
    const zillowRooms = extractRoomsZillow();
    if (zillowRooms.bedrooms) rooms.bedrooms = zillowRooms.bedrooms;
    if (zillowRooms.bathrooms) rooms.bathrooms = zillowRooms.bathrooms;
    
    // Get Zillow-specific fields
    zillowData = extractZillowData();
  }

  // NOTE: imageUrls is intentionally empty here — gallery collection is
  // only done via startUserExtraction() triggered by the user.
  let confidence = 0;
  if (title) confidence += 0.2;
  if (address) confidence += 0.2;
  if (price && !priceHidden) confidence += 0.2;
  if (rooms.bedrooms) confidence += 0.15;
  if (description) confidence += 0.15;
  const pricePeriod = inferPricePeriod(price);

  const listing = {
    source: isZillowPage() ? 'zillow' : { url: window.location.href, domain: window.location.hostname, parserType: 'generic' },
    title, address,
    price: price || '',
    priceText: price,
    pricePeriod,
    priceHidden: priceHidden || false, // Flag for "Price on Application"
    bedrooms: rooms.bedrooms,
    bathrooms: rooms.bathrooms,
    parking: rooms.parking,
    description,
    imageUrls: [],   // gallery images only collected on user request
    extractionConfidence: confidence,
    // 自动检测房源类型：买房(sale)还是租房(rent)
    reportMode: detectReportMode({ priceText: price }, window.location.href),
    // Include Zillow-specific fields if on Zillow
    ...(isZillowPage() ? {
      sqft: zillowData.sqft || null,
      zestimate: zillowData.zestimate || null,
      rentZestimate: zillowData.rentZestimate || null,
      yearBuilt: zillowData.yearBuilt || null,
      lotSize: zillowData.lotSize || null,
      hoaFee: zillowData.hoaFee || null,
      propertyTax: zillowData.propertyTax || null,
      daysOnZillow: zillowData.daysOnZillow || null,
    } : {}),
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
  // Check if this is a Zillow page
  if (isZillowPage()) {
    const zillowAddress = extractAddressZillow();
    if (zillowAddress) return zillowAddress;
  }
  
  // Priority 1: realestate.com.au 专用提取
  const reAddress = extractAddressRealestate();
  if (reAddress) return reAddress;

  const addressPatterns = [/(\d+[\s,]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3},\s*[A-Z]{2,4}\s*\d{4})/, /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s*[A-Z]{2,4})/];
  for (const pattern of addressPatterns) {
    const match = document.body.innerText.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

/**
 * realestate.com.au 专用地址提取
 * 只使用稳定的 data-testid 选择器，不依赖 CSS 类名
 */
function extractAddressRealestate() {
  // 方法1: 直接查找 h1 中的地址
  const h1 = document.querySelector('h1');
  if (h1) {
    const text = h1.textContent?.trim() || '';
    if (/^\d+\s+[A-Za-z]/.test(text) && text.length < 200) {
      return text;
    }
  }

  // 方法2: 查找地址相关的 data-testid 元素 (最稳定)
  const addrSelectors = [
    '[data-testid="address"]',
    '[data-testid="listing-address"]',
    '[data-testid="property-address"]',
  ];
  for (const sel of addrSelectors) {
    const el = queryDeep(document, sel);
    if (el) {
      const text = el.textContent?.trim() || '';
      if (text.length > 5 && text.length < 200) {
        return text;
      }
    }
  }

  // 方法3: 从页面文本中查找典型地址模式
  const bodyText = document.body.innerText;
  const addressRe = /(\d+\s+[A-Za-z\s\-]+,\s*[A-Za-z\s\-]+\s+[A-Z]{2,4}\s*\d{4})/;
  const match = bodyText.match(addressRe);
  if (match) {
    return match[1] || match[0];
  }

  // 方法4: 查找包含 suburb/state/postcode 的文本行
  const lines = bodyText.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/\d{4}$/.test(trimmed) && /[A-Z]{2,4}/.test(trimmed) && trimmed.length < 150 && trimmed.length > 10) {
      if (!/^\d{2}[\/\-]/.test(trimmed) && !/^\+61/.test(trimmed)) {
        return trimmed;
      }
    }
  }

  return null;
}

function extractPrice() {
  // Use the new unified price extraction logic
  // This function is kept for backward compatibility
  const result = extractPriceWithNewLogic();
  return result;
}

/**
 * realestate.com.au 专用价格提取
 * 只使用稳定的 data-testid 选择器，不依赖 CSS 类名
 */
function extractPriceRealestate() {
  // 方法1: data-testid 价格元素 (最稳定)
  const priceSelectors = [
    '[data-testid="price"]',
    '[data-testid="listing-price"]',
    '[data-testid="property-price"]',
    '[data-testid="search-result-price"]',
  ];
  for (const sel of priceSelectors) {
    const el = queryDeep(document, sel);
    if (el) {
      const text = el.textContent?.trim() || '';
      if (/\$[\d,]+/.test(text)) {
        return text;
      }
    }
  }

  // 方法2: 查找包含 "price" 或 "$" 的 data-testid 元素
  const allElements = document.querySelectorAll('[data-testid]');
  for (const el of allElements) {
    const testid = el.getAttribute('data-testid') || '';
    const text = el.textContent?.trim() || '';
    if ((testid.toLowerCase().includes('price') || text.includes('$')) && /\$[\d,]+/.test(text)) {
      const priceMatch = text.match(/\$[\d,]+(?:\.\d+)?(?:\s*\/\s*(?:week|month))?/i);
      if (priceMatch) {
        return priceMatch[0].trim();
      }
    }
  }

  // 方法3: 从页面头部区域查找价格
  const heroPoster = document.querySelector('.residential-page-header, [class*="page-header"], [class*="listing-header"]');
  if (heroPoster) {
    const text = heroPoster.textContent || '';
    const priceMatch = text.match(/\$[\d,]+(?:\.\d+)?\s*(?:\/\s*(?:week|month))?/);
    if (priceMatch) {
      return priceMatch[0].trim();
    }
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
    if (el) {
      const text = el.textContent.trim();
      // Lower threshold to 30 chars to ensure we have some description
      // (Edge Function requires either images OR description)
      if (text.length > 30 && !text.toLowerCase().includes('cookie') && !text.toLowerCase().includes('sign in') && !text.toLowerCase().includes('login')) {
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
  const items = Array.from(document.querySelectorAll('.pswp__item'));
  if (items.length === 0) return null;

  let best = null;
  let bestAbsTx = Infinity;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const style = window.getComputedStyle(item);
    const tx = parseTranslateX(style.transform);
    const absTx = Math.abs(tx);

    if (absTx < bestAbsTx) {
      bestAbsTx = absTx;
      best = { item, index: i, tx };
    }
  }

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

  const imgs = Array.from(item.querySelectorAll('.pswp__img'));

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

    if (!isPlaceholder) {
      candidates.push({ img, nw, area, index: i, isReastatic });
    }
  }

  if (candidates.length === 0) {
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
      return { img: globalBest, source: 'global-best' };
    }
    return null;
  }

  // Priority 1: reastatic CDN image (real high-res photo)
  const reastatic = candidates.filter(c => c.isReastatic);
  if (reastatic.length > 0) {
    reastatic.sort((a, b) => b.nw - a.nw || b.area - a.area);
    return { img: reastatic[0].img, source: 'item-best' };
  }

  // Priority 2: loaded images (naturalWidth > 0) sorted by nw desc
  const loaded = candidates.filter(c => c.nw > 0);
  if (loaded.length > 0) {
    loaded.sort((a, b) => b.nw - a.nw);
    return { img: loaded[0].img, source: 'item-best' };
  }

  // Priority 3: fallback to largest client area
  candidates.sort((a, b) => b.area - a.area);
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

    try { clickable.click(); } catch (_) {
      try { clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
    }

    if (await waitForPhotoSwipe(3000)) {
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

  try { galleryEl.click(); } catch (_) {
    try { galleryEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
  }

  if (await waitForPhotoSwipe(3000)) {
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

  const existing = document.querySelector('.pswp');
  if (existing && existing.classList.contains('pswp--open')) {
    return true;
  }

  // Strategy 1: Click first listing image
  if (await clickFirstListingImage()) return true;

  // Strategy 2: Click gallery container
  if (await clickGalleryContainer()) return true;

  // Strategy 3: Click button candidates
  const hits = collectGalleryButtonCandidates();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const clickTarget =
      h.el.closest('button') ||
      h.el.closest('a') ||
      h.el.closest('[role="button"]') ||
      h.el;
    try { clickTarget.click(); } catch (_) {
      try { clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
    }
    if (await waitForPhotoSwipe(3000)) {
      return true;
    }
  }

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

  const out = [];
  const seen = new Set();
  const push = (raw, reason) => {
    const u = normalizeUrl(raw);
    if (!u || isPlaceholderUrl(u) || seen.has(u)) return false;
    seen.add(u);
    out.push({ url: u, reason });
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

  const pswpEl = document.querySelector('.pswp');
  if (!pswpEl) {
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

  // Strategy 1: window.pswp.items (PhotoSwipe v5 global)
  if (Array.isArray(window.pswp?.items) && window.pswp.items.length > 0) {
    const items = window.pswp.items.map(extractItem).filter(Boolean);
    return items;
  }

  // Strategy 2: pswpEl.__pswp.items (PhotoSwipe v4)
  if (pswpEl.__pswp && Array.isArray(pswpEl.__pswp.items) && pswpEl.__pswp.items.length > 0) {
    const items = pswpEl.__pswp.items.map(extractItem).filter(Boolean);
    return items;
  }

  // Strategy 3: PhotoSwipe v5 keyed instances via dataset.pswpUid
  const uid = pswpEl.dataset?.pswpUid;
  if (uid && window.pswp?.instances instanceof Map) {
    const instance = window.pswp.instances.get(Number(uid));
    if (instance && Array.isArray(instance.items) && instance.items.length > 0) {
      const items = instance.items.map(extractItem).filter(Boolean);
      return items;
    }
  }

  // Strategy 4: try reading items from the UI DOM
  const pswpItems = Array.from(pswpEl.querySelectorAll('.pswp__item'));
  if (pswpItems.length > 0) {
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
      return collected;
    }
  }

  // Strategy 5: Scan list-page thumbnail images for full-res URLs
  const galleryUrlsFromList = scanGalleryFromListView();
  if (galleryUrlsFromList && galleryUrlsFromList.length > 0) {
    return galleryUrlsFromList;
  }

  // Strategy 6: Try SSR data
  const galleryUrlsFromSsr = scanGalleryFromSsrData();
  if (galleryUrlsFromSsr && galleryUrlsFromSsr.length > 0) {
    return galleryUrlsFromSsr;
  }

  // Strategy 7: Scan window for gallery/image arrays
  const galleryUrlsFromWindow = scanGalleryFromWindow();
  if (galleryUrlsFromWindow && galleryUrlsFromWindow.length > 0) {
    return galleryUrlsFromWindow;
  }

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

  return collected.length > 0 ? collected : null;
}

/**
 * Strategy 6: Scan SSR/RWT data blocks (NEXT_DATA, redux state, etc.)
 */
function scanGalleryFromSsrData() {
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

  return collected.length > 0 ? collected : null;
}

/**
 * Strategy 7: Scan window object for gallery/image arrays.
 * Common patterns: window.images, window.gallery, window.photos, window.mediaItems, etc.
 */
function scanGalleryFromWindow() {
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
        return { ready: true, pollCount: polls };
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
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
  if (!pswp) {
    return { isValid: false };
  }

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
          return { changed: true, newSnapshot: snapshot, prevSnapshot, reason: 'pswp-api+signature', newCurrIndex, polls };
        }
        // currIndex 变了但 signature 没变 = PhotoSwipe 内部 glitch，继续等待
      }
    }

    // Strategy B: signature changed (fallback 或无 API 时的唯一判断)
    if (snapshot.isValid && snapshot.signature && snapshot.signature !== prevSnapshot?.signature) {
      const reason = pswpInfo ? 'signature-only(no-pswp-index)' : 'signature';
      return { changed: true, newSnapshot: snapshot, prevSnapshot, reason, polls };
    }
  }

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
      return { used: 'pswp-api', success: true };
    } catch (_) {}
  }

  const btn =
    document.querySelector('.pswp__button--arrow--right') ||
    document.querySelector('.pswp__button--arrow--next') ||
    document.querySelector('[class*="arrow"][class*="right"]');

  if (btn && !btn.disabled) {
    try { btn.click(); } catch (_) { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    return { used: 'button', success: true };
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
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

      // 1️⃣ Try clicking the close button (most stable)
      const closeBtn = pswpRoot.querySelector('.pswp__button--close');
      if (closeBtn) {
        closeBtn.click();
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

      // 3️⃣ Fallback: force-remove DOM after animation settles
      setTimeout(() => {
        const stillOpen = document.querySelector('.pswp.pswp--open');
        if (stillOpen) {
          stillOpen.remove();
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
    return [];
  }
  _pagingLock = true;

  const result = [];
  try {

    const pswp = document.querySelector('.pswp.pswp--open');
    if (!pswp) {
      return [];
    }

    // Wait for gallery to be ready
    const ready = await waitForGalleryReady(3000);
    if (!ready.ready) {
      return [];
    }

    // Get PhotoSwipe instance info
    const pswpInfo = getPhotoSwipeInstance();
    const totalSlides = pswpInfo?.totalSlides || 0;

    // Get initial snapshot
    const initialSnapshot = getActiveSlideSnapshot();

    if (!initialSnapshot.isValid) {
      return [];
    }

    // ── Snapshot vs Result Item ─────────────────────────────────────────
    // snapshot: 翻页判断用，包含 signature/rawSrc/slotIndex 等元数据
    //   字段: { isValid, strategy, signature, rawSrc, currIndex, slotIndex, transformX, imgEl }
    // result item: 最终输出用，只包含签名和 URL
    //   字段: { signature, url }
    // ───────────────────────────────────────────────────────────────────

    // Record first image
    const firstSignature = initialSnapshot.signature;
    const firstSrc = initialSnapshot.rawSrc;
    if (firstSignature && firstSrc) {
      result.push({ signature: firstSignature, url: firstSrc });
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
        if (consecutiveNoNew >= MAX_NO_NEW) {
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
        continue;
      }

      const newSignature = newSnapshot.signature;
      const newSrc = newSnapshot.rawSrc;

      if (seenSignatures.has(newSignature)) {
        if (result.length >= 3) {
          break;
        }
        continue;
      }

      // Record new image (result item — signature + url only)
      seenSignatures.add(newSignature);
      result.push({ signature: newSignature, url: newSrc });
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
      }
    }

    finalUrls.sort((a, b) => extractWidthFromUrl(b) - extractWidthFromUrl(a));

    return finalUrls.length > 0 ? finalUrls : [];

  } catch (err) {
    console.error('[gallery] Error during extraction:', err);
    // Return whatever we collected
    const finalUrls = result
      .filter(item => item.signature || item.url)
      .map(item => item.url)
      .filter((url, idx, arr) => arr.indexOf(url) === idx);
    return finalUrls;
  } finally {
    _pagingLock = false;
    closeGallery();
  }
}


// ── Mark as ready ──
isReady = true;

})(); // End of IIFE

