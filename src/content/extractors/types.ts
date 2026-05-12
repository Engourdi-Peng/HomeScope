/**
 * 标准化房源数据结构
 * 所有网站 extractor 统一输出此格式
 */

export type ListingSource = 'realestate-au' | 'zillow' | 'future-site';

/**
 * 标准化房源数据接口
 * 提取层输出的统一格式，source 字段必填
 */
export interface StandardizedListingData {
  // === 必填核心字段 ===
  source: ListingSource;
  url: string;

  // === 标准化公共字段 ===
  address: string;
  price: string;
  priceAmount?: number;
  pricePeriod?: 'week' | 'month' | 'year' | 'total';
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string;
  description: string;
  images: string[];

  // === 澳洲特有字段 ===
  carSpaces?: number | null;

  // === 美国特有字段 ===
  sqft?: number | null;
  zestimate?: string | null;
  rentZestimate?: string | null;
  yearBuilt?: number | null;
  lotSize?: string | null;
  hoaFee?: string | null;
  propertyTax?: string | null;
  schoolRatings?: SchoolRating[];
  daysOnZillow?: number | null;

  // === 通用扩展 ===
  facts?: Record<string, unknown>;
  rawJson?: unknown;

  // === 提取元数据 ===
  extractionConfidence: number;
  extractedAt: string;
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
