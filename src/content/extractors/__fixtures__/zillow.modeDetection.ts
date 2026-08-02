/**
 * Listing-mode detection fixtures (PR 1A).
 *
 * IMPORTANT: These fixtures do NOT contain an expectedMode field. The expected
 * mode for each fixture is hard-coded in the corresponding test file
 * (`zillow.modeDetection.test.ts`). This prevents label/filename from leaking
 * into the resolver logic, per the audit's explicit constraint.
 *
 * Each fixture holds the raw data needed by the three sources:
 *   - Source A (JSON-LD):       `jsonLdScripts` → resolved by resolveModeFromCurrentListingJsonLd
 *   - Source B (structured raw): `homeStatus / listingType / listingSubType / transactionType`
 *                               → resolved by resolveStructuredRawStatus
 *   - Source C (Hero DOM):      built via `buildHeroDoc()` factory from `hero` blocks
 *   - URL:                      always taken from the test's `url` parameter
 */

export interface HeroBlock {
  /** Visible status text inside [data-testid="status"]. Optional. */
  statusText?: string;
  /** Visible price text inside [data-testid="price"] / [data-testid="list-price"]. Optional. */
  priceText?: string;
  /** h1 visible text. Optional. */
  h1Text?: string;
  /** Up to 200 mock CTAs (button/anchor texts). Optional. */
  ctas?: string[];
}

export interface ModeFixture {
  url: string;
  zpid: string | null;
  buildingId: string | null;
  jsonLdScripts: string[];
  hero?: HeroBlock;
  homeStatus?: string;
  listingType?: string;
  listingSubType?: string;
  transactionType?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Sale sample: 1004 S Pennsylvania, Denver, CO 80209 — zpid 13356678
// JSON-LD: businessFunction = #Sell on the current listing node.
// gdpClientCache (for-rent sub-app overlay for zpid 13304275) is filtered out
// by the Source B contract (we only read fields for the current zpid, and the
//   fixture below sets homeStatus/listingType to FOR_SALE on purpose).
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_SALE_1004: ModeFixture = {
  url: 'https://www.zillow.com/homedetails/1004-S-Pennsylvania-St-Denver-CO-80209/13356678_zpid/',
  zpid: '13356678',
  buildingId: null,
  jsonLdScripts: [
    // Current listing
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['RealEstateListing', 'Product'],
      '@id': 'https://www.zillow.com/homedetails/1004-S-Pennsylvania-St-Denver-CO-80209/13356678_zpid/',
      url: 'https://www.zillow.com/homedetails/1004-S-Pennsylvania-St-Denver-CO-80209/13356678_zpid/',
      itemOffered: { '@type': 'SingleFamilyResidence' },
      offers: {
        '@type': 'Offer',
        businessFunction: 'http://purl.org/goodrelations/v1#Sell',
        price: 1100000,
        priceCurrency: 'USD',
      },
    }),
    // Nearby listings — ItemList of 39 RealEstateListing nodes (all #Sell,
    // all different zpids). Source A MUST reject them because their zpid
    // does not match.
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: Array.from({ length: 39 }, (_, i) => ({
        '@type': 'ListItem',
        item: {
          '@type': ['RealEstateListing', 'Product'],
          '@id': `https://www.zillow.com/homedetails/Nearby-${i}-St-Denver-CO-80205/${13000000 + i}_zpid/`,
          offers: {
            businessFunction: 'http://purl.org/goodrelations/v1#Sell',
          },
        },
      })),
    }),
  ],
  hero: {
    statusText: 'For sale',
    priceText: '$1,100,000',
    h1Text: '1004 S Pennsylvania St, Denver, CO 80209',
    ctas: ['Get pre-qualified', 'Save'],
  },
  homeStatus: 'FOR_SALE',
  listingType: 'FOR_SALE',
  listingSubType: 'FOR_SALE',
  transactionType: undefined,
};

// ───────────────────────────────────────────────────────────────────────────
// Rent sample 1: 624 E 12th Ave #A — zpid 443788836 (Room for rent)
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_RENT_624: ModeFixture = {
  url: 'https://www.zillow.com/homedetails/624-E-12th-Ave-A-Denver-CO-80203/443788836_zpid/',
  zpid: '443788836',
  buildingId: null,
  jsonLdScripts: [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['RealEstateListing', 'Product'],
      '@id': 'https://www.zillow.com/homedetails/624-E-12th-Ave-A-Denver-CO-80203/443788836_zpid/',
      url: 'https://www.zillow.com/homedetails/624-E-12th-Ave-A-Denver-CO-80203/443788836_zpid/',
      itemOffered: { '@type': 'Room' },
      offers: {
        '@type': 'Offer',
        businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
        price: 745,
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: 745,
          priceCurrency: 'USD',
          eligibleQuantity: { '@type': 'QuantitativeValue', unitText: 'MO', unitCode: 'MON' },
        },
      },
    }),
  ],
  hero: {
    statusText: 'Room for rent',
    priceText: '$745/mo',
    h1Text: '624 E 12th Ave #A, Denver, CO 80203',
    ctas: ['Apply now', 'Request to apply'],
  },
  homeStatus: 'FOR_RENT',
  listingType: 'FOR_RENT',
  listingSubType: 'FOR_RENT',
  transactionType: undefined,
};

