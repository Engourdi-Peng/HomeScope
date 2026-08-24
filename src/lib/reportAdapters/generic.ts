// ===== Generic / Basic Adapter =====
// 兜底适配器：处理 Basic result 和未知结构

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem, PropertyIntelligenceProfile } from './types';
import { buildPropertyIntelligenceProfile } from './reportRules';

type AnyResult = any;

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

/** "3 / 2" or "" if both missing. */
function formatBedsBaths(beds: unknown, baths: unknown): string {
  const b = toText(beds);
  const ba = toText(baths);
  if (b && ba) return `${b} / ${ba}`;
  return b || ba;
}

/** "1,196 sqft" — appends "sqft" if numeric. */
function formatSqft(value: unknown): string {
  const t = toText(value);
  if (!t) return '';
  if (/sqft|sq\s*ft|square\s*feet|square\s*footage/i.test(t)) return t;
  return `${t} sqft`;
}

/** "$11,988/yr" — formats a raw tax number into a readable annual figure. */
function formatTax(value: unknown): string {
  const raw = toText(value);
  if (!raw) return '';
  // If already formatted like "$12,000/yr", return as-is
  if (/^\$[\d,]+(\/yr)?/i.test(raw)) return raw.replace(/\/yr$/i, '') + '/yr';
  const num = Number(String(raw).replace(/[$,]/g, ''));
  if (isNaN(num)) return raw;
  return `$${num.toLocaleString('en-US')}/yr`;
}

function objectItems(arr: unknown[], opts?: { title?: string; badge?: string; severity?: 'low' | 'medium' | 'high' }): SectionItem[] {
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
        const description = toText(obj.description ?? obj.message ?? obj.action ?? obj.reason ?? '');
        if (!title && !description) return null;
        return { title: title || description, description: description || title, badge: opts?.badge, severity: opts?.severity } as SectionItem;
      }
      return null;
    })
    .filter(Boolean) as SectionItem[];
}

// ── hero ─────────────────────────────────────────────────────────────────────

function buildHero(result: AnyResult, isBasic: boolean): HeroData {
  if (isBasic || result.analysisType === 'basic') {
    const score = (() => {
      const v = result.overallScore ?? result.overall_score;
      return v != null && v !== '' ? Number(v) || null : null;
    })();
    const address = toText(result.listingOverview?.address ?? result.address ?? '');
    return {
      title: toText(result.listingOverview?.title ?? result.title ?? ''),
      address: address || undefined,
      score,
      verdict: (typeof result.decision === 'string' && result.decision.trim())
        ? toText(result.decision)
        : toText(result.verdict ?? 'Not enough data'),
      confidence: undefined,
      summary: toText(result.textAnalysis ?? result.summary ?? result.quickSummary ?? result.quick_summary ?? ''),
      bottomLine: toText(result.bottom_line ?? result.bottomLine ?? result.quickSummary ?? '') || undefined,
      primaryLabel: undefined,
      secondaryLabel: toText(result.nextBestMove ?? result.next_step ?? '') || undefined,
    };
  }
  const score = (() => {
    const v = result.overallScore ?? result.overall_score;
    return v != null && v !== '' ? Number(v) || null : null;
  })();
  return {
    title: toText(result.listingInfo?.title ?? result.title ?? ''),
    address: toText(result.listingInfo?.address ?? result.address ?? ''),
    score,
    verdict: toText(result.verdict ?? result.overall_verdict ?? 'Not enough data'),
    confidence: toText(result.confidenceLevel ?? result.confidence_level ?? ''),
    summary: toText(result.quickSummary ?? result.quick_summary ?? result.summary ?? ''),
    primaryLabel: undefined,
    secondaryLabel: undefined,
  };
}

// ── quick facts ───────────────────────────────────────────────────────────────

