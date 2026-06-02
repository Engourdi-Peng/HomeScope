// ===== reportViewModel — 结果页数据标准化层 =====
// 把原始 listing 数据、AI 输出、前端模板统一处理成稳定的展示数据.
// JSX 只从 viewModel 取值，不直接访问 AI 原始字段.
// 包含 5 大一致性校验规则.

import type { ReportSection } from './types';
import { MODULE_FALLBACKS, RISK_ACTION_FALLBACKS, QUESTION_FALLBACKS, buildBasicQuestionFallbacks } from './Fallbacks';

// ── 通用工具 ──────────────────────────────────────────────────────────────────

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['title', 'label', 'name', 'heading', 'value', 'summary',
      'description', 'detail', 'text', 'reason', 'risk', 'signal',
      'action', 'recommendation']) {
      const t = toText(obj[key]);
      if (t) return t;
    }
    return '';
  }
  return '';
}

function fmtMoney(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return '$' + val.toLocaleString();
  }
  return toText(val);
}

function extractImageUrls(raw: any): string[] {
  const candidates = [
    raw?.listingInfo?.images, raw?.listingInfo?.photos,
    raw?.listingInfo?.photoUrls, raw?.listingInfo?.imageUrls,
    raw?.images, raw?.photos,
    raw?.photoUrls, raw?.photo_urls,
    raw?.imageUrls, raw?.image_urls,
  ];
  const result: string[] = [];
  for (const arr of candidates) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const url = typeof item === 'string' ? item.trim()
        : typeof item === 'object' && item !== null
          ? String((item as Record<string, unknown>).url ?? (item as Record<string, unknown>).src ?? '')
          : '';
      if (url.startsWith('http') && !/icon|logo|avatar|placeholder|default|1x1|pixel|blank/i.test(url)) {
        result.push(url);
      }
    }
  }
  return result;
}

// ── 数据底座优先 ─────────────────────────────────────────────────────────────

function preferRawFact<T>(...values: T[]): T {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return values[values.length - 1];
}

// ── Evidence Score 计算 ────────────────────────────────────────────────────────

export type EvidenceVerdict = 'Strong Listing Evidence' | 'Enough to Review' | 'Need More Evidence' | 'High Uncertainty';

/**
 * computeEvidenceScore — Evidence Score for Basic reports.
 * Represents listing information completeness, NOT property quality.
 * ALWAYS calculated from raw listing data; never trusts AI-supplied scores.
 *
 * Scoring:
 *   base 20
 *   address +10
 *   asking price +10
 *   beds +8
 *   baths +8
 *   sqft +12
 *   property type +8
 *   year built +6
 *   tax/HOA +8
 *   photos count > 0 +8
 *   listing description +5
 *   legal/multi-family confirmed +8
 *   comps/zestimate/market estimate +8
 *   cap 100
 *
 * Max achievable with only address+price+beds+baths = 20+10+10+8+8 = 76.
 * Needs sqft+type+tax+photos+desc+legal+comps to reach 85+.
 */
export function computeEvidenceScore(result: any, listingInfo?: any): number {
  const raw = result?.raw ?? result;

  let score = 20;
  const snap = raw?.property_snapshot ?? {};
  const info = listingInfo ?? {};

  const has = (v: unknown) => v != null && v !== '';

  if (has(snap?.address ?? info?.address)) score += 10;
  if (has(snap?.asking_price ?? info?.price ?? snap?.askingPrice)) score += 10;
  if (has(snap?.beds ?? info?.bedrooms ?? snap?.beds)) score += 8;
  if (has(snap?.baths ?? info?.bathrooms ?? snap?.baths)) score += 8;
  if (has(snap?.sqft ?? info?.sqft ?? snap?.squareFeet)) score += 12;
  if (has(snap?.home_type ?? info?.propertyType)) score += 8;
  if (has(snap?.year_built ?? info?.yearBuilt)) score += 6;
  if (has(snap?.annual_tax ?? info?.taxes ?? info?.tax ?? snap?.hoa ?? info?.hoa)) score += 8;
  if (has(snap?.photos_count ?? info?.photos_count)) score += 8;
  if (has(raw?.quickSummary ?? raw?.quick_summary ?? raw?.summary ?? raw?.bottom_line)) score += 5;
  if (has(raw?.legal_compliance ?? raw?.certificateOfOccupancy ?? snap?.legal_use)) score += 8;
  if (has(snap?.price_per_sqft ?? info?.zestimate ?? snap?.zestimate ?? snap?.market_estimate)) score += 8;

  return Math.min(100, score);
}

