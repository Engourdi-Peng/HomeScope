import { describe, it, expect } from 'vitest';
import { normalizeUSRentReport } from './usRent';

const MODULE_FALLBACKS = { RENT_BOTTOM_LINE_FALLBACK: 'Monthly rent not listed. Confirm the advertised price before applying.' };

function baseRentResult(): Record<string, unknown> {
  return {
    source: 'zillow',
    sourceDomain: 'zillow.com',
    address: '2 Leroy St, Staten Island, NY 10314',
    title: '2 Leroy St, Staten Island, NY 10314',
    overallScore: 65,
    score: 65,
    rental_listing_score: {
      verdict: 'Review With Caution',
      reason: 'The listing lacks key details.',
    },
    bottom_line: 'Modern 2-bed in Staten Island. Confirm rent and fees.',
    quick_summary: 'Recent 2-bed in Staten Island. Confirm all fees.',
    summary: 'Recent 2-bed in Staten Island.',
    rental_snapshot: {
      monthly_rent: '$2,670',
      beds: '2',
      baths: '1',
      sqft: '1,000',
    },
    what_could_change_decision: [
      {
        title: 'Monthly rent not confirmed',
        evidence: 'Not Disclosed / Cannot Verify',
        why_it_matters: 'Cannot assess affordability.',
        action: 'Ask landlord for exact rent.',
      },
    ],
    rental_listing_trust: {
      source_consistency: 'Possible Signal',
      signal_source_breakdown: { address: 'Possible Signal', price: 'Not Disclosed / Cannot Verify', photos: 'Possible Signal', facts: 'Possible Signal' },
      concerns: [],
    },
    availability_check: { status: 'Unknown', available_date: null, lead_time: null, caveats: [] },
    rent_fairness: { asking_rent: '$2,670', rent_zestimate: null, comparable_signal: null, verdict: 'Needs More Evidence', evidence_quality: 'Not Disclosed / Cannot Verify', explanation: 'No comparable data.' },
    recurring_monthly_costs: { items: [], total_recurring_estimate: null },
    application_payment_risk: { status: 'Unknown', fee_amount: null, requirements: [], red_flags: [], caveats: [] },
    lease_terms_rules: { lease_term: null, restrictions: [], additional_fees: [], utilities: [], parking: null, pet_policy: null, termination_early_end: null },
    location_daily_life: { walkability_score: null, noise_concerns: [], daily_amenities: [], weather_or_seasonal: null, evidence_quality: null },
    photo_habitability_review: {
      unit_specific_evidence: [],
      habitability_signals: [],
      missing_views: [],
    },
    risk_categories: {
      listing_trust: {
        risk_level: 'Medium',
        signal: 'Limited listing data.',
        why_it_matters: 'Cannot verify key facts.',
        questions: ['Confirm all listed facts.'],
      },
      availability: {
        risk_level: 'High',
        signal: 'No availability date.',
        why_it_matters: 'Property may not be available.',
        questions: [],
      },
      costs_and_payment: {
        risk_level: 'High',
        signal: 'Monthly rent not confirmed.',
        why_it_matters: 'Cannot assess affordability.',
        questions: [],
      },
      habitability_and_lease: {
        risk_level: 'Medium',
        signal: 'No in-unit laundry; baseboard heat only.',
        evidence: 'Visible in Photos',
        questions: [],
      },
    },
  };
}

function findSection(sections: { id: string }[], id: string): { id: string } | undefined {
  return sections.find((s) => s.id === id);
}

function sectionText(section: { items?: { title?: string; description?: string; value?: string }[] }): string {
  const items = section.items ?? [];
  return items
    .flatMap((it) => [it.title, it.description, it.value].filter(Boolean))
    .join(' | ');
}

