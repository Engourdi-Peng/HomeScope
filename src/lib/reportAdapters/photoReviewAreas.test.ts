import { describe, expect, it } from 'vitest';
import { mergePhotoReviewAreas } from './photoReviewAreas';

describe('mergePhotoReviewAreas', () => {
  it('aggregates duplicate cached areas using normalized names', () => {
    const areas = mergePhotoReviewAreas([
      { area: 'Kitchen', photoCount: 2, visibleConcerns: ['Check grout'] },
      { area: ' kitchen ', photoCount: 3, visibleConcerns: ['Check  grout', 'Inspect seal'] },
    ]);

    expect(areas).toHaveLength(1);
    expect(areas[0].photoCount).toBe(5);
    expect(areas[0].visibleConcerns).toEqual(['Check grout', 'Inspect seal']);
  });

  it('does not merge same-named areas with explicit identities', () => {
    const areas = mergePhotoReviewAreas([
      { area: 'bedroom', unitNumber: '1A' },
      { area: 'bedroom', unitNumber: '1B' },
      { area: 'bedroom', floor: 2 },
      { area: 'bedroom', floor: 3 },
    ]);

    expect(areas).toHaveLength(4);
  });
});
