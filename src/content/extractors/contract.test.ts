import { describe, expect, it, beforeAll } from 'vitest';
import type {
  ExtractContext,
  ModeAwareListingExtractor,
  ListingTypeMeta,
  CommonListingFields,
  RentListingFields,
  SaleListingFields,
} from './base';
import type { StandardizedListingData } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Mock ModeAwareListingExtractor — verifies contract only (new fields part)
// 旧字段 price/parking/rentZestimate 不参与验证（兼容现有链路）
// ─────────────────────────────────────────────────────────────────────────────

function makeMock(): ModeAwareListingExtractor {
  const common: CommonListingFields = {
    address: '123 Main St, Queens, NY 11361',
    title: '123 Main St',
    displayPrice: '$2,300/mo',
    description: 'Tenant pays electric. 12-month lease.',
    whatsSpecialText: 'Freshly painted, hardwood floors.',
    images: ['https://example.com/photo1.jpg'],
    propertyType: 'Apartment',
    homeType: 'Apartment',
    propertySubtype: 'Condo',
    bedrooms: 2,
    bathrooms: 1,
    sqft: 850,
    yearBuilt: 1995,
    parkingDescription: '1 garage space, attached',
    managementCompany: 'Greystar Properties',
    contactInfo: 'agent@example.com',
    schoolRatings: [],
    walkScore: '70 / 100',
    bikeScore: '50 / 100',
    neighborhood: 'Bayside',
    architecturalStyle: 'Raised Ranch',
    stories: '2',
    region: 'Bayside',
    floodZone: 'Zone X',
    heating: 'Central',
    cooling: 'Central',
    basement: 'None',
    garageSpaces: 1,
    listingType: 'rent',
    listingTypeSource: 'dom',
    listingTypeConfidence: 'high',
    listingTypeConflicts: [],
  };

  const rentFields: RentListingFields = {
    monthlyRent: 2300,
    advertisedRentRange: { low: 2200, high: 2400 },
    exactUnit: 'Apt 3B',
    availableDate: '2026-08-01',
    securityDeposit: 'One month rent',
    holdingDeposit: '$500',
    applicationFee: '$50',
    leaseTerm: '12 months',
    utilitiesIncluded: ['Water', 'Heat'],
    landlordPays: ['Water', 'Heat'],
    tenantPays: ['Electric', 'Internet'],
    petPolicy: 'Cats allowed, dogs under 25 lbs',
    parkingFee: '$50/month',
    amenityFee: null,
    qualificationRequirements: 'Income 40x rent, credit 700+',
  };

  const saleFields: SaleListingFields = {
    askingPrice: 850000,
    zestimate: 870000,
    pricePerSqft: 1000,
    annualTax: 8500,
    taxAssessedValue: 720000,
    monthlyPayment: 4200,
    propertyTaxMonthly: 708,
    homeInsuranceMonthly: 150,
    hoaFee: '$350/mo',
    hoaStatus: 'Has HOA',
    priceHistory: null,
    daysOnZillow: 14,
    dateOnMarket: '2026-07-01',
    lotSize: '5,000 Square Feet',
    lotDimensions: '50x100',
  };

  return {
    source: 'zillow',
    canHandle: () => true,
    async extract(ctx: ExtractContext): Promise<StandardizedListingData> {
      const meta = await this.detectListingType(ctx);
      const common = await this.extractCommonFields(ctx);
      if (meta.type === 'rent') {
        const rent = await this.extractRentSpecificFields(ctx, common);
        return {
          source: 'zillow',
          url: ctx.url.href,
          address: common.address,
          price: common.displayPrice ?? '',
          priceAmount: rent.monthlyRent ?? undefined,
          pricePeriod: 'month',
          bedrooms: common.bedrooms,
          bathrooms: common.bathrooms,
          propertyType: common.propertyType,
          description: common.description,
          images: common.images,
          listingType: 'rent',
          // rent fields
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
          parkingDescription: common.parkingDescription,
          managementCompany: common.managementCompany,
          yearBuilt: common.yearBuilt ?? null,
          displayPrice: common.displayPrice,
          extractedAt: new Date().toISOString(),
          extractionConfidence: 0.7,
        } as StandardizedListingData;
      }
      const sale = await this.extractSaleSpecificFields(ctx, common);
      return {
        source: 'zillow',
        url: ctx.url.href,
        address: common.address,
        price: common.displayPrice ?? '',
        priceAmount: sale.askingPrice ?? undefined,
        pricePeriod: 'total',
        bedrooms: common.bedrooms,
        bathrooms: common.bathrooms,
        propertyType: common.propertyType,
        description: common.description,
        images: common.images,
        listingType: 'sale',
        askingPrice: sale.askingPrice ?? null,
        saleZestimate: sale.zestimate ?? null,
        pricePerSqft: sale.pricePerSqft ?? null,
        annualTax: sale.annualTax ?? null,
        taxAssessedValue: sale.taxAssessedValue ?? null,
        monthlyPayment: sale.monthlyPayment ?? null,
        propertyTaxMonthly: sale.propertyTaxMonthly ?? null,
        homeInsuranceMonthly: sale.homeInsuranceMonthly ?? null,
        hoaFee: sale.hoaFee ?? null,
        hoaStatus: sale.hoaStatus ?? null,
        priceHistory: sale.priceHistory ?? null,
        daysOnZillow: sale.daysOnZillow ?? null,
        dateOnMarket: sale.dateOnMarket ?? null,
        lotSize: sale.lotSize ?? null,
        lotDimensions: sale.lotDimensions ?? null,
        parkingDescription: common.parkingDescription,
        managementCompany: common.managementCompany,
        yearBuilt: common.yearBuilt ?? null,
        displayPrice: common.displayPrice,
        extractedAt: new Date().toISOString(),
        extractionConfidence: 0.7,
      } as StandardizedListingData;
    },
    async detectListingType(_ctx: ExtractContext): Promise<ListingTypeMeta> {
      return {
        type: 'rent',
        source: 'dom',
        confidence: 'high',
        conflicts: [],
      };
    },
    async extractCommonFields(_ctx: ExtractContext): Promise<CommonListingFields> {
      return common;
    },
    async extractRentSpecificFields(
      _ctx: ExtractContext,
      _common: CommonListingFields,
    ): Promise<RentListingFields> {
      return rentFields;
    },
    async extractSaleSpecificFields(
      _ctx: ExtractContext,
      _common: CommonListingFields,
    ): Promise<SaleListingFields> {
      return saleFields;
    },
    async forceReextract(
      ctx: ExtractContext,
      c: CommonListingFields,
      forced: 'rent' | 'sale',
    ): Promise<StandardizedListingData> {
      if (forced === 'rent') {
        const rent = await this.extractRentSpecificFields(ctx, c);
        return {
          source: 'zillow',
          url: ctx.url.href,
          address: c.address,
          price: c.displayPrice ?? '',
          priceAmount: rent.monthlyRent ?? undefined,
          pricePeriod: 'month',
          bedrooms: c.bedrooms,
          bathrooms: c.bathrooms,
          propertyType: c.propertyType,
          description: c.description,
          images: c.images,
          listingType: 'rent',
          monthlyRent: rent.monthlyRent ?? null,
          advertisedRentRange: rent.advertisedRentRange ?? null,
          extractedAt: new Date().toISOString(),
          extractionConfidence: 0.7,
        } as StandardizedListingData;
      }
      const sale = await this.extractSaleSpecificFields(ctx, c);
      return {
        source: 'zillow',
        url: ctx.url.href,
        address: c.address,
        price: c.displayPrice ?? '',
        priceAmount: sale.askingPrice ?? undefined,
        pricePeriod: 'total',
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        propertyType: c.propertyType,
        description: c.description,
        images: c.images,
        listingType: 'sale',
        askingPrice: sale.askingPrice ?? null,
        saleZestimate: sale.zestimate ?? null,
        extractedAt: new Date().toISOString(),
        extractionConfidence: 0.7,
      } as StandardizedListingData;
    },
  };
}

