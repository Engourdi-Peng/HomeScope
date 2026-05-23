/**
 * Zillow 专用解析器
 * 支持 zillow.com 的房源详情页
 *
 * 提取策略（优先级）：
 * 1. JSON-LD RealEstateListing（schema.org 结构）
 * 2. __NEXT_DATA__ JSON componentProps.gdpClientCache
 * 3. hdpApolloPreloadedData JSON（详细页）
 * 4. data-testid 选择器
 * 5. 文本正则搜索（兜底）
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
  lotSizeSqft?: number;
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
  // DOM 提取新增字段
  highlights?: string[];
  heating?: string;
  cooling?: string;
  basement?: string;
  garageSpaces?: number;
  carportSpaces?: number;
  constructionMaterial?: string;
  parcelNumber?: string;
  taxAssessedValue?: number;
  annualTax?: number;
  dateOnMarket?: string;
  region?: string;
  gasMeters?: number;
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
    let rawData = this.extractFromJsonLd(ctx.document);

    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromNextData(ctx.document) };
    }

    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromApolloData(ctx.document) };
    }

    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromTestId(ctx.document) };
    }

    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromText(ctx.document, ctx.url) };
    }

    // 策略5: DOM 模块提取（兜底补充）
    rawData = { ...rawData, ...this.extractFromDom(ctx.document) };

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

      // DOM 模块提取字段
      highlights: rawData.highlights,
      heating: rawData.heating,
      cooling: rawData.cooling,
      basement: rawData.basement,
      garageSpaces: rawData.garageSpaces ?? null,
      carportSpaces: rawData.carportSpaces ?? null,
      constructionMaterial: rawData.constructionMaterial,
      parcelNumber: rawData.parcelNumber,
      taxAssessedValue: rawData.taxAssessedValue ?? null,
      annualTax: rawData.annualTax ?? null,
      dateOnMarket: rawData.dateOnMarket,
      region: rawData.region,
      gasMeters: rawData.gasMeters ?? null,

      // 提取元数据
      extractionConfidence: confidence,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * 策略0: 解析 JSON-LD RealEstateListing（schema.org 结构）
   * Zillow 现在使用这个格式作为主要数据源
   */
  private extractFromJsonLd(doc: Document): Partial<ZillowRawData> {
    try {
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);

          // 查找 RealEstateListing 类型的数据
          const candidates = Array.isArray(data)
            ? data
            : (data['@graph'] ? data['@graph'] : [data]);

          for (const item of candidates) {
            const type = (item['@type'] || '').toString().toLowerCase();
            if (type.includes('realestate') || type.includes('product')) {
              // Zillow JSON-LD 结构：地址和房间信息在 itemOffered 里
              const propertyInfo = item.itemOffered || item;

              // 地址
              const addressObj = propertyInfo.address || item.address;
              let address = '';
              if (typeof addressObj === 'string') {
                address = addressObj;
              } else if (addressObj && typeof addressObj === 'object') {
                const parts = [
                  addressObj.streetAddress,
                  addressObj.addressLocality,
                  addressObj.addressRegion,
                  addressObj.postalCode,
                ].filter(Boolean);
                address = parts.join(', ');
              }

              // 价格
              const offer = item.offers || item.aggregateOffer;
              let price = '';
              let priceAmount: number | undefined;
              if (offer?.price != null) {
                price = typeof offer.price === 'number'
                  ? `$${offer.price.toLocaleString()}`
                  : `$${offer.price}`;
                priceAmount = typeof offer.price === 'number' ? offer.price : parseInt(String(offer.price), 10);
              }

              // 房间信息
              const bedrooms = propertyInfo.numberOfBedrooms;
              // 浴室从 floorPlan 或 amenities 获取
              let bathrooms: number | undefined;
              if (propertyInfo.numberOfBathrooms != null) {
                bathrooms = propertyInfo.numberOfBathrooms;
              }

              // 面积
              let sqft: number | undefined;
              if (propertyInfo.floorSize?.value) {
                sqft = propertyInfo.floorSize.value;
              }

              // 房产类型
              let propertyType = '';
              if (propertyInfo['@type']) {
                propertyType = propertyInfo['@type'].toString();
              }

              return {
                address,
                price,
                priceAmount,
                bedrooms,
                bathrooms,
                sqft,
                propertyType,
              };
            }
          }
        } catch (e) {
          // 跳过无效的 JSON
        }
      }
    } catch (e) {
      console.warn('[ZillowExtractor] Failed to parse JSON-LD:', e);
    }
    return {};
  }

  /**
   * 策略1: 解析 __NEXT_DATA__ JSON（支持新的 componentProps 结构）
   */
  private extractFromNextData(doc: Document): Partial<ZillowRawData> {
    try {
      const script = doc.querySelector('script[id="__NEXT_DATA__"]');
      if (!script) return {};

      const data = JSON.parse(script.textContent);
      const pageProps = data?.props?.pageProps;
      const componentProps = pageProps?.componentProps;

      // 新的 Zillow 结构：componentProps.gdpClientCache
      const gdpCache = componentProps?.gdpClientCache;
      if (gdpCache && typeof gdpCache === 'object') {
        for (const key of Object.keys(gdpCache)) {
          const item = gdpCache[key];
          if (item && typeof item === 'object' && (item.zpid || item.zestimate || item.price)) {
            return this.extractFromPropertyData(item);
          }
        }
      }

      // 尝试旧的结构路径
      const props = pageProps ?? data?.props ?? data;
      const propertyData =
        props?.propertyData ??
        props?.homeDetailPage ??
        props?.hdpApolloData ??
        props?.data?.searchResults ??
        props?.ForSaleShoppingPage ??
        props;

      if (propertyData && typeof propertyData === 'object') {
        return this.extractFromPropertyData(propertyData);
      }

      return {};
    } catch (e) {
      console.warn('[ZillowExtractor] Failed to parse __NEXT_DATA__:', e);
      return {};
    }
  }

  /**
   * 从 propertyData 对象中提取字段
   */
  private extractFromPropertyData(propertyData: Record<string, unknown>): Partial<ZillowRawData> {
    // 提取地址
    const address = this.extractAddress(propertyData);

    // 提取价格
    const price = this.extractPrice(propertyData);

    // 提取房间信息
    const bedrooms = propertyData.bedrooms ?? propertyData.beds ?? propertyData.numBeds;
    const bathrooms = propertyData.bathrooms ?? propertyData.baths ?? propertyData.numBaths;
    const sqft = propertyData.sqft ?? propertyData.livingArea ?? propertyData.area;

    // 提取其他字段
    const yearBuilt = propertyData.yearBuilt ?? propertyData.year_built;
    const lotSize = propertyData.lotSize ?? propertyData.lot_Size ?? propertyData.lot_size;
    const propertyType = propertyData.propertyType ?? propertyData.type ?? propertyData.homeType;
    const description = propertyData.description ?? propertyData.rawDescription ?? (propertyData.editableDescription as Record<string, unknown>)?.section ?? '';

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
   * 策略5: DOM 模块提取（What's Special & Facts & Features）
   * 当 JSON 数据不完整时，从页面 DOM 结构中提取
   */
  private extractFromDom(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // 提取 What's Special 模块
    const whatsSpecialData = this.extractWhatsSpecial(doc);
    Object.assign(data, whatsSpecialData);

    // 提取 Facts & Features 模块
    const factsData = this.extractFactsAndFeatures(doc);
    Object.assign(data, factsData);

    return data;
  }

  /**
   * 从 What's Special 模块提取数据
   */
  private extractWhatsSpecial(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    try {
      // 找到 What's Special 模块
      const wsModule = doc.querySelector('[class*="LegacyStyledPriorityModules"]');
      if (!wsModule) return data;

      // 找到包含 "What's special" 标题的DIV
      const wsContent = [...wsModule.children].find(c => 
        c.textContent?.includes("What's special")
      );
      
      if (!wsContent) return data;

      // 提取简短特性列表 (Child 1)
      const features: string[] = [];
      const children = [...wsContent.children];
      if (children[1]) {
        const featuresText = children[1].textContent || '';
        // 按大写字母分割提取特性列表
        const featureMatches = featuresText.match(/[A-Z][^A-Z]*/g);
        if (featureMatches) {
          featureMatches.forEach(f => {
            const trimmed = f.trim();
            if (trimmed.length > 3) {
              features.push(trimmed);
            }
          });
        }
        data.highlights = features.length > 0 ? features : undefined;
      }

      // 提取完整描述 (Child 2)
      if (children[2]) {
        const fullText = children[2].textContent || '';
        // 移除 "Show more" 按钮文本
        data.description = fullText.replace(/Show more$/, '').trim();
      }

    } catch (e) {
      console.warn('[ZillowExtractor] Failed to extract What\'s Special:', e);
    }

    return data;
  }

  /**
   * 从 Facts & Features 模块提取结构化数据
   */
  private extractFactsAndFeatures(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    try {
      // 找到 Facts & Features 模块
      const ffSection = [...doc.querySelectorAll('.ds-data-view-list > div')].find(d => 
        d.querySelector('h2')?.textContent?.includes('Facts & features')
      );

      if (!ffSection) return data;

      const innerContent = ffSection.querySelector('div');
      if (!innerContent) return data;

      const text = innerContent.textContent || '';

      // 解析 Facts & Features 结构化数据
      const facts = this.parseFactsText(text);
      Object.assign(data, facts);

    } catch (e) {
      console.warn('[ZillowExtractor] Failed to extract Facts & Features:', e);
    }

    return data;
  }

  /**
   * 解析 Facts & Features 文本为结构化数据
   */
  private parseFactsText(text: string): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // 移除 "Facts & features" 标题
    const cleanText = text.replace(/^Facts & features/, '');

    // 提取 bedrooms
    const bedsMatch = cleanText.match(/Bedrooms:\s*(\d+)/);
    if (bedsMatch) data.bedrooms = parseInt(bedsMatch[1]);

    // 提取 bathrooms
    const bathsMatch = cleanText.match(/Full bathrooms:\s*(\d+(?:\.\d+)?)/);
    if (bathsMatch) data.bathrooms = parseFloat(bathsMatch[1]);

    // 提取总面积
    const sqftMatch = cleanText.match(/Total interior livable area:\s*([\d,]+)/);
    if (sqftMatch) {
      data.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
    } else {
      // 尝试其他 sqft 格式
      const sqftAlt = cleanText.match(/Total structure area:\s*([\d,]+)/);
      if (sqftAlt) {
        data.sqft = parseInt(sqftAlt[1].replace(/,/g, ''));
      }
    }

    // 提取地块面积
    const lotMatch = cleanText.match(/Lot.*?:\s*([\d,]+)\s*Square Feet/i);
    if (lotMatch) {
      data.lotSize = `${lotMatch[1]} sqft`;
      data.lotSizeSqft = parseInt(lotMatch[1].replace(/,/g, ''));
    }

    // 提取建造年份
    const yearMatch = cleanText.match(/Year built:\s*(\d{4})/i);
    if (yearMatch) data.yearBuilt = parseInt(yearMatch[1]);

    // 提取房产类型
    const homeTypeMatch = cleanText.match(/Home type:\s*([^L]+?)Property/i);
    if (homeTypeMatch) data.propertyType = homeTypeMatch[1].trim();

    // 提取建筑材料
    const materialsMatch = cleanText.match(/Materials:\s*(\w+)/i);
    if (materialsMatch) data.constructionMaterial = materialsMatch[1];

    // 提取供暖类型
    const heatingMatch = cleanText.match(/Heating:\s*(\w+)/i);
    if (heatingMatch) data.heating = heatingMatch[1];

    // 提取制冷类型
    const coolingMatch = cleanText.match(/Cooling:\s*([A-Za-z\/]+(?:\([\w\/]+\))?)/i);
    if (coolingMatch) data.cooling = coolingMatch[1].trim();

    // 提取停车位
    const garageMatch = cleanText.match(/Garage spaces:\s*(\d+)/i);
    if (garageMatch) data.garageSpaces = parseInt(garageMatch[1]);

    const carportMatch = cleanText.match(/Carport spaces:\s*(\d+)/i);
    if (carportMatch) data.carportSpaces = parseInt(carportMatch[1]);

    // 提取地块编号
    const parcelMatch = cleanText.match(/Parcel number:\s*([\d]+)/i);
    if (parcelMatch) data.parcelNumber = parcelMatch[1];

    // 提取税务信息
    const taxValueMatch = cleanText.match(/Tax assessed value:\s*\$?([\d,]+)/i);
    if (taxValueMatch) data.taxAssessedValue = parseInt(taxValueMatch[1].replace(/,/g, ''));

    const taxAmountMatch = cleanText.match(/Annual tax amount:\s*\$?([\d,]+)/i);
    if (taxAmountMatch) data.annualTax = parseInt(taxAmountMatch[1].replace(/,/g, ''));

    // 提取上市日期
    const dateOnMarketMatch = cleanText.match(/Date on market:\s*(\d+\/\d+\/\d+)/i);
    if (dateOnMarketMatch) data.dateOnMarket = dateOnMarketMatch[1];

    // 提取在售天数
    const daysOnMarketMatch = cleanText.match(/Cumulative days on market:\s*(\d+)/i);
    if (daysOnMarketMatch) data.daysOnZillow = parseInt(daysOnMarketMatch[1]);

    // 提取区域
    const regionMatch = cleanText.match(/Region:\s*([A-Za-z\s]+)/i);
    if (regionMatch) data.region = regionMatch[1].trim();

    // 提取地下室信息
    const basementMatch = cleanText.match(/Basement:\s*(Full|Unfinished|Walk-Out)/gi);
    if (basementMatch) data.basement = basementMatch.join(', ');

    // 提取燃气表数量（多户家庭）
    const gasMeterMatch = cleanText.match(/Gas:\s*Separate\s+Gas\s+Meters:\s*(\d+)/i);
    if (gasMeterMatch) data.gasMeters = parseInt(gasMeterMatch[1]);

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
   * 从 Zillow 图库模态框提取图片
   * 只在模态框完全打开后执行（检测 div[id="__cl1n_jeg20e"] 或 class 包含 StyledModalDialog）
   */
  async extractImages(ctx: ExtractContext): Promise<string[]> {
    const doc = ctx.document;

    // 等待模态框打开
    if (!this.isGalleryModalOpen(doc)) {
      await this.waitForGalleryModal(doc);
    }

    // 查找图库容器
    const mediaWall = doc.querySelector('ul[class*="hollywood-vertical-media-wall"]') ||
                      doc.querySelector('ul[class*="media-wall-container"]') ||
                      doc.querySelector('ul[class*="media-wall"]');

    if (!mediaWall) {
      console.warn('[ZillowExtractor] Gallery media wall not found');
      return [];
    }

    // 遍历每个 li 元素提取图片
    const images: string[] = [];
    const items = mediaWall.querySelectorAll('li[class*="media-stream-tile"]');

    for (const item of items) {
      const source = item.querySelector('picture > source');
      const srcset = source?.getAttribute('srcset');

      if (srcset) {
        // 取 srcset 中最高分辨率（最后一个 URL，通常是 1536w）
        const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
        const bestUrl = urls[urls.length - 1];
        if (bestUrl) {
          images.push(this.upgradeToHiRes(bestUrl));
        }
      } else {
        // 兜底：从 img src 提取
        const img = item.querySelector('picture > img');
        const src = img?.src;
        if (src) {
          images.push(this.upgradeToHiRes(src));
        }
      }
    }

    return this.deduplicateImages(images);
  }

  /**
   * 检测图库模态框是否打开
   */
  private isGalleryModalOpen(doc: Document): boolean {
    return !!(
      doc.querySelector('div[id="__cl1n_jeg20e"]') ||
      doc.querySelector('[class*="StyledModalDialog"]')
    );
  }

  /**
   * 等待图库模态框打开（最多 5 秒）
   */
  private waitForGalleryModal(doc: Document): Promise<void> {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (this.isGalleryModalOpen(doc)) {
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(doc.body, { childList: true, subtree: true });

      // 5 秒超时兜底
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000);
    });
  }

  /**
   * 升级到高清版本（优先 1536）
   */
  private upgradeToHiRes(url: string): string {
    if (!url) return '';
    return url
      .replace('-cc_ft_960.jpg', '-cc_ft_1536.jpg')
      .replace('-cc_ft_960.', '-cc_ft_1536.')
      .replace(/-p_d\.jpg/, '-p_d.jpg')
      .replace(/\?.*$/, '');
  }

  /**
   * 去重保持顺序
   */
  private deduplicateImages(urls: string[]): string[] {
    return [...new Set(urls)];
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
