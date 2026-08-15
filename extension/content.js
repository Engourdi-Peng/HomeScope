/**
 * HomeScope Content Script — Zillow Extractor
 * =====================================================================
 * PRODUCTION SOURCE OF TRUTH for Zillow extraction.
 * ---------------------------------------------------------------------
 * This file is the ONLY production implementation of the Zillow
 * extractor. All Zillow bug fixes and extraction changes must happen
 * here.
 *
 * The TS rewrite at `src/content/extractors/zillow.ts` is intentionally
 * FROZEN — it is a schema reference for the eventual Phase 5 migration
 * only, and is NOT shipped inside the Chrome extension. It is allowed
 * to drift from this file until the Single TS Extractor phase.
 *
 * See plan: docs/zillow-golden-cases/ + Phase 0 of the migration plan.
 * =====================================================================
 *
 * Handles page extraction and gallery image collection (user-triggered only).
 * Includes anti-detection measures to avoid Zillow rate limiting.
 */

;(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════
  // SINGLETON GUARD — must run before any listener / timer / observer /
  // initialization side effect. Chrome MV3 injects all `chrome.scripting.
  // executeScript({ files: ['content.js'] })` calls into the SAME isolated
  // world as the manifest-declared content script, so they share this
  // `globalThis`. The first instance wins; later ones bail out immediately.
  // This is the final safety net — the real fix is to call
  // `chrome.scripting.executeScript` at most once per tab lifetime, but if
  // any future code path still slips a second injection in, we won't end up
  // with N listeners and N parallel gallery extractions.
  // ═══════════════════════════════════════════════════════════════════════
  if (globalThis.__HS_CONTENT_LOADED__) {
    // Duplicate instance — log once for diagnosis and exit before registering
    // any listener, timer, or window event handler.
    return;
  }
  Object.defineProperty(globalThis, '__HS_CONTENT_LOADED__', {
    value: true,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // Debug logging — disabled in production for MV3 compliance
  const noop = function() {};

  // ═══════════════════════════════════════════════════════════
  // ANTI-DETECTION UTILITIES
  // ═══════════════════════════════════════════════════════════

  // ===== Random delay with variable curve (not uniform) =====
  function randomDelay(minMs = 2000, maxMs = 8000) {
    // Use a slight exponential distribution to simulate natural pauses
    const base = Math.random();
    const curved = Math.pow(base, 1.5); // more short pauses, fewer very long ones
    const delay = Math.floor(curved * (maxMs - minMs) + minMs);
    return new Promise(r => setTimeout(r, delay));
  }

  // ===== Short delay for poll intervals =====
  function shortDelay(minMs = 300, maxMs = 1000) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(r => setTimeout(r, delay));
  }

  // ═══════════════════════════════════════════════════════════
  // TEXT NORMALIZATION
  // ═══════════════════════════════════════════════════════════

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function splitCleanLines(text) {
    return String(text || '').split(/\n+/).map(normalizeText).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════
  // MLS / SOURCE ATTRIBUTION FILTER
  // Zillow (and others) embed MLS attribution text inside the same h1 or address element
  // as the actual listing address. We MUST strip these lines before they contaminate
  // address / title / region fields in the report card.
  // ═══════════════════════════════════════════════════════════

  /**
   * Returns true if a single line is an MLS / data-source attribution line.
   */
  function isMlsLine(text) {
    var t = normalizeText(text);
    if (!t) return true; // empty / blank lines
    // Full-line attribution patterns — match at start of line
    if (/^(source\s*:|mls\s*#|mls id\s*#|mls logo|report a problem|listing provided by|idx information|as distributed by mls grid|mls grid)/i.test(t)) return true;
    // OneKey / MLS brokerage standalone lines
    if (/^onekey®?\s*mls$/i.test(t)) return true;
    // Contains attribution keywords (partial match for safety)
    if (/OneKey®?\s+MLS|MLS\s+GRID|as distributed by MLS/i.test(t)) return true;
    // Lone ZIP / postal code (no street) — MLS sections sometimes include the ZIP
    if (/^\d{5}(?:-\d{4})?\s*$/.test(t)) return true;
    // Catch-all: anything mentioning "Properties may or may not be listed" etc.
    if (/Properties may or may not be listed/i.test(t)) return true;
    return false;
  }

  /**
   * Returns true if text looks like a real full street address.
   * Used to identify address lines vs attribution / neighborhood text.
   */
  function isLikelyFullAddress(text) {
    var t = normalizeText(text);
    if (!t || isMlsLine(t)) return false;
    // Must have a street number AND end with "City, ST ZIP"
    return /\d+\s+/.test(t) && /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(t);
  }

  /**
   * Returns the first likely-full-address line from multi-line text.
   * Returns null if no valid address line is found.
   */
  function cleanAddressCandidate(raw) {
    var lines = splitCleanLines(raw);
    for (var i = 0; i < lines.length; i++) {
      if (isLikelyFullAddress(lines[i])) return lines[i];
    }
    return null;
  }

  /**
   * Cleans a title candidate:
   * - Strips MLS / attribution lines
   * - Strips browser title suffixes like " | MLS #1004955 | Zillow"
   * - Falls back to address line if present
   */
  function cleanTitleCandidate(raw) {
    var t = normalizeText(raw);
    if (!t) return null;
    if (isMlsLine(t)) return null;
    // Strip Zillow / browser title suffix
    t = t.replace(/\s*\|\s*MLS\s*#?\s*\d+.*$/i, '').replace(/\s*\|\s*Zillow.*$/i, '').trim();
    // Prefer a recognized address line within this text
    var addr = cleanAddressCandidate(t);
    if (addr) return addr;
    if (isLikelyFullAddress(t)) return t;
    return t.length > 5 ? t : null;
  }

  /**
   * Strips MLS attribution lines from multi-line text.
   * Returns all valid non-MLS lines joined by newline.
   */
  function filterMlsFromText(raw) {
    if (!raw) return '';
    var lines = raw.split(/\r?\n/);
    var valid = lines.filter(function(line) { return !isMlsLine(line); });
    return valid.join('\n').trim();
  }

  /**
   * Extracts the MLS source attribution line from the page.
   * Returns null if not found.
   */
  function extractZillowMlsSource() {
    var raw = document.body ? document.body.innerText || '' : '';
    var lines = splitCleanLines(raw);
    for (var i = 0; i < lines.length; i++) {
      if (/^(source\s*:|mls\s*#|onekey®?\s*mls|as distributed by mls|mls grid)/i.test(lines[i])) {
        return normalizeText(lines[i].replace(/^source\s*:\s*/i, ''));
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // HARDENED RATE LIMITING WITH LOCALSTORAGE PERSISTENCE
  // 限制已移除 - 允许无限提取
  const RATE_CONFIG = {
    hardLimitPerHour: 999999,       // 几乎无限制
    warnThreshold: 999999,          // 禁用警告
    cooldownMs: 0,                   // 无冷却时间
    storageKey: 'homescope_extraction_log',
  };

  function getExtractionLog() {
    try {
      const raw = localStorage.getItem(RATE_CONFIG.storageKey);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (_) {
      return [];
    }
  }

  function saveExtractionLog(log) {
    try {
      localStorage.setItem(RATE_CONFIG.storageKey, JSON.stringify(log));
    } catch (_) {}
  }

  function cleanOldEntries(log) {
    const windowStart = Date.now() - (60 * 60 * 1000);
    return log.filter(t => t > windowStart);
  }

  function checkRateLimit() {
    const log = cleanOldEntries(getExtractionLog());
    const count = log.length;
    const latest = log[log.length - 1];
    const cooldownRemaining = latest ? Math.max(0, RATE_CONFIG.cooldownMs - (Date.now() - latest)) : 0;

    if (cooldownRemaining > 0) {
      return {
        allowed: false,
        blocked: true,
        cooldownMs: cooldownRemaining,
        count,
        message: `Rate limit reached. Please wait ${Math.ceil(cooldownRemaining / 60000)} minutes before extracting again.`,
      };
    }
    if (count >= RATE_CONFIG.hardLimitPerHour) {
      return {
        allowed: false,
        blocked: true,
        cooldownMs: RATE_CONFIG.cooldownMs,
        count,
        message: `You've extracted ${count} properties in the last hour. Please take a break and try again later.`,
      };
    }
    if (count >= RATE_CONFIG.warnThreshold) {
      return {
        allowed: true,
        warning: true,
        count,
        message: `You've extracted ${count} properties recently. Zillow may show verification challenges if you continue.`,
      };
    }
    return { allowed: true, warning: false, count };
  }

  function recordExtraction() {
    const log = getExtractionLog();
    log.push(Date.now());
    saveExtractionLog(cleanOldEntries(log));
  }

  // ===== CAPTCHA / Challenge detection =====
  function detectZillowChallenge() {
    const challengePatterns = [
      // reCAPTCHA
      '[class*="rc-dosc"]',
      '[class*="recaptcha"]',
      'iframe[src*="recaptcha"]',
      // Zillow-specific challenges
      '[class*="challenge"]',
      '[class*="captcha"]',
      '[class*="human"]',
      '[id*="challenge"]',
      // Generic verification pages
      'iframe[src*="api/anchor"]',
      '[class*="verify"]',
    ];

    for (const selector of challengePatterns) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) return true;
      } catch (_) {}
    }

    // Check for suspicious body class patterns
    const body = document.body;
    const suspiciousClasses = ['challenge', 'captcha', 'verification', 'blocked', 'human-check'];
    for (const cls of suspiciousClasses) {
      if (body.className.toLowerCase().includes(cls)) return true;
    }

    // Check URL for challenge redirect
    if (window.location.href.includes('/challenge/') ||
        window.location.href.includes('/captcha/') ||
        window.location.href.includes('/blocked')) {
      return true;
    }

    return false;
  }

  // ===== Human mouse movement simulation =====
  async function simulateMouseMove(fromX, fromY, toX, toY, durationMs = 800) {
    const steps = Math.floor(durationMs / 16); // ~60fps
    const dx = (toX - fromX) / steps;
    const dy = (toY - fromY) / steps;

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      // Add slight curve using ease-in-out
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = fromX + dx * steps * ease;
      const y = fromY + dy * steps * ease;
      // Add tiny random jitter
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;
      try {
        const evt = new MouseEvent('mousemove', {
          bubbles: false,
          cancelable: false,
          clientX: x + jitterX,
          clientY: y + jitterY,
        });
        document.dispatchEvent(evt);
      } catch (_) {}
      await shortDelay(14, 18);
    }
  }

  // ===== Human scroll with variable speed =====
  async function simulateHumanScroll(totalPx = 200, durationMs = 1200) {
    const startScrollY = window.scrollY;
    const startTime = performance.now();
    const steps = Math.floor(durationMs / 16);
    const halfStep = Math.floor(steps / 2);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Ease-in-out curve
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // Add micro-variations for natural feel
      const variation = 1 + (Math.random() - 0.5) * 0.08;
      const progress = ease * variation;
      const targetY = startScrollY + totalPx * progress;
      window.scrollTo({ top: Math.max(0, Math.floor(targetY)), behavior: 'instant' });
      await shortDelay(14, 18);
    }
    window.scrollTo({ top: startScrollY, behavior: 'instant' });
  }

  // ===== Light human behavior simulation =====
  async function simulateHumanBehavior() {
    // Wait for gallery to be ready (with short timeout)
    await waitForGalleryReady(2000);

    // Quick mouse movement (faster)
    const viewportW = Math.max(document.documentElement.clientWidth, window.innerWidth || 800);
    const viewportH = Math.max(document.documentElement.clientHeight, window.innerHeight || 600);
    const fromX = Math.floor(Math.random() * viewportW * 0.3) + viewportW * 0.1;
    const fromY = Math.floor(Math.random() * viewportH * 0.3) + viewportH * 0.1;
    const toX = fromX + Math.floor(Math.random() * 200) - 100;
    const toY = fromY + Math.floor(Math.random() * 150) - 75;
    await simulateMouseMove(fromX, fromY, toX, toY, 200 + Math.random() * 200);

    // Quick scroll
    const direction = Math.random() > 0.5 ? 1 : -1;
    const scrollPx = (Math.floor(Math.random() * 200) + 80) * direction;
    await simulateHumanScroll(scrollPx, 300 + Math.random() * 300);
  }

  // ===== Send warning to side panel =====
  function sendWarningToSidePanel(warning) {
    try {
      chrome.runtime.sendMessage({
        type: warning.blocked ? 'RATE_BLOCKED' : 'RATE_WARNING',
        data: warning,
      }).catch(() => {});
    } catch (_) {}
  }

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
        return true;

      case 'GET_PAGE_STATE':
        sendResponse(getPageState());
        return true;

      case 'EXTRACT_LISTING':
        // applyZillowStructuredOverride is already called inside extractListingDataLight
        // before the promise resolves — do NOT call it again here.
        extractListingDataLight().then(({ listing, detection }) => {
          pageData = listing;
          sendResponse({ data: listing, error: null, detection });
        }).catch((err) => {
          sendResponse({ data: null, error: err.message, detection: null });
        });
        return true;

      case 'START_USER_EXTRACTION':
        noop('[DIAG] START_USER_EXTRACTION received, bypassCache:', message.bypassCache, 'analysisType:', message.analysisType);
        // Pre-check rate limit BEFORE starting extraction (avoids wasted work)
        const preRateCheck = checkRateLimit();
        if (!preRateCheck.allowed) {
          noop('[DIAG] START_USER_EXTRACTION blocked by rate limit');
          sendResponse({ success: false, error: preRateCheck.message, code: 'RATE_LIMIT' });
          break;
        }
        // Also check extraction lock to prevent concurrent sessions
        if (_extractionLock) {
          noop('[DIAG] START_USER_EXTRACTION blocked by extraction lock');
          sendResponse({ success: false, error: 'Extraction already in progress. Please wait.', code: 'ALREADY_RUNNING' });
          break;
        }
        noop('[DIAG] START_USER_EXTRACTION: calling startUserExtraction, lock will be set');
        startUserExtraction(message.bypassCache, message.analysisType).then(({ listing, detection }) => {
          noop('[DIAG] START_USER_EXTRACTION promise resolved, about to sendResponse');
          pageData = listing;
          sendResponse({ success: true, data: listing, detection });
          noop('[DIAG] START_USER_EXTRACTION sendResponse called successfully');
        }).catch((err) => {
          noop('[DIAG] START_USER_EXTRACTION promise rejected:', err.message, 'code:', err.code);
          sendResponse({ success: false, error: err.message, code: err.code || 'EXTRACTION_ERROR' });
        });
        return true;

      case 'GET_CACHED_DATA':
        sendResponse({ success: true, data: pageData });
        return true;

      // ──────────────────────────────────────────────────────────────────
      // FORCE_REEXTRACT — 强制重提取（用户在 ReportModeModal 选定 Rent/Sale）
      // content script 持有 document，调 ZillowExtractor.forceReextract(forcedType)
      // 返回 { ok, data } 或 { ok:false, error }
      // 不允许只 toggle listingType 后用之前的 common 数据直接发起分析。
      // ──────────────────────────────────────────────────────────────────
      case 'FORCE_REEXTRACT': {
        const forcedType = message.forcedListingType;
        if (forcedType !== 'rent' && forcedType !== 'sale') {
          sendResponse({ ok: false, error: 'forcedListingType must be rent or sale' });
          return true;
        }

        // 异步处理
        (async () => {
          try {
            // 取最近一次提取结果（pageData）作为 common fields 基线
            const baseData = pageData;
            if (!baseData) {
              sendResponse({ ok: false, error: 'No prior extraction data — please re-extract first' });
              return;
            }

            // 复用现有 extractListingDataLight 拿到 lightListing（含 raw data）
            // 然后基于当前 listingType 选定，调用 forceReextract
            const lightResult = await extractListingDataLight();
            const lightListing = lightResult?.listing;
            if (!lightListing) {
              sendResponse({ ok: false, error: 'Failed to re-read page data' });
              return;
            }

            // 根据 forcedType 标记 listingType + 新字段
            const out = { ...lightListing };
            out.listingType = forcedType;
            out.reportMode = forcedType;

            if (forcedType === 'rent') {
              // 把 price（页面原始文本）作为 displayPrice 保留
              out.displayPrice = out.price || null;
              // 价格字段映射: US rent 模式用 monthlyRent；priceAmount 即月租
              if (out.price && /\/(?:mo|month|monthly)\b/i.test(out.price)) {
                const m = out.price.match(/\$?\s?([\d,]+)/);
                if (m) {
                  out.monthlyRent = parseFloat(m[1].replace(/,/g, ''));
                  out.priceAmount = out.monthlyRent;
                }
              }
              // 售价相关字段清空（仅清新字段；旧字段保留兼容）
              out.askingPrice = null;
              out.saleZestimate = null;
              out.pricePerSqft = null;
              out.annualTax = null;
              out.propertyTaxMonthly = null;
              out.homeInsuranceMonthly = null;
              out.monthlyPayment = null;
              out.taxAssessedValue = null;
              out.daysOnZillow = null;
              out.dateOnMarket = null;
              // pricePeriod 标记为 month
              out.pricePeriod = 'month';
            } else {
              // sale 模式
              out.displayPrice = out.price || null;
              // 售价来自 priceAmount 或 price 文本
              if (out.priceAmount != null) {
                out.askingPrice = out.priceAmount;
              } else if (out.price) {
                const m = out.price.match(/\$?\s?([\d,]+)/);
                if (m) {
                  const v = parseFloat(m[1].replace(/,/g, ''));
                  out.askingPrice = v;
                  out.priceAmount = v;
                }
              }
              // rent 专属字段清空（仅清新字段）
              out.monthlyRent = null;
              out.advertisedRentRange = null;
              out.securityDeposit = null;
              out.holdingDeposit = null;
              out.applicationFee = null;
              out.leaseTerm = null;
              out.utilitiesIncluded = null;
              out.landlordPays = null;
              out.tenantPays = null;
              out.petPolicy = null;
              out.parkingFee = null;
              out.amenityFee = null;
              out.qualificationRequirements = null;
              out.exactUnit = null;
              out.availableDate = null;
              // pricePeriod 标记为 total
              out.pricePeriod = 'total';
            }

            // Write back pageData cache (used by subsequent GET_CACHED_DATA)
            const overridden = applyZillowStructuredOverride(out);
            pageData = overridden;

            sendResponse({ ok: true, data: overridden });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
        })();
        return true;
      }

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
 * @param {string} analysisType - 'basic' or 'full'; basic skips gallery/photo collection.
 * @returns {Promise<{listing: object, detection: object}>}
 */
async function startUserExtraction(bypassCache = false, analysisType = 'full') {
  noop('[DIAG] startUserExtraction ENTRY: lock currently:', _extractionLock, 'bypassCache:', bypassCache);
  if (_extractionLock) {
    const err = new Error('Extraction already in progress');
    err.code = 'EXTRACTION_IN_PROGRESS';
    noop('[DIAG] startUserExtraction: lock blocked');
    throw err;
  }

  _extractionLock = true;
  noop('[DIAG] startUserExtraction: lock acquired');

  try {
    const listingUrl = window.location.href;
    noop('[DIAG] startUserExtraction: starting for URL:', listingUrl.substring(0, 80));

    // ── Step: Check rate guidance (soft limit, no blocking) ──
    noop('[DIAG] startUserExtraction: checking rate limit...');
    const rateWarning = checkRateLimit();
    noop('[DIAG] startUserExtraction: rate check done');

    // ── Step: Check in-memory URL cache ──
    noop('[DIAG] startUserExtraction: checking session cache...');
    if (!bypassCache) {
      const cached = _sessionCache.get(listingUrl);
      if (cached && Date.now() - cached._cachedAt < SESSION_CACHE_TTL_MS) {
        noop('[DIAG] startUserExtraction: returning cached result');
        _extractionLock = false;
        // Still show rate warning even if cached
        if (rateWarning.warning) {
          sendWarningToSidePanel(rateWarning);
        }
        return cached;
      }
    }
    noop('[DIAG] startUserExtraction: cache miss or bypass, proceeding');

    // ── Step: Extract lightweight data ──
    noop('[DIAG] startUserExtraction: extracting light data...');
    let lightListing, lightDetection;
    try {
      const result = await extractListingDataLight();
      lightListing = result.listing;
      lightDetection = result.detection;
    } catch (err) {
      noop('[DIAG] startUserExtraction: extractListingDataLight failed:', err.message);
      // Use minimal fallback data so extraction can continue
      lightListing = {
        source: 'zillow',
        title: document.title || 'Property',
        address: '',
        price: '',
        imageUrls: [],
        description: '',
        reportMode: 'sale'
      };
      lightDetection = { canAnalyze: true, signals: [] };
    }
    noop('[DIAG] Light extraction result:', JSON.stringify({
      title: lightListing.title?.substring(0, 50),
      address: lightListing.address?.substring(0, 50),
      price: lightListing.price?.substring(0, 30),
      imageUrlsLen: (lightListing.imageUrls || []).length,
      descriptionLen: lightListing.description?.length || 0
    }));

    // ── Step: Check rate limit BEFORE starting ──
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
      sendWarningToSidePanel(rateCheck);
      const err = new Error('Rate limit exceeded. Please wait before trying again.');
      err.code = 'RATE_LIMIT';
      throw err;
    }
    if (rateCheck.warning) {
      sendWarningToSidePanel(rateCheck);
      // Proceed but warn user
    }

    // ── Step: Detect CAPTCHA / challenge early ──
    if (detectZillowChallenge()) {
      sendWarningToSidePanel({
        warning: true,
        message: 'Zillow is showing a verification challenge. Extraction skipped. Please complete the verification and try again.',
      });
      const err = new Error('Zillow verification challenge detected.');
      err.code = 'ZILLOW_CHALLENGE';
      throw err;
    }

    // ── Step: Open PhotoSwipe gallery (skip for basic — no images needed) ──
    let opened = false;
    let imageUrls = [];
    if (analysisType !== 'basic') {
      noop('[DIAG] startUserExtraction: calling openGallery...');

      if (isZillowPage()) {
        noop('[DIAG] startUserExtraction: Zillow page detected, using new 4-collector path');
        const pageContext = detectZillowPageScope();

        let galleryResult = await extractZillowGallery({
          pageContext,
          listing: lightListing
        });

        // 只重试一次
        if (galleryResult.status === GALLERY_RESULT_STATUS.PARTIAL) {
          const preservedTotal = galleryResult.expectedTotal;
          noop('[DIAG] startUserExtraction: gallery partial, retrying with preservedTotal:', preservedTotal);
          galleryResult = await extractZillowGallery({
            pageContext,
            listing: lightListing,
            retry: true,
            preservedExpectedTotal: preservedTotal
          });
        }

        if (galleryResult.status !== GALLERY_RESULT_STATUS.COMPLETE) {
          const error = new Error(
            galleryResult.status === GALLERY_RESULT_STATUS.PARTIAL
              ? `Photo collection incomplete: ${galleryResult.uniqueCount}/${galleryResult.expectedTotal}`
              : `Unable to collect Zillow listing photos: ${galleryResult.reason || 'unknown'}`
          );
          error.code = galleryResult.status === GALLERY_RESULT_STATUS.PARTIAL
            ? 'GALLERY_INCOMPLETE'
            : 'GALLERY_EXTRACTION_FAILED';
          noop('[DIAG] startUserExtraction: gallery not complete:', galleryResult);
          throw error;
        }

        imageUrls = galleryResult.images.map(image => image.url);
        opened = true;
        noop('[DIAG] startUserExtraction: Zillow gallery extraction complete:', imageUrls.length, 'images');
      } else {
        // 非 Zillow 页面继续走原 PhotoSwipe 路径
        try {
          opened = await openGallery();
        } catch (err) {
          noop('[DIAG] startUserExtraction: openGallery threw:', err.message);
          opened = false;
        }
        noop('[DIAG] startUserExtraction: openGallery returned:', opened);

        // ── Step: Simulate human behavior after opening gallery ──
        if (opened) {
          try {
            await simulateHumanBehavior();
          } catch (err) {
            noop('[DIAG] startUserExtraction: simulateHumanBehavior threw:', err.message);
          }
        }

        noop('[DIAG] openGallery returned:', opened);

        // ── Step: Collect images via PhotoSwipe paging ──
        if (opened) {
          noop('[DIAG] PhotoSwipe gallery opened, starting to collect images...');
          try {
            imageUrls = await collectByPhotoSwipePaging();
          } catch (err) {
            noop('[DIAG] startUserExtraction: collectByPhotoSwipePaging threw:', err.message);
            imageUrls = [];
          }
          noop('[DIAG] collectByPhotoSwipePaging returned:', imageUrls.length, 'images');
        }
      }

      lightListing.imageUrls = imageUrls;
    } else {
      lightListing.imageUrls = [];
      noop('[DIAG] startUserExtraction: basic analysis, skipping gallery/photo collection');
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
    // v6 minimal patch: apply Zillow structured override as the FINAL
    // assembly step — after every fallback and image merge, before the
    // session cache, pageData, and sendResponse are written. Prevents
    // downstream fallbacks from overwriting structured fields.
    const finalListing = applyZillowStructuredOverride(listing);
    const result = { listing: finalListing, detection };

    // ── Step: Store in session cache ──
    result._cachedAt = Date.now();
    _sessionCache.set(listingUrl, result);

    // ── Step: Record extraction for rate limiting (localStorage, persists across tabs) ──
    recordExtraction();

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
  if (json.name) title = filterMlsFromText(String(json.name).trim());
  if (!title && json.headline) title = filterMlsFromText(String(json.headline).trim());

  // ---- Address ----
  let address = null;
  // Zillow uses nested structure: itemOffered.address
  const addr = json.address || json.location || json.itemOffered?.address || null;
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
  // Handle Zillow's nested structure: offers.price
  const offer = json.offers || json.aggregateOffer || null;
  if (offer) {
    const rawPrice = offer.price || offer.lowPrice || null;
    if (rawPrice != null) {
      const priceCurrency = offer.priceCurrency || '';
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
  
  // Handle Zillow's nested structure: itemOffered.numberOfBedrooms
  const propertyInfo = json.itemOffered || json;
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
  // Zillow uses itemOffered.numberOfBedrooms
  //
  // IMPORTANT: bedrooms=0 (Studio) is a LEGAL value and MUST be preserved.
  // The previous expression `parseInt('0', 10) || null` wrongly coerced 0
  // back to null, which leaked DOM signals ("1 bedroom") into the Studio
  // result. We now keep the parsed number unless the original wasn't a
  // finite number.
  if (rooms.bedrooms == null && propertyInfo.numberOfBedrooms != null) {
    const n = Number(propertyInfo.numberOfBedrooms);
    rooms.bedrooms = Number.isFinite(n) ? n : null;
  }
  if (rooms.bathrooms == null && propertyInfo.numberOfBathroomsTotal != null) {
    const n = Number(propertyInfo.numberOfBathroomsTotal);
    rooms.bathrooms = Number.isFinite(n) ? n : null;
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
    mergedDescription = filterMlsFromText(bestForDetails.description || '');
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
/**
 * PR 1A hotfix: listing-mode detection for Zillow.
 *
 * Priority:
 *   1. JSON-LD offers.businessFunction  — #Sell = sale, #LeaseOut = rent
 *      (only the node whose url/@id matches current URL or zpid is trusted;
 *       ItemList / nearby homes are ignored)
 *   2. Current-listing status badge text + primary price chip
 *   3. URL path fallback (rent only; /homedetails/ does NOT imply sale)
 *
 * FORBIDDEN:
 *   - document.body.innerText / textContent
 *   - Rent Zestimate / Nearby homes / Payment calculator / body description
 *   - ItemList nodes or nodes whose zpid/url does not match current listing
 *
 * @param {Object} listing  - { priceText } for /mo check only
 * @param {string} url     - window.location.href
 * @returns {'sale'|'rent'|null}
 */
function detectReportMode(listing, url) {
  // ── Source 1: JSON-LD offers.businessFunction ─────────────────────────────
  {
    const currentUrl = String(url || window.location.href || '');
    let currentZpid = null;
    try {
      const parsed = new URL(currentUrl);
      const m = parsed.pathname.match(/\/(\d+)_zpid\//);
      if (m) currentZpid = m[1];
    } catch (_) {}

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    outer: for (const script of Array.from(scripts)) {
      let data;
      try { data = JSON.parse(script.textContent || ''); } catch (_) { continue; }
      const candidates = Array.isArray(data)
        ? data
        : (data && Array.isArray(data['@graph'])) ? data['@graph'] : [data];
      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue;
        const t = item['@type'];
        const types = Array.isArray(t) ? t.map(String) : [String(t || '')];
        if (!types.some(s => s.includes('RealEstateListing') || s.toLowerCase() === 'realestate')) continue;

        // zpid match — reject nearby ItemList / different-zpid nodes
        let itemZpid = null;
        if (typeof item.zpid === 'number' || typeof item.zpid === 'string') {
          itemZpid = String(item.zpid);
        } else {
          for (const k of ['url', '@id', 'hdpUrl']) {
            const v = item[k];
            if (typeof v === 'string') {
              const m2 = v.match(/\/(\d+)_zpid\//);
              if (m2) { itemZpid = m2[1]; break; }
            }
          }
        }
        let isCurrent = false;
        if (currentZpid && itemZpid && currentZpid === itemZpid) isCurrent = true;
        if (!isCurrent) {
          try {
            for (const k of ['url', '@id', 'hdpUrl']) {
              const v = item[k];
              if (typeof v !== 'string') continue;
              const p = new URL(v, currentUrl);
              const normPath = p.pathname.replace(/\/+$/, '').toLowerCase();
              const currPath = new URL(currentUrl).pathname.replace(/\/+$/, '').toLowerCase();
              if (normPath && normPath === currPath) { isCurrent = true; break; }
            }
          } catch (_) {}
        }
        if (!isCurrent) continue;

        // Read businessFunction from offers
        const offersRaw = item.offers;
        const offers = Array.isArray(offersRaw) ? offersRaw
          : (offersRaw != null) ? [offersRaw] : [];
        const funcs = offers.map(o => {
          if (!o || typeof o !== 'object') return null;
          const raw = (typeof o.businessFunction === 'string') ? o.businessFunction
            : (o['@id'] != null) ? String(o['@id']) : '';
          const lower = raw.toLowerCase();
          if (lower.endsWith('#sell') || lower === 'sell') return 'sell';
          if (lower.endsWith('#leaseout') || lower === 'leaseout') return 'leaseout';
          return null;
        }).filter(Boolean);

        if (funcs.length > 0) {
          if (funcs.every(f => f === 'sell')) return 'sale';
          if (funcs.every(f => f === 'leaseout')) return 'rent';
          // Conflict (both sell + leaseout on same node) → fall through to Source 2
        }
      }
    }
  }

  // ── Source 2: status badge + primary price chip ───────────────────────────
  {
    const statusEl = document.querySelector('[data-testid="status"]') ||
                     document.querySelector('[class*="status-message"]');
    if (statusEl) {
      const t = (statusEl.textContent || '').trim().toLowerCase();
      if (/^\s*for\s*rent\s*$/.test(t)) return 'rent';
      if (/^\s*room\s*for\s*rent\s*$/.test(t)) return 'rent';
      if (/^\s*for\s*sale\s*$/.test(t) || /^\s*sale\s*$/.test(t)) return 'sale';
    }
    // h1 — unambiguous only (must not contain the opposite signal)
    const h1 = document.querySelector('h1');
    if (h1) {
      const t = (h1.textContent || '').toLowerCase();
      if (/room\s*for\s*rent/.test(t) && !/for\s*sale/.test(t)) return 'rent';
      if (/for\s*rent/.test(t) && !/for\s*sale/.test(t)) return 'rent';
      if (/for\s*sale/.test(t) && !/for\s*rent/.test(t)) return 'sale';
    }
    // Primary price chip /mo — data-testid="price" / data-testid="list-price"
    // NOT BuyAbility / Est. payment (different elements, filtered out by selector)
    const priceEl = document.querySelector('[data-testid="price"]') ||
                    document.querySelector('[data-testid="list-price"]') ||
                    document.querySelector('h3[class*="price"]');
    if (priceEl) {
      const pt = (priceEl.textContent || '').toLowerCase();
      if (/\/(?:mo|month|monthly)\b/.test(pt)) return 'rent';
    }
    // listing.priceText fallback for /mo (from extractor's price)
    const listingPt = ((listing && listing.priceText) || '').toLowerCase();
    if (/\/(?:mo|month|monthly)\b/.test(listingPt)) return 'rent';
  }

  // ── Source 3: URL fallback (rent only) ─────────────────────────────────
  {
    const urlLower = String(url || window.location.href || '').toLowerCase();
    if (urlLower.includes('/rent/') || urlLower.includes('/rental/') ||
        urlLower.includes('/for-rent/') || urlLower.includes('/to-rent/') ||
        urlLower.includes('/apartments/') || urlLower.includes('/community/')) {
      return 'rent';
    }
    // /homedetails/ does NOT default to sale
  }

  // No evidence → null (caller treats as unknown → REPORT_MODE_REQUIRED)
  return null;
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
 * Check if current page is a Zillow search results page (not a specific listing)
 * Search pages should be excluded from extraction as they don't contain
 * single-property data and would cause stale data display issues.
 * 
 * This handles:
 * - /homes_for_sale/ - standard search results
 * - /homes/for_sale/ - map search results
 * - /rent, /sold, /foreclosures, /new - other search types
 * - Any URL with searchQueryState params - map search
 */
function isZillowSearchPage() {
  const url = window.location.href.toLowerCase();
  
  // ── Step 1: 房源详情页检测（优先级最高）─────────────────────
  // 这些是详情页，即使 URL 包含搜索路径也不应该被过滤
  // 详情页 URL 模式:
  // - /homedetails/ - Zillow 标准详情页
  // - /zpid/ - 旧版详情页 URL
  // - /{address-slug}_zpid/ - 新版详情页 (如 /4626-217th-street-bayside-ny_zpid/)
  // - 独立的地址结尾模式 (e.g. /4626-217th-street-bayside-ny/)
  const detailPatterns = [
    '/homedetails',
    '/zpid/',
    '/zpid?',  // zpid 在查询参数中
  ];
  const isDetailPage = detailPatterns.some(p => url.includes(p)) ||
    // 地址-slug 结尾模式: /街道地址-城市-州/
    /\/[0-9]+[a-z0-9\-]+-[a-z0-9\-]+-[a-z0-9\-]+\/?$/i.test(url) ||
    // _zpid 结尾模式
    /_zpid\/?$/i.test(url);
  
  if (isDetailPage) {
    return false; // 详情页不应该被过滤
  }
  
  // ── Step 2: 搜索结果页检测 ──────────────────────────────────
  // 搜索页 URL 模式:
  // - /homes_for_sale/ - 标准搜索结果
  // - /homes/for_sale/ - 地图搜索结果
  // - /homes/for_rent/ - 地图租房搜索
  // - /rent - 租房搜索
  // - /sold - 已售房源搜索
  // - /foreclosures - 止赎搜索
  // - /new - 新上市搜索
  // - 包含 searchQueryState 参数 - 地图搜索特有
  const searchPatterns = [
    '/homes_for_sale/',
    '/homes/for_sale/',
    '/homes/for_rent/',
    '/homes/recently_sold/',
    '/homes/pending/',
    '/rent',
    '/sold',
    '/foreclosures',
    '/new',
  ];
  
  const hasSearchPattern = searchPatterns.some(p => url.includes(p));
  const hasSearchQueryState = url.includes('searchquerystate');
  
  // 如果是搜索模式 URL 或者有 searchQueryState 参数，认为是搜索结果页
  return hasSearchPattern || hasSearchQueryState;
}

/**
 * Section-scoped Zillow data extraction using document.body.innerText
 * 
 * Uses strict label/value matching that won't match "Bedrooms & bathrooms" header.
 * Each section (Facts & Features, Financial, Monthly payment) is parsed independently.
 */
function extractZillowData() {
  const raw = document.body.innerText || "";

  // ── BuyAbility / Payment breakdown DOM extraction ─────────────────────────────
  // Zillow's generated class names change frequently. Semantic text anchors are
  // stable here, so locate the smallest UL containing all six breakdown labels.
  function normalizeDomText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function findExactTextElements(root, target) {
    const normalizedTarget = normalizeDomText(target).toLowerCase();
    const matches = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (normalizeDomText(node.textContent).toLowerCase() === normalizedTarget && node.parentElement) {
        matches.push(node.parentElement);
      }
    }
    return matches;
  }

  function findPaymentBreakdownRoot() {
    const requiredLabels = [
      'Mortgage insurance',
      'Property taxes',
      'Home insurance',
      'HOA fees',
      'Utilities'
    ];
    const candidates = [];
    for (const principalElement of findExactTextElements(document.body, 'Principal & interest')) {
      let element = principalElement;
      for (let hops = 0; element && hops < 12; hops += 1, element = element.parentElement) {
        const text = element.textContent || '';
        if (element.tagName === 'UL' && requiredLabels.every((label) => text.includes(label))) {
          candidates.push(element);
          break;
        }
      }
    }
    // ── Fallback: find the breakdown root with only "Principal & interest"
    //   This handles listings where Mortgage insurance = $0 (no row in the DOM).
    //   Also handles cases where "Utilities" is not shown separately.
    if (candidates.length === 0) {
      for (const principalElement of findExactTextElements(document.body, 'Principal & interest')) {
        let element = principalElement;
        for (let hops = 0; element && hops < 12; hops += 1, element = element.parentElement) {
          const text = element.textContent || '';
          // Relaxed: only Principal & interest required; Property taxes and Home insurance
          // are present on virtually all Zillow BuyAbility breakdowns.
          if (element.tagName === 'UL' &&
              text.includes('Principal & interest') &&
              text.includes('Property taxes') &&
              text.includes('Home insurance')) {
            candidates.push(element);
            break;
          }
        }
      }
    }
    return candidates.sort((a, b) => normalizeDomText(a.innerText).length - normalizeDomText(b.innerText).length)[0] || null;
  }

  function extractBuyAbilityPayment() {
    const breakdownRoot = findPaymentBreakdownRoot();
    if (!breakdownRoot) return null;

    const getRowValue = (label) => {
      const normalizedLabel = label.toLowerCase();
      for (const row of breakdownRoot.querySelectorAll(':scope > li')) {
        const text = normalizeDomText(row.innerText);
        if (text.toLowerCase().startsWith(normalizedLabel)) {
          const value = text.slice(label.length).trim().replace(/^[:：]\s*/, '');
          return value || null;
        }
      }
      return null;
    };

    let estimatedMonthlyPayment = null;
    // ── Read estimatedMonthlyPayment from the dedicated "Estimated monthly payment"
    // row inside the breakdown <ul>, NOT from any ancestor container that happens
    // to contain "$.../mo".  This prevents HOA: $930/mo from shadowing the true
    // total when the DOM order puts HOA before the total label.
    const estPatterns = [/\$[\d,]+(?:\.\d{2})?\s*\/\s*mo\b/i];
    for (const row of breakdownRoot.querySelectorAll(':scope > li')) {
      const rowText = normalizeDomText(row.innerText);
      if (!/estimated\s*monthly\s*payment/i.test(rowText)) continue;
      const match = rowText.match(estPatterns[0]);
      if (match) {
        estimatedMonthlyPayment = match[0].replace(/\s+/g, ' ').trim();
        break;
      }
    }

    const result = {
      estimatedMonthlyPayment,
      principalAndInterest: getRowValue('Principal & interest'),
      mortgageInsurance: getRowValue('Mortgage insurance'),
      propertyTaxes: getRowValue('Property taxes'),
      homeInsurance: getRowValue('Home insurance'),
      hoaFees: getRowValue('HOA fees'),
      utilities: getRowValue('Utilities')
    };
    return Object.values(result).some(Boolean) ? result : null;
  }

  // ── HOA and Roof extraction from facts section ────────────────────────────────
  function extractFactsFromDOM() {
    const factsSection = document.querySelector(
      'section[id*="facts"], ' +
      'div[id*="facts-features"], ' +
      'div[data-testid*="fact"], ' +
      '[data-testid*="home-details-facts"], ' +
      'div[data-zmid*="facts"], ' +
      'ul.facts-section, ' +
      'div.facts li, ' +
      '[class*="facts"] li'
    ) || document.body;

    const readExactLabelValue = (label) => {
      for (const labelElement of findExactTextElements(factsSection, label)) {
        const row = labelElement.closest('li') || labelElement.parentElement;
        const text = normalizeDomText(row?.innerText);
        const prefix = new RegExp(`^${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\s*[:：]\\s*`, 'i');
        const value = text.replace(prefix, '').trim();
        if (value && value.toLowerCase() !== label.toLowerCase()) return value;
      }
      return null;
    };

    const hasHoaValue = readExactLabelValue('Has HOA');
    return {
      hasHoa: hasHoaValue ? /^(yes|no)$/i.test(hasHoaValue) ? /^yes$/i.test(hasHoaValue) : null : null,
      roof: readExactLabelValue('Roof')
    };
  }

  const lines = raw
    .split(/\n+/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const norm = s => String(s || "").replace(/\s+/g, " ").trim();

  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const findIndex = (patterns, start = 0) => {
    for (let i = start; i < lines.length; i++) {
      if (patterns.some(p => p.test(lines[i]))) return i;
    }
    return -1;
  };

  const sliceSection = (startPatterns, endPatterns, maxLen = 800) => {
    const start = findIndex(startPatterns);
    if (start < 0) return { start: -1, end: -1, lines: [] };

    let end = lines.length;
    for (let i = start + 1; i < Math.min(lines.length, start + maxLen); i++) {
      if (endPatterns.some(p => p.test(lines[i]))) {
        end = i;
        break;
      }
    }

    return {
      start,
      end,
      lines: lines.slice(start, end),
    };
  };

  const facts = sliceSection(
    [/^Facts & features$/i],
    [
      /^Services availability$/i,
      /^Contact a buyer/i,
      /^Offer Insights$/i,
      /^Estimated market value$/i,
      /^Price history$/i,
      /^Public tax history$/i,
      /^Monthly payment$/i,
      /^Climate risks$/i,
      /^Neighborhood:/i,
    ]
  );

  const financial = sliceSection(
    [/^Financial & listing details$/i],
    [
      /^Services availability$/i,
      /^Contact a buyer/i,
      /^Offer Insights$/i,
      /^Estimated market value$/i,
      /^Price history$/i,
      /^Public tax history$/i,
      /^Monthly payment$/i,
      /^Climate risks$/i,
    ],
    220
  );

  // C-1: also stop at BuyAbility℠ payment / Est. payment / Estimated payment
  // hero anchors so the text-fallback `monthlyLines` slice never leaks the
  // BuyAbility module's hidden customize-slider estimates into the payment
  // strict-label lookahead (this is the path that produced $1,547 / $170 /
  // $105 / $0 on 2500 Walnut when DOM extraction raced the SPA render).
  const monthly = sliceSection(
    [/^Monthly payment$/i],
    [
      /^Down payment assistance$/i,
      /^BuyAbility(?:™|\u2122|\u2120|\u2113|\u24e2)?\s*payment$/i,
      /^Est\.?\s*payment$/i,
      /^Estimated\s+(?:monthly\s+)?payment$/i,
      /^Climate risks$/i,
      /^Neighborhood:/i,
    ],
    160
  );

  const climate = sliceSection(
    [/^Climate risks$/i, /^Flood zone$/i],
    [
      /^Neighborhood:/i,
      /^Street View$/i,
      /^Getting around$/i,
      /^Walk Score$/i,
      /^Bike Score$/i,
      /^Nearby schools$/i,
      /^More about schools$/i,
    ],
    140
  );

  // C-2: when scanning lookahead rows for a payment label, reject candidates
  // that don't look like an actual money amount.  This stops BuyAbility's
  // hidden customize-slider estimates (e.g. "Other costs: $1306",
  // "Powered by NMLS #10287") from being picked up as a P&I / Tax / Ins /
  // HOA value when `monthlyLines` accidentally contains them.
  const PAYMENT_VALUE_PATTERNS = [
    /^\$\s*[\d,]+(?:\.\d+)?\s*(?:\/\s*mo)?$/i,        // $5,593 / $5,593/mo
    /^Not\s+included$/i,                              // BuyAbility "Not included"
    /^Included$/i,                                     // alternative phrasing
    /^\d+\s*\/\s*\d+\s*score$/i,                      // credit-score rows that slipped in (defensive)
  ];
  function looksLikePaymentValue(candidate) {
    if (!candidate) return false;
    const c = candidate.trim();
    return PAYMENT_VALUE_PATTERNS.some(re => re.test(c));
  }

  function getStrictLabelValue(sectionLines, labels, stopLabels = [], maxLookahead = 6) {
    for (let i = 0; i < sectionLines.length; i++) {
      const line = sectionLines[i];

      for (const label of labels) {
        const escaped = escapeRegExp(label);

        // Case 1: "Label: value"
        const inline = line.match(new RegExp(`^${escaped}\\s*[:：]\\s*(.+)$`, "i"));
        if (inline?.[1]) return norm(inline[1]);

        // Case 2: exact "Label" only, not "Bedrooms & bathrooms"
        const exact = new RegExp(`^${escaped}$`, "i").test(line);
        if (!exact) continue;

        for (let j = i + 1; j < Math.min(sectionLines.length, i + maxLookahead); j++) {
          const candidate = norm(sectionLines[j]);
          if (!candidate) continue;

          if (
            stopLabels.some(stop =>
              new RegExp(`^${escapeRegExp(stop)}\\s*[:：]?$`, "i").test(candidate)
            )
          ) {
            return null;
          }

          // C-2: payment labels require a money-shaped value; if the candidate
          // is unrelated text (BuyAbility slider legend, NMLS notice, marketing
          // copy, etc.) keep scanning rather than returning it.
          if (!looksLikePaymentValue(candidate)) continue;

          return candidate;
        }
      }
    }

    return null;
  }

  function parseNumber(v) {
    if (v == null) return null;
    const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function parseMoneyNumber(v) {
    if (v == null) return null;
    const m = String(v).replace(/[$,]/g, "").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function extractTopSummary() {
    const top = lines.slice(0, Math.min(lines.length, 80));
    const priceLine = top.find(l => /^\$[\d,]+$/.test(l)) || null;
    const addressLine =
      top.find(l => /\d{5}/.test(l) && /,\s*[A-Z]{2}\s+\d{5}/.test(l)) || null;

    // ── Hero / Top Summary local extraction ──
    // Real Zillow listings sometimes split "Est." and "$7,829/mo" across
    // two adjacent text nodes. To preserve the existing single-line behaviour
    // and stay strictly local to the Hero/Top Summary slice, we:
    //   (1) keep the original `^Est\.?\s*payment:` same-line match, and
    //   (2) if that misses, anchor on a standalone "Est." / "Est. payment"
    //       line inside the same `top` slice and absorb the first legal
    //       "$X/mo" token from the **next 1–3 adjacent text nodes only**.
    // We MUST NOT fall back to scanning the whole `lines` array — that
    // would let "$930/mo" from an HOA row leak into the hero total.
    // If no legal amount is found inside that 1–3 node window, keep null
    // (do not guess).
    const HERO_AMOUNT_RE = /\$[\d,]+(?:\.\d{2})?\s*\/\s*mo\b/i;

    let estPaymentRaw = null;
    const estPaymentLineSameRow =
      top.find(l => /^Est\.?\s*payment:\s*.+\/mo\b/i.test(l)) || null;
    if (estPaymentLineSameRow) {
      estPaymentRaw = estPaymentLineSameRow;
    } else {
      // Same-line with label only (no $/mo yet) — e.g. "Est. payment:"
      // pointing at a value that lives in the next node. We still treat this
      // as a same-row match and only absorb a token that's literally on the
      // same line after the colon.
      const estPaymentLine =
        top.find(l => /^Est\.?\s*payment:/i.test(l)) || null;
      if (estPaymentLine) {
        estPaymentRaw = estPaymentLine;
      } else {
        const anchorIndex = top.findIndex(l =>
          /^Est\.?(\s+payment)?\s*[:.]?\s*$/i.test(l)
        );
        if (anchorIndex >= 0) {
          for (let i = 1; i <= 3 && anchorIndex + i < top.length; i++) {
            const candidate = top[anchorIndex + i];
            if (HERO_AMOUNT_RE.test(candidate)) {
              estPaymentRaw = candidate;
              break;
            }
          }
        }
      }
    }

    return {
      priceDisplay: priceLine,
      priceAmount: parseMoneyNumber(priceLine),
      address: addressLine,
      estimatedPaymentTop: estPaymentRaw
        ? norm(estPaymentRaw.replace(/^Est\.?\s*payment:\s*/i, ""))
        : null,
    };
  }

  // ── v7 helper: read "Label: value" facts directly from the Facts & features
  //     DOM container (data-testid="fact-category" > li > span). Independent of
  //     document.body.innerText and not affected by "Show more" folding.
  //     Returns a flat {Label: value} map of the first occurrence per label.
  //     No retries, no waiting, no clicking — single synchronous pass.
  function readZillowFactsDict() {
    const out = {};
    try {
      const headings = document.querySelectorAll('h2');
      let root = null;
      for (const h of headings) {
        if (/^Facts & features$/i.test(h.textContent || '')) {
          root = h.closest('[data-c11n-component="Box"]') || h.parentElement;
          break;
        }
      }
      if (!root) return out;
      const categories = root.querySelectorAll('[data-testid="fact-category"]');
      categories.forEach((cat) => {
        const spans = cat.querySelectorAll('li > span');
        spans.forEach((sp) => {
          const text = (sp.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text) return;
          const m = text.match(/^([^:]{1,40}?):\s*(.+)$/);
          if (m) {
            const k = m[1].trim();
            const v = m[2].trim();
            if (k && v && out[k] === undefined) out[k] = v;
          }
        });
      });
    } catch (_) {
      // never throw — returns partial or empty dict
    }
    return out;
  }

  // === PR: full structured Facts & features groups (schema-agnostic) ===
  // Walks the Facts & features module structurally and emits:
  //   groups: [{ section, categories: [{ category, items: [{label, value, raw}] }] }]
  // - section   = <h3> text inside [data-testid="category-group"]
  // - category  = <h6> text inside [data-testid="fact-category"] (may be "")
  // - item      = each <li><span>...</span></li>
  //     - "Label: value" -> { label: "Label", value: "value", raw: "Label: value" }
  //     - otherwise      -> { label: null,      value: <text>, raw: <text> }
  // Returns plain JSON-serializable object (no Map).
  function readZillowFactsAndFeatures() {
    const empty = { groups: [] };
    try {
      const headings = document.querySelectorAll('h2');
      let root = null;
      for (const h of headings) {
        if (/^Facts & features$/i.test(h.textContent || '')) {
          root = h.closest('[data-c11n-component="Box"]') || h.parentElement;
          break;
        }
      }
      if (!root) return empty;
      const groupEls = root.querySelectorAll('[data-testid="category-group"]');
      const groups = [];
      groupEls.forEach((groupEl) => {
        const sectionEl = groupEl.querySelector('h3');
        const section = sectionEl ? (sectionEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
        const catEls = groupEl.querySelectorAll('[data-testid="fact-category"]');
        const categories = [];
        catEls.forEach((catEl) => {
          const h6 = catEl.querySelector('h6');
          const category = h6 ? (h6.textContent || '').replace(/\s+/g, ' ').trim() : '';
          const items = [];
          const spans = catEl.querySelectorAll('li > span');
          spans.forEach((sp) => {
            const text = (sp.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const m = text.match(/^([^:]{1,80}?):\s*(.+)$/);
            if (m) {
              const label = m[1].trim();
              const value = m[2].trim();
              if (label && value) {
                items.push({ label, value, raw: text });
              }
            } else {
              items.push({ label: null, value: text, raw: text });
            }
          });
          if (items.length > 0) {
            categories.push({ category, items });
          }
        });
        if (categories.length > 0) {
          groups.push({ section, categories });
        }
      });
      return { groups };
    } catch (_) {
      return empty;
    }
  }

  function extractDescription() {
    const start = lines.findIndex(l => /^What's special$/i.test(l));
    if (start < 0) return null;

    const endPatterns = [
      /^Hide$/i,
      /^\d+\s+days$/i,
      /^Zillow last checked:/i,
      /^Listing updated:/i,
      /^Listed by:/i,
      /^Source:/i,
      /^Stay connected$/i,
      /^Facts & features$/i,
    ];

    const collected = [];
    for (let i = start + 1; i < Math.min(lines.length, start + 80); i++) {
      const line = lines[i];
      if (endPatterns.some(p => p.test(line))) break;
      collected.push(line);
    }

    return collected.join("\n").trim() || null;
  }

  function extractFloodZone() {
    const section = climate.lines.length ? climate.lines : lines;

    for (let i = 0; i < section.length; i++) {
      const line = section[i];

      const inline = line.match(/^Flood zone\s*[:：]\s*(.+)$/i);
      if (inline?.[1]) return norm(inline[1]);

      if (/^Flood zone$/i.test(line)) {
        const candidates = [];

        for (let j = i + 1; j < Math.min(section.length, i + 10); j++) {
          const candidate = norm(section[j]);
          if (!candidate) continue;

          if (/^(Neighborhood:|Street View|Getting around|Walk Score|Bike Score|Nearby schools|More about)/i.test(candidate)) {
            break;
          }

          if (/FEMA|Zone|flood|risk|minimal-risk/i.test(candidate)) {
            candidates.push(candidate);
          }

          if (candidates.length >= 2) break;
        }

        if (candidates.length) return candidates.join(" ");
      }
    }

    const direct = raw.match(/In FEMA Zone[^\n]+/i);
    if (direct?.[0]) return norm(direct[0]);

    return null;
  }

  // Walk Score / Bike Score / Transit Score: extract from Getting Around section
  function extractScores() {
    const gettingAround = sliceSection(
      [/^Getting around$/i],
      [/^Nearby schools$/i, /^More about schools$/i, /^Climate risks$/i],
      80
    );
    const lines = gettingAround?.lines ?? [];

    let walkScore = null;
    let bikeScore = null;
    let transitScore = null;
    for (const line of lines) {
      const wm = line.match(/walk\s+score[:\s]*(\d+)\s*\/?\s*100[^,\n]*(?:,\s*([^\n]+))?/i);
      if (wm && !walkScore) {
        walkScore = `${wm[1]} / 100${wm[2] ? ', ' + wm[2].trim() : ''}`;
      }
      const bm = line.match(/bike\s+score[:\s]*(\d+)\s*\/?\s*100[^,\n]*(?:,\s*([^\n]+))?/i);
      if (bm && !bikeScore) {
        bikeScore = `${bm[1]} / 100${bm[2] ? ', ' + bm[2].trim() : ''}`;
      }
      // Transit Score: "Transit Score: 67 / 100, Good Transit"
      const tm = line.match(/transit\s+score[:\s]*(\d+)\s*\/?\s*100[^,\n]*(?:,\s*([^\n]+))?/i);
      if (tm && !transitScore) {
        transitScore = Number(tm[1]) || null;
      }
    }
    return { walkScore, bikeScore, transitScore };
  }

  // ── School Ratings: extract from Nearby Schools section ────────────────────────
  // Zillow page contains school ratings as structured text: "School Name  Rating: X/10  0.X miles"
  function extractSchoolRatings() {
    const schoolsSection = sliceSection(
      [/^Nearby schools$/i, /^More about schools$/i],
      [/^Getting around$/i, /^Climate risks$/i, /^Neighborhood$/i],
      120
    );
    const schoolLines = schoolsSection?.lines ?? [];

    const schools = [];
    for (const line of schoolLines) {
      // Match: "School Name  Rating: 8/10  1.2 miles" or similar patterns
      // Try multiple patterns for robustness
      const ratingMatch = line.match(/rating[:\s]*(\d+)\s*\/?\s*10/i);
      const distanceMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:mi|miles?)/i);
      if (ratingMatch) {
        const name = line
          .replace(/\s*rating[:\s]*\d+\s*\/?\s*10/i, '')
          .replace(/\s*\d+(?:\.\d+)?\s*(?:mi|miles?)\s*/gi, '')
          .replace(/,/g, ',')
          .trim();
        const rating = Number(ratingMatch[1]) || null;
        const distance = distanceMatch ? distanceMatch[0].trim() : null;
        if (name && name.length > 1 && rating) {
          schools.push({ name, rating, distance: distance || undefined });
        }
      }
    }
    return schools.length > 0 ? schools : null;
  }

  // Neighborhood: extract from Neighborhood section
  function extractNeighborhood() {
    const section = sliceSection(
      [/^Neighborhood:$/i],
      [/^Street View$/i, /^Getting around$/i, /^Facts & features$/i, /^Price history$/i],
      20
    );
    if (!section) return null;
    const lines = section.lines ?? [];
    const candidates = [];
    for (let i = 1; i < Math.min(lines.length, i + 5); i++) {
      const line = lines[i]?.trim() ?? '';
      if (!line) continue;
      if (/^(Street View|Getting around|Facts &|Walk Score|Bike Score|Nearby schools|More about)/i.test(line)) break;
      candidates.push(line);
    }
    return candidates.join(', ') || null;
  }

  const top = extractTopSummary();
  const factsLines = facts.lines;
  const financialLines = financial.lines;
  const monthlyLines = monthly.lines;
  const factsDict = readZillowFactsDict();
  const factsAndFeatures = readZillowFactsAndFeatures();

  // ── Zillow Estimated Market Value section: Zestimate + Sales Range ──────────────────
  // Declared OUTSIDE the result object — JavaScript object literals cannot contain var/let/const declarations.
  const estimatedSalesRangeLines = (() => {
    const mvSection = sliceSection(
      [/^Estimated market value$/i],
      [/^Price history$/i, /^Monthly payment$/i, /^Public tax history$/i],
      60
    );
    return mvSection?.lines ?? [];
  })();

  const parseRangeNum = (s) => {
    if (!s) return null;
    const normalized = String(s).replace(/[$,]/g, '');
    const mMatch = normalized.match(/^([\d.]+)\s*M$/i);
    if (mMatch) return Number(mMatch[1]) * 1_000_000;
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  };

  let estimatedSalesRangeMin = null;
  let estimatedSalesRangeMax = null;
  for (let _ri = 0; _ri < estimatedSalesRangeLines.length; _ri++) {
    const line = estimatedSalesRangeLines[_ri];
    const inlineMatch = line.match(/\$([\d,.]+(?:M)?)\s*[-–]\s*\$([\d,.]+(?:M)?)/i);
    if (inlineMatch && !estimatedSalesRangeMin) {
      estimatedSalesRangeMin = parseRangeNum(inlineMatch[1]);
      estimatedSalesRangeMax = parseRangeNum(inlineMatch[2]);
      continue;
    }
    if (/estimated\s+sales\s+range/i.test(line) && _ri + 1 < estimatedSalesRangeLines.length) {
      const nextLine = estimatedSalesRangeLines[_ri + 1];
      const nextMatch = nextLine.match(/\$([\d,.]+(?:M)?)\s*[-–]\s*\$([\d,.]+(?:M)?)/i);
      if (nextMatch && !estimatedSalesRangeMin) {
        estimatedSalesRangeMin = parseRangeNum(nextMatch[1]);
        estimatedSalesRangeMax = parseRangeNum(nextMatch[2]);
      }
    }
  }

  const result = {
    // Top summary
    price: top.priceDisplay,
    priceAmount: top.priceAmount,
    address: top.address,
    estimatedPaymentTop: top.estimatedPaymentTop,

    // Facts & features
    bedrooms: parseNumber(getStrictLabelValue(factsLines, ["Bedrooms"], [
      "Bathrooms",
      "Full bathrooms",
      "1/2 bathrooms",
      "Heating",
      "Cooling",
    ])),

    bathrooms: parseNumber(getStrictLabelValue(factsLines, ["Bathrooms"], [
      "Full bathrooms",
      "1/2 bathrooms",
      "Heating",
      "Cooling",
    ])),

    fullBaths: parseNumber(getStrictLabelValue(factsLines, [
      "Full bathrooms",
      "Full bathroom",
      "Full baths",
      "Full bath",
    ], [
      "1/2 bathrooms",
      "Half bathrooms",
      "Heating",
      "Cooling",
    ])),

    halfBaths: parseNumber(getStrictLabelValue(factsLines, [
      "1/2 bathrooms",
      "1/2 bathroom",
      "Half bathrooms",
      "Half bathroom",
      "Half baths",
      "Half bath",
    ], [
      "Heating",
      "Cooling",
      "Appliances",
      "Features",
    ])),

    heating: getStrictLabelValue(factsLines, ["Heating"], [
      "Cooling",
      "Appliances",
      "Features",
      "Interior area",
    ]),

    cooling: getStrictLabelValue(factsLines, ["Cooling"], [
      "Appliances",
      "Features",
      "Interior area",
      "Property",
    ]),

    basement: getStrictLabelValue(factsLines, ["Basement"], [
      "Attic",
      "Has fireplace",
      "Interior area",
      "Property",
    ]),

    totalStructureArea: parseNumber(getStrictLabelValue(factsLines, ["Total structure area"], [
      "Total interior livable area",
      "Property",
    ])),

    sqft: parseNumber(getStrictLabelValue(factsLines, ["Total interior livable area"], [
      "Property",
      "Parking",
    ])),

    totalSpaces: parseNumber(getStrictLabelValue(factsLines, ["Total spaces"], [
      "Parking features",
      "Garage spaces",
      "Lot",
    ])),

    parkingFeatures: getStrictLabelValue(factsLines, ["Parking features"], [
      "Garage spaces",
      "Lot",
    ]),

    // === v7: DOM-facts-dict fallback for rental facts (non-destructive).
    // Inner-text path is tried first; DOM dictionary only fills in when the
    // inner-text read returned null (e.g. Show more collapsed content).
    parking: factsDict['Parking features'] ?? null,
    buildingName: factsDict['Building name'] ?? null,

    garageSpaces: parseNumber(getStrictLabelValue(factsLines, ["Garage spaces"], [
      "Lot",
      "Size",
    ])),

    lotSize: getStrictLabelValue(factsLines, ["Size"], [
      "Dimensions",
      "Features",
      "Details",
      "Parcel number",
    ]),

    lotDimensions: getStrictLabelValue(factsLines, ["Dimensions"], [
      "Features",
      "Details",
      "Parcel number",
    ]),

    parcelNumber: getStrictLabelValue(factsLines, ["Parcel number"], [
      "Special conditions",
      "Construction",
    ]),

    homeType: getStrictLabelValue(factsLines, ["Home type"], [
      "Architectural style",
      "Property subtype",
      "Materials",
    ]) ?? factsDict['Home type'] ?? null,

    architecturalStyle: getStrictLabelValue(factsLines, ["Architectural style"], [
      "Property subtype",
      "Materials",
    ]),

    propertySubtype: getStrictLabelValue(factsLines, ["Property subtype"], [
      "Materials",
      "Condition",
      "Year built",
    ]),

    propertyType: getStrictLabelValue(factsLines, ["Property subtype"], [
      "Materials",
      "Condition",
      "Year built",
    ]),

    constructionMaterial: getStrictLabelValue(factsLines, ["Materials"], [
      "Condition",
      "Year built",
    ]),

    yearBuilt: parseNumber(getStrictLabelValue(factsLines, ["Year built"], [
      "Utilities & green energy",
      "Sewer",
      "Water",
      "Community & HOA",
    ])),

    sewer: getStrictLabelValue(factsLines, ["Sewer"], [
      "Water",
      "Utilities for property",
      "Community & HOA",
    ]),

    water: getStrictLabelValue(factsLines, ["Water"], [
      "Utilities for property",
      "Community & HOA",
    ]),

    propertyUtilities: getStrictLabelValue(factsLines, ["Utilities for property"], [
      "Community & HOA",
      "HOA",
    ]),

    hasHoa: getStrictLabelValue(factsLines, ["Has HOA"], [
      "Location",
      "Region",
    ]),

    // ── HOA fee: extracted from Facts & Features > Community & HOA > HOA > HOA fee.
    //   This is the canonical Zillow "HOA fee: $951 monthly" entry that appears
    //   even when BuyAbility / Monthly payment breakdown has not rendered yet.
    //   Priority over BuyAbility-derived hoaFees only when BuyAbility returns null,
    //   so existing DOM-extracted BuyAbility rows remain authoritative.
    hoaFeeFromFacts: getStrictLabelValue(factsLines, ["HOA fee"], [
      "Location",
      "Region",
    ]),

    region: getStrictLabelValue(factsLines, ["Region"], [
      "Financial & listing details",
    ]),

    // === Rental facts (Facts & features section) ===
    // Strict-label reads only — no full-page regex.
    // Sources (priority): gdpClientCache property > DOM facts container.
    leaseTerm: getStrictLabelValue(factsLines, [
      "Lease term",
      "Lease length",
    ], [
      "Pets allowed",
      "Parking features",
      "Laundry",
      "Interior area",
      "Property",
    ]) ?? factsDict['Lease term'] ?? null,

    petPolicy: getStrictLabelValue(factsLines, [
      "Pets allowed",
      "Pet policy",
      "Pets",
    ], [
      "Laundry",
      "Parking features",
      "Lease term",
      "Property",
    ]) ?? factsDict['Pets allowed'] ?? null,

    laundry: getStrictLabelValue(factsLines, [
      "Laundry",
      "Laundry features",
    ], [
      "Pets allowed",
      "Parking features",
      "Lease term",
      "Property",
    ]) ?? factsDict['Laundry'] ?? null,

    availabilityStatus: (() => {
      const raw = getStrictLabelValue(factsLines, [
        "Available now",
        "Availability",
        "Date available",
        "Available date",
      ], [
        "Lease term",
        "Pets allowed",
        "Laundry",
        "Property",
      ]);
      if (!raw) return null;
      const lower = raw.toLowerCase();
      if (/now|today|immediately/.test(lower)) return "available_now";
      if (/coming\s*soon|future/.test(lower)) return "coming_soon";
      // Date-like string: keep raw text
      return raw;
    })(),

    // === PR: high-value fields promoted from Facts & features (DOM fallback
    //     only — do not overwrite innerText-derived values above). ===
    fullBathrooms: parseNumber(getStrictLabelValue(factsLines, [
      "Full bathrooms",
      "Full bathroom",
      "Full baths",
      "Full bath",
    ], [
      "1/2 bathrooms",
      "Half bathrooms",
      "Heating",
      "Cooling",
    ])),

    interiorFeatures: getStrictLabelValue(factsLines, [
      "Interior features",
    ], [
      "Appliances",
      "Features",
      "Interior area",
      "Property",
    ]),

    flooring: getStrictLabelValue(factsLines, [
      "Flooring",
      "Floor covering",
    ], [
      "Cooling",
      "Appliances",
      "Features",
      "Interior area",
    ]),

    parkingDetails: getStrictLabelValue(factsLines, [
      "Parking",
      "Parking details",
    ], [
      "Garage spaces",
      "Lot",
      "Features",
    ]),

    patioPorch: getStrictLabelValue(factsLines, [
      "Patio & porch",
      "Patio and porch",
      "Patio",
      "Porch",
    ], [
      "Pool",
      "Features",
      "Property",
    ]),

    exteriorFeatures: getStrictLabelValue(factsLines, [
      "Exterior features",
      "Other exterior features",
    ], [
      "Lot",
      "Features",
      "Property",
    ]),

    amenitiesIncluded: getStrictLabelValue(factsLines, [
      "Amenities included",
      "Community amenities",
    ], [
      "Features",
      "Property",
      "Community & HOA",
    ]),

    security: getStrictLabelValue(factsLines, [
      "Security",
      "Security features",
    ], [
      "Features",
      "Property",
    ]),

    // === PR: full structured Facts & features groups (schema-agnostic).
    //     Always populated — independent of which fields are promoted above. ===
    factsAndFeaturesGroups: factsAndFeatures,

    // Financial & listing details
    pricePerSqft: getStrictLabelValue(financialLines, ["Price per square foot"], [
      "Tax assessed value",
      "Annual tax amount",
      "Date on market",
    ]),

    pricePerSqftAmount: parseMoneyNumber(getStrictLabelValue(financialLines, ["Price per square foot"], [
      "Tax assessed value",
      "Annual tax amount",
      "Date on market",
    ])),

    taxAssessedValue: getStrictLabelValue(financialLines, ["Tax assessed value"], [
      "Annual tax amount",
      "Date on market",
    ]),

    taxAssessedValueAmount: parseMoneyNumber(getStrictLabelValue(financialLines, ["Tax assessed value"], [
      "Annual tax amount",
      "Date on market",
    ])),

    annualTax: getStrictLabelValue(financialLines, ["Annual tax amount"], [
      "Date on market",
      "Cumulative days on market",
      "Listing agreement",
    ]),

    annualTaxAmount: parseMoneyNumber(getStrictLabelValue(financialLines, ["Annual tax amount"], [
      "Date on market",
      "Cumulative days on market",
      "Listing agreement",
    ])),

    dateOnMarket: getStrictLabelValue(financialLines, ["Date on market"], [
      "Cumulative days on market",
      "Listing agreement",
    ]),

    cumulativeDaysOnMarket: getStrictLabelValue(financialLines, ["Cumulative days on market"], [
      "Listing agreement",
      "Electric utility on property",
    ]),

    listingAgreement: getStrictLabelValue(financialLines, ["Listing agreement"], [
      "Electric utility on property",
      "Services availability",
    ]),

    // Monthly payment
    monthlyPayment: getStrictLabelValue(monthlyLines, ["Estimated monthly payment"], [
      "Principal & interest",
      "Mortgage insurance",
      "Property taxes",
    ]),

    monthlyPaymentAmount: parseMoneyNumber(getStrictLabelValue(monthlyLines, ["Estimated monthly payment"], [
      "Principal & interest",
      "Mortgage insurance",
      "Property taxes",
    ])),

    principalAndInterest: getStrictLabelValue(monthlyLines, ["Principal & interest"], [
      "Mortgage insurance",
      "Property taxes",
    ]),

    mortgageInsurance: getStrictLabelValue(monthlyLines, ["Mortgage insurance"], [
      "Property taxes",
      "Home insurance",
    ]),

    propertyTaxesMonthly: getStrictLabelValue(monthlyLines, ["Property taxes"], [
      "Home insurance",
      "HOA fees",
    ]),

    homeInsuranceMonthly: getStrictLabelValue(monthlyLines, ["Home insurance"], [
      "HOA fees",
      "Utilities",
    ]),

    hoaFees: getStrictLabelValue(monthlyLines, ["HOA fees"], [
      "Utilities",
    ]),

    utilities: getStrictLabelValue(monthlyLines, ["Utilities"], [
      "All calculations are estimates",
      "HOA fees may include",
      "Mortgage interest rates",
    ]),

    // Other
    description: extractDescription(),
    floodZone: extractFloodZone(),
    ...(() => {
      const s = extractScores();
      return { walkScore: s.walkScore, bikeScore: s.bikeScore, transitScore: s.transitScore };
    })(),
    ...(() => {
      const schools = extractSchoolRatings();
      return { schoolRatings: schools };
    })(),
    neighborhood: extractNeighborhood(),
    estimatedSalesRangeMin,
    estimatedSalesRangeMax,

    zillowFinancials: null,

    debug: {
      factsStart: facts.start,
      factsEnd: facts.end,
      financialStart: financial.start,
      financialEnd: financial.end,
      monthlyStart: monthly.start,
      monthlyEnd: monthly.end,
      climateStart: climate.start,
      climateEnd: climate.end,
    },
  };

  // ── Try DOM extraction first (new BuyAbility UI) ────────────────────────────
  // extractBuyAbilityPayment and extractFactsFromDOM are defined above
  const buyAbility = (typeof extractBuyAbilityPayment === 'function')
    ? extractBuyAbilityPayment()
    : null;
  const factsDOM = (typeof extractFactsFromDOM === 'function')
    ? extractFactsFromDOM()
    : null;

  // Build zillowFinancials
  // Priority: DOM extraction (BuyAbility) > text parsing fallback.
  // Each field is independently overridden — missing DOM values fall back to text extraction.
  const monthlyPaymentFromText = result.monthlyPayment ? parseMoney(result.monthlyPayment) : null;
  const zfMonthly = {
    estimatedMonthlyPayment: buyAbility?.estimatedMonthlyPayment
      ? parseMoney(buyAbility.estimatedMonthlyPayment)
      : monthlyPaymentFromText,
    principalAndInterest: buyAbility?.principalAndInterest
      ? parseMoney(buyAbility.principalAndInterest)
      : (result.principalAndInterest ? parseMoney(result.principalAndInterest) : null),
    mortgageInsurance: buyAbility?.mortgageInsurance
      ? parseMoney(buyAbility.mortgageInsurance)
      : (result.mortgageInsurance ? parseMoney(result.mortgageInsurance) : null),
    propertyTaxes: buyAbility?.propertyTaxes
      ? parseMoney(buyAbility.propertyTaxes)
      : (result.propertyTaxesMonthly ? parseMoney(result.propertyTaxesMonthly) : null),
    homeInsurance: buyAbility?.homeInsurance
      ? parseMoney(buyAbility.homeInsurance)
      : (result.homeInsuranceMonthly ? parseMoney(result.homeInsuranceMonthly) : null),
    hoaFees: buyAbility?.hoaFees
      ? parseMoney(buyAbility.hoaFees)
      : (result.hoaFees
          ? parseMoney(result.hoaFees)
          : (result.hoaFeeFromFacts ? parseMoney(result.hoaFeeFromFacts) : null)),
    utilities: buyAbility?.utilities
      ? parseMoney(buyAbility.utilities)
      : (result.utilities ? parseMoney(result.utilities) : null),
  };
  // Consistency guard: if estimatedMonthlyPayment is lower than P&I alone, the
  // extraction picked up a row-value (e.g. HOA $930) instead of the true total.
  // Treat the total as unavailable rather than propagating bad data.
  // Now also checks against P&I + tax + insurance + HOA (the complete known set).
  const knownComponents = [
    zfMonthly.principalAndInterest?.value,
    zfMonthly.propertyTaxes?.value,
    zfMonthly.homeInsurance?.value,
    zfMonthly.hoaFees?.value,
    zfMonthly.mortgageInsurance?.value,
  ].filter(n => n != null && Number.isFinite(n));
  const lowestPossibleTotal = knownComponents.reduce((sum, value) => sum + value, 0);
  const estimatedPaymentValue = zfMonthly.estimatedMonthlyPayment?.value;
  if (
    estimatedPaymentValue != null &&
    lowestPossibleTotal > 0 &&
    estimatedPaymentValue < lowestPossibleTotal
  ) {
    // Null out the total; individual components are still valid.
    zfMonthly.estimatedMonthlyPayment = null;
  }

  // C-3: hero-total cross-check. When the SPA delivered BuyAbility's hidden
  // customize-slider estimate via the text-fallback path (producing a small
  // P&I + tax + ins + HOA cluster such as $1,547 / $170 / $105 / $0), the
  // sum-of-components guard above is silent because the estimatedMonthlyPayment
  // itself is still the real hero $7,829. Compare the running component total
  // against the hero payment and drop the contaminated component cluster when
  // it is wildly inconsistent with the hero.  We treat "wildly inconsistent" as
  // components sum being less than 50% of the hero (true components always sum
  // to roughly the hero, modulo utilities + other costs) so this guard only
  // fires on the small-down-payment contamination pattern, not normal pages.
  const heroPaymentValue =
    result?.estimatedPaymentTop != null
      ? parseMoneyNumber(result.estimatedPaymentTop)
      : null;
  if (
    heroPaymentValue != null &&
    heroPaymentValue > 0 &&
    lowestPossibleTotal > 0 &&
    lowestPossibleTotal < heroPaymentValue * 0.5
  ) {
    // Components are too small relative to the hero total — likely a hidden
    // BuyAbility customize estimate. Drop them rather than letting them
    // shadow the real BuyAbility UL values downstream.
    zfMonthly.principalAndInterest = null;
    zfMonthly.propertyTaxes = null;
    zfMonthly.homeInsurance = null;
    zfMonthly.hoaFees = null;
    zfMonthly.mortgageInsurance = null;
    zfMonthly.utilities = null;
  }

  // ── HOA Services included + HOA fee: read from Community & HOA section in Facts & features ──
  // Zillow lists services like: "Water, Trash, Maintenance Grounds, Maintenance Structure, Snow Removal"
  // Zillow also lists the ledger HOA fee as "HOA fee: $951 monthly" inside the same section.
  // We capture both as deterministic facts so the Sale pipeline never loses the HOA amount
  // even when BuyAbility / Monthly payment breakdown has not yet rendered.
  const hoaSection = sliceSection(
    [/^Community & HOA$/i],
    [/^Region$/i, /^Location$/i, /^Financial & listing details$/i],
    40
  );
  const hoaSectionLines = hoaSection?.lines ?? [];
  const hoaServicesIncluded = (() => {
    const services = [];
    for (const line of hoaSectionLines) {
      // Match each service item prefixed by the "Services included" label
      const serviceMatch = line.match(/^Services\s+included[:\s]*(.+)/i);
      if (serviceMatch) {
        const raw = serviceMatch[1];
        // Services are comma-separated
        for (const s of raw.split(/[,;]/)) {
          const trimmed = s.trim();
          if (trimmed && trimmed.length > 1 && trimmed.length < 50) {
            services.push(trimmed);
          }
        }
      }
    }
    return services.length > 0 ? services : null;
  })();

  // ── HOA fee fallback: deterministic promotion from Community & HOA > HOA > HOA fee.
  //   Only fills in `result.hoaFee` when no other source (BuyAbility, JSON-LD
  //   propertyData, sliceSection monthly payment) has already set it. This keeps
  //   Rent and Building paths untouched: neither uses this exact label.
  const hoaFeeFromFactsSection = (() => {
    for (const line of hoaSectionLines) {
      const match = line.match(/^HOA\s+fee[:\s]*(.+)/i);
      if (match && match[1]) {
        const value = match[1].trim();
        // Skip sentinel values that mean "no HOA" rather than "has HOA but no number".
        if (/^n\/?a$/i.test(value)) return null;
        return value;
      }
    }
    return null;
  })();
  if (hoaFeeFromFactsSection && !result.hoaFee) {
    result.hoaFee = hoaFeeFromFactsSection;
  }

  // ── Roof fallback: only used when extractFactsFromDOM() did not surface a
  //     "Roof: <value>" entry. Searches the structured Facts & features groups
  //     for an item whose label is exactly "Roof" (case-insensitive) and uses
  //     its value. A loose substring match is deliberately avoided — there are
  //     other Roofing-related rows (e.g. "Roof age") that must not be picked
  //     up here. The structural read is independent of the inner-text path and
  //     is not affected by Zillow's "Show more" folding.
  function pickRoofFromFactsAndFeatures(facts) {
    if (!facts || !Array.isArray(facts.groups)) return null;
    for (const group of (facts.groups || [])) {
      const categories = Array.isArray(group.categories) ? group.categories : [];
      for (const cat of categories) {
        const items = Array.isArray(cat.items) ? cat.items : [];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const label = typeof item.label === 'string' ? item.label.trim() : '';
          if (label.toLowerCase() !== 'roof') continue;
          const value = typeof item.value === 'string' ? item.value.trim() : '';
          if (value) return value;
        }
      }
    }
    return null;
  }

  result.zillowFinancials = {
    monthlyPayment: zfMonthly,
    // Facts from DOM
    hasHoa: factsDOM?.hasHoa ?? (result.hasHoa || null),
    // Roof precedence: specialized DOM reader first, structured Facts &
    // features fallback only when DOM read is empty. Keeps the specialized
    // DOM value authoritative on listings where both paths surface a value.
    roof: factsDOM?.roof || pickRoofFromFactsAndFeatures(factsAndFeatures) || null,
    // Deterministic HOA fee promoted from Community & HOA > HOA > HOA fee.
    // Supplied as flat string so backend consumers that read zillowFinancials.hoaFee
    // (regardless of nested monthlyPayment shape) can rely on it.
    hoaFee: result.hoaFee || null,
    // Preserve flat financial fields for other consumers
    pricePerSqft: result.pricePerSqft,
    pricePerSqftAmount: result.pricePerSqftAmount,
    taxAssessedValue: result.taxAssessedValue,
    taxAssessedValueAmount: result.taxAssessedValueAmount,
    annualTaxAmount: result.annualTax,
    annualTaxAmountNumber: result.annualTaxAmount,
    dateOnMarket: result.dateOnMarket,
    cumulativeDaysOnMarket: result.cumulativeDaysOnMarket,
    // ── New structured fields ──
    hoaIncludedServices: hoaServicesIncluded,
    schoolRatings: result.schoolRatings || null,
    transitScore: result.transitScore || null,
    estimatedSalesRangeMin: result.estimatedSalesRangeMin || null,
    estimatedSalesRangeMax: result.estimatedSalesRangeMax || null,
  };

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Sale Property Payment lazy-render recovery
//
// On a Zillow Sale single-property page, the BuyAbility / monthly-payment
// breakdown is mounted lazily when the BuyAbility module scrolls into the
// Zillow `.layout-container-desktop` scroll container. If the page was
// loaded at the top, the first `extractZillowData()` call often finds the
// breakdown still un-hydrated, so `zillowFinancials.monthlyPayment` ends
// up null. This helper:
//
//   1. Only runs on Zillow Sale single-property pages (reportMode='sale',
//      PAGE_SCOPES.PROPERTY). Other paths are completely untouched.
//   2. Only triggers when the first pass produced no Payment component at
//      all. If any of the six core rows already has a value, we skip.
//   3. Locates `.layout-container-desktop` and the `Estimated market value`
//      heading; calls `scrollIntoView()` (no fixed pixel offsets).
//   4. Waits a single bounded window for the breakdown to mount.
//   5. Calls `extractZillowData()` again to re-read with DOM priority +
//      text fallback (unchanged behaviour).
//   6. Merges ONLY the non-empty `monthlyPayment` fields from the second
//      pass back onto the first result. Address, HOA, Roof, Facts, and
//      every other Zillow field stay exactly as the first pass produced.
//   7. Always restores `.layout-container-desktop.scrollTo({ top: 0 })`
//      in a `finally`, even on throw / timeout / missing anchor, so the
//      gallery step that runs immediately afterwards still sees the page
//      at the top.
//
// Never modifies collector / paging / dedup / expectedTotal logic.
// ──────────────────────────────────────────────────────────────────────
async function maybeRecoverSalePropertyPayment(initialZillowData) {
  // Gate 1: only Zillow Sale single-property.
  if (!isZillowPage()) return initialZillowData;
  const reportMode = (typeof detectReportMode === 'function')
    ? detectReportMode({}, window.location.href)
    : null;
  if (reportMode !== 'sale') return initialZillowData;
  const pageScope = (typeof detectZillowPageScope === 'function')
    ? detectZillowPageScope()
    : { scope: null };
  if (!pageScope || pageScope.scope !== PAGE_SCOPES.PROPERTY) return initialZillowData;

  // Gate 2: only when every Payment component is missing.
  const firstMp = initialZillowData?.zillowFinancials?.monthlyPayment || null;
  const PAYMENT_FIELDS = [
    'estimatedMonthlyPayment',
    'principalAndInterest',
    'mortgageInsurance',
    'propertyTaxes',
    'homeInsurance',
    'hoaFees',
    'utilities',
  ];
  const isMeaningful = (v) => {
    if (v == null) return false;
    if (typeof v === 'object') return v.value != null;
    return String(v).trim() !== '';
  };
  const hasAnyPayment = PAYMENT_FIELDS.some((k) => isMeaningful(firstMp?.[k]));
  if (hasAnyPayment) {
    return initialZillowData;
  }

  // Gate 3: container must exist.
  const layoutContainer = document.querySelector('.layout-container-desktop');
  if (!layoutContainer) {
    return initialZillowData;
  }

  try {
    const anchor = findEstimatedMarketValueAnchor();
    if (!anchor) {
      return initialZillowData;
    }

    // Force the BuyAbility / monthly-payment block to lazy-mount by
    // scrolling the anchor into view inside the Zillow layout container.
    try {
      anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
    } catch (_) {
      anchor.scrollIntoView();
    }

    // Bounded wait for Zillow to hydrate the BuyAbility breakdown.
    const waitDeadline = Date.now() + 1500;
    while (Date.now() < waitDeadline) {
      if (typeof findPaymentBreakdownRoot === 'function' && findPaymentBreakdownRoot()) break;
      await shortDelay(80, 140);
    }

    // Second pass: re-read with existing DOM priority + text fallback.
    const secondZillowData = extractZillowData();
    return mergeSalePropertyPayment(initialZillowData, secondZillowData);
  } catch (err) {
    return initialZillowData;
  } finally {
    // Restore the Zillow layout container to the top regardless of
    // success / failure / missing anchor / timeout. The gallery step
    // assumes the page is at the top; a stale scroll position would
    // cause `gallery_not_opened` in `openGalleryForScope()`.
    try {
      if (layoutContainer && typeof layoutContainer.scrollTo === 'function') {
        layoutContainer.scrollTo({ top: 0, behavior: 'auto' });
        await shortDelay(150, 250);
      }
    } catch (_) {
      /* swallow — restoration must never throw into the caller */
    }
  }
}

// Locate the heading whose normalised text is `Estimated market value`.
// Falls back to case-insensitive contains to tolerate minor wording
// shifts in the Zillow DOM.
function findEstimatedMarketValueAnchor() {
  const headingMatches = (text) => {
    const norm = (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!norm) return false;
    return norm === 'estimated market value'
      || norm.startsWith('estimated market value')
      || norm.includes('estimated market value');
  };
  const headings = document.querySelectorAll('h1, h2, h3');
  for (const h of headings) {
    if (headingMatches(h.textContent)) {
      return h;
    }
  }
  return null;
}

// Merge helper: start from `first` (which has all the address / HOA /
// Roof / Facts data we don't want to disturb), then promote only the
// non-empty `monthlyPayment` fields from `second`.
function mergeSalePropertyPayment(first, second) {
  if (!second || typeof second !== 'object') return first;
  const safeFirst = first && typeof first === 'object' ? first : { source: 'zillow' };
  const secondMp = second?.zillowFinancials?.monthlyPayment || null;
  if (!secondMp) return safeFirst;

  const existingZf = safeFirst.zillowFinancials || {};
  const existingMp = existingZf.monthlyPayment || {};

  const isMeaningful = (v) => {
    if (v == null) return false;
    if (typeof v === 'object') return v.value != null;
    return String(v).trim() !== '';
  };

  const PAYMENT_FIELDS = [
    'estimatedMonthlyPayment',
    'principalAndInterest',
    'mortgageInsurance',
    'propertyTaxes',
    'homeInsurance',
    'hoaFees',
    'utilities',
  ];

  const mergedMp = { ...existingMp };
  let promoted = 0;
  for (const key of PAYMENT_FIELDS) {
    if (isMeaningful(existingMp[key])) continue; // never overwrite a real first-pass value
    const candidate = secondMp[key];
    if (isMeaningful(candidate)) {
      mergedMp[key] = candidate;
      promoted += 1;
    }
  }

  if (promoted === 0) return safeFirst;
  return {
    ...safeFirst,
    zillowFinancials: {
      ...existingZf,
      monthlyPayment: mergedMp,
    },
  };
}

/**
 * Parse a money string into a structured value object.
 * Handles: $0, N/A, Not included, /sqft, /mo variants.
 * Uses value != null checks — never !value — because $0 is a valid value.
 */
function parseMoney(raw) {
  if (!raw || typeof raw !== 'string') {
    return { raw: String(raw ?? ''), value: null, status: 'unknown' };
  }
  const s = raw.trim();
  if (s === '' || s === 'N/A' || s === 'n/a') {
    return { raw: s, value: null, status: 'not_applicable' };
  }
  if (s === 'Not included' || s === 'not included') {
    return { raw: s, value: null, status: 'not_included' };
  }

  let period = null;
  let cleaned = s;

  // Detect period suffix
  if (/\/sqft$/i.test(s) || /per\s*sq/i.test(s)) {
    period = 'per_sqft';
    cleaned = s.replace(/\/sqft$/i, '').replace(/per\s*sq\.?\s*ft/gi, '').trim();
  } else if (/\/mo$/i.test(s) || /per\s*month/i.test(s)) {
    period = 'monthly';
    cleaned = s.replace(/\/mo$/i, '').replace(/per\s*month/gi, '').trim();
  }

  // Strip $ and commas
  cleaned = cleaned.replace(/\$/g, '').replace(/,/g, '').trim();

  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) {
    return { raw: s, value: null, status: 'unknown' };
  }

  return { raw: s, value, status: 'known', ...(period ? { period } : {}) };
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
  const financial = {};

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

  // Property Tax — also capture raw number
  if (data.annualTax || data.propertyTax || data.taxAssessment) {
    const taxVal = data.annualTax || data.propertyTax || data.taxAssessment;
    if (typeof taxVal === 'number') {
      result.propertyTax = '$' + taxVal.toLocaleString() + '/yr';
      result.annualTaxAmount = taxVal;
    } else {
      result.propertyTax = String(taxVal);
      // Try to parse "$6,070/yr" → 6070
      const parsed = parseTaxAmount(String(taxVal));
      if (parsed) result.annualTaxAmount = parsed;
    }
  }

  // Living Area (sqft)
  if (data.livingArea || data.sqft || data.area) {
    result.sqft = data.livingArea || data.sqft || data.area;
  }

  // Days on Zillow
  if (data.daysOnZillow || data.listingAge || data.daysOnMarket) {
    result.daysOnZillow = data.daysOnZillow || data.listingAge || data.daysOnMarket;
  }

  // Tax Assessed Value
  if (data.taxAssessedValue || data.tax_assessed_value) {
    const tav = data.taxAssessedValue || data.tax_assessed_value;
    if (typeof tav === 'number') {
      result.taxAssessedValue = '$' + tav.toLocaleString();
      result.taxAssessedValueAmount = tav;
      financial.taxAssessedValueDisplay = '$' + tav.toLocaleString();
      financial.taxAssessedValue = tav;
    } else {
      result.taxAssessedValue = String(tav);
      const parsed = parseTaxAmount(String(tav));
      if (parsed) {
        result.taxAssessedValueAmount = parsed;
        financial.taxAssessedValue = parsed;
        financial.taxAssessedValueDisplay = '$' + parsed.toLocaleString();
      } else {
        financial.taxAssessedValueDisplay = String(tav);
      }
    }
  }

  // Price per Sqft
  if (data.pricePerSqft || data.price_per_sqft || data.pricePerSqftAmount) {
    const pps = data.pricePerSqft || data.price_per_sqft || data.pricePerSqftAmount;
    if (typeof pps === 'number') {
      result.pricePerSqft = '$' + pps + '/sqft';
      result.pricePerSqftAmount = pps;
      financial.pricePerSqft = pps;
      financial.pricePerSqftDisplay = '$' + pps + '/sqft';
    } else {
      result.pricePerSqft = String(pps);
      const parsed = parsePricePerSqftAmount(String(pps));
      if (parsed) {
        result.pricePerSqftAmount = parsed;
        financial.pricePerSqft = parsed;
        financial.pricePerSqftDisplay = '$' + parsed + '/sqft';
      } else {
        financial.pricePerSqftDisplay = String(pps);
      }
    }
  }

  // Date Listed
  if (data.dateListed || data.date_listed || data.listingDate || data.listDate) {
    const dl = data.dateListed || data.date_listed || data.listingDate || data.listDate;
    result.dateListed = String(dl);
    financial.dateListed = String(dl);
  }

  // Available Date
  if (data.availableDate || data.available_date || data.moveInDate || data.move_in_date) {
    const ad = data.availableDate || data.available_date || data.moveInDate || data.move_in_date;
    result.availableDate = String(ad);
    financial.availableDate = String(ad);
  }

  // Build financialDetails object from accumulated values
  if (financial.taxAssessedValueDisplay || financial.pricePerSqftDisplay ||
      financial.dateListed || financial.availableDate || result.annualTaxAmount) {
    result.financialDetails = { ...financial };
    if (result.propertyTax) {
      result.financialDetails.propertyTaxDisplay = result.propertyTax;
    }
    if (result.annualTaxAmount) {
      result.financialDetails.annualTaxAmount = result.annualTaxAmount;
    }
  }

  return result;
}

// Parse "$6,070/yr" or "$6070" → 6070 (number)
function parseTaxAmount(str) {
  if (!str) return null;
  const cleaned = str.replace(/[$,]/g, '').replace(/\/yr|\/year/gi, '').trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// Parse "$434/sqft" or "434" → 434 (number)
function parsePricePerSqftAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[$,]|per sqft|per sq\.?|per\s*ft|\/sqft|\/sq\.?\s*ft/gi, '').trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/**
 * Extract address from Zillow page
 */
function extractAddressZillow() {
  // Method 1: data-testid selectors — strip MLS lines first
  const selectors = [
    '[data-testid="address"]',
    'h1[data-testid="address"]',
    'address[data-testid="street-address"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      // cleanAddressCandidate finds the first line that looks like a real address
      const address = cleanAddressCandidate(el.textContent || '');
      if (address) return address;
    }
  }

  // Method 2: generic [class*="address"] selector
  const addrEl = document.querySelector('[class*="address"]');
  if (addrEl) {
    const address = cleanAddressCandidate(addrEl.textContent || '');
    if (address) return address;
  }

  // Method 3: h1 fallback — use cleanTitleCandidate which strips MLS + browser suffixes
  const h1 = document.querySelector('h1');
  if (h1) {
    const candidate = cleanTitleCandidate(h1.textContent || '');
    if (candidate && isLikelyFullAddress(candidate)) return candidate;
  }

  return null;
}

/**
 * Read a labeled value from a Zillow Facts & Features-like row.
 *
 * Used as the LAST-RESORT fallback for `extractRoomsZillow`. Unlike
 * `getStrictLabelValue` (which iterates ZillowRawData lines), this one walks
 * the live DOM and accepts multiple label candidates. Returns a short text
 * snippet that immediately follows the label, or null if nothing found.
 *
 * Goal: tolerate realistic variations like:
 *   "Bedrooms: 0"
 *   "Bedrooms    0"
 *   "Bedrooms — 0"
 *
 * The snippet is then parsed for the FIRST number — so callers can use
 * `parseFloat('0') === 0` without polluting Studio listings with marketing
 * copy that mentions other unit types.
 */
function extractLabeledScopeText(labelCandidates) {
  // try DOM scoped to Facts & Features / property details
  const scopedRoots = [
    document.querySelector('[data-testid="bed-bath-beyond"]'),
    document.querySelector('[data-testid="bed-bath-sqft"]'),
    document.querySelector('[data-testid="hdp-property-details"]'),
  ].filter(Boolean);

  for (const root of scopedRoots) {
    const text = (root.textContent || '').replace(/\s+/g, ' ');
    for (const label of labelCandidates) {
      // case-insensitive word boundary label, then capture the immediate tail
      const re = new RegExp(
        '\\b(?:bedrooms?|baths?)\\b[\\s\\-:—–]*([^\\n|]{0,40})',
        'i',
      );
      const m = text.match(re);
      if (m && m[1] != null) return m[1].trim();
    }
  }

  // fall back: look in Facts-and-features blocks of line-organized text
  try {
    const all = Array.from(document.querySelectorAll('dl, [data-testid="facts-and-features"] li, [data-testid="facts-and-features"] div'));
    for (const el of all) {
      const t = (el.textContent || '').trim();
      for (const label of labelCandidates) {
        const re = new RegExp('^\\s*' + label + '[\\s\\-:—–]+(.+)$', 'i');
        const m = t.match(re);
        if (m) return m[1].trim();
      }
    }
  } catch (_) {
    // ignore — DOM may not expose all branches
  }

  return null;
}

function extractRoomsZillow() {
  const result = { bedrooms: null, bathrooms: null, sqft: null };

  // ── Method 1: per-stat data-testid elements (preferred) ───────────────────
  // Zillow renders each room stat as a discrete element with these testids.
  const bedStatEl = document.querySelector('[data-testid="bed-bath-item--bed"]');
  const bathStatEl = document.querySelector('[data-testid="bed-bath-item--bath"]');
  const sqftStatEl = document.querySelector('[data-testid="bed-bath-item--sqft"]');

  if (bedStatEl) {
    const m = (bedStatEl.textContent || '').match(/(\d+(?:\.\d+)?)/);
    if (m) result.bedrooms = parseFloat(m[1]);
  }
  if (bathStatEl) {
    const m = (bathStatEl.textContent || '').match(/(\d+(?:\.\d+)?)/);
    if (m) result.bathrooms = parseFloat(m[1]);
  }
  if (sqftStatEl) {
    const m = (sqftStatEl.textContent || '').match(/([\d,]+)/);
    if (m) result.sqft = parseInt(m[1].replace(/,/g, ''), 10);
  }

  // ── Method 2: container with label-aware parsing ─────────────────────────
  // For each label, take the FIRST value immediately after the label.
  // Don't blindly use text.match() — the container can include filter chips
  // (e.g. "Beds 1+ 2 3 4 5+") that pollute matches.
  const bedBathEl = document.querySelector('[data-testid="bed-bath-beyond"]') ||
                    document.querySelector('[data-testid="bed-bath-sqft"]') ||
                    document.querySelector('[data-testid="hdp-property-details"]');
  
if (bedBathEl) {
    const text = bedBathEl.textContent || '';

    // For each label, take the FIRST value immediately after the label in the
    // container text. We avoid plain text.match(...) because the container can
    // include filter chips (e.g. "Beds 1+ 2 3 4 5+") or duplicate "1 ba"
    // badges from adjacent similar-listing cards.
    const labeledValue = (labelRe, valueRe) => {
      const labelMatch = text.match(labelRe);
      if (!labelMatch || labelMatch.index == null) return null;
      const tail = text.slice(labelMatch.index + labelMatch[0].length);
      const valueMatch = tail.match(valueRe);
      return valueMatch ? valueMatch[1] : null;
    };

    if (result.bedrooms == null) {
      const v = labeledValue(/\bbeds?\b/i, /(\d+(?:\.\d+)?)/);
      if (v) result.bedrooms = parseFloat(v);
    }
    if (result.bathrooms == null) {
      const v = labeledValue(/\bbaths?\b/i, /(\d+(?:\.\d+)?)/);
      if (v) result.bathrooms = parseFloat(v);
    }
    if (result.sqft == null) {
      const v = labeledValue(/\bsqft\b/i, /([\d,]+)/);
      if (v) result.sqft = parseInt(v.replace(/,/g, ''), 10);
    }
  }

  // ── Method 3: individual data-testid fallbacks ───────────────────────────
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

  // ── Method 4: scoped labeled fallback (last resort) ─────────────────────
  // ⚠ IMPORTANT: the previous implementation used a body-wide regex like
  // `/(\d+)\s*(?:bd|bed(?:s|room)?)/i` which is unreliable for Studio pages.
  // Concretely, when the current listing has bedrooms=0 but the building's
  // marketing copy contains phrases like "studios and one-bedroom apartments",
  // the regex matched "1 bedroom" and OVERWROTE the structured 0 with 1.
  //
  // The new fallback:
  //   (a) only fires when no labeled source produced a value;
  //   (b) ONLY trusts matches that come from a labeled scope (Facts & Features
  //       row, or an explicit "Bedrooms: N" label). A free-floating "1 bedroom"
  //       in the body text is NOT trusted for Studio safety.
  //   (c) preserves 0 (does NOT skip when result.bedrooms === 0).
  if (result.bedrooms == null) {
    const scopedText = extractLabeledScopeText(['bedrooms']);
    if (scopedText) {
      const m = scopedText.match(/(\d+(?:\.\d+)?)/);
      if (m) result.bedrooms = parseFloat(m[1]);
    }
  }
  if (result.bathrooms == null) {
    const scopedText = extractLabeledScopeText(['bathrooms']);
    if (scopedText) {
      const m = scopedText.match(/(\d+(?:\.\d+)?)/);
      if (m) result.bathrooms = parseFloat(m[1]);
    }
  }

  // sqft has no zero/Studio ambiguity, so a body-text fallback is safe and
  // surfaces "230 sqft" reliably for Studio pages.
  if (result.sqft == null) {
    const bodyText = document.body?.innerText || '';
    const sqftMatch = bodyText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|square\s*feet)\b/i);
    if (sqftMatch) result.sqft = parseInt(sqftMatch[1].replace(/,/g, ''), 10);
  }

  return result;
}

/**
 * Extract the "What's Special" / agent marketing text from a Zillow listing page.
 * Targets the "What's special" section (not the full page body).
 * Strips MLS/IDX/disclaimer noise.
 * Returns up to 2500 characters of clean marketing copy, or empty string on failure.
 *
 * Strategy: prefer a DOM-level scoped read inside [data-testid="listing-overview"]
 * (which preserves inter-word whitespace from sibling list items), falling back
 * to a body innerText line scan.
 */
function extractZillowAgentMarketingText() {
  // ── Preferred: DOM-level scoped extraction ───────────────────────────────
  const overview = document.querySelector('[data-testid="listing-overview"]');
  if (overview) {
    const headings = overview.querySelectorAll('h1, h2, h3');
    let scopeEl = null;
    for (const h of headings) {
      if (/what['\u2019']?s\s*special/i.test(h.textContent || '')) {
        scopeEl = h.parentElement || overview;
        break;
      }
    }
    if (scopeEl) {
      // Collect highlight bullets first (each <span role="listitem"> is its own
      // item, joined with a space — this fixes "PrivateYardLaundryHookUp...").
      const bullets = [];
      for (const li of scopeEl.querySelectorAll('span[role="listitem"]')) {
        const t = (li.getAttribute('aria-label') || li.textContent || '').trim();
        if (t && t.length >= 3) bullets.push(t);
      }

      // Then collect the body text (the agent paragraph below the bullets).
      const bodyEl = scopeEl.querySelector('[data-testid="description"]') ||
                     scopeEl.querySelector('article') ||
                     scopeEl;
      let body = '';
      if (bodyEl) {
        // Clone to avoid mutating live DOM, then drop the bullets so we don't
        // double-count them.
        const clone = bodyEl.cloneNode(true);
        clone.querySelectorAll('span[role="listitem"], ul, ol').forEach(n => n.remove());
        body = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }

      const combined = [...bullets, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

      const MLS_NOISE_RE = /internet data exchange|idx program|data relating to real estate|mls grid|all rights reserved|broker reciprocity/i;
      if (combined.length >= 30 && !MLS_NOISE_RE.test(combined)) {
        return combined.slice(0, 2500);
      }
    }
  }

  // ── Fallback: body innerText line scan (legacy behavior) ─────────────────
  const raw = document.body?.innerText || '';
  const lines = raw
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex(l => /^what['\u2019']?s special$/i.test(l));
  if (startIndex === -1) return '';

  const endPatterns = [
    /^show more$/i,
    /^show less$/i,
    /^\d+\s+days?\s+on zillow$/i,
    /^zillow last checked/i,
    /^listing updated/i,
    /^listed by:?$/i,
    /^source:/i,
    /^facts\s*&\s*features$/i,
    /^open houses$/i,
  ];

  const collected = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (endPatterns.some(re => re.test(line))) break;
    collected.push(line);
  }

  const text = collected
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const MLS_NOISE_RE = /internet data exchange|idx program|data relating to real estate|mls grid|all rights reserved|broker reciprocity/i;

  if (!text || text.length < 30) return '';
  if (MLS_NOISE_RE.test(text)) return '';

  return text.slice(0, 2500);
}

/**
 * Normalize a string to title case.
 */
function normalizeTitleCase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/**
 * Extract highlights (bullet-style phrases) from the "What's Special" section
 * of a Zillow listing page. Returns up to 8 title-cased phrases.
 *
 * Strategy:
 *   1. Preferred: walk the DOM and pull each <span role="listitem"> value
 *      individually. This avoids the "Private yardLaundry hook up..." run-
 *      together problem that occurs when Zillow renders each highlight as
 *      its own inline span and innerText doesn't insert separators.
 *   2. Fallback: scan body innerText line-by-line (legacy behavior).
 */
function extractZillowWhatsSpecialHighlights() {
  // ── Preferred: DOM-level scoped extraction ───────────────────────────────
  // Find the listing-overview container, then the "What's special" header
  // inside it, then collect each <span role="listitem"> as a separate phrase.
  const overview = document.querySelector('[data-testid="listing-overview"]');
  if (overview) {
    const headings = overview.querySelectorAll('h1, h2, h3');
    let whatsSpecialScope = null;
    for (const h of headings) {
      if (/what['\u2019']?s\s*special/i.test(h.textContent || '')) {
        whatsSpecialScope = h.parentElement || overview;
        break;
      }
    }
    if (whatsSpecialScope) {
      const items = whatsSpecialScope.querySelectorAll('span[role="listitem"]');
      const highlights = [];
      for (const li of items) {
        const text = (li.getAttribute('aria-label') || li.textContent || '').trim();
        if (text.length >= 3 && text.length <= 80) {
          highlights.push(normalizeTitleCase(text));
        }
        if (highlights.length >= 8) break;
      }
      if (highlights.length > 0) return Array.from(new Set(highlights));
    }
  }

  // ── Fallback: body innerText line scan (legacy behavior) ─────────────────
  const bodyText = document.body?.innerText || '';
  const lines = bodyText
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex(l => /^what['\u2019']?s special$/i.test(l));
  if (startIndex === -1) return [];

  const stopRe = /delivered vacant|welcome to|this spacious|located in|show more|show less|facts\s*&\s*features|zillow last checked|listing updated|listed by|source:/i;

  const highlights = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (stopRe.test(line)) break;

    const cleaned = line.replace(/\s+/g, ' ').trim();

    if (
      cleaned.length >= 3 &&
      cleaned.length <= 80 &&
      !/what['\u2019']?s special|show more|show less|source:|mls/i.test(cleaned)
    ) {
      highlights.push(normalizeTitleCase(cleaned));
    }

    if (highlights.length >= 8) break;
  }

  return Array.from(new Set(highlights));
}

async function extractListingDataLight() {
  // ── 过滤搜索结果页 ──────────────────────────────────────────
  // 搜索结果页不应提取数据，否则会显示第一个房源卡片的信息
  // 而不是当前 tab 的真实内容
  if (isZillowSearchPage()) {
    noop('[HomeScope] Search page detected, skipping extraction');
    return { listing: null, detection: buildPropertyDetection(detectPropertySignals(), { title: document.title }) };
  }

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
    // NOTE: a truthy check here would silently skip Studio (`bedrooms=0`).
    // We MUST compare against null/undefined so the structured 0 survives.
    if (zillowRooms.bedrooms != null) rooms.bedrooms = zillowRooms.bedrooms;
    if (zillowRooms.bathrooms != null) rooms.bathrooms = zillowRooms.bathrooms;

    // Get Zillow-specific fields (includes zillowFinancials)
    zillowData = extractZillowData();
    // Sale single-property Payment lazy-render recovery: if the page was
    // still above the BuyAbility section when the first pass ran, the
    // monthly-payment breakdown may not have mounted yet. A bounded scroll
    // to "Estimated market value" + a short wait lets Zillow hydrate the
    // block, and we merge only the non-empty monthlyPayment fields back in.
    zillowData = await maybeRecoverSalePropertyPayment(zillowData);
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
    // PR 1A: populate listingUrl so background can use it
    listingUrl: window.location.href || null,    // 自动检测房源类型：买房(sale)还是租房(rent)
    reportMode: detectReportMode({ priceText: price }, window.location.href),
    // PR 1A: listingType mirrors reportMode (for background.js deriveReportModeStrict)
    listingType: detectReportMode({ priceText: price }, window.location.href),
    // Include Zillow-specific fields if on Zillow
    ...(isZillowPage() ? {
      mlsSource: extractZillowMlsSource(),
      sqft: zillowData.sqft || null,
      zestimate: zillowData.zestimate || null,
      rentZestimate: zillowData.rentZestimate || null,
      yearBuilt: zillowData.yearBuilt || null,
      lotSize: zillowData.lotSize || null,
      hoaFee: zillowData.hoaFee || null,
      propertyTax: zillowData.propertyTax || null,
      annualTaxAmount: zillowData.annualTaxAmount || null,
      daysOnZillow: zillowData.daysOnZillow || null,
      // Financial details
      taxAssessedValue: zillowData.taxAssessedValue || null,
      taxAssessedValueAmount: zillowData.taxAssessedValueAmount || null,
      pricePerSqft: zillowData.pricePerSqft || null,
      pricePerSqftAmount: zillowData.pricePerSqftAmount || null,
      dateListed: zillowData.dateListed || null,
      availableDate: zillowData.availableDate || null,
      financialDetails: zillowData.financialDetails || null,
      zillowFinancials: zillowData.zillowFinancials || null,
      // Walk Score / Bike Score / Neighborhood / Architectural Style / Transit / Schools
      walkScore: zillowData.walkScore || null,
      bikeScore: zillowData.bikeScore || null,
      neighborhood: zillowData.neighborhood || null,
      architecturalStyle: zillowData.architecturalStyle || null,
      transitScore: zillowData.zillowFinancials?.transitScore || null,
      schoolRatings: zillowData.zillowFinancials?.schoolRatings || null,
      // roof and HOA from facts section (BuyAbility / DOM extraction)
      roof: zillowData.zillowFinancials?.roof || null,
      hoa: zillowData.zillowFinancials?.hasHoa != null
        ? zillowData.zillowFinancials.hasHoa ? 'Yes' : 'No'
        : null,
      // HOA explicitly included services (from Community & HOA section)
      hoaIncludedServices: zillowData.zillowFinancials?.hoaIncludedServices || null,
      // Property classification (also referenced from optionalDetails fallbacks)
      propertyType: zillowData.propertyType || null,
      homeType: zillowData.homeType || null,
      propertySubtype: zillowData.propertySubtype || null,
      // Heating / cooling / basement / parking / flood zone — kept at top
      // level so the report + backend fallback can read them directly
      // without depending on propertyFactsV2 nesting.
      heating: zillowData.heating || null,
      cooling: zillowData.cooling || null,
      basement: zillowData.basement || null,
      parkingFeatures: zillowData.parkingFeatures || null,
      // === Rental facts (DOM facts container; non-destructive: do not
      // overwrite number rooms.parking already on top-level listing). ===
      leaseTerm: zillowData.leaseTerm || null,
      petPolicy: zillowData.petPolicy || null,
      laundry: zillowData.laundry || null,
      availabilityStatus: zillowData.availabilityStatus || null,
      garageSpaces: zillowData.garageSpaces != null ? zillowData.garageSpaces : null,
      floodZone: zillowData.floodZone || null,
      region: zillowData.region || null,
      // === PR: high-value Facts & features fields (DOM fallback only) ===
      fullBathrooms: zillowData.fullBathrooms != null ? zillowData.fullBathrooms : null,
      interiorFeatures: zillowData.interiorFeatures || null,
      flooring: zillowData.flooring || null,
      parkingDetails: zillowData.parkingDetails || null,
      patioPorch: zillowData.patioPorch || null,
      exteriorFeatures: zillowData.exteriorFeatures || null,
      amenitiesIncluded: zillowData.amenitiesIncluded || null,
      security: zillowData.security || null,
      // === PR: full structured Facts & features groups (schema-agnostic) ===
      factsAndFeatures: zillowData.factsAndFeaturesGroups || { groups: [] },
      // ── Sale valuation: Estimated sales range from Zillow ──────────────────────
      estimatedSalesRangeMin: zillowData.zillowFinancials?.estimatedSalesRangeMin || null,
      estimatedSalesRangeMax: zillowData.zillowFinancials?.estimatedSalesRangeMax || null,
    } : {}),
  };

  // ── propertyFactsV2: structured Zillow field normalization ──
  if (isZillowPage()) {
    const zf = zillowData?.zillowFinancials ?? null;
    const agentMarketingTextRaw = extractZillowAgentMarketingText();

    const marketingBody = agentMarketingTextRaw
      .replace(/^.*?(?=(Delivered vacant|Welcome to|This spacious|Located in|Beautifully|Perfect for)\b)/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const agentMarketingText = marketingBody || agentMarketingTextRaw;

    // Detect MLS/disclaimer noise in description
    const rawDesc = description || '';
    const MLS_NOISE_RE = /source[:.]|mls|onekey|as distributed by|all rights reserved|broker reciprocity|internet data exchange|idx program|data relating to real estate|mls grid/i;
    const mlsDisclaimerDetected = MLS_NOISE_RE.test(rawDesc);

    // Build missingFields list
    const missingFields = [];
    if (!address) missingFields.push('address');
    if (!price) missingFields.push('price');
    if (!rooms.bedrooms) missingFields.push('beds');
    if (!rooms.bathrooms) missingFields.push('baths');
    if (!zillowData.sqft) missingFields.push('sqft');
    if (!zillowData.yearBuilt) missingFields.push('yearBuilt');
    if (!zillowData.lotSize) missingFields.push('lotSize');
    if (!zillowData.zestimate) missingFields.push('zestimate');
    if (!zillowData.rentZestimate) missingFields.push('rentZestimate');
    if (!zillowData.heating) missingFields.push('heating');
    if (!zillowData.cooling) missingFields.push('cooling');
    if (!zillowData.basement) missingFields.push('basement');
    if (!zillowData.annualTaxAmount) missingFields.push('annualTaxAmount');
    if (!zillowData.pricePerSqftAmount) missingFields.push('pricePerSqft');
    if (!zillowData.walkScore) missingFields.push('walkScore');
    if (!zillowData.bikeScore) missingFields.push('bikeScore');
    if (!zillowData.floodZone) missingFields.push('floodZone');
    if (!zillowData.neighborhood) missingFields.push('neighborhood');
    if (!zillowData.daysOnZillow) missingFields.push('daysOnZillow');

    listing.propertyFactsV2 = {
      schemaVersion: 'zillow_property_facts_v2',
      identity: {
        address: address || null,
        price: price || null,
        sourceDomain: 'zillow.com',
        listingUrl: window.location.href,
        propertyType: zillowData.propertyType || null,
        homeType: zillowData.homeType || null,
        propertySubtype: zillowData.propertySubtype || null,
        region: zillowData.region || null,
      },
      basicFacts: {
        beds: rooms.bedrooms || null,
        baths: rooms.bathrooms || null,
        sqft: zillowData.sqft || null,
        lotSize: zillowData.lotSize || null,
        yearBuilt: zillowData.yearBuilt || null,
        daysOnZillow: zillowData.daysOnZillow || null,
      },
      listingText: {
        description: rawDesc || null,
        whatsSpecialText: agentMarketingText || null,
        agentMarketingText: agentMarketingText || null,
        highlights: [],
        mlsDisclaimerDetected,
      },
      factsAndFeatures: {
        heating: zillowData.heating || null,
        cooling: zillowData.cooling || null,
        basement: zillowData.basement || null,
        leaseTerm: zillowData.leaseTerm || null,
        petPolicy: zillowData.petPolicy || null,
        laundry: zillowData.laundry || null,
        availabilityStatus: zillowData.availabilityStatus || null,
        parkingFeatures: zillowData.parkingFeatures || null,
        // === PR: parallel schema-agnostic groups (preserves flat fields above) ===
        factsAndFeaturesGroups: zillowData.factsAndFeaturesGroups || { groups: [] },
      },
      financials: {
        pricePerSqft: zillowData.pricePerSqftAmount || null,
        annualTaxAmount: zillowData.annualTaxAmount || null,
        zestimate: zillowData.zestimate || null,
        rentZestimate: zillowData.rentZestimate || null,
        // ── Estimated Sales Range from Zillow ──────────────────────────────────
        estimatedSalesRangeMin: zf?.estimatedSalesRangeMin || null,
        estimatedSalesRangeMax: zf?.estimatedSalesRangeMax || null,
      },
      monthlyPayment: zf?.monthlyPayment || null,
      location: {
        walkScore: zillowData.walkScore || null,
        bikeScore: zillowData.bikeScore || null,
        transitScore: zf?.transitScore || null,
        floodZone: zillowData.floodZone || null,
        neighborhood: zillowData.neighborhood || null,
      },
      // Schools from Zillow (extracted via extractSchoolRatings)
      schools: (zillowData.zillowFinancials?.schoolRatings || []).map((s) => ({
        name: s.name || '',
        rating: s.rating || 0,
        level: s.level,
        distance: s.distance,
      })),
      openHouses: [],
      extractionMeta: {
        confidence: typeof extractionConfidence !== 'undefined' ? extractionConfidence : (confidence || null),
        warnings: [],
        missingFields,
      },
    };

  }

  const detection = buildPropertyDetection(signals, listing);

  return { listing: applyZillowStructuredOverride(listing), detection };
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
      const raw = sel.includes('meta') ? el.getAttribute('content') : el.textContent;
      const text = cleanTitleCandidate(raw || '');
      if (text) return text;
    }
  }
  // Fallback: strip MLS junk from page title too
  return cleanTitleCandidate(document.title || '') || document.title;
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

/**
 * Generic page-level room count extractor (NOT Zillow-specific).
 *
 * ⚠ This is a last-resort fallback used by non-Zillow pages. On Zillow pages
 * we route rooms through `extractRoomsZillow`, which preserves Studio
 * bedrooms=0 and avoids marketing-copy contamination.
 *
 * The regex here is intentionally conservative — it ONLY accepts a number
 * immediately before "bed" / "bedroom" with at most minimal whitespace
 * separators, AND at most 6 characters of context ahead (rejecting
 * marketing phrases like "spacious studios and thoughtfully designed
 * one-bedroom apartments"). For Studio safety we keep a separate, stricter
 * Studio check below that returns 0 if the page literally says
 * "Studio" anywhere.
 */
function extractRooms() {
  const text = document.body.innerText;
  const result = { bedrooms: null, bathrooms: null, parking: null };

  // Studio detection — only matched when an explicit "Studio" label appears
  // together with a sentence context that is clearly the unit's own fact row
  // (e.g. "Apartment Type: Studio", or "Bedrooms: Studio", or a JSON-LD-style
  // "Studio" stat). Marketing copy like "spacious studios" is excluded
  // because of the plural and the adjective prefix.
  if (/\btype\b[\s:—\-]*studio\b/i.test(text) ||
      /\bbedrooms?\b[\s:—\-]*studio\b/i.test(text) ||
      /^\s*studio\s*$/im.test(text)) {
    result.bedrooms = 0;
  }

  // Bedrooms — only trust strongly-attached numbers, e.g. "0 bed", "1 bedroom".
  // Reject widely-separated numbers like "studios and 1 bedroom" or
  // "designed 1-bedroom apartments" by requiring either a label OR a
  // post-numeric unit word immediately adjacent.
  if (result.bedrooms == null) {
    const labeled = text.match(/\bbedrooms?\b\s*[:\-—]?\s*(\d+)\b/i);
    if (labeled) {
      result.bedrooms = parseInt(labeled[1], 10);
    }
  }
  if (result.bedrooms == null) {
    // Strong-attach: number + "bd/bed/bedroom(s)" with optional dots and a
    // word boundary at the END of "bedroom(s)" so we don't grab unrelated
    // sentences.
    const m = text.match(/(?:^|[\s.,;:(\[])(\d{1,2})\s*(?:bd|bedrooms?)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) result.bedrooms = n;
    }
  }

  // Bathrooms — same conservative approach.
  if (result.bathrooms == null) {
    const labeled = text.match(/\bbathrooms?\b\s*[:\-—]?\s*(\d+(?:\.\d+)?)\b/i);
    if (labeled) result.bathrooms = parseFloat(labeled[1]);
  }
  if (result.bathrooms == null) {
    const m = text.match(/(?:^|[\s.,;:(\[])(\d{1,2}(?:\.\d+)?)\s*(?:bathrooms?|ba)\b/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) result.bathrooms = n;
    }
  }

  const carRe = /(\d+)\s*(?:car(?:port|space)?s?|parking|garage)\b/gi;
  const carVals = [];
  let cm;
  while ((cm = carRe.exec(text)) !== null) { const n = parseInt(cm[1], 10); if (n >= 1 && n <= 20) carVals.push(n); }
  if (carVals.length) result.parking = Math.max(...carVals);
  return result;
}

/**
 * Extract a free-form description body for a listing page.
 *
 * IMPORTANT: Previously this used overly-broad selectors like
 * `[class*="content"]`, which on Zillow frequently matched the
 * "Similar listings" / "More units in this building" carousel first and
 * returned the wrong property's description. To avoid that, we now:
 *
 *  1. Prefer Zillow-specific scoped containers (listing-overview, structured
 *     description testid) — these wrap the actual listing's text only.
 *  2. Fall back to generic selectors, but only within the main page root
 *     (skip sticky navs, carousels, modals) and reject containers that are
 *     too short or look like card UI (containing multiple "$" amounts).
 */
function extractDescription() {
  // ─── 1) Zillow-specific scoped selectors (preferred) ─────────────────────
  const scopedSelectors = [
    '[data-testid="listing-overview"] [data-testid="description"]',
    '[data-testid="listing-overview"] article',
    '[data-testid="description"]',
    '[data-testid="structured-description"]',
  ];
  for (const sel of scopedSelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const text = (el.textContent || '').trim();
    if (text.length >= 30 && isLikelyDescription(text)) {
      return text.slice(0, 5000);
    }
  }

  // ─── 2) Generic fallbacks inside main / article only ─────────────────────
  const genericContainers = document.querySelectorAll('main article, main [class*="description"], main [class*="about"]');
  for (const el of genericContainers) {
    const text = (el.textContent || '').trim();
    if (text.length >= 80 && isLikelyDescription(text)) {
      return text.slice(0, 5000);
    }
  }

  return null;
}

/**
 * Reject obvious "this is not the main listing description" candidates:
 *  - Cookie / login / sign-in banners
 *  - Carousel / multi-property UI (several $ prices in one block)
 *  - MLS / IDX attribution noise
 */
function isLikelyDescription(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (lower.includes('cookie') || lower.includes('sign in') || lower.includes('login')) return false;
  if (/source[:.]|mls|onekey|idx program|all rights reserved|broker reciprocity/i.test(text)) return false;
  // Reject card-like UI with multiple dollar amounts (e.g. similar-listing
  // carousel: "$3,650+ $2,800+ $2,400+ ...").
  const dollarHits = (text.match(/\$[\d,]+/g) || []).length;
  if (dollarHits >= 4) return false;
  return true;
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
 * Check if gallery is open (PhotoSwipe or Zillow StyledDialog).
 */
function isGalleryOpen() {
  return !!(
    document.querySelector('.pswp.pswp--open') ||
    document.querySelector('[class*="StyledDialog"]') ||
    document.querySelector('[role="dialog"]')
  );
}

/**
 * Poll until gallery is confirmed open, or timeout.
 * Supports PhotoSwipe and Zillow StyledDialog.
 * Returns true if gallery opened successfully within timeoutMs.
 */
async function waitForPhotoSwipe(timeoutMs = 3000) {
  const start = Date.now();
  
  // 如果 body overflow 已经是 hidden，说明图库可能已经打开
  const bodyOverflowHidden = () => {
    const style = document.body.style.overflow;
    const computed = window.getComputedStyle(document.body).overflow;
    return style === 'hidden' || computed === 'hidden';
  };
  
  while (Date.now() - start < timeoutMs) {
    // PhotoSwipe check
    const pswp = document.querySelector('.pswp');
    if (pswp && pswp.classList.contains('pswp--open')) return true;
    
    // Zillow StyledDialog check
    if (document.querySelector('[class*="StyledDialog"]')) return true;
    
    // Generic dialog check
    if (document.querySelector('[role="dialog"]')) return true;
    
    // Zillow Lightbox/Overlay check - 新版 Zillow 可能使用不同的类名
    if (document.querySelector('[class*="Lightbox"]')) return true;
    if (document.querySelector('[class*="GalleryModal"]')) return true;
    if (document.querySelector('[class*="PhotoModal"]')) return true;
    if (document.querySelector('[class*="media-modal"]')) return true;
    if (document.querySelector('[class*="image-modal"]')) return true;
    
    // 如果 body overflow 是 hidden，也认为图库打开了
    if (bodyOverflowHidden()) {
      return true;
    }
    
    await shortDelay(200, 500);
  }
  
  // 最后一次检查：如果 body overflow 是 hidden，仍然返回 true
  if (bodyOverflowHidden()) {
    return true;
  }
  
  return false;
}

/**
 * Strategy 1: Click the first listing image (most stable).
 * Skips tiny images (icons/logos), finds clickable ancestor,
 * clicks it, then waits for PhotoSwipe to open.
 * For Zillow: prioritizes main photo container over thumbnail grids.
 */
async function clickFirstListingImage() {
  // For Zillow, try to find the main photo container first
  if (isZillowPage()) {
    noop('[DIAG] clickFirstListingImage: Zillow detected, searching main photo container');

    // Find main photo container (hero/primary image area)
    const mainPhotoSelectors = [
      // Zillow specific selectors
      '[data-testid="photo-gallery"]',
      '[class*="PhotoView"]',
      '[class*="photo-view"]',
      // Generic gallery containers
      '[class*="hero"][class*="photo"]',
      '[class*="main"][class*="photo"]',
      '[class*="primary"][class*="photo"]',
    ];

    for (const sel of mainPhotoSelectors) {
      const container = document.querySelector(sel);
      if (container) {
        noop('[DIAG] clickFirstListingImage: Found main photo container with selector:', sel);

        // Find large images within this container
        const imgs = container.querySelectorAll('img');
        for (const img of imgs) {
          const rect = img.getBoundingClientRect();
          // Only click large images (likely the main photo)
          if (rect.width < 300 || rect.height < 200) continue;

          // Find clickable ancestor
          const clickable =
            img.closest('button[aria-label*="view larger"]') ||
            img.closest('button') ||
            img.closest('a') ||
            img.closest('[role="button"]') ||
            img;

          // Skip if this is a thumbnail in a grid
          const parent = img.parentElement;
          if (parent && (parent.className || '').match(/grid|tile|thumb/i)) {
            continue;
          }

          noop('[DIAG] clickFirstListingImage: Clicking main photo image');
          try { clickable.click(); } catch (_) {
            try { clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
          }

          if (await waitForPhotoSwipe(3000)) {
            return true;
          }
        }
      }
    }

    noop('[DIAG] clickFirstListingImage: Main photo container not found or failed, trying fallback');
  }

  // Generic approach for all pages
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
    noop('[DIAG] openGallery: PhotoSwipe already open');
    markGalleryOpened();
    return true;
  }

  // ========== Zillow 策略 ==========
  if (isZillowPage()) {
    noop('[DIAG] openGallery: Zillow page detected, looking for gallery buttons');

    // 检查 Zillow StyledDialog 是否已存在（可能图片画廊已经打开）
    const existingDialog = document.querySelector('[class*="StyledDialog"]') || document.querySelector('[role="dialog"]');
    if (existingDialog) {
      noop('[DIAG] openGallery: StyledDialog already exists, returning true');
      markGalleryOpened();
      return true;
    }

    // 优先查找专门的图片查看按钮（最可靠）
    // 支持多种选择器：data-testid、aria-label、类名模糊匹配、文本内容匹配
    const photoViewBtn = document.querySelector(
      '[data-testid="see-all-photos-button"], ' +
      '[aria-label*="See all photos" i], ' +
      '[aria-label*="view photo" i], ' +
      '[class*="PhotoViewseeAllPhotos"], ' +
      '[class*="StyledGallerySeeAllPhotosButton"]'
    );
    
    // 如果标准选择器找不到，尝试通过文本内容匹配
    let textMatchedBtn = null;
    if (!photoViewBtn) {
      const allBtns = document.querySelectorAll('button');
      textMatchedBtn = Array.from(allBtns).find(b => 
        /See all \d+ photos?/i.test(b.textContent || '')
      );
    }
    
    const targetBtn = photoViewBtn || textMatchedBtn;
    if (targetBtn) {
      noop('[DIAG] openGallery: Found photo view button:', (targetBtn.getAttribute('aria-label') || targetBtn.textContent || '').substring(0, 80));
      try { targetBtn.click(); } catch (_) {
        try { targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
      }
      if (await waitForPhotoSwipe(3000)) {
        markGalleryOpened();
        return true;
      }
    }

    // 查找所有 "view larger view of" 按钮
    const allBtns = document.querySelectorAll('[aria-label*="view larger view of"]');
    noop('[DIAG] openGallery: Found', allBtns.length, '"view larger" buttons');

    if (allBtns.length === 0) {
      noop('[DIAG] openGallery: No view larger buttons found, trying fallback strategies');
    } else {
      // 严格过滤：只保留真正的照片按钮，排除一切其他媒体类型
      const photoBtns = [...allBtns].filter(btn => {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        // 排除任何非照片的媒体类型
        const excluded = /\b(3d|3-d|tour|video|floor\s*plan|floorplan|map|street\s*view|aerial|drone|latlng|dron|小鸟瞰|小区概览|平面图|卫星图|街景)\b/i;
        return !excluded.test(label);
      });
      noop('[DIAG] openGallery: Photo buttons after strict filter:', photoBtns.length);

      if (photoBtns.length > 0) {
        // 策略1: 只点击第一个按钮（主图），这是最可靠的入口
        const firstBtn = photoBtns[0];
        const firstLabel = firstBtn.getAttribute('aria-label') || '';
        noop('[DIAG] openGallery: Clicking first photo button:', firstLabel.substring(0, 80));

        // 使用更强制的点击方式，阻止默认导航行为
        // 首先阻止事件冒泡
        const stopNav = (e) => {
          e.stopPropagation();
          e.preventDefault();
        };

        // 临时添加事件阻止器
        firstBtn.addEventListener('click', stopNav, { capture: true, once: true });

        // 模拟鼠标事件，确保 cancelable
        const mouseEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        firstBtn.dispatchEvent(mouseEvent);

        // 等待一小段时间后移除阻止器
        setTimeout(() => {
          firstBtn.removeEventListener('click', stopNav, { capture: true });
        }, 100);

        if (await waitForPhotoSwipe(3000)) {
          noop('[DIAG] openGallery: First button succeeded');
          markGalleryOpened();
          return true;
        }

        // 如果事件方式失败，尝试直接调用点击处理
        try {
          firstBtn.click();
        } catch (_) {}

        if (await waitForPhotoSwipe(3000)) {
          noop('[DIAG] openGallery: First button succeeded via click()');
          markGalleryOpened();
          return true;
        }

        // 策略2: 如果第一个按钮失败，尝试主图片区域的按钮
        // 查找主图容器中的按钮
        const heroContainer = document.querySelector(
          '[class*="photo-header"], ' +
          '[class*="media-container"], ' +
          '[class*="gallery-container"], ' +
          '[data-testid="photo-gallery"]'
        );
        if (heroContainer) {
          const heroBtns = heroContainer.querySelectorAll('[aria-label*="view larger view of"]');
          if (heroBtns.length > 0) {
            const filteredHeroBtns = [...heroBtns].filter(btn => {
              const label = (btn.getAttribute('aria-label') || '').toLowerCase();
              return !/\b(3d|tour|video|floor\s*plan|floorplan|map|street\s*view|drone)\b/i.test(label);
            });
            if (filteredHeroBtns.length > 0) {
              noop('[DIAG] openGallery: Trying hero container buttons');
              for (const btn of filteredHeroBtns.slice(0, 2)) {
                const label = btn.getAttribute('aria-label') || '';
                noop('[DIAG] openGallery: Clicking hero button:', label.substring(0, 60));

                // 添加事件阻止器
                btn.addEventListener('click', stopNav, { capture: true, once: true });
                btn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                setTimeout(() => {
                  btn.removeEventListener('click', stopNav, { capture: true });
                }, 100);

                if (await waitForPhotoSwipe(2000)) {
                  markGalleryOpened();
                  return true;
                }
              }
            }
          }
        }
      }
    }

    // 如果 Zillow 特定策略都失败，尝试通用的 Strategy 1-3
    noop('[DIAG] openGallery: Zillow strategies exhausted, trying generic strategies');
  }

  // Strategy 1: Click first listing image
  noop('[DIAG] openGallery: Trying Strategy 1: clickFirstListingImage');
  if (await clickFirstListingImage()) {
    markGalleryOpened();
    return true;
  }

  // Strategy 2: Click gallery container
  noop('[DIAG] openGallery: Trying Strategy 2: clickGalleryContainer');
  if (await clickGalleryContainer()) {
    markGalleryOpened();
    return true;
  }

  // Strategy 3: Click button candidates
  noop('[DIAG] openGallery: Trying Strategy 3: button candidates');
  const hits = collectGalleryButtonCandidates();
  noop('[DIAG] openGallery: Found', hits.length, 'button candidates');
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
      markGalleryOpened();
      return true;
    }
  }

  noop('[DIAG] openGallery: All strategies failed, returning false');
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
 * Image request metadata tracking (for anti-detection).
 * Adds an artificial referer to make Zillow CDN requests look more natural.
 * Since we can't actually modify network requests from content script,
 * this adds metadata that can be logged and used for rate-limiting decisions.
 */
const _imageMetaLog = {
  count: 0,
  lastDomain: null,
};

function trackImageAccess(imageUrl) {
  try {
    const url = new URL(imageUrl);
    _imageMetaLog.count++;
    _imageMetaLog.lastDomain = url.hostname;
  } catch (_) {}
}

// Check if too many images from same domain in short window (anti-burst)
function shouldThrottleImages() {
  const log = getExtractionLog();
  const recentImages = _imageMetaLog.count;
  // If we've accessed more than 50 images in this extraction session, slow down
  if (recentImages > 50) {
    return true;
  }
  return false;
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
 * Success criteria: at least one .pswp__img with a valid src or currentSrc.
 */
async function waitForGalleryReady(timeoutMs = 2000) {
  const start = Date.now();
  let polls = 0;
  while (Date.now() - start < timeoutMs) {
    polls++;
    const pswp = document.querySelector('.pswp.pswp--open');
    if (!pswp) {
      await shortDelay(150, 400);
      continue;
    }
    const imgs = Array.from(pswp.querySelectorAll('.pswp__img'));
    for (const img of imgs) {
      const src = (img.currentSrc || img.src || '').trim();
      // Accept any non-empty src (http, blob, data)
      if (src && (src.startsWith('http') || src.startsWith('blob:') || src.startsWith('data:'))) {
        return { ready: true, pollCount: polls };
      }
    }
    await shortDelay(150, 400);
  }
  // Even if timeout, return true - gallery is open, just URL not ready yet
  return { ready: true, pollCount: polls };
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
async function waitForRealSlideChange(prevSnapshot, prevCurrIndex, timeoutMs = 6000) {
  const start = Date.now();
  let polls = 0;
  let lastSnapshot = prevSnapshot;
  const initialPrevSignature = prevSnapshot?.signature;

  while (Date.now() - start < timeoutMs) {
    polls++;
    await shortDelay(300, 800);

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
    } catch (err) {
    }
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
 * Close the PhotoSwipe gallery or Zillow StyledDialog if open.
 * Uses user-behavior simulation (click close button → ESC) for maximum compatibility.
 * Safe to call redundantly — does nothing if gallery is not open.
 * 
 * "先礼后兵" 策略：
 * 1. 优先让 Zillow 自己关闭（点击关闭按钮 + ESC）
 * 2. 延迟给 React 时间完成关闭流程
 * 3. 温和清理样式/类名（不用 .remove()）
 */
  // 全局标志：记录图库是否真正打开过（避免误关登录弹窗）
  let _galleryWasOpened = false;
  
  function markGalleryOpened() { _galleryWasOpened = true; }
  function markGalleryClosed() { _galleryWasOpened = false; }
  
  function closeGallery() {
    try {
      // ========== 安全检查：只有当图库真正打开过才关闭 ==========
      // 避免误关登录弹窗等非图片图库的 dialog
      if (!_galleryWasOpened) {
        return;
      }
      
      // ========== 温和恢复页面状态（兜底方案）==========
      // 只清理样式和 class，不删除 DOM 元素
      const gentleRestore = () => {
        // 恢复 body 滚动
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.paddingRight = '';
        
        // 恢复 html 滚动
        document.documentElement.style.overflow = '';
        document.documentElement.style.position = '';
        
        // 移除滚动锁定类
        document.body.classList.remove('modal-open', 'pswp--open', 'gallery-open', 'hdp-double-scroll-layout');
        document.documentElement.classList.remove('modal-open');
        
      };

      // ========== Zillow StyledDialog 处理 ==========
      // 关键：只关闭包含图片内容的 dialog（避免误关登录弹窗）
      if (isZillowPage()) {
        // 查找图库相关的 dialog（包含图片/照片相关元素的）
        const allDialogs = document.querySelectorAll('[class*="StyledDialog"], [role="dialog"]');
        let galleryDialog = null;
        
        for (const dialog of allDialogs) {
          // 检查是否是图库 dialog（有图片、照片墙等元素）
          const hasImages = dialog.querySelector('img') !== null;
          const hasPhotoText = dialog.textContent?.toLowerCase().includes('photo') ||
                              dialog.textContent?.toLowerCase().includes('图片');
          const hasMediaWall = dialog.querySelector('[class*="media-wall"], [class*="photo"], [class*="gallery"]') !== null;
          
          if (hasImages || hasPhotoText || hasMediaWall) {
            galleryDialog = dialog;
            break;
          }
        }
        
        if (galleryDialog) {

          // 1️⃣ 优先：找到并点击真正的关闭按钮
          const closeBtnSelectors = [
            'button[aria-label*="close" i]',
            'button[aria-label="Close"]',
            '[data-testid="modal-close"]',
            '[class*="StyledCloseButton"] button',
            '[class*="CloseButton"]',
            'button[class*="close"]',
          ];
          
          for (const sel of closeBtnSelectors) {
            const btn = galleryDialog.querySelector(sel);
            if (btn && btn.offsetParent !== null) { // 确保按钮可见
              btn.click();
              break;
            }
          }

          // 2️⃣ 补发 ESC 键事件（发送到 galleryDialog 而非 document，避免 Zillow 报错）
          setTimeout(() => {
            galleryDialog.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true
            }));
            galleryDialog.dispatchEvent(new KeyboardEvent('keyup', {
              key: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true
            }));
          }, 50);

          // 3️⃣ 延迟温和恢复（给 Zillow React 时间）
          setTimeout(() => {
            gentleRestore();
            markGalleryClosed();
          }, 400);
          
          return;
        }
      }

      // ========== PhotoSwipe 处理 ==========
      const pswpRoot = document.querySelector('.pswp.pswp--open');
      if (!pswpRoot) {
        // PhotoSwipe 也不存在，但检查是否需要恢复页面状态
        const bodyOverflowHidden = document.body.style.overflow === 'hidden' || 
                                 window.getComputedStyle(document.body).overflow === 'hidden';
        if (bodyOverflowHidden) {
          gentleRestore();
        }
        return;
      }


      // 1️⃣ Try clicking the close button
      const closeBtn = pswpRoot.querySelector('.pswp__button--close');
      if (closeBtn) {
        closeBtn.click();
      }

      // 2️⃣ Simulate ESC key（发送到 pswpRoot 而非 document）
      setTimeout(() => {
        if (pswpRoot) {
          pswpRoot.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true,
            })
          );
          pswpRoot.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      }, 50);

      // 3️⃣ Fallback: gentle restore after animation settles
      setTimeout(() => {
        gentleRestore();
        markGalleryClosed();
      }, 400);
    } catch (err) {
      // 即使出错也尝试温和恢复
      setTimeout(() => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.classList.remove('modal-open');
        markGalleryClosed();
      }, 100);
    }
  }

/**
 * NEW PhotoSwipe gallery extraction using signature-based approach.
 * Supports both PhotoSwipe and Zillow StyledDialog.
 *
 * @returns {Promise<string[]>} Deduplicated image URL array
 */
async function collectByPhotoSwipePaging() {
  if (_pagingLock) {
    noop('[DIAG] collectByPhotoSwipePaging: paging lock is held, returning empty');
    return [];
  }
  _pagingLock = true;

  const result = [];
  noop('[DIAG] collectByPhotoSwipePaging: starting');
  try {

    // ========== Zillow StyledDialog 处理 ==========
    const styledDialog = document.querySelector('[class*="StyledDialog"]');
    if (isZillowPage() && styledDialog) {
      noop('[DIAG] collectByPhotoSwipePaging: Zillow StyledDialog detected');
      // 主动切换到 Photos Tab（确保在正确的媒体类型）
      const switched = await switchToPhotosTab();
      if (!switched) {
      }
      const zillowImages = await extractGalleryImagesZillow();
      if (zillowImages.length > 0) {
        noop('[DIAG] collectByPhotoSwipePaging: Zillow images extracted:', zillowImages.length);
        _pagingLock = false;
        closeGallery();
        return zillowImages;
      }
    }

    // ========== 图库打开但元素选择器不匹配的处理 ==========
    // 当 body overflow 是 hidden 时，说明图库已打开
    // 但可能使用了非标准的类名，尝试从页面数据提取
    const bodyOverflowHidden = document.body.style.overflow === 'hidden' || 
                               window.getComputedStyle(document.body).overflow === 'hidden';
    if (isZillowPage() && bodyOverflowHidden) {
      
      // 尝试从页面数据提取
      const pageImages = await extractImagesFromPageDataZillow();
      if (pageImages.length > 0) {
        noop('[DIAG] collectByPhotoSwipePaging: Page data extracted:', pageImages.length, 'images');
        _pagingLock = false;
        closeGallery();
        return pageImages;
      }
      
      // 尝试从 DOM 中的任何可见图片提取
      const domImages = await extractGalleryImagesZillow();
      if (domImages.length > 0) {
        noop('[DIAG] collectByPhotoSwipePaging: DOM extraction got:', domImages.length, 'images');
        _pagingLock = false;
        closeGallery();
        return domImages;
      }
    }

    // ========== PhotoSwipe 处理 ==========
    const pswp = document.querySelector('.pswp.pswp--open');
    if (!pswp) {
      noop('[DIAG] collectByPhotoSwipePaging: PhotoSwipe not open, returning empty');
      return [];
    }
    noop('[DIAG] collectByPhotoSwipePaging: PhotoSwipe is open');

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
    noop('[DIAG] collectByPhotoSwipePaging: Starting main paging loop');
    const seenSignatures = new Set([firstSignature]);
    let totalAttempts = 0;
    const MAX_TOTAL = 60;
    const MAX_EXECUTION_TIME = 60000; // 最大执行时间 60 秒

    // 记录开始时间，用于超时检测
    const loopStartTime = Date.now();

    noop('[DIAG] collectByPhotoSwipePaging: Initial snapshot:', {
      isValid: initialSnapshot.isValid,
      hasSignature: !!initialSnapshot.signature,
      signature: initialSnapshot.signature?.substring(0, 20),
      strategy: initialSnapshot.strategy
    });

    while (totalAttempts < MAX_TOTAL) {
      // 检查是否超过最大执行时间
      const elapsedTime = Date.now() - loopStartTime;
      if (elapsedTime > MAX_EXECUTION_TIME) {
        noop('[DIAG] collectByPhotoSwipePaging: MAX_EXECUTION_TIME reached, exiting loop');
        break;
      }

      totalAttempts++;

      // Re-fetch pswpInfo each iteration (DOM may have changed)
      const pswpInfoNow = getPhotoSwipeInstance();
      const totalSlidesNow = pswpInfoNow?.totalSlides || 0;
      const prevCurrIndex = pswpInfoNow?.instance?.currIndex ?? 0;


      noop('[DIAG] collectByPhotoSwipePaging: Loop iteration', totalAttempts, '- pswpInfo:', {
        hasInstance: !!pswpInfoNow,
        totalSlides: totalSlidesNow,
        prevCurrIndex,
        // 检查 instance 上有哪些属性
        instanceType: pswpInfoNow?.instance ? typeof pswpInfoNow.instance : null,
        instanceKeys: pswpInfoNow?.instance ? Object.keys(pswpInfoNow.instance) : null,
        // 尝试直接访问可能的属性
        directCurrIndex: pswpInfoNow?.instance?.currIndex,
        directUid: pswpInfoNow?.uid,
        // 检查 pswpRoot
        pswpRootExists: !!document.querySelector('.pswp')
      });

      // 检查是否已经到了最后一张图，如果是则退出
      const isAtLastSlide = pswpInfoNow && totalSlidesNow > 0 &&
                            prevCurrIndex === totalSlidesNow - 1;
      if (isAtLastSlide) {
        noop('[DIAG] collectByPhotoSwipePaging: Already at last slide, exiting');
        break;
      }

      // Advance to next slide
      const advanceResult = advanceToNextSlide();
      noop('[DIAG] collectByPhotoSwipePaging: advanceToNextSlide result:', advanceResult);

      // Wait for slide to change — pass full snapshot (not result item)
      const waitResult = await waitForRealSlideChange(
        currentSnapshot,  // Always pass the current full snapshot
        prevCurrIndex,
        6000  // Increased timeout for slow connections
      );

      noop('[DIAG] collectByPhotoSwipePaging: waitResult:', {
        changed: waitResult.changed,
        reason: waitResult.reason,
        polls: waitResult.polls,
        newSignature: waitResult.newSnapshot?.signature?.substring(0, 20)
      });

      if (!waitResult.changed) {
        // 图片未变化，检查是否到了图库边界
        const pswpInfoNow = getPhotoSwipeInstance();
        const isAtLastSlide = pswpInfoNow && pswpInfoNow.totalSlides > 0 &&
                              pswpInfoNow.instance.currIndex === pswpInfoNow.totalSlides - 1;
        const isAtFirstSlide = pswpInfoNow && pswpInfoNow.instance.currIndex === 0;

        if (isAtLastSlide || isAtFirstSlide) {
          noop('[DIAG] collectByPhotoSwipePaging: At gallery boundary (timeout), exiting');
          break;
        }
        // 否则继续等待
        continue;
      }

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
        // 检查是否到了图库边界（第一张或最后一张）
        const pswpInfoNow = getPhotoSwipeInstance();
        const isAtLastSlide = pswpInfoNow && pswpInfoNow.totalSlides > 0 &&
                              pswpInfoNow.instance.currIndex === pswpInfoNow.totalSlides - 1;
        const isAtFirstSlide = pswpInfoNow && pswpInfoNow.instance.currIndex === 0;

        // 如果到了边界，视为收集完成
        if (isAtLastSlide || isAtFirstSlide) {
          noop('[DIAG] collectByPhotoSwipePaging: At gallery boundary, exiting');
          break;
        }
        // 否则可能是加载延迟，继续等待
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


// ============================================================================
// Zillow Gallery Extraction Upgrade - 4 collector types + page scope detection
// ============================================================================

// 结果状态
const GALLERY_RESULT_STATUS = {
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  FAILED: 'failed'
};

// 图库类型
// 注：ZILLOW_MEDIA_CAROUSEL / ZILLOW_VERTICAL_MEDIA_WALL / ZILLOW_BUILDING_GALLERY /
// ZILLOW_UNIT_CAROUSEL 是当前 production 已分别实测通过的 collector。
// ZILLOW_IMX_LIGHTBOX / ZILLOW_PHOTOSWIPE 是历史 Property 页面已经实测通过的兼容路径，
// 本轮恢复它们的独立 detection，避免和现有 4 collector 互相覆盖。
const GALLERY_TYPES = {
  ZILLOW_MEDIA_CAROUSEL: 'zillow_media_carousel',
  ZILLOW_VERTICAL_MEDIA_WALL: 'zillow_vertical_media_wall',
  ZILLOW_BUILDING_GALLERY: 'zillow_building_gallery',
  ZILLOW_UNIT_CAROUSEL: 'zillow_unit_carousel',
  ZILLOW_IMX_LIGHTBOX: 'zillow_imx_lightbox',
  ZILLOW_PHOTOSWIPE: 'zillow_photoswipe'
};

// 页面范围
const PAGE_SCOPES = {
  PROPERTY: 'property',
  BUILDING: 'building',
  UNIT: 'unit'
};

// 识别当前页面范围
// Unit 优先从 hash 识别，Building 使用 pathname，Property 使用 zpid
function detectZillowPageScope() {
  const hash = window.location.hash;
  const pathname = window.location.pathname;

  // Unit: URL 含 #udpLightbox-{unitId}-mmlb-{index}
  const unitHashMatch = hash.match(/#udpLightbox-(\d+)-mmlb-/);
  if (unitHashMatch) {
    return {
      scope: PAGE_SCOPES.UNIT,
      unitId: unitHashMatch[1],
      buildingId: null,
      zpid: null
    };
  }

  // Building: /apartments/... 路径（使用 pathname 避免 query string 干扰）
  const buildingMatch = pathname.match(/^\/apartments\/.+\/([A-Za-z0-9_-]+)\/?$/);
  if (buildingMatch) {
    return {
      scope: PAGE_SCOPES.BUILDING,
      buildingId: buildingMatch[1],
      unitId: null,
      zpid: null
    };
  }

  // Property: /homedetails/ 或包含 zpid 的路径
  const zpidMatch = window.location.href.match(/(\d+)_zpid/);
  if (zpidMatch) {
    return {
      scope: PAGE_SCOPES.PROPERTY,
      zpid: zpidMatch[1],
      buildingId: null,
      unitId: null
    };
  }

  // 默认按 Property 处理
  return {
    scope: PAGE_SCOPES.PROPERTY,
    zpid: null,
    buildingId: null,
    unitId: null
  };
}

// 查找可见元素（尺寸>0, 可见, 中心点命中）
function findVisibleElement(selector) {
  const candidates = document.querySelectorAll(selector);
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && (hit === el || el.contains(hit))) {
      return el;
    }
  }
  return null;
}

// 查找 IMX Lightbox root（严格 root identity，不依赖 Next photo）
// 历史实测 selector: #search-detail-lightbox / .imx-lightbox / .imx-lightbox-modal
//
// 重要：#search-detail-lightbox 在新版本中是一个包含整个页面模块的大外壳，
// 内部同时存在 details-page-container / similar-homes-module / market-value-module
// / 普通页面 carousel / 各种页面按钮，最后才是真正可见的 gallery dialog。
// 因此仅凭"#search-detail-lightbox 可见 + 内部任意位置有 /fp/ 图片" 不再可信。
//
// 为了防止 outer shell 抢占 inner gallery structure，本函数收窄为：
//   - 真实 `.imx-lightbox` / `.imx-lightbox-modal` 优先（这些是真正的 lightbox 容器）
//   - 真实 IMX paging controls：root 内可见 `button[aria-label="Next photo"]`
//     以及严格 counter "^\d+\s+of\s+\d+$"
//   - 仅当以上条件同时满足，才返回；否则返回 null（让 detection 走更具体的
//     vertical / media-carousel / PhotoSwipe 路径，避免误分类）。
function findVisibleImxLightbox() {
  // 真实 IMX 容器优先（这些是 Zillow IMX lightbox 的强信号）
  const strongSelectors = [
    '.imx-lightbox-modal',
    '.imx-lightbox'
  ];
  for (const sel of strongSelectors) {
    const candidates = document.querySelectorAll(sel);
    for (const el of candidates) {
      if (!el || !el.isConnected) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // 必须存在真实图片元素
      const hasImage =
        el.querySelector('img[src*="fp/"]') ||
        el.querySelector('picture img') ||
        el.querySelector('[class*="Lightbox-image"], [class*="lightbox-image"]');
      if (!hasImage) continue;
      // 还需要 root-local paging controls 才算真正 IMX paging gallery
      const hasPaging =
        el.querySelector('button[aria-label="Next photo"]') ||
        el.querySelector('button[aria-label*="Next" i]');
      if (!hasPaging) continue;
      return el;
    }
  }

  // #search-detail-lightbox 本身只是一个大的页面/lightbox 外壳，不能直接当 IMX。
  // 真实 IMX lightbox 才会同时具备 strongSelector 之一；这里不再把 #search-detail-lightbox
  // 单独作为最终分类来源。如果未来 Zillow 把 IMX 容器换名，这里也保持稳定拒绝。
  return null;
}

// 查找 PhotoSwipe root（严格 root identity，不依赖 Next photo）
// 历史实测 selector: .pswp.pswp--open / .pswp--open / [class*="PhotoSwipe"]
function findVisiblePhotoSwipe() {
  const candidates = document.querySelectorAll(
    '.pswp.pswp--open, .pswp--open, [class*="PhotoSwipe"]'
  );
  for (const el of candidates) {
    if (!el) continue;
    if (!el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    // 必须有可见的真实图片元素，仅仅是 pswp 占位不算打开
    const pswpImgs = el.querySelectorAll('.pswp__img, img[src*="fp/"]');
    let hasReal = false;
    for (const img of pswpImgs) {
      const src = (img.currentSrc || img.src || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      const r = img.getBoundingClientRect();
      if (r.width <= 24 || r.height <= 24) continue;
      hasReal = true;
      break;
    }
    if (hasReal) return el;
  }
  return null;
}

// 查找 Unit dialog
function findVisibleUnitGalleryDialog() {
  const hashMatch = window.location.hash.match(/#udpLightbox-(\d+)-mmlb-/);
  if (!hashMatch) return null;

  const unitId = hashMatch[1];
  const dialogs = document.querySelectorAll('[role="dialog"]');

  for (const dialog of dialogs) {
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const imgs = dialog.querySelectorAll('img[src*="fp/"]');
    if (imgs.length > 0) return dialog;
  }
  return null;
}

// 查找 Building dialog
function findVisibleBuildingGalleryDialog() {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dialog of dialogs) {
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const imgs = dialog.querySelectorAll('img[src*="fp/"]');
    if (imgs.length > 0) return dialog;
  }
  return null;
}

// 提取 Zillow 图片 hash
function canonicalizeZillowPhoto(url) {
  if (!url) return null;
  const match = String(url).match(/\/fp\/([a-f0-9]+)/i);
  return match ? `zillow:${match[1].toLowerCase()}` : null;
}

// 解析 opener 按钮文本中的照片数量
// 支持: "See all 22 photos", "See all photos (16)", "22 photos"
function parsePhotoTotal(text) {
  const value = String(text || '');

  // 数字在 photos 前面: "See all 22 photos"
  const before = value.match(/(\d+)\s+photos?/i);
  if (before) return Number(before[1]);

  // 数字在 photos 后面: "See all photos (16)"
  const after = value.match(/photos?\s*\(\s*(\d+)\s*\)/i);
  if (after) return Number(after[1]);

  return null;
}

// 带坐标点击（使用实测成功的完整事件参数）
function clickWithCoordinates(element) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return;

  hit.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: x,
    clientY: y
  }));
  hit.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    buttons: 1,
    clientX: x,
    clientY: y
  }));
  hit.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    clientX: x,
    clientY: y
  }));
  hit.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    clientX: x,
    clientY: y
  }));
}

// 确保图库打开按钮在视口内可见
async function ensureGalleryOpenerInView() {
  if (window.scrollY > 100) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    await shortDelay(300, 500);
  }
  // Also reset Zillow's real scroll container (`.layout-container-desktop`).
  // The viewport can be at top while the Zillow layout container is still
  // scrolled down, which makes `findVisibleElement()`'s elementFromPoint hit
  // test fail and returns `gallery_not_opened`. Independent threshold (> 0)
  // to avoid masking the window.scrollY check above.
  const layoutContainer = document.querySelector('.layout-container-desktop');
  if (layoutContainer && layoutContainer.scrollTop > 0
      && typeof layoutContainer.scrollTo === 'function') {
    layoutContainer.scrollTo({ top: 0, behavior: 'auto' });
    await shortDelay(150, 250);
  }
}

// 等待可见的 Photos 标签
async function waitForVisiblePhotosTab(timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const candidates = document.querySelectorAll('[data-testid="persistent-tab-photos"]');
    for (const tab of candidates) {
      const rect = tab.getBoundingClientRect();
      const style = getComputedStyle(tab);
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      if (hit && (hit === tab || tab.contains(hit))) {
        return tab;
      }
    }
    await shortDelay(100, 200);
  }
  return null;
}

