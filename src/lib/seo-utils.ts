/**
 * SEO 工具函数
 * 用于生成分享页面的 slug、title、description 和 SEO 内容块
 */

import type { AnalysisResult } from '../types';
import { parseAddress } from '../../shared/address';

/**
 * 从完整地址中提取 suburb/location
 * 
 * 澳洲地址格式: "6 Edinburgh Street, Richmond, VIC 3121, AU"
 * 地址段:
 *   [0] 门牌号 + 街道: "6 Edinburgh Street"
 *   [1] Suburb: "Richmond"
 *   [2] 州 + 邮编: "VIC 3121"
 *   [3] 国家: "AU"
 * 
 * @param address 完整地址，如 "6 Edinburgh Street, Richmond, VIC 3121, AU"
 * @returns 提取的 suburb 或 null（如果解析失败）
 * 
 * @example
 * extractSuburbFromAddress("6 Edinburgh Street, Richmond, VIC 3121, AU")
 * // => "Richmond"
 * 
 * extractSuburbFromAddress("123 Main St, Sydney, NSW 2000")
 * // => "Sydney"
 * 
 * extractSuburbFromAddress("invalid")
 * // => null
 */
export function extractSuburbFromAddress(address: string | null | undefined): string | null {
  return parseAddress(address).suburb;
}

/**
 * Slug 输入参数
 */
export interface SlugInput {
  suburb?: string | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  reportId: string | number;
  reportMode?: 'rent' | 'sale';
}

/**
 * SEO 字段输入参数
 */
export interface SEOFieldsInput {
  suburb?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  weeklyRent?: number | null;
  askingPrice?: number | null;
  verdict?: string | null;
  reportId: string | number;
  reportMode?: 'rent' | 'sale';
}

/**
 * SEO 内容块输入参数
 */
export interface SEOContentInput {
  suburb?: string | null;
  bedrooms?: number | null;
  whatLooksGood: string[];
  riskSignals: string[];
  verdict?: string | null;
  quickSummary?: string | null;
}

/**
 * 将字符串转换为 URL 安全的 slug
 * - 全小写
 * - 空格转 -
 * - 去掉特殊字符
 */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 生成语义化的分享 slug
 * 
 * 规则:
 * - 优先级: suburb > bedrooms > propertyType > reportId
 * - 全小写，空格转 -
 * - 不伪造 suburb
 * - slug 一旦生成后尽量稳定
 * 
 * @example
 * generateShareSlug({ suburb: "Sydney", bedrooms: 2, propertyType: "apartment", reportId: 58 })
 * // => "sydney-2-bedroom-apartment-rental-analysis-58"
 * 
 * generateShareSlug({ bedrooms: 2, reportId: 59 })
 * // => "2-bedroom-rental-analysis-59"
 * 
 * generateShareSlug({ reportId: 60 })
 * // => "rental-analysis-60"
 */
export function generateShareSlug(input: SlugInput): string {
  const parts: string[] = [];

  // 添加 suburb（如果存在）
  if (input.suburb) {
    parts.push(toSlug(input.suburb));
  }

  // 添加 bedrooms（如果存在）
  if (input.bedrooms != null) {
    parts.push(`${input.bedrooms}-bedroom`);
  }

  // 添加 propertyType（如果存在）
  if (input.propertyType) {
    parts.push(toSlug(input.propertyType));
  }

  // 添加通用描述和 reportId
  parts.push(input.reportMode === 'sale' ? 'sale-analysis' : 'rental-analysis');
  parts.push(String(input.reportId));

  return parts.join('-');
}

/**
 * 生成 SEO title 和 description
 * 
 * Title 规则:
 * - 优先模板: "Is this rental worth it in {suburb}? {bedrooms} bedroom analysis"
 * - 无 suburb: "Is this rental worth it? {bedrooms} bedroom analysis"
 * - 无 bedrooms: "Rental property analysis | HomeScope"
 * 
 * Description 规则:
 * - 优先模板: "AI rental analysis of a {bedrooms}-bedroom property in {suburb}. Review the pros, cons, risks and final verdict before applying."
 * - 自动降级，不硬拼假信息
 */