function buildQuickFacts(result: AnyResult): QuickFact[] {
  const facts: QuickFact[] = [];
  const info = result.listingInfo ?? result.listingOverview ?? {};
  const add = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) facts.push({ label, value: t });
  };
  add('Beds', info.bedrooms ?? result.bedrooms);
  add('Baths', info.bathrooms ?? result.bathrooms);
  add('Parking', info.parking ?? result.parking);
  add('Price', info.price ?? result.price);
  add('Rent/wk', info.weeklyRent ?? result.weeklyRent);

  add('Sqft', info.sqft ?? result.sqft);
  return facts;
}

// ── highlights ────────────────────────────────────────────────────────────────

function buildHighlights(result: AnyResult): HighlightsData {
  const stringArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  // Filter out AI error/hallucination text that slips through as risk items
  const ERROR_PATTERNS = [
    /^analysis could not be completed$/i,
    /^unable to (fully )?analyse/i,
    /^unable to (fully )?analyze/i,
    /^not enough data/i,
    /^error: /i,
    /^failed to /i,
  ];
  const isErrorText = (s: string) => ERROR_PATTERNS.some((re) => re.test(s.trim()));

  const allRisks = [
    ...stringArr(result.riskSignals),
    ...stringArr(result.risks),
    ...stringArr(result.hidden_risks),
    ...stringArr(result.hiddenRisks),
    ...stringArr(result.red_flags),
    ...stringArr(result.redFlags),
  ].filter((s) => !isErrorText(s));

  return {
    pros: stringArr(result.whatLooksGood).concat(stringArr(result.pros)),
    cons: stringArr(result.cons),
    risks: allRisks,
  };
}

// ── build sections ────────────────────────────────────────────────────────────

/**
 * Apply property_snapshot data to fill any missing fields in what_we_know.
 * property_snapshot is built from optionalDetails in the backend and is always
 * populated — it is the authoritative source for extracted structured fields.
 * This ensures WhatWeKnowSection always shows data even when the AI's
 * what_we_know is empty or incomplete.
 */
function applyPropertySnapshot(wwKnow: Record<string, unknown>, result: AnyResult): void {
  const snap = (result as any).property_snapshot ?? {};
  const opts = (result as any).optionalDetails ?? {};
  const setIfEmpty = (key: string, value: unknown) => {
    if ((wwKnow[key] == null || wwKnow[key] === '') && value != null && value !== '') {
      wwKnow[key] = value;
    }
  };
  setIfEmpty('address',        snap.address ?? snap.full_address ?? snap.street_address);
  setIfEmpty('asking_price',   snap.asking_price_display ?? snap.asking_price ?? snap.price);
  setIfEmpty('beds',          snap.beds ?? snap.bedrooms);
  setIfEmpty('baths',         snap.baths ?? snap.bathrooms);
  setIfEmpty('sqft',          snap.sqft ?? snap.square_feet ?? snap.squareFeet);
  setIfEmpty('year_built',    snap.year_built ?? snap.yearBuilt);
  setIfEmpty('property_type', snap.home_type ?? snap.property_type ?? snap.propertyType);
  setIfEmpty('lot_size',      snap.lot_size ?? snap.lotSize);
  setIfEmpty('tax_year',      snap.annual_tax_display ?? snap.annual_tax ?? snap.annualTax);
  setIfEmpty('price_per_sqft',snap.price_per_sqft_display ?? snap.price_per_sqft ?? snap.pricePerSqft);
  // Parking: prefer a description-derived summary (e.g. "Two deeded underground
  // parking spaces") over the raw count. "Parking 4" is ambiguous and can be
  // misread as 4 deeded spots.
  setIfEmpty('parking',       describeParking(opts, snap));
  // monthly_payment: the backend builds monthly_cost_snapshot separately;
  // read from result.monthly_cost_snapshot if present.
  // The snapshot uses snake_case keys from the deterministic fill:
  //   estimated_monthly_payment, principal_and_interest, mortgage_insurance,
  //   property_taxes, home_insurance, hoa_fees, utilities.
  const mcs = (result as any).monthly_cost_snapshot;
  if (mcs && !wwKnow['monthly_payment']) {
    const total = (mcs.estimated_monthly_payment != null && mcs.estimated_monthly_payment > 0)
      ? mcs.estimated_monthly_payment
      : null;
    setIfEmpty('monthly_payment', total);
    setIfEmpty('monthly_payment_source', mcs.source ?? 'Zillow/listing estimate');
    setIfEmpty(
      'monthly_payment_components',
      {
        principal_and_interest: mcs.principal_and_interest ?? null,
        property_taxes: mcs.property_taxes ?? null,
        home_insurance: mcs.home_insurance ?? null,
        mortgage_insurance: mcs.mortgage_insurance ?? null,
        hoa_fees: mcs.hoa_fees ?? null,
        utilities: mcs.utilities ?? null,
      },
    );
  }
}

