/**
 * NewReportUI — Figma-aligned report display (Phase 1 + Phase 2)
 *
 * ONLY reads NormalizedReport. All text output goes through safeText() / renderValue().
 *
 * Modules (in order):
 *  1. HeroSection       — score, verdict, headline, next best move
 *  2. WhatCouldChangeYourDecisionSection — 3 decision-changing risk cards
 *  3. DealChangingRisksSection            — risk cards with specific actions
 *  4. PropertySnapshotSection            — "Is the Price Fair?" + property facts
 *  5. CarryingCostsSection              — "What It May Really Cost Monthly"
 *  6. PhotoSpaceAnalysisCard             — shared component, "What Photos Reveal / Don't Show"
 *  7. AgentSpinDecoderSection           — listing language reality check
 *  8. WhoThisPropertyWorksForSection    — layout fit rename
 *  9. QuestionsToAskSection             — data gaps as action questions
 * 10. NextBestMoveSection               — verdict-based summary
 * 11. ReportClosingCTA                   — bottom value summary + share
 */
import React from 'react';
import {
  Check,
  CheckCircle2,
  CheckCircle,
  Copy,
  Share2,
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
  ChevronRight,
  ClipboardList,
  Wrench,
  FileText,
  Droplet,
  MapPin,
  Activity,
  Camera,
  FileSearch,
  CircleHelp,
  Ban,
  ThumbsUp,
} from 'lucide-react';
import type { NormalizedReport, ReportSection } from '../lib/reportAdapters/types';
import type { ReportViewModel } from '../lib/reportAdapters';
import { PhotoSpaceAnalysisCard } from './PhotoSpaceAnalysisCard';

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

