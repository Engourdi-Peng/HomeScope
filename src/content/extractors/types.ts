/**
 * 标准化房源数据结构
 * 所有网站 extractor 统一输出此格式
 */

export type ListingSource = 'realestate-au' | 'zillow' | 'future-site';

/**
 * 标准化房源数据接口
 * 提取层输出的统一格式，source 字段必填
 *
 * 兼容原则：
 *  - 旧字段（price/priceAmount/pricePeriod/parking/rentZestimate/zestimate/yearBuilt）
 *    保持原类型不变，保留给现有 Sale/AU/ResultCard 读取
 *  - 新字段（displayPrice/askingPrice/monthlyRent/advertisedRentRange/
 *    parkingDescription/parkingFee/managementCompany 等）并存
 *  - 互斥规则只针对新字段部分；旧字段不参与互斥
 */
export interface StandardizedListingData {
  // === 必填核心字段 ===
  source: ListingSource;
  url: string;

  // === 标准化公共字段 ===
  address: string;
  title: string;
  /** 旧字段：保留。语义 = displayPrice（页面原始价格文本） */
  price: string;
  priceAmount?: number;
  pricePeriod?: 'week' | 'month' | 'year' | 'total';
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string;
  description: string;
  whatsSpecialText?: string;
  images: string[];

  // === 澳洲特有字段 ===
  carSpaces?: number | null;
  /** 旧字段：兼容 parking（number | null）。与新字段 parkingDescription 并存 */
  parking?: number | null;

  // === 美国特有字段 ===
  sqft?: number | null;
  /** 旧字段：保持原 string | null 类型，兼容现有链路 */
  zestimate?: string | null;
  /** 旧字段：保持原 string | null 类型，与新字段 advertisedRentRange 分开 */
  rentZestimate?: string | null;
  yearBuilt?: number | null;
  lotSize?: string | null;
  hoaFee?: string | null;
  propertyTax?: string | null;
  schoolRatings?: SchoolRating[];
  daysOnZillow?: number | null;

  // === DOM 提取扩展字段 ===
  homeType?: string;
  propertySubtype?: string;
  walkScore?: string;
  bikeScore?: string;
  neighborhood?: string;
  architecturalStyle?: string;
  stories?: string;
  hoaStatus?: string;
  floodZone?: string | null;
  highlights?: string[];
  heating?: string;
  cooling?: string;
  basement?: string;
  garageSpaces?: number | null;
  carportSpaces?: number | null;
  constructionMaterial?: string;
  parcelNumber?: string;
  taxAssessedValue?: number | null;
  annualTax?: number | null;
  dateOnMarket?: string | null;
  region?: string;
  gasMeters?: number | null;

  // === 通用扩展 ===
  facts?: Record<string, unknown>;
  rawJson?: unknown;

  // === 提取元数据 ===
  extractionConfidence: number;
  extractedAt: string;

  // === 房源类型识别（US 链路识别 rent vs sale，禁止任何 sale 默认）===
  listingType?: 'rent' | 'sale' | 'unknown';
  listingTypeSource?: 'jsonld' | 'dom' | 'url' | 'price' | 'fallback';
  listingTypeConfidence?: 'high' | 'medium' | 'low';
  listingTypeConflicts?: Array<'rent' | 'sale'>;

  // ────────────────────────────────────────────────────────────────────
  // 新增字段（兼容模式：并存，不删除旧字段）
  // ────────────────────────────────────────────────────────────────────

  /** 页面原始价格文本（如 "$2,300/mo" 或 "$850,000"）。新增，不参与模式判断。 */
  displayPrice?: string;

  /** 描述字符串（如 "1 garage space, attached"）。与旧字段 parking 并存。 */
  parkingDescription?: string | null;

  /** 真实通用事实（两模式都允许），如 "Greystar Properties" */
  managementCompany?: string | null;

