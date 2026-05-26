// ===== Generic / Basic Adapter =====
// 兜底适配器：处理 Basic result 和未知结构
// 尽可能从可用字段构建最小 NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection } from './types';

type AnyResult = any;

function str(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  return String(val);
}

function num(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ---- hero ----
function buildHero(result: AnyResult, isBasic: boolean): HeroData {
  // Basic result fields
  if (isBasic || result.analysisType === 'basic') {
    const score = num(result.overallScore ?? result.overall_score ?? null);
    const verdict = str(result.decision ?? result.verdict ?? '');
    const summary = str(result.textAnalysis ?? result.summary ?? result.quickSummary ?? result.quick_summary ?? '');
    const address = str(result.listingOverview?.address ?? result.address ?? '');

    return {
      title: str(result.listingOverview?.title ?? result.title ?? ''),
      address: address || undefined,
      score,
      verdict: verdict || (score !== null ? 'Not enough data' : 'No verdict available'),
      summary: summary || undefined,
    };
  }

  // Full generic result
  const score = num(result.overallScore ?? result.overall_score ?? null);
  const verdict = str(result.verdict ?? result.overall_verdict ?? '');
  const summary = str(result.quickSummary ?? result.quick_summary ?? result.summary ?? result.quick_summary ?? '');
  const confidence = str(result.confidenceLevel ?? result.confidence_level ?? '');
  const address = str(result.listingInfo?.address ?? result.address ?? '');
  const title = str(result.listingInfo?.title ?? result.title ?? '');

  return {
    title: title || undefined,
    address: address || undefined,
    score,
    verdict: verdict || (score !== null ? 'Not enough data' : 'No verdict available'),
    confidence: confidence || undefined,
    summary: summary || undefined,
  };
}

// ---- quick facts ----
function buildQuickFacts(result: AnyResult): QuickFact[] {
  const facts: QuickFact[] = [];

  // Try different sources for listing info
  const info = result.listingInfo ?? result.listingOverview ?? {};

  const beds = info.bedrooms ?? result.bedrooms ?? null;
  if (beds !== null && beds !== undefined) facts.push({ label: 'Beds', value: str(beds) });

  const baths = info.bathrooms ?? result.bathrooms ?? null;
  if (baths !== null && baths !== undefined) facts.push({ label: 'Baths', value: str(baths) });

  const parking = info.parking ?? result.parking ?? null;
  if (parking !== null && parking !== undefined) facts.push({ label: 'Parking', value: str(parking) });

  const price = info.price ?? result.price ?? null;
  if (price) facts.push({ label: 'Price', value: str(price) });

  const weeklyRent = info.weeklyRent ?? result.weeklyRent ?? null;
  if (weeklyRent) facts.push({ label: 'Rent/wk', value: str(weeklyRent) });

  const propType = info.propertyType ?? result.propertyType ?? null;
  if (propType) facts.push({ label: 'Type', value: str(propType) });

  const sqft = info.sqft ?? result.sqft ?? null;
  if (sqft) facts.push({ label: 'Sqft', value: str(sqft) });

  return facts;
}

// ---- highlights ----
function buildHighlights(result: AnyResult): HighlightsData {
  const pros = [
    ...(Array.isArray(result.whatLooksGood) ? result.whatLooksGood : []),
    ...(Array.isArray(result.pros) ? result.pros : []),
  ];
  const cons = Array.isArray(result.cons) ? result.cons : [];
  const risks = [
    ...(Array.isArray(result.riskSignals) ? result.riskSignals : []),
    ...(Array.isArray(result.risks) ? result.risks : []),
    ...(Array.isArray(result.hidden_risks) ? result.hidden_risks : []),
    ...(Array.isArray(result.hiddenRisks) ? result.hiddenRisks : []),
    ...(Array.isArray(result.red_flags) ? result.red_flags : []),
    ...(Array.isArray(result.redFlags) ? result.redFlags : []),
  ];
  return { pros, cons, risks };
}

// ---- helpers ----
function textItems(arr: any[]): Array<{ title: string; description?: string }> {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === 'string') return { title: item };
      return {
        title: str(item.title ?? item.phrase ?? item.keyword ?? ''),
        description: str(item.description ?? item.message ?? item.action ?? ''),
      };
    })
    .filter((i) => i.title);
}

