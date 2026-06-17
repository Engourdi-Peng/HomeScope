// ===== AU Rent Adapter =====
// 转换 AU Rent 报告原始字段 → NormalizedReport

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem } from './types';

type AURentResult = any;

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

function buildHero(result: AURentResult): HeroData {
  const weeklyRent = toText(
    result.listingInfo?.weeklyRent ??
    result.weeklyRent ??
    result.rent_fairness?.listing_price ??
    ''
  );
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
    primaryLabel: weeklyRent ? `Rent: ${weeklyRent}` : undefined,
  };
}

// ── quick facts ───────────────────────────────────────────────────────────────

function buildQuickFacts(result: AURentResult): QuickFact[] {
  const info = result.listingInfo ?? {};
  const facts: QuickFact[] = [];
  const add = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) facts.push({ label, value: t });
  };
  add('Beds', info.bedrooms ?? result.bedrooms);
  add('Baths', info.bathrooms ?? result.bathrooms);
  add('Parking', info.parking ?? result.parking);
  add('Rent/wk', info.weeklyRent ?? result.weeklyRent);
  const fair = result.rent_fairness ?? result.rentFairness ?? {};
  if (fair.estimated_min ?? fair.estimatedMin) add('Est. Rent Min', toText(fair.estimated_min ?? fair.estimatedMin));
  if (fair.estimated_max ?? fair.estimatedMax) add('Est. Rent Max', toText(fair.estimated_max ?? fair.estimatedMax));
  const strat = result.application_strategy ?? result.applicationStrategy ?? {};
  if (strat.urgency) add('Urgency', toText(strat.urgency));
  return facts;
}

// ── highlights ───────────────────────────────────────────────────────────────

function buildHighlights(result: AURentResult): HighlightsData {
  const stringArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    pros: stringArr(result.whatLooksGood).concat(stringArr(result.pros)).concat(stringArr(result.property_strengths)),
    cons: stringArr(result.cons).concat(stringArr(result.potential_issues)),
    risks: [
      ...stringArr(result.riskSignals),
      ...stringArr(result.risks),
      ...stringArr(result.hidden_risks),
      ...stringArr(result.hiddenRisks),
    ],
  };
}

// ── build sections ────────────────────────────────────────────────────────────