/**
 * Builds a human-readable parking description. The Zillow extraction returns
 * "Total spaces: 4, Garage spaces: 2" but the listing description often says
 * "Two deeded underground parking spaces & guest parking". The latter is far
 * more useful for a buyer, so prefer it when present.
 */
function describeParking(opts: Record<string, unknown>, snap: Record<string, unknown>): string {
  const description = String(
    opts.description ?? opts.listingDescription ?? opts.whatsSpecialText ?? opts.listingText ?? '',
  );
  // Phrases like "Two deeded underground parking spaces", "3 deeded parking spots"
  const deededMatch = description.match(
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+deeded\s+(underground\s+|covered\s+|assigned\s+|heated\s+|private\s+)?(parking\s+(spaces?|spots|stalls?)|garage\s+spaces?)/i,
  );
  if (deededMatch) return `Deeded parking: ${deededMatch[0]}`;
  const spacesVal = snap.parking ?? opts.parking ?? opts.garageSpaces ?? snap.garage_spaces;
  if (spacesVal != null && spacesVal !== '') return `${spacesVal} parking spaces`;
  return '';
}

/** Format a numeric or string value as "$X,XXX/mo". Returns '' when too small. */
function formatMonthlyPayment(value: unknown): string {
  if (value == null || value === '') return '';
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(num) || num < 100 || num > 50000) return '';
  return '$' + Math.round(num).toLocaleString('en-US') + '/mo';
}

