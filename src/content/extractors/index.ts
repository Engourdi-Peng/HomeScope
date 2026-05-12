/**
 * Extractor 工厂函数
 * 统一管理和路由所有网站 extractor
 */

import type { ListingExtractor } from './base';
import { RealEstateExtractor } from './realestate';
import { ZillowExtractor } from './zillow';

// Extractor 注册表（便于扩展新网站）
const EXTRACTOR_REGISTRY: ListingExtractor[] = [
  new RealEstateExtractor(),
  new ZillowExtractor(),
  // 未来可添加：
  // new RedfinExtractor(),
  // new RealtorExtractor(),
  // new DomainExtractor(),
];

/**
 * 根据 URL 获取对应的 extractor
 */
export function getExtractor(url: URL | string): ListingExtractor | null {
  const urlObj = typeof url === 'string' ? new URL(url) : url;
  return EXTRACTOR_REGISTRY.find(e => e.canHandle(urlObj)) ?? null;
}

/**
 * 获取所有支持的 source 列表
 */
export function getSupportedSources(): string[] {
  return EXTRACTOR_REGISTRY.map(e => e.source);
}

/**
 * 判断 URL 是否被支持
 */
export function isUrlSupported(url: URL | string): boolean {
  return getExtractor(url) !== null;
}

export { RealEstateExtractor, ZillowExtractor };
