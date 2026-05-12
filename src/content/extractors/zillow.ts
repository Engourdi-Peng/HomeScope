/**
 * Zillow 专用解析器
 * 支持 zillow.com 的房源详情页
 * 
 * 提取策略（优先级）：
 * 1. __NEXT_DATA__ JSON（最稳定）
 * 2. hdpApolloPreloadedData JSON（详细页）
 * 3. data-testid 选择器
 * 4. 文本正则搜索（兜底）
 */

import type { ListingExtractor, ExtractContext } from './base';
import type { StandardizedListingData, SchoolRating } from './types';
import { getText } from '../utils/text';

const ZILLOW_HOSTNAME = 'zillow.com';

interface ZillowRawData {
  address?: string;
  price?: string;
  priceAmount?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: string;
  yearBuilt?: number;
  propertyType?: string;
  description?: string;
  photoUrls?: string[];
  zestimate?: string;
  rentZestimate?: string;
  hoaFee?: string;
  propertyTax?: string;
  schoolRatings?: SchoolRating[];
  daysOnZillow?: number;
}

export class ZillowExtractor implements ListingExtractor {
  readonly source = 'zillow' as const;

  canHandle(url: URL): boolean {
    return url.hostname.includes(ZILLOW_HOSTNAME) && (
      url.pathname.includes('/homedetails/') ||
      url.pathname.includes('/condo/') ||
      url.pathname.includes('/townhouse/') ||
      url.pathname.includes('/rent/') ||
      url.pathname.includes('/lot/')
    );
  }