// ───────────────────────────────────────────────────────────────────────────
// Rent sample 2: 1650 S Albion (Apartment complex) — uses apartments tail ID
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_RENT_1650: ModeFixture = {
  url: 'https://www.zillow.com/apartments/denver-co/1650-s-albion/CgzFQT/',
  zpid: null,
  buildingId: 'CgzFQT',
  jsonLdScripts: [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['RealEstateListing', 'Product'],
      '@id': 'https://www.zillow.com/apartments/denver-co/1650-s-albion/CgzFQT/',
      url: 'https://www.zillow.com/apartments/denver-co/1650-s-albion/CgzFQT/',
      itemOffered: { '@type': 'ApartmentComplex' },
      offers: [
        {
          '@type': 'Offer',
          businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
          price: 1500,
          priceCurrency: 'USD',
          priceSpecification: { unitCode: 'MON', eligibleQuantity: { unitCode: 'MON' } },
        },
        {
          '@type': 'Offer',
          businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
          price: 1800,
          priceCurrency: 'USD',
          priceSpecification: { unitCode: 'MON', eligibleQuantity: { unitCode: 'MON' } },
        },
        {
          '@type': 'AggregateOffer',
          businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
          lowPrice: 1500,
          highPrice: 1800,
          priceCurrency: 'USD',
          priceSpecification: { unitCode: 'MON', eligibleQuantity: { unitCode: 'MON' } },
        },
      ],
    }),
  ],
  hero: {
    h1Text: '1650 S Albion Apartments',
    ctas: ['Available units', 'Lease details'],
  },
  homeStatus: 'FOR_RENT',
  listingType: 'FOR_RENT',
  listingSubType: 'FOR_RENT',
  transactionType: undefined,
};

// ───────────────────────────────────────────────────────────────────────────
// Pollution fixture: the same current listing node carries BOTH sell and
// leaseout offers in the same `offers` array. Source A must return 'conflict'
// in this scenario (the offers themselves disagree on the same listing).
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_CONFLICT_JSONLD: ModeFixture = {
  ...FIXTURE_SALE_1004,
  jsonLdScripts: [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': ['RealEstateListing', 'Product'],
      '@id': 'https://www.zillow.com/homedetails/1004-S-Pennsylvania-St-Denver-CO-80209/13356678_zpid/',
      url: 'https://www.zillow.com/homedetails/1004-S-Pennsylvania-St-Denver-CO-80209/13356678_zpid/',
      itemOffered: { '@type': 'SingleFamilyResidence' },
      offers: [
        {
          '@type': 'Offer',
          businessFunction: 'http://purl.org/goodrelations/v1#Sell',
          price: 1100000,
          priceCurrency: 'USD',
        },
        {
          '@type': 'Offer',
          businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
          price: 6500,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: 6500,
            priceCurrency: 'USD',
            eligibleQuantity: { '@type': 'QuantitativeValue', unitText: 'MO', unitCode: 'MON' },
          },
        },
      ],
    }),
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Conflict fixture: structured raw status says FOR_RENT but JSON-LD says
// #Sell. Both sources are equally authoritative → mode must be 'unknown'.
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_CONFLICT_SALE_STRUCTURED_RENT: ModeFixture = {
  ...FIXTURE_SALE_1004,
  // Source B flips to FOR_RENT
  homeStatus: 'FOR_RENT',
  listingType: 'FOR_RENT',
  listingSubType: 'FOR_RENT',
};

// ───────────────────────────────────────────────────────────────────────────
// Conflict fixture: JSON-LD = #Sell, but Hero = "For rent" → conflict.
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_CONFLICT_JSONLD_SELL_HERO_RENT: ModeFixture = {
  ...FIXTURE_SALE_1004,
  hero: {
    statusText: 'For rent',
    ctas: ['Apply now'],
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Pollution fixture: gdpClientCache (Source B) is missing; JSON-LD and Hero
// disagree; URL fallback also wins for /apartments/. The resolver must choose
// URL fallback only when JSON-LD and structured are both empty.
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_URL_FALLBACK: ModeFixture = {
  url: 'https://www.zillow.com/apartments/boulder-co/trailside/MtaPvT/',
  zpid: null,
  buildingId: 'MtaPvT',
  jsonLdScripts: [],
  hero: { ctas: [] },
  homeStatus: undefined,
  listingType: undefined,
  listingSubType: undefined,
  transactionType: undefined,
};