// One-shot gallery opener diagnostics. Captures candidate presence, rect,
// One-shot failure diagnostics for openGalleryForScope()'s two
// opened:false paths. Goal: classify the failure as one of:
//   1. selector does not exist in DOM at all
//   2. selector exists but is hidden (display/visibility/zero rect)
//   3. selector exists but elementFromPoint cannot hit it
//   4. Zillow has introduced a new photo/gallery opener (detected via nearbyCandidates)
//   5. lazy mount / inner scroll container mis-positioned
// This function is observational only — it never alters the result of
// findVisibleElement() or clickWithCoordinates(), and it never influences
// collector / paging / dedup / image-count logic.
function hsLogGalleryOpenFail(scope, attemptedSelectors) {
  try {
    const safeAttr = (el, name) => {
      try {
        return el.getAttribute ? (el.getAttribute(name) || null) : null;
      } catch (_) {
        return null;
      }
    };
    const safeText = (el) => {
      try {
        return (el && el.textContent ? el.textContent : '').trim().slice(0, 60) || null;
      } catch (_) {
        return null;
      }
    };
    const safeCls = (el) => {
      try {
        return (typeof el.className === 'string' ? el.className : '').trim().slice(0, 80) || null;
      } catch (_) {
        return null;
      }
    };

    const diagnostic = {
      phase: 'open_gallery_failed',
      scope: scope || null,
      url: (function () { try { return window.location ? window.location.href : null; } catch (_) { return null; } })(),
      scrollY: (function () { try { return window.scrollY || 0; } catch (_) { return 0; } })(),
      readyState: (function () { try { return document.readyState || null; } catch (_) { return null; } })(),
      historyLength: (function () { try { return window.history ? window.history.length : null; } catch (_) { return null; } })(),
      layoutDesktopScrollTop: (function () {
        try {
          const c = document.querySelector('.layout-container-desktop');
          return c ? (c.scrollTop || 0) : null;
        } catch (_) { return null; }
      })(),
    };

    if (Array.isArray(attemptedSelectors)) {
      for (const sel of attemptedSelectors) {
        const bucket = { allCount: 0, items: [] };
        try {
          const all = document.querySelectorAll(sel);
          bucket.allCount = all.length;
          for (const el of all) {
            try {
              const rect = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const hit = document.elementFromPoint(cx, cy);
              const hitIsSelf = hit ? (hit === el || el.contains(hit)) : false;
              bucket.items.push({
                tag: el.tagName ? el.tagName.toLowerCase() : null,
                id: el.id || null,
                cls: safeCls(el),
                ariaLabel: safeAttr(el, 'aria-label'),
                dataTestId: safeAttr(el, 'data-testid'),
                text: safeText(el),
                rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                isConnected: !!el.isConnected,
                pointHitTag: hit ? (hit.tagName ? hit.tagName.toLowerCase() : null) : null,
                pointHitIsSelf: hitIsSelf,
              });
            } catch (_) { /* per-element failures are non-fatal */ }
          }
        } catch (_) { /* selector iteration failures are non-fatal */ }
        try {
          diagnostic[sel] = bucket;
        } catch (_) {
          diagnostic['__selector_key_error__'] = sel;
        }
      }
    }

    // Nearby photo/gallery opener candidates. Used to surface a new Zillow
    // selector that the current code does not yet recognise.
    try {
      const nearby = document.querySelectorAll(
        'button, [role="button"], [data-testid*="photo" i], [data-testid*="gallery" i], [aria-label*="photo" i]'
      );
      diagnostic.nearbyCandidates = [];
      for (const el of nearby) {
        try {
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) continue;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          diagnostic.nearbyCandidates.push({
            tag: el.tagName ? el.tagName.toLowerCase() : null,
            id: el.id || null,
            cls: safeCls(el),
            dataTestId: safeAttr(el, 'data-testid'),
            ariaLabel: safeAttr(el, 'aria-label'),
            text: safeText(el),
            rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
          });
          if (diagnostic.nearbyCandidates.length >= 20) break;
        } catch (_) { /* per-element failures are non-fatal */ }
      }
    } catch (_) {
      diagnostic.nearbyCandidates = [];
    }

  } catch (_) {
    /* diagnostics must never throw */
  }
}