  async extract(ctx: ExtractContext): Promise<StandardizedListingData> {
    // 尝试多种提取策略
    let rawData = this.extractFromNextData(ctx.document);
    
    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromApolloData(ctx.document) };
    }
    
    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromTestId(ctx.document) };
    }
    
    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromText(ctx.document, ctx.url) };
    }

    // 如果仍未提取到数据，抛出警告但仍返回
    if (!rawData.address && !rawData.price) {
      console.warn('[ZillowExtractor] Failed to extract data with any strategy');
    }

    // 计算置信度
    const confidence = this.calculateConfidence(rawData);

    // 标准化输出
    return {
      source: 'zillow',
      url: ctx.url.href,
      address: rawData.address || '',
      price: rawData.price || '',
      priceAmount: rawData.priceAmount,
      pricePeriod: this.determinePricePeriod(ctx.url.href),
      bedrooms: rawData.bedrooms ?? null,
      bathrooms: rawData.bathrooms ?? null,
      propertyType: rawData.propertyType || '',
      description: rawData.description || '',
      images: this.processImages(rawData.photoUrls || []),
      
      // Zillow 特有
      sqft: rawData.sqft ?? null,
      zestimate: rawData.zestimate,
      rentZestimate: rawData.rentZestimate,
      yearBuilt: rawData.yearBuilt ?? null,
      lotSize: rawData.lotSize,
      hoaFee: rawData.hoaFee,
      propertyTax: rawData.propertyTax,
      schoolRatings: rawData.schoolRatings,
      daysOnZillow: rawData.daysOnZillow ?? null,
      
      // 提取元数据
      extractionConfidence: confidence,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * 策略1: 解析 __NEXT_DATA__ JSON（最稳定）
   */
  private extractFromNextData(doc: Document): Partial<ZillowRawData> {
    try {
      const script = doc.querySelector('script[id="__NEXT_DATA__"]');
      if (!script) return {};
      
      const data = JSON.parse(script.textContent);
      const props = data?.props?.pageProps ?? data?.props ?? data;
      
      // 尝试多个可能的数据路径
      const propertyData = 
        props?.propertyData ??
        props?.homeDetailPage ??
        props?.hdpApolloData ??
        props?.data?.searchResults ??
        props?.ForSaleShoppingPage ??
        props;
      
      if (!propertyData) return {};

      // 提取地址
      const address = this.extractAddress(propertyData);
      
      // 提取价格
      const price = this.extractPrice(propertyData);
      
      // 提取房间信息
      const bedrooms = propertyData.bedrooms ?? propertyData.beds ?? propertyData.numBeds;
      const bathrooms = propertyData.bathrooms ?? propertyData.beds ?? propertyData.numBaths;
      const sqft = propertyData.sqft ?? propertyData.livingArea ?? propertyData.area;
      
      // 提取其他字段
      const yearBuilt = propertyData.yearBuilt ?? propertyData.year_built;
      const lotSize = propertyData.lotSize ?? propertyData.lot_Size ?? propertyData.lot_size;
      const propertyType = propertyData.propertyType ?? propertyData.type ?? propertyData.homeType;
      const description = propertyData.description ?? propertyData.rawDescription ?? propertyData.editableDescription?.section ?? '';
      
      // 提取 Zillow 特有数据
      const zestimate = propertyData.zestimate ?? propertyData.zestimateValue;
      const rentZestimate = propertyData.rentZestimate ?? propertyData.rentZestimateValue;
      const hoaFee = propertyData.hoaFee ?? propertyData.hoa_fee;
      const propertyTax = propertyData.annualTax ?? propertyData.propertyTax ?? propertyData.taxAssessment;
      
      // 提取学校评分
      const schoolRatings = this.extractSchoolRatings(propertyData);
      
      // 提取在售天数
      const daysOnZillow = propertyData.daysOnZillow ?? propertyData.daysOnMarket ?? propertyData.listingAge;
      
      // 提取图片
      const photoUrls = this.extractPhotoUrls(propertyData);

      return {
        address,
        price,
        priceAmount: this.parsePrice(price),
        bedrooms,
        bathrooms,
        sqft,
        lotSize,
        yearBuilt,
        propertyType,
        description,
        photoUrls,
        zestimate,
        rentZestimate,
        hoaFee,
        propertyTax,
        schoolRatings,
        daysOnZillow,
      };
    } catch (e) {
      console.warn('[ZillowExtractor] Failed to parse __NEXT_DATA__:', e);
      return {};
    }
  }

  /**
   * 策略2: 解析 Apollo Preloaded Data
   */
  private extractFromApolloData(doc: Document): Partial<ZillowRawData> {
    try {
      const scripts = doc.querySelectorAll('script[type="application/json"]');
      
      for (const script of scripts) {
        const id = script.id?.toLowerCase() || '';
        
        // 查找包含房源数据的脚本
        if (id.includes('hdpapollo') || id.includes('preloaded') || id.includes('hdpmapollodata')) {
          const data = JSON.parse(script.textContent);
          
          // 递归搜索有用数据
          const found = this.deepSearch(data, ['price', 'address', 'beds', 'baths', 'sqft', 'zestimate']);
          
          if (found.address || found.price) {
            return {
              address: found.address,
              price: found.price,
              priceAmount: this.parsePrice(found.price),
              bedrooms: found.beds,
              bathrooms: found.baths,
              sqft: found.sqft,
              zestimate: found.zestimate,
            };
          }
        }
      }
      
      return {};
    } catch (e) {
      console.warn('[ZillowExtractor] Failed to parse Apollo data:', e);
      return {};
    }
  }

  /**
   * 策略3: 使用 data-testid 选择器
   */
  private extractFromTestId(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // 地址
    const addressEl = doc.querySelector('[data-testid="address"]') ??
                      doc.querySelector('h1[data-testid="address"]') ??
                      doc.querySelector('address[data-testid="street-address"]');
    if (addressEl) {
      data.address = addressEl.textContent?.trim() || '';
    }

    // 价格
    const priceEl = doc.querySelector('[data-testid="price"]') ??
                    doc.querySelector('[data-testid="list-price"]') ??
                    doc.querySelector('[class*="price"] span');
    if (priceEl) {
      data.price = priceEl.textContent?.trim() || '';
      data.priceAmount = this.parsePrice(data.price);
    }

    // 床/浴/面积
    const bedBathEl = doc.querySelector('[data-testid="bed-bath-beyond"]') ??
                      doc.querySelector('[data-testid="bed-bath-sqft"]');
    if (bedBathEl) {
      const text = bedBathEl.textContent || '';
      const bedMatch = text.match(/(\d+)\s*bed/);
      const bathMatch = text.match(/(\d+(?:\.\d+)?)\s*bath/);
      const sqftMatch = text.match(/([\d,]+)\s*sqft/);
      
      if (bedMatch) data.bedrooms = parseInt(bedMatch[1]);
      if (bathMatch) data.bathrooms = parseFloat(bathMatch[1]);
      if (sqftMatch) data.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
    }

    // 描述
    const descEl = doc.querySelector('[data-testid="description"]') ??
                   doc.querySelector('[data-testid="structured-property-meta"]');
    if (descEl) {
      data.description = descEl.textContent?.trim() || '';
    }

    return data;
  }

  /**
   * 策略4: 文本正则搜索（兜底）
   */
  private extractFromText(doc: Document, url: URL): Partial<ZillowRawData> {
    const bodyText = doc.body?.textContent || '';
    const data: Partial<ZillowRawData> = {};

    // 地址：从 h1 或 title 提取
    const h1 = doc.querySelector('h1');
    if (h1) {
      data.address = h1.textContent?.trim() || '';
    }

    // 价格正则
    const priceMatch = bodyText.match(/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month))?/);
    if (priceMatch) {
      data.price = priceMatch[0];
      data.priceAmount = this.parsePrice(data.price);
    }

    // 床/浴正则
    const bedMatch = bodyText.match(/(\d+)\s*(?:bed(?:s|room)?|bd)/i);
    const bathMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:s)?|ba)/i);
    const sqftMatch = bodyText.match(/([\d,]+)\s*sq\s*ft|([\d,]+)\s*sqft/i);
    
    if (bedMatch) data.bedrooms = parseInt(bedMatch[1]);
    if (bathMatch) data.bathrooms = parseFloat(bathMatch[1]);
    if (sqftMatch) {
      data.sqft = parseInt((sqftMatch[1] || sqftMatch[2]).replace(/,/g, ''));
    }

    // 年份正则
    const yearMatch = bodyText.match(/built\s+in\s+(\d{4})/i) ??
                      bodyText.match(/year\s*built[:\s]*(\d{4})/i);
    if (yearMatch) data.yearBuilt = parseInt(yearMatch[1]);

    return data;
  }

  /**
   * 从 propertyData 中提取地址
   */
  private extractAddress(data: Record<string, unknown>): string {
    // 多个可能的地址字段
    const addressFields = [
      data?.streetAddress,
      data?.address,
      data?.formattedAddress,
      data?.location?.address,
      data?.hdpData?.homeInfo?.streetAddress,
      data?.zpid ? `${data?.street} ${data?.city} ${data?.state} ${data?.zipcode}` : null,
    ];

    for (const addr of addressFields) {
      if (addr && typeof addr === 'string' && addr.length > 5) {
        return addr;
      }
    }

    // 尝试拼接
    const parts = [
      data?.street,
      data?.city,
      data?.state,
      data?.zipcode,
    ].filter(Boolean);
    
    return parts.length > 0 ? parts.join(', ') : '';
  }

  /**
   * 从 propertyData 中提取价格
   */
  private extractPrice(data: Record<string, unknown>): string {
    const priceFields = [
      data?.price,
      data?.unformattedPrice,
      data?.listPrice,
      data?.zestimate,
      data?.lastSoldPrice,
      data?.hdpData?.homeInfo?.zestimate,
    ];

    for (const price of priceFields) {
      if (price !== undefined && price !== null) {
        if (typeof price === 'number') {
          return `$${price.toLocaleString()}`;
        }
        if (typeof price === 'string' && price.match(/\d/)) {
          return price.startsWith('$') ? price : `$${price}`;
        }
      }
    }

    return '';
  }

  /**
   * 从 propertyData 中提取图片列表
   */
  private extractPhotoUrls(data: Record<string, unknown>): string[] {
    const photos: string[] = [];

    // 多个可能的图片路径
    const photoPaths = [
      data?.photos,
      data?.imageUrls,
      data?.photoUrls,
      data?.media?.[0]?.url,
      data?.hdpData?.homeInfo?.photoUrl,
      data?.listingPhotos,
      data?.images,
    ];

    for (const path of photoPaths) {
      if (Array.isArray(path)) {
        for (const photo of path) {
          if (typeof photo === 'string') {
            photos.push(this.cleanImageUrl(photo));
          } else if (photo?.url) {
            photos.push(this.cleanImageUrl(photo.url));
          } else if (photo?.src) {
            photos.push(this.cleanImageUrl(photo.src));
          }
        }
      }
    }

    return [...new Set(photos)].slice(0, 30);
  }

  /**
   * 从 propertyData 中提取学校评分
   */
  private extractSchoolRatings(data: Record<string, unknown>): SchoolRating[] {
    const schools: SchoolRating[] = [];
    
    const schoolData = data?.schools ?? data?.schoolRatings ?? data?.nearbySchools ?? [];
    
    if (!Array.isArray(schoolData)) return [];

    for (const school of schoolData.slice(0, 10)) {
      if (school?.name) {
        schools.push({
          name: school.name,
          rating: school.rating ?? school.score ?? 0,
          level: school.level ?? school.type,
          distance: school.distance ?? school.proximity,
        });
      }
    }

    return schools;
  }

  /**
   * 递归搜索数据中的关键字段
   */
  private deepSearch(obj: unknown, keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    if (!obj || typeof obj !== 'object') return result;

    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (keys.includes(key.toLowerCase())) {
        result[key] = (obj as Record<string, unknown>)[key];
      }
    }

    // 递归搜索子对象
    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        const subResult = this.deepSearch(value, keys);
        Object.assign(result, subResult);
      }
    }

    return result;
  }

  /**
   * 清理图片 URL（移除尺寸参数获取高清图）
   */
  private cleanImageUrl(url: string): string {
    if (!url) return '';
    
    // 移除 Zillow 图片尺寸参数
    let cleaned = url
      .replace(/[?&]width=\d+/g, '')
      .replace(/[?&]height=\d+/g, '')
      .replace(/[?&]fit=\w+/g, '')
      .replace(/[?&]downsample=\w+/g, '')
      .replace(/\?+$/, '');
    
    // 如果是 Zillow CDN 图片，尝试获取最高质量版本
    if (cleaned.includes('photos.wikimapia.org') || cleaned.includes('photos.zillow.com')) {
      // 移除任何尺寸限制
      cleaned = cleaned.replace(/\/\d+_[a-z]\.jpg$/i, '_a.jpg');
    }
    
    return cleaned;
  }

  /**
   * 处理图片列表
   */
  private processImages(urls: string[]): string[] {
    const cleaned = urls
      .map(url => this.cleanImageUrl(url))
      .filter(url => url.startsWith('http'))
      .filter(url => !url.match(/logo|icon|avatar|placeholder/));
    
    return [...new Set(cleaned)].slice(0, 30);
  }

  /**
   * 根据 URL 判断价格周期（租房/买房）
   */
  private determinePricePeriod(url: string): StandardizedListingData['pricePeriod'] {
    if (url.includes('/rent/') || url.includes('/for-rent/')) {
      return 'month';
    }
    return 'total';
  }

  /**
   * 解析价格字符串为数字
   */
  private parsePrice(priceStr: string | undefined): number | undefined {
    if (!priceStr) return undefined;
    
    // 移除 $ 和 , 
    const cleaned = priceStr
      .replace(/\$/g, '')
      .replace(/,/g, '')
      .replace(/\s*\/\s*(?:mo|month|week|year)/gi, '')
      .trim();
    
    // 提取数字
    const match = cleaned.match(/[\d,]+(?:\.\d{2})?/);
    if (match) {
      return parseFloat(match[0].replace(/,/g, ''));
    }
    
    return undefined;
  }

  /**
   * 计算提取置信度
   */
  private calculateConfidence(data: Partial<ZillowRawData>): number {
    let confidence = 0.2; // 基础分

    if (data.address) confidence += 0.2;
    if (data.price) confidence += 0.15;
    if (data.bedrooms != null) confidence += 0.1;
    if (data.bathrooms != null) confidence += 0.1;
    if (data.sqft) confidence += 0.1;
    if (data.photoUrls && data.photoUrls.length > 0) confidence += 0.1;
    if (data.description && data.description.length > 50) confidence += 0.1;
    if (data.zestimate) confidence += 0.05;

    return Math.min(1, confidence);
  }
}
