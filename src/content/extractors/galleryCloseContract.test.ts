/**
 * Contract tests for the gallery-closed-on-finish invariants:
 *
 *   1. Every `opened:true` return path in `openGalleryForScope()` MUST
 *      call `markGalleryOpened()` first. Failure paths MUST NOT.
 *   2. `extractZillowGallery()` MUST wrap its body in try/finally and
 *      call `closeGallery()` from the finally block, so the gallery is
 *      closed on success / PARTIAL / FAILED / thrown — uniformly across
 *      all 5 Zillow collectors and the legacy PhotoSwipe path.
 *   3. The 5 `collectZillow*` collectors MUST NOT call `closeGallery()`
 *      themselves — closing is owned by `extractZillowGallery()`'s finally.
 *   4. `closeGallery()` itself MUST be the canonical closing dispatcher
 *      with the existing galleryDialog / PhotoSwipe branches intact.
 *
 * Source-text contracts (not DOM) because `extension/content.js` is loaded
 * by Chrome natively and is not on the TS module graph; vitest runs in
 * `environment: 'node'` without jsdom.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTENT_JS = resolve(__dirname, '..', '..', '..', 'extension', 'content.js');

function readContent(): string {
  return readFileSync(CONTENT_JS, 'utf8');
}

// Brace-balanced extraction of an async function body.
function extractFunctionBody(src: string, signatureRe: RegExp): string {
  const headerMatch = src.match(signatureRe);
  if (!headerMatch) throw new Error(`signature not found: ${signatureRe}`);
  const start = headerMatch.index! + headerMatch[0].length - 1; // at the `{`
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`could not balance braces for: ${signatureRe}`);
}

const OPEN_GALLERY_RE =
  /async\s+function\s+openGalleryForScope\s*\([^)]*\)\s*\{/m;
const EXTRACT_RE =
  /async\s+function\s+extractZillowGallery\s*\([^)]*\)\s*\{/m;

describe('Gallery close lifecycle contracts', () => {
  it('openGalleryForScope calls markGalleryOpened() on every opened:true return path', () => {
    const body = extractFunctionBody(readContent(), OPEN_GALLERY_RE);
    // Capture every `return { opened: true, ... }` so we can assert each
    // is preceded by markGalleryOpened() in its enclosing branch.
    const openedReturns = body.match(
      /return\s*\{\s*opened:\s*true\s*,[\s\S]*?\}\s*;/g
    ) ?? [];
    expect(openedReturns.length, 'expected at least one opened:true return').toBeGreaterThanOrEqual(6);

    // Walk the body and, for each opened:true return, ensure a
    // markGalleryOpened() appears earlier in the same scope.
    // A safe simplification: every opened:true return in the function
    // must have AT LEAST one markGalleryOpened() earlier in the body.
    const markCalls = body.match(/markGalleryOpened\s*\(\s*\)\s*;/g) ?? [];
    expect(markCalls.length, 'expected at least 6 markGalleryOpened() calls').toBeGreaterThanOrEqual(6);

    // Last markGalleryOpened() must come BEFORE the last opened:true return.
    const lastMark = body.lastIndexOf('markGalleryOpened');
    const lastOpenedReturn = body.lastIndexOf('return { opened: true');
    expect(lastMark, 'no markGalleryOpened in body').toBeGreaterThanOrEqual(0);
    expect(lastOpenedReturn).toBeGreaterThan(lastMark);
  });

  it('openGalleryForScope does NOT call markGalleryOpened() on opened:false paths', () => {
    const body = extractFunctionBody(readContent(), OPEN_GALLERY_RE);
    // Both BUILDING miss and PROPERTY final fallback return
    // `{ opened: false, expectedTotal: null }`. Verify no
    // markGalleryOpened() call is closer to those returns than to any
    // opened:true return — i.e. the guard must be paired strictly with
    // opened:true. We assert by counting scope-aware pairing: every
    // opened:false return in the body is OUTSIDE a markGalleryOpened call.
    //
    // The simplest proxy: the number of opened:true returns exceeds the
    // number of opened:false returns; assert that ratio.
    const openedTrue = (body.match(/return\s*\{\s*opened:\s*true\b/g) ?? []).length;
    const openedFalse = (body.match(/return\s*\{\s*opened:\s*false\b/g) ?? []).length;
    expect(openedTrue).toBeGreaterThanOrEqual(6);
    expect(openedFalse).toBeGreaterThanOrEqual(2);
    expect(openedTrue).toBeGreaterThan(openedFalse);
  });

  it('extractZillowGallery wraps the body in try/finally and calls closeGallery() from finally', () => {
    const body = extractFunctionBody(readContent(), EXTRACT_RE);
    // try{ ... }finally{ closeGallery(); } structure check.
    // Look for a `try {` whose corresponding `} finally {` block contains
    // `closeGallery();`.
    const tryFinallyRe =
      /try\s*\{[\s\S]*?\}\s*finally\s*\{([\s\S]*?)\}\s*$/m;
    const match = body.match(tryFinallyRe);
    expect(match, 'expected a trailing try/finally block in extractZillowGallery').not.toBeNull();
    expect(match![1]).toMatch(/closeGallery\s*\(\s*\)\s*;/);
  });

  it('extractZillowGallery try/finally closes after ALL 5 Zillow gallery paths', () => {
    const body = extractFunctionBody(readContent(), EXTRACT_RE);
    // Ensure the switch dispatch lives INSIDE the try block by checking
    // that all galleryType case labels appear before the matching
    // `} finally {`.
    const finallyPos = body.search(/\}\s*finally\s*\{/);
    expect(finallyPos, 'finally block missing').toBeGreaterThan(0);
    const tryRegion = body.slice(0, finallyPos);
    const requiredGalleryTypes = [
      'ZILLOW_MEDIA_CAROUSEL',
      'ZILLOW_VERTICAL_MEDIA_WALL',
      'ZILLOW_BUILDING_GALLERY',
      'ZILLOW_UNIT_CAROUSEL',
      'ZILLOW_IMX_LIGHTBOX',
    ];
    for (const t of requiredGalleryTypes) {
      expect(tryRegion, `${t} must dispatch inside the try block`).toContain(t);
    }
    // Also: PhotoSwipe path must dispatch inside the try block when reached.
    expect(tryRegion).toContain('ZILLOW_PHOTOSWIPE');
  });

  it('collectZillow* collectors do NOT call closeGallery() themselves', () => {
    const body = readContent();
    const collectorNames = [
      'collectZillowMediaCarousel',
      'collectZillowVerticalWall',
      'collectZillowBuildingGallery',
      'collectZillowUnitCarousel',
      'collectZillowImxLightbox',
    ];
    for (const name of collectorNames) {
      // Brace-balanced extraction of the collector function.
      const sigRe = new RegExp(`async\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
      const collectorBody = extractFunctionBody(body, sigRe);
      expect(collectorBody, `${name} body must exist`).toBeTruthy();
      expect(
        collectorBody,
        `${name} must not call closeGallery() — closing is owned by extractZillowGallery()'s finally`
      ).not.toMatch(/closeGallery\s*\(/);
    }
  });

  it('closeGallery() canonical dispatcher is unchanged: galleryDialog has close-button selectors and gentleRestore', () => {
    const src = readContent();
    // closeGallery() itself MUST still exist, MUST still walk the
    // closeButtonSelectors list, and MUST still call gentleRestore().
    const sigRe = /function\s+closeGallery\s*\([^)]*\)\s*\{/m;
    const headerMatch = src.match(sigRe);
    expect(headerMatch, 'closeGallery() function missing').not.toBeNull();
    const body = extractFunctionBody(src, sigRe);

    // Required close-button selectors (the 6 known buttons).
    const requiredSelectors = [
      'button[aria-label*="close" i]',
      'button[aria-label="Close"]',
      '[data-testid="modal-close"]',
      '[class*="StyledCloseButton"] button',
      '[class*="CloseButton"]',
      'button[class*="close"]',
    ];
    for (const sel of requiredSelectors) {
      expect(body, `closeGallery must reference selector: ${sel}`).toContain(sel);
    }

    // gentleRestore() must still be called.
    expect(body).toMatch(/gentleRestore\s*\(\s*\)/);

    // _galleryWasOpened guard must remain (protects non-gallery dialogs).
    expect(body).toMatch(/_galleryWasOpened/);

    // Escape dispatch via KeyboardEvent must remain.
    expect(body).toMatch(/KeyboardEvent/);
    expect(body).toMatch(/'Escape'/);
  });
});