async function openGalleryForScope(pageContext) {
  // Unit: hash 可能先更新，dialog 后挂载。等待 dialog 出现，不立即返回 opened:false
  if (pageContext.scope === PAGE_SCOPES.UNIT) {
    const timeout = 5000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const dialog = findVisibleUnitGalleryDialog();
      if (dialog) {
        markGalleryOpened();
        return { opened: true, expectedTotal: null };
      }
      await shortDelay(100, 200);
    }
    markGalleryOpened();
    return { opened: true, expectedTotal: null };
  }

  // Building: 先滚回顶部，再查找 opener
  if (pageContext.scope === PAGE_SCOPES.BUILDING) {
    await ensureGalleryOpenerInView();
    const opener = findVisibleElement('button[data-testid="photos-label"]');
    const expectedTotal = parsePhotoTotal(opener?.textContent);
    if (opener) {
      clickWithCoordinates(opener);
      await shortDelay(200, 300);
      markGalleryOpened();
      return { opened: true, expectedTotal };
    }

    // Fallback (Building-only): photos-label 在某些 building 详情页不可见，
    // 改用 hollywood-gallery-images 容器内"view larger view of the …photo of this building"
    // 入口按钮打开图库。先在容器内查，再退到全页面查。
    const buildingViewLargerSelector =
      'button[aria-label^="view larger view of the "][aria-label*="photo of this building"]';
    const buildingViewLargerInGallerySelector =
      '[data-testid="hollywood-gallery-images"] ' + buildingViewLargerSelector;
    const buildingFallbackSelector =
      findVisibleElement(buildingViewLargerInGallerySelector)
      || findVisibleElement(buildingViewLargerSelector);
    if (buildingFallbackSelector) {
      clickWithCoordinates(buildingFallbackSelector);
      await shortDelay(200, 300);
      markGalleryOpened();
      return { opened: true, expectedTotal: null };
    }

    return { opened: false, expectedTotal: null };
  }

  // Property: 新版入口需要两步
  if (pageContext.scope === PAGE_SCOPES.PROPERTY) {
    await ensureGalleryOpenerInView();

    const newEntry = findVisibleElement(
      'button[aria-label^="Open photo slideshow at photo "]'
    );
    if (newEntry) {
      clickWithCoordinates(newEntry);
      const photosTab = await waitForVisiblePhotosTab(5000);
      if (photosTab) {
        const preTab = photosTab;
        const tabRect = photosTab.getBoundingClientRect();
        const tabHit = document.elementFromPoint(tabRect.left + tabRect.width / 2, tabRect.top + tabRect.height / 2);
        clickWithCoordinates(photosTab);
        await shortDelay(200, 300);
        markGalleryOpened();
        return { opened: true, expectedTotal: null };
      }
      await shortDelay(200, 300);
      markGalleryOpened();
      return { opened: true, expectedTotal: null };
    }

    const oldEntry = findVisibleElement(
      'button[data-testid="gallery-see-all-photos-button"]'
    );
    if (oldEntry) {
      clickWithCoordinates(oldEntry);
      await shortDelay(200, 300);
      const expectedTotal = parsePhotoTotal(oldEntry.textContent);
      markGalleryOpened();
      return { opened: true, expectedTotal };
    }

  }

  return { opened: false, expectedTotal: null };
}

