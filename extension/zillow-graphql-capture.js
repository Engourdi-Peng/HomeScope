// zillow-graphql-capture.js
// Main world injection — loaded via zillow-graphql-bridge.js
// Responsibilities: fetch/XHR interception, GraphQL response normalization, SPA route listening, snapshot serving

(function() {
  'use strict';

  // ─── 3.1 Installation marker ───────────────────────────────────────────────────
  if (window.__HS_GRAPHQL_CAPTURE__) return;
  window.__HS_GRAPHQL_CAPTURE__ = {
    _snapshot: null,
    _currentZpid: null,
    _currentPathname: null,
    _installed: false,
    _installedXHR: false
  };

  // ─── 3.2 Helper functions ─────────────────────────────────────────────────────
  function normalizePath(path) {
    try {
      return new URL(path, location.href).pathname;
    } catch {
      return (path || '').replace(/[#?].*$/, '');
    }
  }

  function extractCurrentZpid() {
    var m = location.pathname.match(/(\d+)_zpid/);
    return m ? m[1] : null;
  }

  function normalizeAddressValue(value) {
    if (!value) return null;

    if (typeof value === 'string') {
      var text = value.trim();
      return text || null;
    }

    if (typeof value === 'object') {
      var street = value.streetAddress || value.addressLine1 || null;
      var city = value.city || null;
      var state = value.state || value.stateId || null;
      var zipcode = value.zipcode || value.zipCode || value.postalCode || null;

      var locality = [city, state].filter(Boolean).join(', ');
      var tail = [locality, zipcode].filter(Boolean).join(' ');

      var result = [street, tail].filter(Boolean).join(', ').trim();
      return result || null;
    }

    return null;
  }

  function normalizeFeeLabel(value) {
    if (!value) return 'unknown';

    return String(value)
      .toLowerCase()
      .replace(/\b(?:required|monthly|fee|fees|per month)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'unknown';
  }

  // ─── 3.3 GraphQL request detection ───────────────────────────────────────────
  var GRAPHQL_PATTERNS = [
    /\/graphql\/?(\?.*)?$/,
    /\/zg-graph\//
  ];

  function isGraphQLRequest(url) {
    try {
      var parsed = new URL(url, location.href);
      if (parsed.hostname !== location.hostname) return false;
      return GRAPHQL_PATTERNS.some(function(p) { return p.test(parsed.pathname); });
    } catch {
      return false;
    }
  }

  // ─── 3.4 Fetch interception ──────────────────────────────────────────────────
  (function installFetchInterceptor() {
    if (window.__HS_GRAPHQL_CAPTURE__._installed) return;
    window.__HS_GRAPHQL_CAPTURE__._installed = true;

    var originalFetch = window.fetch;
    var capture = window.__HS_GRAPHQL_CAPTURE__;

    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input.url || '');
      if (isGraphQLRequest(url)) {
        var promise = originalFetch.apply(this, arguments);
        promise.then(function(response) {
          if (!response || !response.clone) return;
          var clone = response.clone();
          clone.json().then(function(data) {
            processGraphQLResponse(data);
          }).catch(function() {});
        }).catch(function() {});
        return promise;
      }
      return originalFetch.apply(this, arguments);
    };
  })();

  // ─── 3.5 XHR interception (compatibility fallback) ──────────────────────────
  (function installXHRInterceptor() {
    if (window.__HS_GRAPHQL_CAPTURE__._installedXHR) return;
    window.__HS_GRAPHQL_CAPTURE__._installedXHR = true;

    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._hsUrl = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(data) {
      var url = this._hsUrl;
      if (isGraphQLRequest(url)) {
        this.addEventListener('load', function() {
          try {
            var respData = JSON.parse(this.responseText);
            processGraphQLResponse(respData);
          } catch {}
        });
      }
      return originalSend.apply(this, arguments);
    };
  })();

  // ─── 3.6 publishSnapshot ──────────────────────────────────────────────────────
  function publishSnapshot(snap) {
    try {
      window.postMessage({
        namespace: 'HomeScope',
        type: 'STRUCTURED_SNAPSHOT',
        payload: snap,
        capturedPageUrl: location.href
      }, location.origin);
    } catch {}
  }

  // ─── 3.7 processGraphQLResponse ──────────────────────────────────────────────
  function processGraphQLResponse(data) {
    var capture = window.__HS_GRAPHQL_CAPTURE__;
    var currentZpid = extractCurrentZpid();
    var currentPathname = location.pathname;

    // Support batch arrays — each item may be { data: {...} }, unwrap first
    var results = [];
    if (data && data.data) {
      if (Array.isArray(data.data)) {
        results = data.data.map(function(item) {
          return (item && item.data) ? item.data : item;
        });
      } else {
        results = [data.data];
      }
    } else if (Array.isArray(data)) {
      results = data.map(function(item) {
        return (item && item.data) ? item.data : item;
      });
    }

    results.forEach(function(container) {
      // Property
      if (container && container.property) {
        var p = container.property;
        if (!currentZpid) return;
        if (String(p.zpid) !== currentZpid) return;
        if (p.hdpUrl && normalizePath(p.hdpUrl) !== currentPathname) return;

        var snap = normalizeProperty(p);
        capture._snapshot = snap;
        capture._currentZpid = currentZpid;
        capture._currentPathname = currentPathname;
        publishSnapshot(snap);
        return;
      }

      // Building
      if (container && container.building) {
        var b = container.building;
        if (!b.bdpUrl) return;
        if (normalizePath(b.bdpUrl) !== currentPathname) return;

        var snap = normalizeBuilding(b);

        // After identity verification passes, enrich from current page
        enrichBuildingFromPage(snap, currentPathname);

        capture._snapshot = snap;
        capture._currentZpid = null;
        capture._currentPathname = currentPathname;
        publishSnapshot(snap);
        return;
      }
    });
  }

  // ─── 3.8 SPA route listening ─────────────────────────────────────────────────
  function clearAndNotify() {
    var capture = window.__HS_GRAPHQL_CAPTURE__;
    capture._snapshot = null;
    capture._currentZpid = extractCurrentZpid();
    capture._currentPathname = location.pathname;

    try {
      window.postMessage({
        namespace: 'HomeScope',
        type: 'ROUTE_CHANGED',
        capturedPageUrl: location.href
      }, location.origin);
    } catch {}
  }

  window.addEventListener('popstate', clearAndNotify);

  (function installHistoryInterceptors() {
    var originalPushState = history.pushState;
    history.pushState = function() {
      var result = originalPushState.apply(history, arguments);
      clearAndNotify();
      return result;
    };

    var originalReplaceState = history.replaceState;
    history.replaceState = function() {
      var result = originalReplaceState.apply(history, arguments);
      clearAndNotify();
      return result;
    };
  })();

  // ─── 3.9 gdpClientCache fallback ────────────────────────────────────────────
  function tryGdpClientCacheFallback() {
    var currentZpid = extractCurrentZpid();
    if (!currentZpid) return null;

    try {
      var nextDataEl = document.getElementById('__NEXT_DATA__');
      if (!nextDataEl || !nextDataEl.textContent) return null;

      var nextData = JSON.parse(nextDataEl.textContent);

      var rawCache =
        nextData &&
        nextData.props &&
        nextData.props.pageProps &&
        nextData.props.pageProps.componentProps &&
        nextData.props.pageProps.componentProps.gdpClientCache;

      if (!rawCache) return null;

      var parsedCache = null;

      if (typeof rawCache === 'string') {
        try {
          parsedCache = JSON.parse(rawCache);
        } catch {
          return null;
        }
      } else if (rawCache && typeof rawCache === 'object') {
        parsedCache = rawCache;
      }

      if (!parsedCache || typeof parsedCache !== 'object') {
        return null;
      }

      var keys = Object.keys(parsedCache);

      for (var i = 0; i < keys.length; i++) {
        var entry = parsedCache[keys[i]];

        if (typeof entry === 'string') {
          try {
            entry = JSON.parse(entry);
          } catch {
            continue;
          }
        }

        if (!entry || typeof entry !== 'object') continue;

        var property =
          entry.property ||
          (entry.data && entry.data.property) ||
          (entry.query && entry.query.property) ||
          (entry.data &&
            entry.data.query &&
            entry.data.query.property) ||
          null;

        if (!property || typeof property !== 'object') continue;
        if (String(property.zpid) !== currentZpid) continue;

        return normalizeProperty(property);
      }
    } catch {}

    return null;
  }

  // ─── 3.10 Respond to REQUEST_STRUCTURED_SNAPSHOT ────────────────────────────
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    var data = event.data || {};
    if (data.namespace !== 'HomeScope') return;

    if (data.type === 'REQUEST_STRUCTURED_SNAPSHOT') {
      var capture = window.__HS_GRAPHQL_CAPTURE__;
      var currentZpid = extractCurrentZpid();
      var currentPathname = location.pathname;
      var snap = capture._snapshot;

      if (snap) {
        if (
          snap.identity &&
          snap.identity.zpid &&
          snap.identity.zpid !== currentZpid
        ) {
          snap = null;
        }

        if (
          snap.identity &&
          snap.identity.bdpUrl &&
          normalizePath(snap.identity.bdpUrl) !== currentPathname
        ) {
          snap = null;
        }
      }

      if (!snap) {
        snap = tryGdpClientCacheFallback();

        if (snap) {
          capture._snapshot = snap;
          capture._currentZpid = currentZpid;
          capture._currentPathname = currentPathname;
        }
      }

      event.source.postMessage({
        namespace: 'HomeScope',
        type: 'STRUCTURED_SNAPSHOT',
        requestId: data.requestId || null,
        payload: snap,
        capturedPageUrl: location.href
      }, event.origin);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // NORMALIZERS
  // ══════════════════════════════════════════════════════════════════════════════

  // ─── 3.11 normalizeBaseProperty ───────────────────────────────────────────────
  function normalizeBaseProperty(p) {
    return {
      source: 'zillow_structured',
      sourceVersion: 'zillow_structured_v1',
      capturedAt: new Date().toISOString(),
      capturedPageUrl: location.href,
      identity: {
        zpid: p.zpid ? String(p.zpid) : null,
        bdpUrl: null,
        hdpUrl: p.hdpUrl || null,
        address: normalizeAddressValue(p.address || p.streetAddress || null),
        name: null
      },
      classification: {
        objectKind: 'property',
        transactionType: 'unknown',
        priceUnit: 'unknown',
        propertyType: null
      },
      pricing: {
        displayedPrice: null,
        baseRent: null,
        priceText: null
      },
      layout: {
        bedrooms: p.bedrooms != null ? Number(p.bedrooms) : null,
        bathrooms: p.bathrooms != null ? Number(p.bathrooms) : null,
        sqft: p.livingArea != null ? Number(p.livingArea)
          : (p.livingAreaValue != null ? Number(p.livingAreaValue) : null),
        bedroomRange: null,
        availableUnitCount: null
      }
    };
  }

  // ─── 3.12 deriveObjectKind + helpers + normalizeProperty ──────────────────
  function deriveObjectKind(p) {
    // Priority 1: listing_sub_type.is_roomForRent
    if (p.listing_sub_type && p.listing_sub_type.is_roomForRent === true) return 'room';

    // Priority 2: atAGlanceFacts — factLabel === "Type" && factValue contains "Room for rent"
    if (p.resoFacts && p.resoFacts.atAGlanceFacts) {
      var facts = p.resoFacts.atAGlanceFacts;
      for (var i = 0; i < facts.length; i++) {
        var item = facts[i];
        if (item
          && typeof item.factLabel === 'string'
          && item.factLabel === 'Type'
          && typeof item.factValue === 'string'
          && /room for rent/i.test(item.factValue)) {
          return 'room';
        }
      }
    }

    // Priority 3: address contains unit indicator
    // address may be an object { streetAddress, city, state, zipcode }
    var addrRaw = p.address;
    var addrStr = '';
    if (typeof addrRaw === 'string') {
      addrStr = addrRaw;
    } else if (addrRaw && typeof addrRaw === 'object') {
      addrStr = [
        addrRaw.streetAddress,
        addrRaw.city,
        addrRaw.state,
        addrRaw.zipcode
      ].filter(Boolean).join(', ');
    }
    if (/unit|apt|#|floor\s*\d/i.test(addrStr)) return 'unit';

    // Priority 4: homeType
    var ht = p.homeType || (p.resoFacts && p.resoFacts.homeType);
    if (ht && /apartment|condo/i.test(ht)) return 'unit';

    return 'property';
  }

  function deriveTransactionType(p) {
    var hs = p.homeStatus;
    if (hs === 'FOR_RENT') return 'rent';
    if (hs === 'FOR_SALE') return 'sale';
    var ltd = p.listingTypeDimension;
    if (ltd === 'For Rent') return 'rent';
    if (ltd === 'For Sale') return 'sale';
    var hdp = p.hdpTypeDimension;
    if (hdp === 'ForRent') return 'rent';
    var khs = p.keystoneHomeStatus;
    if (khs === 'ForRent') return 'rent';
    var frag = p.pageUrlFragment;
    if (frag === 'ForRent') return 'rent';
    return 'unknown';
  }

  function derivePriceUnit(p) {
    var tt = deriveTransactionType(p);
    if (tt === 'rent') return 'monthly';
    if (tt === 'sale') return 'total';
    return 'unknown';
  }

  function normalizeProperty(p) {
    var objKind = deriveObjectKind(p);
    var txType = deriveTransactionType(p);

    if (objKind === 'room') return normalizeRoomProperty(p);
    if (objKind === 'building') return normalizeBuilding(p);
    if (txType === 'sale') return normalizeSaleProperty(p);
    return normalizeRentalProperty(p);
  }

  // ─── 3.13 normalizeRentalProperty ───────────────────────────────────────────
  // For non-room FOR_RENT listings (whole units)
  function normalizeRentalProperty(p) {
    var result = normalizeBaseProperty(p);
    result.classification.objectKind = 'property';
    result.classification.transactionType = 'rent';
    result.classification.priceUnit = 'monthly';

    var displayedPrice = typeof p.price === 'number' ? p.price : null;
    result.pricing.displayedPrice = displayedPrice;
    result.pricing.baseRent = displayedPrice;

    // Layout: root object priority, then resoFacts
    if (result.layout.bedrooms == null && p.resoFacts && p.resoFacts.bedrooms != null) {
      result.layout.bedrooms = Number(p.resoFacts.bedrooms);
    }
    if (result.layout.bathrooms == null && p.resoFacts && p.resoFacts.bathrooms != null) {
      result.layout.bathrooms = Number(p.resoFacts.bathrooms);
    }

    // propertyType
    result.classification.propertyType = p.homeType
      || (p.resoFacts && p.resoFacts.homeType)
      || (p.resoFacts && p.resoFacts.propertySubType)
      || (p.resoFacts && p.resoFacts.structureType)
      || null;

    // resoFacts generic fields
    if (p.resoFacts) {
      var rf = p.resoFacts;
      result.rentalDetails = {
        yearBuilt: typeof rf.yearBuilt === 'number' ? rf.yearBuilt : null,
        parking: rf.parkingFeatures || null,
        heating: rf.heating || null,
        cooling: rf.cooling || null,
        laundry: rf.laundry || null,
        basement: rf.basement || null,
        furnished: typeof rf.furnished === 'boolean' ? rf.furnished : null,
        leaseTerm: rf.leaseTerm ? String(rf.leaseTerm) : null,
        availableDate: rf.availableDate || null,
        atAGlanceFacts: {},
        listPriceIncludesRequiredMonthlyFees: null,
        requiredMonthlyFees: null,
        totalMonthlyCost: null,
        promotionText: null
      };

      if (rf.atAGlanceFacts && Array.isArray(rf.atAGlanceFacts)) {
        var facts = {};
        var allowedLabels = ['Date available', 'Type', 'Lease', 'Pets', 'Parking', 'Deposit & fees'];
        for (var ai = 0; ai < rf.atAGlanceFacts.length; ai++) {
          var item = rf.atAGlanceFacts[ai];
          if (item && item.factLabel && allowedLabels.indexOf(item.factLabel) >= 0) {
            facts[item.factLabel] = item.factValue || null;
          }
        }
        result.rentalDetails.atAGlanceFacts = facts;
      }
    }

    return result;
  }

  // ─── 3.14 normalizeRoomProperty ────────────────────────────────────────────
  function normalizeRoomProperty(p) {
    var result = normalizeBaseProperty(p);
    result.classification.objectKind = 'room';
    result.classification.transactionType = 'rent';
    result.classification.priceUnit = 'monthly';

    result.roomRental = {
      hasPrivateBath: null,
      roomIsFurnished: null,
      housemateCount: null,
      leaseTerm: null,
      furnished: null,
      hasPetsAllowed: null,
      allowedPets: null,
      parkingCapacity: null,
      parkingFeatures: null,
      hasAttachedGarage: null,
      atAGlanceFacts: {},
      listPriceIncludesRequiredMonthlyFees: null,
      requiredMonthlyFees: null,
      totalMonthlyCost: null,
      promotionText: null
    };

    // roomForRent fields
    if (p.roomForRent) {
      var rr = p.roomForRent;
      if (rr.roomDetails) {
        var rd = rr.roomDetails;
        result.roomRental.hasPrivateBath = typeof rd.hasPrivateBath === 'boolean' ? rd.hasPrivateBath : null;
        result.roomRental.roomIsFurnished = typeof rd.roomIsFurnished === 'boolean' ? rd.roomIsFurnished : null;
      }
      if (rr.roommateDetails) {
        var count = rr.roommateDetails.totalCount;
        result.roomRental.housemateCount = (typeof count === 'number')
          ? count
          : (typeof count === 'string' ? parseInt(count, 10) || null : null);
      }
      if (rr.leaseDetails && rr.leaseDetails.leaseTerm) {
        result.roomRental.leaseTerm = String(rr.leaseDetails.leaseTerm);
      }
    }

    // resoFacts fields
    if (p.resoFacts) {
      var rf = p.resoFacts;
      result.roomRental.furnished = typeof rf.furnished === 'boolean' ? rf.furnished : null;
      if (rf.leaseTerm) result.roomRental.leaseTerm = String(rf.leaseTerm);
      result.roomRental.hasPetsAllowed = typeof rf.hasPetsAllowed === 'boolean' ? rf.hasPetsAllowed : null;
      if (rf.allowedPets) result.roomRental.allowedPets = rf.allowedPets;
      if (typeof rf.parkingCapacity === 'number') result.roomRental.parkingCapacity = rf.parkingCapacity;
      if (rf.parkingFeatures) result.roomRental.parkingFeatures = rf.parkingFeatures;
      result.roomRental.hasAttachedGarage = typeof rf.hasAttachedGarage === 'boolean' ? rf.hasAttachedGarage : null;

      if (rf.atAGlanceFacts && Array.isArray(rf.atAGlanceFacts)) {
        var facts = {};
        var allowedLabels = ['Date available', 'Type', 'Lease', 'Pets', 'Parking', 'Deposit & fees'];
        for (var ri = 0; ri < rf.atAGlanceFacts.length; ri++) {
          var item = rf.atAGlanceFacts[ri];
          if (item && item.factLabel && allowedLabels.indexOf(item.factLabel) >= 0) {
            facts[item.factLabel] = item.factValue || null;
          }
        }
        result.roomRental.atAGlanceFacts = facts;
      }
    }

    if (typeof p.listPriceIncludesRequiredMonthlyFees === 'boolean') {
      result.roomRental.listPriceIncludesRequiredMonthlyFees = p.listPriceIncludesRequiredMonthlyFees;
    }

    // Pricing
    var displayedPrice = typeof p.price === 'number' ? p.price : null;
    var baseRent = typeof p.baseRent === 'number' ? p.baseRent : displayedPrice;
    result.pricing.displayedPrice = displayedPrice;
    result.pricing.baseRent = baseRent;

    // requiredMonthlyFees — strict parsing rules:
    // 1. Only within required marker + 500-char block
    // 2. Only amounts with explicit /month or monthly
    // 3. Dedupe by label (not amount)
    // 4. Base rent and promo prices excluded
    // 5. No raw rentalCostsAndFees transmitted
    if (p.description && typeof p.description === 'string') {
      var desc = p.description;
      var requiredFees = 0;
      var feeEntries = []; // { amount, label, normalizedLabel }
      var seenFeeEntries = new Set();

      var markerRegex = /(?:additional required fees|rental price does not include|rental price does not include\s+the\s+following)/gi;
      var markerMatch;
      while ((markerMatch = markerRegex.exec(desc)) !== null) {
        var markerEnd = markerMatch.index + markerMatch[0].length;
        var block = desc.substring(markerEnd, markerEnd + 500);

        var feeWithAmountRegex = /\$([\d,]+)\s*(?:\/month|monthly|per\s*month|per\s*Month)/gi;
        var feeMatch;
        while ((feeMatch = feeWithAmountRegex.exec(block)) !== null) {
          var amt = parseInt(feeMatch[1].replace(/,/g, ''), 10);
          if (isNaN(amt) || amt <= 0 || amt >= 10000) continue;
          // Filter out suspiciously large amounts (>= 80% of base rent)
          if (baseRent && amt > baseRent * 0.8) continue;

          // Forward-slice fee name: start at amount end (in original description),
          // cut at next '$', newline, period, semicolon, comma, ' and $', or end.
          // Limit window to 60 chars.
          var absoluteAmountIndex = markerEnd + feeMatch.index;
          var amountMatchLength = feeMatch[0].length;
          var feeNameStart = absoluteAmountIndex + amountMatchLength;
          var feeNameEnd = Math.min(feeNameStart + 60, desc.length);
          var forwardRaw = desc.substring(feeNameStart, feeNameEnd);

          var stopMatch = forwardRaw.match(/\$|\n|\.|;|,| and \$/);
          var feeNameText = stopMatch
            ? forwardRaw.substring(0, stopMatch.index)
            : forwardRaw;
          feeNameText = feeNameText.trim();

          var label = feeNameText || 'Fee';
          var normalizedLabel = normalizeFeeLabel(feeNameText || feeMatch[1]);

          // Dedupe by amount + normalized fee name (not by absolute position —
          // Zillow may repeat identical fee paragraphs).
          var entryKey = String(amt) + ':' + normalizedLabel;
          if (!seenFeeEntries.has(entryKey)) {
            seenFeeEntries.add(entryKey);
            feeEntries.push({ amount: amt, label: label, normalizedLabel: normalizedLabel });
            requiredFees += amt;
          }
        }
      }

      result.roomRental.requiredMonthlyFees = requiredFees > 0 ? requiredFees : null;
      result.roomRental.totalMonthlyCost = (baseRent && requiredFees > 0) ? (baseRent + requiredFees) : null;

      var promoMatch = desc.match(/(?:(\d+)\s*months?\s*free|up to\s*\d+\s*weeks?\s*free|effective\s*rent|first\s*(?:two|2)\s*months?\s*\$0)/i);
      if (promoMatch) {
        result.roomRental.promotionText = promoMatch[0].substring(0, 200);
      }
    }

    return result;
  }

  // ─── 3.15 normalizeBuilding ─────────────────────────────────────────────────
  function normalizeBuilding(b) {
    var result = {
      source: 'zillow_structured',
      sourceVersion: 'zillow_structured_v1',
      capturedAt: new Date().toISOString(),
      capturedPageUrl: location.href,
      identity: {
        zpid: null,
        bdpUrl: b.bdpUrl || null,
        hdpUrl: null,
        address: null,
        name: null
      },
      classification: {
        objectKind: 'building',
        transactionType: 'rent',
        priceUnit: 'monthly',
        propertyType: null
      },
      pricing: {
        displayedPrice: null,
        baseRent: null,
        baseRentMin: null,
        baseRentMax: null,
        knownMonthlyTotalMin: null,
        knownMonthlyTotalMax: null,
        listPriceMin: null,
        listPriceMax: null,
        applicationCostMin: null,
        applicationCostMax: null,
        moveInCostMin: null,
        moveInCostMax: null,
        priceText: null,
        promotionText: null,
        hasVariableMonthlyCosts: false,
        variableCostLabels: []
      },
      layout: {
        bedrooms: null,
        bathrooms: null,
        sqft: null,
        bedroomRange: null,
        availableUnitCount: null,
        availableUnitCountSource: null,
        minBeds: null,
        maxBeds: null
      },
      buildingDetails: {
        currency: b.currency || 'USD',
        isWaitlisted: typeof b.isWaitlisted === 'boolean' ? b.isWaitlisted : null,
        inventoryRecordCount: 0,
        floorPlanRecordCount: 0,
        sampleUnits: [],
        bedroomGroups: [],
        requiredMonthlyKnownFees: null,
        fees: {
          monthly: { required: [], optional: [] },
          application: { required: [], optional: [] },
          moveIn: { required: [], optional: [] },
          additional: []
        }
      }
    };

    // Identity — building root name/address
    if (b.name || b.buildingName) {
      result.identity.name = b.name || b.buildingName;
    }
    result.identity.address = normalizeAddressValue(b.address || b.streetAddress || null);

    // availableUnitCount — building root only (not from floorPlans)
    if (typeof b.availableUnitCount === 'number') {
      result.layout.availableUnitCount = b.availableUnitCount;
      result.layout.availableUnitCountSource = 'building';
    }

    // costsV2
    if (b.rentalCostsAndFees && b.rentalCostsAndFees.costsV2) {
      var cv2 = b.rentalCostsAndFees.costsV2;
      if (cv2.baseRent && cv2.baseRent.amount) {
        if (cv2.baseRent.amount.min != null) result.pricing.baseRentMin = Number(cv2.baseRent.amount.min);
        if (cv2.baseRent.amount.max != null) result.pricing.baseRentMax = Number(cv2.baseRent.amount.max);
      }
      if (cv2.monthly && cv2.monthly.amount) {
        if (cv2.monthly.amount.min != null) result.pricing.knownMonthlyTotalMin = Number(cv2.monthly.amount.min);
        if (cv2.monthly.amount.max != null) result.pricing.knownMonthlyTotalMax = Number(cv2.monthly.amount.max);
      }
      if (cv2.listPrice && cv2.listPrice.amount) {
        if (cv2.listPrice.amount.min != null) result.pricing.listPriceMin = Number(cv2.listPrice.amount.min);
        if (cv2.listPrice.amount.max != null) result.pricing.listPriceMax = Number(cv2.listPrice.amount.max);
      }
      if (cv2.application && cv2.application.amount) {
        if (cv2.application.amount.min != null) result.pricing.applicationCostMin = Number(cv2.application.amount.min);
        if (cv2.application.amount.max != null) result.pricing.applicationCostMax = Number(cv2.application.amount.max);
      }
      if (cv2.moveIn && cv2.moveIn.amount) {
        if (cv2.moveIn.amount.min != null) result.pricing.moveInCostMin = Number(cv2.moveIn.amount.min);
        if (cv2.moveIn.amount.max != null) result.pricing.moveInCostMax = Number(cv2.moveIn.amount.max);
      }
    }

    // Legacy costs fallback
    if (b.rentalCostsAndFees && b.rentalCostsAndFees.costs) {
      var c = b.rentalCostsAndFees.costs;
      if (result.pricing.baseRentMin == null && c.baseRent) result.pricing.baseRentMin = Number(c.baseRent) || null;
      if (result.pricing.knownMonthlyTotalMin == null && c.monthly) result.pricing.knownMonthlyTotalMin = Number(c.monthly) || null;
    }

    // feesV2 — strict feeGroup structure:
    // feesV2.<category>.feeGroup[] → group.type REQUIRED/OPTIONAL → group.fees[] → fee.amount.min/max/displayText
    if (b.rentalCostsAndFees && b.rentalCostsAndFees.feesV2) {
      var fv2 = b.rentalCostsAndFees.feesV2;
      var requiredMonthlySum = 0;
      var hasVariable = false;

      function processCategory(categoryName, categoryData) {
        if (!categoryData || typeof categoryData !== 'object') return;
        var groups = categoryData.feeGroup;
        if (!Array.isArray(groups)) return;

        for (var gi = 0; gi < groups.length; gi++) {
          var group = groups[gi];
          if (!group || !Array.isArray(group.fees)) continue;

          var isGroupRequired = (group.type === 'REQUIRED' || group.required !== false);

          for (var fi = 0; fi < group.fees.length; fi++) {
            var fee = group.fees[fi];
            if (!fee || !fee.type) continue;

            var isFeeRequired = isGroupRequired || (fee.type === 'REQUIRED') || (fee.required !== false);

            var minVal = null, maxVal = null;
            if (fee.amount && typeof fee.amount === 'object') {
              minVal = typeof fee.amount.min === 'number' ? fee.amount.min
                : (typeof fee.amount.max === 'number' ? fee.amount.max : null);
              maxVal = typeof fee.amount.max === 'number' ? fee.amount.max : null;
            } else {
              minVal = typeof fee.min === 'number' ? fee.min : (typeof fee.max === 'number' ? fee.max : null);
              maxVal = typeof fee.max === 'number' ? fee.max : null;
            }

            var feeEntry = {
              type: fee.type,
              displayName: fee.displayName || fee.type,
              min: minVal,
              max: maxVal,
              displayText: fee.displayText || null,
              required: isFeeRequired,
              period: fee.period || categoryName || null
            };

            if (categoryName === 'monthly') {
              if (isFeeRequired) {
                result.buildingDetails.fees.monthly.required.push(feeEntry);
                if (feeEntry.min != null && fee.type.toUpperCase() !== 'BASE_RENT') {
                  requiredMonthlySum += feeEntry.min;
                }
              } else {
                result.buildingDetails.fees.monthly.optional.push(feeEntry);
              }
            } else if (categoryName === 'application') {
              if (isFeeRequired) result.buildingDetails.fees.application.required.push(feeEntry);
              else result.buildingDetails.fees.application.optional.push(feeEntry);
            } else if (categoryName === 'moveIn') {
              if (isFeeRequired) result.buildingDetails.fees.moveIn.required.push(feeEntry);
              else result.buildingDetails.fees.moveIn.optional.push(feeEntry);
            } else {
              result.buildingDetails.fees.additional.push(feeEntry);
            }

            if (fee.displayText && /varies|vary|unknown/i.test(fee.displayText)) {
              hasVariable = true;
              result.pricing.variableCostLabels.push(fee.type);
            }
          }
        }
      }

      processCategory('monthly', fv2.monthly);
      processCategory('application', fv2.application);
      processCategory('moveIn', fv2.moveIn);
      processCategory('additional', fv2.additional);

      result.pricing.hasVariableMonthlyCosts = hasVariable;
      result.buildingDetails.requiredMonthlyKnownFees = requiredMonthlySum > 0 ? requiredMonthlySum : null;
    }

    // specialOffers — prefer building.specialOffers, then rentalCostsAndFees.specialOffers
    var promotionFound = false;
    if (b.specialOffers && Array.isArray(b.specialOffers) && b.specialOffers.length > 0) {
      result.pricing.promotionText = String(b.specialOffers[0].description || b.specialOffers[0].text || b.specialOffers[0]).substring(0, 200);
      promotionFound = true;
    }
    if (!promotionFound && b.rentalCostsAndFees && b.rentalCostsAndFees.specialOffers) {
      var offers = b.rentalCostsAndFees.specialOffers;
      if (Array.isArray(offers) && offers.length > 0) {
        result.pricing.promotionText = String(offers[0].description || offers[0].text || offers[0]).substring(0, 200);
      }
    }

    // selectors.beds → bedroomGroups
    if (b.rentalCostsAndFees && b.rentalCostsAndFees.selectors && b.rentalCostsAndFees.selectors.beds) {
      var beds = b.rentalCostsAndFees.selectors.beds;
      var groups = [];
      var minBed = null, maxBed = null;

      for (var bi = 0; bi < Math.min(beds.length, 10); bi++) {
        var sel = beds[bi];
        if (!sel || sel.numBeds == null) continue;
        var bedsVal = Number(sel.numBeds);
        if (minBed === null || bedsVal < minBed) minBed = bedsVal;
        if (maxBed === null || bedsVal > maxBed) maxBed = bedsVal;

        var grp = {
          beds: bedsVal,
          label: (sel.selector && sel.selector.displayName)
            ? sel.selector.displayName
            : (bedsVal === 0 ? 'Studio' : bedsVal + ' bed'),
          baseRentMin: null,
          baseRentMax: null,
          knownMonthlyTotalMin: null,
          knownMonthlyTotalMax: null
        };

        if (sel.selector && sel.selector.costsV2) {
          var selCv2 = sel.selector.costsV2;
          if (selCv2.baseRent && selCv2.baseRent.amount) {
            if (selCv2.baseRent.amount.min != null) grp.baseRentMin = Number(selCv2.baseRent.amount.min);
            if (selCv2.baseRent.amount.max != null) grp.baseRentMax = Number(selCv2.baseRent.amount.max);
          }
          if (selCv2.monthly && selCv2.monthly.amount) {
            if (selCv2.monthly.amount.min != null) grp.knownMonthlyTotalMin = Number(selCv2.monthly.amount.min);
            if (selCv2.monthly.amount.max != null) grp.knownMonthlyTotalMax = Number(selCv2.monthly.amount.max);
          }
        }

        groups.push(grp);
      }

      result.buildingDetails.bedroomGroups = groups;
      result.layout.minBeds = minBed;
      result.layout.maxBeds = maxBed;

      if (minBed !== null && maxBed !== null) {
        if (minBed === 0 && maxBed === 0) result.layout.bedroomRange = 'Studio';
        else if (minBed === maxBed) result.layout.bedroomRange = String(minBed) + ' bed';
        else result.layout.bedroomRange = (minBed === 0 ? 'Studio' : minBed + ' bed') + ' – ' + maxBed + ' bed';
      }

      // Lowest base rent
      var lowestBase = null;
      for (var gli = 0; gli < groups.length; gli++) {
        if (groups[gli].baseRentMin != null) {
          if (lowestBase === null || groups[gli].baseRentMin < lowestBase) lowestBase = groups[gli].baseRentMin;
        }
      }
      if (lowestBase !== null) result.pricing.baseRentMin = lowestBase;
    }

    // sampleUnits — selectors.units[].unitZpid matched to floorPlans[].units[].zpid
    if (b.rentalCostsAndFees && b.rentalCostsAndFees.selectors && b.rentalCostsAndFees.selectors.units) {
      var allUnits = b.rentalCostsAndFees.selectors.units;
      result.buildingDetails.inventoryRecordCount = allUnits.length;

      // Build fpZpidMap: fpUnit.zpid → fpUnit (from floorPlans[].units[])
      var fpZpidMap = {};
      if (b.floorPlans && Array.isArray(b.floorPlans)) {
        result.buildingDetails.floorPlanRecordCount = b.floorPlans.length;
        for (var fpIdx = 0; fpIdx < b.floorPlans.length; fpIdx++) {
          var fpItem = b.floorPlans[fpIdx];
          if (fpItem.units) {
            for (var uIdx = 0; uIdx < fpItem.units.length; uIdx++) {
              var fpUnit = fpItem.units[uIdx];
              if (fpUnit && fpUnit.zpid) {
                fpZpidMap[String(fpUnit.zpid)] = fpUnit;
              }
            }
          }
        }
      }

      var sampleCount = Math.min(allUnits.length, 12);
      for (var si = 0; si < sampleCount; si++) {
        var unit = allUnits[si];
        if (!unit) continue;

        var unitZpid = unit.unitZpid ? String(unit.unitZpid)
          : (unit.zpid ? String(unit.zpid) : null);

        var sampleUnit = {
          unitZpid: unitZpid,
          unitLabel: (unit.selector && unit.selector.displayName) ? unit.selector.displayName : null,
          beds: unit.numBeds != null ? Number(unit.numBeds) : null,
          baths: null,
          baseRent: null,
          knownMonthlyTotal: null,
          availableFrom: null
        };

        // baths and availableFrom from matched floorPlan.units entry
        if (unitZpid && fpZpidMap[unitZpid]) {
          var matchedFpUnit = fpZpidMap[unitZpid];
          if (matchedFpUnit.numBaths != null) sampleUnit.baths = Number(matchedFpUnit.numBaths);
          if (matchedFpUnit.availableFrom) sampleUnit.availableFrom = String(matchedFpUnit.availableFrom);
        }

        // selector.costsV2
        if (unit.selector && unit.selector.costsV2) {
          var uCv2 = unit.selector.costsV2;
          if (uCv2.baseRent && uCv2.baseRent.amount) {
            if (uCv2.baseRent.amount.min != null) sampleUnit.baseRent = Number(uCv2.baseRent.amount.min);
            else if (uCv2.baseRent.amount.max != null) sampleUnit.baseRent = Number(uCv2.baseRent.amount.max);
          }
          if (uCv2.monthly && uCv2.monthly.amount) {
            if (uCv2.monthly.amount.min != null) sampleUnit.knownMonthlyTotal = Number(uCv2.monthly.amount.min);
            else if (uCv2.monthly.amount.max != null) sampleUnit.knownMonthlyTotal = Number(uCv2.monthly.amount.max);
          }
        }

        result.buildingDetails.sampleUnits.push(sampleUnit);
      }
    }

    return result;
  }

  // ─── 3.16 enrichBuildingFromPage ────────────────────────────────────────────
  function enrichBuildingFromPage(result, currentPathname) {
    // og:title parsing: "Name - Address (N units available) | Zillow"
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) {
      var titleContent = ogTitle.content;

      // availableUnitCount from og:title
      var unitsMatch = titleContent.match(/\((\d+)\s*units?\s*available\)/i);
      if (unitsMatch && result.layout.availableUnitCount == null) {
        result.layout.availableUnitCount = parseInt(unitsMatch[1], 10);
        result.layout.availableUnitCountSource = 'og:title';
      }

      // address from og:title (only if not already set from building root)
      if (!result.identity.address) {
        var titleClean = titleContent
          .replace(/\s*\|\s*Zillow\s*$/i, '')
          .replace(/\s*\(\d+\s*units?\s*available\)\s*/gi, '')
          .trim();
        var dashIdx = titleClean.lastIndexOf(' - ');
        if (dashIdx >= 0) {
          var potentialAddr = titleClean.substring(dashIdx + 3).trim();
          if (potentialAddr.length > 0 && potentialAddr.length < 200) {
            result.identity.address = potentialAddr;
          }
        }
      }

      // name from og:title (only if not set from building root)
      if (!result.identity.name) {
        var titleClean = titleContent
          .replace(/\s*\|\s*Zillow\s*$/i, '')
          .replace(/\s*\(\d+\s*units?\s*available\)\s*/gi, '')
          .trim();
        var dashIdx = titleClean.lastIndexOf(' - ');
        var potentialName = (dashIdx >= 0) ? titleClean.substring(0, dashIdx) : titleClean;
        if (potentialName.length > 0 && potentialName.length < 200) {
          result.identity.name = potentialName;
        }
      }
    }

    // h1 is building name — NOT address
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent && !result.identity.name) {
      var h1Text = h1.textContent.trim();
      if (h1Text.length > 0 && h1Text.length < 200) {
        result.identity.name = h1Text;
      }
    }
  }

  // ─── 3.17 normalizeSaleProperty ────────────────────────────────────────────
  function normalizeSaleProperty(p) {
    var result = normalizeBaseProperty(p);
    result.classification.objectKind = 'property';
    result.classification.transactionType = 'sale';
    result.classification.priceUnit = 'total';
    result.pricing.baseRent = null;

    result.saleDetails = {
      price: typeof p.price === 'number' ? p.price : null,
      currency: p.currency || 'USD',
      yearBuilt: null,
      livingArea: null,
      propertyFacts: {},
      ownershipCosts: {},
      priceHistory: [],
      taxHistory: []
    };

    if (p.resoFacts) {
      var rf = p.resoFacts;
      result.saleDetails.yearBuilt = typeof rf.yearBuilt === 'number' ? rf.yearBuilt : null;

      result.saleDetails.propertyFacts = {
        heating: rf.heating || null,
        cooling: rf.cooling || null,
        parking: rf.parkingFeatures || null,
        garageParkingCapacity: typeof rf.garageParkingCapacity === 'number' ? rf.garageParkingCapacity : null,
        hasGarage: typeof rf.hasGarage === 'boolean' ? rf.hasGarage : null,
        basement: rf.basement || rf.basementYN || null,
        roofType: rf.roofType || null,
        lotSize: rf.lotSize || null,
        architecturalStyle: rf.architecturalStyle || null,
        propertySubType: rf.propertySubType || rf.propertySubtype || null,
        structureType: rf.structureType || null
      };

      result.saleDetails.ownershipCosts = {
        zestimate: typeof p.zestimate === 'number' ? p.zestimate : null,
        rentZestimate: typeof p.rentZestimate === 'number' ? p.rentZestimate : null,
        taxAnnualAmount: typeof rf.taxAnnualAmount === 'number' ? rf.taxAnnualAmount : null,
        taxAssessedValue: typeof rf.taxAssessedValue === 'number' ? rf.taxAssessedValue : null,
        hoaFee: typeof rf.hoaFee === 'number' ? rf.hoaFee : (rf.hoaFeeTotal ? Number(rf.hoaFeeTotal) : null),
        hasAssociation: rf.hasAssociation === true ? true : (rf.hasAssociation === false ? false : null),
        pricePerSquareFoot: typeof rf.pricePerSquareFoot === 'number' ? rf.pricePerSquareFoot : null
      };

      if (p.priceHistory && Array.isArray(p.priceHistory)) {
        var phCount = Math.min(p.priceHistory.length, 10);
        for (var pi = 0; pi < phCount; pi++) {
          var entry = p.priceHistory[pi];
          result.saleDetails.priceHistory.push({
            date: entry.date || entry.time ? String(entry.date || entry.time) : null,
            price: typeof entry.price === 'number' ? entry.price : (typeof entry.value === 'number' ? entry.value : null),
            priceText: entry.priceText || null,
            event: entry.event || null
          });
        }
      }

      if (p.taxHistory && Array.isArray(p.taxHistory)) {
        var thCount = Math.min(p.taxHistory.length, 5);
        for (var ti = 0; ti < thCount; ti++) {
          var tEntry = p.taxHistory[ti];
          result.saleDetails.taxHistory.push({
            year: tEntry.year || null,
            tax: typeof tEntry.tax === 'number' ? tEntry.tax : null,
            taxText: tEntry.taxText || null
          });
        }
      }
    }

    result.saleDetails.livingArea = p.livingArea != null ? Number(p.livingArea)
      : (p.livingAreaValue != null ? Number(p.livingAreaValue) : null);

    result.pricing.displayedPrice = typeof p.price === 'number' ? p.price : null;

    return result;
  }

})();
