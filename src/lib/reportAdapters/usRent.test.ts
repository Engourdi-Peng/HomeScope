import { describe, it, expect } from 'vitest';
import { normalizeUSRentReport } from './usRent';
import { hasInteriorPhotos } from './interiorPhotos';

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

  // ── Room rental deterministic facts override ─────────────────────────────
  // The backend persists `room_rental_facts` only when
  // effectiveReportMode==='rent' AND structuredListing.classification.objectKind==='room'
  // AND isStructuredListingValid() (from ./reportMode.ts) accepts the payload.
  // When the adapter sees that object it must surface the deterministic fields
  // and replace AI free-text in rental-snapshot / rent-true-cost and Quick Facts.
  //
  // The fixture below mirrors the real schema:
  //   structuredListing.pricing.displayedPrice / baseRent
  //   structuredListing.roomRental.{requiredMonthlyFees, totalMonthlyCost,
  //     listPriceIncludesRequiredMonthlyFees, housemateCount, hasPrivateBath,
  //     roomIsFurnished, allowedPets, atAGlanceFacts, parkingCapacity, parkingFeatures}
  // The adapter must NOT read or surface the obsolete fields
  //   averageMonthlyTotal / parkingSpaces / moveInReady / utilitiesIncluded.
  function baseRoomRentalFacts() {
    return {
      object_kind: 'room' as const,
      advertised_effective_rent: 415,
      required_monthly_fees: 250,
      average_monthly_total: 665,
      fees_included_in_advertised_price: false,
      housemate_count: 4,
      has_private_bath: false,
      furnished: false,
      pet_policy: 'No Pets',
      available_date: 'Available Now',
      lease_term: 'Contact For Details',
      parking_capacity_property_level: 6,
      parking_features: ['Attached', 'Garage', 'Other'],
      parking_allocation_confirmed: false,
    };
  }

  function baseRoomRentResult(): Record<string, unknown> {
    return {
      ...baseRentResult(),
      room_rental_facts: baseRoomRentalFacts(),
      // Intentional AI noise — must NOT surface in Room Quick Facts / Snapshot
      // / True Cost when deterministic facts are present.
      rental_snapshot: {
        monthly_rent: '$2,670',
        security_deposit: 'Not Disclosed / Cannot Verify',
        lease_term: '12 months',
        available_date: 'Now',
        beds: '2',
        baths: '2',
        sqft: '1,200',
        parking: 'Garage included',
        pet_policy: 'Cats allowed',
        building_name: 'Staten Island Towers',
        property_type: 'Apartment',
      },
      rent_fairness: {
        asking_rent: '$2,670',
        verdict: 'Overpriced',
        explanation: 'Market says $1,800/mo for similar units.',
      },
      recurring_monthly_costs: {
        items: [{ name: 'Trash', amount: '15', notes: 'mandatory', evidence: 'Confirmed From Listing' }],
        total_recurring_estimate: '$250',
      },
    };
  }

  function findQuickFacts(report: any): any[] {
    return Array.isArray(report?.quickFacts) ? report.quickFacts : [];
  }

  // A. fees_included_in_advertised_price=false → "additional to"
  it('A. false fee inclusion: true-cost must say "additional to", not "included in"', () => {
    const normalized = normalizeUSRentReport(baseRoomRentResult());
    const tc = findSection(normalized.sections, 'rent-true-cost');
    const text = sectionText(tc!);
    expect(text).toMatch(/Required Monthly Fees/i);
    expect(text).toMatch(/\$250\/mo/);
    expect(text).toMatch(/additional to the advertised effective rent/i);
    expect(text).not.toMatch(/included in the advertised effective rent/i);
  });

  // B. fees_included_in_advertised_price=true → "included in"
  it('B. true fee inclusion: true-cost says "included in"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).fees_included_in_advertised_price = true;
    const normalized = normalizeUSRentReport(result);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    const text = sectionText(tc!);
    expect(text).toMatch(/\$250\/mo/);
    expect(text).toMatch(/included in the advertised effective rent/i);
    expect(text).not.toMatch(/additional to the advertised effective rent/i);
  });

  // C. fees_included_in_advertised_price=null → "inclusion not confirmed"
  it('C. null fee inclusion: true-cost says "inclusion not confirmed"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).fees_included_in_advertised_price = null;
    const normalized = normalizeUSRentReport(result);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    const text = sectionText(tc!);
    expect(text).toMatch(/\$250\/mo/);
    expect(text).toMatch(/whether this is included is not confirmed/i);
    expect(text).not.toMatch(/additional to the advertised effective rent/i);
    expect(text).not.toMatch(/included in the advertised effective rent/i);
  });

  // D. parkingCapacity=6
  it('D. parkingCapacity=6: snapshot shows property-level + allocation not confirmed', () => {
    const normalized = normalizeUSRentReport(baseRoomRentResult());
    const snap = findSection(normalized.sections, 'rental-snapshot');
    const text = sectionText(snap!);
    expect(text).toMatch(/Parking/i);
    expect(text).toMatch(/6 property-level spaces advertised/i);
    expect(text).toMatch(/tenant allocation not confirmed/i);
    // Parking must NOT leak into rent-true-cost.
    const tc = findSection(normalized.sections, 'rent-true-cost');
    expect(sectionText(tc!)).not.toMatch(/property-level spaces advertised/);
  });

  // E. housemateCount=4, furnished=false, hasPrivateBath=false
  it('E. housemateCount=4, furnished=false, hasPrivateBath=false: all rendered correctly', () => {
    const normalized = normalizeUSRentReport(baseRoomRentResult());
    const snap = findSection(normalized.sections, 'rental-snapshot');
    const text = sectionText(snap!);
    expect(text).toMatch(/Housemates/);
    expect(text).toMatch(/Housemates\s*\|\s*4\b/);
    expect(text).toMatch(/Furnished\s*\|\s*No\b/);
    expect(text).toMatch(/Private Bathroom/);
    expect(text).toMatch(/No — sharing arrangement not confirmed/i);
  });

  // F. has_private_bath missing → "Not confirmed", NOT "No"
  it('F. has_private_bath missing: shows "Not confirmed", never "No"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).has_private_bath = null;
    const normalized = normalizeUSRentReport(result);
    const snap = findSection(normalized.sections, 'rental-snapshot');
    const text = sectionText(snap!);
    expect(text).toMatch(/Private Bathroom/);
    expect(text).toMatch(/Not confirmed/);
    expect(text).not.toMatch(/No — sharing arrangement not confirmed/);
    // Quick Facts path also.
    const qfs = findQuickFacts(normalized);
    const bathFact = qfs.find((f) => f.label === 'Private Bathroom');
    expect(bathFact?.value).toBe('Not confirmed');
  });

  // Same null-preservation for furnished.
  it('F. furnished missing: shows "Not confirmed", never "No"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).furnished = null;
    const normalized = normalizeUSRentReport(result);
    const qfs = findQuickFacts(normalized);
    const fact = qfs.find((f) => f.label === 'Furnished');
    expect(fact?.value).toBe('Not confirmed');
    const snap = findSection(normalized.sections, 'rental-snapshot');
    expect(sectionText(snap!)).toMatch(/Furnished\s*\|\s*Not confirmed/);
  });

  // G. Room Quick Facts must NOT mix AI snapshot fields.
  it('G. room Quick Facts: never reads AI Apartment/Cats allowed/12 months/Sqft', () => {
    const normalized = normalizeUSRentReport(baseRoomRentResult());
    const qfs = findQuickFacts(normalized);
    const labels = qfs.map((f) => f.label);
    // Required room Quick Facts.
    expect(labels).toContain('Listing Type');
    expect(labels).toContain('Advertised Effective Rent');
    expect(labels).toContain('Housemates');
    expect(labels).toContain('Private Bathroom');
    expect(labels).toContain('Furnished');
    expect(labels).toContain('Pet Policy');
    expect(labels).toContain('Available');
    expect(labels).toContain('Lease Term');
    expect(labels).toContain('Parking');
    // Forbidden labels — adapter must not import from AI snapshot.
    expect(labels).not.toContain('Security Deposit');
    expect(labels).not.toContain('Beds');
    expect(labels).not.toContain('Baths');
    expect(labels).not.toContain('Sqft');
    expect(labels).not.toContain('Property Type');
    expect(labels).not.toContain('Heating/Cooling');
    expect(labels).not.toContain('Laundry');
    expect(labels).not.toContain('Utilities Included');
    expect(labels).not.toContain('Monthly Rent');
    // Forbidden values from the AI rental_snapshot fixture.
    const blob = JSON.stringify(qfs);
    expect(blob).not.toMatch(/Apartment/);
    expect(blob).not.toMatch(/Cats allowed/);
    expect(blob).not.toMatch(/12 months/);
    expect(blob).not.toMatch(/1,200/);
    expect(blob).not.toMatch(/2,670/);
    expect(blob).not.toMatch(/Garage included/);
  });

  // H. totalMonthlyCost=665 with fees_included=false → "advertised effective rent plus required monthly fees"
  it('H. totalMonthlyCost=665 + fees_included=false: plus required monthly fees copy', () => {
    const normalized = normalizeUSRentReport(baseRoomRentResult());
    const tc = findSection(normalized.sections, 'rent-true-cost');
    const text = sectionText(tc!);
    expect(text).toMatch(/Average Monthly Total/i);
    expect(text).toMatch(/\$665\/mo/);
    expect(text).toMatch(/advertised effective rent plus required monthly fees/i);
    expect(text).not.toMatch(/required monthly fees included in the advertised effective rent/i);
    expect(text).not.toMatch(/fee inclusion is not confirmed/i);
  });

  // I. totalMonthlyCost missing → only compute when both rent and fees are finite.
  // Adapter is NOT responsible for math; it only reads average_monthly_total
  // verbatim. The "compute on the fly" rule lives in the backend.
  // Here we verify the adapter omits the row when total is null.
  it('I. average_monthly_total=null in payload: adapter omits Average Monthly Total row', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).average_monthly_total = null;
    const normalized = normalizeUSRentReport(result);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    expect(sectionText(tc!)).not.toMatch(/Average Monthly Total/i);
  });

  it('I. average_monthly_total=665 in payload: adapter renders Average Monthly Total = $665', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).average_monthly_total = 665;
    const normalized = normalizeUSRentReport(result);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    const text = sectionText(tc!);
    expect(text).toMatch(/Average Monthly Total/i);
    expect(text).toMatch(/\$665\/mo/);
    expect(text).toMatch(/advertised effective rent plus required monthly fees/i);
  });

  it('I. advertised_effective_rent missing: no Average Monthly Total row in adapter', () => {
    const result = baseRoomRentResult();
    const facts = (result.room_rental_facts as any);
    facts.average_monthly_total = null;
    facts.advertised_effective_rent = null;
    const normalized = normalizeUSRentReport(result);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    expect(sectionText(tc!)).not.toMatch(/Average Monthly Total/i);
  });

  it('I. required_monthly_fees missing: no Average Monthly Total row in adapter', () => {
    const result = baseRoomRentResult();
    const facts = (result.room_rental_facts as any);
    facts.average_monthly_total = null;
    facts.required_monthly_fees = null;
    const normalized = normalizeUSRentReport(result);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    expect(sectionText(tc!)).not.toMatch(/Average Monthly Total/i);
  });

  // J. non-room apartment regression.
  it('J. non-room apartment: adapter uses AI rental_snapshot and rent_fairness, untouched', () => {
    const result = baseRentResult();
    const normalized = normalizeUSRentReport(result);
    const snap = findSection(normalized.sections, 'rental-snapshot');
    expect(snap).toBeDefined();
    expect(sectionText(snap!)).toMatch(/Monthly Rent/i);
    expect(sectionText(snap!)).toMatch(/\$2,670/);
    expect(sectionText(snap!)).not.toMatch(/Listing Type\s*\|\s*Room Rental/);
    expect(sectionText(snap!)).not.toMatch(/Advertised Effective Rent/);
    const tc = findSection(normalized.sections, 'rent-true-cost');
    expect(sectionText(tc!)).toMatch(/Asking Rent/i);
    expect(sectionText(tc!)).not.toMatch(/Required Monthly Fees/);
    expect(sectionText(tc!)).not.toMatch(/Average Monthly Total/);
    expect(sectionText(tc!)).not.toMatch(/Regular Rent After Promotion/);
    expect(sectionText(tc!)).not.toMatch(/Fee Treatment During Free Months/);
    // Quick Facts for apartment still includes the AI fields.
    const qfs = findQuickFacts(normalized);
    expect(qfs.find((f) => f.label === 'Monthly Rent')).toBeDefined();
    expect(qfs.find((f) => f.label === 'Listing Type')).toBeUndefined();
  });

  // ── Average Monthly Total three-state copy contract ──────────────────────
  // A. fees_included=false + total supplied → "advertised effective rent plus required monthly fees"
  it('Average Total copy A: fees_included=false → "advertised effective rent plus required monthly fees"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).fees_included_in_advertised_price = false;
    (result.room_rental_facts as any).average_monthly_total = 665;
    const normalized = normalizeUSRentReport(result);
    const text = sectionText(findSection(normalized.sections, 'rent-true-cost')!);
    expect(text).toMatch(/Average Monthly Total\s*\|\s*\$665\/mo\s*—\s*advertised effective rent plus required monthly fees/i);
    expect(text).not.toMatch(/required monthly fees included in the advertised effective rent/i);
    expect(text).not.toMatch(/fee inclusion is not confirmed/i);
  });

  // B. fees_included=true + total supplied → "required monthly fees included in the advertised effective rent"
  it('Average Total copy B: fees_included=true → "required monthly fees included in the advertised effective rent"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).fees_included_in_advertised_price = true;
    // Per backend rule 2: total == advertised_effective_rent when totalMonthlyCost
    // is missing and fees are included. The fixture mirrors the persisted state
    // so we pass the rent-only value here (the adapter doesn't double-check).
    (result.room_rental_facts as any).average_monthly_total = 415;
    const normalized = normalizeUSRentReport(result);
    const text = sectionText(findSection(normalized.sections, 'rent-true-cost')!);
    expect(text).toMatch(/Average Monthly Total\s*\|\s*\$415\/mo\s*—\s*required monthly fees included in the advertised effective rent/i);
    expect(text).not.toMatch(/plus required monthly fees/i);
    expect(text).not.toMatch(/fee inclusion is not confirmed/i);
  });

  // C. fees_included=null + total supplied → "fee inclusion is not confirmed"
  it('Average Total copy C: fees_included=null → "fee inclusion is not confirmed"', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).fees_included_in_advertised_price = null;
    (result.room_rental_facts as any).average_monthly_total = 665;
    const normalized = normalizeUSRentReport(result);
    const text = sectionText(findSection(normalized.sections, 'rent-true-cost')!);
    expect(text).toMatch(/Average Monthly Total\s*\|\s*\$665\/mo\s*—\s*fee inclusion is not confirmed/i);
    expect(text).not.toMatch(/advertised effective rent plus required monthly fees/i);
    expect(text).not.toMatch(/required monthly fees included in the advertised effective rent/i);
  });

  // D. average_monthly_total=null → no Average Monthly Total row.
  it('Average Total copy D: average_monthly_total=null → no Average Monthly Total row', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).average_monthly_total = null;
    const normalized = normalizeUSRentReport(result);
    const text = sectionText(findSection(normalized.sections, 'rent-true-cost')!);
    expect(text).not.toMatch(/Average Monthly Total/i);
  });

  // K. promotionText still isolated.
  it('K. promotionText: never reads or derives regular paid-month rent', () => {
    const result = {
      ...baseRoomRentResult(),
      promotionText: '$332/mo for the first 3 months, then $525/mo regular',
      description: 'Special promotion: first 3 months at $332',
      rent_fairness: {
        asking_rent: '$2,670',
        verdict: 'Overpriced',
        explanation: 'Market says $1,800/mo for similar units.',
      },
    } as Record<string, unknown>;
    const normalized = normalizeUSRentReport(result);
    const tcText = sectionText(findSection(normalized.sections, 'rent-true-cost')!);
    const snapText = sectionText(findSection(normalized.sections, 'rental-snapshot')!);
    const qfsBlob = JSON.stringify(findQuickFacts(normalized));
    // Forbidden values from promotion / description / AI noise.
    expect(tcText).not.toMatch(/\$332/);
    expect(tcText).not.toMatch(/\$525/);
    // The seeded promotionText "first 3 months at $332" must not appear.
    expect(tcText).not.toMatch(/first 3 months/i);
    expect(tcText).not.toMatch(/Special promotion/i);
    expect(tcText).not.toMatch(/\$2,670/);
    expect(tcText).not.toMatch(/Overpriced/);
    expect(tcText).not.toMatch(/Market says/);
    expect(snapText).not.toMatch(/\$332/);
    expect(snapText).not.toMatch(/\$525/);
    expect(snapText).not.toMatch(/\$2,670/);
    expect(qfsBlob).not.toMatch(/\$332/);
    expect(qfsBlob).not.toMatch(/\$525/);
    // Deterministic fields still anchor.
    expect(tcText).toMatch(/Advertised Effective Rent/i);
    expect(tcText).toMatch(/\$415\/mo/);
    expect(tcText).toMatch(/Average Monthly Total/i);
    expect(tcText).toMatch(/\$665\/mo/);
    expect(tcText).toMatch(/advertised effective rent plus required monthly fees/i);
    expect(tcText).toMatch(/Regular Rent After Promotion/i);
    expect(tcText).toMatch(/Not captured in structured data/i);
    expect(tcText).toMatch(/Fee Treatment During Free Months/i);
    expect(tcText).toMatch(/Not confirmed/);
  });

  // ── contract: obsolete keys are never read even if present in payload ──
  it('contract: ignores obsolete averageMonthlyTotal / parkingSpaces / moveInReady / utilitiesIncluded', () => {
    const result = baseRoomRentResult();
    // Plant legacy fields that must NOT be used.
    (result.room_rental_facts as any).averageMonthlyTotal = 9999;
    (result.room_rental_facts as any).parkingSpaces = 999;
    (result.room_rental_facts as any).moveInReady = true;
    (result.room_rental_facts as any).utilitiesIncluded = ['Water'];
    const normalized = normalizeUSRentReport(result);
    const tcText = sectionText(findSection(normalized.sections, 'rent-true-cost')!);
    const snapText = sectionText(findSection(normalized.sections, 'rental-snapshot')!);
    expect(tcText).not.toMatch(/\$9,999/);
    expect(tcText).not.toMatch(/999 property-level spaces/);
    expect(snapText).not.toMatch(/Move-In Ready/i);
    expect(snapText).not.toMatch(/Water/);
    // Genuine values still anchor.
    expect(tcText).toMatch(/\$665\/mo/);
    expect(snapText).toMatch(/6 property-level spaces advertised/);
  });

  // ── contract: parking not duplicated in rent-true-cost ────────────────────
  it('contract: rent-true-cost for room rentals does not duplicate parking', () => {
    const normalized = normalizeUSRentReport(baseRoomRentResult());
    const tc = findSection(normalized.sections, 'rent-true-cost');
    const titles = (tc!.items ?? []).map((i: any) => i.title);
    expect(titles).not.toContain('Parking');
  });

  // ── contract: parking_allocation_confirmed is fixed to false ──────────────
  it('contract: parking_allocation_confirmed is fixed to false in payload', () => {
    const result = baseRoomRentResult();
    (result.room_rental_facts as any).parking_allocation_confirmed = true;
    const normalized = normalizeUSRentReport(result);
    const snapText = sectionText(findSection(normalized.sections, 'rental-snapshot')!);
    expect(snapText).toMatch(/tenant allocation not confirmed/i);
    expect(snapText).not.toMatch(/tenant allocated/i);
  });
});

