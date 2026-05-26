/**
 * NewReportUI — 统一报告展示组件
 *
 * 只接收 NormalizedReport，不直接读取任何 US/AU 专属字段。
 * 所有数据通过 adapter 转换后传入。
 */
import { Check, AlertTriangle, AlertCircle, Info, TrendingUp, DollarSign, Shield, Home, MessageSquare, Clock, Target, Zap, Eye, BarChart3 } from 'lucide-react';
import type { NormalizedReport, ReportSection, SectionItem, SectionTone } from '../lib/reportAdapters/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function str(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  return String(val);
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ── VerdictBadge ─────────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  'Worth Inspecting':  { bg: 'bg-green-500/10', text: 'text-green-700',   border: 'border-green-200' },
  'Proceed With Caution': { bg: 'bg-amber-500/10', text: 'text-amber-700', border: 'border-amber-200' },
  'Likely Overpriced / Risky': { bg: 'bg-red-500/10',   text: 'text-red-700',   border: 'border-red-200' },
  'Need More Evidence': { bg: 'bg-blue-500/10',  text: 'text-blue-700',  border: 'border-blue-200' },
  'Strong Apply':       { bg: 'bg-green-500/10', text: 'text-green-700', border: 'border-green-200' },
  'Apply With Caution': { bg: 'bg-amber-500/10', text: 'text-amber-700', border: 'border-amber-200' },
  'Not Recommended':   { bg: 'bg-red-500/10',   text: 'text-red-700',   border: 'border-red-200' },
  'YES':                { bg: 'bg-green-500/10', text: 'text-green-700', border: 'border-green-200' },
  'MAYBE':              { bg: 'bg-amber-500/10', text: 'text-amber-700', border: 'border-amber-200' },
  'NO':                 { bg: 'bg-red-500/10',   text: 'text-red-700',   border: 'border-red-200' },
  'PROCEED':            { bg: 'bg-green-500/10', text: 'text-green-700', border: 'border-green-200' },
  'PROCEED_WITH_CAUTION': { bg: 'bg-amber-500/10', text: 'text-amber-700', border: 'border-amber-200' },
  'SKIP':               { bg: 'bg-red-500/10',   text: 'text-red-700',   border: 'border-red-200' },
};

function VerdictBadge({ value }: { value: string }) {
  const cfg = VERDICT_CONFIG[value] ?? { bg: 'bg-stone-100', text: 'text-stone-600', border: 'border-stone-200' };
  return (
    <span className={cx(
      'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-xl border',
      cfg.bg, cfg.text, cfg.border
    )}>
      {value}
    </span>
  );
}