function detectZillowGallery(pageContext) {
  // Unit 只能识别 Unit，不穿透
  if (pageContext.scope === PAGE_SCOPES.UNIT) {
    const root = findVisibleUnitGalleryDialog();
    return root
      ? { galleryType: GALLERY_TYPES.ZILLOW_UNIT_CAROUSEL, root }
      : { galleryType: null, root: null };
  }

  // Building 只能识别 Building，不穿透
  if (pageContext.scope === PAGE_SCOPES.BUILDING) {
    const root = findVisibleBuildingGalleryDialog();
    return root
      ? { galleryType: GALLERY_TYPES.ZILLOW_BUILDING_GALLERY, root }
      : { galleryType: null, root: null };
  }

  // Property 优先级：先识别具体内部 structure，避免被模糊外壳抢占。
  //
  // 原则：明确的内部 gallery structure > 外层 modal/root 名称 > 行为能力 fallback。
  // 具体顺序：
  //   1) Vertical Media Wall：明确 `[data-testid="hollywood-vertical-media-wall"]`
  //      且内部存在当前 listing 的 `/fp/` 图片 + 可见 vertical/scroll capability。
  //   2) Media Carousel：明确 `[data-testid="media-carousel"][aria-label="photo-carousel"]`
  //      且内部存在 carousel item 图片与局部 carousel controls。
  //   3) PhotoSwipe：真实 `.pswp.pswp--open` / `.pswp--open` 等真实 paging gallery 结构。
  //   4) IMX Lightbox：必须具备 `.imx-lightbox` / `.imx-lightbox-modal` 等真实 lightbox 容器
  //      且具备 root-local paging controls；不能仅凭 `#search-detail-lightbox` 外壳分类。
  //   5) 行为能力 fallback：只在能定位一个明确的 Gallery dialog context 且能证明 vertical/scroll
  //      capability 时才进入 Vertical；只在能证明 paging capability 时才进入 paging 类型。
  //   6) 仍无法证明行为类型 → unknown，不默认 collector。

  // 1) Vertical Media Wall（具体内部 structure，必须早于 IMX 外壳）
  const verticalWall = findVisibleElement(
    '[data-testid="hollywood-vertical-media-wall"]'
  );
  if (verticalWall && hasVerticalWallCapability(verticalWall)) {
    return { galleryType: GALLERY_TYPES.ZILLOW_VERTICAL_MEDIA_WALL, root: verticalWall };
  }

  // 2) 新版 Media Carousel
  const mediaCarousel = findVisibleElement(
    '[data-testid="media-carousel"][aria-label="photo-carousel"]'
  );
  if (mediaCarousel && hasMediaCarouselCapability(mediaCarousel)) {
    return { galleryType: GALLERY_TYPES.ZILLOW_MEDIA_CAROUSEL, root: mediaCarousel };
  }

  // 3) PhotoSwipe：必须存在真实 active slide 与 paging structure
  const pswpRoot = findVisiblePhotoSwipe();
  if (pswpRoot && hasPhotoSwipePagingCapability(pswpRoot)) {
    return { galleryType: GALLERY_TYPES.ZILLOW_PHOTOSWIPE, root: pswpRoot };
  }

  // 4) IMX Lightbox：findVisibleImxLightbox() 已收紧为真实 lightbox 容器 + root-local paging controls
  const imxRoot = findVisibleImxLightbox();
  if (imxRoot) {
    return { galleryType: GALLERY_TYPES.ZILLOW_IMX_LIGHTBOX, root: imxRoot };
  }

  // 5) 行为能力 fallback：尝试在一个明确的 Gallery dialog 内证明 vertical/scroll capability
  const dialogVertical = findGalleryDialogWithVerticalCapability();
  if (dialogVertical) {
    return {
      galleryType: GALLERY_TYPES.ZILLOW_VERTICAL_MEDIA_WALL,
      root: dialogVertical
    };
  }

  return { galleryType: null, root: null };
}

