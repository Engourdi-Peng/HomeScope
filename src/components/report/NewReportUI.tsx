/**
 * NewReportUI — Figma-aligned report display (Phase 1 + Phase 2)
 *
 * ONLY reads NormalizedReport. All text output goes through safeText() / renderValue().
 *
 * Basic layout (in order):
 *  1. HeroSection              — address, Evidence Score, Verdict, Bottom Line
 *  2. WhatWeKnowSection       — property facts (missing fields hidden)
 *  3. ListingSignalsSection   — 2–3 specific signals from listing data
 *  4. WhatsMissingSection     — 4–6 dynamic unverified items
 *  5. KeyThingsToCheckSection — 2–4 property-specific things to check
 *  6. QuestionsToAskSection   — 3–5 questions before viewing
 *  7. BasicCTA                — Unlock Full Analysis CTA
 *
 * Deep layout (in order):
 *  1. HeroSection              — score, verdict, headline, next best move
 *  2. WhatCouldChangeYourDecisionSection — 3 decision-changing risk cards
 *  3. DealChangingRisksSection            — risk cards with specific actions
 *  4. PropertySnapshotSection            — "Is the Price Fair?" + property facts
 *  5. CarryingCostsSection              — "What It May Really Cost Monthly"
 *  6. PhotoSpaceAnalysisCard             — shared component, "What Photos Reveal / Don't Show"
 *  7b. RiskCategoriesSection            — buyer-advocate 4-class risk signals
 *  7c. ListingDoesNotProveSection       — dynamic checklist of unproven facts
 *  7d. BeforeYouBookShowingSection      — questions derived from risk signals
 *  8. AgentSpinDecoderSection           — listing language reality check
 *  9. WhoThisPropertyWorksForSection    — layout fit rename
 * 10. QuestionsToAskSection             — data gaps as action questions
 * 11. NextBestMoveSection               — verdict-based summary
 * 12. ReportClosingCTA                   — bottom value summary + share
 */
import React from 'react';
import {
  Check,
  CheckCircle2,
  CheckCircle,
  Copy,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  TrendingUp,
  DollarSign,
  Shield,
  Home,
  MessageSquare,
  Target,
  Zap,
  Eye,
  BarChart3,
  ClipboardList,
  Wrench,
  FileText,
  Droplet,
  MapPin,
  Activity,
  FileSearch,
  CircleHelp,
  Ban,
  ThumbsUp,
  Signal,
  ArrowLeft,
  ShieldAlert,
  HelpCircle,
  House,
  Droplets,
  Layers,
  Wallet,
} from 'lucide-react';
import type { NormalizedReport, ReportSection, ContradictionVM } from '../../lib/reportAdapters/types';
import type { ReportViewModel } from '../../lib/reportAdapters';
import { PhotoSpaceAnalysisCard } from './PhotoSpaceAnalysisCard';
import { UPSELL_CTA_FALLBACK } from '../../lib/reportAdapters/Fallbacks';

// ── Section dedup context ──────────────────────────────────────────────────────

const UsedSectionsCtx = React.createContext<Set<string>>(new Set());
const RegisterSectionsCtx = React.createContext<(ids: string[]) => void>(() => {});

function SectionRegistrar({ ids }: { ids: string[] }) {
  const register = React.useContext(RegisterSectionsCtx);
  React.useEffect(() => {
    register(ids);
  }, [ids.join(','), register]);
  return null;
}

function useIsSectionUsed(id: string): boolean {
  return React.useContext(UsedSectionsCtx).has(id);
}

// ── Safe Text Utilities ────────────────────────────────────────────────────────