export function evidenceVerdict(score: number): EvidenceVerdict {
  // Must match backend getBasicVerdict() in analyze/index.ts exactly:
  // score >= 80 -> Enough to Review
  // score >= 60 -> Review With Caution
  // score >= 40 -> Need More Evidence
  // score < 40  -> High Uncertainty
  if (score >= 80) return 'Enough to Review';
  if (score >= 60) return 'Review With Caution';
  if (score >= 40) return 'Need More Evidence';
  return 'High Uncertainty';
}

// ── 校验函数 ──────────────────────────────────────────────────────────────────

/**
 * 问句校验：必须是完整问句，不接受陈述句、字段名、风险总结.
 * 规则：结尾是 ?，或以 can/is/are/what/when/how/has/does/do/why 开头，长度 >= 10.
 */
export function isValidQuestion(text: string): boolean {
  if (!text || text.trim().length < 10) return false;
  const q = text.trim();
  if (q.endsWith('?')) return true;
  return /^(can|is|are|what|when|how|has|does|do|why|should|would|could|will|have)/i.test(q);
}

/**
 * Action 校验：长度 >= 50, 必须以 Ask/Check/Verify/Request/Inspect/Obtain/Get 开头,
 * 且不能等于 summary.
 */
export function isValidAction(action: string, summary: string): boolean {
  if (!action || action.trim().length < 50) return false;
  if (action.trim() === (summary || '').trim()) return false;
  return /^(ask|check|verify|request|inspect|obtain|get)/i.test(action.trim());
}

// ── 照片一致性校验 ────────────────────────────────────────────────────────────

const INTERIOR_AREAS = [
  'living room', 'bedroom', 'bathroom', 'kitchen',
  'hallway', 'dining room', 'basement', 'storage',
  'attic', 'laundry', 'office', 'family room',
];

export interface PhotoAnalysisVM {
  detectedAreas: string[];
  hasInteriorPhotos: boolean;
  photoCount: number;
  summary: string;
  coverageNote: 'missing' | 'limited' | 'reasonable';
}

export function normalizePhotoAnalysis(raw: any, imageUrls: string[] = []): PhotoAnalysisVM {
  const rawAreas: string[] = (raw?.detectedAreas ?? raw?.areas ?? []).map(String);
  const normalized = rawAreas.map(a => a.toLowerCase());
  const hasInterior = normalized.some(a =>
    INTERIOR_AREAS.some(i => a.includes(i))
  );
  const photoCount = imageUrls.length || rawAreas.length || 0;

  let coverageNote: PhotoAnalysisVM['coverageNote'];
  let summary: string;

  if (hasInterior) {
    coverageNote = photoCount > 10 ? 'reasonable' : 'limited';
    summary = photoCount > 10
      ? MODULE_FALLBACKS.PHOTO_COVERAGE_REASONABLE
      : MODULE_FALLBACKS.PHOTO_LIMITED_CONDITION;
  } else {
    coverageNote = 'missing';
    summary = MODULE_FALLBACKS.PHOTO_MISSING_INTERIOR;
  }

  return { detectedAreas: rawAreas, hasInteriorPhotos: hasInterior, photoCount, summary, coverageNote };
}

// ── Price 一致性校验 ──────────────────────────────────────────────────────────

export type PriceVerdict = 'Unknown' | 'Overpriced' | 'Fair' | 'Good Value';
export type PriceConfidence = 'Low' | 'Medium' | 'High';

export interface PriceVM {
  askingPrice: string | null;
  estimatedMin: string | null;
  estimatedMax: string | null;
  verdict: PriceVerdict;
  confidence: PriceConfidence;
  analysis: string;
  warning?: string;
}

export function normalizePriceVerdict(v: string | undefined): PriceVerdict {
  if (!v) return 'Unknown';
  const lower = v.toLowerCase();
  if (/overpriced|high|expensive/i.test(lower)) return 'Overpriced';
  if (/underpriced|bargain|good.value|attractive/i.test(lower)) return 'Good Value';
  if (/fair|reasonable|appropriate/i.test(lower)) return 'Fair';
  return 'Unknown';
}

function conflictingVerdict(text: string, verdict: PriceVerdict): boolean {
  const lower = text.toLowerCase();
  if (verdict === 'Overpriced') return /appears fair|good value|bargain|underpriced/i.test(lower);
  if (verdict === 'Fair') return /overpriced|overvalued/i.test(lower);
  return false;
}

