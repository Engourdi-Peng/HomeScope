import type { AnalysisResult } from '../../shared/types/analysis';
import { DollarSign, TrendingUp, AlertTriangle, AlertCircle, Check, MessageSquare, MessageCircle, Eye, SquareCheck } from 'lucide-react';
import { AnimatedNumber } from '../AnimatedNumber';
import { RiskBadge } from './RiskBadge';
import { ActionChecklist, buildChecklistItems } from './ActionChecklist';
import { QuickBalance, buildQuickBalanceData } from './QuickBalance';
import { PhotoSpaceAnalysisCard } from '../report/PhotoSpaceAnalysisCard';

// ── Shared UI primitives ────────────────────────────────────────────────────
function SectionDivider() {
  return <div className="h-px bg-stone-200 my-8"></div>;
}

function VerdictBadge({ verdict }: { verdict?: string }) {
  const config: Record<string, { cls: string }> = {
    'Strong Buy': { cls: 'bg-green-500/20 text-green-300 border-green-500/50' },
    'Worth Considering': { cls: 'bg-amber-500/20 text-amber-300 border-amber-500/50' },
    'Probably Skip': { cls: 'bg-red-500/20 text-red-300 border-red-500/50' },
    'Deeply Concerning': { cls: 'bg-red-500/30 text-red-400 border-red-500/60' },
  };
  const c = config[verdict || ''] || { cls: 'bg-stone-100 text-stone-600 border-stone-300' };
  return (
    <span className={`text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-xl border-2 ${c.cls}`}>
      {verdict || 'Needs Verification'}
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

function BulletList({ items, maxItems = 999, emptyLabel }: { items?: string[]; maxItems?: number; emptyLabel?: string }) {
  const list = (items || []).slice(0, maxItems);
  if (list.length === 0) return <span className="text-sm text-stone-400 italic">{emptyLabel || 'Not disclosed in listing'}</span>;
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
      className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ── Property Snapshot helpers ─────────────────────────────────────────────────
function buildSnapshotData(result: AnalysisResult) {
  const ps = result.property_snapshot || {};
  const listing = result.listingInfo;
  const opt = (result as any).optionalDetails || {};

  // 从多个来源 fallback 获取字段
  const beds = ps.beds ?? listing?.bedrooms ?? (result as any).bedrooms ?? opt.bedrooms ?? null;
  const baths = ps.baths ?? listing?.bathrooms ?? (result as any).bathrooms ?? opt.bathrooms ?? null;
  const yearBuilt = ps.yearBuilt ?? (result as any).year_built ?? (result as any).yearBuilt ?? opt.yearBuilt ?? null;
  const sqft = ps.sqft ?? (result as any).sqft ?? (result as any).sqftTotal ?? opt.sqft ?? null;
  const askingPrice = (result as any).askingPrice ?? (result as any).price ?? listing?.priceAmount ?? opt.price ?? null;
  const homeType = ps.homeType ?? listing?.propertyType ?? (result as any).homeType ?? (result as any).propertyType ?? opt.propertyType ?? null;
  const region = ps.region ?? listing?.address ?? (result as any).address ?? (result as any).location ?? opt.region ?? null;

  return { beds, baths, yearBuilt, sqft, askingPrice, homeType, region, ps };
}

// ── Property Snapshot Card ────────────────────────────────────────────────────
function PropertySnapshotCard({ result }: { result: AnalysisResult }) {
  const { beds, baths, yearBuilt, sqft, askingPrice, homeType, region } = buildSnapshotData(result);

  // 只收集有值的核心字段（不显示缺失信息）
  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  if (region) rows.push({ label: 'Address', value: region });
  // Beds×Baths 只在两者都有值时才显示
  if (beds != null && baths != null) {
    rows.push({ label: 'Beds / Baths', value: `${beds} / ${baths}` });
  } else if (beds != null) {
    rows.push({ label: 'Bedrooms', value: beds });
  } else if (baths != null) {
    rows.push({ label: 'Bathrooms', value: baths });
  }
  if (yearBuilt) rows.push({ label: 'Year Built', value: yearBuilt });
  if (sqft) rows.push({ label: 'Interior', value: `${sqft} sqft` });
  if (askingPrice) rows.push({ label: 'Asking Price', value: `$${Number(askingPrice).toLocaleString()}` });

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '50ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center">
          <span className="text-stone-600 text-sm">🏠</span>
        </div>
        <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wide">Property Snapshot</h3>
      </div>
      <div className="grid grid-cols-2 @container[size>=480px]:grid-cols-3 gap-x-4 gap-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col">
            <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wider mb-0.5">{row.label}</span>
            <span className="text-sm font-medium text-stone-900">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Price Assessment Card ────────────────────────────────────────────────────
function PriceAssessmentCard({ pa, zestimate }: { pa?: AnalysisResult['price_assessment']; zestimate?: number }) {
  const hasRange = pa?.estimated_min != null && pa?.estimated_max != null;
  const isLowConfidence = pa?.valuation_confidence === 'Low' || pa?.valuation_confidence === 'Unknown';

  // Direction: asking vs zestimate or estimated range
  let directionLabel = '';
  let directionClass = '';
  const askingNum = Number(pa?.asking_price);
  const zNum = Number(zestimate);
  if (!isNaN(askingNum) && !isNaN(zNum) && zNum > 0) {
    const diff = askingNum - zNum;
    const diffAbs = Math.abs(diff);
    if (diff > 0) {
      directionLabel = `$${(diffAbs / 1000).toFixed(1)}k above Zestimate`;
      directionClass = 'text-amber-700';
    } else if (diff < 0) {
      directionLabel = `$${(diffAbs / 1000).toFixed(1)}k below Zestimate`;
      directionClass = 'text-green-700';
    } else {
      directionLabel = 'In line with Zestimate';
      directionClass = 'text-blue-700';
    }
  } else if (!isNaN(askingNum) && hasRange) {
    const rangeMin = Number(pa!.estimated_min!);
    const rangeMax = Number(pa!.estimated_max!);
    if (askingNum > rangeMax) {
      directionLabel = `$${((askingNum - rangeMax) / 1000).toFixed(1)}k above range`;
      directionClass = 'text-amber-700';
    } else if (askingNum < rangeMin) {
      directionLabel = `$${((rangeMin - askingNum) / 1000).toFixed(1)}k below range`;
      directionClass = 'text-green-700';
    }
  }

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
            {pa?.asking_price ? `$${Number(pa.asking_price).toLocaleString()}` : 'Not disclosed'}
          </div>
          {directionLabel && (
            <div className={`text-xs font-medium mt-1 ${directionClass}`}>{directionLabel}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Verdict</span>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${
          pa?.verdict === 'Underpriced' ? 'bg-green-50 text-green-700' :
          pa?.verdict === 'Overpriced' ? 'bg-red-50 text-red-700' :
          pa?.verdict === 'Fair' ? 'bg-amber-50 text-amber-700' :
          'bg-stone-50 text-stone-600'
        }`}>{pa?.verdict || 'Needs Verification'}</span>
      </div>
      {pa?.explanation && <p className="text-sm text-stone-600 leading-relaxed">{pa.explanation}</p>}
      {isLowConfidence && (
        <div className="mt-3 text-xs text-stone-500">
          Confidence: Limited — price still depends on condition, legal use and comparable sales.
        </div>
      )}
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
      {pa?.valuation_confidence && pa.valuation_confidence !== 'Unknown' && (
        <div className={`mt-3 p-3 rounded-xl ${isLowConfidence ? 'bg-amber-50' : 'bg-stone-50'}`}>
          <div className="text-xs font-medium text-stone-600 mb-1">Price Confidence: {pa.valuation_confidence}</div>
          {isLowConfidence && (
            <p className="text-xs text-stone-500">
              The asking price sits within the estimated range, but confidence is low because comparable sales, interior condition, tax records, and legal occupancy status are not verified.
            </p>
          )}
        </div>
      )}
    </CardShell>
  );
}

// ── Carrying Costs Card ──────────────────────────────────────────────────────
function CarryingCostsCard({ cc }: { cc?: AnalysisResult['carrying_costs'] }) {
  const hasTaxData = cc?.annual_tax != null || cc?.monthly_tax_equivalent != null;
  // 只有明确的 HOA 费用金额才触发，'Yes' 或 'Unknown' 字符串不触发
  const hasHoa = typeof cc?.hoa === 'string' && cc.hoa !== 'Yes' && cc.hoa !== 'Unknown' && cc.hoa.length > 0;

  // Broader signal check — includes zillowFinancials-derived fields (monthly_breakdown)
  // Uses value != null checks, NOT !value — because $0 is a valid value
  const hasAnyCostSignal =
    hasTaxData ||
    hasHoa ||
    cc?.primary_monthly_estimate != null ||
    cc?.monthly_breakdown?.estimatedMonthlyPayment?.value != null ||
    cc?.monthly_breakdown?.principalAndInterest?.value != null ||
    cc?.monthly_breakdown?.propertyTaxes?.value != null ||
    cc?.monthly_breakdown?.homeInsurance?.value != null ||
    cc?.monthly_breakdown?.hoaFees?.value != null;

  // 数据不足时，切换到 "Not enough disclosed" 模式
  if (!hasAnyCostSignal) {
    return (
      <CardShell icon={<DollarSign size={18} className="text-amber-600" strokeWidth={1.5} />} title="Carrying Costs" delay={150}>
        <div className="bg-amber-50 rounded-xl p-4 mb-4">
          <div className="text-xs font-semibold text-amber-800 mb-2">Not Enough Disclosed</div>
          <p className="text-sm text-amber-700 mb-3">
            The listing does not provide enough cost data to estimate monthly ownership pressure.
          </p>
        </div>
        
        {/* Why it matters */}
        <div className="p-3 bg-stone-50 rounded-xl mb-4">
          <div className="text-xs font-medium text-stone-600 mb-1">Why it matters</div>
          <p className="text-xs text-stone-500">
            Without these numbers, the monthly cost could be materially higher than the purchase price suggests.
          </p>
        </div>
        
        {/* Missing cost items checklist */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">Missing cost items</div>
          {[
            'Annual property tax',
            'HOA or common charges',
            "Homeowner's insurance",
            'Utilities estimate',
            'Maintenance reserve',
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-stone-600">
              <span className="text-amber-500 mt-0.5 shrink-0">•</span>
              {item}
            </div>
          ))}
        </div>
        
        {/* Where to check */}
        <div className="mt-4 pt-3 border-t border-amber-100">
          <div className="text-xs font-medium text-blue-600">Where to verify</div>
          <p className="text-xs text-stone-500 mt-1">
            NYC Department of Finance property tax lookup, listing agent, or local insurance quotes.
          </p>
        </div>
      </CardShell>
    );
  }

  // 有足够数据时，只显示有值的卡片
  const costItems: Array<{ label: string; value: string }> = [];
  if (cc?.primary_monthly_estimate != null) {
    costItems.push({ label: 'Est. Monthly', value: `$${cc.primary_monthly_estimate.toLocaleString()}` });
  }
  if (cc?.annual_tax != null) costItems.push({ label: 'Annual Tax', value: `$${cc.annual_tax.toLocaleString()}` });
  if (cc?.monthly_tax_equivalent != null) costItems.push({ label: 'Monthly Tax', value: `$${cc.monthly_tax_equivalent.toLocaleString()}` });
  if (cc?.hoa && cc.hoa !== 'Yes') costItems.push({ label: 'HOA', value: cc.hoa });

  // Monthly breakdown from Zillow financials
  const breakdown = cc?.monthly_breakdown;

  return (
    <CardShell icon={<DollarSign size={18} className="text-amber-600" strokeWidth={1.5} />} title="Carrying Costs" delay={150}>
      {costItems.length > 0 && (
        <div className={`grid gap-4 mb-5 ${costItems.length >= 3 ? 'grid-cols-3' : costItems.length >= 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'}`}>
          {costItems.map((item, i) => (
            <div key={i} className="p-4 bg-stone-50 rounded-xl text-center">
              <div className="text-[10px] font-medium uppercase tracking-widest text-stone-500 mb-1">{item.label}</div>
              <div className="text-lg font-semibold text-stone-800">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly payment breakdown from Zillow financials */}
      {breakdown && (
        <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-2">
          <div className="text-xs font-semibold text-slate-700 mb-2">Monthly Payment Breakdown</div>
          {breakdown.estimatedMonthlyPayment?.value != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Estimated Monthly</span>
              <span className="font-semibold text-slate-800">${breakdown.estimatedMonthlyPayment.value.toLocaleString()}/mo</span>
            </div>
          )}
          {breakdown.principalAndInterest?.value != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Principal & Interest</span>
              <span className="font-semibold text-slate-800">${breakdown.principalAndInterest.value.toLocaleString()}/mo</span>
            </div>
          )}
          {breakdown.mortgageInsurance?.value != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Mortgage Insurance</span>
              <span className="font-semibold text-slate-800">${breakdown.mortgageInsurance.value.toLocaleString()}/mo</span>
            </div>
          )}
          {breakdown.propertyTaxes?.value != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Property Taxes</span>
              <span className="font-semibold text-slate-800">${breakdown.propertyTaxes.value.toLocaleString()}/mo</span>
            </div>
          )}
          {breakdown.homeInsurance?.value != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Home Insurance</span>
              <span className="font-semibold text-slate-800">${breakdown.homeInsurance.value.toLocaleString()}/mo</span>
            </div>
          )}
          {breakdown.hoaFees?.value != null ? (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">HOA Fees</span>
              <span className="font-semibold text-slate-800">${breakdown.hoaFees.value.toLocaleString()}/mo</span>
            </div>
          ) : (
            breakdown.hoaFees?.status === 'not_applicable' && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">HOA Fees</span>
                <span className="text-slate-400">N/A</span>
              </div>
            )
          )}
          {breakdown.utilities?.status === 'not_included' && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Utilities</span>
              <span className="text-slate-400">Not included</span>
            </div>
          )}

          {/* Not included reminder */}
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="text-xs font-medium text-stone-500 mb-2">Not included in Zillow estimate</div>
            <div className="grid grid-cols-2 gap-1">
              {[
                'Utilities',
                'Maintenance reserve',
                'Repairs & CapEx',
                'Vacancy allowance',
                'Actual insurance quote',
                'Legal / rental compliance',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-stone-400">
                  <span className="shrink-0 text-stone-300">–</span>{item}
                </div>
              ))}
            </div>
          </div>

          {/* Zillow disclaimer */}
          <div className="mt-2 text-xs text-stone-400 italic">
            Zillow estimate only — verify loan terms, insurance, taxes and utilities before budgeting.
          </div>
        </div>
      )}

      {/* Tax note from Zillow financials (discrepancy between annual-derived and monthly payment tax) */}
      {cc?.tax_note && (
        <div className="text-xs text-slate-500 italic mb-3">{cc.tax_note}</div>
      )}

      {cc?.cost_pressure && cc.cost_pressure !== 'Unknown' && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Cost Pressure</span>
          <span className={`text-sm font-bold px-2 py-0.5 rounded ${
            cc.cost_pressure === 'Low' ? 'bg-green-50 text-green-700' :
            cc.cost_pressure === 'High' ? 'bg-red-50 text-red-700' :
            'bg-amber-50 text-amber-700'
          }`}>{cc.cost_pressure}</span>
        </div>
      )}
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
  // 调整 summary 使其更保守
  const adjustedSummary = ip?.summary?.replace(
    /Brooklyn location has strong rental demand/,
    'Brooklyn location may support rental demand, but realistic rent needs external verification.'
  );

  return (
    <CardShell
      icon={<TrendingUp size={18} className="text-blue-600" strokeWidth={1.5} />}
      title="Investment Potential"
      delay={200}
      badge={ip?.rating ? <RiskBadge level={ip.rating} /> : undefined}
    >
      {adjustedSummary && <p className="text-sm text-stone-700 leading-relaxed mb-4">{adjustedSummary}</p>}
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
            <div className="text-xs font-semibold text-purple-800 mb-1">"{item.phrase || 'Not disclosed'}"</div>
            <div className="text-sm text-stone-700 mb-1.5">{item.what_it_may_mean || 'Not disclosed'}</div>
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
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Where to verify</div>
          <BulletList items={lc.external_sources_needed as string[]} maxItems={5} />
        </div>
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
      title="Data Gaps to Verify"
      delay={420}
    >
      <div className="space-y-3">
        {items.slice(0, 5).map((gap, i) => (
          <div key={i} className="p-3 bg-stone-50 rounded-xl">
            <div className="text-sm font-semibold text-stone-700 mb-0.5">{gap.missing_item || 'Not disclosed'}</div>
            {gap.why_it_matters && <div className="text-xs text-stone-500 mb-1">{gap.why_it_matters}</div>}
            {gap.suggested_source && (
              <div className="text-xs text-blue-600">
                Where to verify: {gap.suggested_source}
              </div>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Questions to Ask Card ────────────────────────────────────────────────────
function QuestionsToAskCard({ result }: { result: AnalysisResult }) {
  // 预定义的高质量问题列表（最多 8 个）
  const defaultQuestions = [
    'Can you provide the Certificate of Occupancy?',
    'Is the property legally registered as a single-family, two-family, or multi-family home?',
    'Are there any open DOB, HPD, or permit violations?',
    'What is the annual property tax and assessed value?',
    'How old are the roof, boiler, electrical panel, plumbing, and heating system?',
    'Can you provide recent interior photos or inspection records?',
    'Has there been any water intrusion, flooding, or drainage issue?',
    'What are realistic market rents if part of the home is rented out?',
  ];

  // 已知字段（用于过滤冗余问题）
  const snap = (result as any)?.property_snapshot ?? {};
  const hasBeds = !!(snap?.beds || snap?.bedrooms);
  const hasBaths = !!(snap?.baths || snap?.bathrooms);
  const hasSqft = !!snap?.sqft;
  const hasPropertyType = !!(snap?.homeType || snap?.propertyType || snap?.home_type || snap?.property_type);
  const hasBasicFields = hasBeds || hasBaths || hasSqft || hasPropertyType;

  const BASIC_FIELD_PATTERNS = [
    /missing basic property details/i,
    /property type[, ]*beds[, ]*baths[, ]*and interior size/i,
    /provide basic property details/i,
    /provide\s+(beds|baths|sqft|square\s*footage|interior\s*size|property\s*type)/i,
    /missing\s+(beds|baths|interior\s*size|property\s*type)/i,
    /can you provide (the )?(beds?|baths?|sqft|square\s*footage|square\s*feet|interior\s*size|property\s*type|home\s*type)/i,
    /how many (beds?|baths?)\b/i,
    /\bbeds?\b.*\?\s*$/i,
    /\bbaths?\b.*\?\s*$/i,
    /(beds?|baths?|sqft|square\s*footage)\s+are\s+(listed|confirmed|disclosed|available)/i,
    /can you (tell me|confirm|give me) (the )?(beds?|baths?|sqft|square\s*footage|property\s*type|home\s*type)/i,
    /what('s| is) the (beds?|baths?|sqft|square\s*footage|property\s*type|home\s*type)/i,
  ];

  const rawQuestions = (result as any).questions_to_ask as string[] | undefined;

  let questions: string[] = [];

  if (rawQuestions && rawQuestions.length > 0) {
    // 从原始问题中过滤和去重
    questions = rawQuestions
      .slice(0, 15)
      .filter(q => q && q.length > 10 && !q.endsWith(':')) // 过滤太短的和标题式问题
      .map(q => q.trim())
      .filter(q => {
        // 过滤标题式问题（以冒号结尾或全大写开头）
        if (q.endsWith(':')) return false;
        if (/^[A-Z\s]+$/.test(q.split(' ')[0] || '')) return false;
        return true;
      })
      .filter((q, i, arr) => {
        // 去重（相似问题只保留一个）
        const normalized = q.toLowerCase().replace(/[^\w]/g, '').slice(0, 25);
        return arr.findIndex(x => 
          x.toLowerCase().replace(/[^\w]/g, '').slice(0, 25) === normalized
        ) === i;
      })
      .map(q => {
        // 修复常见语法问题
        return q
          .replace(/^What is the interior photos and condition assessment\?$/, 
                   'Can you provide interior photos and a condition assessment?')
          .replace(/^Roof inspection:.*$/i, 
                   'When was the roof last inspected, and what is its current condition?')
          .replace(/^Is the property legally registered.*$/,
                   'Is the property legally registered as a single-family, two-family, or multi-family home?')
          .replace(/^Certificate of Occupancy\??.*$/,
                   'Can you provide the Certificate of Occupancy?')
          .replace(/^DOB.*$/i, 'Are there any open DOB or HPD violations on this property?')
          .replace(/^Legal occupancy.*$/i, 'Is the property legally registered as a single-family, two-family, or multi-family home?')
          .trim();
      })
      .filter(q => q.length > 10) // 再次过滤太短的问题
      .slice(0, 8);

    // 过滤已知基础字段问题（beds/baths/sqft/propertyType 已在页面上确认时）
    if (hasBasicFields) {
      questions = questions.filter(q => {
        const lowerQ = q.toLowerCase();
        for (const pattern of BASIC_FIELD_PATTERNS) {
          if (pattern.test(lowerQ)) return false;
        }
        return true;
      });
    }
  }

  // 如果没有原始问题，使用默认问题
  if (questions.length === 0) {
    questions = defaultQuestions;
  }

  // 对默认问题也过滤已知基础字段问题
  if (hasBasicFields) {
    questions = questions.filter(q => {
      const lowerQ = q.toLowerCase();
      for (const pattern of BASIC_FIELD_PATTERNS) {
        if (pattern.test(lowerQ)) return false;
      }
      return true;
    });
  }

  // 如果过滤后问题为空，使用不含基础字段的备用列表
  if (questions.length === 0) {
    questions = defaultQuestions.filter(q => {
      const lowerQ = q.toLowerCase();
      if (/beds?\?|baths?\?|square\s*footage.*\?/i.test(lowerQ)) return false;
      return true;
    });
  }

  return (
    <CardShell icon={<MessageCircle size={18} className="text-stone-600" strokeWidth={1.5} />} title="Questions to Ask" delay={440}>
      <div className="text-xs text-stone-500 mb-4">
        Before making an offer, ask the seller or listing agent:
      </div>
      <div className="grid grid-cols-1 gap-3">
        {questions.slice(0, 8).map((q, i) => (
          <div key={i} className="flex items-start gap-3 p-3 bg-stone-50 rounded-xl">
            <span className="text-stone-400 text-sm font-medium shrink-0">Q{i + 1}.</span>
            <span className="text-sm text-stone-700 leading-relaxed">{q}</span>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Pros / Cons Card ──────────────────────────────────────────────────────────
function ProsConsCard({ result }: { result: AnalysisResult }) {
  const ip = (result as any).investment_potential as AnalysisResult['investment_potential'] | undefined;
  const mr = (result as any).maintenance_risk as AnalysisResult['maintenance_risk'] | undefined;
  const lf = (result as any).layout_fit;
  const rawPros = (result as any).pros as string[] | undefined;
  const rawCons = (result as any).cons as string[] | undefined;

  let pros = rawPros && rawPros.length > 0 ? rawPros : [];
  let cons = rawCons && rawCons.length > 0 ? rawCons : [];

  if (pros.length === 0 && ip) {
    pros = (ip as any).supporting_signals?.slice(0, 4) || [];
    if (pros.length === 0 && lf?.best_for) {
      pros = (lf.best_for as string[]).slice(0, 4);
    }
  }

  if (cons.length === 0) {
    const ipRisks = (ip as any)?.risks || [];
    const mrRisks = mr?.risk_factors || [];
    cons = [...ipRisks, ...mrRisks].slice(0, 5);
  }

  if (pros.length === 0 && cons.length === 0) return null;

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
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Data Needed</div>
          <BulletList items={nl.external_data_needed as string[]} maxItems={5} />
        </div>
      )}
    </CardShell>
  );
}

// ── Top Risks Section ────────────────────────────────────────────────────────
import { RiskCard, buildTopRiskCards } from './RiskCard';

function TopRisksSection({ result }: { result: AnalysisResult }) {
  const cards = buildTopRiskCards(result);
  
  if (cards.length === 0) return null;

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
          <AlertTriangle size={16} className="text-amber-600" strokeWidth={1.5} />
        </div>
        <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wide">Top Risks</h3>
      </div>
      <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-3">
        {cards.map((card, i) => (
          <RiskCard
            key={i}
            icon={card.icon}
            title={card.title}
            severity={card.severity}
            summary={card.summary}
            action={card.action}
            delay={60 + i * 50}
          />
        ))}
      </div>
    </div>
  );
}

// ── Final Recommendation Card ────────────────────────────────────────────────
function RecommendationCard({ rec, decisionScore, scoreConfidence }: { 
  rec?: { 
    verdict?: string; 
    reasoning?: string; 
    confidence?: string;
    mainReasons?: string[];
    nextStep?: string;
    keyTakeaway?: string;
  };
  decisionScore?: number;
  scoreConfidence?: string;
}) {
  if (!rec) return null;

  // 评分可用性判断
  const hasScore = decisionScore != null && decisionScore > 0;
  
  // 置信度显示
  const confidenceLabel = scoreConfidence || rec.confidence || 'Medium';
  const confidenceClass = confidenceLabel === 'High' ? 'text-green-400' :
                         confidenceLabel === 'Medium' ? 'text-amber-400' : 'text-red-400';

  // Default Key Takeaway based on score
  const defaultTakeaway = hasScore && decisionScore! < 50
    ? 'This property has significant concerns that require thorough verification before considering an offer.'
    : hasScore && decisionScore! < 70
    ? 'This property is not an obvious pass, but key legal, cost and maintenance risks must be verified before progressing.'
    : hasScore
    ? 'This property appears to be a reasonable option, but standard due diligence still applies.'
    : 'Limited data available. Additional verification recommended before proceeding.';

  return (
    <div className="bg-[#282828] text-white rounded-3xl p-5 @container[size>=480px]:p-8 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out mb-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-[#2a2a2a] flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA]">Final Verdict</div>
      </div>
      
      {/* Score + Verdict Row */}
      <div className="flex flex-col @container[size>=600px]:flex-row @container[size>=600px]:items-start gap-4 mb-5">
        {/* Left: Decision Score */}
        <div className="flex items-baseline gap-2">
          {hasScore ? (
            <>
              <span className="text-5xl @container:text-6xl font-light tracking-tight text-white">
                <AnimatedNumber target={decisionScore} />
              </span>
              <span className="text-xl @container:text-2xl font-light text-[#B3B3B3]">/100</span>
            </>
          ) : (
            <span className="text-lg text-stone-400 italic">Score unavailable</span>
          )}
          <span className="text-[10px] font-medium uppercase tracking-widest text-[#BDBDBD] ml-2">Decision Score</span>
        </div>

        {/* Right: Verdict Badge + Confidence */}
        <div className="@container[size>=600px]:ml-auto @container[size>=600px]:text-right">
          <VerdictBadge verdict={rec.verdict} />
          {confidenceLabel && (
            <div className={`mt-2 text-xs ${confidenceClass}`}>
              Report Confidence: {confidenceLabel}
            </div>
          )}
        </div>
      </div>

      {/* Score limitation note (when low confidence) */}
      {hasScore && confidenceLabel === 'Low' && (
        <div className="text-xs text-stone-500 mb-4">
          Score is limited by missing tax, legal occupancy, roof, and interior condition data.
        </div>
      )}

      {/* No score explanation */}
      {!hasScore && (
        <div className="text-xs text-stone-500 mb-4">
          Not enough structured data to calculate a decision score.
        </div>
      )}

      {/* Key Takeaway */}
      <div className="mb-5 p-4 bg-white/5 rounded-xl border border-white/10">
        <div className="flex items-center gap-1.5 mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div className="text-[10px] font-medium uppercase tracking-widest text-amber-400">Key Takeaway</div>
        </div>
        <p className="text-sm text-stone-200 leading-relaxed">
          {rec.keyTakeaway || defaultTakeaway}
        </p>
      </div>

      {/* Main Reasons */}
      {rec.mainReasons && rec.mainReasons.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-2">Main reasons</div>
          <div className="space-y-1.5">
            {rec.mainReasons.slice(0, 3).map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-white">
                <span className="text-[#DAA520] mt-0.5 shrink-0">•</span>
                {r}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next Step */}
      {rec.nextStep && (
        <div className="p-3 bg-[rgba(218,165,32,0.12)] rounded-xl border border-[#DAA520]/40">
          <div className="flex items-center gap-1.5 mb-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#DAA520] shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
            <div className="text-[10px] font-medium uppercase tracking-widest text-[#DAA520]">Next step</div>
          </div>
          <div className="text-sm text-white">{rec.nextStep}</div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export function USSaleReport({ result }: { result: AnalysisResult }) {
  const rec = (result as any).recommendation as { 
    verdict?: string; 
    reasoning?: string; 
    confidence?: string;
    mainReasons?: string[];
    nextStep?: string;
    keyTakeaway?: string;
  } | undefined;

  // 评分数据来源（按优先级 fallback）
  const decisionScore = 
    (result as any).decisionScore ??
    result.overallScore ??
    (result as any).overall_score ??
    (result as any).score ??
    (result as any).finalVerdict?.score ??
    (result as any).recommendation?.score ??
    null;

  // 评分置信度
  const scoreConfidence = 
    (result as any).scoreConfidence ??
    result.confidenceLevel ??
    (result as any).recommendation?.confidence ??
    'Medium';

  // 构建 mainReasons 和 nextStep
  const mr = (result as any).maintenance_risk;
  const lc = (result as any).legal_compliance;
  const er = undefined; // environmental risk card removed
  const gaps = (result as any).data_gaps as AnalysisResult['data_gaps'] | undefined;

  const mainReasons: string[] = [];
  if (mr?.rating && mr.rating !== 'Low') {
    mainReasons.push('Built in 1955; major systems may be older or partially updated — electrical panel, wiring, plumbing, heating and roof age should be verified');
  }
  if (lc?.risk_level && lc.risk_level !== 'Low') {
    mainReasons.push('Legal occupancy / multi-family status not verified');
  }
  if (!((result as any).carrying_costs)?.annual_tax) {
    mainReasons.push('Carrying costs and tax information not disclosed');
  }

  const nextStep = 'Before making an offer, verify CO, DOB/HPD records, tax records, and inspection history.';

  // 构建完整的 recommendation 对象
  const fullRecommendation = rec ? {
    ...rec,
    mainReasons: mainReasons.length > 0 ? mainReasons : undefined,
    nextStep: nextStep,
  } : undefined;

  // 构建 checklist items
  const checklistItems = buildChecklistItems(result);

  // 构建 Quick Balance data
  const quickBalance = buildQuickBalanceData(result);

  return (
    <div className="space-y-4">
      {/* ── 1. Final Verdict / Decision Score ── */}
      <RecommendationCard 
        rec={fullRecommendation} 
        decisionScore={decisionScore}
        scoreConfidence={scoreConfidence}
      />

      {/* ── 2. Top Risks ── */}
      <TopRisksSection result={result} />

      {/* ── 3. Photo & Space Analysis ── */}
      <PhotoSpaceAnalysisCard raw={result as any} />

      {/* ── 4. Before You Proceed Checklist ── */}
      <ActionChecklist items={checklistItems} delay={80} />

      {/* ── 5. Quick Balance ── */}
      <QuickBalance pros={quickBalance.pros} cons={quickBalance.cons} delay={100} />

      {/* ── 6. Property Snapshot ── */}
      <PropertySnapshotCard result={result} />

      {/* ── 7. Price Assessment ── */}
      <PriceAssessmentCard pa={result.price_assessment} zestimate={(result as any).zestimate} />

      {/* ── 8. Carrying Costs ── */}
      <CarryingCostsCard cc={(result as any).carrying_costs} />

      {/* ── 9. Investment Potential ── */}
      <InvestmentPotentialCard ip={(result as any).investment_potential} />

      <SectionDivider />

      {/* ── 10. Detailed Risk Analysis ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">Detailed Risk Analysis</h3>
        </div>
        <MaintenanceRiskCard mr={(result as any).maintenance_risk} />
        <LegalComplianceCard lc={(result as any).legal_compliance} />
        <LayoutFitCard lf={(result as any).layout_fit} />
        <ListingLanguageCard llrc={(result as any).listing_language_reality_check} />
      </div>

      <SectionDivider />

      {/* ── 10. Supporting Data ── */}
      <DataGapsCard gaps={(result as any).data_gaps} />
      <NeighborhoodCard nl={(result as any).neighborhood_lifestyle} />
    </div>
  );
}
