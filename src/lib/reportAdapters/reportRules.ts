export type EvidenceType =
  | 'listing_stated'
  | 'photo_observed'
  | 'inferred_needs_verification'
  | 'missing_data';

export type BuyerReportMode =
  | 'single_family_owner_occupier'
  | 'multi_family_income'
  | 'condo_hoa'
  | 'coop_board'
  | 'townhouse'
  | 'land_or_development'
  | 'new_construction'
  | 'unknown';

import type {
  PropertyIntelligenceProfile,
  PropertyIntelligenceCategory,
  OwnershipModel,
  BuyerUseCase,
  ProfileConfidence,
} from './types';
import type { BuyerReportMode, EvidenceType } from './types';

export interface EvidenceMeta {
  evidenceType: EvidenceType;
  sourceSignal: string;
  whyItMatters: string;
  whatToVerify: string;
}

export interface StructuredRiskTrigger {
  key: string;
  label: string;
  triggered: boolean;
  sourceSignals: string[];
  evidenceType: EvidenceType;
  allowedClaims: string[];
  forbiddenClaims: string[];
  requiredQuestions: string[];
  requiredCopyPatterns: string[];
}

export interface PhotoAreaRiskSummary {
  area: string;
  score: number;
  visible_condition: string;
  possible_concerns: string[];
  photos_do_not_prove: string[];
  ask_before_viewing: string;
  evidence?: EvidenceMeta[];
}