export function normalizePriceCopy(priceAssessment: any): PriceVM {
  const verdict = normalizePriceVerdict(priceAssessment?.verdict ?? priceAssessment?.valuation_verdict);

  let confidence: PriceConfidence = 'Medium';
  const confRaw = priceAssessment?.valuationConfidence ?? priceAssessment?.valuation_confidence
    ?? priceAssessment?.confidence;
  if (confRaw) {
    const c = String(confRaw).toLowerCase();
    if (/high|strong/i.test(c)) confidence = 'High';
    else if (/low|weak/i.test(c)) confidence = 'Low';
  }

  let analysis: string;
  switch (verdict) {
    case 'Unknown':
      analysis = MODULE_FALLBACKS.PRICE_ANALYSIS_UNKNOWN;
      break;
    case 'Overpriced':
      if (priceAssessment?.explanation && !conflictingVerdict(priceAssessment.explanation, verdict)) {
        analysis = priceAssessment.explanation;
      } else {
        analysis = MODULE_FALLBACKS.PRICE_ANALYSIS_OVERPRICED;
      }
      break;
    case 'Fair':
      analysis = priceAssessment?.explanation || MODULE_FALLBACKS.PRICE_ANALYSIS_FAIR;
      break;
    case 'Good Value':
      analysis = priceAssessment?.explanation || MODULE_FALLBACKS.PRICE_ANALYSIS_GOOD_VALUE;
      break;
  }

  return {
    askingPrice: priceAssessment?.asking_price ?? priceAssessment?.askingPrice ?? priceAssessment?.listPrice ?? null,
    estimatedMin: priceAssessment?.estimated_min ?? priceAssessment?.estimatedMin ?? null,
    estimatedMax: priceAssessment?.estimated_max ?? priceAssessment?.estimatedMax ?? null,
    verdict,
    confidence,
    analysis,
  };
}

// ── Carrying Costs 清理 ───────────────────────────────────────────────────────

export interface CarryingCostItem { label: string; value: string; }

export interface CarryingCostVM {
  hasBreakdown: boolean;
  estimatedMonthly: string | null;
  items: CarryingCostItem[];
  warning: string;
}

export function normalizeCarryingCosts(costs: any): CarryingCostVM {
  const items: CarryingCostItem[] = [];

  const fields: Array<{ label: string; value: any }> = [
    { label: 'Known Tax', value: costs?.annualTax ?? costs?.annual_tax },
    { label: 'HOA', value: costs?.hoa ?? costs?.HOA ?? costs?.monthly_hoa },
    { label: 'Insurance Est.', value: costs?.insuranceEstimate ?? costs?.insurance ?? costs?.insurance_estimate },
    { label: 'Maintenance Reserve', value: costs?.maintenanceReserve ?? costs?.maintenance_reserve },
    { label: 'Financing Assumptions', value: costs?.financingAssumptions ?? costs?.financing_assumptions },
  ];

  for (const f of fields) {
    if (f.value != null && f.value !== '') {
      const text = typeof f.value === 'number' ? fmtMoney(f.value) : toText(f.value);
      if (text) items.push({ label: f.label, value: text });
    }
  }

  const estimatedMonthly = costs?.estimatedMonthlyCost ?? costs?.estimated_monthly_cost
    ?? costs?.monthlyCost ?? costs?.monthly_cost ?? null;

  const hasBreakdown = items.length > 0;

  return {
    hasBreakdown,
    estimatedMonthly: estimatedMonthly != null && estimatedMonthly !== ''
      ? (typeof estimatedMonthly === 'number' ? fmtMoney(estimatedMonthly) : toText(estimatedMonthly))
      : null,
    items,
    warning: MODULE_FALLBACKS.CARRYING_COSTS_WARNING,
  };
}

// ── Deal-Changing Risks ────────────────────────────────────────────────────────

export interface DealRiskVM {
  id: string;
  category: string;
  severity: 'High' | 'Medium' | 'Low';
  summary: string;
  action: string;
}

function normalizeSeverity(level: any): DealRiskVM['severity'] {
  const s = String(level ?? '').toLowerCase();
  if (/high|critical|severe/i.test(s)) return 'High';
  if (/low/i.test(s)) return 'Low';
  return 'Medium';
}

