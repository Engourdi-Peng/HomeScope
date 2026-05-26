// ===== US Sale Adapter =====
// 转换 US Sale 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem } from './types';

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

// ── hero ─────────────────────────────────────────────────────────────────────

function buildHero(result: USSaleResult): HeroData {
  const address = toText(
    result.listingInfo?.address ??
    result.property_snapshot?.address ??
    result.address ??
    ''
  );
  return {
    title: toText(result.listingInfo?.title ?? result.title ?? ''),
    address: address || undefined,
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

function buildQuickFacts(result: USSaleResult): QuickFact[] {
  const snap = result.property_snapshot ?? {};
  const facts: QuickFact[] = [];
  const add = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) facts.push({ label, value: t });
  };
  add('Beds', snap.beds ?? snap.bedrooms);
  add('Baths', snap.baths ?? snap.bathrooms);
  add('Sqft', snap.sqft);
  add('Built', snap.yearBuilt ?? snap.year_built);
  add('Type', snap.homeType ?? snap.home_type);
  add('Lot', snap.lotSize ?? snap.lot_size);
  add('Assessed', snap.taxAssessedValue ?? snap.tax_assessed_value);
  add('Tax/yr', snap.annualTax ?? snap.annual_tax);
  add('HOA', snap.hoa);
  add('$/sqft', snap.pricePerSqft ?? snap.price_per_sqft);
  add('Region', snap.region);
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

  // ── property_snapshot ──────────────────────────────────────────────────────
  const snapItems: SectionItem[] = [];
  if (snap.beds ?? snap.bedrooms) snapItems.push({ title: 'Beds', value: toText(snap.beds ?? snap.bedrooms) });
  if (snap.baths ?? snap.bathrooms) snapItems.push({ title: 'Baths', value: toText(snap.baths ?? snap.bathrooms) });
  if (snap.sqft) snapItems.push({ title: 'Sqft', value: toText(snap.sqft) });
  if (snap.yearBuilt ?? snap.year_built) snapItems.push({ title: 'Year Built', value: toText(snap.yearBuilt ?? snap.year_built) });
  if (snap.homeType ?? snap.home_type) snapItems.push({ title: 'Home Type', value: toText(snap.homeType ?? snap.home_type) });
  if (snap.roof) snapItems.push({ title: 'Roof', value: toText(snap.roof) });
  if (snap.lotSize ?? snap.lot_size) snapItems.push({ title: 'Lot Size', value: toText(snap.lotSize ?? snap.lot_size) });
  if (snap.taxAssessedValue ?? snap.tax_assessed_value) snapItems.push({ title: 'Tax Assessed Value', value: toText(snap.taxAssessedValue ?? snap.tax_assessed_value) });
  if (snap.annualTax ?? snap.annual_tax) snapItems.push({ title: 'Annual Tax', value: toText(snap.annualTax ?? snap.annual_tax) });
  if (snap.hoa) snapItems.push({ title: 'HOA', value: toText(snap.hoa) });
  if (snap.pricePerSqft ?? snap.price_per_sqft) snapItems.push({ title: 'Price/Sqft', value: toText(snap.pricePerSqft ?? snap.price_per_sqft) });
  if (snap.region) snapItems.push({ title: 'Region', value: toText(snap.region) });
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
  if (costs.annual_tax ?? costs.annualTax) costItems.push({ title: 'Annual Tax', value: toText(costs.annual_tax ?? costs.annualTax) });
  if (costs.monthly_tax_equivalent ?? costs.monthlyTaxEquivalent) costItems.push({ title: 'Monthly Tax', value: toText(costs.monthly_tax_equivalent ?? costs.monthlyTaxEquivalent) });
  if (costs.hoa) costItems.push({ title: 'HOA', value: toText(costs.hoa) });
  const pressure = costs.cost_pressure ?? costs.costPressure;
  if (pressure) costItems.push({ title: 'Cost Pressure', value: toText(pressure), badge: toText(pressure) });
  if (costs.summary) costItems.push({ title: 'Summary', description: toText(costs.summary) });
  const missingCosts = Array.isArray(costs.missing_costs) ? costs.missing_costs.filter((x: unknown) => toText(x)) : [];
  if (missingCosts.length) costItems.push({ title: 'Missing Costs', description: toText(missingCosts) });
  if (costItems.length > 0) sections.push({ id: 'carrying-costs', title: 'Carrying Costs', subtitle: 'Tax, HOA, and ongoing costs', items: costItems });

  // ── investment_potential ────────────────────────────────────────────────────
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  const investItems: SectionItem[] = [];
  const rating = invest.rating;
  if (rating) investItems.push({ title: 'Rating', value: toText(rating), badge: toText(rating) });
  if (invest.estimated_monthly_rent ?? invest.estimatedMonthlyRent) investItems.push({ title: 'Est. Monthly Rent', value: toText(invest.estimated_monthly_rent ?? invest.estimatedMonthlyRent) });
  if (invest.summary) investItems.push({ title: 'Summary', description: toText(invest.summary) });
  // supporting_signals are strings like "4 bedrooms suggest rental income" → title=actual text
  const signals = Array.isArray(invest.supporting_signals) ? invest.supporting_signals : [];
  for (const s of signals) {
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

  // ── neighborhood_lifestyle ─────────────────────────────────────────────────
  const neigh = result.neighborhood_lifestyle ?? result.neighborhoodLifestyle ?? {};
  const neighItems: SectionItem[] = [];
  if (neigh.summary) neighItems.push({ title: 'Summary', description: toText(neigh.summary) });
  neighItems.push(...objectItems(neigh.page_signals, { title: 'Signal' }));
  neighItems.push(...objectItems(neigh.external_data_needed, { title: 'Data Needed' }));
  if (neighItems.length > 0) sections.push({ id: 'neighborhood', title: 'Neighborhood', items: neighItems });

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
  return {
    meta: {
      market: 'US',
      reportMode: 'sale',
      source: toText(result.source ?? result.listingInfo?.source ?? ''),
      sourceDomain: toText(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic: false,
    },
    hero: buildHero(result),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result),
    raw: result,
  };
}
