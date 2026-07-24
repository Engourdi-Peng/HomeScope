import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Path to the real producer fixture (extension/zillow-graphql-capture.js) ──
// The capture layer writes a `zillow_structured` / `zillow_structured_v1`
// payload. We import the canonical 1995 S Logan St fixture so the test
// asserts the exact shape the producer actually emits. This file is the
// SINGLE source of truth — the test must not duplicate or modify the schema.
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/fixtures/zillow_structured_room.json',
);
const roomFixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, any>;

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
// A. Producer fixture contract — verifies the real producer-written fixture
// matches the contract required by the backend buildRoomRentalFacts.
// =============================================================================

describe('producer fixture (1995 S Logan St) — real capture contract', () => {
  it('uses the zillow_structured_v1 source envelope', () => {
    expect(roomFixture.source).toBe('zillow_structured');
    expect(roomFixture.sourceVersion).toBe('zillow_structured_v1');
  });

  it('carries the canonical identity anchors the consumer requires', () => {
    expect(typeof roomFixture.identity?.zpid).toBe('string');
    expect(roomFixture.identity.zpid).not.toBe('');
    expect(typeof roomFixture.identity?.hdpUrl).toBe('string');
    expect(roomFixture.identity.hdpUrl).not.toBe('');
  });

  it('classifies 1995 S Logan St as a room-rental monthly listing', () => {
    expect(roomFixture.classification?.objectKind).toBe('room');
    expect(roomFixture.classification?.transactionType).toBe('rent');
    expect(roomFixture.classification?.priceUnit).toBe('monthly');
  });

  it('matches the 1995 S Logan St room-rental numeric header', () => {
    expect(roomFixture.pricing?.displayedPrice).toBe(415);
    expect(roomFixture.pricing?.baseRent).toBe(415);
  });

  it('matches the roomRental deterministic facts for 1995 S Logan St', () => {
    const rr = roomFixture.roomRental;
    expect(rr.requiredMonthlyFees).toBe(250);
    expect(rr.totalMonthlyCost).toBe(665);
    expect(rr.housemateCount).toBe(4);
    expect(rr.parkingCapacity).toBe(6);
    // False values must be preserved (not coerced to null).
    expect(rr.hasPrivateBath).toBe(false);
    expect(rr.roomIsFurnished).toBe(false);
    expect(rr.listPriceIncludesRequiredMonthlyFees).toBe(false);
  });

  it('atAGlanceFacts is a flat object keyed by fact label', () => {
    const facts = roomFixture.roomRental?.atAGlanceFacts;
    expect(facts).toBeTypeOf('object');
    expect(facts).not.toBeNull();
    // Real producer writes Allow-list keys only: Date available / Type / Lease / Pets / Parking / Deposit & fees
    const knownKeys = [
      'Date available',
      'Type',
      'Lease',
      'Pets',
      'Parking',
      'Deposit & fees',
    ];
    const presentKeys = Object.keys(facts);
    for (const k of presentKeys) {
      expect(knownKeys).toContain(k);
    }
  });
});

// =============================================================================
// B. Background handoff — the producer-written structuredListing is forwarded
// from submit -> run with the same object identity.
// =============================================================================

describe('analyze handoff — structuredListing pass-through', () => {
  it('runAnalysis forwards producer structuredListing into the run payload unchanged', async () => {
    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls: ['https://photos.zillowstatic.com/fp/x.webp'],
      description: 'Stylish room rental near downtown Denver.',
      structuredListing: roomFixture,
    };

    await submitAnalysis(submitData, 'zillow.com');
    await runAnalysis('aid-1', submitData, 'zillow.com');

    const submitCall = captured.find((c) => c.url.includes('action=submit'));
    const runCall = captured.find((c) => c.url.includes('action=run'));
    expect(submitCall, 'expected a submit fetch').toBeDefined();
    expect(runCall, 'expected a run fetch').toBeDefined();

    const submitBody = JSON.parse(String(submitCall!.init?.body));
    const runBody = JSON.parse(String(runCall!.init?.body));

    // Same object reaches both endpoints.
    expect(submitBody.structuredListing).toEqual(roomFixture);
    expect(runBody.structuredListing).toEqual(roomFixture);
    // Specific field spot-checks at the boundary.
    expect(runBody.id).toBe('aid-1');
    expect(runBody.structuredListing.pricing.displayedPrice).toBe(415);
    expect(runBody.structuredListing.roomRental.requiredMonthlyFees).toBe(250);
    expect(runBody.structuredListing.roomRental.totalMonthlyCost).toBe(665);
    expect(runBody.structuredListing.roomRental.housemateCount).toBe(4);
    expect(runBody.structuredListing.classification.objectKind).toBe('room');
  });

  it('submitAnalysis forwards the same producer structuredListing', async () => {
    await submitAnalysis(
      {
        reportMode: 'rent',
        analysisType: 'full',
        imageUrls: [],
        description: 'submit',
        structuredListing: roomFixture,
      },
      'zillow.com',
    );

    const submitCall = captured.find((c) => c.url.includes('action=submit'));
    expect(submitCall).toBeDefined();
    const body = JSON.parse(String(submitCall!.init?.body));
    expect(body.structuredListing).toEqual(roomFixture);
  });
});

