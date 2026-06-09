/**
 * HomeScope Content Script
 * Handles page extraction and gallery image collection (user-triggered only).
 * Includes anti-detection measures to avoid Zillow rate limiting.
 */

;
(function () {
  'use strict';

  // Debug logging — always enabled for extension debugging
  const noop = console.log.bind(console, '[HomeScope]');

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

  // ===== Hardened rate limiting with localStorage persistence =====
  // 限制已移除 - 允许无限提取
  const RATE_CONFIG = {
    hardLimitPerHour: 999999,
    // 几乎无限制
    warnThreshold: 999999,
    // 禁用警告
    cooldownMs: 0,
    // 无冷却时间
    storageKey: 'homescope_extraction_log'
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
    const windowStart = Date.now() - 60 * 60 * 1000;
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
        message: `Rate limit reached. Please wait ${Math.ceil(cooldownRemaining / 60000)} minutes before extracting again.`
      };
    }
    if (count >= RATE_CONFIG.hardLimitPerHour) {
      return {
        allowed: false,
        blocked: true,
        cooldownMs: RATE_CONFIG.cooldownMs,
        count,
        message: `You've extracted ${count} properties in the last hour. Please take a break and try again later.`
      };
    }
    if (count >= RATE_CONFIG.warnThreshold) {
      return {
        allowed: true,
        warning: true,
        count,
        message: `You've extracted ${count} properties recently. Zillow may show verification challenges if you continue.`
      };
    }
    return {
      allowed: true,
      warning: false,
      count
    };
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
    '[class*="rc-dosc"]', '[class*="recaptcha"]', 'iframe[src*="recaptcha"]',
    // Zillow-specific challenges
    '[class*="challenge"]', '[class*="captcha"]', '[class*="human"]', '[id*="challenge"]',
    // Generic verification pages
    'iframe[src*="api/anchor"]', '[class*="verify"]'];
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
    if (window.location.href.includes('/challenge/') || window.location.href.includes('/captcha/') || window.location.href.includes('/blocked')) {
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
          clientY: y + jitterY
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
      window.scrollTo({
        top: Math.max(0, Math.floor(targetY)),
        behavior: 'instant'
      });
      await shortDelay(14, 18);
    }
    window.scrollTo({
      top: startScrollY,
      behavior: 'instant'
    });
  }

  // ===== Multi-layer human behavior simulation =====
  async function simulateHumanBehavior() {
    // Layer 1: Random pause before any interaction (500ms - 4s)
    await randomDelay(500, 4000);

    // Layer 2: Slight mouse movement to mimic attention
    const viewportW = Math.max(document.documentElement.clientWidth, window.innerWidth || 800);
    const viewportH = Math.max(document.documentElement.clientHeight, window.innerHeight || 600);
    const fromX = Math.floor(Math.random() * viewportW * 0.3) + viewportW * 0.1;
    const fromY = Math.floor(Math.random() * viewportH * 0.3) + viewportH * 0.1;
    const toX = fromX + Math.floor(Math.random() * 200) - 100;
    const toY = fromY + Math.floor(Math.random() * 150) - 75;
    await simulateMouseMove(fromX, fromY, toX, toY, 600 + Math.random() * 800);

    // Layer 3: Slight scroll with natural speed
    const direction = Math.random() > 0.5 ? 1 : -1;
    const scrollPx = (Math.floor(Math.random() * 200) + 80) * direction;
    await simulateHumanScroll(scrollPx, 800 + Math.random() * 1000);

    // Layer 4: Pause after scroll (simulating reading)
    await randomDelay(300, 2000);
  }

  // ===== Send warning to side panel =====
  function sendWarningToSidePanel(warning) {
    try {
      chrome.runtime.sendMessage({
        type: warning.blocked ? 'RATE_BLOCKED' : 'RATE_WARNING',
        data: warning
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
  const HIDDEN_PRICE_PATTERNS = [/contact\s+agent/i, /price\s+on\s+application/i, /\bpoa\b/i, /\bPOA\b/i, /enquire\s+for\s+price/i, /ask\s+for\s+price/i, /price\s+upon\s+request/i, /tba\b/i, /tbd\b/i, /to\s+be\s+advised/i, /to\s+be\s+announced/i, /auction\s+guide/i, /^$\s*contact\s+agent/i];
  function isHiddenPrice(text) {
    if (!text) return false;
    const normalized = text.replace(/\$[\d,]+/g, '').trim();
    return HIDDEN_PRICE_PATTERNS.some(p => p.test(normalized));
  }

  // ===== Extract data from window.__NEXT_DATA__ or window.__RE_STATE__ =====
  function extractFromWindowState() {
    const result = {
      price: null,
      title: null,
      address: null
    };

    // Method 1: window.__NEXT_DATA__ (Next.js App Router)
    if (window.__NEXT_DATA__) {
      try {
        var _window$__NEXT_DATA__;
        const pageProps = (_window$__NEXT_DATA__ = window.__NEXT_DATA__.props) === null || _window$__NEXT_DATA__ === void 0 ? void 0 : _window$__NEXT_DATA__.pageProps;
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
      var _ref, _obj$price;
      const price = (_ref = (_obj$price = obj.price) !== null && _obj$price !== void 0 ? _obj$price : obj.askingPrice) !== null && _ref !== void 0 ? _ref : obj.lowPrice;
      if (typeof price === 'number' || typeof price === 'string' && /^\$?[\d,]+/.test(price)) {
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
    if (obj['@type'] === 'Residence' || obj['@type'] === 'House' || obj['@type'] === 'Apartment' || obj['@type'] === 'SingleFamilyResidence' || obj['@type'] === 'RealEstateListing' || obj['@type'] === 'Product') {
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
      return {
        price: immediatePrice,
        hidden: false
      };
    }
    if (immediatePrice && isHiddenPrice(immediatePrice)) {
      return {
        price: immediatePrice,
        hidden: true
      };
    }

    // If no immediate price, use polling (MutationObserver may not catch React's rendering)
    return new Promise(resolve => {
      let attempts = 0;
      const maxAttempts = Math.floor(maxWaitMs / intervalMs);
      const tryExtract = () => {
        attempts++;
        const price = extractPriceWithNewLogic();
        if (price) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve({
            price,
            hidden: isHiddenPrice(price)
          });
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve({
            price: null,
            hidden: false,
            timedOut: true
          });
        }
      };

      // Polling interval - this is more reliable than MutationObserver for React apps
      const interval = setInterval(tryExtract, intervalMs);

      // Timeout fallback
      const timeout = setTimeout(() => {
        clearInterval(interval);
        resolve({
          price: null,
          hidden: false,
          timedOut: true
        });
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
            var _offer$price;
            const priceVal = (_offer$price = offer.price) !== null && _offer$price !== void 0 ? _offer$price : offer.lowPrice;
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
    const semanticSelectors = ['.property-info__price',
    // Realestate main price container
    '.property-price',
    // Realestate price element
    '[class*="property-info__price"]',
    // Partial match fallback
    '[class*="property-price"]' // Partial match fallback
    ];
    for (const sel of semanticSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        var _el$textContent;
        const text = ((_el$textContent = el.textContent) === null || _el$textContent === void 0 ? void 0 : _el$textContent.trim()) || '';
        if (/\$[\d,]+/.test(text)) {
          const parent = el.closest('.property-info__middle-content, .listing-details, main, article, [class*="main-listing"]');
          if (parent || els.length === 1) {
            return text;
          }
        }
      }
    }

    // P2b: data-testid selectors
    const selectors = ['[data-testid="price"]', '[data-testid="listing-price"]', '[data-testid="property-price"]', '[data-testid="search-result-price"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        var _el$textContent2;
        const text = ((_el$textContent2 = el.textContent) === null || _el$textContent2 === void 0 ? void 0 : _el$textContent2.trim()) || '';
        if (/\$[\d,]+/.test(text)) {
          return text;
        }
      }
    }

    // P2c: Search all data-testid elements
    const allDataTestId = document.querySelectorAll('[data-testid]');
    for (const el of allDataTestId) {
      var _el$textContent3;
      const text = ((_el$textContent3 = el.textContent) === null || _el$textContent3 === void 0 ? void 0 : _el$textContent3.trim()) || '';
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
    '.property-info__price', '.property-price', '[class*="property-info__price"]', '[class*="property-price"]',
    // data-testid as fallback
    '[data-testid="price"]', '[data-testid="listing-price"]'];
    for (const sel of selectors) {
      const result = queryDeep(document, sel);
      if (result) {
        var _result$textContent;
        const text = ((_result$textContent = result.textContent) === null || _result$textContent === void 0 ? void 0 : _result$textContent.trim()) || '';
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
    const patterns = [/\$\s*[\d,]+(?:\.\d+)?\s*(?:\/\s*(?:week|weekly|pw|w\/k|month|pcm|annum|year))?/gi];
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
      var _el$textContent4;
      const text = ((_el$textContent4 = el.textContent) === null || _el$textContent4 === void 0 ? void 0 : _el$textContent4.trim()) || '';
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
    var _event$data, _event$data2;
    // Only accept messages from the page (same window instance)
    if (event.source !== window) {
      return;
    }

    // Validate message source
    if (((_event$data = event.data) === null || _event$data === void 0 ? void 0 : _event$data.source) !== 'homescope-auth-bridge') {
      return;
    }
    if (((_event$data2 = event.data) === null || _event$data2 === void 0 ? void 0 : _event$data2.type) === 'HOMESCOPE_SYNC_SESSION') {
      chrome.runtime.sendMessage({
        action: 'sync_session_from_site',
        payload: event.data.payload
      }, response => {
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
          success: (response === null || response === void 0 ? void 0 : response.success) !== false,
          error: (response === null || response === void 0 ? void 0 : response.error) || null
        }, event.origin);
      });
    }
  }

  // ── Message handler ──
  function handleMessage(message, sender, sendResponse) {
    const {
      action
    } = message;
    switch (action) {
      case 'PONG':
        // Always respond with this instance's ID
        sendResponse({
          ready: true,
          instanceId: INSTANCE_ID,
          url: window.location.href,
          title: document.title
        });
        break;
      case 'GET_PAGE_STATE':
        sendResponse(getPageState());
        break;
      case 'EXTRACT_LISTING':
        extractListingDataLight().then(({
          listing,
          detection
        }) => {
          pageData = listing;
          sendResponse({
            data: listing,
            error: null,
            detection
          });
        }).catch(err => {
          sendResponse({
            data: null,
            error: err.message,
            detection: null
          });
        });
        return true;
      case 'START_USER_EXTRACTION':
        noop('[DIAG] START_USER_EXTRACTION received, bypassCache:', message.bypassCache);
        // Pre-check rate limit BEFORE starting extraction (avoids wasted work)
        const preRateCheck = checkRateLimit();
        if (!preRateCheck.allowed) {
          noop('[DIAG] START_USER_EXTRACTION blocked by rate limit');
          sendResponse({
            success: false,
            error: preRateCheck.message,
            code: 'RATE_LIMIT'
          });
          break;
        }
        noop('[DIAG] START_USER_EXTRACTION: calling runStartUserExtractionOnce');
        runStartUserExtractionOnce({
          bypassCache: message.bypassCache,
          analysisType: message.analysisType
        }).then(({
          listing,
          detection
        }) => {
          noop('[DIAG] START_USER_EXTRACTION promise resolved, about to sendResponse');
          pageData = listing;
          sendResponse({
            success: true,
            data: listing,
            detection
          });
          noop('[DIAG] START_USER_EXTRACTION sendResponse called successfully');
        }).catch(err => {
          noop('[DIAG] START_USER_EXTRACTION promise rejected:', err.message, 'code:', err.code);
          sendResponse({
            success: false,
            error: err.message,
            code: err.code || 'EXTRACTION_ERROR'
          });
        });
        return true;
      case 'GET_CACHED_DATA':
        sendResponse({
          success: true,
          data: pageData
        });
        break;
      default:
        sendResponse({
          success: false,
          error: 'UNKNOWN_ACTION'
        });
    }
  }

  // ===== Register listeners =====
  chrome.runtime.onMessage.addListener(handleMessage);
  window.addEventListener('message', handleAuthBridge);

  // ===== User-triggered extraction session state =====

  let isReady = false;
  let pageData = null;
  let propertySignals = null;
  let startUserExtractionInProgress = false;
  let startUserExtractionPromise = null;
  let _galleryWasOpened = false;
  let _galleryOpenedByHomeScope = false;
  let _galleryOpenStartedAt = 0;
  let _originalBodyOverflow = null;
  let _originalHtmlOverflow = null;

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

  async function runStartUserExtractionOnce(options = {}) {
    if (startUserExtractionInProgress && startUserExtractionPromise) {
      console.warn('[HomeScope] START_USER_EXTRACTION already in progress, returning existing promise');
      return await startUserExtractionPromise;
    }

    startUserExtractionInProgress = true;
    startUserExtractionPromise = (async () => {
      try {
        return await startUserExtraction(options.bypassCache === true, options.analysisType);
      } finally {
        startUserExtractionInProgress = false;
        startUserExtractionPromise = null;
        console.log('[HomeScope] START_USER_EXTRACTION lock released');
      }
    })();

    return await startUserExtractionPromise;
  }

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
      var _lightListing$title, _lightListing$address, _lightListing$price, _lightListing$descrip, _listing$description;
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
        lightDetection = {
          canAnalyze: true,
          signals: []
        };
      }
      noop('[DIAG] Light extraction result:', JSON.stringify({
        title: (_lightListing$title = lightListing.title) === null || _lightListing$title === void 0 ? void 0 : _lightListing$title.substring(0, 50),
        address: (_lightListing$address = lightListing.address) === null || _lightListing$address === void 0 ? void 0 : _lightListing$address.substring(0, 50),
        price: (_lightListing$price = lightListing.price) === null || _lightListing$price === void 0 ? void 0 : _lightListing$price.substring(0, 30),
        imageUrlsLen: (lightListing.imageUrls || []).length,
        descriptionLen: ((_lightListing$descrip = lightListing.description) === null || _lightListing$descrip === void 0 ? void 0 : _lightListing$descrip.length) || 0
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

      // ── Step: Wait for page to stabilize after load ──
      noop('[DIAG] startUserExtraction: waiting for page to stabilize...');
      await randomDelay(800, 3000);

      // ── Step: Detect CAPTCHA / challenge early ──
      if (detectZillowChallenge()) {
        sendWarningToSidePanel({
          warning: true,
          message: 'Zillow is showing a verification challenge. Extraction skipped. Please complete the verification and try again.'
        });
        const err = new Error('Zillow verification challenge detected.');
        err.code = 'ZILLOW_CHALLENGE';
        throw err;
      }

      // ── Step: Open gallery with structured result ──
      noop('[DIAG] startUserExtraction: calling openGallery...');

      // parseExpectedPhotoCount from page
      function parseExpectedPhotoCount() {
        const patterns = [/see all (\d+) photos/i, /(\d+)\s+photos?/i, /(\d+)\s+photos?/i];
        const selectors = ['[data-testid="see-all-photos-button"]', '[aria-label*="See all"]', 'button', 'a'];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            const text = (el.textContent || '') + (el.getAttribute('aria-label') || '');
            for (const pat of patterns) {
              const m = text.match(pat);
              if (m) return Number(m[1]) || null;
            }
          }
        }
        return null;
      }

      const expectedCount = parseExpectedPhotoCount();
      noop('[DIAG] startUserExtraction: expected photo count:', expectedCount);

      let openResult = {
        ok: false,
        galleryType: 'none',
        opener: null,
        failureReason: null
      };
      let imageUrls = [];
      let imageExtractionStatus = 'skipped';
      let imageExtractionFailureReason = null;
      let imageExtractionExpectedCount = expectedCount;
      let imageExtractionCollectedCount = 0;

      try {
        try {
          openResult = await openGallery(expectedCount);
        } catch (err) {
          noop('[DIAG] startUserExtraction: openGallery threw:', err.message);
          openResult = {
            ok: false,
            galleryType: 'none',
            opener: null,
            failureReason: err.message
          };
        }

        const galleryType = normalizeGalleryType(openResult.galleryType);
        noop('[DIAG] startUserExtraction: openGallery normalized result:', JSON.stringify({
          ok: openResult.ok,
          galleryType,
          opener: openResult.opener,
          failureReason: openResult.failureReason
        }));

        // ── Step: Simulate human behavior after opening gallery ──
        if (openResult.ok) {
          try {
            await simulateHumanBehavior();
          } catch (err) {
            noop('[DIAG] startUserExtraction: simulateHumanBehavior threw:', err.message);
          }
        }

        // ── Step: Route to appropriate extractor by gallery type ──
        if (openResult.ok && galleryType === 'photoswipe_lightbox') {
          noop('[DIAG] PhotoSwipe detected, using PhotoSwipe extractor');
          try {
            imageUrls = await collectByPhotoSwipePaging(expectedCount);
            imageExtractionStatus = imageUrls.length > 0 ? 'complete' : 'failed';
            imageExtractionFailureReason = imageUrls.length === 0 ? 'PhotoSwipe extraction returned 0 images' : null;
          } catch (err) {
            noop('[DIAG] collectByPhotoSwipePaging threw:', err.message);
            imageExtractionStatus = 'failed';
            imageExtractionFailureReason = err.message;
          }
          noop('[DIAG] PhotoSwipe extraction returned:', imageUrls.length, 'images');
        } else if (openResult.ok && galleryType === 'imx_lightbox_carousel') {
          noop('[DIAG] IMX lightbox carousel detected, using IMX extractor');
          try {
            imageUrls = await collectByImxLightboxCarousel(expectedCount);
            imageExtractionStatus = imageUrls.length > 0 ? 'complete' : 'failed';
            imageExtractionFailureReason = imageUrls.length === 0 ? 'IMX extractor returned 0 images' : null;
          } catch (err) {
            noop('[DIAG] collectByImxLightboxCarousel threw:', err.message);
            imageExtractionStatus = 'failed';
            imageExtractionFailureReason = err.message;
          }
          noop('[DIAG] IMX extraction returned:', imageUrls.length, 'images');
        } else if (openResult.ok && galleryType === 'pure_gallery') {
          noop('[DIAG] Pure gallery detected, using pure gallery extractor');
          try {
            const pureResult = await collectPureGalleryImages(expectedCount);
            imageUrls = pureResult.imageUrls || [];
            if (imageUrls.length > 0) {
              const meetsExpected = expectedCount ? imageUrls.length >= Math.max(expectedCount - 1, 1) : true;
              imageExtractionStatus = meetsExpected ? 'complete' : 'partial';
              imageExtractionFailureReason = null;
            } else {
              imageExtractionStatus = 'failed';
              imageExtractionFailureReason = pureResult.failureReason || 'Pure gallery extractor returned 0 images';
            }
          } catch (err) {
            noop('[DIAG] collectPureGalleryImages threw:', err.message);
            imageExtractionStatus = 'failed';
            imageExtractionFailureReason = err.message;
          }
          noop('[DIAG] Pure gallery extraction returned:', imageUrls.length, 'images');
        } else if (openResult.ok && galleryType === 'hollywood_vertical_wall') {
          noop('[DIAG] Hollywood vertical wall detected, using tile-based extractor');
          try {
            imageUrls = await extractFromHollywoodVerticalWall(expectedCount);
            imageExtractionStatus = imageUrls.length > 0 ? expectedCount && imageUrls.length < expectedCount ? 'partial' : 'complete' : 'failed';
            imageExtractionFailureReason = imageUrls.length === 0 ? 'Hollywood extractor returned 0 images' : imageUrls.length < (expectedCount || 0) ? 'Hollywood extractor collected fewer images than expected' : null;
          } catch (err) {
            noop('[DIAG] extractFromHollywoodVerticalWall threw:', err.message);
            imageExtractionStatus = 'failed';
            imageExtractionFailureReason = err.message;
          }
          noop('[DIAG] Hollywood extraction returned:', imageUrls.length, 'images');
        } else if (openResult.ok && galleryType === 'styled_dialog') {
          if (isImxLightboxOpen()) {
            noop('[DIAG] Styled dialog is IMX, using IMX extractor');
            try {
              imageUrls = await collectByImxLightboxCarousel(expectedCount);
              imageExtractionStatus = imageUrls.length > 0 ? 'complete' : 'failed';
              imageExtractionFailureReason = imageUrls.length === 0 ? 'IMX extractor returned 0 images' : null;
            } catch (err) {
              noop('[DIAG] collectByImxLightboxCarousel threw:', err.message);
              imageExtractionStatus = 'failed';
              imageExtractionFailureReason = err.message;
            }
          } else if (getZillowMediaWallTiles?.().length > 0) {
            noop('[DIAG] Styled dialog has media wall tiles, using Hollywood extractor');
            try {
              imageUrls = await extractFromHollywoodVerticalWall(expectedCount);
              imageExtractionStatus = imageUrls.length > 0 ? 'partial' : 'failed';
              imageExtractionFailureReason = imageUrls.length === 0 ? 'Hollywood extractor returned 0 images' : null;
            } catch (err) {
              noop('[DIAG] extractFromHollywoodVerticalWall threw:', err.message);
              imageExtractionStatus = 'failed';
              imageExtractionFailureReason = err.message;
            }
          } else {
            noop('[DIAG] Styled dialog detected but no known photo structure found');
            imageUrls = [];
            imageExtractionStatus = 'failed';
            imageExtractionFailureReason = 'Styled dialog has no IMX or Hollywood structure';
          }
          noop('[DIAG] Styled dialog extraction returned:', imageUrls.length, 'images');
        } else {
          noop('[DIAG] Gallery could not be opened in Photos mode');
          imageExtractionStatus = 'failed';
          imageExtractionFailureReason = openResult.failureReason || 'Gallery could not be opened in Photos mode';
          try {
            imageUrls = await extractImagesFromPageDataZillow();
            if (imageUrls.length > 0) {
              imageExtractionStatus = 'partial';
              imageExtractionFailureReason = 'Gallery open failed, used page data fallback';
            }
          } catch (_) {}
          noop('[DIAG] Fallback extraction returned:', imageUrls.length, 'images');
        }

        imageExtractionCollectedCount = imageUrls.length;
      } finally {
        const closeResult = await closeGallery(normalizeGalleryType(openResult?.galleryType || 'none'));
        console.log('[Gallery] close result:', closeResult);
        console.log('[Gallery] still open after close?:', isAnyGalleryOpen());
        restoreGentlePageState();
      }

      // ── Step: Build complete listing ──
      const listing = {
        ...lightListing,
        rawText: lightListing?.rawText || document.body.innerText || '',
        yearBuilt: lightListing?.listingFacts?.yearBuilt ?? lightListing?.listingFacts?.evidence?.yearBuilt?.value ?? lightListing?.yearBuilt ?? null,
        imageUrls,
        imageExtractionStatus,
        imageExtractionFailureReason,
        imageExtractionExpectedCount,
        imageExtractionCollectedCount
      };
      noop('[DIAG] Final extraction result:', JSON.stringify({
        imageUrlsCount: listing.imageUrls.length,
        descriptionLen: ((_listing$description = listing.description) === null || _listing$description === void 0 ? void 0 : _listing$description.length) || 0
      }));

      // ── Step: Ensure we have either images OR description ──
      if (listing.imageUrls.length === 0 && !listing.description) {
        const fallbackParts = [listing.title, listing.address].filter(Boolean);
        listing.description = fallbackParts.join(' — ') || 'Property listing';
      }
      const detection = buildPropertyDetection(propertySignals, listing);
      const result = {
        listing,
        detection
      };

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
        const candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
        for (const item of candidates) {
          const type = (item['@type'] || '').toLowerCase();
          const isListing = type.includes('realestate') || type.includes('residence') || type.includes('house') || type.includes('apartment') || type.includes('accommodation') || type.includes(' lodging') || type.includes('offer') || type === 'product' && item.name;
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
      var _json$itemOffered;
      // ---- Title ----
      let title = null;
      if (json.name) title = String(json.name).trim();
      if (!title && json.headline) title = String(json.headline).trim();

      // ---- Address ----
      let address = null;
      // Zillow uses nested structure: itemOffered.address
      const addr = json.address || json.location || ((_json$itemOffered = json.itemOffered) === null || _json$itemOffered === void 0 ? void 0 : _json$itemOffered.address) || null;
      if (addr) {
        if (typeof addr === 'string') {
          address = addr.trim();
        } else if (typeof addr === 'object') {
          const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry].filter(Boolean).map(s => String(s).trim());
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
      const rooms = {
        bedrooms: null,
        bathrooms: null,
        parking: null
      };

      // Handle Zillow's nested structure: itemOffered.numberOfBedrooms
      const propertyInfo = json.itemOffered || json;
      const amenityList = (json.amenityFeature || json.features || []).concat(json.propertyFeature || []).filter(Boolean);
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
      if (rooms.bedrooms == null && propertyInfo.numberOfBedrooms != null) {
        rooms.bedrooms = parseInt(String(propertyInfo.numberOfBedrooms), 10) || null;
      }
      if (rooms.bathrooms == null && propertyInfo.numberOfBathroomsTotal != null) {
        rooms.bathrooms = parseInt(String(propertyInfo.numberOfBathroomsTotal), 10) || null;
      }

      // ---- Description ----
      let description = null;
      if (json.description) {
        const d = String(json.description).trim();
        if (d.length > 50) description = d.slice(0, 5000);
      }
      return {
        title,
        address,
        price,
        rooms,
        description
      };
    } catch (_) {
      return {
        title: null,
        address: null,
        price: null,
        rooms: {
          bedrooms: null,
          bathrooms: null,
          parking: null
        },
        description: null
      };
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
      let mergedRooms = {
        bedrooms: null,
        bathrooms: null,
        parking: null
      };

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
    const patterns = [/\d+\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4},\s*[A-Z]{2,4}\s*\d{4,}/, /\d+\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4},\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/, /[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3},\s*[A-Z]{2,4}\s*\d{4,}/,
    // Chinese-style: Unit 123, Street Name, Suburb, City 123456
    /[\u4e00-\u9fa5]{2,}[\s\S]{0,40}?\d{6}/];
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
    if (urlLower.includes('/rent/') || urlLower.includes('/rental/') || urlLower.includes('/to-rent/')) {
      return 'rent';
    }

    // 买房 URL (通用)
    if (urlLower.includes('/buy/') || urlLower.includes('/for-sale/') || urlLower.includes('/sale/') || urlLower.includes('/sold/')) {
      return 'sale';
    }

    // ========== Zillow 特定检测 ==========
    if (isZillowPage()) {
      // Zillow rent URL
      if (urlLower.includes('zillow.com/rent') || urlLower.includes('for-rent')) {
        return 'rent';
      }

      // Zillow for sale URL patterns
      if (urlLower.includes('homedetails') || urlLower.includes('/condo/') || urlLower.includes('/townhouse/') || urlLower.includes('/lot/') || urlLower.includes('for-sale')) {
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
      annualTaxAmount: null,
      sqft: null,
      daysOnZillow: null,
      schoolRatings: [],
      // Financial details
      taxAssessedValue: null,
      taxAssessedValueAmount: null,
      pricePerSqft: null,
      pricePerSqftAmount: null,
      dateListed: null,
      availableDate: null,
      financialDetails: null
    };
    try {
      // Method 1: __NEXT_DATA__ componentProps (new Zillow structure)
      const nextDataScript = document.querySelector('script#__NEXT_DATA__');
      if (nextDataScript) {
        var _nextData$props;
        const nextData = JSON.parse(nextDataScript.textContent);
        const pageProps = nextData === null || nextData === void 0 || (_nextData$props = nextData.props) === null || _nextData$props === void 0 ? void 0 : _nextData$props.pageProps;
        const componentProps = pageProps === null || pageProps === void 0 ? void 0 : pageProps.componentProps;

        // Try to find data in gdpClientCache (massive array, search carefully)
        const gdpCache = componentProps === null || componentProps === void 0 ? void 0 : componentProps.gdpClientCache;
        if (gdpCache && typeof gdpCache === 'object') {
          // gdpClientCache is a large object with numeric keys
          // Search for objects with zpid, price, etc.
          for (const key of Object.keys(gdpCache)) {
            const item = gdpCache[key];
            if (item && typeof item === 'object') {
              // Check if this is property data
              if (item.zpid || item.zestimate || item.price) {
                var _item$itemOffered;
                Object.assign(data, extractFieldsFromPropertyData(item));
                // Extract floorSize (sqft) from itemOffered
                if ((_item$itemOffered = item.itemOffered) !== null && _item$itemOffered !== void 0 && (_item$itemOffered = _item$itemOffered.floorSize) !== null && _item$itemOffered !== void 0 && _item$itemOffered.value) {
                  data.sqft = item.itemOffered.floorSize.value;
                }
                break; // Found the main property data
              }
            }
          }
        }

        // Also try to extract from JSON-LD RealEstateListing
        const jsonLdArray = parseJsonLd();
        for (const json of jsonLdArray) {
          const type = (json['@type'] || '').toString().toLowerCase();
          if (type.includes('realestate') || type.includes('product')) {
            var _propertyInfo$floorSi;
            // Extract sqft from floorSize
            const propertyInfo = json.itemOffered || json;
            if ((_propertyInfo$floorSi = propertyInfo.floorSize) !== null && _propertyInfo$floorSi !== void 0 && _propertyInfo$floorSi.value && !data.sqft) {
              data.sqft = propertyInfo.floorSize.value;
            }
            break;
          }
        }
      }

      // Method 2: Look for JSON in script tags (fallback)
      if (!data.zestimate) {
        const scripts = document.querySelectorAll('script[type="application/json"]');
        for (const script of scripts) {
          var _script$id;
          const id = ((_script$id = script.id) === null || _script$id === void 0 ? void 0 : _script$id.toLowerCase()) || '';
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
        const yearMatch = bodyText.match(/(?:Year Built|Built in|Year built)[\s:]*([^\n]{0,20}?)(\d{4})/i);
        if (yearMatch) {
          data.yearBuilt = parseInt(yearMatch[2], 10);
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

        // Extract sqft from text
        if (!data.sqft) {
          const sqftMatch = bodyText.match(/([\d,]+)\s*sq\s*ft/i);
          if (sqftMatch) {
            data.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
          }
        }

        // Extract Price per Sqft
        if (!data.pricePerSqft) {
          const ppsMatch = bodyText.match(/\$\s*([\d,]+)\s*(?:\/|per)\s*sq\.?\s*ft/i);
          if (ppsMatch) {
            const ppsNum = parseInt(ppsMatch[1].replace(/,/g, ''), 10);
            data.pricePerSqft = '$' + ppsNum + '/sqft';
            data.pricePerSqftAmount = ppsNum;
          }
        }

        // Extract Tax Assessed Value
        if (!data.taxAssessedValue) {
          const tavMatch = bodyText.match(/Tax Assessed Value[\s:]*\$([\d,]+)/i);
          if (tavMatch) {
            const tavNum = parseInt(tavMatch[1].replace(/,/g, ''), 10);
            data.taxAssessedValue = '$' + tavNum.toLocaleString();
            data.taxAssessedValueAmount = tavNum;
          }
        }

        // Extract Date Listed
        if (!data.dateListed) {
          const dlMatch = bodyText.match(/Listed on\s*[:]?\s*(.*?\d{4})/i);
          if (dlMatch) {
            data.dateListed = dlMatch[1].trim();
          }
        }

        // Extract Available Date
        if (!data.availableDate) {
          const avMatch = bodyText.match(/(?:Available|Move-in|Available by)[\s:]*\s*(.*?\d{4}|\w+ \d{1,2},? \d{4})/i);
          if (avMatch) {
            data.availableDate = avMatch[1].trim();
          }
        }
      }
    } catch (e) {
      // Silently handle errors
    }

    // Build financialDetails from all accumulated values
    const financial = {};
    if (data.taxAssessedValue) financial.taxAssessedValueDisplay = data.taxAssessedValue;
    if (data.taxAssessedValueAmount) financial.taxAssessedValue = data.taxAssessedValueAmount;
    if (data.pricePerSqft) financial.pricePerSqftDisplay = data.pricePerSqft;
    if (data.pricePerSqftAmount) financial.pricePerSqft = data.pricePerSqftAmount;
    if (data.dateListed) financial.dateListed = data.dateListed;
    if (data.availableDate) financial.availableDate = data.availableDate;
    if (data.propertyTax) financial.propertyTaxDisplay = data.propertyTax;
    if (data.annualTaxAmount) financial.annualTaxAmount = data.annualTaxAmount;
    if (Object.keys(financial).length > 0) {
      data.financialDetails = financial;
    }
    console.log('[ZillowExtractor] financialDetails', JSON.stringify(financial));
    return data;
  }

  /**
   * Parse a money string into a structured value object.
   * Handles: $0, N/A, Not included, /sqft, /mo variants.
   * Uses value != null checks — never !value — because $0 is a valid value.
   */
  function parseMoney(raw) {
    if (!raw || typeof raw !== 'string') {
      return {
        raw: String(raw !== null && raw !== void 0 ? raw : ''),
        value: null,
        status: 'unknown'
      };
    }
    const s = raw.trim();
    if (s === '' || s === 'N/A' || s === 'n/a') {
      return {
        raw: s,
        value: null,
        status: 'not_applicable'
      };
    }
    if (s === 'Not included' || s === 'not included') {
      return {
        raw: s,
        value: null,
        status: 'not_included'
      };
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
      return {
        raw: s,
        value: null,
        status: 'unknown'
      };
    }
    return {
      raw: s,
      value,
      status: 'known',
      ...(period ? {
        period
      } : {})
    };
  }

  function collectListingRawSources() {
    const bodyText = document.body.innerText || '';
    const jsonLd = parseJsonLd();
    const appJsonScripts = Array.from(document.querySelectorAll('script[type="application/json"]')).slice(0, 10);
    const domSnapshots = {
      h1: document.querySelector('h1')?.innerText?.trim() || '',
      title: document.title || '',
      price: Array.from(document.querySelectorAll('span, div')).map(el => el.innerText?.trim()).find(text => /^\$[\d,]+$/.test(text || '')) || ''
    };
    return {
      bodyText,
      title: document.title || '',
      url: window.location.href,
      jsonLd,
      scriptTagCount: appJsonScripts.length,
      domSnapshots
    };
  }

  function buildRawSourcesSummary(rawSources) {
    return {
      bodyTextSample: (rawSources?.bodyText || '').slice(0, 500),
      title: rawSources?.title || '',
      url: rawSources?.url || window.location.href,
      jsonLdCount: Array.isArray(rawSources?.jsonLd) ? rawSources.jsonLd.length : 0,
      scriptTagCount: rawSources?.scriptTagCount || 0,
      domSnapshots: rawSources?.domSnapshots || {}
    };
  }

  function makeFactEvidence(value, source, rawText, confidence) {
    if (value == null || value === '') return null;
    return {
      value,
      source,
      rawText: rawText || undefined,
      confidence
    };
  }

  function parseOptionalNumericValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value).match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeYearBuilt(year) {
    const value = parseOptionalNumericValue(year);
    if (value == null) return null;
    const currentYear = new Date().getFullYear() + 1;
    if (value < 1700 || value > currentYear) return null;
    return Math.round(value);
  }

  function extractYearBuiltCandidateFromText(text) {
    if (!text) return null;
    const normalizedText = String(text)
      .replace(/[\u00a0\u202f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const patterns = [
      /Built\s+in\s+(\d{4})/i,
      /Year\s*built[^\d]{0,20}(\d{4})/i,
      /yearBuilt\s*[:=]\s*["']?(\d{4})["']?/i,
      /year_built\s*[:=]\s*["']?(\d{4})["']?/i,
      /Construction\s+year[^\d]{0,20}(\d{4})/i,
      /Built\s*:?\s*(\d{4})/i
    ];
    for (const re of patterns) {
      const match = normalizedText.match(re);
      if (!match) continue;
      const rawYear = match.slice(1).reverse().find(Boolean);
      if (!rawYear) continue;
      const year = normalizeYearBuilt(rawYear);
      if (year != null) {
        return makeFactEvidence(year, 'bodyText', match[0], /Built\s+in/i.test(match[0]) ? 0.95 : 0.9);
      }
    }
    return null;
  }

  function extractYearBuiltCandidateFromDom() {
    const selectors = [
      '[data-testid="home-details-chip-container"]',
      '[data-testid="fact-container"]',
      '[data-testid="structured-facts-container"]',
      '[data-testid="facts-and-features"]',
      'section',
      'main'
    ];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 20);
      for (const node of nodes) {
        const text = node?.innerText || '';
        const candidate = extractYearBuiltCandidateFromText(text);
        if (candidate?.value != null) {
          return {
            ...candidate,
            source: 'domText'
          };
        }
      }
    }
    return null;
  }

  function extractPricePerSqftCandidateFromText(text) {
    if (!text) return null;
    const match = text.match(/\$\s*([\d,]+)\s*(?:price\s*\/\s*sqft|\/\s*sqft|per\s*sq\.?\s*ft)/i);
    if (!match || !match[1]) return null;
    const value = parseOptionalNumericValue(match[1]);
    if (value == null) return null;
    return makeFactEvidence(value, 'bodyText', match[0], 0.9);
  }

  function collectFactConflict(conflicts, field, candidates, winner, reason) {
    if (!Array.isArray(candidates) || candidates.length < 2) return;
    const values = candidates.map(candidate => candidate?.value).filter(value => value != null);
    const unique = Array.from(new Set(values.map(value => JSON.stringify(value)))).map(key => JSON.parse(key));
    if (unique.length < 2) return;
    conflicts.push({
      field,
      values: unique,
      winner,
      reason,
      note: reason
    });
  }

  function pickFactCandidate(field, candidates, conflicts, reason) {
    const valid = candidates.filter(Boolean);
    if (valid.length === 0) return null;
    const winner = valid[0];
    collectFactConflict(conflicts, field, valid, winner.value, reason || 'priority_order');
    return winner;
  }

  function buildZillowListingFacts(rawSources, listing) {
    const conflicts = [];
    const evidence = {};
    const bodyText = rawSources?.bodyText || '';
    const zillowFinancials = listing?.zillowFinancials || {};
    const annualTaxCandidate = pickFactCandidate('annualTax', [makeFactEvidence(zillowFinancials?.financialDetails?.annualTaxAmount?.value ?? listing?.annualTaxAmount ?? null, zillowFinancials?.financialDetails?.annualTaxAmount?.value != null ? 'structured' : 'fallback', zillowFinancials?.financialDetails?.annualTaxAmount?.raw || listing?.propertyTax || '', zillowFinancials?.financialDetails?.annualTaxAmount?.value != null ? 0.96 : 0.7)], conflicts, 'financial_then_fallback');
    const pricePerSqftCandidate = pickFactCandidate('pricePerSqft', [makeFactEvidence(zillowFinancials?.financialDetails?.pricePerSqft?.value ?? listing?.pricePerSqftAmount ?? null, zillowFinancials?.financialDetails?.pricePerSqft?.value != null ? 'structured' : 'fallback', zillowFinancials?.financialDetails?.pricePerSqft?.raw || listing?.pricePerSqft || '', zillowFinancials?.financialDetails?.pricePerSqft?.value != null ? 0.96 : 0.75), extractPricePerSqftCandidateFromText(bodyText)], conflicts, 'structured_then_bodyText');
    const monthlyPaymentCandidate = pickFactCandidate('estimatedMonthlyPayment', [makeFactEvidence(zillowFinancials?.monthlyPayment?.estimatedMonthlyPayment?.value ?? zillowFinancials?.topEstimatedPayment?.value ?? null, zillowFinancials?.monthlyPayment?.estimatedMonthlyPayment?.value != null ? 'structured' : 'bodyText', zillowFinancials?.monthlyPayment?.estimatedMonthlyPayment?.raw || zillowFinancials?.topEstimatedPayment?.raw || '', 0.95)], conflicts, 'structured_monthly_payment');
    const principalAndInterestCandidate = pickFactCandidate('principalAndInterest', [makeFactEvidence(zillowFinancials?.monthlyPayment?.principalAndInterest?.value ?? null, 'structured', zillowFinancials?.monthlyPayment?.principalAndInterest?.raw || '', 0.95)], conflicts, 'structured_monthly_payment');
    const propertyTaxesMonthlyCandidate = pickFactCandidate('propertyTaxesMonthly', [makeFactEvidence(zillowFinancials?.monthlyPayment?.propertyTaxes?.value ?? zillowFinancials?.derived?.propertyTaxMonthlyFromAnnual?.value ?? null, zillowFinancials?.monthlyPayment?.propertyTaxes?.value != null ? 'structured' : 'fallback', zillowFinancials?.monthlyPayment?.propertyTaxes?.raw || zillowFinancials?.derived?.propertyTaxMonthlyFromAnnual?.raw || '', zillowFinancials?.monthlyPayment?.propertyTaxes?.value != null ? 0.95 : 0.85)], conflicts, 'monthly_tax_then_derived');
    const homeInsuranceCandidate = pickFactCandidate('homeInsuranceMonthly', [makeFactEvidence(zillowFinancials?.monthlyPayment?.homeInsurance?.value ?? null, 'structured', zillowFinancials?.monthlyPayment?.homeInsurance?.raw || '', 0.95)], conflicts, 'structured_monthly_payment');
    const hoaAmountCandidate = pickFactCandidate('hoaAmount', [makeFactEvidence(zillowFinancials?.monthlyPayment?.hoaFees?.value ?? parseOptionalNumericValue(listing?.hoaFee) ?? null, zillowFinancials?.monthlyPayment?.hoaFees?.value != null ? 'structured' : 'fallback', zillowFinancials?.monthlyPayment?.hoaFees?.raw || String(listing?.hoaFee || ''), zillowFinancials?.monthlyPayment?.hoaFees?.value != null ? 0.95 : 0.75)], conflicts, 'structured_then_fallback');
    const yearlyBuiltFromDom = extractYearBuiltCandidateFromDom();
    const yearBuiltCandidate = pickFactCandidate('yearBuilt', [makeFactEvidence(normalizeYearBuilt(listing?.yearBuilt), listing?.yearBuilt != null ? 'structured' : 'fallback', listing?.yearBuilt != null ? String(listing.yearBuilt) : '', listing?.yearBuilt != null ? 0.96 : 0.6), yearlyBuiltFromDom, extractYearBuiltCandidateFromText(bodyText)], conflicts, 'structured_then_dom_then_bodyText');
    evidence.yearBuilt = yearBuiltCandidate;
    evidence.priceValue = makeFactEvidence(listing?.priceValue ?? null, listing?.priceValue != null ? 'structured' : 'fallback', listing?.price || '', listing?.priceValue != null ? 0.98 : 0.5);
    evidence.address = makeFactEvidence(listing?.address || null, listing?.address ? 'dom' : 'fallback', rawSources?.domSnapshots?.h1 || listing?.address || '', listing?.address ? 0.95 : 0.5);
    evidence.beds = makeFactEvidence(listing?.beds ?? listing?.bedrooms ?? null, listing?.beds != null || listing?.bedrooms != null ? 'structured' : 'fallback', '', 0.92);
    evidence.baths = makeFactEvidence(listing?.baths ?? listing?.bathrooms ?? null, listing?.baths != null || listing?.bathrooms != null ? 'structured' : 'fallback', '', 0.92);
    evidence.sqft = makeFactEvidence(listing?.sqft ?? null, listing?.sqft != null ? 'structured' : 'fallback', '', 0.92);
    evidence.propertyType = makeFactEvidence(listing?.propertyType || null, listing?.propertyType ? 'structured' : 'fallback', listing?.propertyType || '', listing?.propertyType ? 0.88 : 0.5);
    evidence.pricePerSqft = pricePerSqftCandidate;
    evidence.estimatedMonthlyPayment = monthlyPaymentCandidate;
    evidence.principalAndInterest = principalAndInterestCandidate;
    evidence.propertyTaxesMonthly = propertyTaxesMonthlyCandidate;
    evidence.homeInsuranceMonthly = homeInsuranceCandidate;
    evidence.hoaAmount = hoaAmountCandidate;
    evidence.annualTax = annualTaxCandidate;
    const facts = {
      sourceDomain: 'zillow.com',
      url: rawSources?.url || window.location.href,
      capturedAt: new Date().toISOString(),
      address: listing?.address || null,
      priceValue: listing?.priceValue ?? null,
      priceDisplay: listing?.price || listing?.askingPrice || null,
      beds: listing?.beds ?? listing?.bedrooms ?? null,
      baths: listing?.baths ?? listing?.bathrooms ?? null,
      sqft: listing?.sqft ?? null,
      lotSizeDisplay: listing?.lotSize || null,
      yearBuilt: yearBuiltCandidate?.value ?? null,
      propertyType: listing?.propertyType || null,
      pricePerSqft: pricePerSqftCandidate?.value ?? null,
      estimatedMonthlyPayment: monthlyPaymentCandidate?.value ?? null,
      principalAndInterest: principalAndInterestCandidate?.value ?? null,
      propertyTaxesMonthly: propertyTaxesMonthlyCandidate?.value ?? null,
      homeInsuranceMonthly: homeInsuranceCandidate?.value ?? null,
      hoaAmount: hoaAmountCandidate?.value ?? null,
      annualTax: annualTaxCandidate?.value ?? null,
      floodZone: zillowFinancials?.floodZone || null,
      description: listing?.description || null,
      specialFeatures: Array.isArray(listing?.features) ? listing.features : [],
      schools: Array.isArray(zillowFinancials?.schoolRatings) ? zillowFinancials.schoolRatings : [],
      evidence,
      conflicts,
      rawSourcesSummary: buildRawSourcesSummary(rawSources)
    };
    console.log('[LISTING_FACTS_EXTRACTED]', {
      yearBuilt: facts.yearBuilt,
      priceValue: facts.priceValue,
      sqft: facts.sqft,
      annualTax: facts.annualTax,
      pricePerSqft: facts.pricePerSqft,
      evidence: {
        yearBuilt: facts.evidence?.yearBuilt || null,
        annualTax: facts.evidence?.annualTax || null,
        pricePerSqft: facts.evidence?.pricePerSqft || null
      },
      conflicts: facts.conflicts
    });
    return facts;
  }

  /**
   * Extract Zillow financial data (monthly payment breakdown, financial details)
   * from document.body.innerText using line-based section-bound extraction.
   * Does NOT use Zillow class names — only text patterns.
   * Only activates on Zillow US sale pages.
   */
  function extractZillowFinancialsFromBodyText() {
    var _inlineFinancial$Pric, _inlineFinancial$Tax, _inlineFinancial$Annu, _inlineFinancial$Date, _nextLineMonthly$Esti, _nextLineMonthly$Prin, _nextLineMonthly$Mort, _nextLineMonthly$Prop, _nextLineMonthly$Home, _nextLineMonthly$HOA, _nextLineMonthly$Util, _financialDetails$ann;
    const raw = document.body.innerText || '';
    const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);

    // Step 1: Extract top-level "Est. payment: $X/mo"
    let topEstimatedPayment = null;
    const topMatch = raw.match(/Est\.\s*payment[\s:]*\$?([\d,]+)/i);
    if (topMatch) {
      topEstimatedPayment = parseMoney('$' + topMatch[1] + '/mo');
    }

    // Step 2: Slice "Financial & listing details" section
    const financialEnders = ['Show more', 'Hide', 'Services availability', 'Contact a buyer'];
    let financialSectionLines = [];
    let inFinancial = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === 'Financial & listing details') {
        inFinancial = true;
        continue;
      }
      if (inFinancial && financialEnders.includes(line)) break;
      if (inFinancial) financialSectionLines.push(line);
    }

    // Step 3: Slice "Monthly payment" section
    const monthlyEnders = ['All calculations are estimates', 'Mortgage interest rates', 'Contact a buyer'];
    let monthlySectionLines = [];
    let inMonthly = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === 'Monthly payment') {
        inMonthly = true;
        continue;
      }
      if (inMonthly && monthlyEnders.includes(line)) break;
      if (inMonthly) monthlySectionLines.push(line);
    }

    // Step 4: Parse inline label:value pairs (used in financial section)
    const parseInlineLabelValue = sectionLines => {
      const result = {};
      for (let i = 0; i < sectionLines.length; i++) {
        const colonIdx = sectionLines[i].indexOf(':');
        if (colonIdx > 0) {
          const label = sectionLines[i].slice(0, colonIdx).trim();
          const valueRaw = sectionLines[i].slice(colonIdx + 1).trim();
          if (valueRaw) result[label] = parseMoney(valueRaw);
        }
      }
      return result;
    };

    // Step 5: Parse label\nvalue pairs (used in monthly section)
    const parseNextLineValues = sectionLines => {
      const result = {};
      for (let i = 0; i < sectionLines.length - 1; i++) {
        const curr = sectionLines[i];
        const next = sectionLines[i + 1];
        // Curr has no colon, next has no colon, curr is short → curr is label, next is value
        if (curr.indexOf(':') === -1 && next.indexOf(':') === -1 && curr.length < 60) {
          if (!result[curr]) {
            result[curr] = parseMoney(next);
            i++; // skip the next line (consumed as value)
          }
        }
      }
      return result;
    };
    const inlineFinancial = parseInlineLabelValue(financialSectionLines);
    const nextLineMonthly = parseNextLineValues(monthlySectionLines);
    const financialDetails = {
      pricePerSqft: (_inlineFinancial$Pric = inlineFinancial['Price per square foot']) !== null && _inlineFinancial$Pric !== void 0 ? _inlineFinancial$Pric : null,
      taxAssessedValue: (_inlineFinancial$Tax = inlineFinancial['Tax assessed value']) !== null && _inlineFinancial$Tax !== void 0 ? _inlineFinancial$Tax : null,
      annualTaxAmount: (_inlineFinancial$Annu = inlineFinancial['Annual tax amount']) !== null && _inlineFinancial$Annu !== void 0 ? _inlineFinancial$Annu : null,
      dateOnMarket: (_inlineFinancial$Date = inlineFinancial['Date on market']) !== null && _inlineFinancial$Date !== void 0 ? _inlineFinancial$Date : null
    };
    const monthlyPayment = {
      estimatedMonthlyPayment: (_nextLineMonthly$Esti = nextLineMonthly['Estimated monthly payment']) !== null && _nextLineMonthly$Esti !== void 0 ? _nextLineMonthly$Esti : null,
      principalAndInterest: (_nextLineMonthly$Prin = nextLineMonthly['Principal & interest']) !== null && _nextLineMonthly$Prin !== void 0 ? _nextLineMonthly$Prin : null,
      mortgageInsurance: (_nextLineMonthly$Mort = nextLineMonthly['Mortgage insurance']) !== null && _nextLineMonthly$Mort !== void 0 ? _nextLineMonthly$Mort : null,
      propertyTaxes: (_nextLineMonthly$Prop = nextLineMonthly['Property taxes']) !== null && _nextLineMonthly$Prop !== void 0 ? _nextLineMonthly$Prop : null,
      homeInsurance: (_nextLineMonthly$Home = nextLineMonthly['Home insurance']) !== null && _nextLineMonthly$Home !== void 0 ? _nextLineMonthly$Home : null,
      hoaFees: (_nextLineMonthly$HOA = nextLineMonthly['HOA fees']) !== null && _nextLineMonthly$HOA !== void 0 ? _nextLineMonthly$HOA : null,
      utilities: (_nextLineMonthly$Util = nextLineMonthly['Utilities']) !== null && _nextLineMonthly$Util !== void 0 ? _nextLineMonthly$Util : null
    };

    // Derive knownMonthlyTotal from P&I + insurance + tax + home insurance components
    const knownComponents = [monthlyPayment.principalAndInterest, monthlyPayment.mortgageInsurance, monthlyPayment.propertyTaxes, monthlyPayment.homeInsurance].filter(m => (m === null || m === void 0 ? void 0 : m.status) === 'known' && (m === null || m === void 0 ? void 0 : m.value) != null);
    const sum = knownComponents.reduce((acc, m) => acc + m.value, 0);
    const knownMonthlyTotal = sum > 0 ? sum : null;
    const propertyTaxMonthlyFromAnnual = ((_financialDetails$ann = financialDetails.annualTaxAmount) === null || _financialDetails$ann === void 0 ? void 0 : _financialDetails$ann.status) === 'known' ? Math.round(financialDetails.annualTaxAmount.value / 12) : null;
    return {
      source: 'zillow',
      topEstimatedPayment: topEstimatedPayment !== null && topEstimatedPayment !== void 0 ? topEstimatedPayment : null,
      financialDetails,
      monthlyPayment,
      derived: {
        knownMonthlyTotal: knownMonthlyTotal != null ? {
          raw: '$' + knownMonthlyTotal,
          value: knownMonthlyTotal,
          status: 'known'
        } : null,
        propertyTaxMonthlyFromAnnual: propertyTaxMonthlyFromAnnual != null ? {
          raw: '$' + propertyTaxMonthlyFromAnnual,
          value: propertyTaxMonthlyFromAnnual,
          status: 'known'
        } : null
      }
    };
  }
  function extractZillowListingFromBodyTextV2() {
    var _topSummary$price$lin, _topSummary$price, _financialDetails$ann2, _factsFeatures$sectio, _topSummary$price2, _topSummary$price3, _topSummary$price4, _listing$estimatedPay, _listing$zillowFinanc, _listing$zillowFinanc2;
    const raw = document.body.innerText || '';
    const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
    function findExact(label, start = 0) {
      const lower = label.toLowerCase();
      return lines.findIndex((line, i) => i >= start && line.toLowerCase() === lower);
    }
    function findIncludes(label, start = 0) {
      const lower = label.toLowerCase();
      return lines.findIndex((line, i) => i >= start && line.toLowerCase().includes(lower));
    }
    function parsePlainNumber(rawValue) {
      if (!rawValue) return null;
      const match = String(rawValue).match(/[\d,]+/);
      return match ? Number(match[0].replace(/,/g, '')) : null;
    }
    function parseMoney(rawValue, defaultPeriod = 'unknown') {
      if (!rawValue) return null;
      const clean = String(rawValue).trim();
      if (/^n\/a$/i.test(clean)) {
        return {
          raw: clean,
          value: null,
          status: 'not_applicable',
          period: defaultPeriod
        };
      }
      if (/not included/i.test(clean)) {
        return {
          raw: clean,
          value: null,
          status: 'not_included',
          period: defaultPeriod
        };
      }
      if (/not available|--/i.test(clean)) {
        return {
          raw: clean,
          value: null,
          status: 'unknown',
          period: defaultPeriod
        };
      }
      const match = clean.match(/\$?\s*([\d,]+)/);
      if (!match) {
        return {
          raw: clean,
          value: null,
          status: 'unknown',
          period: defaultPeriod
        };
      }
      let period = defaultPeriod;
      if (/\/\s*mo|per\s*month/i.test(clean)) {
        period = 'monthly';
      } else if (/\/\s*sqft|per\s*square\s*foot/i.test(clean)) {
        period = 'per_sqft';
      }
      return {
        raw: clean,
        value: Number(match[1].replace(/,/g, '')),
        status: 'known',
        period
      };
    }
    function valueAfterLabel(sectionLines, label) {
      const labelLower = label.toLowerCase();
      for (let i = 0; i < sectionLines.length; i++) {
        const line = sectionLines[i];

        // Format: "Annual tax amount: $3,490"
        if (line.toLowerCase().startsWith(labelLower + ':')) {
          return line.slice(line.indexOf(':') + 1).trim();
        }

        // Format:
        // "Property taxes"
        // "$449"
        if (line.toLowerCase() === labelLower) {
          return sectionLines[i + 1] || null;
        }
      }
      return null;
    }
    function sliceBetweenByIndex(startIndex, endLabels) {
      if (startIndex === -1) return [];
      let end = lines.length;
      for (const label of endLabels) {
        const idx = findIncludes(label, startIndex + 1);
        if (idx !== -1 && idx < end) end = idx;
      }
      return lines.slice(startIndex, end);
    }
    function sliceBetweenLabel(startLabel, endLabels, startSearchFrom = 0) {
      const start = findExact(startLabel, startSearchFrom);
      return sliceBetweenByIndex(start, endLabels);
    }
    function extractTopSummary() {
      // Do not use nav "Facts & features" as boundary.
      // Find first standalone listing price line, e.g. "$749,000".
      const priceIndex = lines.findIndex(line => /^\$[\d,]+$/.test(line) && !/\/mo|\/sqft|HOA|Zestimate/i.test(line));
      const priceLine = priceIndex !== -1 ? lines[priceIndex] : null;
      const nearby = priceIndex !== -1 ? lines.slice(priceIndex, priceIndex + 20) : [];
      const addressLine = priceIndex !== -1 ? lines[priceIndex + 1] || null : null;
      function numberBeforeLabel(label) {
        const idx = nearby.findIndex(line => line.toLowerCase() === label.toLowerCase());
        if (idx > 0) return parsePlainNumber(nearby[idx - 1]);
        return null;
      }
      const estPaymentLine = nearby.find(line => /Est\.?\s*payment/i.test(line));
      const estPaymentMatch = estPaymentLine ? estPaymentLine.match(/(?:Est\.?\s*payment|Estimated\s*payment)\s*:?\s*(\$[\d,]+)\s*\/?\s*mo/i) : raw.match(/(?:Est\.?\s*payment|Estimated\s*payment)\s*:?\s*(\$[\d,]+)\s*\/?\s*mo/i);
      return {
        price: priceLine ? {
          raw: priceLine,
          value: Number(priceLine.replace(/[^\d]/g, '')),
          source: 'top_summary',
          lineIndex: priceIndex
        } : null,
        address: addressLine,
        beds: numberBeforeLabel('beds'),
        baths: numberBeforeLabel('baths'),
        sqft: numberBeforeLabel('sqft'),
        estimatedPayment: estPaymentMatch ? {
          ...parseMoney(estPaymentMatch[1] + '/mo', 'monthly'),
          source: 'top_summary'
        } : null,
        debugNearbyLines: nearby
      };
    }
    function extractWhatsSpecial(priceIndex) {
      const start = findExact("What's special", priceIndex || 0);
      if (start === -1) {
        return {
          tags: [],
          description: null,
          debugSection: []
        };
      }

      // Zillow description normally ends at the first "Hide" after What's special.
      const hideIndex = findExact('Hide', start + 1);
      const end = hideIndex !== -1 ? hideIndex : Math.min(lines.length, start + 80);
      const section = lines.slice(start, end);
      const content = section.slice(1);
      const tags = [];
      const descriptionLines = [];
      for (const line of content) {
        const isLikelyTag = /^[A-Z0-9\s&'-]{3,80}$/.test(line) && line.length <= 80 && !/[.!?]$/.test(line);
        if (isLikelyTag && descriptionLines.length === 0) {
          // Some Zillow chips can be merged in innerText like:
          // "GENEROUS BACKYARDFULL KITCHEN"
          // Keep raw first; later we can improve with DOM chip extraction.
          tags.push(line);
        } else {
          descriptionLines.push(line);
        }
      }
      return {
        tags,
        description: descriptionLines.join('\n').trim() || null,
        debugSection: section
      };
    }
    function extractFinancialDetails() {
      const section = sliceBetweenLabel('Financial & listing details', ['Show more', 'Hide', 'Services availability', 'Contact a buyer', 'Monthly payment', 'Nearby schools']);
      return {
        pricePerSqft: parseMoney(valueAfterLabel(section, 'Price per square foot'), 'per_sqft'),
        taxAssessedValue: parseMoney(valueAfterLabel(section, 'Tax assessed value'), 'one_time'),
        annualTaxAmount: parseMoney(valueAfterLabel(section, 'Annual tax amount'), 'annual'),
        dateOnMarket: valueAfterLabel(section, 'Date on market'),
        cumulativeDaysOnMarket: valueAfterLabel(section, 'Cumulative days on market'),
        listingAgreement: valueAfterLabel(section, 'Listing agreement'),
        listingTerms: valueAfterLabel(section, 'Listing terms'),
        tenantPays: valueAfterLabel(section, 'Tenant pays'),
        electricUtilityOnProperty: valueAfterLabel(section, 'Electric utility on property'),
        debugSection: section
      };
    }
    function extractMonthlyPayment() {
      const section = sliceBetweenLabel('Monthly payment', ['All calculations are estimates', 'Mortgage interest rates', 'Contact a buyer', 'Nearby schools', 'Neighborhood']);
      const monthlyPayment = {
        estimatedMonthlyPayment: parseMoney(valueAfterLabel(section, 'Estimated monthly payment'), 'monthly'),
        principalAndInterest: parseMoney(valueAfterLabel(section, 'Principal & interest'), 'monthly'),
        mortgageInsurance: parseMoney(valueAfterLabel(section, 'Mortgage insurance'), 'monthly'),
        propertyTaxes: parseMoney(valueAfterLabel(section, 'Property taxes'), 'monthly'),
        homeInsurance: parseMoney(valueAfterLabel(section, 'Home insurance'), 'monthly'),
        hoaFees: parseMoney(valueAfterLabel(section, 'HOA fees'), 'monthly'),
        utilities: parseMoney(valueAfterLabel(section, 'Utilities'), 'monthly'),
        debugSection: section
      };
      monthlyPayment.derivedKnownMonthlyTotal = [monthlyPayment.principalAndInterest, monthlyPayment.mortgageInsurance, monthlyPayment.propertyTaxes, monthlyPayment.homeInsurance, monthlyPayment.hoaFees, monthlyPayment.utilities].filter(x => x && x.status === 'known' && x.value != null).reduce((sum, x) => sum + x.value, 0);
      return monthlyPayment;
    }
    function extractFactsFeatures() {
      // Do not use nav "Facts & features".
      // Use actual content heading "Interior" as start.
      const interiorIndex = findExact('Interior');
      const factsStart = interiorIndex !== -1 ? interiorIndex : findExact('Bedrooms & bathrooms');
      if (factsStart === -1) {
        return {
          sections: {},
          rawFactsSection: []
        };
      }
      const section = sliceBetweenByIndex(factsStart, ['Financial & listing details', 'Price history', 'Public tax history', 'Monthly payment', 'Nearby schools']);
      const mainHeadings = ['Interior', 'Property', 'Construction', 'Utilities & green energy', 'Community & HOA'];
      const result = {};
      let current = null;
      for (const line of section) {
        if (mainHeadings.includes(line)) {
          current = line;
          result[current] = [];
          continue;
        }
        if (current) {
          result[current].push(line);
        }
      }
      return {
        sections: result,
        rawFactsSection: section
      };
    }
    const topSummary = extractTopSummary();
    const priceIndex = (_topSummary$price$lin = topSummary === null || topSummary === void 0 || (_topSummary$price = topSummary.price) === null || _topSummary$price === void 0 ? void 0 : _topSummary$price.lineIndex) !== null && _topSummary$price$lin !== void 0 ? _topSummary$price$lin : 0;
    const whatsSpecial = extractWhatsSpecial(priceIndex);
    const factsFeatures = extractFactsFeatures();
    const financialDetails = extractFinancialDetails();
    const monthlyPayment = extractMonthlyPayment();
    const zillowFinancials = {
      source: 'zillow',
      askingPrice: topSummary.price,
      topEstimatedPayment: topSummary.estimatedPayment,
      financialDetails: {
        pricePerSqft: financialDetails.pricePerSqft,
        taxAssessedValue: financialDetails.taxAssessedValue,
        annualTaxAmount: financialDetails.annualTaxAmount,
        dateOnMarket: financialDetails.dateOnMarket,
        cumulativeDaysOnMarket: financialDetails.cumulativeDaysOnMarket,
        listingAgreement: financialDetails.listingAgreement,
        listingTerms: financialDetails.listingTerms,
        tenantPays: financialDetails.tenantPays,
        electricUtilityOnProperty: financialDetails.electricUtilityOnProperty
      },
      monthlyPayment: {
        estimatedMonthlyPayment: monthlyPayment.estimatedMonthlyPayment,
        principalAndInterest: monthlyPayment.principalAndInterest,
        mortgageInsurance: monthlyPayment.mortgageInsurance,
        propertyTaxes: monthlyPayment.propertyTaxes,
        homeInsurance: monthlyPayment.homeInsurance,
        hoaFees: monthlyPayment.hoaFees,
        utilities: monthlyPayment.utilities
      },
      derived: {
        knownMonthlyTotal: monthlyPayment.derivedKnownMonthlyTotal || null,
        propertyTaxMonthlyFromAnnual: ((_financialDetails$ann2 = financialDetails.annualTaxAmount) === null || _financialDetails$ann2 === void 0 ? void 0 : _financialDetails$ann2.value) != null ? Math.round(financialDetails.annualTaxAmount.value / 12) : null
      },
      whatsSpecial,
      factsFeatures
    };

    // Extract property type: try Style section, facts, or URL
    let propertyType = null;
    let yearBuiltFromFacts = null;
    if (factsFeatures?.rawFactsSection?.length) {
      const rawFactsText = factsFeatures.rawFactsSection.join(' ');
      const factsYearEvidence = extractYearBuiltCandidateFromText(rawFactsText);
      if (factsYearEvidence?.value != null) {
        yearBuiltFromFacts = factsYearEvidence.value;
      }
    }
    // Try Style section in facts
    if (factsFeatures !== null && factsFeatures !== void 0 && (_factsFeatures$sectio = factsFeatures.sections) !== null && _factsFeatures$sectio !== void 0 && _factsFeatures$sectio['Style']) {
      propertyType = factsFeatures.sections['Style'].join(' ').trim() || null;
    }
    // Try URL-based inference
    if (!propertyType) {
      const urlLower = window.location.href.toLowerCase();
      if (urlLower.includes('/condo/')) propertyType = 'Condo';else if (urlLower.includes('/townhouse/')) propertyType = 'Townhouse';else if (urlLower.includes('/lot/')) propertyType = 'Lot / Land';
    }
    // Try to find property type in facts features
    if (!propertyType && factsFeatures !== null && factsFeatures !== void 0 && factsFeatures.rawFactsSection) {
      const rawFacts = factsFeatures.rawFactsSection.join(' ');
      if (/single\s*family/i.test(rawFacts)) propertyType = 'Single Family Home';else if (/multi\s*family/i.test(rawFacts)) propertyType = 'Multi-Family';else if (/condo/i.test(rawFacts)) propertyType = 'Condo';else if (/townhouse/i.test(rawFacts)) propertyType = 'Townhouse';else if (/apartment/i.test(rawFacts)) propertyType = 'Apartment';else if (/duplex/i.test(rawFacts)) propertyType = 'Duplex';else if (/lot/i.test(rawFacts) || /land/i.test(rawFacts)) propertyType = 'Lot / Land';
    }
    const listing = {
      source: 'zillow',
      sourceDomain: 'zillow.com',
      reportMode: 'sale',
      price: ((_topSummary$price2 = topSummary.price) === null || _topSummary$price2 === void 0 ? void 0 : _topSummary$price2.raw) || null,
      askingPrice: ((_topSummary$price3 = topSummary.price) === null || _topSummary$price3 === void 0 ? void 0 : _topSummary$price3.raw) || null,
      priceValue: ((_topSummary$price4 = topSummary.price) === null || _topSummary$price4 === void 0 ? void 0 : _topSummary$price4.value) || null,
      address: topSummary.address || null,
      bedrooms: topSummary.beds,
      beds: topSummary.beds,
      bathrooms: topSummary.baths,
      baths: topSummary.baths,
      sqft: topSummary.sqft,
      propertySize: topSummary.sqft,
      estimatedPayment: topSummary.estimatedPayment,
      description: whatsSpecial.description,
      features: whatsSpecial.tags,
      propertyType,
      yearBuilt: yearBuiltFromFacts,
      factsFeatures,
      financialDetails,
      monthlyPayment,
      zillowFinancials
    };
    const rawSources = collectListingRawSources();
    if (listing.yearBuilt == null) {
      const fallbackYearEvidence = extractYearBuiltCandidateFromDom() || extractYearBuiltCandidateFromText(rawSources?.bodyText || '');
      if (fallbackYearEvidence?.value != null) {
        listing.yearBuilt = fallbackYearEvidence.value;
      }
    }
    const listingFacts = buildZillowListingFacts(rawSources, listing);
    listing.listingFacts = listingFacts;
    listing.rawSourcesSummary = listingFacts.rawSourcesSummary;
    try {
      window.__HS_LAST_EXTRACTED_DATA__ = listing;
      window.__HOMESCOPE_LAST_EXTRACTED_DATA__ = listing;
      window.__HS_DEBUG_LAST_LISTING__ = listing;
    } catch (_) {}
    return listing;
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
      result.zestimate = typeof data.zestimate === 'number' ? '$' + data.zestimate.toLocaleString() : String(data.zestimate);
    }

    // Rent Zestimate
    if (data.rentZestimate) {
      result.rentZestimate = typeof data.rentZestimate === 'number' ? '$' + data.rentZestimate.toLocaleString() : String(data.rentZestimate);
    }

    // Year Built
    if (data.yearBuilt || data.year_built) {
      result.yearBuilt = data.yearBuilt || data.year_built;
    }

    // Property Type — Zillow uses @type field (e.g. "SingleFamilyResidence", "Condo", "Townhouse")
    // Also accept homeType / propertyType / buildingType variants
    if (data.homeType || data.propertyType || data.home_type || data.property_type || data.buildingType || data.listingType) {
      result.propertyType = data.homeType || data.propertyType || data.home_type || data.property_type || data.buildingType || data.listingType;
    }
    // Also check @type from JSON-LD (normalize to readable format)
    if (data['@type'] && !result.propertyType) {
      const t = String(data['@type']).replace(/([A-Z])/g, ' $1').trim();
      result.propertyType = t;
    }

    // Lot Size
    if (data.lotSize || data.lot_size || data.lotSizeValue) {
      result.lotSize = String(data.lotSize || data.lot_size || data.lotSizeValue);
    }

    // HOA Fee
    if (data.hoaFee || data.hoa_fee) {
      const hoaVal = data.hoaFee || data.hoa_fee;
      result.hoaFee = typeof hoaVal === 'number' ? '$' + hoaVal.toLocaleString() + '/mo' : String(hoaVal);
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
    if (financial.taxAssessedValueDisplay || financial.pricePerSqftDisplay || financial.dateListed || financial.availableDate || result.annualTaxAmount) {
      result.financialDetails = {
        ...financial
      };
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
    // Method 1: data-testid selectors
    const selectors = ['[data-testid="address"]', 'h1[data-testid="address"]', 'address[data-testid="street-address"]', '[class*="address"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        var _el$textContent5;
        const text = ((_el$textContent5 = el.textContent) === null || _el$textContent5 === void 0 ? void 0 : _el$textContent5.trim()) || '';
        if (text.length > 5 && text.length < 300) {
          return text;
        }
      }
    }

    // Method 2: h1 fallback
    const h1 = document.querySelector('h1');
    if (h1) {
      var _h1$textContent;
      const text = ((_h1$textContent = h1.textContent) === null || _h1$textContent === void 0 ? void 0 : _h1$textContent.trim()) || '';
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
    const result = {
      bedrooms: null,
      bathrooms: null,
      sqft: null
    };

    // Method 1: data-testid bed-bath-sqft container
    const bedBathEl = document.querySelector('[data-testid="bed-bath-beyond"]') || document.querySelector('[data-testid="bed-bath-sqft"]') || document.querySelector('[data-testid="hdp-property-details"]');
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
        var _bedEl$textContent;
        const match = (_bedEl$textContent = bedEl.textContent) === null || _bedEl$textContent === void 0 ? void 0 : _bedEl$textContent.match(/(\d+)/);
        if (match) result.bedrooms = parseInt(match[1]);
      }
    }
    if (!result.bathrooms) {
      const bathEl = document.querySelector('[data-testid="bathrooms"]');
      if (bathEl) {
        var _bathEl$textContent;
        const match = (_bathEl$textContent = bathEl.textContent) === null || _bathEl$textContent === void 0 ? void 0 : _bathEl$textContent.match(/(\d+(?:\.\d+)?)/);
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
    var _fromJsonLd$rooms$bed, _fromJsonLd$rooms, _fromJsonLd$rooms$bat, _fromJsonLd$rooms2, _fromJsonLd$rooms$par, _fromJsonLd$rooms3;
    // Zillow V2 extractor — priority path, returns fully-structured listing
    const isZillow = location.hostname.includes('zillow.com');
    if (isZillow) {
      const zillowV2 = extractZillowListingFromBodyTextV2();
      if (zillowV2 !== null && zillowV2 !== void 0 && zillowV2.price || zillowV2 !== null && zillowV2 !== void 0 && zillowV2.zillowFinancials) {
        var _zillowV2$zillowFinan, _zillowV2$zillowFinan2, _zillowV2$zillowFinan3;
        // Enrich V2 listing with compatibility fields that the rest of the pipeline expects
        zillowV2.title = zillowV2.address || null;
        zillowV2.extractionConfidence = 0.95;
        zillowV2.confidence = 0.95;
        return {
          listing: zillowV2,
          detection: buildPropertyDetection(detectPropertySignals(), zillowV2)
        };
      }
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
    const title = (fromJsonLd === null || fromJsonLd === void 0 ? void 0 : fromJsonLd.title) || domTitle || null;
    const address = (fromJsonLd === null || fromJsonLd === void 0 ? void 0 : fromJsonLd.address) || domAddress || null;
    const price = extractedPrice || (fromJsonLd === null || fromJsonLd === void 0 ? void 0 : fromJsonLd.price) || null;
    const rooms = {
      bedrooms: (_fromJsonLd$rooms$bed = fromJsonLd === null || fromJsonLd === void 0 || (_fromJsonLd$rooms = fromJsonLd.rooms) === null || _fromJsonLd$rooms === void 0 ? void 0 : _fromJsonLd$rooms.bedrooms) !== null && _fromJsonLd$rooms$bed !== void 0 ? _fromJsonLd$rooms$bed : domRooms.bedrooms,
      bathrooms: (_fromJsonLd$rooms$bat = fromJsonLd === null || fromJsonLd === void 0 || (_fromJsonLd$rooms2 = fromJsonLd.rooms) === null || _fromJsonLd$rooms2 === void 0 ? void 0 : _fromJsonLd$rooms2.bathrooms) !== null && _fromJsonLd$rooms$bat !== void 0 ? _fromJsonLd$rooms$bat : domRooms.bathrooms,
      parking: (_fromJsonLd$rooms$par = fromJsonLd === null || fromJsonLd === void 0 || (_fromJsonLd$rooms3 = fromJsonLd.rooms) === null || _fromJsonLd$rooms3 === void 0 ? void 0 : _fromJsonLd$rooms3.parking) !== null && _fromJsonLd$rooms$par !== void 0 ? _fromJsonLd$rooms$par : domRooms.parking
    };
    const description = (fromJsonLd === null || fromJsonLd === void 0 ? void 0 : fromJsonLd.description) || domDescription || null;

    // Zillow-specific data
    let zillowData = {
      source: 'zillow'
    };
    if (isZillowPage()) {
      // Use Zillow-specific rooms extraction
      const zillowRooms = extractRoomsZillow();
      if (zillowRooms.bedrooms) rooms.bedrooms = zillowRooms.bedrooms;
      if (zillowRooms.bathrooms) rooms.bathrooms = zillowRooms.bathrooms;

      // Get Zillow-specific fields
      zillowData = extractZillowData();

      // Extract monthly payment breakdown from body text (deterministic, no AI needed)
      const zillowFinancials = extractZillowFinancialsFromBodyText();
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
      source: isZillowPage() ? 'zillow' : {
        url: window.location.href,
        domain: window.location.hostname,
        parserType: 'generic'
      },
      title,
      address,
      price: price || '',
      priceText: price,
      pricePeriod,
      priceHidden: priceHidden || false,
      // Flag for "Price on Application"
      bedrooms: rooms.bedrooms,
      bathrooms: rooms.bathrooms,
      parking: rooms.parking,
      description,
      imageUrls: [],
      // gallery images only collected on user request
      extractionConfidence: confidence,
      // 自动检测房源类型：买房(sale)还是租房(rent)
      reportMode: detectReportMode({
        priceText: price
      }, window.location.href),
      // Include Zillow-specific fields if on Zillow
      ...(isZillowPage() ? {
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
        zillowFinancials: zillowFinancials || null
      } : {})
    };
    const detection = buildPropertyDetection(signals, listing);
    return {
      listing,
      detection
    };
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
      price: signals.hasPrice
    });
    return {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      isPropertyLike: signals.confidence > 0.3,
      extractionStage: 'initial',
      basicSignals: signals,
      basicDetectedSignals: signals,
      detection
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Property signal detection (lightweight DOM scan)
  // ─────────────────────────────────────────────────────────────

  function detectPropertySignals() {
    const signals = [];
    let confidence = 0;
    const images = document.querySelectorAll('img');
    const propertyImages = Array.from(images).filter(img => {
      const src = img.src || img.dataset.src || '';
      return src && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar');
    });
    if (propertyImages.length >= 3) {
      signals.push('images');
      confidence += 0.25;
    } else if (propertyImages.length >= 1) confidence += 0.1;
    const pricePatterns = [/\$\d+/, /\d+[\d,]*\s*(?:per|weekly|week|pw|pcm|month)/i, /(?:price|cost|rent)/i];
    const hasPrice = pricePatterns.some(p => document.body.innerText.match(p));
    if (hasPrice) {
      signals.push('price');
      confidence += 0.2;
    }
    const addressPatterns = [/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s*[A-Z]{2,4}\s*\d{4}/, /\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/];
    const hasAddress = addressPatterns.some(p => document.body.innerText.match(p));
    if (hasAddress) {
      signals.push('address');
      confidence += 0.2;
    }
    const roomPatterns = [/\d+\s*(?:bed|bedroom|bedrooms)/i, /\d+\s*(?:bath|bathroom|bathrooms)/i, /\d+\s*(?:car|parking|garage)/i];
    const roomMatches = roomPatterns.reduce((count, p) => {
      return count + (document.body.innerText.match(p) ? 1 : 0);
    }, 0);
    if (roomMatches >= 2) {
      signals.push('rooms');
      confidence += 0.2;
    } else if (roomMatches >= 1) confidence += 0.1;
    const descSelectors = ['[class*="description"]', '[class*="detail"]', '[class*="content"]', 'p'];
    let hasDescription = false;
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.length > 100) {
        hasDescription = true;
        break;
      }
    }
    if (hasDescription) {
      signals.push('description');
      confidence += 0.15;
    }
    let tier = 'low';
    if (confidence >= 0.6) tier = 'high';else if (confidence >= 0.4) tier = 'medium';else if (confidence >= 0.2) tier = 'partial';
    return {
      imageCount: propertyImages.length,
      hasPrice,
      hasAddress,
      hasBedrooms: roomPatterns[0].test(document.body.innerText),
      hasBathrooms: roomPatterns[1].test(document.body.innerText),
      hasParking: roomPatterns[2].test(document.body.innerText),
      hasDescription,
      confidence,
      tier,
      signals
    };
  }
  function buildPropertyDetection(signals, listing) {
    var _listing$imageUrls$le, _listing$imageUrls, _signals$signals;
    let score = signals && signals.confidence != null ? signals.confidence : 0;
    if (listing !== null && listing !== void 0 && listing.title && String(listing.title).trim().length > 8) score += 0.08;
    if (listing !== null && listing !== void 0 && listing.address) score += 0.08;
    if (listing !== null && listing !== void 0 && listing.price) score += 0.12;
    const nImg = typeof (listing === null || listing === void 0 ? void 0 : listing.imageCount) === 'number' ? listing.imageCount : (_listing$imageUrls$le = listing === null || listing === void 0 || (_listing$imageUrls = listing.imageUrls) === null || _listing$imageUrls === void 0 ? void 0 : _listing$imageUrls.length) !== null && _listing$imageUrls$le !== void 0 ? _listing$imageUrls$le : 0;
    if (nImg >= 1) score += 0.05;
    if (nImg >= 3) score += 0.08;
    score = Math.min(score, 0.99);
    let tier = 'none';
    if (score >= 0.45) tier = 'full';else if (score >= 0.22) tier = 'partial';
    const canAnalyze = score >= 0.3 && !!(listing !== null && listing !== void 0 && listing.title || listing !== null && listing !== void 0 && listing.address || listing !== null && listing !== void 0 && listing.price || nImg >= 1 || signals !== null && signals !== void 0 && signals.hasPrice || (signals === null || signals === void 0 ? void 0 : signals.imageCount) >= 1);
    return {
      score,
      signals: (_signals$signals = signals === null || signals === void 0 ? void 0 : signals.signals) !== null && _signals$signals !== void 0 ? _signals$signals : [],
      tier,
      canAnalyze
    };
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
      var _h1$textContent2;
      const text = ((_h1$textContent2 = h1.textContent) === null || _h1$textContent2 === void 0 ? void 0 : _h1$textContent2.trim()) || '';
      if (/^\d+\s+[A-Za-z]/.test(text) && text.length < 200) {
        return text;
      }
    }

    // 方法2: 查找地址相关的 data-testid 元素 (最稳定)
    const addrSelectors = ['[data-testid="address"]', '[data-testid="listing-address"]', '[data-testid="property-address"]'];
    for (const sel of addrSelectors) {
      const el = queryDeep(document, sel);
      if (el) {
        var _el$textContent6;
        const text = ((_el$textContent6 = el.textContent) === null || _el$textContent6 === void 0 ? void 0 : _el$textContent6.trim()) || '';
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
    const priceSelectors = ['[data-testid="price"]', '[data-testid="listing-price"]', '[data-testid="property-price"]', '[data-testid="search-result-price"]'];
    for (const sel of priceSelectors) {
      const el = queryDeep(document, sel);
      if (el) {
        var _el$textContent7;
        const text = ((_el$textContent7 = el.textContent) === null || _el$textContent7 === void 0 ? void 0 : _el$textContent7.trim()) || '';
        if (/\$[\d,]+/.test(text)) {
          return text;
        }
      }
    }

    // 方法2: 查找包含 "price" 或 "$" 的 data-testid 元素
    const allElements = document.querySelectorAll('[data-testid]');
    for (const el of allElements) {
      var _el$textContent8;
      const testid = el.getAttribute('data-testid') || '';
      const text = ((_el$textContent8 = el.textContent) === null || _el$textContent8 === void 0 ? void 0 : _el$textContent8.trim()) || '';
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
    const result = {
      bedrooms: null,
      bathrooms: null,
      parking: null
    };
    const bedMatch = text.match(/(\d+)\s*(?:bed|bedroom|bedrooms)/i);
    if (bedMatch) result.bedrooms = parseInt(bedMatch[1], 10);
    const bathMatch = text.match(/(\d+)\s*(?:bath|bathroom|bathrooms)/i);
    if (bathMatch) result.bathrooms = parseInt(bathMatch[1], 10);
    const carRe = /(\d+)\s*(?:car(?:port|space)?s?|parking|garage)\b/gi;
    const carVals = [];
    let cm;
    while ((cm = carRe.exec(text)) !== null) {
      const n = parseInt(cm[1], 10);
      if (n >= 1 && n <= 20) carVals.push(n);
    }
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
    const patterns = ['placeholder', '.svg', '/logo', '/icon', '/avatar', '200x200-crop', '/main.png', 'blank.gif', 'data:image', '/360x270/', '/340x64/', '/doraexplorer'];
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
        best = {
          item,
          index: i,
          tx
        };
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
        candidates.push({
          img,
          nw,
          area,
          index: i,
          isReastatic
        });
      }
    }
    if (candidates.length === 0) {
      // Global fallback: pick largest area
      let globalBest = null,
        globalBestArea = 0;
      for (let i = 0; i < allPswpImgs.length; i++) {
        const img = allPswpImgs[i];
        const src = (img.currentSrc || img.src || '').trim();
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
        const area = (img.clientWidth || 0) * (img.clientHeight || 0);
        if (area > globalBestArea) {
          globalBestArea = area;
          globalBest = img;
        }
      }
      if (globalBest) {
        return {
          img: globalBest,
          source: 'global-best'
        };
      }
      return null;
    }

    // Priority 1: reastatic CDN image (real high-res photo)
    const reastatic = candidates.filter(c => c.isReastatic);
    if (reastatic.length > 0) {
      reastatic.sort((a, b) => b.nw - a.nw || b.area - a.area);
      return {
        img: reastatic[0].img,
        source: 'item-best'
      };
    }

    // Priority 2: loaded images (naturalWidth > 0) sorted by nw desc
    const loaded = candidates.filter(c => c.nw > 0);
    if (loaded.length > 0) {
      loaded.sort((a, b) => b.nw - a.nw);
      return {
        img: loaded[0].img,
        source: 'item-best'
      };
    }

    // Priority 3: fallback to largest client area
    candidates.sort((a, b) => b.area - a.area);
    return {
      img: candidates[0].img,
      source: 'item-best'
    };
  }

  /**
   * Get the currently active slide's main image element.
   * PRIMARY STRATEGY: find .pswp__item with translateX closest to 0, then pick
   * the best real img inside it (loaded, or largest area).
   * Falls back to .pswp--active class → aria-hidden=false → global area fallback.
   */
  function getVisiblePhotoSwipeImage() {
    var _allPswpImgs$map$sort;
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
    return ((_allPswpImgs$map$sort = allPswpImgs.map(img => {
      const style = window.getComputedStyle(img);
      const opacity = parseFloat(style.opacity);
      const rect = img.getBoundingClientRect();
      const visible = opacity > 0 && rect.width >= 24 && rect.height >= 24;
      const inViewport = rect.left < viewportW && rect.right > 0 && rect.top < viewportH && rect.bottom > 0;
      const area = rect.width * rect.height;
      return {
        img,
        visible,
        inViewport,
        opacity,
        area,
        rect
      };
    }).sort((a, b) => {
      if (a.visible !== b.visible) return a.visible ? -1 : 1;
      if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
      if (a.opacity !== b.opacity) return b.opacity - a.opacity;
      return b.area - a.area;
    })[0]) === null || _allPswpImgs$map$sort === void 0 ? void 0 : _allPswpImgs$map$sort.img) || null;
  }

  /**
   * Get DOM path for a given element (for logging).
   */
  function getElementPath(el) {
    if (!el || !el.tagName) return '';
    const parts = [];
    while (el && el.tagName) {
      let name = el.tagName.toLowerCase();
      if (el.id) {
        name += '#' + el.id;
      } else if (el.className && typeof el.className === 'string' && el.className.trim()) {
        const cls = el.className.trim().split(/\s+/)[0].substring(0, 20);
        name += '.' + cls;
      }
      parts.unshift(name);
      // Traverse parent before we potentially null-out el below
      if (el.id) {
        break;
      }
      const parent = el.parentElement;
      if (parent && parent.tagName !== 'HTML') {
        el = parent;
      } else {
        break;
      }
    }
    return parts.join(' > ');
  }

  /**
   * Check if gallery is open (PhotoSwipe or Zillow StyledDialog).
   */
  function isGalleryOpen() {
    return !!(isPhotoSwipeOpen() || isImxLightboxOpen() || getZillowLightboxRootStrict());
  }

  function isAnyGalleryOpen() {
    return isGalleryOpen();
  }

  function isBodyScrollLocked() {
    try {
      const bodyStyle = window.getComputedStyle(document.body);
      const htmlStyle = window.getComputedStyle(document.documentElement);
      return bodyStyle.overflow === 'hidden' || htmlStyle.overflow === 'hidden';
    } catch (_) {
      return false;
    }
  }

  function normalizeGalleryType(type) {
    if (type === 'photoswipe') return 'photoswipe_lightbox';
    if (type === 'mixed-imx') return 'imx_lightbox_carousel';
    if (type === 'imx') return 'imx_lightbox_carousel';
    if (type === 'imx_lightbox') return 'imx_lightbox_carousel';
    if (type === 'pure_gallery') return 'pure_gallery';
    if (type === 'pure-styled-dialog') return 'styled_dialog';
    if (type === 'styled-unknown') return 'styled_dialog';
    if (type === 'photoswipe_lightbox') return 'photoswipe_lightbox';
    if (type === 'imx_lightbox_carousel') return 'imx_lightbox_carousel';
    if (type === 'hollywood_vertical_wall') return 'hollywood_vertical_wall';
    if (type === 'styled_dialog') return 'styled_dialog';
    return 'none';
  }

  function isPhotoSwipeOpen() {
    return Boolean(
      document.querySelector('.pswp--open') ||
      document.querySelector('.pswp') ||
      document.querySelector('[class*="PhotoSwipe"]') ||
      document.querySelector('[class*="photoswipe"]')
    );
  }

  function getZillowLightboxRoot() {
    return document.querySelector('#search-detail-lightbox') || document.querySelector('[data-testid="search-detail-lightbox"]') || document.querySelector('[role="dialog"][aria-modal="true"]') || document.querySelector('[role="dialog"]');
  }

  function getImxRoot() {
    return (
      document.querySelector('.imx-lightbox') ||
      document.querySelector('.imx-lightbox-modal') ||
      document.querySelector('#search-detail-lightbox .imx-lightbox') ||
      document.querySelector('#search-detail-lightbox .imx-lightbox-modal') ||
      null
    );
  }

  function isImxLightboxOpen() {
    const root = getImxRoot();
    if (!root) return false;
    const hasPhoto = Boolean(root.querySelector('img[src*="photos.zillowstatic.com"]'));
    const hasNav = Boolean(
      root.querySelector('button[aria-label="Next photo"]') ||
      root.querySelector('button[aria-label*="Next photo"]') ||
      root.querySelector('button[aria-label="Previous photo"]')
    );
    const hasCounter = Boolean(root.textContent?.match(/\d+\s+of\s+\d+/i));
    return hasPhoto && (hasNav || hasCounter);
  }

  function getZillowPureGalleryRoot() {
    return document.querySelector('#search-detail-lightbox [class*="VerticalMediaWall"]') ||
      document.querySelector('#search-detail-lightbox [data-testid*="hollywood-vertical-media-wall-container"]') ||
      document.querySelector('#search-detail-lightbox [class*="hollywood-vertical-media-wall"]') ||
      document.querySelector('#search-detail-lightbox ul[class*="hollywood-vertical-media-wall"]') ||
      document.querySelector('[class*="StyledVerticalMediaWall"]') ||
      document.querySelector('[class*="VerticalMediaWall"]') ||
      document.querySelector('[data-testid*="hollywood-vertical-media-wall-container"]') ||
      document.querySelector('[class*="hollywood-vertical-media-wall"]') ||
      document.querySelector('ul[class*="hollywood-vertical-media-wall"]') ||
      null;
  }

  function getZillowLightboxRootStrict() {
    return (
      document.querySelector('#search-detail-lightbox') ||
      document.querySelector('[data-testid="search-detail-lightbox"]') ||
      document.querySelector('.imx-lightbox') ||
      document.querySelector('.imx-lightbox-modal') ||
      document.querySelector('.pswp--open') ||
      document.querySelector('.pswp') ||
      document.querySelector('[class*="PhotoSwipe"]') ||
      Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog')).find((el) => {
        return (
          el.querySelector('.imx-lightbox') ||
          (el.className && typeof el.className === 'string' && el.className.includes('imx-lightbox')) ||
          el.querySelector('[data-testid^="vmw-photo-"]') ||
          el.querySelector('[data-testid*="hollywood-vertical-media-wall"]') ||
          el.querySelector('button[aria-label*="Next photo"]') ||
          el.querySelector('button[aria-label*="Previous photo"]') ||
          el.querySelector('img[src*="photos.zillowstatic.com"]')
        );
      }) ||
      null
    );
  }

  function hasZillowPhotosPanelActive() {
    const root = getZillowLightboxRoot();
    if (!root) return false;
    return Boolean(
      getZillowPureGalleryRoot() ||
      root.querySelector('[data-testid="hollywood-vertical-media-wall"]') ||
      root.querySelector('[data-testid*="hollywood-vertical-media-wall"]') ||
      root.querySelector('[data-testid^="vmw-photo-"]') ||
      root.querySelector('button[aria-label*="Next photo"]') ||
      root.querySelector('button[aria-label*="Previous photo"]') ||
      root.querySelector('.pswp--open') ||
      root.querySelector('.pswp')
    );
  }

  function isZillowMapOrStreetViewPanelActive() {
    const root = getZillowLightboxRoot();
    if (!root) return false;
    const text = (root.textContent || '').toLowerCase();
    const hasMapSignals = Boolean(root.querySelector('canvas') || root.querySelector('[aria-label*="Map"]') || root.querySelector('[aria-label*="Street View"]') || root.querySelector('[class*="map"]') || root.querySelector('[class*="Map"]') || root.querySelector('[data-testid*="map"]') || text.includes('street view') || text.includes('map') || text.includes('travel times'));
    const hasPhotoSignals = hasZillowPhotosPanelActive();
    return hasMapSignals && !hasPhotoSignals;
  }

  function getZillowPhotoKey(url) {
    if (!url) return '';
    try {
      const clean = String(url)
        .replace(/&amp;/g, '&')
        .split('?')[0]
        .trim();
      const u = new URL(clean, window.location.href);
      if (!u.hostname.includes('photos.zillowstatic.com')) {
        return clean;
      }
      const fpMatch = u.pathname.match(/\/fp\/([^/?#]+)/i);
      if (!fpMatch) return clean;
      let filename = fpMatch[1];
      filename = filename.replace(/\.(jpg|jpeg|webp|png)$/i, '');
      const transformIndex = filename.search(
        /-(cc_ft|uncropped_scaled_within|scaled_within|f_auto|f_webp|f_jpg|w_\d+|h_\d+|\d{2,5}x\d{2,5})/i
      );
      if (transformIndex > 0) {
        filename = filename.slice(0, transformIndex);
      }
      filename = filename
        .replace(/-\d{2,5}x\d{2,5}$/i, '')
        .replace(/_\d{2,5}_\d{2,5}$/i, '');
      return `zillow-fp:${filename}`;
    } catch (_) {
      return String(url).replace(/&amp;/g, '&').split('?')[0].trim();
    }
  }

  function isValidZillowPropertyImage(url) {
    if (!url) return false;
    const value = String(url);
    const lower = value.toLowerCase();
    if (!value.includes('photos.zillowstatic.com')) return false;
    if (!value.includes('/fp/')) return false;
    if (lower.includes('agent')) return false;
    if (lower.includes('avatar')) return false;
    if (lower.includes('profile')) return false;
    if (lower.includes('logo')) return false;
    if (lower.includes('map')) return false;
    if (lower.includes('sprite')) return false;
    if (lower.includes('icon')) return false;
    return /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(value);
  }

  function getVisibleArea(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, vw);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, vh);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    return Math.round(w * h);
  }

  function getCurrentImxImage() {
    const root = getImxRoot();
    if (!root) return null;
    const imgs = Array.from(root.querySelectorAll('img[src*="photos.zillowstatic.com"]'))
      .map((img, idx) => {
        const rect = img.getBoundingClientRect();
        const src = img.currentSrc || img.src;
        const alt = img.getAttribute('alt') || '';
        const visibleArea = getVisibleArea(rect);
        return {
          idx,
          img,
          src,
          key: getZillowPhotoKey(src),
          alt,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          visibleArea,
        };
      })
      .filter((x) => {
        if (!isValidZillowPropertyImage(x.src)) return false;
        if (x.width < 300 || x.height < 200) return false;
        if (x.alt.toLowerCase().includes('agent')) return false;
        return x.visibleArea > 0;
      })
      .sort((a, b) => b.visibleArea - a.visibleArea);
    return imgs[0] || null;
  }

  function parseImxExpectedCount() {
    const root = getImxRoot();
    const text = (root?.textContent || '').replace(/\s+/g, ' ');
    const match = text.match(/(\d+)\s+of\s+(\d+)/i);
    return match ? Number(match[2]) : null;
  }

  function parseImxCurrentIndex() {
    const root = getImxRoot();
    const text = (root?.textContent || '').replace(/\s+/g, ' ');
    const match = text.match(/(\d+)\s+of\s+(\d+)/i);
    if (!match) return null;
    return {
      current: Number(match[1]),
      total: Number(match[2]),
    };
  }

  function findImxNextButton() {
    const root = getImxRoot();
    if (!root) return null;
    const selectors = [
      'button[aria-label="Next photo"]',
      'button[aria-label*="Next photo"]',
      'button[aria-label="Next"]',
      'button[aria-label*="Next"]',
      '[data-testid="next-button"]',
      'button[data-testid*="next"]',
    ];
    for (const selector of selectors) {
      const btn = root.querySelector(selector);
      if (btn instanceof HTMLElement && !btn.disabled && btn.offsetParent !== null) {
        return btn;
      }
    }
    return null;
  }

  async function waitForImxImageChange(prevKey, timeoutMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = getCurrentImxImage();
      if (current?.key && current.key !== prevKey) {
        return current;
      }
      await shortDelay(120, 180);
    }
    return getCurrentImxImage();
  }

  async function collectByImxLightboxCarousel(expectedCountInput) {
    const expectedCount = expectedCountInput || parseImxExpectedCount() || 120;
    const maxSteps = Math.min(expectedCount + 3, 130);
    const byKey = new Map();
    const ordered = [];

    console.log('[Gallery][IMX] starting collection', {
      expectedCount,
      initialIndex: parseImxCurrentIndex(),
      initialImage: getCurrentImxImage(),
    });

    for (let step = 0; step < maxSteps; step++) {
      const current = getCurrentImxImage();
      const indexInfo = parseImxCurrentIndex();

      console.log('[Gallery][IMX] step current', {
        step,
        indexInfo,
        key: current?.key,
        alt: current?.alt,
        src: current?.src?.slice(0, 120),
        visibleArea: current?.visibleArea,
        count: ordered.length,
      });

      if (current?.key && !byKey.has(current.key)) {
        byKey.set(current.key, current.src);
        ordered.push({
          step,
          indexInfo,
          key: current.key,
          url: current.src,
          alt: current.alt,
        });
      }

      if (expectedCount && ordered.length >= expectedCount) {
        console.log('[Gallery][IMX] reached expectedCount');
        break;
      }

      const nextBtn = findImxNextButton();
      if (!nextBtn) {
        console.warn('[Gallery][IMX] no next button found, stopping');
        break;
      }

      const beforeKey = current?.key;
      nextBtn.click();

      const after = await waitForImxImageChange(beforeKey, 2500);
      if (!after?.key || after.key === beforeKey) {
        console.warn('[Gallery][IMX] image did not change after clicking next', {
          beforeKey,
          afterKey: after?.key,
        });
        break;
      }

      await shortDelay(250, 350);
    }

    const urls = ordered.map((x) => x.url);
    console.log('[Gallery][IMX] finished', {
      expectedCount,
      collected: urls.length,
      items: ordered.map((x, i) => ({
        n: i + 1,
        indexInfo: x.indexInfo,
        alt: x.alt,
        key: x.key,
        url: x.url.slice(0, 120),
      })),
    });

    return expectedCount ? urls.slice(0, expectedCount) : urls;
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
      // IMX Lightbox check (must come before generic dialog)
      if (document.querySelector('.imx-lightbox') || document.querySelector('.imx-lightbox-modal')) {
        console.log('[gallery] IMX lightbox detected');
        return true;
      }

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
        console.log('[gallery] Detected open gallery via body.overflow hidden');
        return true;
      }
      await shortDelay(400, 1200);
    }

    // 最后一次检查：如果 body overflow 是 hidden，仍然返回 true
    if (bodyOverflowHidden()) {
      console.log('[gallery] Final check: body overflow hidden detected');
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
      '[data-testid="photo-gallery"]', '[class*="PhotoView"]', '[class*="photo-view"]',
      // Generic gallery containers
      '[class*="hero"][class*="photo"]', '[class*="main"][class*="photo"]', '[class*="primary"][class*="photo"]'];
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
            const clickable = img.closest('button[aria-label*="view larger"]') || img.closest('button') || img.closest('a') || img.closest('[role="button"]') || img;

            // Skip if this is a thumbnail in a grid
            const parent = img.parentElement;
            if (parent && (parent.className || '').match(/grid|tile|thumb/i)) {
              continue;
            }
            noop('[DIAG] clickFirstListingImage: Clicking main photo image');
            try {
              clickable.click();
            } catch (_) {
              try {
                clickable.dispatchEvent(new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true
                }));
              } catch (_2) {}
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
      const clickable = img.closest('button') || img.closest('a') || img.closest('[role="button"]') || img.closest('[data-testid*="gallery"]') || img.closest('[data-testid*="photo"]') || img.closest('[class*="gallery"]') || img;
      try {
        clickable.click();
      } catch (_) {
        try {
          clickable.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true
          }));
        } catch (_2) {}
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
    const galleryEl = document.querySelector('[data-testid="gallery"]') || document.querySelector('[data-testid*="photo"]') || document.querySelector('[class*="gallery"][class*="container"]') || document.querySelector('[class*="photo"][class*="grid"]') || document.querySelector('[class*="photo"][class*="viewer"]') || document.querySelector('[class*="listing"][class*="photo"]') || document.querySelector('[class*="media"][class*="gallery"]');
    if (!galleryEl) return false;
    try {
      galleryEl.click();
    } catch (_) {
      try {
        galleryEl.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true
        }));
      } catch (_2) {}
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
      if (/photo/i.test(text) || /photo/i.test(aria) || /photo/i.test(title) || /^\+\d+$/.test(text)) {
        hits.push({
          el,
          tagName: el.tagName.toLowerCase(),
          text,
          aria,
          title
        });
      }
    }
    return hits;
  }

  function isBadZillowMediaOpener(el) {
    const text = [el?.textContent || '', el?.getAttribute?.('aria-label') || '', el?.getAttribute?.('data-testid') || '', el?.getAttribute?.('title') || '', el?.className ? String(el.className) : ''].join(' ').toLowerCase();
    return text.includes('map') || text.includes('street view') || text.includes('travel') || text.includes('commute') || text.includes('schools') || text.includes('nearby') || text.includes('directions') || text.includes('tour') || text.includes('contact') || text.includes('agent') || text.includes('mortgage') || text.includes('pre-qualified');
  }

  function isGoodZillowPhotoOpener(el) {
    const text = [el?.textContent || '', el?.getAttribute?.('aria-label') || '', el?.getAttribute?.('data-testid') || '', el?.getAttribute?.('title') || '', el?.className ? String(el.className) : ''].join(' ').toLowerCase();
    if (isBadZillowMediaOpener(el)) return false;
    return /see all\s+\d+\s+photos/i.test(text) || text.includes('see all photos') || text.includes('view all photos') || text.includes('photos') || text.includes('photo') || text.includes('image of');
  }

  function findZillowPhotosTabButton() {
    const root = getZillowLightboxRoot();
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll('button, [role="tab"], [role="button"], a, div[tabindex], span[tabindex]'));
    const scored = [];
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      const text = [el.textContent || '', el.getAttribute('aria-label') || '', el.getAttribute('data-testid') || '', el.getAttribute('title') || ''].join(' ').trim().toLowerCase();
      if (!text) continue;
      if (text.includes('map') || text.includes('street view') || text.includes('travel') || text.includes('schools') || text.includes('nearby') || text.includes('directions')) {
        continue;
      }
      let score = 0;
      if (text === 'photos') score += 100;
      if (text.includes('photos')) score += 80;
      if (text.includes('photo')) score += 60;
      if (/see all\s+\d+\s+photos/i.test(text)) score += 100;
      if (text.includes('view all photos')) score += 100;
      if (text.includes('media')) score += 20;
      if (score > 0) {
        scored.push({
          el,
          text,
          score
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    console.log('[Gallery] Photos tab candidates:', scored.slice(0, 10).map(x => ({
      text: x.text,
      score: x.score
    })));
    return (scored[0] || {}).el || null;
  }

  function dumpZillowLightboxButtons() {
    const root = getZillowLightboxRoot();
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll('button, [role="tab"], [role="button"], a, div[tabindex], span[tabindex]')).filter(el => el instanceof HTMLElement).map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').trim().slice(0, 80),
      aria: el.getAttribute('aria-label'),
      testid: el.getAttribute('data-testid'),
      role: el.getAttribute('role'),
      className: String(el.className || '').slice(0, 80)
    }));
    console.log('[Gallery] Lightbox buttons dump:', buttons);
  }

  async function ensureZillowLightboxPhotosActive(expectedCount) {
    const root = getZillowLightboxRoot();
    if (!root) {
      console.warn('[Gallery] ensurePhotosActive: no lightbox root');
      return false;
    }
    if (hasZillowPhotosPanelActive()) {
      console.log('[Gallery] Photos panel already active');
      return true;
    }
    console.warn('[Gallery] Lightbox is open but Photos panel is not active', {
      isMapOrStreetView: isZillowMapOrStreetViewPanelActive(),
      expectedCount
    });
    const photosBtn = findZillowPhotosTabButton();
    if (!photosBtn) {
      console.warn('[Gallery] Photos tab/button not found. Dumping lightbox buttons for debug.');
      dumpZillowLightboxButtons();
      return false;
    }
    console.log('[Gallery] Clicking Photos tab/button:', {
      text: photosBtn.textContent,
      aria: photosBtn.getAttribute('aria-label'),
      testid: photosBtn.getAttribute('data-testid')
    });
    photosBtn.click();
    const start = Date.now();
    const timeoutMs = 4000;
    while (Date.now() - start < timeoutMs) {
      if (hasZillowPhotosPanelActive()) {
        console.log('[Gallery] Photos panel activated successfully', {
          vmwTiles: document.querySelectorAll('[data-testid^="vmw-photo-"]').length
        });
        return true;
      }
      await shortDelay(180, 220);
    }
    console.warn('[Gallery] Photos panel did not activate after clicking Photos tab', {
      vmwTiles: document.querySelectorAll('[data-testid^="vmw-photo-"]').length,
      hasPhotosPanel: hasZillowPhotosPanelActive(),
      isMapOrStreetView: isZillowMapOrStreetViewPanelActive()
    });
    dumpZillowLightboxButtons();
    return false;
  }

  function detectGalleryTypeAfterOpen() {
    if (isPhotoSwipeOpen()) {
      return 'photoswipe_lightbox';
    }

    if (isImxLightboxOpen()) {
      return 'imx_lightbox_carousel';
    }

    if (getZillowPureGalleryRoot()) {
      return 'pure_gallery';
    }

    if (
      document.querySelector('#search-detail-lightbox [data-testid="hollywood-vertical-media-wall"]') ||
      document.querySelector('#search-detail-lightbox [data-testid*="hollywood-vertical-media-wall"]') ||
      document.querySelector('#search-detail-lightbox [data-testid^="vmw-photo-"]') ||
      document.querySelector('[data-testid="hollywood-vertical-media-wall"]') ||
      document.querySelector('[data-testid^="vmw-photo-"]')
    ) {
      return 'hollywood_vertical_wall';
    }

    const root = getZillowLightboxRootStrict();
    if (root && isZillowMapOrStreetViewPanelActive()) {
      console.warn('[Gallery] lightbox is open but active panel is Map/StreetView, not Photos');
      return 'none';
    }

    if (
      root && (
        root.querySelector('img[src*="photos.zillowstatic.com"]') ||
        root.querySelector('source[srcset*="photos.zillowstatic.com"]') ||
        root.querySelector('button[aria-label*="Next"]')
      )
    ) {
      return 'styled_dialog';
    }

    return 'none';
  }

  async function waitForGalleryTypeAfterOpen(timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const type = normalizeGalleryType(detectGalleryTypeAfterOpen());
      if (type !== 'none') {
        console.log('[Gallery] detected gallery type:', type);
        return type;
      }
      await shortDelay(120, 180);
    }
    console.warn('[Gallery] gallery type detection timed out', {
      hasImx: isImxLightboxOpen(),
      hasImxRoot: Boolean(getImxRoot()),
      hasStrictRoot: Boolean(getZillowLightboxRootStrict()),
      hasLightbox: Boolean(getZillowLightboxRoot()),
      bodyScrollLocked: isBodyScrollLocked(),
      hasPhotosPanel: hasZillowPhotosPanelActive(),
      isMapOrStreetView: isZillowMapOrStreetViewPanelActive(),
      vmwTiles: document.querySelectorAll('[data-testid^="vmw-photo-"]').length,
      imxExpectedCount: parseImxExpectedCount(),
    });
    return 'none';
  }

  /**
   * Open PhotoSwipe gallery using multi-strategy fallback.
   * Returns structured gallery open result.
   */
  async function openZillowPureGallery(expectedCount) {
    const existingType = normalizeGalleryType(detectGalleryTypeAfterOpen());
    if (existingType === 'pure_gallery') {
      markGalleryOpened('existing-pure-gallery');
      return {
        ok: true,
        galleryType: 'pure_gallery',
        opener: 'existing-pure-gallery',
        failureReason: null
      };
    }

    const openers = [];
    const directOpener = document.querySelector('button[data-testid="gallery-see-all-photos-button"]');
    if (directOpener instanceof HTMLElement) {
      openers.push(directOpener);
    }

    const fallbackMatchers = [
      /see all\s+\d+\s+photos/i,
      /see all\s+photos/i,
      /view all\s+photos/i,
      /view\s+photos/i,
    ];

    Array.from(document.querySelectorAll('button, a, [role="button"]')).forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (openers.includes(el)) return;
      const text = [
        el.innerText,
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-testid')
      ].filter(Boolean).join(' ');
      if (fallbackMatchers.some((pattern) => pattern.test(text))) {
        openers.push(el);
      }
    });

    for (const opener of openers) {
      try {
        opener.scrollIntoView({ block: 'center', inline: 'center' });
      } catch (_) {}
      await shortDelay(240, 320);
      try {
        opener.click();
      } catch (_) {
        try {
          opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (_2) {}
      }

      const started = Date.now();
      while (Date.now() - started < 8000) {
        const detected = normalizeGalleryType(detectGalleryTypeAfterOpen());
        if (detected === 'pure_gallery') {
          markGalleryOpened(opener.getAttribute('data-testid') || opener.innerText || 'see-all-photos');
          return {
            ok: true,
            galleryType: 'pure_gallery',
            opener: opener.getAttribute('data-testid') || opener.innerText || 'see-all-photos',
            failureReason: null
          };
        }
        if (detected !== 'none') {
          return {
            ok: true,
            galleryType: detected,
            opener: opener.getAttribute('data-testid') || opener.innerText || 'see-all-photos',
            failureReason: null
          };
        }
        await shortDelay(180, 240);
      }
    }

    return {
      ok: false,
      galleryType: 'none',
      opener: null,
      failureReason: 'No Zillow see-all-photos opener found'
    };
  }

  async function openGallery(expectedCount) {
    const existingType = normalizeGalleryType(detectGalleryTypeAfterOpen());
    if (existingType === 'photoswipe_lightbox') {
      noop('[DIAG] openGallery: PhotoSwipe already open');
      markGalleryOpened('existing-photoswipe');
      return {
        ok: true,
        galleryType: existingType,
        opener: 'existing-photoswipe',
        failureReason: null
      };
    }

    if (isZillowPage()) {
      noop('[DIAG] openGallery: Zillow page detected, looking for gallery buttons');

      const pureGalleryResult = await openZillowPureGallery(expectedCount);
      if (pureGalleryResult.ok && pureGalleryResult.galleryType === 'pure_gallery') {
        return pureGalleryResult;
      }

      // First, try Photos tab buttons — these open the IMX lightbox directly
      const photosTabSelectors = [
        'button[data-testid="persistent-tab-photos"]',
        'button[aria-label="Photos"]',
        'button[aria-label*="Photos"]',
      ];
      for (const selector of photosTabSelectors) {
        const btn = document.querySelector(selector);
        if (btn instanceof HTMLElement) {
          const text = [btn.textContent || '', btn.getAttribute('aria-label') || ''].join(' ').toLowerCase();
          // Exclude non-photo tabs
          const badTerms = ['3d home', 'floor plan', 'virtual staging', 'map', 'street view', 'tour', 'contact', 'agent', 'mortgage', 'pre-qualified'];
          if (badTerms.some(t => text.includes(t))) continue;
          noop('[DIAG] openGallery: Trying Photos tab button:', selector);
          try {
            btn.click();
          } catch (_) {
            try {
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            } catch (_2) {}
          }
          // IMX opens fast — wait briefly then check
          await shortDelay(400, 600);
          if (isImxLightboxOpen() || isGalleryOpen()) {
            const galleryType = normalizeGalleryType(await waitForGalleryTypeAfterOpen(3000));
            markGalleryOpened('photos-tab-button');
            return {
              ok: true,
              galleryType: galleryType === 'none' ? 'imx_lightbox_carousel' : galleryType,
              opener: 'Photos tab',
              failureReason: null,
            };
          }
        }
      }

      const existingDialog = getZillowLightboxRootStrict();
      if (existingDialog) {
        const photosReady = await ensureZillowLightboxPhotosActive(expectedCount);
        if (!photosReady) {
          return {
            ok: false,
            galleryType: 'none',
            opener: 'existing-styled-dialog',
            failureReason: 'Lightbox opened but Photos panel could not be activated'
          };
        }
        const galleryType = normalizeGalleryType(detectGalleryTypeAfterOpen());
        markGalleryOpened('existing-styled-dialog');
        return {
          ok: true,
          galleryType: galleryType === 'none' ? 'styled_dialog' : galleryType,
          opener: 'existing-styled-dialog',
          failureReason: null
        };
      }

      const zillowCandidates = [];
      const allOpeners = Array.from(document.querySelectorAll('button, a, [role="button"], div[tabindex], img'));
      for (const el of allOpeners) {
        if (!(el instanceof HTMLElement)) continue;
        if (!isGoodZillowPhotoOpener(el)) continue;
        let score = 0;
        const text = [el.textContent || '', el.getAttribute('aria-label') || '', el.getAttribute('data-testid') || '', el.getAttribute('title') || '', el.getAttribute('alt') || ''].join(' ').toLowerCase();
        if (/see all\s+\d+\s+photos/i.test(text)) score += 200;
        if (text.includes('view all photos')) score += 180;
        if (text.includes('see all photos')) score += 180;
        if (el.getAttribute('aria-label') && /see all photos|view all photos/i.test(el.getAttribute('aria-label'))) score += 140;
        if (el.tagName === 'IMG' && /image of|photo of/i.test(text)) score += 120;
        if (text.includes('photos')) score += 80;
        if (text.includes('photo')) score += 60;
        zillowCandidates.push({
          el,
          score,
          text: text.slice(0, 120)
        });
      }
      zillowCandidates.sort((a, b) => b.score - a.score);

      for (const candidate of zillowCandidates) {
        const openerEl = candidate.el;
        const openerName = candidate.text || openerEl.getAttribute('data-testid') || openerEl.tagName;
        noop('[DIAG] openGallery: Trying Zillow opener:', openerName);
        try {
          openerEl.click();
        } catch (_) {
          try {
            openerEl.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true
            }));
          } catch (_2) {}
        }
        const lightboxOpened = await waitForPhotoSwipe(3000);
        if (!lightboxOpened) {
          continue;
        }
        const photosReady = await ensureZillowLightboxPhotosActive(expectedCount);
        if (!photosReady) {
          return {
            ok: false,
            galleryType: 'none',
            opener: openerName,
            failureReason: 'Lightbox opened but Photos panel could not be activated'
          };
        }
        const galleryType = normalizeGalleryType(await waitForGalleryTypeAfterOpen(3000));
        markGalleryOpened(openerName || 'openGallery');
        return {
          ok: true,
          galleryType: galleryType === 'none' ? 'styled_dialog' : galleryType,
          opener: openerName,
          failureReason: null
        };
      }

      noop('[DIAG] openGallery: Zillow strategies exhausted, trying generic strategies');
    }

    noop('[DIAG] openGallery: Trying Strategy 1: clickFirstListingImage');
    if (await clickFirstListingImage()) {
      markGalleryOpened('clickFirstListingImage');
      return {
        ok: true,
        galleryType: normalizeGalleryType(await waitForGalleryTypeAfterOpen(3000)),
        opener: 'clickFirstListingImage',
        failureReason: null
      };
    }

    noop('[DIAG] openGallery: Trying Strategy 2: clickGalleryContainer');
    if (await clickGalleryContainer()) {
      markGalleryOpened('clickGalleryContainer');
      return {
        ok: true,
        galleryType: normalizeGalleryType(await waitForGalleryTypeAfterOpen(3000)),
        opener: 'clickGalleryContainer',
        failureReason: null
      };
    }

    noop('[DIAG] openGallery: Trying Strategy 3: button candidates');
    const hits = collectGalleryButtonCandidates();
    noop('[DIAG] openGallery: Found', hits.length, 'button candidates');
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const clickTarget = h.el.closest('button') || h.el.closest('a') || h.el.closest('[role="button"]') || h.el;
      try {
        clickTarget.click();
      } catch (_) {
        try {
          clickTarget.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true
          }));
        } catch (_2) {}
      }
      if (await waitForPhotoSwipe(3000)) {
        markGalleryOpened(h.text || h.aria || h.title || h.tagName || 'button-candidate');
        return {
          ok: true,
          galleryType: normalizeGalleryType(await waitForGalleryTypeAfterOpen(3000)),
          opener: h.text || h.aria || h.title || h.tagName,
          failureReason: null
        };
      }
    }
    noop('[DIAG] openGallery: All strategies failed, returning false');
    return {
      ok: false,
      galleryType: 'none',
      opener: null,
      failureReason: 'Gallery could not be opened in Photos mode'
    };
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
      const parts = ss.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
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
    return new Promise(resolve => {
      const u = normalizeUrl(url);
      if (!u || u.startsWith('data:') || u.startsWith('blob:')) {
        resolve({
          ok: false
        });
        return;
      }
      const img = new Image();
      const done = (ok, naturalW, naturalH) => {
        clearTimeout(t);
        resolve(ok ? {
          ok: true,
          url: u,
          naturalW,
          naturalH
        } : {
          ok: false
        });
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
    const selectors = ['h1', '[class*="address"]', '[class*="headline"]', 'meta[property="og:title"]', 'meta[name="title"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = sel.includes('meta') ? el.getAttribute('content') || '' : el.textContent || '';
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
      if (area > maxArea) {
        maxArea = area;
        heroImg = img;
      }
    }
    if (!heroImg) return null;
    let best = null;
    let el = heroImg;
    for (let i = 0; i < 18 && el; el = el.parentElement, i++) {
      const cls = (el.className || '').toLowerCase();
      if (!cls.includes('mosaic') && !cls.includes('hero') && !cls.includes('gallery') && !cls.includes('media')) continue;
      const pics = el.querySelectorAll('picture img, img');
      let count = 0;
      for (const p of pics) {
        if (getImgReastaticUrl(p)) count++;
      }
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
        if (cls.includes('hero') || cls.includes('mosaic') || cls.includes('gallery__main') || cls.includes('main-image') || cls.includes('photo-gallery') || cls.includes('listing-gallery') || cls.includes('property-gallery')) {
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
        var _node$parentElement;
        const gallery = (_node$parentElement = node.parentElement) === null || _node$parentElement === void 0 ? void 0 : _node$parentElement.closest('[class*="gallery"], [class*="photo"], section, article, main');
        if (gallery) return gallery;
      }
    }

    // ── Anchor 3: "N Images" text node ──
    const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker2.nextNode()) {
      const node = walker2.currentNode;
      const t = (node.textContent || '').trim();
      if (/^\d+\s*images?$/i.test(t) && t.length < 30) {
        var _node$parentElement2;
        const gallery = (_node$parentElement2 = node.parentElement) === null || _node$parentElement2 === void 0 ? void 0 : _node$parentElement2.closest('[class*="gallery"], [class*="photo"], section, article, main');
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
    const blacklist = ['footer-carousel', 'carousel-card', 'similar', 'recommended', 'more-properties', 'agent-info', 'agency', 'enquiry', 'advertisement', 'sponsored', 'promo', 'promotion'];
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
    if (!src) return {
      keep: false,
      reason: 'empty-src'
    };
    if (isPlaceholderUrl(src)) return {
      keep: false,
      reason: 'placeholder'
    };
    const uiPatterns = ['branding', 'avatar', 'phone__link', 'doraexplorer'];
    if (uiPatterns.some(k => cls.includes(k))) return {
      keep: false,
      reason: 'ui-element'
    };
    if (isInBlacklistAncestry(img)) return {
      keep: false,
      reason: 'blacklist-ancestry'
    };
    const rect = img.getBoundingClientRect();
    if (rect.width < 64 || rect.height < 48) return {
      keep: false,
      reason: 'too-small'
    };
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    const aria = (img.getAttribute('aria-label') || '').toLowerCase();
    const title = (img.getAttribute('title') || '').toLowerCase();
    const metaText = alt + aria + title;
    if (/image\s+\d+\s+of\s+\d+/i.test(metaText)) return {
      keep: true,
      reason: 'aria-image-of'
    };
    if (pageAddress && (alt.includes(pageAddress) || aria.includes(pageAddress))) return {
      keep: true,
      reason: 'address-match'
    };
    return {
      keep: true,
      reason: 'gallery-root'
    };
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
      out.push({
        url: u,
        reason
      });
      return true;
    };

    // og:image
    for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]']) {
      const m = document.querySelector(sel);
      const c = m === null || m === void 0 ? void 0 : m.getAttribute('content');
      if (c) push(c, 'og-image');
    }

    // Gallery root DOM scan
    const pageAddress = extractPageAddress();
    const galleryRoot = findGalleryRoot();
    const rootImgs = galleryRoot ? Array.from(galleryRoot.querySelectorAll('picture img, img')).filter(img => !!getImgReastaticUrl(img)) : Array.from(document.querySelectorAll('picture img, img')).filter(img => !!getImgReastaticUrl(img));
    const scored = [];
    for (const img of rootImgs) {
      const {
        keep,
        reason
      } = shouldKeepImage(img, pageAddress);
      if (!keep) continue;
      const src = getImgReastaticUrl(img);
      const rect = img.getBoundingClientRect();
      scored.push({
        src,
        area: rect.width * rect.height,
        reason
      });
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
    var _window$pswp, _pswpEl$dataset, _window$pswp2;
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
      return {
        url: norm,
        width,
        id: cid
      };
    }

    // Strategy 1: window.pswp.items (PhotoSwipe v5 global)
    if (Array.isArray((_window$pswp = window.pswp) === null || _window$pswp === void 0 ? void 0 : _window$pswp.items) && window.pswp.items.length > 0) {
      const items = window.pswp.items.map(extractItem).filter(Boolean);
      return items;
    }

    // Strategy 2: pswpEl.__pswp.items (PhotoSwipe v4)
    if (pswpEl.__pswp && Array.isArray(pswpEl.__pswp.items) && pswpEl.__pswp.items.length > 0) {
      const items = pswpEl.__pswp.items.map(extractItem).filter(Boolean);
      return items;
    }

    // Strategy 3: PhotoSwipe v5 keyed instances via dataset.pswpUid
    const uid = (_pswpEl$dataset = pswpEl.dataset) === null || _pswpEl$dataset === void 0 ? void 0 : _pswpEl$dataset.pswpUid;
    if (uid && ((_window$pswp2 = window.pswp) === null || _window$pswp2 === void 0 ? void 0 : _window$pswp2.instances) instanceof Map) {
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
        collected.push({
          url: norm,
          width: extractWidthFromUrl(src),
          id: cid
        });
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
    const imgFullResAttrs = ['data-full-src', 'data-full', 'data-zoom-src', 'data-zoom', 'data-high-res-src', 'data-highres', 'data-hires', 'data-hd-src', 'data-src-full', 'data-original', 'data-ghost', 'data-lazy-src', 'data-expand', 'data-bg-src', 'data-img-src',
    // Common realestate site patterns
    'data-url', 'data-srcset'];
    for (const img of document.querySelectorAll('img')) {
      for (const attr of imgFullResAttrs) {
        const val = img.getAttribute(attr);
        if (val && isValidImageUrl(val)) {
          const norm = normalizeUrl(val);
          const cid = extractContentId(norm);
          collected.push({
            url: norm,
            width: extractWidthFromUrl(norm),
            id: cid
          });
          break;
        }
      }
    }

    // Patterns for <a href> pointing to full-res images
    const linkSelectors = ['a[href*=".jpg"]', 'a[href*=".jpeg"]', 'a[href*=".png"]', 'a[href*=".webp"]', 'a[data-src]', 'a[data-href]', 'a[data-url]', 'a[data-image]'];
    for (const selector of linkSelectors) {
      for (const a of document.querySelectorAll(selector)) {
        const href = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url') || a.getAttribute('data-image');
        if (href && isValidImageUrl(href)) {
          const norm = normalizeUrl(href);
          const cid = extractContentId(norm);
          if (!collected.find(x => x.url === norm)) {
            collected.push({
              url: norm,
              width: extractWidthFromUrl(norm),
              id: cid
            });
          }
        }
      }
    }

    // Scan for JSON data attributes on containers
    const dataContainerSelectors = ['[data-images]', '[data-gallery]', '[data-photos]', '[data-media]', '[data-image-list]', '[data-photo-gallery]', '[data-slideshow]', '[data-json]', '[data-config]', '[data-props]', '[data-listing]'];
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
                collected.push({
                  url: norm,
                  width: extractWidthFromUrl(norm),
                  id: cid
                });
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
    const ssrSelectors = ['#__NEXT_DATA__', 'script[data-reactstate]', 'script[data-redux-state]', 'script[data-page-context]', 'script[id="__NEXT_DATA__"]', '#__PRELOADED_STATE__', 'script[data-initial-state]'];
    const ssrSources = [];
    for (const sel of ssrSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        ssrSources.push(el.textContent || el.innerText || '');
      }
    }

    // Also check window globals
    const windowKeys = ['__INITIAL_STATE__', '__PRELOADED_STATE__', '__STATE__', '__REDUX_STATE__', '__NEXT_REDUX_WRAPPER_STORE__', '__pageData__', '__INITIAL_PROPS__'];
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
              collected.push({
                url: norm,
                width: extractWidthFromUrl(norm),
                id: cid
              });
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
    const candidates = [window.images, window.gallery, window.photos, window.mediaItems, window.imageUrls, window.imageList, window.galleryImages, window.listingImages, window.propertyImages, window.photoGallery];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const arr = Array.isArray(candidate) ? candidate : [candidate];
        for (const item of arr) {
          const url = typeof item === 'string' ? item : (item === null || item === void 0 ? void 0 : item.src) || (item === null || item === void 0 ? void 0 : item.url) || (item === null || item === void 0 ? void 0 : item.href) || (item === null || item === void 0 ? void 0 : item.image) || (item === null || item === void 0 ? void 0 : item.photo);
          if (url && isValidImageUrl(url)) {
            const norm = normalizeUrl(url);
            const cid = extractContentId(norm);
            if (!collected.find(x => x.url === norm)) {
              collected.push({
                url: norm,
                width: extractWidthFromUrl(norm),
                id: cid
              });
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
      let sig = path; // fallback to full path
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
    lastDomain: null
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
      var _pswpRoot$dataset, _window$pswp3;
      const pswpRoot = document.querySelector('.pswp');
      if (!pswpRoot) return null;
      const uid = (_pswpRoot$dataset = pswpRoot.dataset) === null || _pswpRoot$dataset === void 0 ? void 0 : _pswpRoot$dataset.pswpUid;
      if (uid && ((_window$pswp3 = window.pswp) === null || _window$pswp3 === void 0 ? void 0 : _window$pswp3.instances) instanceof Map) {
        const inst = window.pswp.instances.get(Number(uid));
        if (inst) {
          let totalSlides = 0;
          if (typeof inst.getNumItems === 'function') {
            totalSlides = inst.getNumItems();
          } else if (Array.isArray(inst.items)) {
            totalSlides = inst.items.length;
          }
          return {
            instance: inst,
            uid: String(uid),
            totalSlides
          };
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
        return {
          instance: inst,
          uid: 'el',
          totalSlides
        };
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
        await shortDelay(300, 700);
        continue;
      }
      const imgs = Array.from(pswp.querySelectorAll('.pswp__img'));
      for (const img of imgs) {
        const src = (img.currentSrc || img.src || '').trim();
        if (src && src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('blob:')) {
          return {
            ready: true,
            pollCount: polls
          };
        }
      }
      await shortDelay(300, 700);
    }
    return {
      ready: false,
      pollCount: polls
    };
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
      return {
        isValid: false
      };
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
            isValid: isValidReastaticUrl(rawSrc)
          };
        }
      } catch (_) {}
    }

    // Strategy B: find the center-most slide by transform
    const items = Array.from(pswp.querySelectorAll('.pswp__item'));
    let bestItem = null,
      bestAbsTx = Infinity,
      bestSlotIndex = -1;
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
          isValid: isValidReastaticUrl(rawSrc)
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
            return {
              strategy: 'aria',
              signature,
              rawSrc: src,
              isValid: true,
              imgEl: img
            };
          }
        }
      }
    }

    // Strategy D: largest visible img
    const allImgs = Array.from(pswp.querySelectorAll('.pswp__img'));
    let bestArea = 0,
      bestVisibleImg = null;
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
      return {
        strategy: 'area',
        signature,
        rawSrc,
        isValid: true,
        imgEl: bestVisibleImg
      };
    }
    return {
      isValid: false,
      strategy: 'none'
    };
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
    var _lastSnapshot;
    const start = Date.now();
    let polls = 0;
    let lastSnapshot = prevSnapshot;
    const initialPrevSignature = prevSnapshot === null || prevSnapshot === void 0 ? void 0 : prevSnapshot.signature;
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
          if (snapshot.isValid && snapshot.signature && snapshot.signature !== (prevSnapshot === null || prevSnapshot === void 0 ? void 0 : prevSnapshot.signature)) {
            console.log('[gallery] Slide changed (pswp-api+signature):', {
              prevIndex: prevCurrIndex,
              newIndex: newCurrIndex,
              polls
            });
            return {
              changed: true,
              newSnapshot: snapshot,
              prevSnapshot,
              reason: 'pswp-api+signature',
              newCurrIndex,
              polls
            };
          }
          // currIndex 变了但 signature 没变 = PhotoSwipe 内部 glitch，继续等待
        }
      }

      // Strategy B: signature changed (fallback 或无 API 时的唯一判断)
      if (snapshot.isValid && snapshot.signature && snapshot.signature !== (prevSnapshot === null || prevSnapshot === void 0 ? void 0 : prevSnapshot.signature)) {
        var _snapshot$signature;
        const reason = pswpInfo ? 'signature-only(no-pswp-index)' : 'signature';
        console.log('[gallery] Slide changed (signature):', {
          prevSignature: initialPrevSignature === null || initialPrevSignature === void 0 ? void 0 : initialPrevSignature.substring(0, 20),
          newSignature: (_snapshot$signature = snapshot.signature) === null || _snapshot$signature === void 0 ? void 0 : _snapshot$signature.substring(0, 20),
          reason,
          polls
        });
        return {
          changed: true,
          newSnapshot: snapshot,
          prevSnapshot,
          reason,
          polls
        };
      }
    }
    console.log('[gallery] waitForRealSlideChange TIMEOUT:', {
      elapsed: Date.now() - start,
      polls,
      prevSignature: initialPrevSignature === null || initialPrevSignature === void 0 ? void 0 : initialPrevSignature.substring(0, 20),
      lastValidSignature: (_lastSnapshot = lastSnapshot) === null || _lastSnapshot === void 0 || (_lastSnapshot = _lastSnapshot.signature) === null || _lastSnapshot === void 0 ? void 0 : _lastSnapshot.substring(0, 20)
    });
    return {
      changed: false,
      newSnapshot: lastSnapshot,
      prevSnapshot,
      reason: 'timeout',
      polls
    };
  }

  /**
   * Advance to next slide. Priority: pswp API > button click > keyboard.
   */
  function advanceToNextSlide() {
    const pswpInfo = getPhotoSwipeInstance();
    if (pswpInfo) {
      try {
        pswpInfo.instance.next();
        return {
          used: 'pswp-api',
          success: true
        };
      } catch (err) {
        console.warn('[gallery] pswp.instance.next() failed:', err === null || err === void 0 ? void 0 : err.message);
      }
    }
    const btn = document.querySelector('.pswp__button--arrow--right') || document.querySelector('.pswp__button--arrow--next') || document.querySelector('[class*="arrow"][class*="right"]');
    if (btn && !btn.disabled) {
      try {
        btn.click();
      } catch (_) {
        btn.dispatchEvent(new MouseEvent('click', {
          bubbles: true
        }));
      }
      return {
        used: 'button',
        success: true
      };
    }
    console.warn('[gallery] No next button found, using keyboard');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true
    }));
    return {
      used: 'keyboard',
      success: true
    };
  }

  /**
   * Restore page scroll/body state after gallery interactions.
   */
  function restoreGentlePageState() {
    if (_originalBodyOverflow !== null) {
      document.body.style.overflow = _originalBodyOverflow;
    } else {
      document.body.style.overflow = '';
    }
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.paddingRight = '';
    if (_originalHtmlOverflow !== null) {
      document.documentElement.style.overflow = _originalHtmlOverflow;
    } else {
      document.documentElement.style.overflow = '';
    }
    document.documentElement.style.position = '';
    document.body.classList.remove('modal-open', 'pswp--open', 'gallery-open', 'hdp-double-scroll-layout');
    document.documentElement.classList.remove('modal-open');
    console.log('[gallery] Gentle page state restored');
  }

  function markGalleryOpened(source = 'unknown') {
    _galleryWasOpened = true;
    _galleryOpenedByHomeScope = true;
    _galleryOpenStartedAt = Date.now();
    if (_originalBodyOverflow === null) {
      _originalBodyOverflow = document.body?.style?.overflow || '';
    }
    if (_originalHtmlOverflow === null) {
      _originalHtmlOverflow = document.documentElement?.style?.overflow || '';
    }
    console.log('[Gallery] markGalleryOpened', {
      source,
      time: _galleryOpenStartedAt
    });
  }

  function markGalleryClosed() {
    _galleryWasOpened = false;
    _galleryOpenedByHomeScope = false;
    _galleryOpenStartedAt = 0;
  }

  function resetGalleryOpenState() {
    _galleryWasOpened = false;
    _galleryOpenedByHomeScope = false;
    _galleryOpenStartedAt = 0;
    _originalBodyOverflow = null;
    _originalHtmlOverflow = null;
    console.log('[Gallery] gallery open state reset');
  }

  function dispatchEscapeToElementTarget() {
    let target = null;
    if (document.activeElement instanceof HTMLElement) {
      const active = document.activeElement;
      // Guard: only use if closest() is available and target is a real element
      if (typeof active.closest === 'function') {
        target = active.closest('[role="dialog"], button, [role="button"]');
      }
    }
    if (!target) {
      target = getZillowLightboxRootStrict() ||
        document.querySelector('#search-detail-lightbox button[aria-label*="close" i]') ||
        document.querySelector('.imx-lightbox button[aria-label*="close" i]') ||
        document.querySelector('[role="dialog"]');
    }
    if (target instanceof HTMLElement) {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true
      }));
    }
  }

  /**
   * Close Zillow mixed gallery / media lightbox.
   * First priority: button[title="Close media lightbox"]
   * Safe — does not use [role="dialog"] which clicks wrong buttons.
   */
  async function closeZillowMixedGallery() {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };

    const closeBtn = document.querySelector('button[title="Close media lightbox"]');

    if (closeBtn && isVisible(closeBtn)) {
      console.log('[Gallery] trying mixed gallery close button:', closeBtn);
      closeBtn.click();
      await sleep(800);

      const stillOpen = !!document.querySelector('button[title="Close media lightbox"]');
      if (!stillOpen) {
        console.log('[Gallery] mixed gallery closed via Close media lightbox');
        return { ok: true, method: 'mixed-gallery-close-button' };
      }
    } else {
      console.log('[Gallery] mixed gallery close button not found');
    }

    return { ok: false, method: 'mixed-gallery-close-button' };
  }

  function isPureGalleryOverlayOpen() {
    return !!document.querySelector([
      '[class*="VerticalMediaWall"]',
      '[data-testid*="hollywood-vertical-media-wall-container"]',
      '[class*="hollywood-vertical-media-wall"]',
      'ul[class*="hollywood-vertical-media-wall"]'
    ].join(','));
  }

  function findPureGalleryDialogCloseButton(dialogRoot) {
    if (!(dialogRoot instanceof HTMLElement)) return null;

    const selectorCandidates = [
      'button[aria-label="Close"]',
      'button[aria-label*="Close" i]',
      'button[data-testid*="close" i]',
      '[data-testid*="close" i]',
      'button[class*="CloseButton"]',
      '[class*="CloseButton"] button',
    ];

    for (const selector of selectorCandidates) {
      const node = dialogRoot.querySelector(selector);
      if (node instanceof HTMLElement && node.offsetParent !== null) {
        return node.closest('button') || node;
      }
    }

    const svgButton = Array.from(dialogRoot.querySelectorAll('svg')).map((svg) => svg.closest('button')).find((button) => {
      if (!(button instanceof HTMLElement) || button.offsetParent === null) return false;
      const label = [
        button.getAttribute('aria-label') || '',
        button.getAttribute('title') || '',
        button.className || '',
      ].join(' ');
      return /close|dismiss|x/i.test(label) || button.querySelector('path[d]');
    });
    if (svgButton instanceof HTMLElement) {
      return svgButton;
    }

    const visibleButtons = Array.from(dialogRoot.querySelectorAll('button')).filter((button) => {
      if (!(button instanceof HTMLElement) || button.offsetParent === null) return false;
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const dialogRect = dialogRoot.getBoundingClientRect();
      const nearTopRight = rect.top <= dialogRect.top + 120 && rect.right >= dialogRect.right - 160;
      return nearTopRight;
    });

    return visibleButtons[0] || null;
  }

  function findPureGalleryBackdrop(dialogRoot, galleryRoot) {
    if (!(dialogRoot instanceof HTMLElement)) return null;
    const dialogRect = dialogRoot.getBoundingClientRect();
    const candidates = Array.from(dialogRoot.querySelectorAll('div, section, aside')).filter((el) => {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) return false;
      if (galleryRoot && (el === galleryRoot || el.contains(galleryRoot) || galleryRoot.contains(el))) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const coversDialog = rect.width >= dialogRect.width * 0.85 && rect.height >= dialogRect.height * 0.85;
      const hasOverlayStyle = /overlay|backdrop|scrim|mask/i.test(String(el.className || ''));
      return coversDialog || hasOverlayStyle;
    });

    return candidates[0] || null;
  }

  async function closeZillowPureGalleryWithEscape(dialogRoot) {
    const targets = [
      document.activeElement,
      dialogRoot instanceof HTMLElement ? dialogRoot : document.querySelector('[role="dialog"], [aria-modal="true"]'),
      document.body,
    ].filter((el, index, arr) => el instanceof HTMLElement && typeof el.closest === 'function' && arr.indexOf(el) === index);

    for (const target of targets) {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      }));

      await shortDelay(120, 140);

      target.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      }));

      await shortDelay(650, 800);

      if (!isPureGalleryOverlayOpen()) {
        console.log('[Gallery] pure gallery closed via Escape');
        markGalleryClosed();
        return true;
      }
    }

    console.log('[Gallery] pure gallery Escape close failed');
    return false;
  }

  async function attemptClosePureGallery(dialogRoot, galleryRoot) {
    const closeButton = findPureGalleryDialogCloseButton(dialogRoot);
    if (closeButton instanceof HTMLElement) {
      console.log('[Gallery] attempting pure gallery close via dialog button');
      closeButton.click();
      await shortDelay(150, 220);
      if (!isPureGalleryOverlayOpen()) {
        markGalleryClosed();
        return true;
      }
    }

    const closedByEscape = await closeZillowPureGalleryWithEscape(dialogRoot);
    if (closedByEscape) {
      return true;
    }

    const backdrop = findPureGalleryBackdrop(dialogRoot, galleryRoot);
    if (backdrop instanceof HTMLElement) {
      console.log('[Gallery] attempting pure gallery close via backdrop');
      backdrop.click();
      await shortDelay(180, 260);
      if (!isPureGalleryOverlayOpen()) {
        markGalleryClosed();
        return true;
      }
    }

    return false;
  }

  async function closeGallery(galleryType = 'none') {
    try {
      if (!_galleryWasOpened && !isAnyGalleryOpen()) {
        console.log('[Gallery] closeGallery success — no gallery was opened or currently open');
        return true;
      }

      const normalizedType = normalizeGalleryType(galleryType);
      const beforeUrl = window.location.href;
      const beforePath = window.location.pathname;
      const pureGalleryRoot = getZillowPureGalleryRoot();
      const isPureGallery = normalizedType === 'pure_gallery' || Boolean(pureGalleryRoot);
      const pureGalleryDialog = pureGalleryRoot?.closest('[role="dialog"], [aria-modal="true"]') || document.querySelector('[role="dialog"][aria-modal="true"], [role="dialog"], [aria-modal="true"]');

      // ── Always try mixed gallery close first ───────────────────────────────
      // Mixed gallery can be open even if galleryType detection returned 'none'.
      const mixedResult = await closeZillowMixedGallery();
      if (mixedResult.ok) {
        markGalleryClosed();
        console.log('[Gallery] closeGallery success');
        return true;
      }

      // ── IMX lightbox close ──────────────────────────────────────────────────
      if (normalizedType === 'imx_lightbox_carousel' || isImxLightboxOpen()) {
        const imxCloseSelectors = [
          '#search-detail-lightbox button[aria-label*="close" i]',
          '#search-detail-lightbox button[data-testid="modal-close"]',
          '.imx-lightbox button[aria-label*="close" i]',
          '.imx-lightbox-modal button[aria-label*="close" i]',
        ];
        for (const sel of imxCloseSelectors) {
          const btn = document.querySelector(sel);
          if (btn instanceof HTMLElement && btn.offsetParent !== null) {
            console.log('[gallery] Closing IMX lightbox via:', sel);
            btn.click();
            await shortDelay(150, 250);
            if (!isAnyGalleryOpen()) {
              markGalleryClosed();
              return true;
            }
          }
        }
        // Try Escape key on IMX root
        const imxRoot = getImxRoot();
        if (imxRoot instanceof HTMLElement) {
          dispatchEscapeToElementTarget();
          await shortDelay(200, 300);
          if (!isAnyGalleryOpen()) {
            markGalleryClosed();
            return true;
          }
        }
      }

      // ── Hollywood / PureGallery / StyledDialog close ─────────────────────────
      if (isPureGallery) {
        const pureClosed = await attemptClosePureGallery(pureGalleryDialog, pureGalleryRoot);
        if (pureClosed) {
          return true;
        }
        console.warn('[Gallery] pure gallery close attempts exhausted; skip history.back to avoid navigation');
      }

      const lightboxRoot = getZillowLightboxRootStrict();
      if (!isPureGallery && lightboxRoot && (normalizedType === 'hollywood_vertical_wall' || normalizedType === 'styled_dialog' || normalizedType === 'imx_lightbox_carousel' || isZillowPage())) {
        const dialogRoot = getZillowPureGalleryRoot()?.closest('[role="dialog"], [aria-modal="true"]') || lightboxRoot.closest?.('[role="dialog"], [aria-modal="true"]') || lightboxRoot;
        const closeBtnSelectors = [
          'button[aria-label*="close" i]',
          '[data-testid="modal-close"]',
          'button[class*="close"]',
          'button[title="Close media lightbox"]',
        ];
        for (const sel of closeBtnSelectors) {
          const btn = dialogRoot?.querySelector?.(sel) || document.querySelector(sel);
          if (btn instanceof HTMLElement && btn.offsetParent !== null) {
            console.log('[gallery] Clicking Zillow close button:', sel);
            btn.click();
            await shortDelay(120, 180);
            if (!isAnyGalleryOpen()) {
              markGalleryClosed();
              return true;
            }
          }
        }
        dispatchEscapeToElementTarget();
        await shortDelay(220, 320);
        if (!isAnyGalleryOpen()) {
          markGalleryClosed();
          return true;
        }
      }

      // ── PhotoSwipe close ────────────────────────────────────────────────────
      if (normalizedType === 'photoswipe_lightbox' || isPhotoSwipeOpen()) {
        const closeBtn = document.querySelector('.pswp__button--close');
        if (closeBtn instanceof HTMLElement) {
          closeBtn.click();
          await shortDelay(120, 180);
        }
        if (isPhotoSwipeOpen()) {
          dispatchEscapeToElementTarget();
          await shortDelay(220, 320);
        }
      }

      // ── Final fallback: history.back ────────────────────────────────────────
      const stillOpen = isAnyGalleryOpen();
      if (stillOpen && _galleryOpenedByHomeScope && !isPureGallery && /\/homedetails\//i.test(beforeUrl)) {
        console.log('[Gallery] still open after all close attempts, trying history.back');
        history.back();
        await shortDelay(600, 900);
        const afterUrl = window.location.href;
        const afterPath = window.location.pathname;
        console.log('[Gallery] history.back: beforeUrl=', beforeUrl, 'afterUrl=', afterUrl);
        const leftHomeDetails = /\/homedetails\//i.test(beforePath) && !/\/homedetails\//i.test(afterPath);
        if (leftHomeDetails) {
          console.warn('[Gallery] history.back navigated away, restored, close failed');
          history.forward();
          await shortDelay(300, 450);
          if (!/\/homedetails\//i.test(window.location.pathname)) {
            window.location.assign(beforeUrl);
            await shortDelay(500, 700);
          }
          return false;
        }
        const closedViaHistory = !isAnyGalleryOpen() && /\/homedetails\//i.test(window.location.pathname || beforePath);
        if (closedViaHistory) {
          markGalleryClosed();
          console.log('[Gallery] closeGallery success via history.back');
          return true;
        }
      }

      const closed = !isAnyGalleryOpen();
      if (!closed && _galleryOpenedByHomeScope) {
        restoreGentlePageState();
      }
      if (closed) {
        markGalleryClosed();
      }
      if (!closed) {
        console.log('[Gallery] closeGallery failed');
      } else {
        console.log('[Gallery] closeGallery success');
      }
      return closed;
    } catch (err) {
      console.error('[gallery] closeGallery error:', err);
      return false;
    } finally {
      resetGalleryOpenState();
    }
  }

  /**
   * NEW PhotoSwipe gallery extraction using signature-based approach.
   * PhotoSwipe only.
   *
   * @returns {Promise<string[]>} Deduplicated image URL array
   */
  async function collectByPhotoSwipePaging(expectedCount) {
    if (_pagingLock) {
      noop('[DIAG] collectByPhotoSwipePaging: paging lock is held, returning empty');
      return [];
    }
    _pagingLock = true;
    const result = [];
    noop('[DIAG] collectByPhotoSwipePaging: starting');
    try {
      var _initialSnapshot$sign;
      if (!isPhotoSwipeOpen()) {
        console.warn('[Gallery] collectByPhotoSwipePaging called but PhotoSwipe is not open');
        return [];
      }
      const pswp = document.querySelector('.pswp.pswp--open');
      if (!pswp) {
        noop('[DIAG] collectByPhotoSwipePaging: PhotoSwipe not open, returning empty');
        return [];
      }
      noop('[DIAG] collectByPhotoSwipePaging: PhotoSwipe is open');

      // Wait for gallery to be ready
      const ready = await waitForGalleryReady(5000);
      if (!ready.ready) {
        console.warn('[gallery] PhotoSwipe gallery not ready after 5s, proceeding with available data');
      } else {
        console.log('[gallery] Gallery ready after', ready.pollCount, 'polls');
      }

      // Get PhotoSwipe instance info
      const pswpInfo = getPhotoSwipeInstance();
      const totalSlides = (pswpInfo === null || pswpInfo === void 0 ? void 0 : pswpInfo.totalSlides) || 0;
      console.log('[gallery] PhotoSwipe instance:', pswpInfo ? `found (uid=${pswpInfo.uid}, totalSlides=${totalSlides})` : 'not found');

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
        result.push({
          signature: firstSignature,
          url: firstSrc
        });
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
        signature: (_initialSnapshot$sign = initialSnapshot.signature) === null || _initialSnapshot$sign === void 0 ? void 0 : _initialSnapshot$sign.substring(0, 20),
        strategy: initialSnapshot.strategy
      });
      while (totalAttempts < MAX_TOTAL) {
        var _pswpInfoNow$instance, _pswpInfoNow$instance2, _pswpInfoNow$instance3, _waitResult$newSnapsh;
        // 检查是否超过最大执行时间
        const elapsedTime = Date.now() - loopStartTime;
        if (elapsedTime > MAX_EXECUTION_TIME) {
          noop('[DIAG] collectByPhotoSwipePaging: MAX_EXECUTION_TIME reached, exiting loop');
          console.log('[gallery] Max execution time (30s) reached, stopping extraction');
          break;
        }
        totalAttempts++;

        // Re-fetch pswpInfo each iteration (DOM may have changed)
        const pswpInfoNow = getPhotoSwipeInstance();
        const totalSlidesNow = (pswpInfoNow === null || pswpInfoNow === void 0 ? void 0 : pswpInfoNow.totalSlides) || 0;
        const prevCurrIndex = (_pswpInfoNow$instance = pswpInfoNow === null || pswpInfoNow === void 0 || (_pswpInfoNow$instance2 = pswpInfoNow.instance) === null || _pswpInfoNow$instance2 === void 0 ? void 0 : _pswpInfoNow$instance2.currIndex) !== null && _pswpInfoNow$instance !== void 0 ? _pswpInfoNow$instance : 0;
        console.log('[gallery] Loop', totalAttempts, '- currIndex:', prevCurrIndex, 'totalSlides:', totalSlidesNow);
        noop('[DIAG] collectByPhotoSwipePaging: Loop iteration', totalAttempts, '- pswpInfo:', {
          hasInstance: !!pswpInfoNow,
          totalSlides: totalSlidesNow,
          prevCurrIndex,
          // 检查 instance 上有哪些属性
          instanceType: pswpInfoNow !== null && pswpInfoNow !== void 0 && pswpInfoNow.instance ? typeof pswpInfoNow.instance : null,
          instanceKeys: pswpInfoNow !== null && pswpInfoNow !== void 0 && pswpInfoNow.instance ? Object.keys(pswpInfoNow.instance) : null,
          // 尝试直接访问可能的属性
          directCurrIndex: pswpInfoNow === null || pswpInfoNow === void 0 || (_pswpInfoNow$instance3 = pswpInfoNow.instance) === null || _pswpInfoNow$instance3 === void 0 ? void 0 : _pswpInfoNow$instance3.currIndex,
          directUid: pswpInfoNow === null || pswpInfoNow === void 0 ? void 0 : pswpInfoNow.uid,
          // 检查 pswpRoot
          pswpRootExists: !!document.querySelector('.pswp')
        });

        // 检查是否已经到了最后一张图，如果是则退出
        const isAtLastSlide = pswpInfoNow && totalSlidesNow > 0 && prevCurrIndex === totalSlidesNow - 1;
        if (isAtLastSlide) {
          noop('[DIAG] collectByPhotoSwipePaging: Already at last slide, exiting');
          console.log('[gallery] Already at last slide, exiting');
          break;
        }

        // Advance to next slide
        const advanceResult = advanceToNextSlide();
        noop('[DIAG] collectByPhotoSwipePaging: advanceToNextSlide result:', advanceResult);
        console.log('[gallery] Attempt', totalAttempts, '- advanceToNextSlide:', advanceResult);

        // Wait for slide to change — pass full snapshot (not result item)
        const waitResult = await waitForRealSlideChange(currentSnapshot,
        // Always pass the current full snapshot
        prevCurrIndex, 6000 // Increased timeout for slow connections
        );
        noop('[DIAG] collectByPhotoSwipePaging: waitResult:', {
          changed: waitResult.changed,
          reason: waitResult.reason,
          polls: waitResult.polls,
          newSignature: (_waitResult$newSnapsh = waitResult.newSnapshot) === null || _waitResult$newSnapsh === void 0 || (_waitResult$newSnapsh = _waitResult$newSnapsh.signature) === null || _waitResult$newSnapsh === void 0 ? void 0 : _waitResult$newSnapsh.substring(0, 20)
        });
        if (!waitResult.changed) {
          // 图片未变化，检查是否到了图库边界
          const pswpInfoNow = getPhotoSwipeInstance();
          const isAtLastSlide = pswpInfoNow && pswpInfoNow.totalSlides > 0 && pswpInfoNow.instance.currIndex === pswpInfoNow.totalSlides - 1;
          const isAtFirstSlide = pswpInfoNow && pswpInfoNow.instance.currIndex === 0;
          if (isAtLastSlide || isAtFirstSlide) {
            noop('[DIAG] collectByPhotoSwipePaging: At gallery boundary (timeout), exiting');
            console.log('[gallery] Reached gallery boundary, exiting');
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
          const isAtLastSlide = pswpInfoNow && pswpInfoNow.totalSlides > 0 && pswpInfoNow.instance.currIndex === pswpInfoNow.totalSlides - 1;
          const isAtFirstSlide = pswpInfoNow && pswpInfoNow.instance.currIndex === 0;

          // 如果到了边界，视为收集完成
          if (isAtLastSlide || isAtFirstSlide) {
            noop('[DIAG] collectByPhotoSwipePaging: At gallery boundary, exiting');
            console.log('[gallery] Reached gallery boundary (first/last slide), exiting');
            break;
          }
          // 否则可能是加载延迟，继续等待
          continue;
        }

        // Record new image (result item — signature + url only)
        seenSignatures.add(newSignature);
        result.push({
          signature: newSignature,
          url: newSrc
        });
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
      const finalUrls = result.filter(item => item.signature || item.url).map(item => item.url).filter((url, idx, arr) => arr.indexOf(url) === idx);
      return expectedCount ? finalUrls.slice(0, expectedCount) : finalUrls;
    } finally {
      _pagingLock = false;
    }
  }

  function getZillowMediaWallRoot() {
    return document.querySelector('#search-detail-lightbox [data-testid="hollywood-vertical-media-wall"]') || document.querySelector('#search-detail-lightbox [data-testid*="hollywood-vertical-media-wall"]') || document.querySelector('[data-testid="hollywood-vertical-media-wall"]') || document.querySelector('[data-testid*="hollywood-vertical-media-wall"]') || document.querySelector('[class*="StyledVerticalMediaWall"]') || document.querySelector('[class*="VerticalMediaWall"]') || document.querySelector('#search-detail-lightbox');
  }

  function getZillowMediaWallTiles() {
    const root = getZillowMediaWallRoot();
    if (!root) return [];
    return Array.from(root.querySelectorAll('[data-testid^="vmw-photo-"]')).map(el => {
      const testId = el.getAttribute('data-testid') || '';
      const match = testId.match(/vmw-photo-(\d+)/i);
      return {
        el,
        index: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
      };
    }).filter(item => Number.isFinite(item.index)).sort((a, b) => a.index - b.index);
  }

  function findHollywoodScrollContainer() {
    const mediaWall = getZillowMediaWallRoot();
    if (!mediaWall) return window;
    const candidates = [];
    let node = mediaWall;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node instanceof HTMLElement) candidates.push(node);
      node = node.parentElement;
    }
    document.querySelectorAll('#search-detail-lightbox [tabindex="0"], #search-detail-lightbox [role="dialog"], [role="dialog"] [tabindex="0"], [role="dialog"]').forEach(el => {
      if (el instanceof HTMLElement && !candidates.includes(el)) {
        candidates.push(el);
      }
    });
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      const hasScrollableSize = el.scrollHeight > el.clientHeight + 50;
      const isVisible = el.offsetParent !== null || style.position === 'fixed' || style.position === 'absolute';
      if (!isVisible || !hasScrollableSize) continue;
      const before = el.scrollTop;
      el.scrollTop = before + 10;
      const after = el.scrollTop;
      el.scrollTop = before;
      if (after !== before) {
        console.log('[Gallery] Hollywood scroll container found:', {
          tag: el.tagName,
          id: el.id,
          className: String(el.className),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop
        });
        return el;
      }
    }
    console.warn('[Gallery] Hollywood scroll container fallback to window');
    return window;
  }

  function isValidZillowImageUrl(url) {
    const normalized = upgradeToHiRes(url || '');
    return Boolean(normalized) && normalized.includes('photos.zillowstatic.com') && !/3d-tour|floorplan|dron|latlng|tour-preview/i.test(normalized);
  }

  function getZillowImageQualityScore(url) {
    const normalized = upgradeToHiRes(url || '');
    let score = 0;
    const widthMatch = normalized.match(/(?:_|-)ft_(\d+)\./i) || normalized.match(/(?:^|[?&])w(?:idth)?=(\d+)/i);
    if (widthMatch) score += Number(widthMatch[1]) || 0;
    if (normalized.includes('-cc_ft_1536')) score += 5000;
    if (normalized.includes('-cc_ft_960')) score += 2000;
    return score;
  }

  function parseSrcsetCandidates(srcset) {
    if (!srcset) return [];
    return String(srcset).split(',').map(part => {
      const pieces = part.trim().split(/\s+/);
      const url = pieces[0];
      const descriptor = pieces[1] || '';
      let descriptorScore = 0;
      const wMatch = descriptor.match(/^(\d+)w$/i);
      if (wMatch) descriptorScore = Number(wMatch[1]);
      const xMatch = descriptor.match(/^([\d.]+)x$/i);
      if (xMatch) descriptorScore = Number(xMatch[1]) * 1000;
      return {
        url,
        descriptorScore
      };
    }).filter(item => item.url);
  }

  function collectBestImageFromTile(tileEl) {
    const candidates = [];
    const addCandidate = (url, extraScore = 0) => {
      if (!url || !isValidZillowImageUrl(url)) return;
      candidates.push({
        url: upgradeToHiRes(url),
        score: getZillowImageQualityScore(url) + extraScore
      });
    };
    tileEl.querySelectorAll('source').forEach(source => {
      parseSrcsetCandidates(source.getAttribute('srcset')).forEach(item => {
        addCandidate(item.url, item.descriptorScore);
      });
    });
    tileEl.querySelectorAll('img').forEach(img => {
      addCandidate(img.currentSrc, 1);
      addCandidate(img.getAttribute('src'), 1);
      addCandidate(img.getAttribute('data-src'), 1);
      parseSrcsetCandidates(img.getAttribute('srcset')).forEach(item => {
        addCandidate(item.url, item.descriptorScore);
      });
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].url;
  }

  async function collectPureGalleryImages(expectedCount = null) {
    const uniq = (items) => Array.from(new Set(items.filter(Boolean)));
    const parseSrcset = (srcset) => {
      if (!srcset) return [];
      return String(srcset).split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
    };
    const normalizePureGalleryUrl = (url) => {
      if (!url) return null;
      const value = String(url).replace(/&amp;/g, '&').replace(/^\/\//, 'https://');
      if (!value.includes('photos.zillowstatic.com/fp/')) return null;
      if (!/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(value)) return null;
      return upgradeToHiRes(value);
    };
    const getPhotoId = (url) => String(url || '').match(/\/fp\/([a-f0-9]{24,64})/i)?.[1] || null;
    const chooseBestByPhotoId = (urls) => {
      const byId = new Map();
      urls.forEach((url) => {
        const id = getPhotoId(url);
        if (!id) return;
        const existing = byId.get(id);
        if (!existing || getZillowImageQualityScore(url) > getZillowImageQualityScore(existing)) {
          byId.set(id, url);
        }
      });
      return Array.from(byId.values());
    };
    const collectFromRoot = (root) => {
      if (!root) return [];
      const urls = [];
      root.querySelectorAll('img').forEach((img) => {
        urls.push(img.currentSrc, img.src, img.getAttribute('src'));
        urls.push(...parseSrcset(img.getAttribute('srcset')));
      });
      root.querySelectorAll('source').forEach((source) => {
        urls.push(source.src, source.getAttribute('src'));
        urls.push(...parseSrcset(source.getAttribute('srcset')));
      });
      root.querySelectorAll('*').forEach((el) => {
        Array.from(el.attributes || []).forEach((attr) => {
          const value = attr?.value || '';
          if (!value.includes('photos.zillowstatic.com/fp/')) return;
          const matches = value.match(/https?:\/\/photos\.zillowstatic\.com\/fp\/[^"'()\s<>\\]+/g);
          if (matches) urls.push(...matches);
        });
        const style = el.getAttribute('style') || '';
        if (style.includes('photos.zillowstatic.com/fp/')) {
          const matches = style.match(/https?:\/\/photos\.zillowstatic\.com\/fp\/[^"'()\s<>\\]+/g);
          if (matches) urls.push(...matches);
        }
      });
      return uniq(urls.map(normalizePureGalleryUrl));
    };
    const findScrollableContainer = (root, dialog) => {
      const scope = dialog || root || document.body;
      const candidates = uniq([root, dialog, ...Array.from(scope?.querySelectorAll?.('*') || [])]);
      return candidates
        .filter((el) => el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 80)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || dialog || root || null;
    };

    const vertical = getZillowPureGalleryRoot();
    const dialog = vertical?.closest('[role="dialog"], [aria-modal="true"]') || document.querySelector('[role="dialog"], [aria-modal="true"]');
    const root = vertical || dialog;
    if (!root) {
      return {
        ok: false,
        imageUrls: [],
        collectedCount: 0,
        expectedCount,
        failureReason: 'No pure gallery root found'
      };
    }

    const scrollBox = findScrollableContainer(vertical || root, dialog);
    const all = [];
    const collectTargets = () => {
      all.push(...collectFromRoot(vertical));
      if (dialog && dialog !== vertical) all.push(...collectFromRoot(dialog));
      if (root !== vertical && root !== dialog) all.push(...collectFromRoot(root));
    };

    collectTargets();
    if (scrollBox instanceof HTMLElement) {
      const maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
      const steps = 12;
      for (let index = 0; index <= steps; index++) {
        scrollBox.scrollTop = Math.round(maxScroll * (index / steps));
        scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
        await shortDelay(320, 380);
        collectTargets();
      }
      scrollBox.scrollTop = 0;
    }

    await shortDelay(320, 420);
    collectTargets();

    let imageUrls = chooseBestByPhotoId(uniq(all));
    if (expectedCount && imageUrls.length > expectedCount) {
      imageUrls = imageUrls.slice(0, expectedCount);
    }

    return {
      ok: imageUrls.length > 0,
      imageUrls,
      collectedCount: imageUrls.length,
      expectedCount,
      failureReason: imageUrls.length ? null : 'No Zillow photo URLs collected from pure gallery'
    };
  }

  async function extractFromHollywoodVerticalWall(expectedCount) {
    console.log('[Gallery] Hollywood tile-based extraction starting', {
      expectedCount
    });
    const scrollContainer = findHollywoodScrollContainer();
    const byIndex = new Map();
    const start = Date.now();
    const timeoutMs = 15000;
    let stableRounds = 0;
    let lastLoadedCount = 0;
    let lastScrollTop = -1;
    while (Date.now() - start < timeoutMs) {
      const tiles = getZillowMediaWallTiles();
      for (const {
        el,
        index
      } of tiles) {
        if (expectedCount && index >= expectedCount) continue;
        const url = collectBestImageFromTile(el);
        if (url) byIndex.set(index, url);
      }
      const loadedCount = byIndex.size;
      const scrollTop = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;
      const scrollHeight = scrollContainer === window ? document.documentElement.scrollHeight : scrollContainer.scrollHeight;
      const clientHeight = scrollContainer === window ? window.innerHeight : scrollContainer.clientHeight;
      console.log('[Gallery] Hollywood scroll/collect progress', {
        expectedCount,
        tileCount: tiles.length,
        loadedImageCount: loadedCount,
        scrollTop,
        scrollHeight,
        clientHeight
      });
      if (expectedCount && loadedCount >= expectedCount) {
        break;
      }
      if (loadedCount === lastLoadedCount && scrollTop === lastScrollTop) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastLoadedCount = loadedCount;
        lastScrollTop = scrollTop;
      }
      if (stableRounds >= 6) {
        console.warn('[Gallery] Hollywood extraction stable too long, stopping', {
          loadedCount,
          expectedCount,
          scrollTop
        });
        break;
      }
      const tilesNow = getZillowMediaWallTiles();
      const lastTile = tilesNow[tilesNow.length - 1]?.el;
      if (lastTile) {
        try {
          lastTile.scrollIntoView({
            block: 'end',
            inline: 'nearest',
            behavior: 'instant'
          });
        } catch (_) {
          lastTile.scrollIntoView(false);
        }
      }
      if (scrollContainer === window) {
        window.scrollBy(0, 900);
      } else {
        scrollContainer.scrollTop = Math.min(scrollContainer.scrollTop + 900, scrollContainer.scrollHeight);
      }
      await shortDelay(360, 440);
    }
    const result = Array.from(byIndex.entries()).sort(([a], [b]) => a - b).map(([, url]) => url);
    console.log('[Gallery] Hollywood tile-based extraction finished', {
      expectedCount,
      finalCount: result.length,
      indexes: Array.from(byIndex.keys()).sort((a, b) => a - b)
    });
    return expectedCount ? result.slice(0, expectedCount) : result;
  }

  /**
   * 切换到 Zillow StyledDialog 中的 Photos Tab
   * 返回 true 表示已切换或已在 Photos tab，返回 false 表示找不到 Tab
   */
  async function switchToPhotosTab() {
    const dialog = document.querySelector('[class*="StyledDialog"]') || document.querySelector('[role="dialog"]');
    if (!dialog) return false;

    // 查找所有 Tab 元素（button / role="tab" / div[tabindex]）
    const tabCandidates = dialog.querySelectorAll('button, [role="tab"], [role="menuitem"], [tabindex="0"]');
    for (const tab of tabCandidates) {
      const label = (tab.textContent || tab.getAttribute('aria-label') || '').toLowerCase();
      // 匹配 Photos / Photo Gallery 等
      if (/^photo/i.test(label)) {
        // 检查是否已激活（避免重复点击）
        const isActive = tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-current') === 'true' || tab.className.includes('active') || tab.className.includes('selected');
        if (isActive) {
          console.log('[gallery] Already on Photos tab');
          return true;
        }
        console.log('[gallery] Clicking Photos tab:', label);
        try {
          tab.click();
        } catch (_) {
          try {
            tab.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true
            }));
          } catch (_2) {}
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
   * Returns deduplicated image URLs, upgraded to highest resolution.
   * Filters out 3D Tour, Floor Plan, Map, Street View, Drone images.
   */
  async function extractGalleryImagesZillow() {
    const images = [];
    const seen = new Set();

    // 查找图库对话框
    const dialog = document.querySelector('[class*="StyledDialog"]') || document.querySelector('[role="dialog"]');
    if (!dialog) {
      console.log('[ZillowGallery] Dialog not found');
      return images;
    }

    // ── 策略0: 从页面 JavaScript 数据中提取（最可靠）─────────────────────
    // Zillow 在 __NEXT_DATA__ 或 gdpClientCache 中存储所有图片 URL
    const pageImages = extractImagesFromPageData();
    if (pageImages.length > 0) {
      console.log('[ZillowGallery] Extracted', pageImages.length, 'images from page data');
      return pageImages;
    }

    // ── 策略0.5: 从 media-stream-tile 提取（新版 Zillow 图库结构）───────
    // 根据 aria-label="view larger view of the X photo of this home" 去重
    const mediaStreamTiles = dialog.querySelectorAll('li[class*="media-stream-tile"]');
    if (mediaStreamTiles.length > 0) {
      console.log('[ZillowGallery] Found', mediaStreamTiles.length, 'media-stream-tile elements');

      // 按 aria-label 编号提取图片，去重
      const tileMap = new Map();
      mediaStreamTiles.forEach(tile => {
        const img = tile.querySelector('img');
        const btn = tile.querySelector('button[aria-label*="view larger view of the"]');
        if (img && btn) {
          const ariaLabel = btn.getAttribute('aria-label') || '';
          const match = ariaLabel.match(/view larger view of the (\d+) photo/);
          if (match) {
            const index = parseInt(match[1], 10);
            const src = img.src || img.currentSrc || '';

            // 只保留 zillowstatic 图片
            if (src.includes('photos.zillowstatic.com') && !tileMap.has(index)) {
              tileMap.set(index, upgradeToHiRes(src));
            }
          }
        }
      });
      if (tileMap.size > 0) {
        // 按序号排序
        const sortedImages = Array.from(tileMap.entries()).sort((a, b) => a[0] - b[0]).map(([_, url]) => url);
        console.log('[ZillowGallery] Initial media-stream-tile extraction:', sortedImages.length, 'images (before lazy load)');

        // 如果图片数量少于预期，继续触发懒加载
        // （虚拟列表可能只有部分渲染，需要滚动触发加载）
        if (sortedImages.length < 10) {
          console.log('[ZillowGallery] Few images found, triggering lazy load to load more...');
          // 继续执行下面的懒加载逻辑，不提前返回
        } else {
          // 图片数量足够，直接返回
          console.log('[ZillowGallery] Media stream tiles extracted', sortedImages.length, 'unique images');
          return sortedImages;
        }
      }
    }

    // ── 懒加载触发：滚动图库容器加载所有图片 ──────────────────────────────
    // Zillow 使用虚拟列表，只渲染可见区域，需要滚动触发懒加载
    // 关键：滚动容器是 DialogBody，不是图片墙本身

    // 优先使用 DialogBody 作为滚动容器（对于新版 Zillow）
    const DialogBody = dialog.querySelector('[class*="DialogBody"]') || dialog;
    const mediaContainer = DialogBody.querySelector('[class*="media-wall"], ' + '[class*="StyledMediaWall"], ' + '[class*="PhotoViewerContent"], ' + '[class*="gallery"], ' + 'ul[class*="media"], ' + 'div[class*="media"], ' + '[class*="photo-grid"], ' + '[class*="photo-list"]');

    // 使用哪个元素滚动（优先 DialogBody）
    const scrollContainer = DialogBody.scrollHeight > DialogBody.clientHeight ? DialogBody : mediaContainer;
    if (scrollContainer) {
      console.log('[ZillowGallery] Triggering lazy load by scrolling', scrollContainer.tagName, 'scrollH=', scrollContainer.scrollHeight, 'clientH=', scrollContainer.clientHeight);

      // 打开图库后等待 0.5 秒，让初始内容加载完成
      await new Promise(r => setTimeout(r, 500));

      // 获取初始图片数量（从 dialog 内查找）
      const getImgCount = () => dialog.querySelectorAll('img').length;
      const TOLERANCE = 10; // 滚动到底的容差值（像素）
      const SCROLL_STEP_MS = 500; // 每步滚动后等待时间
      const SCROLL_STEP_SIZE = 700; // 每次滚动 700 像素

      /**
       * 检测滚动容器是否已经滚到底部
       */
      function isScrolledToBottom() {
        const {
          scrollTop,
          clientHeight,
          scrollHeight
        } = scrollContainer;
        return scrollTop + clientHeight >= scrollHeight - TOLERANCE;
      }

      // 逐步滚动到底部，每步滚动后等待 0.5 秒
      let stepCount = 0;
      while (true) {
        stepCount++;

        // 记录滚动前位置
        const prevScrollTop = scrollContainer.scrollTop;

        // 逐步向下滚动一步
        const targetScroll = prevScrollTop + SCROLL_STEP_SIZE;
        scrollContainer.scrollTop = Math.min(targetScroll, scrollContainer.scrollHeight);
        await new Promise(r => setTimeout(r, SCROLL_STEP_MS));

        // 获取滚动后状态
        const newScrollTop = scrollContainer.scrollTop;
        const currentCount = getImgCount();
        const atBottom = isScrolledToBottom();
        console.log('[ZillowGallery] Step', stepCount, '- scrollTop:', newScrollTop, '/', scrollContainer.scrollHeight, '- images:', currentCount, '- atBottom:', atBottom);

        // 判断是否应该退出
        if (atBottom) {
          console.log('[ZillowGallery] Reached bottom');
          break;
        }

        // 防止无限循环（最多滚动200步）
        if (stepCount >= 200) {
          console.log('[ZillowGallery] Max steps reached, stopping');
          break;
        }
      }

      // 滚动回顶部
      scrollContainer.scrollTop = 0;
      await new Promise(r => setTimeout(r, 300));

      // 最终等待确保所有图片渲染完成
      await new Promise(r => setTimeout(r, 500));
      console.log('[ZillowGallery] Lazy load scrolling complete, total images found:', getImgCount());
    }

    // ── 策略1: 从 Photos 专用区域提取（最准确）────────────────────────────
    const photoWallSelectors = ['ul[class*="hollywood-vertical-media-wall"]', 'ul[class*="media-wall-container"]', 'ul[class*="media-wall"]', '[class*="StyledMediaWall"]', 'ul[class*="media-stream"]', '[class*="media-wall"]', 'ul[class*="photo-stream"]'];
    for (const sel of photoWallSelectors) {
      const wall = dialog.querySelector(sel);
      if (wall) {
        const wallImgs = wall.querySelectorAll('img');
        for (const img of wallImgs) {
          const src = extractBestImageSrc(img);
          if (src) {
            const hiRes = upgradeToHiRes(src);
            if (!seen.has(hiRes)) {
              seen.add(hiRes);
              images.push(hiRes);
            }
          }
        }
        if (images.length > 0) {
          console.log('[ZillowGallery] Photo wall found, got', images.length, 'images');
          return images;
        }
      }
    }

    // ── 策略2: 兜底 — 从整个对话框提取，放宽过滤条件 ─────────────────────
    const imgs = dialog.querySelectorAll('img');
    for (const img of imgs) {
      let src = img.src || img.currentSrc || img.getAttribute('data-src') || '';

      // 只要是 Zillow CDN 图片就尝试获取
      if (!src || !src.includes('photos.zillowstatic.com') && !src.includes('photos.wikimapia') && !src.includes('mlsimaging')) continue;

      // 排除明显的非照片媒体
      if (/3d-tour|floorplan|dron|latlng|tour-preview/i.test(src)) continue;

      // 只过滤极小的缩略图（可能是地图/图标）
      const rect = img.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 30) continue;

      // 升级到高清并去除查询参数
      src = upgradeToHiRes(src);
      if (!seen.has(src)) {
        seen.add(src);
        images.push(src);
      }
    }
    console.log('[ZillowGallery] Found', images.length, 'images');
    return images;
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
            if (!seen.has(url)) {
              seen.add(url);
              images.push(url);
            }
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
            if (!seen.has(url)) {
              seen.add(url);
              images.push(url);
            }
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
                if (!seen.has(url)) {
                  seen.add(url);
                  images.push(url);
                }
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
            if (!seen.has(url)) {
              seen.add(url);
              images.push(url);
            }
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
          console.log('[ZillowGallery] Found', photos.length, 'photos in __NEXT_DATA__');
          return photos;
        }
      } catch (e) {
        console.log('[ZillowGallery] Failed to parse __NEXT_DATA__:', e.message);
      }
    }

    // 尝试从页面中的 JSON 数据提取
    const jsonScripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of jsonScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const photos = deepFindPhotos(data);
        if (photos.length > images.length) {
          console.log('[ZillowGallery] Found', photos.length, 'photos in JSON script');
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
   * 从 img 元素提取最佳图片 URL（优先 srcset）
   */
  function extractBestImageSrc(img) {
    const ss = img.getAttribute('srcset');
    if (ss) {
      const parts = ss.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
      // 取最高分辨率（通常是最后一个，1536w）
      const best = parts[parts.length - 1];
      if (best) return best;
    }
    return img.currentSrc || img.src || img.getAttribute('data-src') || '';
  }

  /**
   * 将 Zillow CDN 图片 URL 升级到最高质量
   */
  function upgradeToHiRes(url) {
    if (!url) return '';
    return url.replace(/-cc_ft_\d+\.jpg/, '-cc_ft_1536.jpg').replace(/[?&]width=\d+/g, '').replace(/[?&]height=\d+/g, '').replace(/[?&]fit=\w+/g, '').replace(/[?&]downsample=\w+/g, '').replace(/\?.*$/, '');
  }

  // ── Mark as ready ──
  isReady = true;
})(); // End of IIFE