describe('hasInteriorPhotos — area normalization', () => {
  it('A. object array with area field — living_room / kitchen / bedroom → true', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [
          { area: 'living_room', confidence: 'Medium', photoCount: 1 },
          { area: 'kitchen' },
          { area: 'bedroom' },
        ],
      },
    });
    expect(result).toBe(true);
  });

  it('B. string array — ["bathroom"] → true', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: ['bathroom'],
      },
    });
    expect(result).toBe(true);
  });

  it('C. object array with only exterior / yard / roof → false', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [
          { area: 'exterior' },
          { area: 'yard' },
          { area: 'roof' },
        ],
      },
    });
    expect(result).toBe(false);
  });

  it('D. description text mentions "kitchen" but area is exterior → false (no false positive)', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [
          {
            area: 'exterior',
            description: 'Kitchen window visible from outside',
            concerns: ['kitchen sink not visible'],
          },
        ],
      },
    });
    expect(result).toBe(false);
  });

  it('E. imageUrls present (no other sources) → true', () => {
    const result = hasInteriorPhotos({
      imageUrls: ['https://example.com/photo.webp'],
    });
    expect(result).toBe(true);
  });

  it('underscore area "living_room" is normalized to "living room"', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [{ area: 'living_room' }],
      },
    });
    expect(result).toBe(true);
  });

  it('hyphen area "dining-room" is normalized to "dining room"', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [{ area: 'dining-room' }],
      },
    });
    expect(result).toBe(true);
  });

  it('object with name field (no area field) is recognized', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [{ name: 'kitchen' }],
      },
    });
    expect(result).toBe(true);
  });

  it('object with label field (no area/name field) is recognized', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [{ label: 'bedroom' }],
      },
    });
    expect(result).toBe(true);
  });

  it('object with type field (no area/name/label field) is recognized', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [{ type: 'bathroom' }],
      },
    });
    expect(result).toBe(true);
  });

  it('object without any area/name/label/type field is treated as empty', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [{ description: 'something' }],
      },
      imageUrls: [],
    });
    expect(result).toBe(false);
  });

  it('no sources at all → false', () => {
    expect(hasInteriorPhotos({})).toBe(false);
  });

  it('null / undefined area entries are tolerated', () => {
    const result = hasInteriorPhotos({
      photoReview: {
        areas: [null, undefined, { area: 'kitchen' }],
      },
    });
    expect(result).toBe(true);
  });
});