function makeContext(): ExtractContext {
  return {
    document: {} as Document,
    url: new URL('https://www.zillow.com/homedetails/123-Main-St/12345_zpid/'),
    signals: {} as ExtractContext['signals'],
    stage: 'final',
  };
}

describe('ListingExtractor contract', () => {
  const ext = makeMock();
  const ctx = makeContext();

  // ─── 类型层：互斥（针对新字段部分）───
  describe('rent/sale field mutual exclusion (new fields only)', () => {
    it('RentListingFields does not contain any sale field key', async () => {
      const rent: RentListingFields = await ext.extractRentSpecificFields(ctx, await ext.extractCommonFields(ctx));
      const saleFieldKeys = [
        'askingPrice',
        'zestimate',
        'pricePerSqft',
        'annualTax',
        'taxAssessedValue',
        'monthlyPayment',
        'propertyTaxMonthly',
        'homeInsuranceMonthly',
        'hoaFee',
        'hoaStatus',
        'priceHistory',
        'daysOnZillow',
        'dateOnMarket',
        'lotSize',
        'lotDimensions',
      ];
      for (const k of saleFieldKeys) {
        expect((rent as unknown as Record<string, unknown>)[k]).toBeUndefined();
      }
    });

    it('SaleListingFields does not contain any rent field key', async () => {
      const sale: SaleListingFields = await ext.extractSaleSpecificFields(ctx, await ext.extractCommonFields(ctx));
      const rentFieldKeys = [
        'monthlyRent',
        'advertisedRentRange',
        'exactUnit',
        'availableDate',
        'securityDeposit',
        'holdingDeposit',
        'applicationFee',
        'leaseTerm',
        'utilitiesIncluded',
        'landlordPays',
        'tenantPays',
        'petPolicy',
        'parkingFee',
        'amenityFee',
        'qualificationRequirements',
      ];
      for (const k of rentFieldKeys) {
        expect((sale as unknown as Record<string, unknown>)[k]).toBeUndefined();
      }
    });
  });

  // ─── 运行时：rent 路径 ───
  describe('rent path (new fields only)', () => {
    let common: CommonListingFields;
    let rent: RentListingFields;

    beforeAll(async () => {
      common = await ext.extractCommonFields(ctx);
      rent = await ext.extractRentSpecificFields(ctx, common);
    });

    it('extractRentSpecificFields returns RentListingFields shape', () => {
      expect(rent.monthlyRent).toBe(2300);
      expect(rent.advertisedRentRange?.low).toBe(2200);
      expect(rent.advertisedRentRange?.high).toBe(2400);
      expect(rent.leaseTerm).toBe('12 months');
      expect(rent.parkingFee).toBe('$50/month');
      expect(rent.utilitiesIncluded).toEqual(['Water', 'Heat']);
    });
  });

  // ─── 运行时：sale 路径 ───
  describe('sale path (new fields only)', () => {
    let common: CommonListingFields;
    let sale: SaleListingFields;

    beforeAll(async () => {
      common = await ext.extractCommonFields(ctx);
      sale = await ext.extractSaleSpecificFields(ctx, common);
    });

    it('extractSaleSpecificFields returns SaleListingFields shape', () => {
      expect(sale.askingPrice).toBe(850000);
      expect(sale.zestimate).toBe(870000);
      expect(sale.monthlyPayment).toBe(4200);
      expect(sale.annualTax).toBe(8500);
      expect(sale.lotSize).toBe('5,000 Square Feet');
    });
  });

  // ─── Common 字段两模式都返回 ───
  describe('common fields appear in both modes (real general facts)', () => {
    it('Common fields include yearBuilt / parkingDescription / managementCompany', async () => {
      const common = await ext.extractCommonFields(ctx);
      expect(common.yearBuilt).toBe(1995);
      expect(common.parkingDescription).toBe('1 garage space, attached');
      expect(common.managementCompany).toBe('Greystar Properties');
      expect(common.bedrooms).toBe(2);
      expect(common.bathrooms).toBe(1);
      expect(common.sqft).toBe(850);
    });
  });

  // ─── forceReextract ───
  describe('forceReextract', () => {
    it('returns rent data when forced to rent', async () => {
      const common = await ext.extractCommonFields(ctx);
      const data = await ext.forceReextract!(ctx, common, 'rent');
      expect(data.listingType).toBe('rent');
      expect(data.monthlyRent).toBe(2300);
    });
    it('returns sale data when forced to sale', async () => {
      const common = await ext.extractCommonFields(ctx);
      const data = await ext.forceReextract!(ctx, common, 'sale');
      expect(data.listingType).toBe('sale');
      expect(data.askingPrice).toBe(850000);
    });
  });
});

// ─── helpers (kept for reference; beforeAll/async now in describe) ───
async function commonFor(ext: ModeAwareListingExtractor, ctx: ExtractContext) {
  return await ext.extractCommonFields(ctx);
}
async function rentFor(
  ext: ModeAwareListingExtractor,
  ctx: ExtractContext,
  common: CommonListingFields,
) {
  return await ext.extractRentSpecificFields(ctx, common);
}
async function saleFor(
  ext: ModeAwareListingExtractor,
  ctx: ExtractContext,
  common: CommonListingFields,
) {
  return await ext.extractSaleSpecificFields(ctx, common);
}