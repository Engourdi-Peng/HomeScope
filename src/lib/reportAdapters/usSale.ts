// ===== US Sale Adapter =====
// 转换 US Sale 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem, ReportProfile } from './types';

type USSaleResult = any;

// ── safe text helpers ─────────────────────────────────────────────────────────

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['title', 'label', 'name', 'heading', 'value', 'summary', 'description', 'detail', 'text', 'reason', 'risk', 'signal', 'action', 'recommendation']) {
      const t = toText(obj[key]);
      if (t) return t;
    }
    return '';
  }
  return '';
}

// Format financial number to display string
function fmtMoney(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return '$' + val.toLocaleString();
  }
  return toText(val);
}

function fmtAnnualTax(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return '$' + val.toLocaleString() + '/yr';
  }
  return toText(val);
}

function fmtPerSqft(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return '$' + val + '/sqft';
  }
  return toText(val);
}

function makeItem(
  label: string,
  value: unknown,
  opts?: { badge?: string; severity?: 'low' | 'medium' | 'high' }
): SectionItem | null {
  const text = toText(value);
  if (!text) return null;
  return { title: label, description: text, badge: opts?.badge, severity: opts?.severity };
}

function makeItemsFromArray(
  label: string,
  arr: unknown,
  opts?: { badge?: string; severity?: 'low' | 'medium' | 'high' }
): SectionItem[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => makeItem(label, item, opts)).filter(Boolean) as SectionItem[];
}

function stringsToItems(label: string, arr: unknown[], opts?: { badge?: string; severity?: 'low' | 'medium' | 'high' }): SectionItem[] {
  return arr
    .map(item => {
      const text = toText(item);
      if (!text) return null;
      return { title: label, description: text, badge: opts?.badge, severity: opts?.severity } as SectionItem;
    })
    .filter(Boolean) as SectionItem[];
}

function objectItems(arr: unknown[], opts?: { badge?: string; severity?: 'low' | 'medium' | 'high' }): SectionItem[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(item => {
      if (typeof item === 'string') {
        const t = toText(item);
        return t ? { title: t } as SectionItem : null;
      }
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        const title = toText(obj.title ?? obj.phrase ?? obj.keyword ?? obj.label ?? '');
        const description = toText(obj.description ?? obj.what_it_may_mean ?? obj.message ?? obj.action ?? obj.reason ?? '');
        if (!title && !description) return null;
        return { title: title || description, description: description || title, badge: opts?.badge, severity: opts?.severity } as SectionItem;
      }
      return null;
    })
    .filter(Boolean) as SectionItem[];
}

// ── severity from string ──────────────────────────────────────────────────────

function severityOf(level: string | undefined): 'low' | 'medium' | 'high' | undefined {
  if (!level) return undefined;
  const l = level.toUpperCase();
  if (l === 'LOW') return 'low';
  if (l === 'MEDIUM' || l === 'MODERATE') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
}

// ── Listing summary / dirty data filters ──────────────────────────────────────

function isListingSummaryString(value: unknown): boolean {
  if (!value) return true;
  const text = String(value).trim();
  if (!text) return true;
  return (
    /\b\d+\s*bds\b/i.test(text) ||
    /\b\d+\s*beds?\b/i.test(text) ||
    /\b\d+\s*ba\b/i.test(text) ||
    /\b\d+[,.\d]*\s*sqft\b/i.test(text) ||
    /\b\d+\s*sq\s*ft\b/i.test(text) ||
    /home\s+for\s+sale\b/i.test(text) ||
    /\bactive\b/i.test(text) ||
    /\bmulti\.?family\s+home\s+for\s+sale\b/i.test(text) ||
    /\bsingle\s+family\s+home\s+for\s+sale\b/i.test(text) ||
    /\bcondo\s+for\s+sale\b/i.test(text) ||
    /\btownhouse\s+for\s+sale\b/i.test(text)
  );
}

