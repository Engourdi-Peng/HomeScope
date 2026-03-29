/**
 * Slug 生成模块
 * 为分享页生成 SEO 友好的短 slug
 * 
 * 目标格式: /share/rockbank-vic-3-bedroom-rental-analysis-1271c1cf
 * 包含字段: suburb, state(可选), bedrooms, rental-analysis, shortId
 */

import { parseAddress, ParsedAddress } from './parseAddress';

/**
 * 字符串转换为 URL 友好的小写 slug
 */
function toSlug(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // 移除特殊字符
    .replace(/\s+/g, '-')          // 空格转连字符
    .replace(/-+/g, '-')           // 多个连字符合并
    .replace(/^-+|-+$/g, '');     // 移除首尾连字符
}

/**
 * 生成 6 位短 ID (从 UUID 中提取)
 */
function generateShortId(uuid: string): string {
  // 移除连字符并取最后 8 个字符
  const clean = uuid.replace(/-/g, '');
  return clean.slice(-8).toLowerCase();
}

/**
 * 生成简短的 shortId (6位，基于时间戳+随机)
 */
export function generateShortIdFromTimestamp(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 5);
  return `${prefix}${timestamp}${random}`.slice(-6);
}

/**
 * slug 生成选项
 */
export interface ShareSlugOptions {
  /** 原始地址字符串 */
  address?: string | null;
  /** 已解析的地址对象 (可选，与 address 二选一) */
  parsedAddress?: ParsedAddress;
  /** 卧室数量 */
  bedrooms?: number | null;
  /** 原始 UUID (用于生成 shortId) */
  uuid?: string;
  /** 自定义 shortId (优先级最高) */
  shortId?: string;
  /** 是否包含 state (默认 true) */
  includeState?: boolean;
}

/**
 * 生成分享页 slug
 * 
 * @param options - 生成选项
 * @returns slug 字符串，格式如 "rockbank-vic-3-bedroom-rental-analysis-1271c1cf"
 * 
 * @example
 * generateShareSlug({ address: "32 Bluebottle Parade, Rockbank, VIC 3335, AU", bedrooms: 3, uuid: "abc-123" })
 * // 返回: "rockbank-vic-3-bedroom-rental-analysis-1271c1cf"
 */
export function generateShareSlug(options: ShareSlugOptions): string {
  const {
    address,
    parsedAddress: providedParsedAddress,
    bedrooms,
    uuid,
    shortId: customShortId,
    includeState = true,
  } = options;
  
  // 解析地址
  const parsed = providedParsedAddress || parseAddress(address);
  
  // 生成 slug 部分
  const parts: string[] = [];
  
  // 1. suburb (必需)
  const suburbSlug = toSlug(parsed.suburb);
  if (suburbSlug) {
    parts.push(suburbSlug);
  }
  
  // 2. state (可选)
  if (includeState && parsed.state) {
    parts.push(parsed.state.toLowerCase());
  }
  
  // 3. bedrooms
  if (bedrooms && bedrooms > 0) {
    parts.push(`${bedrooms}-bedroom`);
  }
  
  // 4. rental-analysis (固定词)
  parts.push('rental-analysis');
  
  // 5. shortId (6位)
  let shortId: string;
  if (customShortId) {
    shortId = customShortId;
  } else if (uuid) {
    shortId = generateShortId(uuid);
  } else {
    shortId = generateShortIdFromTimestamp();
  }
  parts.push(shortId);
  
  return parts.join('-');
}

/**
 * 生成带路径前缀的完整 URL
 */
export function generateShareUrl(options: ShareSlugOptions): string {
  const slug = generateShareSlug(options);
  return `/share/${slug}`;
}

/**
 * 验证 slug 格式
 */
export function isValidShareSlug(slug: string): boolean {
  // 格式: suburb-state-N-bedroom-rental-analysis-xxxxxx
  const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-rental-analysis-[a-z0-9]{6,8}$/;
  return pattern.test(slug);
}