export function generateSEOFields(input: SEOFieldsInput): { seo_title: string; seo_description: string } {
  const { suburb, bedrooms, bathrooms, weeklyRent, askingPrice, verdict, reportMode } = input;
  const isRent = reportMode !== 'sale';

  // 生成 SEO title
  let seo_title: string;

  if (isRent) {
    if (suburb && bedrooms) {
      seo_title = `Is this rental worth it in ${suburb}? ${bedrooms} bedroom analysis`;
    } else if (bedrooms) {
      seo_title = `Is this rental worth it? ${bedrooms} bedroom analysis`;
    } else {
      seo_title = `Rental property analysis | HomeScope`;
    }
  } else {
    if (suburb && bedrooms) {
      seo_title = `Is this property worth buying in ${suburb}? ${bedrooms} bedroom analysis`;
    } else if (bedrooms) {
      seo_title = `Is this property worth buying? ${bedrooms} bedroom analysis`;
    } else {
      seo_title = `Property purchase analysis | HomeScope`;
    }
  }

  // 生成 SEO description
  let seo_description: string;

  if (isRent) {
    if (suburb && bedrooms) {
      seo_description = `AI rental analysis of a ${bedrooms}-bedroom property in ${suburb}. `;
      if (bathrooms) {
        seo_description += `${bathrooms} bathroom, `;
      }
      if (weeklyRent) {
        seo_description += `$${weeklyRent}/week. `;
      }
      seo_description += 'Review the pros, cons, risks and final verdict before applying.';
    } else if (bedrooms) {
      seo_description = `AI rental analysis of a ${bedrooms}-bedroom property. `;
      if (bathrooms) {
        seo_description += `${bathrooms} bathroom, `;
      }
      if (weeklyRent) {
        seo_description += `$${weeklyRent}/week. `;
      }
      seo_description += 'Review the pros, cons, risks and final verdict before applying.';
    } else {
      seo_description = 'AI-powered rental property analysis. Review detailed pros, cons, risks and expert verdict before making your decision.';
    }
  } else {
    if (suburb && bedrooms) {
      seo_description = `AI purchase analysis of a ${bedrooms}-bedroom property in ${suburb}. `;
      if (bathrooms) {
        seo_description += `${bathrooms} bathroom, `;
      }
      if (askingPrice) {
        seo_description += `$${askingPrice.toLocaleString()}. `;
      }
      seo_description += 'Review the pros, cons, risks and final verdict before making an offer.';
    } else if (bedrooms) {
      seo_description = `AI purchase analysis of a ${bedrooms}-bedroom property. `;
      if (bathrooms) {
        seo_description += `${bathrooms} bathroom, `;
      }
      if (askingPrice) {
        seo_description += `$${askingPrice.toLocaleString()}. `;
      }
      seo_description += 'Review the pros, cons, risks and final verdict before making an offer.';
    } else {
      seo_description = 'AI-powered property purchase analysis. Review detailed pros, cons, risks and expert verdict before making your decision.';
    }
  }

  return {
    seo_title: seo_title.slice(0, 60), // SEO title 通常不超过 60 字符
    seo_description: seo_description.slice(0, 160), // SEO description 通常不超过 160 字符
  };
}

/**
 * 从 AnalysisResult 中提取 SEO 相关信息
 */