function SeverityPill({ value, category }: { value: string; category?: string }) {
  const key = value?.toLowerCase() ?? '';
  const isEnvironmental = category && /environmental|flood|insurance zone/i.test(category);
  if (isEnvironmental && (!key || key === 'unknown')) {
    return (
      <span className="inline-flex items-center text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide bg-stone-100 text-stone-600">
        Needs Verification
      </span>
    );
  }
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
  return /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance|environmental|flood|insurance/i.test(haystack);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1: HeroSection — Decision Summary
// ─────────────────────────────────────────────────────────────────────────────

function HeroSection({ report }: { report: NormalizedReport }) {
  const { hero, highlights, sections } = report;

  // Address: structured hero.address first, then property_snapshot section, then hero.title as last resort
  const address =
    renderValue(hero.address ?? '') ||
    renderValue(sections.find((s) => s.id === 'property-snapshot')
      ?.items.find((i) => /address|location/i.test(renderValue(i.title)))?.value ?? '');

  const identityText = address || renderValue(hero.title ?? '');

  // Generate headline based on top risk
  const headline = React.useMemo(() => {
    const allRiskText = [
      ...highlights.risks,
      ...highlights.cons,
      ...sections.flatMap((s) => s.items.map((i) => renderValue(i.description ?? i.title))),
    ].join(' ').toLowerCase();

    if (/rental|legal|co |certificate|certificate of occupancy|occupancy/i.test(allRiskText)) {
      return 'Worth a closer look — but verify the rental legality first.';
    }
    if (/roof|flat roof|drainage|leak/i.test(allRiskText)) {
      return 'Worth checking, but maintenance risk could affect the real cost.';
    }
    if (/price|overpriced|estimate|fair/i.test(allRiskText)) {
      return 'Price looks uncertain — verify the numbers before moving forward.';
    }
    if (/photo|interior|photo.?count|missing photo|only exterior/i.test(allRiskText)) {
      return 'Looks promising, but the photos leave important questions unanswered.';
    }
    return 'Worth reviewing further, but key risks need verification first.';
  }, [highlights, sections]);

  // Next Best Move — NYC-aware, actionable
  const nextBestMove = React.useMemo(() => {
    const isNYC = /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
      (hero.address ?? '') + (hero.title ?? '')
    );
    if (isNYC) {
      return 'Ask for the Certificate of Occupancy, open violation records, roof age, and actual rental history before booking a viewing.';
    }
    return 'Ask the agent for legal use, repair history, open permits, and comparable sales before booking a viewing.';
  }, [hero.address, hero.title]);

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
      (s) => /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance|environmental|flood|insurance/i.test(s.id + s.title)
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

        {/* Hero image */}
        {hero.imageUrl && (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 mb-6">
            <img
              src={hero.imageUrl}
              alt={address || 'Property photo'}
              className="w-full aspect-[16/10] object-cover"
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          </div>
        )}

        {/* Score + /100 */}
        <div className="flex items-baseline gap-3 mb-6">
          {scoreText !== null ? (
            <div className="text-7xl sm:text-8xl font-bold bg-gradient-to-br from-white via-slate-200 to-slate-300 bg-clip-text text-transparent">
              {scoreText}
            </div>
          ) : (
            <div className="text-7xl sm:text-8xl font-bold text-slate-500">—</div>
          )}
          <div className="text-3xl text-slate-400">/100</div>
        </div>

        {/* Verdict badge */}
        {hero.verdict && (
          <div className="inline-flex items-center gap-2 backdrop-blur border px-6 py-3 rounded-xl mb-4" style={{ borderColor: '#DAA520', backgroundColor: 'rgba(218, 165, 32, 0.15)' }}>
            <Activity className="w-4 h-4" style={{ color: '#DAA520' }} />
            <span className="font-semibold tracking-wide" style={{ color: '#DAA520' }}>{renderValue(hero.verdict)}</span>
          </div>
        )}

        {/* Report Confidence */}
        {hero.confidence && (
          <div className="flex items-center justify-center gap-2 text-slate-300 font-medium mb-6 sm:mb-8">
            <div className="w-2 h-2 rounded-full bg-slate-400" />
            <span>Report Confidence: {renderValue(hero.confidence)}</span>
          </div>
        )}

        {/* One-line headline */}
        <div className="backdrop-blur border rounded-xl p-5 sm:p-6 mb-4" style={{ backgroundColor: '#3a3a3a', borderColor: 'rgba(218, 165, 32, 0.4)' }}>
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <ThumbsUp className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-300 uppercase tracking-wider text-xs font-semibold">Bottom Line</span>
          </div>
          <p className="text-slate-100 text-base sm:text-lg leading-relaxed font-medium">{headline}</p>
        </div>

        {/* Short explanation paragraph */}
        {hero.summary && (
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-6">
            {renderValue(hero.summary)}
          </p>
        )}

        {/* Main Reasons */}
        {mainReasons.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
              <div className="w-1 h-4 bg-gradient-to-b from-slate-400 to-slate-500 rounded-full" />
              <span className="text-slate-300 uppercase tracking-wider text-xs font-semibold">Why It Matters</span>
            </div>
            <ul className="space-y-3">
              {mainReasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-3 text-slate-200">
                  <div className="w-6 h-6 rounded-lg bg-slate-700/30 border border-slate-600/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  </div>
                  <span className="min-w-0 break-words">{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Next Best Move CTA */}
        <div className="border rounded-xl p-4 sm:p-5" style={{ backgroundColor: '#3a3a3a', borderColor: '#DAA520' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(218, 165, 32, 0.2)' }}>
              <Target className="w-3 h-3" style={{ color: '#DAA520' }} />
            </div>
            <span className="uppercase tracking-wider text-xs font-semibold" style={{ color: '#DAA520' }}>Next Best Move</span>
          </div>
          <p className="text-slate-100 text-sm">{nextBestMove}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2: WhatCouldChangeYourDecisionSection
// ─────────────────────────────────────────────────────────────────────────────

const RISK_TITLES: Array<{ keywords: RegExp; title: string }> = [
  { keywords: /basement|moisture|water.*intrusion|drainage|foundation|crack|foundation movement/i, title: 'Basement Moisture Risk' },
  { keywords: /electrical|plumb|heating|boiler|system/i, title: 'Higher Maintenance Burden' },
  { keywords: /rental|legal|co |certificate|occupancy|lease/i, title: 'Rental Legality Risk' },
  { keywords: /flood|insurance|zone/i, title: 'Flood / Insurance Risk' },
  { keywords: /photo|interior|missing/i, title: 'Missing Interior Photos' },
  { keywords: /permit|violation|complaint|dob|hpd/i, title: 'Open Violations Risk' },
  { keywords: /price|overpriced|fair|estimate|value/i, title: 'Price Confidence Risk' },
  { keywords: /noise|neighbor|neighbourhood|community/i, title: 'Neighbourhood Concern' },
  { keywords: /days on market|262|market time|listed.*ago|hasn't sold|hasnt sold/i, title: 'Long Market Time' },
  { keywords: /roof|flat roof|drainage|leak/i, title: 'Masonry / Moisture Risk' },
  { keywords: /kitchen|bathroom|renovation|\$\d+.*k|update|cosmetic/i, title: 'Renovation Cost Risk' },
  { keywords: /market time|days on market/i, title: 'Long Market Time' },
];

function getRiskTitle(text: string): string {
  for (const { keywords, title } of RISK_TITLES) {
    if (keywords.test(text)) return title;
  }
  return 'Key Verification Risk';
}

function getRiskShortExplanation(risk: string): string {
  const t = risk.toLowerCase();
  if (/roof|flat roof|drainage|leak/i.test(t)) {
    return 'Visible roof condition issues or water damage signals can mean major near-term repair costs not reflected in the asking price.';
  }
  if (/electrical|plumb|heating|boiler|system/i.test(t)) {
    return 'Aging systems can fail unexpectedly, triggering costly replacements and affecting insurability.';
  }
  if (/rental|legal|co |certificate|occupancy|lease/i.test(t)) {
    return 'An illegal or unapproved rental unit can reduce value, trigger fines, and block your financing.';
  }
  if (/flood|insurance|zone/i.test(t)) {
    return 'Flood-zone designation or high-risk insurance can materially increase carrying costs.';
  }
  if (/photo|interior|missing/i.test(t)) {
    return 'Missing interior photos mean important condition details have not disclosed.';
  }
  if (/permit|violation|complaint|dob|hpd/i.test(t)) {
    return 'Open violations or complaints can indicate deferred maintenance or legal issues.';
  }
  if (/price|overpriced|fair|estimate|value/i.test(t)) {
    return "Without verified condition details, the price estimate may not reflect the property's real value.";
  }
  if (/noise|neighbor|neighbourhood|community/i.test(t)) {
    return 'Neighbourhood characteristics can affect livability and long-term resale appeal.';
  }
  if (/days on market|262|market time|listed.*ago|hasn't sold|hasnt sold/i.test(t)) {
    return '262 days on market may indicate pricing concerns, condition issues, weak demand, or unresolved buyer objections.';
  }
  if (/basement|moisture|water.*intrusion|drainage|foundation|crack/i.test(t)) {
    return 'Visible basement cracks and unfinished condition may indicate water intrusion, drainage issues, or foundation movement.';
  }
  if (/kitchen|bathroom|renovation|\$\d+.*k|update|cosmetic/i.test(t)) {
    return 'Kitchen and bathroom condition may require significant updates before rental or resale.';
  }
  return risk.length > 120 ? risk.slice(0, 117) + '...' : risk;
}

const IMPACT_LABELS: Array<{ keywords: RegExp; label: string }> = [
  { keywords: /rental|income|legal|co |occupancy|lease/i, label: 'Could affect rental income' },
  { keywords: /roof|electrical|plumb|heating|boiler|maintenance|repair|cost|money|expense/i, label: 'Could cost money' },
  { keywords: /price|overpriced|fair|value|estimate/i, label: 'Could affect your offer' },
  { keywords: /photo|interior|space|room|layout|flood|insurance|zone/i, label: 'Could change your decision' },
  { keywords: /permit|violation|open permit| dob |hpd|complaint/i, label: 'Check before offer' },
  { keywords: /basement|moisture|water|drainage|foundation|crack/i, label: 'Check before viewing' },
  { keywords: /kitchen|bathroom|renovation|\$\d+k|update|cosmetic/i, label: 'Could change your decision' },
  { keywords: /days on market|262|market time/i, label: 'Check before offer' },
];

function getImpactLabel(text: string): string {
  for (const { keywords, label } of IMPACT_LABELS) {
    if (keywords.test(text)) return label;
  }
  return 'Check before offer';
}

function WhatCouldChangeYourDecisionSection({ report, viewModel }: { report: NormalizedReport; viewModel?: ReportViewModel }) {
  const { highlights, sections } = report;

  // Photo consistency: skip Missing Interior Photos card if interior photos are detected
  const hasInteriorPhotos = viewModel?.photos?.hasInteriorPhotos ?? false;
  const photoVM = viewModel?.photos;

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
    /photo|interior|space|missing/i,
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

  // Photo consistency rule: if interior photos exist, skip "Missing Interior Photos" card entirely
  if (hasInteriorPhotos) {
    // filter out photo-related risks from dedup source
    const filtered = dedupedRisks.filter(r => !/photo|interior|missing.*photo|space.*missing/i.test(r));
    // if we removed photo ones, backfill from allRisks if needed
    const dedupedWithPhoto = [...filtered];
    const photoKeywords = /photo|interior|missing.*photo|space.*missing/i;
    for (const r of allRisks) {
      if (dedupedWithPhoto.length >= 3) break;
      if (photoKeywords.test(r)) continue; // skip photo-related when we have interior photos
      if (!dedupedWithPhoto.includes(r)) dedupedWithPhoto.push(r);
    }
    dedupedRisks.length = 0;
    dedupedRisks.push(...dedupedWithPhoto);
  }

  const topRisks = dedupedRisks.slice(0, 3);
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
        These are the issues that could affect whether this property is still worth your time.
      </p>

      <div className="space-y-4 sm:space-y-6">
        {topRisks.map((risk, i) => {
          const cardTitle = getRiskTitle(risk);
          const shortExplanation = getRiskShortExplanation(risk);

          // Bug guard: if title and explanation are identical (both raw risk text),
          // the keyword map produced a title from raw input — skip this card.
          if (cardTitle === shortExplanation) return null;

          const impact = getImpactLabel(risk);
          return (
            <div key={i} className="flex flex-col gap-3 p-5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="font-bold text-slate-900 text-base leading-snug">{cardTitle}</div>
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
function buildRiskAction(riskText: string, isNYC = false): string {
  const t = riskText.toLowerCase();

  // 1. Environmental / Flood — must come FIRST, before Maintenance
  // to prevent basement/water keywords from triggering roof/boiler/electrical action.
  if (/flood|insurance|zone|environmental|windstorm|hurricane|seismic/i.test(t)) {
    if (isNYC) {
      return 'Check FEMA flood maps, NYC flood maps, basement water history, and insurance quotes before estimating monthly costs.';
    }
    return 'Check FEMA flood maps, local flood maps, water intrusion history, and insurance quotes before estimating monthly costs.';
  }

  // 2. Legal & Compliance
  if (/legal|compliance|rental|co |certificate|occupancy|lease|registered|violation|permit| dob |hpd|complaint/i.test(t)) {
    if (isNYC) {
      return 'Ask for the Certificate of Occupancy and check NYC DOB, HPD, and ACRIS records before relying on rental income or making an offer.';
    }
    return 'Ask for legal-use documents and check local building department or county records before relying on rental income or making an offer.';
  }

  // 3. Maintenance — excludes basement/water (those go to Environmental or Structural)
  if (/maintenance|deferred|roof|drainage|leak|dated|old systems|boiler|electrical|plumbing|hvac/i.test(t)) {
    let base = 'Ask for the roof age, boiler age, electrical panel details, plumbing history, HVAC condition, and recent repair records before viewing. Bring a licensed inspector if still interested.';
    if (/cracked tile|cracked.floor/i.test(t)) {
      base += ' Also ask whether the basement has had water intrusion, drainage issues, or foundation repairs.';
    }
    return base;
  }

  // 4. Price Risk
  if (/price|overpriced|estimate|fair|value|comparable|comp/i.test(t)) {
    return 'Ask for recent comparable sales, price reduction history, and seller motivation before deciding whether the asking price is justified.';
  }

  // 5. Rent / Investment Risk
  if (/rent|rental income|investment|yield|return/i.test(t)) {
    return 'Ask for actual lease history, current tenant status, and comparable local rents before using rental income in your numbers.';
  }

  // 6. Default fallback
  return 'Ask the agent for documents or records that confirm this risk before booking a viewing or making an offer.';
}

// Legacy alias — kept to avoid breaking internal calls
function makeSpecificAction(text: string, isNYC = false): string {
  return buildRiskAction(text, isNYC);
}

function DealChangingRisksSection({ report, viewModel }: { report: NormalizedReport; viewModel?: ReportViewModel }) {
  const { sections, highlights, hero } = report;

  const isNYC = viewModel?.meta?.isNYC
    ?? /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
      (hero?.address ?? '') + (hero?.title ?? '')
    );

  // Use validated actions from viewModel if available
  const vmRisks = viewModel?.dealRisks ?? [];

  interface RiskCard {
    title: string;
    description: string;
    severity: string;
    action: string;
    icon: React.ReactNode;
    iconColor: string;
    sectionId: string;
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
      : buildRiskAction(titleLower + ' ' + descText, isNYC);

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

  if (riskCards.length < 3) {
    for (const r of highlights.risks) {
      if (riskCards.length >= 3) break;
      const t = renderValue(r);
      if (!t) continue;
      riskCards.push({
        title: t,
        description: '',
        severity: 'Medium',
        action: buildRiskAction(t, isNYC),
        icon: <AlertTriangle className="w-5 h-5" />,
        iconColor: 'text-amber-600/70',
        sectionId: '__highlights__',
      });
    }
  }

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
                      <SeverityPill value={card.severity} category={card.category} />
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

function PropertySnapshotSection({ report }: { report: NormalizedReport }) {
  const { hero, quickFacts, sections } = report;

  const address =
    renderValue(hero.address ?? '') ||
    renderValue(sections.find((s) => s.id === 'property-snapshot')?.items.find((i) =>
      /address|location/i.test(renderValue(i.title))
    )?.value ?? '');

  const qfItems = quickFacts
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
  const analysisText = priceData.find((i) =>
    /analysis|explanation|summary|context/i.test(i.label)
  )?.description ?? priceData.find((i) =>
    /analysis|explanation|summary|context/i.test(i.label)
  )?.value ?? '';

  // Detect uncertain verdict — do not say "appears fair" when verdict is unknown
  const verdictText = priceData.find((i) =>
    /verdict|assessment|fair|over|under/i.test(i.label)
  )?.value ?? '';
  const verdictIsUnknown = /unknown|uncertain|cannot|insufficient|no comp/i.test(verdictText);
  const hasComps = priceData.some((i) =>
    /comparable|comp|zestimate|zillow|redfin|market/i.test((i.label + ' ' + i.description).toLowerCase())
  );
  const verdictIsOverpriced = /overpriced|over|too high|above|high/i.test(verdictText);
  const verdictIsFair = /fair|reasonable|good.*value|undervalued|below/i.test(verdictText) && !/not fair|unfair/i.test(verdictText);

  // Verdict-aware confidence copy — prevents contradictions like "appears fair" when verdict is Overpriced
  function getPriceConfidenceCopy(): string {
    if (verdictIsOverpriced) {
      return 'The asking price appears high relative to visible condition, long days on market, and unverified legal use. Confidence is still limited because local comps, full inspection details, and rental legality have not been verified.';
    }
    if (verdictIsFair) {
      return 'The asking price appears reasonable based on available signals, but confidence is limited until condition, legal use, and comparable sales are verified.';
    }
    if (verdictIsUnknown || !hasComps) {
      return 'Price cannot be judged confidently from the available data. The price per sqft is only a starting point. Local comps, condition, legal use, and renovation needs could materially change value.';
    }
    return 'The asking price may be attractive based on available signals, but verify condition, title/legal use, and comparable sales before treating it as a bargain.';
  }

  return (
    <div className="rounded-2xl p-8 md:p-10 mb-8" style={{ backgroundColor: '#282828' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(218, 165, 32, 0.15)' }}>
          <Home className="w-5 h-5" style={{ color: '#DAA520' }} />
        </div>
        <h2 className="text-2xl font-bold text-white">PROPERTY SNAPSHOT</h2>
      </div>

      {/* Address */}
      {hasAddress && (
        <div className="mb-8">
          <div className="text-slate-400 uppercase text-xs tracking-wider mb-2">Address</div>
          <div className="text-2xl text-white">{address}</div>
        </div>
      )}

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
                  <div className="text-4xl font-bold text-white">{range}</div>
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
                  <div className="text-4xl font-bold text-white">{asking}</div>
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

          {/* Analysis paragraph — rewritten to be more advisory */}
          {analysisText ? (
            <p className="text-slate-200 text-base leading-relaxed mb-6">{analysisText}</p>
          ) : confIsLow ? (
            <p className="text-slate-300 text-sm leading-relaxed mb-6">
              Low confidence means the price may look reasonable on paper, but missing condition details could change the real value.
            </p>
          ) : null}

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
  const { sections } = report;

  const costSection = sections.find((s) =>
    /cost|carrying|holding|afford/i.test(s.id + s.title)
  );
  const items = costSection?.items ?? [];

  // Legacy/garbage labels to suppress — these come from raw backend summaries,
  // not structured data. Do not render them in the cost breakdown.
  const suppressLabels = new Set([
    'known costs',
    'breakdown available from zillow',
    'monthly carrying costs',
    'estimated monthly cost',
    'carrying costs',
    'total costs',
    'cost pressure',
  ]);

  const costItems = items
    .map((item) => ({
      label: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
      badge: renderValue(item.badge),
    }))
    .filter((i) => {
      const lbl = i.label.toLowerCase();
      if (suppressLabels.has(lbl)) return false;
      // Case-insensitive suppress — catches 'Known Costs', 'Breakdown available from Zillow', etc.
      const fullText = (i.label + ' ' + i.description).toLowerCase();
      if (/breakdown|known costs|zillow|monthly carrying costs|cost pressure/i.test(fullText)) return false;
      // Suppress raw risk/severity labels appearing in cost descriptions
      if (/^risk level$|^high$|^medium$|^low$/i.test(fullText.trim())) return false;
      // Suppress long description-only items that are AI summaries (not structured cost data)
      if (!i.value && i.description && i.description.length > 50) return false;
      return i.value || i.description;
    });

  const missingCosts = items
    .filter((i) => /missing|not.?disclosed|not.?available/i.test(renderValue(i.description ?? i.title)))
    .map((i) => renderValue(i.description ?? i.title))
    .filter(Boolean);

  // hasTotalOnly: true only when we have a structured total AND no detailed breakdown data.
  // Legacy summaries like "Breakdown available from Zillow" are already suppressed above.
  const hasDetailedBreakdown = items.some((item) => {
    const raw = JSON.stringify(item);
    return /breakdown|itemized|line.?item/i.test(raw) &&
      (item as Record<string, unknown>).value !== undefined;
  });
  const hasTotalOnly = !hasDetailedBreakdown &&
    costItems.length > 0 &&
    costItems.some((i) => /total|monthly/i.test(i.label));

  const hasAnyFinancialSignal = items.some((item) => {
    const val = item.value ?? '';
    const desc = item.description ?? '';
    return /\$[\d,]/.test(val) || /\$[\d,]/.test(desc)
      || /N\/A|Not included|Known|available/i.test(val + desc);
  });

  const hasContent = costItems.length > 0 || missingCosts.length > 0;

  // Track annual vs monthly tax separately for unit display
  let annualTaxValue = '';
  let monthlyTaxValue = '';

  // Classify cost items into structured categories
  const structuredCosts: Record<string, { value: string; description: string }> = {};
  const otherCostItems: typeof costItems = [];

  for (const item of costItems) {
    const label = item.label.toLowerCase();
    if (/tax|year|annual/i.test(label)) {
      const v = item.value;
      if (/\/mo|\/month/i.test(v)) {
        monthlyTaxValue = v.replace(/\/mo|\/month/i, '').replace(/^\$/, '').trim();
      } else if (/\/yr|\/year|yearly/i.test(v)) {
        annualTaxValue = v.replace(/\/yr|\/year|yearly/i, '').replace(/^\$/, '').trim();
      } else {
        // No unit — assume annual if large (> 1000), monthly otherwise
        const num = parseFloat(v.replace(/[$,]/g, ''));
        if (num > 1000) annualTaxValue = v.replace(/^\$/, '').trim();
        else monthlyTaxValue = v.replace(/^\$/, '').trim();
      }
      structuredCosts['tax'] = { value: item.value, description: item.description };
    } else if (/hoa|monthly fee/i.test(label)) {
      structuredCosts['hoa'] = { value: item.value, description: item.description };
    } else if (/insurance/i.test(label)) {
      structuredCosts['insurance'] = { value: item.value, description: item.description };
    } else if (/maintenance|reserve/i.test(label)) {
      structuredCosts['maintenance'] = { value: item.value, description: item.description };
    } else if (/financ|mortgage|down/i.test(label)) {
      structuredCosts['financing'] = { value: item.value, description: item.description };
    } else if (/total|monthly/i.test(label)) {
      structuredCosts['total'] = { value: item.value, description: item.description };
    } else {
      // Suppress summary-like items that belong in the disclaimer, not bullet lists.
      // Long description (>50 chars) that reads like an AI summary gets filtered out.
      const isSummaryLike = item.description.length > 50 && item.value.length < 5;
      // Also suppress if description is just a risk/severity label
      const isRiskLabel = /^risk level$|^high$|^medium$|^low$/i.test(item.description.trim());
      if (!isSummaryLike && !isRiskLabel) {
        otherCostItems.push(item);
      }
    }
  }

  function formatTaxDisplay(): string {
    const hasAnnual = annualTaxValue.length > 0;
    const hasMonthly = monthlyTaxValue.length > 0;
    if (hasAnnual && hasMonthly) {
      const ann = annualTaxValue.startsWith('$') ? annualTaxValue : `$${annualTaxValue}`;
      const mo = monthlyTaxValue.startsWith('$') ? monthlyTaxValue : `$${monthlyTaxValue}`;
      return `${ann}/year · approx. ${mo}/mo`;
    }
    if (hasAnnual) {
      const ann = annualTaxValue.startsWith('$') ? annualTaxValue : `$${annualTaxValue}`;
      return `${ann}/year`;
    }
    if (hasMonthly) {
      const mo = monthlyTaxValue.startsWith('$') ? monthlyTaxValue : `$${monthlyTaxValue}`;
      return `${mo}/mo`;
    }
    return '';
  }

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
          <DollarSign className="w-5 h-5 text-violet-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          What It May Really Cost Monthly
        </h2>
      </div>

      {/* Estimation warning banner */}
      <div className="rounded-xl p-4 mb-6 bg-amber-50 border border-amber-200">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-800 text-sm leading-relaxed">
            This monthly estimate should be treated as a starting point, not a final budget. Insurance, repairs, utilities, vacancy, and financing terms can change the real cost.
          </p>
        </div>
      </div>

      {/* Not Enough Disclosed warning */}
      {!hasContent && !hasAnyFinancialSignal && (
        <div className="bg-slate-50 border border-slate-300 rounded-xl p-5 sm:p-6 mb-6">
          <div className="font-semibold text-slate-800 mb-2">Not Enough Disclosed</div>
          <p className="text-slate-700 text-sm">
            The listing does not provide enough cost data to estimate monthly ownership expenses.
          </p>
        </div>
      )}

      {/* Structured cost breakdown */}
      {(structuredCosts.total || Object.keys(structuredCosts).length > 0) && (
        <div className="space-y-1 mb-4">
          {structuredCosts.total && (
            <div className="flex justify-between items-center py-2.5 border-b border-slate-200 mb-2">
              <span className="text-sm font-semibold text-slate-900">Estimated Monthly Cost</span>
              <span className="text-lg font-bold text-slate-900">{structuredCosts.total.value}</span>
            </div>
          )}
          {structuredCosts.tax ? (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-600">Known Tax</span>
              <span className="text-sm font-medium text-slate-900 text-right">{formatTaxDisplay() || structuredCosts.tax.value}</span>
            </div>
          ) : null}
          {structuredCosts.hoa ? (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-600">HOA</span>
              <span className="text-sm font-medium text-slate-900 text-right">{structuredCosts.hoa.value}</span>
            </div>
          ) : (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-400">HOA</span>
              <span className="text-sm text-slate-400 text-right">None</span>
            </div>
          )}
          {structuredCosts.insurance ? (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-600">Insurance</span>
              <span className="text-sm font-medium text-slate-900 text-right">{structuredCosts.insurance.value}</span>
            </div>
          ) : (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-400">Insurance</span>
              <span className="text-sm text-slate-400 text-right">Not provided</span>
            </div>
          )}
          {structuredCosts.maintenance ? (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-600">Maintenance Reserve</span>
              <span className="text-sm font-medium text-slate-900 text-right">{structuredCosts.maintenance.value}</span>
            </div>
          ) : (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-400">Maintenance Reserve</span>
              <span className="text-sm text-slate-400 text-right">Not included</span>
            </div>
          )}
          {structuredCosts.financing ? (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-600">Financing Assumptions</span>
              <span className="text-sm font-medium text-slate-900 text-right">{structuredCosts.financing.value}</span>
            </div>
          ) : (
            <div className="flex justify-between items-start py-1.5">
              <span className="text-sm text-slate-400">Financing Assumptions</span>
              <span className="text-sm text-slate-400 text-right">Not shown</span>
            </div>
          )}
        </div>
      )}

      {/* Other unclassified cost items */}
      {otherCostItems.length > 0 && (
        <div className="divide-y divide-slate-100">
          {otherCostItems.map((item, i) => (
            <div key={i} className="py-2.5 first:pt-0 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                {item.description && (
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.value && <span className="text-sm font-semibold text-slate-900">{item.value}</span>}
                {item.badge && <SeverityPill value={item.badge} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Total-only disclaimer — shown after cost items when assumptions are incomplete */}
      {hasTotalOnly && costItems.length > 0 && (
        <div className="rounded-lg p-4 mt-4 bg-slate-50 border border-slate-200">
          <div className="font-semibold text-slate-700 mb-1 text-sm">Full cost assumptions are not available</div>
          <p className="text-slate-500 text-xs leading-relaxed">
            This appears to include known listing cost assumptions, but financing terms, insurance, utilities,
            vacancy, and maintenance reserves may not be fully included. Treat this as a rough planning number only.
          </p>
        </div>
      )}

      {/* Missing costs list */}
      {missingCosts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="font-semibold text-gray-900 mb-2">Why it matters</div>
          <p className="text-gray-700 text-sm leading-relaxed mb-3">
            Without these numbers, total monthly cost could be materially higher than expected.
          </p>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="font-semibold text-gray-900 mb-2">Missing cost items:</div>
            <ul className="space-y-1.5 ml-5">
              {missingCosts.map((item, i) => (
                <li key={i} className="text-gray-700 text-sm list-disc">{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 7: AgentSpinDecoderSection
// ─────────────────────────────────────────────────────────────────────────────

function makeFallbackAsk(phrase: string): string {
  const t = phrase.toLowerCase();

  // rental / investor / live in one unit — must come first
  if (/rent|rental|income|investor|live in one|second unit|extra income/i.test(t)) {
    return 'Can you confirm legal two-family use, whether the second unit is legally rentable, and what actual rent it has achieved?';
  }
  if (/two.?family|multi.family|spacious|large.*family|family.*home/i.test(t)) {
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

function AgentSpinDecoderSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const realitySection = sections.find((s) =>
    /listing.?reality|listing.?spin|agent.?lingo|agent.?spin/i.test(s.id + s.title)
  );

  const realityItems: Array<{
    phrase: string;
    meaning: string;
    ask: string;
    badge: string;
  }> = [];

  if (realitySection) {
    for (const item of realitySection.items) {
      const title = renderValue(item.title);
      const desc = renderValue(item.description);
      const badge = renderValue(item.badge);
      // Support both old format (title=phrase, description=meaning) and
      // new format (what_to_verify field via badge or separate field)
      const ask = badge && !/verify/i.test(badge) ? badge : makeFallbackAsk(title + ' ' + desc);
      if (title || desc) {
        realityItems.push({ phrase: title, meaning: desc, ask, badge });
      }
    }
  }

  if (realityItems.length === 0) return null;

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

  // Fallbacks if empty
  if (bestFor.length === 0) {
    bestFor = [
      'Owner-occupant seeking rental income offset',
      'Multi-generational family needing separate living areas',
      'Buyer comfortable with renovation and inspections',
    ];
  }
  if (notIdealFor.length === 0) {
    notIdealFor = [
      'Buyer wanting move-in-ready condition',
      'Buyer with limited renovation budget',
      'Buyer uncomfortable with tenant or compliance risk',
    ];
  }

  return {
    bestFor,
    notIdealFor,
    whyItMatters:
      summary ||
      'This layout may support owner-occupy plus rental or multi-generational living, but legal use, unit separation, and renovation needs should be verified first.',
  };
}

function WhoThisPropertyWorksForSection({ report }: { report: NormalizedReport }) {
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
function fieldToQuestion(fieldText: string): string {
  const t = fieldText.toLowerCase();
  if (/roof|drainage|leak/i.test(t)) return 'How old are the roof, boiler, electrical panel, plumbing, and HVAC systems?';
  if (/electrical|plumb|heating|boiler|system|mechanical/i.test(t)) return 'When were the major systems last updated, and are maintenance records available?';
  if (/comparable|comp|market trends|recent sale/i.test(t)) return 'Can you provide recent comparable sales for similar properties in the area?';
  if (/legal|two.?family|occupancy|certificate/i.test(t)) return 'Can you confirm the legal use and provide the Certificate of Occupancy?';
  if (/rent|income|lease|tenant/i.test(t)) return 'What actual rent has the second unit achieved, not just estimated rent?';
  if (/price|asking|list/i.test(t)) return 'Has the price been reduced since listing, and what is the seller\'s motivation?';
  if (/days on market|262|listed|how long/i.test(t)) return 'Why has the property been on market for so long? Were there failed inspections, price reductions, or buyer concerns?';
  if (/violation|dob|hpd|complaint|permit/i.test(t)) return 'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?';
  if (/basement|foundation|water|intrusion|drainage/i.test(t)) return 'Has the basement had water intrusion, foundation repairs, or drainage issues?';
  if (/insurance|flood|zone/i.test(t)) return 'Is the property in a flood zone, and what does insurance typically cost for this property?';
  if (/cost|tax|hoa|expense|monthly/i.test(t)) return 'What are the real monthly costs including insurance, utilities, repairs, vacancy, and maintenance reserve?';
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

// Region-aware fallback questions — varies by NYC vs non-NYC
function getFallbackQuestions(isNYC: boolean): Array<{ q: string; tag: string; color: string }> {
  const records = isNYC ? 'NYC DOB, HPD, and ACRIS' : 'local building department and county records';
  return [
    { q: 'Can you confirm the legal two-family status and provide the Certificate of Occupancy?', tag: 'Legal', color: 'bg-violet-100 text-violet-700' },
    { q: 'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?', tag: 'Legal', color: 'bg-violet-100 text-violet-700' },
    { q: 'How old are the roof, boiler, electrical panel, plumbing, and HVAC systems?', tag: 'Systems', color: 'bg-orange-100 text-orange-700' },
    { q: 'Has the basement had water intrusion, leaks, foundation issues, or drainage problems?', tag: 'Basement', color: 'bg-blue-100 text-blue-700' },
    { q: 'What actual rent has the second unit achieved, not just estimated rent?', tag: 'Rent', color: 'bg-green-100 text-green-700' },
    { q: 'Can you provide recent comparable sales for similar two-family homes in the area?', tag: 'Price', color: 'bg-amber-100 text-amber-700' },
    { q: 'What are the real monthly costs including insurance, utilities, repairs, vacancy, and maintenance reserve?', tag: 'Costs', color: 'bg-teal-100 text-teal-700' },
    { q: 'Why has the property been on market for so long? Were there price reductions, failed inspections, or buyer concerns?', tag: 'Market Time', color: 'bg-indigo-100 text-indigo-700' },
  ];
}

function QuestionsToAskSection({ report, viewModel }: { report: NormalizedReport; viewModel?: ReportViewModel }) {
  const { sections, hero } = report;

  const isNYC = viewModel?.meta?.isNYC
    ?? /nyc|new york city|brooklyn|queens|bronx|manhattan|staten/i.test(
      (hero?.address ?? '') + (hero?.title ?? '')
    );

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
    // Ensure monthly costs question is present; merge fallback if needed
    const hasCosts = finalQuestions.some(q =>
      /monthly|cost|insurance|utility|maintenance|reserve/i.test(q.question)
    );
    const seenQ = new Set(finalQuestions.map(q => q.question));
    if (finalQuestions.length < 8 || !hasCosts) {
      const fallback = getFallbackQuestions(isNYC);
      for (const fq of fallback) {
        if (finalQuestions.length >= 8) break;
        if (seenQ.has(fq.q)) continue;
        finalQuestions.push({ question: fq.q, tag: fq.tag, tagColor: fq.color, whereToVerify: '' });
        seenQ.add(fq.q);
      }
    }
  } else {
    // Legacy: build from section items
    const gapSections = sections.filter((s) =>
      /data.?gap|missing|verify|question|ask|inspection/i.test(s.id + s.title) &&
      !isRiskSection(s)
    );
    const questions: Array<{ question: string; tag: string; tagColor: string; whereToVerify: string }> = [];
    const seenQ = new Set<string>();

    for (const s of gapSections) {
      for (const item of s.items) {
        const title = renderValue(item.title);
        const desc = renderValue(item.description);
        const badge = renderValue(item.badge);
        const fullText = (title + ' ' + desc).trim();
        if (!fullText) continue;
        if (/missing data|summary|overview|where to verify|things to verify|questions to ask/i.test(title)) continue;
        const rawText = desc.length > title.length ? desc : title;
        const isFieldName = FIELD_NAME_PATTERNS.some((p) => p.test(rawText));
        let qText: string;
        if (isFieldName) {
          const converted = fieldToQuestion(rawText);
          if (!converted || seenQ.has(converted)) continue;
          qText = converted;
        } else if (rawText.endsWith('?') || /^(can|could|what|how|why|when|is|are|has|have|do|does)/i.test(rawText)) {
          qText = rawText;
        } else if (rawText.length > 50) {
          continue;
        } else {
          continue;
        }
        if (seenQ.has(qText)) continue;
        seenQ.add(qText);
        const { label: tagLabel, color: tagColor } = getQuestionTag(qText);
        let whereToVerify = '';
        if (badge && /nyc| dob |hpd|acris|records/i.test(badge) && isNYC) {
          whereToVerify = badge;
        }
        questions.push({ question: qText, tag: tagLabel, tagColor, whereToVerify });
      }
    }

    if (questions.length === 0) {
      finalQuestions = getFallbackQuestions(isNYC).map((fq) => ({
        question: fq.q,
        tag: fq.tag,
        tagColor: fq.color,
        whereToVerify: '',
      }));
    } else {
      const seenFamilies = new Set<number>();
      const deduped: typeof questions = [];
      for (const q of questions) {
        const qLower = q.question.toLowerCase();
        let matchedFamily = -1;
        for (let fi = 0; fi < CORE_QUESTION_FAMILIES.length; fi++) {
          if (CORE_QUESTION_FAMILIES[fi].keywords.test(qLower)) {
            matchedFamily = fi;
            break;
          }
        }
        if (matchedFamily >= 0 && seenFamilies.has(matchedFamily)) continue;
        if (matchedFamily >= 0) seenFamilies.add(matchedFamily);
        deduped.push(q);
      }
      if (deduped.length < 4) {
        const fallback = getFallbackQuestions(isNYC);
        for (const fq of fallback) {
          if (deduped.length >= 8) break;
          if (seenQ.has(fq.q)) continue;
          deduped.push({ question: fq.q, tag: fq.tag, tagColor: fq.color, whereToVerify: '' });
          seenQ.add(fq.q);
        }
      }
      finalQuestions = deduped.slice(0, 8);
    }
  }

  if (finalQuestions.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
          <ClipboardList className="w-5 h-5 text-sky-600/70" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Questions to Ask Before You View</h2>
        </div>
      </div>
      <p className="text-slate-500 text-sm mb-6 sm:mb-8">
        Use these before booking a viewing, contacting the agent, or making an offer.
      </p>

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

  const verdict = hero.verdict.toLowerCase();
  const score = hero.score;

  let message = 'Use the questions above to decide whether this property deserves a viewing.';
  if (/worth|inspecting|strong|good|recommend/i.test(verdict) && (score === null || score === undefined || score >= 75)) {
    message = 'This property may be worth viewing, but confirm the key assumptions before making an offer.';
  } else if (/caution|proceed|caution|uncertain|more.?evidence/i.test(verdict)) {
    message = 'Keep this property on your shortlist, but do not rely on the rental income or price signal until the legal status, roof condition, and major systems are verified.';
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

function InvestmentPotentialSection({ report }: { report: NormalizedReport }) {
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

function DetailedRiskAnalysisSection({ report }: { report: NormalizedReport }) {
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

// ── Location Reality Check ────────────────────────────────────────────────────

function LocationRealityCheckSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

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

  // Standard "What to verify" questions — shown first
  const defaultVerifyItems = [
    'What are the actual nearby transit options and commute times?',
    'What are the school ratings and catchment zones?',
    'What is the crime and safety profile of this block?',
    'Is the property in a flood zone or hurricane evacuation zone?',
    'Are comparable two-family rentals in this area leasing quickly?',
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

  // Generate "What this could mean" explanation
  let whatItMeans = '';
  if (claimList.length > 0) {
    whatItMeans = `This location may work well for buyers who want a quieter residential setting with access to transit, schools, and local amenities. However, the listing does not provide specific commute times, school ratings, crime data, Walk Score, or rental demand data, so the location quality still needs verification.`;
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

function RemainingSections({ report }: { report: NormalizedReport }) {
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

function ReportClosingCTA({
  report,
  onShare,
  analysisId,
  mode,
  shareState,
  onShareClick,
}: {
  report: NormalizedReport;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  analysisId?: string;
  mode?: 'web' | 'extension';
  shareState?: { isSharing?: boolean; shareResult?: { slug: string; shareUrl: string } | null; copied?: boolean };
  onShareClick?: () => void;
}) {
  const [shareLabel, setShareLabel] = React.useState('Get a second opinion');
  const shareTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveShareResult = shareState !== undefined ? (shareState.shareResult ?? null) : null;
  const effectiveCopied = shareState !== undefined ? (shareState.copied ?? false) : false;
  const effectiveIsSharing = shareState !== undefined ? (shareState.isSharing ?? false) : false;

  function resetShareLabel() {
    if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    shareTimerRef.current = setTimeout(() => setShareLabel('Get a second opinion'), 2000);
  }

  async function handleShare() {
    if (onShareClick) {
      onShareClick();
      return;
    }

    const raw = report.raw ?? {};
    const explicitUrl = raw.shareUrl ?? raw.share_url ?? raw.publicUrl ?? raw.public_url;
    if (typeof explicitUrl === 'string' && explicitUrl.startsWith('http')) {
      try {
        await navigator.clipboard.writeText(explicitUrl);
        setShareLabel('Link copied');
        resetShareLabel();
      } catch {
        setShareLabel('Copy failed');
        resetShareLabel();
      }
      return;
    }

    const slug = raw.shareSlug ?? raw.share_slug;
    if (typeof slug === 'string' && slug) {
      const url = `${window.location.origin}/share/${slug}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareLabel('Link copied');
        resetShareLabel();
      } catch {
        setShareLabel('Copy failed');
        resetShareLabel();
      }
      return;
    }

    if (window.location.pathname.includes('/share/')) {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setShareLabel('Link copied');
        resetShareLabel();
      } catch {
        setShareLabel('Copy failed');
        resetShareLabel();
      }
      return;
    }

    if (onShare && analysisId) {
      try {
        const result = await onShare(analysisId);
        const url = result.shareUrl ?? `${window.location.origin}/share/${result.slug}`;
        await navigator.clipboard.writeText(url);
        setShareLabel('Link copied');
        resetShareLabel();
      } catch {
        setShareLabel('Copy failed');
        resetShareLabel();
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareLabel('Link copied');
      resetShareLabel();
    } catch {
      setShareLabel('Copy failed');
      resetShareLabel();
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

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-8 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <Target className="w-5 h-5 text-amber-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">One last check before you decide</h2>
      </div>

      {/* Core message */}
      <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-4">
        You now know the key risks, missing details, and questions to ask before spending time on this property.
      </p>

      <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-6">
        HomeScope is not here to tell you what to buy. It helps you spot what the listing may not make obvious — so you can move forward with more confidence, or skip a property that is not worth the trip.
      </p>

      {/* What this report helped you avoid guessing */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 sm:p-6 mb-6">
        <div className="font-semibold text-slate-800 mb-3">What this report helped you avoid guessing</div>
        <ul className="space-y-2">
          {[
            'Whether the price looks reasonable',
            'What the listing language may be hiding',
            'Which photos or details are missing',
            'What could cost money later',
            'What to ask before booking a viewing',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <CheckCircle2 className="w-4 h-4 text-amber-600/80 mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Share section */}
      <div className="border-t border-slate-200 pt-6">
        <div className="font-semibold text-slate-800 mb-1">Not sure yet? Get a second opinion.</div>
        <p className="text-slate-600 text-sm mb-4">Share this report with someone you trust before you make a call.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          {effectiveShareResult === null ? (
            <button
              type="button"
              onClick={handleShare}
              disabled={effectiveIsSharing}
              className="px-6 py-3 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer w-full sm:w-auto"
            >
              {effectiveIsSharing ? 'Generating share link...' : 'Share this report'}
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full w-fit">
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

interface NewReportUIProps {
  report: NormalizedReport;
  viewModel?: ReportViewModel;
  mode?: 'web' | 'extension';
  showBackButton?: boolean;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  analysisId?: string;
  shareState?: { isSharing?: boolean; shareResult?: { slug: string; shareUrl: string } | null; copied?: boolean };
  onShareClick?: () => void;
}

export function NewReportUI({ report, viewModel, mode, showBackButton, onShare, analysisId, shareState, onShareClick }: NewReportUIProps) {
  const { sections, highlights, quickFacts, hero } = report;

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
          className="mb-4 text-sm text-stone-500 hover:text-stone-900 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          Back to reports
        </button>
      )}

      {/* 1. Hero */}
      <HeroSection report={report} />

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
      {report.raw?.spaceAnalysis || report.raw?.visualAnalysis || report.raw?.photos ? (
        <PhotoSpaceAnalysisCard raw={report.raw} />
      ) : null}

      {/* 8. Agent Spin Decoder */}
      <AgentSpinDecoderSection report={report} />

      {/* 9. Who This Property Works For */}
      <WhoThisPropertyWorksForSection report={report} />

      {/* 10. Questions to Ask */}
      <QuestionsToAskSection report={report} />

      {/* 11. Next Best Move */}
      <NextBestMoveSection report={report} />

      {/* 11. Closing CTA */}
      <ReportClosingCTA
        report={report}
        onShare={onShare}
        analysisId={analysisId}
        mode={mode}
        shareState={shareState}
        onShareClick={onShareClick}
      />
    </div>
    </RegisterSectionsCtx.Provider>
    </UsedSectionsCtx.Provider>
  );
}
