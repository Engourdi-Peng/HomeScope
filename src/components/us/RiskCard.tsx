import { RiskBadge } from './RiskBadge';
import type { AnalysisResult } from '../../shared/types/analysis';
import { AlertTriangle, AlertCircle, Shield, Wrench, FileCheck, Droplets } from 'lucide-react';

interface RiskCardProps {
  icon: React.ReactNode;
  title: string;
  severity: 'High' | 'Medium' | 'Low';
  summary: string;
  action: string;
  delay?: number;
}

export function RiskCard({ icon, title, severity, summary, action, delay = 0 }: RiskCardProps) {
  const isHigh = severity === 'High';
  
  const accentColor = isHigh 
    ? 'border-l-red-500 bg-red-50/30' 
    : 'border-l-amber-500 bg-amber-50/30';
  
  const iconBg = isHigh ? 'bg-red-100' : 'bg-amber-100';
  const iconColor = isHigh ? 'text-red-600' : 'text-amber-600';
  const actionBg = isHigh ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200';

  return (
    <div
      className={`bg-white rounded-2xl p-5 border-l-4 ${accentColor} border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
          <span className={iconColor}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-stone-900">{title}</h4>
            <RiskBadge level={severity} />
          </div>
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-stone-600 leading-relaxed mb-4">{summary}</p>

      {/* Action */}
      <div className="flex items-start gap-2">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer shrink-0 ${actionBg}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">Action</span>
        </span>
        <span className="text-xs text-stone-600 leading-relaxed pt-0.5">{action}</span>
      </div>
    </div>
  );
}

// ── Pre-configured risk cards builder ──────────────────────────────────────
interface RiskItem {
  title: string;
  severity: 'High' | 'Medium' | 'Low';
  summary: string;
  action: string;
}

export function buildTopRiskCards(result: AnalysisResult): RiskCardProps[] {
  const cards: RiskCardProps[] = [];
  
  const mr = (result as any).maintenance_risk;
  const lc = (result as any).legal_compliance;
  // 1. Maintenance Risk
  if (mr?.rating && mr.rating !== 'Low') {
    const severity = mr.rating === 'High' ? 'High' : 'Medium';
    cards.push({
      icon: <Wrench size={18} strokeWidth={1.5} />,
      title: 'Maintenance',
      severity,
      summary: mr.summary || 'Building systems age and condition unverified. Requires professional inspection.',
      action: 'Require full inspection before offer.',
    });
  }

  // 2. Legal / Occupancy Risk
  if (lc?.risk_level && lc.risk_level !== 'Low') {
    const severity = lc.risk_level === 'High' ? 'High' : 'Medium';
    cards.push({
      icon: <FileCheck size={18} strokeWidth={1.5} />,
      title: 'Legal / Occupancy',
      severity,
      summary: lc.summary || 'Legal occupancy status and Certificate of Occupancy not verified.',
      action: 'Check DOB / ACRIS / Certificate of Occupancy.',
    });
  }

  // Fallback: if no structured data, use generic cards
  if (cards.length === 0) {
    const score = (result as any).decisionScore ?? result.overallScore ?? 50;
    
    if (score < 50) {
      cards.push({
        icon: <AlertTriangle size={18} strokeWidth={1.5} />,
        title: 'Overall Risk',
        severity: 'High',
        summary: 'Multiple unverified factors require due diligence.',
        action: 'Verify all key data before proceeding.',
      });
    } else if (score < 70) {
      cards.push({
        icon: <Shield size={18} strokeWidth={1.5} />,
        title: 'Moderate Concerns',
        severity: 'Medium',
        summary: 'Some factors require verification before making an offer.',
        action: 'Request inspection and verify records.',
      });
    }
  }

  return cards;
}