  // === Rent 专属新字段 ===
  /** 主租金额（real price）。互斥：sale 输出 undefined */
  monthlyRent?: number | null;
  /** 页面实际广告租金上下限（仅来自页面广告），不与 rentZestimate 混用 */
  advertisedRentRange?: { low?: number | null; high?: number | null } | null;
  /** Rent 专属：单元号 */
  exactUnit?: string | null;
  /** Rent 专属：入住日期 */
  availableDate?: string | null;
  /** Rent 专属：保证金 */
  securityDeposit?: string | null;
  /** Rent 专属：预付定金 */
  holdingDeposit?: string | null;
  /** Rent 专属：申请费 */
  applicationFee?: string | null;
  /** Rent 专属：租期 */
  leaseTerm?: string | null;
  /** Rent 专属：含 utilities 列表 */
  utilitiesIncluded?: string[] | null;
  /** Rent 专属：房东支付项 */
  landlordPays?: string[] | null;
  /** Rent 专属：租客支付项 */
  tenantPays?: string[] | null;
  /** Rent 专属：宠物政策 */
  petPolicy?: string | null;
  /** Rent 专属：停车费，与 Common.parkingDescription 并存 */
  parkingFee?: string | null;
  /** Rent 专属：物业费 */
  amenityFee?: string | null;
  /** Rent 专属：资格要求 */
  qualificationRequirements?: string | null;

  // === Sale 专属新字段 ===
  /** 售价（real price）。互斥：rent 输出 undefined */
  askingPrice?: number | null;
  /** sale 模式 zestimate（与 rent 的 rentZestimate 语义不同，rentZestimate 是收入参考） */
  saleZestimate?: number | null;
  pricePerSqft?: number | null;
  propertyTaxMonthly?: number | null;
  homeInsuranceMonthly?: number | null;
  priceHistory?: string | null;
  lotDimensions?: string | null;

  // === Listing identity (PR 1A) ===
  /**
   * canonical listing URL (origin + decoded path, no query/hash, no trailing slash).
   * Preserves original case. Never empty for a successfully extracted listing.
   */
  listingUrl?: string;
  /** raw location.href at extraction time, preserved for debugging. */
  pageUrl?: string;
  /** zpid derived from the URL or the gdpClientCache entry that matches the current listing. */
  zpid?: string | null;
  /** buildingId from the gdpClientCache property record (apartments + multi-unit). */
  buildingId?: string | null;
  /** Stable identity string: zillow:<zpid|buildingId|apartmentTail|normalizedPath>. */
  listingIdentity?: string | null;

  // === Mode resolution (PR 1A) ===
  /**
   * The three-source resolution result. Populated by ZillowExtractor on every
   * extraction. Backends (supabase/functions/analyze) prefer this over the
   * legacy body.reportMode / listingType / pricePeriod fields when
   * resolverVersion === 'zillow_listing_mode_v2'.
   *
   * Sources fields are typed as strings rather than a closed enum because the
   * full `ListingModeSourceResult` (which includes `'unknown'`) is needed by
   * `modeDetection.ts`, while the backend/contract layer only ever sees
   * `'sale' | 'rent' | 'none' | 'conflict'`. The resolver collapses any
   * `'unknown'` source into `'none'` before serializing.
   */
  modeResolution?: {
    resolverVersion: 'zillow_listing_mode_v2';
    mode: 'sale' | 'rent' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    decisionSource: string;
    conflict: boolean;
    evidence: string[];
    sources: {
      jsonLd: 'sale' | 'rent' | 'none' | 'conflict';
      structured: 'sale' | 'rent' | 'none' | 'conflict';
      hero: 'sale' | 'rent' | 'none' | 'conflict';
    };
    listingIdentity: string;
  };

  // === Page scope — derived from URL pattern + page structure ===
  /** Describes what kind of listing the current page represents. */
  listingScope?: ListingScope;

  /** Building name for multi-unit and selected-unit pages. */
  buildingName?: string | null;

  /**
   * Concrete UNITS inside a multi-unit building or a selected-unit page.
   *
   * SEMANTIC GUARANTEE: every entry here represents a single, addressable unit
   * (identified by unitId, unitNumber, zpid, or a stable
   * `${name}|${beds}|${baths}|${sqft}|${monthlyRent}|${availableFrom}`
   * fingerprint). FLOOR-PLAN aggregates that summarise a group of identical
   * units are NOT mixed in here — they go to `floorPlanSummaries`.
   */
  availableUnits?: AvailableUnit[] | null;

  /**
   * FLOOR-PLAN summaries (roll-ups). Always semantically distinct from
   * `availableUnits` so the two layers are not conflated.
   */
  floorPlanSummaries?: Array<{
    planName?: string | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    sqft?: number | null;
    minPrice?: number | null;
    maxPrice?: number | null;
    unitCount?: number | null;
  }> | null;
}

/**
 * 学校评分（美国特有）
 */
export interface SchoolRating {
  name: string;
  rating: number;
  level?: 'elementary' | 'middle' | 'high';
  distance?: string;
}

/**
 * Extractor 注册配置
 */