export function normalizeDealRisks(risks: any[], context: { isNYC?: boolean } = {}): DealRiskVM[] {
  const { isNYC = false } = context;

  const OVERRIDE_ACTIONS: Record<string, string> = {
    maintenance: RISK_ACTION_FALLBACKS.maintenance,
    legal: isNYC ? RISK_ACTION_FALLBACKS.legal_nyc : RISK_ACTION_FALLBACKS.legal_general,
    environmental: isNYC ? RISK_ACTION_FALLBACKS.environmental_nyc : RISK_ACTION_FALLBACKS.environmental_general,
    price: RISK_ACTION_FALLBACKS.price,
    market: RISK_ACTION_FALLBACKS.market,
  };

  return risks.map((risk, idx) => {
    const category = toText(risk.category ?? risk.type ?? risk.area ?? 'default').toLowerCase();
    const severity = normalizeSeverity(risk.severity ?? risk.riskLevel ?? risk.level);
    const summary = toText(risk.summary ?? risk.description ?? risk.title ?? risk.signal ?? '');

    let action = toText(risk.action ?? risk.recommendation ?? risk.what_to_do ?? risk.next_step ?? '');
    if (!isValidAction(action, summary)) {
      const catKey = Object.keys(OVERRIDE_ACTIONS).find(k => category.includes(k)) ?? 'default';
      action = OVERRIDE_ACTIONS[catKey];
    }

    return {
      id: `risk-${idx}`,
      category,
      severity,
      summary,
      action,
    };
  });
}

// ── What Could Change Your Decision ───────────────────────────────────────────

export interface DecisionCardVM {
  id: string;
  title: string;
  explanation: string;
  badge: string;
}

const CARD_TITLE_MAP: Record<string, string> = {
  market_time: 'Long Market Time',
  basement: 'Basement Moisture Risk',
  renovation: 'Renovation Cost Risk',
  legal: 'Rental Legality Risk',
  price: 'Price Confidence Risk',
  roof: 'Roof Condition Risk',
  inspection: 'Inspection Findings',
  price_verify: 'Price Confidence Risk',
  legal_verify: 'Legal Verification Needed',
  default: 'Key Verification Risk',
};

export function normalizeDecisionCards(
  reasons: any[],
  risks: any[],
  photoVM: PhotoAnalysisVM,
): DecisionCardVM[] {
  const CARDS: DecisionCardVM[] = [];
  const added = new Set<string>();

  const textSources = [...(reasons || []), ...(risks || [])]
    .map((r) => toText(typeof r === 'string' ? r : (r?.signal ?? r?.text ?? r?.title ?? '')))
    .filter(Boolean);

  const FAMILY_KEYWORDS: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /days on market|long market time|listed.*ago/i, category: 'market_time' },
    { pattern: /basement|moisture|water.*intrusion|drainage|foundation/i, category: 'basement' },
    { pattern: /kitchen|bathroom|renovation|\$\d+.*k|update|cosmetic/i, category: 'renovation' },
    { pattern: /legal|co|certificate|rental|two.family|occupancy/i, category: 'legal' },
    { pattern: /price|comparable|valuation|overpriced/i, category: 'price' },
    { pattern: /roof/i, category: 'roof' },
  ];

  for (const text of textSources) {
    if (CARDS.length >= 3) break;

    // 如果有室内照片，跳过 photo 相关的卡片
    if (photoVM.hasInteriorPhotos && /photo|interior|missing/i.test(text)) continue;

    let category = 'default';
    for (const { pattern, category: cat } of FAMILY_KEYWORDS) {
      if (pattern.test(text)) { category = cat; break; }
    }

    const title = CARD_TITLE_MAP[category];
    if (!added.has(title)) {
      added.add(title);
      CARDS.push({ id: category, title, explanation: text, badge: 'Verify' });
    }
  }

  const fallbacks: DecisionCardVM[] = [
    { id: 'inspection', title: 'Inspection Findings', explanation: 'Full inspection is needed to verify structural integrity, systems condition, and any hidden issues.', badge: 'Verify' },
    { id: 'price_verify', title: 'Price Confidence Risk', explanation: 'Comparable sales and market conditions should be verified with local data.', badge: 'Verify' },
    { id: 'legal_verify', title: 'Legal Verification Needed', explanation: 'Property records, permits, and any outstanding violations should be confirmed before making an offer.', badge: 'Verify' },
  ];

  for (const f of fallbacks) {
    if (CARDS.length >= 3) break;
    if (!added.has(f.title)) {
      added.add(f.title);
      CARDS.push(f);
    }
  }

  return CARDS.slice(0, 3);
}

// ── Agent Spin Decoder ─────────────────────────────────────────────────────────

export interface SpinDecoderVM {
  listingSays: string;
  homeScopeReads: string;
  ask: string;
}

