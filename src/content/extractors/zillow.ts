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

import type { ListingExtractor, ExtractContext } from './base';
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
    // ????????
    let rawData = this.extractFromJsonLd(ctx.document);

    // Cascade: only skip a strategy if we already have the essential fields from it.
    // Always run the JSON-LD step (method 0) regardless.
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

    // ??5: DOM ??????????section-scoped parsing?
    const domData = this.extractFromDom(ctx.document);
    rawData = { ...rawData, ...domData };

    // ??????????????????
    if (!rawData.address && !rawData.price) {
      console.warn('[ZillowExtractor] Failed to extract data with any strategy');
    }

    // ?????
    const confidence = this.calculateConfidence(rawData);

    // ?????
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
      description: cleanDescription(rawData.description) || '',
      whatsSpecialText: cleanDescription(rawData.whatsSpecialText) || '',
      images: this.processImages(rawData.photoUrls || []),

      // Zillow ??
      sqft: rawData.sqft ?? null,
      zestimate: rawData.zestimate,
      rentZestimate: rawData.rentZestimate,
      yearBuilt: rawData.yearBuilt ?? null,
      lotSize: rawData.lotSize,
      hoaFee: rawData.hoaFee,
      propertyTax: rawData.propertyTax,
      schoolRatings: rawData.schoolRatings,
      daysOnZillow: rawData.daysOnZillow ?? null,

      // DOM ??????
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

      // Home type and subtype (extracted from Facts & Features section)
      homeType: rawData.homeType || rawData.propertyType || '',
      propertySubtype: rawData.propertySubtype || '',

      // Additional extracted fields
      walkScore: rawData.walkScore,
      bikeScore: rawData.bikeScore,
      neighborhood: rawData.neighborhood,
      architecturalStyle: rawData.architecturalStyle,
      stories: rawData.stories,
      hoaStatus: rawData.hoaStatus,

      // ?????
      extractionConfidence: confidence,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * ??0: ?? JSON-LD RealEstateListing?schema.org ???
   * Zillow ???????????????
   */
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