function buildSections(result: AURentResult): ReportSection[] {
  const sections: ReportSection[] = [];

  // ── rent_fairness ──────────────────────────────────────────────────────────
  const fair = result.rent_fairness ?? result.rentFairness ?? {};
  const fairItems: SectionItem[] = [];
  if (fair.estimated_min ?? fair.estimatedMin) fairItems.push({ title: 'Est. Min', value: toText(fair.estimated_min ?? fair.estimatedMin) });
  if (fair.estimated_max ?? fair.estimatedMax) fairItems.push({ title: 'Est. Max', value: toText(fair.estimated_max ?? fair.estimatedMax) });
  if (fair.listing_price ?? fair.listingPrice) fairItems.push({ title: 'Listing Price', value: toText(fair.listing_price ?? fair.listingPrice) });
  if (fair.verdict) fairItems.push({ title: 'Verdict', value: toText(fair.verdict) });
  if (fair.explanation) fairItems.push({ title: 'Analysis', description: toText(fair.explanation) });
  if (fairItems.length > 0) sections.push({ id: 'rent-fairness', title: 'Rent Fairness', subtitle: 'Is the rent price fair?', items: fairItems });

  // ── application_strategy ────────────────────────────────────────────────────
  const strat = result.application_strategy ?? result.applicationStrategy ?? {};
  const stratItems: SectionItem[] = [];
  if (strat.urgency) {
    const u = toText(strat.urgency);
    stratItems.push({ title: 'Urgency', value: u, badge: u });
  }
  if (strat.applySpeed ?? strat.apply_speed) stratItems.push({ title: 'Apply Speed', value: toText(strat.applySpeed ?? strat.apply_speed) });
  if (Array.isArray(strat.checklist)) stratItems.push(...objectItems(strat.checklist, { title: 'Checklist Item' }));
  if (Array.isArray(strat.reasoning)) stratItems.push({ title: 'Reasoning', description: toText(strat.reasoning) });
  if (stratItems.length > 0) sections.push({ id: 'application-strategy', title: 'Application Strategy', subtitle: 'How to win this rental', items: stratItems });

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
  if (compItems.length > 0) sections.push({ id: 'competition-risk', title: 'Competition Risk', subtitle: 'How competitive is this rental', items: compItems });

  // ── agent_lingo_translation / reality_check ──────────────────────────────────
  const lingo = result.agent_lingo_translation ?? result.agentLingoTranslation ?? result.reality_check ?? result.realityCheck ?? {};
  const lingoArr: unknown[] = Array.isArray(lingo) ? lingo : (lingo.phrases ?? lingo.items ?? []);
  const lingoItems: SectionItem[] = [];
  for (const item of lingoArr) {
    const phrase = toText(item.phrase ?? item.original ?? item.title ?? '');
    const meaning = toText(item.meaning ?? item.reality ?? item.description ?? '');
    if (phrase || meaning) {
      lingoItems.push({
        title: phrase || meaning,
        description: phrase && meaning ? meaning : '',
        badge: toText(item.verdict ?? item.type ?? ''),
      });
    }
  }
  if (lingoItems.length > 0) sections.push({ id: 'agent-lingo', title: 'Agent Spin Reality Check', subtitle: 'What agent language really means', items: lingoItems });

  // ── light_thermal_guide ────────────────────────────────────────────────────
  const light = result.light_thermal_guide ?? result.lightThermalGuide ?? {};
  const lightItems: SectionItem[] = [];
  if (light.naturalLight) lightItems.push({ title: 'Natural Light', description: toText(light.naturalLight) });
  if (light.thermalComfort) lightItems.push({ title: 'Thermal Comfort', description: toText(light.thermalComfort) });
  if (light.orientation) lightItems.push({ title: 'Orientation', description: toText(light.orientation) });
  if (light.summary ?? light.overall) lightItems.push({ title: 'Summary', description: toText(light.summary ?? light.overall) });
  if (lightItems.length > 0) sections.push({ id: 'light-thermal', title: 'Light & Thermal', subtitle: 'Natural light and comfort assessment', items: lightItems });

  // ── property_strengths ────────────────────────────────────────────────────
  const strengths = Array.isArray(result.property_strengths ?? result.propertyStrengths) ? result.property_strengths ?? result.propertyStrengths : [];
  const strengthItems = objectItems(strengths, { title: 'Strength' });
  if (strengthItems.length > 0) sections.push({ id: 'property-strengths', title: 'Property Strengths', subtitle: 'What looks good', tone: 'positive', items: strengthItems });

  // ── potential_issues ──────────────────────────────────────────────────────
  const issues = Array.isArray(result.potential_issues ?? result.potentialIssues) ? result.potential_issues ?? result.potentialIssues : [];
  const issueItems = objectItems(issues, { title: 'Issue', severity: 'medium' });
  if (issueItems.length > 0) sections.push({ id: 'potential-issues', title: 'Potential Issues', subtitle: 'Concerns to investigate', tone: 'warning', items: issueItems });

  // ── questions_to_ask ──────────────────────────────────────────────────────
  const questions = Array.isArray(result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions) ? result.questionsToAsk ?? result.questions_to_ask ?? result.agentQuestions : [];
  const qItems = objectItems(questions, { title: 'Question' });
  if (qItems.length > 0) sections.push({ id: 'questions-to-ask', title: 'Questions to Ask', subtitle: 'Before applying', items: qItems });

  // ── final_recommendation ──────────────────────────────────────────────────
  const rec = result.finalRecommendation ?? result.final_recommendation ?? result.recommendation ?? {};
  const recItems: SectionItem[] = [];
  if (rec.verdict) recItems.push({ title: 'Verdict', value: toText(rec.verdict) });
  if (rec.reason ?? rec.reasoning) recItems.push({ title: 'Reasoning', description: toText(rec.reason ?? rec.reasoning) });
  if (recItems.length > 0) sections.push({ id: 'final-recommendation', title: 'Final Recommendation', items: recItems });

  return sections;
}

// ── main adapter ──────────────────────────────────────────────────────────────

export function normalizeAURentReport(result: AURentResult): NormalizedReport {
  return {
    meta: {
      market: 'AU',
      reportMode: 'rent',
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
