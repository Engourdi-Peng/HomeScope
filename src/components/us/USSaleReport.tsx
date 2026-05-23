import type { AnalysisResult } from '../../shared/types/analysis';
import { DollarSign, TrendingUp, AlertTriangle, AlertCircle, Check, MessageSquare, MessageCircle, Eye, SquareCheck } from 'lucide-react';

// ── Shared UI primitives ────────────────────────────────────────────────────
function SectionDivider() {
  return <div className="h-px bg-stone-200 my-12"></div>;
}

function RiskBadge({ level }: { level?: string }) {
  const config: Record<string, { cls: string; label: string }> = {
    Low: { cls: 'bg-green-50 text-green-700 border-green-200', label: 'LOW RISK' },
    Medium: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'MEDIUM RISK' },
    High: { cls: 'bg-red-50 text-red-700 border-red-200', label: 'HIGH RISK' },
    Unknown: { cls: 'bg-stone-50 text-stone-500 border-stone-200', label: 'UNKNOWN' },
  };
  const c = config[level || 'Unknown'] || config.Unknown;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${c.cls}`}>
      {c.label}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict?: string }) {
  const config: Record<string, { cls: string }> = {
    'Strong Buy': { cls: 'bg-green-500/20 text-green-300 border-green-500/50' },
    'Worth Considering': { cls: 'bg-blue-500/20 text-blue-300 border-blue-500/50' },
    'Probably Skip': { cls: 'bg-red-500/20 text-red-300 border-red-500/50' },
    'Deeply Concerning': { cls: 'bg-red-500/30 text-red-400 border-red-500/60' },
  };
  const c = config[verdict || ''] || { cls: 'bg-stone-100 text-stone-600 border-stone-300' };
  return (
    <span className={`text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-xl border-2 ${c.cls}`}>
      {verdict || 'Unknown'}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-start gap-4 py-1.5 border-b border-stone-100 last:border-0">
      <span className="text-xs font-medium text-stone-500 uppercase tracking-wide shrink-0">{label}</span>
      <span className="text-sm text-stone-800 text-right">{value}</span>
    </div>
  );
}

function BulletList({ items, maxItems = 999 }: { items?: string[]; maxItems?: number }) {
  const list = (items || []).slice(0, maxItems);
  if (list.length === 0) return <span className="text-sm text-stone-400 italic">No data</span>;
  return (
    <ul className="space-y-1.5">
      {list.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
          <span className="text-stone-400 mt-0.5 shrink-0">•</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function CardShell({
  icon,
  title,
  children,
  delay = 0,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  delay?: number;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-3xl p-6 @container[size>=480px]:p-10 shadow-[0_1px_8px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <h3 className="text-base font-semibold text-stone-900">{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ── Property Snapshot Card ────────────────────────────────────────────────────
function PropertySnapshotCard({ ps, region }: { ps?: AnalysisResult['property_snapshot']; region?: string }) {
  return (
    <CardShell icon={<span className="text-stone-600 text-sm font-bold">🏠</span>} title="Property Snapshot" delay={50}>
      <div className="grid grid-cols-2 @container[size>=560px]:grid-cols-3 gap-x-8 gap-y-1">
        <InfoRow label="Location" value={region || (ps as any)?.region || '—'} />
        <InfoRow label="Beds × Baths" value={ps ? `${ps.beds ?? '—'} × ${ps.baths ?? '—'}` : '—'} />
        <InfoRow label="Interior Area" value={ps?.sqft ? `${ps.sqft} sqft` : '—'} />
        <InfoRow label="Year Built" value={ps?.yearBuilt || '—'} />
        <InfoRow label="Home Type" value={ps?.homeType || '—'} />
        <InfoRow label="Roof" value={ps?.roof || '—'} />
        <InfoRow label="Lot Size" value={ps?.lotSize || '—'} />
        <InfoRow label="Tax Assessed" value={ps?.taxAssessedValue ? `$${Number(ps.taxAssessedValue).toLocaleString()}` : '—'} />
        <InfoRow label="Annual Tax" value={ps?.annualTax ? `$${Number(ps.annualTax).toLocaleString()}` : '—'} />
        <InfoRow label="HOA" value={ps?.hoa || '—'} />
        <InfoRow label="Price/Sqft" value={ps?.pricePerSqft ? `$${ps.pricePerSqft}` : '—'} />
      </div>
    </CardShell>
  );
}

// ── Price Assessment Card ────────────────────────────────────────────────────
function PriceAssessmentCard({ pa }: { pa?: AnalysisResult['price_assessment'] }) {
  const hasRange = pa?.estimated_min != null && pa?.estimated_max != null;
  return (
    <CardShell icon={<DollarSign size={18} className="text-stone-600" strokeWidth={1.5} />} title="Price Assessment" delay={100}>
      <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-6 mb-5">
        {hasRange ? (
          <div className="p-4 bg-stone-50 rounded-xl">
            <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Estimated Value Range</div>
            <div className="text-xl font-semibold text-stone-800">
              ${Number(pa!.estimated_min!).toLocaleString()} – ${Number(pa!.estimated_max!).toLocaleString()}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-stone-50 rounded-xl">
            <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Estimated Value Range</div>
            <div className="text-sm text-stone-500 italic">Cannot validate without comps or Zestimate</div>
          </div>
        )}
        <div className="p-4 bg-stone-50 rounded-xl">
          <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-2">Asking Price</div>
          <div className="text-xl font-semibold text-stone-800">
            {pa?.asking_price ? `$${Number(pa.asking_price).toLocaleString()}` : '—'}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Verdict</span>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${
          pa?.verdict === 'Underpriced' ? 'bg-green-50 text-green-700' :
          pa?.verdict === 'Overpriced' ? 'bg-red-50 text-red-700' :
          pa?.verdict === 'Fair' ? 'bg-blue-50 text-blue-700' :
          'bg-stone-50 text-stone-600'
        }`}>{pa?.verdict || '—'}</span>
        {pa?.valuation_confidence && (
          <span className="text-xs text-stone-400">Confidence: {pa.valuation_confidence}</span>
        )}
      </div>
      {pa?.explanation && <p className="text-sm text-stone-600 leading-relaxed">{pa.explanation}</p>}
      {pa?.tax_context && (
        <div className="mt-3 p-3 bg-amber-50 rounded-xl">
          <span className="text-xs font-medium text-amber-700">Tax Context: </span>
          <span className="text-xs text-amber-800">{pa.tax_context}</span>
        </div>
      )}
      {pa?.price_per_sqft_context && (
        <div className="mt-2 p-3 bg-stone-50 rounded-xl">
          <span className="text-xs font-medium text-stone-600">Price/Sqft: </span>
          <span className="text-xs text-stone-700">{pa.price_per_sqft_context}</span>
        </div>
      )}
      {pa?.missing_data && (pa.missing_data as string[]).length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Missing Data</div>
          <BulletList items={pa.missing_data as string[]} maxItems={4} />
        </div>
      )}
    </CardShell>
  );
}

