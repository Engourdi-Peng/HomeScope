// ===== Canonical Report Input Parity Tests =====
//
// Asserts that the canonical input assembler produces the same canonical
// `result.listingInfo` / `result.images` / `result.reportMode` regardless of
// whether the consumer is:
//   - the website's history page (Account.tsx — partial backend result + summary metadata)
//   - the extension's analysis pipeline (store.tsx — full backend result + ListingDataV2)
//   - the website's share page (Share.tsx — public summary + minimal full_result)
//
// The three flows must converge on the same hero fields (address, beds/baths,
// sqft, year, price, image) and the same `reportMode` so that
// `normalizeReportResult` → `buildReportViewModel` → `NewReportUI` renders
// the same content for the same analysisId.

import { describe, it, expect } from 'vitest';
import { buildCanonicalReportInput } from './canonicalInput';
import { normalizeReportResult } from './normalizeReport';
import { buildReportViewModel } from './reportViewModel';

// ---- Shared raw backend fixture -------------------------------------------
// Mirrors what `submitAnalysis` (full) returns to both web and extension:
// listingInfo has been populated by the backend from Zillow / rea data.

const backendFullResult: any = {
  id: 'analysis-123',
  reportMode: 'sale',
  analysisType: 'full',
  market: 'US',
  sourceDomain: 'zillow.com',
  overallScore: 73,
  verdict: 'Need More Evidence',
  quickSummary: 'Bright condo, but HOA reserves and balcony waterproofing must be verified.',
  whatLooksGood: ['Bright south-facing layout', 'Two deeded parking spaces'],
  riskSignals: ['HOA reserve balance undisclosed', 'Balcony waterproofing membrane unknown'],
  realityCheck: '',
  questionsToAsk: [
    'What is the HOA reserve balance?',
    'Are there any pending special assessments?',
    'What is the most recent balcony inspection?',
  ],
  decisionPriority: 'MEDIUM',
  confidenceLevel: 'Medium',
  property_snapshot: {
    address: '180 Cook Street #509, Denver, CO 80206',
    asking_price: '$1,100,000',
    sqft: 2596,
    beds: 2,
    baths: 3,
    home_type: 'Condominium',
    year_built: 1971,
    parking: 2,
    hoa: '$1,024 monthly',
    annual_tax: 7122,
    price_per_sqft: 424,
  },
  what_we_know: {
    address: '180 Cook Street #509, Denver, CO 80206',
    asking_price: '$1,100,000',
    beds: 2,
    baths: 3,
    sqft: '2596',
    property_type: 'Condominium',
    hoa: '$1,024/mo',
  },
  monthly_cost_snapshot: {
    source: 'Zillow/listing estimate',
    estimated_monthly_payment: 7624,
    principal_and_interest: 5350,
    mortgage_insurance: 0,
    property_taxes: 883,
    home_insurance: 367,
    hoa_fees: 1024,
    utilities: null,
    disclaimer: 'Based on Zillow listing estimate only. Not independently verified by HomeScope.',
  },
  listingInfo: {
    title: '180 Cook Street #509',
    address: '180 Cook Street #509, Denver, CO 80206',
    price: '$1,100,000',
    priceAmount: 1100000,
    bedrooms: 2,
    bathrooms: 3,
    parking: 2,
    sqft: 2596,
    propertyType: 'Condominium',
    yearBuilt: 1971,
    annualTax: 7122,
    coverImageUrl: 'https://photos.zillow.com/cook-509-cover.jpg',
    images: [
      'https://photos.zillow.com/cook-509-1.jpg',
      'https://photos.zillow.com/cook-509-2.jpg',
      'https://photos.zillow.com/cook-509-3.jpg',
    ],
    heating: 'Forced air',
    cooling: 'Central',
    basement: 'No',
    floodZone: 'X',
  },
  images: [
    'https://photos.zillow.com/cook-509-1.jpg',
    'https://photos.zillow.com/cook-509-2.jpg',
    'https://photos.zillow.com/cook-509-3.jpg',
  ],
};

// Frontend extraction — what the extension content script produces.
const frontendListingV2: any = {
  listingUrl: 'https://www.zillow.com/homedetails/180-Cook-St-509-Denver-CO-80206/123_zpid/',
  title: '180 Cook Street #509',
  address: '180 Cook Street #509, Denver, CO 80206',
  price: '$1,100,000',
  bedrooms: 2,
  bathrooms: 3,
  parking: 2,
  sqft: 2596,
  imageUrls: [
    'https://photos.zillow.com/cook-509-thumb.jpg',
  ],
  source: { url: 'https://www.zillow.com/', domain: 'zillow.com' },
  sourceDomain: 'zillow.com',
  reportMode: 'sale',
  listingType: 'sale',
  extractionConfidence: 0.92,
};

