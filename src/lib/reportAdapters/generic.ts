// ===== Generic / Basic Adapter =====
// 兜底适配器：处理 Basic result 和未知结构

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem } from './types';

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
        const description = toText(obj.description ?? obj.message ?? obj.action ?? obj.reason ?? '');
        if (!title && !description) return null;
        return { title: title || description, description: description || title, badge: opts?.badge, severity: opts?.severity } as SectionItem;
      }
      return null;
    })
    .filter(Boolean) as SectionItem[];
}

function severityOf(level: string | undefined): 'low' | 'medium' | 'high' | undefined {
  if (!level) return undefined;
  const l = level.toUpperCase();
  if (l === 'LOW') return 'low';
  if (l === 'MEDIUM' || l === 'MODERATE') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
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
      verdict: toText(result.decision ?? result.verdict ?? 'Not enough data'),
      confidence: undefined,
      summary: toText(result.textAnalysis ?? result.summary ?? result.quickSummary ?? result.quick_summary ?? ''),
      primaryLabel: undefined,
      secondaryLabel: undefined,
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
  add('Type', info.propertyType ?? result.propertyType);
  add('Sqft', info.sqft ?? result.sqft);
  return facts;
}

// ── highlights ────────────────────────────────────────────────────────────────

function buildHighlights(result: AnyResult): HighlightsData {
  const stringArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    pros: stringArr(result.whatLooksGood).concat(stringArr(result.pros)),
    cons: stringArr(result.cons),
    risks: [
      ...stringArr(result.riskSignals),
      ...stringArr(result.risks),
      ...stringArr(result.hidden_risks),
      ...stringArr(result.hiddenRisks),
      ...stringArr(result.red_flags),
      ...stringArr(result.redFlags),
    ],
  };
}

// ── build sections ────────────────────────────────────────────────────────────

function buildSections(result: AnyResult, isBasic: boolean): ReportSection[] {
  const sections: ReportSection[] = [];

  if (isBasic) {
    const summaryItems: SectionItem[] = [];
    if (result.listingOverview) {
      const lo = result.listingOverview;
      if (lo.address) summaryItems.push({ title: 'Address', value: toText(lo.address) });
      if (lo.price) summaryItems.push({ title: 'Price', value: toText(lo.price) });
      if (lo.bedrooms) summaryItems.push({ title: 'Beds', value: toText(lo.bedrooms) });
      if (lo.bathrooms) summaryItems.push({ title: 'Baths', value: toText(lo.bathrooms) });
    }
    if (result.textAnalysis) summaryItems.push({ title: 'Analysis', description: toText(result.textAnalysis) });
    if (result.decision) summaryItems.push({ title: 'Decision', value: toText(result.decision) });
    if (result.upgradePrompt) summaryItems.push({ title: 'Upgrade', description: toText(result.upgradePrompt) });
    if (summaryItems.length > 0) sections.push({ id: 'summary', title: 'Summary', items: summaryItems });
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
  if (qItems.length > 0) sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', items: qItems });

  return sections;
}

// ── main adapter ──────────────────────────────────────────────────────────────

export function normalizeGenericReport(result: AnyResult): NormalizedReport {
  const isBasic = result.analysisType === 'basic' || ('decision' in result && result.decision !== undefined);

  return {
    meta: {
      market: 'UNKNOWN',
      reportMode: (() => {
        const m = result.reportMode ?? result.report_mode ?? result.analysisType ?? 'unknown';
        return toText(m) as 'sale' | 'rent' | 'unknown';
      })(),
      source: toText(result.source ?? ''),
      sourceDomain: toText(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic,
    },
    hero: buildHero(result, isBasic),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result, isBasic),
    raw: result,
  };
}
