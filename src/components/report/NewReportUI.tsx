/**
 * NewReportUI — Figma-aligned unified report display
 *
 * ONLY reads NormalizedReport. Never touches raw fields directly.
 * All text output goes through safeText() / renderValue().
 * Flat Figma-style design.
 */
import {
  Check,
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
} from 'lucide-react';
import type { NormalizedReport, ReportSection, SectionItem } from '../lib/reportAdapters/types';

// ── Safe Text Utilities ────────────────────────────────────────────────────────

function safeText(value: unknown): string {
  if (value == null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return '';
  if (Array.isArray(value)) {
    return value
      .map((v) => safeText(v))
      .filter(Boolean)
      .join(', ');
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
    // Try common string fields
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

function isStringArray(arr: unknown): arr is string[] {
  if (!Array.isArray(arr)) return false;
  return arr.every((v) => typeof v === 'string');
}

function stringsOnly(arr: unknown[]): string[] {
  return arr.map(renderValue).filter(Boolean);
}

// ── Icon Map ──────────────────────────────────────────────────────────────────

function iconFor(id: string, className = 'w-4 h-4') {
  const map: Record<string, React.ReactNode> = {
    'price-assessment':     <DollarSign className={className} />,
    'carrying-costs':      <DollarSign className={className} />,
    'rent-fairness':       <DollarSign className={className} />,
    'investment-potential': <TrendingUp className={className} />,
    'maintenance-risk':    <AlertTriangle className={className} />,
    'legal-compliance':     <Shield className={className} />,
    'environmental-risk':   <AlertTriangle className={className} />,
    'deal-breakers':        <AlertCircle className={className} />,
    'red-flags':            <AlertTriangle className={className} />,
    'competition-risk':     <BarChart3 className={className} />,
    'property-snapshot':    <Home className={className} />,
    'space-analysis':      <Home className={className} />,
    'neighborhood':         <Eye className={className} />,
    'questions-to-ask':      <MessageSquare className={className} />,
    'questions':            <MessageSquare className={className} />,
    'data-gaps':            <Info className={className} />,
    'layout-fit':           <Home className={className} />,
    'property-strengths':   <Check className={className} />,
    'potential-issues':     <AlertCircle className={className} />,
    'next-move':            <Target className={className} />,
    'would-i-buy':          <Target className={className} />,
    'state-advice':        <Info className={className} />,
    'final-recommendation': <Target className={className} />,
    'agent-lingo':         <MessageSquare className={className} />,
    'light-thermal':        <Info className={className} />,
    'listing-reality-check':<MessageSquare className={className} />,
    'affordability':        <DollarSign className={className} />,
    'holding-costs':        <DollarSign className={className} />,
    'land-value':           <TrendingUp className={className} />,
    'application-strategy': <Zap className={className} />,
    'summary':              <Info className={className} />,
  };
  return map[id] ?? <BarChart3 className={className} />;
}

// ── Severity Badge ─────────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<string, { bg: string; text: string }> = {
  low:      { bg: 'bg-green-100', text: 'text-green-700' },
  medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
  high:     { bg: 'bg-red-100',  text: 'text-red-700' },
  critical: { bg: 'bg-red-200',  text: 'text-red-800' },
};

function SeverityBadge({ value }: { value: string }) {
  const key = value?.toLowerCase() ?? '';
  const cfg = SEVERITY_STYLE[key] ?? { bg: 'bg-stone-100', text: 'text-stone-600' };
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
      {value}
    </span>
  );
}

// ── Verdict Badge (with icon) ──────────────────────────────────────────────────

const VERDICT_STYLE: Record<string, { bg: string; text: string }> = {
  'Worth Inspecting':      { bg: 'bg-green-500/10', text: 'text-green-700' },
  'Proceed With Caution':  { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  'Likely Overpriced':     { bg: 'bg-red-500/10',   text: 'text-red-700' },
  'Need More Evidence':    { bg: 'bg-blue-500/10',  text: 'text-blue-700' },
  'Strong Apply':          { bg: 'bg-green-500/10', text: 'text-green-700' },
  'Apply With Caution':    { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  'Not Recommended':       { bg: 'bg-red-500/10',   text: 'text-red-700' },
};

function VerdictBadge({ value }: { value: string }) {
  const key = Object.keys(VERDICT_STYLE).find((k) => value.includes(k)) ?? '';
  const cfg = key ? VERDICT_STYLE[key] : { bg: 'bg-stone-100', text: 'text-stone-600' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border ${cfg.bg} ${cfg.text} border-stone-200`}>
      <AlertTriangle className="w-3 h-3" />
      {value}
    </span>
  );
}

// ── Score Number (large Figma-style) ───────────────────────────────────────────

function ScoreDisplay({ score }: { score: number | null }) {
  if (score === null) return <span className="text-7xl font-bold text-white">—</span>;
  const color = score >= 70 ? 'text-green-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';
  return (
    <span className={`text-7xl sm:text-8xl font-extrabold leading-none tracking-tight ${color}`}>
      {score}
    </span>
  );
}

// ── Hero: Final Verdict ────────────────────────────────────────────────────────

function HeroSection({ report }: { report: NormalizedReport }) {
  const { hero, highlights, sections } = report;

  const mainReasons: string[] = [];
  // risks first, then cons, capped at 3
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
  // fall back to risk sections
  if (mainReasons.length === 0) {
    const riskSections = sections.filter((s) =>
      /risk|danger|red.?flag|deal.?breaker|warning/i.test(s.id) ||
      /risk|danger|red.?flag|deal.?breaker/i.test(s.title)
    );
    for (const s of riskSections) {
      for (const item of s.items) {
        if (mainReasons.length >= 3) break;
        const t = renderValue(item.description ?? item.title);
        if (t) mainReasons.push(t);
      }
    }
  }

  const nextStep: string =
    sections.find((s) => /question|verify|data.?gap|next.?step|before/i.test(s.id))?.items[0]?.description
    ?? sections.find((s) => /question|verify|data.?gap|next.?step|before/i.test(s.id))?.items[0]?.title
    ?? sections.find((s) => /question|verify|data.?gap|next.?step|before/i.test(s.id))?.subtitle
    ?? (hero.summary ? 'Verify key risks, costs and inspection details before progressing.' : '');

  const confidence = renderValue(hero.confidence);
  const keyTakeaway = renderValue(hero.summary);
  const verdict = renderValue(hero.verdict);
  const score = hero.score;

  return (
    <div className="bg-stone-900 rounded-2xl p-6 sm:p-8 text-white mb-6">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-white" />
        </div>
        <span className="text-xs font-bold uppercase tracking-widest text-white/60">Final Verdict</span>
      </div>

      {/* Score + verdict */}
      <div className="flex items-end gap-4 mb-4">
        <ScoreDisplay score={score} />
        <div className="flex flex-col gap-1 pb-2">
          <span className="text-2xl text-white/50 font-medium">/100</span>
          <span className="text-xs text-white/40 uppercase tracking-wide">Decision Score</span>
        </div>
      </div>

      {/* Verdict badge */}
      {verdict && (
        <div className="mb-3">
          <VerdictBadge value={verdict} />
        </div>
      )}

      {/* Confidence */}
      {confidence && (
        <div className="flex items-center gap-2 mb-5 text-xs text-white/50">
          <div className="w-2 h-2 rounded-full bg-white/30" />
          <span>Report Confidence: {confidence}</span>
        </div>
      )}

      {/* Key Takeaway */}
      {keyTakeaway && (
        <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-3.5 h-3.5 text-white/40" />
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Key Takeaway</span>
          </div>
          <p className="text-sm text-white/80 leading-relaxed">{keyTakeaway}</p>
        </div>
      )}

      {/* Main Reasons */}
      {mainReasons.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-3.5 h-3.5 text-white/40" />
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Main Reasons</span>
          </div>
          <ul className="space-y-1.5">
            {mainReasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                <div className="w-1.5 h-1.5 rounded-sm bg-white/30 mt-1.5 shrink-0" />
                <span className="min-w-0 break-words">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next Step */}
      {nextStep && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <ChevronRight className="w-3.5 h-3.5 text-white/40" />
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wide">Next Step</span>
          </div>
          <p className="text-sm text-white/80">{renderValue(nextStep)}</p>
        </div>
      )}
    </div>
  );
}

// ── Top Risks ─────────────────────────────────────────────────────────────────

function isRiskSection(section: ReportSection): boolean {
  const id = section.id.toLowerCase();
  const title = section.title.toLowerCase();
  return /risk|danger|red.?flag|deal.?breaker|warning|legal|compliance|maintenance|environmental|flood|insurance/i.test(id + title);
}

function TopRisksSection({ report }: { report: NormalizedReport }) {
  const { sections, highlights } = report;

  // Collect risk items
  const riskItems: Array<{
    title: string;
    description: string;
    severity: string;
    action: string;
    icon: React.ReactNode;
  }> = [];

  for (const s of sections) {
    if (!isRiskSection(s)) continue;
    if (riskItems.length >= 3) break;

    const severity = s.items.find((i) => i.severity || i.badge)?.severity
      ?? s.items.find((i) => i.badge)?.badge
      ?? 'Medium';
    const descItem = s.items.find((i) => renderValue(i.description));
    const actionItem = s.items.find((i) => /action|verify|inspect|check|request/i.test(renderValue(i.description ?? i.title)));

    riskItems.push({
      title: renderValue(s.title),
      description: renderValue(descItem?.description ?? s.subtitle),
      severity: renderValue(severity),
      action: renderValue(actionItem?.description ?? actionItem?.title ?? 'Verify this before making a decision.'),
      icon: iconFor(s.id, 'w-5 h-5'),
    });
  }

  // Supplement from highlights.risks
  if (riskItems.length < 3) {
    for (const r of highlights.risks) {
      if (riskItems.length >= 3) break;
      const t = renderValue(r);
      if (!t) continue;
      riskItems.push({
        title: t,
        description: '',
        severity: 'Medium',
        action: 'Verify this before making a decision.',
        icon: <AlertTriangle className="w-5 h-5" />,
      });
    }
  }

  if (riskItems.length === 0) return null;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-stone-900 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-white" />
        </div>
        <h2 className="text-xl font-bold text-stone-900 tracking-tight">Top Risks</h2>
      </div>

      {/* Risk cards */}
      <div className="space-y-3">
        {riskItems
        .filter(risk => risk.title || risk.description)
        .map((risk, i) => {
          const sevClass = (risk.severity?.toLowerCase() ?? '') === 'high' || risk.severity?.toLowerCase() === 'critical'
            ? 'bg-red-50 border-red-100'
            : (risk.severity?.toLowerCase() ?? '') === 'medium'
            ? 'bg-amber-50 border-amber-100'
            : 'bg-stone-50 border-stone-100';
          return (
            <div key={i} className={`rounded-xl border p-4 ${sevClass}`}>
              <div className="flex items-start gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center shrink-0">
                  <span className="text-stone-500">{risk.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-stone-800">{risk.title}</h3>
                    <SeverityBadge value={risk.severity} />
                  </div>
                </div>
              </div>
              {risk.description && (
                <p className="text-xs text-stone-500 leading-relaxed mt-1">{risk.description}</p>
              )}
              {risk.action && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-stone-200/50">
                  <div className="w-7 h-7 rounded-lg bg-white border border-stone-200 flex items-center justify-center shrink-0">
                    <ChevronRight className="w-3.5 h-3.5 text-stone-500" />
                  </div>
                  <span className="text-xs font-medium text-stone-500">Action</span>
                  <span className="text-xs text-stone-600 min-w-0 break-words">{risk.action}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Before You Proceed + Quick Balance ────────────────────────────────────────

function BeforeProceedSection({ report }: { report: NormalizedReport }) {
  const { sections, highlights } = report;

  // Before You Proceed items
  const questions = sections.find((s) =>
    /question|verify|data.?gap|next.?step|before|ask/i.test(s.id)
  );
  const beforeItems: string[] = [];
  if (questions) {
    for (const item of questions.items) {
      const t = renderValue(item.description ?? item.title);
      if (t && !beforeItems.includes(t)) beforeItems.push(t);
    }
  }
  // Fallback from risks
  if (beforeItems.length === 0) {
    for (const r of highlights.risks) {
      const t = renderValue(r);
      if (t && !beforeItems.includes(t)) beforeItems.push(t);
    }
  }

  const upsideItems = highlights.pros.map(renderValue).filter(Boolean);
  const concernItems = [...highlights.cons, ...highlights.risks].map(renderValue).filter(Boolean);

  if (beforeItems.length === 0 && upsideItems.length === 0 && concernItems.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Before You Proceed */}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-stone-900 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-sm font-semibold text-stone-800">Before You Proceed</h3>
        </div>
        <ul className="space-y-2">
          {beforeItems.length > 0 ? beforeItems.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-stone-600">
              <Check className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          )) : (
            <li className="text-sm text-stone-400 italic">No items</li>
          )}
        </ul>
      </div>

      {/* Quick Balance */}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-stone-900 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-sm font-semibold text-stone-800">Quick Balance</h3>
        </div>

        {upsideItems.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-4 h-4 text-green-600" />
              <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Potential Upside</span>
            </div>
            <ul className="space-y-1.5">
              {upsideItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-stone-600">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {concernItems.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Key Concerns</span>
            </div>
            <ul className="space-y-1.5">
              {concernItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-stone-600">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Property Snapshot (from quickFacts) ───────────────────────────────────────

function PropertySnapshotSection({ report }: { report: NormalizedReport }) {
  const { quickFacts, sections } = report;

  // Property Snapshot from quickFacts
  const qfItems = quickFacts.map((f) => ({
    label: renderValue(f.label),
    value: renderValue(f.value),
    helper: renderValue(f.helper),
  })).filter((f) => f.value);

  // Also grab property-snapshot section if exists
  const snapSection = sections.find((s) => s.id === 'property-snapshot');
  const snapSectionItems = snapSection?.items.map((item) => ({
    label: renderValue(item.title),
    value: renderValue(item.value),
    description: renderValue(item.description),
  })).filter((i) => i.value || i.description) ?? [];

  const allItems = [...qfItems, ...snapSectionItems];
  if (allItems.length === 0) return null;

  return (
    <SectionCard
      section={{
        id: 'property-snapshot',
        title: 'Property Snapshot',
        items: allItems.map((i) => ({
          title: i.label,
          value: i.value,
          description: i.description,
        })),
      }}
    />
  );
}

// ── Generic Section Card ───────────────────────────────────────────────────────

function SectionCard({ section }: { section: ReportSection }) {
  if (!section.items || section.items.length === 0) return null;

  const items = section.items
    .map((item) => ({
      ...item,
      title: renderValue(item.title),
      value: renderValue(item.value),
      description: renderValue(item.description),
    }))
    // Skip items that have no useful content
    .filter((item) => {
      const hasContent = item.value || item.description;
      return item.title || hasContent;
    });

  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-stone-200 mb-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-100">
        <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <span className="text-stone-500">{iconFor(section.id)}</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-stone-800">{renderValue(section.title)}</h3>
          {section.subtitle && (
            <p className="text-xs text-stone-400 mt-0.5">{renderValue(section.subtitle)}</p>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="px-5 py-3 divide-y divide-stone-50">
        {items.map((item, i) => (
          <div key={i} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-stone-700">{item.title}</span>
                {item.value && (
                  <span className="ml-2 text-sm font-semibold text-stone-900">{item.value}</span>
                )}
              </div>
              {item.badge && (
                <SeverityBadge value={renderValue(item.badge)} />
              )}
              {item.severity && !item.badge && (
                <SeverityBadge value={item.severity} />
              )}
            </div>
            {item.description && (
              <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">{item.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Remaining Sections (grouped by category) ───────────────────────────────────

function remainingSectionIds(): string[] {
  return [
    'property-snapshot',
    'questions-to-ask',
    'questions',
    'data-gaps',
    'before-you-proceed',
  ];
}

function RemainingSections({ report }: { report: NormalizedReport }) {
  const { sections } = report;
  const skip = remainingSectionIds();
  const remaining = sections.filter((s) => !skip.includes(s.id) && !isRiskSection(s));

  if (remaining.length === 0) return null;

  return (
    <div>
      {remaining.map((section) => (
        <SectionCard key={section.id} section={section} />
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
        Try upgrading to a deep analysis for more insights.
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
  const hasHighlights = highlights.pros.length > 0 || highlights.cons.length > 0 || highlights.risks.length > 0;
  const hasQuickFacts = quickFacts && quickFacts.length > 0;
  const hasScore = hero.score !== null && hero.score !== undefined;
  const hasVerdict = renderValue(hero.verdict);

  if (!hasSections && !hasHighlights && !hasQuickFacts && !hasScore && !hasVerdict) {
    return <EmptyState />;
  }

  return (
    <div className="w-full max-w-[1056px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Hero — always first */}
      <HeroSection report={report} />

      {/* Top Risks — second */}
      <TopRisksSection report={report} />

      {/* Before You Proceed + Quick Balance */}
      <BeforeProceedSection report={report} />

      {/* Property Snapshot from quickFacts */}
      <PropertySnapshotSection report={report} />

      {/* Remaining dynamic sections */}
      <RemainingSections report={report} />
    </div>
  );
}
