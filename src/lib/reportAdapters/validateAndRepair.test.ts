/**
 * Regression tests for validateAndRepairFullReport repair rules.
 * Copies the core repair logic as a standalone module so it can be unit-tested
 * without loading the full 9000-line analyze/index.ts.
 *
 * The actual production function lives in supabase/functions/analyze/index.ts.
 * When the production function changes, mirror the relevant rules here and keep
 * these tests green.
 */
import { describe, expect, it } from 'vitest';

function _questionExists(arr: unknown[], needle: string): boolean {
  const lower = needle.toLowerCase();
  return arr.some((q) => {
    const text = typeof q === 'string' ? q : String((q as any)?.question ?? (q as any)?.text ?? JSON.stringify(q));
    return text.toLowerCase().includes(lower.slice(0, 20));
  });
}

function _appendQuestion(arr: unknown[], question: string): void {
  if (!_questionExists(arr, question)) arr.push(question);
}

// ── Isolated repair logic (mirrors analyze/index.ts III-A / III-B / III-C) ─────
// Keep in sync with supabase/functions/analyze/index.ts validateAndRepairFullReport.

function runRepairs(report: Record<string, unknown>, ctx: {
  heating?: string | null;
  basement?: string | null;
  floodZone?: string | null;
  reportProfile?: string;
  buyerReportMode?: string;
  fullBaths?: number | null;
  halfBaths?: number | null;
  baths?: number | null;
  annualTax?: number | null;
  monthlyTax?: number | null;
  description: string;
}) {
  const vf = ctx;
  const listingText = ctx.description?.toLowerCase() ?? '';
  const heating = String(vf.heating ?? '').toLowerCase();
  const basement = String(vf.basement ?? '').toLowerCase();
  const floodZone = String(vf.floodZone ?? '').trim();
  const isSFOC = vf.reportProfile === 'single_family_owner_occupier'
    || (vf.buyerReportMode as string) === 'single_family_owner_occupier';
  const isOilHeat = /oil|oil-fired|oil heat/i.test(heating);
  const hasFullBaths = vf.fullBaths != null;
  const hasHalfBaths = vf.halfBaths != null;
  const hasBasement = Boolean(basement);
  const reportTextLower = JSON.stringify(report).toLowerCase();

  const stringReplacements: Array<[RegExp, string]> = [];

  // ═══ PHASE 1: High-priority structural repairs that must run BEFORE applyReplacements ═══

  // ── SFOC Next Best Move "do not rely on the rental income" ──────────────────
  // This runs BEFORE applyReplacements so it can fix the phrase before rental income is replaced.
  if (isSFOC) {
    const rentalSignals = ['rental income', 'rent roll', 'tenant lease'];
    const hasRentalSignal = rentalSignals.some((s) => listingText.includes(s));
    if (!hasRentalSignal) {
      const SFOC_RENTAL_REPLACEMENT =
        'Do not rely on the price signal, expansion potential, basement use, or monthly cost estimate until comparable sales, permits, roof condition, and major systems are verified.';
      const doNotRelyPattern = /do not rely on (?:the )?rental income[^.]*price signal[^.]*\./gi;
      const fixDoNotRely = (obj: any): void => {
        if (typeof obj !== 'object' || obj === null) return;
        if (Array.isArray(obj)) { obj.forEach(fixDoNotRely); return; }
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (typeof v === 'string' && doNotRelyPattern.test(v)) {
            obj[k] = v.replace(doNotRelyPattern, SFOC_RENTAL_REPLACEMENT);
          } else if (typeof v === 'object' || Array.isArray(v)) {
            fixDoNotRely(obj[k]);
          }
        }
      };
      fixDoNotRely(report);
    }
  }

  // ═══ PHASE 2: String replacement patterns ═══════════════════════════════════════

  // ── Flood zone ──────────────────────────────────────────────────────────────
  if (floodZone) {
    const zoneDisplay = floodZone.startsWith('FEMA') ? floodZone : `FEMA Zone: ${floodZone}`;
    const fzReplacement = `${zoneDisplay}. Buyers should still verify drainage history, basement water intrusion history, flood insurance requirements, and local storm exposure before relying on this assumption.`;
    const askReplacement = 'Does the stated flood zone affect insurance requirements, drainage risk, or basement water history?';
    stringReplacements.push(
      [/\bis the property in a flood zone\?/gi, askReplacement],
      [/\bcheck FEMA maps\b/gi, 'verify flood zone details and insurance requirements'],
      [/\bflood unknown\b/gi, fzReplacement],
      [/\bflood not stated\b/gi, fzReplacement],
      [/\bflood not disclosed\b/gi, fzReplacement],
      [/\bflood risk not confirmed\b/gi, fzReplacement],
      [/\bflood status unknown\b/gi, fzReplacement],
      [/\bflood status not disclosed\b/gi, fzReplacement],
      [/\bflood status not stated\b/gi, fzReplacement],
      [/\bflood and coastal risks not stated\b/gi, fzReplacement],
      [/\blisting does not state flood status\b/gi, fzReplacement],
      [/\bflood zone unknown\b/gi, fzReplacement],
      [/\bflood risk unknown\b/gi, fzReplacement],
    );
  }

  // ── SFOC rental language ──────────────────────────────────────────────────
  if (isSFOC) {
    const rentalSignals = [
      'rental income', 'rent roll', 'tenant lease', 'tenant status',
      'income-producing', 'occupied by tenant', 'current lease',
      'actual leases', 'relying on rent', 'relying on rental setup',
      'income unit', 'rental unit', 'rental yield', 'cash flow',
      'income support', 'rental return', 'investor yield',
      'investment income', 'income from the property',
    ];
    const hasRentalSignal = rentalSignals.some((s) => listingText.includes(s));
    if (!hasRentalSignal) {
      // NOTE: price signal is NOT replaced here because fixDoNotRely handles it.
      stringReplacements.push(
        [/\brental income\b(?<!do not rely on the )/i, 'comparable sales'],
        [/\brental yield\b/gi, 'resale or ownership-cost assumptions'],
        [/\bcash\s+flow\b/gi, 'monthly affordability'],
        [/\bincome\s+support\b/gi, 'financing terms'],
        [/\brental\s+return\b/gi, 'resale or ownership-cost assumptions'],
        [/\binvestor\s+yield\b/gi, 'resale or ownership-cost assumptions'],
        [/\binvestment\s+income\b/gi, 'financing terms'],
        [/\bincome\s+from\s+the\s+property\b/gi, 'ownership costs'],
        [/\brent roll\b/gi, 'comparable sales analysis'],
        [/\btenant lease\b/gi, 'financing terms'],
        [/\btenant status\b/gi, 'ownership history'],
        [/\bincome-support(?:ing|ed)?\b/gi, 'financing terms'],
        [/\bactual leases\b/gi, 'financing pre-approval'],
        [/\brelying on (?:the )?rental (?:income|setup)\b/gi, 'relying on comparable sales and condition analysis'],
      );
    }
  }

  // ── Oil heating: context-aware replacements ─────────────────────────────────────
  if (isOilHeat) {
    const oilForbiddenTerms: Array<{ pattern: string; replacement: string }> = [
      { pattern: 'fuel storage history remediation or replacement', replacement: 'Oil heating system and tank history need verification' },
      { pattern: 'possible tank or soil concerns', replacement: 'Because the listing shows oil heating, verify oil tank location, tank age, service records, and whether any tank was removed or abandoned.' },
      { pattern: 'possible tank/soil concerns', replacement: 'Because the listing shows oil heating, verify oil tank location, tank age, service records, and whether any tank was removed or abandoned.' },
      { pattern: 'fuel storage remediation', replacement: 'oil tank history and service records' },
      { pattern: 'tank remediation', replacement: 'tank age and service records' },
      { pattern: 'soil contamination', replacement: 'tank and soil verification' },
      { pattern: 'soil concerns', replacement: 'tank and soil verification' },
      { pattern: 'fuel storage problem', replacement: 'oil heating system setup' },
      { pattern: 'environmental contamination', replacement: 'heating system condition' },
      { pattern: 'costly tank removal', replacement: 'tank age and condition verification' },
      { pattern: 'underground tank', replacement: 'oil tank location' },
      { pattern: 'removal cost', replacement: 'service records' },
      { pattern: 'remediation', replacement: 'service records' },
      { pattern: 'contamination', replacement: 'service records' },
      { pattern: 'replacement', replacement: 'oil tank history' },
    ];
    const oilContextSignals = /oil|fuel\s*storage|tank|heating\s*system/i;
    const applyOilAwareReplacements = (obj: any): void => {
      if (typeof obj !== 'object' || obj === null) return;
      if (Array.isArray(obj)) { obj.forEach(applyOilAwareReplacements); return; }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v !== 'string') { applyOilAwareReplacements(obj[k]); continue; }
        if (!oilContextSignals.test(v)) continue;
        let next = v;
        for (const { pattern, replacement } of oilForbiddenTerms) {
          const re = new RegExp(pattern, 'gi');
          if (re.test(next)) next = next.replace(re, replacement);
        }
        if (next !== v) obj[k] = next;
      }
    };
    applyOilAwareReplacements(report);
    stringReplacements.push(
      [/(?:possible\s+)?fuel storage\s+(?:history\s+)?(?:location\s+)?(?:and\s+)?(?:removal\s+)?cost/gi,
        'Oil heating system and tank history need verification'],
      [/\bremoval cost\b/gi, 'service records'],
      [/\bunderground\s+tank\b/gi, 'oil tank location'],
      [/\bfuel storage\s+(?:problem|issue)\b/gi, 'oil heating system setup'],
      [/\benvironmental contamination\b/gi, 'heating system condition'],
      [/\bcostly\s+tank\s+removal\b/gi, 'tank age and condition verification'],
      [/\bfuel storage\s+history\s+remediation\s+or\s+replacement\b/gi,
        'Oil heating system and tank history need verification'],
      [/\bpossible\s+tank\s+or\s+soil\s+concerns\b/gi,
        'Because the listing shows oil heating, verify oil tank location, tank age, service records, and whether any tank was removed or abandoned.'],
    );
  }

  // ── Vague / low-value copy ───────────────────────────────────────────────────
  stringReplacements.push(
    [/Could cost money/gi, 'Could affect repair budget, insurance assumptions, or negotiation position'],
    [/Key Verification Risk/gi, 'Verification Needed'],
    [/Hidden issue/gi, 'Item to Verify'],
    [/Worth a closer look/gi, 'Verify Before Committing'],
    [/May shift with more info/gi, 'Depends on verified condition and comparable sales'],
  );

  // ═══ PHASE 3: Apply all string replacements ═══════════════════════════════════
  const applyReplacements = (obj: any): void => {
    if (typeof obj === 'string') return;
    if (Array.isArray(obj)) { obj.forEach(applyReplacements); return; }
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'string') {
          let next = v;
          for (const [pattern, replacement] of stringReplacements) {
            if (pattern.test(next)) next = next.replace(pattern, replacement);
          }
          if (next !== v) obj[k] = next;
        } else {
          applyReplacements(v);
        }
      }
    }
  };
  applyReplacements(report);

  // ═══ PHASE 4: Structural field forces ══════════════════════════════════════════

  // ── Flood zone: structural environmental_risk ──────────────────────────────
  if (floodZone) {
    const zoneDisplay = floodZone.startsWith('FEMA') ? floodZone : `FEMA Zone: ${floodZone}`;
    const isMinimalRisk = /Zone X|minimal|unshaded/i.test(zoneDisplay);
    const envRisk = (report as any).environmental_risk as Record<string, unknown> | undefined;
    if (envRisk && typeof envRisk === 'object') {
      envRisk.summary = `${zoneDisplay}. Buyers should still verify drainage history, basement water intrusion history, flood insurance requirements, and local storm exposure before relying on this assumption.`;
      envRisk.title = isMinimalRisk
        ? 'Flood / Drainage — Lower FEMA Risk, Still Verify'
        : 'Flood / Drainage Verification';
      envRisk.description = `${zoneDisplay}. Verify flood insurance requirements, basement water intrusion history, drainage, and local storm exposure.`;
      envRisk.action = 'Verify FEMA/local maps, insurance requirements, basement water history, drainage, and prior storm-related issues.';
      envRisk.risk_level = isMinimalRisk ? 'Low / Verify' : 'Medium';
      if (!envRisk.items_to_check || !Array.isArray(envRisk.items_to_check)) {
        (envRisk as any).items_to_check = [];
      }
      const items: string[] = (envRisk as any).items_to_check;
      if (!items.some((item: unknown) => /flood/i.test(String(item)))) {
        items.unshift(`Flood Zone: ${zoneDisplay} — verify insurance cost and basement water history`);
      }
    }

    // Fix flood questions in top-level questions_to_ask array
    const floodQReplacement = 'Does the stated flood zone affect insurance requirements, drainage risk, or basement water history?';
    const topQuestions: unknown[] =
      (report as any).questions_to_ask
      ?? (report as any).questions
      ?? [];
    for (const q of topQuestions) {
      if (typeof q === 'object' && q !== null) {
        const qObj = q as Record<string, unknown>;
        const qText = String(qObj.text ?? qObj.question ?? JSON.stringify(q));
        if (/is the property in a flood zone/i.test(qText)) {
          if (qObj.text) qObj.text = floodQReplacement;
          if (qObj.question) qObj.question = floodQReplacement;
        }
      } else if (typeof q === 'string' && /is the property in a flood zone/i.test(q)) {
        const idx = topQuestions.indexOf(q);
        topQuestions[idx] = floodQReplacement;
      }
    }
  }

  // ── Bath breakdown ───────────────────────────────────────────────────────
  if (hasFullBaths || hasHalfBaths) {
    const fb = vf.fullBaths ?? 0;
    const hb = vf.halfBaths ?? 0;
    const breakdown = fb > 0 && hb > 0
      ? `${fb} full + ${hb} half`
      : fb > 0 ? `${fb} full`
      : hb > 0 ? `${hb} half` : '';
    const ps = report.property_snapshot as Record<string, unknown> | undefined;
    if (ps) {
      ps.bathDisplay = breakdown;
      ps.bathTotalDisplay = `${vf.baths} baths (listing)`;
    }
    for (const mod of [
      (report as any).what_we_found,
      (report as any).whatWeFound,
    ] as Array<Record<string, unknown> | undefined>) {
      if (mod && typeof mod === 'object') {
        mod.bathDisplay = breakdown;
        mod.bathTotalDisplay = `${vf.baths} baths (listing)`;
      }
    }
  }

  // ── Basement questions — always run when hasBasement is true ─────────────────
  const liveReportText = JSON.stringify(report).toLowerCase();
  const basementSignal = hasBasement
    || /basement|lower level|drop ceiling|wood panel|below-grade|partially finished|finished basement/i
      .test(listingText + ' ' + liveReportText);
  if (basementSignal) {
    const questionArr: unknown[] =
      (report as any).questions_to_ask
      ?? (report as any).questions
      ?? [];
    const BASEMENT_QUESTIONS = [
      'Can you confirm the basement\'s current use, condition, access, egress, permits, and whether any basement area is included in legal square footage?',
      'Has the basement had any water intrusion, drainage, foundation, or moisture issues?',
    ];
    for (const q of BASEMENT_QUESTIONS) _appendQuestion(questionArr, q);
    (report as any).questions_to_ask = questionArr;
  }

  // ── Photo area: Basement misclassified as Living Room ────────────────────
  const photoAreas = (report as any).photo_analysis?.areas
    ?? (report as any).photoAnalysis?.areas
    ?? (report as any).photo_areas
    ?? [];
  if (Array.isArray(photoAreas)) {
    for (const area of photoAreas) {
      if (!area || typeof area !== 'object') continue;
      const a = area as Record<string, unknown>;
      const areaText = String(a.name ?? a.area ?? '').toLowerCase();
      const isBasementArea = /basement|lower level|drop ceiling|wood panel|below-grade/i.test(areaText);
      const descText = String(a.description ?? a.observations ?? '').toLowerCase();
      const hasBasementSignal = /basement|lower level|drop ceiling|wood panel|below-grade/i.test(descText);
      if ((/living room|lounge/i.test(areaText)) && (isBasementArea || hasBasementSignal)) {
        // Write to BOTH 'name' and 'area' — model may use either.
        a.name = 'Basement / Lower Level';
        a.area = 'Basement / Lower Level';
      }
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const sfocCtx = {
  reportProfile: 'single_family_owner_occupier',
  description: '',
};

describe('validateAndRepairFullReport — Oil Heating', () => {
  it('replaces "Potential fuel storage history remediation or replacement"', () => {
    const report = { maintenance_risk: { summary: 'Potential fuel storage history remediation or replacement' } };
    runRepairs(report, { heating: 'Oil', description: '' });
    expect(report.maintenance_risk.summary).not.toMatch(/remediation|replacement/i);
    expect(report.maintenance_risk.summary).toMatch(/oil heating system|tank history/i);
  });

  it('replaces "heating system raises possible tank/soil concerns"', () => {
    const report = { maintenance_risk: { summary: 'heating system raises possible tank/soil concerns' } };
    runRepairs(report, { heating: 'Oil', description: '' });
    expect(report.maintenance_risk.summary).not.toMatch(/soil concerns|tank\/soil/i);
    expect(report.maintenance_risk.summary).toMatch(/verify oil tank|tank age|service records/i);
  });

  it('replaces "removal cost" in oil context', () => {
    const report = { maintenance_risk: { description: 'Possible fuel storage history location and removal cost' } };
    runRepairs(report, { heating: 'Oil', description: '' });
    expect(report.maintenance_risk.description).not.toMatch(/removal cost/i);
  });

  it('replaces "underground tank" in oil context', () => {
    const report = { maintenance_risk: { description: 'Check for underground tank integrity' } };
    runRepairs(report, { heating: 'Oil', description: '' });
    expect(report.maintenance_risk.description).toMatch(/oil tank location/i);
  });

  it('does NOT replace "replacement" in non-oil context', () => {
    const report = { maintenance_risk: { summary: 'Roof replacement may be needed within 5 years' } };
    runRepairs(report, { heating: 'Gas forced air', description: '' });
    expect(report.maintenance_risk.summary).toMatch(/replacement/i);
  });

  it('replaces standalone "contamination" in oil context', () => {
    const report = { maintenance_risk: { summary: 'Oil contamination may be present' } };
    runRepairs(report, { heating: 'Oil', description: '' });
    expect(report.maintenance_risk.summary).toMatch(/service records/i);
  });
});

describe('validateAndRepairFullReport — SFOC Rental Language', () => {
  it('replaces "rental income" in SFOC context', () => {
    const report = { next_best_move: { action: 'Do not rely on the rental income' } };
    runRepairs(report, sfocCtx as any);
    expect(JSON.stringify(report)).not.toMatch(/\brental income\b/i);
  });

  it('replaces "rental yield"', () => {
    const report = { investment_metrics: { summary: 'Expected rental yield is 5%' } };
    runRepairs(report, sfocCtx as any);
    expect(report.investment_metrics.summary).toMatch(/resale|ownership-cost assumptions/i);
    expect(report.investment_metrics.summary).not.toMatch(/\brental yield\b/i);
  });

  it('replaces "cash flow"', () => {
    const report = { carrying_costs: { summary: 'High property tax burden reducing cash flow' } };
    runRepairs(report, sfocCtx as any);
    expect(report.carrying_costs.summary).toMatch(/monthly affordability/i);
    expect(report.carrying_costs.summary).not.toMatch(/\bcash\s+flow\b/i);
  });

  it('replaces "income support"', () => {
    const report = { summary: 'Income support from the property offsets costs' };
    runRepairs(report, sfocCtx as any);
    expect(JSON.stringify(report)).not.toMatch(/\bincome support\b/i);
  });

  it('fixes "do not rely on the rental income or price signal" — doNotRely runs before applyReplacements', () => {
    const report = {
      your_next_best_move: {
        action: 'Do not rely on the rental income or price signal.',
      },
    };
    runRepairs(report, sfocCtx as any);
    expect(JSON.stringify(report)).not.toMatch(/\brental income\b/i);
    // The doNotRely fix runs before applyReplacements, so the full replacement should be kept
    expect(JSON.stringify(report)).toMatch(/price signal, expansion potential, basement use/i);
  });

  it('does NOT replace rental language when listing EXPLICITLY mentions rental income', () => {
    const report = { next_best_move: { action: 'Rental income offsets mortgage by $500/mo' } };
    runRepairs(report, { ...sfocCtx, description: 'rental income potential' } as any);
    expect(JSON.stringify(report)).toMatch(/\brental income\b/i);
  });
});

describe('validateAndRepairFullReport — Flood Zone', () => {
  it('replaces "Flood and coastal risks not stated"', () => {
    const report = { environmental_risk: { summary: 'Flood and coastal risks not stated', title: 'Environmental Risk' } };
    runRepairs(report, { floodZone: 'FEMA Zone X (unshaded)', description: '' });
    expect(report.environmental_risk.summary).toMatch(/FEMA Zone X/i);
    expect(report.environmental_risk.summary).not.toMatch(/not stated|unknown/i);
  });

  it('replaces "Is the property in a flood zone?" question', () => {
    const report = {
      questions_to_ask: [
        'Is the property in a flood zone?',
        'What school district is this in?',
      ],
    };
    runRepairs(report, { floodZone: 'FEMA Zone X (unshaded)', description: '' });
    expect(report.questions_to_ask[0]).toMatch(/stated flood zone affect insurance/i);
    expect(report.questions_to_ask[0]).not.toMatch(/Is the property in a flood zone\?/i);
  });

  it('replaces "flood unknown" variant', () => {
    const report = { environmental_risk: { summary: 'Flood unknown — verify independently' } };
    runRepairs(report, { floodZone: 'FEMA Zone AE (1% annual flood hazard)', description: '' });
    expect(report.environmental_risk.summary).toMatch(/FEMA Zone AE/i);
    expect(report.environmental_risk.summary).not.toMatch(/flood unknown/i);
  });

  it('replaces "flood not stated"', () => {
    const report = { environmental_risk: { summary: 'Flood not stated in listing' } };
    runRepairs(report, { floodZone: 'FEMA Zone AE', description: '' });
    expect(report.environmental_risk.summary).toMatch(/FEMA Zone AE/i);
    expect(report.environmental_risk.summary).not.toMatch(/not stated/i);
  });

  it('sets title to "Flood / Drainage Verification" for non-minimal zone', () => {
    const report = { environmental_risk: { summary: 'Unknown', title: 'Environmental Risk' } };
    runRepairs(report, { floodZone: 'FEMA Zone AE', description: '' });
    expect(report.environmental_risk.title).toBe('Flood / Drainage Verification');
  });

  it('sets risk_level to "Low / Verify" for Zone X minimal-risk', () => {
    const report = { environmental_risk: { summary: 'Unknown', risk_level: 'Unknown' } };
    runRepairs(report, { floodZone: 'FEMA Zone X (unshaded)', description: '' });
    expect(report.environmental_risk.risk_level).toBe('Low / Verify');
  });

  it('sets action field for flood zone', () => {
    const report = { environmental_risk: { summary: 'Unknown', action: '' } };
    runRepairs(report, { floodZone: 'FEMA Zone AE', description: '' });
    expect(report.environmental_risk.action).toMatch(/FEMA|local maps|insurance|basement water history/i);
  });
});

describe('validateAndRepairFullReport — Bath Breakdown', () => {
  it('writes bathDisplay "1 full + 1 half" into property_snapshot', () => {
    const report = { property_snapshot: {} };
    runRepairs(report, { fullBaths: 1, halfBaths: 1, baths: 2, description: '' });
    expect(report.property_snapshot.bathDisplay).toBe('1 full + 1 half');
  });

  it('writes bathTotalDisplay "2 baths (listing)"', () => {
    const report = { property_snapshot: {} };
    runRepairs(report, { fullBaths: 1, halfBaths: 1, baths: 2, description: '' });
    expect(report.property_snapshot.bathTotalDisplay).toBe('2 baths (listing)');
  });

  it('writes bathDisplay into what_we_found when present', () => {
    const report = { property_snapshot: {}, what_we_found: {} };
    runRepairs(report, { fullBaths: 2, halfBaths: 1, baths: 3, description: '' });
    expect(report.what_we_found.bathDisplay).toBe('2 full + 1 half');
  });

  it('only outputs full when no half baths', () => {
    const report = { property_snapshot: {} };
    runRepairs(report, { fullBaths: 3, halfBaths: 0, baths: 3, description: '' });
    expect(report.property_snapshot.bathDisplay).toBe('3 full');
  });
});

describe('validateAndRepairFullReport — Basement Living Room Classification', () => {
  it('renames "Living Room" with basement signals to "Basement / Lower Level" (name + area)', () => {
    const report = {
      photo_analysis: {
        areas: [
          { area: 'Living Room', description: 'Drop ceiling visible, wood paneling on walls, below-grade windows' },
        ],
      },
    };
    runRepairs(report, { basement: 'Finished basement', description: '' });
    // Production writes BOTH 'name' and 'area' — model may use either field.
    expect(report.photo_analysis.areas[0].area).toBe('Basement / Lower Level');
  });

  it('renames "Living Room" via name field (model uses name not area)', () => {
    const report = {
      photo_analysis: {
        areas: [
          { name: 'Living Room', description: 'Drop ceiling visible, wood paneling on walls, below-grade windows' },
        ],
      },
    };
    runRepairs(report, { basement: 'Finished basement', description: '' });
    // Production writes both 'name' and 'area'
    expect(report.photo_analysis.areas[0].name).toBe('Basement / Lower Level');
  });

  it('keeps real living room unchanged when no basement signals', () => {
    const report = {
      photo_analysis: {
        areas: [
          { area: 'Living Room', description: 'Hardwood floors, large windows, fireplace' },
        ],
      },
    };
    runRepairs(report, { description: '' });
    expect(report.photo_analysis.areas[0].area).toBe('Living Room');
  });

  it('appends basement questions to questions_to_ask', () => {
    const report = {
      questions_to_ask: ['What is the school district?'],
    };
    runRepairs(report, { basement: 'Full basement', description: '' });
    expect(report.questions_to_ask.some((q: unknown) =>
      /basement.*current use|egress|permits/i.test(String(q))
    )).toBe(true);
  });
});

describe('validateAndRepairFullReport — Compound Input', () => {
  it('handles a report with oil heating AND flood zone AND SFOC simultaneously', () => {
    const report = {
      maintenance_risk: {
        summary: 'Potential fuel storage history remediation or replacement. High property tax burden reducing cash flow.',
      },
      environmental_risk: {
        summary: 'Flood and coastal risks not stated',
        title: 'Environmental Risk',
      },
      your_next_best_move: {
        action: 'Do not rely on the rental income or price signal.',
      },
      questions_to_ask: [
        'Is the property in a flood zone?',
      ],
    };
    runRepairs(report, {
      heating: 'Oil',
      floodZone: 'FEMA Zone AE',
      reportProfile: 'single_family_owner_occupier',
      description: '',
    } as any);

    // Oil heating
    expect(report.maintenance_risk.summary).not.toMatch(/remediation|replacement/i);
    expect(report.maintenance_risk.summary).toMatch(/oil heating system|tank history/i);
    // SFOC rental
    expect(JSON.stringify(report)).not.toMatch(/\brental income\b/i);
    expect(JSON.stringify(report)).not.toMatch(/\bcash\s+flow\b/i);
    // Flood zone
    expect(report.environmental_risk.summary).toMatch(/FEMA Zone AE/i);
    expect(report.environmental_risk.summary).not.toMatch(/not stated/i);
    expect(report.environmental_risk.title).toBe('Flood / Drainage Verification');
    // Question
    expect(report.questions_to_ask[0]).toMatch(/stated flood zone affect insurance/i);
  });
});
