/**
 * NewReportUI — Figma-aligned report display (Phase 1 + Phase 2)
 *
 * ONLY reads NormalizedReport. All text output goes through safeText() / renderValue().
 * Phase 1: Final Verdict Hero, Top Risks, Before You Proceed + Quick Balance.
 * Phase 2: Property Snapshot, Carrying Costs, Investment Potential, Detailed Risk Analysis,
 *          Data Gaps, Neighborhood, Remaining Sections.
 */
import React from 'react';
import {
  Check,
  CheckCircle2,
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
} from 'lucide-react';
import type { NormalizedReport, ReportSection } from '../lib/reportAdapters/types';

// ── Section dedup context ──────────────────────────────────────────────────────
// Tracks which section IDs have been consumed by earlier components.

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
    'price-assessment':      <DollarSign className={className} />,
    'carrying-costs':       <DollarSign className={className} />,
    'rent-fairness':        <DollarSign className={className} />,
    'investment-potential':  <TrendingUp className={className} />,
    'maintenance-risk':     <Wrench className={className} />,
    'legal-compliance':      <Shield className={className} />,
    'environmental-risk':    <Droplet className={className} />,
    'deal-breakers':         <AlertCircle className={className} />,
    'red-flags':             <AlertTriangle className={className} />,
    'competition-risk':      <BarChart3 className={className} />,
    'property-snapshot':     <Home className={className} />,
    'space-analysis':       <Home className={className} />,
    'neighborhood':          <MapPin className={className} />,
    'questions-to-ask':      <MessageSquare className={className} />,
    'questions':             <MessageSquare className={className} />,
    'data-gaps':            <FileText className={className} />,
    'layout-fit':            <Home className={className} />,
    'property-strengths':    <Check className={className} />,
    'potential-issues':     <AlertCircle className={className} />,
    'next-move':             <Target className={className} />,
    'would-i-buy':           <Target className={className} />,
    'state-advice':         <Info className={className} />,
    'final-recommendation':  <Target className={className} />,
    'agent-lingo':          <MessageSquare className={className} />,
    'light-thermal':        <Eye className={className} />,
    'listing-reality-check':<ClipboardList className={className} />,
    'affordability':        <DollarSign className={className} />,
    'holding-costs':         <DollarSign className={className} />,
    'land-value':            <TrendingUp className={className} />,
    'application-strategy':  <Zap className={className} />,
    'summary':               <Info className={className} />,
  };
  return map[id] ?? <BarChart3 className={className} />;
}

