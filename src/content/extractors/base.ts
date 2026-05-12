/**
 * 提取器接口定义
 * Layer C（数据提取层）的核心抽象
 */

import type { StandardizedListingData, ListingSource } from './types';
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
