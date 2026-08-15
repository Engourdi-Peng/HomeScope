/**
 * Contract tests for the Roof pass-through between `readZillowFactsAndFeatures`
 * and `zillowFinancials.roof` in `extension/content.js`.
 *
 * Background:
 *   On some listings the specialized DOM Roof reader (`extractFactsFromDOM`)
 *   misses the "Roof: <value>" row even though the structured Facts &
 *   features walker has it. Without a fallback, `zillowFinancials.roof`
 *   becomes null and the field is lost all the way through `listing.roof`
 *   -> `optionalDetails.roof` -> `verifiedFacts.roof` ->
 *   `property_snapshot.roof`. This test pins the fallback contract in
 *   `extension/content.js` source so future refactors cannot silently
 *   regress it.
 *
 * Why source-text contract tests rather than DOM tests:
 *   - vitest config uses `environment: 'node'` (no jsdom).
 *   - `extension/content.js` is loaded by the browser natively and is not on
 *     the TS module graph.
 *   - The locked-in contract is about priority + label exactness, both of
 *     which are observable in source text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTENT_JS = resolve(__dirname, '..', '..', '..', 'extension', 'content.js');

function readContent(): string {
  return readFileSync(CONTENT_JS, 'utf8');
}

// Bracket-balanced walk from a `function name(...)` header.
function extractHelper(src: string, fnName: string): string {
  const headerRe = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const headerMatch = src.match(headerRe);
  if (!headerMatch) {
    throw new Error(`Could not find header for ${fnName}`);
  }
  const start = headerMatch.index! + headerMatch[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Could not balance braces for ${fnName}`);
}

describe('Roof pass-through contract (content.js)', () => {
  it('defines a structured-facts picker named exactly pickRoofFromFactsAndFeatures', () => {
    const src = readContent();
    // The helper MUST exist with this exact name so the fallback wiring
    // below cannot silently rename it and break the contract.
    expect(src).toMatch(/function\s+pickRoofFromFactsAndFeatures\s*\(/);
  });

  it('picker accepts the readZillowFactsAndFeatures() shape (groups[*].categories[*].items[*])', () => {
    const src = readContent();
    const helper = extractHelper(src, 'pickRoofFromFactsAndFeatures');
    expect(helper).toMatch(/groups/);
    expect(helper).toMatch(/categories/);
    expect(helper).toMatch(/items/);
  });

  it('picker requires an exact label match ("Roof"), not substring', () => {
    const src = readContent();
    const helper = extractHelper(src, 'pickRoofFromFactsAndFeatures');
    // Must compare with a strict equality (after toLowerCase + trim), not a
    // substring / includes / startsWith. Rows like "Roof age" or "Roof
    // material" must not bleed in.
    expect(helper).toMatch(/label\.toLowerCase\(\)\s*!==\s*['"]roof['"]/);
    expect(helper).not.toMatch(/label\.includes\(\s*['"]roof['"]/);
    expect(helper).not.toMatch(/label\.startsWith\(/);
  });

  it('picker ignores items without a non-empty value', () => {
    const src = readContent();
    const helper = extractHelper(src, 'pickRoofFromFactsAndFeatures');
    // The helper must filter empty values before returning.
    expect(helper).toMatch(/if\s*\(\s*value\s*\)/);
    expect(helper).toMatch(/return\s+value;/);
  });

  it('zillowFinancials.roof writes a fallback ONLY when factsDOM.roof is empty', () => {
    const src = readContent();
    // The expected precedence is encoded in source:
    //   roof: factsDOM?.roof || pickRoofFromFactsAndFeatures(factsAndFeatures) || null
    expect(src).toMatch(
      /roof:\s*factsDOM\?\.roof\s*\|\|\s*pickRoofFromFactsAndFeatures\(\s*factsAndFeatures\s*\)\s*\|\|\s*null/
    );
  });

  it('does NOT widen the picker to substring or partial matches', () => {
    const src = readContent();
    // Catch any future temptation to weaken the contract.
    expect(src).not.toMatch(/roof:\s*factsDOM\?\.roof\s*\|\|\s*factsAndFeatures/);
    expect(src).not.toMatch(/roof:\s*factsAndFeatures.*factsDOM/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Downstream contract: optionalDetails.roof must flow into verifiedFacts.roof
// and ultimately property_snapshot.roof. This mirrors what the existing
// `zillowSaleDataIntegrity.test.ts` already asserts at the fixture level.
// ─────────────────────────────────────────────────────────────────────────────
describe('Roof downstream contract (background.js -> analyze/index.ts)', () => {
  it('background.js forwards listingData.roof into optionalDetails.roof', () => {
    const bg = readFileSync(
      resolve(__dirname, '..', '..', '..', 'extension', 'background.js'),
      'utf8'
    );
    expect(bg).toMatch(/listingData\?\.roof\)\s*optionalDetails\.roof\s*=\s*listingData\.roof/);
  });

  it('analyze buildVerifiedFactsFromPayload surfaces roof from optionalDetails', () => {
    const idx = readFileSync(
      resolve(
        __dirname,
        '..', '..', '..',
        'supabase', 'functions', 'analyze', 'index.ts'
      ),
      'utf8'
    );
    expect(idx).toMatch(/roof:\s*String\(od\.roof\s*\?\?\s*''\)\s*\|\|\s*null/);
  });

  it('analyze writes verifiedFacts.roof into property_snapshot.roof', () => {
    const idx = readFileSync(
      resolve(
        __dirname,
        '..', '..', '..',
        'supabase', 'functions', 'analyze', 'index.ts'
      ),
      'utf8'
    );
    expect(idx).toMatch(/if\s*\(\s*verifiedFacts\.roof\s*\)/);
    expect(idx).toMatch(/finalReport\.property_snapshot\.roof\s*=\s*verifiedFacts\.roof/);
  });
});