export function normalizeSpinDecoder(items: any[], context: { isNYC?: boolean } = {}): SpinDecoderVM[] {
  const { isNYC = false } = context;

  return items.map(item => {
    const listingSays = toText(item.phrase ?? item.listing_says ?? item.listing ?? item.keyword ?? '');
    const homeScopeReads = toText(item.what_it_may_mean ?? item.interpretation ?? item.reads ?? '');
    let ask = toText(item.what_to_verify ?? item.ask ?? item.question ?? item.ask_before_viewing ?? '');

    const askLower = ask.toLowerCase();
    const listingLower = listingSays.toLowerCase();

    // 关键词 domain 校验：rent → 必须问 legal rent / actual rent
    if (/rent|unit|income|investor|live in one/i.test(listingLower)) {
      if (!/legal|actual rent|co|certificate|occupancy|rent roll/i.test(askLower)) {
        ask = 'Can you confirm the legal rental status, provide actual rent amounts, and show the Certificate of Occupancy before viewing?';
      }
    }
    // basement / recreation / storage → 必须问 water/foundation/drainage
    if (/basement|recreation|storage/i.test(listingLower)) {
      if (!/water|moisture|foundation|drainage|flood|intrus/i.test(askLower)) {
        ask = 'Has the basement had water intrusion, foundation repairs, or drainage issues?';
      }
    }
    // spacious / two-family → 必须问 legal area / CO
    if (/spacious|two.family|multi.family/i.test(listingLower)) {
      if (!/legal|unit|square footage|co|certificate/i.test(askLower)) {
        ask = 'Can you confirm the legal number of units, total square footage, and provide the Certificate of Occupancy?';
      }
    }
    // updated / renovated → 必须问 what and when
    if (/updated|renovated|new.*kitchen|new.*bath/i.test(listingLower)) {
      if (!/what|when|permitted|permits/i.test(askLower)) {
        ask = 'What was updated, when, and was it permitted?';
      }
    }

    return { listingSays, homeScopeReads, ask };
  });
}

// ── Who This Works For ─────────────────────────────────────────────────────────

export interface FitVM {
  bestFor: string[];
  notIdealFor: string[];
  whyItMatters: string;
}

export function normalizeFitSection(layoutFit: any): FitVM {
  const bestFor: string[] = [];
  const notIdealFor: string[] = [];

  const bfRaw = layoutFit?.best_for ?? layoutFit?.bestFor ?? layoutFit?.good_for ?? [];
  const bfArr = Array.isArray(bfRaw) ? bfRaw : [bfRaw];
  for (const item of bfArr) {
    const text = toText(item);
    if (text && text.length > 5) bestFor.push(text);
  }

  const nifRaw = layoutFit?.not_ideal_for ?? layoutFit?.notIdealFor ?? [];
  const nifArr = Array.isArray(nifRaw) ? nifRaw : [nifRaw];
  for (const item of nifArr) {
    const text = toText(item);
    if (text && text.length > 5) notIdealFor.push(text);
  }

  return {
    bestFor: bestFor.length ? bestFor : [MODULE_FALLBACKS.FIT_BEST_FOR_DEFAULT],
    notIdealFor: notIdealFor.length ? notIdealFor : [MODULE_FALLBACKS.FIT_NOT_IDEAL_DEFAULT],
    whyItMatters: toText(layoutFit?.why_it_matters ?? layoutFit?.why ?? ''),
  };
}

// ── Questions to Ask ──────────────────────────────────────────────────────────

export interface QuestionVM {
  text: string;
  category: string;
  tagColor: string;
}

/** 从 result 中提取 what_we_know 和 whats_missing，识别已知字段和缺失维度 */
function extractQuestionContext(result: any): {
  hasPrice: boolean;
  hasBeds: boolean;
  hasBaths: boolean;
  hasSqft: boolean;
  hasPropertyType: boolean;
  hasCondition: boolean;
  hasLegalUse: boolean;
  hasCosts: boolean;
  hasComps: boolean;
  hasZillowMonthly: boolean;
  isUS: boolean;
  isAU: boolean;
  sourceDomain: string;
} {
  const wwKnow = result?.what_we_know ?? result?.whatWeKnow ?? {};
  const missing = result?.whats_missing ?? result?.whatsMissing ?? [];
  const raw = result?.raw ?? result;

  const has = (v: unknown) => v != null && v !== '';

  const missingLabels = (missing as any[]).map((m: any) => {
    const label = typeof m === 'string' ? m : (m.label ?? '');
    return label.toLowerCase();
  });

  const sourceDomain = raw?.sourceDomain ?? raw?.source_domain ?? '';
  const isAU = /realestate|domain|allhomes/i.test(sourceDomain);
  const isUS = !isAU;

  return {
    hasPrice:        has(wwKnow?.asking_price ?? wwKnow?.askingPrice ?? wwKnow?.price),
    hasBeds:         has(wwKnow?.beds ?? wwKnow?.bedrooms),
    hasBaths:        has(wwKnow?.baths ?? wwKnow?.bathrooms),
    hasSqft:         has(wwKnow?.sqft ?? wwKnow?.square_feet ?? wwKnow?.squareFeet ?? wwKnow?.floor_area),
    hasPropertyType: has(wwKnow?.property_type ?? wwKnow?.propertyType ?? wwKnow?.home_type ?? wwKnow?.homeType),
    hasCondition:    !!(raw?.spaceAnalysis || raw?.visualAnalysis || raw?.photos || raw?.space_analysis),
    // Legal use is considered missing if whats_missing mentions it (so !hasLegalUse triggers a question)
    // If nothing legal is mentioned in missing, we still don't have confirmed CO — ask anyway
    hasLegalUse:    false, // Always ask for legal docs unless we have an explicit CO confirmation
    // hasCosts: true if we have tax/insurance/HOA from what_we_know OR monthly_cost_snapshot from Zillow
    hasCosts:        !!(raw?.monthly_cost_snapshot?.estimated_monthly_payment) ||
                       has(wwKnow?.taxes ?? wwKnow?.annual_tax ?? wwKnow?.insurance ?? wwKnow?.hoa),
    hasComps:        has(wwKnow?.comparable_sales ?? wwKnow?.comparableSales ?? wwKnow?.zestimate),
    hasZillowMonthly: !!(raw?.monthly_cost_snapshot?.estimated_monthly_payment),
    isUS,
    isAU,
    sourceDomain,
  };
}

