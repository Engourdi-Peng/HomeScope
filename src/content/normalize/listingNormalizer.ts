/**
 * 标准化输出层
 * Layer D：所有 extractor 的结果统一转换为 ExtractedListingData
 */

import type { ExtractedListingData } from '../../../shared/types/analysis';
import type { PropertySignals } from '../detectors/propertySignals';
import { deduplicateImages } from '../utils/image';
import { CONFIDENCE_THRESHOLDS } from '../../../shared/constants';

export interface ExtractionStatus {
  isPropertyLike: boolean;
  extractionConfidence: number;
  completeness: 'high' | 'medium' | 'low';
  missingFields: string[];
}

/** 计算信息完整性 */
export function computeCompleteness(
  partial: Partial<ExtractedListingData>
): 'high' | 'medium' | 'low' {
  let count = 0;
  const total = 10;
  const fields: (keyof ExtractedListingData)[] = [
    'title', 'address', 'price', 'priceAmount', 'pricePeriod',
    'bedrooms', 'bathrooms', 'parking', 'description', 'imageUrls',
  ];
  for (const field of fields) {
    const val = partial[field];
    if (field === 'imageUrls') {
      if (Array.isArray(val) && val.length >= 3) count++;
    } else if (val !== undefined && val !== null && val !== '') {
      count++;
    }
  }
  const ratio = count / total;
  if (ratio >= 0.7) return 'high';
  if (ratio >= 0.4) return 'medium';
  return 'low';
}

/** 找出缺失的关键字段 */
export function findMissingFields(
  partial: Partial<ExtractedListingData>
): string[] {
  const missing: string[] = [];
  if (!partial.title) missing.push('title');
  if (!partial.address) missing.push('address');
  if (!partial.price && !partial.priceAmount) missing.push('price');
  if (partial.bedrooms === undefined || partial.bedrooms === null) missing.push('bedrooms');
  if (partial.bathrooms === undefined || partial.bathrooms === null) missing.push('bathrooms');
  if (partial.description) {
    if (partial.description.length < 50) missing.push('description (too short)');
  } else {
    missing.push('description');
  }
  const images = partial.imageUrls ?? [];
  if (images.length === 0) missing.push('images');
  return missing;
}

/** 判断是否是房产页面 */
export function computeIsPropertyLike(
  partial: Partial<ExtractedListingData>,
  signals?: PropertySignals
): boolean {
  const confidence = partial.extractionConfidence ?? 0;
  const hasPrice = !!(partial.price || partial.priceAmount);
  const hasDesc = !!(partial.description && partial.description.length > 30);
  const hasImages = (partial.imageUrls?.length ?? 0) >= 1;

  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return true;
  if (hasPrice && hasDesc) return true;
  if (hasImages && hasDesc) return true;

  if (signals) {
    return signals.imageCount >= 1 && signals.hasPrice;
  }

  return confidence >= CONFIDENCE_THRESHOLDS.MEDIUM;
}

/** 将 extractor 结果标准化为统一的 ExtractedListingData */
export function normalizeToListingData(
  partial: Partial<ExtractedListingData>,
  extractorId: string,
  url: string,
  signals?: PropertySignals
): ExtractedListingData {
  const domain = (() => {
    try { return new URL(url).hostname; }
    catch { return ''; }
  })();

  const status: ExtractionStatus = {
    isPropertyLike: computeIsPropertyLike(partial, signals),
    extractionConfidence: partial.extractionConfidence ?? 0,
    completeness: computeCompleteness(partial),
    missingFields: findMissingFields(partial),
  };

  return {
    source: {
      url,
      domain,
      parserType: extractorId === 'generic' ? 'generic' : 'site_specific',
      siteName: extractorId !== 'generic' ? extractorId : undefined,
    },
    status,
    title: partial.title,
    address: partial.address,
    priceText: partial.price,
    pricePeriod: partial.pricePeriod ?? 'unknown',
    priceAmount: partial.priceAmount,
    bedrooms: partial.bedrooms,
    bathrooms: partial.bathrooms,
    parking: partial.parking,
    propertyType: partial.propertyType ?? null,
    description: partial.description,
    imageUrls: deduplicateImages(partial.imageUrls ?? []),
    features: partial.features ?? [],
    rawText: partial.rawText,
    extractedAt: Date.now(),
  };
}
