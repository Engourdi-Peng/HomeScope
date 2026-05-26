// ===== AU Rent Adapter =====
// 转换 AU Rent 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection } from './types';

type AURentResult = any;

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
function buildHero(result: AURentResult): HeroData {
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
  const weeklyRent = str(
    result.listingInfo?.weeklyRent ??
    result.weeklyRent ??
    result.rent_fairness?.listing_price ??
    ''
  );

  return {
    title: title || undefined,
    address: address || undefined,
    score,
    verdict: verdict || (score !== null ? 'Not enough data' : 'No verdict available'),
    confidence: confidence || undefined,
    summary: summary || undefined,
    primaryLabel: weeklyRent ? `Rent: ${weeklyRent}` : undefined,
  };
}

// ---- quick facts ----
function buildQuickFacts(result: AURentResult): QuickFact[] {
  const facts: QuickFact[] = [];

  const info = result.listingInfo ?? {};
  const beds = info.bedrooms ?? result.bedrooms ?? null;
  if (beds !== null && beds !== undefined) facts.push({ label: 'Beds', value: str(beds) });

  const baths = info.bathrooms ?? result.bathrooms ?? null;
  if (baths !== null && baths !== undefined) facts.push({ label: 'Baths', value: str(baths) });

  const parking = info.parking ?? result.parking ?? null;
  if (parking !== null && parking !== undefined) facts.push({ label: 'Parking', value: str(parking) });

  const weeklyRent = info.weeklyRent ?? result.weeklyRent ?? null;
  if (weeklyRent) facts.push({ label: 'Rent/wk', value: str(weeklyRent) });

  const propType = info.propertyType ?? result.propertyType ?? null;
  if (propType) facts.push({ label: 'Type', value: str(propType) });

  // rent_fairness
  const fair = result.rent_fairness ?? result.rentFairness ?? {};
  if (fair.estimated_min ?? fair.estimatedMin) {
    facts.push({ label: 'Est. Rent Min', value: str(fair.estimated_min ?? fair.estimatedMin) });
  }
  if (fair.estimated_max ?? fair.estimatedMax) {
    facts.push({ label: 'Est. Rent Max', value: str(fair.estimated_max ?? fair.estimatedMax) });
  }

  // application_strategy
  const strat = result.application_strategy ?? result.applicationStrategy ?? {};
  if (strat.urgency) {
    facts.push({ label: 'Urgency', value: str(strat.urgency) });
  }

  return facts;
}

// ---- highlights ----
function buildHighlights(result: AURentResult): HighlightsData {
  const pros = [
    ...(Array.isArray(result.whatLooksGood) ? result.whatLooksGood : []),
    ...(Array.isArray(result.pros) ? result.pros : []),
    ...(Array.isArray(result.property_strengths) ? result.property_strengths : []),
  ];
  const cons = [
    ...(Array.isArray(result.cons) ? result.cons : []),
    ...(Array.isArray(result.potential_issues) ? result.potential_issues : []),
  ];
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
  if (l === 'MODERATE' || l === 'MEDIUM') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
}

