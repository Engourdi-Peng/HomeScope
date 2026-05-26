// ===== normalizeReport — 统一入口 =====
// 检测 result 的 market / reportMode / isBasic，分发到对应 adapter

import type { NormalizedReport, Market, ReportMode } from './types';
import { normalizeUSSaleReport } from './usSale';
import { normalizeAUSaleReport } from './auSale';
import { normalizeAURentReport } from './auRent';
import { normalizeGenericReport } from './generic';

type AnyResult = any;

// ---- field name normalizers ----
// 兼容 camelCase 和 snake_case

function getField(result: AnyResult, ...paths: string[]): any {
  for (const p of paths) {
    if (result?.[p] !== undefined) return result[p];
  }
  return undefined;
}

// ---- detect market ----
function detectMarket(result: AnyResult): Market {
  // 1. Explicit market field
  const m = getField(result, 'market', 'Market');
  if (m === 'US' || m === 'AU') return m;

  // 2. sourceDomain clues
  const domain = getField(result, 'sourceDomain', 'source_domain', 'source', 'Source') ?? '';
  const domainStr = typeof domain === 'string' ? domain.toLowerCase() : '';
  if (domainStr.includes('zillow') || domainStr.includes('realtor')) return 'US';
  if (domainStr.includes('realestate') || domainStr.includes('domain') || domainStr.includes('allhomes')) return 'AU';

  // 3. Field presence clues
  // US tends to have: property_snapshot, carrying_costs, maintenance_risk
  // AU tends to have: stampDuty, land_value_analysis, deal_breakers
  const hasUSModules = result?.property_snapshot ?? result?.carrying_costs ?? result?.maintenance_risk ?? false;
  const hasAUModules = result?.stampDuty ?? result?.land_value_analysis ?? result?.deal_breakers ?? false;

  if (hasUSModules && !hasAUModules) return 'US';
  if (hasAUModules && !hasUSModules) return 'AU';

  // 4. Report mode inference
  const mode = detectReportMode(result);
  if (mode === 'rent') return 'AU'; // No US rent yet, default AU

  return 'UNKNOWN';
}

// ---- detect report mode ----
function detectReportMode(result: AnyResult): ReportMode {
  const mode = getField(result, 'reportMode', 'report_mode', 'analysisType', 'mode');
  if (mode === 'sale') return 'sale';
  if (mode === 'rent') return 'rent';
  return 'unknown';
}

// ---- detect basic result ----
function detectBasicResult(result: AnyResult): boolean {
  if (getField(result, 'analysisType') === 'basic') return true;
  if ('decision' in result && result.decision !== undefined) return true;
  if (!result?.property_snapshot && !result?.carrying_costs && !result?.price_assessment && !result?.overallScore) return true;
  return false;
}

// ---- main export ----
export function normalizeReportResult(result: AnyResult): NormalizedReport {
  const market = detectMarket(result);
  const reportMode = detectReportMode(result);
  const isBasic = detectBasicResult(result);

  let normalized: NormalizedReport;

  if (isBasic) {
    normalized = normalizeGenericReport(result);
  } else if (market === 'US' && reportMode === 'sale') {
    normalized = normalizeUSSaleReport(result);
  } else if (market === 'AU' && reportMode === 'sale') {
    normalized = normalizeAUSaleReport(result);
  } else if (market === 'AU' && reportMode === 'rent') {
    normalized = normalizeAURentReport(result);
  } else if (market === 'US' && reportMode === 'rent') {
    normalized = normalizeGenericReport(result);
  } else {
    normalized = normalizeGenericReport(result);
  }

  return normalized;
}