export interface VerifiedFactsShape {
  address: string | null;
  price: number | null;
  price_display?: string | null;
  beds: number | null;
  baths: number | null;
  fullBaths?: number | null;
  halfBaths?: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  propertySubtype?: string | null;
  lotSize?: number | null;
  lotSize_display?: string | null;
  heating?: string | null;
  cooling?: string | null;
  basement?: string | null;
  garage?: string | null;
  parking?: string | null;
  annualTax: number | null;
  annualTax_display?: string | null;
  monthlyPayment: number | null;
  monthlyPayment_display?: string | null;
  monthlyTax?: number | null;
  insurance?: number | null;
  insurance_display?: string | null;
  hoa: 'yes' | 'no' | 'unknown';
  hoaAmount?: number | null;
  pricePerSqft: number | null;
  pricePerSqft_display?: string | null;
  daysOnMarket: number | null;
  floodZone?: string | null;
  schoolRatings?: string | null;
  region?: string | null;
  sourceDomain?: string | null;
  reportProfile?: string;
  normalizedPropertyCategory?: string;
  buyerReportMode?: BuyerReportMode;
  sourceFieldKeys?: string[];
  missingFactKeys?: string[];
  fieldEvidence?: Record<string, unknown> | null;
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyBuyerReportMode(input: {
  normalizedPropertyCategory?: string | null;
  propertyType?: string | null;
  propertySubtype?: string | null;
  yearBuilt?: number | null;
  listingText?: string | null;
}): BuyerReportMode {
  const normalizedCategory = String(input.normalizedPropertyCategory ?? '').toLowerCase();
  const propertyType = String(input.propertyType ?? '').toLowerCase();
  const propertySubtype = String(input.propertySubtype ?? '').toLowerCase();
  const listingText = String(input.listingText ?? '').toLowerCase();
  const yearBuilt = typeof input.yearBuilt === 'number' ? input.yearBuilt : null;

  const combined = [normalizedCategory, propertyType, propertySubtype, listingText].join(' ');
  const isNewConstruction = includesAny(combined, [/new construction/, /newly built/, /to be built/, /spec home/, /builder warranty/])
    || (yearBuilt != null && yearBuilt >= new Date().getFullYear() - 1 && includesAny(combined, [/new/, /construction/, /builder/]));
  if (isNewConstruction) return 'new_construction';
  if (/co_op|coop|co-op/.test(combined)) return 'coop_board';
  if (/condo/.test(combined)) return 'condo_hoa';
  if (/townhouse|townhome|rowhouse/.test(combined)) return 'townhouse';
  if (/land|lot|vacant|development/.test(combined)) return 'land_or_development';
  if (/multi_family|multi-family|duplex|triplex|fourplex|2-family|two-family|legal 2 family|income unit/.test(combined)) {
    return 'multi_family_income';
  }
  if (/single_family|single family|single-family|house/.test(combined)) return 'single_family_owner_occupier';
  return 'unknown';
}

function buildTrigger(args: Omit<StructuredRiskTrigger, 'triggered'> & { triggered?: boolean }): StructuredRiskTrigger {
  return {
    triggered: Boolean(args.triggered),
    ...args,
  };
}

export function buildRiskTriggers(input: {
  verifiedFacts: Partial<VerifiedFactsShape>;
  buyerReportMode: BuyerReportMode;
  listingText?: string | null;
  topConcerns?: string[];
  detectedAreas?: string[];
}): StructuredRiskTrigger[] {
  const verifiedFacts = input.verifiedFacts ?? {};
  const listingText = String(input.listingText ?? '').toLowerCase();
  const heating = String(verifiedFacts.heating ?? '').toLowerCase();
  const basement = String(verifiedFacts.basement ?? '').toLowerCase();
  const floodZone = String(verifiedFacts.floodZone ?? '').trim();
  const region = String(verifiedFacts.region ?? '').toLowerCase();
  const propertyType = String(verifiedFacts.propertyType ?? '').toLowerCase();
  const topConcerns = (input.topConcerns ?? []).map((item) => String(item).toLowerCase());
  const detectedAreas = (input.detectedAreas ?? []).map((item) => String(item).toLowerCase());
  const yearBuilt = typeof verifiedFacts.yearBuilt === 'number' ? verifiedFacts.yearBuilt : null;
  const pricePerSqft = typeof verifiedFacts.pricePerSqft === 'number' ? verifiedFacts.pricePerSqft : null;

  const basementVisualSignal = [...topConcerns, ...detectedAreas].some((value) =>
    /basement|lower level|drop ceiling|wood panel|below-grade|storage/.test(value),
  );
  const datedConditionSignal = [...topConcerns, ...detectedAreas, listingText].some((value) =>
    /dated|older bathroom|older fixtures|small interior|needs updating|original condition|worn/.test(value),
  );
  const coastalOrFloodSensitiveRegion = /coast|beach|bay|shore|island|waterfront|flood|hurricane|storm|river|canal/.test(region);
  const buildOutSignal = /build out|extension|expansion|potential|adu|add value|develop|convert/.test(listingText);
  const olderHome = yearBuilt != null && yearBuilt <= new Date().getFullYear() - 40;
  const condoOrCoop = input.buyerReportMode === 'condo_hoa' || input.buyerReportMode === 'coop_board' || /condo|co-op|coop|apartment/.test(propertyType);

  return [
    buildTrigger({
      key: 'oilHeating',
      label: 'Oil Heating Verification',
      triggered: heating.includes('oil'),
      sourceSignals: [String(verifiedFacts.heating ?? '')].filter(Boolean),
      evidenceType: 'listing_stated',
      allowedClaims: [
        'verify oil heating system age',
        'verify service records',
        'verify oil tank location',
        'verify tank age and condition',
        'verify whether any tank was removed or abandoned',
      ],
      forbiddenClaims: ['underground tank', 'contamination', 'leak', 'removal cost'],
      requiredQuestions: [
        'What type of oil heating equipment is installed, and how old is it?',
        'Where is the oil tank located, and are service or abandonment records available?',
      ],
      requiredCopyPatterns: ['needs verification', 'not confirmed'],
    }),
    buildTrigger({
      key: 'basementPresent',
      label: 'Basement / Lower Level Verification',
      triggered: Boolean(basement) || basementVisualSignal,
      sourceSignals: [String(verifiedFacts.basement ?? ''), ...detectedAreas.filter((value) => /basement|lower level|storage/.test(value))].filter(Boolean),
      evidenceType: basement ? 'listing_stated' : 'photo_observed',
      allowedClaims: [
        'verify moisture history',
        'verify drainage',
        'verify egress',
        'verify ceiling height',
        'verify permitted use',
        'verify whether finished area is included in legal sqft',
      ],
      forbiddenClaims: ['illegal basement', 'water damage', 'not permitted'],
      requiredQuestions: [
        'Has the basement or lower level had moisture, drainage, or water intrusion issues?',
        'Is any finished lower-level area included in legal square footage and permitted for its current use?',
      ],
      requiredCopyPatterns: ['photos do not prove', 'verify before relying on this assumption'],
    }),
    buildTrigger({
      key: 'buildOutMarketing',
      label: 'Expansion Marketing Claim Verification',
      triggered: buildOutSignal,
      sourceSignals: [listingText].filter(Boolean),
      evidenceType: 'listing_stated',
      allowedClaims: [
        'verify zoning',
        'verify setbacks',
        'verify FAR',
        'verify permit history',
        'verify Certificate of Occupancy',
        'verify whether expansion is actually feasible',
      ],
      forbiddenClaims: ['expansion is allowed', 'can legally expand'],
      requiredQuestions: [
        'What zoning, setback, and FAR limits apply to the build-out claim?',
        'Has any prior expansion, conversion, or ADU work been permitted or approved?',
      ],
      requiredCopyPatterns: ['listing does not provide enough evidence', 'needs verification'],
    }),
    buildTrigger({
      key: 'highPricePerSqftWithDatedCondition',
      label: 'High Price Per Sqft Needs Comps',
      triggered: Boolean(pricePerSqft && pricePerSqft >= 700 && datedConditionSignal),
      sourceSignals: [verifiedFacts.pricePerSqft_display ?? String(pricePerSqft ?? ''), ...topConcerns].filter(Boolean) as string[],
      evidenceType: 'inferred_needs_verification',
      allowedClaims: [
        'needs comparable sales support',
        'verify similar sales by property type, lot size, condition, school zone, and exact location',
      ],
      forbiddenClaims: ['overpriced', 'price is too high'],
      requiredQuestions: [
        'Can you provide recent comparable sales for similar size, condition, and school zone?',
      ],
      requiredCopyPatterns: ['price confidence is limited', 'needs comps'],
    }),
    buildTrigger({
      key: 'floodZoneKnown',
      label: 'Flood Zone Known',
      triggered: Boolean(floodZone),
      sourceSignals: [floodZone].filter(Boolean),
      evidenceType: 'listing_stated',
      allowedClaims: [
        'use the exact flood zone',
        'generally lower FEMA flood risk when Zone X or minimal risk is stated',
        'verify drainage, basement water history, flood insurance requirement, and local storm exposure',
      ],
      forbiddenClaims: ['flood status unknown', 'listing does not state flood status'],
      requiredQuestions: [
        'What flood insurance, drainage, and water intrusion history should be independently verified for this flood zone?',
      ],
      requiredCopyPatterns: ['verify independently'],
    }),
    buildTrigger({
      key: 'floodZoneMissingButRegionSensitive',
      label: 'Flood Zone Missing In Sensitive Region',
      triggered: !floodZone && coastalOrFloodSensitiveRegion,
      sourceSignals: [region].filter(Boolean),
      evidenceType: 'missing_data',
      allowedClaims: [
        'flood status is not confirmed from the listing',
        'verify FEMA maps, local flood maps, insurance quotes, and water intrusion history',
      ],
      forbiddenClaims: ['minimal flood risk confirmed'],
      requiredQuestions: [
        'Is this address in a FEMA or local flood overlay zone, and what insurance quote applies?',
      ],
      requiredCopyPatterns: ['not confirmed', 'listing does not provide enough evidence'],
    }),
    buildTrigger({
      key: 'olderHome',
      label: 'Older Home System Age Verification',
      triggered: olderHome,
      sourceSignals: [String(yearBuilt ?? '')].filter(Boolean),
      evidenceType: 'listing_stated',
      allowedClaims: [
        'verify roof age',
        'verify electrical panel',
        'verify plumbing material and age',
        'verify heating / cooling age',
        'verify permits for renovations',
        'verify insulation / windows where relevant',
      ],
      forbiddenClaims: ['systems are severely aged', 'needs major rehab'],
      requiredQuestions: [
        'How old are the roof, electrical panel, plumbing material, and heating/cooling systems?',
      ],
      requiredCopyPatterns: ['system age should be verified'],
    }),
    buildTrigger({
      key: 'condoOrCoopHoa',
      label: 'HOA / Co-op Governance Verification',
      triggered: condoOrCoop,
      sourceSignals: [propertyType, input.buyerReportMode].filter(Boolean),
      evidenceType: 'listing_stated',
      allowedClaims: [
        'verify HOA or maintenance fee',
        'verify reserves',
        'verify special assessments',
        'verify master insurance',
        'verify rental restrictions',
        'verify litigation',
        'verify owner-occupancy ratio',
        'verify board approval',
      ],
      forbiddenClaims: ['generic HOA questions for non-HOA single-family homes'],
      requiredQuestions: [
        'What are the reserves, assessments, rental rules, and board or association approval requirements?',
      ],
      requiredCopyPatterns: ['verify independently'],
    }),
  ];
}

// ── Property Intelligence Profile Builder ─────────────────────────────────────

export interface BuildProfileInput {
  normalizedPropertyCategory?: string | null;
  propertyType?: string | null;
  propertySubtype?: string | null;
  homeType?: string | null;
  listingText?: string | null;
  yearBuilt?: number | null;
  pricePerSqft?: number | null;
  daysOnMarket?: number | null;
  hoaAmount?: number | null;
  taxHistory?: string | null;
  zestimateAvailable?: boolean;
}

const PROPERTY_CATEGORY_PATTERNS: Array<[PropertyIntelligenceCategory, RegExp]> = [
  ['co_op',        /co_op|coop|co-op|stock cooperative/],
  ['condo',        /condo|condominium|condop/],
  ['multi_family', /multi_family|multi-family|duplex|triplex|2-family|2 family|legal 2 family|income unit/],
  ['townhouse',    /townhouse|townhome|rowhouse|row house/],
  ['land',         /land|lot|vacant|development site|acreage/],
  ['manufactured',  /manufactured|mobile home|double-wide|trailer/],
  ['single_family',/single family|house|detached|single-family/],
];

function detectPropertyCategory(input: BuildProfileInput): PropertyIntelligenceCategory {
  const fields = [
    input.normalizedPropertyCategory,
    input.propertyType,
    input.propertySubtype,
    input.homeType,
  ].map(f => (f ?? '').toLowerCase());

  for (const [category, pattern] of PROPERTY_CATEGORY_PATTERNS) {
    if (fields.some(f => pattern.test(f))) return category;
  }

  const text = (input.listingText ?? '').toLowerCase();
  for (const [category, pattern] of PROPERTY_CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }

  return 'unknown';
}

function detectOwnershipModel(category: PropertyIntelligenceCategory): OwnershipModel {
  if (category === 'co_op') return 'cooperative';
  if (category === 'condo') return 'condominium';
  if (category !== 'unknown') return 'fee_simple';
  return 'unknown';
}

const DECISION_AXIS: Record<PropertyIntelligenceCategory, string[]> = {
  co_op: [
    'Board approval requirements and timeline',
    'Monthly maintenance: total cost, what it includes, and any planned increases',
    'Subletting rules and owner-occupancy requirements',
    'Transfer/flip tax and acquisition fees if applicable',
    'Building financial health: reserves, assessments, and capital expenditure plan',
    'Financing restrictions and minimum down payment',
  ],
  condo: [
    'HOA common charges and what they cover',
    'Reserve fund balance and any pending special assessments',
    'Rental restrictions, pet policies, and owner-occupancy ratio',
    'Master insurance coverage and unit-owner insurance requirements',
    'Litigation or pending legal issues with the HOA',
  ],
  multi_family: [
    'Certificate of Occupancy: legal unit count and approved use for each unit',
    'Current rent roll: actual rents, lease terms, and tenant status',
    'Separate metering for utilities',
    'Open violations: DOB, HPD, ECB, fire department',
    'Rent stabilization or rent control status',
    'Cap rate and NOI based on actual (not estimated) rents',
  ],
  single_family: [
    'Roof, HVAC, electrical, and plumbing age and condition',
    'Basement: permits, egress, legal use, and moisture history',
    'Comparable sales for price confidence',
    'Drainage, grading, and flood zone',
  ],
  townhouse: [
    'HOA fees, what they cover, and exterior maintenance responsibility',
    'HOA reserves, special assessments, and rules',
    'Parking arrangements and deeded vs. rented spots',
    'Comparable sales for price confidence',
  ],
  land: [
    'Zoning: permitted uses, setbacks, FAR limits',
    'Utilities: water, sewer, gas, electric at lot line',
    'Flood zone and insurance requirements',
    'Survey: easements, encroachments, lot dimensions',
  ],
  manufactured: [
    'Land ownership: own the lot or rent in a park',
    'Park rules, age restrictions, and pet policies',
    'Financing options and title verification (HUD tag)',
    'Foundation, anchoring, and skirting condition',
  ],
  unknown: [],
};

const IRRELEVANT_RISKS: Record<PropertyIntelligenceCategory, string[]> = {
  co_op:        ['roof age', 'hvac age', 'electrical panel', 'plumbing material', 'boiler age', 'furnace age', 'heating system'],
  condo:        ['roof age', 'hvac age', 'electrical panel', 'plumbing material', 'boiler age', 'furnace age', 'heating system'],
  multi_family: ['roof age', 'hvac age', 'electrical panel'],
  single_family: [],
  townhouse:    ['roof age'],
  land:         ['roof', 'hvac', 'electrical', 'plumbing', 'basement', 'boiler', 'furnace', 'heating'],
  manufactured: ['roof', 'hvac', 'electrical', 'plumbing', 'basement', 'boiler', 'furnace', 'heating'],
  unknown:      [],
};

function extractDecisiveSignals(text: string, category: PropertyIntelligenceCategory): string[] {
  const signals: string[] = [];
  // Normalize: treat hyphens as spaces so "walk-in" matches "walk in"
  const lower = text.toLowerCase().replace(/-/g, ' ');

  if (category === 'co_op') {
    const coopKeywords = [
      ['subletting prohibited', 'no subletting', 'sublet not allowed'],
      ['board approval', 'board package', 'board interview'],
      ['flip tax', 'transfer fee', 'acquisition fee'],
      ['maintenance includes', 'maintenance covers'],
      ['share certificate'],
      ['parking waitlist', 'no parking'],
      ['no pets', 'pet policy'],
    ];
    for (const [primary, ...aliases] of coopKeywords) {
      const all = [primary, ...aliases];
      if (all.some(k => lower.includes(k))) signals.push(primary);
    }
  }

  if (category === 'condo') {
    const condoKeywords = [
      ['hoa fee', 'monthly hoa', 'association fee'],
      ['flip tax', 'transfer fee'],
      ['rental restriction', 'no rentals', 'rentals not allowed'],
      ['pet policy', 'no pets'],
      ['litigation', 'pending lawsuit'],
      ['reserve fund', 'underfunded reserves'],
    ];
    for (const [primary, ...aliases] of condoKeywords) {
      const all = [primary, ...aliases];
      if (all.some(k => lower.includes(k))) signals.push(primary);
    }
  }

  if (category === 'multi_family') {
    const mfKeywords = [
      ['legal 2 family', 'legal two family'],
      ['walk in apartment', 'walkin apartment'],
      ['mother daughter'],
      ['separate entrance', 'separate street entrance'],
      ['income unit'],
      ['rent stabilized', 'rent controlled'],
    ];
    for (const [primary, ...aliases] of mfKeywords) {
      const all = [primary, ...aliases];
      if (all.some(k => lower.includes(k))) signals.push(primary);
    }
  }

  return signals;
}

function computeProfileConfidence(
  input: BuildProfileInput,
  category: PropertyIntelligenceCategory,
  signalCount: number,
): ProfileConfidence {
  if (
    category !== 'unknown' &&
    signalCount >= 2 &&
    (input.zestimateAvailable || input.taxHistory)
  ) {
    return 'high';
  }
  if (category !== 'unknown' && (input.propertyType || signalCount >= 1)) {
    return 'medium';
  }
  return 'low';
}

/**
 * Build a PropertyIntelligenceProfile from listing facts.
 * This function is called in the backend BEFORE the LLM generates the Basic report,
 * so the profile can be injected into the prompt and used for guardrails.
 *
 * Usage in backend:
 *   const profile = buildPropertyIntelligenceProfile({
 *     normalizedPropertyCategory: opts.normalizedPropertyCategory,
 *     propertyType: opts.propertyType,
 *     propertySubtype: opts.propertySubtype,
 *     homeType: opts.homeType,
 *     listingText: description,
 *     yearBuilt: opts.yearBuilt,
 *     pricePerSqft: opts.pricePerSqft,
 *     daysOnMarket: opts.daysOnMarket,
 *     hoaAmount: opts.hoaFee,
 *     taxHistory: opts.taxHistory,
 *     zestimateAvailable: Boolean(zillowFinancials?.zestimate),
 *   });
 */
export function buildPropertyIntelligenceProfile(input: BuildProfileInput): PropertyIntelligenceProfile {
  const category = detectPropertyCategory(input);
  const ownershipModel = detectOwnershipModel(category);
  const listingText = input.listingText ?? '';
  const signals = extractDecisiveSignals(listingText, category);
  const irrelevantRisks = IRRELEVANT_RISKS[category];

  // Infer buyer use case from listing signals and property type
  let likelyBuyerUseCase: BuyerUseCase = 'unknown';
  if (category === 'multi_family') {
    likelyBuyerUseCase = 'investment';
  } else {
    const isInvestment = /(?:investment|rental|income|cash flow)/i.test(listingText);
    likelyBuyerUseCase = isInvestment ? 'investment' : 'primary_residence';
  }

  return {
    propertyCategory: category,
    ownershipModel,
    likelyBuyerUseCase,
    primaryDecisionAxis: DECISION_AXIS[category] ?? [],
    decisiveListingSignals: signals,
    irrelevantGenericRisksToAvoid: irrelevantRisks,
    confidence: computeProfileConfidence(input, category, signals.length),
  };
}