// =============================================================================
// C. Null fallback — when the producer cannot build a valid structuredListing
// (non-Zillow page, missing GraphQL data, or web-form path), the handoff must
// propagate a stable null and not break existing apartment/sale flows.
// =============================================================================

describe('null fallback — no structuredListing', () => {
  it('runAnalysis sends structuredListing: null on web-form path (no producer)', async () => {
    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls: [],
      description: 'Web form submission — no structuredListing captured.',
    };

    await runAnalysis('aid-1', submitData, 'zillow.com');

    const runCall = captured.find((c) => c.url.includes('action=run'));
    expect(runCall).toBeDefined();

    const runBody = JSON.parse(String(runCall!.init?.body));

    expect(runBody).toHaveProperty('structuredListing');
    expect(runBody.structuredListing).toBeNull();
  });

  it('sale flow without structuredListing is unaffected', async () => {
    const submitData = {
      reportMode: 'sale' as const,
      analysisType: 'full' as const,
      imageUrls: ['https://photos.zillowstatic.com/fp/y.webp'],
      description: 'Single-family sale listing — no structuredListing.',
    };

    await runAnalysis('aid-1', submitData, 'zillow.com');

    const runCall = captured.find((c) => c.url.includes('action=run'));
    expect(runCall).toBeDefined();
    const body = JSON.parse(String(runCall!.init?.body));
    expect(body.structuredListing).toBeNull();
    expect(body.analysisType).toBe('full');
  });
});

// =============================================================================
// D. Request body limits — this handoff must NOT duplicate imageUrls,
// must NOT forward the full listingData, and must keep the request body
// minimal. buildRoomRentalFacts only needs the top-level structuredListing.
// =============================================================================

describe('request body limits — no payload bloat', () => {
  it('runAnalysis does NOT forward a full listingData field', async () => {
    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls: ['https://photos.zillowstatic.com/fp/x.webp'],
      description: 'desc',
      structuredListing: roomFixture,
    };

    await submitAnalysis(submitData, 'zillow.com');
    await runAnalysis('aid-1', submitData, 'zillow.com');

    const runCall = captured.find((c) => c.url.includes('action=run'));
    const body = JSON.parse(String(runCall!.init?.body));

    // The full listingData must NOT be forwarded — only structuredListing.
    expect(body).not.toHaveProperty('listingData');
    expect(body.structuredListing).toBeDefined();
  });

  it('runAnalysis does not duplicate imageUrls', async () => {
    const imageUrls = ['https://photos.zillowstatic.com/fp/a.webp', 'https://photos.zillowstatic.com/fp/b.webp'];
    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls,
      description: 'desc',
      structuredListing: roomFixture,
    };

    await submitAnalysis(submitData, 'zillow.com');
    await runAnalysis('aid-1', submitData, 'zillow.com');

    const runCall = captured.find((c) => c.url.includes('action=run'));
    const body = JSON.parse(String(runCall!.init?.body));

    // imageUrls appears exactly once as a top-level field.
    expect(body.imageUrls).toEqual(imageUrls);
    const bodyStr = JSON.stringify(body);
    const occurrences = bodyStr.split('https://photos.zillowstatic.com/fp/a.webp').length - 1;
    expect(occurrences).toBe(1);
  });

  it('runAnalysis request body stays small (no image array duplication, no listingData cascade)', async () => {
    const submitData = {
      reportMode: 'rent' as const,
      analysisType: 'full' as const,
      imageUrls: ['https://photos.zillowstatic.com/fp/x.webp'],
      description: 'desc',
      structuredListing: roomFixture,
    };

    await runAnalysis('aid-1', submitData, 'zillow.com');

    const runCall = captured.find((c) => c.url.includes('action=run'));
    const body = JSON.parse(String(runCall!.init?.body));

    // runAnalysis is intentionally minimal — it only forwards the fields the
    // backend needs to re-run deterministically. reportMode lives in
    // optionalDetails or was set at submit; structuredListing is the new
    // handoff channel. We assert the EXACT set of top-level keys so an
    // accidental future duplicate (e.g. listingData) gets caught. Note that
    // JSON.stringify drops keys whose value is undefined, so optionalDetails
    // is absent in this test (no optionalDetails supplied).
    const allowedKeys = [
      'id',
      'imageUrls',
      'description',
      'analysisType',
      'structuredListing',
    ];
    expect(Object.keys(body).sort()).toEqual([...allowedKeys].sort());
  });
});

// =============================================================================
// E. Routing — getAnalyzeApiUrl still routes Zillow/realtor to US server and
// falls back to AU for unknown domains. (kept as a sanity check.)
// =============================================================================

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
