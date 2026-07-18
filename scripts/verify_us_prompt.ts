/**
 * verify_us_prompt.ts
 *
 * Acceptance / scoring script for the US Sale prompt overhaul.
 * Loads one or more JSON reports (real LLM output or a fixture) under
 * `scripts/fixtures/us_sale/*.json` and grades them against the four
 * stated requirements. Outputs a per-file score card plus aggregate.
 *
 * Run:
 *   npx tsx scripts/verify_us_prompt.ts
 *   npx tsx scripts/verify_us_prompt.ts path/to/result.json
 *
 * Rules (must match the prompt contract at analysis/index.ts:
 *  INLINE_US_STEP2_SALE_PROMPT — REQUIRED NEW TOP-LEVEL OUTPUT FIELDS):
 *
 *  R1 — risk_categories: 4 keys present, at least one non-null, every non-null
 *       item includes risk_level AND why_it_matters.
 *  R2 — listing_does_not_prove: max 4 items, each ≥5 chars, no question marks,
 *       no consequence explanations, buyer-critical coverage.
 *  R3 — before_you_book_showing: max 4 items, each ends with "?", visit-critical.
 *  R4 — photo_review risk orientation: each area.visibleConcerns is
 *       risk-oriented language (no banned aesthetic wording) and never
 *       overrules the listing's structured property type.
 *  R5 — deeper_due_diligence: max 6 items, documents/professional checks only.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

type Severity = 'high' | 'medium' | 'low' | 'unknown';
type Verdict = 'pass' | 'fail';

interface RiskCategorySignal {
  risk_level?: string;
  signal?: string;
  evidence?: string;
  missing?: string;
  why_it_matters?: string;
  questions?: string[];
}

interface RiskCategories {
  foundation_basement?: RiskCategorySignal | null;
  water_leaks?: RiskCategorySignal | null;
  roof_exterior?: RiskCategorySignal | null;
  hidden_ownership_cost?: RiskCategorySignal | null;
}

interface PhotoArea {
  name?: string;
  visibleConcerns?: string[];
  cannotTellFromPhotos?: string[];
  whatToCheckNext?: string[];
}

interface PhotoReview {
  overallSummary?: string;
  areas?: PhotoArea[];
}

interface ReportResult {
  risk_categories?: RiskCategories | null;
  listing_does_not_prove?: string[] | null;
  before_you_book_showing?: string[] | null;
  deeper_due_diligence?: string[] | null;
  photo_review?: PhotoReview | null;
  key_takeaways?: any;
  property_category?: string;
  propertyType?: string;
  propertyCategory?: string;
}

interface CriterionResult {
  id: string;
  verdict: Verdict;
  score: number;
  max: number;
  reason: string;
}

// ─── Rule R1: 4-class risk_categories ────────────────────────────────────────
function gradeR1(report: ReportResult): CriterionResult {
  const rc = report.risk_categories;
  const max = 25;
  if (!rc || typeof rc !== 'object') {
    return { id: 'R1 risk_categories', verdict: 'fail', score: 0, max, reason: 'risk_categories object missing' };
  }
  const keys = ['foundation_basement', 'water_leaks', 'roof_exterior', 'hidden_ownership_cost'] as const;
  let present = 0;
  let wellShaped = 0;
  const issues: string[] = [];
  for (const k of keys) {
    const slot = rc[k];
    if (slot !== undefined) present += 1;
    if (slot == null) continue;
    if (typeof slot !== 'object' || Array.isArray(slot)) {
      issues.push(`${k} not object`);
      continue;
    }
    const hasLevel = typeof slot.risk_level === 'string' && /^(High|Medium|Low|Unknown)$/i.test(slot.risk_level.trim());
    const hasWhy = typeof slot.why_it_matters === 'string' && slot.why_it_matters.trim().length >= 10;
    const hasSignal = typeof slot.signal === 'string' && slot.signal.trim().length > 0;
    if (hasLevel && hasWhy && hasSignal) wellShaped += 1;
    else issues.push(`${k} missing ${[
      hasLevel ? null : 'risk_level',
      hasWhy ? null : 'why_it_matters',
      hasSignal ? null : 'signal',
    ].filter(Boolean).join('+')}`);
  }
  const allFour = present === 4 ? 5 : 0;
  const atLeastOneNonNull = present >= 1 && Object.values(rc).some((v) => v != null) ? 5 : 0;
  const nonNullCount = Object.values(rc).filter((v) => v != null).length;
  const qualityScore = nonNullCount === 0 ? 0 : Math.round((wellShaped / nonNullCount) * 15);
  const score = allFour + atLeastOneNonNull + qualityScore;
  const verdict: Verdict = score >= 20 ? 'pass' : 'fail';
  return {
    id: 'R1 risk_categories',
    verdict,
    score,
    max,
    reason: `present=${present}/4, wellShaped=${wellShaped}/${nonNullCount || 0}${issues.length ? ', issues=' + issues.join('; ') : ''}`,
  };
}

// ─── Rule R2: listing_does_not_prove ─────────────────────────────────────────
// Rules: max 4 items, each ≥5 chars, NO question marks, NO consequence explanations
const BUYER_CRITICAL = [
  'roof', 'foundation', 'basement', 'plumbing', 'electrical',
  'panel', 'hvac', 'water heater', 'hoa', 'permit', 'comps',
  'disclosure', 'inspection', 'oil tank', 'easement',
];

function gradeR2(report: ReportResult): CriterionResult {
  const ldp = report.listing_does_not_prove;
  const max = 20;
  if (!Array.isArray(ldp) || ldp.length === 0) {
    return { id: 'R2 listing_does_not_prove', verdict: 'fail', score: 0, max, reason: 'array missing or empty' };
  }
  const cleaned = ldp.map((s) => (typeof s === 'string' ? s : '')).filter((s) => s.trim().length > 0);
  const longEnough = cleaned.filter((s) => s.trim().length >= 5);
  const hasQuestionMark = cleaned.filter((s) => s.includes('?')).length;
  const hasConsequence = cleaned.filter((s) => /could |may |might /.test(s.toLowerCase())).length;
  const lower = cleaned.map((s) => s.toLowerCase());
  const unique = new Set(lower).size;
  const dedupRatio = unique / cleaned.length;
  const buyerCriticalHits = cleaned.filter((s) => BUYER_CRITICAL.some((k) => s.toLowerCase().includes(k))).length;
  let score = 0;
  const issues: string[] = [];
  // Max 4 items
  if (cleaned.length <= 4) score += 8; else issues.push(`count=${cleaned.length}>4`);
  // All items ≥5 chars
  if (longEnough.length === cleaned.length) score += 4; else issues.push('short-string items');
  // No question marks
  if (hasQuestionMark === 0) score += 4; else issues.push(`${hasQuestionMark} items have question marks`);
  // No consequence explanations
  if (hasConsequence === 0) score += 4; else issues.push(`${hasConsequence} items have consequence language`);
  // Buyer-critical coverage
  if (buyerCriticalHits >= 1) score += 4; else issues.push(`buyer-critical=${buyerCriticalHits}<1`);
  // Anti-canned-list heuristic
  if (dedupRatio >= 0.6) score += 4; else issues.push(`dedupRatio=${dedupRatio.toFixed(2)}<0.6 — looks canned`);
  const verdict: Verdict = score >= 14 ? 'pass' : 'fail';
  return {
    id: 'R2 listing_does_not_prove',
    verdict,
    score,
    max,
    reason: `count=${cleaned.length}/4, buyerCritical=${buyerCriticalHits}, dedup=${dedupRatio.toFixed(2)}, noQ=${hasQuestionMark===0}, noConseq=${hasConsequence===0}${issues.length ? ' [' + issues.join('; ') + ']' : ''}`,
  };
}

// ─── Rule R3: before_you_book_showing ────────────────────────────────────────
// Rules: max 4 items, each ends with "?", visit-critical gates only
function gradeR3(report: ReportResult): CriterionResult {
  const arr = report.before_you_book_showing;
  const max = 20;
  if (!Array.isArray(arr) || arr.length === 0) {
    return { id: 'R3 before_you_book_showing', verdict: 'fail', score: 0, max, reason: 'array missing or empty' };
  }
  const cleaned = arr.map((s) => (typeof s === 'string' ? s : '')).filter((s) => s.trim().length > 0);
  const endsWithQ = cleaned.filter((s) => s.trim().endsWith('?')).length;
  // visit-critical vocabulary
  const visitCritical = ['basement', 'permit', 'roof', 'flood', 'water', 'hoa', 'parking', 'bedroom', 'bathroom', 'legal', 'occupancy', 'renovation', 'addition'];
  let visitCriticalHits = 0;
  for (const q of cleaned) {
    const qLower = q.toLowerCase();
    if (visitCritical.some((v) => qLower.includes(v))) visitCriticalHits += 1;
  }
  let score = 0;
  const issues: string[] = [];
  // Max 4 items
  if (cleaned.length <= 4) score += 8; else issues.push(`count=${cleaned.length}>4`);
  // All end with ?
  if (endsWithQ === cleaned.length) score += 6; else issues.push(`?=${endsWithQ}/${cleaned.length}`);
  // At least half are visit-critical
  const visitRate = cleaned.length === 0 ? 0 : visitCriticalHits / cleaned.length;
  if (visitRate >= 0.5) score += 6; else issues.push(`visit-critical=${visitRate.toFixed(2)}<0.5`);
  const verdict: Verdict = score >= 14 ? 'pass' : 'fail';
  return {
    id: 'R3 before_you_book_showing',
    verdict,
    score,
    max,
    reason: `count=${cleaned.length}/4, ?=${endsWithQ}/${cleaned.length}, visit-critical=${visitCriticalHits}${issues.length ? ' [' + issues.join('; ') + ']' : ''}`,
  };
}

// ─── Rule R4: photo_review risk orientation ───────────────────────────────────
const BANNED_AESTHETIC = [
  'makes the space feel',
  'patchy grass',
  'limited natural light',
  'older cabinets',
  'small room',
  'busy backsplash',
  'looks dated but clean',
  'cozy feel',
];

const PROPERTY_TYPE_OVERRULE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(appears? to be|seems? to be|looks? like)\s+(a|an)?\s*(semi[-\s]?detached|multi[-\s]?family|townhouse|condo|apartment|co[-\s]?op|illegal|unpermitted\s+(basement|apartment|unit))\b/i, label: 'overrule-property-type' },
  { re: /\bthis\s+is\s+(a|an)\s+(multi[-\s]?family|semi[-\s]?detached|townhouse|condo|apartment|co[-\s]?op)\b/i, label: 'overrule-property-type' },
  { re: /\b(illegal|unpermitted)\s+(basement\s+)?(apartment|unit|conversion)\b/i, label: 'illegal-apartment' },
];

function propertyTypeFromListing(report: ReportResult): string {
  return (
    (typeof report.propertyCategory === 'string' && report.propertyCategory) ||
    (typeof report.property_category === 'string' && report.property_category) ||
    (typeof report.propertyType === 'string' && report.propertyType) ||
    ''
  );
}

function gradeR4(report: ReportResult): CriterionResult {
  const max = 25;
  const review = report.photo_review;
  if (!review || typeof review !== 'object' || !Array.isArray(review.areas) || review.areas.length === 0) {
    return { id: 'R4 photo_review risk', verdict: 'fail', score: 0, max, reason: 'photo_review.areas missing or empty' };
  }
  const areas = review.areas;
  let riskOrientedAreas = 0;
  let bannedAestheticHits = 0;
  let overruleHits: string[] = [];
  const issues: string[] = [];
  for (const area of areas) {
    const concerns = Array.isArray(area.visibleConcerns) ? area.visibleConcerns : [];
    const text = concerns.join(' ').toLowerCase();
    if (concerns.length === 0) {
      issues.push(`${area.name ?? '?'}: empty visibleConcerns`);
      continue;
    }
    // risk-oriented phrasing: any of these markers present
    const riskMarkers = ['may ', 'could ', 'not prove', 'not visible', 'verify', '?', 'unknown', 'caution', 'risk', 'concern', 'potential', 'inspection', 'permit', 'unclear'];
    const matched = riskMarkers.filter((m) => text.includes(m));
    if (matched.length >= 1) riskOrientedAreas += 1;
    // banned aesthetic phrases
    for (const phrase of BANNED_AESTHETIC) {
      if (text.includes(phrase)) bannedAestheticHits += 1;
    }
  }
  // Also scan overall summary + cannotTellFromPhotos for property-type overrule patterns.
  const listingType = propertyTypeFromListing(report);
  const overallText = (review.overallSummary ?? '').toString();
  const allBodies = areas.flatMap((a) => [
    ...(a.visibleConcerns ?? []),
    ...(a.cannotTellFromPhotos ?? []),
    ...(a.whatToCheckNext ?? []),
  ]).join('\n');
  const corpus = overallText + '\n' + allBodies;
  for (const { re, label } of PROPERTY_TYPE_OVERRULE_PATTERNS) {
    const m = corpus.match(re);
    if (m) overruleHits.push(`${label}: "${m[0]}"`);
  }
  const orientationRate = riskOrientedAreas / areas.length;
  let score = 0;
  if (orientationRate >= 0.7) score += 15;
  else if (orientationRate >= 0.4) score += 8;
  else issues.push(`orientation=${(orientationRate * 100).toFixed(0)}%<70%`);
  if (bannedAestheticHits === 0) score += 5;
  else issues.push(`banned-aesthetic=${bannedAestheticHits}`);
  if (overruleHits.length === 0) score += 5;
  else issues.push(`property-type-overrule=${overruleHits.length}`);
  if (!listingType) issues.push('no listing property_type on file (cannot verify overrule)');
  const verdict: Verdict = score >= 18 ? 'pass' : 'fail';
  return {
    id: 'R4 photo_review risk',
    verdict,
    score,
    max,
    reason: `areas=${areas.length}, riskOriented=${riskOrientedAreas}, banned=${bannedAestheticHits}, overrule=${overruleHits.length}${listingType ? `, listingType="${listingType}"` : ''}${issues.length ? ' [' + issues.join('; ') + ']' : ''}`,
  };
}

// ─── Rule R5: deeper_due_diligence ────────────────────────────────────────────
// Rules: max 6 items, documents/professional checks only
function gradeR5(report: ReportResult): CriterionResult {
  const ddd = report.deeper_due_diligence;
  const max = 15;
  if (!Array.isArray(ddd) || ddd.length === 0) {
    // Optional field — don't fail if missing
    return { id: 'R5 deeper_due_diligence', verdict: 'pass', score: max, max, reason: 'optional field, not present' };
  }
  const cleaned = ddd.map((s) => (typeof s === 'string' ? s : '')).filter((s) => s.trim().length > 0);
  let score = 0;
  const issues: string[] = [];
  // Max 6 items
  if (cleaned.length <= 6) score += 8; else issues.push(`count=${cleaned.length}>6`);
  // All items ≥3 chars
  const longEnough = cleaned.filter((s) => s.trim().length >= 3).length;
  if (longEnough === cleaned.length) score += 7; else issues.push(`${cleaned.length - longEnough} items too short`);
  const verdict: Verdict = score >= 10 ? 'pass' : 'fail';
  return {
    id: 'R5 deeper_due_diligence',
    verdict,
    score,
    max,
    reason: `count=${cleaned.length}/6, allLong=${longEnough === cleaned.length}${issues.length ? ' [' + issues.join('; ') + ']' : ''}`,
  };
}

// ─── Aggregator ─────────────────────────────────────────────────────────────
const GRADERS = [gradeR1, gradeR2, gradeR3, gradeR4, gradeR5];

function grade(report: ReportResult) {
  const results = GRADERS.map((g) => g(report));
  const score = results.reduce((acc, r) => acc + r.score, 0);
  const max = results.reduce((acc, r) => acc + r.max, 0);
  const pct = Math.round((score / max) * 100);
  const passing = results.filter((r) => r.verdict === 'pass').length;
  return { results, score, max, pct, passing };
}

const FIXTURE_DIR = resolve(process.cwd(), 'scripts/fixtures/us_sale');

function collectInputs(target?: string): string[] {
  if (target) return [resolve(target)];
  try {
    if (!statSync(FIXTURE_DIR).isDirectory()) return [];
    return readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(FIXTURE_DIR, f));
  } catch {
    return [];
  }
}

function fmtVerdict(v: Verdict) {
  return v === 'pass' ? 'PASS' : 'FAIL';
}

function main() {
  const target = process.argv[2];
  const inputs = collectInputs(target);
  if (inputs.length === 0) {
    console.error('No fixtures found.');
    console.error(`  Drop JSON reports at ${FIXTURE_DIR}`);
    console.error(`  Or pass a path: npx tsx scripts/verify_us_prompt.ts path/to/file.json`);
    process.exit(1);
  }

  console.log(`US Sale Prompt Acceptance — ${inputs.length} input(s)`);
  console.log('='.repeat(78));

  let totalScore = 0;
  let totalMax = 0;
  let totalPass = 0;
  let totalCriteria = 0;
  for (const file of inputs) {
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e: any) {
      console.error(`! Skipping ${file}: ${e.message}`);
      continue;
    }
    const result = raw && typeof raw === 'object' ? raw.result ?? raw : raw;
    if (!result || typeof result !== 'object') {
      console.error(`! Skipping ${file}: no result object`);
      continue;
    }
    const { results, score, max, pct, passing } = grade(result as ReportResult);
    totalScore += score;
    totalMax += max;
    totalPass += passing;
    totalCriteria += results.length;
    console.log(`\n${file}`);
    console.log('-'.repeat(78));
    for (const r of results) {
      const pctOfMax = Math.round((r.score / r.max) * 100);
      console.log(`  [${fmtVerdict(r.verdict)}] ${r.id}  ${String(r.score).padStart(3)}/${r.max}  (${pctOfMax}%)  — ${r.reason}`);
    }
    console.log(`  ── Score: ${score}/${max} (${pct}%)  ${passing}/${results.length} criteria passing`);
  }

  console.log('\n' + '='.repeat(78));
  const overallPct = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;
  console.log(`OVERALL: ${totalScore}/${totalMax} (${overallPct}%)  ${totalPass}/${totalCriteria} criteria passing across ${inputs.length} input(s)`);
  process.exit(overallPct >= 75 ? 0 : 2);
}

main();
