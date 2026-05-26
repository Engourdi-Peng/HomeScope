// ===== US Sale Adapter =====
// 转换 US Sale 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection } from './types';

type USSaleResult = any;

function pick<T>(obj: any, ...keys: (keyof T)[]): Partial<T> {
  const result: any = {};
  for (const key of keys) {
    if (obj?.[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

// 通用 safe 字符串化
function str(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  return String(val);
}

// 通用 safe 数字
function num(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ---- hero ----
function buildHero(result: USSaleResult): HeroData {
  const score = num(result.overall_score ?? result.overallScore ?? null);
  const verdict = str(result.overall_verdict ?? result.verdict ?? '');
  const summary = str(result.quick_summary ?? result.quickSummary ?? result.summary ?? '');
  const confidence = str(
    result.recommendation?.confidence ??
    result.scoreConfidence ??
    result.confidence ??
    ''
  );
  const address = str(
    result.listingInfo?.address ??
    result.property_snapshot?.address ??
    result.address ??
    ''
  );
  const title = str(result.listingInfo?.title ?? result.title ?? '');
  const primaryLabel = str(result.recommendation?.mainReasons?.[0] ?? '');
  const secondaryLabel = str(result.recommendation?.nextStep ?? '');

  return {
    title: title || undefined,
    address: address || undefined,
    score,
    verdict: verdict || (score !== null ? 'Not enough data' : 'No verdict available'),
    confidence: confidence || undefined,
    summary: summary || undefined,
    primaryLabel: primaryLabel || undefined,
    secondaryLabel: secondaryLabel || undefined,
  };
}

// ---- quick facts ----
function buildQuickFacts(result: USSaleResult): QuickFact[] {
  const snap = result.property_snapshot ?? {};
  const facts: QuickFact[] = [];

  const beds = snap.beds ?? snap.bedrooms ?? null;
  if (beds !== null && beds !== undefined) facts.push({ label: 'Beds', value: str(beds) });

  const baths = snap.baths ?? snap.bathrooms ?? null;
  if (baths !== null && baths !== undefined) facts.push({ label: 'Baths', value: str(baths) });

  const sqft = snap.sqft ?? null;
  if (sqft !== null && sqft !== undefined) facts.push({ label: 'Sqft', value: str(sqft) });

  const yearBuilt = snap.yearBuilt ?? snap.year_built ?? null;
  if (yearBuilt !== null && yearBuilt !== undefined) facts.push({ label: 'Built', value: str(yearBuilt) });

  const homeType = snap.homeType ?? snap.home_type ?? null;
  if (homeType) facts.push({ label: 'Type', value: str(homeType) });

  const lotSize = snap.lotSize ?? snap.lot_size ?? null;
  if (lotSize) facts.push({ label: 'Lot', value: str(lotSize) });

  const taxAssessed = snap.taxAssessedValue ?? snap.tax_assessed_value ?? null;
  if (taxAssessed) facts.push({ label: 'Assessed', value: str(taxAssessed) });

  const annualTax = snap.annualTax ?? snap.annual_tax ?? null;
  if (annualTax) facts.push({ label: 'Tax/yr', value: str(annualTax) });

  const hoa = snap.hoa ?? null;
  if (hoa) facts.push({ label: 'HOA', value: str(hoa) });

  const pricePerSqft = snap.pricePerSqft ?? snap.price_per_sqft ?? null;
  if (pricePerSqft) facts.push({ label: '$/sqft', value: str(pricePerSqft) });

  const region = snap.region ?? null;
  if (region) facts.push({ label: 'Region', value: str(region) });

  return facts;
}

// ---- highlights ----
function buildHighlights(result: USSaleResult): HighlightsData {
  const pros = Array.isArray(result.pros) ? result.pros : [];
  const cons = Array.isArray(result.cons) ? result.cons : [];
  const risks = [
    ...(Array.isArray(result.hidden_risks) ? result.hidden_risks : []),
    ...(Array.isArray(result.hiddenRisks) ? result.hiddenRisks : []),
    ...(Array.isArray(result.red_flags) ? result.red_flags : []),
    ...(Array.isArray(result.redFlags) ? result.redFlags : []),
  ];
  return { pros, cons, risks };
}

// ---- helpers: build section items ----
function textItems(arr: any[]): Array<{ title: string; description?: string }> {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === 'string') return { title: item };
      return {
        title: str(item.title ?? item.phrase ?? item.keyword ?? ''),
        description: str(item.description ?? item.what_it_may_mean ?? item.message ?? item.action ?? ''),
      };
    })
    .filter((i) => i.title);
}

function riskSeverity(level: string | undefined): 'low' | 'medium' | 'high' | 'critical' | undefined {
  if (!level) return undefined;
  const l = level.toUpperCase();
  if (l === 'LOW') return 'low';
  if (l === 'MEDIUM' || l === 'MODERATE') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
}

// ---- build sections ----
function buildSections(result: USSaleResult): ReportSection[] {
  const sections: ReportSection[] = [];

  // property_snapshot
  const snap = result.property_snapshot ?? {};
  if (Object.keys(snap).length > 0) {
    const items: ReportSection['items'] = [];
    if (snap.beds ?? snap.bedrooms) items.push({ title: 'Beds', value: str(snap.beds ?? snap.bedrooms) });
    if (snap.baths ?? snap.bathrooms) items.push({ title: 'Baths', value: str(snap.baths ?? snap.bathrooms) });
    if (snap.sqft) items.push({ title: 'Sqft', value: str(snap.sqft) });
    if (snap.yearBuilt ?? snap.year_built) items.push({ title: 'Year Built', value: str(snap.yearBuilt ?? snap.year_built) });
    if (snap.homeType ?? snap.home_type) items.push({ title: 'Home Type', value: str(snap.homeType ?? snap.home_type) });
    if (snap.roof) items.push({ title: 'Roof', value: str(snap.roof) });
    if (snap.lotSize ?? snap.lot_size) items.push({ title: 'Lot Size', value: str(snap.lotSize ?? snap.lot_size) });
    if (snap.taxAssessedValue ?? snap.tax_assessed_value) items.push({ title: 'Tax Assessed Value', value: str(snap.taxAssessedValue ?? snap.tax_assessed_value) });
    if (snap.annualTax ?? snap.annual_tax) items.push({ title: 'Annual Tax', value: str(snap.annualTax ?? snap.annual_tax) });
    if (snap.hoa) items.push({ title: 'HOA', value: str(snap.hoa) });
    if (snap.pricePerSqft ?? snap.price_per_sqft) items.push({ title: 'Price/Sqft', value: str(snap.pricePerSqft ?? snap.price_per_sqft) });
    if (snap.region) items.push({ title: 'Region', value: str(snap.region) });
    if (items.length > 0) {
      sections.push({ id: 'property-snapshot', title: 'Property Snapshot', items });
    }
  }

  // price_assessment
  const price = result.price_assessment ?? result.priceAssessment ?? {};
  if (Object.keys(price).length > 0) {
    const items: ReportSection['items'] = [];
    if (price.estimated_min ?? price.estimatedMin) {
      items.push({ title: 'Est. Min', value: price.estimated_min ?? price.estimatedMin });
    }
    if (price.estimated_max ?? price.estimatedMax) {
      items.push({ title: 'Est. Max', value: price.estimated_max ?? price.estimatedMax });
    }
    if (price.asking_price ?? price.askingPrice) {
      items.push({ title: 'Asking Price', value: str(price.asking_price ?? price.askingPrice) });
    }
    if (price.valuation_confidence ?? price.valuationConfidence) {
      items.push({
        title: 'Confidence',
        value: str(price.valuation_confidence ?? price.valuationConfidence),
        badge: str(price.valuation_confidence ?? price.valuationConfidence),
      });
    }
    if (price.verdict) items.push({ title: 'Verdict', value: price.verdict });
    if (price.explanation) items.push({ title: 'Analysis', description: price.explanation });
    if (price.tax_context ?? price.taxContext) items.push({ title: 'Tax Context', description: price.tax_context ?? price.taxContext });
    if (price.price_per_sqft_context ?? price.pricePerSqftContext) {
      items.push({ title: 'Price/Sqft Context', description: price.price_per_sqft_context ?? price.pricePerSqftContext });
    }
    if (price.missing_data?.length) {
      items.push({ title: 'Missing Data', description: price.missing_data.join(', ') });
    }
    if (items.length > 0) {
      sections.push({ id: 'price-assessment', title: 'Price Assessment', subtitle: 'Estimated value range', items });
    }
  }

  // carrying_costs
  const costs = result.carrying_costs ?? result.carryingCosts ?? {};
  if (Object.keys(costs).length > 0) {
    const items: ReportSection['items'] = [];
    if (costs.annual_tax ?? costs.annualTax) {
      items.push({ title: 'Annual Tax', value: str(costs.annual_tax ?? costs.annualTax) });
    }
    if (costs.monthly_tax_equivalent ?? costs.monthlyTaxEquivalent) {
      items.push({ title: 'Monthly Tax', value: str(costs.monthly_tax_equivalent ?? costs.monthlyTaxEquivalent) });
    }
    if (costs.hoa) items.push({ title: 'HOA', value: str(costs.hoa) });
    if (costs.cost_pressure ?? costs.costPressure) {
      const level = str(costs.cost_pressure ?? costs.costPressure);
      items.push({ title: 'Cost Pressure', value: level, badge: level });
    }
    if (costs.summary) items.push({ title: 'Summary', description: costs.summary });
    if (costs.missing_costs?.length) {
      items.push({ title: 'Missing Costs', description: costs.missing_costs.join(', ') });
    }
    if (items.length > 0) {
      sections.push({ id: 'carrying-costs', title: 'Carrying Costs', subtitle: 'Tax, HOA, and ongoing costs', items });
    }
  }

  // investment_potential
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  if (Object.keys(invest).length > 0) {
    const items: ReportSection['items'] = [];
    if (invest.rating) {
      const r = str(invest.rating);
      items.push({ title: 'Rating', value: r, badge: r });
    }
    if (invest.estimated_monthly_rent ?? invest.estimatedMonthlyRent) {
      items.push({
        title: 'Est. Monthly Rent',
        value: str(invest.estimated_monthly_rent ?? invest.estimatedMonthlyRent),
      });
    }
    if (invest.summary) items.push({ title: 'Summary', description: invest.summary });
    const signals = invest.supporting_signals ?? invest.supportingSignals ?? [];
    if (signals.length) items.push(...textItems(signals).map((i) => ({ ...i, title: 'Signal', description: i.description })));
    if (invest.risks?.length) items.push(...textItems(invest.risks).map((i) => ({ ...i, title: 'Risk', description: i.description })));
    if (invest.things_to_verify?.length) {
      items.push(...textItems(invest.things_to_verify).map((i) => ({ ...i, title: 'Verify', description: i.description })));
    }
    if (items.length > 0) {
      sections.push({ id: 'investment-potential', title: 'Investment Potential', items });
    }
  }

  // maintenance_risk
  const maint = result.maintenance_risk ?? result.maintenanceRisk ?? {};
  if (Object.keys(maint).length > 0) {
    const items: ReportSection['items'] = [];
    if (maint.rating) {
      const r = str(maint.rating);
      const sev = riskSeverity(r);
      items.push({ title: 'Risk Level', value: r, severity: sev, badge: r });
    }
    if (maint.summary) items.push({ title: 'Summary', description: maint.summary });
    if (maint.risk_factors?.length) items.push(...textItems(maint.risk_factors).map((i) => ({ ...i, title: 'Risk Factor', description: i.description })));
    if (maint.inspection_priorities?.length) {
      items.push(...textItems(maint.inspection_priorities).map((i) => ({ ...i, title: 'Inspection Priority', description: i.description })));
    }
    if (items.length > 0) {
      sections.push({ id: 'maintenance-risk', title: 'Maintenance Risk', subtitle: 'Age, systems, and upkeep', items });
    }
  }

  // legal_compliance
  const legal = result.legal_compliance ?? result.legalCompliance ?? {};
  if (Object.keys(legal).length > 0) {
    const items: ReportSection['items'] = [];
    if (legal.risk_level ?? legal.riskLevel) {
      const r = str(legal.risk_level ?? legal.riskLevel);
      items.push({ title: 'Risk Level', value: r, badge: r });
    }
    if (legal.summary) items.push({ title: 'Summary', description: legal.summary });
    if (legal.items_to_verify?.length) {
      items.push(...textItems(legal.items_to_verify).map((i) => ({ ...i, title: 'Verify', description: i.description })));
    }
    if (legal.external_sources_needed?.length) {
      items.push(...textItems(legal.external_sources_needed).map((i) => ({ ...i, title: 'Data Needed', description: i.description })));
    }
    if (items.length > 0) {
      sections.push({ id: 'legal-compliance', title: 'Legal & Compliance', items });
    }
  }

  // environmental_risk
  const env = result.environmental_risk ?? result.environmentalRisk ?? {};
  if (Object.keys(env).length > 0) {
    const items: ReportSection['items'] = [];
    if (env.risk_level ?? env.riskLevel) {
      const r = str(env.risk_level ?? env.riskLevel);
      items.push({ title: 'Risk Level', value: r, badge: r });
    }
    if (env.summary) items.push({ title: 'Summary', description: env.summary });
    if (env.items_to_check?.length) {
      items.push(...textItems(env.items_to_check).map((i) => ({ ...i, title: 'Check', description: i.description })));
    }
    if (items.length > 0) {
      sections.push({ id: 'environmental-risk', title: 'Environmental Risk', items });
    }
  }

  // listing_language_reality_check
  const reality = result.listing_language_reality_check ?? result.listingLanguageRealityCheck ?? [];
  if (reality.length > 0) {
    const items: ReportSection['items'] = reality.map((item: any) => ({
      title: str(item.phrase ?? item.title ?? ''),
      description: str(item.what_it_may_mean ?? item.description ?? ''),
      badge: item.what_to_verify ? 'Verify' : undefined,
    })).filter((i) => i.title);
    if (items.length > 0) {
      sections.push({ id: 'listing-reality-check', title: 'Listing Reality Check', subtitle: 'What the listing language really means', items });
    }
  }

  // neighborhood_lifestyle
  const neigh = result.neighborhood_lifestyle ?? result.neighborhoodLifestyle ?? {};
  if (Object.keys(neigh).length > 0) {
    const items: ReportSection['items'] = [];
    if (neigh.summary) items.push({ title: 'Summary', description: neigh.summary });
    if (neigh.page_signals?.length) {
      items.push(...textItems(neigh.page_signals).map((i) => ({ ...i, title: 'Signal', description: i.description })));
    }
    if (neigh.external_data_needed?.length) {
      items.push(...textItems(neigh.external_data_needed).map((i) => ({ ...i, title: 'Data Needed', description: i.description })));
    }
    if (items.length > 0) {
      sections.push({ id: 'neighborhood', title: 'Neighborhood', items });
    }
  }

  // data_gaps
  const gaps = result.data_gaps ?? result.dataGaps ?? [];
  if (gaps.length > 0) {
    const items: ReportSection['items'] = gaps.map((item: any) => ({
      title: str(item.missing_item ?? item.title ?? ''),
      description: str(item.why_it_matters ?? item.whyItMatters ?? item.description ?? ''),
      badge: item.suggested_source ? str(item.suggested_source) : undefined,
    })).filter((i) => i.title);
    if (items.length > 0) {
      sections.push({ id: 'data-gaps', title: 'Data Gaps', subtitle: 'Missing information to verify', items });
    }
  }

  // layout_fit
  const layout = result.layout_fit ?? result.layoutFit ?? {};
  if (Object.keys(layout).length > 0) {
    const items: ReportSection['items'] = [];
    if (layout.summary) items.push({ title: 'Summary', description: layout.summary });
    const bestFor = layout.best_for ?? layout.bestFor ?? [];
    if (bestFor.length) items.push({ title: 'Best For', description: bestFor.join('; ') });
    const notIdeal = layout.not_ideal_for ?? layout.notIdealFor ?? [];
    if (notIdeal.length) items.push({ title: 'Not Ideal For', description: notIdeal.join('; ') });
    if (items.length > 0) {
      sections.push({ id: 'layout-fit', title: 'Layout Fit', subtitle: 'Space and layout suitability', items });
    }
  }

  // questions_to_ask
  const questions = result.questions_to_ask ?? result.questionsToAsk ?? [];
  if (questions.length > 0) {
    const items: ReportSection['items'] = textItems(questions).map((i) => ({ ...i, title: i.title }));
    sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', subtitle: 'Before you make an offer', items });
  }

  return sections;
}

// ---- main adapter ----
export function normalizeUSSaleReport(result: USSaleResult): NormalizedReport {
  const hero = buildHero(result);
  const highlights = buildHighlights(result);
  const quickFacts = buildQuickFacts(result);
  const sections = buildSections(result);

  return {
    meta: {
      market: 'US',
      reportMode: 'sale',
      source: str(result.source ?? result.listingInfo?.source ?? ''),
      sourceDomain: str(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic: false,
    },
    hero,
    highlights,
    quickFacts,
    sections,
    raw: result,
  };
}
