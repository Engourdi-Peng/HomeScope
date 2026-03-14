import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import type { AnalysisResult } from '../types';

interface ScoreDisplayProps {
  result: AnalysisResult;
}

const verdictConfig = {
  'Worth Inspecting': {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  'Proceed With Caution': {
    icon: AlertTriangle,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  'Likely Overpriced / Risky': {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  'Need More Evidence': {
    icon: HelpCircle,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
};

export function ScoreDisplay({ result }: ScoreDisplayProps) {
  const config = verdictConfig[result.verdict];
  const Icon = config.icon;

  return (
    <div className={`${config.bgColor} border ${config.borderColor} rounded-2xl p-6`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`flex items-center gap-3 ${config.color}`}>
          <Icon className="w-8 h-8" />
          <span className="text-xl font-bold">{result.verdict}</span>
        </div>
        <div className="text-3xl font-bold text-slate-900">
          {result.overallScore}/10
        </div>
      </div>
      <p className="text-slate-700">{result.quickSummary}</p>
    </div>
  );
}
