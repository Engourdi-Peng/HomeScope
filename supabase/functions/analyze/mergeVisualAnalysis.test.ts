/**
 * Regression matrix for the multi-unit rent additive merge.
 *
 * These tests cover arbitrary batch counts and arbitrary photo mixes
 * (real interior photos, virtual staging, floor plans) so the merge logic
 * stays robust as Step 1 photo collection scales up.
 *
 * Contract under test:
 *  - photoIndex is preserved (no rebase; caller is responsible)
 *  - photos are concatenated across batches (count preserved exactly)
 *  - photoReview.areas merge same-area entries across batches
 *  - explicit unit/floor/subject identities keep same-named areas separate
 *  - keyTakeaways are appended in batch order with exact-string dedupe
 *  - moduleTitle/moduleSubtitle first non-empty wins
 *  - overallSummary belongs to the batch with the most-area-coverage, not
 *    always the last batch
 *  - when all batches are floor-plan-only, the merged summary still belongs
 *    to whichever batch covers the most photos
 *  - when all batches contain zero photoReview, merged photoReview.overallSummary
 *    is simply omitted (no synthetic text)
 *
 * These checks are listing-agnostic — they only assert the merge contract.
 */
import { describe, expect, it } from 'vitest';
import { mergeVisualAnalysis } from './mergeVisualAnalysis';

interface MergeFixtureBatch {
  photos: Array<Record<string, unknown>>;
  spaceAnalysis: Array<Record<string, unknown>>;
  photoReview: Record<string, unknown>;
}

function photo(i: number): Record<string, unknown> {
  return { photoIndex: i, area: 'living_room' };
}

function review(opts: {
  areas: Array<{ area: string; photoCount: number }>;
  overallSummary?: string;
  moduleTitle?: string;
  keyTakeaways?: {
    solidSigns?: string[];
    cannotVerify?: string[];
    needsAttention?: string[];
  };
}): Record<string, unknown> {
  const reviewOut: Record<string, unknown> = {};
  if (opts.moduleTitle) reviewOut.moduleTitle = opts.moduleTitle;
  reviewOut.areas = opts.areas.map((a) => ({
    area: a.area,
    photoCount: a.photoCount,
  }));
  const kt: Record<string, unknown> = {};
  if (opts.keyTakeaways?.solidSigns) kt.solidSigns = opts.keyTakeaways.solidSigns;
  if (opts.keyTakeaways?.cannotVerify) kt.cannotVerify = opts.keyTakeaways.cannotVerify;
  if (opts.keyTakeaways?.needsAttention) kt.needsAttention = opts.keyTakeaways.needsAttention;
  if (Object.keys(kt).length > 0) reviewOut.keyTakeaways = kt;
  if (opts.overallSummary) reviewOut.overallSummary = opts.overallSummary;
  return reviewOut;
}

