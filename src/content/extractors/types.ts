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
  dateOnMarket?: string;
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
