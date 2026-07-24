// ===== US Rent Adapter =====
// Converts US Rent Step 2 output → NormalizedReport with 16 sections.
//
// When the backend persists a `room_rental_facts` object inside the result
// (only ever set for `effectiveReportMode === 'rent'` + `objectKind === 'room'`
// after `isStructuredListingValid` from ./reportMode.ts succeeds), we treat its
// deterministic fields as authoritative and let them override the equivalent
// AI free-text fields inside the `rental-snapshot` and `rent-true-cost`
// sections. Everything else (highlights, photo review, lease terms, etc.) is
// left untouched so non-room apartments are unaffected.

import type { NormalizedReport, HeroData, HighlightsData, QuickFact, ReportSection, SectionItem } from './types';
import { MODULE_FALLBACKS } from './Fallbacks';
import { hasInteriorPhotos } from './interiorPhotos';

type USRentResult = any;

// ---- deterministic room-rental facts -------------------------------------------------

interface RoomRentalFacts {
  source: 'zillow_structured';
  sourceVersion: string;
  capturedAt: string | null;
  hasPrivateBath: boolean;
  advertisedEffectiveRent: number | null;
  leaseTerm: string | null;
  requiredMonthlyFees: number | null;
  averageMonthlyTotal: number | null;
  parkingSpaces: number | null;
  parkingTenantAllocated: false;
  moveInReady: boolean | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  utilitiesIncluded: string[] | null;
  notes: string[];
}

function readRoomRentalFacts(result: USRentResult): RoomRentalFacts | null {
  const candidate = result?.room_rental_facts;
  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.source !== 'zillow_structured') return null;
  return candidate as RoomRentalFacts;
}

function formatMoney(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return `$${n.toLocaleString('en-US')}`;
}

function buildParkingText(facts: RoomRentalFacts): string {
  const n = facts.parkingSpaces;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return `${n} property-level spaces advertised — tenant allocation not confirmed`;
  }
  return 'Not confirmed';
}

// Renter fallback shown when every model-provided Bottom Line candidate was
// poisoned with sale-flavored phrases. Sourced from Fallbacks.ts so all renter
// copy lives in one place.
//
// TODO [v1.0.6 — Bug 2 follow-up]: When the extension extraction pipeline
// starts sending lease term / application fee / pet policy / utilities /
// qualification requirements through, replace this generic fallback with a
// per-field list that names which lease details the LLM confirmed and which
// it could not verify. Tracking plan:
//   - src/content/extractors/zillow.ts → add 12 fields to ZillowRawData +
//     parseLeaseDetails() extractor
//   - extension/background.js → forward leaseTerm/applicationFee/petPolicy/
//     tenantPays/landlordPays/utilitiesIncluded/qualificationRequirements/
//     securityDeposit/holdingDeposit in optionalDetails (line 783-865, 1028-1107)
//   - supabase/functions/analyze/index.ts → mirror each field into
//     property_snapshot (line 6850-6877)
// See plan: c:\Users\47201\.cursor\plans\fix_rent_report_blocking_bugs_3fc7dec1.plan.md
const RENT_BOTTOM_LINE_FALLBACK = MODULE_FALLBACKS.RENT_BOTTOM_LINE_FALLBACK;

// ── safe text helpers ─────────────────────────────────────────────────────────

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
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

function evidenceLabel(v: unknown): string {
  const t = toText(v);
  return t || 'Not Disclosed / Cannot Verify';
}

// ── hero ─────────────────────────────────────────────────────────────────────

// Score-to-verdict mapping (used by both hero and rental-score section).
// Ensures verdict is always consistent with the numeric score.
//
// Thresholds must match the canonical 4-tier mapping in reportViewModel.ts
// `evidenceVerdict()` and the backend recompute in analyze/index.ts:
//   score >= 80 → "Enough to Review"
//   score >= 60 → "Review With Caution"
//   score >= 40 → "Need More Evidence"
//   score <  40 → "High Uncertainty"
function scoreVerdict(score: number | null | undefined): string {
  if (score == null) return 'Not enough data';
  if (score >= 80) return 'Enough to Review';
  if (score >= 60) return 'Review With Caution';
  if (score >= 40) return 'Need More Evidence';
  return 'High Uncertainty';
}

function buildHero(result: USRentResult): HeroData {
  const monthlyRent = toText(
    result.rental_snapshot?.monthly_rent ??
    result.listingInfo?.monthlyRent ??
    result.monthlyRent ??
    ''
  );
  const numericScore = result.overallScore ?? result.score;
  return {
    title: toText(result.listingInfo?.title ?? result.title ?? ''),
    address: toText(result.listingInfo?.address ?? result.address ?? ''),
    score: numericScore != null && numericScore !== '' ? Number(numericScore) || null : null,
    verdict: (() => {
      // If AI verdict is a real quality signal (not the generic "Need More Evidence"),
      // use it. Otherwise fall back to score-based verdict so score and verdict are consistent.
      const aiVerdict = toText(result.rental_listing_score?.verdict ?? '');
      if (aiVerdict && aiVerdict !== 'Need More Evidence') return aiVerdict;
      return scoreVerdict(numericScore);
    })(),
    confidence: toText(result.confidenceLevel ?? result.confidence_level ?? ''),
    summary: sanitizeRentFinalLine(
      result.bottom_line,
      result.quick_summary ?? result.quickSummary ?? result.summary,
      RENT_BOTTOM_LINE_FALLBACK,
    ),
    primaryLabel: monthlyRent ? `Rent: ${monthlyRent}` : undefined,
  };
}