// 判断一个 vertical wall candidate 是否真正具备 vertical/scroll gallery 行为能力
// 不能仅凭 testid，必须存在当前 listing 的 /fp/ 图片以及真实可滚动结构。
function hasVerticalWallCapability(candidate) {
  if (!candidate || !candidate.isConnected) return false;
  // 当前 listing 的 /fp/ 图片
  const imgs = candidate.querySelectorAll('img[src*="fp/"]');
  let hasRealFp = false;
  for (const img of imgs) {
    const src = (img.currentSrc || img.src || '').trim();
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    const r = img.getBoundingClientRect();
    if (r.width <= 24 || r.height <= 24) continue;
    hasRealFp = true;
    break;
  }
  if (!hasRealFp) return false;

  // vertical/scroll capability：candidate 自身或其可滚动祖先具备 overflow-y=auto/scroll
  // 且 scrollHeight > clientHeight（多张图片需要滚动加载）
  const scrollable = findScrollableParent(candidate) || candidate;
  const style = getComputedStyle(scrollable);
  const isScrollable =
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    scrollable.scrollHeight > scrollable.clientHeight + 50;
  // 即便当前 scrollHeight 尚未明显大于 clientHeight（首屏前几张尚未触发滚动），
  // 只要 ancestor 是 vertical 容器 + 已有多张 /fp/ 图片，仍视为具备能力。
  const hasVerticalStructure =
    isScrollable ||
    candidate.matches('[data-testid="hollywood-vertical-media-wall"]') ||
    !!candidate.querySelector('[data-testid="styled-vertical-media-wall"]');
  return hasVerticalStructure;
}

// 判断一个 media-carousel candidate 是否真正具备 paging gallery 行为能力
function hasMediaCarouselCapability(candidate) {
  if (!candidate || !candidate.isConnected) return false;
  // 存在 carousel item 图片
  const items = candidate.querySelectorAll('[data-testid="carousel-item-li"]');
  if (items.length === 0) {
    // 退化检查：存在可见 /fp/ 图片
    const imgs = candidate.querySelectorAll('img[src*="fp/"]');
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      if (r.width > 24 && r.height > 24) return true;
    }
    return false;
  }
  return true;
}

// 判断一个 PhotoSwipe root 是否真正具备 paging gallery 行为能力
function hasPhotoSwipePagingCapability(pswpRoot) {
  if (!pswpRoot || !pswpRoot.isConnected) return false;
  // findVisiblePhotoSwipe() 已要求有真实 .pswp__img 或 /fp/ 图片
  // 再加一道：root 内存在 PhotoSwipe paging controls（arrow / button / counter）
  const hasControl =
    pswpRoot.querySelector('.pswp__button--arrow--right') ||
    pswpRoot.querySelector('.pswp__button--arrow--next') ||
    pswpRoot.querySelector('[class*="pswp__button"]') ||
    pswpRoot.querySelector('button[aria-label*="Next" i]') ||
    pswpRoot.querySelector('button[aria-label*="next" i]');
  return !!hasControl;
}

// 在所有可见 dialog 中找一个具备 vertical/scroll capability 的 dialog。
// 用于 behavior fallback：明确 dialog context 内确实存在垂直滚动结构 + /fp/ 图片。
function findGalleryDialogWithVerticalCapability() {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const dialog of dialogs) {
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    // 必须存在当前 listing 的 /fp/ 图片
    const imgs = dialog.querySelectorAll('img[src*="fp/"]');
    let hasRealFp = false;
    for (const img of imgs) {
      const src = (img.currentSrc || img.src || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      const r = img.getBoundingClientRect();
      if (r.width <= 24 || r.height <= 24) continue;
      hasRealFp = true;
      break;
    }
    if (!hasRealFp) continue;
    // 必须包含 vertical wall 结构或可滚动 ancestor
    // Contract: collectZillowVerticalWall() 要求 root === mediaWall。
    // 当 dialog 内存在具体 hollywood-vertical-media-wall 节点时，
    // 必须返回该 wall 节点本身，而不是 dialog；否则 collector 拿到 dialog
    // 会再次进入 root contract mismatch（reached_bottom / no_scroll_container）。
    const wallNode = dialog.querySelector('[data-testid="hollywood-vertical-media-wall"]');
    if (wallNode && wallNode.isConnected) {
      const wRect = wallNode.getBoundingClientRect();
      if (wRect.width > 0 && wRect.height > 0) {
        return wallNode;
      }
    }
    const styledWall = dialog.querySelector('[data-testid="styled-vertical-media-wall"]');
    if (styledWall && styledWall.isConnected) {
      const wallRoot = styledWall.closest('[data-testid="hollywood-vertical-media-wall"]')
        || styledWall.closest('[role="dialog"]')
        || styledWall;
      const sRect = wallRoot.getBoundingClientRect();
      if (sRect.width > 0 && sRect.height > 0) {
        return wallRoot;
      }
    }
    // 仅 generic scroll 行为且无 concrete wall root：拒绝作为 Vertical Media Wall root，
    // 由 detectZillowGallery() 走 unknown 分支，避免把 dialog 喂进 collector。
    const scrollable = findScrollableParent(dialog);
    if (scrollable && scrollable.scrollHeight > scrollable.clientHeight + 50) {
      return null;
    }
  }
  return null;
}

async function waitForZillowGallery(pageContext, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const detected = detectZillowGallery(pageContext);

    if (detected.galleryType && detected.root) {
      return detected;
    }

    await shortDelay(100, 200);
  }

  return { galleryType: null, root: null };
}