export interface ExtractorConfig {
  id: ListingSource;
  canHandle: (url: URL) => boolean;
}

// ============================================================================
// Listing mode resolution (PR 1A — three-source strict detection)
// ----------------------------------------------------------------------------
// Used by ZillowExtractor to detect whether the current listing is sale or rent
// without depending on full-page innerText or loosely-matched status keywords.
//
// Design constraints:
//   - Three sources of evidence, each with an explicit quality level.
//   - JSON-LD businessFunction is the highest-quality signal but must be
//     filtered to the current listing via zpid/buildingId/pathname match.
//   - Structured raw status fields (homeStatus/listingType/...) must come from
//     the original Zillow payload, NOT from a previously-computed
//     detectListingTypeInternal() output (otherwise it's the same signal twice).
//   - Hero DOM is medium quality: explicit status text can independently
//     confirm; price alone cannot.
//
// Source results are joined by resolveListingMode() (see zillow.ts) using
// deterministic rules — no fuzzy matching, no `A | B` regex, no document.body.innerText.
// ============================================================================

export type ListingMode = 'sale' | 'rent' | 'unknown';
export type ListingModeSourceResult = ListingMode | 'none' | 'conflict';

export type ListingModeResolverVersion = 'zillow_listing_mode_v2';

export type ListingModeDecisionSource =
  | 'source_consensus'
  | 'jsonld_business_function'
  | 'structured_raw_status'
  | 'current_listing_hero'
  | 'rent_url_fallback'
  | 'conflict'
  | 'insufficient_evidence';

export interface ListingModeResolution {
  resolverVersion: ListingModeResolverVersion;
  mode: ListingMode;
  confidence: 'high' | 'medium' | 'low';
  decisionSource: ListingModeDecisionSource;
  conflict: boolean;
  evidence: string[];
  sources: {
    jsonLd: ListingModeSourceResult;
    structured: ListingModeSourceResult;
    hero: ListingModeSourceResult;
  };
  listingIdentity: string;
  listingScope?: ListingScope;
}

/**
 * Allowed evidence strings. Whitelisted so a downstream log/transport layer
 * never has to validate arbitrary content (and so future JSON serializers can
 * enforce enum membership).
 */
export const LISTING_MODE_EVIDENCE_VALUES = new Set<string>([
  // JSON-LD signals
  'jsonld_sell',
  'jsonld_leaseout',
  'jsonld_mon_unit',
  'jsonld_conflict',
  'jsonld_missing_business_function',
  // Structured raw status signals
  'structured_for_sale',
  'structured_for_rent',
  'structured_conflict',
  'structured_missing',
  // Hero signals
  'hero_status_for_sale',
  'hero_status_for_rent',
  'hero_status_room_for_rent',
  'hero_price_monthly_with_rent_cta',
  'hero_price_total_with_sale_cta',
  'hero_price_only_no_status',
  // URL fallback
  'url_rent_path',
  // Resolution outcomes
  'jsonld_consensus_with_structured',
  'jsonld_alone',
  'hero_alone',
  'conflict_high_vs_medium',
]);

/**
 * The canonical schema version string passed alongside `modeResolution` to the
 * backend. Backend rejects any unknown version and falls back to legacy
 * reportMode/listingType/pricePeriod resolution.
 */
export const LISTING_MODE_RESOLVER_VERSION: ListingModeResolverVersion = 'zillow_listing_mode_v2';

/**
 * What kind of listing a page represents.
 */
export type ListingScope =
  | 'single_property'
  | 'entire_home'
  | 'private_room'
  | 'multi_unit_building'
  | 'selected_unit'
  | 'unknown';

/**
 * A single concrete unit inside a multi-unit building or selected-unit page.
 *
 * `availableUnits` MUST always represent addressable units. Floor-plan
 * roll-ups belong to `floorPlanSummaries`, not here.
 */
export interface AvailableUnit {
  /** Stable backend ID when Zillow exposes one. */
  unitId?: string | null;
  /** Display name (e.g. "Unit 3B", "Plan A"). */
  name?: string | null;
  /** Building-stable unit identifier (e.g. "3B", "102"). Two different
   *  unitNumbers MUST NOT be merged even when beds/baths/price match. */
  unitNumber?: string | null;
  /** zpid when the unit has its own Zillow listing. */
  zpid?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  monthlyRent?: number | null;
  availableFrom?: string | null;
  photoCount?: number | null;
  photoUrl?: string | null;
}