function buildSections(result: AnyResult, isBasic: boolean, analysisProfile?: PropertyIntelligenceProfile): ReportSection[] {
  const sections: ReportSection[] = [];
  // Hoist property_snapshot so the labelMap (which uses wwKnow + snap) can
  // reference it before any conditional logic declares it.
  const snap = (result as any).property_snapshot ?? {};

  if (isBasic) {
    // ── what-we-know (US Basic v2) ─────────────────────────────────────────
    const wwKnow = result.what_we_know ?? result.whatWeKnow ?? {};
    // Fill gaps from property_snapshot (authoritative source from optionalDetails)
    applyPropertySnapshot(wwKnow, result);
    const wwItems: SectionItem[] = [];
    const labelMap: Array<[string, unknown]> = [
      ['Address', wwKnow.address],
      ['Asking Price', wwKnow.asking_price ?? wwKnow.askingPrice ?? wwKnow.price],
      ['Beds / Baths', formatBedsBaths(wwKnow.beds ?? wwKnow.bedrooms, wwKnow.baths ?? wwKnow.bathrooms)],
      ['Sqft', formatSqft(wwKnow.sqft)],
      ['Year Built', wwKnow.year_built ?? wwKnow.yearBuilt],
      ['Property Type', wwKnow.property_type ?? wwKnow.propertyType],
      ['Lot Size', wwKnow.lot_size ?? wwKnow.lotSize],
      ['Tax / Year', formatTax(wwKnow.tax_year ?? wwKnow.taxYear ?? wwKnow.taxes ?? wwKnow.annual_tax)],
      ['Price per Sqft', wwKnow.price_per_sqft ?? wwKnow.pricePerSqft],
      ['Parking', wwKnow.parking ?? snap.parking ?? snap.garage_spaces ?? snap.garageSpaces],
      ['Estimated Monthly Payment', formatMonthlyPayment(wwKnow.monthly_payment ?? wwKnow.monthlyPayment)],
      ['HOA', wwKnow.hoa ?? wwKnow.HOA ?? wwKnow.hoa_fee ?? wwKnow.hoaFee],
    ];
    for (const [label, val] of labelMap) {
      const t = toText(val);
      if (t) wwItems.push({ title: label, value: t });
    }
    if (wwItems.length > 0) sections.push({ id: 'what-we-know', title: 'What We Know', items: wwItems });

    // ── carrying-costs (US Basic v2) ─────────────────────────────────────────
    // Show the deterministic monthly cost snapshot when at least one component
    // is available. The frontend view derives a total from the components when
    // estimated_monthly_payment is missing.
    const mcsRaw = (result as any).monthly_cost_snapshot ?? null;
    // Detect at least one valid numeric component (or the estimated total).
    // monthly_payment_components is also seeded by applyPropertySnapshot but
    // mcsRaw is the authoritative source for rendering the breakdown rows.
    const hasComponents =
      mcsRaw &&
      (
        (mcsRaw.estimated_monthly_payment != null && mcsRaw.estimated_monthly_payment > 0) ||
        (mcsRaw.principal_and_interest != null && mcsRaw.principal_and_interest > 0) ||
        (mcsRaw.property_taxes != null && mcsRaw.property_taxes > 0) ||
        (mcsRaw.home_insurance != null && mcsRaw.home_insurance > 0) ||
        (mcsRaw.hoa_fees != null && mcsRaw.hoa_fees > 0)
      );
    if (hasComponents) {
      const carryingItems: SectionItem[] = [];
      // Total derived from components when estimated_monthly_payment is null
      const derivedTotal = (() => {
        if (mcsRaw.estimated_monthly_payment != null && mcsRaw.estimated_monthly_payment > 0) return mcsRaw.estimated_monthly_payment;
        const parts = [
          mcsRaw.principal_and_interest,
          mcsRaw.property_taxes,
          mcsRaw.home_insurance,
          mcsRaw.mortgage_insurance,
          mcsRaw.hoa_fees,
        ];
        const sum = parts.reduce((acc: number, v: number) => acc + (typeof v === 'number' && v > 0 ? v : 0), 0);
        return sum > 0 ? sum : null;
      })();
      if (derivedTotal) {
        carryingItems.push({
          title: 'Zillow Estimated Payment',
          value: '$' + Math.round(Number(derivedTotal)).toLocaleString('en-US') + '/mo',
          badge: 'Zillow estimate',
        });
      }
      const pushComponent = (label: string, raw: unknown) => {
        if (raw == null) return;
        const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''));
        if (!Number.isFinite(num) || num < 0) return;
        carryingItems.push({ title: label, value: '$' + Math.round(num).toLocaleString('en-US') });
      };
      pushComponent('Principal & Interest', mcsRaw.principal_and_interest);
      pushComponent('Property Tax',          mcsRaw.property_taxes);
      pushComponent('Home Insurance',        mcsRaw.home_insurance);
      pushComponent('HOA',                   mcsRaw.hoa_fees);
      pushComponent('Mortgage Insurance',    mcsRaw.mortgage_insurance);
      if (mcsRaw.utilities != null) {
        const u = String(mcsRaw.utilities).trim();
        if (u) carryingItems.push({ title: 'Utilities', value: u });
      }
      if (mcsRaw.disclaimer) {
        carryingItems.push({ title: 'Source', description: String(mcsRaw.disclaimer) });
      }
      sections.push({
        id: 'carrying-costs',
        title: 'Known Carrying Costs',
        subtitle: 'From the Zillow listing estimate',
        items: carryingItems,
      });
    }

    // ── listing-signals (US Basic v2) ─────────────────────────────────────────
    // Prefer AI-generated signals; if none returned, derive from structured fields
    const aiSignals: any[] = Array.isArray(result.listing_signals) ? result.listing_signals : [];
    const yearBuilt = wwKnow.year_built ?? wwKnow.yearBuilt ?? snap.year_built ?? snap.yearBuilt ?? null;
    const propertyType = ((wwKnow.property_type ?? wwKnow.propertyType ?? snap.home_type ?? snap.property_type ?? '')).toLowerCase();
    const pricePerSqft = wwKnow.price_per_sqft ?? wwKnow.pricePerSqft ?? snap.price_per_sqft ?? snap.pricePerSqft ?? null;
    const tax = wwKnow.tax_year ?? wwKnow.taxYear ?? wwKnow.taxes ?? wwKnow.annual_tax ?? snap.annual_tax ?? snap.annualTax ?? null;
    const hasHOA = !!(wwKnow.hoa ?? wwKnow.HOA ?? wwKnow.hoa_fee ?? wwKnow.hoaFee ?? snap.hoa_fee ?? snap.hoaFee);
    const hasBasementMention = /basement|cellar|below.?grade|walk.?out/i.test(String(wwKnow.description ?? snap.description ?? ''));
    const isMultiFamily = /duplex|multi.?family|2\.?family|3\.?family|4\.?family|two.?family/i.test(propertyType);
    const hasRenovationMention = /renovation|updated|remodel|newly.?done|refurbish/i.test(String(wwKnow.description ?? snap.description ?? ''));
    const isOld = yearBuilt && Number(yearBuilt) < 1975;
    const listingText = String(wwKnow.description ?? snap.description ?? '').toLowerCase();
    // Heuristic: above-average price/sqft is a signal worth surfacing
    const sqft = wwKnow.sqft ?? wwKnow.square_feet ?? wwKnow.squareFeet ?? null;
    const pricePerSqftSignal = pricePerSqft && Number(pricePerSqft) > 500
      ? pricePerSqft : null;

    // Only add yearBuilt system signal for fee-simple ownership types where buyer maintains systems
    const SYSTEM_OWNER_TYPES = new Set(['single_family', 'multi_family', 'townhouse']);
    const profileCategory = analysisProfile?.propertyCategory;
    const isSystemOwnerType = profileCategory
      ? SYSTEM_OWNER_TYPES.has(profileCategory)
      : !/condo|co.?op|land|manufactured/i.test(propertyType);

    const dynamicSignals: any[] = [];
    if (isOld && yearBuilt && isSystemOwnerType) dynamicSignals.push({
      signal: `Built in ${yearBuilt}`,
      reason: `A home from ${yearBuilt} likely has aging roof, HVAC, electrical, or plumbing — all significant costs to verify before committing.`,
    });
    if (pricePerSqftSignal) {
      const display = typeof pricePerSqftSignal === 'string' ? pricePerSqftSignal : `$${Number(pricePerSqftSignal).toLocaleString()}/sqft`;
      dynamicSignals.push({
        signal: `At ${display}`,
        reason: `Price per sqft is visible, but comparable sales and property condition are needed before judging whether the price is justified.`,
      });
    }
    if (tax) {
      const taxDisplay = typeof tax === 'string' ? tax : `$${Number(tax).toLocaleString()}/yr`;
      dynamicSignals.push({
        signal: `Tax Disclosed: ${taxDisplay}`,
        reason: `Annual taxes are listed, but insurance, utilities, and loan terms still need verification before calculating real carrying costs.`,
      });
    }
    // Zestimate signal: if Zillow data exists, surface it
    const zestimate = wwKnow.zestimate ?? (snap as any).zestimate ?? null;
    const rentZestimate = wwKnow.rent_zestimate ?? (snap as any).rentZestimate ?? null;
    if (zestimate) {
      dynamicSignals.push({
        signal: 'Zillow Value Available',
        reason: `Zillow shows a Zestimate of $${Number(zestimate).toLocaleString()}${rentZestimate ? ` and Rent Zestimate of $${Number(rentZestimate).toLocaleString()}/mo` : ''} — verify with comparable sales and actual assumptions before relying on these figures.`,
      });
    }
    // Basement signal: only for fee-simple / system-owner types (SF, MF, TH)
    // Co-ops and condos may reference a basement but that decision lives with the building management
    if (hasBasementMention && profileCategory && SYSTEM_OWNER_TYPES.has(profileCategory)) dynamicSignals.push({
      signal: `Basement Mentioned`,
      reason: `The listing references a basement — permits, legal use, and egress should be verified before relying on that space.`,
    });
    if (isMultiFamily) dynamicSignals.push({
      signal: `Multi-Family Claim`,
      reason: `The listing suggests multi-family use — Certificate of Occupancy and legal unit count must be verified.`,
    });
    if (hasHOA) dynamicSignals.push({
      signal: `HOA Property`,
      reason: `HOA fees are listed, but reserves, special assessments, and rental restrictions are not disclosed.`,
    });
    if (hasRenovationMention) dynamicSignals.push({
      signal: `Renovation Mentioned`,
      reason: `Update or renovation is referenced — permits and inspection history should be verified.`,
    });
    if (sqft && !pricePerSqft && listingText.includes('spacious')) dynamicSignals.push({
      signal: `Listing Highlights Size`,
      reason: `The listing mentions interior size, but room dimensions and layout practicality still need verification.`,
    });

    // Build final signals: AI signals first, then dynamic fill
    const signals: any[] = [...aiSignals];
    if (signals.length === 0 && dynamicSignals.length > 0) {
      // Use dynamic signals (property-specific) instead of fixed trio
      signals.push(...dynamicSignals);
    }
    if (signals.length > 0) {
      sections.push({
        id: 'listing-signals',
        title: 'Listing Signals',
        subtitle: 'What this listing reveals about the property',
        items: signals.slice(0, 3).map((s: any) => ({
          title: s.signal ?? '',
          description: s.reason ?? '',
        })),
      });
    }

    // ── whats-missing (US Basic v2) ─────────────────────────────────────────
    const missing: string[] = Array.isArray(result.whats_missing ?? result.whatsMissing)
      ? (result.whats_missing ?? result.whatsMissing).filter((x: unknown) => typeof x === 'string')
      : [];
    if (missing.length > 0) {
      sections.push({
        id: 'whats-missing',
        title: "What's Missing",
        subtitle: 'Still needs verification before relying on this listing',
        items: missing.map((s) => ({ title: s })),
      });
    }

    // ── key-things-to-check (US Basic v2) ────────────────────────────────────
    const top3Raw: any[] = Array.isArray(result.top_3_things_to_check ?? result.top3ThingsToCheck)
      ? (result.top_3_things_to_check ?? result.top3ThingsToCheck)
      : [];
    const top3Items: SectionItem[] = top3Raw
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return { title: item };
        const title = toText(item.title ?? '');
        const why = toText(item.why_it_matters ?? item.why ?? item.explanation ?? '');
        const action = toText(item.action ?? item.ask ?? '');
        if (!title && !why && !action) return null;
        return {
          title: title || why || action,
          description: why || undefined,
          action: action || undefined,
        } as SectionItem;
      })
      .filter(Boolean) as SectionItem[];

    // ── Listing-specific prioritization for Basic mode ─────────────────────────
    // Promote items that reference specific listing features (balcony, dewlling
    // membranes, HOA reserves, etc.) above boilerplate ones (e.g. "Built in 1971",
    // generic comps). The Basic report should highlight at least one problem
    // unique to this listing, not just generic advice.
    const SPECIFIC_KEYWORDS = [
      /balcon|waterproof|water\s*intrusion|membrane|deck|decking|leak|terrace/i,
      /parking|deeded|underground/i,
      /hoa|reserve|assessment|board\s*approval|flip\s*tax/i,
      /rental\s*restrict|pet\s*policy|sublet/i,
      /basement|cellar|egress|walk.?out|below.?grade/i,
    ];
    const isListingSpecific = (item: SectionItem) => {
      const text = `${toText(item.title)} ${toText(item.description)} ${toText(item.action)}`;
      return SPECIFIC_KEYWORDS.some(p => p.test(text));
    };

    const top3ItemsSorted = [
      ...top3Items.filter(isListingSpecific),
      ...top3Items.filter((i) => !isListingSpecific(i)),
    ];

    // Show 2–3 items; if fewer than 2, hide the section entirely
    if (top3ItemsSorted.length >= 2) {
      sections.push({
        id: 'key-things-to-check',
        title: 'Key Things To Check',
        subtitle: 'Decisions that can change before you commit',
        items: top3ItemsSorted.slice(0, 3),
      });
    }
  }

  // ── price_assessment ───────────────────────────────────────────────────────
  const price = result.price_assessment ?? result.priceAssessment ?? {};
  const priceItems: SectionItem[] = [];
  if (price.estimated_min ?? price.estimatedMin) priceItems.push({ title: 'Est. Min', value: toText(price.estimated_min ?? price.estimatedMin) });
  if (price.estimated_max ?? price.estimatedMax) priceItems.push({ title: 'Est. Max', value: toText(price.estimated_max ?? price.estimatedMax) });
  if (price.asking_price ?? price.askingPrice) priceItems.push({ title: 'Asking Price', value: toText(price.asking_price ?? price.askingPrice) });
  if (price.verdict) priceItems.push({ title: 'Verdict', value: toText(price.verdict) });
  if (price.explanation) priceItems.push({ title: 'Analysis', description: toText(price.explanation) });
  if (priceItems.length > 0) sections.push({ id: 'price-assessment', title: 'Price Assessment', items: priceItems });

  // ── rent_fairness ─────────────────────────────────────────────────────────
  const fair = result.rent_fairness ?? result.rentFairness ?? {};
  const fairItems: SectionItem[] = [];
  if (fair.estimated_min ?? fair.estimatedMin) fairItems.push({ title: 'Est. Min', value: toText(fair.estimated_min ?? fair.estimatedMin) });
  if (fair.estimated_max ?? fair.estimatedMax) fairItems.push({ title: 'Est. Max', value: toText(fair.estimated_max ?? fair.estimatedMax) });
  if (fair.listing_price ?? fair.listingPrice) fairItems.push({ title: 'Listing Price', value: toText(fair.listing_price ?? fair.listingPrice) });
  if (fair.verdict) fairItems.push({ title: 'Verdict', value: toText(fair.verdict) });
  if (fair.explanation) fairItems.push({ title: 'Analysis', description: toText(fair.explanation) });
  if (fairItems.length > 0) sections.push({ id: 'rent-fairness', title: 'Rent Fairness', items: fairItems });

  // ── investment_potential ────────────────────────────────────────────────────
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  const investItems: SectionItem[] = [];
  if (invest.rating ?? invest.growth_outlook) {
    const r = toText(invest.rating ?? invest.growth_outlook);
    if (r) investItems.push({ title: 'Outlook', value: r, badge: r });
  }
  if (invest.rental_yield_estimate) investItems.push({ title: 'Est. Yield', value: toText(invest.rental_yield_estimate) });
  if (invest.capital_growth_5yr) investItems.push({ title: 'Growth 5yr', value: toText(invest.capital_growth_5yr) });
  if (invest.summary) investItems.push({ title: 'Summary', description: toText(invest.summary) });
  investItems.push(...objectItems(invest.supporting_signals));
  investItems.push(...objectItems(invest.risks, { severity: 'medium' }));
  investItems.push(...objectItems(invest.things_to_verify, { badge: 'Verify' }));
  if (investItems.length > 0) sections.push({ id: 'investment-potential', title: 'Investment Potential', items: investItems });

  // ── space_analysis ─────────────────────────────────────────────────────────
  const space = result.spaceAnalysis ?? result.space_analysis ?? {};
  const spaceData = Array.isArray(space.spaceAnalysis ?? space.space_analysis) ? space.spaceAnalysis ?? space.space_analysis : [];
  const spaceItems: SectionItem[] = [];
  for (const room of spaceData) {
    const roomType = toText(room.spaceType ?? room.room ?? '');
    const score = room.score != null ? `${String(room.score)}/10` : '';
    const explanation = toText(room.explanation ?? '');
    if (roomType || score || explanation) {
      spaceItems.push({ title: roomType, value: score || undefined, description: explanation || undefined });
    }
  }
  if (spaceItems.length > 0) sections.push({ id: 'space-analysis', title: 'Space & Layout', items: spaceItems });

  // ── competition_risk ───────────────────────────────────────────────────────
  const comp = result.competitionRisk ?? result.competition_risk ?? {};
  const compItems: SectionItem[] = [];
  if (comp.level) {
    const l = toText(comp.level);
    compItems.push({ title: 'Competition Level', value: l, badge: l });
  }
  compItems.push(...objectItems(comp.reasons, { title: 'Reason' }));
  if (compItems.length > 0) sections.push({ id: 'competition-risk', title: 'Competition Risk', items: compItems });

  // ── questions_to_ask ──────────────────────────────────────────────────────
  const questions = Array.isArray(result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions) ? result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions : [];
  const qItems = objectItems(questions, { title: 'Question' });
    if (qItems.length > 0) sections.push({ id: 'questions', title: 'Questions to Ask', items: qItems });

  return sections;
}

