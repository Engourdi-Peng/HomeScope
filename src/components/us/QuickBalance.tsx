import type { AnalysisResult } from '../../shared/types/analysis';
import { TrendingUp, AlertTriangle, Check, Minus } from 'lucide-react';

// ── Quick Balance Card ──────────────────────────────────────────────────────────
interface QuickBalanceProps {
  pros: string[];
  cons: string[];
  delay?: number;
}

export function QuickBalance({ pros, cons, delay = 0 }: QuickBalanceProps) {
  if (pros.length === 0 && cons.length === 0) return null;

  return (
    <div
      className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <TrendingUp size={16} className="text-stone-600" strokeWidth={1.5} />
        </div>
        <h3 className="text-base font-semibold text-stone-900">Quick Balance</h3>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 @container[size>=480px]:grid-cols-2 gap-6">
        {/* Potential Upside */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <TrendingUp size={11} className="text-green-600" strokeWidth={2} />
            </div>
            <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Potential Upside</span>
          </div>
          {pros.length > 0 ? (
            <ul className="space-y-2">
              {pros.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                  <span className="text-green-500 mt-0.5 shrink-0">
                    <Check size={13} strokeWidth={2} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400 italic">No significant positives identified</p>
          )}
        </div>

        {/* Key Concerns */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={11} className="text-red-600" strokeWidth={2} />
            </div>
            <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Key Concerns</span>
          </div>
          {cons.length > 0 ? (
            <ul className="space-y-2">
              {cons.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                  <span className="text-red-400 mt-0.5 shrink-0">
                    <Minus size={13} strokeWidth={2} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400 italic">No significant concerns identified</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Build pros/cons from analysis result ───────────────────────────────────────
export function buildQuickBalanceData(result: AnalysisResult): { pros: string[]; cons: string[] } {
  const ip = (result as any).investment_potential as AnalysisResult['investment_potential'] | undefined;
  const mr = (result as any).maintenance_risk as AnalysisResult['maintenance_risk'] | undefined;
  const lf = (result as any).layout_fit;
  const rawPros = (result as any).pros as string[] | undefined;
  const rawCons = (result as any).cons as string[] | undefined;

  let pros: string[] = rawPros && rawPros.length > 0 ? rawPros : [];
  let cons: string[] = rawCons && rawCons.length > 0 ? rawCons : [];

  // Generate pros from investment potential signals
  if (pros.length === 0 && ip) {
    pros = (ip as any).supporting_signals?.slice(0, 4) || [];
    if (pros.length === 0 && lf?.best_for) {
      pros = (lf.best_for as string[]).slice(0, 4);
    }
  }

  // Generate cons from risk factors
  if (cons.length === 0) {
    const ipRisks = (ip as any)?.risks || [];
    const mrRisks = mr?.risk_factors || [];
    cons = [...ipRisks, ...mrRisks].slice(0, 5);
  }

  // Ensure we have at least some content
  if (pros.length === 0 && cons.length === 0) {
    // Try to extract from data_gaps
    const gaps = (result as any).data_gaps as Array<{ missing_item?: string }> | undefined;
    if (gaps && gaps.length > 0) {
      for (const gap of gaps) {
        if (gap.missing_item) {
          cons.push(`Missing: ${gap.missing_item}`);
        }
      }
    }
  }

  return { pros, cons };
}
