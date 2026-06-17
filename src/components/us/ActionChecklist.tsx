import type { AnalysisResult } from '../../shared/types/analysis';
import { ClipboardCheck } from 'lucide-react';

// ── Action Checklist Card ──────────────────────────────────────────────────────
interface ActionChecklistProps {
  items: string[];
  delay?: number;
}

export function ActionChecklist({ items, delay = 0 }: ActionChecklistProps) {
  if (items.length === 0) return null;

  return (
    <div
      className="bg-white rounded-2xl p-5 border border-stone-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
          <ClipboardCheck size={16} className="text-blue-600" strokeWidth={1.5} />
        </div>
        <h3 className="text-base font-semibold text-stone-900">Before You Proceed</h3>
      </div>

      {/* Checklist Items */}
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <label
            key={i}
            className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-stone-50 transition-colors cursor-pointer group"
          >
            {/* Checkbox */}
            <div className="w-4 h-4 rounded-md border-2 border-stone-300 bg-white flex items-center justify-center shrink-0 mt-0.5 group-hover:border-blue-400 transition-colors">
              {/* Empty checkbox visual */}
            </div>
            {/* Item text */}
            <span className="text-sm text-stone-700 leading-relaxed">{item}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Build checklist items from analysis result ─────────────────────────────────
export function buildChecklistItems(result: AnalysisResult): string[] {
  const items: Set<string> = new Set();
  
  const mr = (result as any).maintenance_risk;
  const lc = (result as any).legal_compliance;
  const cc = (result as any).carrying_costs;
  const gaps = (result as any).data_gaps as Array<{ missing_item?: string; suggested_source?: string }> | undefined;

  // 1. Legal / CO related
  if (lc?.risk_level && lc.risk_level !== 'Low') {
    items.add('Ask for Certificate of Occupancy');
    items.add('Check DOB / HPD violations in ACRIS');
  }

  // 2. Tax / Carrying costs
  if (!cc?.annual_tax && !cc?.monthly_tax_equivalent) {
    items.add('Confirm annual property tax amount');
  }

  // 3. Maintenance / Building systems
  if (mr?.rating && mr.rating !== 'Low') {
    items.add('Verify roof, electrical, plumbing, and heating age');
    items.add('Request recent inspection records');
  }

  // 4. Interior / Photos
  items.add('Request recent interior photos');

  // 5. Data gaps from analysis
  if (gaps && gaps.length > 0) {
    const topGaps = gaps.slice(0, 3);
    for (const gap of topGaps) {
      if (gap.missing_item) {
        const normalizedItem = gap.missing_item
          .replace(/^(annual |monthly |property )?tax(es)?/i, 'Confirm annual property tax')
          .replace(/^(roof|plumbing|electrical|heating|boiler|hvac)/i, 'Verify building system age')
          .replace(/certificate of occupancy/i, 'Ask for Certificate of Occupancy')
          .replace(/(DOB|HPD|violations?)/i, 'Check DOB / HPD violations');
        
        if (normalizedItem.length > 10) {
          items.add(normalizedItem);
        }
      }
    }
  }

  // 7. Default items if not enough generated
  const defaultItems = [
    'Ask for Certificate of Occupancy',
    'Check DOB / HPD violations',
    'Confirm annual property tax',
    'Verify roof / electrical / plumbing age',
    'Request recent interior photos',
    'Get insurance quote',
    'Check flood zone',
    'Compare recent sales',
  ];

  // Add defaults if we don't have enough items
  for (const item of defaultItems) {
    if (items.size < 8 && !Array.from(items).some(i => i.toLowerCase().includes(item.toLowerCase().slice(0, 15)))) {
      items.add(item);
    }
    if (items.size >= 8) break;
  }

  return Array.from(items).slice(0, 8);
}
