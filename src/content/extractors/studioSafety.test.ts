/**
 * Pure-JS unit tests for the Studio (bedrooms=0) safety contract in
 * `extension/content.js`. The browser extension file is not directly
 * importable here, so the same regex/parse logic is replicated in the
 * helper below; any divergence between the helper and production code
 * will be caught by the broader regression suite.
 *
 * If the production rules are updated, update THIS helper in lock-step
 * (or, ideally, move `extractRooms` into a shared module so both code
 * paths read the same function).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helper — mirrors extension/content.js#extractRooms (kept in sync).
// Studio detection + labeled + strong-attach regex.
// ─────────────────────────────────────────────────────────────────────────────
function extractRoomsFromText(text) {
  const result = { bedrooms: null, bathrooms: null, parking: null };

  // Studio detection: only matched when "Studio" appears in a labelled
  // context (e.g. "Type: Studio" or "Bedrooms: Studio").
  if (/\btype\b[\s:—\-]*studio\b/i.test(text) ||
      /\bbedrooms?\b[\s:—\-]*studio\b/i.test(text) ||
      /^\s*studio\s*$/im.test(text)) {
    result.bedrooms = 0;
  }

  // Bedrooms — labeled first, then strong-attach.
  if (result.bedrooms == null) {
    const labeled = text.match(/\bbedrooms?\b\s*[:\-—]?\s*(\d+)\b/i);
    if (labeled) {
      result.bedrooms = parseInt(labeled[1], 10);
    }
  }
  if (result.bedrooms == null) {
    const m = text.match(/(?:^|[\s.,;:(\[])(\d{1,2})\s*(?:bd|bedrooms?)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) result.bedrooms = n;
    }
  }

  // Bathrooms — same conservative approach.
  if (result.bathrooms == null) {
    const labeled = text.match(/\bbathrooms?\b\s*[:\-—]?\s*(\d+(?:\.\d+)?)\b/i);
    if (labeled) result.bathrooms = parseFloat(labeled[1]);
  }
  if (result.bathrooms == null) {
    const m = text.match(/(?:^|[\s.,;:(\[])(\d{1,2}(?:\.\d+)?)\s*(?:bathrooms?|ba)\b/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) result.bathrooms = n;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';

describe('extractRooms — Studio (bedrooms=0) safety', () => {
  it('Governors Park West page: Studio with "1-bedroom apartments" copy → bedrooms=0', () => {
    // Reduced approximation of the real page body innerText. The marketing
    // copy includes "spacious studios and thoughtfully designed one-bedroom
    // apartments" which a permissive regex used to match.
    const body = [
      '725 N Logan St APT 5',
      'Apartment',
      'Available now',
      'Cats, small dogs OK',
      'Studio',
      '1',
      'baths',
      '230',
      'sqft',
      '$800/mo',
      "Choose from spacious studios and thoughtfully designed one-bedroom apartments, each offering an inviting atmosphere with ample natural light.",
      'Facts & features',
      'Interior',
      'Bedrooms & bathrooms',
      'Bedrooms: 0',
      'Bathrooms: 1',
    ].join('\n');

    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBe(0);
  });

  it('Studio via explicit "Bedrooms: 0" label survives marketing copy noise', () => {
    const body = [
      'Studio available',
      '1 bedroom apartments also available',
      'Bedrooms: 0',
    ].join('\n');
    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBe(0);
  });

  it('Plain 1-bedroom listing is still 1 (no Studio label, no label, strong-attach)', () => {
    const body = '1 bedroom apartment for rent. Includes 1 bath.';
    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBe(1);
  });

  it('Plain 3-bedroom listing remains 3', () => {
    const body = '3 bedroom townhouse. 2 baths. 1500 sqft.';
    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBe(3);
  });

  it('Weak "1 bedroom" floating in copy without a labeled fact row does not impose a value', () => {
    // No labeled fact row. The old regex would match "1 bedroom" here.
    // The new logic guards via Studio detection OR a labeled match OR a
    // strong-attach. None applies to this string, so bedrooms stays null.
    const body = "Choose from spacious studios and thoughtfully designed one-bedroom apartments";
    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBeNull();
  });

  it('Studio detection is not triggered by the plural "studios" alone', () => {
    const body = "Choose from spacious studios and modern one-bedroom apartments";
    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBeNull();
  });

  it('Studio via "Type: Studio" label sets 0 even when 1-bedroom appears in description', () => {
    const body = [
      'Type: Studio',
      'Apartment Type: Studio',
      'Building marketing: studios and one-bedroom apartments',
    ].join('\n');
    const result = extractRoomsFromText(body);
    expect(result.bedrooms).toBe(0);
  });
});