// ── quick facts (from rental_snapshot, with room_rental_facts override) ──

function buildQuickFacts(result: USRentResult): QuickFact[] {
  const snap = result.rental_snapshot ?? {};
  const facts: QuickFact[] = [];
  const add = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) facts.push({ label, value: t });
  };

  const roomFacts = readRoomRentalFacts(result);
  if (roomFacts) {
    // For room rentals the monthly rent label must read "Advertised Effective Rent".
    const rentText = roomFacts.advertisedEffectiveRent != null
      ? `${formatMoney(roomFacts.advertisedEffectiveRent)}/mo`
      : 'Not confirmed';
    add('Advertised Effective Rent', rentText);
  } else {
    add('Monthly Rent', snap.monthly_rent);
  }
  add('Security Deposit', snap.security_deposit);
  add('Lease Term', snap.lease_term);
  add('Available', snap.available_date);
  add('Beds', snap.beds);
  add('Baths', snap.baths);
  add('Sqft', snap.sqft);
  add('Property Type', snap.property_type);
  add('Heating/Cooling', snap.heating_cooling);
  add('Laundry', snap.laundry);
  if (!roomFacts) add('Parking', snap.parking);
  add('Pet Policy', snap.pet_policy);
  const incl = Array.isArray(snap.included_utilities) ? snap.included_utilities.filter((x: unknown): x is string => typeof x === 'string').join(', ') : '';
  if (incl) facts.push({ label: 'Utilities Included', value: incl });
  if (roomFacts) {
    add('Parking', buildParkingText(roomFacts));
  }
  return facts;
}

// ── highlights (rent_fairness + listing trust + risk) ────────────────────────