function iconColorFor(id: string): string {
  const map: Record<string, string> = {
    'maintenance-risk':    'text-rose-600/70',
    'legal-compliance':    'text-amber-600/70',
    'environmental-risk':  'text-blue-600/70',
    'deal-breakers':       'text-red-600/70',
    'red-flags':           'text-red-600/70',
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
// (Preserved exactly as-is)

function isRiskSection(section: ReportSection): boolean {
  const haystack = (section.id + ' ' + section.title).toLowerCase();
  return /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance|environmental|flood|insurance/i.test(haystack);
}

function HeroSection({ report }: { report: NormalizedReport }) {
  const { hero, highlights, sections } = report;

  const mainReasons: string[] = [];
  for (const r of highlights.risks) {
    if (mainReasons.length >= 3) break;
    const t = renderValue(r);
    if (t) mainReasons.push(t);
  }
  for (const c of highlights.cons) {
    if (mainReasons.length >= 3) break;
    const t = renderValue(c);
    if (t && !mainReasons.includes(t)) mainReasons.push(t);
  }
  if (mainReasons.length === 0) {
    const riskSections = sections.filter(
      (s) =>
        /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance|environmental|flood|insurance/i.test(
          s.id + s.title
        )
    );
    for (const s of riskSections) {
      for (const item of s.items) {
        if (mainReasons.length >= 3) break;
        const t = renderValue(item.description ?? item.title);
        if (t) mainReasons.push(t);
      }
    }
  }

  const nextStep =
    sections.find((s) => /question|verify|data.?gap|next.?step|before/i.test(s.id))?.items[0]?.description
    ?? sections.find((s) => /question|verify|data.?gap|next.?step|before/i.test(s.id))?.items[0]?.title
    ?? sections.find((s) => /question|verify|data.?gap|next.?step|before/i.test(s.id))?.subtitle
    ?? (hero.summary ? 'Verify key risks, costs and inspection details before progressing.' : '');

  const score = hero.score;
  const scoreText = score !== null && score !== undefined ? String(score) : null;

  return (
    <div className="relative bg-slate-900 rounded-2xl p-6 sm:p-8 md:p-10 mb-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-purple-600/5 to-pink-600/5" />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-slate-700/60 flex items-center justify-center">
            <Shield className="w-4 h-4 text-slate-300" />
          </div>
          <span className="text-slate-300 uppercase tracking-wider text-sm font-semibold">Final Verdict</span>
        </div>

        <div className="flex items-baseline gap-3 mb-6">
          {scoreText !== null ? (
            <div className="text-7xl sm:text-8xl font-bold bg-gradient-to-br from-white via-slate-200 to-slate-300 bg-clip-text text-transparent">
              {scoreText}
            </div>
          ) : (
            <div className="text-7xl sm:text-8xl font-bold text-slate-500">—</div>
          )}
          <div className="text-3xl text-slate-400">/100</div>
          <div className="text-slate-300 uppercase tracking-wider text-sm ml-2 sm:ml-4 self-center">
            Decision Score
          </div>
        </div>

        {hero.verdict && (
          <div className="inline-flex items-center gap-2 bg-slate-700/30 backdrop-blur border border-slate-600/40 px-6 py-3 rounded-xl mb-4">
            <Activity className="w-4 h-4 text-slate-300" />
            <span className="font-semibold text-slate-200 tracking-wide">{renderValue(hero.verdict)}</span>
          </div>
        )}

        {hero.confidence && (
          <div className="flex items-center gap-2 text-slate-300 font-medium mb-6 sm:mb-8">
            <div className="w-2 h-2 rounded-full bg-slate-400" />
            <span>Report Confidence: {renderValue(hero.confidence)}</span>
          </div>
        )}

        {hero.summary && (
          <div className="bg-slate-800/80 backdrop-blur border border-blue-500/20 rounded-xl p-5 sm:p-6 mb-4">
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Zap className="w-3.5 h-3.5 text-blue-400/70" />
              <span className="text-blue-400/90 uppercase tracking-wider text-xs font-semibold">Key Takeaway</span>
            </div>
            <p className="text-slate-100 text-base sm:text-lg leading-relaxed">{renderValue(hero.summary)}</p>
          </div>
        )}

        {mainReasons.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
              <div className="w-1 h-4 bg-gradient-to-b from-slate-400 to-slate-500 rounded-full" />
              <span className="text-slate-300 uppercase tracking-wider text-xs font-semibold">Main Reasons</span>
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

        {nextStep && (
          <div className="bg-slate-800/40 border border-amber-500/30 rounded-xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-lg bg-amber-600/20 flex items-center justify-center">
                <Activity className="w-3 h-3 text-amber-400/80" />
              </div>
              <span className="text-amber-400/90 uppercase tracking-wider text-xs font-semibold">Next Step</span>
            </div>
            <p className="text-slate-100 text-sm">{renderValue(nextStep)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TopRisksSection({ report }: { report: NormalizedReport }) {
  const { sections, highlights } = report;

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

  for (const s of sections) {
    if (!isRiskSection(s)) continue;
    if (riskCards.length >= 3) break;

    const sev = s.items.find((i) => i.severity)?.severity
      ?? s.items.find((i) => i.badge)?.badge
      ?? 'Medium';
    const descItem = s.items.find((i) => renderValue(i.description));
    const actionItem = s.items.find(
      (i) => /action|verify|inspect|check|request/i.test(renderValue(i.description ?? i.title))
    );

    riskCards.push({
      title: renderValue(s.title),
      description: renderValue(descItem?.description ?? s.subtitle),
      severity: renderValue(sev),
      action: renderValue(actionItem?.description ?? actionItem?.title ?? 'Verify this before making a decision.'),
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
        action: 'Verify this before making a decision.',
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
      <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200">
        <div className="flex items-center gap-3 mb-6 sm:mb-8">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose-600/70" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Top Risks</h2>
        </div>

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
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="bg-slate-800 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl flex items-center gap-2 shrink-0">
                    <Zap className="w-3.5 h-3.5 text-white" />
                    <span className="uppercase text-xs font-bold tracking-wide text-white">Action</span>
                  </div>
                  <span className="text-slate-700 text-sm font-medium min-w-0 break-words">{card.action}</span>
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

function BeforeProceedSection({ report }: { report: NormalizedReport }) {
  const { sections, highlights } = report;

  const beforeSection = sections.find((s) =>
    /question|verify|data.?gap|next.?step|before|ask/i.test(s.id)
  );
  const beforeItems: string[] = [];
  if (beforeSection) {
    for (const item of beforeSection.items) {
      const t = renderValue(item.description ?? item.title);
      if (t && !beforeItems.includes(t)) beforeItems.push(t);
    }
  }
  if (beforeItems.length === 0) {
    for (const r of highlights.risks) {
      const t = renderValue(r);
      if (t && !beforeItems.includes(t)) beforeItems.push(t);
    }
  }

  const upsideItems = highlights.pros.map(renderValue).filter(Boolean);
  const concernItems = [...highlights.cons, ...highlights.risks]
    .map(renderValue)
    .filter(Boolean);

  if (beforeItems.length === 0 && upsideItems.length === 0 && concernItems.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6">
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-5 sm:mb-6">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
            <ClipboardList className="w-4.5 h-4.5 text-indigo-600/70" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">Before You Proceed</h3>
        </div>
        <div className="space-y-3">
          {beforeItems.length > 0 ? (
            beforeItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <ChevronRight className="w-4 h-4 text-indigo-500/60 mt-0.5 shrink-0" />
                <span className="text-gray-700 text-sm min-w-0 break-words">{item}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400 italic">No items available</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-5 sm:mb-6">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4.5 h-4.5 text-emerald-600/70" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">Quick Balance</h3>
        </div>

        {upsideItems.length > 0 && (
          <div className="mb-5 sm:mb-6">
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600/70 shrink-0" />
              <span className="font-semibold text-slate-700 uppercase text-xs tracking-wide">
                Potential Upside
              </span>
            </div>
            <ul className="space-y-2 ml-7">
              {upsideItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-gray-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/60 mt-0.5 shrink-0" />
                  <span className="text-sm min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {concernItems.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <XCircle className="w-4.5 h-4.5 text-rose-600/70 shrink-0" />
              <span className="font-semibold text-slate-700 uppercase text-xs tracking-wide">
                Key Concerns
              </span>
            </div>
            <ul className="space-y-2 ml-7">
              {concernItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-gray-700">
                  <XCircle className="w-3.5 h-3.5 text-rose-500/60 mt-0.5 shrink-0" />
                  <span className="text-sm min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {upsideItems.length === 0 && concernItems.length === 0 && (
          <p className="text-sm text-gray-400 italic">No balance data available</p>
        )}
      </div>
    </div>
  );
}

// ── Phase 2 ─────────────────────────────────────────────────────────────────

// ── Property Snapshot ────────────────────────────────────────────────────────

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

  // Filter and format price items
  const priceData = priceItems
    .map((item) => ({
      label: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
    }))
    .filter((i) => i.value || i.description);

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
          <Home className="w-5 h-5 text-purple-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Property Snapshot</h2>
      </div>

      {/* Address */}
      {hasAddress && (
        <div className="mb-6 sm:mb-8">
          <div className="text-gray-500 uppercase text-xs tracking-wider mb-2">Address</div>
          <div className="text-xl sm:text-2xl font-semibold text-gray-900 min-w-0 break-words">{address}</div>
        </div>
      )}

      {/* Price Assessment (nested) */}
      {hasPriceData && (
        <div className="bg-slate-50 rounded-xl p-6 sm:p-8 border border-slate-200">
          <div className="flex items-center gap-3 mb-5 sm:mb-6">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5 text-emerald-600/70" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900">
              {renderValue(priceSection?.title ?? 'Price Assessment')}
            </h3>
          </div>

          {/* Estimated Value (large) */}
          {(() => {
            const estMin = priceData.find((i) => /min/i.test(i.label))?.value;
            const estMax = priceData.find((i) => /max/i.test(i.label))?.value;
            if (estMin || estMax) {
              const range = [estMin, estMax].filter(Boolean).join(' – ');
              return (
                <div className="mb-6 sm:mb-8">
                  <div className="text-gray-500 uppercase text-xs tracking-wider mb-2 sm:mb-3">
                    Estimated Value Range
                  </div>
                  <div className="text-3xl sm:text-4xl font-bold text-gray-900">{range}</div>
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
                <div className="mb-6 sm:mb-8">
                  <div className="text-gray-500 uppercase text-xs tracking-wider mb-2 sm:mb-3">
                    Asking Price
                  </div>
                  <div className="text-3xl sm:text-4xl font-bold text-gray-900">{asking}</div>
                </div>
              );
            }
            return null;
          })()}

          {/* Verdict + Confidence row */}
          {(() => {
            const verdict = priceData.find((i) => /verdict|assessment|fair|over|under/i.test(i.label))?.value;
            const confidence = priceData.find((i) => /confidence/i.test(i.label))?.value;
            if (!verdict && !confidence) return null;
            return (
              <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-200 flex-wrap">
                {verdict && (
                  <>
                    <div className="text-gray-600 uppercase text-sm tracking-wide">Verdict</div>
                    <div className="text-slate-700 font-semibold text-lg">{verdict}</div>
                  </>
                )}
                {confidence && (
                  <div className="text-gray-400">{confidence}</div>
                )}
              </div>
            );
          })()}

          {/* Analysis paragraph */}
          {(() => {
            const analysis = priceData.find((i) =>
              /analysis|explanation|summary|context/i.test(i.label)
            )?.description ?? priceData.find((i) =>
              /analysis|explanation|summary|context/i.test(i.label)
            )?.value;
            if (analysis) {
              return (
                <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-6">{analysis}</p>
              );
            }
            return null;
          })()}

          {/* Confidence box */}
          {(() => {
            const conf = priceData.find((i) => /confidence/i.test(i.label) && i.description);
            if (!conf) return null;
            return (
              <div className="bg-white border border-slate-300 rounded-lg p-4 sm:p-5">
                <div className="font-semibold text-gray-900 mb-2">
                  Price Confidence: {renderValue(conf.value ?? '')}
                </div>
                <p className="text-gray-700 text-sm leading-relaxed">{conf.description}</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Quick Facts grid */}
      {hasQuickFacts && (
        <div className="mt-6 sm:mt-8">
          {/* Quick Facts in a responsive grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {qfItems.map((item, i) => (
              <div
                key={i}
                className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-200 min-w-0"
              >
                <div className="text-gray-500 uppercase text-xs tracking-wider mb-1 truncate">
                  {item.label}
                </div>
                <div className="text-gray-900 font-semibold text-sm sm:text-base truncate min-w-0 break-words">
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

// ── Carrying Costs ────────────────────────────────────────────────────────────

function CarryingCostsSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const costSection = sections.find((s) =>
    /cost|carrying|holding|afford/i.test(s.id + s.title)
  );
  const items = costSection?.items ?? [];

  const costItems = items
    .map((item) => ({
      label: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
      badge: renderValue(item.badge),
    }))
    .filter((i) => i.value || i.description);

  const missingCosts = items
    .filter((i) => /missing|not.?disclosed|not.?available/i.test(renderValue(i.description ?? i.title)))
    .map((i) => renderValue(i.description ?? i.title))
    .filter(Boolean);

  const hasContent = costItems.length > 0 || missingCosts.length > 0;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
          <DollarSign className="w-5 h-5 text-violet-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          {renderValue(costSection?.title ?? 'Carrying Costs')}
        </h2>
      </div>

      {/* Not Enough Disclosed warning */}
      {!hasContent && (
        <div className="bg-slate-50 border border-slate-300 rounded-xl p-5 sm:p-6 mb-6">
          <div className="font-semibold text-slate-800 mb-2">Not Enough Disclosed</div>
          <p className="text-slate-700 text-sm">
            The listing does not provide enough cost data to estimate monthly ownership expenses.
          </p>
        </div>
      )}

      {/* Cost items */}
      {costItems.length > 0 && (
        <div className="divide-y divide-slate-100">
          {costItems.map((item, i) => (
            <div key={i} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                {item.description && (
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.value && (
                  <span className="text-sm font-semibold text-slate-900">{item.value}</span>
                )}
                {item.badge && <SeverityPill value={item.badge} />}
              </div>
            </div>
          ))}
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

  // Auto-classify items into groups
  const signals: typeof allItems = [];
  const risks: typeof allItems = [];
  const verify: typeof allItems = [];
  const general: typeof allItems = [];

  for (const item of allItems) {
    const text = (item.title + ' ' + item.value + ' ' + item.description).toLowerCase();
    const label = item.title.toLowerCase();

    if (
      /signal|positive|upside|strength|good|castle|best/i.test(text) ||
      /signal|positive|upside|strength|good/i.test(label)
    ) {
      signals.push(item);
    } else if (
      /risk|concern|negative|downside|weak|problem|bad/i.test(text) ||
      /risk|concern|negative|downside/i.test(label)
    ) {
      risks.push(item);
    } else if (
      /verify|check|inspect|confirm|ask|question|data.?gap|missing/i.test(text) ||
      /verify|check|inspect|confirm|ask|question/i.test(label)
    ) {
      verify.push(item);
    } else if (item.title || item.value || item.description) {
      general.push(item);
    }
  }

  const summary = renderValue(section.subtitle ?? section.items.find((i) =>
    /summary|overview|assessment/i.test(renderValue(i.title))
  )?.description ?? '');

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-5 h-5 text-teal-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          {renderValue(section.title)}
        </h2>
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-6">{summary}</p>
      )}

      {/* Supporting Signals */}
      {signals.length > 0 && (
        <div className="mb-6">
          <div className="font-semibold text-slate-700 mb-3 uppercase text-xs tracking-wide">
            Supporting Signals
          </div>
          <ul className="space-y-2">
            {signals.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <span className="text-sm min-w-0 break-words">
                  {item.value || item.description || item.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      {risks.length > 0 && (
        <div className="mb-6">
          <div className="font-semibold text-slate-700 mb-3 uppercase text-xs tracking-wide">
            Risks
          </div>
          <ul className="space-y-2">
            {risks.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <XCircle className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <span className="text-sm min-w-0 break-words">
                  {item.value || item.description || item.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Things to Verify */}
      {verify.length > 0 && (
        <div className="mb-6">
          <div className="font-semibold text-slate-700 mb-3 uppercase text-xs tracking-wide">
            Things to Verify
          </div>
          <ul className="space-y-2">
            {verify.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gray-700">
                <span className="text-slate-500 shrink-0 mt-0.5">•</span>
                <span className="text-sm min-w-0 break-words">
                  {item.value || item.description || item.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* General Notes (fallback for unclassified items) */}
      {general.length > 0 && (
        <div>
          {signals.length === 0 && risks.length === 0 && verify.length === 0 && (
            <div className="divide-y divide-slate-100">
              {general.map((item, i) => (
                <div key={i} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-700">{item.title}</span>
                    {item.description && (
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                    )}
                  </div>
                  {item.value && (
                    <span className="text-sm font-semibold text-slate-900 shrink-0">{item.value}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detailed Risk Analysis ───────────────────────────────────────────────────

function DetailedRiskAnalysisSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const riskSections = sections.filter((s) => {
    if (!isRiskSection(s)) return false;
    if (useIsSectionUsed(s.id)) return false; // already shown in Top Risks
    return true;
  });

  if (riskSections.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200">
      {/* Header */}
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
          const summary = items.find((i) =>
            /summary|overview|assessment|description/i.test(i.title)
          )?.description
            ?? items.find((i) =>
              /summary|overview|assessment|description/i.test(i.title)
            )?.value
            ?? items.find((i) => i.description && !i.value)?.description
            ?? '';

          const otherItems = items.filter(
            (i) => !/summary|overview|assessment|description/i.test(i.title)
          );

          return (
            <div key={s.id} className={idx < riskSections.length - 1 ? 'pb-6 sm:pb-8 border-b border-gray-200' : ''}>
              {/* Sub-card header */}
              <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconColorFor(s.id).replace('/70', '').replace('text', 'bg-')}/10`}>
                    <span className={iconColorFor(s.id)}>{iconFor(s.id, 'w-4.5 h-4.5')}</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
                    {renderValue(s.title)}
                  </h3>
                </div>
                {sev && <SeverityPill value={sev} />}
              </div>

              {/* Summary */}
              {summary && (
                <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-4">
                  {summary}
                </p>
              )}

              {/* Other items */}
              {otherItems.length > 0 && otherItems.some((i) => i.title || i.value) && (
                <div>
                  {(() => {
                    const grouped: Record<string, typeof otherItems> = {};
                    for (const item of otherItems) {
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

// ── Data Gaps ────────────────────────────────────────────────────────────────

function DataGapsSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const dataGapSections = sections.filter((s) =>
    /data.?gap|missing|verify|question|ask|inspection/i.test(s.id + s.title) &&
    !isRiskSection(s)
  );

  const gapItems: Array<{ title: string; description: string; badge: string }> = [];
  for (const s of dataGapSections) {
    for (const item of s.items) {
      const title = renderValue(item.title);
      const desc = renderValue(item.description);
      const badge = renderValue(item.badge);
      if (title || desc) {
        gapItems.push({ title, description: desc, badge });
      }
    }
  }

  if (gapItems.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-sky-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Data Gaps to Verify</h2>
      </div>

      <div className="space-y-5 sm:space-y-6">
        {gapItems.map((item, i) => (
          <div key={i}>
            <div className="font-semibold text-gray-900 mb-1">{item.title || 'Missing information'}</div>
            {item.description && (
              <p className="text-blue-700 text-sm mb-1 leading-relaxed">{item.description}</p>
            )}
            {item.badge && (
              <p className="text-sky-600/80 text-xs">Where to verify: {item.badge}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Neighborhood ────────────────────────────────────────────────────────────

function NeighborhoodSection({ report }: { report: NormalizedReport }) {
  const { sections } = report;

  const section = sections.find((s) =>
    /neighborhood|lifestyle|location|area|community/i.test(s.id + s.title)
  );

  if (!section) return null;

  const items = section.items
    .map((item) => ({
      title: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
    }))
    .filter((i) => i.title || i.value || i.description);

  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 border border-slate-200 mb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
        <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-pink-600/70" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          {renderValue(section.title)}
        </h2>
      </div>

      {section.subtitle && (
        <p className="text-gray-700 text-sm sm:text-base leading-relaxed mb-6">
          {renderValue(section.subtitle)}
        </p>
      )}

      {/* Place Signals */}
      {(() => {
        const signals = items.filter((i) =>
          /signal|positive|location|place/i.test(i.title + i.description)
        );
        if (signals.length === 0) return null;
        return (
          <div className="mb-6">
            <div className="font-semibold text-gray-900 mb-3">Place Signals</div>
            <ul className="space-y-2">
              {signals.map((item, i) => (
                <li key={i} className="text-gray-700 text-sm">
                  • {item.value || item.description || item.title}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Other items */}
      {(() => {
        const others = items.filter(
          (i) => !/signal|positive|location|place/i.test(i.title + i.description)
        );
        if (others.length === 0) return null;
        return (
          <div className="divide-y divide-slate-100">
            {others.map((item, i) => (
              <div key={i} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-700">{item.title}</span>
                  {item.description && (
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                  )}
                </div>
                {item.value && (
                  <span className="text-sm font-semibold text-slate-900 shrink-0">{item.value}</span>
                )}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ── Generic Section Card (Figma style) ──────────────────────────────────────

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
    <div className="bg-white rounded-2xl p-6 sm:p-8 md:p-10 mb-6 border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 sm:mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <span className="text-stone-500">{iconFor(section.id, 'w-5 h-5')}</span>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">{renderValue(section.title)}</h2>
          {section.subtitle && (
            <p className="text-xs text-stone-400 mt-0.5">{renderValue(section.subtitle)}</p>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-100">
        {items.map((item, i) => {
          const sevKey = (item.severity ?? item.badge ?? '').toLowerCase();
          const sevCfg = GENERIC_SEVERITY[sevKey];

          return (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-700">{item.title}</span>
                  {item.value && (
                    <span className="ml-2 text-sm font-semibold text-slate-900">{item.value}</span>
                  )}
                </div>
                {sevCfg ? (
                  <span className={`inline-flex items-center text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide ${sevCfg.bg} ${sevCfg.text}`}>
                    {item.badge ?? item.severity}
                  </span>
                ) : item.badge ? (
                  <SeverityPill value={item.badge} />
                ) : null}
              </div>
              {item.description && (
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">{item.description}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Remaining Sections ────────────────────────────────────────────────────────

// Sections consumed by Phase 2 dedicated components — do NOT render again
const PHASE2_USED_IDS = new Set([
  'property-snapshot',
  'questions-to-ask',
  'questions',
  'data-gaps',
  'before-you-proceed',
  // These are matched by pattern, not exact id:
  // carrying-costs, carrying_costs, holding-costs, affordability
  // investment-potential, investment_potential
  // neighborhood, neighborhood-lifestyle
  // data-gaps, data_gaps
  // risk sections are matched by isRiskSection()
]);

function matchesPhase2Section(section: ReportSection): boolean {
  const id = section.id.toLowerCase();
  const title = section.title.toLowerCase();
  const combined = id + ' ' + title;

  // Carrying Costs
  if (/cost|carrying|holding|afford/i.test(combined)) return true;
  // Investment Potential
  if (/investment/i.test(combined)) return true;
  // Neighborhood
  if (/neighborhood|lifestyle|location|area/i.test(combined)) return true;
  // Data Gaps
  if (/data.?gap|missing|inspection/i.test(combined)) return true;
  // Already handled
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

// ── Main Component ─────────────────────────────────────────────────────────────

interface NewReportUIProps {
  report: NormalizedReport;
}

export function NewReportUI({ report }: NewReportUIProps) {
  const { sections, highlights, quickFacts, hero } = report;

  const hasSections = sections && sections.length > 0;
  const hasHighlights =
    highlights.pros.length > 0 || highlights.cons.length > 0 || highlights.risks.length > 0;
  const hasQuickFacts = quickFacts && quickFacts.length > 0;
  const hasScore = hero.score !== null && hero.score !== undefined;
  const hasVerdict = renderValue(hero.verdict);

  if (!hasSections && !hasHighlights && !hasQuickFacts && !hasScore && !hasVerdict) {
    return <EmptyState />;
  }

  const [usedIds, setUsedIds] = React.useState<Set<string>>(new Set());
  const registerSections = React.useCallback((ids: string[]) => {
    setUsedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  console.log('[NEW_REPORT_UI_RENDER]', {
    market: report.meta.market,
    reportMode: report.meta.reportMode,
    sectionCount: report.sections.length,
    quickFactsCount: report.quickFacts.length,
    prosCount: report.highlights.pros.length,
    consCount: report.highlights.cons.length,
    risksCount: report.highlights.risks.length,
  });
  console.log('[NEW_REPORT_SECTION_IDS]', report.sections.map(s => s.id || s.title));

  return (
    <UsedSectionsCtx.Provider value={usedIds}>
    <RegisterSectionsCtx.Provider value={registerSections}>
    <div className="w-full max-w-[1056px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Phase 1 */}
      <HeroSection report={report} />
      <TopRisksSection report={report} />
      <BeforeProceedSection report={report} />

      {/* Phase 2 */}
      <PropertySnapshotSection report={report} />
      <CarryingCostsSection report={report} />
      <InvestmentPotentialSection report={report} />
      <DetailedRiskAnalysisSection report={report} />
      <DataGapsSection report={report} />
      <NeighborhoodSection report={report} />

      {/* Everything else */}
      <RemainingSections report={report} />
    </div>
    </RegisterSectionsCtx.Provider>
    </UsedSectionsCtx.Provider>
  );
}
