/**
 * 价格提取工具
 */

export type PricePeriod = 'week' | 'month' | 'year' | 'unknown';

export function normalizePricePeriod(text: string): PricePeriod {
  const t = text.toLowerCase();
  if (t.includes('week') || t.includes('pw') || t.includes('/w')) return 'week';
  if (t.includes('month') || t.includes('/m') || t.includes('pcm')) return 'month';
  if (t.includes('year') || t.includes('/y') || t.includes('annum')) return 'year';
  return 'unknown';
}

export function extractPriceAmount(text: string): number | null {
  const match = text.match(/\$\s*([\d,]+)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ''), 10);
}

/** 多国价格格式正则 */
const PRICE_PATTERNS: RegExp[] = [
  /\$\s*([\d,]+)\s*(?:\/|per|pw|pcm|month|week|annum|year|\$\s*)?/gi,
  /AUD\s*([\d,]+)\s*(?:\/|per|pw|week|month)/gi,
  /USD\s*([\d,]+)\s*(?:\/|per|pw|month)/gi,
  /GBP\s*([\d,]+)\s*(?:\/|per|pw|month)/gi,
  /([\d,]+)\s*(?:per|pw|week|month|year)\s*(?:rent|price|pw|pcm)/gi,
  /\$\s*([\d,]+)\s*(?:\/|per|pw|pcm|month|week)/gi,
];

export function extractPrice(text: string): { priceText: string; priceAmount: number | null; pricePeriod: PricePeriod } {
  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const priceText = match[0].trim();
      return {
        priceText,
        priceAmount: extractPriceAmount(priceText),
        pricePeriod: normalizePricePeriod(priceText),
      };
    }
  }
  return { priceText: '', priceAmount: null, pricePeriod: 'unknown' };
}

export interface RoomCounts {
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
}

/** 从文本中提取房间数量 */
export function extractRooms(text: string): RoomCounts {
  const result: RoomCounts = { bedrooms: null, bathrooms: null, parking: null };

  // 多种格式：2 bed, 2 Bedroom, 2-bed, 2BD
  const bedMatch = text.match(/(\d+)\s*(?:bed(?:room)?s?|BD)/i);
  const bathMatch = text.match(/(\d+)\s*(?:bath(?:room)?s?|BA)/i);
  const carRe = /(\d+)\s*(?:car(?:port|space)?s?|parking|garage)\b/gi;
  const carVals: number[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = carRe.exec(text)) !== null) {
    const n = parseInt(cm[1], 10);
    if (n >= 1 && n <= 20) carVals.push(n);
  }
  if (carVals.length) result.parking = Math.max(...carVals);

  if (bedMatch) result.bedrooms = parseInt(bedMatch[1], 10);
  if (bathMatch) result.bathrooms = parseInt(bathMatch[1], 10);

  return result;
}