function buildHighlights(result: USRentResult): HighlightsData {
  const stringArr = (v: unknown): string[] =>
    (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      .filter((s) => !matchesAny(s, RENT_SALE_FLAVORED_PHRASES));
  const fair = result.rent_fairness ?? {};
  const trust = result.rental_listing_trust ?? {};
  return {
    pros: [
      ...stringArr(result.whatLooksGood),
      ...stringArr(result.pros),
      ...stringArr(result.property_strengths),
    ],
    cons: [
      ...stringArr(result.cons),
      ...stringArr(result.potential_issues),
    ],
    risks: [
      ...stringArr(result.riskSignals),
      ...stringArr(result.risks),
      ...(toText(fair.verdict) ? [`Rent fairness: ${toText(fair.verdict)}`] : []),
      ...stringArr(trust.concerns),
    ],
  };
}

// ── risk_categories severity helper ──────────────────────────────────────────

function severityOf(level: string | undefined): 'low' | 'medium' | 'high' | undefined {
  if (!level) return undefined;
  const l = level.toUpperCase();
  if (l === 'LOW') return 'low';
  if (l === 'MODERATE' || l === 'MEDIUM') return 'medium';
  if (l === 'HIGH' || l === 'CRITICAL') return 'high';
  return undefined;
}

// ── Buyer-flavored phrase patterns (rent prompts forbid these) ────────────────
// Aligned with US_STEP2_RENT_PROMPT (us-prompts.ts L734) and
// STEP1_RENT_SYSTEM_PROMPT (us-prompts.ts L977). Matched as PHRASES with word
// boundaries so that renter-OK phrases like "rent a condo" / "unit on a slab"
// / "bathroom fan" / "let the landlord know" are NOT dropped.
//
// Two categories:
//   - DROP entirely (sale-flavored): ownership, financing, resale, buy/sell advice
//   - KEEP (renter-relevant): habitability, water intrusion, egress, legality
//
// We split the global check into two so other adapters can reuse the same list.
const RENT_SALE_FLAVORED_PHRASES: RegExp[] = [
  // Ownership / sale / buying advice
  /\broof\s*age\b/i,
  /\broof\s*replacement\b/i,
  /\b(roof|foundation)\s*condition\b/i,
  /\bnegotiate\s+(the\s+)?(price|offer|repair)\b/i,
  /\bmake\s+an?\s+offer\b/i,
  /\bbuyer'?s?\s+(market|advisor|agent|pool|remorse)\b/i,
  /\bresale\s+value\b/i,
  /\bresale\s+potential\b/i,
  /\bfuture\s+resale\b/i,
  /\b(comparable|comp)\s+sales?\b/i,
  /\bcomps?\b/i,
  /\bschool\s+district\s+resale\b/i,
  /\b(mortgage|financing|down\s+payment|interest\s+rate)\b/i,
  /\b(seller|landlord)\s+disclosure\b/i,
  /\bseller\s+financing\b/i,
  /\bHOA\s+reserve\s+study\b/i,
  /\bspecial\s+assessment\b/i,
  /\bhoa\s+reserve\b/i,
  /\b(capital|cap)\s+rate\b/i,
  /\bcash[\s-]*on[\s-]*cash\s+return\b/i,
  /\bcap\s+rate\b/i,
  /\bROI\b/i,
  /\bproperty\s+tax(es)?\s+(amount|projection|liability|burden|impact|exposure)\b/i,
  /\bclosing\s+costs?\b/i,
  /\bseller'?s?\s+market\b/i,
  /\binvestor\s+mindset\b/i,
  /\bflip\s+tax\b/i,
  /\bbuy\s+down\s+rate\b/i,
];

// Renter-relevant phrases — these mention roof/foundation/permit/egress but in
// a tenant-safety or habitability context and MUST be preserved. The phrase-
// level filter below drops ONLY SALE-FLAVORED sentences (ownership, financing,
// resale, comps, make-an-offer, mortgage, etc.); renter-relevant phrases like
// "roof leak", "water intrusion", "bedroom egress", "in-law unit" are kept
// because they fall outside the SALE_FLAVORED patterns. This list is
// documented for future reference and to keep prompt-level prohibition
// (`us-prompts.ts:734/977`) in sync with adapter behavior.
//
//   /\b(roof|window)\s+leak(s|ing)?\b/i,
//   /\bwater\s+(intrusion|damage|seepage)\b/i,
//   /\bbasement\s+flood(ing)?\b/i,
//   /\bbasement\s+(moisture|mold)\b/i,
//   /\b(mold|mildew)\b/i,
//   /\bbedroom\s+egress\b/i,
//   /\begress\s+window\b/i,
//   /\b(egress|exit)\s+(requirement|compliance|blocked)\b/i,
//   /\bsecond\s+kitchen\b/i,
//   /\bin[\s-]*law\s+unit\b/i,
//   /\bbasement\s+apartment\b/i,
//   /\b(units?|apartment)\s+with(out)?\s+permit/i,
//   /\bcode\s+violation\b/i,

// Legacy compact list — used by `containsForbidden` for "drop whole field" checks.
// Kept for backwards compat with safeDescription() callers.
const RENT_FORBIDDEN_KEYWORDS = [
  'roof',
  'foundation',
  'seller disclosure',
  'renovation permit',
  'hoa reserve',
  'special assessment',
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  if (!text) return false;
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
}

function containsForbidden(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return RENT_FORBIDDEN_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Drop the entire field if ANY sale-flavored phrase is present.
 * Used for fields where one bad sentence poisons the whole value
 * (e.g. free-form description paragraphs, long-form summary).
 */
function safeDescription(...candidates: unknown[]): string {
  for (const c of candidates) {
    const t = toText(c);
    if (
      t &&
      !containsForbidden(t) &&
      !matchesAny(t, RENT_SALE_FLAVORED_PHRASES)
    ) {
      return t;
    }
  }
  return '';
}

/**
 * Strip sale-flavored phrases from a string while keeping the rest. Used for
 * the headline Bottom Line — we don't want to lose the renter-relevant
 * information, but we don't want buyer-flavored clauses either.
 *
 * Strategy:
 *   1. Split into sentences on [.!?]+ (preserves capitalization hint).
 *   2. Drop any sentence whose lowercase form matches RENT_SALE_FLAVORED_PHRASES.
 *   3. Join remaining sentences.
 *   4. If everything was dropped, return '' so caller can fall back.
 */
function stripSaleFlavoredSentences(text: string): string {
  if (!text) return '';
  // Split on sentence terminators, keeping them with the sentence.
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return '';
  const kept = sentences.filter(
    (s) => !matchesAny(s, RENT_SALE_FLAVORED_PHRASES),
  );
  return kept.join(' ').trim();
}

/**
 * Phrase-level sanitizer for the Bottom Line / hero.summary field. Tries:
 *   1. Clean `bottom_line` by stripping sale-flavored sentences.
 *   2. If that yields empty, try `quick_summary` with the same strip.
 *   3. If still empty, return the renter fallback so the section is never blank.
 */
function sanitizeRentFinalLine(
  bottomLine: unknown,
  quickSummary: unknown,
  fallback: string,
): string {
  const cleanedBL = stripSaleFlavoredSentences(toText(bottomLine));
  if (cleanedBL) return cleanedBL;
  const cleanedQS = stripSaleFlavoredSentences(toText(quickSummary));
  if (cleanedQS) return cleanedQS;
  return fallback;
}

// ── sections ────────────────────────────────────────────────────────────────

function buildSections(result: USRentResult): ReportSection[] {
  const sections: ReportSection[] = [];

  // 1. rental-score — Verdict is always score-derived (not AI free-text)
  const score = result.rental_listing_score ?? {};
  const numericScore = result.overallScore ?? result.score;
  const scoreItems: SectionItem[] = [];
  scoreItems.push({ title: 'Verdict', value: scoreVerdict(numericScore) });
  if (typeof numericScore === 'number' || (numericScore != null && numericScore !== '')) {
    scoreItems.push({ title: 'Score', value: String(numericScore) });
  }
  if (score.reason) scoreItems.push({ title: 'Reason', description: toText(score.reason) });
  if (scoreItems.length > 0) {
    sections.push({ id: 'rental-score', title: 'Rental Listing Score', subtitle: 'Is this listing worth your time?', items: scoreItems });
  }

  // ── Bottom Line ──────────────────────────────────────────────────────────────
  // NOTE: we intentionally DO NOT emit a 'bottom-line' section here.
  // The bottom line is placed in hero.summary and shown via HeroSection's
  // rentHeadline (NewReportUI.tsx). Emitting it as a second section would
  // cause the same text to appear twice in the rent report layout.
  // The hero card at the top already shows the Bottom Line.


  // 3. rental-snapshot (room_rental_facts override when present)
  const snap = result.rental_snapshot ?? {};
  const snapItems: SectionItem[] = [];
  const snapField = (label: string, val: unknown) => {
    const t = toText(val);
    if (t) snapItems.push({ title: label, value: t });
  };
  const roomFacts = readRoomRentalFacts(result);
  if (roomFacts) {
    // Room rental path: monthly rent label reads "Advertised Effective Rent".
    if (roomFacts.advertisedEffectiveRent != null) {
      snapField('Advertised Effective Rent', `${formatMoney(roomFacts.advertisedEffectiveRent)}/mo`);
    } else {
      snapField('Advertised Effective Rent', 'Not confirmed');
    }
    if (roomFacts.leaseTerm) snapField('Lease Term', roomFacts.leaseTerm);
    snapField('Parking', buildParkingText(roomFacts));
    snapField('Private Bath', roomFacts.hasPrivateBath ? 'Yes' : 'No');
    if (typeof roomFacts.moveInReady === 'boolean') {
      snapField('Move-In Ready', roomFacts.moveInReady ? 'Yes' : 'No');
    }
    if (roomFacts.utilitiesIncluded && roomFacts.utilitiesIncluded.length > 0) {
      snapField('Utilities Included', roomFacts.utilitiesIncluded.join(', '));
    }
  } else {
    snapField('Monthly Rent', snap.monthly_rent);
    snapField('Security Deposit', snap.security_deposit);
    snapField('Lease Term', snap.lease_term);
    snapField('Available Date', snap.available_date);
    snapField('Beds / Baths / Sqft', [snap.beds, snap.baths, snap.sqft].filter(Boolean).join(' / '));
    if (Array.isArray(snap.included_utilities) && snap.included_utilities.length > 0) {
      snapItems.push({ title: 'Utilities Included', value: snap.included_utilities.filter((x: unknown): x is string => typeof x === 'string').join(', ') });
    }
    snapField('Parking', snap.parking);
    snapField('Pet Policy', snap.pet_policy);
    snapField('Building', snap.building_name);
    snapField('Property Type', snap.property_type);
    snapField('Unit', snap.exact_unit);
    snapField('Management', snap.management_company);
    snapField('Contact', snap.contact_information);
    snapField('Laundry', snap.laundry);
    snapField('Heating / Cooling', snap.heating_cooling);
    if (Array.isArray(snap.amenities) && snap.amenities.length > 0) {
      snapItems.push({ title: 'Amenities', value: snap.amenities.filter((x: unknown): x is string => typeof x === 'string').join(', ') });
    }
    if (snap.source_status) {
      snapItems.push({ title: 'Source Quality', value: toText(snap.source_status), badge: toText(snap.source_status) });
    }
  }
  if (snapItems.length > 0) {
    sections.push({ id: 'rental-snapshot', title: 'Rental Snapshot', subtitle: 'What the listing tells you up front', items: snapItems });
  }

  // 4. what-could-change-decision
  const wccd = Array.isArray(result.what_could_change_decision) ? result.what_could_change_decision : [];
  const wccdItems: SectionItem[] = [];
  for (const item of wccd) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const rawTitle = toText(obj.title);
    if (!rawTitle) continue;
    // Drop the whole item if its title is poisoned with sale-flavored phrases
    // (e.g. "Verify roof age before offering"). Items themselves are short
    // structured strings, so dropping the item is safer than rewriting.
    if (matchesAny(rawTitle, RENT_SALE_FLAVORED_PHRASES)) continue;
    const evidence = evidenceLabel(obj.evidence);
    const why = safeDescription(obj.why_it_matters, obj.description);
    const action = toText(obj.action);
    const desc = [why, action].filter(Boolean).join(' · ');
    wccdItems.push({ title: rawTitle, description: desc || why, badge: evidence, action: action || undefined });
  }
  if (wccdItems.length > 0) {
    sections.push({ id: 'what-could-change-decision', title: 'What Could Change Your Decision', subtitle: 'Things to verify before you commit', items: wccdItems });
  }

  // 5. rental-listing-trust
  const trust = result.rental_listing_trust ?? {};
  const trustItems: SectionItem[] = [];
  if (trust.source_consistency) trustItems.push({ title: 'Source Consistency', value: toText(trust.source_consistency), badge: toText(trust.source_consistency) });
  if (trust.signal_source_breakdown && typeof trust.signal_source_breakdown === 'object') {
    for (const [k, v] of Object.entries(trust.signal_source_breakdown as Record<string, unknown>)) {
      trustItems.push({ title: k, value: toText(v) });
    }
  }
  if (Array.isArray(trust.concerns)) {
    for (const c of trust.concerns) {
      if (typeof c !== 'string') continue;
      if (matchesAny(c, RENT_SALE_FLAVORED_PHRASES)) continue;
      trustItems.push({ title: c, description: c });
    }
  }
  if (trustItems.length > 0) {
    sections.push({ id: 'rental-listing-trust', title: 'Rental Listing Trust', subtitle: 'How consistent is the listing itself', items: trustItems });
  }

  // 6. availability-check
  const av = result.availability_check ?? {};
  const avItems: SectionItem[] = [];
  if (av.status) avItems.push({ title: 'Status', value: toText(av.status), badge: toText(av.status) });
  if (av.available_date) avItems.push({ title: 'Available Date', value: toText(av.available_date) });
  if (av.lead_time) avItems.push({ title: 'Lead Time', value: toText(av.lead_time) });
  if (Array.isArray(av.caveats)) {
    for (const c of av.caveats) avItems.push({ title: toText(c), description: toText(c) });
  }
  if (avItems.length > 0) {
    sections.push({ id: 'availability-check', title: 'Availability Check', subtitle: 'Live status from the listing only', items: avItems });
  }

  // 7. rent-true-cost (rent_fairness + recurring_monthly_costs; room_rental_facts override)
  const fair = result.rent_fairness ?? {};
  const recur = result.recurring_monthly_costs ?? {};
  const trueCostItems: SectionItem[] = [];
  const roomFactsTC = readRoomRentalFacts(result);
  if (roomFactsTC) {
    // Authoritative room-rental True Cost. We never derive regular paid-month
    // rent here — that requires promotionText / description re-extraction, which
    // is out of scope.
    const rentText = roomFactsTC.advertisedEffectiveRent != null
      ? `${formatMoney(roomFactsTC.advertisedEffectiveRent)}/mo`
      : 'Not confirmed';
    trueCostItems.push({ title: 'Advertised Effective Rent', value: rentText });
    const feesText = roomFactsTC.requiredMonthlyFees != null
      ? `${formatMoney(roomFactsTC.requiredMonthlyFees)}/mo (included in advertised rent)`
      : 'Not confirmed — fees may apply on top of advertised rent';
    trueCostItems.push({ title: 'Required Monthly Fees', value: feesText });
    const totalText = roomFactsTC.averageMonthlyTotal != null
      ? `${formatMoney(roomFactsTC.averageMonthlyTotal)}/mo (average of advertised rent + required fees)`
      : null;
    if (totalText !== null) {
      trueCostItems.push({ title: 'Average Monthly Total', value: totalText });
    }
    const parkingText = buildParkingText(roomFactsTC);
    trueCostItems.push({ title: 'Parking', value: parkingText });
    if (roomFactsTC.utilitiesIncluded && roomFactsTC.utilitiesIncluded.length > 0) {
      trueCostItems.push({ title: 'Utilities Included', value: roomFactsTC.utilitiesIncluded.join(', ') });
    } else {
      trueCostItems.push({ title: 'Utilities Included', value: 'Not confirmed — utilities may be billed separately' });
    }
    if (roomFactsTC.notes && roomFactsTC.notes.length > 0) {
      trueCostItems.push({ title: 'Notes', description: roomFactsTC.notes.join(' · ') });
    }
  } else {
    if (fair.asking_rent) trueCostItems.push({ title: 'Asking Rent', value: toText(fair.asking_rent) });
    if (fair.rent_zestimate) trueCostItems.push({ title: 'Rent Zestimate', value: toText(fair.rent_zestimate) });
    if (fair.comparable_signal) trueCostItems.push({ title: 'Comparable Signal', value: toText(fair.comparable_signal) });
    if (fair.verdict) {
      trueCostItems.push({ title: 'Verdict', value: toText(fair.verdict), badge: toText(fair.verdict) });
    }
    if (fair.evidence_quality) trueCostItems.push({ title: 'Evidence', value: toText(fair.evidence_quality), badge: toText(fair.evidence_quality) });
    if (fair.explanation) trueCostItems.push({ title: 'Explanation', description: toText(fair.explanation) });
    if (Array.isArray(recur.items)) {
      for (const it of recur.items) {
        const o = (it ?? {}) as Record<string, unknown>;
        const desc = [toText(o.amount) ? `$${toText(o.amount)}` : '', toText(o.notes)].filter(Boolean).join(' — ');
        trueCostItems.push({ title: toText(o.name), value: toText(o.amount), description: desc, badge: evidenceLabel(o.evidence) });
      }
    }
    if (recur.total_recurring_estimate) trueCostItems.push({ title: 'Total Recurring / mo (est.)', value: toText(recur.total_recurring_estimate) });
  }
  if (trueCostItems.length > 0) {
    sections.push({ id: 'rent-true-cost', title: 'Rent & True Cost', subtitle: 'Monthly rent + recurring fees', items: trueCostItems });
  }

  // 8. application-payment-risk
  const risk = result.application_payment_risk ?? {};
  const riskItems: SectionItem[] = [];
  if (risk.application_fee) {
    const af = risk.application_fee as Record<string, unknown>;
    riskItems.push({ title: 'Application Fee', value: toText(af.amount), badge: evidenceLabel(af.evidence) });
  }
  if (risk.refundability) {
    const rf = risk.refundability as Record<string, unknown>;
    riskItems.push({ title: 'Refundability', value: toText(rf.status), badge: toText(rf.status) });
  }
  if (risk.deposit) {
    const d = risk.deposit as Record<string, unknown>;
    riskItems.push({ title: 'Deposit', value: toText(d.amount), description: toText(d.conditions) || undefined, badge: evidenceLabel(d.evidence) });
  }
  if (risk.payment_timing) {
    const pt = risk.payment_timing as Record<string, unknown>;
    riskItems.push({ title: 'Payment Timing', description: toText(pt.summary), badge: evidenceLabel(pt.evidence) });
  }
  if (risk.payment_recipient) {
    const pr = risk.payment_recipient as Record<string, unknown>;
    riskItems.push({ title: 'Payment Recipient', value: toText(pr.name), badge: evidenceLabel(pr.evidence) });
  }
  if (risk.payment_method) {
    const pm = risk.payment_method as Record<string, unknown>;
    const accepted = Array.isArray(pm.accepted) ? pm.accepted.filter((x: unknown): x is string => typeof x === 'string').join(', ') : '';
    riskItems.push({ title: 'Payment Method', value: accepted, badge: evidenceLabel(pm.evidence) });
  }
  if (risk.qualification_requirements) {
    const qr = risk.qualification_requirements as Record<string, unknown>;
    const items = Array.isArray(qr.items) ? qr.items.filter((x: unknown): x is string => typeof x === 'string') : [];
    if (items.length > 0) riskItems.push({ title: 'Qualification Requirements', value: items.join(', '), badge: evidenceLabel(qr.evidence) });
  }
  if (risk.guarantor_policy) {
    const gp = risk.guarantor_policy as Record<string, unknown>;
    riskItems.push({ title: 'Guarantor Policy', value: toText(gp.summary), badge: evidenceLabel(gp.evidence) });
  }
  if (risk.advance_payment_or_pressure_signals) {
    const ap = risk.advance_payment_or_pressure_signals as Record<string, unknown>;
    const items = Array.isArray(ap.items) ? ap.items.filter((x: unknown): x is string => typeof x === 'string') : [];
    if (items.length > 0) riskItems.push({ title: 'Pressure / Advance Signals', description: items.join(' · '), badge: evidenceLabel(ap.evidence) });
  }
  if (risk.risk_level) {
    riskItems.push({ title: 'Risk Level', value: toText(risk.risk_level), badge: toText(risk.risk_level), severity: severityOf(toText(risk.risk_level)) });
  }
  if (risk.explanation) {
    const explanation = stripSaleFlavoredSentences(toText(risk.explanation));
    if (explanation) riskItems.push({ title: 'Explanation', description: explanation });
  }
  if (Array.isArray(risk.questions)) {
    for (const q of risk.questions) {
      const t = toText(q);
      if (!t || matchesAny(t, RENT_SALE_FLAVORED_PHRASES)) continue;
      riskItems.push({ title: t, description: t });
    }
  }
  if (riskItems.length > 0) {
    sections.push({ id: 'application-payment-risk', title: 'Application & Payment Risk', subtitle: 'How money moves — and where the risk sits', items: riskItems, tone: 'warning' });
  }

  // 9. lease-terms-rules
  const lt = result.lease_terms ?? {};
  const ltItems: SectionItem[] = [];
  if (lt.lease_term) ltItems.push({ title: 'Lease Term', value: toText(lt.lease_term) });
  if (lt.early_termination) ltItems.push({ title: 'Early Termination', value: toText(lt.early_termination) });
  if (lt.renewal_terms) ltItems.push({ title: 'Renewal', value: toText(lt.renewal_terms) });
  if (lt.deposit_terms) ltItems.push({ title: 'Deposit Terms', value: toText(lt.deposit_terms) });
  if (Array.isArray(lt.restrictions)) {
    for (const r of lt.restrictions) {
      const t = toText(r);
      if (!t || matchesAny(t, RENT_SALE_FLAVORED_PHRASES)) continue;
      ltItems.push({ title: t, description: t });
    }
  }
  if (lt.evidence_quality) ltItems.push({ title: 'Evidence', value: toText(lt.evidence_quality), badge: toText(lt.evidence_quality) });
  if (ltItems.length > 0) {
    sections.push({ id: 'lease-terms-rules', title: 'Lease Terms & Rules', subtitle: 'What you sign up for', items: ltItems });
  }

  // 10. location-daily-life
  const loc = result.location_daily_life ?? {};
  const locItems: SectionItem[] = [];
  if (loc.commute_access) locItems.push({ title: 'Commute Access', value: toText(loc.commute_access) });
  if (Array.isArray(loc.noise_concerns)) {
    for (const n of loc.noise_concerns) locItems.push({ title: 'Noise Concern', description: toText(n) });
  }
  if (Array.isArray(loc.daily_amenities)) {
    for (const n of loc.daily_amenities) locItems.push({ title: toText(n), description: toText(n) });
  }
  if (loc.weather_or_seasonal) locItems.push({ title: 'Weather / Seasonal', value: toText(loc.weather_or_seasonal) });
  if (loc.evidence_quality) locItems.push({ title: 'Evidence', value: toText(loc.evidence_quality), badge: toText(loc.evidence_quality) });
  if (locItems.length > 0) {
    sections.push({ id: 'location-daily-life', title: 'Location & Daily Life Check', subtitle: 'What the area feels like day-to-day', items: locItems });
  }

  // 11. photo-habitability
  const photo = result.photo_habitability_review ?? {};
  const description = result.listingInfo?.description ?? (result as any).raw?.listingInfo?.description ?? '';
  const listingSaysPrivateYard = /private\s*yard/i.test(description);

  // ── Cross-check three sources for interior photo evidence ────────────────────
  // Bug fix: previously the "No interior photos available" fallback fired
  // whenever the Step 2 evidence array was empty, even when Step 1 had
  // detected kitchen / bedroom / etc. The result was two contradictory
  // cards rendered side-by-side. Now we consult all three sources and only
  // show the fallback when ALL three are empty.
  const imageUrlsArr: unknown[] = Array.isArray(result.imageUrls)
    ? (result.imageUrls as unknown[])
    : Array.isArray((result as any).raw?.imageUrls)
      ? ((result as any).raw.imageUrls as unknown[])
      : [];
  const photoHabitabilityReview = result.photo_habitability_review ?? {};
  const hasAnyInteriorPhotos = hasInteriorPhotos({
    step1Areas: (result as any).spaceAnalysis?.areas,
    step1DetectedAreas: (result as any).spaceAnalysis?.detectedAreas
      ?? (result as any).visualAnalysis?.detectedAreas,
    photoReview: (result as any).photoReview ?? (result as any).raw?.photoReview,
    visualAnalysis: (result as any).visualAnalysis ?? (result as any).raw?.visualAnalysis,
    photoHabitabilityReview: {
      unit_specific_evidence: photoHabitabilityReview.unit_specific_evidence,
      habitability_signals: photoHabitabilityReview.habitability_signals,
    },
    imageUrls: imageUrlsArr,
  });

  // Collect raw photo items, then filter buyer-flavored entries
  const photoItemsRaw: SectionItem[] = [];
  if (Array.isArray(photo.unit_specific_evidence)) {
    for (const u of photo.unit_specific_evidence) {
      const t = toText(u);
      if (t && !containsForbidden(t)) photoItemsRaw.push({ title: t, description: t });
    }
  }
  if (photo.model_home_or_staging_likelihood) {
    photoItemsRaw.push({ title: 'Model Home / Staging Likelihood', value: toText(photo.model_home_or_staging_likelihood) });
  }
  if (Array.isArray(photo.habitability_signals)) {
    for (const h of photo.habitability_signals) {
      const t = toText(h);
      if (t && !containsForbidden(t)) photoItemsRaw.push({ title: t, description: t });
    }
  }
  if (Array.isArray(photo.missing_views)) {
    for (const m of photo.missing_views) photoItemsRaw.push({ title: toText(m), description: toText(m) });
  }

  // P1-3: drop roof/foundation "Can't Tell From Photos" items (buyer-flavored for renters)
  const photoItems: SectionItem[] = photoItemsRaw.filter((it) => {
    const text = `${it.title ?? ''} ${it.description ?? ''}`.toLowerCase();
    if (/photos do not show the condition of the roof/i.test(text)) return false;
    if (/photos do not show the condition of the foundation/i.test(text)) return false;
    return true;
  });

  // P1-4: override generic "confirm if yard is private or shared" when listing already says it
  if (listingSaysPrivateYard) {
    // Remove ALL garden-variety yard-shared/private phrasing — LLM output
    // varies too much to enumerate every verb. Drop anything that:
    //   (a) says the yard might be shared / not exclusively assigned, OR
    //   (b) asks the user to verify/confirm/determine/check yard status
    // once the listing already says "private yard".
    const yardDoubtRegex = new RegExp(
      [
        // Generic "confirm/verify/determine/check ... yard ... private/shared/exclusive"
        '\\b(confirm|verify|determine|check|clarify)\\b[\\s\\S]{0,80}?\\byard\\b[\\s\\S]{0,80}?\\b(private|shared|exclusiv)',
        // "Photos do not show whether the yard is shared / exclusively assigned"
        '\\bphotos?\\b[\\s\\S]{0,80}?\\byard\\b[\\s\\S]{0,80}?\\b(shared|exclusiv|assigned)',
        // "Yard may be shared with neighbors / other units"
        '\\byard\\b[\\s\\S]{0,80}?\\b(shared|not\\s+exclusiv|may\\s+be\\s+shared)',
      ].join('|'),
      'i',
    );
    // Walk in reverse so each splice doesn't shift later indexes.
    for (let i = photoItems.length - 1; i >= 0; i--) {
      if (yardDoubtRegex.test(`${photoItems[i].title ?? ''} ${photoItems[i].description ?? ''}`)) {
        photoItems.splice(i, 1);
      }
    }
    // Insert listing-accurate statement at the start of the exterior group
    const firstExteriorIdx = photoItems.findIndex(
      (it) => /exterior|rear exterior|side view/i.test(it.title ?? ''),
    );
    const accurateItem: SectionItem = {
      title: 'Private Yard',
      description:
        'The listing describes the yard as private, but the photos do not prove whether it is exclusively assigned to this unit.',
    };
    if (firstExteriorIdx !== -1) {
      photoItems.splice(firstExteriorIdx, 0, accurateItem);
    } else {
      photoItems.unshift(accurateItem);
    }
  }

  // P1-3: add renter-priority defaults when filtered list is empty AND we have
  // no evidence that any interior photos exist at all. Otherwise the fallback
  // contradicts the visual analysis cards the rest of the report is showing.
  if (photoItems.length === 0 && !hasAnyInteriorPhotos && imageUrlsArr.length === 0) {
    photoItems.push(
      {
        title: 'No interior photos available',
        description: 'No kitchen, bathroom, bedroom, or living room photos were detected. Ask for a full photo set before scheduling a tour.',
      },
      {
        title: 'Ask about heating costs',
        description: 'Confirm which heating type (electric baseboard, gas, oil) and ask for average monthly heating costs.',
      },
      {
        title: 'Check window seals',
        description: 'Verify all windows close and lock properly; drafty windows increase heating costs.',
      },
    );
  }

  if (photoItems.length > 0) {
    sections.push({ id: 'photo-habitability', title: 'Photo & Habitability Review', subtitle: 'What photos tell you about the actual unit', items: photoItems });
  }

  // 12. rental-risk-categories (STRICT four keys, no location)
  const rc = result.risk_categories ?? {};
  const rcLabels: Record<string, string> = {
    listing_trust: 'Listing Trust',
    availability: 'Availability',
    costs_and_payment: 'Costs & Payment',
    habitability_and_lease: 'Habitability & Lease',
  };
  const rcItems: SectionItem[] = [];
  for (const key of ['listing_trust', 'availability', 'costs_and_payment', 'habitability_and_lease'] as const) {
    const bucket = (rc[key] ?? {}) as Record<string, unknown>;
    if (!bucket || Object.keys(bucket).length === 0) continue;
    const rl = toText(bucket.risk_level);
    rcItems.push({
      title: rcLabels[key] ?? key,
      value: rl || 'Unknown',
      badge: rl || 'Unknown',
      severity: severityOf(rl),
      description: safeDescription(bucket.signal, bucket.evidence, bucket.why_it_matters),
    });
    if (Array.isArray(bucket.questions)) {
      for (const q of bucket.questions) rcItems.push({ title: toText(q), description: toText(q) });
    }
  }
  if (rcItems.length > 0) {
    sections.push({ id: 'rental-risk-categories', title: 'Rental Risk Categories', subtitle: 'Four lanes to watch', items: rcItems, tone: 'warning' });
  }

  // 13. listing-does-not-prove
  const ldp = Array.isArray(result.listing_does_not_prove) ? result.listing_does_not_prove : [];
  const ldpItems: SectionItem[] = ldp
    .filter((x: unknown): x is string =>
      typeof x === 'string' &&
      !containsForbidden(x) &&
      !matchesAny(x, RENT_SALE_FLAVORED_PHRASES),
    )
    .map((s: string) => ({ title: s, description: s }));
  if (ldpItems.length > 0) {
    sections.push({ id: 'listing-does-not-prove', title: 'What the Listing Does Not Prove', items: ldpItems });
  }

  // 14. before-tour-apply-pay (single section, three groups via badge)
  const btap = (result.before_you_tour_apply_pay ?? {}) as Record<string, unknown>;
  const btapGroups: Array<{ key: string; label: string; badge: string }> = [
    { key: 'before_tour', label: 'Before Tour', badge: 'Tour' },
    { key: 'before_apply', label: 'Before Apply', badge: 'Apply' },
    { key: 'before_pay', label: 'Before Pay', badge: 'Pay' },
  ];
  const btapItems: SectionItem[] = [];
  for (const g of btapGroups) {
    const arr = Array.isArray(btap[g.key]) ? btap[g.key] : [];
    const strings = (arr as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .filter((s) => !matchesAny(s, RENT_SALE_FLAVORED_PHRASES));
    if (strings.length === 0) continue;
    for (const s of strings) {
      btapItems.push({ title: g.label, description: s, badge: g.badge });
    }
  }
  if (btapItems.length > 0) {
    sections.push({ id: 'before-tour-apply-pay', title: 'Before You Tour / Apply / Pay', subtitle: 'Three checkpoints, in order', items: btapItems });
  }

  // 15. who-this-rental-works-for
  const who = Array.isArray(result.who_this_rental_works_for) ? result.who_this_rental_works_for : [];
  const whoItems: SectionItem[] = [];
  for (const item of who) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const bestFor = toText(obj.best_for);
    const mayNot = toText(obj.may_not_suit);
    const why = toText(obj.why);
    if (!bestFor && !mayNot && !why) continue;
    if (
      matchesAny(bestFor, RENT_SALE_FLAVORED_PHRASES) ||
      matchesAny(mayNot, RENT_SALE_FLAVORED_PHRASES) ||
      matchesAny(why, RENT_SALE_FLAVORED_PHRASES)
    ) {
      continue;
    }
    whoItems.push({
      title: bestFor || mayNot || '—',
      description: [mayNot && `May not suit: ${mayNot}`, why].filter(Boolean).join(' · '),
    });
  }
  if (whoItems.length > 0) {
    sections.push({ id: 'who-this-rental-works-for', title: 'Who This Rental Works For', items: whoItems });
  }

  // 16. next-best-move
  const nbm = Array.isArray(result.next_best_move) ? result.next_best_move : [];
  const nbmItems: SectionItem[] = [];
  for (const item of nbm) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const action = toText(obj.action);
    const reason = toText(obj.reason);
    if (!action && !reason) continue;
    if (matchesAny(action, RENT_SALE_FLAVORED_PHRASES)) continue;
    nbmItems.push({ title: action || reason, description: reason, action: action || undefined });
  }
  if (nbmItems.length > 0) {
    sections.push({ id: 'next-best-move', title: 'Your Next Best Move', items: nbmItems });
  }

  return sections;
}

// ── main adapter ──────────────────────────────────────────────────────────────

export function normalizeUSRentReport(result: USRentResult): NormalizedReport {
  return {
    meta: {
      market: 'US',
      reportMode: 'rent',
      source: toText(result.source ?? result.listingInfo?.source ?? ''),
      sourceDomain: toText(result.sourceDomain ?? result.source_domain ?? ''),
      isBasic: false,
      usedSectionIds: [
        'rental-score',
        // 'bottom-line' intentionally omitted — shown via hero.summary in HeroSection
        'rental-snapshot',
        'what-could-change-decision',
        'rental-listing-trust',
        'availability-check',
        'rent-true-cost',
        'application-payment-risk',
        'lease-terms-rules',
        'location-daily-life',
        'photo-habitability',
        'rental-risk-categories',
        'listing-does-not-prove',
        'before-tour-apply-pay',
        'who-this-rental-works-for',
        'next-best-move',
      ],
    },
    hero: buildHero(result),
    highlights: buildHighlights(result),
    quickFacts: buildQuickFacts(result),
    sections: buildSections(result),
    raw: result,
  };
}