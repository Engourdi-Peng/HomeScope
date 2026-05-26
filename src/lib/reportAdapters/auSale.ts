// ===== AU Sale Adapter =====
// 转换 AU Sale 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection } from './types';

type AUSaleResult = any;

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
function buildHero(result: AUSaleResult): HeroData {
  const score = num(result.overallScore ?? result.overall_score ?? null);
  const verdict = str(
    result.verdict ??
    result.finalRecommendation?.verdict ??
    result.recommendation?.verdict ??
    ''
  );
  const summary = str(
    result.quickSummary ??
    result.quick_summary ??
    result.finalRecommendation?.reason ??
    result.recommendation?.reason ??
    result.summary ??
    ''
  );
  const confidence = str(
    result.confidenceLevel ??
    result.confidence_level ??
    ''
  );
  const address = str(
    result.listingInfo?.address ??
    result.address ??
    ''
  );
  const title = str(result.listingInfo?.title ?? result.title ?? '');

  // next_move
  const nextMove = result.next_move ?? result.nextMove;
  const primaryLabel = nextMove?.headline ? str(nextMove.headline) : undefined;
  const secondaryLabel = nextMove?.suggested_actions?.[0] ? str(nextMove.suggested_actions[0]) : undefined;

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
function buildQuickFacts(result: AUSaleResult): QuickFact[] {
  const facts: QuickFact[] = [];

  const info = result.listingInfo ?? {};
  const beds = info.bedrooms ?? result.bedrooms ?? null;
  if (beds !== null && beds !== undefined) facts.push({ label: 'Beds', value: str(beds) });

  const baths = info.bathrooms ?? result.bathrooms ?? null;
  if (baths !== null && baths !== undefined) facts.push({ label: 'Baths', value: str(baths) });

  const parking = info.parking ?? result.parking ?? null;
  if (parking !== null && parking !== undefined) facts.push({ label: 'Parking', value: str(parking) });

  const price = info.price ?? result.price ?? null;
  if (price) facts.push({ label: 'Price', value: str(price) });

  const propType = info.propertyType ?? result.propertyType ?? null;
  if (propType) facts.push({ label: 'Type', value: str(propType) });

  // holding_costs (AU-specific)
  const costs = result.holding_costs ?? result.holdingCosts ?? {};
  if (costs.deposit20pct) facts.push({ label: '20% Deposit', value: str(costs.deposit20pct) });
  if (costs.stampDuty) facts.push({ label: 'Stamp Duty', value: str(costs.stampDuty) });
  if (costs.estimatedMonthlyRepayment) facts.push({ label: 'Repayment', value: str(costs.estimatedMonthlyRepayment) });

  // land_value_analysis
  const land = result.land_value_analysis ?? result.landValueAnalysis ?? {};
  if (land.landSize) facts.push({ label: 'Land', value: `${str(land.landSize)} sqm` });
  if (land.pricePerSqm) facts.push({ label: '$/sqm', value: str(land.pricePerSqm) });

  // investment
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  if (invest.rental_yield_estimate ?? invest.rentalYieldEstimate) {
    facts.push({ label: 'Yield', value: str(invest.rental_yield_estimate ?? invest.rentalYieldEstimate) });
  }
  if (invest.capital_growth_5yr ?? invest.capitalGrowth5yr) {
    facts.push({ label: 'Growth 5yr', value: str(invest.capital_growth_5yr ?? invest.capitalGrowth5yr) });
  }

  return facts;
}

// ---- highlights ----
function buildHighlights(result: AUSaleResult): HighlightsData {
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

function severityFrom(level: string | undefined): 'low' | 'medium' | 'high' | 'critical' | undefined {
  if (!level) return undefined;
  const l = level.toUpperCase();
  if (l === 'LOW') return 'low';
  if (l === 'MODERATE') return 'medium';
  if (l === 'MEDIUM') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
}

// ---- sections ----
function buildSections(result: AUSaleResult): ReportSection[] {
  const sections: ReportSection[] = [];

  // deal_breakers
  const dealBreakers = result.deal_breakers ?? result.dealBreakers ?? {};
  if (Object.keys(dealBreakers).length > 0) {
    const items: ReportSection['items'] = [];
    if (dealBreakers.summary) items.push({ title: 'Summary', description: dealBreakers.summary });
    if (dealBreakers.overall_severity ?? dealBreakers.overallSeverity) {
      const sev = str(dealBreakers.overall_severity ?? dealBreakers.overallSeverity);
      items.push({ title: 'Overall Severity', value: sev, severity: severityFrom(sev), badge: sev });
    }
    const dealItems = dealBreakers.items ?? dealBreakers.items ?? [];
    for (const item of dealItems) {
      const sev = str(item.severity ?? '');
      items.push({
        title: str(item.title ?? ''),
        description: str(item.description ?? ''),
        severity: severityFrom(sev),
        badge: sev,
      });
    }
    if (items.length > 0) {
      sections.push({
        id: 'deal-breakers',
        title: 'Deal Breakers',
        subtitle: 'Critical issues that may prevent purchase',
        tone: 'danger',
        items,
      });
    }
  }

  // price_assessment
  const price = result.price_assessment ?? result.priceAssessment ?? {};
  if (Object.keys(price).length > 0) {
    const items: ReportSection['items'] = [];
    if (price.estimated_min ?? price.estimatedMin) items.push({ title: 'Est. Min', value: str(price.estimated_min ?? price.estimatedMin) });
    if (price.estimated_max ?? price.estimatedMax) items.push({ title: 'Est. Max', value: str(price.estimated_max ?? price.estimatedMax) });
    if (price.asking_price ?? price.askingPrice) items.push({ title: 'Asking Price', value: str(price.asking_price ?? price.askingPrice) });
    if (price.valuation_confidence ?? price.valuationConfidence) {
      items.push({ title: 'Confidence', value: str(price.valuation_confidence ?? price.valuationConfidence) });
    }
    if (price.verdict) items.push({ title: 'Verdict', value: price.verdict });
    if (price.explanation) items.push({ title: 'Analysis', description: price.explanation });
    if (items.length > 0) {
      sections.push({ id: 'price-assessment', title: 'Price Assessment', subtitle: 'Estimated value range', items });
    }
  }

  // holding_costs
  const costs = result.holding_costs ?? result.holdingCosts ?? {};
  if (Object.keys(costs).length > 0) {
    const items: ReportSection['items'] = [];
    if (costs.deposit20pct) items.push({ title: '20% Deposit', value: str(costs.deposit20pct) });
    if (costs.stampDuty) {
      items.push({
        title: 'Stamp Duty',
        value: str(costs.stampDuty),
        badge: costs.stampDutyState ? str(costs.stampDutyState) : undefined,
      });
    }
    if (costs.transferFees) items.push({ title: 'Transfer Fees', value: str(costs.transferFees) });
    if (costs.legalCosts) items.push({ title: 'Legal Costs', value: str(costs.legalCosts) });
    if (costs.inspectionCosts) items.push({ title: 'Inspection', value: str(costs.inspectionCosts) });
    if (costs.estimatedMonthlyRepayment) items.push({ title: 'Monthly Repayment', value: str(costs.estimatedMonthlyRepayment) });
    if (costs.totalUpfrontCosts) items.push({ title: 'Total Upfront', value: str(costs.totalUpfrontCosts) });
    if (costs.cashFlowAnalysis) {
      const cf = costs.cashFlowAnalysis;
      if (cf.verdict) items.push({ title: 'Cash Flow', value: str(cf.verdict) });
    }
    if (items.length > 0) {
      sections.push({ id: 'holding-costs', title: 'Holding Costs', subtitle: 'Upfront and ongoing costs', items });
    }
  }

  // land_value_analysis
  const land = result.land_value_analysis ?? result.landValueAnalysis ?? {};
  if (Object.keys(land).length > 0) {
    const items: ReportSection['items'] = [];
    if (land.landSize) items.push({ title: 'Land Size', value: `${str(land.landSize)} sqm` });
    if (land.pricePerSqm) items.push({ title: 'Price/sqm', value: str(land.pricePerSqm) });
    if (land.propertyType) items.push({ title: 'Property Type', value: str(land.propertyType) });
    if (land.scarcityIndicator) {
      const si = str(land.scarcityIndicator);
      items.push({ title: 'Scarcity', value: si, badge: si });
    }
    if (land.landBankingPotential !== undefined) {
      items.push({ title: 'Land Banking', value: land.landBankingPotential ? 'Yes' : 'No' });
    }
    if (land.explanation) items.push({ title: 'Analysis', description: land.explanation });
    if (items.length > 0) {
      sections.push({ id: 'land-value', title: 'Land Value Analysis', subtitle: 'Land vs property value', items });
    }
  }

  // investment_potential
  const invest = result.investment_potential ?? result.investmentPotential ?? {};
  if (Object.keys(invest).length > 0) {
    const items: ReportSection['items'] = [];
    if (invest.growth_outlook ?? invest.growthOutlook) {
      const g = str(invest.growth_outlook ?? invest.growthOutlook);
      items.push({ title: 'Growth Outlook', value: g, badge: g });
    }
    if (invest.rental_yield_estimate ?? invest.rentalYieldEstimate) {
      items.push({ title: 'Est. Yield', value: str(invest.rental_yield_estimate ?? invest.rentalYieldEstimate) });
    }
    if (invest.capital_growth_5yr ?? invest.capitalGrowth5yr) {
      items.push({ title: 'Capital Growth 5yr', value: str(invest.capital_growth_5yr ?? invest.capitalGrowth5yr) });
    }
    const pos = invest.key_positives ?? invest.keyPositives ?? [];
    if (pos.length) items.push({ title: 'Key Positives', description: pos.join('; ') });
    const concerns = invest.key_concerns ?? invest.keyConcerns ?? [];
    if (concerns.length) items.push({ title: 'Key Concerns', description: concerns.join('; ') });
    if (items.length > 0) {
      sections.push({ id: 'investment-potential', title: 'Investment Potential', items });
    }
  }

  // affordability_check
  const afford = result.affordability_check ?? result.affordabilityCheck ?? {};
  if (Object.keys(afford).length > 0) {
    const items: ReportSection['items'] = [];
    if (afford.estimated_deposit_20pct ?? afford.estimatedDeposit20pct) {
      items.push({ title: '20% Deposit', value: str(afford.estimated_deposit_20pct ?? afford.estimatedDeposit20pct) });
    }
    if (afford.estimated_loan ?? afford.estimatedLoan) {
      items.push({ title: 'Est. Loan', value: str(afford.estimated_loan ?? afford.estimatedLoan) });
    }
    if (afford.estimated_monthly_repayment ?? afford.estimatedMonthlyRepayment) {
      items.push({ title: 'Monthly Repayment', value: str(afford.estimated_monthly_repayment ?? afford.estimatedMonthlyRepayment) });
    }
    if (afford.assessment) {
      const a = str(afford.assessment);
      items.push({ title: 'Assessment', value: a, badge: a });
    }
    if (afford.note) items.push({ title: 'Note', description: afford.note });
    if (items.length > 0) {
      sections.push({ id: 'affordability', title: 'Affordability Check', items });
    }
  }

  // space_analysis
  const space = result.spaceAnalysis ?? result.space_analysis ?? {};
  if (space.spaceAnalysis?.length ?? space.space_analysis?.length) {
    const roomData = space.spaceAnalysis ?? space.space_analysis ?? [];
    const items: ReportSection['items'] = roomData.map((room: any) => ({
      title: str(room.spaceType ?? room.room ?? ''),
      value: room.score != null ? `${room.score}/10` : undefined,
      description: str(room.explanation ?? room.observations?.join('; ') ?? ''),
    }));
    if (items.length > 0) {
      sections.push({ id: 'space-analysis', title: 'Space & Layout', subtitle: 'Room-by-room analysis', items });
    }
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
      sections.push({ id: 'competition-risk', title: 'Competition Risk', subtitle: 'How competitive is this property', items });
    }
  }

  // red_flag_alerts
  const flags = result.red_flag_alerts ?? result.redFlagAlerts ?? [];
  if (flags.length > 0) {
    const items: ReportSection['items'] = flags.map((flag: any) => {
      const sev = str(flag.severity ?? '');
      return {
        title: str(flag.keyword ?? flag.title ?? ''),
        description: str(flag.message ?? flag.description ?? ''),
        severity: severityFrom(sev),
        badge: str(flag.category ?? ''),
      };
    }).filter((i) => i.title);
    if (items.length > 0) {
      sections.push({ id: 'red-flags', title: 'Red Flag Alerts', subtitle: 'Warning signals in the listing', tone: 'danger', items });
    }
  }

  // state_specific_advice
  const state = result.state_specific_advice ?? result.stateSpecificAdvice ?? {};
  if (Object.keys(state).length > 0) {
    const items: ReportSection['items'] = [];
    if (state.state) items.push({ title: 'State', value: str(state.state) });
    if (state.recommendations?.length) {
      items.push(...textItems(state.recommendations).map((i) => ({ ...i, title: 'Advice' })));
    }
    if (items.length > 0) {
      sections.push({ id: 'state-advice', title: 'State-Specific Advice', subtitle: str(state.state), items });
    }
  }

  // would_i_buy
  const wouldBuy = result.would_i_buy ?? result.wouldIBuy ?? {};
  if (Object.keys(wouldBuy).length > 0) {
    const items: ReportSection['items'] = [];
    if (wouldBuy.answer) items.push({ title: 'Answer', value: str(wouldBuy.answer), badge: str(wouldBuy.answer) });
    if (wouldBuy.confidence) items.push({ title: 'Confidence', value: str(wouldBuy.confidence) });
    if (wouldBuy.reason) items.push({ title: 'Reason', description: wouldBuy.reason });
    if (items.length > 0) {
      sections.push({ id: 'would-i-buy', title: 'Would I Buy This?', items });
    }
  }

  // next_move
  const nextMove = result.next_move ?? result.nextMove ?? {};
  if (Object.keys(nextMove).length > 0) {
    const items: ReportSection['items'] = [];
    if (nextMove.decision) items.push({ title: 'Decision', value: str(nextMove.decision), badge: str(nextMove.decision) });
    if (nextMove.headline) items.push({ title: 'Headline', value: nextMove.headline });
    if (nextMove.reasoning) items.push({ title: 'Reasoning', description: nextMove.reasoning });
    if (nextMove.suggested_actions?.length) {
      items.push(...textItems(nextMove.suggested_actions).map((i) => ({ ...i, title: 'Action' })));
    }
    if (items.length > 0) {
      sections.push({ id: 'next-move', title: 'Next Move', items });
    }
  }

  // questions_to_ask
  const questions = result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions ?? [];
  if (questions.length > 0) {
    const items: ReportSection['items'] = textItems(questions);
    sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', subtitle: 'Before you make an offer', items });
  }

  return sections;
}

// ---- main adapter ----
export function normalizeAUSaleReport(result: AUSaleResult): NormalizedReport {
  return {
    meta: {
      market: 'AU',
      reportMode: 'sale',
      source: str(result.source ?? result.listingInfo?.source ?? ''),
      sourceDomain: str(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic: false,
    },
    hero: buildHero(result),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result),
    raw: result,
  };
}