describe('normalizeUSRentReport — buyer-flavored phrase suppression', () => {
  it('strips sale-flavored sentences from bottom_line (via hero.summary)', () => {
    const result = {
      ...baseRentResult(),
      bottom_line:
        'Worth a closer look, but verify roof age, major systems, basement permits/egress, and comparable sales before spending serious time. Updated 2-bed first-floor apartment in a detached house.',
      quick_summary: 'Listed at $2,670/mo. Photos show modern kitchen and tiled bath.',
    };

    const normalized = normalizeUSRentReport(result);
    const text = normalized.hero.summary ?? '';

    expect(text).not.toMatch(/roof age/i);
    expect(text).not.toMatch(/comparable sales/i);
    expect(text).not.toMatch(/basement permits/i);
    expect(text).not.toMatch(/comps\b/i);
    expect(text).toMatch(/2-bed|detached house/i);
  });

  it('falls back to quick_summary when bottom_line is fully poisoned', () => {
    const result = {
      ...baseRentResult(),
      bottom_line:
        'Verify roof age, mortgage options, and comparable sales before making an offer.',
      quick_summary:
        'Listed at $2,670/mo. Photos show updated kitchen and window AC units.',
    };

    const normalized = normalizeUSRentReport(result);
    const text = normalized.hero.summary ?? '';
    expect(text).not.toMatch(/roof age/i);
    expect(text).not.toMatch(/mortgage/i);
    expect(text).not.toMatch(/comparable sales/i);
    expect(text).toMatch(/window AC|kitchen/i);
  });

  it('falls back to a non-empty string when both bottom_line and quick_summary are poisoned', () => {
    const result = {
      ...baseRentResult(),
      bottom_line:
        'Verify roof age, mortgage options, and comparable sales before making an offer.',
      quick_summary: 'Make an offer based on recent comps and roof age.',
    };

    const normalized = normalizeUSRentReport(result);
    const text = normalized.hero.summary ?? '';
    // Text must be non-empty (fallback triggered)
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toMatch(/roof|mortgage|comps|offer/i);
  });

  it('hero.summary also sanitizes bottom_line', () => {
    const result = {
      ...baseRentResult(),
      bottom_line:
        'Worth a closer look, but verify roof age, major systems, and comparable sales before offering. Photos show updated kitchen.',
    };

    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.summary).toBeDefined();
    expect(normalized.hero.summary).not.toMatch(/roof age/i);
    expect(normalized.hero.summary).not.toMatch(/comparable sales/i);
    expect(normalized.hero.summary).toMatch(/Photos show updated kitchen/i);
  });

  it('drops what_could_change_decision items whose titles contain sale-flavored phrases', () => {
    const result = {
      ...baseRentResult(),
      what_could_change_decision: [
        {
          title: 'Verify roof age before making an offer',
          why_it_matters: 'Roof replacement is a major capital expense.',
          action: 'Get a roof inspection.',
          evidence: 'Not Disclosed / Cannot Verify',
        },
        {
          title: 'Confirm laundry setup on-site',
          why_it_matters: 'No in-unit laundry means a laundromat run.',
          action: 'Ask the landlord about shared laundry.',
          evidence: 'Confirmed From Listing',
        },
      ],
    };

    const normalized = normalizeUSRentReport(result);
    const wccd = findSection(normalized.sections, 'what-could-change-decision');
    expect(wccd).toBeDefined();
    const text = sectionText(wccd!);
    expect(text).not.toMatch(/roof age/i);
    expect(text).not.toMatch(/offer/i);
    expect(text).toMatch(/laundry/i);
  });

  it('filters next-best-move action items', () => {
    const result = {
      ...baseRentResult(),
      next_best_move: [
        { action: 'Schedule a tour and verify window AC cooling', reason: 'Confirm comfort' },
        { action: 'Make an offer based on recent comps', reason: 'Sale decision' },
      ],
    };

    const normalized = normalizeUSRentReport(result);
    const nbm = findSection(normalized.sections, 'next-best-move');
    expect(nbm).toBeDefined();
    const text = sectionText(nbm!);
    expect(text).not.toMatch(/make an offer/i);
    expect(text).not.toMatch(/comps/i);
    expect(text).toMatch(/window AC/i);
  });

  it('does not false-positive on renter-OK phrases containing roof / foundation substrings', () => {
    const result = {
      ...baseRentResult(),
      bottom_line:
        'Roomy 2-bed with a walk-in closet and bath fan in the hallway. Bath has a window that opens for natural ventilation.',
      quick_summary: 'No roof leak observed in photos; landlord responsible for exterior.',
    };

    const normalized = normalizeUSRentReport(result);
    const text = normalized.hero.summary ?? '';
    expect(text).toMatch(/walk-in closet|bath fan|window that opens|roof leak/i);
  });

  // ── Regression: real production bottom_line (Staten Island 2 Leroy St) ────────
  it('Staten Island regression: hero.summary strips the buyer-flavored sentence', () => {
    const productionBottomLine =
      'Worth a closer look, but verify roof age, major systems, basement permits/egress, and comparable sales before spending serious time. First-floor 2BR, 1BA in a detached house with yard and laundry hookup. Rent and deposit not listed. Confirm AC, fees, and availability.';
    const result = { ...baseRentResult(), bottom_line: productionBottomLine };

    const normalized = normalizeUSRentReport(result);

    expect(normalized.hero.summary).toBeDefined();
    expect(normalized.hero.summary).not.toMatch(/roof age/i);
    expect(normalized.hero.summary).not.toMatch(/comparable sales/i);
    expect(normalized.hero.summary).not.toMatch(/basement permits/i);
    expect(normalized.hero.summary).toMatch(/First-floor 2BR/i);
    expect(normalized.hero.summary).toMatch(/laundry hookup/i);
    expect(normalized.hero.summary).toMatch(/Rent and deposit not listed/i);
    expect(normalized.meta.reportMode).toBe('rent');

    // bottom-line section must NOT exist (removed to prevent duplication)
    const bottomLineSection = findSection(normalized.sections, 'bottom-line');
    expect(bottomLineSection).toBeUndefined();
  });

  // ── Bug 3: Verdict thresholds align with canonical 4-tier mapping ───────────
  // Spec: 80+ = "Enough to Review", 60-79 = "Review With Caution",
  //       40-59 = "Need More Evidence", <40 = "High Uncertainty"
  it('score 72 maps to "Review With Caution" (60-79 bracket)', () => {
    const result = { ...baseRentResult(), overallScore: 72, rental_listing_score: null as unknown };
    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.verdict).toBe('Review With Caution');
    expect(normalized.hero.score).toBe(72);
  });

  it('score 45 maps to "Need More Evidence" (40-59 bracket)', () => {
    const result = { ...baseRentResult(), overallScore: 45, rental_listing_score: null as unknown };
    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.verdict).toBe('Need More Evidence');
  });

  it('score 82 maps to "Enough to Review" (80+ bracket)', () => {
    const result = { ...baseRentResult(), overallScore: 82, rental_listing_score: null as unknown };
    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.verdict).toBe('Enough to Review');
  });

  it('score 30 maps to "High Uncertainty" (<40 bracket)', () => {
    const result = { ...baseRentResult(), overallScore: 30, rental_listing_score: null as unknown };
    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.verdict).toBe('High Uncertainty');
  });

  it('preserves AI verdict when it is a real quality signal (not generic)', () => {
    const result = {
      ...baseRentResult(),
      score: 60,
      rental_listing_score: {
        verdict: 'Well-Maintained Unit',
        reason: 'Recent renovation with updated fixtures.',
      },
    };
    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.verdict).toBe('Well-Maintained Unit');
  });

  // ── P1-3: Photo habitability drops roof/foundation items ─────────────────────
  it('drops roof/foundation "Cant Tell From Photos" items from photo-habitability section', () => {
    const result = {
      ...baseRentResult(),
      photo_habitability_review: {
        unit_specific_evidence: [
          'The kitchen features modern stainless steel appliances.',
          'Photos do not show the condition of the roof or gutters.',
        ],
        missing_views: [
          'Photos do not show the condition of the foundation.',
          'The exterior shows multiple window AC units.',
        ],
      },
    };
    const normalized = normalizeUSRentReport(result);
    const photo = findSection(normalized.sections, 'photo-habitability');
    expect(photo).toBeDefined();
    const text = sectionText(photo!);
    expect(text).not.toMatch(/roof or gutters/i);
    expect(text).not.toMatch(/condition of the foundation/i);
    expect(text).toMatch(/stainless steel appliances/i);
    expect(text).toMatch(/window AC/i);
  });

  it('adds renter-priority defaults when photo-habitability is empty after filtering', () => {
    const result = {
      ...baseRentResult(),
      photo_habitability_review: {
        unit_specific_evidence: [
          'Photos do not show the condition of the roof or gutters.',
          'Photos do not show the condition of the foundation.',
        ],
        missing_views: [],
      },
    };
    const normalized = normalizeUSRentReport(result);
    const photo = findSection(normalized.sections, 'photo-habitability');
    expect(photo).toBeDefined();
    const text = sectionText(photo!);
    expect(text).toMatch(/No interior photos available/i);
    expect(text).toMatch(/heating costs/i);
    expect(text).toMatch(/window seals/i);
  });

  // ── P1-4: Private yard uses listing-accurate statement ────────────────────────
  it('overrides generic yard private/shared confirmation when listing says private yard', () => {
    const result = {
      ...baseRentResult(),
      photo_habitability_review: {
        missing_views: [
          'Confirm if the yard is private or shared.',
          'The exterior shows multiple window AC units.',
        ],
      },
      listingInfo: {
        description: 'Updated 2-bed first-floor apartment with private yard and laundry hookup.',
      },
    };
    const normalized = normalizeUSRentReport(result);
    const photo = findSection(normalized.sections, 'photo-habitability');
    expect(photo).toBeDefined();
    const text = sectionText(photo!);
    expect(text).not.toMatch(/Confirm if the yard is private or shared/i);
    expect(text).toMatch(/listing describes the yard as private/i);
    expect(text).toMatch(/do not prove whether it is exclusively assigned/i);
  });

  // ── Bug 4: broader yard-shared regex ──────────────────────────────────────────
  it('drops yard-shared variants beyond the original "Confirm if" wording', () => {
    const result = {
      ...baseRentResult(),
      photo_habitability_review: {
        missing_views: [
          'Verify whether the yard is shared with neighbors.',
          'Photos do not show whether the yard is shared with other units.',
        ],
        unit_specific_evidence: ['Hardwood floors throughout'],
      },
      listingInfo: {
        description: '2BR with private yard and hardwood floors.',
      },
    };
    const normalized = normalizeUSRentReport(result);
    const photo = findSection(normalized.sections, 'photo-habitability');
    expect(photo).toBeDefined();
    const text = sectionText(photo!);
    expect(text).not.toMatch(/Verify whether the yard is shared/i);
    expect(text).not.toMatch(/shared with other units/i);
    expect(text).toMatch(/listing describes the yard as private/i);
    expect(text).toMatch(/do not prove whether it is exclusively assigned/i);
  });

  // ── Bug 1: photo-habitability fallback gate ─────────────────────────────────
  it('does NOT show "No interior photos" fallback when Step 1 detected interior rooms', () => {
    const result = {
      ...baseRentResult(),
      photo_habitability_review: {
        unit_specific_evidence: [],
        habitability_signals: [],
        missing_views: [],
      },
      // Step 1 saw interior rooms but Step 2 produced no evidence strings.
      spaceAnalysis: { areas: ['kitchen', 'bedroom', 'living_room'] },
    };
    const normalized = normalizeUSRentReport(result);
    const photo = findSection(normalized.sections, 'photo-habitability');
    // Section should be empty / undefined because we don't have any items
    // AND we don't want to show the contradictory fallback.
    if (photo) {
      const text = sectionText(photo);
      expect(text).not.toMatch(/No interior photos available/i);
      expect(text).not.toMatch(/Ask about heating costs/i);
      expect(text).not.toMatch(/Check window seals/i);
    }
    // Either way, the contradicting fallback copy must NEVER appear
    // when Step 1 saw interior rooms.
    expect(JSON.stringify(normalized.sections)).not.toMatch(/No interior photos available/i);
  });

  it('still shows "No interior photos" fallback when ALL three sources are empty', () => {
    const result = {
      ...baseRentResult(),
      photo_habitability_review: {
        unit_specific_evidence: [],
        habitability_signals: [],
        missing_views: [],
      },
      imageUrls: [],
      spaceAnalysis: { areas: [] },
    };
    const normalized = normalizeUSRentReport(result);
    const photo = findSection(normalized.sections, 'photo-habitability');
    expect(photo).toBeDefined();
    const text = sectionText(photo!);
    expect(text).toMatch(/No interior photos available/i);
    expect(text).toMatch(/heating costs/i);
    expect(text).toMatch(/window seals/i);
  });

  // ── Bug 2: bottom-line copy no longer blames the landlord ───────────────────
  it('bottom line says rent is listed when lease data is empty', () => {
    const result = {
      ...baseRentResult(),
      bottom_line: '',
      quick_summary: '',
      rental_snapshot: {
        monthly_rent: '$2,670',
      },
    };
    const normalized = normalizeUSRentReport(result);
    expect(normalized.hero.summary).toMatch(/Monthly rent is listed/i);
    expect(normalized.hero.summary).not.toMatch(/Key lease and payment details not listed/i);
  });
});
