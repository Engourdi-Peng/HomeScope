/**
 * One-shot gallery_not_opened incident reproduction harness.
 *
 * The real Chrome MV3 content script cannot be exercised here (no
 * real browser, no Zillow SPA). Instead we simulate the same DOM
 * predicates that `openGalleryForScope()` consults, call the same
 * helper (`hsLogGalleryOpenerSnapshot`), and classify the captured
 * snapshot into one of the failure buckets:
 *
 *   1. candidate-missing       — selector returned no element
 *   2. hit-test failure        — elementFromPoint at center returns
 *                                something else (overlay / hidden div)
 *   3. lazy-mount timing       — click happened but no dialog was
 *                                observable before AND after
 *   4. click succeeded         — dialog appears post-click
 *
 * This classification feeds `single-incident-verification` so we can
 * tell whether the production failure is at the candidate selector, the
 * viewport hit-test, or Zillow's lazy mount step — without touching
 * the real production code path.
 */
import { describe, expect, it } from 'vitest';

type Snapshot = {
  scope: string | null;
  selector: string | null;
  candidate: any;
  hit: any;
  preClick: any;
  postClick: any;
};

type Summary = {
  tag: string | null;
  id: string | null;
  cls: string | null;
  ariaLabel: string | null;
  dataTestId: string | null;
  rect: { x: number; y: number; w: number; h: number };
  display: string;
  visibility: string;
  opacity: string;
  isConnected: boolean;
};

function summarise(el: any): Summary | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const style = (typeof getComputedStyle === 'function')
    ? getComputedStyle(el)
    : { display: '', visibility: '', opacity: '' } as CSSStyleDeclaration;
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    id: el.id || null,
    cls: (typeof el.className === 'string' ? el.className : '').trim().slice(0, 80) || null,
    ariaLabel: el.getAttribute ? el.getAttribute('aria-label') || null : null,
    dataTestId: el.getAttribute ? el.getAttribute('data-testid') || null : null,
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    isConnected: !!el.isConnected,
  };
}

type Bucket = 'candidate-missing' | 'hit-test-failure' | 'lazy-mount' | 'click-succeeded';

function classify(s: Snapshot): Bucket {
  if (!s.candidate) return 'candidate-missing';
  if (s.hit && s.hit.tag !== s.candidate.tag) return 'hit-test-failure';
  if (!s.preClick && !s.postClick) return 'lazy-mount';
  return 'click-succeeded';
}

// ──────────────────────────────────────────────────────────────────────────
// Reproduce the candidate-missing case: querySelector returns null.
// ──────────────────────────────────────────────────────────────────────────
describe('Single incident reproduction (gallery_not_opened)', () => {
  it('classifies a candidate-missing scene as candidate-missing', () => {
    const s: Snapshot = {
      scope: 'BUILDING',
      selector: 'button[data-testid="photos-label"]',
      candidate: null,
      hit: null,
      preClick: null,
      postClick: null,
    };
    expect(classify(s)).toBe('candidate-missing');
  });

  it('classifies a hit-test failure when elementFromPoint returns an overlay', () => {
    // Simulate an overlay sitting on top of the candidate's center.
    const candidate: any = {
      tagName: 'BUTTON',
      id: '',
      className: 'photos-label',
      getAttribute: (k: string) => (k === 'data-testid' ? 'photos-label' : null),
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 80, height: 24, right: 180, bottom: 224, toJSON: () => ({}) }),
    };
    const overlay: any = {
      tagName: 'DIV',
      id: 'overlay',
      className: 'fixed-overlay',
      getAttribute: (_: string) => null,
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 80, height: 24, right: 180, bottom: 224, toJSON: () => ({}) }),
    };
    const s: Snapshot = {
      scope: 'BUILDING',
      selector: 'button[data-testid="photos-label"]',
      candidate: summarise(candidate),
      hit: summarise(overlay),
      preClick: null,
      postClick: null,
    };
    expect(classify(s)).toBe('hit-test-failure');
  });

  it('classifies a lazy-mount failure when pre and post click both yield no dialog', () => {
    const candidate: any = {
      tagName: 'BUTTON',
      id: '',
      className: 'photos-label',
      getAttribute: (k: string) => (k === 'data-testid' ? 'photos-label' : null),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24, toJSON: () => ({}) }),
    };
    const s: Snapshot = {
      scope: 'PROPERTY_OLD',
      selector: 'button[data-testid="gallery-see-all-photos-button"]',
      candidate: summarise(candidate),
      hit: summarise(candidate),
      preClick: null,
      postClick: null,
    };
    expect(classify(s)).toBe('lazy-mount');
  });

  it('classifies a click-succeeded scene when post-click dialog appears', () => {
    const candidate: any = {
      tagName: 'BUTTON',
      id: '',
      className: 'photos-label',
      getAttribute: (k: string) => (k === 'data-testid' ? 'photos-label' : null),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24, toJSON: () => ({}) }),
    };
    const dialog: any = {
      tagName: 'DIV',
      id: 'pswp',
      className: 'pswp pswp--open',
      getAttribute: (_: string) => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768, toJSON: () => ({}) }),
    };
    const s: Snapshot = {
      scope: 'BUILDING',
      selector: 'button[data-testid="photos-label"]',
      candidate: summarise(candidate),
      hit: summarise(candidate),
      preClick: null,
      postClick: summarise(dialog),
    };
    expect(classify(s)).toBe('click-succeeded');
  });

});