function isLikelyValidAddress(value: unknown): boolean {
  if (!value) return false;
  const text = String(value).trim();
  if (!text) return false;

  if (isListingSummaryString(text)) return false;

  // Accept complete US address: "1231 Lydig Avenue, Bronx, NY 10461"
  if (/^\d+\s+.+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i.test(text)) {
    return true;
  }

  // Accept partial street address: "810 Neill Avenue", "1231 Lydig Avenue", "4218 Herkimer Pl"
  if (/^\d+\s+[A-Za-z0-9 .'-]+(?:street|st|avenue|ave|road|rd|place|pl|drive|dr|court|ct|lane|ln|boulevard|blvd|terrace|ter|way|circle|cir|floor)\b/i.test(text)) {
    return true;
  }

  return false;
}

function firstValidAddress(...values: unknown[]): string {
  for (const v of values) {
    const text = String(v ?? '').trim();
    if (isLikelyValidAddress(text)) return text;
  }
  return '';
}

function firstValidTitle(...values: unknown[]): string {
  for (const v of values) {
    const text = String(v ?? '').trim();
    if (text && !isListingSummaryString(text)) return text;
  }
  return '';
}

// ── report profile (property-type routing) ───────────────────────────────────

/**
 * Map the backend's NormalizedPropertyCategory to the legacy ReportProfile.
 * Priority: use normalizedPropertyCategory from backend if available.
 * Fall back to local re-detection only for legacy/forward compat.
 *
 * Backend normalized categories → legacy ReportProfile:
 * co_op          → 'coop'
 * condo          → 'condo'
 * single_family  → 'single_family_owner_occupier'
 * townhouse      → 'townhouse'
 * multi_family   → 'multi_family'
 * manufactured  → 'unknown'
 * land           → 'land'
 * apartment      → 'unknown'
 * unknown        → 'unknown'
 */
const NORMALIZED_TO_PROFILE: Record<string, ReportProfile> = {
  co_op: 'coop',
  condo: 'condo',
  single_family: 'single_family_owner_occupier',
  townhouse: 'townhouse',
  multi_family: 'multi_family',
  manufactured: 'unknown',
  land: 'land',
  apartment: 'unknown',
  unknown: 'unknown',
};

export function computeReportProfile(result: USSaleResult): ReportProfile {
  // Prefer backend's normalizedPropertyCategory if available
  const normCat = result.normalizedPropertyCategory ?? (result as any).reportProfile;
  if (normCat && NORMALIZED_TO_PROFILE[normCat]) {
    return NORMALIZED_TO_PROFILE[normCat];
  }

  // Fallback: re-detect from raw listing data (for legacy or forward compat)
  const snap = result.property_snapshot ?? {};

  // Gather listing text for signal detection
  const listingText = [
    snap.homeType ?? snap.home_type ?? '',
    (result as any).listingInfo?.description ?? '',
    (result as any).listingOverview?.description ?? '',
    (result as any).description ?? '',
    (result as any).listingInfo?.propertyType ?? '',
    (result as any).propertyType ?? '',
  ].join(' ').toLowerCase();

  const propertyType = (snap.homeType ?? snap.home_type ?? '').toLowerCase();

  // Explicit rental/multi-family signals in listing text
  // Must be explicit — basement/storage alone is NOT a rental signal
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant\s*occupied|walk.in\s*apartment|mother.daughter|backyard\s*entrance|separate\s*street\s*entrance|income.generat/i.test(listingText);

  // Explicit property type checks
  const isSingleFamily = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(propertyType);
  const isMultiFamily = /multi\s*family|multi.family|duplex/i.test(propertyType);

  // ── Property type priority (co_op MUST be first to prevent "house"/"residence"
  // in "Stock Cooperative, Residential" from matching single_family first) ─────
  if (/coop|co-op/i.test(propertyType)) return 'coop';
  if (isSingleFamily && !hasRentalSignal) {
    return 'single_family_owner_occupier';
  }
  if (isMultiFamily || hasRentalSignal) {
    return 'multi_family';
  }
  if (/condo/i.test(propertyType)) return 'condo';
  if (/townhouse|town\s*home/i.test(propertyType)) return 'townhouse';
  if (/land|lot/i.test(propertyType)) return 'land';
  return 'unknown';
}

// ── hero ─────────────────────────────────────────────────────────────────────

function buildHero(result: USSaleResult): HeroData {
  // Filter listing summary strings from title
  const rawTitle = result.listingInfo?.title ?? result.title ?? '';
  const title = isListingSummaryString(rawTitle) ? '' : toText(rawTitle);

  // Filter bad address strings
  const addressValues = [
    result.verifiedFacts?.address,
    result.listingInfo?.address,
    result.property_snapshot?.address,
    result.address,
  ];
  const address = firstValidAddress(...addressValues);

  const price = toText(
    result.listingInfo?.priceAmount ??
    result.price ??
    (result as any).askingPrice ??
    (result as any).asking_price ??
    ''
  );
  const beds = toText(result.listingInfo?.bedrooms ?? result.bedrooms ?? result.property_snapshot?.beds ?? result.property_snapshot?.bedrooms ?? '');
  const baths = toText(result.listingInfo?.bathrooms ?? result.bathrooms ?? result.property_snapshot?.baths ?? result.property_snapshot?.bathrooms ?? '');
  const sqft = toText(result.sqft ?? result.property_snapshot?.sqft ?? '');

  // Zestimate from price_assessment or property_snapshot
  const priceAsmt = result.price_assessment ?? result.priceAssessment ?? {};
  const zestimate = toText(
    priceAsmt?.zestimate ??
    priceAsmt?.zillow_estimate ??
    (result as any).zestimate ??
    result.property_snapshot?.zestimate ??
    ''
  );

  // Monthly payment from Zillow financials
  const zf = (result as any).zillowFinancials ?? {};
  const monthlyPayment = (() => {
    const mp = zf.monthlyPayment?.estimatedPayment?.value
      ?? zf.monthlyPayment?.estimatedMonthlyPayment?.value
      ?? zf.estimatedMonthlyPayment?.value
      ?? (result as any).monthly_payment
      ?? (result as any).monthlyPayment
      ?? (result as any).carrying_costs?.monthly_breakdown?.estimatedMonthlyPayment?.value;
    if (mp != null && mp > 100 && mp < 50000) {
      return '$' + Number(mp).toLocaleString() + '/mo';
    }
    return '';
  })();

  return {
    title: title || '',  // normalizeReportResult will override; can be empty
    address: address || undefined,
    price: price || undefined,
    bedrooms: beds || undefined,
    bathrooms: baths || undefined,
    sqft: sqft || undefined,
    zestimate: zestimate || undefined,
    monthlyPayment: monthlyPayment || undefined,
    score: (() => {
      const v = result.overall_score ?? result.overallScore;
      return v != null && v !== '' ? Number(v) || null : null;
    })(),
    verdict: toText(result.overall_verdict ?? result.verdict ?? 'Not enough data'),
    confidence: toText(result.recommendation?.confidence ?? result.scoreConfidence ?? result.confidence ?? ''),
    summary: toText(result.quick_summary ?? result.quickSummary ?? result.summary ?? ''),
    primaryLabel: toText(result.recommendation?.mainReasons?.[0] ?? ''),
    secondaryLabel: toText(result.recommendation?.nextStep ?? ''),
  };
}

// ── quick facts ───────────────────────────────────────────────────────────────

/** Extract normalized property category and display type from result */
function getPropertyCategoryInfo(result: USSaleResult): { normCat: string; displayType: string } {
  const normCat = result.normalizedPropertyCategory
    ?? (result as any).reportProfile
    ?? 'unknown';
  const displayType = result.displayType ?? normCat;
  return { normCat, displayType };
}

/** Format bathroom value as "X full + Y half bath" when half baths are present */
function formatBaths(baths: unknown): string {
  const text = toText(baths);
  if (!text) return '';
  // If it already looks human-readable (e.g., "1.5" or "1 half"), pass through
  if (text.includes('full') || text.includes('half') || text.includes('+' )) return text;
  const num = parseFloat(text);
  if (isNaN(num)) return text;
  const full = Math.floor(num);
  const half = num - full;
  if (half > 0.25 && half <= 0.75) {
    return half === 0.5
      ? (full > 0 ? `${full} full + 1 half bath` : '1 half bath')
      : `${full} full + ${Math.round(half * 2)} half bath`;
  }
  return text;
}

function buildQuickFacts(result: USSaleResult): QuickFact[] {
  const snap = result.property_snapshot ?? {};
  const facts: QuickFact[] = [];
  const { normCat, displayType } = getPropertyCategoryInfo(result);
  const isCoop = normCat === 'co_op';

  const add = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) facts.push({ label, value: t });
  };
  const addMoney = (label: string, val: unknown) => {
    const t = fmtMoney(val);
    if (t && t !== '$') facts.push({ label, value: t });
  };
  const addTaxYr = (label: string, val: unknown) => {
    const t = fmtAnnualTax(val);
    if (t && t !== '/yr') facts.push({ label, value: t });
  };
  const addPerSqft = (label: string, val: unknown) => {
    const t = fmtPerSqft(val);
    if (t && t !== '/sqft') facts.push({ label, value: t });
  };
  const zf = (result as any).zillowFinancials ?? {};

  addMoney('Price', snap.price ?? result.asking_price ?? result.askingPrice ?? result.price);
  add('Beds', snap.beds ?? snap.bedrooms);
  // Format baths with full/half detail when available
  const bathsVal = snap.baths ?? snap.bathrooms;
  if (bathsVal != null) add('Baths', formatBaths(bathsVal));
  add('Sqft', snap.sqft);
  add('Built', snap.yearBuilt ?? snap.year_built);

  // Type: prefer backend displayType, then raw homeType
  const rawHomeType = snap.homeType ?? snap.home_type ?? '';
  const typeDisplay = displayType && displayType !== 'unknown'
    ? displayType
    : (rawHomeType || 'Not disclosed');
  if (typeDisplay) add('Type', typeDisplay);

  add('Lot', snap.lotSize ?? snap.lot_size);
  addMoney('Assessed', snap.tax_assessed_value_display ?? snap.taxAssessedValue ?? snap.tax_assessed_value);
  addTaxYr('Tax/yr', snap.annual_tax_display ?? snap.annualTax ?? snap.annual_tax);

  // Co-op: show "Monthly maintenance" instead of "HOA"
  if (isCoop) {
    const hoaAmount = snap.hoaAmount ?? (result as any).hoaAmount;
    const hoaStatus = snap.hoa ?? (result as any).hoa;
    if (hoaAmount != null) {
      addMoney('Monthly maintenance', hoaAmount);
    } else if (hoaStatus && hoaStatus !== 'N/A' && hoaStatus !== 'unknown') {
      add('Monthly maintenance', 'Not disclosed');
    }
  } else {
    add('HOA', snap.hoa);
  }

  addPerSqft('$/sqft', snap.price_per_sqft_display ?? snap.pricePerSqft ?? snap.price_per_sqft);

  // Region: prefer neighborhood first, then region. Never let a full address appear here.
  const region = snap.region ?? (result as any).region;
  const listingNeighborhood = (result as any).listingInfo?.neighborhood
    ?? (result as any).listingData?.neighborhood
    ?? (result as any).listingData?.neighbourhood
    ?? (result as any).neighborhood
    ?? null;
  const chosenRegion = listingNeighborhood ?? region;
  if (chosenRegion) {
    const regionText = String(chosenRegion);
    // Skip if region looks like a full street address (has street num + state + ZIP)
    const isFullAddress = /^\d[\d-]*\s+[A-Za-z].*,.*[A-Z]{2}\s*\d{5}/.test(regionText)
      || /^\d[\d-]*\s+[A-Za-z][A-Za-z\s]*\s*(avenue|street|ave|st|road|rd|drive|dr|place|pl|boulevard|blvd|terrace|ter|court|ct|lane|ln)\b/i.test(regionText);
    if (!isFullAddress) {
      add('Region', chosenRegion);
    }
  }

  // Zillow monthly payment breakdown
  const monthlyPayment = zf.monthlyPayment?.estimatedPayment?.value ?? zf.monthlyPayment?.estimatedMonthlyPayment?.value
    ?? (result as any).monthly_payment ?? (result as any).monthlyPayment ?? (result as any).carrying_costs?.monthly_breakdown?.estimatedMonthlyPayment?.value;
  if (monthlyPayment != null && monthlyPayment > 100 && monthlyPayment < 50000) {
    facts.push({ label: 'Monthly Payment', value: '$' + Number(monthlyPayment).toLocaleString() + '/mo' });
  }
  return facts;
}