// ── SeverityBadge ───────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { bg: string; text: string }> = {
  low:      { bg: 'bg-green-100',  text: 'text-green-700'  },
  medium:   { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  high:     { bg: 'bg-red-100',    text: 'text-red-700'    },
  critical: { bg: 'bg-red-200',    text: 'text-red-800'    },
  LOW:      { bg: 'bg-green-100',  text: 'text-green-700'  },
  MEDIUM:   { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  HIGH:     { bg: 'bg-red-100',    text: 'text-red-700'    },
  CRITICAL: { bg: 'bg-red-200',    text: 'text-red-800'    },
  Strong:   { bg: 'bg-green-100',  text: 'text-green-700'  },
  Moderate: { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  Weak:     { bg: 'bg-red-100',    text: 'text-red-700'    },
  Unknown:  { bg: 'bg-stone-100',  text: 'text-stone-600'  },
};

function SeverityBadge({ value }: { value: string }) {
  const cfg = SEVERITY_CONFIG[value] ?? { bg: 'bg-stone-100', text: 'text-stone-600' };
  return (
    <span className={cx('inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md', cfg.bg, cfg.text)}>
      {value}
    </span>
  );
}

// ── ScoreRing ────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex items-center justify-center w-24 h-24 rounded-full bg-stone-100">
        <span className="text-stone-400 text-sm">—</span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, score));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const color =
    clamped >= 70 ? '#22c55e' :
    clamped >= 40 ? '#f59e0b' :
                   '#ef4444';

  return (
    <div className="relative w-24 h-24">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="#e7e5e4" strokeWidth="6" />
        <circle
          cx="48" cy="48" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-stone-900">{clamped}</span>
        <span className="text-xs text-stone-500">/100</span>
      </div>
    </div>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function ReportHero({ hero, market }: { hero: NormalizedReport['hero']; market: string }) {
  const score = hero.score;
  const verdict = hero.verdict || 'Not enough data';
  const summary = hero.summary;
  const confidence = hero.confidence;
  const address = hero.address;
  const title = hero.title;
  const primaryLabel = hero.primaryLabel;
  const secondaryLabel = hero.secondaryLabel;

  return (
    <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
      <div className="flex items-start gap-5">
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          {/* Market badge */}
          <div className="flex items-center gap-2 mb-2">
            {market !== 'UNKNOWN' && (
              <span className="text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-stone-100 text-stone-500">
                {market === 'US' ? '🇺🇸 United States' : market === 'AU' ? '🇦🇺 Australia' : market}
              </span>
            )}
            {confidence && (
              <span className="text-xs text-stone-400">Confidence: {confidence}</span>
            )}
          </div>

          {/* Title / address */}
          {title && (
            <h1 className="text-base font-semibold text-stone-900 mb-0.5 leading-snug">{title}</h1>
          )}
          {address && (
            <p className="text-sm text-stone-500 mb-2">{address}</p>
          )}

          {/* Verdict */}
          <div className="flex items-center gap-2 flex-wrap">
            <VerdictBadge value={verdict} />
            {primaryLabel && (
              <span className="text-sm text-stone-600">{primaryLabel}</span>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <p className="mt-4 text-sm text-stone-600 leading-relaxed border-t border-stone-100 pt-4">
          {summary}
        </p>
      )}

      {/* Secondary label */}
      {secondaryLabel && (
        <p className="mt-2 text-sm text-stone-500 italic">{secondaryLabel}</p>
      )}
    </div>
  );
}

// ── Quick Facts ──────────────────────────────────────────────────────────────

function QuickFactsGrid({ facts }: { facts: NormalizedReport['quickFacts'] }) {
  if (!facts || facts.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {facts.map((fact, i) => (
        <div key={i} className="bg-white rounded-xl p-3.5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-1">{fact.label}</p>
          <p className="text-sm font-semibold text-stone-900 truncate">{fact.value}</p>
          {fact.helper && (
            <p className="text-xs text-stone-400 mt-0.5">{fact.helper}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Highlights Panel ─────────────────────────────────────────────────────────

function HighlightsPanel({ highlights }: { highlights: NormalizedReport['highlights'] }) {
  const { pros = [], cons = [], risks = [] } = highlights;

  const hasAny = pros.length > 0 || cons.length > 0 || risks.length > 0;
  if (!hasAny) return null;

  function BulletList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
    if (items.length === 0) return <span className="text-sm text-stone-400 italic">{emptyLabel}</span>;
    return (
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
            <span className="shrink-0 mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Pros */}
      <div className="bg-green-50/70 rounded-xl p-4 border border-green-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
            <Check className="w-4 h-4 text-green-600" />
          </div>
          <h3 className="text-sm font-semibold text-green-800">Pros</h3>
        </div>
        <BulletList items={pros} emptyLabel="No pros listed" />
      </div>

      {/* Cons */}
      <div className="bg-amber-50/70 rounded-xl p-4 border border-amber-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
            <AlertCircle className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="text-sm font-semibold text-amber-800">Cons</h3>
        </div>
        <BulletList items={cons} emptyLabel="No cons listed" />
      </div>

      {/* Risks */}
      <div className="bg-red-50/70 rounded-xl p-4 border border-red-100">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <h3 className="text-sm font-semibold text-red-800">Risks</h3>
        </div>
        <BulletList items={risks} emptyLabel="No risks listed" />
      </div>
    </div>
  );
}

// ── Section Item ─────────────────────────────────────────────────────────────

const TONE_CONFIG: Record<SectionTone, { headerBg: string; headerText: string; border: string }> = {
  positive: { headerBg: 'bg-green-50',  headerText: 'text-green-800', border: 'border-green-100' },
  warning:  { headerBg: 'bg-amber-50', headerText: 'text-amber-800', border: 'border-amber-100' },
  danger:   { headerBg: 'bg-red-50',   headerText: 'text-red-800',   border: 'border-red-100' },
  neutral:  { headerBg: 'bg-stone-50', headerText: 'text-stone-800', border: 'border-stone-100' },
  info:     { headerBg: 'bg-blue-50',  headerText: 'text-blue-800',  border: 'border-blue-100' },
};

function SectionItemRow({ item }: { item: SectionItem }) {
  const badge = item.badge;
  const severity = item.severity;

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 py-2.5 border-b border-stone-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-stone-800">{item.title}</span>
          {item.value && (
            <span className="text-sm font-semibold text-stone-900">{item.value}</span>
          )}
          {badge && !severity && <SeverityBadge value={badge} />}
          {severity && (
            <span className={cx(
              'inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md',
              severity === 'high' || severity === 'critical' ? 'bg-red-100 text-red-700' :
              severity === 'medium' ? 'bg-amber-100 text-amber-700' :
              'bg-green-100 text-green-700'
            )}>
              {item.value ?? severity}
            </span>
          )}
        </div>
        {item.description && (
          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{item.description}</p>
        )}
      </div>
    </div>
  );
}

// ── Report Section ───────────────────────────────────────────────────────────

function iconForSection(id: string) {
  const iconMap: Record<string, React.ReactNode> = {
    'price-assessment':    <DollarSign className="w-4 h-4 text-stone-500" />,
    'carrying-costs':      <DollarSign className="w-4 h-4 text-stone-500" />,
    'investment-potential': <TrendingUp className="w-4 h-4 text-stone-500" />,
    'maintenance-risk':    <AlertTriangle className="w-4 h-4 text-stone-500" />,
    'legal-compliance':    <Shield className="w-4 h-4 text-stone-500" />,
    'environmental-risk':  <AlertTriangle className="w-4 h-4 text-stone-500" />,
    'deal-breakers':       <AlertCircle className="w-4 h-4 text-red-500" />,
    'red-flags':           <AlertTriangle className="w-4 h-4 text-red-500" />,
    'competition-risk':    <BarChart3 className="w-4 h-4 text-stone-500" />,
    'property-snapshot':   <Home className="w-4 h-4 text-stone-500" />,
    'space-analysis':      <Home className="w-4 h-4 text-stone-500" />,
    'neighborhood':        <Eye className="w-4 h-4 text-stone-500" />,
    'questions-to-ask':     <MessageSquare className="w-4 h-4 text-stone-500" />,
    'questions':            <MessageSquare className="w-4 h-4 text-stone-500" />,
    'holding-costs':       <DollarSign className="w-4 h-4 text-stone-500" />,
    'land-value':          <TrendingUp className="w-4 h-4 text-stone-500" />,
    'affordability':       <DollarSign className="w-4 h-4 text-stone-500" />,
    'rent-fairness':       <DollarSign className="w-4 h-4 text-stone-500" />,
    'application-strategy': <Zap className="w-4 h-4 text-stone-500" />,
    'agent-lingo':         <MessageSquare className="w-4 h-4 text-stone-500" />,
    'light-thermal':       <Info className="w-4 h-4 text-stone-500" />,
    'listing-reality-check': <MessageSquare className="w-4 h-4 text-stone-500" />,
    'data-gaps':           <Info className="w-4 h-4 text-stone-500" />,
    'layout-fit':          <Home className="w-4 h-4 text-stone-500" />,
    'property-strengths':  <Check className="w-4 h-4 text-green-600" />,
    'potential-issues':    <AlertCircle className="w-4 h-4 text-amber-600" />,
    'next-move':           <Target className="w-4 h-4 text-stone-500" />,
    'would-i-buy':         <Target className="w-4 h-4 text-stone-500" />,
    'state-advice':        <Info className="w-4 h-4 text-stone-500" />,
    'final-recommendation': <Target className="w-4 h-4 text-stone-500" />,
    'summary':             <Info className="w-4 h-4 text-stone-500" />,
  };
  return iconMap[id] ?? <BarChart3 className="w-4 h-4 text-stone-500" />;
}

function ReportSectionCard({ section, delay = 0 }: { section: ReportSection; delay?: number }) {
  if (!section.items || section.items.length === 0) return null;

  const toneCfg = TONE_CONFIG[section.tone ?? 'neutral'];

  return (
    <div
      className="bg-white rounded-2xl border shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Section header */}
      <div className={cx('px-5 pt-5 pb-3 border-b', toneCfg.headerBg, toneCfg.border)}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm border border-stone-100 shrink-0">
            {iconForSection(section.id)}
          </div>
          <div>
            <h3 className={cx('text-sm font-semibold', toneCfg.headerText)}>{section.title}</h3>
            {section.subtitle && (
              <p className="text-xs text-stone-500 mt-0.5">{section.subtitle}</p>
            )}
          </div>
        </div>
      </div>

      {/* Section items */}
      <div className="px-5 py-2">
        {section.items.map((item, i) => (
          <SectionItemRow key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

// ── Fallback Sections ────────────────────────────────────────────────────────

function FallbackSections({ highlights }: { highlights: NormalizedReport['highlights'] }) {
  const sections: ReportSection[] = [];

  // Summary from highlights
  if (highlights.pros.length || highlights.cons.length || highlights.risks.length) {
    const items: SectionItem[] = [
      ...highlights.pros.map((p) => ({ title: p, badge: 'Pro' as const })),
      ...highlights.cons.map((c) => ({ title: c, badge: 'Con' as const })),
      ...highlights.risks.map((r) => ({ title: r, badge: 'Risk' as const })),
    ];
    if (items.length > 0) {
      sections.push({ id: 'summary', title: 'Summary', items });
    }
  }

  if (highlights.pros.length > 0) {
    sections.push({
      id: 'pros',
      title: 'Pros',
      tone: 'positive',
      items: highlights.pros.map((p) => ({ title: p })),
    });
  }

  if (highlights.cons.length > 0) {
    sections.push({
      id: 'cons',
      title: 'Cons',
      tone: 'warning',
      items: highlights.cons.map((c) => ({ title: c })),
    });
  }

  if (highlights.risks.length > 0) {
    sections.push({
      id: 'risks',
      title: 'Risks',
      tone: 'danger',
      items: highlights.risks.map((r) => ({ title: r })),
    });
  }

  return (
    <>
      {sections.map((section, i) => (
        <ReportSectionCard key={section.id} section={section} delay={i * 60} />
      ))}
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

interface NewReportUIProps {
  report: NormalizedReport;
}

export function NewReportUI({ report }: NewReportUIProps) {
  const { meta, hero, highlights, quickFacts, sections } = report;
  const market = meta.market;

  // Empty state
  const hasSections = sections && sections.length > 0;
  const hasHighlights = highlights.pros.length > 0 || highlights.cons.length > 0 || highlights.risks.length > 0;
  const hasQuickFacts = quickFacts && quickFacts.length > 0;

  if (!hasSections && !hasHighlights && !hasQuickFacts && !hero.score && !hero.verdict) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4">
          <Info className="w-8 h-8 text-stone-400" />
        </div>
        <h2 className="text-lg font-semibold text-stone-700 mb-2">Not enough data</h2>
        <p className="text-sm text-stone-500 max-w-xs">
          This report doesn't have enough information to display a full analysis.
          Try upgrading to a deep analysis for more insights.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <ReportHero hero={hero} market={market} />

      {/* Quick Facts */}
      {hasQuickFacts && (
        <QuickFactsGrid facts={quickFacts} />
      )}

      {/* Highlights */}
      {hasHighlights && (
        <HighlightsPanel highlights={highlights} />
      )}

      {/* Dynamic Sections */}
      {hasSections ? (
        <div className="space-y-4">
          {sections.map((section, i) => (
            <ReportSectionCard key={section.id} section={section} delay={i * 60} />
          ))}
        </div>
      ) : (
        /* Fallback when no structured sections but has highlights */
        hasHighlights && (
          <div className="space-y-4">
            <FallbackSections highlights={highlights} />
          </div>
        )
      )}
    </div>
  );
}
