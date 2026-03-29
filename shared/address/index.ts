/**
 * 地址解析与 Slug 生成工具模块
 * 
 * @example
 * import { parseAddress, generateShareSlug } from '~shared/address';
 * 
 * // 解析地址
 * const parsed = parseAddress("32 Bluebottle Parade, Rockbank, VIC 3335, AU");
 * // { street: "32 Bluebottle Parade", suburb: "Rockbank", state: "VIC", postcode: "3335", country: "AU", raw: "..." }
 * 
 * // 生成 slug
 * const slug = generateShareSlug({ address: "...", bedrooms: 3, uuid: "..." });
 * // "rockbank-vic-3-bedroom-rental-analysis-1271c1cf"
 */

// 地址解析
export { parseAddress, extractSuburb, type ParsedAddress } from './parseAddress';

// Slug 生成
export {
  generateShareSlug,
  generateShareUrl,
  generateShortIdFromTimestamp,
  isValidShareSlug,
  type ShareSlugOptions,
} from './generateSlug';