// ── main adapter ──────────────────────────────────────────────────────────────

export function normalizeGenericReport(result: AnyResult, opts?: { analysisProfile?: PropertyIntelligenceProfile }): NormalizedReport {
  const isBasic = result.analysisType === 'basic' || ('decision' in result && result.decision !== undefined);

  // Resolve market from result (backend now sets market='US' or 'AU' on basic responses).
  const rawMarket = toText(result.market ?? result.Market ?? '');
  const market: 'US' | 'AU' | 'UNKNOWN' = rawMarket === 'US' || rawMarket === 'AU' ? rawMarket : 'UNKNOWN';

  // Build profile if not already provided (standalone calls won't have opts)
  const analysisProfile = opts?.analysisProfile ?? buildPropertyIntelligenceProfile({
    normalizedPropertyCategory: null,
    propertyType: (result as any).propertyType
      ?? (result as any).what_we_know?.property_type
      ?? (result as any).property_snapshot?.home_type,
    listingText: (result as any).description
      ?? (result as any).listingInfo?.description
      ?? (result as any).what_we_know?.description,
    yearBuilt: (() => {
      const yb = (result as any).yearBuilt
        ?? (result as any).what_we_know?.year_built
        ?? (result as any).property_snapshot?.year_built;
      return typeof yb === 'number' ? yb : null;
    })(),
    zestimateAvailable: Boolean(
      (result as any).zestimate
        ?? (result as any).what_we_know?.zestimate
        ?? (result as any).property_snapshot?.zestimate,
    ),
  });

  return {
    meta: {
      market,
      reportMode: (() => {
        // ── Identify reportMode from explicit fields FIRST, then from
        // schema markers in the result. Never default to 'sale' — that
        // would silently trigger sale-only UI for rent reports.
        const candidates = [
          result.reportMode,
          result.report_mode,
          result.listingType,
        ];
        for (const c of candidates) {
          const v = toText(c).toLowerCase();
          if (v === 'sale' || v === 'rent' || v === 'unknown') return v as 'sale' | 'rent' | 'unknown';
        }
        // Schema-based inference for full results that never stamped reportMode.
        if (result.rental_listing_score || result.rental_snapshot || result.rental_listing_trust || result.rent_fairness) {
          return 'rent';
        }
        if (result.property_snapshot || result.carrying_costs || result.price_assessment) {
          return 'sale';
        }
        return 'unknown';
      })(),
      listingScope: toText(result.listingScope ?? null) || null,
      source: toText(result.source ?? ''),
      sourceDomain: toText(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic,
      analysisProfile,
    },
    hero: buildHero(result, isBasic),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result, isBasic, analysisProfile),
    raw: result,
  };
}
