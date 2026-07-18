/**
 * Zillow ?????
 * ?? zillow.com ??????
 *
 * ??????????
 * 1. JSON-LD RealEstateListing?schema.org ???
 * 2. __NEXT_DATA__ JSON componentProps.gdpClientCache
 * 3. hdpApolloPreloadedData JSON?????
 * 4. data-testid ???
 * 5. ??????????
 * 6. DOM ?????Facts & Features / Financial / Monthly payment?
 */

import type {
  ListingExtractor,
  ExtractContext,
  ModeAwareListingExtractor,
  CommonListingFields,
  RentListingFields,
  SaleListingFields,
  ListingTypeMeta,
} from './base';
import type { StandardizedListingData, SchoolRating } from './types';

const ZILLOW_HOSTNAME = 'zillow.com';

// ============================================================================
// MLS Attribution Filter
// ============================================================================

/**
 * MLS attribution / source text MUST NOT be used as address, title, region, or location.
 * Patterns that indicate an entire line is a data-source attribution, not listing data.
 * The regex is deliberately broad so we err on the side of filtering.
 */
const MLS_JUNK_RE = /\b(source[:.]|mls#|mls grid|as distributed by|report a problem|listing provided by|idx information|attribution)\b/i;

/**
 * A line is pure MLS junk if the entire line is an attribution string (no street address pattern).
 * We use a loose street-address heuristic so partial matches like "Source:" don't fail
 * on a legitimate address that happens to mention "source" in a URL.
 */
function isMlsAttribution(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // If the whole line is an MLS attribution pattern, filter it out
  if (MLS_JUNK_RE.test(trimmed)) return true;
  // If the line contains only a ZIP code but no street address, treat as attribution
  // (MLS lines sometimes include "11361" alone)
  if (/^\d{5}(?:-\d{4})?\s*$/.test(trimmed)) return true;
  // OneKey / MLS Brokerage standalone lines
  if (/^onekey??\s*mls$/i.test(trimmed)) return true;
  return false;
}

/**
 * Clean a multi-line candidate string (e.g. h1 text).
 * - Split by newlines
 * - Discard pure MLS attribution lines
 * - Re-assemble remaining lines (should be 0 or 1 address lines in practice)
 * - Return empty string if no usable lines remain
 */
function filterMlsFromCandidate(candidate: string): string {
  if (!candidate) return '';
  const lines = candidate.split(/\r?\n/);
  const validLines = lines.filter(line => !isMlsAttribution(line));
  return validLines.join('\n').trim();
}

// ============================================================================
// Description Cleaner
// ============================================================================

/**
 * ?? description??? MLS attribution ???? listing ???
 * ??????? extractor ?? description ?????
 * Reality Check ????? cleanDescription ????
 */
const MLS_DESCRIPTION_PATTERNS = [
  // ?? MLS attribution
  /^(source\s*:\s*.+)$/gim,
  /^(mls\s*#?\s*\d+.*)$/gim,
  /^(listing\s*provided\s*by.*)$/gim,
  /^(as\s*distributed\s*by.*)$/gim,
  /^(idx\s*information.*)$/gim,
  /^(report\s*a\s*problem.*)$/gim,
  /^(onekey??\s*mls.*)$/gim,
  /^(mls\s+grid.*)$/gim,
  /^(properties\s+may\s+or\s+may\s+not\s+be\s+listed.*)$/gim,
  // MLS/IDX/attribution disclaimer
  /^(all\s+information\s+deemed\s+reliable.*)$/gim,
  /^(all\s+information\s+should\s+be\s+independently.*)$/gim,
  /^(all\s+properties\s+are\s+subject\s+to\s+prior\s+sale.*)$/gim,
  /^(listing\s+data\s+last\s+updated.*)$/gim,
  /^(supplied\s+open\s+house\s+information.*)$/gim,
  /^(streeteasy\s+source.*)$/gim,
  /^(broker\s+participation\s+welcome.*)$/gim,
  /^(copyright\s+\d{4}.*mls.*)$/gim,
  /^(mls\s+information\s+deemed\s+reliable.*)$/gim,
];

function cleanDescription(rawDescription: string | undefined | null): string {
  if (!rawDescription) return '';
  let cleaned = String(rawDescription);

  // 1. ???? MLS attribution???? MLS_DESCRIPTION_PATTERNS ??????
  cleaned = cleaned
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^(source\s*:|mls\s*#|onekey\s*mls|as\s*distributed\s*by|mls\s+grid|deemed\s+reliable|subject\s+to\s+prior\s*sale|streeteasy\s+source|idx\s*information|report\s*a\s*problem)/i.test(trimmed)) return false;
      if (/^\d{5}(?:-\d{4})?\s*$/.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();

  // 2. ???? MLS ???????????
  cleaned = cleaned
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // ?????? MLS disclaimer ???????
      for (const pattern of MLS_DESCRIPTION_PATTERNS) {
        if (pattern.test(trimmed)) return false;
      }
      return true;
    })
    .join('\n')
    .trim();

  // 3. ?????? MLS ??
  for (const pattern of MLS_DESCRIPTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 4. ?????
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  // 5. ?????????????? MLS ????"??"?
  return cleaned.length > 20 ? cleaned : '';
}

// ============================================================================
// Label/Value Helper
// ============================================================================

/**
 * ????????
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ??? label/value ???
 * 
 * ????????
 * 1. ?? "Label: value"
 * 2. ?? label + ??? value
 * 
 * ????? "Bedrooms & bathrooms" ?? header
 */
function getStrictLabelValue(
  sectionLines: string[],
  labels: string[],
  stopLabels: string[] = [],
  maxLookahead = 6
): string | null {
  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (!line) continue;

    for (const label of labels) {
      const escaped = escapeRegex(label);

      // Case 1: "Label: value" ? "Label?value"
      const inlineMatch = line.match(new RegExp(`^${escaped}\\s*[:?]\\s*(.+)$`, 'i'));
      if (inlineMatch?.[1]) {
        return inlineMatch[1].trim();
      }

      // Case 2: ???? "Label"????????
      const exactMatch = new RegExp(`^${escaped}$`, 'i').test(line);
      if (!exactMatch) continue;

      // ??????? value
      for (let j = i + 1; j < Math.min(sectionLines.length, i + maxLookahead); j++) {
        const candidate = sectionLines[j]?.trim();
        if (!candidate) continue;

        // ?? stop label ??
        const isStopLabel = stopLabels.some(stop => 
          new RegExp(`^${escapeRegex(stop)}\\s*[:?]?$`, 'i').test(candidate)
        );
        if (isStopLabel) {
          return null;
        }

        return candidate;
      }
    }
  }

  return null;
}

/**
 * ?????????????????
 */
function parseNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[,$]/g, '').trim();
  const match = cleaned.match(/[\d]+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : undefined;
}

/**
 * ????
 */
function parseIntValue(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/,/g, '').trim();
  const match = cleaned.match(/\d+/);
  return match ? parseInt(match[0], 10) : undefined;
}

// ============================================================================
// Section ????
// ============================================================================

interface SectionBounds {
  start: number;
  end: number;
}

/**
 * ?? section ????????
 */
function findSectionBounds(
  lines: string[],
  startPattern: string,
  endPatterns: string[]
): SectionBounds | null {
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (start === -1) {
      // ?????
      const escapedStart = escapeRegex(startPattern);
      if (new RegExp(`^${escapedStart}`, 'i').test(line)) {
        start = i;
      }
    } else {
      // ? section ??????
      for (const endPattern of endPatterns) {
        const escapedEnd = escapeRegex(endPattern);
        if (new RegExp(`^${escapedEnd}`, 'i').test(line)) {
          end = i;
          return { start, end };
        }
      }
    }
  }

  if (start === -1) return null;
  return { start, end };
}

/**
 * ???? section ????
 */
function getSectionLines(
  allLines: string[],
  startPattern: string,
  endPatterns: string[]
): string[] {
  const bounds = findSectionBounds(allLines, startPattern, endPatterns);
  if (!bounds) return [];
  return allLines.slice(bounds.start, bounds.end);
}

// ============================================================================
// ????
// ============================================================================

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
  propertySubtype?: string;
  homeType?: string;
  description?: string;
  whatsSpecialText?: string;
  descriptionSource?: string;
  photoUrls?: string[];
  zestimate?: string;
  rentZestimate?: string;
  hoaFee?: string;
  propertyTax?: string;
  schoolRatings?: SchoolRating[];
  daysOnZillow?: number;
  // DOM ??????
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
  cumulativeDaysOnMarket?: string;
  region?: string;
  gasMeters?: number;
  // Financial section
  pricePerSqft?: string;
  taxAssessedValueStr?: string;
  annualTaxStr?: string;
  // Monthly payment section
  estimatedPaymentTop?: string;
  monthlyPayment?: string;
  principalAndInterest?: string;
  mortgageInsurance?: string;
  propertyTaxesMonthly?: string;
  homeInsuranceMonthly?: string;
  hoaFees?: string;
  utilities?: string;
  // Climate risks
  floodZone?: string;
  // Full/Half baths
  fullBaths?: number;
  halfBaths?: number;
  // Lot dimensions
  lotDimensions?: string;
  // Parking
  parkingFeatures?: string;
  // Additional fields
  walkScore?: string;
  bikeScore?: string;
  neighborhood?: string;
  architecturalStyle?: string;
  stories?: string;
  hoaStatus?: string;
}

export class ZillowExtractor implements ListingExtractor, ModeAwareListingExtractor {
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

  // ==========================================================================
  // Legacy entry: extract() — 保持原签名,内部走 detect + common + (sale|rent)
  // ==========================================================================
  async extract(ctx: ExtractContext): Promise<StandardizedListingData> {
    const meta = await this.detectListingType(ctx);
    const common = await this.extractCommonFields(ctx);

    if (meta.type === 'rent') {
      const rent = await this.extractRentSpecificFields(ctx, common);
      return mergeCommonAndRent(common, rent, ctx, meta);
    }
    if (meta.type === 'sale') {
      const sale = await this.extractSaleSpecificFields(ctx, common);
      return mergeCommonAndSale(common, sale, ctx, meta);
    }
    // unknown: 只返回 common + listingType='unknown'，等待 ReportModeModal 选定
    return mergeCommonAndUnknown(common, ctx, meta);
  }

  // ==========================================================================
  // ModeAwareListingExtractor — 模式契约
  // ==========================================================================

  async detectListingType(ctx: ExtractContext): Promise<ListingTypeMeta> {
    // 复用现有 4 步信号；保留全部 strict signal 逻辑
    const doc = ctx.document;
    const url = ctx.url;
    // 收集 raw 触发 detectFromStructuredData/detectFromTargetedDom 等
    // 这些方法原为 private，从 extract() 内取过 rawData。这里用最小 raw：
    const raw = this.collectRawSignalsForDetection(doc);
    const result = this.detectListingTypeInternal(doc, url, raw);
    return result;
  }

  async extractCommonFields(ctx: ExtractContext): Promise<CommonListingFields> {
    const data = await this.collectRawData(ctx);
    const meta = await this.detectListingType(ctx);
    return this.buildCommonFields(data, meta);
  }

