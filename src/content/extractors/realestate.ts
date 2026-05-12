/**
 * realestate.com.au 专用解析器
 * 基于原有 content.js 的 realestateExtractor 重构
 * 输出标准化数据格式
 */

import type { ListingExtractor, ExtractContext } from './base';
import type { StandardizedListingData } from './types';
import { extractPrice, extractPriceAmount, normalizePricePeriod } from '../utils/price';
import { extractRooms } from '../utils/price';
import { extractFromPictureSources, extractOgImage, deduplicateImages } from '../utils/image';
import { getText, getBodyText } from '../utils/text';

const REALESTATE_HOSTNAME = 'realestate.com.au';
const PROPERTY_TYPE_KEYWORDS = [
  'House', 'Apartment', 'Unit', 'Townhouse', 'Villa', 'Studio',
  'Flat', 'Duplex', 'Terrace',
];

export class RealEstateExtractor implements ListingExtractor {
  readonly source = 'realestate-au' as const;

  canHandle(url: URL): boolean {
    return url.hostname.includes(REALESTATE_HOSTNAME);
  }

  async extract(ctx: ExtractContext): Promise<StandardizedListingData> {
    const { document, url } = ctx;
    const bodyText = getBodyText(document);

    // --- 价格 ---
    const priceText = (() => {
      for (const sel of [
        '[data-testid="listing-details-price"]',
        '.price',
        '[class*="price"]',
      ]) {
        const t = getText(document, sel);
        if (t.includes('$')) return t;
      }
      // 从正文匹配
      const { priceText: p } = extractPrice(bodyText);
      return p;
    })();

    const priceAmount = extractPriceAmount(priceText);
    const pricePeriod = normalizePricePeriod(priceText);
    const rooms = extractRooms(bodyText);

    // --- 地址 ---
    const addressFull = getText(document, '[data-testid="listing-details-address"]');
    const addrMatch = addressFull.match(/^(.+?),\s*(.+?),\s*([A-Z]{2,3})\s*(\d{4})/);
    let suburb = '', state = '', postcode = '', street = addressFull;
    if (addrMatch) {
      street = addrMatch[1];
      suburb = addrMatch[2];
      state = addrMatch[3];
      postcode = addrMatch[4];
    }

    // --- 图片（优先 realestate 域名）---
    const images: string[] = [];
    // picture/source srcset
    for (const source of document.querySelectorAll('picture source')) {
      const srcset = source.getAttribute('srcset') || '';
      srcset.split(',')
        .map(s => s.trim().split(' ')[0])
        .filter(u => u.startsWith('http') && u.includes(REALESTATE_HOSTNAME))
        .forEach(u => {
          images.push(u.replace(/\?\.*$/, '').replace(/\/\d+px\//, '/1200px/'));
        });
    }
    // img 标签
    for (const img of document.querySelectorAll('img')) {
      const src = img.src || img.getAttribute('data-src') || '';
      if (src.includes(REALESTATE_HOSTNAME) && !src.match(/logo|icon|avatar|[\/](\d{1,3})px[\/]/)) {
        images.push(src.replace(/\?\.*$/, '').replace(/\/\d+px\//, '/1200px/'));
      }
    }
    // JSON 数据中的图片
    try {
      const jsonImgs = bodyText.match(
        /(https?:\/\/[^\s"']+realestate[^\s"',]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"']*)?)/gi
      );
      if (jsonImgs) jsonImgs.forEach(u => images.push(u.split('?')[0]));
    } catch {}

    const finalImages = deduplicateImages(images);

    // --- 描述 ---
    let description = '';
    for (const sel of [
      '[data-testid="description"]',
      '.description-content',
      '.listing-description',
      '[class*="description"]',
    ]) {
      const t = getText(document, sel);
      if (t.length > 50) { description = t; break; }
    }
    if (!description) {
      for (const p of document.querySelectorAll('p')) {
        const t = p.textContent?.trim() || '';
        if (t.length > 100 && !t.toLowerCase().includes('cookie')) {
          description = t; break;
        }
      }
    }

    // --- 房源类型 ---
    let propertyType = '';
    for (const sel of ['[data-testid="property-type"]', '.property-type']) {
      const t = getText(document, sel);
      if (t) { propertyType = t; break; }
    }
    if (!propertyType) {
      for (const t of PROPERTY_TYPE_KEYWORDS) {
        if (bodyText.includes(t)) { propertyType = t; break; }
      }
    }

    // --- 特色设施 ---
    const features: string[] = [];
    for (const sel of ['.features-list li', '.property-features li', '[data-testid="features"] li']) {
      for (const li of document.querySelectorAll(sel)) {
        const t = li.textContent?.trim() || '';
        if (t.length < 100) features.push(t);
      }
    }

    // --- 标题 ---
    const title = document.title.replace(/\s*-\s*realestate\.com\.au.*$/i, '').trim();

    // --- 置信度 ---
    let confidence = 0.3;
    if (priceAmount) confidence += 0.15;
    if (finalImages.length >= 3) confidence += 0.2;
    if (description.length > 50) confidence += 0.15;
    if (rooms.bedrooms != null) confidence += 0.1;
    if (propertyType) confidence += 0.1;

    // 返回标准化格式
    return {
      source: 'realestate-au',
      url: url.href,
      address: addressFull || '',
      price: priceText || '',
      priceAmount,
      pricePeriod: pricePeriod as StandardizedListingData['pricePeriod'],
      bedrooms: rooms.bedrooms ?? null,
      bathrooms: rooms.bathrooms ?? null,
      carSpaces: rooms.parking ?? null,
      propertyType: propertyType || '',
      description: description || '',
      images: finalImages.slice(0, 40),
      // 澳洲特有
      facts: {
        suburb,
        state,
        postcode,
        features: features.length ? [...new Set(features)].slice(0, 20) : undefined,
        title,
      },
      // 提取元数据
      extractionConfidence: Math.min(1, confidence),
      extractedAt: new Date().toISOString(),
    };
  }
}
