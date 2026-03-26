/**
 * 房产信号检测器
 * 从 DOM 中提取"是否是房产页面"的判断依据，输出标准化的 PropertySignals
 */

import type { PropertyDetection, AnalysisTier } from '../../shared/types/analysis';
import { CONFIDENCE_THRESHOLDS } from '../../../shared/constants';
import { countPropertyImages } from '../utils/image';
import { getBodyText, isNonPropertyPage } from '../utils/text';
import { extractPrice, extractRooms } from '../utils/price';
import { KNOWN_PROPERTY_SITES } from '../../shared/constants';

export interface PropertySignals {
  imageCount: number;
  hasPrice: boolean;
  hasAddress: boolean;
  hasBedrooms: boolean;
  hasBathrooms: boolean;
  hasParking: boolean;
  hasDescription: boolean;
  hasPropertyType: boolean;
  domain: string;
  isKnownSite: boolean;
  isSPA: boolean;
  readyState: DocumentReadyState;
}

/** 房产页面关键词 */
const PROPERTY_KEYWORDS = [
  'property', 'rental', 'lease', 'apartment', 'house', 'unit',
  'studio', 'bedroom', 'tenant', 'landlord', 'inspection',
];

/** 物业相关版块关键词 */
const SECTION_KEYWORDS = [
  'gallery', 'floorplan', 'inspection', 'features', 'amenities',
  'description', 'details', 'floor plan',
];

/** 房源类型关键词 */
const PROPERTY_TYPE_KEYWORDS = [
  'House', 'Apartment', 'Unit', 'Townhouse', 'Villa', 'Studio',
  'Flat', 'Duplex', 'Terrace', 'Semi-detached',
];

/** 检测页面是否包含描述内容 */
function hasDescriptionContent(doc: Document): boolean {
  const selectors = [
    '[class*="description"]', '[class*="about"]', '[class*="detail"]',
    '[class*="body"]', '[data-testid*="description"]', 'article', 'main',
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const text = el.textContent || '';
      if (text.length > 80 && !text.toLowerCase().includes('cookie') && !text.toLowerCase().includes('sign in')) {
        return true;
      }
    }
  }
  return false;
}

/** 提取所有房产信号 */
export function detectPropertySignals(doc: Document): PropertySignals {
  const hostname = location.hostname;
  const bodyText = getBodyText(doc);
  const imageCount = countPropertyImages(doc);
  const { priceText } = extractPrice(bodyText);
  const rooms = extractRooms(bodyText);

  const knownSite = KNOWN_PROPERTY_SITES[hostname as keyof typeof KNOWN_PROPERTY_SITES];
  const isKnownSite = !!knownSite;

  // 地址格式检测：Suburb, STATE 1234
  const hasAddress = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,3}\s*\d{4}/.test(bodyText);

  // 房源类型检测
  const hasPropertyType = PROPERTY_TYPE_KEYWORDS.some(t => bodyText.includes(t));

  return {
    imageCount,
    hasPrice: !!priceText,
    hasAddress,
    hasBedrooms: rooms.bedrooms !== null,
    hasBathrooms: rooms.bathrooms !== null,
    hasParking: rooms.parking !== null,
    hasDescription: hasDescriptionContent(doc),
    hasPropertyType,
    domain: hostname,
    isKnownSite,
    isSPA: false,
    readyState: doc.readyState,
  };
}

/** 根据信号计算置信度评分 */
export function computeConfidence(signals: PropertySignals): number {
  let score = 0;

  // === 强信号 ===
  if (signals.imageCount >= 5) score += 0.3;
  else if (signals.imageCount >= 3) score += 0.2;
  else if (signals.imageCount >= 1) score += 0.05;

  if (signals.hasPrice) score += 0.3;
  if (signals.hasAddress) score += 0.15;
  if (signals.hasBedrooms || signals.hasBathrooms || signals.hasParking) score += 0.15;
  if (signals.hasDescription) score += 0.15;

  // === 中信号 ===
  if (signals.isKnownSite) score += 0.15;
  const title = document.title.toLowerCase();
  const keywordMatches = PROPERTY_KEYWORDS.filter(k => title.includes(k));
  if (keywordMatches.length >= 2) score += 0.1;

  const sectionMatches = SECTION_KEYWORDS.filter(k => getBodyText(document).toLowerCase().includes(k));
  if (sectionMatches.length > 0) score += 0.05;

  // === 排除项 ===
  if (isNonPropertyPage(document)) score -= 0.3;

  return Math.max(0, Math.min(1, score));
}

/** 判断分析等级 */
export function computeTier(score: number, signals: PropertySignals): AnalysisTier {
  if (score < CONFIDENCE_THRESHOLDS.MEDIUM) return 'none';

  const hasImages = signals.imageCount >= 3;
  const hasPrice = signals.hasPrice;
  const hasDesc = signals.hasDescription;
  const hasRooms = signals.hasBedrooms || signals.hasBathrooms || signals.hasParking;

  if ((hasImages && hasPrice && hasDesc) || (hasPrice && hasDesc && hasRooms)) {
    return 'full';
  }
  return 'partial';
}

/** 生成检测信号列表（用于调试） */
export function generateSignalList(signals: PropertySignals): string[] {
  const result: string[] = [];
  if (signals.imageCount >= 5) result.push('images>=5');
  else if (signals.imageCount >= 3) result.push('images>=3');
  else if (signals.imageCount >= 1) result.push('images>=1');
  if (signals.hasPrice) result.push('price');
  if (signals.hasAddress) result.push('address');
  if (signals.hasBedrooms || signals.hasBathrooms || signals.hasParking) result.push('bed_bath_car');
  if (signals.hasDescription) result.push('description');
  if (signals.isKnownSite) result.push('known_listing_path');
  return result;
}

/** 综合检测入口：对外暴露的 PropertyDetection */
export function detectPropertyPage(signals?: PropertySignals): PropertyDetection {
  const s = signals ?? detectPropertySignals(document);
  const score = computeConfidence(s);
  const tier = computeTier(score, s);
  const signalList = generateSignalList(s);

  return {
    score,
    signals: signalList,
    tier,
    canAnalyze: score >= CONFIDENCE_THRESHOLDS.MEDIUM && tier !== 'none',
  };
}