  async extractRentSpecificFields(
    ctx: ExtractContext,
    common: CommonListingFields,
  ): Promise<RentListingFields> {
    const data = await this.collectRawData(ctx);
    return this.buildRentFields(data, common);
  }

  async extractSaleSpecificFields(
    ctx: ExtractContext,
    common: CommonListingFields,
  ): Promise<SaleListingFields> {
    const data = await this.collectRawData(ctx);
    return this.buildSaleFields(data, common);
  }

  async forceReextract(
    ctx: ExtractContext,
    common: CommonListingFields,
    forcedListingType: 'rent' | 'sale',
  ): Promise<StandardizedListingData> {
    // 复用已经跑过的 common fields，避免重新扫描页面（content script 持有 document）
    if (forcedListingType === 'rent') {
      const rent = await this.extractRentSpecificFields(ctx, common);
      return mergeCommonAndRent(common, rent, ctx, {
        type: 'rent',
        source: common.listingTypeSource ?? 'dom',
        confidence: 'high',
        conflicts: [],
      });
    }
    if (forcedListingType === 'sale') {
      const sale = await this.extractSaleSpecificFields(ctx, common);
      return mergeCommonAndSale(common, sale, ctx, {
        type: 'sale',
        source: common.listingTypeSource ?? 'dom',
        confidence: 'high',
        conflicts: [],
      });
    }
    throw new Error(`forceReextract: invalid forcedListingType=${forcedListingType}`);
  }

  // ==========================================================================
  // Helpers — internal pipeline
  // ==========================================================================

  /**
   * Re-run all 5 提取步骤(JSON-LD / NEXT_DATA / Apollo / TestID / Text / DOM).
   * Used by both extract() and ModeAware methods.
   * 保留所有现有 4 步信号逻辑（不删/不改）。
   */
  private async collectRawData(ctx: ExtractContext): Promise<ZillowRawData> {
    let rawData = this.extractFromJsonLd(ctx.document);

    if (!rawData.address && !rawData.price) {
      rawData = { ...rawData, ...this.extractFromNextData(ctx.document) };
    }
    if (!rawData.address && !rawData.price && !rawData.propertyType) {
      rawData = { ...rawData, ...this.extractFromApolloData(ctx.document) };
    }
    if (!rawData.address && !rawData.price && !rawData.propertyType) {
      rawData = { ...rawData, ...this.extractFromTestId(ctx.document) };
    }
    if (!rawData.address && !rawData.price && !rawData.propertyType) {
      rawData = { ...rawData, ...this.extractFromText(ctx.document, ctx.url) };
    }

    const domData = this.extractFromDom(ctx.document);
    rawData = { ...rawData, ...domData };

    return rawData;
  }

  /**
   * 最小 raw 数据用于 detectListingType 4 步信号。
   * detectListingType 只需要几个信号字段（address/price/description），不调用完整 DOM。
   */
  private collectRawSignalsForDetection(doc: Document): Partial<ZillowRawData> {
    const jsonld = this.extractFromJsonLd(doc);
    return jsonld;
  }

  /**
   * Build CommonListingFields from raw + meta.
   * 兼容：旧字段（parking/yearBuilt/homeType 等）也填充；新字段（parkingDescription）并存。
   */
  private buildCommonFields(
    raw: ZillowRawData,
    meta: ListingTypeMeta,
  ): CommonListingFields {
    return {
      address: raw.address || '',
      title: '',
      displayPrice: raw.price || '',
      description: cleanDescription(raw.description) || '',
      whatsSpecialText: cleanDescription(raw.whatsSpecialText) || '',
      images: this.processImages(raw.photoUrls || []),
      propertyType: raw.propertyType || '',
      homeType: raw.homeType || raw.propertyType || '',
      propertySubtype: raw.propertySubtype || '',
      bedrooms: raw.bedrooms ?? null,
      bathrooms: raw.bathrooms ?? null,
      sqft: raw.sqft ?? null,
      yearBuilt: raw.yearBuilt ?? null,
      parkingDescription: raw.parkingFeatures || null,
      contactInfo: undefined,
      schoolRatings: raw.schoolRatings,
      walkScore: raw.walkScore,
      bikeScore: raw.bikeScore,
      neighborhood: raw.neighborhood,
      architecturalStyle: raw.architecturalStyle,
      stories: raw.stories,
      region: raw.region,
      floodZone: raw.floodZone,
      heating: raw.heating,
      cooling: raw.cooling,
      basement: raw.basement,
      garageSpaces: raw.garageSpaces ?? null,
      listingType: meta.type,
      listingTypeSource: meta.source,
      listingTypeConfidence: meta.confidence,
      listingTypeConflicts: meta.conflicts,
    };
  }

  /**
   * Build RentListingFields from raw + common.
   * 严格互斥：不得出现 askingPrice/zestimate/monthlyPayment/annualTax 等。
   */
  private buildRentFields(raw: ZillowRawData, common: CommonListingFields): RentListingFields {
    // monthlyRent: 从 raw.price 解析（$/mo 文本）
    const monthlyRent = parseMonthlyRent(raw.price, raw.priceAmount);
    return {
      monthlyRent,
      // advertisedRentRange: 仅来自页面广告上下限（Zillow 偶尔展示 "$X - $Y/mo"）
      advertisedRentRange: parseAdvertisedRentRange(raw),
      exactUnit: undefined,
      availableDate: undefined,
      securityDeposit: undefined,
      holdingDeposit: undefined,
      applicationFee: undefined,
      leaseTerm: undefined,
      utilitiesIncluded: undefined,
      landlordPays: undefined,
      tenantPays: undefined,
      petPolicy: undefined,
      parkingFee: undefined,
      amenityFee: undefined,
      qualificationRequirements: undefined,
    };
  }

  /**
   * Build SaleListingFields from raw + common.
   * 严格互斥：不得出现 monthlyRent/securityDeposit/leaseTerm/parkingFee 等。
   */
  private buildSaleFields(raw: ZillowRawData, common: CommonListingFields): SaleListingFields {
    const askingPrice = raw.priceAmount ?? undefined;
    return {
      askingPrice,
      // zestimate 严格用于 sale：数字版（与 rent 的 rentZestimate 区分）
      zestimate: raw.zestimate ? parseNumberString(raw.zestimate) : undefined,
      pricePerSqft: raw.pricePerSqft ? parseNumberString(raw.pricePerSqft) : undefined,
      annualTax: raw.annualTax ?? undefined,
      taxAssessedValue: raw.taxAssessedValue ?? undefined,
      monthlyPayment: raw.monthlyPayment ? parseNumberString(raw.monthlyPayment) : undefined,
      propertyTaxMonthly: raw.propertyTaxesMonthly ? parseNumberString(raw.propertyTaxesMonthly) : undefined,
      homeInsuranceMonthly: raw.homeInsuranceMonthly ? parseNumberString(raw.homeInsuranceMonthly) : undefined,
      hoaFee: raw.hoaFee,
      hoaStatus: raw.hoaStatus,
      priceHistory: undefined,
      daysOnZillow: raw.daysOnZillow ?? undefined,
      dateOnMarket: raw.dateOnMarket,
      lotSize: raw.lotSize,
      lotDimensions: raw.lotDimensions,
    };
  }

