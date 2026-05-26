// ===== AU Sale Adapter =====
// 转换 AU Sale 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem } from './types';

type AUSaleResult = any;

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
        const description = toText(obj.description ?? obj.what_it_may_mean ?? obj.message ?? obj.action ?? obj.reason ?? '');
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
  if (l === 'MODERATE' || l === 'MEDIUM') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
}

// ── hero ─────────────────────────────────────────────────────────────────────

function buildHero(result: AUSaleResult): HeroData {
  const nextMove = result.next_move ?? result.nextMove;
  return {
    title: toText(result.listingInfo?.title ?? result.title ?? ''),
    address: toText(result.listingInfo?.address ?? result.address ?? ''),
    score: (() => {
      const v = result.overallScore ?? result.overall_score;
      return v != null && v !== '' ? Number(v) || null : null;
    })(),
    verdict: toText(
      result.verdict ??
      result.finalRecommendation?.verdict ??
      result.recommendation?.verdict ??
      'Not enough data'
    ),
    confidence: toText(result.confidenceLevel ?? result.confidence_level ?? ''),
    summary: toText(
      result.quickSummary ??
      result.quick_summary ??
      result.finalRecommendation?.reason ??
      result.recommendation?.reason ??
      result.summary ??
      ''
    ),
    primaryLabel: toText(nextMove?.headline ?? ''),
    secondaryLabel: toText(nextMove?.suggested_actions?.[0] ?? ''),
  };
}

// ── quick facts ───────────────────────────────────────────────────────────────

function buildQuickFacts(result: AUSaleResult): QuickFact[] {
  const info = result.listingInfo ?? {};
  const facts: QuickFact[] = [];
  const add = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) facts.push({ label, value: t });
  };
  add('Beds', info.bedrooms ?? result.bedrooms);
  add('Baths', info.bathrooms ?? result.bathrooms);
  add('Parking', info.parking ?? result.parking);
  add('Price', info.price ?? result.price);
  add('Type', info.propertyType ?? result.propertyType);
  const costs = result.holding_costs ?? result.holdingCosts ?? {};
  add('20% Deposit', costs.deposit20pct);
  add('Stamp Duty', costs.stampDuty);
  add('Repayment', costs.estimatedMonthlyRepayment);
  const land = result.land_value_analysis ?? result.landValueAnalysis ?? {};
  if (land.landSize) add('Land', `${toText(land.landSize)} sqm`);
  if (land.pricePerSqm) add('$/sqm', toText(land.pricePerSqm));
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  if (invest.rental_yield_estimate ?? invest.rentalYieldEstimate) add('Yield', toText(invest.rental_yield_estimate ?? invest.rentalYieldEstimate));
  if (invest.capital_growth_5yr ?? invest.capitalGrowth5yr) add('Growth 5yr', toText(invest.capital_growth_5yr ?? invest.capitalGrowth5yr));
  return facts;
}

// ── highlights ───────────────────────────────────────────────────────────────

function buildHighlights(result: AUSaleResult): HighlightsData {
  const stringArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    pros: stringArr(result.whatLooksGood).concat(stringArr(result.pros)),
    cons: stringArr(result.cons),
    risks: [
      ...stringArr(result.riskSignals),
      ...stringArr(result.risks),
      ...stringArr(result.hidden_risks),
      ...stringArr(result.hiddenRisks),
    ],
  };
}

// ── build sections ────────────────────────────────────────────────────────────

