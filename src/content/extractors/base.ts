/**
 * 提取器接口定义
 * Layer C（数据提取层）的核心抽象
 */

import type { StandardizedListingData, ListingSource, SchoolRating } from './types';
import type { PropertySignals } from '../detectors/propertySignals';

export type ExtractionStage = 'initial' | 'delayed' | 'final';

export interface ExtractContext {
  document: Document;
  url: URL;
  signals: PropertySignals;
  stage: ExtractionStage;
}

/**
 * 标准化提取器接口
 * 每个网站对应一个实现类
 */
export interface ListingExtractor {
  /** 唯一标识符 */
  readonly source: ListingSource;
  /** 判断当前 URL 是否由本 extractor 处理 */
  canHandle(url: URL): boolean;
  /** 执行提取逻辑，返回标准化数据 */
  extract(ctx: ExtractContext): Promise<StandardizedListingData>;
  /** 可选：增量图片提取（用于 PhotoSwipe 模式） */
  extractImages?(ctx: ExtractContext): Promise<string[]>;
}

// ============================================================================
// ModeAwareListingExtractor — ListingExtractor 的模式分流扩展
// 未来 Redfin/Realtor.com 复用此契约。本次只 Zillow 实现。
// ============================================================================

/**
 * 模式识别结果（detectListingType 返回值）
 * type: 严格 rent | sale | unknown，禁止默认 sale
 */
export interface ListingTypeMeta {
  type: 'rent' | 'sale' | 'unknown';
  source: 'jsonld' | 'dom' | 'url' | 'price' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
  conflicts: Array<'rent' | 'sale'>;
}

/**
 * 通用字段集合：地址/标题/描述/属性类型/beds/baths/sqft/图片/联系人等。
 * 两模式都返回。
 */
export interface CommonListingFields {
  address: string;
  title: string;
  /** 页面原始价格文本（如 "$2,300/mo" 或 "$850,000"）。新增字段，不参与模式判断 */
  displayPrice?: string;
  description: string;
  whatsSpecialText?: string;
  images: string[];
  propertyType: string;
  homeType?: string;
  propertySubtype?: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  /** yearBuilt 仅放 Common（真实通用事实） */
  yearBuilt?: number | null;
  /** 描述字符串（如 "1 garage space, attached"），与旧字段 parking 并存 */
  parkingDescription?: string | null;
  /** 真实通用事实，两模式都允许 */
  managementCompany?: string | null;
  contactInfo?: string | null;
  schoolRatings?: SchoolRating[];
  walkScore?: string;
  bikeScore?: string;
  neighborhood?: string;
  architecturalStyle?: string;
  stories?: string;
  region?: string;
  floodZone?: string;
  heating?: string;
  cooling?: string;
  basement?: string;
  garageSpaces?: number | null;
  /** 模式识别结果 */
  listingType: 'rent' | 'sale' | 'unknown';
  listingTypeSource?: ListingTypeMeta['source'];
  listingTypeConfidence?: ListingTypeMeta['confidence'];
  listingTypeConflicts?: ListingTypeMeta['conflicts'];
}

/**
 * Rent 专属字段集合。
 * 严格互斥：不得出现 askingPrice/zestimate/monthlyPayment 等 sale 字段。
 */
export interface RentListingFields {
  /** 主租金额（real price） */
  monthlyRent?: number | null;
  /** 页面实际广告租金上下限（仅来自页面广告），不与 rentZestimate 混用 */
  advertisedRentRange?: { low?: number | null; high?: number | null } | null;
  exactUnit?: string | null;
  availableDate?: string | null;
  securityDeposit?: string | null;
  holdingDeposit?: string | null;
  applicationFee?: string | null;
  leaseTerm?: string | null;
  utilitiesIncluded?: string[] | null;
  landlordPays?: string[] | null;
  tenantPays?: string[] | null;
  petPolicy?: string | null;
  /** 与 Common.parkingDescription 并存 */
  parkingFee?: string | null;
  amenityFee?: string | null;
  qualificationRequirements?: string | null;
}

/**
 * Sale 专属字段集合。
 * 严格互斥：不得出现 monthlyRent/securityDeposit/leaseTerm 等 rent 字段。
 */
export interface SaleListingFields {
  /** 售价（real price） */
  askingPrice?: number | null;
  zestimate?: number | null;
  pricePerSqft?: number | null;
  annualTax?: number | null;
  taxAssessedValue?: number | null;
  monthlyPayment?: number | null;
  propertyTaxMonthly?: number | null;
  homeInsuranceMonthly?: number | null;
  hoaFee?: string | null;
  hoaStatus?: string | null;
  priceHistory?: string | null;
  daysOnZillow?: number | null;
  dateOnMarket?: string | null;
  lotSize?: string | null;
  lotDimensions?: string | null;
}

/**
 * ModeAwareListingExtractor — 在 ListingExtractor 之上增加模式契约
 * 不引入平行接口，避免"两个都可能无人使用"的设计。
 * Zillow 本次实现，future Redfin/Realtor.com 复用。
 *
 * 互斥规则（针对返回的新字段部分）：
 *  - extractRentSpecificFields 返回 RentListingFields: sale 字段不在类型中
 *  - extractSaleSpecificFields 返回 SaleListingFields: rent 字段不在类型中
 *  - 旧字段 price/parking/rentZestimate 不参与互斥（兼容现有链路）
 */
export interface ModeAwareListingExtractor extends ListingExtractor {
  /** 模式识别（strict signals: jsonld > dom > url > price > fallback） */
  detectListingType(ctx: ExtractContext): Promise<ListingTypeMeta>;

  /** 通用字段：地址/标题/描述/属性类型/beds/baths/sqft/图片/联系人/yearBuilt 等 */
  extractCommonFields(ctx: ExtractContext): Promise<CommonListingFields>;

  /** Rent 专属：必须 monthlyRent (real price) */
  extractRentSpecificFields(
    ctx: ExtractContext,
    common: CommonListingFields,
  ): Promise<RentListingFields>;

  /** Sale 专属：必须 askingPrice (real price) */
  extractSaleSpecificFields(
    ctx: ExtractContext,
    common: CommonListingFields,
  ): Promise<SaleListingFields>;

  /**
   * 强制重提取：用户在 ReportModeModal 选定 Rent/Sale 后，由 content script
   * 持有 document 的上下文调用。复用同一 ctx，只重新跑对应 specific extractor。
   * - 不重新扫描页面
   * - 返回合并后的 StandardizedListingData（listingType = forcedListingType）
   * - 不调用：不直接 toggle listingType 后用之前的 common 数据发起分析
   */
  forceReextract?(
    ctx: ExtractContext,
    common: CommonListingFields,
    forcedListingType: 'rent' | 'sale',
  ): Promise<StandardizedListingData>;
}

/**
 * 兼容性接口 - 旧版 ExtractedListingData
 * @deprecated 使用 StandardizedListingData 替代
 */
export interface LegacyExtractContext {
  document: Document;
  url: URL;
  signals: PropertySignals;
  stage: ExtractionStage;
}

export interface LegacyListingExtractor {
  id: string;
  canHandle(url: URL, signals: PropertySignals): boolean;
  extract(ctx: ExtractContext): Promise<Partial<{
    source: { url: string; domain: string; parserType: string };
    title?: string;
    address?: string;
    price?: string;
    priceAmount?: number;
    pricePeriod?: string;
    bedrooms?: number | null;
    bathrooms?: number | null;
    parking?: number | null;
    propertyType?: string | null;
    description?: string;
    imageUrls?: string[];
    features?: string[];
    extractionConfidence: number;
  }> | null>;
}
