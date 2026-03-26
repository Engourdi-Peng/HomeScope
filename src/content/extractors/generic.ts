/**
 * 通用房产解析器（兜底层）
 * 支持多国价格格式、多站点地址模式、多语言描述
 */

import type { ExtractedListingData } from '../../../shared/types/analysis';
import { ListingExtractor, ExtractContext } from './base';
import { extractPrice, normalizePricePeriod } from '../utils/price';
import { extractRooms } from '../utils/price';
import {
  extractFromPictureSources,
  extractFromImgTags,
  extractOgImage,
  extractFromScripts,
  deduplicateImages,
} from '../utils/image';
import { getText, getBodyText, findLongestParagraph, getMetaContent } from '../utils/text';

const PROPERTY_TYPE_KEYWORDS = [
  'House', 'Apartment', 'Unit', 'Townhouse', 'Villa', 'Studio',
  'Flat', 'Duplex', 'Terrace', 'Semi-detached',
];

const FEATURE_KEYWORDS = [
  'Air conditioning', 'Split system', 'Heating', 'Built-in wardrobe', 'Dishwasher',
  'Balcony', 'Garden', 'Garage', 'Carport', 'Pool', 'Spa', 'Gym', 'Pet friendly',
  'Furnished', 'Unfurnished', 'Study', 'Laundry', 'Secure', 'Alarm', 'Intercom',
];

export class GenericPropertyExtractor implements ListingExtractor {
  id = 'generic';

  canHandle() {
    return true; // 始终作为兜底
  }

  async extract(ctx: ExtractContext): Promise<Partial<ExtractedListingData>> {
    const { document, url } = ctx;
    const hostname = url.hostname;
    const bodyText = getBodyText(document);

    // --- 图片 ---
    const images = deduplicateImages([
      ...extractFromPictureSources(document),
      ...extractFromImgTags(document),
      ...(extractOgImage(document) ? [extractOgImage(document)!] : []),
      ...extractFromScripts(document),
    ]);

    // --- 价格 ---
    const { priceText, priceAmount, pricePeriod } = extractPrice(bodyText);

    // --- 地址 ---
    let address = '';
    const addrPatterns = [
      /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,3}\s*\d{4},?\s*(?:Australia)?/,
      /\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z][a-z]+(?:\s+[A-Z]{2,3})?\s*\d{4}/,
    ];
    for (const p of addrPatterns) {
      const m = bodyText.match(p);
      if (m) { address = m[0].trim(); break; }
    }

    // --- 房间信息 ---
    const rooms = extractRooms(bodyText);

    // --- 描述（多来源合并）---
    let description = '';
    const descSelectors = [
      'meta[name="description"]',
      'meta[property="og:description"]',
      '[class*="description"]',
      '[class*="about"]',
      '[class*="detail"]',
      '[class*="listing"]',
      'article',
      'main',
    ];
    for (const sel of descSelectors) {
      const content = sel.startsWith('meta')
        ? getMetaContent(document, sel.replace(/^meta\[(?:name|property)="([^"]+)"\]$/, '$1'))
        : getText(document, sel);
      if (
        content.length > 80 &&
        !content.toLowerCase().includes('cookie') &&
        !content.toLowerCase().includes('sign in') &&
        !content.toLowerCase().includes('login')
      ) {
        description = content;
        break;
      }
    }
    if (!description || description.length < 50) {
      const fallback = findLongestParagraph(document);
      if (fallback.length > 80) description = fallback;
    }

    // --- 标题 ---
    const ogTitle = getMetaContent(document, 'og:title');
    const title = ogTitle || document.title.replace(/\s*[-|\u2013]\s*[^-]+$/, '').trim();

    // --- 房源类型 ---
    let propertyType: string | null = null;
    for (const t of PROPERTY_TYPE_KEYWORDS) {
      if (bodyText.includes(t)) { propertyType = t; break; }
    }

    // --- 特色设施 ---
    const features = FEATURE_KEYWORDS.filter(k =>
      bodyText.toLowerCase().includes(k.toLowerCase())
    );

    // --- 置信度 ---
    let confidence = 0.2;
    if (images.length >= 3) confidence += 0.2;
    if (priceAmount) confidence += 0.15;
    if (description.length > 80) confidence += 0.15;
    if (rooms.bedrooms !== null) confidence += 0.1;
    if (address) confidence += 0.1;
    if (propertyType) confidence += 0.1;

    return {
      source: {
        url: url.href,
        domain: hostname,
        parserType: 'generic',
      },
      title: title || undefined,
      address: address || undefined,
      price: priceText || undefined,
      priceAmount: priceAmount || undefined,
      pricePeriod,
      bedrooms: rooms.bedrooms,
      bathrooms: rooms.bathrooms,
      parking: rooms.parking,
      propertyType,
      description: description || undefined,
      imageUrls: images.slice(0, 25),
      features: features.length ? features : undefined,
      extractionConfidence: Math.min(1, confidence),
    };
  }
}