function buildSections(result: AUSaleResult): ReportSection[] {
  const sections: ReportSection[] = [];

  // ── deal_breakers ──────────────────────────────────────────────────────────
  const dealBreakers = result.deal_breakers ?? result.dealBreakers ?? {};
  if (Object.keys(dealBreakers).length > 0) {
    const items: SectionItem[] = [];
    if (dealBreakers.summary) items.push({ title: 'Summary', description: toText(dealBreakers.summary) });
    const sev = toText(dealBreakers.overall_severity ?? dealBreakers.overallSeverity);
    if (sev) items.push({ title: 'Overall Severity', value: sev, severity: severityOf(sev), badge: sev });
    const dealItems = Array.isArray(dealBreakers.items) ? dealBreakers.items : [];
    for (const item of dealItems) {
      const s = toText(item.severity ?? '');
      items.push({
        title: toText(item.title ?? ''),
        description: toText(item.description ?? ''),
        severity: severityOf(s),
        badge: s || undefined,
      });
    }
    if (items.length > 0) sections.push({ id: 'deal-breakers', title: 'Deal Breakers', subtitle: 'Critical issues that may prevent purchase', tone: 'danger', items });
  }

  // ── price_assessment ───────────────────────────────────────────────────────
  const price = result.price_assessment ?? result.priceAssessment ?? {};
  const priceItems: SectionItem[] = [];
  if (price.estimated_min ?? price.estimatedMin) priceItems.push({ title: 'Est. Min', value: toText(price.estimated_min ?? price.estimatedMin) });
  if (price.estimated_max ?? price.estimatedMax) priceItems.push({ title: 'Est. Max', value: toText(price.estimated_max ?? price.estimatedMax) });
  if (price.asking_price ?? price.askingPrice) priceItems.push({ title: 'Asking Price', value: toText(price.asking_price ?? price.askingPrice) });
  if (price.valuation_confidence ?? price.valuationConfidence) priceItems.push({ title: 'Confidence', value: toText(price.valuation_confidence ?? price.valuationConfidence) });
  if (price.verdict) priceItems.push({ title: 'Verdict', value: toText(price.verdict) });
  if (price.explanation) priceItems.push({ title: 'Analysis', description: toText(price.explanation) });
  if (priceItems.length > 0) sections.push({ id: 'price-assessment', title: 'Price Assessment', subtitle: 'Estimated value range', items: priceItems });

  // ── holding_costs ─────────────────────────────────────────────────────────
  const costs = result.holding_costs ?? result.holdingCosts ?? {};
  const costItems: SectionItem[] = [];
  if (costs.deposit20pct) costItems.push({ title: '20% Deposit', value: toText(costs.deposit20pct) });
  if (costs.stampDuty) costItems.push({ title: 'Stamp Duty', value: toText(costs.stampDuty), badge: toText(costs.stampDutyState) || undefined });
  if (costs.transferFees) costItems.push({ title: 'Transfer Fees', value: toText(costs.transferFees) });
  if (costs.legalCosts) costItems.push({ title: 'Legal Costs', value: toText(costs.legalCosts) });
  if (costs.inspectionCosts) costItems.push({ title: 'Inspection', value: toText(costs.inspectionCosts) });
  if (costs.estimatedMonthlyRepayment) costItems.push({ title: 'Monthly Repayment', value: toText(costs.estimatedMonthlyRepayment) });
  if (costs.totalUpfrontCosts) costItems.push({ title: 'Total Upfront', value: toText(costs.totalUpfrontCosts) });
  if (costItems.length > 0) sections.push({ id: 'holding-costs', title: 'Holding Costs', subtitle: 'Upfront and ongoing costs', items: costItems });

  // ── land_value_analysis ────────────────────────────────────────────────────
  const land = result.land_value_analysis ?? result.landValueAnalysis ?? {};
  const landItems: SectionItem[] = [];
  if (land.landSize) landItems.push({ title: 'Land Size', value: `${toText(land.landSize)} sqm` });
  if (land.pricePerSqm) landItems.push({ title: 'Price/sqm', value: toText(land.pricePerSqm) });
  if (land.propertyType) landItems.push({ title: 'Property Type', value: toText(land.propertyType) });
  const scarcity = toText(land.scarcityIndicator);
  if (scarcity) landItems.push({ title: 'Scarcity', value: scarcity, badge: scarcity });
  if (land.landBankingPotential !== undefined) landItems.push({ title: 'Land Banking', value: land.landBankingPotential ? 'Yes' : 'No' });
  if (land.explanation) landItems.push({ title: 'Analysis', description: toText(land.explanation) });
  if (landItems.length > 0) sections.push({ id: 'land-value', title: 'Land Value Analysis', subtitle: 'Land vs property value', items: landItems });

  // ── investment_potential ────────────────────────────────────────────────────
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  const investItems: SectionItem[] = [];
  const outlook = invest.growth_outlook ?? invest.growthOutlook;
  if (outlook) {
    const t = toText(outlook);
    investItems.push({ title: 'Growth Outlook', value: t, badge: t });
  }
  if (invest.rental_yield_estimate ?? invest.rentalYieldEstimate) investItems.push({ title: 'Est. Yield', value: toText(invest.rental_yield_estimate ?? invest.rentalYieldEstimate) });
  if (invest.capital_growth_5yr ?? invest.capitalGrowth5yr) investItems.push({ title: 'Capital Growth 5yr', value: toText(invest.capital_growth_5yr ?? invest.capitalGrowth5yr) });
  const pos = Array.isArray(invest.key_positives ?? invest.keyPositives) ? invest.key_positives ?? invest.keyPositives : [];
  if (pos.length) investItems.push({ title: 'Key Positives', description: toText(pos) });
  const concerns = Array.isArray(invest.key_concerns ?? invest.keyConcerns) ? invest.key_concerns ?? invest.keyConcerns : [];
  if (concerns.length) investItems.push({ title: 'Key Concerns', description: toText(concerns) });
  if (investItems.length > 0) sections.push({ id: 'investment-potential', title: 'Investment Potential', items: investItems });

  // ── affordability_check ─────────────────────────────────────────────────────
  const afford = result.affordability_check ?? result.affordabilityCheck ?? {};
  const affordItems: SectionItem[] = [];
  if (afford.estimated_deposit_20pct ?? afford.estimatedDeposit20pct) affordItems.push({ title: '20% Deposit', value: toText(afford.estimated_deposit_20pct ?? afford.estimatedDeposit20pct) });
  if (afford.estimated_loan ?? afford.estimatedLoan) affordItems.push({ title: 'Est. Loan', value: toText(afford.estimated_loan ?? afford.estimatedLoan) });
  if (afford.estimated_monthly_repayment ?? afford.estimatedMonthlyRepayment) affordItems.push({ title: 'Monthly Repayment', value: toText(afford.estimated_monthly_repayment ?? afford.estimatedMonthlyRepayment) });
  if (afford.assessment) {
    const a = toText(afford.assessment);
    affordItems.push({ title: 'Assessment', value: a, badge: a });
  }
  if (afford.note) affordItems.push({ title: 'Note', description: toText(afford.note) });
  if (affordItems.length > 0) sections.push({ id: 'affordability', title: 'Affordability Check', items: affordItems });

  // ── space_analysis ─────────────────────────────────────────────────────────
  const space = result.spaceAnalysis ?? result.space_analysis ?? {};
  const spaceData = Array.isArray(space.spaceAnalysis ?? space.space_analysis) ? space.spaceAnalysis ?? space.space_analysis : [];
  const spaceItems: SectionItem[] = [];
  for (const room of spaceData) {
    const roomType = toText(room.spaceType ?? room.room ?? '');
    const score = room.score != null ? `${String(room.score)}/10` : '';
    const explanation = toText(room.explanation ?? (Array.isArray(room.observations) ? room.observations.join('; ') : ''));
    if (roomType || score || explanation) {
      spaceItems.push({ title: roomType, value: score || undefined, description: explanation || undefined });
    }
  }
  if (spaceItems.length > 0) sections.push({ id: 'space-analysis', title: 'Space & Layout', subtitle: 'Room-by-room analysis', items: spaceItems });

  // ── competition_risk ───────────────────────────────────────────────────────
  const comp = result.competitionRisk ?? result.competition_risk ?? {};
  const compItems: SectionItem[] = [];
  if (comp.level) {
    const l = toText(comp.level);
    compItems.push({ title: 'Competition Level', value: l, badge: l });
  }
  compItems.push(...objectItems(comp.reasons, { title: 'Reason' }));
  if (compItems.length > 0) sections.push({ id: 'competition-risk', title: 'Competition Risk', subtitle: 'How competitive is this property', items: compItems });

  // ── red_flag_alerts ────────────────────────────────────────────────────────
  const flags = Array.isArray(result.red_flag_alerts ?? result.redFlagAlerts) ? result.red_flag_alerts ?? result.redFlagAlerts : [];
  const flagItems: SectionItem[] = [];
  for (const flag of flags) {
    const sev = toText(flag.severity ?? '');
    flagItems.push({
      title: toText(flag.keyword ?? flag.title ?? ''),
      description: toText(flag.message ?? flag.description ?? ''),
      severity: severityOf(sev),
      badge: toText(flag.category ?? ''),
    });
  }
  if (flagItems.length > 0) sections.push({ id: 'red-flags', title: 'Red Flag Alerts', subtitle: 'Warning signals in the listing', tone: 'danger', items: flagItems });

  // ── state_specific_advice ─────────────────────────────────────────────────
  const state = result.state_specific_advice ?? result.stateSpecificAdvice ?? {};
  const stateItems: SectionItem[] = [];
  if (state.state) stateItems.push({ title: 'State', value: toText(state.state) });
  stateItems.push(...objectItems(state.recommendations, { title: 'Advice' }));
  if (stateItems.length > 0) sections.push({ id: 'state-advice', title: 'State-Specific Advice', subtitle: toText(state.state), items: stateItems });

  // ── would_i_buy ────────────────────────────────────────────────────────────
  const wouldBuy = result.would_i_buy ?? result.wouldIBuy ?? {};
  const buyItems: SectionItem[] = [];
  if (wouldBuy.answer) {
    const a = toText(wouldBuy.answer);
    buyItems.push({ title: 'Answer', value: a, badge: a });
  }
  if (wouldBuy.confidence) buyItems.push({ title: 'Confidence', value: toText(wouldBuy.confidence) });
  if (wouldBuy.reason) buyItems.push({ title: 'Reason', description: toText(wouldBuy.reason) });
  if (buyItems.length > 0) sections.push({ id: 'would-i-buy', title: 'Would I Buy This?', items: buyItems });

  // ── next_move ──────────────────────────────────────────────────────────────
  const nextMove = result.next_move ?? result.nextMove ?? {};
  const nextItems: SectionItem[] = [];
  if (nextMove.decision) {
    const d = toText(nextMove.decision);
    nextItems.push({ title: 'Decision', value: d, badge: d });
  }
  if (nextMove.headline) nextItems.push({ title: 'Headline', value: toText(nextMove.headline) });
  if (nextMove.reasoning) nextItems.push({ title: 'Reasoning', description: toText(nextMove.reasoning) });
  nextItems.push(...objectItems(nextMove.suggested_actions, { title: 'Action' }));
  if (nextItems.length > 0) sections.push({ id: 'next-move', title: 'Next Move', items: nextItems });

  // ── questions_to_ask ────────────────────────────────────────────────────────
  const questions = Array.isArray(result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions) ? result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions : [];
  const qItems = objectItems(questions, { title: 'Question' });
  if (qItems.length > 0) sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', subtitle: 'Before you make an offer', items: qItems });

  return sections;
}

// ── main adapter ──────────────────────────────────────────────────────────────

export function normalizeAUSaleReport(result: AUSaleResult): NormalizedReport {
  return {
    meta: {
      market: 'AU',
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