// History summary — what Account.tsx reads from the analyses table.
const analysisSummary: any = {
  id: 'analysis-123',
  title: '180 Cook Street #509',
  address: '180 Cook Street #509, Denver, CO 80206',
  weekly_rent: null,
  bedrooms: 2,
  bathrooms: 3,
  car_spaces: 2,
  cover_image_url: 'https://photos.zillow.com/cook-509-cover.jpg',
  report_mode: 'sale',
};

// ---- Tests ----------------------------------------------------------------

describe('Canonical Report Input — web vs extension parity', () => {
  it('produces the same canonical structured fields when both sources carry equivalent data', () => {
    const extensionCanonical = buildCanonicalReportInput(backendFullResult, frontendListingV2);
    const websiteCanonical = buildCanonicalReportInput(backendFullResult, {
      title: analysisSummary.title ?? undefined,
      address: analysisSummary.address ?? undefined,
      coverImageUrl: analysisSummary.cover_image_url ?? undefined,
      imageUrls: analysisSummary.cover_image_url ? [analysisSummary.cover_image_url] : undefined,
      priceAmount: analysisSummary.weekly_rent ?? undefined,
      bedrooms: analysisSummary.bedrooms ?? undefined,
      bathrooms: analysisSummary.bathrooms ?? undefined,
      parking: analysisSummary.car_spaces ?? undefined,
      reportMode: analysisSummary.report_mode,
    });

    // Both flows converge on the same structured listingInfo fields;
    // image galleries may differ because the extension's frontend
    // listingData includes a thumbnail that the website history does not.
    const ei = extensionCanonical.result.listingInfo;
    const wi = websiteCanonical.result.listingInfo;
    expect(ei?.address).toBe(wi?.address);
    expect(ei?.title).toBe(wi?.title);
    expect(ei?.bedrooms).toBe(wi?.bedrooms);
    expect(ei?.bathrooms).toBe(wi?.bathrooms);
    expect(ei?.parking).toBe(wi?.parking);
    expect(ei?.sqft).toBe(wi?.sqft);
    expect(ei?.price).toBe(wi?.price);
    expect(ei?.propertyType).toBe(wi?.propertyType);
    expect(ei?.yearBuilt).toBe(wi?.yearBuilt);
    expect(ei?.coverImageUrl).toBe(wi?.coverImageUrl);
    expect(extensionCanonical.result.reportMode).toBe(websiteCanonical.result.reportMode);
  });

  it('produces byte-identical canonical result when both flows carry the same frontend inputs', () => {
    // When both flows are given the same backend + frontend data, the
    // assembled result must be identical. This locks down the assembler
    // against accidental divergence from any future refactor.
    const sharedFrontend = {
      title: '180 Cook Street #509',
      address: '180 Cook Street #509, Denver, CO 80206',
      coverImageUrl: 'https://photos.zillow.com/cook-509-cover.jpg',
      bedrooms: 2,
      bathrooms: 3,
      parking: 2,
      priceAmount: 1100000,
      reportMode: 'sale' as const,
    };
    const extensionCanonical = buildCanonicalReportInput(backendFullResult, sharedFrontend);
    const webCanonical = buildCanonicalReportInput(backendFullResult, sharedFrontend);
    expect(JSON.stringify(extensionCanonical.result)).toBe(JSON.stringify(webCanonical.result));
  });

  it('keeps the structured hero fields (address, beds, baths, sqft, price, type, year) identical across flows', () => {
    const extensionCanonical = buildCanonicalReportInput(backendFullResult, frontendListingV2);
    const websiteCanonical = buildCanonicalReportInput(backendFullResult, {
      title: analysisSummary.title ?? undefined,
      address: analysisSummary.address ?? undefined,
      coverImageUrl: analysisSummary.cover_image_url ?? undefined,
      imageUrls: analysisSummary.cover_image_url ? [analysisSummary.cover_image_url] : undefined,
      priceAmount: analysisSummary.weekly_rent ?? undefined,
      bedrooms: analysisSummary.bedrooms ?? undefined,
      bathrooms: analysisSummary.bathrooms ?? undefined,
      parking: analysisSummary.car_spaces ?? undefined,
      reportMode: analysisSummary.report_mode,
    });

    const ei = extensionCanonical.result.listingInfo;
    const wi = websiteCanonical.result.listingInfo;
    expect(ei?.address).toBe(wi?.address);
    expect(ei?.title).toBe(wi?.title);
    expect(ei?.bedrooms).toBe(wi?.bedrooms);
    expect(ei?.bathrooms).toBe(wi?.bathrooms);
    expect(ei?.parking).toBe(wi?.parking);
    expect(ei?.sqft).toBe(wi?.sqft);
    expect(ei?.price).toBe(wi?.price);
    expect(ei?.propertyType).toBe(wi?.propertyType);
    expect(ei?.yearBuilt).toBe(wi?.yearBuilt);
    expect(extensionCanonical.result.reportMode).toBe(websiteCanonical.result.reportMode);
  });

  it('preserves the backend authoritative fields when frontend data disagrees', () => {
    const conflictFrontend = {
      ...frontendListingV2,
      address: 'WRONG ADDRESS, Denver, CO 80206',
      bedrooms: 99,
      coverImageUrl: 'https://wrong.example.com/img.jpg',
    };
    const canonical = buildCanonicalReportInput(backendFullResult, conflictFrontend);
    // Backend is authoritative — frontend conflict must NOT overwrite it.
    expect(canonical.result.listingInfo?.address).toBe('180 Cook Street #509, Denver, CO 80206');
    expect(canonical.result.listingInfo?.bedrooms).toBe(2);
    // Backend cover takes priority over conflicting frontend cover.
    expect(canonical.result.listingInfo?.coverImageUrl).toBe('https://photos.zillow.com/cook-509-cover.jpg');
  });

  it('falls back to frontend listingData when backend fields are missing', () => {
    const sparseBackend = {
      ...backendFullResult,
      listingInfo: {
        ...backendFullResult.listingInfo,
        coverImageUrl: undefined,
        images: undefined,
      },
      images: undefined,
    };
    const canonical = buildCanonicalReportInput(sparseBackend, {
      ...frontendListingV2,
      coverImageUrl: 'https://photos.zillow.com/cook-509-cover.jpg',
    });
    // Cover image should now come from the frontend fallback.
    expect(canonical.result.listingInfo?.coverImageUrl).toBe('https://photos.zillow.com/cook-509-cover.jpg');
    // Image gallery merges backend (none) + frontend. Explicit cover URL is
    // prepended so it remains the hero image.
    expect(canonical.images.length).toBeGreaterThanOrEqual(2);
    expect(canonical.images[0]).toBe('https://photos.zillow.com/cook-509-cover.jpg');
    expect(canonical.images).toContain('https://photos.zillow.com/cook-509-thumb.jpg');
  });

  it('resolves reportMode from the analyses-table top-level field when present', () => {
    const canonical = buildCanonicalReportInput(
      { ...backendFullResult, report_mode: 'sale' },
      null,
    );
    expect(canonical.result.reportMode).toBe('sale');
  });

  it('resolves reportMode from the listingData when backend does not carry it', () => {
    const canonical = buildCanonicalReportInput(
      { ...backendFullResult, reportMode: undefined, report_mode: undefined },
      { ...frontendListingV2, reportMode: 'sale' },
    );
    expect(canonical.result.reportMode).toBe('sale');
  });

  it('keeps hero fields intact through normalizeReportResult + buildReportViewModel', () => {
    const extensionCanonical = buildCanonicalReportInput(backendFullResult, frontendListingV2);
    const websiteCanonical = buildCanonicalReportInput(backendFullResult, {
      title: analysisSummary.title ?? undefined,
      address: analysisSummary.address ?? undefined,
      coverImageUrl: analysisSummary.cover_image_url ?? undefined,
      imageUrls: analysisSummary.cover_image_url ? [analysisSummary.cover_image_url] : undefined,
      priceAmount: analysisSummary.weekly_rent ?? undefined,
      bedrooms: analysisSummary.bedrooms ?? undefined,
      bathrooms: analysisSummary.bathrooms ?? undefined,
      parking: analysisSummary.car_spaces ?? undefined,
      reportMode: analysisSummary.report_mode,
    });

    const extNormalized = normalizeReportResult(extensionCanonical.result);
    const webNormalized = normalizeReportResult(websiteCanonical.result);
    const extViewModel = buildReportViewModel(extensionCanonical.result, extensionCanonical.result.listingInfo, extNormalized);
    const webViewModel = buildReportViewModel(websiteCanonical.result, websiteCanonical.result.listingInfo, webNormalized);

    // Critical parity fields that drive the report UI:
    expect(extViewModel.hero.address).toBe(webViewModel.hero.address);
    expect(extViewModel.hero.title).toBe(webViewModel.hero.title);
    expect(extViewModel.hero.price).toBe(webViewModel.hero.price);
    expect(extViewModel.hero.imageUrl).toBe(webViewModel.hero.imageUrl);
    expect(extViewModel.hero.score).toBe(webViewModel.hero.score);
    expect(extViewModel.hero.verdict).toBe(webViewModel.hero.verdict);
    expect(extViewModel.snapshot.beds).toBe(webViewModel.snapshot.beds);
    expect(extViewModel.snapshot.baths).toBe(webViewModel.snapshot.baths);
    expect(extViewModel.snapshot.sqft).toBe(webViewModel.snapshot.sqft);
    expect(extViewModel.snapshot.homeType).toBe(webViewModel.snapshot.homeType);
    expect(extViewModel.meta.market).toBe(webViewModel.meta.market);
    expect(extViewModel.meta.reportMode).toBe(webViewModel.meta.reportMode);
  });
});
