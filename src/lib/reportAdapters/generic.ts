// ===== Generic / Basic Adapter =====
// 兜底适配器：处理 Basic result 和未知结构
// Basic 模式下生成专属 sections：what-we-know, listing-claims, basic-decision-cards,
//   monthly-cost-snapshot, basic-questions, basic-cta

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

// ── hero ─────────────────────────────────────────────────────────────────────

function buildHero(result: AnyResult, isBasic: boolean): HeroData {
  if (isBasic || result.analysisType === 'basic') {
    const evidenceScore = (() => {
      const v = result.evidence_score ?? result.overallScore ?? result.overall_score;
      return v != null && v !== '' ? Number(v) || null : null;
    })();
    const address = toText(
      result.listingInfo?.address ??
      result.listingOverview?.address ??
      result.address ?? ''
    );
    return {
      title: toText(result.listingInfo?.title ?? result.listingOverview?.title ?? result.title ?? 'Quick Property Check'),
      address: address || undefined,
      score: evidenceScore,
      verdict: toText(result.verdict ?? 'Need More Evidence'),
      confidence: evidenceScore != null ? String(evidenceScore) : '',
      summary: toText(result.bottom_line ?? result.quickSummary ?? result.quick_summary ?? ''),
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
  const quickFactsPropertyType = info.propertyType ?? result.propertyType ?? '';
  const quickFactsPropertyTypeDisplay = quickFactsPropertyType && /legal|approved|compliant|certified/i.test(quickFactsPropertyType)
    ? `${quickFactsPropertyType.trim()} (listing-stated)`
    : quickFactsPropertyType;
  add('Type', quickFactsPropertyTypeDisplay);
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

// ── Basic: build what-we-know section ─────────────────────────────────────────

function buildWhatWeKnow(result: AnyResult): ReportSection | null {
  const listingInfo = (result as any).listingInfo ?? {};
  const snapshot = (result as any).property_snapshot ?? {};
  const wwKnow = result.what_we_know ?? {};
  const sourceDomain = result.sourceDomain ?? result.source ?? '';

  const items: SectionItem[] = [];

  const add = (label: string, aiVal: unknown, rawVal: unknown) => {
    const t = toText(aiVal ?? rawVal ?? '');
    if (label === 'Photos') {
      items.push({ title: label, value: aiVal != null ? String(aiVal) : 'Not analysed in basic report' });
    } else {
      items.push({ title: label, value: t || 'Not disclosed' });
    }
  };

  const address = wwKnow.address ?? listingInfo.address ?? snapshot.address ?? result.address ?? '';
  add('Address', address, '');

  const askingPrice = wwKnow.asking_price ?? wwKnow.askingPrice ?? listingInfo.price ?? '';
  add('Asking price', askingPrice, '');

  const beds = wwKnow.beds ?? listingInfo.bedrooms ?? snapshot.beds ?? '';
  add('Beds', beds, '');

  const baths = wwKnow.baths ?? listingInfo.bathrooms ?? snapshot.baths ?? '';
  add('Baths', baths, '');

  const sqft = wwKnow.sqft ?? listingInfo.sqft ?? snapshot.sqft ?? '';
  add('Sqft', sqft, '');

  const propertyType = wwKnow.property_type ?? wwKnow.propertyType ?? listingInfo.propertyType ?? snapshot.home_type ?? '';
  const propertyTypeDisplay = propertyType && /legal|approved|compliant|certified/i.test(propertyType)
    ? `${propertyType.trim()} (listing-stated, not independently verified)`
    : propertyType;
  add('Property type', propertyTypeDisplay, '');

  const source = wwKnow.source ?? sourceDomain;
  add('Source', source, '');

  add('Photos', wwKnow.photos_count ?? null, '');

  if (items.length === 0) return null;
  return { id: 'what-we-know', title: 'What We Know', subtitle: 'Data from the listing only — not verified or analysed.', items };
}

// ── Basic: build listing-claims section ───────────────────────────────────────

const LISTING_CLAIM_FALLBACKS = [
  {
    keyword: /legal 2-family|two.family|multi.family|rental.approved/i,
    phrase: 'LEGAL 2-FAMILY',
    homeScopeCheck: 'Listing-stated only. Confirm through Certificate of Occupancy and public records.',
    askBeforeViewing: 'Can you provide the Certificate of Occupancy or legal-use documents?',
  },
  {
    keyword: /\bTLC\b|needs work|needs updating|needs renovation|needs repair/i,
    phrase: 'Needs TLC',
    homeScopeCheck: 'This may mean repairs, renovations, or system updates are needed.',
    askBeforeViewing: 'Are any repairs, renovations, or major system updates needed?',
  },
  {
    keyword: /\svacant\b|delivered vacant|tenant vacated/i,
    phrase: 'Delivered Vacant',
    homeScopeCheck: 'Vacant properties can have maintenance, security, insurance, or deterioration concerns.',
    askBeforeViewing: 'How long has it been vacant, and have utilities, heating, plumbing, and security been maintained?',
  },
  {
    keyword: /sold as.is|as.is\b|as is\b/i,
    phrase: 'Sold As-Is',
    homeScopeCheck: 'As-is sales typically indicate the seller will not make repairs or provide credits.',
    askBeforeViewing: 'Is the asking price reflective of the as-is condition, and are repairs needed before financing?',
  },
  {
    keyword: /motivated seller|price reduced|price drop|price adjustment/i,
    phrase: 'Motivated Seller / Price Reduced',
    homeScopeCheck: 'Price reductions may signal pricing concerns, condition issues, or weak demand.',
    askBeforeViewing: "Why has the price been reduced, and what is the seller's motivation?",
  },
];

function buildListingClaims(result: AnyResult): ReportSection | null {
  // Prefer structured AI output (listing_claims from new compact prompt)
  const aiClaims = result.listing_claims ?? result.listing_language_reality_check ?? result.listingLanguageRealityCheck ?? result.listing_spin_decoder ?? [];
  const claimArray = Array.isArray(aiClaims) ? aiClaims : [];

  interface Claim {
    phrase: string;
    homeScopeCheck: string;
    askBeforeViewing: string;
  }

  const claims: Claim[] = [];

  // Use AI claims if available (max 3)
  if (claimArray.length > 0) {
    for (const item of claimArray.slice(0, 3)) {
      const phrase = toText(item.phrase ?? item.listing_says ?? item.listing ?? item.keyword ?? '');
      const homeScopeCheck = toText(item.check ?? item.what_it_may_mean ?? item.interpretation ?? item.reads ?? '');
      const ask = toText(item.ask ?? item.what_to_verify ?? item.question ?? item.ask_before_viewing ?? '');
      if (phrase && homeScopeCheck) {
        claims.push({ phrase, homeScopeCheck, askBeforeViewing: ask });
      }
    }
  }

  // Fallback: detect claims from listing text (max 3 total, only if AI claims empty)
  if (claims.length === 0) {
    const listingText = [
      result.listingInfo?.description ?? '',
      result.listingOverview?.description ?? '',
      result.description ?? '',
      result.quickSummary ?? '',
      result.summary ?? '',
      result.quick_summary ?? '',
    ].join(' ');

    const seen = new Set<string>();
    for (const fallback of LISTING_CLAIM_FALLBACKS) {
      if (fallback.keyword.test(listingText)) {
        if (!seen.has(fallback.phrase)) {
          seen.add(fallback.phrase);
          claims.push({
            phrase: fallback.phrase,
            homeScopeCheck: fallback.homeScopeCheck,
            askBeforeViewing: fallback.askBeforeViewing,
          });
        }
      }
      if (claims.length >= 3) break;
    }
  }

  if (claims.length === 0) return null;

  const items: SectionItem[] = claims.map(c => ({
    title: c.phrase,
    description: c.homeScopeCheck,
    value: c.askBeforeViewing,
  }));

  return {
    id: 'listing-claims',
    title: 'Listing Claims to Verify',
    subtitle: 'Based on listing language only. HomeScope has not independently verified these claims.',
    items,
  };
}

// ── Basic: build basic-decision-cards section ─────────────────────────────────

interface DecisionCard {
  title: string;
  whyMatters: string;
  action: string;
}

function buildBasicDecisionCards(result: AnyResult, hasZillowMonthly: boolean): ReportSection | null {
  const isNYC = /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
    (result.listingInfo?.address ?? '') + (result.address ?? '')
  );

  const listingText = [
    result.listingInfo?.description ?? '',
    result.listingOverview?.description ?? '',
    result.description ?? '',
    result.quickSummary ?? '',
    result.summary ?? '',
    result.quick_summary ?? '',
    result.listingInfo?.propertyType ?? '',
    result.propertyType ?? '',
  ].join(' ');

  const isRentalMentioned = /legal 2-family|two.family|multi.family|rental|second unit|income|tenant/i.test(listingText);
  const hasConditionSignal = /TLC|needs work|needs updating|needs renovation|needs repair|vacant|as.is|sold/i.test(listingText);

  const cards: DecisionCard[] = [];

  // 1. Legal Use Verification — only if listing mentions rental/multi-family use
  if (isRentalMentioned) {
    cards.push({
      title: 'Legal Use Verification',
      whyMatters: 'You should not rely on the 2-family or rental setup until the Certificate of Occupancy is confirmed.',
      action: isNYC
        ? 'Ask for the Certificate of Occupancy and check NYC DOB, HPD, and ACRIS records before relying on rental income.'
        : 'Ask for the Certificate of Occupancy and check local building department and county records before relying on rental income.',
    });
  }

  // 2. Carrying Costs — always, but文案 varies by available data
  if (hasZillowMonthly) {
    cards.push({
      title: 'Carrying Costs',
      whyMatters: "Zillow provides a monthly estimate, but actual taxes, insurance, HOA, utilities, loan terms, and maintenance may differ from the estimate.",
      action: 'Confirm whether Zillow\'s estimated taxes, insurance, HOA fees, and monthly payment are accurate for this specific property.',
    });
  } else {
    cards.push({
      title: 'Carrying Costs',
      whyMatters: 'Monthly affordability cannot be judged from the asking price alone.',
      action: 'Confirm property taxes, insurance, HOA, utilities, and maintenance expectations before booking a viewing.',
    });
  }

  // 3. Comparable Sales / Rent Context — always
  cards.push({
    title: 'Comparable Sales / Rent Context',
    whyMatters: 'The asking price has no visible market support from the listing alone.',
    action: 'Ask for recent comparable sales or actual rental history to support the asking price.',
  });

  // 4. Condition / Title Verification — only if listing mentions condition signals
  if (hasConditionSignal) {
    cards.push({
      title: 'Condition / Title Verification',
      whyMatters: 'Properties described as needing TLC, vacant, or sold as-is may have hidden condition or title concerns.',
      action: 'Ask for repair history, maintenance records, and any open permits, violations, liens, or title issues.',
    });
  }

  if (cards.length === 0) return null;

  const items: SectionItem[] = cards.map(c => ({
    title: c.title,
    description: c.whyMatters,
    value: c.action,
  }));

  return {
    id: 'basic-decision-cards',
    title: 'What Could Change Your Decision',
    subtitle: 'Key verification items based on what the listing discloses — not independent analysis.',
    items,
  };
}

// ── Basic: build questions section ────────────────────────────────────────────

function buildBasicQuestions(result: AnyResult): ReportSection | null {
  const raw = result.questions_to_ask ?? result.questionsToAsk ?? [];
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const items: SectionItem[] = raw.slice(0, 5).map((q: any) => ({
    title: toText(q.category ?? 'General'),
    description: toText(q.question ?? q.text ?? q.title ?? ''),
  })).filter((i: SectionItem) => i.description);

  if (items.length === 0) return null;
  return { id: 'basic-questions', title: 'Questions to Ask', subtitle: 'Before booking a viewing.', items };
}

// ── Basic: build CTA section ──────────────────────────────────────────────────

function buildBasicCTA(result: AnyResult): ReportSection {
  const cta = result.upsell_cta ?? {};
  return {
    id: 'basic-cta',
    title: toText(cta.title ?? 'Unlock Full Analysis'),
    subtitle: toText(cta.button ?? 'Upgrade'),
    items: [
      {
        title: toText(cta.body ?? 'Basic shows what the listing says and what still needs verification. Full Analysis goes deeper into photos, price confidence, legal and maintenance risks, carrying-cost assumptions, and whether this property is actually worth viewing.'),
        description: '',
      },
    ],
  };
}

// ── build sections ───────────────────────────────────────────────────────────

function buildSections(result: AnyResult, isBasic: boolean): ReportSection[] {
  const sections: ReportSection[] = [];

  if (isBasic) {
    // 1. What We Know
    const whatWeKnow = buildWhatWeKnow(result);
    if (whatWeKnow) sections.push(whatWeKnow);

    // 2. Listing-Stated Monthly Payment — only if Zillow data exists (no empty shell)
    const monthlyCostSnapshot = (result as any).monthly_cost_snapshot ?? null;
    if (monthlyCostSnapshot) {
      const snapItems: SectionItem[] = [];
      const add = (label: string, value: unknown) => {
        const t = toText(value);
        if (t) snapItems.push({ title: label, value: t });
      };
      add('Estimated Monthly Payment', monthlyCostSnapshot.estimated_monthly_payment);
      add('Principal & Interest', monthlyCostSnapshot.principal_and_interest);
      add('Mortgage Insurance', monthlyCostSnapshot.mortgage_insurance);
      add('Property Taxes', monthlyCostSnapshot.property_taxes);
      add('Home Insurance', monthlyCostSnapshot.home_insurance);
      add('HOA Fees', monthlyCostSnapshot.hoa_fees);
      add('Utilities', monthlyCostSnapshot.utilities);
      if (snapItems.length > 0) {
        sections.push({
          id: 'monthly-cost-snapshot',
          title: 'Zillow Monthly Payment Snapshot',
          subtitle: monthlyCostSnapshot.disclaimer ?? 'Based on Zillow/listing estimate. Not independently verified by HomeScope.',
          items: snapItems,
        });
      }
    }

    // 3. Listing Claims to Verify
    const listingClaims = buildListingClaims(result);
    if (listingClaims) sections.push(listingClaims);

    // 4. What Could Change Your Decision
    const decisionCards = buildBasicDecisionCards(result, !!monthlyCostSnapshot);
    if (decisionCards) sections.push(decisionCards);

    // 5. Questions to Ask (max 5, from AI output)
    const basicQuestions = buildBasicQuestions(result);
    if (basicQuestions) sections.push(basicQuestions);

    // 6. CTA
    sections.push(buildBasicCTA(result));

    return sections;
  }

  // ── Deep mode: existing sections ────────────────────────────────────────────

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

  // ── investment_potential ───────────────────────────────────────────────────
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