  private extractFromJsonLd(doc: Document): Partial<ZillowRawData> {
    try {
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);

          // ?? RealEstateListing ?????
          const candidates = Array.isArray(data)
            ? data
            : (data['@graph'] ? data['@graph'] : [data]);

          for (const item of candidates) {
            const type = (item['@type'] || '').toString().toLowerCase();
            if (type.includes('realestate') || type.includes('product')) {
              // Zillow JSON-LD ??????????? itemOffered ?
              const propertyInfo = item.itemOffered || item;

              // ??
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

              // ??
              const offer = item.offers || item.aggregateOffer;
              let price = '';
              let priceAmount: number | undefined;
              if (offer?.price != null) {
                price = typeof offer.price === 'number'
                  ? `$${offer.price.toLocaleString()}`
                  : `$${offer.price}`;
                priceAmount = typeof offer.price === 'number' ? offer.price : parseInt(String(offer.price), 10);
              }

              // ????
              const bedrooms = propertyInfo.numberOfBedrooms;
              // ??? floorPlan ? amenities ??
              let bathrooms: number | undefined;
              if (propertyInfo.numberOfBathrooms != null) {
                bathrooms = propertyInfo.numberOfBathrooms;
              }

              // ??
              let sqft: number | undefined;
              if (propertyInfo.floorSize?.value) {
                sqft = propertyInfo.floorSize.value;
              }

              // ????
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
          // ????? JSON
        }
      }
    } catch (e) {
      console.warn('[ZillowExtractor] Failed to parse JSON-LD:', e);
    }
    return {};
  }

  /**
   * ??1: ?? __NEXT_DATA__ JSON????? componentProps ???
   */
  private extractFromNextData(doc: Document): Partial<ZillowRawData> {
    try {
      const script = doc.querySelector('script[id="__NEXT_DATA__"]');
      if (!script) return {};

      const data = JSON.parse(script.textContent);
      const pageProps = data?.props?.pageProps;
      const componentProps = pageProps?.componentProps;

      // ?? Zillow ???componentProps.gdpClientCache
      const gdpCache = componentProps?.gdpClientCache;
      if (gdpCache && typeof gdpCache === 'object') {
        for (const key of Object.keys(gdpCache)) {
          const item = gdpCache[key];
          if (item && typeof item === 'object' && (item.zpid || item.zestimate || item.price)) {
            return this.extractFromPropertyData(item);
          }
        }
      }

      // ??????????
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
   * ? propertyData ???????
   */
  private extractFromPropertyData(propertyData: Record<string, unknown>): Partial<ZillowRawData> {
    // ????
    const address = this.extractAddress(propertyData);

    // ????
    const price = this.extractPrice(propertyData);

    // ??????
    const bedrooms = propertyData.bedrooms ?? propertyData.beds ?? propertyData.numBeds;
    const bathrooms = propertyData.bathrooms ?? propertyData.baths ?? propertyData.numBaths;
    const sqft = propertyData.sqft ?? propertyData.livingArea ?? propertyData.area;

    // ??????
    const yearBuilt = propertyData.yearBuilt ?? propertyData.year_built;
    const lotSize = propertyData.lotSize ?? propertyData.lot_Size ?? propertyData.lot_size;
    const propertyType = propertyData.propertyType ?? propertyData.type ?? propertyData.homeType;
    const description = propertyData.description ?? propertyData.rawDescription ?? (propertyData.editableDescription as Record<string, unknown>)?.section ?? '';

    // ?? Zillow ????
    const zestimate = propertyData.zestimate ?? propertyData.zestimateValue;
    const rentZestimate = propertyData.rentZestimate ?? propertyData.rentZestimateValue;
    const hoaFee = propertyData.hoaFee ?? propertyData.hoa_fee;
    const propertyTax = propertyData.annualTax ?? propertyData.propertyTax ?? propertyData.taxAssessment;

    // ??????
    const schoolRatings = this.extractSchoolRatings(propertyData);

    // ??????
    const daysOnZillow = propertyData.daysOnZillow ?? propertyData.daysOnMarket ?? propertyData.listingAge;

    // ????
    const photoUrls = this.extractPhotoUrls(propertyData);

    return {
      address,
      price,
      priceAmount: this.parsePrice(price),
      bedrooms: bedrooms as number | undefined,
      bathrooms: bathrooms as number | undefined,
      sqft: sqft as number | undefined,
      lotSize: lotSize as string | undefined,
      yearBuilt: yearBuilt as number | undefined,
      propertyType: propertyType as string | undefined,
      description: description as string | undefined,
      photoUrls,
      zestimate: zestimate as string | undefined,
      rentZestimate: rentZestimate as string | undefined,
      hoaFee: hoaFee as string | undefined,
      propertyTax: propertyTax as string | undefined,
      schoolRatings,
      daysOnZillow: daysOnZillow as number | undefined,
    };
  }

  /**
   * ??2: ?? Apollo Preloaded Data
   */
  private extractFromApolloData(doc: Document): Partial<ZillowRawData> {
    try {
      const scripts = doc.querySelectorAll('script[type="application/json"]');
      
      for (const script of scripts) {
        const id = script.id?.toLowerCase() || '';
        
        // ???????????
        if (id.includes('hdpapollo') || id.includes('preloaded') || id.includes('hdpmapollodata')) {
          const data = JSON.parse(script.textContent);
          
          // ????????
          const found = this.deepSearch(data, ['price', 'address', 'beds', 'baths', 'sqft', 'zestimate']);
          
          if (found.address || found.price) {
            return {
              address: found.address as string | undefined,
              price: found.price as string | undefined,
              priceAmount: this.parsePrice(found.price as string | undefined),
              bedrooms: found.beds as number | undefined,
              bathrooms: found.baths as number | undefined,
              sqft: found.sqft as number | undefined,
              zestimate: found.zestimate as string | undefined,
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
   * ??3: ?? data-testid ???
   */
  private extractFromTestId(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // ??
    const addressEl = doc.querySelector('[data-testid="address"]') ??
                      doc.querySelector('h1[data-testid="address"]') ??
                      doc.querySelector('address[data-testid="street-address"]');
    if (addressEl) {
      data.address = filterMlsFromCandidate(addressEl.textContent?.trim() || '');
    }

    // ??
    const priceEl = doc.querySelector('[data-testid="price"]') ??
                    doc.querySelector('[data-testid="list-price"]') ??
                    doc.querySelector('[class*="price"] span');
    if (priceEl) {
      data.price = priceEl.textContent?.trim() || '';
      data.priceAmount = this.parsePrice(data.price);
    }

    // ?/?/??
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

    // ??
    const descEl = doc.querySelector('[data-testid="description"]') ??
                   doc.querySelector('[data-testid="structured-property-meta"]');
    if (descEl) {
      data.description = descEl.textContent?.trim() || '';
    }

    return data;
  }

  /**
   * ??4: ??????????
   */
  private extractFromText(doc: Document, _url: URL): Partial<ZillowRawData> {
    const bodyText = doc.body?.textContent || '';
    const data: Partial<ZillowRawData> = {};

    // ???? h1 ? title ?? ? apply MLS filter to prevent source attribution from becoming address
    const h1 = doc.querySelector('h1');
    if (h1) {
      const rawH1 = h1.textContent?.trim() || '';
      data.address = filterMlsFromCandidate(rawH1);
    }

    // ????
    const priceMatch = bodyText.match(/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month))?/);
    if (priceMatch) {
      data.price = priceMatch[0];
      data.priceAmount = this.parsePrice(data.price);
    }

    // ?/???
    const bedMatch = bodyText.match(/(\d+)\s*(?:bed(?:s|room)?|bd)/i);
    const bathMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:s)?|ba)/i);
    const sqftMatch = bodyText.match(/([\d,]+)\s*sq\s*ft|([\d,]+)\s*sqft/i);
    
    if (bedMatch) data.bedrooms = parseInt(bedMatch[1]);
    if (bathMatch) data.bathrooms = parseFloat(bathMatch[1]);
    if (sqftMatch) {
      data.sqft = parseInt((sqftMatch[1] || sqftMatch[2]).replace(/,/g, ''));
    }

    // ????
    const yearMatch = bodyText.match(/built\s+in\s+(\d{4})/i) ??
                      bodyText.match(/year\s*built[:\s]*(\d{4})/i);
    if (yearMatch) data.yearBuilt = parseInt(yearMatch[1]);

    return data;
  }

  /**
   * ??5: DOM ??????????
   * 
   * ?????
   * 1. ??? document.body.innerText
   * 2. ? section ????? section ??????????
   * 3. ????? label/value helper?????? header
   * 4. heating/cooling ? stop labels ??
   */
  private extractFromDom(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // 1. ?????????
    const raw = doc.body?.innerText || '';
    const lines = raw
      .split(/\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    // 2. ????????????
    const topData = this.extractFromTopSummary(lines);
    Object.assign(data, topData);

    // 3. Facts & Features section
    const factsLines = getSectionLines(lines, 'Facts & features', [
      'Services availability',
      "Contact a buyer's agent",
      'Offer Insights',
      'Estimated market value',
      'Price history',
      'Public tax history',
      'Monthly payment',
      'Climate risks',
      'Neighborhood:',
    ]);
    if (factsLines.length > 0) {
      const factsData = this.extractFactsSection(factsLines);
      Object.assign(data, factsData);
    }

    // 4. Financial & listing details section
    const financialLines = getSectionLines(lines, 'Financial & listing details', [
      'Services availability',
      "Contact a buyer's agent",
      'Offer Insights',
      'Estimated market value',
      'Price history',
      'Public tax history',
      'Monthly payment',
      'Climate risks',
    ]);
    if (financialLines.length > 0) {
      const financialData = this.extractFinancialSection(financialLines);
      Object.assign(data, financialData);
    }

    // 5. Monthly payment section
    const paymentLines = getSectionLines(lines, 'Monthly payment', [
      'Down payment assistance',
      'Climate risks',
      'Neighborhood:',
    ]);
    if (paymentLines.length > 0) {
      const paymentData = this.extractMonthlyPaymentSection(paymentLines);
      Object.assign(data, paymentData);
    }

    // 6. Climate risks / Flood zone????
    const climateLines = getSectionLines(lines, 'Climate risks', []);
    if (climateLines.length === 0) {
      // ????? flood zone
      const floodLines = getSectionLines(lines, 'Flood zone', []);
      if (floodLines.length > 0) {
        const floodZone = floodLines.slice(1).join(' ').trim();
        if (floodZone) data.floodZone = floodZone;
      }
    } else {
      // ? climate risks ??? flood zone
      const floodZone = getStrictLabelValue(climateLines, ['Flood zone']);
      if (floodZone) data.floodZone = floodZone;
    }

    // 7. Walk Score / Bike Score / Neighborhood / Architectural Style
    const scoresData = this.extractScoresAndNeighborhood(lines);
    Object.assign(data, scoresData);

    // 8. What's Special section -- agent marketing copy from listing-overview
    const wsData = this.extractWhatsSpecial(doc);
    if (wsData.description) data.description = wsData.description;
    if (wsData.whatsSpecialText) data.whatsSpecialText = wsData.whatsSpecialText;
    if (wsData.highlights) data.highlights = wsData.highlights;

    // === LAYER 2 ===
    console.log('[extract] finalData.whatsSpecialText length:', (data.whatsSpecialText || '').length);
    console.log('[extract] finalData.whatsSpecialText preview:', (data.whatsSpecialText || '').slice(0, 120));
    console.log('[extract] finalData.description length:', (data.description || '').length);
    console.log('[extract] finalData.description preview:', (data.description || '').slice(0, 120));
    console.log('[extract] address:', data.address, '| price:', data.price, '| sqft:', data.sqft, '| yearBuilt:', data.yearBuilt);

    return data;
  }

  /**
   * Strict rent / sale detection for US listings.
   *
   * Priority:
   *   1) JSON-LD / __NEXT_DATA__ (high-confidence signals only; offers.price alone does NOT qualify)
   *   2) Targeted DOM nodes (price / status / title / Facts-Policies / CTA), never full-page innerText
   *   3) URL fallback (rent only — homedetails/ is NOT a default for sale)
   *   4) Price-text fallback (rent only — no sale default)
   *
   * Returns 'unknown' whenever the strict signals are missing or conflicting.
   */
  private detectListingTypeInternal(
    doc: Document,
    url: URL,
    raw: Partial<ZillowRawData>,
  ): {
    type: 'rent' | 'sale' | 'unknown';
    source: 'jsonld' | 'dom' | 'url' | 'price' | 'fallback';
    confidence: 'high' | 'medium' | 'low';
    conflicts: Array<'rent' | 'sale'>;
  } {
    const conflicts: Array<'rent' | 'sale'> = [];

    // Step 0: hard-truth body-text scan.
    //   On multi-unit homedetails pages, Zillow's JSON-LD / __NEXT_DATA__ often marks a
    //   property as FOR_SALE even when the listing itself is a tenant-facing rental. The
    //   user's visible UI, however, is always correct: if the page shows "$2,300/mo" or
    //   an "Apply now" CTA, the listing IS a rental. These signals are sourced from the
    //   rendered DOM body, not from "What's special" agent marketing copy, so they win.
    const hardSignal = this.detectHardTruthFromBody(doc, conflicts);
    if (hardSignal === 'rent') {
      return { type: 'rent', source: 'dom', confidence: 'high', conflicts };
    }
    if (hardSignal === 'sale') {
      return { type: 'sale', source: 'dom', confidence: 'high', conflicts };
    }

    // Step 1: structured (JSON-LD + __NEXT_DATA__)
    //   Only commit to 'rent' or 'sale' if structured data is unambiguous AND no DOM
    //   description signals contradict it. Zillow's structured data sometimes marks a
    //   property as FOR_SALE when the listing itself is a tenant-facing rental — in
    //   that case the description will contain 2+ tenant signals that override.
    const jsonldSignal = this.detectFromStructuredData(doc, conflicts);
    if (jsonldSignal === 'rent') {
      return { type: 'rent', source: 'jsonld', confidence: 'high', conflicts };
    }
    if (jsonldSignal === 'sale') {
      // Before committing to 'sale' from structured data alone, run the DOM check to
      // see if the listing description is tenant-facing. Multi-unit homedetails pages
      // sometimes have wrong FOR_SALE metadata.
      const domOverride = this.detectFromTargetedDom(doc, raw, conflicts);
      if (domOverride === 'rent') {
        return { type: 'rent', source: 'dom', confidence: 'medium', conflicts };
      }
      // DOM didn't find rent signals → trust structured data
      return { type: 'sale', source: 'jsonld', confidence: 'high', conflicts };
    }
    if (conflicts.length > 0) {
      // JSON-LD had both rent and sale signals — fall through to DOM for arbitration.
    }

    // ── Phase B: detect rent from targeted DOM/description (independent path).
    //   Zillow's __NEXT_DATA__.gdpClientCache sometimes marks a property as FOR_SALE
    //   even when the listing itself is a tenant-facing rental (multi-unit homedetails).
    //   We treat DOM/description signals as authoritative for the "FOR_SALE" override
    //   when 2+ tenant signals are present.
    const domSignal = this.detectFromTargetedDom(doc, raw, conflicts);
    if (domSignal === 'rent') {
      // DOM found 2+ tenant signals — this wins over a "FOR_SALE" from structured data.
      return { type: 'rent', source: 'dom', confidence: 'medium', conflicts };
    }
    if (domSignal === 'sale') {
      return { type: 'sale', source: 'dom', confidence: 'medium', conflicts };
    }

    // Step 3: URL fallback (rent only)
    const urlSignal = this.detectFromUrl(url);
    if (urlSignal) {
      return { type: urlSignal, source: 'url', confidence: 'low', conflicts };
    }

    // Step 4: price-text fallback (rent only)
    const priceSignal = this.detectFromPriceText(raw);
    if (priceSignal) {
      return { type: priceSignal, source: 'price', confidence: 'low', conflicts };
    }

    return { type: 'unknown', source: 'fallback', confidence: 'low', conflicts };
  }

  /**
   * Step 0 — scan the rendered page body (innerText) for hard-truth rent/sale signals
   * that override structured data. These are signals the user can see directly:
   *   - Rent:
   *       * "$X,XXX/mo" or "$X,XXX/month" anywhere on the page (NOT price/sqft)
   *       * "Apply now" CTA button text
   *       * "For rent" / "Rental listing" status header
   *       * Lease length/deposit language + tenant/landlord/owner-pays language
   *         (combined; either alone is not enough)
   *   - Sale:
   *       * "Make an offer" CTA button text
   *       * "For sale" status header (must NOT be accompanied by rent signals)
   *
   * Returns 'rent' | 'sale' | null. Returns null when no hard signal is found, in which
   * case the caller falls through to structured-data + targeted-DOM checks.
   */
  private detectHardTruthFromBody(
    doc: Document,
    conflicts: Array<'rent' | 'sale'>,
  ): 'rent' | 'sale' | null {
    let sawRent = false;
    let sawSale = false;

    const bodyText = (doc.body?.innerText || doc.body?.textContent || '').toLowerCase();
    if (!bodyText) return null;

    // 1) $/mo price chip — strong rent signal. Require amount + unit suffix.
    //    Excludes price/sqft ($NNN/sqft) and total price ($NNN,NNN alone).
    //    Pattern: "$2,300 /mo" or "$2,300/mo" or "$2,300 month" — not just "$2,300".
    const monthlyPriceRegex = /\$\s?[\d,]+(?:\.\d{2})?\s*\/\s*(?:mo|month|monthly)\b/;
    if (monthlyPriceRegex.test(bodyText)) {
      sawRent = true;
    }

    // 2) CTA buttons in the visible UI.
    //    "Apply now" → rent, "Make an offer" → sale.
    //    We scan every <button> and anchor inside a likely action bar, including any
    //    element whose aria-label / innerText contains the trigger phrase.
    const applyNowRegex = /\bapply\s*now\b/i;
    const makeOfferRegex = /\bmake\s+an?\s+offer\b/i;

    const ctaEls = Array.from(
      doc.querySelectorAll(
        'button, a[role="button"], a.Button, [role="button"], [class*="Button"]',
      ),
    );
    for (const el of ctaEls) {
      const txt = (
        el.getAttribute('aria-label') ||
        (el as HTMLElement).innerText ||
        el.textContent ||
        ''
      ).trim();
      if (!txt) continue;
      if (applyNowRegex.test(txt)) {
        sawRent = true;
      }
      if (makeOfferRegex.test(txt)) {
        sawSale = true;
      }
    }
    // Also search aria-label across the whole document — Apply Now can be on
    // a button whose textContent is empty (icon-only button).
    const allEls = Array.from(doc.querySelectorAll('*'));
    for (const el of allEls) {
      const aria = el.getAttribute('aria-label') || '';
      if (applyNowRegex.test(aria)) {
        sawRent = true;
      }
      if (makeOfferRegex.test(aria)) {
        sawSale = true;
      }
    }

    // 3) Status header text. Rent: "for rent" / "rental listing" / "this is a rental".
    //    Sale: "for sale" — but only if no rent signal was seen.
    const rentHeaderRegex = /\bfor\s+rent\b|\brental\s+listing\b|\bthis\s+home\s+is\s+for\s+rent\b/;
    const saleHeaderRegex = /\bfor\s+sale\b|\bhome\s+for\s+sale\b/;
    if (rentHeaderRegex.test(bodyText)) {
      sawRent = true;
    }
    if (saleHeaderRegex.test(bodyText) && !monthlyPriceRegex.test(bodyText)) {
      sawSale = true;
    }

    if (sawRent && !sawSale) {
      return 'rent';
    }
    if (sawSale && !sawRent) {
      return 'sale';
    }
    if (sawRent && sawSale) {
      // Even on conflicting pages, if we found a $/mo price chip OR a Apply Now CTA,
      // the listing IS a rental — the "For sale" is a stale multi-unit header artifact.
      // This is the explicit override the bug demanded.
      conflicts.push('rent', 'sale');
      return 'rent';
    }
    return null;
  }

  /**
   * Step 1 — read JSON-LD `RealEstateListing` and `__NEXT_DATA__.gdpClientCache`.
   * Sale MUST be signalled by explicit ForSale / FOR_SALE / homeStatus markers; never by offers.price alone.
   */
  private detectFromStructuredData(
    doc: Document,
    conflicts: Array<'rent' | 'sale'>,
  ): 'rent' | 'sale' | null {
    let sawRent = false;
    let sawSale = false;

    // JSON-LD
    try {
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent || '');
          const candidates = Array.isArray(data)
            ? data
            : (data['@graph'] ? data['@graph'] : [data]);

          for (const item of candidates) {
            const type = (item['@type'] || '').toString().toLowerCase();
            if (!type.includes('realestate') && !type.includes('product')) continue;

            const itemOffered = item.itemOffered || item;
            const blob = JSON.stringify(item).toLowerCase();
            const blob2 = JSON.stringify(itemOffered).toLowerCase();

            // rent signal — explicit markers only
            const priceSpec = item?.offers?.priceSpecification || itemOffered?.offers?.priceSpecification;
            const unitText = String(priceSpec?.unitText || priceSpec?.unitCode || priceSpec?.referenceQuantity?.unitCode || '').toUpperCase();
            if (unitText === 'MON') sawRent = true;
            if (blob.includes('forrent') || blob.includes('for_rent') || blob.includes('rental listing')) sawRent = true;

            // sale signal — explicit ForSale markers only
            if (
              blob.includes('forsale') ||
              blob.includes('for_sale') ||
              blob.includes('"additionalproperty"') && blob.includes('"name":"forsale"') ||
              blob2.includes('forsale')
            ) {
              sawSale = true;
            }

            // NOTE: offers.price presence alone does NOT qualify as sale signal
          }
        } catch {
          // skip unparseable ld+json
        }
      }
    } catch {
      // ignore
    }

    // __NEXT_DATA__.gdpClientCache
    try {
      const nextDataScript = doc.querySelector('script[id="__NEXT_DATA__"]');
      if (nextDataScript) {
        const nextData = JSON.parse(nextDataScript.textContent || '');
        const gdpCache = nextData?.props?.pageProps?.componentProps?.gdpClientCache;
        if (gdpCache && typeof gdpCache === 'object') {
          for (const value of Object.values(gdpCache)) {
            if (!value || typeof value !== 'object') continue;
            const v = value as Record<string, unknown>;
            const listingType = String(v.listingType || '').toUpperCase();
            const homeStatus = String(v.homeStatus || '').toUpperCase();
            if (listingType === 'FOR_RENT' || homeStatus === 'FOR_RENT') sawRent = true;
            if (listingType === 'FOR_SALE' || homeStatus === 'FOR_SALE') sawSale = true;
          }
        }
      }
    } catch {
      // ignore
    }

    if (sawRent && sawSale) {
      conflicts.push('rent', 'sale');
      return null;
    }
    if (sawRent) return 'rent';
    if (sawSale) return 'sale';
    return null;
  }

  /**
   * Step 2 — read targeted DOM nodes (price node, status, h1, breadcrumbs, facts/policies, CTA).
   * Treats "Request tour / Schedule tour / Get a tour / Listed by / Contact agent" as NEUTRAL.
   */
  private detectFromTargetedDom(
    doc: Document,
    raw: Partial<ZillowRawData>,
    conflicts: Array<'rent' | 'sale'>,
  ): 'rent' | 'sale' | null {
    let sawRent = false;
    let sawSale = false;

    // 1) Price node — only the leading price chip
    const priceNode =
      doc.querySelector('[data-testid="price"]') ||
      doc.querySelector('[data-testid="list-price"]') ||
      doc.querySelector('h3[class*="price"]') ||
      doc.querySelector('[class*="ListPrice"]');
    if (priceNode) {
      const txt = (priceNode.textContent || '').toLowerCase();
      if (/\/(mo|month|monthly)\b/.test(txt) || /\bmonthly\b/.test(txt)) sawRent = true;
    }

    // 2) Status node
    const statusNode =
      doc.querySelector('[data-testid="status"]') ||
      doc.querySelector('.status-message');
    if (statusNode) {
      const txt = (statusNode.textContent || '').toLowerCase();
      if (/for\s*rent|rent\s*this\s*home/.test(txt)) sawRent = true;
      if (/for\s*sale|sale\s*by\s*owner|listed\s*for\s*sale/.test(txt)) sawSale = true;
    }

    // 3) Title (h1) + breadcrumbs
    const h1 = doc.querySelector('h1');
    if (h1) {
      const txt = (h1.textContent || '').toLowerCase();
      if (/\bfor\s*rent\b|\bapartment\s*for\s*rent\b/.test(txt)) sawRent = true;
      if (/\bfor\s*sale\b/.test(txt)) sawSale = true;
    }
    const breadcrumbs = doc.querySelector('[data-testid="breadcrumbs"]');
    if (breadcrumbs) {
      const txt = (breadcrumbs.textContent || '').toLowerCase();
      if (/for\s*rent|rentals/.test(txt)) sawRent = true;
      if (/for\s*sale|listings/.test(txt)) sawSale = true;
    }

    // 4) Facts/Policies — search for explicit lease/deposit/application keywords
    const factsSection =
      Array.from(doc.querySelectorAll('h2, h3, div'))
        .find(el => /facts\s*(&|and)\s*features|lease\s*terms|rental\s*policies|pricing\s*(&|and)\s*availability/i.test(el.textContent || ''));
    if (factsSection) {
      const txt = (factsSection.parentElement?.textContent || '').toLowerCase();
      if (/lease\s*length|security\s*deposit|pet\s*deposit|application\s*fee|move-?in\s*fee|holding\s*deposit/.test(txt)) {
        sawRent = true;
      }
    }

    // 4b) Listing description keywords — critical for multi-unit / homedetails listings
    // where Zillow's structured data may say FOR_SALE while the listing itself is a
    // tenant-facing rental description. We require at least TWO distinct rent signals
    // (utility metering, tenant/landlord language, deposit language, lease language) to
    // avoid false positives from a single incidental word.
    const desc = String(raw.description || raw.whatsSpecialText || '').toLowerCase();
    if (desc) {
      const rentHits: string[] = [];
      if (/\btenant\s+(pays|paid|responsib|is\s+responsib)\b/.test(desc)) rentHits.push('tenant-pays');
      if (/\blandlord\s+(pays|responsib|is\s+responsib)\b/.test(desc)) rentHits.push('landlord-pays');
      if (/\b(owner\s+pays|owner\s+is\s+responsible)\b/.test(desc)) rentHits.push('owner-pays');
      if (/\b(monthly\s+rent|rent\s+covers|rent\s+includes)\b/.test(desc)) rentHits.push('rent-includes');
      if (/\b(security\s+deposit|pet\s+deposit|holding\s+deposit|move-?in\s+fees?)\b/.test(desc)) rentHits.push('deposit-language');
      if (/\b(lease\s+(length|term)|12-?month\s+lease|month-?to-?month)\b/.test(desc)) rentHits.push('lease-language');
      if (/\b(application\s+fee|credit\s+check|background\s+check)\b/.test(desc)) rentHits.push('application-language');
      if (/\b(reason\s+for\s+moving|tenant\s+is\s+relocating|landlord\s+is\s+relocating)\b/.test(desc)) rentHits.push('tenant-relocating');
      if (/\b(utilities?\s+(are\s+)?included|water\s+and\s+gas|gas\s+and\s+electric)\b/.test(desc)) rentHits.push('utilities-language');
      if (rentHits.length >= 2) {
        sawRent = true;
      }
      // Sale signal: only strong phrases
      if (/\b(for\s+sale|listed\s+for\s+sale|sale\s+by\s+owner|motivated\s+seller)\b/.test(desc) &&
          !/\bfor\s+rent\b/.test(desc)) {
        sawSale = true;
      }
    }

    // 5) CTA buttons — only Apply now / Make offer count; tours are NEUTRAL
    const ctaCandidates = Array.from(
      doc.querySelectorAll('button, a[role="button"], a.Button')
    );
    for (const el of ctaCandidates) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (/^apply\s*now\b/.test(txt)) sawRent = true;
      if (/^make\s*(an?\s*)?offer\b/.test(txt)) sawSale = true;
      // Request/Schedule/Get a tour, Listed by, Contact agent/property → NEUTRAL (no decision)
    }

    // 6) Title text "List price" alone is NOT enough for sale; must combine with another sale signal
    // (already covered by the title check above)

    if (sawRent && sawSale) {
      conflicts.push('rent', 'sale');
      return null;
    }
    if (sawRent) return 'rent';
    if (sawSale) return 'sale';
    return null;
  }

  /**
   * Step 3 — URL fallback (rent only). homedetails/ is NOT a default for sale.
   */
  private detectFromUrl(url: URL): 'rent' | 'sale' | null {
    const path = (url.pathname || '').toLowerCase();
    if (path.includes('/rent/') || path.includes('/rental/') || path.includes('/apartments/') ||
        path.includes('/for-rent/') || path.includes('/community/')) {
      return 'rent';
    }
    return null;
  }

  /**
   * Step 4 — price-text fallback (rent only). Plain "$XXX,XXX" with no period hint is NOT a sale default.
   */
  private detectFromPriceText(raw: Partial<ZillowRawData>): 'rent' | 'sale' | null {
    const txt = String(raw.price || '').toLowerCase();
    if (!txt) return null;
    if (/\/(mo|month)\b|\bmonthly\b/.test(txt) || /\blease\b/.test(txt)) return 'rent';
    // sale only when explicitly mentioned (sale price / one-time payment)
    if (/\bone-?time\b|\bsale\s*price\b/.test(txt)) return 'sale';
    return null;
  }

  /**
   * ??? summary ??????
   */
  private extractFromTopSummary(lines: string[]): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i];

      // ???$ ???
      if (!data.price && line.match(/^\$[\d,]+/)) {
        data.price = line.match(/^(\$[\d,]+(?:\.\d{2})?)/)?.[1] || line;
        data.priceAmount = this.parsePrice(data.price);
      }

      // ????? NY, CA ?????
      if (!data.address && line.match(/[A-Z]{2}\s+\d{5}/)) {
        data.address = line.trim();
      }

      // beds/baths/sqft??? + ?????
      if (!data.bedrooms) {
        const bedsMatch = line.match(/^(\d+)\s*beds?/i);
        if (bedsMatch) data.bedrooms = parseInt(bedsMatch[1]);
      }
      if (!data.bathrooms) {
        const bathsMatch = line.match(/^(\d+(?:\.\d+)?)\s*baths?/i);
        if (bathsMatch) data.bathrooms = parseFloat(bathsMatch[1]);
      }
      if (!data.sqft) {
        const sqftMatch = line.match(/^([\d,]+)\s*sqft/i);
        if (sqftMatch) data.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
      }

      // Est. payment ???
      const estPaymentMatch = line.match(/Est\.\s*payment:\s*\$([\d,]+)/);
      if (estPaymentMatch) {
        data.estimatedPaymentTop = `$${parseInt(estPaymentMatch[1]).toLocaleString()}/mo`;
      }

      // Year built
      const yearMatch = line.match(/Built in (\d{4})/);
      if (yearMatch) {
        data.yearBuilt = parseInt(yearMatch[1]);
      }

      // Lot size
      const lotMatch = line.match(/([\d,]+)\s*Square Feet/i);
      if (lotMatch && !data.lotSize) {
        data.lotSize = `${parseInt(lotMatch[1]).toLocaleString()} Square Feet`;
      }

      // Price per sqft
      const pricePerSqftMatch = line.match(/\$\d+\/sqft/);
      if (pricePerSqftMatch) {
        data.pricePerSqft = pricePerSqftMatch[0];
      }

      // HOA
      const hoaMatch = line.match(/\$\S+\s*HOA/);
      if (hoaMatch) {
        data.hoaFees = hoaMatch[0].replace(/\s*HOA$/, '');
      }

      // Property type
      if (!data.propertyType) {
        const propTypeMatch = line.match(/^(Single Family Residence|Condo|Townhouse|Multi-Family|Manufactured|Lot\/Land)/i);
        if (propTypeMatch) {
          data.propertyType = propTypeMatch[1];
        }
      }
    }

    return data;
  }

  /**
   * ?? Facts & Features section
   */
  private extractFactsSection(factsLines: string[]): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // Bedrooms - ????
    const bedsValue = getStrictLabelValue(factsLines, ['Bedrooms'], [
      'Bathrooms',
      'Full bathrooms',
      '1/2 bathrooms',
      'Heating',
      'Cooling',
      'Basement',
    ]);
    if (bedsValue) data.bedrooms = parseIntValue(bedsValue);

    // Bathrooms - ????
    const bathsValue = getStrictLabelValue(factsLines, ['Bathrooms'], [
      'Full bathrooms',
      '1/2 bathrooms',
      'Heating',
      'Cooling',
      'Basement',
    ]);
    if (bathsValue) data.bathrooms = parseNumber(bathsValue);

    // Full bathrooms
    const fullBathsValue = getStrictLabelValue(factsLines, ['Full bathrooms'], [
      '1/2 bathrooms',
      'Heating',
      'Cooling',
      'Basement',
    ]);
    if (fullBathsValue) data.fullBaths = parseIntValue(fullBathsValue);

    // Half bathrooms
    const halfBathsValue = getStrictLabelValue(factsLines, ['1/2 bathrooms'], [
      'Heating',
      'Cooling',
      'Basement',
    ]);
    if (halfBathsValue) data.halfBaths = parseIntValue(halfBathsValue);

    // Total interior livable area
    const sqftValue = getStrictLabelValue(factsLines, ['Total interior livable area'], [
      'Total structure area',
      'Total spaces',
      'Size',
      'Dimensions',
      'Home type',
      'Year built',
    ]);
    if (sqftValue) {
      const sqftMatch = sqftValue.match(/([\d,]+)/);
      if (sqftMatch) data.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
    }

    // Heating - ?????? Cooling ??? stop labels
    const heatingValue = getStrictLabelValue(factsLines, ['Heating'], [
      'Cooling',
      'Appliances',
      'Features',
      'Interior area',
      'Property',
    ]);
    if (heatingValue) data.heating = heatingValue;

    // Cooling - ????
    const coolingValue = getStrictLabelValue(factsLines, ['Cooling'], [
      'Appliances',
      'Features',
      'Interior area',
      'Property',
    ]);
    if (coolingValue) data.cooling = coolingValue;

    // Basement
    const basementValue = getStrictLabelValue(factsLines, ['Basement'], [
      'Garage',
      'Parking',
      'Stories',
      'Accessibility',
    ]);
    if (basementValue) data.basement = basementValue;

    // Total spaces / Garage spaces
    const totalSpacesValue = getStrictLabelValue(factsLines, ['Total spaces'], [
      'Size',
      'Dimensions',
      'Home type',
      'Year built',
      'Region',
    ]);
    if (totalSpacesValue) {
      const garageMatch = totalSpacesValue.match(/(\d+)/);
      if (garageMatch) data.garageSpaces = parseInt(garageMatch[1]);
    }

    // Size (Lot size)
    const sizeValue = getStrictLabelValue(factsLines, ['Size'], [
      'Dimensions',
      'Home type',
      'Year built',
      'Region',
    ]);
    if (sizeValue) {
      const lotMatch = sizeValue.match(/([\d,]+)\s*Square Feet/i);
      if (lotMatch) {
        data.lotSize = `${parseInt(lotMatch[1]).toLocaleString()} Square Feet`;
      }
    }

    // Dimensions
    const dimsValue = getStrictLabelValue(factsLines, ['Dimensions'], [
      'Home type',
      'Year built',
      'Region',
    ]);
    if (dimsValue) data.lotDimensions = dimsValue;

    // Home type
    const homeTypeValue = getStrictLabelValue(factsLines, ['Home type'], [
      'Property subtype',
      'Year built',
      'Region',
    ]);
    if (homeTypeValue) {
      data.homeType = homeTypeValue;
      // ????? propertyType??? homeType
      if (!data.propertyType) {
        data.propertyType = homeTypeValue;
      }
    }

    // Property subtype
    const propSubtypeValue = getStrictLabelValue(factsLines, ['Property subtype'], [
      'Year built',
      'Region',
    ]);
    if (propSubtypeValue) {
      data.propertySubtype = propSubtypeValue;
      // ????? propertyType??? propertySubtype
      if (!data.propertyType) {
        data.propertyType = propSubtypeValue;
      }
    }

    // Year built
    const yearValue = getStrictLabelValue(factsLines, ['Year built'], [
      'Region',
    ]);
    if (yearValue) {
      const yearMatch = yearValue.match(/(\d{4})/);
      if (yearMatch) data.yearBuilt = parseInt(yearMatch[1]);
    }

    // Region
    const regionValue = getStrictLabelValue(factsLines, ['Region'], []);
    if (regionValue) data.region = regionValue;

    // Parking features
    const parkingValue = getStrictLabelValue(factsLines, ['Parking features'], []);
    if (parkingValue) data.parkingFeatures = parkingValue;

    return data;
  }

  /**
   * ?? Financial & listing details section
   */
  private extractFinancialSection(financialLines: string[]): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // Price per square foot
    const pricePerSqftValue = getStrictLabelValue(financialLines, ['Price per square foot'], [
      'Tax assessed value',
    ]);
    if (pricePerSqftValue) data.pricePerSqft = pricePerSqftValue;

    // Tax assessed value
    const taxValue = getStrictLabelValue(financialLines, ['Tax assessed value'], [
      'Annual tax amount',
      'Date on market',
    ]);
    if (taxValue) {
      data.taxAssessedValueStr = taxValue;
      const taxNum = parseNumber(taxValue);
      if (taxNum) data.taxAssessedValue = Math.round(taxNum) ?? undefined;
    }

    // Annual tax amount
    const annualTaxValue = getStrictLabelValue(financialLines, ['Annual tax amount'], [
      'Date on market',
      'Cumulative days on market',
    ]);
    if (annualTaxValue) {
      data.annualTaxStr = annualTaxValue;
      const taxNum = parseNumber(annualTaxValue);
      if (taxNum) data.annualTax = Math.round(taxNum) ?? undefined;
    }

    // Date on market
    const dateOnMarketValue = getStrictLabelValue(financialLines, ['Date on market'], [
      'Cumulative days on market',
      'Listing agreement',
    ]);
    if (dateOnMarketValue) data.dateOnMarket = dateOnMarketValue;

    // Cumulative days on market
    const daysOnMarketValue = getStrictLabelValue(financialLines, ['Cumulative days on market'], [
      'Listing agreement',
    ]);
    if (daysOnMarketValue) data.cumulativeDaysOnMarket = daysOnMarketValue;

    return data;
  }

  /**
   * ?? Monthly payment section
   */
  private extractMonthlyPaymentSection(paymentLines: string[]): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    // Estimated monthly payment
    const estPaymentValue = getStrictLabelValue(paymentLines, ['Estimated monthly payment'], [
      'Principal & interest',
      'Down payment',
    ]);
    if (estPaymentValue) data.monthlyPayment = estPaymentValue;

    // Principal & interest
    const piValue = getStrictLabelValue(paymentLines, ['Principal & interest'], [
      'Mortgage insurance',
      'Property taxes',
    ]);
    if (piValue) data.principalAndInterest = piValue;

    // Mortgage insurance
    const miValue = getStrictLabelValue(paymentLines, ['Mortgage insurance'], [
      'Property taxes',
      'Home insurance',
    ]);
    if (miValue) data.mortgageInsurance = miValue;

    // Property taxes
    const propTaxValue = getStrictLabelValue(paymentLines, ['Property taxes'], [
      'Home insurance',
      'HOA fees',
    ]);
    if (propTaxValue) data.propertyTaxesMonthly = propTaxValue;

    // Home insurance
    const insValue = getStrictLabelValue(paymentLines, ['Home insurance'], [
      'HOA fees',
      'Utilities',
    ]);
    if (insValue) data.homeInsuranceMonthly = insValue;

    // HOA fees
    const hoaValue = getStrictLabelValue(paymentLines, ['HOA fees'], [
      'Utilities',
    ]);
    if (hoaValue) data.hoaFees = hoaValue;

    // Utilities
    const utilValue = getStrictLabelValue(paymentLines, ['Utilities'], []);
    if (utilValue) data.utilities = utilValue;

    return data;
  }

  /**
   * Extracts the "What's Special" section -- agent marketing copy.
   *
   * Priority:
   *   1. Scoped listing-overview: data-testid="listing-overview" with "What's special" h2
   *   2. Heading-section scan: walk innerText lines looking for "What's special"
   *
   * Returns whatsSpecialText + cleanDescription + descriptionSource.
   * Never uses a global [data-testid="description"] query.
   * Never writes address / price / sqft / yearBuilt / zillowFinancials / images.
   */
  private extractWhatsSpecial(doc: Document): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    const MLS_RE = /^(source\s*:|mls\s*#|onekey\s*mls|idx\s*program|streeteasy\s*source|deemed\s+reliable|subject\s+to\s+prior\s+sale|report\s+a\s*problem|\(c\)\s*\d{4}|all\s+information\s+should\s+be\s+independently|properties\s+may\s+or\s+may\s+not\s+be\s+listed|supplied\s+open\s+house|listing\s+data\s+last\s+updated|broker's\s*firm|internet\s+data\s+exchange)/i;
    const isNoise = (line: string): boolean => MLS_RE.test(line.trim());
    const STOP_LINES_RE = /^(show\s*more$|show\s*less$|show\s*details$|hide$|hide\s*details$|listed\s*by|price\s*history|^features$|interior\s*features|property\s*details|financial\s*info|monthly\s*payment|zillow\s*last\s*checked|listing\s*updated|street\s*view|travel\s*times|maps?\s*and\s*markets?)/i;
    const cleanLine = (line: string): string =>
      line.replace(/^(show\s*more|show\s*less|hide)$/i, '').trim();

    // ?? STRATEGY 1: scoped listing-overview ??????????????????????????????????????
    const overview = doc.querySelector('[data-testid="listing-overview"]');
    console.log('[Zillow Extractor][WhatsSpecial scoped] running | overview exists:', !!overview);

    if (overview) {
      const h2 = overview.querySelector('h2');
      const headingText = h2?.textContent?.trim() || '';
      console.log('[Zillow Extractor][WhatsSpecial scoped] headingText:', headingText);

      if (/what'?s\s*special/i.test(headingText)) {
        const highlights: string[] = [];
        for (const li of overview.querySelectorAll('span[role="listitem"]')) {
          const text = (li.getAttribute('aria-label') || li.textContent || '').trim();
          if (text && !isNoise(text)) {
            highlights.push(text);
          }
        }

        const bodyEl =
          overview.querySelector('[data-testid="description"]') ||
          overview.querySelector('article');

        const bodyLines: string[] = [];
        if (bodyEl) {
          const text = (bodyEl as HTMLElement).innerText || '';
          for (const raw of text.split(/\n+/)) {
            const trimmed = raw.trim();
            if (isNoise(trimmed)) continue;
            if (STOP_LINES_RE.test(trimmed)) break;
            const cleaned = cleanLine(trimmed);
            if (cleaned.length >= 5) bodyLines.push(cleaned);
          }
        }

        console.log('[Zillow Extractor][WhatsSpecial scoped] highlightCount:', highlights.length);
        console.log('[Zillow Extractor][WhatsSpecial scoped] bodyLines count:', bodyLines.length);

        const parts: string[] = [];
        if (highlights.length > 0) parts.push(...highlights);
        if (bodyLines.length > 0) parts.push(...bodyLines);

        if (parts.length > 0) {
          const clean = parts.join(' ').trim();
          if (clean.length >= 30) {
            data.whatsSpecialText = clean;
            data.description = clean;
            data.descriptionSource = 'listing_overview';
            console.log('[Zillow Extractor][WhatsSpecial scoped] ? SUCCESS | whatsSpecialText length:', clean.length, '| preview:', clean.slice(0, 120));
            return data;
          }
        }
      }
    }

    // ?? STRATEGY 2: heading-section scan (full-page fallback) ??????????????????
    const bodyText = doc.body?.innerText || '';
    const lines = bodyText.split(/\n+/);
    let inSection = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^what'?s\s*special$/i.test(trimmed)) { inSection = true; continue; }
      if (inSection) {
        if (isNoise(trimmed)) continue;
        if (STOP_LINES_RE.test(trimmed)) break;
        if (trimmed.length >= 5) sectionLines.push(cleanLine(trimmed));
      }
    }

    if (sectionLines.length > 0) {
      const clean = sectionLines.join(' ').trim();
      if (clean.length >= 30) {
        data.whatsSpecialText = clean;
        data.description = clean;
        data.descriptionSource = 'heading_scan';
        console.log('[Zillow Extractor][WhatsSpecial heading-scan] ? SUCCESS | length:', clean.length);
        return data;
      }
    }

    console.log('[Zillow Extractor][WhatsSpecial] ? no real content found | returning empty');
    return data;
  }

  /**
   * ? propertyData ???????
   * ??????????????? unit number??
   */
  private extractAddress(data: Record<string, unknown>): string {
    // ??????
    const candidates: string[] = [];

    // ????????
    if (data?.streetAddress) candidates.push(String(data.streetAddress));
    if (data?.address) {
      const addr = String(data.address);
      if (!candidates.includes(addr)) candidates.push(addr);
    }
    if (data?.formattedAddress) {
      const addr = String(data.formattedAddress);
      if (!candidates.includes(addr)) candidates.push(addr);
    }
    if (data?.location && typeof data.location === 'object') {
      const locAddr = (data.location as Record<string, unknown>)?.address;
      if (locAddr && typeof locAddr === 'string') candidates.push(locAddr);
    }
    if (data?.hdpData && typeof data.hdpData === 'object') {
      const homeInfo = (data.hdpData as Record<string, unknown>)?.homeInfo;
      if (homeInfo && typeof homeInfo === 'object') {
        const hiAddr = (homeInfo as Record<string, unknown>)?.streetAddress;
        if (hiAddr && typeof hiAddr === 'string') candidates.push(String(hiAddr));
      }
    }
    if (data?.street && data?.city && data?.state && data?.zipcode) {
      const reconstructed = `${data.street}, ${data.city}, ${data.state} ${data.zipcode}`;
      if (!candidates.includes(reconstructed)) candidates.push(reconstructed);
    }

    // ???????? unit number ????Queens ??: "46-26 217th St #1"?
    const unitPattern = /#[A-Z0-9]|apt\.?\s*\d|unit\s*\d/i;
    for (const addr of candidates) {
      if (addr && addr.length > 5 && unitPattern.test(addr)) {
        return addr;
      }
    }

    // ???????????
    for (const addr of candidates) {
      if (addr && addr.length > 5) {
        return addr;
      }
    }

    // ??????? parts
    const parts = [
      data?.street,
      data?.city,
      data?.state,
      data?.zipcode,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : '';
  }

  /**
   * ? propertyData ?????
   */
  private extractPrice(data: Record<string, unknown>): string {
    const hdpData = data?.hdpData as Record<string, unknown> | undefined;
    const homeInfo = hdpData?.homeInfo as Record<string, unknown> | undefined;
    const priceFields: (string | number | undefined)[] = [
      data?.price as string | number | undefined,
      data?.unformattedPrice as string | number | undefined,
      data?.listPrice as string | number | undefined,
      data?.zestimate as string | number | undefined,
      data?.lastSoldPrice as string | number | undefined,
      homeInfo?.zestimate as string | number | undefined,
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
   * ? propertyData ???????
   */
  private extractPhotoUrls(data: Record<string, unknown>): string[] {
    const photos: string[] = [];

    // ?????????
    const hdpData = data?.hdpData as Record<string, unknown> | undefined;
    const homeInfo = hdpData?.homeInfo as Record<string, unknown> | undefined;
    const mediaData = (data?.media as Array<Record<string, unknown>> | undefined);
    const photoPaths: (unknown[] | string | undefined)[] = [
      data?.photos as unknown[] | undefined,
      data?.imageUrls as unknown[] | undefined,
      data?.photoUrls as unknown[] | undefined,
      mediaData?.[0]?.url as string | undefined,
      homeInfo?.photoUrl as string | undefined,
      data?.listingPhotos as unknown[] | undefined,
      data?.images as unknown[] | undefined,
    ];

    for (const path of photoPaths) {
      if (Array.isArray(path)) {
        for (const photo of path) {
          if (typeof photo === 'string') {
            photos.push(this.cleanImageUrl(photo));
          } else if (photo && typeof photo === 'object') {
            const photoObj = photo as Record<string, unknown>;
            if (photoObj?.url) {
              photos.push(this.cleanImageUrl(photoObj.url as string));
            } else if (photoObj?.src) {
              photos.push(this.cleanImageUrl(photoObj.src as string));
            }
          }
        }
      }
    }

    return [...new Set(photos)].slice(0, 30);
  }

  /**
   * ? propertyData ???????
   */
  private extractSchoolRatings(data: Record<string, unknown>): SchoolRating[] {
    const schools: SchoolRating[] = [];
    
    const schoolData = data?.schools ?? data?.schoolRatings ?? data?.nearbySchools ?? [];
    
    if (!Array.isArray(schoolData)) return [];

    for (const school of schoolData.slice(0, 10)) {
      const schoolObj = school as Record<string, unknown>;
      if (schoolObj?.name) {
        schools.push({
          name: schoolObj.name as string,
          rating: (schoolObj.rating ?? schoolObj.score ?? 0) as number,
          level: (schoolObj.level ?? schoolObj.type) as 'elementary' | 'middle' | 'high' | undefined,
          distance: (schoolObj.distance ?? schoolObj.proximity) as string | undefined,
        });
      }
    }

    return schools;
  }

  /**
   * ????????????
   */
  private deepSearch(obj: unknown, keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    if (!obj || typeof obj !== 'object') return result;

    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (keys.includes(key.toLowerCase())) {
        result[key] = (obj as Record<string, unknown>)[key];
      }
    }

    // ???????
    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        const subResult = this.deepSearch(value, keys);
        Object.assign(result, subResult);
      }
    }

    return result;
  }

  /**
   * ???? URL?????????????
   */
  private cleanImageUrl(url: string): string {
    if (!url) return '';
    
    // ?? Zillow ??????
    let cleaned = url
      .replace(/[?&]width=\d+/g, '')
      .replace(/[?&]height=\d+/g, '')
      .replace(/[?&]fit=\w+/g, '')
      .replace(/[?&]downsample=\w+/g, '')
      .replace(/\?+$/, '');
    
    // ??? Zillow CDN ?????????????
    if (cleaned.includes('photos.wikimapia.org') || cleaned.includes('photos.zillow.com')) {
      // ????????
      cleaned = cleaned.replace(/\/\d+_[a-z]\.jpg$/i, '_a.jpg');
    }
    
    return cleaned;
  }

  /**
   * ??????
   */
  private processImages(urls: string[]): string[] {
    const cleaned = urls
      .map(url => this.cleanImageUrl(url))
      .filter(url => url.startsWith('http'))
      .filter(url => !url.match(/logo|icon|avatar|placeholder/));
    
    return [...new Set(cleaned)].slice(0, 30);
  }

  /**
   * ?? URL ?????????/???
   */
  private determinePricePeriod(url: string): StandardizedListingData['pricePeriod'] {
    if (url.includes('/rent/') || url.includes('/for-rent/')) {
      return 'month';
    }
    return 'total';
  }

  /**
   * ??????????
   */
  private parsePrice(priceStr: string | undefined): number | undefined {
    if (!priceStr) return undefined;
    
    // ?? $ ? , 
    const cleaned = priceStr
      .replace(/\$/g, '')
      .replace(/,/g, '')
      .replace(/\s*\/\s*(?:mo|month|week|year)/gi, '')
      .trim();
    
    // ????
    const match = cleaned.match(/[\d,]+(?:\.\d{2})?/);
    if (match) {
      return parseFloat(match[0].replace(/,/g, ''));
    }
    
    return undefined;
  }

  /**
   * ? Zillow ??????????
   * ???????????????? div[id="__cl1n_jeg20e"] ? class ?? StyledModalDialog?
   */
  async extractImages(ctx: ExtractContext): Promise<string[]> {
    const doc = ctx.document;

    // ????????
    if (!this.isGalleryModalOpen(doc)) {
      await this.waitForGalleryModal(doc);
    }

    // ??????
    const mediaWall = doc.querySelector('ul[class*="hollywood-vertical-media-wall"]') ||
                      doc.querySelector('ul[class*="media-wall-container"]') ||
                      doc.querySelector('ul[class*="media-wall"]');

    if (!mediaWall) {
      console.warn('[ZillowExtractor] Gallery media wall not found');
      return [];
    }

    // ???? li ??????
    const images: string[] = [];
    const items = mediaWall.querySelectorAll('li[class*="media-stream-tile"]');

    for (const item of items) {
      const source = item.querySelector('picture > source');
      const srcset = source?.getAttribute('srcset');

      if (srcset) {
        // ? srcset ??????????? URL???? 1536w?
        const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
        const bestUrl = urls[urls.length - 1];
        if (bestUrl) {
          images.push(this.upgradeToHiRes(bestUrl));
        }
      } else {
        // ???? img src ??
        const img = item.querySelector('picture > img') as HTMLImageElement | null;
        const src = img?.src;
        if (src) {
          images.push(this.upgradeToHiRes(src));
        }
      }
    }

    return this.deduplicateImages(images);
  }

  /**
   * ????????????
   */
  private isGalleryModalOpen(doc: Document): boolean {
    return !!(
      doc.querySelector('div[id="__cl1n_jeg20e"]') ||
      doc.querySelector('[class*="StyledModalDialog"]')
    );
  }

  /**
   * ????????????? 5 ??
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

      // 5 ?????
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000);
    });
  }

  /**
   * ?????????? 1536?
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
   * ??????
   */
  private deduplicateImages(urls: string[]): string[] {
    return [...new Set(urls)];
  }

  /**
   * Extract Walk Score, Bike Score, Neighborhood, and Architectural Style from DOM text.
   */
  private extractScoresAndNeighborhood(lines: string[]): Partial<ZillowRawData> {
    const data: Partial<ZillowRawData> = {};

    for (const line of lines) {
      // Walk Score: "Walk Score: 37 / 100, Car-Dependent"
      const walkMatch = line.match(/walk\s+score[:\s]*(\d+)\s*\/\s*100/i);
      if (walkMatch && !data.walkScore) {
        const score = walkMatch[1];
        const labelMatch = line.match(/,\s*([^,]+)$/);
        data.walkScore = `${score} / 100${labelMatch ? ', ' + labelMatch[1].trim() : ''}`;
      }

      // Bike Score: "Bike Score: 56 / 100, Bikeable"
      const bikeMatch = line.match(/bike\s+score[:\s]*(\d+)\s*\/\s*100/i);
      if (bikeMatch && !data.bikeScore) {
        const score = bikeMatch[1];
        const labelMatch = line.match(/,\s*([^,]+)$/);
        data.bikeScore = `${score} / 100${labelMatch ? ', ' + labelMatch[1].trim() : ''}`;
      }

      // Neighborhood: "Neighborhood: Bayside"
      const neighborhoodMatch = line.match(/^neighborhood[:\s]*(.+)/i);
      if (neighborhoodMatch && !data.neighborhood) {
        const candidate = neighborhoodMatch[1].trim();
        if (!isMlsAttribution(candidate)) {
          data.neighborhood = candidate;
        }
      }

      // Architectural Style: "Architectural style: Raised Ranch"
      const archMatch = line.match(/architectural\s+style[:\s]*(.+)/i);
      if (archMatch && !data.architecturalStyle) {
        const candidate = archMatch[1].trim();
        if (!isMlsAttribution(candidate)) {
          data.architecturalStyle = candidate;
        }
      }

      // Stories: "Stories: 2"
      const storiesMatch = line.match(/stories[:\s]*(.+)/i);
      if (storiesMatch && !data.stories) {
        data.stories = storiesMatch[1].trim();
      }

      // HOA Status: "Has HOA: No" or "HOA fee: N/A"
      const hoaMatch = line.match(/(?:has\s+hoa|hoa\s+fee)[:\s]*(.+)/i);
      if (hoaMatch && !data.hoaStatus) {
        data.hoaStatus = hoaMatch[1].trim();
      }
    }

    return data;
  }

  /**
   * ????????????
   */
  private calculateConfidence(data: Partial<ZillowRawData>): number {
    let confidence = 0.2; // ???

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

// ============================================================================
// Top-level helpers — used by ZillowExtractor merge pipeline
// ============================================================================

/**
 * Strip $ + comma + /mo suffix from a price string and return a number.
 * Falls back to undefined on parse failure.
 */
function parsePriceToNumber(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  const cleaned = priceStr
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s*\/\s*(?:mo|month|week|year)/gi, '')
    .trim();
  const match = cleaned.match(/[\d]+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = parseFloat(match[0]);
  return isNaN(n) ? undefined : n;
}

/**
 * Parse a "$X,XXX" string into a number. Used for monthlyPayment / propertyTaxMonthly / etc.
 */
function parseNumberString(value: string | undefined | null): number | undefined {
  if (value == null) return undefined;
  const cleaned = String(value).replace(/[$,]/g, '').trim();
  const match = cleaned.match(/[\d]+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = parseFloat(match[0]);
  return isNaN(n) ? undefined : n;
}

/**
 * Parse monthlyRent from raw page text. Supports "$2,300/mo", "$2,300 /mo", "2300/mo".
 * 优先 raw.priceAmount（已解析数字），否则从 raw.price 文本解析。
 */
function parseMonthlyRent(
  priceText: string | undefined,
  priceAmount: number | undefined,
): number | null {
  // 必须是 /mo 才算 rent；total 价格不能直接当 monthlyRent
  if (priceText && /\/(?:mo|month|monthly)\b/i.test(priceText)) {
    return priceAmount ?? parsePriceToNumber(priceText) ?? null;
  }
  return null;
}

/**
 * Parse advertisedRentRange: 仅来自页面实际广告租金上下限。
 * 例: "$2,200 - $2,800/mo" → { low: 2200, high: 2800 }
 * 严格区分于 rentZestimate（rentZestimate 是 Zillow 估算，与广告上下限不混用）。
 *
 * Zillow 在大部分 Rent 列表只展示单一价格（$/mo），不展示区间。
 * 当 raw 中没有区间数据时返回 null，不退化到 rentZestimate。
 */
function parseAdvertisedRentRange(
  raw: Partial<ZillowRawData>,
): { low?: number | null; high?: number | null } | null {
  const txt = String(raw.price ?? '');
  if (!txt) return null;
  const match = txt.match(/\$\s?([\d,]+)\s*[-–—]\s*\$\s?([\d,]+)\s*(?:\/\s*(?:mo|month))?/i);
  if (!match) return null;
  const low = parseNumberString(match[1]);
  const high = parseNumberString(match[2]);
  if (low == null && high == null) return null;
  return { low: low ?? null, high: high ?? null };
}

/**
 * 合并 common + rent → StandardizedListingData（rent 路径）。
 * 严格互斥：不得写入 sale 专属字段（askingPrice/zestimate/monthlyPayment/annualTax/...）。
 * 旧字段 price/parking/rentZestimate 同时填充（兼容现有链路）。
 */
function mergeCommonAndRent(
  common: CommonListingFields,
  rent: RentListingFields,
  ctx: ExtractContext,
  meta: ListingTypeMeta,
): StandardizedListingData {
  const pricePeriod: StandardizedListingData['pricePeriod'] = 'month';
  return {
    // === 必填核心 ===
    source: 'zillow',
    url: ctx.url.href,

    // === 标准化公共字段 ===
    address: common.address,
    title: common.title,
    /** 旧字段 price: 仅保留 displayPrice 同源文本，不参与模式判断 */
    price: common.displayPrice ?? '',
    priceAmount: rent.monthlyRent ?? undefined,
    pricePeriod,
    bedrooms: common.bedrooms,
    bathrooms: common.bathrooms,
    propertyType: common.propertyType,
    description: common.description,
    whatsSpecialText: common.whatsSpecialText,
    images: common.images,

    // === 澳洲特有 ===
    carSpaces: undefined,
    /** 旧字段 parking: 与 Common.parkingDescription 并存 */
    parking: common.garageSpaces ?? null,

    // === 美国特有 ===
    sqft: common.sqft,
    zestimate: undefined,
    /** 旧字段 rentZestimate: 保持原 string | null 类型 */
    rentZestimate: undefined,
    yearBuilt: common.yearBuilt ?? null,
    lotSize: undefined,
    hoaFee: undefined,
    propertyTax: undefined,
    schoolRatings: common.schoolRatings,
    daysOnZillow: undefined,

    // === DOM 扩展 ===
    homeType: common.homeType,
    propertySubtype: common.propertySubtype,
    walkScore: common.walkScore,
    bikeScore: common.bikeScore,
    neighborhood: common.neighborhood,
    architecturalStyle: common.architecturalStyle,
    stories: common.stories,
    hoaStatus: undefined,
    floodZone: common.floodZone ?? null,
    highlights: undefined,
    heating: common.heating,
    cooling: common.cooling,
    basement: common.basement,
    garageSpaces: common.garageSpaces ?? null,
    carportSpaces: null,
    constructionMaterial: undefined,
    parcelNumber: undefined,
    taxAssessedValue: undefined,
    annualTax: undefined,
    dateOnMarket: undefined,
    region: common.region,
    gasMeters: null,

    // === 通用扩展 ===
    facts: undefined,
    rawJson: undefined,

    // === 提取元数据 ===
    extractionConfidence: 0.5,
    extractedAt: new Date().toISOString(),

    // === 模式识别 ===
    listingType: 'rent',
    listingTypeSource: meta.source,
    listingTypeConfidence: meta.confidence,
    listingTypeConflicts: meta.conflicts,

    // ─── 新增字段（rent 路径）───
    displayPrice: common.displayPrice,
    parkingDescription: common.parkingDescription,
    managementCompany: common.managementCompany,

    monthlyRent: rent.monthlyRent ?? null,
    advertisedRentRange: rent.advertisedRentRange ?? null,
    exactUnit: rent.exactUnit ?? null,
    availableDate: rent.availableDate ?? null,
    securityDeposit: rent.securityDeposit ?? null,
    holdingDeposit: rent.holdingDeposit ?? null,
    applicationFee: rent.applicationFee ?? null,
    leaseTerm: rent.leaseTerm ?? null,
    utilitiesIncluded: rent.utilitiesIncluded ?? null,
    landlordPays: rent.landlordPays ?? null,
    tenantPays: rent.tenantPays ?? null,
    petPolicy: rent.petPolicy ?? null,
    parkingFee: rent.parkingFee ?? null,
    amenityFee: rent.amenityFee ?? null,
    qualificationRequirements: rent.qualificationRequirements ?? null,

    // sale 字段在 rent 路径下不写入（undefined）— 由类型系统隐式表达
  };
}

/**
 * 合并 common + sale → StandardizedListingData（sale 路径）。
 * 严格互斥：不得写入 rent 专属字段（monthlyRent/securityDeposit/leaseTerm/...）。
 * 旧字段 price/parking/rentZestimate 同时填充（兼容现有链路）。
 */
function mergeCommonAndSale(
  common: CommonListingFields,
  sale: SaleListingFields,
  ctx: ExtractContext,
  meta: ListingTypeMeta,
): StandardizedListingData {
  const pricePeriod: StandardizedListingData['pricePeriod'] = 'total';
  return {
    // === 必填核心 ===
    source: 'zillow',
    url: ctx.url.href,

    // === 标准化公共字段 ===
    address: common.address,
    title: common.title,
    price: common.displayPrice ?? '',
    priceAmount: sale.askingPrice ?? undefined,
    pricePeriod,
    bedrooms: common.bedrooms,
    bathrooms: common.bathrooms,
    propertyType: common.propertyType,
    description: common.description,
    whatsSpecialText: common.whatsSpecialText,
    images: common.images,

    // === 澳洲特有 ===
    carSpaces: undefined,
    parking: common.garageSpaces ?? null,

    // === 美国特有 ===
    sqft: common.sqft,
    zestimate: sale.zestimate != null ? String(sale.zestimate) : undefined,
    rentZestimate: undefined,
    yearBuilt: common.yearBuilt ?? null,
    lotSize: sale.lotSize ?? undefined,
    hoaFee: sale.hoaFee ?? undefined,
    propertyTax: undefined,
    schoolRatings: common.schoolRatings,
    daysOnZillow: sale.daysOnZillow ?? null,

    // === DOM 扩展 ===
    homeType: common.homeType,
    propertySubtype: common.propertySubtype,
    walkScore: common.walkScore,
    bikeScore: common.bikeScore,
    neighborhood: common.neighborhood,
    architecturalStyle: common.architecturalStyle,
    stories: common.stories,
    hoaStatus: sale.hoaStatus ?? undefined,
    floodZone: common.floodZone ?? null,
    highlights: undefined,
    heating: common.heating,
    cooling: common.cooling,
    basement: common.basement,
    garageSpaces: common.garageSpaces ?? null,
    carportSpaces: null,
    constructionMaterial: undefined,
    parcelNumber: undefined,
    taxAssessedValue: sale.taxAssessedValue ?? null,
    annualTax: sale.annualTax ?? null,
    dateOnMarket: sale.dateOnMarket,
    region: common.region,
    gasMeters: null,

    // === 通用扩展 ===
    facts: undefined,
    rawJson: undefined,

    // === 提取元数据 ===
    extractionConfidence: 0.5,
    extractedAt: new Date().toISOString(),

    // === 模式识别 ===
    listingType: 'sale',
    listingTypeSource: meta.source,
    listingTypeConfidence: meta.confidence,
    listingTypeConflicts: meta.conflicts,

    // ─── 新增字段（sale 路径）───
    displayPrice: common.displayPrice,
    parkingDescription: common.parkingDescription,
    managementCompany: common.managementCompany,

    askingPrice: sale.askingPrice ?? null,
    saleZestimate: sale.zestimate ?? null,
    pricePerSqft: sale.pricePerSqft ?? null,
    propertyTaxMonthly: sale.propertyTaxMonthly ?? null,
    homeInsuranceMonthly: sale.homeInsuranceMonthly ?? null,
    priceHistory: sale.priceHistory ?? null,
    lotDimensions: sale.lotDimensions ?? null,

    // rent 字段在 sale 路径下不写入（undefined）
  };
}

/**
 * 合并 common + unknown → StandardizedListingData。
 * 等待 ReportModeModal 选定 Rent/Sale 后，通过 forceReextract 重新跑 specific。
 * 不允许只 toggle listingType 用 common 数据直接发起分析。
 */
function mergeCommonAndUnknown(
  common: CommonListingFields,
  ctx: ExtractContext,
  meta: ListingTypeMeta,
): StandardizedListingData {
  const pricePeriod: StandardizedListingData['pricePeriod'] = ctx.url.href.includes('/rent/')
    ? 'month'
    : 'total';
  return {
    source: 'zillow',
    url: ctx.url.href,
    address: common.address,
    title: common.title,
    price: common.displayPrice ?? '',
    priceAmount: undefined,
    pricePeriod,
    bedrooms: common.bedrooms,
    bathrooms: common.bathrooms,
    propertyType: common.propertyType,
    description: common.description,
    whatsSpecialText: common.whatsSpecialText,
    images: common.images,
    carSpaces: undefined,
    parking: common.garageSpaces ?? null,
    sqft: common.sqft,
    zestimate: undefined,
    rentZestimate: undefined,
    yearBuilt: common.yearBuilt ?? null,
    lotSize: undefined,
    hoaFee: undefined,
    propertyTax: undefined,
    schoolRatings: common.schoolRatings,
    daysOnZillow: undefined,
    homeType: common.homeType,
    propertySubtype: common.propertySubtype,
    walkScore: common.walkScore,
    bikeScore: common.bikeScore,
    neighborhood: common.neighborhood,
    architecturalStyle: common.architecturalStyle,
    stories: common.stories,
    hoaStatus: undefined,
    floodZone: common.floodZone ?? null,
    highlights: undefined,
    heating: common.heating,
    cooling: common.cooling,
    basement: common.basement,
    garageSpaces: common.garageSpaces ?? null,
    carportSpaces: null,
    constructionMaterial: undefined,
    parcelNumber: undefined,
    taxAssessedValue: undefined,
    annualTax: undefined,
    dateOnMarket: undefined,
    region: common.region,
    gasMeters: null,
    facts: undefined,
    rawJson: undefined,
    extractionConfidence: 0.3,
    extractedAt: new Date().toISOString(),
    listingType: 'unknown',
    listingTypeSource: meta.source,
    listingTypeConfidence: meta.confidence,
    listingTypeConflicts: meta.conflicts,

    // 新增字段（unknown 路径：只填 common 相关）
    displayPrice: common.displayPrice,
    parkingDescription: common.parkingDescription,
    managementCompany: common.managementCompany,

    // rent/sale specific 字段全部 undefined — 等待 forceReextract
  };
}