// ─── Media Carousel Collector ───
//
// Two-root model:
//   - imageRoot = detected.root = the [data-testid="media-carousel"] element.
//     Strictly used to collect `<picture>/<img>` URLs from `[data-testid="carousel-item-li"]`.
//   - controlRoot = shallowest ancestor of imageRoot that contains BOTH
//     a visible `button[aria-label="Next photo"]` AND a visible element
//     whose textContent strictly matches the counter regex. Used to read
//     the counter and locate the Next/Previous photo buttons.
//
// Hard constraints:
//   - controlRoot resolution never returns `document.body`, `documentElement`,
//     or `document`. It never traverses the whole document to find a counter.
//   - Image URL collection is strictly scoped to imageRoot to avoid mixing in
//     Floor Plan / similar listings / other carousels.
//   - Each paging iteration re-checks `imageRoot.isConnected` and
//     `controlRoot.isConnected`; if either is detached, re-runs
//     `detectZillowGallery(context)` and re-resolves controlRoot.
async function collectZillowMediaCarousel(root, context) {
  // Strict counter text regex (must be declared before any helper call;
  // TDZ otherwise throws on the first findControlRoot/getCarouselCounter use).
  // Matches "1 of 51", "Photo 1 of 51", "1 / 51" — anchored so only the
  // actual counter element (whose own textContent equals the counter) matches.
  const ZILLOW_COUNTER_TEXT_RE = /^(?:Photo\s*)?\d+\s*(?:of|\/)\s*\d+$/i;

  let imageRoot = root;
  let controlRoot = findControlRoot(imageRoot);

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  // Walk up from imageRoot looking for the shallowest ancestor that contains:
  //   - a visible button[aria-label="Next photo"]
  //   - a visible element whose textContent strictly matches ZILLOW_COUNTER_TEXT_RE
  // Returns the matching ancestor, or null. Never returns body / html / document.
  function findControlRoot(imgRoot) {
    if (!imgRoot || !imgRoot.isConnected) return null;
    let el = imgRoot.parentElement;
    while (el) {
      if (el === document.body || el === document.documentElement || el === document) {
        return null;
      }
      let hasVisibleNext = false;
      const nextButtons = el.querySelectorAll('button[aria-label="Next photo"]');
      for (const btn of nextButtons) {
        if (isVisibleElement(btn)) { hasVisibleNext = true; break; }
      }
      if (!hasVisibleNext) { el = el.parentElement; continue; }
      let hasVisibleCounter = false;
      const candidates = el.querySelectorAll('*');
      for (const cand of candidates) {
        if (!isVisibleElement(cand)) continue;
        const t = (cand.textContent || '').replace(/\s+/g, ' ').trim();
        if (ZILLOW_COUNTER_TEXT_RE.test(t)) { hasVisibleCounter = true; break; }
      }
      if (hasVisibleCounter) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Robust counter reader (strict regex):
  // - Scoped to controlRoot (no document-wide traversal)
  // - Inspects textContent / aria-label / title
  // - Accepts "1 of 51", "1 / 51", "Photo 1 of 51"
  function parseCounterFromText(rawText) {
    const normalized = String(rawText == null ? '' : rawText).replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    if (!ZILLOW_COUNTER_TEXT_RE.test(normalized)) return null;
    const nums = normalized.match(/(\d+)/g);
    if (!nums || nums.length < 2) return null;
    const current = Number(nums[0]);
    const total = Number(nums[1]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
    return { current, total, raw: normalized };
  }

  // Reads the counter from controlRoot (NOT imageRoot).
  // Leaf-ish heuristic avoids parent-of-counter noise.
  function getCarouselCounter(ctrlRoot) {
    if (!ctrlRoot) return null;

    // 1) Direct descendants (leaf-ish)
    const candidates = ctrlRoot.querySelectorAll('*');
    for (const el of candidates) {
      let hasDescendantMatch = false;
      for (const child of el.children) {
        if (parseCounterFromText(child.textContent)) { hasDescendantMatch = true; break; }
      }
      const own = parseCounterFromText(el.textContent);
      if (own && !hasDescendantMatch) return own;
    }

    // 2) Fallback: aria-label / title
    for (const el of candidates) {
      const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
      if (ariaLabel) {
        const parsed = parseCounterFromText(ariaLabel);
        if (parsed) return parsed;
      }
      const title = el.getAttribute && el.getAttribute('title');
      if (title) {
        const parsed = parseCounterFromText(title);
        if (parsed) return parsed;
      }
    }

    return null;
  }

  // Poll up to 5s for controlRoot resolution + counter to appear (interval 150–250ms).
  const COUNTER_POLL_TIMEOUT_MS = 5000;
  const COUNTER_POLL_MIN_MS = 150;
  const COUNTER_POLL_MAX_MS = 250;

  let initialCounter = null;
  const counterPollStart = Date.now();
  while (Date.now() - counterPollStart < COUNTER_POLL_TIMEOUT_MS) {
    if (!controlRoot || !controlRoot.isConnected) {
      controlRoot = findControlRoot(imageRoot);
    }
    if (controlRoot) {
      initialCounter = getCarouselCounter(controlRoot);
      if (initialCounter) break;
    }
    await shortDelay(COUNTER_POLL_MIN_MS, COUNTER_POLL_MAX_MS);
  }

  if (!initialCounter) {
    noop('[DIAG] collectZillowMediaCarousel: counter not found within', COUNTER_POLL_TIMEOUT_MS, 'ms');
  }

  const expectedTotal = initialCounter?.total || null;
  const startIndex = initialCounter?.current || 1;
  const maxAttempts = (expectedTotal || 50) + 2;

  const seenSignatures = new Set();
  const images = [];

  // Image URL collection is strictly scoped to imageRoot.
  const collectAllCarouselImages = () => {
    if (!imageRoot || !imageRoot.isConnected) return;
    const items = imageRoot.querySelectorAll(
      '[data-testid="carousel-item-li"] img, ' +
      '[data-testid="carousel-item-li"] source'
    );
    for (const item of items) {
      const src = item.src || item.srcset?.split(',')?.pop()?.trim()?.split(' ')[0];
      if (!src) continue;
      const signature = canonicalizeZillowPhoto(src);
      if (signature && !seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        images.push({ index: images.length + 1, url: src, signature });
      }
    }
  };

  const waitForCounterChange = (prevCounter, timeoutMs = 3000) => {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const current = getCarouselCounter(controlRoot);
        if (!current) {
          if (Date.now() - start > timeoutMs) resolve(false);
          else setTimeout(check, 100);
          return;
        }
        if (!prevCounter || current.current !== prevCounter.current) {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  collectAllCarouselImages();

  // Next/Previous photo buttons come from controlRoot, never from imageRoot.
  let nextBtn = (controlRoot && controlRoot.isConnected)
    ? controlRoot.querySelector('button[aria-label="Next photo"]')
    : null;
  let failedMoves = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (expectedTotal && seenSignatures.size >= expectedTotal) {
      break;
    }

    // Re-check connection each iteration; re-resolve if either root detached.
    if (!imageRoot.isConnected || !controlRoot || !controlRoot.isConnected) {
      const reDetected = detectZillowGallery(context);
      if (!reDetected || !reDetected.root || reDetected.galleryType !== GALLERY_TYPES.ZILLOW_MEDIA_CAROUSEL) {
        break;
      }
      imageRoot = reDetected.root;
      controlRoot = findControlRoot(imageRoot);
      if (!controlRoot) break;
      nextBtn = controlRoot.querySelector('button[aria-label="Next photo"]');
      if (!nextBtn) break;
    }

    const prevCounter = getCarouselCounter(controlRoot);

    if (!nextBtn) break;
    clickWithCoordinates(nextBtn);

    const changed = await waitForCounterChange(prevCounter);

    collectAllCarouselImages();

    if (!changed) {
      failedMoves++;
      if (failedMoves >= 1) break;
    } else {
      failedMoves = 0;
    }

    const currentCounter = getCarouselCounter(controlRoot);
    if (currentCounter && currentCounter.current === startIndex && seenSignatures.size < (expectedTotal || 0)) {
      break;
    }
  }

  return {
    status: null,
    expectedTotal,
    images,
    _counterText: initialCounter?.raw ?? null,
    _imageRootConnected: !!(imageRoot && imageRoot.isConnected),
    _controlRootConnected: !!(controlRoot && controlRoot.isConnected)
  };
}

// ─── Vertical Wall Collector ───
function findScrollableParent(element) {
  let current = element.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (current.scrollHeight > current.clientHeight &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

async function collectZillowVerticalWall(root, context, expectedTotal) {
  const mediaWall = root;

  const verticalDiag = (event, fields) => {
    try {
      const payload = Object.assign({ event }, fields);
    } catch (_) {}
  };

  const diagRootInfo = () => ({
    rootConnected: !!(mediaWall && mediaWall.isConnected),
    rootTestid: mediaWall ? mediaWall.getAttribute('data-testid') : null
  });

  const diagContainerInfo = (el) => {
    if (!el) {
      return { scrollContainer: null };
    }
    let style;
    try { style = getComputedStyle(el); } catch (_) { style = null; }
    return {
      scrollContainerId: el.id || null,
      scrollContainerTestid: el.getAttribute ? el.getAttribute('data-testid') : null,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: style ? style.overflowY : null
    };
  };

  let stopReason = 'unknown';
  let loopCount = 0;

  const scrollContainer = findScrollableParent(mediaWall);

  verticalDiag('start', Object.assign(
    diagRootInfo(),
    diagContainerInfo(scrollContainer),
    { initialSeen: null }
  ));

  if (!scrollContainer) {
    // 无可滚动容器，直接采集
    const images = [];
    const seenSignatures = new Set();
    const imgs = mediaWall.querySelectorAll('img[src*="fp/"]');
    for (const img of imgs) {
      const signature = canonicalizeZillowPhoto(img.src);
      if (signature && !seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        images.push({ index: images.length + 1, url: img.src, signature });
      }
    }
    stopReason = 'no_scroll_container';
    verticalDiag('stop', {
      loopCount: 0,
      finalSeen: seenSignatures.size,
      stopReason,
      rootConnected: !!(mediaWall && mediaWall.isConnected)
    });
    return { status: null, expectedTotal, images };
  }

  const images = [];
  const seenSignatures = new Set();

  const collectVisibleImages = () => {
    const imgs = mediaWall.querySelectorAll('img[src*="fp/"]');
    for (const img of imgs) {
      const signature = canonicalizeZillowPhoto(img.src);
      if (signature && !seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        images.push({ index: images.length + 1, url: img.src, signature });
      }
    }
    return imgs.length;
  };

  const scrollStep = Math.floor(scrollContainer.clientHeight * 0.85);

  try {
    while (true) {
      loopCount++;

      const mountedCount = collectVisibleImages();

      if (expectedTotal && seenSignatures.size >= expectedTotal) {
        stopReason = 'expected_total_reached';
        break;
      }

      const previousTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop += scrollStep;
      await shortDelay(300, 500);

      const reachedBottom =
        scrollContainer.scrollTop === previousTop ||
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 10;

      verticalDiag('step', {
        step: loopCount,
        rootConnected: !!(mediaWall && mediaWall.isConnected),
        previousTop,
        currentTop: scrollContainer.scrollTop,
        scrollHeight: scrollContainer.scrollHeight,
        mountedCount,
        seenCount: seenSignatures.size,
        reachedBottom
      });

      if (reachedBottom) {
        collectVisibleImages();
        stopReason = 'reached_bottom';
        break;
      }
    }
  } catch (err) {
    stopReason = 'collector_error';
    verticalDiag('stop', {
      loopCount,
      finalSeen: seenSignatures.size,
      stopReason,
      rootConnected: !!(mediaWall && mediaWall.isConnected)
    });
    throw err;
  }

  verticalDiag('stop', {
    loopCount,
    finalSeen: seenSignatures.size,
    stopReason,
    rootConnected: !!(mediaWall && mediaWall.isConnected)
  });

  return { status: null, expectedTotal, images };
}

// ─── Building Gallery Collector ───
function findScrollableDescendant(root) {
  const candidates = [root, ...root.querySelectorAll('*')]
    .map(el => {
      const style = getComputedStyle(el);
      return {
        el,
        overflowY: style.overflowY,
        delta: el.scrollHeight - el.clientHeight
      };
    })
    .filter(item =>
      item.delta > 100 &&
      (item.overflowY === 'auto' || item.overflowY === 'scroll')
    )
    .sort((a, b) => b.delta - a.delta);

  return candidates[0]?.el || null;
}

async function collectZillowBuildingGallery(root, context, expectedTotal) {
  const dialog = root;
  const scrollContainer = findScrollableDescendant(dialog);

  const images = [];
  const seenSignatures = new Set();

  const collectFromDialog = () => {
    const imgs = dialog.querySelectorAll('img[src*="fp/"]');
    for (const img of imgs) {
      const signature = canonicalizeZillowPhoto(img.src);
      if (signature && !seenSignatures.has(signature)) {
        seenSignatures.add(signature);
        images.push({ index: images.length + 1, url: img.src, signature });
      }
    }
  };

  if (scrollContainer) {
    const scrollStep = Math.floor(scrollContainer.clientHeight * 0.85);
    let reachedBottom = false;

    while (!reachedBottom) {
      collectFromDialog();
      const prevScrollTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop += scrollStep;
      await shortDelay(200, 400);

      const atBottom =
        scrollContainer.scrollTop === prevScrollTop ||
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 10;

      if (atBottom) {
        reachedBottom = true;
      }
    }
    collectFromDialog();
  } else {
    collectFromDialog();
  }

  return { status: null, expectedTotal, images };
}

// ─── Unit Carousel Collector ───
async function collectZillowUnitCarousel(root, context) {
  const dialog = root;

  const getCounterInfo = () => {
    const buttons = [...dialog.querySelectorAll('button')];
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      const style = getComputedStyle(btn);
      const text = btn.textContent?.trim() || '';
      const match = text.match(/(\d+)\s+of\s+(\d+)/i);
      if (!match) continue;
      if (rect.width <= 200 || rect.height <= 200) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      return { current: parseInt(match[1]), total: parseInt(match[2]) };
    }
    return null;
  };

  const initialCounter = getCounterInfo();
  const expectedTotal = initialCounter?.total || null;

  const images = [];
  const seenSignatures = new Set();
  const collectedIndexes = new Set();

  const collectCurrentImage = () => {
    const buttons = [...dialog.querySelectorAll('button')];
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      const style = getComputedStyle(btn);
      const text = btn.textContent?.trim() || '';
      const match = text.match(/(\d+)\s+of\s+(\d+)/i);
      if (!match) continue;
      if (rect.width <= 200 || rect.height <= 200) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const img = btn.querySelector('img');
      if (img) {
        const signature = canonicalizeZillowPhoto(img.src);
        const index = parseInt(match[1]);
        if (signature && !seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          collectedIndexes.add(index);
          images.push({ index, url: img.src, signature });
        }
      }
    }
  };

  const dialogRect = dialog.getBoundingClientRect();
  const leftCenter = { x: dialogRect.left + 50, y: dialogRect.top + dialogRect.height / 2 };
  const rightCenter = { x: dialogRect.right - 50, y: dialogRect.top + dialogRect.height / 2 };

  // Unit 局部等待函数
  const waitForCounterChange = (prevCounter, timeoutMs = 3000) => {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const current = getCounterInfo();
        if (!current) {
          if (Date.now() - start > timeoutMs) resolve(false);
          else setTimeout(check, 100);
          return;
        }
        if (!prevCounter || current.current !== prevCounter.current) {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  const waitForNewHash = (prevSignature, timeoutMs = 3000) => {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const currentSig = [...dialog.querySelectorAll('button')]
          .filter(btn => {
            const rect = btn.getBoundingClientRect();
            return rect.width > 200 && rect.height > 200;
          })
          .map(btn => btn.querySelector('img')?.src)
          .filter(Boolean)
          .map(src => canonicalizeZillowPhoto(src))
          .find(sig => sig && sig !== prevSignature);

        if (currentSig) {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  // 翻页循环
  const maxIterations = expectedTotal || 60;

  for (let i = 0; i < maxIterations; i++) {
    if (expectedTotal && collectedIndexes.size >= expectedTotal) {
      break;
    }

    const prevCounter = getCounterInfo();
    const prevSignature = seenSignatures.size > 0
      ? [...seenSignatures][seenSignatures.size - 1]
      : null;

    const rightBtn = document.elementFromPoint(rightCenter.x, rightCenter.y)?.closest('button');
    clickWithCoordinates(rightBtn);

    const counterChanged = await waitForCounterChange(prevCounter);
    if (!counterChanged) {
      break;
    }

    const hashChanged = await waitForNewHash(prevSignature);
    if (!hashChanged) {
      break;
    }

    collectCurrentImage();

    const currentCounter = getCounterInfo();
    if (currentCounter && initialCounter &&
        currentCounter.current === initialCounter.current &&
        seenSignatures.size < (expectedTotal || 0)) {
      break;
    }
  }

  return { status: null, expectedTotal, images };
}

// ─── IMX Lightbox Collector (root-scoped, P0) ──────────────────────────────
//
// IMX P0 contract (see plan: imx_p0_最小修复):
//   - Input is the IMX root previously resolved by detectZillowGallery(),
//     one of: #search-detail-lightbox, .imx-lightbox, .imx-lightbox-modal.
//   - All queries (counter, Next button, image URLs) are scoped to this root.
//   - Counter must be a strict leaf text matching ^\d+\s+of\s+\d+$.
//   - Next button is `button[aria-label="Next photo"]` inside the root only.
//   - Initial collection cannot return early; even 38/45 must continue paging.
//   - Success = uniqueCount === expectedTotal. Anything below is
//     GALLERY_INCOMPLETE, never silently promoted to success.
//   - No global PhotoSwipe arrows, keyboard, or page-level counter lookups.

function rootIdentityOf(node) {
  if (!node) return null;
  try {
    if (node.id) return `#${node.id}`;
    if (node.className && typeof node.className === 'string') {
      return `.${node.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`;
    }
  } catch (_) {}
  return node.tagName ? node.tagName.toLowerCase() : null;
}

async function collectZillowImxLightbox(root, preservedExpectedTotal) {
  const imxDiag = (msg, extra) => {
    try {
      console.error('[HS_IMX_DIAG]', msg, extra || {});
    } catch (_) {}
  };

  const result = {
    status: null,
    expectedTotal: preservedExpectedTotal || null,
    images: [],
    _counterText: null,
    _imageRootConnected: !!(root && root.isConnected)
  };

  if (!root || !root.isConnected) {
    imxDiag('root_missing_or_detached', { rootIdentity: rootIdentityOf(root) });
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────
  const isVisibleElement = (el) => {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  };

  const IMX_COUNTER_RE = /^\d+\s+of\s+\d+$/i;

  const parseCounter = (raw) => {
    const txt = normalizeText(raw);
    if (!txt || !IMX_COUNTER_RE.test(txt)) return null;
    const m = txt.match(/(\d+)\s+of\s+(\d+)/i);
    if (!m || m.length < 3) return null;
    const current = Number(m[1]);
    const total = Number(m[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
    return { current, total, raw: txt };
  };

  // Strict counter reader: only find visible leaf-ish elements whose own
  // textContent exactly matches ^\d+\s+of\s+\d+$. Never read from a parent
  // whose text contains the pattern (ancestors are rejected by the leaf
  // heuristic below).
  const readImxCounter = () => {
    if (!root || !root.isConnected) return null;
    const candidates = root.querySelectorAll('*');
    for (const el of candidates) {
      if (!isVisibleElement(el)) continue;
      let hasChildMatch = false;
      for (const child of el.children) {
        if (parseCounter(child.textContent)) { hasChildMatch = true; break; }
      }
      const own = parseCounter(el.textContent);
      if (own && !hasChildMatch) return own;
    }
    // Fallback to aria-label / title of visible elements
    for (const el of candidates) {
      if (!isVisibleElement(el)) continue;
      const aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria) {
        const parsed = parseCounter(aria);
        if (parsed) return parsed;
      }
      const title = el.getAttribute && el.getAttribute('title');
      if (title) {
        const parsed = parseCounter(title);
        if (parsed) return parsed;
      }
    }
    return null;
  };

  const findNextButton = () => {
    if (!root || !root.isConnected) return null;
    const btns = root.querySelectorAll('button[aria-label="Next photo"]');
    for (const btn of btns) {
      if (isVisibleElement(btn)) return btn;
    }
    return null;
  };

  const collectCurrentFpHashes = () => {
    if (!root || !root.isConnected) return [];
    const out = [];
    const seen = new Set();
    const imgs = root.querySelectorAll('img[src*="fp/"], source[src*="fp/"]');
    for (const el of imgs) {
      const src = el.currentSrc || el.src || el.getAttribute('src') || '';
      const sig = canonicalizeZillowPhoto(src);
      if (sig && !seen.has(sig)) {
        seen.add(sig);
        out.push({ url: src, signature: sig });
      }
    }
    return out;
  };

  const waitForCounterOrSignatureChange = (prevCounter, prevSignature, timeoutMs) => {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (!root || !root.isConnected) {
          resolve({ changed: false, reason: 'root_detached' });
          return;
        }
        const c = readImxCounter();
        if (c && prevCounter && c.current !== prevCounter.current) {
          resolve({ changed: true, current: c, reason: 'counter' });
          return;
        }
        const fp = collectCurrentFpHashes();
        if (prevSignature) {
          for (const it of fp) {
            if (it.signature !== prevSignature) {
              resolve({ changed: true, current: c, signature: it.signature, reason: 'signature' });
              return;
            }
          }
        } else if (fp.length > 0) {
          resolve({ changed: true, current: c, signature: fp[0].signature, reason: 'signature' });
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve({ changed: false, reason: 'timeout', current: c });
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  };

  // ── 1) Resolve counter (strict, root-scoped) ─────────────────────────
  let initialCounter = null;
  const counterPollStart = Date.now();
  while (Date.now() - counterPollStart < 5000) {
    initialCounter = readImxCounter();
    if (initialCounter) break;
    await shortDelay(150, 250);
  }

  const expectedTotal = (initialCounter && initialCounter.total)
    || (Number(preservedExpectedTotal) || null);
  const initialUniqueCount = new Set(
    collectCurrentFpHashes().map((x) => x.signature).filter(Boolean)
  ).size;
  const nextButton = findNextButton();

  result.expectedTotal = expectedTotal;
  result._counterText = initialCounter ? initialCounter.raw : null;

  imxDiag('initial', {
    rootIdentity: rootIdentityOf(root),
    strictCounterText: initialCounter ? initialCounter.raw : null,
    currentIndex: initialCounter ? initialCounter.current : null,
    expectedTotal,
    initialUniqueCount,
    nextButtonFound: !!nextButton
  });

  if (!root || !root.isConnected) {
    imxDiag('stop', { stopReason: 'root_detached_before_paging' });
    return result;
  }
  if (!nextButton) {
    imxDiag('stop', { stopReason: 'next_button_not_found_in_imx_root' });
    return result;
  }
  if (!expectedTotal || expectedTotal <= 0) {
    imxDiag('stop', { stopReason: 'expected_total_missing' });
    return result;
  }

  // ── 2) Initial collection (do NOT return early) ───────────────────────
  const seenSignatures = new Set();
  const collectAll = () => {
    const fpItems = collectCurrentFpHashes();
    for (const it of fpItems) {
      if (!seenSignatures.has(it.signature)) {
        seenSignatures.add(it.signature);
        result.images.push({
          index: result.images.length + 1,
          url: it.url,
          signature: it.signature
        });
      }
    }
  };
  collectAll();

  // ── 3) Paging loop ────────────────────────────────────────────────────
  const MAX_CLICKS = Math.max(60, expectedTotal + 10);
  const MAX_TOTAL_MS = 60000;
  const MAX_NO_PROGRESS = 3;
  const loopStart = Date.now();
  let nextClickCount = 0;
  let noProgressStreak = 0;
  let stopReason = 'in_progress';

  while (nextClickCount < MAX_CLICKS) {
    if (seenSignatures.size >= expectedTotal) {
      stopReason = 'complete';
      break;
    }
    if (Date.now() - loopStart > MAX_TOTAL_MS) {
      stopReason = 'timeout';
      break;
    }
    if (!root || !root.isConnected) {
      stopReason = 'root_detached';
      break;
    }

    const btn = findNextButton();
    if (!btn) {
      stopReason = 'next_button_lost';
      break;
    }

    const prevCounter = readImxCounter();
    const prevSignature = result.images.length > 0
      ? result.images[result.images.length - 1].signature
      : null;

    clickWithCoordinates(btn);
    nextClickCount++;

    const waitRes = await waitForCounterOrSignatureChange(
      prevCounter,
      prevSignature,
      6000
    );

    const postCounter = waitRes.current || readImxCounter();
    collectAll();

    imxDiag('after_click', {
      nextClickCount,
      currentIndex: postCounter ? postCounter.current : null,
      uniqueCount: seenSignatures.size,
      waitReason: waitRes.reason
    });

    if (!waitRes.changed) {
      noProgressStreak++;
      if (noProgressStreak >= MAX_NO_PROGRESS) {
        stopReason = 'no_progress';
        break;
      }
      continue;
    }
    noProgressStreak = 0;
  }

  if (stopReason === 'in_progress') {
    stopReason = seenSignatures.size >= expectedTotal ? 'complete' : 'max_clicks';
  }

  imxDiag('stop', {
    stopReason,
    nextClickCount,
    expectedTotal,
    uniqueCount: seenSignatures.size
  });

  return result;
}

// ─── Unified Entry: extractZillowGallery ───
async function extractZillowGallery({ pageContext, listing, retry = false, preservedExpectedTotal = null }) {
  // Lifecycle: close the gallery whether the collector completes, returns a
  // PARTIAL result, or throws. closeGallery() is a no-op when
  // _galleryWasOpened is false (no gallery was opened), so the wrapper is
  // safe for failure paths too.
  try {
  let detected = null;
  let expectedTotal = preservedExpectedTotal;

  // 1. 重试：先检查图库是否仍然打开
  if (retry) {
    detected = detectZillowGallery(pageContext);
  }

  // 2. 如果图库未打开，尝试打开
  if (!detected?.root || !detected?.galleryType) {
    const openResult = await openGalleryForScope(pageContext);
    if (!openResult.opened) {
      return {
        status: GALLERY_RESULT_STATUS.FAILED,
        reason: 'gallery_not_opened',
        images: [],
        expectedTotal: null
      };
    }
    expectedTotal = expectedTotal || openResult.expectedTotal || null;

    // 3. 等待并识别图库
    detected = await waitForZillowGallery(pageContext, 5000);
    if (!detected.root || !detected.galleryType) {
      return {
        status: GALLERY_RESULT_STATUS.FAILED,
        reason: 'unknown_gallery_type',
        images: [],
        expectedTotal: expectedTotal
      };
    }
  }

  // 4. 重置滚动容器（Vertical Wall / Building）
  if (retry) {
    if (detected.galleryType === GALLERY_TYPES.ZILLOW_VERTICAL_MEDIA_WALL) {
      const scrollContainer = findScrollableParent(detected.root);
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
        await shortDelay(300, 500);
      }
    } else if (detected.galleryType === GALLERY_TYPES.ZILLOW_BUILDING_GALLERY) {
      const scrollContainer = findScrollableDescendant(detected.root);
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
        await shortDelay(300, 500);
      }
    }
  }

  // 5. 调用对应采集器
  let result;
  switch (detected.galleryType) {
    case GALLERY_TYPES.ZILLOW_MEDIA_CAROUSEL:
      result = await collectZillowMediaCarousel(detected.root, pageContext);
      break;
    case GALLERY_TYPES.ZILLOW_VERTICAL_MEDIA_WALL:
      result = await collectZillowVerticalWall(detected.root, pageContext, expectedTotal);
      break;
    case GALLERY_TYPES.ZILLOW_BUILDING_GALLERY:
      result = await collectZillowBuildingGallery(detected.root, pageContext, expectedTotal);
      break;
    case GALLERY_TYPES.ZILLOW_UNIT_CAROUSEL:
      result = await collectZillowUnitCarousel(detected.root, pageContext);
      break;
    case GALLERY_TYPES.ZILLOW_IMX_LIGHTBOX: {
      // IMX P0: bypass the generic collectByPhotoSwipePaging() (which has
      // Zillow StyledDialog / bodyOverflow broad-scan early returns and
      // returns 38/45 hashes after a single DOM scan for IMX). Use a small
      // root-scoped IMX paging collector instead.
      result = await collectZillowImxLightbox(detected.root, expectedTotal);
      break;
    }
    case GALLERY_TYPES.ZILLOW_PHOTOSWIPE: {
      // PhotoSwipe dispatch is unchanged. reusing the legacy collector
      // here is intentional — IMX must not pass through this branch.
      const legacyUrls = await collectByPhotoSwipePaging();
      const legacyImages = Array.isArray(legacyUrls)
        ? legacyUrls.map((url, index) => ({
            index: index + 1,
            url,
            signature: canonicalizeZillowPhoto(url)
          }))
        : [];
      result = {
        status: null,
        expectedTotal: expectedTotal || null,
        images: legacyImages
      };
      break;
    }
    default:
      result = { status: GALLERY_RESULT_STATUS.FAILED, reason: 'unsupported_gallery_type', images: [] };
  }

  // 6. 校验
  result = validateGalleryResult({
    ...result,
    galleryType: detected.galleryType,
    expectedTotal: result.expectedTotal || expectedTotal || null
  });

  // Summary diagnostic log — fields requested by requirement #10:
  // galleryType, counterText, expectedTotal, uniqueCount, reason.
  // Must NOT include imageUrls array or full response.
  // IMX MUST use the strict counter from the collector (`_counterText`).
  // For IMX, do NOT fall back to a broad root-text scan (which previously
  // captured schema.org / page-level text as the "counter").
  let counterTextForLog = null;
  try {
    const fresh = result && result._counterText;
    if (fresh) {
      counterTextForLog = fresh;
    } else if (
      detected &&
      detected.root &&
      detected.galleryType !== GALLERY_TYPES.ZILLOW_IMX_LIGHTBOX
    ) {
      // best-effort re-read using same regex; never blocks
      const candidates = detected.root.querySelectorAll('*');
      for (const el of candidates) {
        const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        const m = txt.match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
        if (m) { counterTextForLog = txt; break; }
      }
    }
  } catch (_) { /* noop */ }

  return result;
  } finally {
    // Unified close: covers all 5 Zillow collectors + the legacy
    // PhotoSwipe path; runs on success, PARTIAL, FAILED, and thrown.
    // closeGallery() is a safe no-op when _galleryWasOpened is false.
    closeGallery();
  }
}

// ─── Validate Gallery Result ───
function validateGalleryResult(result) {
  const expectedTotal = Number(result.expectedTotal) || null;

  const uniqueCount = new Set(
    result.images.map(image => image.signature).filter(Boolean)
  ).size;

  const normalized = {
    ...result,
    uniqueCount,
    collectedCount: result.images.length
  };

  // ── DIAG: TRACE_2 helper removed — validateGalleryResult now returns
  //   directly without verbose per-branch logging. The expected_total_missing
  //   failure path still propagates as GALLERY_RESULT_STATUS.FAILED with
  //   reason: 'expected_total_missing'.

  // 没有采集到任何图片
  if (!uniqueCount) {
    return { ...normalized, status: GALLERY_RESULT_STATUS.FAILED, reason: 'no_images_collected' };
  }

  // 四种已知 Zillow 图库必须有 expectedTotal
  // 注：IMX / PhotoSwipe 不进入该白名单——它们的 paging 来自 collectByPhotoSwipePaging()，
  // 不依赖 opener 文本，因此走下面的"无 expectedTotal -> COMPLETE"分支。
  const zillowGalleryTypes = [
    GALLERY_TYPES.ZILLOW_MEDIA_CAROUSEL,
    GALLERY_TYPES.ZILLOW_VERTICAL_MEDIA_WALL,
    GALLERY_TYPES.ZILLOW_UNIT_CAROUSEL
  ];

  // Building 例外：fallback 入口不解析 opener 文本，expectedTotal 可能为 null。
  // 此时 collectZillowBuildingGallery() 已通过"滚到底 + fp 图片"自行确认完整性，
  // 不应再因为 expected_total_missing 判失败 —— 只要采到图片即视为 COMPLETE。
  if (result.galleryType === GALLERY_TYPES.ZILLOW_BUILDING_GALLERY && !expectedTotal) {
    if (uniqueCount > 0) {
      return { ...normalized, status: GALLERY_RESULT_STATUS.COMPLETE };
    }
    return {
      ...normalized,
      status: GALLERY_RESULT_STATUS.FAILED,
      reason: 'expected_total_missing'
    };
  }

  if (zillowGalleryTypes.includes(result.galleryType) && !expectedTotal) {
    return {
      ...normalized,
      status: GALLERY_RESULT_STATUS.FAILED,
      reason: 'expected_total_missing'
    };
  }

  // 没有 expectedTotal 时
  if (!expectedTotal) {
    return { ...normalized, status: GALLERY_RESULT_STATUS.COMPLETE };
  }

  // 唯一数量超过预期：混入其他图片
  if (uniqueCount > expectedTotal) {
    return { ...normalized, status: GALLERY_RESULT_STATUS.FAILED, reason: 'unique_count_exceeds_expected' };
  }

  // 唯一数量少于预期：部分缺失
  if (uniqueCount < expectedTotal) {
    return {
      ...normalized,
      status: GALLERY_RESULT_STATUS.PARTIAL,
      reason: 'missing_images',
      missingCount: expectedTotal - uniqueCount
    };
  }

  return { ...normalized, status: GALLERY_RESULT_STATUS.COMPLETE, missingCount: 0 };
}


/**
 * 切换到 Zillow StyledDialog 中的 Photos Tab
 * 返回 true 表示已切换或已在 Photos tab，返回 false 表示找不到 Tab
 */
async function switchToPhotosTab() {
  const dialog = document.querySelector('[class*="StyledDialog"]') ||
                 document.querySelector('[role="dialog"]');
  if (!dialog) return false;

  // 查找所有 Tab 元素（button / role="tab" / div[tabindex]）
  const tabCandidates = dialog.querySelectorAll('button, [role="tab"], [role="menuitem"], [tabindex="0"]');

  for (const tab of tabCandidates) {
    const label = (tab.textContent || tab.getAttribute('aria-label') || '').toLowerCase();
    // 匹配 Photos / Photo Gallery 等
    if (/^photo/i.test(label)) {
      // 检查是否已激活（避免重复点击）
      const isActive = tab.getAttribute('aria-selected') === 'true' ||
                       tab.getAttribute('aria-current') === 'true' ||
                       tab.className.includes('active') ||
                       tab.className.includes('selected');
      if (isActive) {
        return true;
      }
      try { tab.click(); } catch (_) {
        try { tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_2) {}
      }
      // 等待内容切换
      await new Promise(r => setTimeout(r, 800));
      return true;
    }
  }

  return false;
}

/**
 * Extract images from Zillow StyledDialog gallery.
 * 一轮快速扫描：滚动过程中同步收集图片，接近底部后短暂 final collect 结束。
 * - 使用 wheel event 模拟真实用户滚动
 * - 按 /fp/{hash} 去重
 * - 只从 photo wall 容器提取，不扫描整个 dialog
 */
// ============================================================================
// Zillow Gallery Image Extraction
// ============================================================================

/**
 * 找到可以真正滚动的容器（通过向上追溯父级 + 通用扫描 + 实际滚动测试）
 * @param {Element} dialog - gallery dialog 元素
 * @returns {Promise<Element|null>}
 */
async function findScrollContainer(dialog) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const checked = new Set();
  const candidates = [];

  function addCandidate(el, reason) {
    if (!el || checked.has(el)) return;
    checked.add(el);

    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    candidates.push({
      el,
      reason,
      tag: el.tagName,
      className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
      overflowY: style.overflowY,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      rectWidth: rect.width,
      rectHeight: rect.height,
      canScrollByMetrics: el.scrollHeight > el.clientHeight + 80,
    });
  }

  // 1. 先找 photo wall / media wall，然后向上找父级
  const mediaWallSelectors = [
    '[class*="media-wall"]',
    '[class*="MediaWall"]',
    'ul[class*="media"]',
    '[class*="photo-wall"]',
    '[data-testid*="media"]',
    '[data-testid*="photo"]',
    '[class*="photo-grid"]',
  ];

  for (const sel of mediaWallSelectors) {
    try {
      const mediaEls = dialog.querySelectorAll(sel);
      for (const mediaEl of mediaEls) {
        let cur = mediaEl;
        let depth = 0;
        while (cur && depth < 12) {
          addCandidate(cur, `media-wall ancestor depth ${depth}`);
          cur = cur.parentElement;
          depth++;
        }
      }
    } catch (e) {
      // ignore selector errors
    }
  }

  // 2. 通用扫描 dialog 内所有元素
  addCandidate(dialog, 'dialog itself');

  try {
    for (const el of dialog.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) continue;
      if (el.scrollHeight <= el.clientHeight + 80) continue;
      addCandidate(el, 'dialog descendant generic scan');
    }
  } catch (e) {
    // ignore
  }

  // 3. dialog 往上找祖先
  let parent = dialog.parentElement;
  let depth = 0;
  while (parent && depth < 12) {
    addCandidate(parent, `dialog ancestor depth ${depth}`);
    parent = parent.parentElement;
    depth++;
  }

  // 4. 页面级兜底
  if (document.scrollingElement) addCandidate(document.scrollingElement, 'document.scrollingElement');
  addCandidate(document.documentElement, 'documentElement fallback');
  addCandidate(document.body, 'body fallback');

  // 过滤出有真实滚动空间的候选
  const viable = candidates
    .filter((c) => {
      if (!c.el) return false;
      const rect = c.el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) return false;
      return c.el.scrollHeight > c.el.clientHeight + 80;
    })
    .sort((a, b) => {
      const aScore = a.el.scrollHeight - a.el.clientHeight;
      const bScore = b.el.scrollHeight - b.el.clientHeight;
      return bScore - aScore;
    });

  if (viable.length === 0) {
    console.warn('[HomeScope Scroll] no candidates with scroll space found');
    return null;
  }

  // 实际滚动测试
  for (const c of viable) {
    const el = c.el;
    const originalTop = el.scrollTop;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const step = Math.min(300, Math.max(80, Math.round(el.clientHeight * 0.5)));

    if (maxTop <= 0) continue;

    // WheelEvent
    el.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: step,
        deltaMode: 0,
      })
    );

    el.scrollBy({
      top: step,
      behavior: 'auto',
    });

    await sleep(100);

    let afterTop = el.scrollTop;

    // Fallback: 直接设置 scrollTop
    if (Math.abs(afterTop - originalTop) < 2) {
      el.scrollTop = Math.min(originalTop + step, maxTop);
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(100);
      afterTop = el.scrollTop;
    }

    const moved = Math.abs(afterTop - originalTop) > 2;

    // 恢复位置
    el.scrollTop = originalTop;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(50);

    if (moved) {
      return el;
    }
  }

  console.warn('[HomeScope Scroll] no real scroll container found');
  return null;
}

/**
 * Hybrid 滚动函数：尝试多种方式确保滚动发生
 * @param {Element} container - 滚动容器
 * @param {number} step - 滚动步长
 * @returns {Promise<{moved: boolean, beforeTop: number, afterTop: number, nearBottom: boolean}>}
 */
async function scrollOnce(container, step) {
  const beforeTop = container.scrollTop;

  // 方式1: WheelEvent + scrollBy
  container.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: step,
    deltaMode: 0,
  }));

  container.scrollBy({ top: step, behavior: 'auto' });
  await new Promise(r => setTimeout(r, 200));

  let afterTop = container.scrollTop;
  let moved = Math.abs(afterTop - beforeTop) > 2;

  // 方式2: Fallback 直接设置 scrollTop
  if (!moved) {
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(beforeTop + step, maxTop);
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    afterTop = container.scrollTop;
    moved = Math.abs(afterTop - beforeTop) > 2;
  }

  const nearBottom = afterTop + container.clientHeight >= container.scrollHeight - 80;

  return {
    moved,
    beforeTop,
    afterTop,
    nearBottom,
  };
}