export function extractSEOData(result: AnalysisResult): {
  suburb?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  weeklyRent?: number | null;
  propertyType?: string | null;
} {
  // 尝试从各种字段中提取 suburb 信息
  let suburb: string | null = null;
  
  // 从 full_result 中提取 suburb
  if (result.inspectionFit) {
    // inspectionFit 可能包含区域信息
  }
  
  // 从 quickSummary 或其他字段中尝试提取 suburb
  const quickSummary = result.quickSummary || '';
  const whatLooksGood = result.whatLooksGood?.join(' ') || '';
  const riskSignals = result.riskSignals?.join(' ') || '';
  const allText = `${quickSummary} ${whatLooksGood} ${riskSignals}`;
  
  // 常见的澳洲郊区模式
  const suburbMatch = allText.match(/in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)|([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+area/i);
  if (suburbMatch) {
    suburb = suburbMatch[1] || suburbMatch[2];
  }

  // 提取 bedrooms
  let bedrooms: number | null = null;
  const bedroomMatch = allText.match(/(\d+)\s*[- ]?\s*bedroom/i);
  if (bedroomMatch) {
    bedrooms = parseInt(bedroomMatch[1], 10);
  }

  // 提取 bathrooms
  let bathrooms: number | null = null;
  const bathroomMatch = allText.match(/(\d+)\s*[- ]?\s*bathroom/i);
  if (bathroomMatch) {
    bathrooms = parseInt(bathroomMatch[1], 10);
  }

  // 提取 weeklyRent
  let weeklyRent: number | null = null;
  const rentMatch = allText.match(/\$(\d+(?:,\d{3})*)\s*(?:per\s+)?week/i) 
    || allText.match(/(\d+(?:,\d{3})*)\s*(?:per\s+)?week/i);
  if (rentMatch) {
    weeklyRent = parseInt(rentMatch[1].replace(',', ''), 10);
  }

  // 提取 propertyType
  let propertyType: string | null = null;
  const propertyMatch = allText.match(/\b(apartment|studio|house|unit|villa|duplex|townhouse)\b/i);
  if (propertyMatch) {
    propertyType = propertyMatch[1];
  }

  return {
    suburb,
    bedrooms,
    bathrooms,
    weeklyRent,
    propertyType,
  };
}

/**
 * 生成页面底部的 SEO 内容块
 * 
 * 内容基于报告实际数据生成，不编造信息
 */
export function generateSEOContentBlock(input: SEOContentInput): string {
  const { suburb, bedrooms, whatLooksGood, riskSignals, verdict, quickSummary } = input;

  // 生成标题
  let title = 'Rental analysis summary';
  if (suburb && bedrooms) {
    title = `${suburb} ${bedrooms} bedroom rental analysis summary`;
  } else if (bedrooms) {
    title = `${bedrooms} bedroom rental analysis summary`;
  }

  // 生成开头段落
  let intro = 'This rental property has been reviewed using AI based on the listing photos and description provided.';
  if (suburb) {
    intro = `This rental property in ${suburb} has been reviewed using AI based on the listing photos and description provided.`;
  }

  // 收集优点
  const pros = whatLooksGood?.slice(0, 4) || [];
  
  // 收集缺点/风险
  const cons = riskSignals?.slice(0, 4) || [];

  // 构建 markdown 内容
  let content = `## ${title}\n\n${intro}\n\n`;

  if (pros.length > 0) {
    content += '### What stands out\n';
    pros.forEach((pro) => {
      content += `- ${pro}\n`;
    });
    content += '\n';
  }

  if (cons.length > 0) {
    content += '### Possible concerns\n';
    cons.forEach((con) => {
      content += `- ${con}\n`;
    });
    content += '\n';
  }

  if (verdict) {
    content += '### Final verdict\n';
    content += `${verdict}\n`;
  }

  return content;
}

/**
 * 从报告数据生成完整的 SEO 信息
 */
export function generateFullSEO(
  reportId: string | number,
  result: AnalysisResult,
  existingSEO?: { seo_title?: string | null; seo_description?: string | null; share_slug?: string | null }
): {
  seo_slug: string;
  seo_title: string;
  seo_description: string;
} {
  // 如果已有 SEO 数据且 slug 存在，直接返回（保持 slug 稳定性）
  if (existingSEO?.share_slug && existingSEO?.seo_title && existingSEO?.seo_description) {
    return {
      seo_slug: existingSEO.share_slug,
      seo_title: existingSEO.seo_title,
      seo_description: existingSEO.seo_description,
    };
  }

  // 提取报告数据
  const extracted = extractSEOData(result);

  // 生成 slug
  const seo_slug = generateShareSlug({
    suburb: extracted.suburb,
    bedrooms: extracted.bedrooms,
    propertyType: extracted.propertyType,
    reportId,
  });

  // 生成 title 和 description
  const { seo_title, seo_description } = generateSEOFields({
    suburb: extracted.suburb,
    bedrooms: extracted.bedrooms,
    bathrooms: extracted.bathrooms,
    weeklyRent: extracted.weeklyRent,
    verdict: result.verdict,
    reportId,
  });

  return {
    seo_slug,
    seo_title,
    seo_description,
  };
}

/**
 * 生成 sitemap URL 条目
 */
export interface SitemapEntry {
  url: string;
  lastmod: string;
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

/**
 * 为公开报告生成 sitemap 条目
 */
export function generateSitemapEntry(
  slug: string,
  sharedAt?: string | null,
  updatedAt?: string
): SitemapEntry {
  const baseUrl = 'https://www.tryhomescope.com';
  
  // 使用 shared_at 或 updated_at 作为 lastmod
  const lastmod = sharedAt 
    ? new Date(sharedAt).toISOString().split('T')[0]
    : (updatedAt ? new Date(updatedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

  return {
    url: `${baseUrl}/share/${slug}`,
    lastmod,
    changefreq: 'weekly',
    priority: 0.8,
  };
}

/**
 * 生成 XML sitemap
 */
export function generateSitemapXML(entries: SitemapEntry[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  entries.forEach((entry) => {
    xml += '  <url>\n';
    xml += `    <loc>${entry.url}</loc>\n`;
    xml += `    <lastmod>${entry.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${entry.changefreq}</changefreq>\n`;
    xml += `    <priority>${entry.priority}</priority>\n`;
    xml += '  </url>\n';
  });

  xml += '</urlset>';
  return xml;
}