export function normalizeQuestions(
  questions: any[],
  context: {
    isNYC?: boolean;
    maxQuestions?: number;
    /** 传入原始 result，用于动态 fallback 生成 */
    result?: any;
  } = {},
): QuestionVM[] {
  const { isNYC = false, maxQuestions = 8, result: rawResult } = context;
  const results: QuestionVM[] = [];
  const seen = new Set<string>();

  // Photos tag: only match explicit photo/image keywords, NOT "interior"
  const TAG_MAP: Array<{ pattern: RegExp; label: string; color: string }> = [
    { pattern: /legal|co |occupancy|permit|violation|registered/i, label: 'Legal', color: 'bg-violet-100 text-violet-700' },
    { pattern: /roof|drainage|leak/i, label: 'Roof', color: 'bg-amber-100 text-amber-700' },
    { pattern: /electrical|plumb|heating|boiler|system|mechanical|plumbing/i, label: 'Systems', color: 'bg-orange-100 text-orange-700' },
    { pattern: /basement|foundation|water|intrusion|drainage/i, label: 'Basement', color: 'bg-blue-100 text-blue-700' },
    { pattern: /rental|rent|income|lease|tenant|legal rent/i, label: 'Rent', color: 'bg-green-100 text-green-700' },
    { pattern: /flood|insurance|zone|windstorm|hurricane/i, label: 'Insurance', color: 'bg-blue-100 text-blue-700' },
    // Photos: only explicit photo/image keywords — NOT "interior" (which causes false matches on "interior square footage")
    { pattern: /\bphotos?\b|photo |photo-|interior photo|exterior photo|\bimages?\b|\bpictures?\b|\bvisuals?\b/i, label: 'Photos', color: 'bg-pink-100 text-pink-700' },
    { pattern: /monthly|cost|tax|hoa|maintenance|reserve|expense|utility/i, label: 'Costs', color: 'bg-teal-100 text-teal-700' },
    { pattern: /comparable|comp|sale|market.*value|price.*verdict/i, label: 'Price', color: 'bg-amber-100 text-amber-700' },
    { pattern: /days on market|market time|listed|262|hasn't sold/i, label: 'Market Time', color: 'bg-indigo-100 text-indigo-700' },
  ];

  const CORE_QUESTION_FAMILIES: Array<{ keywords: RegExp }> = [
    { keywords: /certificate of occupancy|legal two.?family|legal use|legal status/i },
    { keywords: /violations.*hpd|open permits.*violations|open permits.*hpd/i },
    { keywords: /violation|complaint|permit|open permit|dob|hpd/i },
    { keywords: /roof|drainage|leak/i },
    { keywords: /electrical|plumb|heating|boiler|system|mechanical|plumbing/i },
    { keywords: /basement|foundation|water|intrusion|drainage/i },
    { keywords: /rental|rent|income|lease|tenant|legal rent/i },
    { keywords: /flood|insurance|zone|windstorm|hurricane/i },
    { keywords: /monthly|cost|tax|hoa|maintenance|reserve|expense|utility/i },
    { keywords: /comparable|comp|sale|market.*value|price.*verdict/i },
    { keywords: /days on market|market time|listed|262|hasn't sold/i },
  ];

  const FALLBACKS = context?.fallbackQuestions ?? QUESTION_FALLBACKS;

  function getTag(text: string): { label: string; color: string } {
    for (const { pattern, label, color } of TAG_MAP) {
      if (pattern.test(text)) return { label, color };
    }
    return { label: 'General', color: 'bg-slate-100 text-slate-700' };
  }

  function addQuestion(text: string) {
    if (!text || text.length < 10 || seen.has(text)) return;
    if (!isValidQuestion(text)) return;
    seen.add(text);
    const { label, color } = getTag(text);
    results.push({ text, category: label, tagColor: color });
  }

  for (const q of questions) {
    // Support both new backend format ({ category, question }) and legacy ({ title, description })
    const title = toText(q.question ?? q.title ?? q.text ?? q.q ?? '');
    const desc = toText(q.description ?? '');
    const fullText = (desc.length > title.length ? desc : title).trim();
    if (!fullText) continue;
    if (/missing data|summary|overview|where to verify|things to verify|questions to ask/i.test(fullText)) continue;
    addQuestion(fullText);
  }

  // Family deduplication
  const seenFamilies = new Set<number>();
  const deduped: QuestionVM[] = [];
  for (const q of results) {
    let matchedFamily = -1;
    for (let fi = 0; fi < CORE_QUESTION_FAMILIES.length; fi++) {
      if (CORE_QUESTION_FAMILIES[fi].keywords.test(q.text.toLowerCase())) {
        matchedFamily = fi;
        break;
      }
    }
    if (matchedFamily >= 0 && seenFamilies.has(matchedFamily)) continue;
    if (matchedFamily >= 0) seenFamilies.add(matchedFamily);
    deduped.push(q);
  }

  // ── Fallback injection: use DYNAMIC generation for Basic mode ──────────────────
  // Basic mode fallback must know which fields are already known.
  // Build fallback questions per-topic based on what is missing.
  // Only inject when deduped questions are fewer than maxQuestions.
  if (deduped.length < maxQuestions) {
    const ctx = rawResult ? extractQuestionContext(rawResult) : null;

    if (ctx) {
      // Dynamic fallback generation: knows which fields are already confirmed
      const dynamicFallbacks = buildBasicQuestionFallbacks(ctx);
      for (const fq of dynamicFallbacks) {
        if (deduped.length >= maxQuestions) break;
        if (!seen.has(fq.text)) {
          seen.add(fq.text);
          deduped.push({ text: fq.text, category: fq.category, tagColor: fq.tagColor });
        }
      }
    } else {
      // Legacy: non-Basic or no result context — use static fallbacks
      const staticFallbacks = context?.fallbackQuestions ?? FALLBACKS;
      for (const qText of staticFallbacks) {
        if (deduped.length >= maxQuestions) break;
        if (!seen.has(qText)) {
          seen.add(qText);
          const { label, color } = getTag(qText);
          deduped.push({ text: qText, category: label, tagColor: color });
        }
      }
    }
  }

  return deduped.slice(0, maxQuestions);
}

// ── 顶层 viewModel 组装 ───────────────────────────────────────────────────────

export interface HeroVM {
  address: string;
  title: string;
  price: string | null;
  imageUrl: string | null;
  score: number | null;
  verdict: string;
  bottomLine: string;
  nextBestMove: string;
}

export interface SnapshotVM {
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  homeType: string;
  tax: string;
  hoa: string;
  daysOnMarket: string;
}

export interface ReportViewModel {
  hero: HeroVM;
  decisionCards: DecisionCardVM[];
  dealRisks: DealRiskVM[];
  snapshot: SnapshotVM;
  price: PriceVM;
  carryingCosts: CarryingCostVM;
  photos: PhotoAnalysisVM;
  spinDecoder: SpinDecoderVM[];
  fit: FitVM;
  questions: QuestionVM[];
  meta: {
    market: string;
    reportMode: string;
    sourceDomain?: string;
    isBasic: boolean;
    isNYC: boolean;
  };
  raw: any;
}

/**
 * buildReportViewModel — 结果页数据标准化入口
 * 把原始 result 转换为可稳定渲染的 viewModel.
 * normalizedReport is used to derive the isBasic flag — if not provided,
 * falls back to result.meta.isBasic.
 */
export function buildReportViewModel(
  result: any,
  listingInfo?: any,
  normalizedReport?: { meta?: { isBasic?: boolean } },
): ReportViewModel {
  const raw = result?.raw ?? result;

  // isBasic is the authoritative flag from the normalize layer
  const isBasic = normalizedReport?.meta?.isBasic ?? result?.meta?.isBasic ?? false;

  const heroAddr = preferRawFact(
    listingInfo?.address,
    result?.listingInfo?.address,
    raw?.listingOverview?.address,
    raw?.property_snapshot?.address,
  );
  const isNYC = /nyc|new york city|bronx|brooklyn|manhattan|queens|staten/i.test(
    heroAddr || ''
  );

  const imageUrls = extractImageUrls(raw);
  const photoVM = normalizePhotoAnalysis(
    raw?.spaceAnalysis ?? raw?.visualAnalysis ?? {},
    imageUrls,
  );
  const priceVM = normalizePriceCopy(raw?.price_assessment ?? raw?.priceAssessment ?? {});
  const costsVM = normalizeCarryingCosts(raw?.carrying_costs ?? raw?.carryingCosts ?? {});

  const spinRaw = raw?.listing_language_reality_check ?? raw?.listingLanguageRealityCheck ?? [];
  const spinVM = normalizeSpinDecoder(Array.isArray(spinRaw) ? spinRaw : [], { isNYC });

  const fitVM = normalizeFitSection(raw?.layout_fit ?? raw?.layoutFit ?? {});

  const questionsRaw = raw?.questions_to_ask ?? raw?.questionsToAsk ?? [];
  const questionsVM = normalizeQuestions(
    Array.isArray(questionsRaw) ? questionsRaw : [],
    { isNYC, maxQuestions: isBasic ? 5 : 8, result: raw },
  );

  const decisionCardsVM = normalizeDecisionCards(
    raw?.riskSignals ?? [],
    raw?.whatLooksGood ?? [],
    photoVM,
  );

  const dealRisksVM = normalizeDealRisks(
    raw?.potentialIssues ?? raw?.hiddenRisks ?? [],
    { isNYC },
  );

  const rawScore = raw?.overallScore ?? raw?.overall_score ?? null;

  // For Basic mode: trust the backend's already-normalized score and verdict.
  // The backend enforces evidence_score caps and recomputes verdict from score.
  // Do NOT recompute here — that would reintroduce inconsistencies.
  const effectiveScore = isBasic
    ? (raw?.overallScore ?? raw?.overall_score ?? raw?.evidence_score ?? 50)
    : rawScore;

  const effectiveVerdict = isBasic
    ? (raw?.verdict ?? evidenceVerdict(effectiveScore as number))
    : (raw?.verdict ?? raw?.overallVerdict ?? 'Review');

  const hero: HeroVM = {
    address: heroAddr,
    title: preferRawFact(listingInfo?.title, result?.listingInfo?.title, raw?.title ?? ''),
    price: preferRawFact(listingInfo?.price, result?.listingInfo?.price, null),
    imageUrl: imageUrls[0] ?? null,
    score: effectiveScore as number | null,
    verdict: effectiveVerdict,
    bottomLine: raw?.quickSummary ?? raw?.quick_summary ?? raw?.summary
      ?? MODULE_FALLBACKS.HERO_BOTTOM_LINE,
    nextBestMove: raw?.nextBestMove ?? raw?.next_step ?? MODULE_FALLBACKS.HERO_NEXT_BEST_MOVE_DEFAULT,
  };

  const snap = raw?.property_snapshot ?? {};
  const snapshot: SnapshotVM = {
    beds: preferRawFact(listingInfo?.bedrooms, snap?.beds),
    baths: preferRawFact(listingInfo?.bathrooms, snap?.baths),
    sqft: preferRawFact(snap?.sqft, snap?.squareFeet, snap?.sqft ?? snap?.square_feet),
    yearBuilt: snap?.yearBuilt ?? snap?.year_built ?? '',
    homeType: snap?.homeType ?? snap?.home_type ?? '',
    tax: snap?.annualTax ?? snap?.annual_tax
      ? fmtMoney(snap.annualTax ?? snap.annual_tax)
      : '',
    hoa: toText(snap?.hoa),
    daysOnMarket: snap?.daysOnMarket ?? snap?.days_on_market ?? snap?.date_listed ?? '',
  };

  return {
    hero,
    decisionCards: decisionCardsVM,
    dealRisks: dealRisksVM,
    snapshot,
    price: priceVM,
    carryingCosts: costsVM,
    photos: photoVM,
    spinDecoder: spinVM,
    fit: fitVM,
    questions: questionsVM,
    meta: {
      market: result?.meta?.market ?? 'US',
      reportMode: result?.meta?.reportMode ?? 'sale',
      sourceDomain: result?.meta?.sourceDomain,
      isBasic,
      isNYC,
    },
    raw,
  };
}