/**
 * 从根元素提取所有图片（收集 img/source/backgroundImage）
 * @param {Element} root - 搜索根元素
 * @returns {Array<{fp: string, url: string, sources: string}>}
 */
function collectGalleryImages(root) {
  const map = new Map();
  
  function getFpHash(url) {
    const m = String(url || '').match(/\/fp\/([a-f0-9]+)/i);
    return m ? m[1] : '';
  }
  
  function add(url, source) {
    if (!url) return;
    
    const s = String(url);
    // 只接受 Zillow 域名
    if (!/photos\.zillowstatic\.com\/fp\//i.test(s)) return;
    
    const fp = getFpHash(s);
    if (!fp) return;
    
    if (!map.has(fp)) {
      map.set(fp, {
        fp,
        url: s,
        sources: new Set(),
      });
    }
    
    map.get(fp).sources.add(source);
  }
  
  // 收集 img 和 source 元素的 URL
  root.querySelectorAll('img, source').forEach((el) => {
    add(el.currentSrc, 'currentSrc');
    add(el.getAttribute('src'), 'src');
    
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach((part) => {
        const url = part.trim().split(/\s+/)[0];
        add(url, 'srcset');
      });
    }
  });
  
  // 收集 backgroundImage 中的 URL
  root.querySelectorAll('*').forEach((el) => {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') return;
    
    const matches = bg.match(/https?:\/\/photos\.zillowstatic\.com\/fp\/[a-f0-9][^"')\s]+/gi);
    if (matches) {
      matches.forEach((url) => add(url, 'background'));
    }
  });
  
  return [...map.values()].map((x) => ({
    fp: x.fp,
    url: x.url,
    sources: [...x.sources].join(', '),
  }));
}

/**
 * 从 Zillow 图库提取所有图片
 * 使用改进的滚动策略确保能完整提取
 */
async function extractGalleryImagesZillow() {
  const seenByHash = new Set();
  const collectedUrls = [];

  // ── Step 0: 找到 gallery dialog ───────────────────────────────────────
  const dialog = document.querySelector('[class*="StyledDialog"]') ||
                 document.querySelector('[role="dialog"]');
  
  if (!dialog) {
    return collectedUrls;
  }

  // ── Helper: 标准化 URL（升级到高质量）────────────────────────────
  function normalizeUrl(url) {
    if (!url) return '';
    return url
      .replace(/-cc_ft_\d+\.jpg/, '-cc_ft_1536.jpg')
      .replace(/[?&]width=\d+/g, '')
      .replace(/[?&]height=\d+/g, '')
      .replace(/[?&]fit=\w+/g, '')
      .replace(/[?&]downsample=\w+/g, '')
      .replace(/\?.*$/, '');
  }

  // ── Helper: 添加图片（按 hash 去重）──────────────────────────────
  function addImage(url) {
    if (!url) return false;
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    const match = normalized.match(/\/fp\/([a-f0-9]+)/i);
    const fp = match ? match[1] : '';
    if (fp && seenByHash.has(fp)) return false;
    if (fp) seenByHash.add(fp);
    collectedUrls.push(normalized);
    return true;
  }

  // ── Helper: 收集图片（使用新的 collectGalleryImages）────────────
  function collectImages() {
    const images = collectGalleryImages(dialog);
    for (const img of images) {
      addImage(img.url);
    }
  }

  // ── Step 1: 找到滚动容器（通过实际滚动测试）────────────────────────
  const scrollContainer = await findScrollContainer(dialog);
  
  if (!scrollContainer) {
    collectImages();
    return collectedUrls;
  }

  // ── Step 2: 等待 dialog 准备好 ────────────────────────────────────────
  // 等待图片出现
  const maxWait = 3000;
  const waitStart = Date.now();
  while (Date.now() - waitStart < maxWait) {
    const imgs = dialog.querySelectorAll('img');
    if (Array.from(imgs).some(img => img.complete && img.naturalWidth > 0)) break;
    await new Promise(r => setTimeout(r, 100));
  }

  // ── Step 3: 初始提取 ─────────────────────────────────────────────────
  collectImages();

  // ── Step 4: Hybrid 滚动扫描 ──────────────────────────────────────────
  const viewportH = scrollContainer.clientHeight || 600;
  const SCROLL_STEP = Math.round(viewportH * 0.9);
  const MAX_STEPS = 12;
  const MAX_TIME = 25000;
  
  const startTime = Date.now();

  for (let step = 0; step < MAX_STEPS; step++) {
    if (Date.now() - startTime > MAX_TIME) {
      break;
    }

    const beforeCount = collectedUrls.length;
    
    // 滚动
    const result = await scrollOnce(scrollContainer, SCROLL_STEP);
    
    // 收集图片
    collectImages();
    
    // 如果没有新图片且没移动，停止
    if (!result.moved && collectedUrls.length === beforeCount) {
      break;
    }
    
    // 到达底部，停止
    if (result.nearBottom) {
      break;
    }
  }

  // ── Step 5: 最终滚动到最底部并收集 ───────────────────────────────────
  const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  scrollContainer.scrollTop = maxTop;
  scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  
  collectImages();

  // ── Step 6: 返回 URLs ────────────────────────────────────────────────
  return collectedUrls;
}

/**
 * 从页面 JavaScript 数据中提取所有图片 URL（Zillow 专用）
 * 绕过 DOM 渲染和 PhotoSwipe，直接从页面 JS 数据中获取所有图片
 */
async function extractImagesFromPageDataZillow() {
  const images = [];
  const seen = new Set();

  noop('[ZillowGallery] Starting page data extraction for Zillow images');

  // 尝试从 __NEXT_DATA__ 提取
  const nextData = document.querySelector('script#__NEXT_DATA__');
  if (nextData) {
    try {
      const data = JSON.parse(nextData.textContent);
      const photos = deepFindPhotosZillow(data);
      noop('[ZillowGallery] __NEXT_DATA__ photos found:', photos.length);
      if (photos.length > images.length) {
        for (const url of photos) {
          if (!seen.has(url)) { seen.add(url); images.push(url); }
        }
      }
    } catch (e) {
      noop('[ZillowGallery] __NEXT_DATA__ parse failed:', e.message);
    }
  }

  // 尝试从 gdpClientCache 提取
  try {
    const gdpCache = window.__gdpClientCache;
    if (gdpCache) {
      const photos = deepFindPhotosZillow(gdpCache);
      noop('[ZillowGallery] gdpClientCache photos found:', photos.length);
      if (photos.length > images.length) {
        for (const url of photos) {
          if (!seen.has(url)) { seen.add(url); images.push(url); }
        }
      }
    }
  } catch (e) {
    noop('[ZillowGallery] gdpClientCache access failed:', e.message);
  }

  // 尝试从 __PRELOADED_STATE__ 或类似变量提取
  try {
    for (const key of Object.keys(window)) {
      if (key.includes('PRELOADED') || key.includes('STATE') || key.includes('DATA')) {
        const val = window[key];
        if (val && typeof val === 'object') {
          const photos = deepFindPhotosZillow(val);
          if (photos.length > 0) {
            noop('[ZillowGallery] Window', key, 'photos found:', photos.length);
            for (const url of photos) {
              if (!seen.has(url)) { seen.add(url); images.push(url); }
            }
          }
        }
      }
    }
  } catch (e) {
    noop('[ZillowGallery] Window keys search failed:', e.message);
  }

  // 尝试从页面中的 JSON script 标签提取
  const jsonScripts = document.querySelectorAll('script[type="application/json"]');
  noop('[ZillowGallery] Found', jsonScripts.length, 'JSON scripts');
  for (const script of jsonScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const photos = deepFindPhotosZillow(data);
      if (photos.length > 0) {
        noop('[ZillowGallery] JSON script photos found:', photos.length);
        for (const url of photos) {
          if (!seen.has(url)) { seen.add(url); images.push(url); }
        }
      }
    } catch (e) {
      // 跳过无效 JSON
    }
  }

  noop('[ZillowGallery] Page data extraction complete:', images.length, 'images');
  return images;
}

/**
 * 递归搜索对象中的图片 URL（Zillow 专用）
 */
function deepFindPhotosZillow(obj, depth = 0) {
  if (depth > 30) return [];

  const photos = [];
  if (!obj || typeof obj !== 'object') return photos;

  // 检查当前对象是否包含图片数组
  const photoArrays = ['photos', 'photoUrls', 'photoUrlsArray', 'images', 'media', 'gallery'];
  for (const key of photoArrays) {
    if (Array.isArray(obj[key])) {
      for (const item of obj[key]) {
        if (typeof item === 'string') {
          if (item.includes('photos.zillow') || item.includes('wikimapia') || item.includes('mlsimaging')) {
            const url = upgradeToHiRes(item);
            if (url) photos.push(url);
          }
        } else if (item && typeof item === 'object') {
          // 处理对象格式的图片 { url: "...", ... }
          const url = upgradeToHiRes(item.url || item.src || item.uri || item.imageUrl || item.croppedUrl || '');
          if (url && (url.includes('photos.zillow') || url.includes('wikimapia') || url.includes('mlsimaging'))) {
            photos.push(url);
          }
        }
      }
    }
  }

  // 检查带修饰的对象，如 { photo: { url: "..." } }
  if (obj.photo && typeof obj.photo === 'object' && obj.photo.url) {
    const url = upgradeToHiRes(obj.photo.url);
    if (url) photos.push(url);
  }

  // 检查字符串属性中是否包含图片 URL
  const stringProps = ['url', 'src', 'uri', 'imageUrl', 'photoUrl', 'mediaUrl', 'croppedUrl'];
  for (const prop of stringProps) {
    if (typeof obj[prop] === 'string') {
      const url = upgradeToHiRes(obj[prop]);
      if (url && (url.includes('photos.zillow') || url.includes('wikimapia') || url.includes('mlsimaging'))) {
        photos.push(url);
      }
    }
  }

  // 递归搜索子对象
  for (const key of Object.keys(obj)) {
    if (photoArrays.includes(key)) continue;
    const val = obj[key];
    if (val && typeof val === 'object') {
      const subPhotos = deepFindPhotosZillow(val, depth + 1);
      photos.push(...subPhotos);
    }
  }

  return photos;
}

/**
 * 从页面 JavaScript 数据中提取所有图片 URL
 * Zillow 在 __NEXT_DATA__ 或 gdpClientCache 中存储所有图片 URL
 */
function extractImagesFromPageData() {
  const images = [];
  const seen = new Set();

  // 尝试从 __NEXT_DATA__ 提取
  const nextData = document.querySelector('script#__NEXT_DATA__');
  if (nextData) {
    try {
      const data = JSON.parse(nextData.textContent);
      const photos = deepFindPhotos(data);
      if (photos.length > images.length) {
        return photos;
      }
    } catch (e) {
    }
  }

  // 尝试从页面中的 JSON 数据提取
  const jsonScripts = document.querySelectorAll('script[type="application/json"]');
  for (const script of jsonScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const photos = deepFindPhotos(data);
      if (photos.length > images.length) {
        return photos;
      }
    } catch (e) {
      // 跳过无效 JSON
    }
  }

  return images;
}

/**
 * 递归搜索对象中的图片 URL
 */
function deepFindPhotos(obj, depth = 0) {
  if (depth > 20) return []; // 防止无限递归

  const photos = [];
  if (!obj || typeof obj !== 'object') return photos;

  // 检查当前对象是否包含图片数组
  if (Array.isArray(obj.photos) || Array.isArray(obj.photoUrls) || Array.isArray(obj.images)) {
    const arr = obj.photos || obj.photoUrls || obj.images;
    for (const item of arr) {
      if (typeof item === 'string') {
        const url = upgradeToHiRes(item);
        if (url && url.includes('photos.zillow') || url.includes('wikimapia')) {
          photos.push(url);
        }
      } else if (item && (item.url || item.src || item.uri)) {
        const url = upgradeToHiRes(item.url || item.src || item.uri);
        if (url) {
          photos.push(url);
        }
      }
    }
  }

  // 检查 img 数组
  if (Array.isArray(obj.imgs)) {
    for (const img of obj.imgs) {
      if (typeof img === 'string') {
        const url = upgradeToHiRes(img);
        if (url) photos.push(url);
      } else if (img && (img.url || img.src)) {
        const url = upgradeToHiRes(img.url || img.src);
        if (url) photos.push(url);
      }
    }
  }

  // 检查单个图片对象
  if (obj.url && typeof obj.url === 'string' && obj.url.includes('photos.zillow')) {
    const url = upgradeToHiRes(obj.url);
    if (url) photos.push(url);
  }
  if (obj.src && typeof obj.src === 'string' && obj.src.includes('photos.zillow')) {
    const url = upgradeToHiRes(obj.src);
    if (url) photos.push(url);
  }

  // 递归搜索子对象
  for (const key of Object.keys(obj)) {
    if (key === 'photos' || key === 'photoUrls' || key === 'images' || key === 'imgs') continue;
    const val = obj[key];
    if (val && typeof val === 'object') {
      const subPhotos = deepFindPhotos(val, depth + 1);
      photos.push(...subPhotos);
    }
  }

  return photos;
}

/**
 * 将 Zillow CDN 图片 URL 升级到最高质量
 */
function upgradeToHiRes(url) {
  if (!url) return '';
  return url
    .replace(/-cc_ft_\d+\.jpg/, '-cc_ft_1536.jpg')
    .replace(/[?&]width=\d+/g, '')
    .replace(/[?&]height=\d+/g, '')
    .replace(/[?&]fit=\w+/g, '')
    .replace(/[?&]downsample=\w+/g, '')
    .replace(/\?.*$/, '');
}

// =================================================================
// Zillow structured override (v6 — minimal patch, no module split)
// =================================================================
// Locked-in field rules from two real dumps (2026-08-02):
//   Apartments / b/ page: initialReduxState.gdp.building
//     - building.floorPlans[i].units (nested) holds concrete units
//     - building.units / ungroupedUnits are empty arrays
//     - building.id / buildingId / slug are null — NOT required
//     - Pricing: minPrice/maxPrice (incl. required monthly fees),
//               minBaseRent/maxBaseRent (excl.)
//     - 5 photo arrays may share URLs — hash dedupe deferred
//   /homedetails/<...>/<digits>_zpid/ page: gdpClientCache is JSON string
//     - Must JSON.parse; iterate entries, match by property.zpid to URL zpid
//     - Do NOT rely on cache key fixed format
//     - Cache key shape: ForRentShopperPlatformFullRenderQuery{"zpid":...}
//
// Hard requirements (2026-08-02):
//   1. APT 5 monthlyRent remains in current STRING contract ("$800/mo");
//      do NOT overwrite price string with Number.
//   2. Anonymous units (no unitId/zpid/hdpUrl) MUST NOT borrow
//      bestMatchedUnit.unitNumber. Governor's Park West may emit
//      availableUnits: []; floorPlanSummaries still carries plan info.
//   3. multiUnitGuard: if it still blocks multi_unit_building, allow
//      complete building-level data through. (Guard edit handled in
//      src/extension/multiUnitGuard.ts.)
//
// Scope-limited: NO store.tsx, NO vite/manifest, NO backend changes,
// NO image hash dedupe, NO single tests (those are deferred).
// =================================================================

const ZPID_URL_RE = /\/(\d+)_zpid\/?$/;
const ZILLOW_HOST_RE = /^https?:\/\/(?:www\.)?zillow\.com\//i;

function zillowIsHost(url) {
  return typeof url === 'string' && ZILLOW_HOST_RE.test(url);
}

function zillowParseZpidFromUrl(url) {
  if (!zillowIsHost(url)) return null;
  try {
    const m = new URL(url).pathname.match(ZPID_URL_RE);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function zillowReadNextData() {
  const s = document.getElementById('__NEXT_DATA__');
  if (!s) return null;
  try { return JSON.parse(s.textContent); } catch (_) { return null; }
}

function zillowDeepGet(o, path) {
  let cur = o;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function zillowFormatAddress(a) {
  if (!a || typeof a !== 'object') return null;
  const parts = [a.streetAddress, a.city, a.state, a.zipcode].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function zillowReadNumber(p, key) {
  const v = p == null ? undefined : p[key];
  return typeof v === 'number' ? v : null;
}

function zillowReadBoolean(p, key) {
  const v = p == null ? undefined : p[key];
  return v === true || v === false ? v : null;
}

function zillowReadLivingArea(p) {
  if (typeof p?.livingArea === 'number') return p.livingArea;
  if (typeof p?.livingAreaValue === 'number') return p.livingAreaValue;
  return null;
}

function zillowReadPriceFromProperty(p) {
  if (typeof p?.price === 'number') return p.price;
  if (typeof p?.listPriceLow === 'number') return p.listPriceLow;
  return null;
}

function zillowReadBaseRentFromProperty(p) {
  return typeof p?.baseRent === 'number' ? p.baseRent : null;
}

function zillowInferUnitNumber(property) {
  const street = property?.address?.streetAddress;
  if (typeof street === 'string') {
    const m = street.match(/\b(APT|UNIT|STE)\s+([A-Za-z0-9-]+)/i);
    if (m) return m[2];
  }
  return null;
}

function zillowDecideScopeFromHomedetails(property) {
  if (property?.homeStatus === 'FOR_SALE') return 'single_property';
  if (property?.homeStatus === 'FOR_RENT') {
    if (property?.roomForRent === true) return 'private_room';
    const hasBuilding = property?.buildingId != null
                        && String(property.buildingId).length > 0;
    const street = property?.address?.streetAddress ?? '';
    const hasUnitHint = /\b(APT|UNIT|STE|#)\s*\w+/i.test(street);
    if (hasBuilding && hasUnitHint) return 'selected_unit';
    if (hasBuilding) return 'selected_unit';
    return 'entire_home';
  }
  return 'entire_home';
}

function zillowToFloorPlanSummary(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    planName: typeof plan.name === 'string' ? plan.name : null,
    bedrooms: zillowReadNumber(plan, 'beds'),
    bathrooms: zillowReadNumber(plan, 'baths'),
    sqft: zillowReadNumber(plan, 'sqft'),
    minPrice: zillowReadNumber(plan, 'minPrice'),
    maxPrice: zillowReadNumber(plan, 'maxPrice'),
    minBaseRent: zillowReadNumber(plan, 'minBaseRent'),
    maxBaseRent: zillowReadNumber(plan, 'maxBaseRent'),
    requiredMonthlyFeeMin: zillowReadNumber(plan, 'totalRequiredMonthlyMinFee'),
    requiredMonthlyFeeMax: zillowReadNumber(plan, 'totalRequiredMonthlyMaxFee'),
    listPriceIncludesRequiredMonthlyFees:
      zillowReadBoolean(plan, 'listPriceIncludesRequiredMonthlyFees'),
    availableFrom: typeof plan.availableFrom === 'string' ? plan.availableFrom : null,
    leaseTerm: typeof plan.leaseTerm === 'string' ? plan.leaseTerm : null,
    unitCount: Array.isArray(plan.units) ? plan.units.length : null,
    source: 'gdp.building.floorPlans[i]',
  };
}

function zillowFlattenUnitsApartments(floorPlans, _bestMatched) {
  // Hard requirement 2: anonymous units MUST NOT borrow bestMatchedUnit.unitNumber.
  // Governor's Park West: availableUnits may be [].
  const out = [];
  if (!Array.isArray(floorPlans)) return out;
  for (const plan of floorPlans) {
    const planUnits = Array.isArray(plan?.units) ? plan.units : [];
    for (const u of planUnits) {
      const hasIdentity = u?.unitId != null
                          || u?.zpid != null
                          || typeof u?.hdpUrl === 'string';
      // Only emit units with explicit identity. No borrowing from bestMatched.
      if (!hasIdentity) continue;
      out.push({
        unitId: u?.unitId != null ? String(u.unitId) : null,
        unitNumber: typeof u?.unitNumber === 'string' ? u.unitNumber : null,
        zpid: u?.zpid != null ? String(u.zpid) : null,
        planName: typeof plan?.name === 'string' ? plan.name : null,
        bedrooms: zillowReadNumber(u, 'beds') ?? zillowReadNumber(plan, 'beds'),
        bathrooms: zillowReadNumber(u, 'baths') ?? zillowReadNumber(plan, 'baths'),
        sqft: zillowReadNumber(u, 'sqft') ?? zillowReadNumber(plan, 'sqft'),
        monthlyRent: zillowReadNumber(u, 'minPrice') ?? zillowReadNumber(plan, 'minPrice'),
        baseRent: zillowReadNumber(u, 'minBaseRent') ?? zillowReadNumber(plan, 'minBaseRent'),
        availableFrom: typeof u?.availableFrom === 'string'
                        ? u.availableFrom
                        : (typeof plan?.availableFrom === 'string' ? plan.availableFrom : null),
        hdpUrl: typeof u?.hdpUrl === 'string' ? u.hdpUrl : null,
        hasExplicitIdentity: true,
        source: 'gdp.building.floorPlans[i].units[j]',
      });
    }
  }
  return out;
}

function parseZillowAvailableUnitRow(row) {
  if (!(row instanceof HTMLElement)) return null;

  const cleanText = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parseMoney = (value) => {
    const match = cleanText(value).match(/\$([\d,]+)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  };
  const cells = [...row.querySelectorAll(':scope > td')];
  if (cells.length < 4) return null;

  const unitCellText = cleanText(cells[0].innerText);
  const sqftText = cleanText(cells[1].innerText);
  const availableFrom = cleanText(cells[2].innerText) || null;
  const priceText = cleanText(cells[3].innerText);
  const unitMatch = unitCellText.match(/\bUnit\s+([A-Za-z0-9-]+)\b/i);
  const bedroomMatch = unitCellText.match(/\b(\d+(?:\.\d+)?)\s*bd\b/i);
  const bathroomMatch = unitCellText.match(/\b(\d+(?:\.\d+)?)\s*ba\b/i);
  const photoMatch = unitCellText.match(/\b(\d+)\s*photos?\b/i);
  const sqft = /^[\d,]+$/.test(sqftText) ? Number(sqftText.replace(/,/g, '')) : null;
  const unit = {
    unitNumber: unitMatch?.[1] || null,
    bedrooms: /\bStudio\b/i.test(unitCellText)
      ? 0
      : (bedroomMatch ? Number(bedroomMatch[1]) : null),
    bathrooms: bathroomMatch ? Number(bathroomMatch[1]) : null,
    sqft,
    monthlyRent: parseMoney(priceText),
    availableFrom,
    photoCount: photoMatch ? Number(photoMatch[1]) : null,
    source: 'dom.available-units.table-row',
  };

  // Generic contract: a row is preserved as long as it identifies a unit
  // number. Auxiliary fields (photo count, sqft, date, rent, …) may be
  // absent on the page; missing values stay null so the row still flows
  // through to downstream consumers.
  return unit.unitNumber !== null ? unit : null;
}

function extractZillowAvailableUnitsFromDOM() {
  const seen = new Set();
  return [...document.querySelectorAll('tr[data-test-id="unit-table-row"]')]
    .map(parseZillowAvailableUnitRow)
    .filter((unit) => {
      if (!unit || seen.has(unit.unitNumber)) return false;
      seen.add(unit.unitNumber);
      return true;
    });
}

function zillowBuildApartmentPatch(building) {
  const floorPlans = Array.isArray(building?.floorPlans) ? building.floorPlans : [];
  const domAvailableUnits = extractZillowAvailableUnitsFromDOM();
  const availableUnits = domAvailableUnits.length > 0
    ? domAvailableUnits
    : zillowFlattenUnitsApartments(floorPlans, null);
  const floorPlanSummaries = floorPlans.map(zillowToFloorPlanSummary).filter(Boolean);
  // Bug fix: total available unit count must come from floor plan roll-ups,
  // not from the number of identified concrete units (which can be just 1
  // because DOM/identity filtering intentionally drops anonymous rows).
  const totalAvailableUnitCount = sumFloorPlanUnitCounts(floorPlanSummaries)
    ?? availableUnits.length;
  const offerBlock = extractZillowBuildingSpecialOffer();
  const calculator = extractZillowRentalCostCalculator();
  return {
    listingScope: 'multi_unit_building',
    buildingName: typeof building?.name === 'string' ? building.name : null,
    buildingId: (building?.id ?? building?.buildingId) != null
                  ? String(building.id ?? building.buildingId) : null,
    buildingAddress: zillowFormatAddress(building?.address),
    zpid: null,
    unitNumber: null,
    hdpUrl: null,
    selectedUnit: null,
    monthlyRent: null,
    baseRent: null,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    listPriceIncludesRequiredMonthlyFees: null,
    floorPlanSummaries,
    availableUnits,
    availableUnitCount: totalAvailableUnitCount,
    identifiedUnitCount: availableUnits.length,
    rawAddress: building?.address?.streetAddress ?? null,
    specialOfferText: offerBlock?.text ?? null,
    specialOffers: offerBlock?.items ?? null,
    rentalCostCalculator: calculator,
  };
}

/**
 * Sum floor-plan unitCount values. Returns null when no valid roll-up is
 * present (e.g. legacy shapes missing the field). Ignores null / non-finite /
 * negative values to avoid NaN leaks.
 */
function sumFloorPlanUnitCounts(floorPlanSummaries) {
  if (!Array.isArray(floorPlanSummaries) || floorPlanSummaries.length === 0) {
    return null;
  }
  let sum = 0;
  let anyValid = false;
  for (const fp of floorPlanSummaries) {
    const n = fp && typeof fp === 'object' ? fp.unitCount : null;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      sum += n;
      anyValid = true;
    }
  }
  return anyValid ? sum : null;
}

/**
 * Scope Special Offer extraction to the current listing only.
 * Avoid "Nearby apartments" / "Similar apartments" sections by requiring the
 * candidate node to be inside the building header area or labelled
 * "Special offer" / "Specials". Returns null when nothing reliable is found.
 */
function extractZillowBuildingSpecialOffer() {
  if (typeof document === 'undefined') return null;
  const doc = document;
  const HEADER_SELECTORS = [
    'h1',
    '[data-test-id="building-name"]',
    '[data-testid="building-name"]',
    'header',
  ];

  // Find the building header root (closest containing element of any
  // candidate header element).
  let headerRoot = null;
  for (const sel of HEADER_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) {
      headerRoot = el.closest('section') || el.closest('article') || el.parentElement || el;
      break;
    }
  }

  // Locate "Special offer" / "Specials" heading within the main listing
  // document, but excluding obvious "Similar" / "Nearby" sections. We
  // include button / role=heading / offer-specific data-testid / class
  // hooks so that the offer heading matches even when Zillow renders it
  // as a tab / accordion label.
  const headingSelectors = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'button',
    '[role="heading"]',
    '[data-testid*="special" i]',
    '[class*="special-offer" i]',
    '[class*="SpecialOffer" i]',
    'div', 'span', 'p',
  ];
  const directText = (el) => {
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3 /* text */) out += node.textContent || '';
    }
    return out.trim();
  };
  const candidateHeadings = [...doc.querySelectorAll(headingSelectors.join(','))]
    .filter((el) => {
      const direct = directText(el);
      const txt = (el.textContent || '').trim();
      // Match either on direct short text or on a short whole-textContent.
      const labelMatch = /^specials?\b|^special offer/i.test(direct)
        || (/^specials?\b|^special offer/i.test(txt) && txt.length <= 200);
      if (!labelMatch) return false;
      // Reject if ancestor chain contains a "Similar apartments" / "Nearby" header.
      let p = el.parentElement;
      for (let i = 0; p && i < 6; i += 1) {
        const pt = (p.textContent || '').toLowerCase();
        if (pt.includes('similar apartments') || pt.includes('nearby apartments')
            || pt.includes('other apartments you might')) {
          return false;
        }
        p = p.parentElement;
      }
      return true;
    });

  if (candidateHeadings.length === 0) return null;

  // Prefer candidates that are descendants of headerRoot, then those
  // closest to it. Candidates that share no ancestry with headerRoot
  // rank lowest.
  const isDescendantOf = (el, root) => {
    if (!el || !root) return false;
    let cur = el;
    while (cur && cur !== root) cur = cur.parentElement;
    return !!cur;
  };
  let ranked = candidateHeadings.slice();
  if (headerRoot) {
    ranked.sort((a, b) => {
      const aIn = isDescendantOf(a, headerRoot) ? 0 : 1;
      const bIn = isDescendantOf(b, headerRoot) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return distanceTo(a, headerRoot) - distanceTo(b, headerRoot);
    });
  }

  const heading = ranked[0];

  // Pick the smallest container that looks like an "offer block":
  //   1. Prefer a node whose own attribute hints at an offer container
  //      (data-testid / class).
  //   2. Otherwise, walk up from heading until we find a node whose
  //      textContent is short enough to plausibly be a single offer
  //      block (<1500 chars). This avoids leaking the whole building
  //      page into the offer text.
  let container = null;
  const offerContainerHint = heading.closest(
    '[data-testid*="offer" i], [class*="special-offer" i], [class*="SpecialOffer" i]',
  );
  if (offerContainerHint
      && (offerContainerHint.textContent || '').length <= 4000) {
    container = offerContainerHint;
  } else {
    let c = heading.parentElement;
    while (c && (c.textContent || '').length > 1500 && c.parentElement) {
      c = c.parentElement;
    }
    if (c) container = c;
  }
  if (!container) container = heading.closest('section') || heading.parentElement || heading;

  // Collect individual offer bullets if the container is a list. Filter
  // by offer-shape (short, no sqft/bed/bath markers, no $NNN,NNN price
  // range, etc.) so we don't pull in description lists nested inside the
  // offer block.
  const OFFER_PREFIX = /^(apply|move|get|tour|free|save|use|contact|book|schedule|reserve|sign|receive|cash|earn|enjoy|book|booked)/i;
  const NON_OFFER_MARKERS = /\b(\d+\s*bd|\d+\s*ba|\d+\s*sqft|sq\s*ft|bedrooms|bathrooms)\b/i;
  const items = [];
  const seen = new Set();
  for (const li of container.querySelectorAll('li')) {
    const t = (li.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t.length > 240) continue;
    if (NON_OFFER_MARKERS.test(t) && !OFFER_PREFIX.test(t)) continue;
    if (!seen.has(t)) items.push(t);
    seen.add(t);
  }
  let text = items.length > 0
    ? items.join('\n')
    : (container.textContent || '').replace(/\s+/g, ' ').trim();
  // Trim obvious unrelated trailing content from sibling sections.
  text = text.split(/(Similar apartments|Nearby apartments|Other apartments you might)/i)[0].trim();
  // Hard-length guard. A genuine Winbro offer block is well under 600
  // chars. If we somehow collected the whole building body, drop it.
  if (text.length > 600) text = text.slice(0, 600).trim();
  if (!text || text.length < 4) return null;
  return { text, items: items.length > 0 ? items : null };
}

function distanceTo(el, root) {
  if (!el || !root) return Number.POSITIVE_INFINITY;
  let depth = 0;
  let cur = el;
  while (cur && cur !== root && depth < 32) {
    cur = cur.parentElement;
    depth += 1;
  }
  return depth;
}

/**
 * Extract the Rental Cost Calculator block.
 *
 * Two stable structural sections exist on Zillow's calculator surface:
 *   #application-section     -> Application Cost / Holding Cost / Total application cost
 *   #monthly-section-panel   -> Monthly base rent (range) + four "Varies" reimbursements
 *
 * The primary path reads those two sections independently so that
 * `$50 Application`, `$165 Holding` and `$215 Est. total` never collide
 * with `$765-$885 Monthly base rent`. When one of the section selectors
 * is missing, we fall back to the bounded-container heuristic -- but
 * each field regex remains anchored to its own section text so the two
 * scopes can never bleed into each other.
 *
 * Captures the numeric ranges plus the literal "Varies" reimbursement
 * facts (no fake numbers). Returns null when no calculator block is
 * present on the page.
 */