// ── Carrying Costs Card ──────────────────────────────────────────────────────
function CarryingCostsCard({ cc }: { cc?: AnalysisResult['carrying_costs'] }) {
  return (
    <CardShell icon={<DollarSign size={18} className="text-amber-600" strokeWidth={1.5} />} title="Carrying Costs" delay={150}>
      <div className="grid grid-cols-2 @container[size>=480px]:grid-cols-3 gap-4 mb-5">
        <div className="p-4 bg-stone-50 rounded-xl text-center">
          <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">Annual Tax</div>
          <div className="text-lg font-semibold text-stone-800">
            {cc?.annual_tax != null ? `$${cc.annual_tax.toLocaleString()}` : '—'}
          </div>
        </div>
        <div className="p-4 bg-stone-50 rounded-xl text-center">
          <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">Monthly Tax</div>
          <div className="text-lg font-semibold text-stone-800">
            {cc?.monthly_tax_equivalent != null ? `$${cc.monthly_tax_equivalent.toLocaleString()}` : '—'}
          </div>
        </div>
        <div className="p-4 bg-stone-50 rounded-xl text-center">
          <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">HOA</div>
          <div className="text-lg font-semibold text-stone-800">{cc?.hoa || '—'}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Cost Pressure</span>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${
          cc?.cost_pressure === 'Low' ? 'bg-green-50 text-green-700' :
          cc?.cost_pressure === 'High' ? 'bg-red-50 text-red-700' :
          cc?.cost_pressure === 'Medium' ? 'bg-amber-50 text-amber-700' :
          'bg-stone-50 text-stone-600'
        }`}>{cc?.cost_pressure || '—'}</span>
      </div>
      {cc?.summary && <p className="text-sm text-stone-600 leading-relaxed mb-3">{cc.summary}</p>}
      {cc?.missing_costs && (cc.missing_costs as string[]).length > 0 && (
        <div>
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Missing Costs</div>
          <BulletList items={cc.missing_costs as string[]} maxItems={5} />
        </div>
      )}
    </CardShell>
  );
}

// ── Investment Potential Card ────────────────────────────────────────────────
function InvestmentPotentialCard({ ip }: { ip?: AnalysisResult['investment_potential'] }) {
  return (
    <CardShell
      icon={<TrendingUp size={18} className="text-blue-600" strokeWidth={1.5} />}
      title="Investment Potential"
      delay={200}
      badge={ip?.rating ? <RiskBadge level={ip.rating} /> : undefined}
    >
      {ip?.summary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{ip.summary}</p>}
      {ip?.supporting_signals && (ip.supporting_signals as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1.5">Supporting Signals</div>
          <BulletList items={ip.supporting_signals as string[]} maxItems={4} />
        </div>
      )}
      {ip?.risks && (ip.risks as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1.5">Risks</div>
          <BulletList items={ip.risks as string[]} maxItems={4} />
        </div>
      )}
      {ip?.things_to_verify && (ip.things_to_verify as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">Things to Verify</div>
          <BulletList items={ip.things_to_verify as string[]} maxItems={5} />
        </div>
      )}
      {ip?.estimated_monthly_rent != null && (
        <div className="mt-3 p-3 bg-blue-50 rounded-xl">
          <span className="text-xs font-medium text-blue-700">Est. Monthly Rent: </span>
          <span className="text-sm font-semibold text-blue-900">${ip.estimated_monthly_rent.toLocaleString()}/mo</span>
        </div>
      )}
      {(!ip?.supporting_signals && !ip?.risks && !ip?.things_to_verify) && (
        <span className="text-sm text-stone-400 italic">No investment data available</span>
      )}
    </CardShell>
  );
}

// ── Maintenance Risk Card ─────────────────────────────────────────────────────
function MaintenanceRiskCard({ mr }: { mr?: AnalysisResult['maintenance_risk'] }) {
  return (
    <CardShell
      icon={<AlertTriangle size={18} className="text-amber-600" strokeWidth={1.5} />}
      title="Maintenance Risk"
      delay={250}
      badge={mr?.rating ? <RiskBadge level={mr.rating} /> : undefined}
    >
      {mr?.summary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{mr.summary}</p>}
      {mr?.risk_factors && (mr.risk_factors as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">Risk Factors</div>
          <BulletList items={mr.risk_factors as string[]} maxItems={4} />
        </div>
      )}
      {mr?.inspection_priorities && (mr.inspection_priorities as string[]).length > 0 && (
        <div>
          <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">Inspection Priorities</div>
          <BulletList items={mr.inspection_priorities as string[]} maxItems={5} />
        </div>
      )}
    </CardShell>
  );
}

// ── Listing Language Reality Check Card ──────────────────────────────────────
function ListingLanguageCard({ llrc }: { llrc?: AnalysisResult['listing_language_reality_check'] }) {
  const items = (llrc || []) as Array<{ phrase?: string; what_it_may_mean?: string; what_to_verify?: string }>;
  if (items.length === 0) return null;
  return (
    <CardShell
      icon={<MessageSquare size={18} className="text-purple-600" strokeWidth={1.5} />}
      title="Listing Language Reality Check"
      delay={300}
    >
      <div className="space-y-4">
        {items.map((item, i) => (
          <div key={i} className="p-4 bg-purple-50 rounded-xl">
            <div className="text-xs font-semibold text-purple-800 mb-1">"{item.phrase || '—'}"</div>
            <div className="text-sm text-stone-700 mb-1.5">{item.what_it_may_mean || '—'}</div>
            {item.what_to_verify && (
              <div className="text-xs text-purple-600 italic">Verify: {item.what_to_verify}</div>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Legal Compliance Card ────────────────────────────────────────────────────
function LegalComplianceCard({ lc }: { lc?: AnalysisResult['legal_compliance'] }) {
  return (
    <CardShell
      icon={<AlertCircle size={18} className="text-red-600" strokeWidth={1.5} />}
      title="Legal & Compliance Risk"
      delay={350}
      badge={lc?.risk_level ? <RiskBadge level={lc.risk_level} /> : undefined}
    >
      {lc?.summary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{lc.summary}</p>}
      {lc?.items_to_verify && (lc.items_to_verify as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">Items to Verify</div>
          <BulletList items={lc.items_to_verify as string[]} maxItems={5} />
        </div>
      )}
      {lc?.external_sources_needed && (lc.external_sources_needed as string[]).length > 0 && (
        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">External Sources</div>
          <BulletList items={lc.external_sources_needed as string[]} maxItems={5} />
        </div>
      )}
    </CardShell>
  );
}

// ── Environmental Risk Card ───────────────────────────────────────────────────
function EnvironmentalRiskCard({ er }: { er?: AnalysisResult['environmental_risk'] }) {
  return (
    <CardShell
      icon={<AlertTriangle size={18} className="text-teal-600" strokeWidth={1.5} />}
      title="Environmental & Insurance Risk"
      delay={400}
      badge={er?.risk_level ? <RiskBadge level={er.risk_level} /> : undefined}
    >
      {er?.summary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{er.summary}</p>}
      {er?.items_to_check && (er.items_to_check as string[]).length > 0 && (
        <BulletList items={er.items_to_check as string[]} maxItems={4} />
      )}
    </CardShell>
  );
}

// ── Data Gaps Card ───────────────────────────────────────────────────────────
function DataGapsCard({ gaps }: { gaps?: AnalysisResult['data_gaps'] }) {
  const items = (gaps || []) as Array<{ missing_item?: string; why_it_matters?: string; suggested_source?: string }>;
  if (items.length === 0) return null;
  return (
    <CardShell
      icon={<AlertCircle size={18} className="text-stone-600" strokeWidth={1.5} />}
      title="Data Gaps"
      delay={420}
    >
      <div className="space-y-3">
        {items.slice(0, 5).map((gap, i) => (
          <div key={i} className="p-3 bg-stone-50 rounded-xl">
            <div className="text-sm font-semibold text-stone-700 mb-0.5">{gap.missing_item || '—'}</div>
            {gap.why_it_matters && <div className="text-xs text-stone-500 mb-1">{gap.why_it_matters}</div>}
            {gap.suggested_source && (
              <div className="text-xs text-blue-600">Source: {gap.suggested_source}</div>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Questions to Ask Card ────────────────────────────────────────────────────
function QuestionsToAskCard({ questions }: { questions?: string[] }) {
  const items = questions || [];
  return (
    <CardShell icon={<MessageCircle size={18} className="text-stone-600" strokeWidth={1.5} />} title="Questions to Ask" delay={440}>
      {items.length === 0 ? (
        <span className="text-sm text-stone-400 italic">No questions generated</span>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items.slice(0, 12).map((q, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
              <span className="text-stone-400 text-sm font-medium shrink-0">Q{i + 1}.</span>
              <span className="text-sm text-stone-700 leading-relaxed">{q}</span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

// ── Pros / Cons Card ──────────────────────────────────────────────────────────
function ProsConsCard({ pros, cons }: { pros?: string[]; cons?: string[] }) {
  return (
    <CardShell icon={<Check size={18} className="text-green-600" strokeWidth={1.5} />} title="Pros & Cons" delay={460}>
      <div className="grid grid-cols-1 @container[size>=560px]:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">Pros</div>
          <BulletList items={pros} maxItems={4} />
        </div>
        <div>
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-3">Cons</div>
          <BulletList items={cons} maxItems={5} />
        </div>
      </div>
    </CardShell>
  );
}

// ── Layout Fit Card ───────────────────────────────────────────────────────────
function LayoutFitCard({ lf }: { lf?: AnalysisResult['layout_fit'] }) {
  if (!lf) return null;
  return (
    <CardShell icon={<SquareCheck size={18} className="text-blue-600" strokeWidth={1.5} />} title="Layout Fit" delay={480}>
      {lf.summary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{lf.summary}</p>}
      {lf.best_for && (lf.best_for as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1.5">Best For</div>
          <BulletList items={lf.best_for as string[]} maxItems={4} />
        </div>
      )}
      {lf.not_ideal_for && (lf.not_ideal_for as string[]).length > 0 && (
        <div>
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1.5">Not Ideal For</div>
          <BulletList items={lf.not_ideal_for as string[]} maxItems={4} />
        </div>
      )}
    </CardShell>
  );
}

// ── Neighborhood Card ─────────────────────────────────────────────────────────
function NeighborhoodCard({ nl }: { nl?: AnalysisResult['neighborhood_lifestyle'] }) {
  if (!nl) return null;
  return (
    <CardShell icon={<Eye size={18} className="text-stone-600" strokeWidth={1.5} />} title="Neighborhood & Lifestyle" delay={500}>
      {nl.summary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{nl.summary}</p>}
      {nl.page_signals && (nl.page_signals as string[]).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">Page Signals</div>
          <BulletList items={nl.page_signals as string[]} maxItems={4} />
        </div>
      )}
      {nl.external_data_needed && (nl.external_data_needed as string[]).length > 0 && (
        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">External Data Needed</div>
          <BulletList items={nl.external_data_needed as string[]} maxItems={5} />
        </div>
      )}
    </CardShell>
  );
}

// ── Final Recommendation Card ────────────────────────────────────────────────
function RecommendationCard({ rec }: { rec?: { verdict?: string; reasoning?: string } }) {
  if (!rec) return null;
  return (
    <div
      className="bg-stone-900 text-white rounded-3xl p-6 @container[size>=480px]:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out"
      style={{ animationDelay: '600ms' }}
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-stone-800 flex items-center justify-center">
          <AlertTriangle size={18} className="text-amber-400" strokeWidth={1.5} />
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-stone-400 mb-0.5">Recommendation</div>
          <VerdictBadge verdict={rec.verdict} />
        </div>
      </div>
      {rec.reasoning && (
        <p className="text-base text-stone-200 leading-relaxed">{rec.reasoning}</p>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export function USSaleReport({ result }: { result: AnalysisResult }) {
  const pros = (result as any).pros as string[] | undefined;
  const cons = (result as any).cons as string[] | undefined;
  const questions = (result as any).questions_to_ask as string[] | undefined;
  const rec = (result as any).recommendation as { verdict?: string; reasoning?: string } | undefined;

  // Extract region from optionalDetails if available
  const optionalDetails = (result as any).optionalDetails as Record<string, unknown> | undefined;
  const region = optionalDetails?.region as string | undefined;

  return (
    <div className="space-y-4">
      <PropertySnapshotCard
        ps={(result as any).property_snapshot as AnalysisResult['property_snapshot']}
        region={region}
      />
      <PriceAssessmentCard pa={result.price_assessment} />
      <CarryingCostsCard cc={(result as any).carrying_costs} />
      <InvestmentPotentialCard ip={(result as any).investment_potential} />
      <MaintenanceRiskCard mr={(result as any).maintenance_risk} />
      <LayoutFitCard lf={(result as any).layout_fit} />
      <ListingLanguageCard llrc={(result as any).listing_language_reality_check} />
      <LegalComplianceCard lc={(result as any).legal_compliance} />
      <EnvironmentalRiskCard er={(result as any).environmental_risk} />
      <SectionDivider />
      <ProsConsCard pros={pros} cons={cons} />
      <QuestionsToAskCard questions={questions} />
      <DataGapsCard gaps={(result as any).data_gaps} />
      <NeighborhoodCard nl={(result as any).neighborhood_lifestyle} />
      <div className="mt-4">
        <RecommendationCard rec={rec} />
      </div>
    </div>
  );
}