// ── highlights ────────────────────────────────────────────────────────────────

function buildHighlights(result: USSaleResult): HighlightsData {
  const stringArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    pros: stringArr(result.pros),
    cons: stringArr(result.cons),
    risks: [
      ...stringArr(result.hidden_risks),
      ...stringArr(result.hiddenRisks),
      ...stringArr(result.red_flags),
      ...stringArr(result.redFlags),
    ],
  };
}

// ── build sections ────────────────────────────────────────────────────────────

function buildSections(result: USSaleResult): ReportSection[] {
  const sections: ReportSection[] = [];
  const snap = result.property_snapshot ?? {};
  const { normCat, displayType } = getPropertyCategoryInfo(result);
  const isCoop = normCat === 'co_op';

  // ── property_snapshot ──────────────────────────────────────────────────────
  const snapItems: SectionItem[] = [];
  if (snap.beds ?? snap.bedrooms) snapItems.push({ title: 'Beds', value: toText(snap.beds ?? snap.bedrooms) });
  if (snap.baths ?? snap.bathrooms) snapItems.push({ title: 'Baths', value: formatBaths(snap.baths ?? snap.bathrooms) });
  if (snap.sqft) snapItems.push({ title: 'Sqft', value: toText(snap.sqft) });
  if (snap.yearBuilt ?? snap.year_built) snapItems.push({ title: 'Year Built', value: toText(snap.yearBuilt ?? snap.year_built) });

  // Home Type: prefer normalized displayType, fallback to raw homeType
  const rawHomeType = snap.homeType ?? snap.home_type ?? '';
  const typeDisplay = displayType && displayType !== 'unknown'
    ? displayType
    : rawHomeType;
  if (typeDisplay) {
    const isListingStated = /legal|approved|compliant|certified/i.test(rawHomeType);
    snapItems.push({
      title: 'Home Type',
      value: isListingStated
        ? `${typeDisplay.trim()} (listing-stated, not independently verified)`
        : typeDisplay,
    });
  }

  if (snap.roof) snapItems.push({ title: 'Roof', value: toText(snap.roof) });
  if (snap.lotSize ?? snap.lot_size) snapItems.push({ title: 'Lot Size', value: toText(snap.lotSize ?? snap.lot_size) });
  if (snap.taxAssessedValue ?? snap.tax_assessed_value) snapItems.push({ title: 'Tax Assessed Value', value: fmtMoney(snap.taxAssessedValue ?? snap.tax_assessed_value) });
  if (snap.tax_assessed_value_display) snapItems.push({ title: 'Tax Assessed Value', value: toText(snap.tax_assessed_value_display) });
  if (snap.annualTax ?? snap.annual_tax) snapItems.push({ title: 'Annual Tax', value: fmtAnnualTax(snap.annualTax ?? snap.annual_tax) });
  if (snap.annual_tax_display) snapItems.push({ title: 'Annual Tax', value: toText(snap.annual_tax_display) });

  // Co-op: show "Monthly maintenance" instead of "HOA"
  if (isCoop) {
    const hoaAmount = snap.hoaAmount ?? (result as any).hoaAmount;
    const hoaStatus = snap.hoa ?? (result as any).hoa;
    if (hoaAmount != null) {
      snapItems.push({ title: 'Monthly Maintenance', value: fmtMoney(hoaAmount) });
    } else if (hoaStatus && hoaStatus !== 'N/A' && hoaStatus !== 'unknown') {
      snapItems.push({ title: 'Monthly Maintenance', value: 'Not disclosed' });
    }
  } else {
    if (snap.hoa) snapItems.push({ title: 'HOA', value: toText(snap.hoa) });
  }

  if (snap.pricePerSqft ?? snap.price_per_sqft) snapItems.push({ title: 'Price/Sqft', value: fmtPerSqft(snap.pricePerSqft ?? snap.price_per_sqft) });
  if (snap.price_per_sqft_display) snapItems.push({ title: 'Price/Sqft', value: toText(snap.price_per_sqft_display) });
  if (snap.date_listed) snapItems.push({ title: 'Date Listed', value: toText(snap.date_listed) });
  if (snap.available_date) snapItems.push({ title: 'Available', value: toText(snap.available_date) });
  // Region: prefer neighborhood first, then region. Skip anything that looks like a full address.
  const regionSectionText = String((result as any).listingInfo?.neighborhood
    ?? (result as any).listingData?.neighborhood
    ?? (result as any).listingData?.neighbourhood
    ?? (result as any).neighborhood
    ?? snap.region
    ?? '');
  const isRegionFullAddress = /^\d+\s+[A-Za-z].*,.*[A-Z]{2}\s*\d{5}/.test(regionSectionText)
    || /^\d+\s+[A-Za-z][A-Za-z\s]*\s*(avenue|street|ave|st|road|rd|drive|dr|place|pl|boulevard|blvd|terrace|ter|court|ct|lane|ln)\b/i.test(regionSectionText);
  if (regionSectionText && !isRegionFullAddress) snapItems.push({ title: 'Region', value: toText(regionSectionText) });
  if (snapItems.length > 0) sections.push({ id: 'property-snapshot', title: 'Property Snapshot', items: snapItems });

  // ── price_assessment ───────────────────────────────────────────────────────
  const price = result.price_assessment ?? result.priceAssessment ?? {};
  const priceItems: SectionItem[] = [];
  if (price.estimated_min ?? price.estimatedMin) priceItems.push({ title: 'Est. Min', value: toText(price.estimated_min ?? price.estimatedMin) });
  if (price.estimated_max ?? price.estimatedMax) priceItems.push({ title: 'Est. Max', value: toText(price.estimated_max ?? price.estimatedMax) });
  if (price.asking_price ?? price.askingPrice) priceItems.push({ title: 'Asking Price', value: toText(price.asking_price ?? price.askingPrice) });
  const conf = price.valuation_confidence ?? price.valuationConfidence;
  if (conf) priceItems.push({ title: 'Confidence', value: toText(conf), badge: toText(conf) });
  if (price.verdict) priceItems.push({ title: 'Verdict', value: toText(price.verdict) });
  if (price.explanation) priceItems.push({ title: 'Analysis', description: toText(price.explanation) });
  if (price.tax_context ?? price.taxContext) priceItems.push({ title: 'Tax Context', description: toText(price.tax_context ?? price.taxContext) });
  if (price.price_per_sqft_context ?? price.pricePerSqftContext) priceItems.push({ title: 'Price/Sqft Context', description: toText(price.price_per_sqft_context ?? price.pricePerSqftContext) });
  const missing = Array.isArray(price.missing_data) ? price.missing_data.filter((x: unknown) => toText(x)) : [];
  if (missing.length) priceItems.push({ title: 'Missing Data', description: toText(missing) });
  if (priceItems.length > 0) sections.push({ id: 'price-assessment', title: 'Price Assessment', subtitle: 'Estimated value range', items: priceItems });

  // ── carrying_costs ─────────────────────────────────────────────────────────
  const costs = result.carrying_costs ?? result.carryingCosts ?? {};
  const costItems: SectionItem[] = [];
  if (costs.annual_tax ?? costs.annualTax) costItems.push({ title: 'Annual Tax', value: fmtAnnualTax(costs.annual_tax ?? costs.annualTax) });
  if (costs.annual_tax_display) costItems.push({ title: 'Annual Tax', value: toText(costs.annual_tax_display) });
  if (costs.monthly_tax_equivalent ?? costs.monthlyTaxEquivalent) costItems.push({ title: 'Monthly Tax', value: toText(costs.monthly_tax_equivalent ?? costs.monthlyTaxEquivalent) });

  // Co-op: show "Monthly maintenance" instead of "HOA"
  if (isCoop) {
    if (costs.hoa && costs.hoa !== 'N/A' && costs.hoa !== 'unknown') {
      costItems.push({ title: 'Monthly Maintenance', value: toText(costs.hoa) });
    } else if (!costs.hoa) {
      costItems.push({ title: 'Monthly Maintenance', value: 'Not disclosed' });
    }
  } else {
    if (costs.hoa) costItems.push({ title: 'HOA', value: toText(costs.hoa) });
  }

  const pressure = costs.cost_pressure ?? costs.costPressure;
  if (pressure) costItems.push({ title: 'Cost Pressure', value: toText(pressure), badge: toText(pressure) });
  if (costs.summary) costItems.push({ title: 'Summary', description: toText(costs.summary) });
  const missingCosts = Array.isArray(costs.missing_costs) ? costs.missing_costs.filter((x: unknown) => toText(x)) : [];
  if (missingCosts.length) costItems.push({ title: 'Missing Costs', description: toText(missingCosts) });

  // Monthly breakdown from Zillow financials — key for "What It May Really Cost Monthly" section
  const mb = (costs as any).monthly_breakdown;
  if (mb) {
    if (mb.estimatedMonthlyPayment?.value != null)
      costItems.push({ title: 'Estimated Monthly', value: fmtMoney(mb.estimatedMonthlyPayment.value) });
    if (mb.principalAndInterest?.value != null)
      costItems.push({ title: 'Principal & Interest', value: fmtMoney(mb.principalAndInterest.value) });
    if (mb.mortgageInsurance?.value != null)
      costItems.push({ title: 'Mortgage Insurance', value: fmtMoney(mb.mortgageInsurance.value) });
    if (mb.propertyTaxes?.value != null)
      costItems.push({ title: 'Property Taxes', value: fmtMoney(mb.propertyTaxes.value) });
    if (mb.homeInsurance?.value != null)
      costItems.push({ title: 'Home Insurance', value: fmtMoney(mb.homeInsurance.value) });
    // Co-op: show "Monthly Maintenance" instead of "HOA Fees"
    if (mb.hoaFees?.value != null) {
      costItems.push({ title: isCoop ? 'Monthly Maintenance' : 'HOA Fees', value: fmtMoney(mb.hoaFees.value) });
    } else if ((mb.hoaFees as any)?.status === 'not_applicable') {
      costItems.push({ title: isCoop ? 'Monthly Maintenance' : 'HOA Fees', value: 'N/A' });
    } else if (isCoop && (mb.hoaFees as any)?.status !== 'not_applicable' && mb.hoaFees?.value == null) {
      // Co-op with no maintenance disclosed
      costItems.push({ title: 'Monthly Maintenance', value: 'Not disclosed' });
    }
    if ((mb.utilities as any)?.status === 'not_included')
      costItems.push({ title: 'Utilities', value: 'Not included' });
  }

  if (costItems.length > 0) sections.push({ id: 'carrying-costs', title: 'Carrying Costs', subtitle: 'Tax, HOA, and ongoing costs', items: costItems });

  // ── investment_potential ────────────────────────────────────────────────────
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  const investItems: SectionItem[] = [];
  const rating = invest.rating;
  if (rating) investItems.push({ title: 'Rating', value: toText(rating), badge: toText(rating) });
  if (invest.estimated_monthly_rent ?? invest.estimatedMonthlyRent) investItems.push({ title: 'Est. Monthly Rent', value: toText(invest.estimated_monthly_rent ?? invest.estimatedMonthlyRent) });
  if (invest.summary) investItems.push({ title: 'Summary', description: toText(invest.summary) });
  // supporting_signals are strings like "4 bedrooms suggest rental income" → title=actual text
  const invSignals = Array.isArray(invest.supporting_signals) ? invest.supporting_signals : [];
  for (const s of invSignals) {
    const t = toText(s);
    if (t) investItems.push({ title: t });
  }
  // risks are strings
  const invRisks = Array.isArray(invest.risks) ? invest.risks : [];
  for (const r of invRisks) {
    const t = toText(r);
    if (t) investItems.push({ title: t, severity: 'medium' });
  }
  // things_to_verify are strings
  const verify = Array.isArray(invest.things_to_verify) ? invest.things_to_verify : [];
  for (const v of verify) {
    const t = toText(v);
    if (t) investItems.push({ title: t, badge: 'Verify' });
  }
  if (investItems.length > 0) sections.push({ id: 'investment-potential', title: 'Investment Potential', items: investItems });

  // ── maintenance_risk ───────────────────────────────────────────────────────
  const maint = result.maintenance_risk ?? result.maintenanceRisk ?? {};
  const maintItems: SectionItem[] = [];
  if (maint.rating) {
    const r = toText(maint.rating);
    const sev = severityOf(r);
    maintItems.push({ title: 'Risk Level', value: r, severity: sev, badge: r });
  }
  if (maint.summary) maintItems.push({ title: 'Summary', description: toText(maint.summary) });
  maintItems.push(...objectItems(maint.risk_factors, { title: 'Risk Factor' }));
  maintItems.push(...objectItems(maint.inspection_priorities, { title: 'Inspection Priority' }));
  if (maintItems.length > 0) sections.push({ id: 'maintenance-risk', title: 'Maintenance Risk', subtitle: 'Age, systems, and upkeep', items: maintItems });

  // ── legal_compliance ───────────────────────────────────────────────────────
  const legal = result.legal_compliance ?? result.legalCompliance ?? {};
  const legalItems: SectionItem[] = [];
  if (legal.risk_level ?? legal.riskLevel) {
    const r = toText(legal.risk_level ?? legal.riskLevel);
    legalItems.push({ title: 'Risk Level', value: r, badge: r });
  }
  if (legal.summary) legalItems.push({ title: 'Summary', description: toText(legal.summary) });
  legalItems.push(...objectItems(legal.items_to_verify, { title: 'Verify' }));
  legalItems.push(...objectItems(legal.external_sources_needed, { title: 'Data Needed' }));
  if (legalItems.length > 0) sections.push({ id: 'legal-compliance', title: 'Legal & Compliance', items: legalItems });

  // ── environmental_risk ─────────────────────────────────────────────────────
  const env = result.environmental_risk ?? result.environmentalRisk ?? {};
  const envItems: SectionItem[] = [];
  if (env.risk_level ?? env.riskLevel) {
    const r = toText(env.risk_level ?? env.riskLevel);
    envItems.push({ title: 'Risk Level', value: r, badge: r });
  }
  if (env.summary) envItems.push({ title: 'Summary', description: toText(env.summary) });
  envItems.push(...objectItems(env.items_to_check, { title: 'Check' }));
  if (envItems.length > 0) sections.push({ id: 'environmental-risk', title: 'Environmental Risk', items: envItems });

  // ── listing_language_reality_check ─────────────────────────────────────────
  const reality = Array.isArray(result.listing_language_reality_check ?? result.listingLanguageRealityCheck)
    ? result.listing_language_reality_check ?? result.listingLanguageRealityCheck : [];
  const realityItems: SectionItem[] = [];
  for (const item of reality) {
    const phrase = toText(item.phrase ?? item.title ?? '');
    const meaning = toText(item.what_it_may_mean ?? item.description ?? '');
    if (phrase || meaning) {
      realityItems.push({
        title: phrase || meaning,
        description: phrase && meaning ? meaning : '',
        badge: item.what_to_verify ? 'Verify' : undefined,
      });
    }
  }
  if (realityItems.length > 0) sections.push({ id: 'listing-reality-check', title: 'Listing Reality Check', subtitle: 'What the listing language really means', items: realityItems });

  // ── location_reality_check (replaces neighborhood_lifestyle) ─────────────────
  const neigh = result.neighborhood_lifestyle ?? result.neighborhoodLifestyle ?? {};
  const claims: string[] = [];
  const verifications: string[] = [];

  // page_signals → What the listing claims
  const pageSignals = neigh.page_signals ?? {};
  for (const [, value] of Object.entries(pageSignals)) {
    const text = toText(value);
    if (text) claims.push(text);
  }

  // external_data_needed → What to verify (deduplicated, cleaned)
  const external = neigh.external_data_needed ?? {};
  for (const [, value] of Object.entries(external)) {
    const text = toText(value);
    if (text) verifications.push(text);
  }

  if (claims.length > 0 || verifications.length > 0) {
    sections.push({
      id: 'location-reality-check',
      title: 'Location Reality Check',
      subtitle: 'Based on listing claims, not independently verified.',
      items: [
        { title: 'claims', description: claims.join('\n') },
        { title: 'verifications', description: verifications.join('\n') },
        { title: 'summary', description: toText(neigh.summary ?? '') },
      ],
    });
  }

  // ── data_gaps ──────────────────────────────────────────────────────────────
  const gaps = Array.isArray(result.data_gaps ?? result.dataGaps) ? result.data_gaps ?? result.dataGaps : [];
  const gapItems: SectionItem[] = [];
  for (const item of gaps) {
    const missing = toText(item.missing_item ?? item.title ?? '');
    const why = toText(item.why_it_matters ?? item.whyItMatters ?? item.description ?? '');
    if (missing || why) {
      gapItems.push({ title: missing || why, description: why && missing ? why : '', badge: toText(item.suggested_source) });
    }
  }
  if (gapItems.length > 0) sections.push({ id: 'data-gaps', title: 'Data Gaps', subtitle: 'Missing information to verify', items: gapItems });

  // ── layout_fit ────────────────────────────────────────────────────────────
  const layout = result.layout_fit ?? result.layoutFit ?? {};
  const layoutItems: SectionItem[] = [];
  if (layout.summary) layoutItems.push({ title: 'Summary', description: toText(layout.summary) });
  const bestFor = Array.isArray(layout.best_for ?? layout.bestFor) ? layout.best_for ?? layout.bestFor : [];
  if (bestFor.length) layoutItems.push({ title: 'Best For', description: toText(bestFor) });
  const notIdeal = Array.isArray(layout.not_ideal_for ?? layout.notIdealFor) ? layout.not_ideal_for ?? layout.notIdealFor : [];
  if (notIdeal.length) layoutItems.push({ title: 'Not Ideal For', description: toText(notIdeal) });
  if (layoutItems.length > 0) sections.push({ id: 'layout-fit', title: 'Layout Fit', subtitle: 'Space and layout suitability', items: layoutItems });

  // ── questions_to_ask ──────────────────────────────────────────────────────
  const questions = Array.isArray(result.questions_to_ask ?? result.questionsToAsk) ? result.questions_to_ask ?? result.questionsToAsk : [];
  const qItems = objectItems(questions, { title: 'Question' });
  if (qItems.length > 0) sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', subtitle: 'Before you make an offer', items: qItems });

  return sections;
}

// ── main adapter ──────────────────────────────────────────────────────────────

export function normalizeUSSaleReport(result: USSaleResult): NormalizedReport {
  const reportProfile = computeReportProfile(result);
  const normalizedPropertyCategory = result.normalizedPropertyCategory ?? reportProfile;
  return {
    meta: {
      market: 'US',
      reportMode: 'sale',
      source: toText(result.source ?? result.listingInfo?.source ?? ''),
      sourceDomain: toText(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic: false,
      usedSectionIds: [],
      reportProfile,
      normalizedPropertyCategory: normalizedPropertyCategory as any,
    },
    hero: buildHero(result),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result),
    raw: result,
  };
}