function extractZillowRentalCostCalculator() {
  if (typeof document === 'undefined') return null;
  const doc = document;

  // ---------- Section helpers ----------
  const sectionText = (el) => {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const parseMoney = (s) => {
    if (s == null) return null;
    const m = String(s).replace(/,/g, '').match(/\$?\s*(-?\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };

  // Separator class between a label and its amount. Includes:
  //   - whitespace (\s)
  //   - ":" hyphen "-" en-dash "–"
  //   - "(" ")" "[" "]" "," — Zillow Winbro wraps the holding-cost value
  //     as "Holding Cost ($165 each) $165 Refundable", so a single "(" or
  //     comma must be transparent. Keeping the class otherwise narrow
  //     prevents the regex from spanning across unrelated fields.
  const LABEL_SEP = '[\\s:\\-\u2013()[\\],]*';
  const labelToAmountRe = (label) => new RegExp(
    `${label}${LABEL_SEP}\\$?([\\d,.]+)`, 'i',
  );
  const amountToLabelRe = (label) => new RegExp(
    `\\$([\\d,.]+)\\s*[\\s:\\-\u2013]?\\s*${label}`, 'i',
  );
  const labelToRangeRe = (label) => new RegExp(
    `${label}${LABEL_SEP}\\$?([\\d,.]+)\\s*[\\-\u2013]?\\s*\\$?([\\d,.]+)`, 'i',
  );
  const amountToRangeLabelRe = (label) => new RegExp(
    `\\$([\\d,.]+)\\s*[\\-\u2013]?\\s*\\$([\\d,.]+)\\s*[\\s:\\-\u2013]?\\s*${label}`, 'i',
  );

  const firstNumber = (text, regexes) => {
    for (const re of regexes) {
      const m = re.exec(text);
      if (m && m[1] != null) {
        const v = parseMoney(m[1]);
        if (v != null) return v;
      }
    }
    return null;
  };

  // ---------- Application section (application + holding + total) ----------
  const applicationEl = doc.querySelector('#application-section')
    || doc.querySelector('[data-testid="application-section"]')
    || doc.querySelector('[id*="application" i]');
  const applicationText = sectionText(applicationEl);

  const applicationCost = applicationText
    ? firstNumber(applicationText, [
        labelToAmountRe('application\\s*cost[s]?'),
        amountToLabelRe('application\\s*cost[s]?'),
      ])
    : null;
  const holdingCost = applicationText
    ? firstNumber(applicationText, [
        labelToAmountRe('holding\\s*cost[s]?'),
        amountToLabelRe('holding\\s*cost[s]?'),
      ])
    : null;
  // totalApplicationCost is the schema's existing slot for "$215 Est. total".
  // IMPORTANT: prefer the label->amount direction first. The amount->label
  // pattern (`$NNN Est. total application cost`) can false-match against
  // a `$NNN Holding Cost` value when the collapsed section text places
  // the two adjacent (e.g. "Holding Cost $165 Est. total ... $215"). The
  // label->amount direction is anchored to the literal "Est. total" text
  // and is therefore unambiguous.
  const totalApplicationCost = applicationText
    ? firstNumber(applicationText, [
        labelToAmountRe('est(?:imated)?\\.?\\s*total\\s*application\\s*cost[s]?'),
        labelToAmountRe('total\\s*application\\s*cost[s]?'),
        amountToLabelRe('est(?:imated)?\\.?\\s*total\\s*application\\s*cost[s]?'),
        amountToLabelRe('total\\s*application\\s*cost[s]?'),
      ])
    : null;

  // ---------- Monthly section (base rent range + reimbursements) ----------
  const monthlyEl = doc.querySelector('#monthly-section-panel')
    || doc.querySelector('[data-testid="monthly-section-panel"]')
    || doc.querySelector('[id*="monthly" i]');
  const monthlyText = sectionText(monthlyEl);

  let baseRentMin = null;
  let baseRentMax = null;
  if (monthlyText) {
    for (const re of [
      labelToRangeRe('monthly\\s*base\\s*rent'),
      labelToRangeRe('base\\s*rent'),
      amountToRangeLabelRe('monthly\\s*base\\s*rent'),
      amountToRangeLabelRe('base\\s*rent'),
    ]) {
      const m = re.exec(monthlyText);
      if (m && m[1] != null && m[2] != null) {
        const a = parseMoney(m[1]);
        const b = parseMoney(m[2]);
        if (a != null && b != null) {
          baseRentMin = Math.min(a, b);
          baseRentMax = Math.max(a, b);
          break;
        }
      }
    }
  }

  // Reimbursements: accept per-label or merged form. NEVER derive amounts.
  const reimbursementLabels = [
    'Electric reimbursement',
    'Gas reimbursement',
    'Other reimbursement',
    'Trash reimbursement',
  ];
  const variableReimbursements = [];
  if (monthlyText) {
    const perLabelRe = (label) => new RegExp(
      `${label.replace(/\s+/g, '\\s+')}[:\\s=]+(varies)`, 'i',
    );
    const mergedRe = /(electric|gas|other|trash)\s*[\/,\s]*(?:reimbursement[s]?)?[^a-z]*(?:reimbursement[s]?)?\s*[:=]?\s*varies/i;
    if (reimbursementLabels.some((l) => perLabelRe(l).test(monthlyText))) {
      for (const label of reimbursementLabels) {
        if (perLabelRe(label).test(monthlyText)) variableReimbursements.push(label);
      }
    } else if (mergedRe.test(monthlyText)) {
      for (const label of reimbursementLabels) variableReimbursements.push(label);
    }
  }

  const primaryHasAny = [
    applicationCost, holdingCost, totalApplicationCost,
    baseRentMin, baseRentMax,
  ].some((v) => v != null) || variableReimbursements.length > 0;

  // ---------- Fallback: bounded-container heuristic ----------
  // Only consulted when at least one stable section is missing, and even
  // then we keep the section-scoped outputs above. Each field regex is
  // restricted to its own bounded container text so the two scopes
  // cannot cross-contaminate. We never scan bodyText or invent numbers.
  let fallback = null;
  if (!primaryHasAny) {
    fallback = extractZillowRentalCostCalculatorFallback(doc);
    if (!fallback) return null;
  } else {
    // Optional deposit / move-in cost still flows through the bounded
    // fallback because Zillow does not always render these in a stable
    // section selector.
    fallback = extractZillowRentalCostCalculatorFallback(doc, true);
  }

  const fallbackDeposit = fallback ? (fallback.deposit ?? null) : null;
  const fallbackMoveIn = fallback ? (fallback.totalMoveInCost ?? null) : null;
  return {
    baseRentMin: primaryHasAny ? baseRentMin : (fallback?.baseRentMin ?? null),
    baseRentMax: primaryHasAny ? baseRentMax : (fallback?.baseRentMax ?? null),
    applicationCost: primaryHasAny ? applicationCost : (fallback?.applicationCost ?? null),
    holdingCost: primaryHasAny ? holdingCost : (fallback?.holdingCost ?? null),
    totalApplicationCost: primaryHasAny ? totalApplicationCost : (fallback?.totalApplicationCost ?? null),
    deposit: fallbackDeposit,
    totalMoveInCost: fallbackMoveIn,
    variableReimbursements: primaryHasAny
      ? variableReimbursements.slice()
      : (fallback && Array.isArray(fallback.variableReimbursements) ? fallback.variableReimbursements.slice() : []),
  };
}

/**
 * Bounded-container fallback for the Rental Cost Calculator.
 *
 * When called with `extrasOnly=true`, only deposit + totalMoveInCost are
 * resolved (and only when their labels are anchored to the same
 * calculator block). Otherwise it scans for any calculator anchor block
 * and returns whichever numbers can be anchored to their respective
 * labels -- never inventing numbers from bodyText or from price ranges
 * outside the bounded container.
 */
function extractZillowRentalCostCalculatorFallback(doc, extrasOnly = false) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;

  const directText = (el) => {
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3 /* text */) out += node.textContent || '';
    }
    return out.trim();
  };

  const headingSelectors = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'button',
    '[role="heading"]',
    '[data-testid*="cost" i]',
    '[class*="Calculator" i]',
    'div', 'span', 'p',
  ];
  const candidateHeadings = [...doc.querySelectorAll(headingSelectors.join(','))]
    .filter((el) => {
      const direct = directText(el);
      const txt = (el.textContent || '').trim();
      const labelMatch = /cost calculator|rental cost/i.test(direct)
        || (/cost calculator|rental cost/i.test(txt) && txt.length <= 240);
      if (!labelMatch) return false;
      let p = el.parentElement;
      for (let i = 0; p && i < 6; i += 1) {
        const pt = (p.textContent || '').toLowerCase();
        if (pt.includes('similar apartments') || pt.includes('nearby apartments')
            || pt.includes('other apartments you might')) {
          return false;
        }
        p = p.parentElement;
      }
      return true;
    });

  if (candidateHeadings.length === 0) return null;

  const boundedContainer = (heading) => {
    let container = heading.closest('section') || heading.parentElement || heading;
    if (container && (container.textContent || '').length > 4000) {
      let c = heading.parentElement;
      while (c && (c.textContent || '').length > 1500 && c.parentElement) {
        c = c.parentElement;
      }
      if (c) container = c;
    }
    return container;
  };

  const anchorRegexes = [
    /est(?:\.|imated)?\s*total\s*monthly\s*cost/i,
    /monthly\s*base\s*rent|base\s*rent/i,
    /application\s*cost/i,
    /holding\s*cost/i,
    /move[-\s]*in\s*cost/i,
    /deposit/i,
    /reimbursement/i,
  ];
  const scoreContainer = (root) => {
    if (!root) return -1;
    const t = (root.textContent || '').toLowerCase();
    if (!t) return -1;
    if (t.includes('similar apartments') || t.includes('nearby apartments')
        || t.includes('other apartments you might')) {
      return -1;
    }
    let score = 0;
    for (const re of anchorRegexes) if (re.test(t)) score += 1;
    return score;
  };

  const ranked = candidateHeadings
    .map((h) => ({ heading: h, container: boundedContainer(h) }))
    .filter((c) => scoreContainer(c.container) > 0)
    .sort((a, b) => scoreContainer(b.container) - scoreContainer(a.container));

  if (ranked.length === 0) return null;
  const text = (ranked[0].container.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const parseMoney = (s) => {
    if (s == null) return null;
    const m = String(s).replace(/,/g, '').match(/\$?\s*(-?\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };

  const money = '\\$?([\\d,.]+)';
  const moneySep = '\\s*[\\-\u2013]?\\s*';
  const labelToRange = (label) => new RegExp(
    `${label}[\\s:\\-\u2013]*${money}${moneySep}${money}`, 'i',
  );
  const labelToAmount = (label) => new RegExp(
    `${label}[\\s:\\-\u2013]*${money}`, 'i',
  );
  const amountToLabel = (label, two) => new RegExp(
    `\\$([\\d,.]+)${moneySep}${two ? '\\$([\\d,.]+)' : ''}\\s*[\\s:\\-\u2013]?\\s*${label}`, 'i',
  );

  const firstNumber = (regexes) => {
    for (const re of regexes) {
      const m = re.exec(text);
      if (m && m[1] != null) {
        const v = parseMoney(m[1]);
        if (v != null) return v;
      }
    }
    return null;
  };

  const baseRentRange = (() => {
    for (const re of [
      labelToRange('monthly\\s*base\\s*rent'),
      labelToRange('base\\s*rent'),
      amountToLabel('monthly\\s*base\\s*rent', true),
      amountToLabel('base\\s*rent', true),
    ]) {
      const m = re.exec(text);
      if (m && m[1] != null && m[2] != null) {
        const a = parseMoney(m[1]);
        const b = parseMoney(m[2]);
        if (a != null && b != null) return { min: Math.min(a, b), max: Math.max(a, b) };
      }
    }
    return null;
  })();

  const applicationCost = firstNumber([
    labelToAmount('application\\s*cost[s]?'),
    amountToLabel('application\\s*cost[s]?'),
  ]);
  const holdingCost = firstNumber([
    labelToAmount('holding\\s*cost'),
    amountToLabel('holding\\s*cost'),
  ]);
  const totalApplicationCost = firstNumber([
    // amount->label must run first to beat the generic "$X cost" catch-all.
    amountToLabel('est(?:imated)?\\.?\\s*total\\s*application\\s*cost[s]?', false),
    labelToAmount('est(?:imated)?\\.?\\s*total\\s*application\\s*cost[s]?'),
    amountToLabel('total\\s*application\\s*cost[s]?', false),
    labelToAmount('total\\s*application\\s*cost[s]?'),
  ]);
  const deposit = firstNumber([
    labelToAmount('deposit'),
    amountToLabel('deposit'),
  ]);
  const totalMoveInCost = firstNumber([
    amountToLabel('est(?:imated)?\\.?\\s*move[\\s-]*in\\s*cost[s]?', false),
    labelToAmount('est(?:imated)?\\.?\\s*move[\\s-]*in\\s*cost[s]?'),
    amountToLabel('move[\\s-]*in\\s*cost[s]?', false),
    labelToAmount('move[\\s-]*in\\s*cost[s]?'),
  ]);

  const variableReimbursements = [];
  const reimbursementLabels = [
    'Electric reimbursement',
    'Gas reimbursement',
    'Other reimbursement',
    'Trash reimbursement',
  ];
  const perLabelRe = (label) => new RegExp(
    `${label.replace(/\s+/g, '\\s+')}[:\\s=]+(varies)`, 'i',
  );
  const mergedRe = /(electric|gas|other|trash)\s*[\/,\s]*(?:reimbursement[s]?)?[^a-z]*(?:reimbursement[s]?)?\s*[:=]?\s*varies/i;
  if (reimbursementLabels.some((l) => perLabelRe(l).test(text))) {
    for (const label of reimbursementLabels) {
      if (perLabelRe(label).test(text)) variableReimbursements.push(label);
    }
  } else if (mergedRe.test(text)) {
    for (const label of reimbursementLabels) variableReimbursements.push(label);
  }

  if (extrasOnly) {
    return { deposit, totalMoveInCost };
  }

  const anyValue = [
    applicationCost, holdingCost, totalApplicationCost,
    baseRentRange?.min, baseRentRange?.max,
    deposit, totalMoveInCost,
  ].some((v) => v != null) || variableReimbursements.length > 0;
  if (!anyValue) return null;

  return {
    baseRentMin: baseRentRange?.min ?? null,
    baseRentMax: baseRentRange?.max ?? null,
    applicationCost,
    holdingCost,
    totalApplicationCost,
    deposit,
    totalMoveInCost,
    variableReimbursements,
  };
}

function zillowReadString(p, key) {
  const v = p == null ? undefined : p[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function zillowBuildHomedetailsPatch(property, urlZpid) {
  const zpid = String(property.zpid);
  const buildingId = property.buildingId != null ? String(property.buildingId) : null;
  const unitNumber = zillowInferUnitNumber(property);
  const scope = zillowDecideScopeFromHomedetails(property);
  const monthlyRent = zillowReadPriceFromProperty(property);
  const baseRent = zillowReadBaseRentFromProperty(property);
  const sqft = zillowReadLivingArea(property);
  const beds = zillowReadNumber(property, 'bedrooms');
  const baths = zillowReadNumber(property, 'bathrooms');

  // === Rental facts — strictly from gdpClientCache property.
  //     Field names: see gdpClientCache property shape (verified via
  //     zillowReadBaseRentFromProperty + zillowReadBoolean reads above).
  //     Anything absent is left null; we do NOT fall back to DOM inside patch. ===
  const requiredMonthlyFeeMin = zillowReadNumber(property, 'requiredMonthlyFeeMin');
  const requiredMonthlyFeeMax = zillowReadNumber(property, 'requiredMonthlyFeeMax');
  const leaseTerm = zillowReadString(property, 'leaseTerm');
  const petPolicy = zillowReadString(property, 'petPolicy')
                  ?? zillowReadString(property, 'petsAllowed');
  const laundry = zillowReadString(property, 'laundry');
  const availabilityStatusRaw = zillowReadString(property, 'availabilityStatus')
                             ?? zillowReadString(property, 'dateAvailable')
                             ?? zillowReadString(property, 'availableFrom');
  const availabilityStatus = (() => {
    if (!availabilityStatusRaw) return null;
    const lower = availabilityStatusRaw.toLowerCase();
    if (/now|today|immediately/.test(lower)) return 'available_now';
    if (/coming\s*soon|future/.test(lower)) return 'coming_soon';
    return availabilityStatusRaw;
  })();
  const homeType = zillowReadString(property, 'homeType');
  const parkingStr = zillowReadString(property, 'parking')
                  ?? zillowReadString(property, 'parkingFeatures');

  const availableUnits = (scope === 'selected_unit' && unitNumber) ? [{
    unitId: null,
    unitNumber,
    zpid,
    planName: null,
    bedrooms: beds,
    bathrooms: baths,
    sqft,
    monthlyRent,
    baseRent,
    availableFrom: null,
    hdpUrl: typeof property.hdpUrl === 'string' ? property.hdpUrl : null,
    hasExplicitIdentity: true,
    source: 'property',
  }] : [];

  return {
    listingScope: scope,
    buildingName: property.buildingName ?? null,
    buildingId,
    buildingAddress: zillowFormatAddress(property.address),
    zpid,
    unitNumber,
    hdpUrl: typeof property.hdpUrl === 'string' ? property.hdpUrl : null,
    monthlyRent,
    baseRent,
    sqft,
    bedrooms: beds,
    bathrooms: baths,
    listPriceIncludesRequiredMonthlyFees:
      zillowReadBoolean(property, 'listPriceIncludesRequiredMonthlyFees'),
    requiredMonthlyFeeMin,
    requiredMonthlyFeeMax,
    leaseTerm,
    petPolicy,
    laundry,
    availabilityStatus,
    homeType,
    parking: parkingStr,
    floorPlanSummaries: [],
    availableUnits,
    rawAddress: property.address?.streetAddress ?? null,
  };
}

function zillowBuildPatchFromNextData(nextData, url) {
  if (!nextData || typeof nextData !== 'object') return null;
  const urlZpid = zillowParseZpidFromUrl(url);
  let urlPath = '';
  try { urlPath = new URL(url).pathname; } catch (_) { urlPath = ''; }

  if (/\/homedetails\//.test(urlPath) && urlZpid) {
    const raw = zillowDeepGet(nextData,
      ['props','pageProps','componentProps','gdpClientCache']);
    if (typeof raw !== 'string') return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return null; }
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (v && typeof v === 'object' && v.property?.zpid != null
          && String(v.property.zpid) === urlZpid) {
        return zillowBuildHomedetailsPatch(v.property, urlZpid);
      }
    }
    return null;
  }

  if (/\/(apartments|b)\//.test(urlPath)) {
    const building = zillowDeepGet(nextData,
      ['props','pageProps','componentProps','initialReduxState','gdp','building']);
    if (!building || typeof building !== 'object') return null;

    const hasFloorPlans = Array.isArray(building.floorPlans) && building.floorPlans.length > 0;

    if (hasFloorPlans) {
      return zillowBuildApartmentPatch(building);
    }

    // floorPlans missing or empty — fallback to unit-table DOM.
    const domUnits = extractZillowAvailableUnitsFromDOM();
    if (domUnits.length > 0) {
      const offerBlock = extractZillowBuildingSpecialOffer();
      const calculator = extractZillowRentalCostCalculator();
      return {
        listingScope: 'multi_unit_building',
        buildingName: typeof building?.name === 'string' ? building.name : null,
        buildingId: (building?.id ?? building?.buildingId) != null
                      ? String(building.id ?? building.buildingId) : null,
        buildingAddress: zillowFormatAddress(building?.address),
        zpid: null,
        unitNumber: null,
        hdpUrl: null,
        selectedUnit: null,
        monthlyRent: null,
        baseRent: null,
        sqft: null,
        bedrooms: null,
        bathrooms: null,
        listPriceIncludesRequiredMonthlyFees: null,
        floorPlanSummaries: null,
        availableUnits: domUnits,
        availableUnitCount: domUnits.length,
        identifiedUnitCount: domUnits.length,
        rawAddress: building?.address?.streetAddress ?? null,
        specialOfferText: offerBlock?.text ?? null,
        specialOffers: offerBlock?.items ?? null,
        rentalCostCalculator: calculator,
      };
    }

    return null;
  }

  return null;
}

/**
 * Read the building page's own DOM-rendered building name. Scoped to the
 * building header root only so it never picks up "Similar apartments" /
 * "Nearby apartments" / footer copy. Returns null when no reliable match.
 */
function readZillowBuildingNameFromDOM() {
  if (typeof document === 'undefined') return null;
  const doc = document;
  const HEADER_SELECTORS = [
    '[data-test-id="building-name"]',
    '[data-testid="building-name"]',
    'header h1',
    'h1',
  ];
  let headerRoot = null;
  let nameEl = null;
  for (const sel of HEADER_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent || '').trim()) {
      headerRoot = el.closest('section') || el.closest('article') || el.parentElement || el;
      nameEl = el;
      break;
    }
  }
  if (!headerRoot || !nameEl) return null;
  const rootText = (headerRoot.textContent || '').toLowerCase();
  if (rootText.includes('similar apartments')
      || rootText.includes('nearby apartments')
      || rootText.includes('other apartments you might')) {
    return null;
  }
  const txt = (nameEl.textContent || '').trim();
  if (!txt || txt.length > 200) return null;
  return txt;
}

/**
 * Read the building page's own DOM-rendered address. Strictly scoped to the
 * building header so the value matches the current listing — never pollutes
 * from "Similar" modules or footers. Returns null when no reliable match.
 */
function readZillowBuildingAddressFromDOM() {
  if (typeof document === 'undefined') return null;
  const doc = document;
  const addressEl = doc.querySelector('[data-test-id="building-address"]')
    || doc.querySelector('[data-testid="building-address"]')
    || doc.querySelector('.building-address');
  if (!addressEl) return null;
  let p = addressEl.parentElement;
  for (let i = 0; p && i < 6; i += 1) {
    const pt = (p.textContent || '').toLowerCase();
    if (pt.includes('similar apartments')
        || pt.includes('nearby apartments')
        || pt.includes('other apartments you might')) {
      return null;
    }
    p = p.parentElement;
  }
  const txt = (addressEl.textContent || '').trim();
  if (!txt || txt.length > 400) return null;
  return txt;
}

/**
 * Read real, rendered floor-plan roll-ups from the Building page DOM.
 *
 * STRICTLY read from the page's floor-plan UI (e.g. "Floor plans" section /
 * data-test-id floor-plan card). NEVER derive / fabricate from
 * `availableUnits` rows or unit table data. Returns null when the page has
 * no visible floor-plan section — guard will then keep blocked.
 */
function readZillowFloorPlanSummariesFromDOM() {
  if (typeof document === 'undefined') return null;
  const doc = document;

  // Locate the floor-plan section root. Multiple Zillow variants exist, so we
  // accept any of these hooks as the start of a real floor-plan block.
  const SECTION_HOOKS = [
    '[data-test-id="floorplan-section"]',
    '[data-testid="floorplan-section"]',
    '[data-test-id="floor-plans"]',
    '[data-testid="floor-plans"]',
    'section[aria-label*="loor" i][aria-label*="lan" i]',
  ];
  let sectionRoot = null;
  for (const sel of SECTION_HOOKS) {
    const el = doc.querySelector(sel);
    if (el) { sectionRoot = el; break; }
  }
  if (!sectionRoot) {
    // Fallback: heading-based scoping.
    const heading = [...doc.querySelectorAll('h1, h2, h3, h4')]
      .find((h) => /^\s*floor\s*plans?\s*$/i.test((h.textContent || '').trim()));
    if (heading) sectionRoot = heading.parentElement;
  }
  if (!sectionRoot) return null;

  const rootText = (sectionRoot.textContent || '').toLowerCase();
  if (rootText.length > 200_000) return null; // sanity cap

  // Each plan card exposes name + price range (+optional beds/baths/sqft).
  const CARD_SELECTORS = [
    '[data-test-id="floorplan-card"]',
    '[data-testid="floorplan-card"]',
    '[data-test-id="floor-plan-card"]',
    '[data-testid="floor-plan-card"]',
    '[class*="FloorplanCard" i]',
    '[class*="floorplan-card" i]',
  ];
  const summarySelector = CARD_SELECTORS.join(',');

  const cards = [...sectionRoot.querySelectorAll(summarySelector)];
  if (cards.length === 0) return null;

  const readNumber = (root, key) => {
    const el = root.querySelector(`[data-test="${key}"]`)
      || root.querySelector(`[data-testid="${key}"]`);
    if (!el) return null;
    const m = (el.textContent || '').replace(/[^0-9.]/g, '');
    if (!m) return null;
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  };

  const readPriceRange = (root) => {
    // Match "$X – $Y/mo" or "$X–$Y" inside the card.
    const priceText = (root.textContent || '');
    const m = priceText.match(/\$\s*([0-9][0-9,]*)\s*[–-]\s*\$\s*([0-9][0-9,]*)/);
    if (m) {
      const lo = Number(m[1].replace(/,/g, ''));
      const hi = Number(m[2].replace(/,/g, ''));
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        return { min: lo, max: hi, same: lo === hi };
      }
    }
    const single = priceText.match(/\$\s*([0-9][0-9,]*)/);
    if (single) {
      const n = Number(single[1].replace(/,/g, ''));
      if (Number.isFinite(n)) return { min: n, max: null, same: false };
    }
    return null;
  };

  const seen = new Set();
  const summaries = [];
  for (const card of cards) {
    const nameEl = card.querySelector('h2, h3, [data-test-id="plan-name"], [data-testid="plan-name"]');
    const planName = nameEl ? (nameEl.textContent || '').trim() : null;
    const beds = readNumber(card, 'bedrooms') ?? readNumber(card, 'beds');
    const baths = readNumber(card, 'bathrooms') ?? readNumber(card, 'baths');
    const sqft = readNumber(card, 'sqft') ?? readNumber(card, 'squareFootage');
    const price = readPriceRange(card);
    if (!planName || !price || price.min == null) continue;
    const key = `${planName}|${beds ?? ''}|${baths ?? ''}|${sqft ?? ''}|${price.min ?? ''}|${price.max ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    summaries.push({
      planName,
      bedrooms: beds ?? null,
      bathrooms: baths ?? null,
      sqft: sqft ?? null,
      minPrice: price.min,
      maxPrice: price.max ?? price.min,
      unitCount: null,
      source: 'dom.floorplan-card',
    });
  }
  return summaries.length > 0 ? summaries : null;
}

/**
 * Standalone DOM-only patch for Zillow Building pages.
 *
 * Used when __NEXT_DATA__ is unavailable or has no floorPlans.
 * Clears the dirty monthlyRent / bedrooms / bathrooms / sqft that
 * the generic extraction incorrectly populated.
 *
 * Non-destructive contract:
 *   - Only fills fields that are missing/null on the source listingData.
 *   - buildingName / buildingAddress come from the page's own DOM header.
 *   - floorPlanSummaries come strictly from the page's rendered floor-plan
 *     section; NEVER derived from availableUnits. Falls back to null when
 *     the page has no visible floor-plan block.
 *   - Existing valid values passed in via `existingResult` are preserved by
 *     the caller (this builder only emits its observed DOM values; the
 *     caller merges).
 *
 * Returns null when the unit table is not present on the page.
 */
function buildZillowBuildingPatchFromDOM() {
  const domUnits = extractZillowAvailableUnitsFromDOM();
  if (domUnits.length === 0) return null;

  const domBuildingName = readZillowBuildingNameFromDOM();
  const domBuildingAddress = readZillowBuildingAddressFromDOM();
  const domFloorPlanSummaries = readZillowFloorPlanSummariesFromDOM();
  const offerBlock = extractZillowBuildingSpecialOffer();
  const calculator = extractZillowRentalCostCalculator();

  return {
    listingScope: 'multi_unit_building',
    // Caller merges with non-destructive semantics — emit whatever the page
    // explicitly rendered. Null when not present.
    buildingName: domBuildingName,
    buildingId: null,
    buildingAddress: domBuildingAddress,
    zpid: null,
    unitNumber: null,
    hdpUrl: null,
    selectedUnit: null,
    monthlyRent: null,
    baseRent: null,
    sqft: null,
    bedrooms: null,
    bathrooms: null,
    listPriceIncludesRequiredMonthlyFees: null,
    floorPlanSummaries: domFloorPlanSummaries,
    availableUnits: domUnits,
    availableUnitCount: domUnits.length,
    identifiedUnitCount: domUnits.length,
    rawAddress: domBuildingAddress,
    specialOfferText: offerBlock?.text ?? null,
    specialOffers: offerBlock?.items ?? null,
    rentalCostCalculator: calculator,
  };
}

/**
 * Apply Zillow structured patch on top of an existing extraction result.
 *
 * Rules:
 *   - HARD REQ 1: do NOT touch existingResult.price (string contract "$800/mo").
 *                 monthlyRent is overwritten ONLY when patch.monthlyRent is a number.
 *   - HARD REQ 2: anonymous units (no identity) are NOT emitted; floorPlanSummaries
 *                 still carries the plan info.
 *   - HARD REQ 3: multi_unit_building forces top-level monthlyRent/bedrooms/
 *                 bathrooms/sqft to null; other scopes only overwrite when
 *                 patch has non-null values.
 *   - All existing fields (description, imageUrls, listingType, reportMode,
 *     structuredListing, financials, rentZestimate, leaseTerm, etc.)
 *     are preserved via spread.
 *   - Idempotent. Failure returns the original result.
 */
function applyZillowStructuredOverride(existingResult) {
  if (!existingResult || typeof existingResult !== 'object') return existingResult;
  const url = (existingResult && existingResult.listingUrl)
                || (typeof window !== 'undefined' ? window.location.href : '');
  if (!zillowIsHost(url)) return existingResult;

  let patch = null;

  // Try __NEXT_DATA__ first
  try {
    const nextData = zillowReadNextData();
    if (nextData) {
      patch = zillowBuildPatchFromNextData(nextData, url);

    }
  } catch (_) { /* fall through to DOM */ }

  // Building pages: if __NEXT_DATA__ was absent or returned null,
  // attempt DOM-only patch so the dirty $300 / bedrooms/bathrooms
  // from the generic extraction are still cleared.
  if (!patch) {
    const isBuildingUrl = /\/(apartments|b)\//.test(url);
    if (isBuildingUrl) {
      patch = buildZillowBuildingPatchFromDOM();
    }
  }

  if (!patch) return existingResult;

  const scope = patch.listingScope;
  const isBuilding = scope === 'multi_unit_building';
  const out = { ...existingResult };

  // New fields — non-destructive: keep an existing valid value on the
  // source listingData; only fill when the source is null/undefined and
  // the patch carries a meaningful value. This matches the DOM fallback
  // contract: we never clobber a valid name/address/floorPlanSummaries
  // already extracted upstream.
  out.listingScope = scope;
  const assignIfMissing = (key, patchValue, { nonEmptyArray = false } = {}) => {
    const cur = out[key];
    const curMissing = cur == null
      || (typeof cur === 'string' && cur.trim() === '')
      || (nonEmptyArray && Array.isArray(cur) && cur.length === 0);
    if (curMissing) {
      if (patchValue == null) return;
      if (nonEmptyArray && Array.isArray(patchValue) && patchValue.length === 0) return;
      out[key] = patchValue;
    }
  };
  assignIfMissing('buildingName', patch.buildingName);
  assignIfMissing('buildingId', patch.buildingId);
  assignIfMissing('buildingAddress', patch.buildingAddress);
  out.zpid = patch.zpid;
  out.unitNumber = patch.unitNumber;
  out.hdpUrl = patch.hdpUrl;
  // floorPlanSummaries must come strictly from rendered DOM (or upstream
  // patch); never derive from availableUnits. Keep existing arrays.
  assignIfMissing('floorPlanSummaries', patch.floorPlanSummaries, { nonEmptyArray: true });
  out.availableUnits = patch.availableUnits;
  // availableUnitCount comes from the patch (which already prefers the floor
  // plan roll-up total over the identified-unit count). We only fall back to
  // the existing value when the patch did not provide one (shouldn't happen
  // for building scope, but defensive).
  out.availableUnitCount = patch.availableUnitCount ?? out.availableUnits.length;
  out.identifiedUnitCount = patch.identifiedUnitCount ?? out.availableUnits.length;
  out.selectedUnit = null;
  out.baseRent = patch.baseRent;
  out.listPriceIncludesRequiredMonthlyFees = patch.listPriceIncludesRequiredMonthlyFees;
  // Special offer + rental cost calculator (building scope only — kept as
  // null for single-unit paths).
  if (patch.specialOfferText !== undefined) out.specialOfferText = patch.specialOfferText;
  if (patch.specialOffers !== undefined) out.specialOffers = patch.specialOffers;
  // Only overwrite an existing calculator with the patch when the patch
  // carries a valid, non-null object. A `null` patch (extractor found no
  // calculator block on the page) preserves any calculator we already have
  // from a previous extraction pass, preventing accidental blanks.
  if (patch.rentalCostCalculator && typeof patch.rentalCostCalculator === 'object') {
    out.rentalCostCalculator = patch.rentalCostCalculator;
  }
  // === Rental facts (selected_unit path: patch wins; fall back to existing
  //     DOM facts on listing). building path leaves these null. ===
  if (!isBuilding) {
    if (patch.requiredMonthlyFeeMin !== null && patch.requiredMonthlyFeeMin !== undefined) {
      out.requiredMonthlyFeeMin = patch.requiredMonthlyFeeMin;
    } else if (out.requiredMonthlyFeeMin == null) {
      out.requiredMonthlyFeeMin = null;
    }
    if (patch.requiredMonthlyFeeMax !== null && patch.requiredMonthlyFeeMax !== undefined) {
      out.requiredMonthlyFeeMax = patch.requiredMonthlyFeeMax;
    } else if (out.requiredMonthlyFeeMax == null) {
      out.requiredMonthlyFeeMax = null;
    }
    if (patch.leaseTerm !== null) out.leaseTerm = patch.leaseTerm;
    else if (out.leaseTerm == null) out.leaseTerm = null;
    if (patch.petPolicy !== null) out.petPolicy = patch.petPolicy;
    else if (out.petPolicy == null) out.petPolicy = null;
    if (patch.laundry !== null) out.laundry = patch.laundry;
    else if (out.laundry == null) out.laundry = null;
    if (patch.availabilityStatus !== null) out.availabilityStatus = patch.availabilityStatus;
    else if (out.availabilityStatus == null) out.availabilityStatus = null;
    if (patch.homeType !== null) out.homeType = patch.homeType;
    else if (out.homeType == null) out.homeType = null;
    if (patch.parking !== null) {
      // Non-destructive: do not overwrite an existing number parking count.
      if (out.parking == null || typeof out.parking === 'string') {
        out.parking = patch.parking;
      }
    }
  }
  out.extractionSchemaVersion = 2;

  // Top-level pricing/sizing fix
  if (isBuilding) {
    out.monthlyRent = null;
    out.askingPrice = null;
    out.bedrooms = null;
    out.bathrooms = null;
    out.sqft = null;
    // v6 minimal fix: clear price/priceText/priceAmount so background.js
    // (which always reads listingData.priceText || listingData.price
    //  without knowing about listingScope) does not leak a raw
    // building-page price into optionalDetails.monthlyRent.
    out.price = null;
    out.priceText = null;
    out.priceAmount = null;
    // price (string "$800/mo" etc.) intentionally left untouched (HARD REQ 1).
  } else {
    // HARD REQ 1: number-typed monthlyRent only; do NOT overwrite price string.
    if (patch.monthlyRent !== null) {
      out.monthlyRent = patch.monthlyRent;
      // If existingResult has no price string at all (e.g. no displayPrice),
      // synthesize a display-only string so the UI has something to render.
      // Otherwise leave the existing price string contract intact.
      if (!out.price || typeof out.price !== 'string') {
        out.price = `$${patch.monthlyRent}/mo`;
      }
    }
    if (patch.bedrooms !== null) out.bedrooms = patch.bedrooms;
    if (patch.bathrooms !== null) out.bathrooms = patch.bathrooms;
    if (patch.sqft !== null) out.sqft = patch.sqft;
  }

  // Existing fields (description, imageUrls, images, listingType, reportMode,
  // structuredListing, financials, rentZestimate, leaseTerm, etc.) are
  // preserved by the spread above.
  return out;
}

// ── Mark as ready ──
isReady = true;

})(); // End of IIFE

