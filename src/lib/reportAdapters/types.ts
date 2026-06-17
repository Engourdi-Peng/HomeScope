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

export type BuyerReportMode =
  | 'single_family_owner_occupier'
  | 'multi_family_income'
  | 'condo_hoa'
  | 'coop_board'
  | 'townhouse'
  | 'land_or_development'
  | 'new_construction'
  | 'unknown';

export type EvidenceType =
  | 'listing_stated'
  | 'photo_observed'
  | 'inferred_needs_verification'
  | 'missing_data';

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

// ---- Internal intelligence layer ----
// Profile drives Basic report generation in the backend pipeline.
// Stored in ReportMeta for frontend compatibility (read-only, does not affect AI output).
export type PropertyIntelligenceCategory =
  | 'single_family' | 'multi_family' | 'condo' | 'co_op'
  | 'townhouse' | 'land' | 'manufactured' | 'unknown';
export type OwnershipModel = 'fee_simple' | 'condominium' | 'cooperative' | 'unknown';
export type BuyerUseCase = 'primary_residence' | 'investment' | 'mixed' | 'unknown';
export type ProfileConfidence = 'high' | 'medium' | 'low';

export interface PropertyIntelligenceProfile {
  propertyCategory: PropertyIntelligenceCategory;
  ownershipModel: OwnershipModel;
  likelyBuyerUseCase: BuyerUseCase;
  /** Top 3-6 questions a buyer must answer for this asset type — drives report focus */
  primaryDecisionAxis: string[];
  /** Keywords/phrases detected in listing text that are decisive for THIS asset type */
  decisiveListingSignals: string[];
  /** Generic risks to suppress for this propertyCategory — AI must not default to these */
  irrelevantGenericRisksToAvoid: string[];
  confidence: ProfileConfidence;
}

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
  /** Buyer-oriented routing for report generation and validation */
  buyerReportMode?: BuyerReportMode;
  /** Canonical property type for display and routing (mirrors backend verifiedFacts.normalizedPropertyCategory) */
  normalizedPropertyCategory?: NormalizedPropertyCategory;
  /** Internal intelligence profile — drives Basic report generation in backend; frontend read-only */
  analysisProfile?: PropertyIntelligenceProfile;
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
  homeType?: string;
  imageUrl?: string;
  score: number | null;
  verdict: string;
  confidence?: string;
  summary?: string;
  /** AI-generated bottom line from backend normalizeBottomLine (US Basic v2) */
  bottomLine?: string;
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
  /** Action prompt (used by Top 3 Things To Check on US Basic v2). */
  action?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  badge?: string;
}

/**
 * Section IDs used by the US Basic v2 layout. Not exhaustive — other layouts
 * (Full, AU Basic) may use additional IDs.
 */
export type BasicSectionId =
  | 'what-we-know'
  | 'listing-signals'
  | 'whats-missing'
  | 'top-3-things-to-check'
  | 'questions'
  | 'basic-cta';

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
