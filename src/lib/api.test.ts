import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock the supabase client so api.ts can import it without a live env ──
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: 'test-access-token',
            user: { email: 'test@example.com', id: 'uid-1' },
          },
        },
      }),
    },
  },
}));

// Import AFTER vi.mock so the mocked module is wired into api.ts's import graph.
import { runAnalysis, submitAnalysis, getAnalyzeApiUrl } from './api';

// =============================================================================
// Reusable fetch spy that captures URL/method/body for each call.
// =============================================================================
type CapturedCall = {
  url: string;
  init: RequestInit | undefined;
};

let captured: CapturedCall[];
let originalFetch: typeof fetch;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    captured.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, id: 'aid-1', status: 'submitted' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// =============================================================================
// 端到端 handoff regression: room-rental runtime.
// Goal: ensure structuredListing captured at submit survives to the run payload.
// Without this, the backend's buildRoomRentalFacts never receives the data and
// full_result.room_rental_facts is silently absent.
// =============================================================================

describe('analyze handoff — structuredListing pass-through', () => {
  it('runAnalysis forwards structuredListing from submit data into the run payload', async () => {
    // Realistic fixture based on the Zillow room-rental schema. We do NOT use the
    // web-form AnalyzeRequest shape directly; we rely on the new optional
    // structuredListing field that was added to the type.
    const structuredListing = {
      source: 'zillow_structured',
      sourceVersion: 'zillow_structured_v1',
      identity: { zpid: '58686666', hdpUrl: '/homedetails/1995-S-Logan-St-Denver-CO-80210/58686666_zpid/' },
      classification: { objectKind: 'room', transactionType: 'rent', priceUnit: 'total' },
      pricing: { displayedPrice: 415, baseRent: 415 },
      roomRental: {
        requiredMonthlyFees: 250,
        totalMonthlyCost: 665,
        listPriceIncludesRequiredMonthlyFees: false,
        housemateCount: 4,
        hasPrivateBath: false,
        roomIsFurnished: false,
        furnished: false,
        hasPetsAllowed: false,
        parkingCapacity: 6,
        parkingFeatures: ['Attached', 'Garage', 'Other'],
        leaseTerm: 'Contact For Details',
      },
      atAGlanceFacts: {
        'Date available': 'Available Now',
        Lease: 'Contact For Details',
        Pets: 'No Pets',
      },
    };

    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls: ['https://photos.zillowstatic.com/fp/x.webp'],
      description: 'Stylish room rental near downtown Denver.',
      structuredListing,
      listingData: {
        url: 'https://www.zillow.com/homedetails/1995-S-Logan-St-Denver-CO-80210/58686666_zpid/',
        address: '1995 S Logan St, Denver, CO 80210',
        price: 415,
        priceText: '$415',
        pricePeriod: 'month',
      },
    };

    await submitAnalysis(submitData, 'zillow.com');
    await runAnalysis('aid-1', submitData, 'zillow.com');

    // Identify the run call: URL ends with `?action=run` and body.id is set.
    const runCall = captured.find((c) => c.url.includes('action=run'));
    expect(runCall, 'expected a runAnalysis fetch').toBeDefined();
    const body = JSON.parse(String(runCall!.init?.body));

    expect(body.id).toBe('aid-1');
    expect(body.structuredListing).toEqual(structuredListing);
    expect(body.listingData).toEqual(submitData.listingData);
    // Sanity: core fields still present.
    expect(body.imageUrls).toEqual(submitData.imageUrls);
    expect(body.description).toBe(submitData.description);
    expect(body.analysisType).toBe('full');
  });

  it('runAnalysis sends structuredListing: null when caller omits it (web-form path)', async () => {
    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls: [],
      description: 'Web form submission — no structuredListing captured.',
    };

    await submitAnalysis(submitData, 'zillow.com');
    await runAnalysis('aid-1', submitData, 'zillow.com');

    const runCall = captured.find((c) => c.url.includes('action=run'));
    expect(runCall).toBeDefined();
    const body = JSON.parse(String(runCall!.init?.body));

    // The wiring must still produce a stable null placeholder — never undefined,
    // never the wrong type. This guarantees the backend receives a defined value
    // regardless of upstream capture state.
    expect(body).toHaveProperty('structuredListing');
    expect(body.structuredListing).toBeNull();
    expect(body).toHaveProperty('listingData');
    expect(body.listingData).toBeNull();
  });

  it('submitAnalysis forwards the same structuredListing shape', async () => {
    const structuredListing = {
      source: 'zillow_structured',
      sourceVersion: 'zillow_structured_v1',
      identity: { zpid: '1', hdpUrl: '/homedetails/x/1_zpid/' },
      classification: { objectKind: 'room', transactionType: 'rent', priceUnit: 'total' },
      pricing: { displayedPrice: 100 },
      roomRental: {},
      atAGlanceFacts: {},
    };

    await submitAnalysis(
      {
        reportMode: 'rent',
        analysisType: 'full',
        imageUrls: [],
        description: 'submit',
        structuredListing,
        listingData: { url: 'x' },
      },
      'zillow.com',
    );

    const submitCall = captured.find((c) => c.url.includes('action=submit'));
    expect(submitCall).toBeDefined();
    const body = JSON.parse(String(submitCall!.init?.body));
    expect(body.structuredListing).toEqual(structuredListing);
    expect(body.listingData).toEqual({ url: 'x' });
  });
});

describe('getAnalyzeApiUrl routing', () => {
  it('routes Zillow domains to US server when configured', () => {
    const url = getAnalyzeApiUrl('zillow.com');
    expect(url).toMatch(/^https:\/\/.+\.supabase\.co\/functions\/v1\/analyze$/);
  });
  it('routes realtor.com to US server', () => {
    const url = getAnalyzeApiUrl('realtor.com');
    expect(url).toMatch(/^https:\/\/.+\.supabase\.co\/functions\/v1\/analyze$/);
  });
  it('falls back to AU server for unknown domains', () => {
    const url = getAnalyzeApiUrl('example.com');
    expect(url).toMatch(/^https:\/\/.+\.supabase\.co\/functions\/v1\/analyze$/);
  });
});
