// ===== NormalizedReport — 统一数据模型 =====
// 所有 adapter 的输出格式，NewReportUI 只消费这个结构

export type Market = 'US' | 'AU' | 'UNKNOWN';
export type ReportMode = 'sale' | 'rent' | 'unknown';
export type SectionTone = 'positive' | 'warning' | 'danger' | 'neutral' | 'info';

/**
 * Determines which report templates, risk modules, and questions to use.
 *
 * Classification logic:
 * - single_family_owner_occupier: propertyType is SingleFamily AND listing has NO
 *   rental-unit / multi-family signals (no basement apartment, income unit,
 *   legal two-family, separate unit, duplex, etc.)
 * - multi_family: propertyType is MultiFamily/Duplex OR listing text explicitly
 *   mentions rental unit / income / legal two-family / separate unit
 * - condo / coop / townhouse / land: explicit property types
 * - unknown: cannot determine from available data
 */
export type ReportProfile =
  | 'single_family_owner_occupier'
  | 'multi_family'
  | 'condo'
  | 'coop'
  | 'townhouse'
  | 'land'
  | 'unknown';

/**
 * Normalized property category — canonical property-type classification
 * used to drive report templates, risk/question routing, and display labels.
 *
 * IMPORTANT: This is the authoritative type for all property-type-specific
 * logic. Use this instead of ReportProfile for new code paths.
 *
 * Priority rules (applied in this order):
 * 1. co_op    — explicit co-op / stock cooperative signal → highest priority
 * 2. condo    — condo / condominium
 * 3. townhouse — townhouse / townhome / rowhouse
 * 4. multi_family — multi-family / duplex / triplex / 2-family / etc.
 * 5. single_family — single-family residence / house
 * 6. manufactured — manufactured / mobile home / modular
 * 7. land     — lot / land / vacant land
 * 8. apartment — apartment
 * 9. unknown  — cannot determine from available data
 */
export type NormalizedPropertyCategory =
  | 'co_op'
  | 'condo'
  | 'single_family'
  | 'townhouse'
  | 'multi_family'
  | 'manufactured'
  | 'land'
  | 'apartment'
  | 'unknown';

/**
 * Clean display labels for NormalizedPropertyCategory.
 * Use these instead of raw Zillow / MLS values.
 */
export const PROPERTY_CATEGORY_DISPLAY: Record<NormalizedPropertyCategory, string> = {
  co_op: 'Co-op',
  condo: 'Condo',
  single_family: 'Single-family home',
  townhouse: 'Townhouse',
  multi_family: 'Multi-family home',
  manufactured: 'Manufactured home',
  land: 'Land / lot',
  apartment: 'Apartment',
  unknown: 'Not clearly disclosed',
};

// ---- meta ----
export interface ReportMeta {
  market: Market;
  reportMode: ReportMode;
  source?: string;
  sourceDomain?: string;
  isBasic: boolean;
  /** Section IDs consumed by TopRisksSection — others skip them */
  usedSectionIds?: string[];
  /** Property-type classification driving report routing */
  reportProfile?: ReportProfile;
  /** Canonical property-type category for display and routing */
  normalizedPropertyCategory?: NormalizedPropertyCategory;
  /** Debug metadata from normalization */
  _normalizationDebug?: {
    rawHomeType?: string;
    rawPropertyType?: string;
    rawPropertySubtype?: string;
    normalizedPropertyCategory: NormalizedPropertyCategory;
    displayType: string;
  };
}

// ---- hero ----
export interface HeroData {
  title?: string;
  address?: string;
  price?: string;
  bedrooms?: string;
  bathrooms?: string;
  sqft?: string;
  zestimate?: string;
  monthlyPayment?: string;
  imageUrl?: string;
  score: number | null;
  verdict: string;
  confidence?: string;
  summary?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

// ---- highlights ----
export interface HighlightsData {
  pros: string[];
  cons: string[];
  risks: string[];
}

// ---- quick facts ----
export interface QuickFact {
  label: string;
  value: string;
  helper?: string;
}

// ---- section items ----
export interface SectionItem {
  title: string;
  value?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  badge?: string;
}

// ---- sections ----
export interface ReportSection {
  id: string;
  title: string;
  subtitle?: string;
  tone?: SectionTone;
  items: SectionItem[];
}

// ---- contradiction ----
export interface ContradictionVM {
  id: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  field1?: string;
  field2?: string;
  suggestion?: string;
}

// ---- top-level normalized report ----
export interface NormalizedReport {
  meta: ReportMeta;
  hero: HeroData;
  highlights: HighlightsData;
  quickFacts: QuickFact[];
  sections: ReportSection[];
  /** 原始结果透传，方便调试和 fallback */
  raw: any;
}