// ---- sections ----
function buildSections(result: AURentResult): ReportSection[] {
  const sections: ReportSection[] = [];

  // rent_fairness
  const fair = result.rent_fairness ?? result.rentFairness ?? {};
  if (Object.keys(fair).length > 0) {
    const items: ReportSection['items'] = [];
    if (fair.estimated_min ?? fair.estimatedMin) {
      items.push({ title: 'Est. Min', value: str(fair.estimated_min ?? fair.estimatedMin) });
    }
    if (fair.estimated_max ?? fair.estimatedMax) {
      items.push({ title: 'Est. Max', value: str(fair.estimated_max ?? fair.estimatedMax) });
    }
    if (fair.listing_price ?? fair.listingPrice) {
      items.push({ title: 'Listing Price', value: str(fair.listing_price ?? fair.listingPrice) });
    }
    if (fair.verdict) items.push({ title: 'Verdict', value: fair.verdict });
    if (fair.explanation) items.push({ title: 'Analysis', description: fair.explanation });
    if (items.length > 0) {
      sections.push({ id: 'rent-fairness', title: 'Rent Fairness', subtitle: 'Is the rent price fair?', items });
    }
  }

  // application_strategy
  const strat = result.application_strategy ?? result.applicationStrategy ?? {};
  if (Object.keys(strat).length > 0) {
    const items: ReportSection['items'] = [];
    if (strat.urgency) {
      const u = str(strat.urgency);
      items.push({ title: 'Urgency', value: u, badge: u });
    }
    if (strat.applySpeed ?? strat.apply_speed) {
      items.push({ title: 'Apply Speed', value: str(strat.applySpeed ?? strat.apply_speed) });
    }
    if (strat.checklist?.length) {
      items.push(...textItems(strat.checklist).map((i) => ({ ...i, title: 'Checklist Item' })));
    }
    if (strat.reasoning?.length) {
      items.push({ title: 'Reasoning', description: strat.reasoning.join(' ') });
    }
    if (items.length > 0) {
      sections.push({ id: 'application-strategy', title: 'Application Strategy', subtitle: 'How to win this rental', items });
    }
  }

  // space_analysis
  const space = result.spaceAnalysis ?? result.space_analysis ?? {};
  const spaceData = space.spaceAnalysis ?? space.space_analysis ?? [];
  if (spaceData.length > 0) {
    const items: ReportSection['items'] = spaceData.map((room: any) => ({
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
      sections.push({ id: 'competition-risk', title: 'Competition Risk', subtitle: 'How competitive is this rental', items });
    }
  }

  // agent_lingo_translation / reality_check
  const lingo = result.agent_lingo_translation ?? result.agentLingoTranslation ?? result.reality_check ?? result.realityCheck ?? {};
  const lingoItems: any[] = Array.isArray(lingo) ? lingo : lingo.phrases ?? lingo.items ?? [];
  if (lingoItems.length > 0) {
    const items: ReportSection['items'] = lingoItems.map((item: any) => ({
      title: str(item.phrase ?? item.original ?? item.title ?? ''),
      description: str(item.meaning ?? item.reality ?? item.description ?? ''),
      badge: item.verdict ?? item.type ? str(item.verdict ?? item.type) : undefined,
    })).filter((i) => i.title);
    if (items.length > 0) {
      sections.push({ id: 'agent-lingo', title: 'Agent Spin Reality Check', subtitle: 'What agent language really means', items });
    }
  }

  // light_thermal_guide
  const light = result.light_thermal_guide ?? result.lightThermalGuide ?? {};
  if (Object.keys(light).length > 0) {
    const items: ReportSection['items'] = [];
    if (light.naturalLight) items.push({ title: 'Natural Light', description: str(light.naturalLight) });
    if (light.thermalComfort) items.push({ title: 'Thermal Comfort', description: str(light.thermalComfort) });
    if (light.orientation) items.push({ title: 'Orientation', description: str(light.orientation) });
    if (light.summary ?? light.overall) items.push({ title: 'Summary', description: str(light.summary ?? light.overall) });
    if (items.length > 0) {
      sections.push({ id: 'light-thermal', title: 'Light & Thermal', subtitle: 'Natural light and comfort assessment', items });
    }
  }

  // property_strengths
  const strengths = result.property_strengths ?? result.propertyStrengths ?? [];
  if (strengths.length > 0) {
    const items = textItems(strengths).map((i) => ({ ...i, title: i.title }));
    sections.push({ id: 'property-strengths', title: 'Property Strengths', subtitle: 'What looks good', tone: 'positive', items });
  }

  // potential_issues
  const issues = result.potential_issues ?? result.potentialIssues ?? [];
  if (issues.length > 0) {
    const items: ReportSection['items'] = textItems(issues).map((i) => ({
      ...i,
      severity: 'medium' as const,
    }));
    sections.push({ id: 'potential-issues', title: 'Potential Issues', subtitle: 'Concerns to investigate', tone: 'warning', items });
  }

  // questions_to_ask
  const questions = result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions ?? [];
  if (questions.length > 0) {
    const items: ReportSection['items'] = textItems(questions);
    sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', subtitle: 'Before applying', items });
  }

  // final_recommendation
  const rec = result.finalRecommendation ?? result.final_recommendation ?? result.recommendation ?? {};
  if (Object.keys(rec).length > 0) {
    const items: ReportSection['items'] = [];
    if (rec.verdict) items.push({ title: 'Verdict', value: str(rec.verdict) });
    if (rec.reason ?? rec.reasoning) items.push({ title: 'Reasoning', description: str(rec.reason ?? rec.reasoning) });
    if (items.length > 0) {
      sections.push({ id: 'final-recommendation', title: 'Final Recommendation', items });
    }
  }

  return sections;
}

// ---- main adapter ----
export function normalizeAURentReport(result: AURentResult): NormalizedReport {
  return {
    meta: {
      market: 'AU',
      reportMode: 'rent',
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