// ---- build sections ----
function buildSections(result: AnyResult, isBasic: boolean): ReportSection[] {
  const sections: ReportSection[] = [];

  // Basic result: show a Summary section
  if (isBasic) {
    const summaryItems: ReportSection['items'] = [];
    if (result.listingOverview) {
      const lo = result.listingOverview;
      if (lo.address) summaryItems.push({ title: 'Address', value: str(lo.address) });
      if (lo.price) summaryItems.push({ title: 'Price', value: str(lo.price) });
      if (lo.bedrooms) summaryItems.push({ title: 'Beds', value: str(lo.bedrooms) });
      if (lo.bathrooms) summaryItems.push({ title: 'Baths', value: str(lo.bathrooms) });
    }
    if (result.textAnalysis) summaryItems.push({ title: 'Analysis', description: str(result.textAnalysis) });
    if (result.decision) summaryItems.push({ title: 'Decision', value: str(result.decision) });
    if (result.upgradePrompt) summaryItems.push({ title: 'Upgrade', description: str(result.upgradePrompt) });
    if (summaryItems.length > 0) {
      sections.push({ id: 'summary', title: 'Summary', items: summaryItems });
    }
  }

  // Generic sections from any available data

  // price_assessment
  const price = result.price_assessment ?? result.priceAssessment ?? {};
  if (Object.keys(price).length > 0) {
    const items: ReportSection['items'] = [];
    if (price.estimated_min ?? price.estimatedMin) items.push({ title: 'Est. Min', value: str(price.estimated_min ?? price.estimatedMin) });
    if (price.estimated_max ?? price.estimatedMax) items.push({ title: 'Est. Max', value: str(price.estimated_max ?? price.estimatedMax) });
    if (price.asking_price ?? price.askingPrice) items.push({ title: 'Asking Price', value: str(price.asking_price ?? price.askingPrice) });
    if (price.verdict) items.push({ title: 'Verdict', value: price.verdict });
    if (price.explanation) items.push({ title: 'Analysis', description: price.explanation });
    if (items.length > 0) {
      sections.push({ id: 'price-assessment', title: 'Price Assessment', items });
    }
  }

  // rent_fairness
  const fair = result.rent_fairness ?? result.rentFairness ?? {};
  if (Object.keys(fair).length > 0) {
    const items: ReportSection['items'] = [];
    if (fair.estimated_min ?? fair.estimatedMin) items.push({ title: 'Est. Min', value: str(fair.estimated_min ?? fair.estimatedMin) });
    if (fair.estimated_max ?? fair.estimatedMax) items.push({ title: 'Est. Max', value: str(fair.estimated_max ?? fair.estimatedMax) });
    if (fair.listing_price ?? fair.listingPrice) items.push({ title: 'Listing Price', value: str(fair.listing_price ?? fair.listingPrice) });
    if (fair.verdict) items.push({ title: 'Verdict', value: fair.verdict });
    if (fair.explanation) items.push({ title: 'Analysis', description: fair.explanation });
    if (items.length > 0) {
      sections.push({ id: 'rent-fairness', title: 'Rent Fairness', items });
    }
  }

  // investment_potential
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  if (Object.keys(invest).length > 0) {
    const items: ReportSection['items'] = [];
    if (invest.rating ?? invest.growth_outlook) {
      items.push({ title: 'Outlook', value: str(invest.rating ?? invest.growth_outlook) });
    }
    if (invest.rental_yield_estimate) items.push({ title: 'Est. Yield', value: str(invest.rental_yield_estimate) });
    if (invest.capital_growth_5yr) items.push({ title: 'Growth 5yr', value: str(invest.capital_growth_5yr) });
    if (invest.summary) items.push({ title: 'Summary', description: invest.summary });
    if (items.length > 0) {
      sections.push({ id: 'investment-potential', title: 'Investment Potential', items });
    }
  }

  // space_analysis
  const space = result.spaceAnalysis ?? result.space_analysis ?? {};
  const spaceData = space.spaceAnalysis ?? space.space_analysis ?? [];
  if (spaceData.length > 0) {
    const items: ReportSection['items'] = spaceData.map((room: any) => ({
      title: str(room.spaceType ?? room.room ?? ''),
      value: room.score != null ? `${room.score}/10` : undefined,
      description: str(room.explanation ?? ''),
    }));
    sections.push({ id: 'space-analysis', title: 'Space & Layout', items });
  }

  // competition_risk
  const comp = result.competitionRisk ?? result.competition_risk ?? {};
  if (Object.keys(comp).length > 0) {
    const items: ReportSection['items'] = [];
    if (comp.level) {
      const l = str(comp.level);
      items.push({ title: 'Competition Level', value: l, badge: l });
    }
    if (comp.reasons?.length) {
      items.push(...textItems(comp.reasons).map((i) => ({ ...i, title: 'Reason' })));
    }
    if (items.length > 0) {
      sections.push({ id: 'competition-risk', title: 'Competition Risk', items });
    }
  }

  // questions_to_ask
  const questions = result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions ?? [];
  if (questions.length > 0) {
    const items: ReportSection['items'] = textItems(questions);
    sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', items });
  }

  return sections;
}

// ---- main adapter ----
export function normalizeGenericReport(result: AnyResult): NormalizedReport {
  const isBasic = result.analysisType === 'basic' || ('decision' in result && result.decision !== undefined);

  return {
    meta: {
      market: 'UNKNOWN',
      reportMode: str(result.reportMode ?? result.report_mode ?? result.analysisType ?? 'unknown') as any,
      source: str(result.source ?? ''),
      sourceDomain: str(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic,
    },
    hero: buildHero(result, isBasic),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result, isBasic),
    raw: result,
  };
}