describe('mergeVisualAnalysis — regression matrix', () => {
  it('1+1: two single-photo batches concatenate; photoIndex preserved', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: [photo(0)],
        spaceAnalysis: [],
        photoReview: review({ areas: [{ area: 'kitchen', photoCount: 1 }] }),
      },
      {
        photos: [photo(1)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'bathroom', photoCount: 1 }],
          overallSummary: 'one photo summary',
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);

    expect(merged.photos.length).toBe(2);
    expect((merged.photos[0] as { photoIndex: number }).photoIndex).toBe(0);
    expect((merged.photos[1] as { photoIndex: number }).photoIndex).toBe(1);
    expect(
      (merged.photoReview?.areas as Array<Record<string, unknown>>).length,
    ).toBe(2);
    expect(merged.photoReview?.overallSummary).toBe('one photo summary');
  });

  it('5+7: multi-batch areas and takeaways append in batch order', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: [photo(0), photo(1), photo(2), photo(3), photo(4)],
        spaceAnalysis: [],
        photoReview: review({
          areas: Array.from({ length: 5 }, (_, i) => ({
            area: `room-${i}`,
            photoCount: 1,
          })),
          keyTakeaways: { solidSigns: ['a'] },
        }),
      },
      {
        photos: [photo(5), photo(6), photo(7), photo(8), photo(9), photo(10), photo(11)],
        spaceAnalysis: [],
        photoReview: review({
          areas: Array.from({ length: 7 }, (_, i) => ({
            area: `room-batch2-${i}`,
            photoCount: 1,
          })),
          keyTakeaways: { solidSigns: ['b'] },
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);

    expect(merged.photos.length).toBe(12);
    expect((merged.photoReview?.areas as unknown[]).length).toBe(12);
    expect(merged.photoReview?.keyTakeaways).toEqual({ solidSigns: ['a', 'b'] });
  });

  it('20+2: a small last batch (e.g. floor plans) does NOT take over the summary', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: Array.from({ length: 20 }, (_, i) => photo(i)),
        spaceAnalysis: [],
        photoReview: review({
          areas: Array.from({ length: 10 }, (_, i) => ({
            area: `interior-${i}`,
            photoCount: 2,
          })),
          overallSummary: 'Interiors show updated kitchens and good natural light',
          moduleTitle: 'Photo & Habitability Review',
        }),
      },
      {
        photos: [photo(20), photo(21)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'floor_plan', photoCount: 2 }],
          overallSummary:
            'Floor plans only — no interior condition photographs were supplied',
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);

    expect(merged.photos.length).toBe(22);
    expect((merged.photoReview?.areas as unknown[]).length).toBe(11);
    expect(merged.photoReview?.overallSummary).toBe(
      'Interiors show updated kitchens and good natural light',
    );
    expect(merged.photoReview?.moduleTitle).toBe('Photo & Habitability Review');
  });

  it('20+20+3: three batches — summary never pinned to last batch', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: Array.from({ length: 20 }, (_, i) => photo(i)),
        spaceAnalysis: [],
        photoReview: review({
          areas: Array.from({ length: 10 }, () => ({ area: 'interior', photoCount: 2 })),
          overallSummary: 'Largest-coverage batch wins',
        }),
      },
      {
        photos: Array.from({ length: 20 }, (_, i) => photo(20 + i)),
        spaceAnalysis: [],
        photoReview: review({
          areas: Array.from({ length: 10 }, () => ({ area: 'kitchen', photoCount: 2 })),
          overallSummary: 'Middle batch summary',
        }),
      },
      {
        photos: [photo(40), photo(41), photo(42)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'floor_plan', photoCount: 3 }],
          overallSummary: 'Last batch summary (should NOT win)',
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.photos.length).toBe(43);
    expect((merged.photoReview?.areas as unknown[]).length).toBe(3);
    expect(merged.photoReview?.overallSummary).toBe('Largest-coverage batch wins');
  });

  it('40+1: edge single photo — last batch with floor plan does not steal summary', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: Array.from({ length: 40 }, (_, i) => photo(i)),
        spaceAnalysis: [],
        photoReview: review({
          areas: Array.from({ length: 20 }, () => ({ area: 'interior', photoCount: 2 })),
          overallSummary: 'Big coverage summary',
        }),
      },
      {
        photos: [photo(40)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'floor_plan', photoCount: 1 }],
          overallSummary: 'Tiny trailing summary',
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.photos.length).toBe(41);
    expect(merged.photoReview?.overallSummary).toBe('Big coverage summary');
  });

  it('a floor-plan-only batch is layout evidence, but does not negate other batches', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: Array.from({ length: 5 }, (_, i) => photo(i)),
        spaceAnalysis: [],
        photoReview: review({
          areas: [
            { area: 'kitchen', photoCount: 3 },
            { area: 'bathroom', photoCount: 2 },
          ],
          overallSummary: 'Real interiors visible',
        }),
      },
      {
        photos: [photo(5), photo(6)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'floor_plan', photoCount: 2 }],
          overallSummary: 'Layout only',
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.photos.length).toBe(7);
    expect((merged.photoReview?.areas as unknown[]).length).toBe(3);
    expect(merged.photoReview?.overallSummary).toBe('Real interiors visible');
  });

  it('all-floor-plan batches: merged summary belongs to largest-coverage batch', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: [photo(0), photo(1)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'floor_plan', photoCount: 2 }],
          overallSummary: 'small-floor-plan-only',
        }),
      },
      {
        photos: [photo(2), photo(3), photo(4)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'floor_plan', photoCount: 3 }],
          overallSummary: 'larger-floor-plan-only',
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.photos.length).toBe(5);
    expect((merged.photoReview?.areas as unknown[]).length).toBe(1);
    expect(merged.photoReview?.overallSummary).toBe('larger-floor-plan-only');
  });

  it('zero photoReview: merged photoReview is omitted (no synthetic text)', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: [photo(0)],
        spaceAnalysis: [{ spaceType: 'kitchen', observations: ['o1'], score: 80 }],
        photoReview: {},
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.photos.length).toBe(1);
    expect(merged.spaceAnalysis.length).toBe(1);
    expect(merged.photoReview).toBeUndefined();
  });

  it('exact-duplicate takeaways are deduped across batches', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: [photo(0)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'a', photoCount: 1 }],
          keyTakeaways: { solidSigns: ['countertop'] },
        }),
      },
      {
        photos: [photo(1)],
        spaceAnalysis: [],
        photoReview: review({
          areas: [{ area: 'a', photoCount: 1 }],
          keyTakeaways: { solidSigns: ['countertop', 'new-faucet'] },
        }),
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.photoReview?.keyTakeaways).toEqual({
      solidSigns: ['countertop', 'new-faucet'],
    });
  });

  it('same area across batches is aggregated with conservative confidence', () => {
    const merged = mergeVisualAnalysis([
      {
        photos: [photo(0)],
        spaceAnalysis: [],
        photoReview: {
          areas: [{
            area: 'Kitchen',
            photoCount: 3,
            whatLooksLike: 'White cabinets',
            visibleConcerns: ['Check seal'],
            confidence: 'High',
          }],
        },
      },
      {
        photos: [photo(1)],
        spaceAnalysis: [],
        photoReview: {
          areas: [{
            area: ' kitchen ',
            photoCount: 2,
            whatLooksLike: 'white   cabinets',
            visibleConcerns: ['Check seal', 'Inspect grout'],
            confidence: 'Low',
          }],
        },
      },
    ]);
    const areas = merged.photoReview?.areas as Array<Record<string, unknown>>;
    expect(areas).toHaveLength(1);
    expect(areas[0].photoCount).toBe(5);
    expect(areas[0].visibleConcerns).toEqual(['Check seal', 'Inspect grout']);
    expect(areas[0].confidence).toBe('Low');
  });

  it('same area with different unit, floor, or subject remains separate', () => {
    const merged = mergeVisualAnalysis([
      {
        photoReview: {
          areas: [
            { area: 'bedroom', unitNumber: '1A', photoCount: 1 },
            { area: 'bedroom', floor: '2', photoCount: 1 },
            { area: 'bedroom', subject: 'guest', photoCount: 1 },
          ],
        },
      },
      {
        photoReview: {
          areas: [{ area: 'bedroom', unitNumber: '1B', photoCount: 1 }],
        },
      },
    ]);
    const areas = merged.photoReview?.areas as Array<Record<string, unknown>>;
    expect(areas).toHaveLength(4);
  });

  it('spaceAnalysis merges duplicate spaceType — observations deduped, scores averaged', () => {
    const batches: MergeFixtureBatch[] = [
      {
        photos: [photo(0)],
        spaceAnalysis: [
          { spaceType: 'kitchen', observations: ['cabinets', 'counter'], score: 80 },
        ],
        photoReview: {},
      },
      {
        photos: [photo(1)],
        spaceAnalysis: [
          { spaceType: 'kitchen', observations: ['counter', 'lights'], score: 60 },
        ],
        photoReview: {},
      },
    ];

    const merged = mergeVisualAnalysis(batches);
    expect(merged.spaceAnalysis.length).toBe(1);
    const kitchen = merged.spaceAnalysis[0] as {
      observations: string[];
      score: number;
    };
    expect(kitchen.observations).toEqual(['cabinets', 'counter', 'lights']);
    expect(kitchen.score).toBe(70);
  });
});