function safeText(value: unknown): string {
  if (value == null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) {
    return value.map((v) => safeText(v)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') return '';
  return '';
}

function renderValue(value: unknown): string {
  if (value == null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) {
    const items = value.map(renderValue).filter(Boolean);
    return items.length > 0 ? items.join(', ') : '';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.text) return safeText(obj.text);
    if (obj.title) return safeText(obj.title);
    if (obj.label) return safeText(obj.label);
    if (obj.phrase) return safeText(obj.phrase);
    if (obj.keyword) return safeText(obj.keyword);
    if (obj.message) return safeText(obj.message);
    if (obj.description) return safeText(obj.description);
    return '';
  }
  return '';
}

// ── Icon Map ──────────────────────────────────────────────────────────────────

function iconFor(id: string, className = 'w-4 h-4') {
  const map: Record<string, React.ReactNode> = {
    'price-assessment':       <DollarSign className={className} />,
    'carrying-costs':         <DollarSign className={className} />,
    'rent-fairness':          <DollarSign className={className} />,
    'investment-potential':    <TrendingUp className={className} />,
    'maintenance-risk':       <Wrench className={className} />,
    'legal-compliance':       <Shield className={className} />,
    'environmental-risk':     <Droplet className={className} />,
    'deal-breakers':          <AlertCircle className={className} />,
    'red-flags':              <AlertTriangle className={className} />,
    'competition-risk':        <BarChart3 className={className} />,
    'property-snapshot':      <Home className={className} />,
    'space-analysis':         <Home className={className} />,
    'neighborhood':           <MapPin className={className} />,
    'questions-to-ask':       <MessageSquare className={className} />,
    'questions':              <MessageSquare className={className} />,
    'data-gaps':             <FileText className={className} />,
    'layout-fit':             <Home className={className} />,
    'property-strengths':     <Check className={className} />,
    'potential-issues':      <AlertCircle className={className} />,
    'next-move':             <Target className={className} />,
    'would-i-buy':           <Target className={className} />,
    'state-advice':          <Info className={className} />,
    'final-recommendation':  <Target className={className} />,
    'agent-lingo':           <MessageSquare className={className} />,
    'light-thermal':         <Eye className={className} />,
    'listing-reality-check': <ClipboardList className={className} />,
    'affordability':         <DollarSign className={className} />,
    'holding-costs':         <DollarSign className={className} />,
    'land-value':             <TrendingUp className={className} />,
    'application-strategy':   <Zap className={className} />,
    'summary':                <Info className={className} />,
  };
  return map[id] ?? <BarChart3 className={className} />;
}

function iconColorFor(id: string): string {
  const map: Record<string, string> = {
    'maintenance-risk':   'text-rose-600/70',
    'legal-compliance':   'text-amber-600/70',
    'environmental-risk': 'text-blue-600/70',
    'deal-breakers':      'text-red-600/70',
    'red-flags':          'text-red-600/70',
  };
  return map[id] ?? 'text-stone-500';
}

// ── Severity Badge (Figma pill style) ─────────────────────────────────────────

const SEVERITY_PILL: Record<string, { bg: string; text: string }> = {
  low:      { bg: 'bg-green-100', text: 'text-green-700' },
  medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
  high:     { bg: 'bg-rose-100',  text: 'text-rose-700' },
  critical: { bg: 'bg-rose-200',  text: 'text-rose-800' },
};

function SeverityPill({ value }: { value: string }) {
  const key = value?.toLowerCase() ?? '';
  const cfg = SEVERITY_PILL[key] ?? { bg: 'bg-stone-100', text: 'text-stone-600' };
  return (
    <span className={`inline-flex items-center text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide ${cfg.bg} ${cfg.text}`}>
      {value}
    </span>
  );
}

// ── Phase 1 ─────────────────────────────────────────────────────────────────

function isRiskSection(section: ReportSection): boolean {
  const haystack = (section.id + ' ' + section.title).toLowerCase();
  return /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance/i.test(haystack);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1: HeroSection — Decision Summary
// ─────────────────────────────────────────────────────────────────────────────

function HeroSection({ report, isBasic }: { report: NormalizedReport; isBasic?: boolean }) {
  const { hero, highlights, sections } = report;

  // ── Listing summary filter: guard against beds/baths/sqft strings in display ──
  function isListingSummaryString(value: string): boolean {
    if (!value) return true;
    const text = value.trim();
    return (
      /\b\d+\s*bds\b/i.test(text) ||
      /\b\d+\s*beds?\b/i.test(text) ||
      /\b\d+\s*ba\b/i.test(text) ||
      /\b\d+[,.\d]*\s*sqft\b/i.test(text) ||
      /\b\d+\s*sq\s*ft\b/i.test(text) ||
      /home\s+for\s+sale\b/i.test(text) ||
      /\bactive\b/i.test(text) ||
      /\bmulti\.?family\s+home\s+for\s+sale\b/i.test(text) ||
      /\bsingle\s+family\s+home\s+for\s+sale\b/i.test(text) ||
      /\bcondo\s+for\s+sale\b/i.test(text) ||
      /\btownhouse\s+for\s+sale\b/i.test(text) ||
      /\bhome\s+for\s+rent\b/i.test(text) ||
      /\bapartment\s+for\s+rent\b/i.test(text) ||
      /\bcondo\s+for\s+rent\b/i.test(text) ||
      /\btownhouse\s+for\s+rent\b/i.test(text) ||
      /\bhouse\s+for\s+rent\b/i.test(text) ||
      /\bfor\s+rent\b/i.test(text)
    );
  }

  function safeDisplayText(value: string | undefined | null): string {
    if (!value) return '';
    const text = String(value).trim();
    if (isListingSummaryString(text)) return '';
    return text;
  }

  // Address: structured hero.address first, then property_snapshot section, then raw listingInfo.
  // NEVER fall back to hero.title — it may contain "4 bds2 ba1,824 sqftMulti-family home for sale"
  // which is a beds/baths/sqft/title string, not an address.
  const raw = (report as any).raw ?? {};
  const address = safeDisplayText(
    renderValue(hero.address ?? '') ||
    renderValue(sections.find((s) => s.id === 'property-snapshot')
      ?.items.find((i) => /address|location/i.test(renderValue(i.title)))?.value ?? '') ||
    renderValue(raw.listingInfo?.address ?? '') ||
    renderValue(raw.address ?? '')
  );

  const identityText = address || 'Address not detected';

  // ── Buyer-flavored phrase patterns (rent-safe strip) ─────────────────────────
  // Mirror of the list in usRent.ts adapter — kept local because
  // HeroSection's `headline` useMemo runs in the browser where importing the
  // adapter would create a module-cycle. Phrase-level regex with word
  // boundaries; renter-OK phrases like "roof leak" / "egress window" are NOT
  // matched and are preserved.
  const RENT_SALE_FLAVORED_HEADLINE_PHRASES: RegExp[] = [
    /\broof\s*age\b/i,
    /\broof\s*replacement\b/i,
    /\b(roof|foundation)\s*condition\b/i,
    /\bnegotiate\s+(the\s+)?(price|offer|repair)\b/i,
    /\bmake\s+an?\s+offer\b/i,
    /\bbuyer'?s?\s+(market|advisor|agent|pool|remorse)\b/i,
    /\bresale\s+value\b/i,
    /\bresale\s+potential\b/i,
    /\bfuture\s+resale\b/i,
    /\b(comparable|comp)\s*sales?\b/i,
    /\bcomps?\b/i,
    /\bschool\s+district\s+resale\b/i,
    /\b(mortgage|financing|down\s+payment|interest\s+rate)\b/i,
    /\b(seller|landlord)\s*disclosure\b/i,
    /\bseller\s+financing\b/i,
    /\bHOA\s+reserve\s*study\b/i,
    /\bspecial\s*assessment\b/i,
    /\bhoa\s*reserve\b/i,
    /\b(capital|cap)\s*rate\b/i,
    /\bcash[\s-]*on[\s-]*cash\s*return\b/i,
    /\bcap\s*rate\b/i,
    /\bROI\b/i,
    /\bproperty\s*tax(es)?\s+(amount|projection|liability|burden|impact|exposure)\b/i,
    /\bclosing\s*costs?\b/i,
    /\bseller'?s?\s+market\b/i,
    /\binvestor\s+mindset\b/i,
    /\bflip\s*tax\b/i,
    /\bbuy\s*down\s*rate\b/i,
  ];

  function stripSaleFlavoredHeadline(text: string | undefined | null): string {
    if (!text) return '';
    const sentences = String(text)
      .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length === 0) return '';
    const kept = sentences.filter(
      (s) => !RENT_SALE_FLAVORED_HEADLINE_PHRASES.some((re) => re.test(s)),
    );
    return kept.join(' ').trim();
  }

  // Sanitize hero.summary — replace unverified marketing phrases with "Listing claims / describes"
  // to prevent them from reading as HomeScope-verified facts.
  const rawSummary = renderValue(hero.summary ?? '');
  const sanitizedSummary = React.useMemo(() => {
    if (!rawSummary) return '';
    let s = rawSummary;
    // Capitalize the first letter if needed
    const _capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
    // Patterns: "Legal 2-family X" → "Listing claims legal 2-family X"
    // Patterns: "The listing describes X as Y" → keep as is
    // Patterns: "Listing claims X" → keep as is
    // If starts with "Legal" / "A" / noun phrase without "listing claims" prefix, prepend "Listing claims "
    if (!/^listing claims|^listing describes|^the listing|^seller|^agent|^this property is known/i.test(s.toLowerCase())) {
      // Check if it reads like a verified fact assertion
      if (/^(legal|confirmed|registered|approved|certified|verified|official|proven|definitely|certainly|clearly|obviously)/i.test(s)) {
        s = 'Listing claims ' + s.charAt(0).toLowerCase() + s.slice(1);
      }
    }
    return s;
  }, [rawSummary]);

  // Resolve rent mode once so useMemo bodies stay simple (manual memoization
  // must be preserved verbatim — see react-hooks/preserve-manual-memoization).
  const isRentMode = (() => {
    const raw = (report as any).raw ?? {};
    const candidate = (
      (report.meta?.reportMode ?? '') ||
      (raw?.meta?.reportMode ?? '') ||
      (raw?.reportMode ?? '') ||
      (raw?.report_mode ?? '') ||
      ''
    ).toString().toLowerCase();
    if (candidate === 'rent' || candidate === 'sale') return candidate === 'rent';
    // Schema fallback — if the rent-specific fields are populated, treat as rent
    return Boolean(
      raw?.rental_snapshot ||
      raw?.rental_listing_score ||
      raw?.rent_fairness,
    );
  })();

  // Rent-mode headline — derived inline (no useMemo) so react-compiler's
  // preserve-manual-memoization rule cannot trip over the dependency array.
  // The result is ignored for non-rent reports.
  const rentHeadline: string | null = isRentMode
    ? (() => {
        const sanitized = stripSaleFlavoredHeadline(hero.bottomLine ?? sanitizedSummary);
        return sanitized && sanitized.trim() ? sanitized.trim() : null;
      })()
    : null;

  // Generate headline based on top risk
  const headline = React.useMemo(() => {
    // Basic mode: generate specific Bottom Line based on what is confirmed vs. unverified
    if (isBasic) {
      // Prioritize the backend normalizeBottomLine output — it has real listing fields
      const backendBottomLine = hero.bottomLine;
      if (backendBottomLine && backendBottomLine.trim() && !/^this listing provides useful basic facts/i.test(backendBottomLine)) {
        return backendBottomLine;
      }
      // Fallback: listing-text-aware template only when backend is empty or generic
      const listingText = [
        rawSummary,
        (report.raw?.listingInfo?.description ?? ''),
        (report.raw?.listingOverview?.description ?? ''),
        (report.raw?.description ?? ''),
        (report.raw?.listingInfo?.propertyType ?? ''),
        (report.raw?.propertyType ?? ''),
      ].join(' ');

      const monthlyCostSnapshot = (report.raw as any)?.monthly_cost_snapshot ?? null;
      const hasZillowMonthly = !!(monthlyCostSnapshot?.estimated_monthly_payment);
      const isRentalMentioned = /legal 2-family|two.family|multi.family|rental|second unit|income|tenant/i.test(listingText);
      const hasConditionSignal = /TLC|needs work|needs updating|needs renovation|needs repair|vacant|as.is|sold/i.test(listingText);

      // Build a targeted list of genuinely missing / unverified items
      const missing: string[] = [];
      if (isRentalMentioned) missing.push('legal use');
      if (!hasZillowMonthly) missing.push('carrying costs');
      if (!hasConditionSignal) missing.push('condition details');
      missing.push('comparable sales/rent context');

      if (missing.length >= 2) {
        const list = missing.join(', ');
        return `This listing provides useful basic facts — price, beds, baths, size${isRentalMentioned ? ', listing-stated property type' : ''} — but ${list} still need verification before relying on this property.`;
      }
      if (missing.length === 1) {
        return `This listing provides useful basic facts, including price, beds, baths, and size, but ${missing[0]} still needs verification before relying on this property.`;
      }
      if (sanitizedSummary) {
        return sanitizedSummary;
      }
      return 'This listing provides useful basic facts, but key decision details still need verification before relying on this property.';
    }

    // Deep mode: use headline inference from risks/cons
    const allRiskText = [
      ...highlights.risks,
      ...highlights.cons,
      ...sections.flatMap((s) => s.items.map((i) => renderValue(i.description ?? i.title))),
    ].join(' ').toLowerCase();

    // Compute SFOC status for headline logic
    const rawSummary2 = rawSummary;
    const profileForHeadline = (report.meta?.reportProfile ?? (report as any).raw?.meta?.reportProfile ?? '');
    const sfocForHeadline = profileForHeadline === 'single_family_owner_occupier';

    // Single-family: never lead with rental legality — use age/systems risk
    if (sfocForHeadline) {
      if (/roof|drainage|leak|1935|older|dated|aging/i.test(allRiskText)) {
        return 'Worth a closer look — but verify permits, roof condition, and older systems first.';
      }
      if (/price|overpriced|estimate|fair/i.test(allRiskText)) {
        return 'Price looks uncertain — verify the numbers before moving forward.';
      }
      if (/photo|interior|photo.?count|missing photo|only exterior/i.test(allRiskText)) {
        return 'Looks promising, but the photos leave important questions unanswered.';
      }
      return 'Worth a closer look — but verify recent updates, permits, and key systems before making an offer.';
    }

    // Condo: renovated condo with deeded parking and low HOA
    if (profileForHeadline === 'condo') {
      const rawCondo = (report as any).raw ?? {};
      const condoText = [
        rawCondo?.listingInfo?.description ?? '',
        rawCondo?.property_snapshot?.homeType ?? '',
      ].join(' ').toLowerCase();
      const hasRenovation = /renov|updated|modern|refinish/i.test(condoText);
      const hasDeededParking = /deeded|assigned|parking|garage/i.test(condoText);
      const hasHOA = /\$?\d+\s*hoa|monthly\s*common|common\s*charge/i.test(condoText);

      if (hasRenovation && hasDeededParking && hasHOA) {
        return 'Renovated condo with deeded parking and reasonable HOA. Verify HOA financials, reserve fund, special assessments, rental policy, and master insurance before making an offer.';
      }
      if (hasRenovation) {
        return 'Renovated condo worth a closer look. Verify HOA financials, reserve fund balance, special assessments, and rental restrictions before booking a viewing.';
      }
      return 'Condo purchase requires thorough due diligence. Ask for the HOA budget, reserve fund, special assessment history, rental restrictions, and master insurance policy before making an offer.';
    }

    // Multi-family / rental: more specific bottom lines based on listing signals
    const rawMF = (report as any).raw ?? {};
    const listingTextMF = [
      rawMF?.listingInfo?.description ?? '',
      rawMF?.property_snapshot?.homeType ?? '',
    ].join(' ').toLowerCase();
    const hasProbate = /probate|estate|sheriff.*sale|foreclosure|auction/i.test(listingTextMF);
    const hasTLC = /tlc|needs?\s+work|needs?\s+updating|needs?\s+renovation|needs?\s+repair|fixer|as.is/i.test(listingTextMF);
    const hasOilHeat = /oil\s+heating|oil\s+tank|oil\s+furnace/i.test(listingTextMF);
    // Check for interior photos from raw report's space analysis
    const rawSpace = rawMF?.spaceAnalysis ?? rawMF?.space_analysis ?? rawMF?.visualAnalysis ?? {};
    const rawAreas: string[] = (rawSpace?.detectedAreas ?? rawSpace?.areas ?? []).map(String).map((a: string) => a.toLowerCase());
    const INTERIOR_KEYWORDS = ['living room', 'bedroom', 'bathroom', 'kitchen', 'hallway', 'dining room', 'basement', 'storage', 'attic', 'laundry', 'office', 'family room'];
    const hasInteriorPhotos = rawAreas.some(a => INTERIOR_KEYWORDS.some(k => a.includes(k)));
    const hasNoInterior = !hasInteriorPhotos;
    const hasLongDOM = /\d{3,}\s+days?\s+on\s+market|listed.*\d{3,}\s+days|over\s+\d{3,}\s+days/i.test(allRiskText);

    const hasExplicitRentalSignal = /two.family|two family|2.family|second unit|legal apartment|rental unit|income unit|duplex|multi.family|mother.daughter|tenant|rent roll/i.test(listingTextMF);

    if (!hasExplicitRentalSignal && (hasProbate || hasTLC || hasNoInterior || hasOilHeat)) {
      return 'Worth a closer look, but verify roof age, major systems, basement permits/egress, and comparable sales before spending serious time.';
    }
    if (hasLongDOM) {
      return 'Confidence is still limited because local comps, inspection details, and permit status have not been verified.';
    }
    return !hasExplicitRentalSignal
      ? 'Worth a closer look, but verify roof age, major systems, finished-basement permits/egress, and comparable sales before spending serious time.'
      : 'Worth a closer look, but verify the Certificate of Occupancy, legal unit count, rent roll, utility metering, and renovation permits before relying on the rental income.';
  }, [hero.bottomLine, highlights, sections, sanitizedSummary, isBasic, rawSummary, report]);

  // Next Best Move — NYC-aware, actionable, property-type-aware
  const nextBestMove = React.useMemo(() => {
    const isNYC = /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
      (hero.address ?? '') + (hero.title ?? '')
    );
    // Compute effective profile using normalized category from backend
    const raw = (report as any).raw ?? {};
    const normCat = raw.normalizedPropertyCategory
      ?? raw.meta?.reportProfile
      ?? raw.reportProfile
      ?? '';
    const effectiveProfile = normCat;

    let nextBestMoveText = '';

    if (isBasic) {
      if (effectiveProfile === 'single_family_owner_occupier' || effectiveProfile === 'single_family') {
        nextBestMoveText = 'Ask for permits for recent updates, roof age, electrical panel details, and any open violations before booking a viewing, or unlock the full report.';
      } else if (effectiveProfile === 'co_op') {
        nextBestMoveText = 'Ask for the monthly maintenance fee, board approval requirements, sublet policy, flip tax, and any upcoming assessments before booking a viewing, or unlock the full report.';
      } else if (effectiveProfile === 'condo') {
        nextBestMoveText = 'Ask for the HOA budget, reserve fund balance, special assessments, rental restrictions, and master insurance policy before booking a viewing, or unlock the full report.';
      } else {
        nextBestMoveText = isNYC
          ? 'Ask for the Certificate of Occupancy, open violation records, and actual rental history before booking a viewing, or unlock the full report.'
          : 'Ask the agent for legal use, repair history, and comparable sales before booking a viewing, or unlock the full report.';
      }
    } else if (effectiveProfile === 'single_family_owner_occupier' || effectiveProfile === 'single_family') {
      nextBestMoveText = 'Keep this property on your shortlist, but do not rely on the 4-bedroom marketing claim or the asking price until basement legality, roof condition, major systems, and nearby comps are verified.';
    } else if (effectiveProfile === 'co_op') {
      nextBestMoveText = 'Ask for the monthly maintenance fee and what it includes, board approval requirements, sublet policy and flip tax details, any upcoming assessments, and the building\'s reserve fund before booking a viewing.';
    } else if (effectiveProfile === 'multi_family') {
      nextBestMoveText = 'Ask for the Certificate of Occupancy, full rent roll, lease terms, and any open violations before booking a viewing.';
    } else if (effectiveProfile === 'condo') {
      nextBestMoveText = 'Ask for the HOA budget, reserve fund balance, special assessment history, rental restrictions, master insurance policy, owner-occupancy ratio, any pending litigation, and deeded parking documentation before booking a viewing.';
    } else if (effectiveProfile === 'land') {
      nextBestMoveText = 'Ask for the zoning confirmation, survey, utility availability, and FEMA flood zone designation before booking a viewing.';
    } else if (isNYC) {
      nextBestMoveText = 'Do not rely on basement use assumptions or the price signal until legal use, condition, major systems, and comparable sales are verified.';
    } else {
      nextBestMoveText = 'Ask the agent for legal use, repair history, open permits, and comparable sales before booking a viewing.';
    }

    console.log('[TRACE_RENDER_NEXT_BEST_MOVE_SOURCE]', {
      vmNextBestMove: raw?.nextBestMove ?? raw?.next_step,
      rawNextBestMove: raw?.nextBestMove,
      rawNextStep: raw?.next_step,
      actuallyRenderedText: nextBestMoveText,
    });

    return nextBestMoveText;
  }, [hero.address, hero.title, isBasic, report]);

  const mainReasons: string[] = [];
  const seen = new Set<string>();
  for (const r of highlights.risks) {
    if (mainReasons.length >= 3) break;
    const t = renderValue(r);
    if (t && !seen.has(t)) { seen.add(t); mainReasons.push(t); }
  }
  for (const c of highlights.cons) {
    if (mainReasons.length >= 3) break;
    const t = renderValue(c);
    if (t && !seen.has(t)) { seen.add(t); mainReasons.push(t); }
  }
  if (mainReasons.length === 0) {
    const riskSections = sections.filter(
      (s) => /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance/i.test(s.id + s.title)
    );
    for (const s of riskSections) {
      for (const item of s.items) {
        if (mainReasons.length >= 3) break;
        const t = renderValue(item.description ?? item.title);
        if (t && !seen.has(t)) { seen.add(t); mainReasons.push(t); }
      }
    }
  }

  const score = hero.score;
  const scoreText = score !== null && score !== undefined ? String(score) : null;

  return (
    <div className="relative rounded-2xl p-6 sm:p-8 md:p-10 mb-8 overflow-hidden" style={{ backgroundColor: '#282828' }}>
      <div className="relative z-10">
        {/* Address */}
        {identityText && (
          <div className="text-slate-200 text-lg sm:text-xl md:text-2xl font-semibold mb-5 sm:mb-6 leading-snug">
            {renderValue(identityText)}
          </div>
        )}

        {/* Hero image — fallback chain: hero.imageUrl → raw.listingInfo.coverImageUrl → raw.coverImageUrl → raw.images[0] */}
        {(() => {
          const heroImg = hero.imageUrl
            || raw.listingInfo?.coverImageUrl
            || raw.coverImageUrl
            || (Array.isArray(raw.images) ? raw.images[0] : undefined);
          if (!heroImg) return null;
          return (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 mb-6">
              <img
                src={heroImg}
                alt={address || 'Property photo'}
                className="w-full aspect-[16/10] object-cover"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </div>
          );
        })()}

        {/* Score + /100 */}
        <div className="flex items-baseline gap-3 mb-6">
          {scoreText !== null ? (
            <div className="text-7xl sm:text-8xl font-bold text-amber-400">
              {scoreText}
            </div>
          ) : (
            <div className="text-7xl sm:text-8xl font-bold text-slate-500">—</div>
          )}
          <div className="text-3xl text-[#B3B3B3]">/100</div>
        </div>

        {/* Verdict badge */}
        {hero.verdict && (
          <div className="inline-flex items-center gap-2 backdrop-blur border px-6 py-3 rounded-xl mb-4 border-[#DAA520]/60 bg-[rgba(218,165,32,0.12)]">
            <Activity className="w-4 h-4" style={{ color: '#DAA520' }} />
            <span className="font-semibold tracking-wide" style={{ color: '#DAA520' }}>{renderValue(hero.verdict)}</span>
          </div>
        )}

        {/* One-line headline */}
        <div className="backdrop-blur border rounded-xl p-5 sm:p-6 mb-4" style={{ backgroundColor: '#2a2a2a', borderColor: 'rgba(218, 165, 32, 0.4)' }}>
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <ThumbsUp className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-300 uppercase tracking-wider text-xs font-semibold">Bottom Line</span>
          </div>
          <p className="text-slate-100 text-base sm:text-lg leading-relaxed font-medium">{rentHeadline ?? headline}</p>
        </div>

        {/* Short explanation paragraph — hidden in basic mode and rent mode
            (rent: hero card shows bottom line; summary is redundant) */}
        {!isBasic && sanitizedSummary && !isRentMode && (
          <p className="text-[#D6D6D6] text-sm sm:text-base leading-relaxed mb-6">
            {sanitizedSummary}
          </p>
        )}

        {/* Main Reasons — hidden in basic mode (no unverified inference) */}
        {!isBasic && mainReasons.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
              <div className="w-1 h-4 bg-[#AAAAAA] rounded-full" />
              <span className="text-[#AAAAAA] uppercase tracking-wider text-xs font-semibold">Why It Matters</span>
            </div>
            <ul className="space-y-3">
              {mainReasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-3 text-white">
                  <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#AAAAAA]" />
                  </div>
                  <span className="min-w-0 break-words">{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2: WhatCouldChangeYourDecisionSection
// ─────────────────────────────────────────────────────────────────────────────

const RISK_TITLES: Array<{ keywords: RegExp; title: string }> = [
  // ── Condo specific risks (highest priority — condo has unique HOA financial structure) ──
  { keywords: /hoa.*(budget|reserve|fund|balance)|reserve.*(fund|balance|study)|special\s*assessment|hoa.*(dues|fees|charge|common)/i, title: 'HOA / Condo Financial Risk' },
  { keywords: /special\s*assessment|pending\s*assessment|upcoming\s*assessment/i, title: 'Special Assessment Risk' },
  { keywords: /reserve\s*fund|reserve\s*study|reserve\s*balance|underfunded/i, title: 'Reserve Fund Risk' },
  { keywords: /rental\s*restrict|rental\s*policy|sublet|right\s*of\s*first\s*refusal|noise.*rent|lease.*restrict/i, title: 'Rental Restriction Risk' },
  { keywords: /hoa.*(govern|board|meeting|minute|litigation|dispute|lawsuit)|board\s*(approval|rule|meeting)|hoa.*(conflict|dispute)/i, title: 'HOA Governance Risk' },
  { keywords: /master\s*insurance|building\s*insurance|insurance\s*coverage|liability\s*insurance/i, title: 'Master Insurance Risk' },
  { keywords: /deeded\s*parking|assigned\s*parking|parking\s*deed|deed.*parking|exclusive\s*use/i, title: 'Parking / Deed Risk' },
  // ── Co-op specific risks (co-op has unique financial structure) ──
  { keywords: /maintenance.*fee|board.*approval|sublet.*policy|flip\s*tax|reserve\s*fund|special\s*assessment/i, title: 'Co-op Financial Risk' },
  { keywords: /co.?op.*board|maintenance.*electricity|maintenance.*tax|co.?op.*approval|co.?op.*restrict/i, title: 'Co-op Board Risk' },
  // ── Specific combos must come BEFORE generic fallbacks to prevent misclassification ──
  // Market Time — must be BEFORE generic rental/legal and price (digit + "days on market")
  { keywords: /\d{2,}\s+days?\s+on\s+market|listed\s+\d{2,}\s+days|over\s+\d{2,}\s+days\s+on\s+market/i, title: 'Market Time / Pricing Risk' },
  { keywords: /long market time|listed.*\d{3,}.*days|hasn't sold|hasnt sold|unsold.*listing|listing.*age.*\d{3,}|very slow.*market|over \d{3,} days/i, title: 'Long Market Time' },
  // Basement permit / legal-use risk — keep above generic rental and moisture
  { keywords: /finished basement.*(permit|permitted|legal|legality|egress|ceiling height|certificate|occupancy)|basement.*(permit|permitted|legal use|legality|egress|ceiling height|certificate of occupancy)|unverified permits?.*basement|permits?.*finished basement/i, title: 'Basement Permit Risk' },
  // Basement + rental/legal keywords → NOT moisture
  { keywords: /basement.*(rental|legal|co |certificate|occupancy|lease|rental.?income|unapproved|illegal|registered)|(rental|legal|co |certificate|occupancy|lease|rental.?income|unapproved|illegal|registered).*basement/i, title: 'Rental Legality Risk' },
  // Probate / title risk
  { keywords: /probate|title.*lien|court.*approval|foreclosure.*title|clear.?title|title.*issue|title.*dispute/i, title: 'Probate / Title Risk' },
  // Flood/insurance must not match rental/legal keywords
  { keywords: /flood|fema.*zone|high.?wind|seismic|hurricane|windstorm/i, title: 'Flood / Insurance Risk' },
  // Open violations: ONLY match when text confirms ACTUAL open violations exist.
  // Does NOT match questions/requests about permits/DOB (those → CO Verification Risk).
  // Requires "open" + "violation" or "open" + DOB or "has violations" / "with violations".
  { keywords: /\bopen\s+(dob\s+)?(violations?|complaints?)|(has|with)\s+(open\s+)?(dob\s+)?violations?|\bdob\s+(violations?|complaints?)\s+on\s+(this|the)\s+property|\bopen\s+(dob|hpd)\s+(violations?|complaints?)\b/i, title: 'Open Violations Risk' },
  // Older building systems risk — electrical/plumbing/heating/boiler only (NOT roof — see below)
  { keywords: /electrical|plumb|heating|boiler|system.*age|panel.*replace|service.*amp|hvac|major systems?/i, title: 'Roof / Major Systems Risk' },
  // Roof age risk — must be separate from general systems risk and checked BEFORE the generic basement
  { keywords: /roof.*age|roof.*condition|roof.*replace|roof.*leak|drainage.*roof|flat roof.*age/i, title: 'Roof / Major Systems Risk' },
  // Missing interior photos — only when text genuinely says photos are missing/unavailable/insufficient.
  { keywords: /no interior photo|without interior photo|photo.*not avail|no photo avail|insufficient photo|limited photo coverage|more photo|additional photo|ask for photo|request photo|photo missing|missing photo|photo not provided|photo not shown/i, title: 'Missing Interior Photos' },
  // Price confidence
  { keywords: /price|overpriced|fair.*estimate|estimate.*value|valuation|zestimate|zillow.*estimate/i, title: 'Price Confidence Risk' },
  // Rental legality (general — without basement)
  { keywords: /rental|legal|co |certificate|occupancy|lease|rental.?income/i, title: 'Rental Legality Risk' },
  // CO / permit / DOB verification — matches questions and requests about building records.
  // These don't confirm violations exist; they ask to verify compliance.
  { keywords: /certificate of occupancy|ask for.*certificate|ask.*dob.*records|ask.*permits?\s+pull|what permits.*pulled|building\s+records?\s+verify|verify.*certificate/i, title: 'CO Verification Risk' },
  { keywords: /ask.*(dob|hpd|building\s+dept)|(dob|hpd|building\s+dept)\s+records?\s+verify|open\s+records?\s+request|request.*(dob|hpd)\s+records?/i, title: 'CO Verification Risk' },
  // Window security feature — barred windows may indicate security concerns or NYC safety design; verify intent and egress
  { keywords: /barred window|security bar|window.*bar|security.*window|grated window|window.*grate|iron bar.*window/i, title: 'Window Security Feature' },
  // Renovation cost
  { keywords: /kitchen|bathroom|renovation|update|cosmetic|\$\d+.*k|\d+.*k.*renov/i, title: 'Renovation Cost Risk' },
  // Basement legal & egress risk — must come BEFORE generic basement moisture to catch
  // "finished basement second apartment" / "egress windows" / "ceiling height" cases
  { keywords: /basement.*(egress|ceiling height|single family|sfr|owner.occup|not legal|unapproved|second apartment|apartment setup)|(egress|ceiling height|single family|sfr|owner.occup|not legal|unapproved|second apartment|apartment setup).*basement/i, title: 'Basement Permit / Egress Risk' },
  // Basement moisture — ONLY if no rental/legal/egress keywords present
  { keywords: /basement|moisture|water.*intrusion|drainage|foundation|crack|foundation movement|seepage/i, title: 'Basement Moisture Risk' },
];

function getRiskTitle(text: string): string {
  for (const { keywords, title } of RISK_TITLES) {
    if (keywords.test(text)) return title;
  }
  return 'Key Verification Risk';
}

function _getRiskShortExplanation(risk: string): string {
  const t = risk.toLowerCase();
  if (/roof.*age|roof.*condition|roof.*replace|roof.*leak|drainage.*roof|flat roof.*age/i.test(t)) {
    return 'Roof age unknown — critical for older home. Replacement could be imminent and costly. Ask the seller or agent for the roof age and condition report.';
  }
  if (/roof|drainage|leak/i.test(t)) {
    return 'Roof type and age are not shown in the listing. Verify roof condition, any leak history, and drainage before estimating repair costs.';
  }
  if (/electrical|plumb|heating|boiler|system/i.test(t)) {
    return 'For older homes, electrical panel, plumbing, heating, and boiler condition should be verified before estimating repair costs. Bring a licensed inspector if still interested.';
  }
  if (/window.*bar|security.*bar|barred.*window|grated.*window/i.test(t)) {
    return 'Some bedroom windows appear to have security bars. Verify whether they are fixed or removable, whether they meet fire egress requirements, and whether they reflect owner preference or local security concerns.';
  }
  if (/rental|legal|co |certificate|occupancy|lease/i.test(t)) {
    return 'Legal use must be confirmed against the Certificate of Occupancy. Unverified legal status can affect financing and future resale.';
  }
  if (/co verification|verify.*certificate|ask.*certificate|ask.*dob.*records|ask.*permits?\s+pull|what permits.*pulled/i.test(t)) {
    return 'Building records, permits, and Certificate of Occupancy should be verified before making an offer. Open violations or compliance issues can affect financing and resale.';
  }
  if (/\bopen\s+violations?|open\s+dob|open\s+hpd|has.*violations?|with.*violations?/i.test(t)) {
    return 'Open violations or complaints can indicate legal or code-compliance issues. Verify with DOB, HPD, or local building department records.';
  }
  if (/flood|insurance|zone/i.test(t)) {
    return 'Flood-zone designation or high-risk insurance can materially increase carrying costs.';
  }
  if (/photo|interior|missing/i.test(t)) {
    return 'Missing interior photos mean important condition details have not been disclosed. Ask for additional photos or an inspection report before making a decision.';
  }
  if (/permit.*ask|ask.*permit|only.*mention.*permit|\.\s+permit\s+\./i.test(t)) {
    return 'Permit history should be verified. Pulled permits confirm that work was done legally and to code.';
  }
  if (/price|overpriced|fair|estimate|value/i.test(t)) {
    return "Without verified condition details, the price estimate may not reflect the property's real value.";
  }
  if (/noise|neighbor|neighbourhood|community/i.test(t)) {
    return 'Neighbourhood characteristics can affect livability and long-term resale appeal.';
  }
  if (/days on market|262|market time|listed.*ago|hasn't sold|hasnt sold/i.test(t)) {
    return 'Extended time on market may indicate pricing concerns, condition questions, or buyer due diligence issues. Ask the agent for price reduction history and any failed offers.';
  }
  if (/basement|moisture|water.*intrusion|drainage|foundation|crack/i.test(t)) {
    if (/egress|ceiling height|single family|sfr|owner.occup|not legal|unapproved|second apartment|apartment setup/i.test(t)) {
      return 'The listing describes the basement as a second apartment with kitchen, bathroom, washer/dryer, but the home is listed as single-family. Verify Certificate of Occupancy, permits, egress, ceiling height, and legal use before assuming rental or sleeping use.';
    }
    return 'Visible basement cracks and unfinished condition may indicate water intrusion, drainage issues, or foundation movement.';
  }
  if (/kitchen|bathroom|renovation|\$\d+.*k|update|cosmetic/i.test(t)) {
    return 'Kitchen and bathroom condition may require significant updates before resale or move-in.';
  }
  if (/fast.moving|buyer pressure|short market time|\b5 days\b|only \d+ days/i.test(t)) {
    return 'A fast-moving listing may create buyer pressure. Avoid skipping inspection, permit checks, or roof/system due diligence just to move quickly.';
  }
  return risk.length > 120 ? risk.slice(0, 117) + '...' : risk;
}

const IMPACT_LABELS: Array<{ keywords: RegExp; label: string }> = [
  { keywords: /days on market|market time|fast.moving|buyer pressure|\d{2,}.*days.*market|listed.*days.*ago/i, label: 'Check before offer' },
  { keywords: /rental|income|legal|co |occupancy|lease/i, label: 'Could affect rental income' },
  { keywords: /roof|electrical|plumb|heating|boiler|maintenance|repair|cost|money|expense/i, label: 'Could cost money' },
  { keywords: /price|overpriced|fair|value|estimate/i, label: 'Could affect your offer' },
  { keywords: /photo|interior|space|room|layout|flood|insurance|zone/i, label: 'Could change your decision' },
  { keywords: /co verification|verify.*certificate|ask.*certificate|ask.*dob.*records|what permits.*pulled/i, label: 'Check before viewing' },
  { keywords: /\bopen\s+violations?|open\s+dob|open\s+hpd|has.*violations?|with.*violations?/i, label: 'Check before offer' },
  { keywords: /permit.*ask|ask.*permit|ask.*building\s+records/i, label: 'Check before viewing' },
  { keywords: /basement|moisture|water|drainage|foundation|crack/i, label: 'Check before viewing' },
  // Basement legal & egress — affects legal use, needs offer-stage verification
  { keywords: /basement.*egress|egress.*basement|ceiling height.*basement|basement.*ceiling height|second apartment.*basement|basement.*second apartment/i, label: 'Check before offer' },
  { keywords: /kitchen|bathroom|renovation|\$\d+k|update|cosmetic/i, label: 'Could change your decision' },
  { keywords: /days on market|262|market time|fast.moving|buyer pressure/i, label: 'Check before offer' },
];

// Rent-mode variant — replaces offer/viewing-centric labels with applicant-friendly versions
const RENT_IMPACT_LABELS: Array<{ keywords: RegExp; label: string }> = [
  { keywords: /days on market|market time|fast.moving|competitive|rental.*demand|\d{2,}.*days.*market|listed.*days.*ago/i, label: 'Act quickly or confirm availability' },
  { keywords: /rental|income|legal|co |occupancy|lease/i, label: 'Could affect rental cost or eligibility' },
  { keywords: /roof|electrical|plumb|heating|boiler|maintenance|repair|cost|money|expense/i, label: 'Could increase monthly costs' },
  { keywords: /price|overpriced|fair|value|estimate|rent.*high|rent.*low/i, label: 'Could affect your decision to apply' },
  { keywords: /photo|interior|space|room|layout|flood|insurance|zone/i, label: 'Could change your decision' },
  { keywords: /co verification|verify.*certificate|ask.*certificate|ask.*dob.*records|what permits.*pulled/i, label: 'Ask before scheduling a tour' },
  { keywords: /\bopen\s+violations?|open\s+dob|open\s+hpd|has.*violations?|with.*violations?/i, label: 'Ask landlord to clarify' },
  { keywords: /permit.*ask|ask.*permit|ask.*building\s+records/i, label: 'Ask before scheduling a tour' },
  { keywords: /basement|moisture|water|drainage|foundation|crack/i, label: 'Ask before scheduling a tour' },
  { keywords: /basement.*egress|egress.*basement|ceiling height.*basement|basement.*ceiling height|second apartment.*basement|basement.*second apartment/i, label: 'Ask before applying' },
  { keywords: /kitchen|bathroom|renovation|\$\d+k|update|cosmetic/i, label: 'Could change your decision' },
];

function getImpactLabel(text: string, isRent = false): string {
  const labels = isRent ? RENT_IMPACT_LABELS : IMPACT_LABELS;
  for (const { keywords, label } of labels) {
    if (keywords.test(text)) return label;
  }
  return isRent ? 'Ask before applying' : 'Check before offer';
}

function WhatCouldChangeYourDecisionSection({ report, viewModel, isBasic }: { report: NormalizedReport; viewModel?: ReportViewModel; isBasic?: boolean }) {
  const { highlights, sections } = report;
  const isRentMode = (report.meta?.reportMode ?? '').toString().toLowerCase() === 'rent' ||
    Boolean((report as any).raw?.rental_snapshot || (report as any).raw?.rental_listing_score);

  // Photo consistency: skip Missing Interior Photos card if interior photos are detected
  const hasInteriorPhotos = viewModel?.photos?.hasInteriorPhotos ?? false;
  const _photoVM = viewModel?.photos;

  // Deduplicate risks across sources
  const seen = new Set<string>();
  const allRisks: string[] = [];

  for (const r of highlights.risks) {
    const t = renderValue(r);
    if (t && !seen.has(t)) { seen.add(t); allRisks.push(t); }
  }
  for (const c of highlights.cons) {
    const t = renderValue(c);
    if (t && !seen.has(t)) { seen.add(t); allRisks.push(t); }
  }
  for (const s of sections) {
    if (isRiskSection(s)) {
      for (const item of s.items) {
        const t = renderValue(item.description ?? item.title);
        if (t && !seen.has(t)) { seen.add(t); allRisks.push(t); }
      }
    }
  }

  // Deduplicate by keyword families (roof, legal/CO, systems, price, photos)
  const keywordFamilySeen = new Set<string>();
  const dedupedRisks: string[] = [];
  const FAMILY_KEYWORDS = [
    /roof|flat roof|drainage|leak/i,
    /rental|legal|co |certificate|occupancy|lease/i,
    /electrical|plumb|heating|boiler|system/i,
    /price|overpriced|fair|estimate|value/i,
    /flood|insurance|zone/i,
    /permit|violation|complaint/i,
  ];
  for (const risk of allRisks) {
    let matched = false;
    for (const family of FAMILY_KEYWORDS) {
      if (family.test(risk)) {
        if (keywordFamilySeen.has(family.source)) {
          matched = true;
          break;
        }
        keywordFamilySeen.add(family.source);
      }
    }
    if (!matched) dedupedRisks.push(risk);
  }

  // Detect short DOM for Fast-Moving Listing Risk injection
  // Parse DOM from snapshot (viewModel) or from risk text
  const raw = (report as any).raw ?? {};
  const snap = raw.property_snapshot ?? {};
  const domText = viewModel?.snapshot?.daysOnMarket ?? snap.daysOnMarket ?? snap.days_on_market ?? '';
  const domMatch = String(domText).match(/\d+/);
  const daysOnMarket = domMatch ? parseInt(domMatch[0], 10) : null;

  // Also scan allRisks text for short DOM mentions (e.g., "Only 5 days on market")
  const allRisksText = dedupedRisks.join(' ').toLowerCase();
  const hasShortDOM = daysOnMarket !== null && daysOnMarket <= 14
    || /\bonly \d+ days|\b\d+ days on market\b|\bfast.moving\b|\bshort market\b/i.test(allRisksText);

  // If no risks were detected but listing is fast-moving, inject a risk card
  if (dedupedRisks.length === 0 && hasShortDOM) {
    dedupedRisks.push('Only ' + (daysOnMarket ?? 'few') + ' days on market suggests competitive bidding — but buyer pressure should not replace due diligence.');
  }

  // Detect utility metering signals for Multi-family properties
  const listingText = [
    raw?.listingInfo?.description ?? '',
    raw?.listingOverview?.description ?? '',
    raw?.description ?? '',
  ].join(' ').toLowerCase();
  const gasMeterMatch = listingText.match(/separate\s+gas\s+meters?\s*[:\-]?\s*(\d+)/i);
  const gasMeterCount = gasMeterMatch ? parseInt(gasMeterMatch[1], 10) : null;
  if (gasMeterCount !== null) {
    const meterRisk = gasMeterCount === 1
      ? 'Utilities may not be separately metered. Confirm owner-paid utilities and operating expenses.'
      : 'Separate gas meters detected — verify electric, water, and sewer are also separately metered.';
    if (!dedupedRisks.includes(meterRisk)) dedupedRisks.push(meterRisk);
  }

  // Detect weak photo coverage: inject "Limited Photo Evidence" risk
  const photoCount = viewModel?.photos?.photoCount ?? 0;
  if (!hasInteriorPhotos && photoCount > 0) {
    const photoExplanation = 'Only exterior photos were detected. No kitchen, bathroom, bedroom, basement, roof, or mechanical-system photos were available. This reduces confidence and justifies asking for additional photos before booking a showing.';
    if (!dedupedRisks.includes(photoExplanation)) dedupedRisks.push(photoExplanation);
  }

  // Photo consistency rule: if interior photos exist, skip "Missing Interior Photos" card entirely
  if (hasInteriorPhotos) {
    // filter out photo-related risks from dedup source — use the same specific pattern as RISK_TITLES
    const photoKeywords = /no interior photo|without interior photo|photo.*not avail|no photo avail|insufficient photo|limited photo coverage|more photo|additional photo|ask for photo|request photo|photo missing|missing photo|photo not provided|photo not shown/i;
    const filtered = dedupedRisks.filter(r => !photoKeywords.test(r));
    // if we removed photo ones, backfill from allRisks if needed
    const dedupedWithPhoto = [...filtered];
    for (const r of allRisks) {
      if (dedupedWithPhoto.length >= 3) break;
      if (photoKeywords.test(r)) continue; // skip photo-related when we have interior photos
      if (!dedupedWithPhoto.includes(r)) dedupedWithPhoto.push(r);
    }
    dedupedRisks.length = 0;
    dedupedRisks.push(...dedupedWithPhoto);
  }

  // Filter out empty, badge-only, or meaningless risk items before rendering
  // These can come from AI generating placeholder/label-level text with no substance
  const BADGE_WORDS = /^(risk level|check before offer|could cost money|key verification|verdict|assessment|unknown|pending|tbd|n\/a)$/i;
  const filteredRisks = dedupedRisks.filter(risk => {
    const trimmed = risk.trim();
    // Skip very short items
    if (trimmed.length < 20) return false;
    // Skip if it's just a badge/label word
    if (BADGE_WORDS.test(trimmed)) return false;
    // Skip if the risk text is just a badge label (e.g., "Risk Level" alone)
    if (trimmed.length < 25 && /^(any|a|the|some)\s+/i.test(trimmed)) return false;
    return true;
  });

  const topRisks = filteredRisks.slice(0, 3);
  if (topRisks.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-600/70" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">What Could Change Your Decision</h2>
        </div>
      </div>
      <p className="text-slate-500 text-sm mb-6 sm:mb-8">
        {isBasic
          ? 'Based on listing signals only — not independent analysis.'
          : 'These are the issues that could affect whether this property is still worth your time.'}
      </p>

      <div className="space-y-4 sm:space-y-6">
        {topRisks.map((risk, i) => {
          // ── P0-8 fix: title/description must come from the SAME source risk item ────
          // Previously getRiskTitle() and getRiskShortExplanation() used independent
          // keyword matches on the same raw text, causing title="Basement Moisture Risk"
          // but description="An illegal or unapproved rental unit..." (rental keyword matched
          // description but not title). Now both use the raw risk text directly.
          const cardTitle = getRiskTitle(risk);
          const shortExplanation = risk.length > 120 ? risk.slice(0, 117) + '...' : risk;

          // Guard: if title and explanation are identical (both raw risk text), it means
          // getRiskTitle fell through to "Key Verification Risk" — show the raw text as title.
          const displayTitle = cardTitle !== shortExplanation ? cardTitle : (risk.length > 60 ? risk.slice(0, 57) + '...' : risk);

          const impact = getImpactLabel(risk, isRentMode);
          return (
            <div key={i} className="flex flex-col gap-3 p-5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900 text-base leading-snug">{displayTitle}</div>
              <p className="text-slate-700 text-sm leading-relaxed">{shortExplanation}</p>
              <div>
                <span className="inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-700">
                  {impact}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3: DealChangingRisksSection
// ─────────────────────────────────────────────────────────────────────────────

// New improved helper — returns specific Ask/Check/Verify action per risk type.
// Never duplicates the summary. Always starts with a verb and tells user
// what to do next.
function buildRiskAction(riskText: string, isNYC = false, reportProfile?: string): string {
  const t = riskText.toLowerCase();
  const isSFOC = reportProfile === 'single_family_owner_occupier';

  // 1. Legal & Compliance — SFOC: focus on CO/DOB/permits; multi-family: include rental income + HPD
  // Also catches basement egress / ceiling height / second apartment
  if (/legal|compliance|rental|co |certificate|occupancy|lease|registered|violation|permit| dob |hpd|complaint|egress|ceiling height|second apartment/i.test(t)) {
    if (isSFOC) {
      if (isNYC) {
        return 'Ask for the Certificate of Occupancy and check NYC DOB records and permits for recent renovations before making an offer.';
      }
      return 'Ask for legal-use documents, permits for recent updates, and check local building department records before making an offer.';
    }
    if (isNYC) {
      return 'Ask for the Certificate of Occupancy and check NYC DOB, HPD, and ACRIS records before relying on legal use, renovation claims, or investment assumptions.';
    }
    return 'Ask for legal-use documents and check local building department or county records before relying on legal use, renovation claims, or investment assumptions.';
  }

  // 2. Maintenance — excludes basement/water (those go to Environmental or Structural)
  if (/maintenance|deferred|roof|drainage|leak|dated|old systems|boiler|electrical|plumbing|hvac/i.test(t)) {
    let base = 'Ask for the roof age, boiler age, electrical panel details, plumbing history, HVAC condition, and recent repair records before viewing. Bring a licensed inspector if still interested.';
    if (/cracked tile|cracked.floor/i.test(t)) {
      base += ' Also ask whether the basement has had water intrusion, drainage issues, or foundation repairs.';
    }
    return base;
  }

  // 3. Price Risk
  if (/price|overpriced|estimate|fair|value|comparable|comp/i.test(t)) {
    return 'Ask for recent comparable sales, price reduction history, and seller motivation before deciding whether the asking price is justified.';
  }

  // 4. Rent / Investment Risk
  if (/rent|rental income|investment|yield|return/i.test(t)) {
    return 'Ask for actual lease history, current tenant status, and comparable local rents before using rental income in your numbers.';
  }

  // 5. Default fallback
  return 'Ask the agent for documents or records that confirm this risk before booking a viewing or making an offer.';
}

// Legacy alias — kept to avoid breaking internal calls
function _makeSpecificAction(text: string, isNYC = false, reportProfile?: string): string {
  return buildRiskAction(text, isNYC, reportProfile);
}

function DealChangingRisksSection({ report, viewModel }: { report: NormalizedReport; viewModel?: ReportViewModel }) {
  // Sale-only section — built from sale risk_categories fields.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score) return null;
  const { sections, hero } = report;

  const isNYC = viewModel?.meta?.isNYC
    ?? /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
      (hero?.address ?? '') + (hero?.title ?? '')
    );

  // Compute effectiveProfile for action text
  const raw = (report as any).raw ?? {};
  const profile = raw.meta?.reportProfile ?? raw.reportProfile ?? viewModel?.meta?.reportProfile ?? '';
  const profileText = (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();
  const isSingleFamilyProfile = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profileText) || (/single/i.test(profileText) && !/multi/i.test(profileText));
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
  ].join(' ').toLowerCase();
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);
  const isSFOC = isSingleFamilyProfile && !hasRentalSignal;
  const effectiveProfile = profile || (isSFOC ? 'single_family_owner_occupier' : 'unknown');

  // Use validated actions from viewModel if available
  const _vmRisks = viewModel?.dealRisks ?? [];

  interface RiskCard {
    title: string;
    description: string;
    severity: string;
    action: string;
    icon: React.ReactNode;
    iconColor: string;
    sectionId: string;
    category?: string;
  }

  const riskCards: RiskCard[] = [];
  const seenSectionTitles = new Set<string>();

  for (const s of sections) {
    if (!isRiskSection(s)) continue;
    if (riskCards.length >= 3) break;
    // Skip if we already have a similar section
    const titleLower = renderValue(s.title).toLowerCase();
    if (seenSectionTitles.has(titleLower)) continue;
    seenSectionTitles.add(titleLower);

    const sev = s.items.find((i) => i.severity)?.severity
      ?? s.items.find((i) => i.badge)?.badge
      ?? 'Medium';
    const descItem = s.items.find((i) => renderValue(i.description));
    const actionItem = s.items.find(
      (i) => /action|verify|inspect|check|request/i.test(renderValue(i.description ?? i.title))
    );

    const descText = renderValue(descItem?.description ?? '');
    const rawAction = renderValue(actionItem?.description ?? actionItem?.title ?? '');

    // Heuristic: if the raw action looks like a summary fragment (longer than 60 chars
    // and no question mark, starts with a noun-like word), regenerate it.
    const looksLikeSummary = rawAction.length > 60 && !rawAction.includes('?') &&
      /^(the|this|that|it|deferred|visible|observed|noted|there|property|home|unit|building)/i.test(rawAction);
    // Heuristic: if the raw action is nearly identical to description, regenerate it.
    // Use 80-char threshold so specific longer actions (legal, environmental) are preserved.
    const tooSimilar = rawAction.length > 0 &&
      (descText.length > 0) &&
      (rawAction.includes(descText) || descText.includes(rawAction)) &&
      rawAction.length > 80;

    // isValidAction check: must be >= 50 chars and start with Ask/Check/Verify/...
    // If not valid, use buildRiskAction fallback
    const isValidActionFn = (action: string, summary: string): boolean => {
      if (!action || action.trim().length < 50) return false;
      if (action.trim() === (summary || '').trim()) return false;
      return /^(ask|check|verify|request|inspect|obtain|get)/i.test(action.trim());
    };

    const action = (rawAction && !looksLikeSummary && !tooSimilar && !/verify this before making a decision/i.test(rawAction) && isValidActionFn(rawAction, descText))
      ? rawAction
      : buildRiskAction(titleLower + ' ' + descText, isNYC, effectiveProfile);

    riskCards.push({
      title: renderValue(s.title),
      description: renderValue(descItem?.description ?? s.subtitle),
      severity: renderValue(sev),
      action,
      icon: iconFor(s.id, 'w-5 h-5'),
      iconColor: iconColorFor(s.id),
      sectionId: s.id,
    });
  }

  // Never backfill from highlights.risks — those items are already shown in
  // "What Could Change Your Decision" and are unstructured snippets, not
  // standalone risk modules. Deal-Changing Risks should only show structured
  // sections (Maintenance Risk, Legal & Compliance, etc.) regardless of count.

  if (riskCards.length === 0) return null;

  const filteredCards = riskCards.filter((c) => c.title || c.description);
  const consumedIds = filteredCards
    .map((c) => c.sectionId)
    .filter((id): id is string => id !== '__highlights__');

  return (
    <>
      <SectionRegistrar ids={consumedIds} />
      <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose-600/70" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Deal-Changing Risks</h2>
          </div>
        </div>
        <p className="text-slate-500 text-sm mb-6 sm:mb-8">
          Not every issue is a deal breaker — but these are the ones to check before you rely on the listing.
        </p>

        <div className="space-y-4 sm:space-y-6">
          {filteredCards.map((card, i) => {
            const sevKey = card.severity?.toLowerCase() ?? '';
            const cardBg =
              sevKey === 'high' || sevKey === 'critical'
                ? 'bg-rose-50 border-rose-200'
                : sevKey === 'medium'
                ? 'bg-amber-50 border-amber-200'
                : 'bg-slate-50 border-slate-200';

            return (
              <div key={i} className={`relative ${cardBg} rounded-xl p-5 sm:p-6 border overflow-hidden`}>
                <div className="flex items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <span className={card.iconColor}>{card.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                      <h3 className="text-base sm:text-xl font-bold text-slate-900">{card.title}</h3>
                      <SeverityPill value={card.severity} />
                    </div>
                  </div>
                </div>

                {card.description && (
                  <p className="text-slate-700 text-sm sm:text-base leading-relaxed mb-3 sm:mb-4">
                    {card.description}
                  </p>
                )}

                {card.action && (
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className="bg-slate-800 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 shrink-0">
                      <Target className="w-3.5 h-3.5 text-white" />
                      <span className="uppercase text-xs font-bold tracking-wide text-white">Action</span>
                    </div>
                    <span className="text-slate-700 text-sm font-medium min-w-0 break-words leading-relaxed">{card.action}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4: PropertySnapshotSection — "Is the Price Fair?" + property facts
// ─────────────────────────────────────────────────────────────────────────────

function PropertySnapshotSection({ report, isBasic }: { report: NormalizedReport; isBasic?: boolean }) {
  const { hero, quickFacts, sections, meta } = report;

  // Sale-only section — never render for rent reports.
  if (meta?.reportMode === 'rent') return null;
  // Schema-based guard (defence in depth against meta loss).
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score) return null;

  // Effective property category for display and routing
  const effectiveProfile = meta?.reportProfile ?? meta?.normalizedPropertyCategory ?? '';
  const isSFOC = effectiveProfile === 'single_family_owner_occupier';
  const isCoop = effectiveProfile === 'co_op' || (meta?.normalizedPropertyCategory ?? '') === 'co_op';
  const _isMultiFamily = effectiveProfile === 'multi_family';
  const _isCondo = effectiveProfile === 'condo';
  const _isTownhouse = effectiveProfile === 'townhouse';
  const _isLand = effectiveProfile === 'land';

  function isListingSummaryString(value: string): boolean {
    if (!value) return true;
    const text = value.trim();
    return (
      /\b\d+\s*bds\b/i.test(text) ||
      /\b\d+\s*beds?\b/i.test(text) ||
      /\b\d+\s*ba\b/i.test(text) ||
      /\b\d+[,.\d]*\s*sqft\b/i.test(text) ||
      /\b\d+\s*sq\s*ft\b/i.test(text) ||
      /home\s+for\s+sale\b/i.test(text) ||
      /\bactive\b/i.test(text) ||
      /\bmulti\.?family\s+home\s+for\s+sale\b/i.test(text) ||
      /\bsingle\s+family\s+home\s+for\s+sale\b/i.test(text) ||
      /\bcondo\s+for\s+sale\b/i.test(text) ||
      /\btownhouse\s+for\s+sale\b/i.test(text) ||
      /\bhome\s+for\s+rent\b/i.test(text) ||
      /\bapartment\s+for\s+rent\b/i.test(text) ||
      /\bcondo\s+for\s+rent\b/i.test(text) ||
      /\btownhouse\s+for\s+rent\b/i.test(text) ||
      /\bhouse\s+for\s+rent\b/i.test(text) ||
      /\bfor\s+rent\b/i.test(text)
    );
  }

  function safeDisplayText(value: string | undefined | null): string {
    if (!value) return '';
    const text = String(value).trim();
    if (isListingSummaryString(text)) return '';
    return text;
  }

  const raw = (report as any).raw ?? {};

  // Address: hero.address first, then property-snapshot Address item, then raw.listingInfo.address.
  const address = safeDisplayText(
    renderValue(hero.address ?? '') ||
    renderValue(sections.find((s) => s.id === 'property-snapshot')?.items.find((i) =>
      /address/i.test(renderValue(i.title))
    )?.value ?? '') ||
    renderValue(raw.listingInfo?.address ?? '') ||
    renderValue(raw.address ?? '')
  );

  const qfItems = quickFacts
    .filter((f) => {
      const label = renderValue(f.label);
      // Filter out Type field — user has asked to suppress all Type display
      if (/^type$/i.test(label)) return false;
      return true;
    })
    .map((f) => ({
      label: renderValue(f.label),
      value: renderValue(f.value),
      helper: renderValue(f.helper),
    }))
    .filter((f) => f.value);

  const priceSection = sections.find(
    (s) => /price/i.test(s.id + s.title) && !/investment/i.test(s.id)
  );
  const priceItems = priceSection?.items ?? [];

  const hasAddress = !!address;
  const hasQuickFacts = qfItems.length > 0;
  const hasPriceData = priceItems.some(
    (i) => renderValue(i.value) || renderValue(i.description)
  );

  if (!hasAddress && !hasQuickFacts && !hasPriceData) return null;

  const priceData = priceItems
    .map((item) => ({
      label: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
    }))
    .filter((i) => i.value || i.description);

  // Extract price confidence for explanation
  const confValue = priceData.find((i) => /confidence/i.test(i.label))?.value ?? '';
  const confIsLow = /low|limited|uncertain/i.test(confValue);

  // Sanity check: deduplicate analysisText if it contains repeated risk-suffix fragments.
  // This guards against backend拼接 bugs where "could materially change value" or
  // "should be verified independently" appears more than once.
  function cleanPriceExplanation(text: string): string {
    if (!text) return text;
    // Collapse repeated phrases: if a sentence fragment appears more than once, keep only the last occurrence
    const repeatedPhrase = /((?:[^.!?]+\s){0,5}should be verified independently(?:[^.!?]*)?)\s*(?:\1\s*)+/gi;
    const step1 = text.replace(repeatedPhrase, '$1');
    // Remove duplicate "could materially change value" occurrences
    const materialDups = /((?:[^.!?]+\s){0,3}could materially change value(?:[^.!?]*)?)\s*(?:\1\s*)+/gi;
    const step2 = step1.replace(materialDups, '$1');
    // If the text already ends with a complete sentence (has trailing . ! or ?), return as-is.
    // Only truncate when there are genuinely trailing incomplete fragments after the last complete sentence.
    const trimmed = step2.trim();
    if (/[.!?]$/.test(trimmed)) return trimmed;
    const lastSentence = step2.match(/[^.!?]*[.!?]/g);
    if (lastSentence && lastSentence.length > 0) {
      return lastSentence[lastSentence.length - 1].trim();
    }
    return trimmed;
  }

  const rawAnalysisText = priceData.find((i) =>
    /analysis|explanation|summary|context/i.test(i.label)
  )?.description ?? priceData.find((i) =>
    /analysis|explanation|summary|context/i.test(i.label)
  )?.value ?? '';
  const analysisText = cleanPriceExplanation(rawAnalysisText);

  // Detect uncertain verdict — do not say "appears fair" when verdict is unknown
  const verdictText = priceData.find((i) =>
    /verdict|assessment|fair|over|under/i.test(i.label)
  )?.value ?? '';
  const verdictIsUnknown = /unknown|uncertain|cannot|insufficient|no comp/i.test(verdictText);
  // hasComps must reflect ACTUAL valuation data, not just label keywords — otherwise
  // the copy will claim "no Zestimate / no sales range" even when raw.valuation has them.
  const rawAny = (report as any)?.raw ?? {};
  const valuation = rawAny.valuation ?? {};
  const propertySnap = rawAny.property_snapshot ?? {};
  const realZestimate = valuation.zestimate ?? rawAny.zestimate ?? propertySnap.zestimate ?? propertySnap.market_estimate ?? valuation.estimated_market_value ?? rawAny.estimated_market_value;
  const realZestimateNum = typeof realZestimate === 'number' ? realZestimate : Number(String(realZestimate ?? '').replace(/[^0-9.]/g, '')) || 0;
  const realSalesRange = valuation.sales_range ?? rawAny.sales_range
    ?? (Array.isArray(rawAny.comparable_sales) ? rawAny.comparable_sales : null)
    ?? (Array.isArray(propertySnap.comparable_sales) ? propertySnap.comparable_sales : null);
  const realRentZestimate = rawAny.investment_potential?.estimated_monthly_rent
    ?? rawAny.investmentPotential?.estimated_monthly_rent
    ?? rawAny.investmentPotential?.estimatedMonthlyRent
    ?? rawAny.rent_zestimate
    ?? rawAny.rentZestimate;
  const realCompsList = realSalesRange;
  const realCompsCount = Array.isArray(realCompsList) ? realCompsList.filter((c: unknown) => c != null).length : 0;
  const hasComps = priceData.some((i) =>
    /comparable|comp|zestimate|zillow|redfin|market/i.test((i.label + ' ' + i.description).toLowerCase())
  ) || realZestimateNum > 0 || realCompsCount > 0;
  const hasRealZestimate = realZestimateNum > 0;
  const hasRealSalesRange = realCompsCount > 0;
  const hasRealRentZestimate = realRentZestimate != null && realRentZestimate !== '' && realRentZestimate !== 0;
  const verdictIsOverpriced = /overpriced|over|too high|above|high/i.test(verdictText);
  const verdictIsFair = /fair|reasonable|good.*value|undervalued|below/i.test(verdictText) && !/not fair|unfair/i.test(verdictText);
  const pricePerSqftText = priceData.find((i) => /price\/?sqft|\$\/sqft|price\/sqft/i.test(i.label))?.value ?? '';
  const pricePerSqftValue = Number(String(pricePerSqftText).replace(/[^0-9.]/g, '')) || 0;
  const highPricePerSqft = pricePerSqftValue >= 800;

  // Extract daysOnZillow from raw result for market-time-aware copy
  const daysOnZillowRaw = (report as any)?.raw?.property_snapshot?.daysOnZillow
    ?? (report as any)?.raw?.property_snapshot?.daysOnMarket
    ?? (report as any)?.raw?.daysOnZillow
    ?? (report as any)?.raw?.daysOnMarket;
  const daysOnZillowNum = typeof daysOnZillowRaw === 'number' ? daysOnZillowRaw
    : typeof daysOnZillowRaw === 'string' ? parseInt(daysOnZillowRaw, 10) : null;
  const hasValidDom = daysOnZillowNum != null && Number.isFinite(daysOnZillowNum);
  const isShortDom = hasValidDom && daysOnZillowNum < 30;
  const isMidDom = hasValidDom && daysOnZillowNum >= 30 && daysOnZillowNum < 60;

  // Verdict-aware confidence copy — prevents contradictions like "appears fair" when verdict is Overpriced
  function getPriceConfidenceCopy(): string {
    const isMultiFamilyLike = /multi|two.?family|duplex|triplex|fourplex|income|rental/i.test(String((report as any)?.raw?.normalizedPropertyCategory ?? (report as any)?.raw?.reportProfile ?? ''))
      || /two.?family|duplex|multi.?family|rental unit|income unit/i.test(String((report as any)?.raw?.property_snapshot?.homeType ?? (report as any)?.raw?.property_snapshot?.home_type ?? ''));

    if (isCoop) {
      // Co-op: focus on maintenance cost verification, not interior condition
      if (verdictIsOverpriced) {
        return 'The asking price may look attractive, but do not rely on it without confirming the monthly maintenance fee — it can significantly change the real cost of ownership.';
      }
      if (verdictIsFair) {
        return 'Asking price may be within a plausible range, but verify the monthly maintenance, upcoming assessments, board rules, and building financials before treating it as a fair deal.';
      }
      if (verdictIsUnknown || !hasComps) {
        return 'Price cannot be judged confidently without the monthly maintenance cost. Verify board financials, assessments, and flip tax before estimating the true cost.';
      }
      return 'Do not treat the asking price as a bargain until maintenance, assessments, and building financials are verified.';
    }
    // Multi-family: focus on rental verification, comps, condition. We do NOT
    // reference "no Zestimate / no sales range" because those are extractor
    // gaps (the listing page may have it; HomeScope just didn't capture it).
    // Buyer's price confidence depends on rental verification + comps +
    // condition + recent permits — not on whether we scraped Zillow.
    if (isMultiFamilyLike && (verdictIsUnknown || !hasComps || !hasRealRentZestimate)) {
      const psfText = pricePerSqftText || (pricePerSqftValue ? `$${pricePerSqftValue.toLocaleString()}/sqft` : 'the asking price per sqft');
      const missingParts: string[] = [];
      if (!hasRealRentZestimate) missingParts.push('no Rent Zestimate');
      const missingClause = missingParts.length
        ? `there is ${missingParts.join(', ')}, and the ${psfText} asking price depends on verified legal two-family use, rental income, visible condition, recent permit history, and nearby comparable sales.`
        : `the ${psfText} asking price depends on verified legal two-family use, rental income, visible condition, recent permit history, and nearby comparable sales.`;
      return `Price confidence is limited because ${missingClause}`;
    }
    if (isSFOC && (highPricePerSqft || verdictIsOverpriced || verdictIsUnknown || !hasComps)) {
      // No "no Zestimate / no sales range" reference — those are extractor
      // gaps, not the listing's fault. SFOC price confidence comes from comps /
      // condition / permit history / inspection findings.
      const missingParts: string[] = [];
      const prefix = missingParts.length
        ? `Price confidence is limited because there is ${missingParts.join(' and ')}, and the asking price needs nearby comparable single-family sales, visible condition, recent permit history, and inspection findings to support it.`
        : 'Price confidence is limited; verify the asking price against nearby comparable single-family sales, visible condition, recent permit history, and inspection findings before relying on it.';
      return prefix;
    }
    if (verdictIsOverpriced) {
      if (isSFOC) {
        return 'The asking price appears high relative to visible condition. Confidence is still limited because local comps, full inspection details, and permit status have not been verified.';
      }
      const marketTimeClause = isShortDom
        ? '' // 16 days: no market time mention
        : isMidDom
        ? 'market response is still developing, and ' // 30-59 days
        : hasValidDom
        ? 'extended market time, and ' // 60+ days
        : 'and '; // no DOM data: remove market time claim
      return `The asking price appears high relative to visible condition${marketTimeClause ? ` ${marketTimeClause}` : '.'} Confidence is still limited because local comps, full inspection details, and permit status have not been verified.`;
    }
    if (verdictIsFair) {
      if (isSFOC) {
        return 'Asking price may be within a plausible range based on available signals, but confidence is limited until condition, permits, and comparable single-family sales are verified.';
      }
      return 'Asking price may be within a plausible range based on available signals, but confidence is limited until condition, legal use, and comparable sales are verified.';
    }
    if (verdictIsUnknown || !hasComps) {
      if (isSFOC) {
        return 'Price cannot be judged confidently from the available data. The price per sqft is only a starting point — condition, permits, comparable single-family sales, and renovation needs could materially change value and should be verified independently.';
      }
      return 'Price cannot be judged confidently from the available data. The price per sqft is only a starting point — condition, permits, comparable sales, and renovation needs could materially change value and should be verified independently.';
    }
    if (isSFOC) {
      return 'Do not treat the asking price as a bargain until condition, permits, and comparable single-family sales are verified.';
    }
    return 'Do not treat the asking price as a bargain until legal use, condition, and comparable sales are verified.';
  }

  return (
    <div className="rounded-2xl p-8 md:p-10 mb-8" style={{ backgroundColor: '#282828' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(218, 165, 32, 0.15)' }}>
          <Home className="w-5 h-5" style={{ color: '#DAA520' }} />
        </div>
        <h2 className="text-2xl font-bold text-white">PROPERTY SNAPSHOT</h2>
        {isBasic && (
          <p className="text-xs text-stone-400 mt-0.5">Based on listing data — condition and market comparison not yet verified.</p>
        )}
      </div>

      {/* Address intentionally omitted here to avoid duplicating the Hero address */}

      {/* Price Fairness Section */}
      {hasPriceData && (
        <div className="rounded-xl p-8 mb-6" style={{ backgroundColor: '#3a3a3a' }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(218, 165, 32, 0.15)' }}>
              <DollarSign className="w-5 h-5" style={{ color: '#DAA520' }} />
            </div>
            <h3 className="text-xl font-bold text-white">Is the Price Fair?</h3>
          </div>

          {/* Estimated Value Range (large) */}
          {(() => {
            const estMin = priceData.find((i) => /min/i.test(i.label))?.value;
            const estMax = priceData.find((i) => /max/i.test(i.label))?.value;
            if (estMin || estMax) {
              const range = [estMin, estMax].filter(Boolean).join(' – ');
              return (
                <div className="mb-8">
                  <div className="text-slate-400 uppercase text-xs tracking-wider mb-3">Estimated Value Range</div>
                  <div className="text-2xl font-bold text-white">{range}</div>
                </div>
              );
            }
            return null;
          })()}

          {/* Asking Price (large) */}
          {(() => {
            const asking = priceData.find((i) =>
              /asking|list|price/i.test(i.label)
            )?.value;
            if (asking) {
              return (
                <div className="mb-8">
                  <div className="text-slate-400 uppercase text-xs tracking-wider mb-3">Asking Price</div>
                  <div className="text-2xl font-bold text-white">{asking}</div>
                </div>
              );
            }
            return null;
          })()}

          {/* Verdict + Confidence row */}
          {(() => {
            const verdict = priceData.find((i) => /verdict|assessment|fair|over|under/i.test(i.label))?.value;
            if (!verdict && !confValue) return null;
            return (
              <div className="flex items-center gap-4 mb-6 pb-6 border-b flex-wrap" style={{ borderColor: 'rgba(148, 163, 184, 0.3)' }}>
                {verdict && (
                  <>
                    <div className="text-slate-400 uppercase text-sm tracking-wide">Verdict</div>
                    <div className="text-white font-semibold text-lg">{verdict}</div>
                  </>
                )}
                {confValue && (
                  <div className="text-slate-400">
                    Confidence: {confValue}
                    {confIsLow && <span className="text-amber-400 ml-1">— price may shift with more info</span>}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Analysis paragraph — verdict-aware rewrite for "Unknown" verdicts */}
          {(() => {
            if (verdictIsUnknown && analysisText && /reasonable|appears.*fair|good.*value|undervalued/i.test(analysisText)) {
              return (
                <p className="text-slate-200 text-base leading-relaxed mb-6">
                  Asking price may be within a plausible range based on partial signals, but confidence is low without nearby comparable sales, legal-use verification, rental support, and inspection results.
                </p>
              );
            }
            if (analysisText) {
              return <p className="text-slate-200 text-base leading-relaxed mb-6">{analysisText}</p>;
            }
            if (confIsLow) {
              return (
                <p className="text-slate-300 text-sm leading-relaxed mb-6">
                  Low confidence means the price may look reasonable on paper, but missing condition details could change the real value.
                </p>
              );
            }
            return null;
          })()}

          {/* Low confidence explanation box — verdict-aware, never contradicts the verdict */}
          {confIsLow && (
            <div className="rounded-lg p-5 mb-2" style={{ backgroundColor: '#282828', borderColor: 'rgba(148, 163, 184, 0.2)', borderWidth: '1px', borderStyle: 'solid' }}>
              <div className="font-semibold text-amber-400 mb-1">Why Price Confidence Is Limited</div>
              <p className="text-slate-300 text-sm leading-relaxed">{getPriceConfidenceCopy()}</p>
            </div>
          )}

          {/* Price Confidence box (if not low) */}
          {(() => {
            const conf = priceData.find((i) => /confidence/i.test(i.label) && i.description);
            if (!conf || confIsLow) return null;
            return (
              <div className="rounded-lg p-5" style={{ backgroundColor: '#282828', borderColor: 'rgba(148, 163, 184, 0.2)', borderWidth: '1px', borderStyle: 'solid' }}>
                <div className="font-semibold text-white mb-2">Price Confidence: {renderValue(conf.value ?? '')}</div>
                <p className="text-slate-300 text-sm leading-relaxed">{conf.description}</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Quick Facts grid */}
      {hasQuickFacts && (
        <div className="mt-6 sm:mt-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {qfItems.map((item, i) => (
              <div
                key={i}
                className="rounded-lg px-4 py-3 min-w-0"
                style={{ backgroundColor: '#3a3a3a' }}
              >
                <div className="text-slate-400 uppercase text-xs tracking-wider mb-1 truncate">
                  {item.label}
                </div>
                <div className="text-white font-semibold text-sm sm:text-base truncate min-w-0 break-words">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 5: CarryingCostsSection — "What It May Really Cost Monthly"
// ─────────────────────────────────────────────────────────────────────────────

function CarryingCostsSection({ report }: { report: NormalizedReport }) {
  // Sale-only section — never render for rent reports.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rent_fairness) return null;
  const _sections = report.sections;
  const raw = report.raw ?? {};

  // ── Read monthly breakdown directly from raw carrying_costs ─────────────────
  const carrying_costs = (raw as any).carrying_costs ?? {};
  const mb = (carrying_costs as any).monthly_breakdown ?? {};
  const zf = (raw as any).zillowFinancials ?? {};

  // Helper to safely extract a dollar amount from various shapes
  function toMoney(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'number') return '$' + v.toLocaleString();
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (obj.value != null) return toMoney(obj.value);
    }
    return '';
  }

  function toMonthly(v: unknown): string {
    const m = toMoney(v);
    if (m && !/\/mo$/i.test(m)) return m + '/mo';
    return m;
  }

  // Extract breakdown values — read from mb fields directly (they are { value: number } or plain numbers)
  const estimatedMonthlyPayment = toMonthly(
    mb.estimatedMonthlyPayment?.value ?? mb.estimatedMonthlyPayment ??
    zf.monthlyPayment?.estimatedPayment?.value ?? zf.monthlyPayment?.estimatedMonthlyPayment?.value ??
    (raw as any).monthlyPayment ?? (raw as any).monthly_payment ?? null
  );
  const principalAndInterest = toMoney(
    mb.principalAndInterest?.value ?? mb.principalAndInterest ??
    zf.monthlyPayment?.principalAndInterest?.value ?? null
  );
  const propertyTaxes = toMoney(
    mb.propertyTaxes?.value ?? mb.propertyTaxes ??
    zf.monthlyPayment?.propertyTaxes?.value ?? null
  );
  const homeInsurance = toMoney(
    mb.homeInsurance?.value ?? mb.homeInsurance ??
    zf.monthlyPayment?.homeInsurance?.value ?? null
  );
  const hoaFees = (() => {
    if (mb.hoaFees?.status === 'not_applicable' || zf.hoaFees?.status === 'not_applicable') return 'N/A';
    const v = mb.hoaFees?.value ?? mb.hoaFees ?? zf.hoaFees?.value ?? null;
    return toMoney(v);
  })();
  const utilities = (() => {
    if (mb.utilities?.status === 'not_included' || zf.utilities?.status === 'not_included') return 'Not included';
    return '';
  })();

  // Annual tax — with anomaly detection and derived fallback
  // Zillow/StreetEasy pages sometimes parse tax data into wildly incorrect values
  // (e.g. $656,604 for a $725,000 home). If annual_tax > 5% of price, suppress
  // it and fall back to propertyTaxes * 12 derived from the monthly payment breakdown.
  const rawAnnualTaxVal = (() => {
    const v = carrying_costs.annual_tax ?? carrying_costs.annualTax ??
      (raw as any).annualTax ?? (raw as any).annual_tax ?? null;
    if (v == null) return null;
    return typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, '')) || null;
  })();
  const priceForGuard = (() => {
    const p = (raw as any).price ?? (raw as any).askingPrice ??
      (raw as any).listingInfo?.price ?? (raw as any).property_snapshot?.price ?? 0;
    if (typeof p === 'number') return p;
    const parsed = parseFloat(String(p).replace(/[^0-9.]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  })();
  const isSuspectedAnomaly = rawAnnualTaxVal != null
    && priceForGuard > 0
    && rawAnnualTaxVal > priceForGuard * 0.05;
  // Derive effective annual tax from monthly payment breakdown
  const derivedAnnualTax = (() => {
    const monthlyTaxVal = (typeof mb.propertyTaxes?.value === 'number')
      ? mb.propertyTaxes.value
      : parseFloat(String(propertyTaxes).replace(/[^0-9.]/g, '')) || null;
    return monthlyTaxVal != null && monthlyTaxVal > 0 && monthlyTaxVal < 10000
      ? Math.round(monthlyTaxVal * 12)
      : null;
  })();
  const annualTax = (() => {
    if (isSuspectedAnomaly) return null;
    if (rawAnnualTaxVal != null) {
      if (typeof rawAnnualTaxVal === 'number') return '$' + rawAnnualTaxVal.toLocaleString() + '/yr';
      return String(rawAnnualTaxVal);
    }
    return null;
  })();
  // Show derived annual tax only when raw is suppressed and derived is available
  const showDerivedAnnualTax = isSuspectedAnomaly && derivedAnnualTax != null;
  // Effective annual tax for display
  const effectiveAnnualTax = annualTax
    ?? (showDerivedAnnualTax ? '$' + derivedAnnualTax.toLocaleString() + '/yr (derived from monthly payment)' : null)
    ?? null;

  const hasBreakdown = !!(estimatedMonthlyPayment || principalAndInterest || propertyTaxes || homeInsurance);
  const hasCostSignal = hasBreakdown || !!(effectiveAnnualTax || hoaFees === 'N/A');

  if (!hasCostSignal) {
    return (
      <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5 text-violet-600/70" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">What It May Really Cost Monthly</h2>
        </div>
        <div className="rounded-xl p-4 mb-4 bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-amber-800 text-sm leading-relaxed">The listing does not provide enough cost data to estimate monthly ownership expenses.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
          <DollarSign className="w-5 h-5 text-violet-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">What It May Really Cost Monthly</h2>
      </div>

      {/* Zillow Monthly Payment Breakdown */}
      {hasBreakdown && (
        <div className="space-y-1 mb-6">
          {/* Total */}
          {estimatedMonthlyPayment && (
            <div className="flex justify-between items-center py-2.5 border-b border-slate-200 mb-2">
              <span className="text-sm font-semibold text-slate-900">Zillow Estimated Monthly Payment</span>
              <span className="text-lg font-bold text-slate-900">{estimatedMonthlyPayment}</span>
            </div>
          )}
          {/* Breakdown rows */}
          {principalAndInterest && (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-500">Principal & Interest</span>
              <span className="text-sm font-medium text-slate-700">{principalAndInterest}</span>
            </div>
          )}
          {propertyTaxes && (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-500">Zillow Property Tax Estimate</span>
              <span className="text-sm font-medium text-slate-700">{propertyTaxes}</span>
            </div>
          )}
          {homeInsurance ? (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-500">Home Insurance Estimate</span>
              <span className="text-sm font-medium text-slate-700">{homeInsurance}</span>
            </div>
          ) : (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-400">Home Insurance Estimate</span>
              <span className="text-sm text-slate-400">Not provided</span>
            </div>
          )}
          <div className="flex justify-between items-start py-1.5">
            <span className="text-sm text-slate-400">HOA</span>
            <span className="text-sm text-slate-400">{hoaFees || 'None'}</span>
          </div>
          {utilities && (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-400">Utilities</span>
              <span className="text-sm text-slate-400">{utilities}</span>
            </div>
          )}
          {/* Annual tax — separate from monthly breakdown; uses derived value if raw is anomalous */}
          {effectiveAnnualTax && (
            <div className="flex justify-between items-start py-1.5 border-t border-slate-100 mt-2 pt-2">
              <span className="text-sm text-slate-600">Annual Tax</span>
              <span className="text-sm font-medium text-slate-900">{effectiveAnnualTax}</span>
            </div>
          )}
          {/* Disclaimer */}
          <div className="mt-3 pt-2 border-t border-slate-100">
            {hasBreakdown && estimatedMonthlyPayment ? (
              <p className="text-xs text-slate-400 italic">Zillow estimates monthly ownership cost around {estimatedMonthlyPayment}, excluding utilities. Verify taxes, insurance, loan terms, and actual utility costs before relying on this number.</p>
            ) : (
              <p className="text-xs text-slate-400 italic">This is a Zillow estimate, not a final ownership budget.</p>
            )}
          </div>
        </div>
      )}

      {/* Fallback: annual tax only (no monthly breakdown) — uses effectiveAnnualTax */}
      {!hasBreakdown && effectiveAnnualTax && (
        <div className="space-y-1 mb-6">
          <div className="flex justify-between items-start py-1.5">
            <span className="text-sm text-slate-600">Annual Tax</span>
            <span className="text-sm font-medium text-slate-900">{effectiveAnnualTax}</span>
          </div>
        </div>
      )}

      {/* Missing costs */}
      {!(hasBreakdown || effectiveAnnualTax) && (
        <div className="rounded-xl p-4 bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-amber-800 text-sm leading-relaxed">The listing does not provide enough cost data to estimate monthly ownership expenses.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 7: AgentSpinDecoderSection
// ─────────────────────────────────────────────────────────────────────────────

function makeFallbackAsk(phrase: string, reportProfile?: string): string {
  const t = phrase.toLowerCase();
  const isSFOC = reportProfile === 'single_family_owner_occupier';

  // rental / investor / live in one unit — property-aware
  if (/rent|rental|income|investor|live in one|second unit|extra income/i.test(t)) {
    if (isSFOC) {
      return 'Are all recent updates documented with permits, and who performed the work?';
    }
    return 'Can you confirm legal two-family use, whether the second unit is legally rentable, and what actual rent it has achieved?';
  }
  if (/two.?family|multi.family|spacious|large.*family|family.*home/i.test(t)) {
    if (isSFOC) {
      return 'Can you confirm the legal use and provide the Certificate of Occupancy?';
    }
    return 'Can you confirm legal two-family use, whether the second unit is legally rentable, and what actual rent it has achieved?';
  }
  if (/basement|open.*basement|large.*basement|full.*basement/i.test(t)) {
    return 'Has the basement had water intrusion, foundation repairs, or drainage issues?';
  }
  if (/quiet|tree.?lin|peaceful|serene/i.test(t)) {
    return 'What are the nearby transit options, parking situation, and typical noise level?';
  }
  if (/personal touch|potential|vision/i.test(t)) {
    return 'Which systems or rooms have not been updated in the last 10 years?';
  }
  if (/low tax|tax.*saving/i.test(t)) {
    return 'What is the current tax bill, and has there been a recent reassessment?';
  }
  if (/updated|renovated|new.*kitchen|new.*bath/i.test(t)) {
    return 'What was updated, when, and was it permitted?';
  }
  if (/close|near|amenit|transit/i.test(t)) {
    return 'What is the actual commute time, noise level, and parking situation?';
  }
  if (/move.?in|ready|vacant/i.test(t)) {
    return 'What is the condition of the property, and are there any known defects?';
  }
  if (/storage|garage|parking/i.test(t)) {
    return 'Is the garage or parking included, and is there additional storage?';
  }
  if (/light|bright|sun|exposure/i.test(t)) {
    return 'What is the orientation of the property and typical natural light?';
  }
  return 'Can you provide documentation or records that confirm this?';
}

function AgentSpinDecoderSection({ report, viewModel }: { report: NormalizedReport; viewModel?: ReportViewModel }) {
  // Sale-only section — "Agent Spin" is a sale concept.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score) return null;
  const { sections } = report;

  // ── Compute effectiveProfile from report raw data ───────────────────────────
  const raw = report.raw ?? {};
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
    raw.property_snapshot?.homeType ?? '',
    raw.property_snapshot?.home_type ?? '',
  ].join(' ').toLowerCase();
  const profileText = (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();
  const isSingleFamilyProfile = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profileText) || (/single/i.test(profileText) && !/multi/i.test(profileText));
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);
  const isSFOC = isSingleFamilyProfile && !hasRentalSignal;
  const effectiveProfile = raw.meta?.reportProfile ?? raw.reportProfile ?? viewModel?.meta?.reportProfile
    ?? (isSFOC ? 'single_family_owner_occupier' : 'unknown');

  // ── Prefer pre-validated spinDecoder from viewModel (semantic overrides applied) ──
  const vmSpin = viewModel?.spinDecoder;
  const realityItems: Array<{
    phrase: string;
    meaning: string;
    ask: string;
    badge: string;
  }> = [];

  if (vmSpin && vmSpin.length > 0) {
    // Use the pre-validated viewModel spinDecoder which has SFOC-aware semantic overrides
    for (const item of vmSpin) {
      if (item.listingSays || item.homeScopeReads) {
        realityItems.push({
          phrase: item.listingSays,
          meaning: item.homeScopeReads,
          ask: item.ask,
          badge: '',
        });
      }
    }
  } else {
    // Fallback: build from section items (legacy path)
    const realitySection = sections.find((s) =>
      /listing.?reality|listing.?spin|agent.?lingo|agent.?spin/i.test(s.id + s.title)
    );

    if (realitySection) {
      for (const item of realitySection.items) {
        const title = renderValue(item.title);
        const desc = renderValue(item.description);
        const badge = renderValue(item.badge);
        const ask = badge && !/verify/i.test(badge) ? badge : makeFallbackAsk(title + ' ' + desc, effectiveProfile);
        if (title || desc) {
          realityItems.push({ phrase: title, meaning: desc, ask, badge });
        }
      }
    }
  }

  if (realityItems.length === 0) return null;

  // Sanitize meaning — never let listing claims appear as verified facts
  for (const item of realityItems) {
    if (!/listing (claims|describes|suggests)/i.test(item.meaning)) {
      const firstWord = item.meaning.split(' ')[0] || '';
      const _lowerFirst = firstWord.toLowerCase();
      // If meaning starts with a word that makes it sound like a verified fact, prepend "Listing claims"
      if (/^(the|this property|it|is|was|registered|confirmed|approved|legal)/i.test(firstWord)) {
        item.meaning = 'Listing claims: ' + item.meaning.charAt(0).toLowerCase() + item.meaning.slice(1);
      }
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
          <FileSearch className="w-5 h-5 text-indigo-600/70" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Agent Spin Decoder</h2>
        </div>
      </div>
      <p className="text-slate-500 text-sm mb-6 sm:mb-8">
        What the listing language may really mean for a buyer.
      </p>

      <div className="space-y-5 sm:space-y-6">
        {realityItems.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
            {/* Listing says */}
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Listing says</div>
              <p className="text-slate-800 text-sm font-medium italic">"{item.phrase}"</p>
            </div>

            {/* HomeScope reads it as */}
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-start gap-2">
                <Eye className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">HomeScope reads it as</div>
                  <p className="text-slate-700 text-sm leading-relaxed">{item.meaning}</p>
                </div>
              </div>
            </div>

            {/* Ask */}
            <div className="px-5 py-4 bg-amber-50/50">
              <div className="flex items-start gap-2">
                <CircleHelp className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 mb-1">Ask before viewing</div>
                  <p className="text-slate-700 text-sm leading-relaxed">{item.ask}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 8: WhoThisPropertyWorksForSection
// ─────────────────────────────────────────────────────────────────────────────

// ── normalizeFitSection ──────────────────────────────────────────────────────
// Reads best_for / not_ideal_for directly from raw report data (before adapter
// stringification), so bullets are actual strings, not a single comma-joined string.
function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['title', 'label', 'name', 'heading', 'value', 'summary', 'description']) {
      const t = toText(obj[key]);
      if (t) return t;
    }
    return '';
  }
  return '';
}

function normalizeFitSection(report: NormalizedReport): {
  bestFor: string[];
  notIdealFor: string[];
  whyItMatters: string;
} {
  const raw = report.raw ?? {};
  const layout = raw.layout_fit ?? raw.layoutFit ?? {};

  // ── Detect report profile from raw data ────────────────────────────────
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
    raw.property_snapshot?.homeType ?? '',
    raw.property_snapshot?.home_type ?? '',
  ].join(' ').toLowerCase();

  const profile = (raw.meta?.reportProfile ?? raw.reportProfile ?? '') ||
    (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();

  const isSingleFamilyProfile =
    /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profile) ||
    (/single/i.test(profile) && !/multi/i.test(profile));

  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);

  const isSFOC = isSingleFamilyProfile && !hasRentalSignal;

  // best_for: array of strings, or comma/semicolon/newline separated string
  let bestFor: string[] = [];
  const bfRaw = layout.best_for ?? layout.bestFor;
  if (Array.isArray(bfRaw)) {
    bestFor = bfRaw.map(toText).filter(Boolean);
  } else if (typeof bfRaw === 'string' && bfRaw.trim()) {
    bestFor = bfRaw.split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 3);
  }

  // not_ideal_for: same
  let notIdealFor: string[] = [];
  const nifRaw = layout.not_ideal_for ?? layout.notIdealFor;
  if (Array.isArray(nifRaw)) {
    notIdealFor = nifRaw.map(toText).filter(Boolean);
  } else if (typeof nifRaw === 'string' && nifRaw.trim()) {
    notIdealFor = nifRaw.split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 3);
  }

  // whyItMatters from summary field
  const summary = toText(layout.summary ?? '');

  // ── Property-aware fallbacks — must NEVER carry data from another listing ──
  // Every string below is derived at runtime from the actual report's raw fields.
  // If a field is missing, we render a neutral placeholder, never a hardcoded
  // city / year / system name from a prior report.
  if (bestFor.length === 0) {
    // Pull representative facts from raw listing data
    const snap = raw.property_snapshot ?? {};
    const info = raw.listingInfo ?? {};
    const beds = Number(snap.beds ?? snap.bedrooms ?? info.bedrooms ?? NaN);
    const baths = Number(snap.baths ?? snap.bathrooms ?? info.bathrooms ?? NaN);
    const bedroomBit = Number.isFinite(beds) && beds > 0
      ? `${beds}-bedroom`
      : 'multi-bedroom';
    const bathBit = Number.isFinite(baths) && baths > 0
      ? `${baths}-bath`
      : 'single-bath';
    const homeType = String(snap.homeType ?? snap.home_type ?? info.propertyType ?? '').trim();
    const typeBit = homeType
      ? homeType.toLowerCase().includes('multi')
        ? 'multi-family layout'
        : homeType.toLowerCase().includes('condo')
          ? 'condo layout'
          : homeType.toLowerCase().includes('co-op') || homeType.toLowerCase().includes('coop')
            ? 'co-op layout'
            : 'single-family layout'
      : isSFOC ? 'single-family layout' : 'this layout';

    if (isSFOC) {
      bestFor = [
        `Owner-occupants looking for a ${bedroomBit} ${typeBit}`,
        `Buyers prioritizing ${bathBit} layouts with private outdoor space`,
        'Buyers prioritizing this neighborhood\'s amenities and commute access',
      ];
    } else {
      bestFor = [
        `Owner-occupants seeking rental income to offset a ${bedroomBit} ${typeBit}`,
        'Multi-generational households needing separate living areas',
        'Buyers comfortable with renovation and permit verification',
      ];
    }
  }
  if (notIdealFor.length === 0) {
    if (isSFOC) {
      notIdealFor = [
        'Investors seeking strong rental cash flow',
        'Buyers needing a large open floor plan',
        'Buyers unwilling to inspect older building systems',
      ];
    } else {
      notIdealFor = [
        'Buyers wanting move-in-ready condition with no renovation work',
        'Buyers with limited renovation budget',
        'Buyers uncomfortable with legal-use or rental-income verification',
      ];
    }
  }

  const defaultWhyItMatters = (() => {
    const snap = raw.property_snapshot ?? {};
    const info = raw.listingInfo ?? {};
    const yearBuiltRaw = snap.year_built ?? snap.yearBuilt ?? info.yearBuilt;
    const yearBuiltNum = Number(yearBuiltRaw);
    if (Number.isFinite(yearBuiltNum) && yearBuiltNum > 1800 && yearBuiltNum < 2030) {
      if (yearBuiltNum < 1978) {
        return `Built in ${yearBuiltNum} — electrical panel, plumbing material, heating system, roof age, basement moisture history, and possible lead-based paint risk due to pre-1978 construction should all be verified before relying on this property. Permit history for any renovation work should also be confirmed.`;
      }
      return `Built in ${yearBuiltNum} — electrical panel, plumbing, heating, and roof age should be verified before relying on this property. Permit history for any renovation work should also be confirmed.`;
    }
    return 'Year built was not disclosed by the listing. Electrical, plumbing, heating, roof age, and permit history should be verified independently before relying on this property.';
  })();

  return {
    bestFor,
    notIdealFor,
    whyItMatters: summary || defaultWhyItMatters,
  };
}

function WhoThisPropertyWorksForSection({ report }: { report: NormalizedReport }) {
  // Sale-only section — rent has its own "Who This Rental Works For" component.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score) return null;
  const { bestFor, notIdealFor, whyItMatters } = normalizeFitSection(report);

  // Render nothing only if there's no data and all fallbacks were used
  if (bestFor.length === 0 && notIdealFor.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
          <Home className="w-5 h-5 text-teal-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Who This Property Works For</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-5">
        {/* Best for */}
        {bestFor.length > 0 && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <ThumbsUp className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold text-emerald-800 uppercase text-xs tracking-wide">Best For</span>
            </div>
            <ul className="space-y-2">
              {bestFor.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-emerald-900">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Not ideal for */}
        {notIdealFor.length > 0 && (
          <div className="rounded-xl bg-rose-50 border border-rose-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Ban className="w-4 h-4 text-rose-600" />
              <span className="font-semibold text-rose-800 uppercase text-xs tracking-wide">Not Ideal For</span>
            </div>
            <ul className="space-y-2">
              {notIdealFor.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-rose-900">
                  <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Why it matters */}
      {whyItMatters && (
        <div className="rounded-xl p-4 bg-slate-50 border border-slate-200">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-slate-700 text-sm mb-1">Why it matters</div>
              <p className="text-slate-600 text-sm leading-relaxed">{whyItMatters}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 9: QuestionsToAskSection
// ─────────────────────────────────────────────────────────────────────────────

// Field-name patterns that are NOT real questions — skip or convert these
const FIELD_NAME_PATTERNS = [
  /year built|property age|annual.*tax|tax.*assess|bedroom count|bathroom count|sqft|square.*foot|roof type|dwelling type|building code|lot size|days on market|market time/i,
];

// Convert field-name text into a real question
function fieldToQuestion(fieldText: string, reportProfile?: string): string {
  const t = fieldText.toLowerCase();
  const isSFOC = reportProfile === 'single_family_owner_occupier';
  if (/roof|drainage|leak/i.test(t)) return 'How old are the roof, boiler, electrical panel, plumbing, and HVAC systems?';
  if (/electrical|plumb|heating|boiler|system|mechanical/i.test(t)) return 'When were the major systems last updated, and are maintenance records available?';
  if (/comparable|comp|market trends|recent sale/i.test(t)) return isSFOC
    ? 'Can you provide recent comparable single-family sales for similar homes in the area?'
    : 'Can you provide recent comparable sales for similar properties in the area?';
  if (/legal|two.?family|occupancy|certificate/i.test(t)) return isSFOC
    ? 'Can you confirm the basement’s current use, condition, access, permits, and whether any basement area is included in legal rentable space?'
    : 'Can you provide the Certificate of Occupancy or legal-use documents confirming the permitted use of this property?';
  if (/rent|income|lease|tenant/i.test(t)) return isSFOC
    ? 'Can you confirm the basement’s current use, condition, access, permits, and whether any basement area is included in legal rentable space?'
    : 'Can you confirm the property permitted use and whether there are any rental restrictions if you intend to rent it?';
  if (/price|asking|list/i.test(t)) return 'Has the price been reduced since listing, and what is the seller\'s motivation?';
  if (/days on market|262|listed|how long/i.test(t)) return 'Why has the property been on market for this long? Were there any price reductions, failed offers, or buyer concerns?';
  if (/violation|dob|hpd|complaint|permit/i.test(t)) return isSFOC
    ? 'Are there any local building department records, permits, complaints, or open violations? What permits were pulled for recent updates?'
    : 'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?';
  if (/basement|foundation|water|intrusion|drainage/i.test(t)) return 'Has the basement had water intrusion, foundation repairs, or drainage issues?';
  if (/insurance|flood|zone/i.test(t)) return 'Is the property in a flood zone, and what does insurance typically cost for this property?';
  if (/cost|tax|hoa|expense|monthly/i.test(t)) return isSFOC
    ? 'Can you provide the actual insurance quote, average utility costs, and any owner-paid expenses?'
    : 'What are the real monthly costs including insurance, utilities, repairs, vacancy, and maintenance reserve?';
  if (/photo|photo.?count|interior/i.test(t)) return 'Can you provide additional interior photos or inspection details for the basement, roof, and mechanical systems?';
  return '';
}

const QUESTION_TAGS: Array<{ keywords: RegExp; label: string; color: string }> = [
  { keywords: /legal|co |occupancy|permit|violation|registered/i, label: 'Legal', color: 'bg-violet-100 text-violet-700' },
  { keywords: /roof|drainage|leak/i, label: 'Roof', color: 'bg-amber-100 text-amber-700' },
  { keywords: /electrical|plumb|heating|boiler|system|mechanical/i, label: 'Systems', color: 'bg-orange-100 text-orange-700' },
  { keywords: /basement|foundation|water|intrusion|drainage/i, label: 'Basement', color: 'bg-blue-100 text-blue-700' },
  { keywords: /rent|rental|income|lease/i, label: 'Rent', color: 'bg-green-100 text-green-700' },
  { keywords: /insurance|flood|zone/i, label: 'Insurance', color: 'bg-blue-100 text-blue-700' },
  { keywords: /photo|interior|exterior|photo.?count/i, label: 'Photos', color: 'bg-pink-100 text-pink-700' },
  { keywords: /cost|tax|hoa|expense|monthly|maintenance|reserve/i, label: 'Costs', color: 'bg-teal-100 text-teal-700' },
  { keywords: /comparable|comp|sale|market.*value|price.*verdict/i, label: 'Price', color: 'bg-amber-100 text-amber-700' },
  { keywords: /days on market|market time|listed|262|hasn't sold/i, label: 'Market Time', color: 'bg-indigo-100 text-indigo-700' },
];

function getQuestionTag(text: string): { label: string; color: string } {
  for (const { keywords, label, color } of QUESTION_TAGS) {
    if (keywords.test(text)) return { label, color };
  }
  return { label: 'General', color: 'bg-slate-100 text-slate-700' };
}

// Core question families for deduplication — one question per topic area
const CORE_QUESTION_FAMILIES: Array<{ keywords: RegExp; label: string; color: string }> = [
  { keywords: /certificate of occupancy|legal two.?family|legal use|legal status/i, label: 'Legal', color: 'bg-violet-100 text-violet-700' },
  { keywords: /violations.*hpd|open permits.*violations|open permits.*hpd/i, label: 'Legal', color: 'bg-violet-100 text-violet-700' },
  { keywords: /violation|complaint|permit|open permit|dob|hpd/i, label: 'Legal', color: 'bg-violet-100 text-violet-700' },
  { keywords: /roof|drainage|leak/i, label: 'Roof', color: 'bg-amber-100 text-amber-700' },
  { keywords: /electrical|plumb|heating|boiler|system|mechanical|plumbing/i, label: 'Systems', color: 'bg-orange-100 text-orange-700' },
  { keywords: /basement|foundation|water|intrusion|drainage/i, label: 'Basement', color: 'bg-blue-100 text-blue-700' },
  { keywords: /rental|rent|income|lease|tenant|legal rent/i, label: 'Rent', color: 'bg-green-100 text-green-700' },
  { keywords: /flood|insurance|zone|windstorm|hurricane/i, label: 'Insurance', color: 'bg-blue-100 text-blue-700' },
  { keywords: /photo|interior|basement|exterior|mechanical|system photo/i, label: 'Photos', color: 'bg-pink-100 text-pink-700' },
  { keywords: /monthly|cost|tax|hoa|maintenance|reserve|expense|utility/i, label: 'Costs', color: 'bg-teal-100 text-teal-700' },
  { keywords: /comparable|comp|sale|market.*value|price.*verdict/i, label: 'Price', color: 'bg-amber-100 text-amber-700' },
  { keywords: /days on market|market time|listed|262|hasn't sold/i, label: 'Market Time', color: 'bg-indigo-100 text-indigo-700' },
];

// Region-aware fallback questions — varies by NYC vs non-NYC AND by reportProfile
function getFallbackQuestions(isNYC: boolean, reportProfile?: string): Array<{ q: string; tag: string; color: string }> {
  const isSFOC = reportProfile === 'single_family_owner_occupier';
  // records reference kept for future use: isNYC ? 'NYC DOB, HPD, and ACRIS' : 'local building department and county records'

  if (isSFOC) {
    return [
      { q: 'Can you confirm the basement’s current use, condition, access, permits, and whether any basement area is included in legal rentable space?', tag: 'Legal', color: 'bg-violet-100 text-violet-700' },
      { q: 'Are there any local building department records, permits, complaints, or open violations? What permits were pulled for recent updates?', tag: 'Legal', color: 'bg-violet-100 text-violet-700' },
      { q: 'How old is the roof, and what is the electrical panel capacity?', tag: 'Roof', color: 'bg-amber-100 text-amber-700' },
      { q: 'Has the basement had water intrusion, foundation repairs, or drainage issues?', tag: 'Basement', color: 'bg-blue-100 text-blue-700' },
      { q: 'Can you provide recent comparable sales for similar nearby properties to support the asking price?', tag: 'Price', color: 'bg-amber-100 text-amber-700' },
      { q: 'Can you provide the actual insurance quote, average utility costs, and any owner-paid expenses?', tag: 'Costs', color: 'bg-teal-100 text-teal-700' },
      { q: 'What plumbing materials are currently used, and have they been updated?', tag: 'Systems', color: 'bg-orange-100 text-orange-700' },
      { q: 'Why has the property been on market for so long? Were there any price reductions or buyer concerns?', tag: 'Market Time', color: 'bg-indigo-100 text-indigo-700' },
    ];
  }

  return [
    { q: 'Can you provide the Certificate of Occupancy or legal-use documents confirming the permitted use of this property?', tag: 'Legal', color: 'bg-violet-100 text-violet-700' },
    { q: 'Can you provide recent comparable sales for similar nearby properties to support the asking price?', tag: 'Price', color: 'bg-amber-100 text-amber-700' },
    { q: 'Are there any open permits, violations, complaints, or unresolved building records for this address?', tag: 'Legal', color: 'bg-violet-100 text-violet-700' },
    { q: 'Are gas, electric, heat, and water separately metered or owner-paid? Can you provide recent utility bills?', tag: 'Costs', color: 'bg-teal-100 text-teal-700' },
    { q: 'How old are the roof, boiler/heating system, electrical panels, plumbing, and water heater?', tag: 'Systems', color: 'bg-orange-100 text-orange-700' },
    { q: 'What is the basement’s current condition, access, permitted use, and water-intrusion history?', tag: 'Basement', color: 'bg-blue-100 text-blue-700' },
  ];
}

function QuestionsToAskSection({ report, viewModel, isBasic }: { report: NormalizedReport; viewModel?: ReportViewModel; isBasic?: boolean }) {
  const { sections, hero } = report;
  const maxQuestions = isBasic ? 5 : 6;
  const rawResultForTrace = (report as any)?.raw ?? {};

  const isNYC = viewModel?.meta?.isNYC
    ?? /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
      (hero?.address ?? '') + (hero?.title ?? '')
    );

  // ── Compute reportProfile from report data ─────────────────────────────────
  const raw = report.raw ?? {};
  const profile = raw.meta?.reportProfile ?? raw.reportProfile
    ?? viewModel?.meta?.reportProfile ?? '';
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
    raw.property_snapshot?.homeType ?? '',
    raw.property_snapshot?.home_type ?? '',
  ].join(' ').toLowerCase();
  const profileText = (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();
  const isSingleFamilyProfile = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profileText) || (/single/i.test(profileText) && !/multi/i.test(profileText));
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);
  const effectiveProfile = profile || (isSingleFamilyProfile && !hasRentalSignal ? 'single_family_owner_occupier' : 'unknown');

  // ── P0-7: Skip questions about fields that are already known from the listing ──────
  // Derive known fields from hero + sections to avoid redundant questions.
  const _heroAddress = hero?.address ?? '';
  const _heroTitle = hero?.title ?? '';
  const knownBeds = /^\d+$/.test(String(hero?.bedrooms ?? ''));
  const knownBaths = /^\d+$/.test(String(hero?.bathrooms ?? ''));
  const knownSqft = /^\d+$/.test(String(hero?.sqft ?? ''));
  const knownPropertyType = !!(viewModel?.meta?.displayType && !/^unknown$/i.test(viewModel.meta.displayType));
  const knownYearBuilt = sections.some(s => {
    const yearItem = s.items?.find((i: any) => /year.?built|year_built/i.test(i.title ?? ''));
    return yearItem && !/unknown/i.test(String(yearItem.value ?? yearItem.description ?? ''));
  });
  const knownPrice = !!(hero?.price && !/unknown/i.test(String(hero?.price)));

  function shouldSkipQuestion(q: string): boolean {
    const lower = q.toLowerCase();
    // ── Property-aware filtering ───────────────────────────────────────────────
    // For single-family owner-occupier profiles, skip multi-family/rental questions
    if (effectiveProfile === 'single_family_owner_occupier') {
      if (/two.family|2.family|legal two.family|legal 2.family|second unit rent|actual rent history|rental income cannot be assumed|owner.occupy \+ rental|hpd registration for rental|legally rentable|comparable two.family rentals|rent roll|income unit|actual rent achieved/i.test(lower)) {
        return true;
      }
    }
    // ── P0: Skip any variant of "missing basic property details" — ALWAYS when basic fields are known.
    // This catches AI-generated questions that slip through the backend and viewModel filters.
    if (knownBeds && knownBaths && knownSqft && knownPropertyType) {
      if (
        /missing basic property|provide.*beds.*baths.*interior|property type.*beds.*baths.*interior|what are the.*beds.*baths.*size|can you provide.*beds.*baths|missing property details|basic property details.*beds|can you (tell me|confirm|give me).*beds.*baths.*sqft|what('s| is) the.*beds.*baths.*sqft/i.test(lower) ||
        /provide.*beds.*baths.*size|provide.*missing.*beds.*baths|can you (provide|tell).*beds.*baths.*(and )?(sqft|size|interior)|can you provide the.*beds.*baths.*sqft|what are the.*beds.*baths.*interior/i.test(lower)
      ) {
        return true;
      }
    }
    // Broader: if beds+baths are known, skip anything asking for beds+baths
    if (knownBeds && knownBaths) {
      if (/beds?\s*[,\/]\s*baths?\s*[,\/]\s*(?:interior\s*)?(size|sqft|sq\.?ft|square footage)/i.test(lower)) {
        return true;
      }
    }
    // Year built — skip if known
    if (knownYearBuilt) {
      if (/year.?built|when was.*built|construction date.*unknown/i.test(lower)) {
        return true;
      }
    }
    // Zestimate — skip if asking price is known (Zestimate not needed as a separate question)
    if (knownPrice && /no zestimate|without zestimate|missing zestimate|estimate.*available/i.test(lower)) {
      return true;
    }
    // Property type — skip if known
    if (knownPropertyType) {
      if (/property type.*missing|what type of property|unknown.*property type/i.test(lower)) {
        return true;
      }
    }
    return false;
  }

  // Prefer viewModel questions (pre-validated) when available
  const vmQuestions = viewModel?.questions ?? [];
  let finalQuestions: Array<{ question: string; tag: string; tagColor: string; whereToVerify: string }> = [];

  if (vmQuestions.length > 0) {
    finalQuestions = vmQuestions.map(q => ({
      question: q.text,
      tag: q.category,
      tagColor: q.tagColor,
      whereToVerify: '',
    }));
    // ── Multi-layer question deduplication pipeline ─────────────────────────────────
    // Layer 1: Substring dedup — keep longer version when one question fully contains the other
    const dedupedBySubstring: typeof finalQuestions = [];
    for (const q of finalQuestions) {
      let dominated = false;
      let moreSpecificExistingIdx = -1;
      for (let ei = 0; ei < dedupedBySubstring.length; ei++) {
        const existing = dedupedBySubstring[ei];
        if (existing.question.toLowerCase().includes(q.question.toLowerCase()) && existing.question.length > q.question.length) {
          dominated = true; break;
        }
        if (q.question.toLowerCase().includes(existing.question.toLowerCase()) && q.question.length > existing.question.length) {
          moreSpecificExistingIdx = ei;
        }
      }
      if (dominated) continue;
      if (moreSpecificExistingIdx >= 0) {
        dedupedBySubstring[moreSpecificExistingIdx] = q;
      } else {
        dedupedBySubstring.push(q);
      }
    }

    // Layer 2: Prefix dedup — if two questions share the same opening content phrase
    // (ignoring stopwords), keep the longer one. Catches:
    // "Can you provide recent comparable single-family sales to support the asking price?" vs
    // "Can you provide recent comparable single-family sales for similar homes in the area?"
    const STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
      'will', 'shall', 'may', 'might', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
      'by', 'from', 'as', 'that', 'this', 'these', 'those', 'what', 'which', 'who',
      'whom', 'and', 'or', 'but', 'not', 'no', 'any', 'all', 'each', 'every', 'if',
      'then', 'than', 'so', 'just', 'also', 'how', 'when', 'where', 'why']);
    function tokenize(text: string): string[] {
      return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w));
    }
    function getPrefixTokens(tokens: string[], minPrefix = 4): string[] {
      return tokens.slice(0, minPrefix);
    }
    const dedupedByPrefix: typeof dedupedBySubstring = [];
    for (const q of dedupedBySubstring) {
      const qTokens = tokenize(q.question);
      const qPrefix = getPrefixTokens(qTokens, 4).join(' ');
      let replaced = false;
      for (let ei = 0; ei < dedupedByPrefix.length; ei++) {
        const existing = dedupedByPrefix[ei];
        const existingTokens = tokenize(existing.question);
        const existingPrefix = getPrefixTokens(existingTokens, 4).join(' ');
        if (qPrefix === existingPrefix) {
          // Same prefix — keep longer (more specific)
          if (q.question.length > existing.question.length) {
            dedupedByPrefix[ei] = q;
          }
          replaced = true;
          break;
        }
      }
      if (!replaced) dedupedByPrefix.push(q);
    }

    // Layer 3: Token-overlap dedup (Jaccard > 50%) — catches semantically similar questions
    const dedupedByOverlap: typeof dedupedByPrefix = [];
    outer: for (const q of dedupedByPrefix) {
      const qTokens = new Set(tokenize(q.question));
      for (const existing of dedupedByOverlap) {
        const existingTokens = new Set(tokenize(existing.question));
        let intersection = 0;
        for (const t of qTokens) { if (existingTokens.has(t)) intersection++; }
        const union = new Set([...qTokens, ...existingTokens]).size;
        const jaccard = union > 0 ? intersection / union : 0;
        if (jaccard > 0.50 && existing.question.length >= q.question.length) {
          continue outer; // skip q, keep existing
        }
        if (jaccard > 0.50 && q.question.length > existing.question.length) {
          const idx = dedupedByOverlap.indexOf(existing);
          dedupedByOverlap[idx] = q;
          continue outer;
        }
      }
      dedupedByOverlap.push(q);
    }

    // Layer 4: DOB/HPD question family dedup — collapse DOB/violations variants to longest
    const dobHpdFamilyDedup: typeof dedupedByOverlap = [];
    for (const q of dedupedByOverlap) {
      const ql = q.question.toLowerCase();
      // Check if this question starts with a DOB/HPD/violations phrase
      const dobCoreMatch = ql.match(/^are there any\s*(open\s*)?(dob|housing and preservation department|hpd)[,\s]+(or\s*)?(any\s*)?(violations?|permits?|complaints?|unresolved building issues?)[,\s]*(or\s*)?(any\s*)?(violations?|permits?|complaints?|unresolved building issues?)?[,\s]*(or\s*)?(any\s*)?(violations?|permits?|complaints?|unresolved building issues?)?/i);
      if (dobCoreMatch) {
        let replaced = false;
        for (let di = 0; di < dobHpdFamilyDedup.length; di++) {
          const existing = dobHpdFamilyDedup[di];
          const el = existing.question.toLowerCase();
          const existingCoreMatch = el.match(/^are there any\s*(open\s*)?(dob|housing and preservation department|hpd)[,\s]+(or\s*)?(any\s*)?(violations?|permits?|complaints?|unresolved building issues?)[,\s]*(or\s*)?(any\s*)?(violations?|permits?|complaints?|unresolved building issues?)?[,\s]*(or\s*)?(any\s*)?(violations?|permits?|complaints?|unresolved building issues?)?/i);
          if (existingCoreMatch) {
            // Both are DOB/HPD core questions — keep the longer (more complete) one
            if (q.question.length > existing.question.length) {
              dobHpdFamilyDedup[di] = q;
            }
            replaced = true;
            break;
          }
        }
        if (!replaced) dobHpdFamilyDedup.push(q);
      } else {
        dobHpdFamilyDedup.push(q);
      }
    }
    finalQuestions = dobHpdFamilyDedup.slice(0, maxQuestions);
  } else {
    // No AI questions — don't render the Questions module
    return null;
  }

  if (finalQuestions.length === 0) return null;

  // ── P0-7: Apply skip filter to final list before rendering ───────────────────────
  // Skips questions about already-known fields to avoid redundant/untrustworthy questions
  finalQuestions = finalQuestions.filter(q => !shouldSkipQuestion(q.question));

  console.log('[TRACE_RENDER_QUESTIONS_SOURCE]', {
    questionsFromViewModel: viewModel?.questions?.map(q => q.text),
    rawQuestionsToAsk: rawResultForTrace?.questions_to_ask,
    rawQuestionsToAskCamel: rawResultForTrace?.questionsToAsk,
    actuallyRenderedQuestions: finalQuestions.map(q => q.question),
  });

  if (finalQuestions.length === 0) return null;

  const [copied, setCopied] = React.useState(false);

  function formatQuestionsForAgent(questions: Array<{ question: string }>): string {
    const header = "Hi, I'm interested in this property. Before scheduling a viewing, could you please confirm:\n";
    const body = questions
      .slice(0, 8)
      .map((q, i) => `${i + 1}. ${q.question}`)
      .join('\n');
    const footer = '\nThanks.';
    return header + body + footer;
  }

  function handleCopyQuestions() {
    const text = formatQuestionsForAgent(finalQuestions);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
          <ClipboardList className="w-5 h-5 text-sky-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Questions to Ask Before You View</h2>
      </div>
      <p className="text-slate-500 text-sm mb-4">
        Use these before booking a viewing, contacting the agent, or making an offer.
      </p>

      {/* Copy questions for agent — light secondary button below description */}
      <button
        type="button"
        onClick={handleCopyQuestions}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-xl transition-colors cursor-pointer mb-6"
      >
        {copied ? (
          <><CheckCircle2 className="w-4 h-4 text-emerald-500" />Questions copied</>
        ) : (
          <><Copy className="w-4 h-4" />Copy questions for agent</>
        )}
      </button>

      <div className="space-y-3">
        {finalQuestions.map((q, i) => (
          <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors">
            <div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-xs font-bold text-slate-500">{i + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full ${q.tagColor}`}>
                  {q.tag}
                </span>
              </div>
              <p className="text-slate-800 text-sm leading-relaxed mb-0.5">{q.question}</p>
              {q.whereToVerify && (
                <p className="text-slate-500 text-xs">
                  Where to verify: {q.whereToVerify}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 10: NextBestMoveSection
// ─────────────────────────────────────────────────────────────────────────────

function NextBestMoveSection({ report }: { report: NormalizedReport }) {
  const { hero, meta } = report;

  // ── Rent-mode guard: rent has its own copy via usRent adapter (`next-best-move` section id).
  if (meta?.reportMode === 'rent') return null;
  // Schema-based guard (defence in depth against meta loss).
  const _rawCheck = (report as any).raw ?? {};
  if (_rawCheck.rental_snapshot || _rawCheck.rental_listing_score || _rawCheck.rent_fairness) return null;

  const verdict = hero.verdict.toLowerCase();
  const score = hero.score;

  // Use the authoritative reportProfile from the backend/viewModel, not local re-classification.
  // Only fall back to listing-text classification as a last resort.
  const raw = (report as any).raw ?? {};
  const authoritativeProfile = meta?.reportProfile ?? raw?.meta?.reportProfile ?? raw?.reportProfile ?? '';
  const profileText = (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();
  const isSingleFamilyProfile = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profileText) || (/single/i.test(profileText) && !/multi/i.test(profileText));
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
  ].join(' ').toLowerCase();
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);
  const isSFOCFromText = isSingleFamilyProfile && !hasRentalSignal;
  // Authoritative: use backend's reportProfile if available; only fall back to listing-text detection
  const _effectiveProfile = authoritativeProfile ||
    (isSFOCFromText ? 'single_family_owner_occupier' : 'unknown');
  // Final guard: if authoritative profile says SFOC, always use SFOC messaging regardless of listing text
  const isSFOC = authoritativeProfile
    ? authoritativeProfile === 'single_family_owner_occupier'
    : isSFOCFromText;

  let message = 'Use the questions above to decide whether this property deserves a viewing.';
  if (/worth|inspecting|strong|good|recommend/i.test(verdict) && (score === null || score === undefined || score >= 75)) {
    message = 'This property may be worth viewing, but confirm the key assumptions before making an offer.';
  } else if (/caution|proceed|caution|uncertain|more.?evidence/i.test(verdict)) {
    if (isSFOC) {
      message = 'Keep this property on your shortlist, but do not rely on the finished basement value or price signal until permits, roof condition, major systems, and comparable sales are verified.';
    } else {
      message = 'Keep this property on your shortlist, but verify legal use, roof condition, major systems, and comparable sales before relying on the price.';
    }
  } else if (/skip|overpriced|risky|high.?risk|not.?recommend|do not/i.test(verdict) || (score !== null && score !== undefined && score < 60)) {
    message = 'This property may not be worth your time unless the seller or agent can answer the key risk questions clearly.';
  }

  return (
    <div className="rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border-2" style={{ backgroundColor: '#282828', borderColor: '#DAA520' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(218, 165, 32, 0.2)' }}>
          <Target className="w-5 h-5" style={{ color: '#DAA520' }} />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold" style={{ color: '#DAA520' }}>Your Next Best Move</h2>
      </div>
      <p className="text-slate-200 text-base sm:text-lg leading-relaxed">
        {message}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Remaining Phase 2 Components (kept as-is / minimal changes)
// ─────────────────────────────────────────────────────────────────────────────

// ── Investment Potential ──────────────────────────────────────────────────────

function _InvestmentPotentialSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const section = sections.find((s) =>
    /investment/i.test(s.id + s.title)
  );
  if (!section) return null;

  const allItems = section.items
    .map((item) => ({
      title: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
      badge: renderValue(item.badge),
      severity: renderValue(item.severity),
    }))
    .filter((i) => i.title || i.value || i.description);

  if (allItems.length === 0) return null;

  const signals: typeof allItems = [];
  const risks: typeof allItems = [];
  const verify: typeof allItems = [];
  const general: typeof allItems = [];

  for (const item of allItems) {
    const text = (item.title + ' ' + item.value + ' ' + item.description).toLowerCase();
    const label = item.title.toLowerCase();

    if (/signal|positive|upside|strength|good|castle|best/i.test(text) || /signal|positive|upside|strength|good/i.test(label)) {
      signals.push(item);
    } else if (/risk|concern|negative|downside|weak|problem|bad/i.test(text) || /risk|concern|negative|downside/i.test(label)) {
      risks.push(item);
    } else if (/verify|check|inspect|confirm|ask|question|data.?gap|missing/i.test(text) || /verify|check|inspect|confirm|ask|question/i.test(label)) {
      verify.push(item);
    } else if (item.title || item.value || item.description) {
      general.push(item);
    }
  }

  const summary = renderValue(section.subtitle ?? section.items.find((i) =>
    /summary|overview|assessment/i.test(renderValue(i.title))
  )?.description ?? '');

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-5 h-5 text-teal-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          {renderValue(section.title)}
        </h2>
      </div>

      {summary && (
        <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-6">{summary}</p>
      )}

      {signals.length > 0 && (
        <div className="mb-6">
          <div className="font-semibold text-slate-700 mb-3 uppercase text-xs tracking-wide">Supporting Signals</div>
          <ul className="space-y-2">
            {signals.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <span className="text-sm min-w-0 break-words">{item.value || item.description || item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {risks.length > 0 && (
        <div className="mb-6">
          <div className="font-semibold text-slate-700 mb-3 uppercase text-xs tracking-wide">Risks</div>
          <ul className="space-y-2">
            {risks.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <XCircle className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <span className="text-sm min-w-0 break-words">{item.value || item.description || item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verify.length > 0 && (
        <div className="mb-6">
          <div className="font-semibold text-slate-700 mb-3 uppercase text-xs tracking-wide">Things to Verify</div>
          <ul className="space-y-2">
            {verify.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <span className="text-slate-500 shrink-0 mt-0.5">-</span>
                <span className="text-sm min-w-0 break-words">{item.value || item.description || item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {general.length > 0 && signals.length === 0 && risks.length === 0 && verify.length === 0 && (
        <div className="divide-y divide-slate-100">
          {general.map((item, i) => (
            <div key={i} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-700">{item.title}</span>
                {item.description && (
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                )}
              </div>
              {item.value && <span className="text-sm font-semibold text-slate-900 shrink-0">{item.value}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detailed Risk Analysis ───────────────────────────────────────────────────

function _DetailedRiskAnalysisSection({ report }: { report: NormalizedReport }) {
  const { sections, hero } = report;

  const isNYC = /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
    (hero?.address ?? '') + (hero?.title ?? '')
  );

  const riskSections = sections.filter((s) => {
    if (!isRiskSection(s)) return false;
    if (useIsSectionUsed(s.id)) return false;
    return true;
  });

  if (riskSections.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6 sm:mb-8">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-orange-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Detailed Risk Analysis</h2>
      </div>

      <div className="space-y-6 sm:space-y-8">
        {riskSections.map((s, idx) => {
          const items = s.items
            .map((item) => ({
              title: renderValue(item.title),
              value: renderValue(item.value),
              description: renderValue(item.description),
              badge: renderValue(item.badge),
              severity: renderValue(item.severity),
            }))
            .filter((i) => i.title || i.value || i.description);

          if (items.length === 0) return null;

          const sev = items.find((i) => i.severity)?.severity
            ?? items.find((i) => i.badge)?.badge
            ?? '';
          const summary = items.find((i) => /summary|overview|assessment|description/i.test(i.title))?.description
            ?? items.find((i) => /summary|overview|assessment|description/i.test(i.title))?.value
            ?? items.find((i) => i.description && !i.value)?.description
            ?? '';

          const otherItems = items.filter((i) => !/summary|overview|assessment|description/i.test(i.title));

          // Replace generic verify text with specific action
          const processedItems = otherItems.map((item) => {
            if (/verify this before making a decision/i.test(item.title + ' ' + (item.description ?? ''))) {
              return {
                ...item,
                description: buildRiskAction(renderValue(s.title) + ' ' + item.description, isNYC),
              };
            }
            return item;
          });

          return (
            <div key={s.id} className={idx < riskSections.length - 1 ? 'pb-6 sm:pb-8 border-b border-gray-200' : ''}>
              <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconColorFor(s.id).replace('/70', '').replace('text', 'bg-')}/10`}>
                    <span className={iconColorFor(s.id)}>{iconFor(s.id, 'w-4.5 h-4.5')}</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900">{renderValue(s.title)}</h3>
                </div>
                {sev && <SeverityPill value={sev} />}
              </div>

              {summary && (
                <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-4">{summary}</p>
              )}

              {processedItems.length > 0 && processedItems.some((i) => i.title || i.value) && (
                <div>
                  {(() => {
                    const grouped: Record<string, typeof processedItems> = {};
                    for (const item of processedItems) {
                      const label = item.title || '';
                      const cat =
                        /risk|factor|failure|cost/i.test(label) ? 'Risk Factors' :
                        /inspect|priority|check|action/i.test(label) ? 'Inspection Priorities' :
                        /verify|where|data|missing|need/i.test(label) ? 'Where to Verify' :
                        'Details';
                      if (!grouped[cat]) grouped[cat] = [];
                      grouped[cat].push(item);
                    }
                    return Object.entries(grouped).map(([cat, catItems]) => {
                      const filtered = catItems.filter((i) => i.title || i.value);
                      if (filtered.length === 0) return null;
                      return (
                        <div key={cat} className="mb-4">
                          {cat !== 'Details' && (
                            <div className="font-semibold text-gray-900 mb-2">{cat}</div>
                          )}
                          <ul className="space-y-1.5 ml-5">
                            {filtered.map((item, i) => (
                              <li key={i} className="text-gray-700 text-sm list-disc">
                                {item.value || item.description || item.title}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Risk Categories — Buyer-Advocate 4-Class Risk Signal Framework ──────────

type RiskCategoryKey = 'foundation_basement' | 'water_leaks' | 'roof_exterior' | 'hidden_ownership_cost';
type RiskLevel = 'High' | 'Medium' | 'Low' | 'Unknown';

function normalizeRiskLevel(raw: unknown, signal: string): RiskLevel {
  const s = String(raw ?? '').trim();
  if (s === 'High' || s === 'Medium' || s === 'Low' || s === 'Unknown') return s;
  const sig = signal.toLowerCase();
  if (sig.includes('risk signal')) return 'High';
  if (sig.includes('needs verification')) return 'Medium';
  if (sig.includes('listing shows evidence') || sig.includes('no listing evidence')) return 'Low';
  return 'Unknown';
}

const RISK_CATEGORY_META: Record<RiskCategoryKey, { label: string; icon: React.ReactNode }> = {
  foundation_basement:    { label: 'Foundation / Basement',    icon: <Layers size={18} strokeWidth={1.5} /> },
  water_leaks:           { label: 'Water / Leaks',            icon: <Droplets size={18} strokeWidth={1.5} /> },
  roof_exterior:         { label: 'Roof / Exterior',          icon: <House size={18} strokeWidth={1.5} /> },
  hidden_ownership_cost: { label: 'Hidden Cost',              icon: <Wallet size={18} strokeWidth={1.5} /> },
};

function RiskCategoriesSection({ report }: { report: NormalizedReport }) {
  // Sale-only section — uses foundation_basement/water_leaks/roof_exterior/hidden_ownership_cost.
  // Rent has its own RentalRiskCategoriesSection that uses rent lanes.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard: if the report has a rent schema (rental_risk_categories etc.),
  // it is a rent report even if meta.reportMode was lost in transit.
  const raw = (report.raw as any) ?? {};
  if (raw.rental_snapshot || raw.rental_listing_score || raw.rental_listing_trust || raw.rent_fairness) return null;
  const rc = (report.raw as any)?.risk_categories;
  if (!rc || typeof rc !== 'object') return null;

  const entries = (Object.keys(RISK_CATEGORY_META) as RiskCategoryKey[])
    .map((key) => {
      const meta = RISK_CATEGORY_META[key];
      const c = rc[key];
      if (!c || typeof c !== 'object') return null;
      const signal = safeText((c as any).signal) || 'Needs verification';
      const evidence = safeText((c as any).evidence) || 'Unknown — listing does not prove';
      const missing = safeText((c as any).missing) || '';
      const why = safeText((c as any).why_it_matters) || '';
      const riskLevel = normalizeRiskLevel((c as any).risk_level, signal);
      const qs: string[] = Array.isArray((c as any).questions)
        ? (c as any).questions.filter((x: unknown) => typeof x === 'string' && (x as string).trim())
        : [];
      return { key, meta, signal, evidence, missing, why, riskLevel, qs };
    })
    .filter(Boolean) as Array<{
      key: RiskCategoryKey;
      meta: { label: string; icon: React.ReactNode };
      signal: string;
      evidence: string;
      missing: string;
      why: string;
      riskLevel: RiskLevel;
      qs: string[];
    }>;

  if (entries.length === 0) return null;

  const badgeForLevel = (level: RiskLevel): { cls: string; label: string } => {
    switch (level) {
      case 'High':   return { cls: 'bg-red-50 text-red-700 border border-red-200',           label: 'Risk signal' };
      case 'Medium': return { cls: 'bg-amber-50 text-amber-700 border border-amber-200',       label: 'Needs verification' };
      case 'Low':    return { cls: 'bg-green-50 text-green-700 border border-green-200',      label: 'Listing shows evidence' };
      default:       return { cls: 'bg-stone-100 text-stone-700 border border-stone-200',     label: 'Unknown' };
    }
  };

  const dotForLevel = (level: RiskLevel): string => {
    switch (level) {
      case 'High':   return 'bg-red-500';
      case 'Medium': return 'bg-amber-500';
      case 'Low':    return 'bg-green-500';
      default:       return 'bg-stone-400';
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out mb-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <ShieldAlert size={18} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-stone-900">Risk Categories</h3>
          <p className="text-xs text-stone-500">Buyer-advocate 4-class risk check. Each category shows risk level, listing evidence, what's missing, and why it matters.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 @container[size>=640px]:grid-cols-2 gap-3">
        {entries.map(({ key, meta, signal, evidence, missing, why, riskLevel, qs }) => {
          const badge = badgeForLevel(riskLevel);
          return (
            <div key={key} className="rounded-xl border border-stone-200 bg-stone-50/40 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-white border border-stone-200 flex items-center justify-center text-stone-600 shrink-0">
                    {meta.icon}
                  </div>
                  <span className="text-sm font-semibold text-stone-800 leading-tight">{meta.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${dotForLevel(riskLevel)}`}
                    title={`Risk level: ${riskLevel}`}
                    aria-label={`Risk level ${riskLevel}`}
                  />
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {signal && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-0.5">Signal</div>
                    <p className="text-xs text-stone-800 font-medium leading-relaxed">{signal}</p>
                  </div>
                )}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-0.5">Listing evidence</div>
                  <p className="text-xs text-stone-700 leading-relaxed">{evidence}</p>
                </div>
                {missing && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-0.5">Not proven</div>
                    <p className="text-xs text-stone-600 leading-relaxed">{missing}</p>
                  </div>
                )}
                {why && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-0.5">Why it matters</div>
                    <p className="text-xs text-stone-600 leading-relaxed">{why}</p>
                  </div>
                )}
                {qs.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-0.5">Ask</div>
                    <ul className="space-y-1">
                      {qs.slice(0, 4).map((q, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-stone-700 leading-relaxed">
                          <span className="text-stone-400 mt-0.5 shrink-0">•</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[10px] text-stone-400 italic">
        These are signals derived from listing facts and visible photos. They are not a structural inspection — verify with a licensed inspector and the listing agent before making an offer.
      </div>
    </div>
  );
}

// ── Listing Does Not Prove ─────────────────────────────────────────────────────

function ListingDoesNotProveSection({ report }: { report: NormalizedReport }) {
  // Sale-only heading copy ("buyer-relevant facts") — rent uses GenericSectionCard.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard — defence in depth against meta loss.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score || (report.raw as any)?.who_this_rental_works_for) return null;
  const arr = (report.raw as any)?.listing_does_not_prove;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const items = arr.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0);
  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out mb-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <HelpCircle size={18} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-stone-900">What the Listing Does Not Prove</h3>
          <p className="text-xs text-stone-500">Key buyer-relevant facts this listing has not disclosed or documented.</p>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 p-3 bg-stone-50 rounded-xl">
            <span className="shrink-0 mt-0.5 text-amber-500">•</span>
            <span className="text-sm text-stone-700 leading-relaxed">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Before You Book a Showing ──────────────────────────────────────────────────

const BYBS_MIN = 7;
const BYBS_MAX = 10;

const BYBS_STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
  'will', 'shall', 'may', 'might', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
  'by', 'from', 'as', 'that', 'this', 'these', 'those', 'what', 'which', 'who',
  'whom', 'and', 'or', 'but', 'not', 'no', 'any', 'all', 'each', 'every', 'if',
  'then', 'than', 'so', 'just', 'also', 'how', 'when', 'where', 'why']);

function bybsTokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !BYBS_STOPWORDS.has(w));
}

function dedupeQuestions(input: string[]): string[] {
  // Layer 1: substring dedup (keep longer)
  const layer1: string[] = [];
  for (const q of input) {
    let dominated = false;
    let moreSpecificIdx = -1;
    for (let i = 0; i < layer1.length; i++) {
      const ex = layer1[i];
      if (ex.toLowerCase().includes(q.toLowerCase()) && ex.length > q.length) { dominated = true; break; }
      if (q.toLowerCase().includes(ex.toLowerCase()) && q.length > ex.length) moreSpecificIdx = i;
    }
    if (dominated) continue;
    if (moreSpecificIdx >= 0) layer1[moreSpecificIdx] = q; else layer1.push(q);
  }
  // Layer 2: prefix dedup
  const layer2: string[] = [];
  for (const q of layer1) {
    const prefix = bybsTokenize(q).slice(0, 4).join(' ');
    let replaced = false;
    for (let i = 0; i < layer2.length; i++) {
      const exPrefix = bybsTokenize(layer2[i]).slice(0, 4).join(' ');
      if (prefix === exPrefix) {
        if (q.length > layer2[i].length) layer2[i] = q;
        replaced = true; break;
      }
    }
    if (!replaced) layer2.push(q);
  }
  // Layer 3: token overlap (Jaccard > 0.5)
  const layer3: string[] = [];
  outer3: for (const q of layer2) {
    const qt = new Set(bybsTokenize(q));
    for (const ex of layer3) {
      const et = new Set(bybsTokenize(ex));
      let inter = 0;
      for (const t of qt) if (et.has(t)) inter++;
      const uni = new Set([...qt, ...et]).size;
      const jacc = uni > 0 ? inter / uni : 0;
      if (jacc > 0.5) {
        if (q.length > ex.length) {
          const idx = layer3.indexOf(ex);
          layer3[idx] = q;
        }
        continue outer3;
      }
    }
    layer3.push(q);
  }
  return layer3;
}

function BeforeYouBookShowingSection({ report, viewModel }: { report: NormalizedReport; viewModel?: ReportViewModel }) {
  // Sale-only section — "Before You Book a Showing" is a purchase concept.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score || (report.raw as any)?.before_tour_apply_pay) return null;
  const raw = (report.raw as any) ?? {};
  const fromBybs = Array.isArray(raw.before_you_book_showing)
    ? raw.before_you_book_showing.filter((x: unknown): x is string => typeof x === 'string' && x.trim())
    : [];
  const vmQuestions = (viewModel?.questions ?? []).map(q => q.text).filter(Boolean);
  const fromQta = Array.isArray(raw.questions_to_ask)
    ? raw.questions_to_ask.filter((x: unknown): x is string => typeof x === 'string' && x.trim())
    : [];

  // Priority: bybs (most targeted) ∪ viewModel questions ∪ raw questions_to_ask
  const merged = dedupeQuestions([...fromBybs, ...vmQuestions, ...fromQta]);
  const items = merged.slice(0, BYBS_MAX);
  if (items.length < BYBS_MIN) return null;

  return (
    <div className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out mb-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <HelpCircle size={18} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-stone-900">Before You Book a Showing</h3>
          <p className="text-xs text-stone-500">Ask the seller or listing agent before you book a showing. These questions target the risks the listing has not addressed.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {items.map((q, i) => (
          <div key={i} className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
            <span className="text-stone-400 text-sm font-medium shrink-0">Q{i + 1}.</span>
            <span className="text-sm text-stone-700 leading-relaxed">{q}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Location Reality Check ────────────────────────────────────────────────────

function LocationRealityCheckSection({ report }: { report: NormalizedReport }) {
  // Sale-only section — uses location-reality-check section id which only exists in sale reports.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.location_daily_life || (report.raw as any)?.rental_listing_score) return null;
  const { sections } = report;

  // ── Compute effectiveProfile from report data ───────────────────────────────
  const raw = report.raw ?? {};
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
    raw.property_snapshot?.homeType ?? '',
    raw.property_snapshot?.home_type ?? '',
  ].join(' ').toLowerCase();
  const profileText = (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();
  const isSingleFamilyProfile = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profileText) || (/single/i.test(profileText) && !/multi/i.test(profileText));
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);
  const isSFOC = isSingleFamilyProfile && !hasRentalSignal;

  const section = sections.find((s) => /location-reality-check/i.test(s.id));
  if (!section) return null;

  const claims = section.items
    .filter((i) => i.title === 'claims')
    .map((i) => renderValue(i.description))
    .filter(Boolean);

  const verifications = section.items
    .filter((i) => i.title === 'verifications')
    .map((i) => renderValue(i.description))
    .filter(Boolean);

  const claimList = claims[0] ? claims[0].split('\n').map((c) => c.trim()).filter(Boolean) : [];
  const verifyList = verifications[0] ? verifications[0].split('\n').map((v) => v.trim()).filter(Boolean) : [];

  // ── Extract Zillow location data from raw report ──
  // Read from top-level fields (analyze function result) AND from listingInfo (backward compat)
  const extractedLocation = {
    neighborhood: (raw as any).neighborhood ?? (raw as any).listingData?.neighborhood
      ?? (raw as any).listingInfo?.neighborhood ?? '',
    floodZone: (raw as any).floodZone ?? (raw as any).listingData?.floodZone
      ?? (raw as any).listingInfo?.floodZone ?? '',
    walkScore: (raw as any).walkScore ?? (raw as any).listingData?.walkScore
      ?? (raw as any).listingInfo?.walkScore ?? '',
    bikeScore: (raw as any).bikeScore ?? (raw as any).listingData?.bikeScore
      ?? (raw as any).listingInfo?.bikeScore ?? '',
    schoolRatings: (raw as any).schoolRatings ?? (raw as any).listingData?.schoolRatings
      ?? (raw as any).listingInfo?.schoolRatings ?? '',
    transit: (raw as any).transit ?? (raw as any).listingData?.transit
      ?? (raw as any).listingInfo?.transit ?? '',
  };
  const hasExtractedLocation = Object.values(extractedLocation).some(v => v && String(v).length > 0);

  // Filter neighborhood: skip listing status values (e.g. "Active", "For Sale", "Pending")
  function isLikelyNeighborhood(val: string): boolean {
    const v = val.toLowerCase().trim();
    if (/^(active|for sale|pending|sold|off market|coming soon)$/i.test(v)) return false;
    if (/^\d[\d-]*\s+[A-Za-z].*,.*[A-Z]{2}\s*\d{5}/.test(val)) return false; // full address
    if (/^\d[\d-]*\s+[A-Za-z][A-Za-z\s]*\s*(avenue|street|ave|st|road|rd|drive|dr|place|pl|boulevard|blvd)/i.test(val)) return false;
    return true;
  }

  // Normalize schoolRatings once so it's available in both extractedClaims injection
  // and the "whatItMeans" generation below.
  const rawRatings = extractedLocation.schoolRatings;
  const ratingsArr: unknown[] = Array.isArray(rawRatings) ? rawRatings : String(rawRatings || '').split(/[,\s]+/);
  const normalizedRatings: number[] = ratingsArr
    .map((r: unknown) => parseFloat(String(r).trim()))
    .filter((r: number) => r >= 1 && r <= 10 && !isNaN(r))
    .filter((v: number, i: number, arr: number[]) => arr.indexOf(v) === i)
    .slice(0, 3);

  // Inject extracted Zillow claims when AI-generated claims are absent or sparse
  if (hasExtractedLocation) {
    const extractedClaims: string[] = [];
    // Only add neighborhood if it looks like a real neighborhood name (not listing status)
    if (extractedLocation.neighborhood && isLikelyNeighborhood(extractedLocation.neighborhood)) {
      extractedClaims.push(`Neighborhood: ${extractedLocation.neighborhood}`);
    }
    if (extractedLocation.floodZone) extractedClaims.push(`Flood Zone: ${extractedLocation.floodZone}`);
    if (extractedLocation.walkScore) extractedClaims.push(`Walk Score: ${extractedLocation.walkScore}`);
    if (extractedLocation.bikeScore) extractedClaims.push(`Bike Score: ${extractedLocation.bikeScore}`);
    if (normalizedRatings.length > 0) {
      extractedClaims.push(`School Ratings: ${normalizedRatings.join(', ')}/10`);
    }
    if (extractedLocation.transit) extractedClaims.push(`Transit Score: ${extractedLocation.transit}`);
    // Merge: prepend extracted claims, then AI claims
    for (const c of extractedClaims) {
      if (!claimList.includes(c)) claimList.unshift(c);
    }
  }

  // Standard "What to verify" questions — property-aware
  const defaultVerifyItems = isSFOC ? [
    'What are recent comparable single-family sales nearby?',
    'What are actual commute times to key destinations?',
    'What is evening and weekend parking like?',
    'What are nearby school ratings and catchment zones?',
    'What is the safety profile of this block?',
    'Is the property in a flood zone or hurricane evacuation zone?',
  ] : [
    'What are the actual nearby transit options and commute times?',
    'What are the school ratings and catchment zones?',
    'What is the crime and safety profile of this block?',
    'Is the property in a flood zone or hurricane evacuation zone?',
    'How easy is parking during evenings and weekends?',
  ];

  const seen = new Set<string>();
  const allVerify: string[] = [];

  for (const item of defaultVerifyItems) {
    const norm = item.toLowerCase();
    if (!seen.has(norm)) { seen.add(norm); allVerify.push(item); }
  }

  // Supplement with data-provided verifications (skip generic external-data noise)
  for (const v of verifyList) {
    const norm = v.toLowerCase();
    // Skip URLs and generic "check X website" noise
    if (/\.com|\.net|\.org|http|www|greatschools|niche|walkscore|walk score|transit score/i.test(norm)) continue;
    if (!seen.has(norm)) { seen.add(norm); allVerify.push(v); }
  }

  // Generate "What this could mean" explanation — property-aware, uses extracted Zillow data when available
  let whatItMeans = '';
  if (claimList.length > 0) {
    if (hasExtractedLocation) {
      // Use real extracted data to generate a meaningful explanation
      const parts: string[] = [];
      if (extractedLocation.walkScore) {
        const ws = parseInt(String(extractedLocation.walkScore), 10);
        parts.push(ws >= 70
          ? `Walk Score ${extractedLocation.walkScore} suggests strong walkability — most errands can be done on foot.`
          : `Walk Score ${extractedLocation.walkScore} indicates limited walkability — a car is likely needed for most daily tasks.`);
      }
      if (extractedLocation.bikeScore) {
        const bs = parseInt(String(extractedLocation.bikeScore), 10);
        parts.push(bs >= 70
          ? `Bike Score ${extractedLocation.bikeScore} suggests the area is bike-friendly.`
          : `Bike Score ${extractedLocation.bikeScore} indicates cycling infrastructure is limited.`);
      }
      if (extractedLocation.floodZone) {
        const fz = String(extractedLocation.floodZone).toLowerCase();
        if (fz.includes('zone x') || fz === 'minimal' || fz === 'none') {
          parts.push(`Flood risk appears low based on listing-provided FEMA Zone X information. Still verify local flood maps, basement water history, drainage, and insurance requirements.`);
        } else if (fz.includes('zone a') || fz.includes('zone v')) {
          parts.push(`FEMA Flood Zone ${extractedLocation.floodZone} indicates elevated flood risk — verify flood insurance cost.`);
        } else {
          parts.push(`Flood Zone ${extractedLocation.floodZone} should be verified with local FEMA maps.`);
        }
      }
      // Only reference school ratings if they were successfully parsed (normalizedRatings.length > 0)
      // schoolRatings that failed parsing will be empty array — skip the "ratings are listed" claim
      if (normalizedRatings && normalizedRatings.length > 0) {
        parts.push(`School ratings (${normalizedRatings.join(', ')}/10) are listed. Verify against GreatSchools or Niche for the most current block-level data.`);
      }
      if (parts.length > 0) {
        whatItMeans = parts.join(' ');
      }
    }
    if (!whatItMeans) {
      if (isSFOC) {
        whatItMeans = `This location may work well for buyers seeking a single-family home in a residential setting with access to transit, schools, and local amenities. However, the listing does not provide specific commute times, school ratings, crime data, or comparable single-family sales data, so the location quality still needs verification.`;
      } else {
        whatItMeans = `This location may work well for buyers who want a quieter residential setting with access to transit, schools, and local amenities. However, the listing does not provide specific commute times, school ratings, crime data, Walk Score, or rental demand data, so the location quality still needs verification.`;
      }
    }
  }

  if (claimList.length === 0 && allVerify.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 border border-slate-200 mb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-pink-600/70" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Location Reality Check</h2>
          <p className="text-xs text-slate-500 mt-0.5">Based on listing claims, not independently verified.</p>
        </div>
      </div>

      {/* What the listing claims */}
      {claimList.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold text-slate-700 mb-2">What the listing claims</div>
          <ul className="space-y-1.5">
            {claimList.map((claim, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="text-emerald-500 mt-0.5 shrink-0">+</span>
                {claim}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What this could mean */}
      {whatItMeans && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="text-xs font-semibold text-amber-700 mb-1.5">What this could mean</div>
          <p className="text-sm text-amber-800 leading-relaxed">{whatItMeans}</p>
        </div>
      )}

      {/* What to verify */}
      {allVerify.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-2">What to verify</div>
          <ul className="space-y-2">
            {allVerify.slice(0, 6).map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="text-sky-500 mt-0.5 shrink-0">?</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Generic Section Card ────────────────────────────────────────────────────

const GENERIC_SEVERITY: Record<string, { bg: string; text: string }> = {
  low:      { bg: 'bg-green-100', text: 'text-green-700' },
  medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
  high:     { bg: 'bg-rose-100',  text: 'text-rose-700' },
  critical: { bg: 'bg-rose-200',  text: 'text-rose-800' },
};

function GenericSectionCard({ section }: { section: ReportSection }) {
  const items = section.items
    .map((item) => ({
      title: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
      badge: renderValue(item.badge),
      severity: renderValue(item.severity),
    }))
    .filter((item) => {
      const hasContent = item.value || item.description;
      return item.title || hasContent;
    });

  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-3 mb-5 sm:mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <span className="text-stone-500">{iconFor(section.id, 'w-5 h-5')}</span>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">{renderValue(section.title)}</h2>
          {section.subtitle && <p className="text-xs text-stone-400 mt-0.5">{renderValue(section.subtitle)}</p>}
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {items.map((item, i) => {
          const sevKey = (item.severity ?? item.badge ?? '').toLowerCase();
          const sevCfg = GENERIC_SEVERITY[sevKey];

          return (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-700">{item.title}</span>
                  {item.value && <span className="ml-2 text-sm font-semibold text-slate-900">{item.value}</span>}
                </div>
                {sevCfg ? (
                  <span className={`inline-flex items-center text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide ${sevCfg.bg} ${sevCfg.text}`}>
                    {item.badge ?? item.severity}
                  </span>
                ) : item.badge ? (
                  <SeverityPill value={item.badge} />
                ) : null}
              </div>
              {item.description && <p className="text-xs text-stone-400 mt-1 leading-relaxed">{item.description}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Remaining Sections ────────────────────────────────────────────────────────

const PHASE2_USED_IDS = new Set([
  'property-snapshot',
  'questions-to-ask',
  'questions',
  'data-gaps',
  'before-you-proceed',
  'listing-reality-check',
  'listing-reality',
  'agent-spin',
  'agent-lingo',
  'layout-fit',
  'layout',
  'who-property',
  'price-assessment',
  'carrying-costs',
]);

function matchesPhase2Section(section: ReportSection): boolean {
  const id = section.id.toLowerCase();
  const title = section.title.toLowerCase();
  const combined = id + ' ' + title;

  if (/cost|carrying|holding|afford/i.test(combined)) return true;
  if (/investment/i.test(combined)) return true;
  if (/neighborhood|lifestyle|location|area/i.test(combined)) return true;
  if (/data.?gap|missing|inspection/i.test(combined)) return true;
  if (/listing.?reality|listing.?spin|agent.?spin|agent.?lingo/i.test(combined)) return true;
  if (/layout|layout.?fit|who.?property|space|fit/i.test(combined)) return true;
  if (PHASE2_USED_IDS.has(id)) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// RENT-SPECIFIC DEEP REPORT SECTIONS
// ─────────────────────────────────────────────────────────────────────────
// Each component reads the corresponding section emitted by
// src/lib/reportAdapters/usRent.ts (section ids prefixed `rental-*` plus a
// few shared ids like `listing-does-not-prove` and `next-best-move`).
// They are deliberately narrow — no sale-only fields, no Zillow taxes, no
// Roof/Foundation categories.
// ═══════════════════════════════════════════════════════════════════════════

const RENT_RISK_META: Record<string, { label: string }> = {
  listing_trust: { label: 'Listing Trust' },
  availability: { label: 'Availability' },
  costs_and_payment: { label: 'Costs & Payment' },
  habitability_and_lease: { label: 'Habitability & Lease' },
};

function normalizeRentRiskLevel(level: string | undefined): string {
  if (!level) return 'Unknown';
  const upper = level.toUpperCase();
  if (upper === 'LOW') return 'Low';
  if (upper === 'MODERATE' || upper === 'MEDIUM') return 'Medium';
  if (upper === 'HIGH' || upper === 'CRITICAL') return 'High';
  return level;
}

function _RentSection({
  report,
  sectionId,
  title,
  subtitle,
  tone,
  children,
}: {
  report: NormalizedReport;
  sectionId: string;
  title: string;
  subtitle?: string;
  tone?: 'warning' | 'info';
  children: (s: { id: string; title: string; items: { title?: string; value?: string; description?: string; badge?: string; severity?: 'low' | 'medium' | 'high' }[] }) => React.ReactNode;
}) {
  const section = report.sections.find((s) => s.id === sectionId);
  if (!section || section.items.length === 0) return null;

  const toneClass = tone === 'warning' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white';

  return (
    <>
    {/* Register sectionId so _RemainingSections won't render it twice */}
    <SectionRegistrar ids={[sectionId]} />
    <div className={`rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border ${toneClass}`}>
      <div className="flex items-center gap-3 mb-2">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">{title}</h2>
      </div>
      {subtitle && <p className="text-xs text-stone-400 mb-5 sm:mb-6">{subtitle}</p>}
      {children(section as any)}
    </div>
    </>
  );
}

function _RentKVBlock({ items }: { items: { title?: string; value?: string; description?: string; badge?: string; severity?: 'low' | 'medium' | 'high' }[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="divide-y divide-slate-100">
      {items.map((it, i) => {
        const sevKey = (it.severity ?? it.badge ?? '').toLowerCase();
        const sevClass =
          sevKey === 'high' || sevKey === 'critical'
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : sevKey === 'medium' || sevKey === 'moderate'
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : sevKey === 'low'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-50 text-slate-600 border-slate-200';
        return (
          <div key={i} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              {it.title && <span className="text-sm font-medium text-slate-700">{it.title}</span>}
              {it.value && <span className="ml-2 text-sm font-semibold text-slate-900">{it.value}</span>}
              {it.description && <p className="text-xs text-stone-500 mt-1 leading-relaxed">{it.description}</p>}
            </div>
            {it.badge && (
              <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${sevClass}`}>
                {it.badge}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RentalListingScoreSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="rental-score" title="Rental Listing Score" subtitle="Is this listing worth your time?">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentalBottomLineSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="bottom-line" title="Bottom Line">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentalSnapshotSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="rental-snapshot" title="Rental Snapshot" subtitle="What the listing tells you up front">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentalListingTrustSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="rental-listing-trust" title="Rental Listing Trust" subtitle="How consistent is the listing itself">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentalAvailabilitySection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="availability-check" title="Availability Check" subtitle="Live status from the listing only">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentTrueCostSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="rent-true-cost" title="Rent & True Cost" subtitle="Monthly rent + recurring fees">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function ApplicationPaymentRiskSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="application-payment-risk" title="Application & Payment Risk" subtitle="How money moves — and where the risk sits" tone="warning">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function LeaseTermsRulesSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="lease-terms-rules" title="Lease Terms & Rules" subtitle="What you sign up for">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function LocationDailyLifeSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="location-daily-life" title="Location & Daily Life Check" subtitle="What the area feels like day-to-day">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentalRiskCategoriesSection({ report }: { report: NormalizedReport }) {
  const raw = (report.raw as any) ?? {};
  // Rent schema uses `rental_risk_categories` (different from sale's `risk_categories`).
  const rc = raw.rental_risk_categories;
  if (!rc || typeof rc !== 'object') return null;

  const keys = ['listing_trust', 'availability', 'costs_and_payment', 'habitability_and_lease'] as const;
  const present = keys.filter((k) => rc[k] && typeof rc[k] === 'object' && Object.keys(rc[k]).length > 0);
  if (present.length === 0) return null;

  const sevClass = (level: string) => {
    const u = (level ?? '').toUpperCase();
    if (u === 'HIGH' || u === 'CRITICAL') return 'bg-rose-50 text-rose-700 border-rose-200';
    if (u === 'MEDIUM' || u === 'MODERATE') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (u === 'LOW') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return 'bg-slate-50 text-slate-600 border-slate-200';
  };

  return (
    <>
    <SectionRegistrar ids={['rental-risk-categories']} />
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-amber-200">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">Rental Risk Categories</h2>
      </div>
      <p className="text-xs text-stone-400 mb-5 sm:mb-6">Four lanes to watch</p>
      <div className="space-y-4">
        {present.map((k) => {
          const meta = RENT_RISK_META[k];
          const bucket = rc[k] ?? {};
          const level = normalizeRentRiskLevel(bucket.risk_level);
          const signal = (bucket.signal ?? '').toString();
          const evidence = (bucket.evidence ?? '').toString();
          const missing = (bucket.missing ?? '').toString();
          const why = (bucket.why_it_matters ?? '').toString();
          const qs: string[] = Array.isArray(bucket.questions)
            ? bucket.questions.filter((x: unknown) => typeof x === 'string' && (x as string).trim())
            : [];
          return (
            <div key={k} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-base font-bold text-slate-900">{meta.label}</h3>
                <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${sevClass(level)}`}>
                  {level}
                </span>
              </div>
              {signal && <p className="text-sm text-slate-700 leading-relaxed mb-2">{signal}</p>}
              {why && <p className="text-xs text-stone-500 leading-relaxed mb-2">{why}</p>}
              {evidence && <p className="text-xs text-stone-500"><span className="font-medium">Evidence:</span> {evidence}</p>}
              {missing && <p className="text-xs text-stone-500"><span className="font-medium">Missing:</span> {missing}</p>}
              {qs.length > 0 && (
                <ul className="mt-2 space-y-1 list-disc list-inside text-xs text-slate-600">
                  {qs.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}

function BeforeYouTourApplyPaySection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="before-tour-apply-pay" title="Before You Tour / Apply / Pay" subtitle="Three checkpoints, in order">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function RentalWhoItWorksForSection({ report }: { report: NormalizedReport }) {
  return (
    <_RentSection report={report} sectionId="who-this-rental-works-for" title="Who This Rental Works For">
      {(s) => <_RentKVBlock items={s.items} />}
    </_RentSection>
  );
}

function _RemainingSections({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const remaining = sections.filter(
    (s) =>
      !matchesPhase2Section(s) &&
      !isRiskSection(s) &&
      !useIsSectionUsed(s.id)
  );

  if (remaining.length === 0) return null;

  return (
    <div>
      {remaining.map((section) => (
        <GenericSectionCard key={section.id} section={section} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 11: ReportClosingCTA
// ─────────────────────────────────────────────────────────────────────────────

const FEEDBACK_REASONS = [
  { key: 'wrong_info',       label: 'Wrong info' },
  { key: 'too_generic',      label: 'Too generic' },
  { key: 'missing_key_risk', label: 'Missing key risk' },
  { key: 'too_long',         label: 'Too long' },
  { key: 'not_actionable',   label: 'Not actionable' },
] as const;

function getAnonymousId(): string {
  let id = localStorage.getItem('hs_anon_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('hs_anon_id', id);
  }
  return id;
}

function ReportClosingCTA({
  report,
  onShare,
  analysisId,
  mode,
  shareState,
  onShareClick,
  userId,
  listingFingerprint,
  listingAddress,
  reportType,
  isBasic,
  onUpgrade,
  hideBottomSection,
}: {
  report: NormalizedReport;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  analysisId?: string;
  mode?: 'web' | 'extension';
  shareState?: { isSharing?: boolean; shareResult?: { slug: string; shareUrl: string } | null; copied?: boolean };
  onShareClick?: () => void;
  userId?: string;
  listingFingerprint?: string;
  listingAddress?: string;
  reportType?: string;
  /** Set true for Basic layout to show simplified messaging */
  isBasic?: boolean;
  /** Show "Unlock Full Analysis" upgrade button (used in Basic layout) */
  onUpgrade?: () => void;
  /** Hide share and feedback sections for public share page */
  hideBottomSection?: boolean;
}) {
  // ── Share state (local fallback when shareState prop not provided) ───────────
  const [localShareResult, setLocalShareResult] = React.useState<{ slug: string; shareUrl: string } | null>(null);
  const [localIsSharing, setLocalIsSharing] = React.useState(false);

  // ── Feedback state ────────────────────────────────────────────────────────
  const [rating, setRating] = React.useState<'useful' | 'not_useful' | null>(null);
  const [selectedReasons, setSelectedReasons] = React.useState<string[]>([]);
  const [comment, setComment] = React.useState('');
  const [feedbackState, setFeedbackState] = React.useState<'idle' | 'saving' | 'submitted' | 'error'>('idle');

  // ── Rent-mode awareness (P0-3: sale CTA strings must not leak into rent reports) ─
  const isRent = (report.meta?.reportMode ?? (report as any).reportMode ?? '').toString().toLowerCase() === 'rent';
  const ctaBuyMessage = isRent
    ? 'HomeScope does not tell you whether to rent a home. It helps you spot what the listing may not make obvious — so you can move forward with more confidence, or skip a property that is not worth applying to.'
    : 'HomeScope is not here to tell you what to buy. It helps you spot what the listing may not make obvious — so you can move forward with more confidence, or skip a property that is not worth the trip.';
  const ctaAvoidItems = isRent
    ? [
        'Whether the rent looks fair',
        'What the listing language may be hiding',
        'Which photos or details are missing',
        'What could increase your monthly costs',
        'What to ask before scheduling a tour',
      ]
    : [
        'Whether the price looks reasonable',
        'What the listing language may be hiding',
        'Which photos or details are missing',
        'What could cost money later',
        'What to ask before booking a viewing',
      ];
  const shareCtaMessage = isRent
    ? 'Share this report with someone you trust before you make a decision.'
    : 'Share this report with someone you trust before you make a call.';

  const effectiveShareResult = shareState !== undefined ? (shareState.shareResult ?? null) : localShareResult;
  const effectiveCopied = shareState !== undefined ? (shareState.copied ?? false) : false;
  const effectiveIsSharing = shareState !== undefined ? (shareState.isSharing ?? false) : localIsSharing;

  // ── Save feedback to Supabase ───────────────────────────────────────────────
  const saveFeedback = React.useCallback(async (
    newRating: 'useful' | 'not_useful',
    reasonsToSave: string[] = selectedReasons,
    commentToSave: string | null = comment,
  ) => {
    setFeedbackState('saving');
    try {
      const { saveFeedback } = await import('../../lib/feedbackService');
      await saveFeedback({
        analysisId,
        userId: userId ?? undefined,
        anonymousId: getAnonymousId(),
        listingFingerprint: listingFingerprint ?? undefined,
        listingAddress: listingAddress ?? undefined,
        reportType: reportType ?? undefined,
        rating: newRating,
        reasons: reasonsToSave,
        comment: commentToSave,
      });
      setFeedbackState(newRating === 'not_useful' ? 'idle' : 'submitted');
    } catch (err) {
      console.error('[feedback] save error:', err);
      setFeedbackState('error');
    }
  }, [analysisId, userId, listingFingerprint, listingAddress, reportType, selectedReasons, comment]);

  // ── Toggle reason ──────────────────────────────────────────────────────────
  const toggleReason = React.useCallback((key: string) => {
    setSelectedReasons(prev => {
      const next = prev.includes(key)
        ? prev.filter(r => r !== key)
        : [...prev, key];
      if (rating === 'not_useful') {
        saveFeedback('not_useful', next, comment);
      }
      return next;
    });
  }, [rating, saveFeedback, comment]);

  // ── Comment change → auto-save ─────────────────────────────────────────────
  const handleCommentChange = React.useCallback((value: string) => {
    setComment(value);
    if (rating === 'not_useful') {
      saveFeedback('not_useful', selectedReasons, value);
    }
  }, [rating, saveFeedback, selectedReasons]);

  // ── Handle rating click ────────────────────────────────────────────────────
  function handleRatingClick(newRating: 'useful' | 'not_useful') {
    // If clicking the already-selected rating, deselect (toggle off)
    if (rating === newRating) {
      setRating(null);
      setSelectedReasons([]);
      setComment('');
      setFeedbackState('idle');
      return;
    }
    setRating(newRating);
    if (newRating === 'useful') {
      setSelectedReasons([]);
      setComment('');
      setFeedbackState('idle');
    }
    saveFeedback(newRating, newRating === 'useful' ? [] : selectedReasons, newRating === 'useful' ? null : comment);
  }

  // ── Submit feedback ────────────────────────────────────────────────────────
  async function handleSubmitFeedback() {
    if (rating !== 'not_useful') return;
    setFeedbackState('saving');
    try {
      const { saveFeedback } = await import('../../lib/feedbackService');
      await saveFeedback({
        analysisId,
        userId: userId ?? undefined,
        anonymousId: getAnonymousId(),
        listingFingerprint: listingFingerprint ?? undefined,
        listingAddress: listingAddress ?? undefined,
        reportType: reportType ?? undefined,
        rating: 'not_useful',
        reasons: selectedReasons,
        comment: comment || null,
      });
      setFeedbackState('submitted');
    } catch (err) {
      console.error('[feedback] submit error:', err);
      setFeedbackState('error');
    }
  }

  async function handleShare() {
    if (onShareClick) {
      onShareClick();
      return;
    }

    const raw = report.raw ?? {};
    const explicitUrl = raw.shareUrl ?? raw.share_url ?? raw.publicUrl ?? raw.public_url;
    if (typeof explicitUrl === 'string' && explicitUrl.startsWith('http')) {
      setLocalShareResult({ slug: '', shareUrl: explicitUrl });
      try {
        await navigator.clipboard.writeText(explicitUrl);
      } catch {
        // silent fail
      }
      return;
    }

    const slug = raw.shareSlug ?? raw.share_slug;
    if (typeof slug === 'string' && slug) {
      const url = `${window.location.origin}/share/${slug}`;
      setLocalShareResult({ slug, shareUrl: url });
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // silent fail
      }
      return;
    }

    if (window.location.pathname.includes('/share/')) {
      setLocalShareResult({ slug: '', shareUrl: window.location.href });
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch {
        // silent fail
      }
      return;
    }

    if (onShare && analysisId) {
      setLocalIsSharing(true);
      try {
        const result = await onShare(analysisId);
        setLocalShareResult({ slug: result.slug, shareUrl: result.shareUrl });
        const url = result.shareUrl ?? `${window.location.origin}/share/${result.slug}`;
        await navigator.clipboard.writeText(url);
      } catch {
        // silent fail
      } finally {
        setLocalIsSharing(false);
      }
      return;
    }

    try {
      setLocalShareResult({ slug: '', shareUrl: window.location.href });
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // silent fail
    }
  }

  function handleAnalyseAnother() {
    if (mode === 'extension') return;
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  }

  // Hide share and feedback sections for public share page
  if (hideBottomSection) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <Target className="w-5 h-5 text-amber-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">One last check before you decide</h2>
        {isBasic && (
          <p className="text-xs text-stone-400 mt-0.5">Basic shows listing signals — Full Analysis adds condition, market comparison, and risk depth.</p>
        )}
      </div>

      {/* Core message */}
      <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-4">
        You now know the key risks, missing details, and questions to ask before spending time on this property.
      </p>

      <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-6">
        {ctaBuyMessage}
      </p>

      {/* What this report helped you avoid guessing */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 sm:p-6 mb-6">
        <div className="font-semibold text-slate-800 mb-3">What this report helped you avoid guessing</div>
        <ul className="space-y-2">
          {ctaAvoidItems.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <CheckCircle2 className="w-4 h-4 text-amber-600/80 mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Share section */}
      <div className="border-t border-slate-200 pt-6">
        <p className="text-slate-600 text-sm mb-4">{shareCtaMessage}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          {effectiveShareResult === null ? (
            <button
              type="button"
              onClick={handleShare}
              disabled={effectiveIsSharing}
              className="px-6 py-3 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer w-full sm:w-auto min-w-[11rem] text-center"
            >
              {effectiveIsSharing ? 'Generating share link...' : 'Share Report'}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full min-w-[11rem] text-center">
              {effectiveCopied ? (
                <>
                  <CheckCircle size={14} />
                  <span className="text-xs font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <CheckCircle size={14} />
                  <span className="text-xs font-medium">Copied</span>
                  <button
                    onClick={() => {
                      const url = effectiveShareResult?.shareUrl || `${window.location.origin}/share/${effectiveShareResult?.slug}`;
                      navigator.clipboard.writeText(url).catch(() => {});
                    }}
                    className="ml-0.5 p-1 hover:bg-green-100 rounded transition-colors cursor-pointer"
                    title="Copy link again"
                  >
                    <Copy size={11} />
                  </button>
                </>
              )}
            </div>
          )}
          {onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-stone-900 font-semibold text-sm rounded-xl transition-colors cursor-pointer w-full sm:w-auto"
            >
              Unlock Full Analysis
            </button>
          )}
          {mode !== 'extension' && (
            <button
              type="button"
              onClick={handleAnalyseAnother}
              className="px-6 py-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold text-sm rounded-xl transition-colors cursor-pointer w-full sm:w-auto"
            >
              Analyse another property
            </button>
          )}
        </div>
      </div>

      {/* ── Feedback Section ───────────────────────────────────────────── */}
      <div className="border-t border-slate-200 pt-5 mt-5 flex flex-col">
        {/* Title */}
        <p className="text-xs text-stone-400 mb-3">Was this report useful?</p>

        {/* Main rating buttons */}
        <div className="flex items-center justify-start gap-2 mb-3">
          <button
            type="button"
            onClick={() => handleRatingClick('useful')}
            disabled={feedbackState === 'saving'}
            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer transition-colors disabled:opacity-50 ${
              rating === 'useful'
                ? 'border-blue-200 bg-blue-50 text-blue-700 font-medium'
                : 'border-slate-200 text-slate-500 hover:border-blue-200 hover:text-blue-600'
            }`}
          >
            {rating === 'useful' ? (
              <span className="flex items-center gap-1">
                <Check size={11} />
                Yes, useful
              </span>
            ) : (
              'Yes, useful'
            )}
          </button>
          <button
            type="button"
            onClick={() => handleRatingClick('not_useful')}
            disabled={feedbackState === 'saving'}
            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer transition-colors disabled:opacity-50 ${
              rating === 'not_useful'
                ? 'border-rose-200 bg-rose-50 text-rose-700 font-medium'
                : 'border-slate-200 text-slate-500 hover:border-rose-200 hover:text-rose-600'
            }`}
          >
            {rating === 'not_useful' ? (
              <span className="flex items-center gap-1">
                <Check size={11} />
                Not really
              </span>
            ) : (
              'Not really'
            )}
          </button>
        </div>

        {/* Success state — Yes */}
        {rating === 'useful' && feedbackState !== 'error' && (
          <p className="text-xs text-stone-400 flex items-center gap-1">
            <CheckCircle size={12} className="text-stone-400 shrink-0" />
            Thanks for your feedback.
          </p>
        )}

        {/* Success state — Not really submitted */}
        {feedbackState === 'submitted' && rating === 'not_useful' && (
          <p className="text-xs text-stone-400 flex items-center gap-1">
            <CheckCircle size={12} className="text-stone-400 shrink-0" />
            Thanks — this helps us improve HomeScope.
          </p>
        )}

        {/* Error state */}
        {feedbackState === 'error' && (
          <p className="text-xs text-red-500">Could not save feedback. Please try again.</p>
        )}

        {/* Reason options — shown when "Not really" is selected and not yet submitted */}
        {rating === 'not_useful' && feedbackState !== 'submitted' && feedbackState !== 'error' && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-stone-400">What could be better?</p>

            {/* Reason pill chips */}
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK_REASONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleReason(key)}
                  disabled={feedbackState === 'saving'}
                  className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors disabled:opacity-50 ${
                    selectedReasons.includes(key)
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-slate-200 text-slate-500 hover:border-rose-200 hover:text-rose-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Comment textarea */}
            <textarea
              rows={2}
              placeholder="Anything else? Optional"
              value={comment}
              onChange={e => handleCommentChange(e.target.value)}
              disabled={feedbackState === 'saving'}
              className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 resize-none placeholder:text-slate-400 focus:outline-none focus:border-slate-400 disabled:opacity-50"
            />

            {/* Submit button — always shown when not_useful is selected */}
            <button
              type="button"
              onClick={handleSubmitFeedback}
              disabled={feedbackState === 'saving'}
              className="w-full px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
            >
              {feedbackState === 'saving' ? 'Saving...' : 'Submit feedback'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Basic Report Components ────────────────────────────────────────────────────

// ── ListingSignalsSection — "Listing Signals"（US Basic v2）────────────────────
function ListingSignalsSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'listing-signals');
  if (!section || section.items.length === 0) return null;

  return (
    <div className="bg-white border border-stone-100 rounded-2xl p-5 sm:p-6 mb-8 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
          <Signal className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            {section.title || 'Listing Signals'}
          </h2>
          {section.subtitle && (
            <p className="text-xs sm:text-sm text-stone-500 mt-0.5">{section.subtitle}</p>
          )}
        </div>
      </div>
      <ul className="space-y-3">
        {section.items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">{i + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-slate-800">{item.title}</span>
              {item.description && (
                <span className="text-slate-500"> — {item.description}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── WhatsMissingSection — "What's Missing"（US Basic v2）─────────────────────
function WhatsMissingSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'whats-missing');
  if (!section || section.items.length === 0) return null;

  return (
    <div className="bg-white border border-stone-100 rounded-2xl p-5 sm:p-6 mb-8 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            {section.title || "What's Missing"}
          </h2>
        </div>
      </div>
      <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest mb-3">
        Still needs verification
      </div>
      <ul className="space-y-2">
        {section.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
            <span className="text-amber-400 mt-1 shrink-0">—</span>
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── KeyThingsToCheckSection — "Key Things To Check"（US Basic v2）────────────
function KeyThingsToCheckSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'key-things-to-check');
  if (!section || section.items.length < 2) return null;

  return (
    <div className="bg-white border border-stone-100 rounded-2xl p-5 sm:p-6 mb-8 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
          <Target className="w-5 h-5 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            {section.title || 'Key Things To Check'}
          </h2>
          {section.subtitle && (
            <p className="text-xs sm:text-sm text-stone-500 mt-0.5">{section.subtitle}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {section.items.map((item, i) => (
          <div
            key={i}
            className="border border-stone-100 rounded-xl p-4 bg-stone-50/40 flex flex-col"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`shrink-0 rounded-full w-6 h-6 flex items-center justify-center text-[11px] font-bold ${
                  i === 0
                    ? 'bg-red-500 text-white'
                    : i === 1
                    ? 'bg-amber-500 text-white'
                    : 'bg-stone-400 text-white'
                }`}
              >
                {i + 1}
              </span>
              <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                {item.title}
              </h3>
            </div>
            {item.description && (
              <p className="text-xs text-stone-600 leading-relaxed mb-3">
                {item.description}
              </p>
            )}
            {item.action && (
              <div className="mt-auto pt-3 border-t border-stone-100">
                <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1">
                  What to do
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {item.action}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── WhatWeKnowSection ────────────────────────────────────────────────────────
function WhatWeKnowSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'what-we-know');
  if (!section || section.items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <Home className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">What We Know</h2>
          <p className="text-xs text-stone-400 mt-0.5">{section.subtitle}</p>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {section.items.map((item, i) => {
          const rawValue = renderValue(item.value ?? '');
          const isUnresolved = rawValue.startsWith('Not ');
          return (
            <div key={i} className="py-3 first:pt-0 last:pb-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span className="text-sm font-medium text-slate-600 self-start pt-px">{renderValue(item.title)}</span>
              <span className={`text-sm font-semibold text-slate-900 text-right leading-relaxed ${isUnresolved ? 'text-stone-400 italic' : ''}`}>
                {rawValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BasicDecisionSection — "What Could Change Your Decision" cards for Basic mode ─
function BasicDecisionSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'basic-decision-cards');
  if (!section || section.items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-600/70" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">What Could Change Your Decision</h2>
          <p className="text-xs text-stone-400 mt-0.5">Based on listing signals only — not independent analysis.</p>
        </div>
      </div>
      <div className="space-y-4 sm:space-y-5">
        {section.items.map((item, i) => (
          <div key={i} className="flex flex-col gap-3 p-5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="font-bold text-slate-900 text-base">{renderValue(item.title)}</div>
            {item.description && (
              <div className="flex items-start gap-2">
                <span className="text-amber-600 font-semibold text-xs shrink-0 mt-0.5">Why it matters:</span>
                <span className="text-slate-700 text-sm leading-relaxed">{renderValue(item.description)}</span>
              </div>
            )}
            {item.value && (
              <div className="flex items-start gap-2">
                <div className="bg-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5 shrink-0">
                  <Target className="w-3 h-3 text-white" />
                  <span className="uppercase text-[10px] font-bold tracking-wide text-white">Action</span>
                </div>
                <span className="text-slate-700 text-sm font-medium leading-relaxed">{renderValue(item.value)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MonthlyCostSnapshotSection ─────────────────────────────────────────────────
function MonthlyCostSnapshotSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'monthly-cost-snapshot');
  if (!section || section.items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <DollarSign className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{section.title}</h2>
          {section.subtitle && (
            <p className="text-xs text-stone-400 mt-0.5">{section.subtitle}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 @container[size>=560px]:grid-cols-3 gap-4">
        {section.items.map((item, i) => (
          <div key={i} className="p-4 bg-slate-50 rounded-xl">
            <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">{renderValue(item.title)}</div>
            <div className="text-sm font-semibold text-slate-800">{renderValue(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ListingClaimsSection — "Listing Claims to Verify" for Basic mode ──────────────────
function ListingClaimsSection({ report }: { report: NormalizedReport }) {
  const section = report.sections.find((s) => s.id === 'listing-claims');
  if (!section || section.items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
          <FileSearch className="w-5 h-5 text-indigo-600/70" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Listing Claims to Verify</h2>
          <p className="text-xs text-stone-400 mt-0.5">{section.subtitle}</p>
        </div>
      </div>
      <div className="space-y-4 sm:space-y-5">
        {section.items.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
            {/* Listing says */}
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Listing says</div>
              <p className="text-slate-800 text-sm font-medium italic">"{renderValue(item.title)}"</p>
            </div>
            {/* HomeScope check */}
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-start gap-2">
                <Eye className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">HomeScope check</div>
                  <p className="text-slate-700 text-sm leading-relaxed">{renderValue(item.description)}</p>
                </div>
              </div>
            </div>
            {/* Ask before viewing */}
            {item.value && (
              <div className="px-5 py-4 bg-amber-50/50">
                <div className="flex items-start gap-2">
                  <CircleHelp className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 mb-1">Ask before viewing</div>
                    <p className="text-slate-700 text-sm leading-relaxed">{renderValue(item.value)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── BasicCTA ──────────────────────────────────────────────────────────────────
// Button action types for upgrade flow
export type UpgradeButtonAction = 'view' | 'disabled' | 'signIn' | 'checkout' | 'start';

interface UpgradeButtonState {
  label: string;
  action: UpgradeButtonAction;
  disabled: boolean;
}

interface BasicCTAProps {
  report: NormalizedReport;
  analysisId?: string;
  mode?: 'web' | 'extension';
  onUpgrade?: () => void;
  /** User auth status */
  authStatus?: 'logged_out' | 'logging_in' | 'logged_in';
  /** Available credits */
  credits?: number;
  /** Whether this listing already has a full report */
  hasFullReport?: boolean;
  /** Whether full analysis is currently running */
  isFullRunning?: boolean;
  /** Callback for sign-in action */
  onSignIn?: () => void;
  /** Callback for checkout/purchase action */
  onOpenCheckout?: () => void;
  /** Callback for viewing existing full report */
  onViewFullReport?: () => void;
}

/**
 * Unified button state selector following the priority order:
 * 1. hasFullReport → "View Full Report"
 * 2. isFullRunning → "Generating Full Report..." (disabled)
 * 3. authStatus !== 'logged_in' → "Sign in to Unlock Full Analysis"
 * 4. credits <= 0 → "Get More Full Checks"
 * 5. Otherwise → "Unlock Full Analysis"
 */
function getUpgradeButtonState(props: BasicCTAProps): UpgradeButtonState {
  if (props.hasFullReport) {
    return { label: 'View Full Report', action: 'view', disabled: false };
  }
  if (props.isFullRunning) {
    return { label: 'Generating Full Report...', action: 'disabled', disabled: true };
  }
  if (props.authStatus !== 'logged_in') {
    return { label: 'Sign in to Unlock Full Analysis', action: 'signIn', disabled: false };
  }
  if (!props.credits || props.credits <= 0) {
    return { label: 'Get More Full Checks', action: 'checkout', disabled: false };
  }
  return { label: 'Unlock Full Analysis', action: 'start', disabled: false };
}

function BasicCTA({
  report,
  analysisId,
  mode,
  onUpgrade,
  authStatus,
  credits,
  hasFullReport,
  isFullRunning,
  onSignIn,
  onOpenCheckout,
  onViewFullReport,
}: BasicCTAProps) {
  // 网页端不显示 BasicCTA
  if (mode !== 'extension') {
    return null;
  }

  function handleAnalyseAnother() {
    if (mode === 'extension') return;
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  }

  // Pull CTA content from the adapter-generated section
  const ctaSection = report.sections.find((s) => s.id === 'basic-cta');
  const ctaTitle = ctaSection?.title || 'Want the full picture?';
  const ctaBody = ctaSection?.items?.[0]?.title ||
    'Basic shows what this listing reveals and what still needs asking. Unlock Full Analysis for condition risk analysis, price confidence verdict, carrying-cost breakdown, and whether this property is actually worth viewing.';

  // Unified button state
  const buttonState = getUpgradeButtonState({
    authStatus,
    credits,
    hasFullReport,
    isFullRunning,
  });

  // Handle primary button click based on action
  function handlePrimaryClick() {
    switch (buttonState.action) {
      case 'view':
        onViewFullReport?.();
        break;
      case 'signIn':
        onSignIn?.();
        break;
      case 'checkout':
        onOpenCheckout?.();
        break;
      case 'disabled':
        // Do nothing
        break;
      case 'start':
      default:
        onUpgrade?.();
        break;
    }
  }

  // Show loading spinner for generating state
  const isGenerating = buttonState.action === 'disabled';

  return (
    <div className="bg-[#282828] rounded-2xl p-6 sm:p-8 md:p-10 mb-8 overflow-hidden" style={{ border: '1px solid rgba(218, 165, 32, 0.3)' }}>
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-yellow-500/20 rounded-2xl flex items-center justify-center shrink-0">
          <Zap className="w-6 h-6 text-yellow-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-semibold text-white mb-2">{ctaTitle}</h3>
          <p className="text-stone-300 text-sm leading-relaxed mb-6">
            {ctaBody}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handlePrimaryClick}
              disabled={buttonState.disabled}
              className={`px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-stone-900 font-semibold text-sm rounded-xl transition-colors ${
                buttonState.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              {isGenerating && (
                <span className="inline-block w-4 h-4 mr-2 align-middle">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </span>
              )}
              {buttonState.label}
            </button>
            {mode !== 'extension' && buttonState.action !== 'view' && (
              <button
                type="button"
                onClick={handleAnalyseAnother}
                className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer border border-white/20"
              >
                Analyse another property
              </button>
            )}
          </div>
          {buttonState.action === 'disabled' && (
            <p className="text-stone-400 text-xs mt-3">
              This usually takes 1–3 minutes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4">
        <Info className="w-8 h-8 text-stone-400" />
      </div>
      <h2 className="text-lg font-semibold text-stone-700 mb-2">Not enough data</h2>
      <p className="text-sm text-stone-500 max-w-xs">
        This report does not have enough information to display a full analysis.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component — Rendering Order
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1b: VerifiedFromListingSection — "What We Found" / Verified vs Need to Verify
// ─────────────────────────────────────────────────────────────────────────────

// MODULE X: ContradictionBanner — displays detected contradictions from property data analysis
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: React.ReactNode; iconColor: string }> = {
  high: {
    bg: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.3)',
    icon: <AlertTriangle className="w-4 h-4" />,
    iconColor: '#EF4444',
  },
  medium: {
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.3)',
    icon: <AlertCircle className="w-4 h-4" />,
    iconColor: '#F59E0B',
  },
  low: {
    bg: 'rgba(59, 130, 246, 0.08)',
    border: 'rgba(59, 130, 246, 0.3)',
    icon: <Info className="w-4 h-4" />,
    iconColor: '#3B82F6',
  },
};

function ContradictionBanner({ contradictions }: { contradictions: ContradictionVM[] }) {
  if (!contradictions || contradictions.length === 0) return null;

  const highSeverity = contradictions.filter((c) => c.severity === 'high');
  const otherSeverity = contradictions.filter((c) => c.severity !== 'high');

  return (
    <>
      {/* High-severity contradictions: prominent banner */}
      {highSeverity.length > 0 && (
        <div
          className="rounded-2xl p-6 mb-6"
          style={{
            backgroundColor: SEVERITY_STYLES.high.bg,
            border: `1px solid ${SEVERITY_STYLES.high.border}`,
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div style={{ color: SEVERITY_STYLES.high.iconColor }}>{SEVERITY_STYLES.high.icon}</div>
            <span className="text-sm font-semibold" style={{ color: SEVERITY_STYLES.high.iconColor }}>
              Data Inconsistency Detected
            </span>
          </div>
          <div className="space-y-3">
            {highSeverity.map((c) => (
              <div key={c.id} className="text-sm text-slate-200">
                <span className="font-medium text-white">{c.description}</span>
                {c.suggestion && (
                  <div className="mt-1 text-xs text-slate-400" style={{ fontStyle: 'italic' }}>
                    {c.suggestion}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Medium / low severity: compact list in What to Verify */}
      {otherSeverity.length > 0 && (
        <div
          className="rounded-xl p-5 mb-6"
          style={{
            backgroundColor: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">What to Verify</div>
          </div>
          <div className="space-y-2">
            {otherSeverity.map((c) => {
              const style = SEVERITY_STYLES[c.severity] ?? SEVERITY_STYLES.low;
              return (
                <div key={c.id} className="flex items-start gap-2 text-sm">
                  <div className="mt-0.5 shrink-0" style={{ color: style.iconColor }}>{style.icon}</div>
                  <div className="text-slate-300">
                    <span>{c.description}</span>
                    {c.suggestion && (
                      <div className="text-xs text-slate-500 mt-0.5" style={{ fontStyle: 'italic' }}>
                        {c.suggestion}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function VerifiedFromListingSection({ report, viewModel: _viewModel }: {
  report: NormalizedReport;
  viewModel?: ReportViewModel;
}) {
  // Sale-only section — verified facts use zestimate/sales_range/property_snapshot fields.
  // Rent has its own RentalSnapshotSection.
  if (report.meta?.reportMode === 'rent') return null;
  // Schema-based guard.
  if ((report.raw as any)?.rental_snapshot || (report.raw as any)?.rental_listing_score) return null;
  const hero = report.hero;
  const { sections } = report;

  // ── Compute isSFOC from report data ─────────────────────────────────────────
  const raw = report.raw ?? {};
  const listingText = [
    raw.listingInfo?.description ?? '',
    raw.listingOverview?.description ?? '',
    raw.description ?? '',
    raw.property_snapshot?.homeType ?? '',
    raw.property_snapshot?.home_type ?? '',
  ].join(' ').toLowerCase();
  const profileText = (raw.property_snapshot?.homeType ?? raw.property_snapshot?.home_type ?? '').toLowerCase();
  const isSingleFamilyProfile = /single\s*family|singlefamily|single\s*family\s*residence|single\s*family\s*home/i.test(profileText) || (/single/i.test(profileText) && !/multi/i.test(profileText));
  const hasRentalSignal = /rental\s*unit|basement\s*apartment|income\s*unit|legal\s*two.family|2.family|multi.family|duplex|separate\s*unit|tenant|walk.in\s*apartment|mother.daughter/i.test(listingText);
  const isSFOC = isSingleFamilyProfile && !hasRentalSignal;

  // ── Verified from listing — use hero fields directly (set by usSale adapter) ──
  const verified: Array<{ label: string; value: string }> = [];

  if (hero?.price) verified.push({ label: 'Asking price', value: hero.price });
  if (hero?.bedrooms && hero?.bathrooms) {
    verified.push({ label: 'Beds / Baths', value: `${hero.bedrooms} / ${hero.bathrooms}` });
  }
  if (hero?.sqft) verified.push({ label: 'Interior', value: hero.sqft });

  // Year Built from property-snapshot section
  const yearBuiltItem = sections.find(s => /property.?snapshot/i.test(s.id))
    ?.items.find(i => /year.?built/i.test(i.title ?? ''));
  if (yearBuiltItem?.value) verified.push({ label: 'Year Built', value: renderValue(yearBuiltItem.value) });

  // Zestimate from hero (populated by usSale adapter from price_assessment)
  if (hero?.zestimate) verified.push({ label: 'Zestimate', value: hero.zestimate });

  // Monthly payment from hero intentionally omitted here.
  // Use the detailed Zillow monthly payment breakdown below as the single source of truth
  // to avoid showing conflicting summary vs detailed payment figures in the same report.

  // ── Still needs verification — property-aware list ─────────────────────────
  const needsList = isSFOC ? [
    'Roof age and condition',
    'Permits for recent updates',
    'Boiler / water heater installation date',
    'Electrical panel and wiring updates',
    'Plumbing material and age',
    'Basement moisture history',
    'Insurance and utility costs',
  ] : [
    'Certificate of Occupancy',
    'Basement condition and permitted use',
    'DOB / HPD / ECB records',
    'Roof / boiler / electrical age',
    'Legal-use documents and occupancy records',
    'Insurance and utility costs',
  ];

  if (verified.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-5 sm:p-6 mb-6 border border-slate-200">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <h3 className="text-sm font-semibold text-slate-800">What We Found</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* From the listing */}
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">From the listing</div>
          <div className="space-y-1.5">
            {verified.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-xs text-slate-400 w-32 shrink-0 pt-0.5">{item.label}</span>
                <span className="text-xs font-medium text-slate-700">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Still needs verification */}
        <div>
          <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">Still needs verification</div>
          <div className="space-y-1">
            {needsList.map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                <span className="text-amber-400 mt-0.5 shrink-0">—</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface NewReportUIProps {
  report: NormalizedReport;
  viewModel?: ReportViewModel;
  /** Set to true for basic/free reports to use the lightweight Quick Property Check layout */
  isBasic?: boolean;
  mode?: 'web' | 'extension';
  showBackButton?: boolean;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  analysisId?: string;
  shareState?: { isSharing?: boolean; shareResult?: { slug: string; shareUrl: string } | null; copied?: boolean };
  onShareClick?: () => void;
  onUpgrade?: () => void;
  /** Logged-in user ID (from AuthContext) */
  userId?: string;
  /** Stable identifier for the listing (used for anonymous feedback) */
  listingFingerprint?: string;
  /** Human-readable listing address (used for anonymous feedback) */
  listingAddress?: string;
  /** Report type: 'basic' | 'full' */
  reportType?: string;
  /** User auth status */
  authStatus?: 'logged_out' | 'logging_in' | 'logged_in';
  /** Available credits */
  credits?: number;
  /** Whether this listing already has a full report */
  hasFullReport?: boolean;
  /** Whether full analysis is currently running */
  isFullRunning?: boolean;
  /** Callback for sign-in action */
  onSignIn?: () => void;
  /** Callback for checkout/purchase action */
  onOpenCheckout?: () => void;
  /** Callback for viewing existing full report */
  onViewFullReport?: () => void;
  /** Hide bottom section (share + feedback modules) for public share page */
  hideBottomSection?: boolean;
}

export function NewReportUI({
  report,
  viewModel,
  isBasic: isBasicProp,
  mode,
  showBackButton,
  onShare,
  analysisId,
  shareState,
  onShareClick,
  onUpgrade,
  userId,
  listingFingerprint,
  listingAddress,
  reportType,
  authStatus,
  credits,
  hasFullReport,
  isFullRunning,
  onSignIn,
  onOpenCheckout,
  onViewFullReport,
  hideBottomSection,
}: NewReportUIProps) {
  const { sections, highlights, quickFacts, hero } = report;

// Resolve isBasic: explicit prop wins; fall back to viewModel.meta.isBasic
      const propIsBasic = isBasicProp ?? viewModel?.meta?.isBasic ?? false;

      // Hard guard: any of the following MUST mean this is a Full report and we must
  // never let it fall into the Basic layout, regardless of what normalizeReport's
  // detectBasicResult() inferred from upstream signal loss.
  //   1. The backend stamped analysisType: 'full' on the result object.
  //   2. Full-only sections are present (risk_categories / listing_does_not_prove
  //      / before_you_book_showing / maintenance_risk / carrying_costs).
  //   3. The Full-only structured property_snapshot exists.
  //   4. A US-market marker is present.
  // Otherwise a US Sale Full report that loses a single upstream signal can be
  // silently downgraded to the Basic layout and lose the Risk Categories,
  // Before You Book a Showing, and other Full-only modules.
  const rawObj: Record<string, unknown> = (report?.raw as Record<string, unknown>) ?? {};
  const rawIsFull =
    rawObj.analysisType === 'full' ||
    rawObj.property_snapshot != null ||
    rawObj.risk_categories != null ||
    rawObj.listing_does_not_prove != null ||
    rawObj.before_you_book_showing != null ||
    rawObj.maintenance_risk != null ||
    rawObj.carrying_costs != null ||
    rawObj.market === 'US' ||
    rawObj.market === 'AU';

  const effectiveIsBasic = propIsBasic && !rawIsFull;

  // ── Resolve effective reportMode (sale | rent | unknown) ─────────────────
  // Priority:
  //   1) explicit prop (reportType passed from ReportScreen)
  //   2) viewModel.meta.reportMode (built from normalizedReport.meta)
  //   3) schema-based inference from raw data: the strongest signal.
  //      Rent schema fields win over sale schema fields because rent reports
  //      sometimes also expose stray sale fields (e.g. from a prior prompt run
  //      that was overwritten). Schema-based inference is the final authority.
  // We do NOT default to 'sale' here because that would silently route rent
  // reports through sale-only UI sections (Carrying Costs, Roof Risk, etc.).
  const effectiveReportMode: 'sale' | 'rent' | 'unknown' = (() => {
    const fromProps = (reportType ?? '').toString().toLowerCase();
    const fromViewModel = (viewModel?.meta?.reportMode ?? '').toString().toLowerCase();
    const fromRaw = (rawObj.reportMode ?? rawObj.report_mode ?? '').toString().toLowerCase();
    const candidates = [fromProps, fromViewModel, fromRaw].filter(Boolean);
    for (const c of candidates) {
      if (c === 'rent') return 'rent';
      if (c === 'sale') return 'sale';
      if (c === 'unknown') {
        // Only accept 'unknown' if no schema signal disagrees with it.
        const hasRentSchema = !!(rawObj.rental_listing_score || rawObj.rental_snapshot || rawObj.rental_listing_trust || rawObj.rent_fairness);
        const hasSaleSchema = !!(rawObj.property_snapshot || rawObj.carrying_costs || rawObj.price_assessment);
        if (hasRentSchema && !hasSaleSchema) return 'rent';
        if (hasSaleSchema && !hasRentSchema) return 'sale';
        return 'unknown';
      }
    }
    // Schema-based fallback (any explicit candidate absent)
    const hasRentSchema = !!(rawObj.rental_listing_score || rawObj.rental_snapshot || rawObj.rental_listing_trust || rawObj.rent_fairness);
    const hasSaleSchema = !!(rawObj.property_snapshot || rawObj.carrying_costs || rawObj.price_assessment);
    if (hasRentSchema && !hasSaleSchema) return 'rent';
    if (hasSaleSchema && !hasRentSchema) return 'sale';
    return 'unknown';
  })();

  const hasSections = sections && sections.length > 0;
  const hasHighlights = highlights.pros.length > 0 || highlights.cons.length > 0 || highlights.risks.length > 0;
  const hasQuickFacts = quickFacts && quickFacts.length > 0;
  const hasScore = hero.score !== null && hero.score !== undefined;
  const hasVerdict = renderValue(hero.verdict);

  if (!hasSections && !hasHighlights && !hasQuickFacts && !hasScore && !hasVerdict) {
    return <EmptyState />;
  }

  const [usedIds, setUsedIds] = React.useState<Set<string>>(new Set());
  const registerSections = React.useCallback((ids: string[]) => {
    setUsedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  return (
    <UsedSectionsCtx.Provider value={usedIds}>
    <RegisterSectionsCtx.Provider value={registerSections}>
    <div className="w-full max-w-[1056px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Back button — only on web result pages */}
      {showBackButton && (
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              window.location.href = '/';
            }
          }}
          className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 transition-colors mb-4"
        >
          <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
            <ArrowLeft size={14} strokeWidth={1.5} />
          </div>
          <span className="text-xs font-medium">Back to Profile</span>
        </button>
      )}

      {/* ── Basic Report Layout ─────────────────────────────────────── */}
      {effectiveIsBasic ? (
        <>
          {/* 1. Hero */}
          <HeroSection report={report} isBasic={true} />

          {/* 2. What We Know */}
          <WhatWeKnowSection report={report} />

          {/* 3. Listing Signals */}
          <ListingSignalsSection report={report} />

          {/* 4. What's Missing */}
          <WhatsMissingSection report={report} />

          {/* 5. Key Things To Check */}
          <KeyThingsToCheckSection report={report} />

          {/* 6. Questions to Ask */}
          <QuestionsToAskSection report={report} viewModel={viewModel} isBasic={true} />

          {/* 7. Unlock Full Analysis */}
          <BasicCTA
            report={report}
            analysisId={analysisId}
            mode={mode}
            onUpgrade={onUpgrade}
            authStatus={authStatus}
            credits={credits}
            hasFullReport={hasFullReport}
            isFullRunning={isFullRunning}
            onSignIn={onSignIn}
            onOpenCheckout={onOpenCheckout}
            onViewFullReport={onViewFullReport}
          />
        </>
      ) : (
        <>
          {/* ── Deep Report Layout ─────────────────────────────────── */}

          {/* 1. Hero */}
          <HeroSection report={report} isBasic={false} />

          {/* 1b. Contradiction Banner */}
          {viewModel && <ContradictionBanner contradictions={viewModel.contradictions} />}

          {/* 1c. Verified vs Need to Verify */}
          {viewModel && <VerifiedFromListingSection report={report} viewModel={viewModel} />}

          {effectiveReportMode === 'rent' ? (
            <>
              {/* ── Rent-specific deep layout ────────────────────────── */}
              {/* 2. Rental Listing Score (verdict + reason) */}
              <RentalListingScoreSection report={report} />

              {/* 3. Bottom Line */}
              <RentalBottomLineSection report={report} />

              {/* 4. Rental Snapshot (monthly rent, beds, sqft, parking, pet policy, etc.) */}
              <RentalSnapshotSection report={report} />

              {/* 5. Rental Listing Trust (source consistency, signal breakdown) */}
              <RentalListingTrustSection report={report} />

              {/* 6. Availability Check */}
              <RentalAvailabilitySection report={report} />

              {/* 7. Rent & True Cost (asking rent + rent zestimate + recurring) */}
              <RentTrueCostSection report={report} />

              {/* 8. Application & Payment Risk */}
              <ApplicationPaymentRiskSection report={report} />

              {/* 9. Lease Terms & Rules */}
              <LeaseTermsRulesSection report={report} />

              {/* 10. Location & Daily Life Check */}
              <LocationDailyLifeSection report={report} />

              {/* 11. Photo & Habitability Review (reuse sale's photo block when present) */}
              {report.raw?.photoReview || report.raw?.spaceAnalysis || report.raw?.visualAnalysis || report.raw?.photos ? (
                <PhotoSpaceAnalysisCard raw={report.raw} />
              ) : null}

              {/* 12. Rental Risk Categories (4 rent lanes) */}
              <RentalRiskCategoriesSection report={report} />

              {/* 13. What Could Change Your Decision (rent) */}
              <WhatCouldChangeYourDecisionSection report={report} />

              {/* 14. What the Listing Does Not Prove */}
              <ListingDoesNotProveSection report={report} />

              {/* 15. Before You Tour / Apply / Pay */}
              <BeforeYouTourApplyPaySection report={report} />

              {/* 16. Who This Rental Works For */}
              <RentalWhoItWorksForSection report={report} />

              {/* 17. Next Best Move */}
              <NextBestMoveSection report={report} />

              {/* 18. Any remaining generic sections from the rent adapter */}
              <_RemainingSections report={report} />
            </>
          ) : (() => {
            // ── Sale path. Defence-in-depth: even if meta.reportMode was lost
            //    in transit and effectiveReportMode resolved to non-rent,
            //    detect rent schema in raw data and re-route to the rent UI.
            const rawHasRentSchema = !!(rawObj.rental_listing_score || rawObj.rental_snapshot || rawObj.rental_listing_trust || rawObj.rent_fairness);
            if (rawHasRentSchema) {
              return (
                <>
                  <RentalListingScoreSection report={report} />
                  <RentalBottomLineSection report={report} />
                  <RentalSnapshotSection report={report} />
                  <RentalListingTrustSection report={report} />
                  <RentalAvailabilitySection report={report} />
                  <RentTrueCostSection report={report} />
                  <ApplicationPaymentRiskSection report={report} />
                  <LeaseTermsRulesSection report={report} />
                  <LocationDailyLifeSection report={report} />
                  {report.raw?.photoReview || report.raw?.spaceAnalysis || report.raw?.visualAnalysis || report.raw?.photos ? (
                    <PhotoSpaceAnalysisCard raw={report.raw} />
                  ) : null}
                  <RentalRiskCategoriesSection report={report} />
                  <WhatCouldChangeYourDecisionSection report={report} />
                  <ListingDoesNotProveSection report={report} />
                  <BeforeYouTourApplyPaySection report={report} />
                  <RentalWhoItWorksForSection report={report} />
                  <NextBestMoveSection report={report} />
                  <_RemainingSections report={report} />
                </>
              );
            }
            return (
              <>
                {/* ── Sale deep layout (unchanged) ──────────────────────── */}

                {/* 2. What Could Change Your Decision */}
                <WhatCouldChangeYourDecisionSection report={report} />

                {/* 3. Deal-Changing Risks */}
                <DealChangingRisksSection report={report} />

                {/* 4. Property Snapshot (Is the Price Fair?) */}
                <PropertySnapshotSection report={report} />

                {/* 5. Carrying Costs */}
                <CarryingCostsSection report={report} />

                {/* 6. Location Reality Check */}
                <LocationRealityCheckSection report={report} />

                {/* 7. Photo & Space Analysis */}
                {report.raw?.photoReview || report.raw?.spaceAnalysis || report.raw?.visualAnalysis || report.raw?.photos ? (
                  <PhotoSpaceAnalysisCard raw={report.raw} />
                ) : null}

                {/* 7b. Buyer Risk Check (risk_categories) */}
                <RiskCategoriesSection report={report} />

                {/* 7c. What the Listing Does Not Prove */}
                <ListingDoesNotProveSection report={report} />

                {/* 7d. Before You Book a Showing */}
                <BeforeYouBookShowingSection report={report} />

                {/* 8. Agent Spin Decoder */}
                <AgentSpinDecoderSection report={report} viewModel={viewModel} />

                {/* 9. Who This Property Works For */}
                <WhoThisPropertyWorksForSection report={report} />

                {/* 11. Next Best Move */}
                <NextBestMoveSection report={report} />

                {/* 9b. Any sections not consumed by sale-specific modules */}
                <_RemainingSections report={report} />
              </>
            );
          })()}

          {/* 12. Closing CTA — only shown for full reports */}
          {!effectiveIsBasic && (
            <ReportClosingCTA
              report={report}
              onShare={onShare}
              analysisId={analysisId}
              mode={mode}
              shareState={shareState}
              onShareClick={onShareClick}
              userId={userId}
              listingFingerprint={listingFingerprint}
              listingAddress={listingAddress}
              reportType={reportType}
              hideBottomSection={hideBottomSection}
            />
          )}
        </>
      )}
    </div>
    </RegisterSectionsCtx.Provider>
    </UsedSectionsCtx.Provider>
  );
}
