// Supabase Edge Function - Rental & Sale Property Analyzer
// Deploy with: supabase functions deploy analyze

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ReportMode = 'rent' | 'sale';

type AnalysisStage =
  | "upload_received"
  | "detecting_rooms"
  | "evaluating_spaces"
  | "extracting_strengths_and_issues"
  | "estimating_competition"
  | "building_final_report"
  | "done"
  | "failed";

interface AnalysisState {
  id?: string;
  stage: AnalysisStage;
  message: string;
  progress: number;
  status: "queued" | "processing" | "done" | "failed";
  result?: unknown;
  error?: string;
}

type Step1UserContent =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(name: string): string | undefined;
  };
};

// ── Primary (AU) Database ─────────────────────────────────────────────────
// All user data, credits, history, and analysis records are stored HERE.
// US server is a pure worker — it does NOT own any user data.
const PRIMARY_SUPABASE_URL = "https://trteewgplkqiedonomzg.supabase.co";
const PRIMARY_ANON_KEY = Deno.env.get("AU_ANON_KEY") || "";
const PRIMARY_SERVICE_ROLE_KEY = Deno.env.get("AU_SERVICE_ROLE_KEY") || "";

// ── US Worker Config ─────────────────────────────────────────────────────
// US server has no auth, no user data, no history.
// It only runs analysis. All results are written to PRIMARY.
const US_SUPABASE_URL = Deno.env.get("US_SUPABASE_URL") || "";
const US_ANON_KEY = Deno.env.get("US_ANON_KEY") || "";
const IS_US_WORKER = !!US_SUPABASE_URL; // true when deployed on US Supabase

// ── Server-role constants ─────────────────────────────────────────────────
const AUTH_URL = PRIMARY_SUPABASE_URL;
const AUTH_ANON_KEY = PRIMARY_ANON_KEY;
const ACCOUNT_SERVICE_KEY = PRIMARY_SERVICE_ROLE_KEY;

// All data writes ALWAYS go to PRIMARY (AU) — even when this code runs on US
const LOCAL_URL = PRIMARY_SUPABASE_URL;
const LOCAL_SERVICE_KEY = PRIMARY_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = PRIMARY_ANON_KEY;

const SITE_URL = Deno.env.get("SITE_URL") || "https://www.tryhomescope.com";

console.log("=== Server Configuration ===");
console.log("IS_US_WORKER:", IS_US_WORKER);
console.log("PRIMARY_URL (all data):", LOCAL_URL ? "***" : "NOT SET");
console.log("AUTH_URL (account system):", AUTH_URL ? "***" : "NOT SET");
console.log("ACCOUNT_SERVICE_KEY set:", !!ACCOUNT_SERVICE_KEY);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token",
  "Access-Control-Max-Age": "86400",
};

// ========== Property Intelligence Profile Builder ==========

type PropertyIntelligenceCategory =
  | 'single_family' | 'multi_family' | 'condo' | 'co_op'
  | 'townhouse' | 'land' | 'manufactured' | 'unknown';
type OwnershipModel = 'fee_simple' | 'condominium' | 'cooperative' | 'unknown';
type ProfileConfidence = 'high' | 'medium' | 'low';

interface PropertyIntelligenceProfile {
  propertyCategory: PropertyIntelligenceCategory;
  ownershipModel: OwnershipModel;
  likelyBuyerUseCase: 'primary_residence' | 'investment' | 'mixed' | 'unknown';
  primaryDecisionAxis: string[];
  decisiveListingSignals: string[];
  irrelevantGenericRisksToAvoid: string[];
  confidence: ProfileConfidence;
  hasZestimate: boolean;
  hasRentZestimate: boolean;
}

interface BuildProfileInput {
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
  rentZestimateAvailable?: boolean;
}

// ── Category detection ─────────────────────────────────────────────────────────
// Priority: normalizedPropertyCategory > structured fields (homeType/propertySubtype/propertyType) > listingText
// Structured fields NEVER overridden by listingText keywords.
// Use SINGLE patterns for all matching (no /i flag — pass pre-lowercased values).

const PROPERTY_CATEGORY_PATTERNS: Array<[PropertyIntelligenceCategory, string[]]> = [
  ['co_op',        ['co_op', 'coop', 'co op', 'stock cooperative', 'cooperative']],
  ['condo',        ['condo', 'condominium', 'condop']],
  ['multi_family', ['multi_family', 'multi family', 'duplex', 'triplex', '2 family', '2-family', 'legal 2 family', 'income unit', 'two family', 'two-family', 'three family', 'three-family', 'four family', 'four-family']],
  ['townhouse',    ['townhouse', 'townhome', 'rowhouse', 'row house']],
  ['land',         ['land', 'lot', 'vacant', 'development site', 'acreage']],
  ['manufactured', ['manufactured', 'mobile home', 'double wide', 'double-wide', 'trailer']],
  ['single_family', ['single family', 'single-family', 'single family residence', 'single-family residence', 'singlefamily', 'single_family', 'detached house', 'detached', 'house']],
];

function normalizeCategoryToken(raw: string): string {
  return raw
    // Split camelCase: "SingleFamily" → "Single Family"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectPropertyCategory(input: BuildProfileInput): { category: PropertyIntelligenceCategory; source: string } {
  // ── Priority 1: normalizedPropertyCategory (authoritative canonical value from UI/extractor) ──
  if (input.normalizedPropertyCategory) {
    const nc = normalizeCategoryToken(input.normalizedPropertyCategory);
    for (const [cat, patterns] of PROPERTY_CATEGORY_PATTERNS) {
      if (patterns.some(p => p === nc || nc === p)) return { category: cat, source: 'normalizedPropertyCategory' };
    }
    // normalizedPropertyCategory is set but didn't match any known category → treat as authoritative unknown
    return { category: 'unknown', source: 'normalizedPropertyCategory' };
  }

  // ── Priority 2: structured fields (homeType, propertySubtype, propertyType) ──
  // These are Zillow/API structured fields — more reliable than free-text listing description.
  const structuredFields: Array<{ value: string | null | undefined; name: string }> = [
    { value: input.homeType,         name: 'homeType' },
    { value: input.propertySubtype,  name: 'propertySubtype' },
    { value: input.propertyType,     name: 'propertyType' },
  ];

  for (const { value, name } of structuredFields) {
    if (!value) continue;
    const token = normalizeCategoryToken(value);
    for (const [cat, patterns] of PROPERTY_CATEGORY_PATTERNS) {
      if (patterns.some(p => p === token || token === p)) {
        return { category: cat, source: name };
      }
    }
  }

  // ── Priority 3: listingText (last resort — never override structured fields) ──
  // Only used when no structured fields are available.
  const text = (input.listingText ?? '').toLowerCase();
  for (const [cat, patterns] of PROPERTY_CATEGORY_PATTERNS) {
    if (patterns.some(p => text.includes(p))) {
      return { category: cat, source: 'listingText' };
    }
  }

  return { category: 'unknown', source: 'none' };
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
  const lower = text.toLowerCase();

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
      ['legal 2 family', 'legal two family', 'legal two-family'],
      ['walk-in apartment', 'walk in apartment'],
      ['mother-daughter', 'mother daughter'],
      ['separate entrance', 'separate street entrance'],
      ['income unit'],
      ['rent stabilized', 'rent-controlled', 'rent controlled'],
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

function buildPropertyIntelligenceProfile(input: BuildProfileInput): PropertyIntelligenceProfile & { categorySource: string } {
  const { category, source } = detectPropertyCategory(input);
  const ownershipModel = detectOwnershipModel(category);
  const listingText = input.listingText ?? '';
  const signals = extractDecisiveSignals(listingText, category);
  const irrelevantRisks = IRRELEVANT_RISKS[category];

  let likelyBuyerUseCase: 'primary_residence' | 'investment' | 'mixed' | 'unknown' = 'unknown';
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
    categorySource: source,
    hasZestimate: input.zestimateAvailable ?? false,
    hasRentZestimate: input.rentZestimateAvailable ?? false,
  };
}

// ── Property-type-specific fallback pools (for normalize + guardrail) ──────────

type CheckItem = { title: string; why_it_matters: string; action: string };

const PROPERTY_TYPE_CHECK_POOL: Record<PropertyIntelligenceCategory, CheckItem[]> = {
  co_op: [
    { title: 'Board Approval & Timeline', why_it_matters: 'A co-op board can reject any buyer even after offer acceptance.', action: 'Ask about board package requirements, typical approval timeline, and any rejection history.' },
    { title: 'Total Monthly Cost', why_it_matters: 'Monthly maintenance + flip tax can significantly affect true carrying cost.', action: 'Ask for the full maintenance breakdown, what it includes, and flip tax calculation.' },
    { title: 'Subletting Rules', why_it_matters: 'Subletting restrictions affect resale liquidity and future flexibility.', action: 'Confirm subletting policy, duration limits, and any fees.' },
    { title: 'Building Financial Health', why_it_matters: 'Underfunded reserves mean future special assessments — a hidden cost to all unit owners.', action: 'Ask for 2 years of financial statements and reserve fund balance.' },
  ],
  condo: [
    { title: 'HOA Reserves & Assessments', why_it_matters: 'HOA fees are visible, but reserve fund health and pending special assessments are not.', action: 'Ask for the reserve fund balance, last reserve study, and any upcoming assessments.' },
    { title: 'Rental Restrictions', why_it_matters: 'Rental restrictions affect resale liquidity and future flexibility.', action: 'Confirm rental limits, pet policies, and any right-of-first-refusal on resales.' },
    { title: 'Master Insurance & Owner Coverage', why_it_matters: 'Building insurance coverage affects what unit owners must insure separately.', action: 'Confirm master policy coverage and any required unit-owner insurance.' },
    { title: 'Owner-Occupancy Ratio', why_it_matters: 'Low owner-occupancy affects financing options and building management quality.', action: 'Ask about the current owner-occupancy ratio and financing restrictions.' },
  ],
  multi_family: [
    { title: 'Legal Unit Count & CO', why_it_matters: 'The listing claims multi-family use, but CO must confirm legal unit count.', action: 'Ask for the Certificate of Occupancy to confirm legal unit count and approved use.' },
    { title: 'Actual Rent Roll', why_it_matters: 'Rental income assumptions need verified rent rolls and lease copies.', action: 'Ask for the current rent roll and actual leases for each unit.' },
    { title: 'Separate Metering', why_it_matters: 'Shared utilities affect operating expenses and net income.', action: 'Confirm whether utilities are separately metered for each unit.' },
    { title: 'Open Violations', why_it_matters: 'Open violations can block financing and indicate deferred maintenance.', action: 'Ask about DOB, HPD, ECB, or fire department violations.' },
  ],
  single_family: [
    { title: 'Roof and Major Systems', why_it_matters: 'Roof, HVAC, electrical, and plumbing are top repair costs in years 1–5.', action: 'Ask for roof age, HVAC age, electrical panel type, and recent system updates.' },
    { title: 'Comparable Sales', why_it_matters: 'Without comparable sales, price confidence is low.', action: 'Ask for 3–5 recent nearby comparable sales.' },
    { title: 'Basement Permits and Legal Use', why_it_matters: 'Unpermitted basement space can block financing and insurance.', action: 'Ask whether the basement is permitted, has proper egress, and is in legal sqft.' },
  ],
  townhouse: [
    { title: 'HOA Fees & Exterior Responsibility', why_it_matters: 'Townhouse HOA covers exterior but scope varies — know what you\'re responsible for.', action: 'Ask for HOA documents and clarify exterior maintenance responsibilities.' },
    { title: 'Comparable Sales', why_it_matters: 'Without comparable sales, price confidence is low.', action: 'Ask for 3–5 recent comparable townhouse sales in this HOA or neighborhood.' },
    { title: 'Parking Arrangements', why_it_matters: 'Parking rights affect livability and resale value.', action: 'Confirm parking: deeded, assigned, or unassigned — and any guest rules.' },
  ],
  land: [
    { title: 'Zoning & Permitted Uses', why_it_matters: 'Zoning determines what you can build or use the land for.', action: 'Verify zoning with the local planning department.' },
    { title: 'Utilities at Lot Line', why_it_matters: 'Connecting utilities can cost tens of thousands.', action: 'Confirm availability and cost of water, sewer, gas, and electric.' },
    { title: 'Flood Zone & Survey', why_it_matters: 'Flood zone affects insurance; survey confirms buildability.', action: 'Check FEMA flood maps and request a current survey.' },
  ],
  manufactured: [
    { title: 'Land Ownership & Lot Rent', why_it_matters: 'If the lot is rented, lot rent is a non-negotiable ongoing cost.', action: 'Confirm whether the land is owned or rented and what the monthly lot rent is.' },
    { title: 'Park Rules & Lot Rent Increases', why_it_matters: 'Park rules and pending lot rent increases affect total cost of ownership.', action: 'Ask for the park\'s rules, any pending rent increases, and recent park sales.' },
    { title: 'HUD Tag & Title', why_it_matters: 'Without the HUD tag, resale may be difficult and financing options are limited.', action: 'Confirm the HUD tag number and whether title is clear.' },
  ],
  unknown: [],
};

const PROPERTY_TYPE_MISSING_POOL: Record<PropertyIntelligenceCategory, string[]> = {
  co_op: [
    'Monthly maintenance total cost and what it covers',
    'Board approval requirements and timeline',
    'Flip tax or transfer fee calculation',
    'Subletting and owner-occupancy rules',
    'Reserve fund balance and building financials',
    'Financing restrictions and minimum down payment',
  ],
  condo: [
    'HOA reserves, pending assessments, and special fees',
    'Rental restrictions and pet policies',
    'Master insurance coverage',
    'Owner-occupancy ratio and financing restrictions',
    'Litigation or pending legal issues',
  ],
  multi_family: [
    'Certificate of Occupancy and legal unit count',
    'Current rent roll and actual leases',
    'Rent stabilization or rent control status',
    'Open DOB/HPD/ECB violations',
    'Separate utility metering',
  ],
  single_family: [
    'Major systems age: roof / HVAC / electrical / plumbing',
    'Basement permits, egress, and legal use',
    'Comparable sales',
    'Open permits or violations',
    'Actual insurance and utility costs',
  ],
  townhouse: [
    'HOA fees, what they cover, and exterior responsibility',
    'HOA reserves and special assessment history',
    'Parking arrangements and deeded vs. rented spots',
    'Comparable sales',
  ],
  land: [
    'Zoning and permitted uses',
    'Utilities availability and connection cost',
    'Flood zone and survey',
    'Easements and deed restrictions',
  ],
  manufactured: [
    'Land ownership and monthly lot rent',
    'Park rules and lot rent increase history',
    'HUD tag and title verification',
    'Financing options available',
  ],
  unknown: [],
};

/**
 * Signals specific to each property type that should be surfaced when AI returns
 * empty or filtered-out listing_signals.  These are decision-axis signals that
 * co-op/condo/multi-family buyers must know — not generic SF warnings.
 */
const PROPERTY_TYPE_SIGNAL_POOL: Record<string, Array<{ signal: string; reason: string }>> = {
  co_op: [
    { signal: 'Stock Cooperative Ownership', reason: 'This is a co-op — monthly maintenance, board approval, and subletting rules govern the transaction.' },
    { signal: 'Subletting Prohibited or Restricted', reason: 'Subletting restrictions affect resale liquidity and future flexibility.' },
    { signal: 'Maintenance May Include Utilities', reason: 'Monthly fee may cover utilities, but total carrying cost must still be verified.' },
    { signal: 'Parking Waitlist May Apply', reason: 'Parking may not be available immediately — ask about waitlist length and fees.' },
    { signal: 'No Zestimate or Tax History Available', reason: 'Co-ops often lack Zestimate and public tax records — verify all financials independently.' },
  ],
  condo: [
    { signal: 'HOA Property', reason: 'HOA fees are listed, but reserve fund health and special assessments are not.' },
    { signal: 'Rental Restrictions May Apply', reason: 'Rental limits affect resale liquidity and investment potential.' },
    { signal: 'Owner-Occupancy Ratio Unknown', reason: 'Low owner-occupancy affects building management quality and financing options.' },
  ],
  multi_family: [
    { signal: 'Multi-Family Claim', reason: 'Listing suggests multi-family use — Certificate of Occupancy must confirm legal unit count.' },
    { signal: 'Basement: See Remarks', reason: 'Basement legality and permits must be verified before relying on that space.' },
    { signal: 'No Zestimate or Rent Zestimate', reason: 'Investment metrics cannot be calculated without verified rent rolls.' },
  ],
  single_family: [],
  townhouse: [],
  land: [],
  manufactured: [],
  unknown: [],
};

/**
 * Single-family dynamic backfill candidates for applySingleFamilyFinalGuard.
 * Used to fill gaps after stripping multi-family content.
 * NOT used for filtering — only for adding missing items.
 */
const SF_CANDIDATE_MISSING: string[] = [
  'Comparable sales',
  'Major systems age: roof / HVAC / electrical / plumbing',
  'Basement permits, egress, and legal use',
  'Open permits or violations',
  'Actual insurance and utility costs',
];

const SF_CANDIDATE_CHECKS: Array<{ title: string; why_it_matters: string; action: string }> = [
  {
    title: 'Comparable Sales',
    why_it_matters: 'Without comparable sales, price confidence is low — the listing price or Zestimate is not enough to judge fairness.',
    action: 'Ask for 3–5 recent nearby comparable sales before relying on the asking price.',
  },
  {
    title: 'Built in {{YEAR}}: Major Systems Age',
    why_it_matters: 'A home from {{YEAR}} likely has aging roof, HVAC, electrical, or plumbing — all significant repair costs.',
    action: 'Ask for roof age, HVAC age, electrical panel type, and any recent system updates.',
  },
  {
    title: 'Basement: Permits, Egress, and Legal Use',
    why_it_matters: 'Unpermitted basement space can block financing and insurance — permits and proper egress must be verified.',
    action: 'Confirm whether the basement is permitted, legally finished, and has proper egress.',
  },
];

const SF_CANDIDATE_QUESTIONS: Array<{ category: string; question: string }> = [
  {
    category: 'Condition',
    question: 'What is the current condition and age of the roof, HVAC, electrical panel, plumbing, and water heater? Are there any known issues or recent repairs?',
  },
  {
    category: 'Market',
    question: 'Can you provide 3–5 recent comparable sales in the area to help assess whether the asking price is justified?',
  },
  {
    category: 'Legal',
    question: 'The listing mentions a basement — can you confirm whether it is permitted, legally finished, and has proper egress?',
  },
  {
    category: 'Legal',
    question: 'Are there any open permits, building violations, or unresolved DOB/HPD complaints on this property?',
  },
  {
    category: 'Costs',
    question: 'Can you confirm the annual property taxes, estimated insurance costs, and any HOA or community fees?',
  },
];

/**
 * Questions specific to each property type that should be asked when AI returns fewer
 * than 5 questions or returns generic residential questions (roof/HVAC/plumbing).
 * These questions are asked in the fallback pipeline — the AI may have already produced
 * good questions, which are kept via dedup.  Pool items supplement, not replace.
 */
const PROPERTY_TYPE_QUESTION_POOL: Record<string, string[]> = {
  co_op: [
    'What is the current monthly maintenance, and exactly what does it include — utilities, property tax, underlying mortgage?',
    'What are the board approval requirements, financing restrictions, and typical approval timeline?',
    'What is the exact subletting policy — duration limits, fees, and board consent requirements?',
    'Can you provide building financials, reserve fund balance, any recent assessments, and planned capital projects?',
    'How long is the parking waitlist and what is the monthly parking fee?',
    'Is there a flip tax or transfer fee, and if so, how is it calculated?',
  ],
  condo: [
    'What are the HOA fees, what do they cover, and what is the reserve fund balance?',
    'Are there any pending special assessments or recent reserve study findings?',
    'What are the rental restrictions and pet policies?',
    'What does the master insurance policy cover and what unit-owner insurance is required?',
    'What is the current owner-occupancy ratio and are there financing restrictions?',
  ],
  multi_family: [
    'Can you provide the Certificate of Occupancy confirming the legal unit count and approved use?',
    'Can you provide the current rent roll and actual leases for each unit?',
    'Are utilities separately metered for each unit, or does the owner pay for any utilities?',
    'Are there any open DOB, HPD, ECB, or fire department violations on this property?',
    'Are any units rent-stabilized or rent-controlled?',
  ],
  single_family: [],
  townhouse: [],
  land: [],
  manufactured: [],
  unknown: [],
};

/**
 * Required decision-axis keywords per property type.  Used to determine whether the
 * AI's top-3-things-to-check has adequate coverage before falling back to the pool.
 * Coverage is satisfied when ≥ half the required keywords are matched.
 */
const REQUIRED_DECISION_KEYWORDS: Record<string, string[]> = {
  co_op: ['board', 'maintenance', 'subletting', 'building financial', 'flip tax', 'monthly cost'],
  condo: ['hoa', 'reserve', 'assessment', 'rental', 'insurance', 'owner-occupancy'],
  multi_family: ['legal', 'co', 'certificate', 'rent roll', 'meter', 'violation'],
  single_family: ['roof', 'hvac', 'comparable', 'basement', 'permit'],
  townhouse: ['hoa', 'exterior', 'comparable', 'parking'],
  land: [],
  manufactured: [],
  unknown: [],
};

/**
 * Post-LLM guardrail: remove generic risks that should not appear for this propertyCategory.
 * Falls back to property-type-specific pool if AI returned too few relevant items.
 * Also filters signals based on available financial data (Zestimate/RentZestimate).
 */
function validateBasicReportAgainstProfile(
  result: any,
  profile: PropertyIntelligenceProfile & { hasZestimate?: boolean; hasRentZestimate?: boolean; categorySource?: string },
  opts?: Record<string, unknown>,
): any {
  const avoid = profile.irrelevantGenericRisksToAvoid ?? [];
  const hasZ = profile.hasZestimate ?? false;
  const hasRentZ = profile.hasRentZestimate ?? false;

  const avoidPatterns = avoid.map(r => new RegExp(r.replace(/\s+/g, '\\s*'), 'i'));

  const isForbidden = (text: string) =>
    avoidPatterns.some(p => p.test(text));

  // Filter top_3_things_to_check
  const existing = Array.isArray(result.top_3_things_to_check) ? result.top_3_things_to_check : [];
  const filtered = existing.filter((item: any) => {
    const combined = `${item.title ?? ''} ${item.why_it_matters ?? ''} ${item.action ?? ''}`;
    return !isForbidden(combined);
  });

  // Supplement from type-specific pool if < 2 items
  if (filtered.length < 2) {
    const pool = PROPERTY_TYPE_CHECK_POOL[profile.propertyCategory] ?? [];
    for (const sup of pool) {
      if (filtered.length >= 3) break;
      const supText = `${sup.title} ${sup.action}`;
      if (!isForbidden(supText) && !filtered.some((f: any) => f.title === sup.title)) {
        filtered.push(sup);
      }
    }
  }

  result.top_3_things_to_check = filtered.slice(0, 4);

  // Filter whats_missing
  if (Array.isArray(result.whats_missing)) {
    result.whats_missing = result.whats_missing.filter((item: string) => {
      if (isForbidden(item)) return false;
      const lower = item.toLowerCase();
      if (hasZ && /no zestimate|zestimate.*not available/i.test(lower)) return false;
      if (hasRentZ && /no rent zestimate|rent zestimate.*not available/i.test(lower)) return false;
      return true;
    });

    if (result.whats_missing.length < 4) {
      const pool = PROPERTY_TYPE_MISSING_POOL[profile.propertyCategory] ?? [];
      for (const gap of pool) {
        if (result.whats_missing.length >= 6) break;
        if (!isForbidden(gap) && !result.whats_missing.includes(gap)) {
          result.whats_missing.push(gap);
        }
      }
    }
  }

  // ── Repair listing_signals: filter forbidden + backfill from type-specific pool ──
  if (Array.isArray(result.listing_signals)) {
    result.listing_signals = result.listing_signals.filter((s: any) => {
      const text = `${s.signal ?? ''} ${s.reason ?? ''}`.toLowerCase();
      if (isForbidden(text)) return false;
      // If Zestimate exists, filter out "No Zestimate" signals
      if (hasZ && /no zestimate|zestimate.*not available|zestimate.*unavailable/i.test(text)) return false;
      // If Rent Zestimate exists, filter out "No Rent Zestimate" signals
      if (hasRentZ && /no rent zestimate|rent zestimate.*not available|rent zestimate.*unavailable/i.test(text)) return false;
      return true;
    });

    // Backfill when AI returned empty or all forbidden signals
    if (result.listing_signals.length === 0) {
      const pool = PROPERTY_TYPE_SIGNAL_POOL[profile.propertyCategory] ?? [];
      for (const sig of pool) {
        if (result.listing_signals.length >= 4) break;
        if (!isForbidden(`${sig.signal} ${sig.reason}`)) {
          result.listing_signals.push(sig);
        }
      }
    }

    // ── Dynamic Zestimate signal injection ─────────────────────────────────────
    // Prompt instructs AI to emit this, but it sometimes omits it.
    // Inject directly when hasZestimate/hasRentZestimate is true and no signals generated.
    if (result.listing_signals.length === 0 && (profile.hasZestimate || profile.hasRentZestimate)) {
      const zVal = profile.hasZestimate ? (opts as any)?.zestimate ?? (result.what_we_know as any)?.zestimate : null;
      const rzVal = profile.hasRentZestimate ? (opts as any)?.rentZestimate ?? (result.what_we_know as any)?.rentZestimate : null;
      const zStr = zVal ? `Zestimate of $${Number(zVal).toLocaleString()}` : '';
      const rzStr = rzVal ? `Rent Zestimate of $${Number(rzVal).toLocaleString()}/mo` : '';
      const hasBoth = zStr && rzStr;
      const suffix = hasBoth
        ? `${zStr} and ${rzStr}`
        : (zStr || rzStr);
      result.listing_signals.push({
        signal: 'Zillow Value Available',
        reason: `Zillow shows ${suffix} — but comparable sales and actual assumptions still need verification.`,
      });
    }
  }

  // ── Repair bottom_line: only overwrite when truly forbidden content is present ──
  const bl = (result.bottom_line ?? '').toString();
  // Only rebuild when bottom_line contains genuinely wrong property-type content:
  // multi-family terms in a single-family report, or Zestimate stated as missing when it exists
  const FORBIDDEN_BL_PATTERNS = [
    /rent roll|lease.*each.*unit|legal unit count|separate utility metering/i,
    /multi.family|rental income|each.*unit.*legal/i,
    /duplex.home|duplex.style/i,
  ];
  const hasForbiddenBL = FORBIDDEN_BL_PATTERNS.some(re => re.test(bl));
  const trulyForbidden = hasForbiddenBL ||
    (hasZ && /no zestimate|zestimate.*not available|zestimate.*unavailable/i.test(bl.toLowerCase()));
  if (trulyForbidden) {
    const wwKnow = result.what_we_know ?? {};
    const price = wwKnow.asking_price ?? wwKnow.askingPrice ?? wwKnow.price ?? null;
    const parts: string[] = [];
    if (price) parts.push(typeof price === 'string' ? price : `$${Number(price).toLocaleString()}`);
    const missingStr = (result.whats_missing ?? []).slice(0, 3).join(', ');
    if (parts.length > 0 && missingStr) {
      const typeLabel = profile.propertyCategory === 'co_op' ? 'co-op' :
                        profile.propertyCategory === 'condo' ? 'condo' :
                        profile.propertyCategory === 'multi_family' ? 'multi-family' : 'property';
      result.bottom_line = `This ${typeLabel} at ${parts.join(', ')} is listed — but ${missingStr} still need verification.`;
    }
  }

  // ── Supplement questions_to_ask from PROPERTY_TYPE_QUESTION_POOL ───────────────
  if (Array.isArray(result.questions_to_ask)) {
    const existingQ = (result.questions_to_ask as any[]).map((q: any) =>
      (typeof q === 'string' ? q : (q.question ?? '')).toLowerCase()
    );
    const pool = PROPERTY_TYPE_QUESTION_POOL[profile.propertyCategory] ?? [];
    for (const q of pool) {
      if (result.questions_to_ask.length >= 5) break;
      // #region agent log H1
      fetch('http://127.0.0.1:7551/ingest/acb963f0-2502-480f-a2cb-a3edc4af3b03',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'05ad70'},body:JSON.stringify({sessionId:'05ad70',location:'analyze.ts:579',message:'PROPERTY_TYPE_QUESTION_POOL q type',data:{qType:typeof q,qValue:String(q).slice(0,50)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const qText = q;
      const key = qText.toLowerCase().slice(0, 30);
      const isDup = existingQ.some((eq: string) => eq.slice(0, 30) === key);
      if (!isDup && !isForbidden(qText)) {
        result.questions_to_ask.push(qText);
        existingQ.push(key);
      }
    }
  }

  return result;
}

/**
 * Final guard: strips multi-family/mixed-use content from single_family reports
 * when category was determined from a structured field (homeType/propertySubtype/
 * propertyType/normalizedPropertyCategory).
 *
 * Only activated when:
 *   profile.propertyCategory === 'single_family'
 *   AND categorySource is one of the structured field sources
 *
 * Stripped items are replaced by SF_CANDIDATE_* items based on available listing facts.
 */
function applySingleFamilyFinalGuard(
  result: any,
  profile: PropertyIntelligenceProfile & { categorySource?: string },
  optionalDetails?: Record<string, unknown>,
): any {
  const isStructuredSingleFamily =
    profile.propertyCategory === 'single_family' &&
    profile.categorySource != null &&
    ['homeType', 'propertySubtype', 'propertyType', 'normalizedPropertyCategory'].includes(profile.categorySource);

  // ── Diagnostic logs ──────────────────────────────────────────────────────────
  console.log('[SingleFamilyGuard] entered', {
    propertyCategory: profile.propertyCategory,
    categorySource: (profile as any).categorySource,
    isStructuredSingleFamily,
  });

  if (!isStructuredSingleFamily) {
    // Explain why guard was skipped
    console.log('[SingleFamilyGuard] skipped', {
      reason: profile.propertyCategory !== 'single_family'
        ? `propertyCategory=${profile.propertyCategory} (not single_family)`
        : `categorySource=${(profile as any).categorySource ?? 'null'} (not a structured field)`,
    });
    return result;
  }

  const opts = optionalDetails ?? {};
  const wwKnow = result.what_we_know ?? {};
  const listingText = String(opts.description ?? opts.listingDescription ?? '').toLowerCase();
  const yearBuilt = opts.yearBuilt ?? wwKnow.year_built ?? null;
  const hasPrice = !!(opts.askingPrice ?? wwKnow.asking_price ?? wwKnow.price);
  const hasBasementMention = /basement|cellar|below.?grade|walk.?out/i.test(listingText);
  const hasRenovationMention = /renovation|updated|remodel|newly.?done/i.test(listingText);

  // ── Patterns that indicate multi-family / mixed-use — must be stripped ──────────
  const FORBIDDEN_MULTIFAMILY_PATTERNS: RegExp[] = [
    /rent roll|rentroll/i,
    /lease[^s\b]|leases for each unit|unit lease|lease for each/i,
    /separate utility metering|utility metering per unit|separate meter.*unit/i,
    /legal unit count|unit count.*legal|how many units/i,
    /multi.family claim/i,
    /rental income reliance|rental income as|rely on rental income/i,
    /two.unit|two-unit|two unit|2.unit|2-unit|2 unit/i,
    /mother.daughter|motherdaughter|mother daughter/i,
    /walk.in apartment|walk.in basement/i,
    /approved use for each unit|legal.*each.*unit|each.*unit.*legal/i,
    /separate entrance.*rental|rental.*separate entrance|income unit/i,
  ];

  const hasForbidden = (text: string) =>
    FORBIDDEN_MULTIFAMILY_PATTERNS.some(re => re.test(text));

  // ── Strip from bottom_line ───────────────────────────────────────────────────
  const origBottomLine = result.bottom_line ?? '';
  let finalBottomLine = origBottomLine;
  if (hasForbidden(origBottomLine)) {
    // Rebuild bottom_line from known listing facts (safe SF content)
    const parts: string[] = [];
    if (hasPrice) {
      const p = opts.askingPrice ?? wwKnow.asking_price ?? wwKnow.price;
      parts.push(typeof p === 'string' ? p : `$${Number(p).toLocaleString()}`);
    }
    if (wwKnow.beds || wwKnow.bedrooms) parts.push(`${wwKnow.beds ?? wwKnow.bedrooms} bed`);
    if (wwKnow.baths || wwKnow.bathrooms) parts.push(`${wwKnow.baths ?? wwKnow.bathrooms} bath`);
    if (wwKnow.sqft || wwKnow.square_feet) parts.push(`${wwKnow.sqft ?? wwKnow.square_feet} sqft`);
    if (yearBuilt) parts.push(`built ${yearBuilt}`);
    if (opts.propertyType) parts.push(opts.propertyType as string);

    const knownFacts = parts.join(', ');
    const sfMissing: string[] = [];
    const hasMajorSystems = yearBuilt && Number(yearBuilt) <= new Date().getFullYear() - 40;
    if (!wwKnow.comparable_sales && !wwKnow.comparableSales) sfMissing.push('comparable sales');
    if (hasBasementMention) sfMissing.push('basement permits, egress, and legal use');
    if (hasMajorSystems) sfMissing.push('major systems age: roof / HVAC / electrical / plumbing');
    if (!wwKnow.home_condition && !wwKnow.condition && !hasMajorSystems) {
      sfMissing.push('major systems age: roof / HVAC / electrical / plumbing');
    }
    sfMissing.push('open permits or violations');
    if (!wwKnow.taxes && !wwKnow.annual_tax && !opts.annualTax && !opts.taxAnnual) {
      sfMissing.push('actual insurance and utility costs');
    }
    const missingStr = sfMissing.length > 0 ? sfMissing.slice(0, 4).join(', ') : 'key facts';

    if (knownFacts) {
      finalBottomLine = `This ${opts.propertyType ?? 'property'} at ${knownFacts} — but ${missingStr} still need verification before committing.`;
    } else {
      finalBottomLine = `Key basics such as ${missingStr} are missing or unclear for this listing.`;
    }
    result.bottom_line = finalBottomLine;
  }

  // ── Strip from listing_signals ───────────────────────────────────────────────
  const origSignalCount = Array.isArray(result.listing_signals) ? result.listing_signals.length : 0;
  if (Array.isArray(result.listing_signals)) {
    const rewritten: any[] = [];
    for (const s of result.listing_signals) {
      const signalText = `${s.signal ?? ''} ${s.reason ?? ''}`;
      if (hasForbidden(signalText)) continue; // drop forbidden signals
      if (/duplex.home|duplex.style|duplex.layout|duplex.description/i.test(signalText)) {
        rewritten.push({
          signal: 'Listing Wording Differs from Structured Facts',
          reason: 'The listing description uses "duplex" wording, but Zillow structured facts list this as Single Family Residence. Clarify whether "duplex" refers to layout or style only, not legal multi-unit use.',
        });
        continue;
      }
      rewritten.push(s);
    }
    result.listing_signals = rewritten;
  }

  // ── Strip from whats_missing ────────────────────────────────────────────────
  const origMissing = Array.isArray(result.whats_missing) ? [...result.whats_missing] : [];
  if (Array.isArray(result.whats_missing)) {
    result.whats_missing = (result.whats_missing as string[]).filter(item => !hasForbidden(item));
  }

  // ── Strip from top_3_things_to_check ────────────────────────────────────────
  const origTop3 = Array.isArray(result.top_3_things_to_check) ? [...result.top_3_things_to_check] : [];
  if (Array.isArray(result.top_3_things_to_check)) {
    result.top_3_things_to_check = (result.top_3_things_to_check as any[]).filter(item => {
      const combined = `${item.title ?? ''} ${item.why_it_matters ?? ''} ${item.action ?? ''}`;
      return !hasForbidden(combined);
    });
  }

  // ── Strip from questions_to_ask ──────────────────────────────────────────────
  const origQuestions = Array.isArray(result.questions_to_ask) ? [...result.questions_to_ask] : [];
  if (Array.isArray(result.questions_to_ask)) {
    result.questions_to_ask = (result.questions_to_ask as any[]).filter(q => {
      const text = typeof q === 'string' ? q : (q.question ?? '');
      return !hasForbidden(text);
    });
  }

  // ── Dynamic backfill from SF_CANDIDATE_POOL ────────────────────────────────
  if (Array.isArray(result.whats_missing)) {
    const existingMissing = new Set((result.whats_missing as string[]).map(m => m.toLowerCase()));
    // Concept dedup: check for semantic overlap, not just exact match
    const hasMajorSystemsConcept = existingMissing.has('major systems age: roof / hvac / electrical / plumbing') ||
      existingMissing.has('major systems age') ||
      /major system|roof age|roof.*hvac|roof.*electrical|roof.*plumb/i.test(Array.from(existingMissing).join(' '));
    const candidates: string[] = [];
    if (!existingMissing.has('comparable sales') && hasPrice) candidates.push('Comparable sales');
    if (!hasMajorSystemsConcept && yearBuilt) candidates.push('Major systems age: roof / HVAC / electrical / plumbing');
    if (!existingMissing.has('basement permits, egress, and legal use') && hasBasementMention) candidates.push('Basement permits, egress, and legal use');
    if (!existingMissing.has('open permits or violations')) candidates.push('Open permits or violations');
    if (!existingMissing.has('actual insurance and utility costs') && hasPrice) candidates.push('Actual insurance and utility costs');
    if (hasRenovationMention && !existingMissing.has('renovation permits and inspection history')) {
      candidates.push('Renovation permits and inspection history');
    }
    for (const c of candidates) {
      if ((result.whats_missing as string[]).length >= 6) break;
      if (!existingMissing.has(c.toLowerCase())) {
        (result.whats_missing as string[]).push(c);
        existingMissing.add(c.toLowerCase());
      }
    }
  }

  if (Array.isArray(result.top_3_things_to_check)) {
    const existingTitles = new Set((result.top_3_things_to_check as any[]).map(i => (i.title ?? '').toLowerCase()));
    if ((result.top_3_things_to_check as any[]).length < 3) {
      if (!existingTitles.has('comparable sales') && hasPrice) {
        (result.top_3_things_to_check as any[]).push({
          title: 'Comparable Sales',
          why_it_matters: 'Without comparable sales, price confidence is low — the listing price or Zestimate is not enough to judge fairness.',
          action: 'Ask for 3–5 recent nearby comparable sales before relying on the asking price.',
        });
      }
      if (!existingTitles.has(`built in ${yearBuilt ?? ''}: major systems age`) && yearBuilt) {
        (result.top_3_things_to_check as any[]).push({
          title: `Built in ${yearBuilt}: Major Systems Age`,
          why_it_matters: `A home from ${yearBuilt} likely has aging roof, HVAC, electrical, or plumbing — all significant repair costs before year one.`,
          action: 'Ask for roof age, HVAC age, electrical panel type, and any recent system updates.',
        });
      }
      if (!existingTitles.has('basement: permits, egress, and legal use') && hasBasementMention) {
        (result.top_3_things_to_check as any[]).push({
          title: 'Basement: Permits, Egress, and Legal Use',
          why_it_matters: 'Unpermitted basement space can block financing and insurance — permits and proper egress must be verified.',
          action: 'Confirm whether the basement is permitted, legally finished, and has proper egress.',
        });
      }
    }
  }

  if (Array.isArray(result.questions_to_ask)) {
    const existingQ = new Set(
      (result.questions_to_ask as any[]).map(q =>
        (typeof q === 'string' ? q : (q.question ?? '')).toLowerCase().slice(0, 30)
      )
    );
    for (const q of SF_CANDIDATE_QUESTIONS) {
      if ((result.questions_to_ask as any[]).length >= 5) break;
      const key = q.question.toLowerCase().slice(0, 30);
      if (!existingQ.has(key)) {
        if (q.question.includes('basement') && !hasBasementMention) continue;
        (result.questions_to_ask as any[]).push(q);
        existingQ.add(key);
      }
    }
  }

  // ── Diagnostic summary ───────────────────────────────────────────────────────
  console.log('[SingleFamilyGuard] scrubbed', {
    bottomLineChanged: finalBottomLine !== origBottomLine,
    bottomLineBefore: origBottomLine,
    bottomLineAfter: result.bottom_line,
    removedMissingCount: origMissing.length - (Array.isArray(result.whats_missing) ? result.whats_missing.length : 0),
    removedTopChecksCount: origTop3.length - (Array.isArray(result.top_3_things_to_check) ? result.top_3_things_to_check.length : 0),
    removedQuestionsCount: origQuestions.length - (Array.isArray(result.questions_to_ask) ? result.questions_to_ask.length : 0),
    finalMissing: result.whats_missing,
    finalTopChecks: result.top_3_things_to_check,
    finalQuestions: result.questions_to_ask,
  });

  return result;
}

// ========== Auth Helpers ==========

interface UserProfile {
  id: string;
  email: string;
  credits_remaining: number;
  credits_reserved: number;
  credits_used: number;
}

/**
 * Get current user from Authorization header, X-Auth-Token header, or request body.
 * Token is ALWAYS verified against AU auth endpoint (PRIMARY_SUPABASE_URL).
 * Both AU server and US worker use the same AU auth — there's one HomeScope account.
 * Note: Kong may filter custom headers (x-auth-token), so body.authToken is a fallback.
 */
async function getCurrentUser(req: Request): Promise<{ user: UserProfile | null; error: string | null; code: string }> {
  const authHeader = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");
  const xAuthToken = req.headers.get("x-auth-token");

  // Try to get token from body as fallback (for Kong-filtered headers)
  let tokenFromBody: string | null = null;
  try {
    const clonedReq = req.clone();
    const body = await clonedReq.json().catch(() => ({}));
    tokenFromBody = body.authToken || body.userToken || null;
  } catch {
    // Ignore body parse errors
  }

  console.log("=== getCurrentUser Debug ===", {
    IS_US_WORKER,
    AUTH_URL: AUTH_URL ? "***" : "NOT SET",
    ACCOUNT_SERVICE_KEY_set: !!ACCOUNT_SERVICE_KEY,
    AU_ANON_KEY_set: !!PRIMARY_ANON_KEY,
    authHeader_exists: !!authHeader,
    authHeader_prefix: authHeader?.slice(0, 20),
    apikey_exists: !!apikey,
    apikey_prefix: apikey?.slice(0, 16),
    xAuthToken_exists: !!xAuthToken,
    tokenFromBody_exists: !!tokenFromBody,
  });

  // Determine which token to use for authentication
  // Priority: authToken (body) > X-Auth-Token (header) > Authorization (header)
  // authToken from body has highest priority (used by browser extension)
  let token = authHeader ? authHeader.replace("Bearer ", "") : null;
  let actualToken = tokenFromBody || xAuthToken || token;

  if (!actualToken) {
    console.log("getCurrentUser error: No valid token found (authToken, X-Auth-Token, or Authorization)");
    return { user: null, error: "Missing authentication token", code: "NO_TOKEN" };
  }

  console.log("getCurrentUser: token_source=%s token_preview=%s...", tokenFromBody ? "authToken(body)" : xAuthToken ? "X-Auth-Token(header)" : "Authorization(header)", actualToken.substring(0, 15));

  // Token always comes from AU auth (whether sent via Authorization header or body)
  // Auth endpoint is ALWAYS AU — US server has no auth.users, only analysis data
  const authBaseUrl = AUTH_URL;
  const effectiveAnonKey = AUTH_ANON_KEY || "";

  if (!effectiveAnonKey) {
    console.error("CRITICAL: AUTH_ANON_KEY (AU_ANON_KEY) is not set!");
    return { user: null, error: "Server configuration error: missing AU_ANON_KEY", code: "MISSING_AU_ANON_KEY"};
  }

  console.log("getCurrentUser: authBaseUrl=%s effectiveAnonKey_set=%s", authBaseUrl, !!effectiveAnonKey);

  try {
    // Verify token and get user from Supabase Auth
    const userResponse = await fetch(`${authBaseUrl}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${actualToken}`,
        "apikey": effectiveAnonKey,
      },
    });

    console.log("getCurrentUser: /auth/v1/user status=%d effectiveAnonKey_prefix=%s", userResponse.status, effectiveAnonKey.slice(0, 16));

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error("getCurrentUser: /auth/v1/user FAILED", {
        status: userResponse.status,
        body_preview: errorText.slice(0, 200),
      });
      return { user: null, error: `Auth API failed: ${userResponse.status} - ${errorText.slice(0, 100)}`, code: "AUTH_API_FAILED" };
    }

    const userData = await userResponse.json();
    console.log("getCurrentUser: auth success, user_id=%s email=%s", userData.id, userData.email);

    // Get user profile with credits (including reserved)
    // Always use AU Supabase — profiles are stored in the AU project
    // Use service role key to bypass RLS (profiles table RLS blocks anon key reads)
    if (!ACCOUNT_SERVICE_KEY) {
      console.error(
        "[getCurrentUser] Missing ACCOUNT_SERVICE_KEY (AU_SERVICE_ROLE_KEY). " +
        "hasACCOUNT_SERVICE_KEY=%s hasAU_SERVICE_ROLE_KEY=%s",
        !!ACCOUNT_SERVICE_KEY,
        !!PRIMARY_SERVICE_ROLE_KEY
      );
      return {
        user: null,
        error: "Server configuration error: missing service role key",
        code: "SERVER_MISSING_SERVICE_ROLE_KEY",
      };
    }

    const profileResponse = await fetch(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userData.id}&select=id,email,credits_remaining,credits_reserved,credits_used`,
      {
        headers: {
          "apikey": ACCOUNT_SERVICE_KEY,
          "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
        },
      }
    );

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text().catch(() => "");
      console.error("[getCurrentUser] Profile fetch failed", {
        status: profileResponse.status,
        statusText: profileResponse.statusText,
        body: errorText,
        hasServiceRoleKey: !!ACCOUNT_SERVICE_KEY,
      });
      return {
        user: null,
        error: `Failed to fetch user profile: ${profileResponse.status}`,
        code: `PROFILE_FETCH_FAILED_${profileResponse.status}`,
      };
    }

    const profiles = await profileResponse.json();
    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.error("[getCurrentUser] Profile not found for user:", userData.id);
      return { user: null, error: "Profile not found", code: "PROFILE_NOT_FOUND" };
    }

    return { user: profiles[0] as UserProfile, error: null, code: "OK" };
  } catch (err) {
    console.error("Auth error:", err);
    return { user: null, error: "Authentication failed", code: "AUTH_EXCEPTION" };
  }
}

/**
 * Check if user has available credits (remaining - reserved > 0)
 */
function hasAvailableCredits(user: UserProfile | null): boolean {
  if (!user) return false;
  return (user.credits_remaining - user.credits_reserved) > 0;
}

// ========== SEO Helper Functions ==========

/**
 * Convert string to URL-safe slug
 */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate semantic share slug
 * Format: suburb-bedroom-propertyType-rental-analysis-{id}  (rent mode)
 *         suburb-bedroom-propertyType-sale-analysis-{id}     (sale mode)
 */
function generateShareSlug(input: {
  suburb?: string | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  reportId: string;
  reportMode?: ReportMode;
}): string {
  const parts: string[] = [];

  if (input.suburb) {
    parts.push(toSlug(input.suburb));
  }

  if (input.bedrooms != null) {
    parts.push(`${input.bedrooms}-bedroom`);
  }

  if (input.propertyType) {
    parts.push(toSlug(input.propertyType));
  }

  parts.push(input.reportMode === 'sale' ? 'sale-analysis' : 'rental-analysis');
  parts.push(String(input.reportId));

  return parts.join('-');
}

/**
 * Generate SEO title and description
 */
function generateSEOFields(input: {
  suburb?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  weeklyRent?: number | null;
  askingPrice?: number | null;
  verdict?: string | null;
  reportId: string;
  reportMode?: ReportMode;
}): { seo_title: string; seo_description: string } {
  const { suburb, bedrooms, bathrooms, weeklyRent, askingPrice, verdict, reportMode } = input;
  const isRent = reportMode !== 'sale';

  // Generate SEO title（包含 realestate.com.au 关键词）
  let seo_title: string;
  if (isRent) {
    if (suburb && bedrooms) {
      seo_title = `${bedrooms} bed rental on realestate.com.au in ${suburb} – Worth it?`;
    } else if (suburb) {
      seo_title = `Rental on realestate.com.au in ${suburb} – Worth it?`;
    } else if (bedrooms) {
      seo_title = `${bedrooms} bed rental on realestate.com.au – Worth it?`;
    } else {
      seo_title = `realestate.com.au Rental Analysis | HomeScope`;
    }
  } else {
    if (suburb && bedrooms) {
      seo_title = `${bedrooms} bed property on realestate.com.au in ${suburb} – Worth buying?`;
    } else if (suburb) {
      seo_title = `Property on realestate.com.au in ${suburb} – Worth buying?`;
    } else if (bedrooms) {
      seo_title = `${bedrooms} bed property on realestate.com.au – Worth buying?`;
    } else {
      seo_title = `realestate.com.au Property Analysis | HomeScope`;
    }
  }

  // Generate SEO description（包含 realestate.com.au 关键词）
  let seo_description: string;
  if (isRent) {
    if (suburb && bedrooms) {
      seo_description = `${bedrooms}-bed, ${bathrooms || '?'}-bath on realestate.com.au in ${suburb}. `;
      if (weeklyRent) seo_description += `$${weeklyRent}/week. `;
      seo_description += 'AI analysis: pros, cons, risks and verdict. Built for Australian renters.';
    } else if (bedrooms) {
      seo_description = `${bedrooms}-bed property on realestate.com.au. `;
      if (bathrooms) seo_description += `${bathrooms} bathroom, `;
      if (weeklyRent) seo_description += `$${weeklyRent}/week. `;
      seo_description += 'AI analysis: pros, cons, risks and verdict.';
    } else {
      seo_description = 'AI analysis of property from realestate.com.au. Pros, cons, risks and verdict. Built for Australian renters.';
    }
  } else {
    if (suburb && bedrooms) {
      seo_description = `${bedrooms}-bed, ${bathrooms || '?'}-bath on realestate.com.au in ${suburb}. `;
      if (askingPrice) seo_description += `$${askingPrice.toLocaleString()}. `;
      seo_description += 'AI analysis: pros, cons, risks and verdict. Built for Australian property buyers.';
    } else if (bedrooms) {
      seo_description = `${bedrooms}-bed property on realestate.com.au. `;
      if (bathrooms) seo_description += `${bathrooms} bathroom, `;
      if (askingPrice) seo_description += `$${askingPrice.toLocaleString()}. `;
      seo_description += 'AI analysis: pros, cons, risks and verdict.';
    } else {
      seo_description = 'AI analysis of property from realestate.com.au. Pros, cons, risks and verdict. Built for Australian property buyers.';
    }
  }

  return {
    seo_title: seo_title.slice(0, 60),
    seo_description: seo_description.slice(0, 160),
  };
}

// ========== Dev Mode / Test Account Whitelist ==========

const DEV_MODE_WHITELIST = [
  'test@example.com',
  'dev@example.com',
  'localhost@test.com',
  // Add more test emails here
];

/**
 * Check if user should bypass credits check (dev mode / test accounts)
 * This is controlled by environment variable DEV_BYPASS_CREDITS or whitelist
 */
function shouldBypassCreditsCheck(user: UserProfile | null): boolean {
  if (!user) return false;
  
  // Check environment variable first
  const devBypass = Deno.env.get("DEV_BYPASS_CREDITS");
  if (devBypass === "true" || devBypass === "1") {
    console.log("[DEV] Credits check bypassed via DEV_BYPASS_CREDITS env");
    return true;
  }
  
  // Check whitelist
  const userEmail = user.email?.toLowerCase() || '';
  for (const whitelisted of DEV_MODE_WHITELIST) {
    if (userEmail.includes(whitelisted.toLowerCase())) {
      console.log(`[DEV] Credits check bypassed for whitelisted email: ${user.email}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Add credits to a user (for dev/testing purposes)
 * Only works in dev mode or for whitelisted accounts
 */
async function addDevCredits(userId: string, amount: number = 10): Promise<boolean> {
  // Only allow in dev mode
  const devBypass = Deno.env.get("DEV_BYPASS_CREDITS");
  if (devBypass !== "true" && devBypass !== "1") {
    console.log("[DEV] addDevCredits skipped - DEV_BYPASS_CREDITS not enabled");
    return false;
  }

  try {
    // Operates on profiles table — always AU
    const check = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining`,
      { headers: { "apikey": ACCOUNT_SERVICE_KEY, "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}` } }
    );

    if (!check.ok || !Array.isArray(check.payload) || check.payload.length === 0) {
      return false;
    }

    const current = check.payload[0].credits_remaining || 0;

    const update = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": ACCOUNT_SERVICE_KEY,
          "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
        },
        body: JSON.stringify({ credits_remaining: current + amount }),
      }
    );

    return update.ok;
  } catch (err) {
    console.error("[DEV] addDevCredits error:", err);
    return false;
  }
}

// ========== Credits & Usage Records Operations (Atomic) ==========

/**
 * Reserve a credit for analysis - ATOMIC operation
 * Uses UPDATE with WHERE clause to prevent race conditions
 * Returns: { success: true, usageId } or { success: false, error }
 */
/**
 * Unified fetch helper - reads body only once
 */
async function fetchJson(url: string, options?: RequestInit): Promise<{ ok: boolean; status: number; payload: any }> {
  const res = await fetch(url, options);
  const raw = await res.text();

  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { raw };
  }

  if (!res.ok) {
    console.error("upstream error", {
      url: url.replace(AUTH_URL, "***").replace(LOCAL_URL, "***"),
      status: res.status,
      payload,
    });
  }

  return { ok: res.ok, status: res.status, payload };
}

async function reserveCredits(userId: string, analysisId: string): Promise<{ success: boolean; usageId?: string; error?: string }> {
  console.log(`[reserveCredits] userId=${userId}, analysisId=${analysisId}`);

  try {
    // Step 1: Check current credits — ALWAYS query AU profiles
    const check = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining,credits_reserved`,
      { headers: { "apikey": ACCOUNT_SERVICE_KEY, "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}` } }
    );

    if (!check.ok) {
      if (check.status === 404) return { success: false, error: "User not found" };
      return { success: false, error: "Failed to check credits" };
    }

    const profiles = check.payload;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return { success: false, error: "User not found" };
    }

    const profile = profiles[0];
    const available = profile.credits_remaining - profile.credits_reserved;
    console.log(`[reserveCredits] remaining=${profile.credits_remaining}, reserved=${profile.credits_reserved}, available=${available}`);

    if (available <= 0) {
      return { success: false, error: "No credits available" };
    }

    // Step 2: Reserve a credit — write to AU profiles
    const update = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": ACCOUNT_SERVICE_KEY,
          "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({ credits_reserved: profile.credits_reserved + 1 }),
      }
    );

    if (!update.ok) {
      console.error("[reserveCredits] update failed:", update.payload);
      return { success: false, error: "Failed to reserve credit" };
    }

    const updatedProfiles = update.payload;
    if (!Array.isArray(updatedProfiles) || updatedProfiles.length === 0) {
      return { success: false, error: "No credits available" };
    }

    // Step 3: Create usage record in AU
    const usage = await fetchJson(
      `${AUTH_URL}/rest/v1/usage_records`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": ACCOUNT_SERVICE_KEY,
          "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          user_id: userId,
          analysis_id: analysisId,
          status: "reserved",
          credits_change: 0,
        }),
      }
    );

    let usageId: string | undefined;
    if (usage.ok && Array.isArray(usage.payload) && usage.payload.length > 0) {
      usageId = usage.payload[0].id;
    }

    console.log(`[reserveCredits] done, usageId=${usageId}`);
    return { success: true, usageId };
  } catch (err) {
    console.error("[reserveCredits] error:", err);
    return { success: false, error: "Failed to reserve credits" };
  }
}

/**
 * Release reserved credit
 * Called when analysis fails
 */
async function releaseCredits(userId: string, usageId?: string): Promise<boolean> {
  console.log(`[releaseCredits] userId=${userId}, usageId=${usageId}`);

  try {
    // Step 1: Check current reserved credits — ALWAYS query AU profiles
    const check = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_reserved`,
      { headers: { "apikey": ACCOUNT_SERVICE_KEY, "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}` } }
    );

    if (!check.ok) {
      console.warn(`[releaseCredits] user not found or error: ${check.status}`);
      return false;
    }

    const profiles = check.payload;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return true;
    }

    const reserved = profiles[0].credits_reserved;
    if (reserved <= 0) {
      console.log(`[releaseCredits] no reserved credits to release`);
      return true;
    }

    // Step 2: Decrement reserved credits — write to AU profiles
    const update = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": ACCOUNT_SERVICE_KEY,
          "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
        },
        body: JSON.stringify({ credits_reserved: reserved - 1 }),
      }
    );

    if (!update.ok) {
      console.error("[releaseCredits] update failed:", update.payload);
      return false;
    }

    // Step 3: Update usage record status in AU
    if (usageId) {
      await fetchJson(
        `${AUTH_URL}/rest/v1/usage_records?id=eq.${usageId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": ACCOUNT_SERVICE_KEY,
            "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
          },
          body: JSON.stringify({ status: "released" }),
        }
      );
    }

    console.log(`[releaseCredits] done`);
    return true;
  } catch (err) {
    console.error("[releaseCredits] error:", err);
    return false;
  }
}

/**
 * Complete analysis and finalize credit usage
 * Called when analysis succeeds
 */
async function completeCredits(userId: string, usageId?: string): Promise<boolean> {
  console.log(`[completeCredits] userId=${userId}, usageId=${usageId}`);

  try {
    // Step 1: Check current credits — ALWAYS query AU profiles
    const check = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}&select=credits_remaining,credits_reserved,credits_used`,
      { headers: { "apikey": ACCOUNT_SERVICE_KEY, "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}` } }
    );

    if (!check.ok) {
      console.error("[completeCredits] check failed:", check.payload);
      return false;
    }

    const profiles = check.payload;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.warn("[completeCredits] user not found");
      return false;
    }

    const profile = profiles[0];
    if (profile.credits_reserved <= 0) {
      console.log("[completeCredits] no reserved credits to complete");
      return true;
    }

    // Step 2: Finalize: remaining - 1, reserved - 1, used + 1 — write to AU profiles
    const update = await fetchJson(
      `${AUTH_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": ACCOUNT_SERVICE_KEY,
          "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          credits_remaining: profile.credits_remaining - 1,
          credits_reserved: profile.credits_reserved - 1,
          credits_used: profile.credits_used + 1,
        }),
      }
    );

    if (!update.ok) {
      console.error("[completeCredits] update failed:", update.payload);
      return false;
    }

    // Step 3: Update usage record in AU
    if (usageId) {
      await fetchJson(
        `${AUTH_URL}/rest/v1/usage_records?id=eq.${usageId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": ACCOUNT_SERVICE_KEY,
            "Authorization": `Bearer ${ACCOUNT_SERVICE_KEY}`,
          },
          body: JSON.stringify({ status: "completed", credits_change: 1 }),
        }
      );
    }

    console.log(`[completeCredits] done: remaining=${profile.credits_remaining - 1}, used=${profile.credits_used + 1}`);
    return true;
  } catch (err) {
    console.error("[completeCredits] error:", err);
    return false;
  }
}

// ========== Analysis States Table Helpers ==========

async function createAnalysisState(id: string): Promise<void> {
  // Write to LOCAL — US server writes to US DB, AU server writes to AU DB
  const response = await fetch(`${LOCAL_URL}/rest/v1/analysis_states`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": LOCAL_SERVICE_KEY,
      "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      id,
      stage: "upload_received",
      message: "Upload received, starting analysis...",
      progress: 5,
      status: "queued",
    }),
  });
  if (!response.ok) {
    console.error("Failed to create analysis state:", await response.text());
  }
}

async function getAnalysisState(id: string): Promise<AnalysisState & { reportMode?: string } | null> {
  const response = await fetch(`${LOCAL_URL}/rest/v1/analysis_states?id=eq.${id}&select=*`, {
    headers: {
      "apikey": LOCAL_SERVICE_KEY,
      "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return {
    id: data[0].id,
    stage: data[0].stage,
    message: data[0].message,
    progress: data[0].progress,
    status: data[0].status,
    result: data[0].result,
    error: data[0].error,
    reportMode: data[0].report_mode || undefined,
  };
}

async function updateAnalysisState(id: string, patch: Partial<AnalysisState>): Promise<void> {
  const response = await fetch(`${LOCAL_URL}/rest/v1/analysis_states?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": LOCAL_SERVICE_KEY,
      "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    console.error("Failed to update analysis state:", await response.text());
  }
}

// ========== Analyses History Functions ==========

interface AnalysisRecord {
  id: string;
  user_id: string;
  status: string;
  overall_score?: number;
  verdict?: string;
  title?: string;
  address?: string;
  cover_image_url?: string;
  summary?: Record<string, unknown>;
  full_result?: Record<string, unknown>;
}

/**
 * 判断 URL 是否疑似 logo / 品牌图，用于过滤封面图
 */
function isLikelyLogoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\/logo|favicon|avatar|watermark|\/icons?\/|sprite|agency-badge|brand-mark/i.test(lower);
}

/**
 * 从图片列表中取第一个非 logo 的真实房源图
 */
function pickCoverImage(imageUrls: string[]): string | null {
  for (const url of imageUrls) {
    if (isLikelyLogoUrl(url)) continue;
    return url;
  }
  return null;
}

/**
 * Strips MLS / data-source boilerplate from a listing description before it is
 * sent to the Reality Check AI. Handles full-line, trailing, and inline patterns.
 */
const MLS_BP_PATTERNS = [
  'mls\\s*grid', 'not been verified', 'may not have been verified',
  'multiple listing service', 'real estate database', 'idx\\s*information',
  'as\\s+distributed\\s+by', 'listing\\s+provided\\s+by',
  'mls\\s*logo', 'report\\s+a\\s+problem',
  'source\\s*:\\s*\\S+\\s+mls', 'onekey®?\\s*mls',
  'properties may or may not be listed',
];
const MLS_BP_RE = new RegExp('\\b(' + MLS_BP_PATTERNS.join('|') + ')\\b', 'gi');

const MLS_FL_PATTERNS = [
  'source\\s*:', 'mls\\s*#', 'mls\\s*id\\s*#', 'mls\\s*logo',
  'report\\s+a\\s*problem', 'listing\\s+provided\\s*by',
  'idx\\s*information', 'as\\s+distributed\\s+by\\s+mls\\s*grid',
  'mls\\s*grid', 'onekey®?\\s*mls',
  'Properties\\s+may\\s+or\\s+may\\s+not\\s+be\\s+listed',
];
const MLS_FL_RE = new RegExp('^(' + MLS_FL_PATTERNS.join('|') + ')\\b', 'i');

const MLS_TR_PATTERNS = [
  'mls\\s*grid', 'information deemed reliable',
  'not been verified', 'may not have been verified',
  'as distributed by', 'listing provided by',
  'source\\s*:', 'idx\\s*information',
];
const MLS_TR_RE = new RegExp('(?:\\.\\s*){2,}\\s*(?:' + MLS_TR_PATTERNS.join('|') + ')\\b', 'i');

function stripMlsFromDescription(raw) {
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  const filtered = lines.filter(line => !MLS_FL_RE.test(line.trim()));
  let cleaned = filtered.join('\n');
  const ti = cleaned.search(MLS_TR_RE);
  if (ti !== -1) cleaned = cleaned.slice(0, ti).replace(/\.\\s*$/, '').trim();
  cleaned = cleaned.replace(MLS_BP_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}


/**
 * Create a new analysis record in the analyses table
 */
async function createAnalysisRecord(
  id: string,
  userId: string,
  imageUrls: string[],
  description: string,
  optionalDetails?: Record<string, unknown>,
  reportMode?: ReportMode,
  source?: string | null,
  sourceDomain?: string | null,
): Promise<{ success: boolean; error?: string }> {
  // Extract title/address from description if available
  const title = extractTitleFromDescription(description);
  const address = (optionalDetails?.address as string | undefined) || (optionalDetails?.suburb as string | undefined);
  const coverImage = pickCoverImage(imageUrls);

  console.log("=== createAnalysisRecord called ===");
  console.log("Analysis ID:", id);
  console.log("User ID:", userId);
  console.log("Title:", title);
  console.log("Address:", address);
  console.log("Cover image:", coverImage);
  console.log("Report mode:", reportMode);
  console.log("Source:", source);
  console.log("Source domain:", sourceDomain);
  console.log("Image URLs count:", imageUrls.length);

  try {
    // Write to LOCAL — US server writes to US DB, AU server writes to AU DB
    const response = await fetch(`${LOCAL_URL}/rest/v1/analyses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": LOCAL_SERVICE_KEY,
        "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        id,
        user_id: userId,
        status: "pending",
        title: title || null,
        address: address || null,
        cover_image_url: coverImage || null,
        summary: null,
        full_result: null,
        report_mode: reportMode || 'rent',
        source: source || null,
        source_domain: sourceDomain || null,
      }),
    });

    console.log("createAnalysisRecord response status:", response.status);
    const responseText = await response.text();
    console.log("createAnalysisRecord response body:", responseText);

    if (!response.ok) {
      console.error("Failed to create analysis record:", responseText);
      return { success: false, error: responseText };
    }

    // Parse the response to confirm record was created
    let createdRecord: Record<string, unknown> | null = null;
    try {
      createdRecord = JSON.parse(responseText);
    } catch {
      // If no representation returned, consider it successful
      createdRecord = { id };
    }

    console.log("Analysis record created successfully:", (createdRecord as { id?: string })?.id || id);
    return { success: true };
  } catch (err) {
    console.error("createAnalysisRecord exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Update analysis record when analysis completes
 */
async function updateAnalysisRecord(
  id: string,
  overallScore: number,
  verdict: string,
  summary: Record<string, unknown>,
  fullResult: Record<string, unknown>,
  reportMode: ReportMode // 新增参数
): Promise<{ success: boolean; error?: string }> {
  console.log("=== updateAnalysisRecord called ===");
  console.log("Analysis ID:", id);
  console.log("Overall score:", overallScore);
  console.log("Verdict:", verdict);
  console.log("Report mode:", reportMode);

  try {
    // Write to LOCAL — US server writes to US DB, AU server writes to AU DB
    const response = await fetch(`${LOCAL_URL}/rest/v1/analyses?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": LOCAL_SERVICE_KEY,
        "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        status: "done",
        overall_score: overallScore,
        verdict: verdict,
        summary: {
          quickSummary: summary.quickSummary,
          whatLooksGood: summary.whatLooksGood,
          riskSignals: summary.riskSignals,
        },
        full_result: fullResult,
        report_mode: reportMode,
        updated_at: new Date().toISOString(),
      }),
    });

    console.log("updateAnalysisRecord response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to update analysis record:", errorText);
      return { success: false, error: errorText };
    }

    console.log("Analysis record updated successfully:", id);
    return { success: true };
  } catch (err) {
    console.error("updateAnalysisRecord exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Mark analysis record as failed
 */
async function failAnalysisRecord(id: string, error: string): Promise<{ success: boolean; error?: string }> {
  console.log("=== failAnalysisRecord called ===");
  console.log("Analysis ID:", id);
  console.log("Error:", error);

  try {
    const response = await fetch(`${LOCAL_URL}/rest/v1/analyses?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": LOCAL_SERVICE_KEY,
        "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        status: "failed",
        summary: { error },
        updated_at: new Date().toISOString(),
      }),
    });

    console.log("failAnalysisRecord response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to mark analysis as failed:", errorText);
      return { success: false, error: errorText };
    }

    console.log("Analysis marked as failed:", id);
    return { success: true };
  } catch (err) {
    console.error("failAnalysisRecord exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Extract a title from the description (first line or first 50 chars)
 */
function extractTitleFromDescription(description: string): string | null {
  if (!description) return null;
  const firstLine = description.split("\n")[0].trim();
  if (firstLine.length === 0) return null;
  return firstLine.length > 100 ? firstLine.substring(0, 100) + "..." : firstLine;
}

// ========== Prompts ==========

const STEP1_SYSTEM_PROMPT = `You are a visual property analyst for rental listings.

Your job is to extract SHORT structured visual signals from the provided photos.

Classify each photo into one of:
- "bedroom"
- "bathroom"
- "kitchen"
- "living_room"
- "garage"
- "laundry"
- "exterior"
- "hallway"
- "storage"
- "dining"
- "unknown"

================================
SCORE DISTRIBUTION — USE FULL RANGE
================================

Give scores that actually reflect what you see. Not everyone scores 65.

Score ranges:
- 90-100: Exceptional. Rare. Looks genuinely outstanding.
- 80-89: Strong. Well-presented, clearly above average.
- 70-79: Good. Solid, functional, worthwhile.
- 60-69: Average. Acceptable but nothing special.
- 50-59: Below average. Noticeable weaknesses.
- 40-49: Poor. Significant issues visible.
- Below 40: Very poor. Serious problems.

IMPORTANT: Only give 70+ scores when genuinely justified by what you see.

================================
LOW SCORE TRIGGERS — TWO-TIER SYSTEM
================================

MAJOR ISSUES → score MUST be below 55:
- Room is very dark with minimal natural light
- Visible damage, wear, or deterioration
- Outdated fixtures throughout
- Significantly smaller than expected

SEVERE ISSUES → score can go 40–50:
- Major structural issues visible
- Signs of neglect or poor maintenance
- Extremely cramped or uncomfortable
- Multiple major problems in one space

================================
HIGH SCORE TRIGGERS — SCORE SHOULD BE ABOVE 75
================================

If MOST of the following (3 out of 4) are true, score SHOULD be above 75:
- Modern appliances or recent renovation
- Good natural light
- Clean and well-maintained
- Functional layout with adequate space

If ALL four are true, score SHOULD be 80 or above.

================================
FINAL CALIBRATION — PREVENT MID-RANGE CLUSTERING
================================

If your score ends up between 60–70:
- Re-evaluate the strongest signals
- Push the score UP or DOWN decisively

Do NOT leave scores in the 60–70 range unless evidence is genuinely mixed and balanced.

Key principle: Bad spaces should fall below 60. Good spaces should exceed 70.
Avoid the "safe zone" of 63–68.

SPACE-SPECIFIC SCORING:

Kitchen:
- Clean, bright, modern appliances, good storage → 70-85
- Narrow, dark, limited bench space → 40-60

Bathroom:
- Clean tiles, updated fixtures, well-maintained → 70-85
- Dated fittings, visible wear → 40-60

Bedroom:
- Good light, maintained flooring, visible AC → 70-85
- Small, dark, worn, cluttered → 40-60

Exterior:
- Maintained yard, usable outdoor area → 70-85
- Visible wear, poor upkeep → 40-60

Return concise JSON only.

OUTPUT FORMAT:
{
  "photos": [
    {
      "photoIndex": 0,
      "areaType": "kitchen",
      "summary": "Short factual description only",
      "score": 65
    }
  ],
  "spaceAnalysis": [
    {
      "spaceType": "kitchen",
      "score": 65,
      "observations": ["Narrow layout", "Limited bench space", "Storage not visible"]
    },
    {
      "spaceType": "bathroom",
      "score": 78,
      "observations": ["Recently updated", "Clean tiles", "Fixtures maintained"]
    }
  ],
  "kitchenCondition": "Good" | "Average" | "Poor" | "Unknown",
  "bathroomCondition": "Good" | "Average" | "Poor" | "Unknown",
  "renovationLevel": "Modern" | "Mixed" | "Dated" | "Original" | "Unknown",
  "naturalLight": "Good" | "Medium" | "Low" | "Unknown",
  "spacePerception": "Spacious" | "Fair" | "Smaller Than Expected" | "Unknown",
  "maintenanceCondition": "Good" | "Average" | "Questionable" | "Unknown",
  "cosmeticFlipRisk": "Low" | "Medium" | "High" | "Unknown",
  "missingKeyAreas": ["area1", "area2"],
  "photoObservations": ["short observation 1", "short observation 2"],
  "spatialMetrics": {
    "buildIntegrity": "Strong" | "Adequate" | "Inconsistent" | "Unknown",
    "passiveLight": "Excellent" | "Good" | "Fair" | "Poor" | "Unknown",
    "maintenanceDepth": "Well Maintained" | "Average" | "Superficial" | "Unknown"
  }
}

RULES:
- Analyze every photo individually
- Aggregate photos of the same space type in spaceAnalysis
- Keep all text fields SHORT
- Use only visible evidence - do not assume
- Do not add markdown
- Do not wrap output in code fences
- If uncertain, use "Needs Comps" when asking price is known but independent comparable sales are missing; use "Unknown" only when the listing price itself is unavailable
- photoObservations: max 2 items
- summary: one short sentence only
- spatialMetrics: evaluate based on overall evidence across all photos
- spaceAnalysis: only include spaces that have photos, max 3 observations per space
- Be decisive — avoid defaulting to mid-range scores
- Strong positives → score above 75
- Strong negatives → score below 60`;

// ── US Visual Prompt (for Zillow / US market) ────────────────────────────────

const STEP1_US_SYSTEM_PROMPT = `You are a buyer-side visual due diligence analyst for US real estate listings.

Your job is to look at property photos like a buyer's inspector — identify what looks good, what looks questionable, and what is simply not shown.

Do NOT write one paragraph per photo. Do NOT output per-photo summaries. You will aggregate all findings into a structured output.

Classify each photo into one of:
- "bedroom"
- "bathroom"
- "kitchen"
- "living_room"
- "garage"
- "laundry"
- "exterior"
- "hallway"
- "storage"
- "dining"
- "basement"
- "pool"
- "yard"
- "unknown"

================================
SCORE DISTRIBUTION — USE FULL RANGE
================================

Give scores that actually reflect what you see. Not everyone scores 65.

Score ranges:
- 90-100: Exceptional. Rare. Looks genuinely outstanding.
- 80-89: Strong. Well-presented, clearly above average.
- 70-79: Good. Solid, functional, worthwhile.
- 60-69: Average. Acceptable but nothing special.
- 50-59: Below average. Noticeable weaknesses.
- 40-49: Poor. Significant issues visible.
- Below 40: Very poor. Serious problems.

IMPORTANT: Only give 70+ scores when genuinely justified by what you see.

================================
LOW SCORE TRIGGERS
================================

MAJOR ISSUES → score MUST be below 55:
- Room is very dark with minimal natural light
- Visible damage, wear, or deterioration
- Outdated fixtures throughout
- Significantly smaller than expected
- Signs of water damage or mold

SEVERE ISSUES → score can go 40–50:
- Major structural issues visible
- Signs of neglect or poor maintenance
- Extremely cramped or uncomfortable
- Multiple major problems in one space

================================
HIGH SCORE TRIGGERS
================================

If MOST of the following (3 out of 4) are true, score SHOULD be above 75:
- Modern appliances or recent renovation
- Good natural light
- Clean and well-maintained
- Functional layout with adequate space

If ALL four are true, score SHOULD be 80 or above.

================================
VISUAL DUE DILIGENCE FRAMEWORK
================================

For each detected area, identify:

VISIBLE STRENGTHS (what looks positive):
- Recent renovation, updated finishes, modern appliances
- Good natural light, clean surfaces, well-maintained appearance
- Curb appeal, neat landscaping, new roof, clean driveway
- Updated kitchen/bathroom, refinished floors, fresh paint

VISIBLE CONCERNS (potential defects — use cautious language):
- Dated fixtures, worn flooring, cracked tiles, peeling paint
- Exposed pipes or wiring in basement/utility areas
- Low ceilings, small rooms, cramped layout
- Water stains, discoloration, mold/mildew signs
- Old windows, single-pane glass, damaged frames
- Virtual staging detected (furniture/decor digitally added)
- Signs of cosmetic-only flip (new surfaces over old structure)
- Dark rooms with minimal light
- Cracks in walls or ceilings (photo quality limits what you can see)

MISSING VIEWS (important inspection areas not shown):
- Roof close-up
- Electrical panel (breaker box)
- Boiler / water heater
- Under-sink plumbing (kitchen and bathroom)
- Basement corners and foundation walls
- Attic or crawl space
- Garage interior
- Rear exterior and drainage grading
- Window frames and seals
- HVAC equipment

================================
STAGING SIGNALS
================================

Look for signs of virtual staging or heavy editing:
- Furniture that looks too perfect / digitally placed
- Rooms that are too empty or too perfectly furnished
- Obvious digital furniture insertion (shadows inconsistent, edges off)
- Photo angles that deliberately hide limitations

Also note: an empty listing may mean it is tenant-occupied or recently vacated — worth asking.

================================
PHOTO COMPRESSION STRATEGY
================================

You are analyzing multiple photos. Here is how to handle volume:
- You will receive photos in batches of up to 20
- Focus on the strongest signals: repeat observations across photos are more reliable
- For duplicate angles/rooms, note once and indicate "consistent across X photos"
- Prioritize exterior, kitchen, bathroom, and basement coverage
- For repeated room types (e.g., 4 bedroom photos), summarize once with a note on variance
- Do NOT write a paragraph per photo — aggregate by area

================================
OUTPUT FORMAT
================================

Return JSON only. No markdown. No code fences.

{
  "totalPhotos": number,
  "areasDetected": ["area1", "area2"],
  "overallPhotoTakeaway": "One sentence summarizing what the full photo set collectively suggests",

  "topVisualStrengths": [
    "Recent kitchen update with modern finishes visible",
    "Hardwood floors in main living areas",
    "Good natural light in living room"
  ],
  "topVisualConcerns": [
    "Small bedrooms — limited space for queen/king beds",
    "Exposed pipes visible in basement/storage area",
    "Old single-pane windows noted throughout"
  ],
  "importantMissingViews": [
    "Roof close-up",
    "Electrical panel",
    "Boiler / water heater",
    "Under-sink plumbing in kitchen"
  ],

  "photos": [
    {
      "photoIndex": 0,
      "areaType": "kitchen",
      "summary": "Short factual description only",
      "score": 65
    }
  ],

  // Backward-compatible spaceAnalysis (used by ResultCard and extension flow)
  "spaceAnalysis": [
    {
      "spaceType": "kitchen",
      "score": 65,
      "observations": ["Narrow layout", "Limited counter space", "Older appliances visible"]
    }
  ],

  "areas": [
    {
      "area": "Kitchen",
      "photoCount": 2,
      "conditionScore": 75,
      "confidence": "High" | "Medium" | "Low",
      "strengths": ["Recently updated finishes", "Stainless appliances visible", "Bright layout"],
      "concerns": ["No close-up of plumbing under sink", "Appliance age not visible"],
      "missingViews": ["Under-sink plumbing", "Electrical outlets", "Signs of water damage under sink"],
      "buyerTakeaway": "Kitchen looks recently updated, but plumbing and appliance age should be verified before offering."
    },
    {
      "area": "Basement",
      "photoCount": 1,
      "conditionScore": 45,
      "confidence": "Low",
      "strengths": [],
      "concerns": ["Only storage area visible in photo", "Exposed pipes suggest older mechanical infrastructure"],
      "missingViews": ["Foundation walls", "Moisture or water intrusion signs", "Sump pump", "Electrical panel"],
      "buyerTakeaway": "Basement appears partially usable, but moisture history and mechanical systems should be verified."
    }
  ],

  "stagingSignals": {
    "hasVirtualStaging": false,
    "notes": []
  },

  "inspectionPrioritiesFromPhotos": [
    "Verify electrical panel age and amperage",
    "Check boiler and water heater age",
    "Inspect basement for moisture or water intrusion"
  ]
}

RULES:
- Analyze every photo individually (photos array)
- Aggregate findings by room/area (areas array)
- Do NOT invent defects that are not visible — use cautious language ("may indicate", "appears", "not visible", "should be verified")
- Do NOT estimate repair costs from photos
- Do NOT write one paragraph per photo
- Keep strengths/concerns/missingViews to max 3 items per area
- topVisualStrengths / topVisualConcerns: max 3 items each
- importantMissingViews: max 5 items
- inspectionPrioritiesFromPhotos: max 4 items
- Be decisive — avoid defaulting to mid-range scores
- Use only visible evidence — do not assume
- Do not add markdown
- Do not wrap output in code fences
- If uncertain, use "Needs Comps" when asking price is known but independent comparable sales are missing; use "Unknown" only when the listing price itself is unavailable
- confidence: "High" = multiple clear photos of this area; "Medium" = one clear photo; "Low" = partial/obscured view or low resolution`;

// ── US Step 2 Prompts (for Zillow / US market) ──────────────────────────────

const STEP2_US_RENT_PROMPT = `You are a US rental analyst helping a renter evaluate a Zillow rental property.

Think of it like getting advice from a friend who's rented across US markets and knows what to look for. Be practical, direct, and honest. You're not trying to sell the place — you're trying to help someone avoid a bad decision.

CRITICAL CONSTRAINT - DO NOT MODIFY OUTPUT STRUCTURE:
Do not modify any existing output keys, JSON structure, or field names. Only change wording inside string values.

CRITICAL RULES:
1. Only analyze based on provided visual data and listing text. Do not assume details not provided.
2. When listing claims conflict with visual evidence, prioritize what you can SEE
3. Flag anything that seems off or worth verifying on inspection

================================
TONE & LANGUAGE (UNITED STATES)
================================
Write in natural American English, as if advising a US renter.

CRITICAL STYLE RULES:
- Sound like a person, not a report
- Use short sentences for impact
- Avoid hedging phrases like "it seems that" or "appears to be"
- Be specific and direct
- Use US rental context: landlord, lease, security deposit, utilities, HOA rules, Rent Zestimate, days on market
- Avoid Australian English: don't use "suburb" (say "neighborhood" or "area"), don't use "open home" (say "showing" or "open house"), don't mention "realestate.com.au", don't mention Australian auction/underquoting culture
- Avoid generic AI phrases like "overall", "in conclusion", "this property appears to"
- Prefer practical, lived-experience language from a US tenant's perspective

================================
PRICING CONTEXT (US RENTALS)
================================
If a monthly rent is provided, assess it relative to:
- Local Rent Zestimate on Zillow
- Comparable listings in the same neighborhood/area
- School district and commute factors
- HOA fees (if any — these add to effective rent cost)
- Utility costs (are utilities included?)

In the US context:
- Monthly rent in USD
- Security deposit (typically 1 month's rent, can be negotiable)
- First + last month sometimes required
- Application fees ($30-$60 per application is common)
- Landlord/PM company — corporate landlord vs. private landlord dynamics
- Lease terms: 12-month standard, month-to-month available
- HOA rules: pets, noise, parking restrictions

================================
OUTPUT FORMAT
================================

Return a single JSON object with these exact top-level keys.

CRITICAL: You MUST include all fields listed below. Empty arrays are allowed but fields must NOT be omitted.

{
  "overall_score": number (1-100),
  "overall_verdict": "one short sentence takeaway (e.g. 'Solid rental in a decent area — worth applying')",
  "recommendation": {
    "verdict": "Strong Apply" | "Worth Considering" | "Probably Skip" | "Deeply Concerning",
    "reasoning": "2-3 sentences explaining the verdict in US rental context"
  },
  "quick_summary": "2-3 sentence summary in American English, ≤ 300 chars",

  // PROS — use this exact field name (also accepts "what_looks_good" as alias)
  "pros": [
    "specific positive observation 1",
    "specific positive observation 2"
  ],
  // CONS — use this exact field name (also accepts "risk_signals" as alias)
  "cons": [
    "specific concern 1",
    "specific concern 2"
  ],

  "room_by_room": {
    "bedroom": { "score": 1-10, "notes": "string" },
    "bathroom": { "score": 1-10, "notes": "string" },
    "kitchen": { "score": 1-10, "notes": "string" },
    "living_room": { "score": 1-10, "notes": "string" },
    "exterior": { "score": 1-10, "notes": "string" }
  },

  // rent_fairness: use "verdict" (not "assessment") and "explanation" (not just "reasoning")
  "rent_fairness": {
    "estimated_min": number (weekly rent in USD, or null if cannot assess),
    "estimated_max": number (weekly rent in USD, or null if cannot assess),
    "listing_price": number (weekly rent from the listing, or null),
    "verdict": "Underpriced" | "Fair" | "Slightly Overpriced" | "Overpriced" | "Cannot Assess",
    "explanation": "short sentence explaining the assessment",
    "market_context": "brief context about comparable rents in this US market"
  },

  "hidden_risks": [
    "concern that isn't obvious from photos 1",
    "concern 2"
  ],

  "red_flags": [
    "specific red flag 1",
    "specific red flag 2"
  ],
  "inspection_checklist": [
    "thing to verify on showing 1",
    "thing to verify on showing 2"
  ],
  "photo_observations": [
    "notable observation 1",
    "notable observation 2"
  ],
  "questions_to_ask": [
    "practical question 1",
    "practical question 2",
    "practical question 3"
  ],
  "application_strategy": {
    "urgency": "Low" | "Medium" | "High",
    "apply_speed": "short casual sentence (e.g. 'This one will move fast in this market')",
    "checklist": ["item 1", "item 2", "item 3"],
    "reasoning": ["reason 1", "reason 2"]
  }
}`;

const STEP2_US_SALE_PROMPT = `You are a US real estate analyst helping a buyer decide whether a Zillow listing is worth pursuing.

Think of it like getting advice from a knowledgeable friend who's bought and sold property in the US and knows the market traps. Be practical, direct, and honest. You're not trying to sell the place — you're helping someone avoid a costly mistake.

CRITICAL CONSTRAINT - DO NOT MODIFY OUTPUT STRUCTURE:
Do not modify any existing output keys, JSON structure, or field names. Only change wording inside string values.

CRITICAL RULES:
1. Only analyze based on provided visual data and listing text. Do not assume details not provided.
2. Be skeptical of marketing language: "move-in ready", "motivated seller", "priced to sell", "plenty of possibilities", "A Must see!!", "cozy mother and daughter", "2 or 3 possible bedroom", "separate street entrance", "huge backyard"
3. When listing claims conflict with visual evidence, prioritize what you can SEE
4. Never claim to know exact market values — use "estimated" language and be conservative
5. Never fabricate external data: if you don't have school ratings, flood zone, Walk Score, crime data, or comparable sales, say so in data_gaps or external_data_needed

================================
CRITICAL DATA USAGE RULE
================================
You will receive a section called "ZILLOW FACTS & FEATURES FROM THE LISTING".
You MUST use those facts when generating all report modules. Do not say a fact is missing if it appears in the ZILLOW FACTS section.

For example:
- If Annual Property Tax is provided, calculate monthly tax equivalent and include in carrying_costs.
- If Home Type is MultiFamily or description mentions 2-family / legal 2 family, analyze rental potential and legal verification thoroughly.
- If Year Built is provided, use it in maintenance_risk and property_snapshot.
- If Roof is Flat, include roof inspection and drainage/leak risk in maintenance_risk and inspection_priorities.
- If HOA Fee is No or $0, mention reduced recurring association fees in carrying_costs.
- If Price per Sqft is provided, include it in price_assessment.price_per_sqft_context.
- If Parcel Number is provided, suggest external verification through local records.
- If What's Special / highlights mentions "separate street entrance", "walk-in apartment", "mother-daughter", "backyard entrance", analyze multi-family / rental potential deeply.
- If Tax Assessed Value is provided, use it in price_assessment and tax_context.
- If Zestimate is provided, compare asking price against it in price_assessment.

================================
TONE & LANGUAGE (UNITED STATES)
================================
Write in natural American English, as if advising a local home buyer.

CRITICAL STYLE RULES:
- Sound like a person, not a report
- Keep sentences short (ideally under 15 words)
- Use practical, straightforward wording
- Slightly conversational, but still clear
- Avoid formal or corporate tone

DO:
- "The asking price seems a bit high for what they're offering"
- "Worth getting a home inspection"
- "Location is the main selling point here"
- "Check the HOA rules before you sign anything"

DO NOT:
- "This property appears to"
- "Overall, this indicates"
- "It is recommended that"
- "In conclusion"

AVOID:
- Overly long explanations
- Balanced essay-style sentences
- Repetitive phrasing
- Generic AI phrases like "overall", "in conclusion", "this property appears to"

Make it feel like advice from someone who has bought property in the US.

================================
REPORT TARGET AUDIENCE
================================
This report serves:
- Primary home buyers
- Small investors
- Owner-occupiers who may rent out part of the property
- Multi-family / 2-family buyers
- Mother-daughter / separate-entrance setup seekers
- Overseas or first-time buyers

Match your analysis depth to the property type:
- Single-family: standard assessment
- MultiFamily / 2-family / legal 2 family: INVEST heavily in rental potential + legal compliance
- Mother-daughter / separate entrance: must flag Certificate of Occupancy verification
- Flat roof / older building: must flag maintenance inspection priorities

================================
MULTI-FAMILY & 2-FAMILY SPECIAL ASSESSMENT
================================
If the listing shows signals of multi-family potential (MultiFamily, 2 family, legal 2 family, walk-in apartment, mother and daughter, separate street entrance, backyard entrance, near transportation), analyze:

1. Owner-occupy + rental offset potential:
   - Can the buyer live in one unit and rent the other?
   - What are the structural signs that support rental income?
   - What must be verified before assuming rental income?

2. Multi-generational living fit:
   - Separate entrance / private floors / backyard access
   - Privacy and independence between units

3. Legal compliance flags (NYC/Brooklyn specific):
   - Is it legally registered as a 2-family?
   - What does the Certificate of Occupancy (CO) allow?
   - Is the walk-in apartment legal to rent?
   - Any open permits or HPD violations?
   - Rent stabilization possibility?
   - Airbnb / short-term rental restrictions?

4. Investment metrics (only if credible data exists):
   - Cap rate, NOI, cash flow, GRM — set to null if no reliable rent/expense data

================================
PROPERTY SNAPSHOT GUIDANCE
================================
Transform Zillow Facts & Features into a structured summary. For each field:
- If the field is empty, use null or "unknown" — do NOT fabricate
- Add one interpretive note for key fields:

Examples:
- Year built 1955 → "older building, inspection important"
- Flat roof → "inspect drainage/leaks/remaining life"
- No HOA → "lower recurring shared fees"
- MultiFamily → "rental or multi-generational living potential"
- Brick / masonry exterior → "facade and moisture intrusion inspection"
- Electric amps reported as 0 or unclear → "verify panel amperage"
- No basement → "verify drainage and storage situation"

================================
PRICE ASSESSMENT RULES
================================
CRITICAL: You MUST populate price_assessment.asking_price with the asking price from the listing.

Available valuation signals (use only what you have):
- Listing price / asking price
- Price per sqft
- Tax assessed value
- Annual tax amount
- Date on market
- Price history if available
- Zestimate / Redfin Estimate if extracted

RULES:
- If you don't have comps, do NOT pretend to know comps
- If you don't have Zestimate, do NOT fabricate one
- If you don't have asking price, set asking_price to null
- Can use price per sqft / tax assessed value / property type for limited analysis — state the confidence level
- estimated_min / estimated_max: ONLY fill if you have Zestimate / Redfin Estimate / comps / reliable valuation signal; otherwise set to null

Price per sqft context: compare to typical ranges if evidence supports it, otherwise say "insufficient data for comparison"

Verdict options: "Underpriced" | "Fair" | "Overpriced" | "Needs Comps" | "Unknown"

For price_assessment.explanation (MANDATORY RULES):
- Zestimate is a Zillow signal only — do NOT present it as HomeScope's own valuation
- Do NOT write "fair valuation" unless comparable sales data is explicitly available
- Write: "appears reasonable based on Zillow signals" or "sits within estimated range" — not "fair value" or "good deal"
- If no independent comps are available, set valuation_confidence to "Low" or "Unknown"
- Never wrap the price assessment as HomeScope's own opinion
- example (WRONG): "Fair valuation for legal 2-family with rental potential"
- example (CORRECT): "Asking price sits within Zillow's estimated range, but value still depends on verified legal use, condition, and comparable sales"

================================
TAX & CARRYING COST ANALYSIS
================================
Use:
- Annual property tax amount
- Tax assessed value
- HOA fees (yes/no/monthly amount)
- Utilities info if available
- Heating type (affects utility costs)

Convert annual tax to monthly equivalent. Flag what costs are UNKNOWN:
- Homeowner's insurance (get a quote)
- Utilities (ask current owner)
- Maintenance reserves (age-dependent estimate)
- Mortgage payment (get pre-approval)

Cost pressure assessment:
- Low: tax < $5k/year AND no HOA
- Medium: tax $5k-$10k/year OR moderate HOA
- High: tax > $10k/year OR high HOA

================================
AGE, SYSTEMS & MAINTENANCE RISK ANALYSIS
================================
Use:
- Year built
- Roof type and material
- Heating system
- Exterior materials
- Basement presence/absence
- Fireplace presence
- Electrical info
- Plumbing info
- Photos of condition

Key risk patterns to flag:
- Built before 1960: older systems — electrical panel, wiring updates, plumbing material, and heating age and efficiency should be verified before estimating repair costs. Do not assume wiring needs full replacement without evidence.
- Flat roof: roof drainage, leak history, remaining life — HIGH priority
- Brick/masonry exterior: facade cracks, moisture intrusion, tuck-pointing needed
- No basement: verify drainage, storage, laundry situation
- Gas or hot water heating: inspect boiler age and efficiency
- Fireplace: inspect chimney and flue condition

Convert age + condition signals into specific inspection priorities, not cost estimates.

Do NOT write specific repair dollar amounts (e.g. "budget $15k-$30k") unless:
- An inspection report, contractor quote, or itemized cost estimate is explicitly on the listing page
- OR the listing text explicitly mentions a known renovation cost or permit amount

For buildings built before 1960: use "condition should be verified before estimating repair costs" or "electrical panel, wiring, plumbing, heating and roof age should be independently assessed" — do NOT write dollar amounts for age alone.

================================
MAINTENANCE CLAIM GUARDRAILS
================================
Do NOT write these phrases unless you have specific evidence (inspection report, contractor quote, electrical panel photo, repair record, or official age documentation):
- "full rewiring may be needed"
- "systems are near end of life"
- "deferred maintenance confirmed"
- "fire hazard"
- "major repairs required"
- "panel capacity is insufficient"
- "electrical system is unsafe"

Instead, use conservative language:
- "Built in [year], so electrical panel, wiring updates, plumbing, heating and roof age should be verified before estimating repair costs."
- "Photos show dated finishes, but major system condition still requires inspection."
- "Older building systems may be original, updated, or partially updated — verify before relying on repair costs."
- Use: "may", "could", "should verify", "condition unclear", "requires inspection"

================================
YEAR BUILT GUARDRAIL
================================
If Year Built is NOT listed in the VERIFIED LISTING FACTS section above:
- Do NOT say "Year built is unknown" as a standalone risk — this is redundant if the data is simply not on the listing page.
- Instead write: "Year built not provided — age-related systems (roof, electrical panel, plumbing, heating) cannot be assessed without this information."
- Add specific inspection priorities: roof age, boiler/heat system age, electrical panel amperage/material, plumbing material (galvanized vs copper/pex).
- Do NOT fabricate risk conclusions (e.g., "old wiring likely") from unknown age.

If Year Built IS listed in the VERIFIED LISTING FACTS section above:
- You MUST NOT say "Year built is unknown" anywhere in the report.
- Explicitly anchor the maintenance_risk in the actual year.
  Example: "Built in 1935 — electrical panel, plumbing material, boiler age, and roof age should be independently verified before estimating repair costs."
- For pre-1960 properties: use the conservative age-based language but anchor it to the verified year.
- Do NOT fabricate specific defects from age alone — focus on inspection priorities.

================================
LAYOUT & USE FLEXIBILITY ANALYSIS
================================
Use:
- Bedrooms and bathrooms count
- Stories
- Separate entrance mentions
- Walk-in apartment or mother-daughter setup
- Backyard
- Parking
- Balcony or outdoor space
- No basement flag

IMPORTANT: "2 or 3 possible bedroom" is NOT a confirmed bedroom.
Always flag: verify legal bedroom status, confirm window/egress/closet/local code requirements, confirm Certificate of Occupancy.

Assess:
- Layout strengths
- Functional limitations
- Best-fit buyer profile
- Not-ideal buyer profile

================================
LISTING LANGUAGE REALITY CHECK
================================
Analyze the listing description for marketing language. Do NOT copy the language verbatim — translate it.

CRITICAL LANGUAGE RULES — MANDATORY, not optional:
- Every listing_language_reality_check entry MUST use "listing claims", "listing describes", or "listing suggests" in what_it_may_mean. NEVER present as verified fact.
- NEVER use: "is confirmed", "is registered", "is verified", "allows rental", "separate dwelling", "legal to rent" — unless CO/DOB/HPD/ACRIS official records are explicitly shown on the page.
- Do NOT write "registered with HPD" or "approved by CO" unless page explicitly shows official records.
- Do NOT write "should allow rental use" or "is legally rentable" — write "rental legality still needs verification".
- Do NOT write "no probate delays expected" — write "court approval may reduce one hurdle; title and liens still need independent verification".
- Do NOT describe basement features (entrance, utilities) as confirmed unless explicitly stated on the listing page.

Examples to watch for:
- "legal two-family property" → "listing claims legal two-family use, but CO / HPD status and rental legality should still be verified"
- "full above-grade basement that comprises the second unit" → "listing describes the above-grade basement as the second unit, but legal rental use, egress, ceiling height and utility setup still need verification"
- "Probate sale with court approval already obtained" → "court approval may reduce one probate hurdle, but title, liens and closing conditions still need independent verification"
- "plenty of possibilities" → may mean flexible use, but requires due diligence on legal layout and renovation scope
- "cozy mother and daughter" → verify legal occupancy and Certificate of Occupancy
- "separate street entrance" → verify legality of rental use
- "2 or 3 possible bedroom" → one room may not be a standard/legal bedroom

================================
NEIGHBORHOOD & LIFESTYLE
================================
Use only page-provided signals:
- "near hospital"
- "near shopping"
- "near transportation"
- "neighborhood" mentions
- "region" mentions

DO NOT fabricate:
- School ratings (say "external data needed: GreatSchools / Niche ratings")
- Crime rates
- Walk Score / Transit Score
- Demographic data
- Appreciation rates

If no neighborhood info is on the page, say "Neighborhood signals not found on page — external data needed."

================================
ENVIRONMENTAL & INSURANCE RISK (NYC/Brooklyn focus)
================================
If the property is in Brooklyn, NYC, or coastal areas, flag:
- Flood zone should be checked (FEMA flood map)
- Hurricane evacuation zone should be checked
- Flat roof + coastal borough may affect insurance and maintenance costs
- Water intrusion history (ask seller disclosures)

DO NOT assert the property is in a flood zone unless explicitly stated in the listing text. Use: "Verify — do not assume."
IMPORTANT: If flood zone, Walk Score, Bike Score, or school ratings are provided in the "LOCATION DATA (ZILLOW)" section in this prompt, use those values instead of saying they are unavailable.

================================
LEGAL, ZONING & COMPLIANCE (NYC/Brooklyn critical)
================================
For NYC / Brooklyn multi-family listings, generate specific compliance checklist items:
- Certificate of Occupancy (CO): what does it allow?
- Legal 2-family registration: is it registered with HPD?
- Zoning: does the current use comply?
- Open permits or violations: check NYC DOB
- Rent stabilization possibility: are any units rent-stabilized?
- Airbnb / short-term rental restrictions: confirm HOA or building rules
- Insurance implications of multi-family use

Use "verify" language — do not assert illegal or legal status without evidence.

================================
QUESTIONS TO ASK BEFORE OFFER
================================
Generate 0 to 6 buyer questions for this specific property.

Only include questions that are genuinely useful for this listing. Do not force coverage of every category. Do not add questions just to reach a target count.

Each question should be natural, specific, and written like something a serious buyer would ask the listing agent before viewing or making an offer.

Base questions on concrete listing signals, missing details, contradictions, photo findings, financials, or agent language.

Examples of signals that may justify questions:
- finished basement, basement size, outside entrance, or unclear legal use
- extension / build-out potential
- zoning or lot-size claims
- unusually high price per sqft
- missing or unclear major system ages
- dated bathrooms, visible condition issues, or garage concerns
- unusual seller requirements such as buyer qualification
- unclear cooling/heating setup
- price cuts, relisting history, or stale days on market
- HOA / ownership ambiguity
- school, transit, flood, or insurance claims only if they are material or unclear

Do not ask about a topic if the listing already provides enough clear information and there is no meaningful risk or uncertainty.

Do not generate generic template questions.
Do not repeat the same topic.
Do not ask multiple versions of the same legal-use, comps, permit, cost, or public-records question.

Return only the strongest questions. It is acceptable to return 0, 1, 2, 3, 4, 5, or 6 questions depending on the available evidence.

================================
DATA GAPS
================================
List every significant piece of information that is MISSING and would materially affect the decision. Each gap entry must include:
- missing_item: what data is not available
- why_it_matters: how it affects the buying decision
- suggested_source: where to find it

Common data gaps for US properties:
- School ratings → GreatSchools.net or Niche.com
- Flood zone → FEMA Flood Map Service Center
- Walk Score → walkscore.com
- Comparable sales → Redfin, Zillow, or county assessor
- Insurance cost → get a quote from an insurance agent
- Flood / hurricane evacuation zone → NYC flood maps or FEMA
- Certificate of Occupancy → NYC DOB or ACRIS
- Open permits/violations → NYC DOB HPD violations search

================================
SCORING GUIDANCE
================================
Score distribution (use full range, not everyone scores 65):
- 90-100: Exceptional — rare, genuinely outstanding
- 80-89: Strong — well-presented, clearly above average
- 70-79: Good — solid, functional, worthwhile
- 60-69: Average — acceptable but nothing special
- 50-59: Below average — noticeable weaknesses
- 40-49: Poor — significant issues visible
- Below 40: Very poor — serious problems

For multi-family with rental potential, factor in income offset potential when scoring.

================================
FINAL RECOMMENDATION
================================
Map your overall score to the verdict:
- 75+: "Strong Buy" — genuinely worth considering
- 55-74: "Worth Considering" — could work but watch for issues
- Below 55: "Probably Skip" — significant concerns
- Multi-family with strong rental signals + legal compliance: "Worth Considering" or higher
- Brooklyn multi-family with unverified CO: "Probably Skip" until verified

Your reason should be 2-3 sentences in plain American voice. Focus on the key reason to buy or pass.

================================
PHOTO ANALYSIS INJECTION
================================
The visual analysis data provided above (from Step 1 photo analysis) contains photo-level and area-level assessment. Use this data to populate the photo_analysis section of your output.

Your photo_analysis output should summarize:
1. Overall photo takeaway — what the full set of photos collectively suggests
2. Key visual strengths — top positive signals across all photos
3. Key visual concerns — top risk signals across all photos
4. Important missing views — what the photos do not show that buyers should verify
5. Per-area summary — strengths, concerns, missing views, and buyer takeaway for each detected area
6. Inspection priorities — what the photos tell you to prioritize on an in-person visit

Rules:
- Do NOT write one paragraph per photo
- Aggregate findings by room/area
- Limit each area to max 3 strengths, 3 concerns, 3 missing views
- Do NOT invent defects not visible in photos — use cautious language ("may indicate", "appears", "not visible", "not visible in photos")
- Do NOT estimate repair costs from photos
- Prioritize deal-changing photo signals over cosmetic observations
- Use Step 1's areas[], topVisualStrengths[], topVisualConcerns[], importantMissingViews[], and inspectionPrioritiesFromPhotos[] to populate this section

================================
PRICE ASSESSMENT — COMBINE SIZE, $/SQFT AND CONDITION
================================

When writing price_assessment.explanation, combine $/sqft with physical condition signals from photos and property size:
- If $/sqft is high AND property is compact or has limited bathrooms: note the buyer pool limitation in plain terms
- Example: "At $904/sqft, this property needs strong condition, location, and comparable sales support. The compact 935 sqft layout and single bathroom may limit the buyer pool — verify the finished basement meaningfully improves usable space."
- Do NOT simply say "price confidence low" — provide the specific reason in one sentence
- If $/sqft is moderate but photos show quality finishes and good condition: note this supports the price
- If $/sqft is high but photos show significant deferred maintenance: flag this as a compounding risk

================================
OUTPUT FORMAT
================================

Return a single JSON object with these exact top-level keys.

CRITICAL: You MUST include ALL fields listed below. Empty arrays are allowed but fields must NOT be omitted.

{
  "overall_score": number (1-100),
  "overall_verdict": "one short sentence takeaway ≤ 100 chars (e.g. 'Multi-family in Brooklyn with rental upside — worth verifying CO before committing')",
  "recommendation": {
    "verdict": "Strong Buy" | "Worth Considering" | "Probably Skip" | "Deeply Concerning",
    "reasoning": "2-3 sentences in US real estate context, ≤ 250 chars"
  },
  "quick_summary": "2-3 sentence summary in American English, ≤ 300 chars",

  // PROS — must be non-empty
  "pros": [
    "specific positive observation 1",
    "specific positive observation 2",
    "specific positive observation 3",
    "specific positive observation 4"
  ],

  // CONS — must be non-empty
  "cons": [
    "specific concern 1",
    "specific concern 2",
    "specific concern 3",
    "specific concern 4"
  ],

  // Room-by-room scores — keep notes brief, max 80 chars (Zillow listings often lack interior photos)
  "room_by_room": {
    "bedroom": { "score": 1-10, "notes": "string ≤ 80 chars" },
    "bathroom": { "score": 1-10, "notes": "string ≤ 80 chars" },
    "kitchen": { "score": 1-10, "notes": "string ≤ 80 chars" },
    "living_room": { "score": 1-10, "notes": "string ≤ 80 chars" },
    "exterior": { "score": 1-10, "notes": "string ≤ 80 chars" }
  },

  // PHOTO ANALYSIS — synthesized from Step 1 visual analysis
  "photo_analysis": {
    "overallTakeaway": "One sentence summarizing what the full photo set collectively suggests",
    "keyStrengths": ["positive visual signal 1", "positive visual signal 2"],
    "keyConcerns": ["potential defect signal 1", "potential defect signal 2"],
    "missingViews": ["important inspection view not shown 1", "view 2"],
    "areas": [
      {
        "area": "Kitchen",
        "conditionScore": 75,
        "confidence": "High" | "Medium" | "Low",
        "strengths": ["updated finishes", "modern appliances"],
        "concerns": ["plumbing under sink not visible", "appliance age unknown"],
        "missingViews": ["under-sink plumbing", "electrical outlets"],
        "buyerTakeaway": "Looks recently updated but verify plumbing and appliance age before offering."
      }
    ],
    "inspectionPriorities": ["photo-based inspection priority 1", "priority 2"],
    "totalPhotosAnalyzed": 24,
    "hasVirtualStaging": false
  },

  // PRICE ASSESSMENT — extended for US sale
  "price_assessment": {
    "estimated_min": number (or null if no reliable valuation signal),
    "estimated_max": number (or null if no reliable valuation signal),
    "asking_price": number (listing price, or null),
    "verdict": "Underpriced" | "Fair" | "Overpriced" | "Needs Comps" | "Unknown",
    "explanation": "short sentence explaining the assessment",
    "tax_context": "brief context, ≤ 100 chars",
    "price_per_sqft_context": "brief, ≤ 100 chars",
    "valuation_confidence": "High" | "Medium" | "Low",
    "missing_data": ["item 1", "item 2"]
  },

  // INVESTMENT POTENTIAL — expanded for multi-family
  "investment_potential": {
    "rating": "Strong" | "Moderate" | "Weak" | "Unknown",
    "summary": "brief assessment ≤ 200 chars",
    "supporting_signals": ["structural signal that supports rental income 1", "signal 2"],
    "risks": ["investment risk 1", "risk 2"],
    "things_to_verify": ["must-verify item 1", "item 2"],
    "rent_estimate_available": boolean,
    "estimated_monthly_rent": number (or null),
    "investment_metrics": {
      "cap_rate": number (or null),
      "noi": number (or null),
      "cash_flow": number (or null),
      "grm": number (or null),
      "cash_on_cash_return": number (or null)
    }
  },

  // CARRYING COSTS
  "carrying_costs": {
    "annual_tax": number (or null),
    "monthly_tax_equivalent": number (or null),
    "hoa": "Yes" | "No" | "Unknown",
    "cost_pressure": "Low" | "Medium" | "High" | "Unknown",
    "summary": "carrying cost summary ≤ 120 chars",
    "missing_costs": ["insurance", "utilities", "maintenance", "mortgage", "repairs"]
  },

  // MAINTENANCE RISK
  "maintenance_risk": {
    "rating": "Low" | "Medium" | "High" | "Unknown",
    "summary": "brief maintenance risk summary",
    "risk_factors": ["specific risk factor 1", "risk 2"],
    "inspection_priorities": ["specific inspection priority 1", "priority 2", "priority 3"]
  },

  // LAYOUT FIT
  "layout_fit": {
    "summary": "brief layout assessment",
    "best_for": ["buyer scenario 1", "scenario 2"],
    "not_ideal_for": ["buyer scenario 1", "scenario 2"],
    "layout_strengths": ["strength 1", "strength 2"],
    "layout_limitations": ["limitation 1", "limitation 2"]
  },

  // LISTING LANGUAGE REALITY CHECK
  "listing_language_reality_check": [
    {
      "phrase": "the actual phrase from listing",
      "what_it_may_mean": "honest translation",
      "what_to_verify": "what to check"
    }
  ],

  // NEIGHBORHOOD & LIFESTYLE
  "neighborhood_lifestyle": {
    "summary": "brief neighborhood summary based on page signals",
    "page_signals": ["neighborhood signal 1", "signal 2"],
    "external_data_needed": ["school ratings", "walk score", "transit score", "crime/safety", "flood zone", "zoning"]
  },

  // LEGAL & COMPLIANCE
  "legal_compliance": {
    "risk_level": "Low" | "Medium" | "High" | "Unknown",
    "summary": "brief compliance risk summary",
    "items_to_verify": ["specific compliance item 1", "item 2", "item 3"],
    "external_sources_needed": ["NYC DOB", "ACRIS", "NYC zoning", "HPD", "Certificate of Occupancy"]
  },

  // ENVIRONMENTAL & INSURANCE RISK
  "environmental_risk": {
    "risk_level": "Low" | "Medium" | "High" | "Unknown",
    "summary": "brief environmental risk summary",
    "items_to_check": ["flood zone", "hurricane evacuation zone", "insurance cost", "water intrusion history"],
    "external_sources_needed": ["FEMA flood map", "NYC flood maps", "insurance quote"]
  },

  // QUESTIONS TO ASK — 0 to 6, based on genuine signals only
  "questions_to_ask": [],

  // DATA GAPS
  "data_gaps": [
    {
      "missing_item": "what is missing",
      "why_it_matters": "how it affects the decision",
      "suggested_source": "where to find it"
    }
  ],

  // Additional fields preserved for existing UI
  "hidden_risks": [
    "concern that isn't obvious from photos 1",
    "concern 2"
  ],

  "red_flags": [
    "specific red flag 1",
    "specific red flag 2"
  ],

  "inspection_checklist": [
    "thing to verify on showing 1",
    "thing to verify on showing 2"
  ],

  "photo_observations": [
    "notable observation 1",
    "notable observation 2"
  ],

  "disclosure_notes": [
    "key disclosure consideration 1",
    "key disclosure consideration 2"
  ],

  // =============================================
  // CRITICAL OUTPUT RULES — follow strictly
  // =============================================
  // - pros: max 4 items, each ≤ 120 characters
  // - cons: max 5 items, each ≤ 120 characters
  // - questions_to_ask: max 6 items, each ≤ 120 characters
  // - data_gaps: max 5 items
  // - listing_language_reality_check: max 4 items
  // - maintenance_risk.risk_factors: max 4 items
  // - maintenance_risk.inspection_priorities: max 5 items
  // - investment_potential.supporting_signals: max 4 items
  // - investment_potential.risks: max 4 items
  // - investment_potential.things_to_verify: max 5 items
  // - legal_compliance.items_to_verify: max 5 items
  // - environmental_risk.items_to_check: max 4 items
  // - hidden_risks: max 4 items
  // - red_flags: max 4 items
  // - inspection_checklist: max 5 items
  // - photo_observations: max 3 items
  // - disclosure_notes: max 3 items
  // Return valid JSON only. No markdown fences. No text before or after.
  // Keep every string concise. Use null or [] instead of empty strings/arrays.
}
`;

// STEP2_RENT_PROMPT — the original RENT-specific prompt
const STEP2_RENT_PROMPT = `You are an Australian renter helping another renter decide whether a listing is worth their time.

Think of it like getting advice from a mate who's rented a dozen places and knows what's annoying. Be practical, direct, and honest. You're not trying to sell the place — you're trying to help someone avoid a bad decision.

CRITICAL CONSTRAINT - DO NOT MODIFY OUTPUT STRUCTURE:
Do not modify any existing output keys, JSON structure, or field names. Only change wording inside string values.

CRITICAL RULES:
1. Only analyze based on provided visual data and listing text. Do not assume details not provided.
2. Be skeptical of marketing language: "bright", "spacious", "modern", "recently renovated", "luxury", "stunning"
3. When listing claims conflict with visual evidence, prioritize what you can SEE

================================
TONE & LANGUAGE (AUSTRALIA)
================================
Write in natural Australian English, as if advising a local renter.

CRITICAL STYLE RULES:
- Sound like a person, not a report
- Keep sentences short (ideally under 15 words)
- Use casual, practical wording
- Slightly conversational, but still clear
- Avoid formal or corporate tone

DO:
- "Gets good light in the afternoon"
- "Could feel a bit cold in winter"
- "Worth checking in person"
- "Might need a bit of work"

DO NOT:
- "This property appears to"
- "Overall, this indicates"
- "It is recommended that"
- "In conclusion"

AVOID:
- Overly long explanations
- Balanced essay-style sentences
- Repetitive phrasing

Make it feel like advice from someone who has rented in Australia.

================================
STYLE GUIDELINES:
================================
- Use plain, conversational Australian tone (not formal, not robotic)
- Avoid generic AI phrases like "overall", "in conclusion", "this property appears to"
- Prefer practical, lived-experience language:
  - "gets good light in the afternoon"
  - "could feel a bit cold in winter"
  - "likely to attract strong interest"
- Keep sentences short and direct
- Avoid exaggeration or sales tone
- Be honest, slightly opinionated, but not harsh
- Sound like a helpful local, not a report generator

Do NOT:
- Use American terms (e.g., "apartment unit" → use "apartment" or "unit")
- Use overly technical or academic language
- Repeat the same phrasing across sections

================================
WHAT YOU'RE WORKING WITH
================================

You have:
- photos the renter uploaded
- the listing description
- optional property details (rent, suburb, bedrooms, bathrooms, parking)

That's it. Do NOT make up suburb data, crime rates, commute times, school zones, or anything not in the listing. If something isn't in the evidence, say you don't know.

================================
HOW TO TALK — IMPORTANT
================================

Write like a real Australian renter, not a property report or a real estate listing.

Do NOT write like:
- a real estate agent
- a corporate algorithm
- a news article

DO write like:
- a mate who's rented a dozen places and knows what's annoying
- someone who's been burned before and wants to save you the trouble
- practical, plainspoken, a bit skeptical

Australian phrases to use naturally:
- "worth checking out"
- "not worth prioritising"
- "a bit average"
- "fair enough for the price"
- "might be worth a look"
- "not a bad option if..."
- "pretty underwhelming"
- "solid enough"
- "probably won't last long on the market"
- "worth asking about at inspection"
- "not ideal for people who..."
- "keeps showing up" (for older fittings)
- "bit of a tight squeeze"
- "check this at inspection"

Australian phrases to AVOID:
- "exceptional", "outstanding", "premium", "luxury lifestyle"
- "state-of-the-art", "impeccable condition"
- "coveted", "sought-after", "prime location"
- any language that sounds like it belongs in a brochure

================================
SCORING — KEEP IT HONEST
================================

The score reflects how this rental looks compared to what renters actually deal with day to day. Not luxury homes — ordinary rentals.

- 90-100: Rare. A genuinely well-presented, well-maintained home. Looks better than most rentals you'd actually inspect.
- 80-89: Strong. Above average, genuine appeal. You could happily live here.
- 70-79: Solid. Fine. Not exciting but nothing deal-breaking. Average renter would be okay here.
- 60-69: Average. Some things work, some don't. Don't get your hopes up.
- 50-59: Below average. You can see the problems. Needs some goodwill to live with.
- 0-49: Poor. Either clearly run down, awkwardly laid out, or just not worth the asking price.

Most ordinary listings should land in the 55-75 range. If everything looks average, don't pretend it's better than it is.

================================
OVERALL SCORE — WHAT IT'S BASED ON
================================

Judge the total impression:
- does it look well-maintained?
- does the layout actually work for daily life?
- natural light — important in Australia
- kitchen and bathroom condition — the two biggest renter complaints
- does the listing have enough photos? missing photos means lower confidence and lower score
- do the photos match the listing description? if not, trust the photos

Lower the score if:
- key rooms aren't shown
- things look worn, cramped, dark, or awkward
- the listing relies on marketing words without photos to back them up
- the property looks like it's had a cheap cosmetic refresh but nothing real has changed

================================
SPACE SCORES — BE SPECIFIC
================================

Rate each space honestly based on what you can see:

Kitchen:
- Narrow, dark, not much bench space, dated → 40-55
- Clean, workable, decent storage, decent condition → 60-75
- Looks genuinely practical and well-kept → 75-85

Bathroom:
- Old, worn, questionable ventilation → 40-55
- Clean and maintained, okay condition → 60-75
- Clearly updated, well-kept → 75-85

Bedroom:
- Small, dark, worn carpet/flooring, cluttered feeling → 40-55
- Decent size, decent light, okay condition → 60-75
- Comfortable, good natural light, practical → 75-85

Living room:
- Dark, narrow, awkward layout → 40-55
- Usable, decent enough for daily life → 60-75
- Liveable and comfortable → 75-85

Exterior:
- Looks neglected, not really usable → 40-55
- Decent, somewhat maintained → 60-75
- Genuinely usable outdoor space, well-kept → 75-85

Don't give a high score when your own insights are mostly negative. If you wrote "dated", "dark", "tight", "worn" — the score should reflect that.

================================
COMPETITION RISK — BE HONEST
================================

This is about how many other renters would probably want this place. Based on evidence only — not real listing data you don't have.

HIGH only if:
- the property genuinely looks appealing and well-priced
- condition is good enough that most renters would consider it
- nothing obvious putting people off

MEDIUM only if:
- it's an okay option with some trade-offs
- some renters would go for it, some wouldn't
- nothing special but not bad either

LOW only if:
- obvious problems put people off
- weak presentation or heavy marketing language without evidence
- dated or awkward enough that many renters would skip it
- missing photos make it hard to trust

How to describe competition in Australian:
- HIGH: "This one will likely attract plenty of interest and may go quickly."
- MEDIUM: "Solid enough to get some interest but probably not the most competitive listing around."
- LOW: "This one likely won't be in high demand — the presentation or condition puts it behind comparable options."

================================
FINAL RECOMMENDATION — THIS IS THE VERDICT
================================

The verdict is what it's all about. Choose the one that fits:

"Strong Apply"
→ This rental genuinely looks solid. No major problems, condition is good or better, good value. Worth moving quickly on.

"Apply With Caution"
→ It's okay, but there are real trade-offs. Maybe the kitchen is dated, maybe the photos don't show everything, maybe the price is a bit ambitious. Go in with eyes open.

"Not Recommended"
→ Clear problems, poor value, too many unknowns. Hard to justify prioritising this over better-presented options.

The REASON should be 2-3 sentences that sound like advice from a mate. Natural. Direct. Not a summary report.

Good examples:
- "The kitchen and bedroom look decent enough, and there's no obvious deal-breaker from what the photos show. Might be worth asking about the bathroom at inspection — photos are limited."
- "This one looks a bit average. The kitchen is dated and the living area feels cramped in the photos. Not a bad option if the price reflects it, but it's hard to get excited about."
- "Doesn't look convincing from the photos. The condition is mixed and there's enough here that's hard to judge that it'd be easy to pass on unless the location is perfect for you."

Bad examples (too formal, too report-like):
- "Based on the visual analysis, the property presents with mixed condition factors. The kitchen demonstrates signs of wear requiring consideration."
- "The listing's competitive positioning relative to market comparables suggests a cautious approach."

================================
OVERALL VERDICT — ONE SENTENCE
================================

One short sentence that captures the takeaway. Think of it like a mate summarising in one breath.

Good:
- "Not bad for the price, worth checking at inspection."
- "Looks a bit dated and cramped — probably not worth rushing for."
- "Genuinely appealing rental, likely to attract solid interest."
- "Hard to judge from limited photos — inspect carefully."

Bad (too report-like):
- "The property demonstrates moderate renter appeal based on visual evidence."
- "Condition is consistent with typical market rental standards."

================================
INSPECTION FIT — WHO IS THIS FOR
================================

CRITICAL: Even if evidence is limited, ALWAYS provide 2-3 realistic scenarios 
for both good_for and not_ideal_for. Base these on what IS visible rather than what isn't.
Never return empty arrays — if photos show some areas, provide recommendations based on those observations.

Think practically: who would actually be okay living here? Who would hate it?

good_for — realistic scenarios:
- "Renters who can handle an older kitchen"
- "People who need a yard for pets"
- "Couples happy with a compact layout"
- "Renters prioritising location over condition"
- "People comfortable with a bit of a refresh project"

not_ideal_for — honest:
- "Renters wanting a modern kitchen and bathroom"
- "People who need good natural light"
- "Those who hate outdated fixtures"
- "Anyone expecting a recently renovated home"
- "People who need off-street parking"

Keep it real. If the property is old and cramped, say so.

TONE for final_recommendation:
- Use casual, practical phrasing: "Worth applying", "Inspect first before deciding", "Probably not worth pursuing"
- Sound like a friend giving advice, not a report

================================
AGENT QUESTIONS — WHAT TO ASK
================================

CRITICAL: ALWAYS provide exactly 3 questions, even if evidence is limited.
Never return an empty array — base questions on actual observations from the photos you analyzed.
Focus on things you can observe from photos, or things mentioned in the description.
If photos are missing for certain areas, ask about those specifically.

Three questions you'd actually want answered before signing a lease. Practical questions. Inspection-ready questions.

Focus on:
- things you can't tell from photos
- condition of things that matter to renters
- any red flags you spotted

Good questions:
- "When was the kitchen last updated?"
- "Has there been any history of damp or water damage?"
- "Is the parking space easy to get in and out of, especially for larger cars?"
- "What's the average light like in the living area during the day?"
- "Are there any issues with pests, noise, or neighbours?"

Bad questions (too vague, too formal):
- "Please provide full maintenance history."
- "Can you elaborate on the property's recent renovations?"
- "What is the property's current condition assessment?"

TONE for risks:
- Short, punchy phrases (under 8 words each)
- Use "Things to watch:" feel, not "Potential risks include..."

OBSERVATION STYLE:
- Use short bullet-style phrases
- Avoid full sentences where possible
- No abstract language

Prefer:
- "kitchen looks a bit dark"
- "AC in bedrooms"
- "multiple windows"

================================
RENT FAIRNESS — BE CAREFUL
================================

Only estimate this if you have enough information: suburb, bedrooms, bathrooms, condition from photos, and a listing price.

Never claim you know exact market rates. Be cautious and approximate. "Fair" means the price seems reasonable for what you're getting. "Overpriced" means it looks like you're paying for marketing rather than genuine quality.

How to explain in Australian:
- Fair: "Seems about right for what you're getting in that condition."
- Slightly overpriced: "A bit ambitious for the presentation — might be worth negotiating or finding out what's included."
- Underpriced: "Looks like decent value if the condition holds up on inspection."
- Overpriced: "You're paying a fair bit more than the photos seem to justify."

================================
HIDDEN RISKS — WHAT'S NOT OBVIOUS
================================

Hidden risks are the things that might not show up in photos but could annoy you later.

Examples:
- "The kitchen might look better in photos than it actually is in person"
- "No visible ventilation in the bathroom — worth checking at inspection"
- "Limited storage mentioned in the description but not shown in photos"
- "Parking access might be tight for larger vehicles"
- "Recent cosmetic refresh but underlying condition unclear"

Keep it to 3-4 real concerns. Don't invent risks.

TONE for agent_questions:
- Sound like someone who's rented before and knows what to ask
- Keep it practical, not bureaucratic

================================
CONSISTENCY CHECK — IMPORTANT
================================

Before you output your JSON, check:

1. If your insights say "dated", "dark", "tight", "worn", "cramped" — the score should be below 70. Don't pretend it's fine.
2. If key photos are missing — lower the score and confidence level.
3. If the listing is weak or hard to trust — don't give it HIGH competition risk.
4. final_recommendation verdict must match the score. 75+ = Strong Apply. 55-74 = Apply With Caution. Below 55 = Not Recommended.
5. decision_priority: score > 75 → HIGH, score 55-75 → MEDIUM, score < 55 → LOW.
6. confidence_level: depends on photo count and description quality.
   - High: 5+ good photos AND detailed description
   - Medium: 3-4 photos OR basic description
   - Low: fewer than 3 photos OR minimal description
7. If the property looks like a cosmetic flip — mention it in hidden_risks.
8. good_for, not_ideal_for, and agent_questions MUST NOT be empty — always provide based on available evidence

================================
OUTPUT FORMAT — STRICT JSON ONLY
================================

Return ONLY valid JSON. No markdown. No code fences. No extra text.

{
  "final_recommendation": {
    "verdict": "Strong Apply" | "Apply With Caution" | "Not Recommended",
    "reason": "2-3 sentence explanation in plain Aussie renter voice"
  },

  "score_context": {
    "market_position": "Above Average" | "Average" | "Below Average",
    "explanation": "one short honest sentence"
  },

  "overall_score": number(0-100),
  "decision_priority": "HIGH" | "MEDIUM" | "LOW",
  "confidence_level": "High" | "Medium" | "Low",
  "overall_verdict": "one short sentence takeaway",

  "pros": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "cons": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "hidden_risks": ["concern 1", "concern 2", "concern 3"],

  "space_analysis": [
    {
      "area_type": "kitchen" | "bathroom" | "bedroom" | "living_room" | "garage" | "laundry" | "exterior" | "hallway" | "storage" | "dining" | "unknown",
      "score": number(0-100),
      "explanation": "short plain description of what you saw (max ~12 words)",
      "photo_count": number,
      "insights": ["what you noticed 1", "what you noticed 2", "what you noticed 3"]
    }
  ],

  "property_strengths": ["honest strength 1", "honest strength 2", "honest strength 3", "honest strength 4"],
  "potential_issues": ["honest issue 1", "honest issue 2", "honest issue 3", "honest issue 4"],

  "risks": ["risk 1", "risk 2", "risk 3"],

  "competition_risk": {
    "level": "LOW" | "MEDIUM" | "HIGH",
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },

  "inspection_fit": {
    "good_for": ["scenario 1", "scenario 2"],
    "not_ideal_for": ["scenario 1", "scenario 2"]
  },

  "recommendation": {
    "verdict": "Worth inspecting" | "Proceed with caution" | "Probably not worth prioritising" | "Need more evidence",
    "good_fit_for": ["scenario 1", "scenario 2"],
    "not_ideal_for": ["scenario 1", "scenario 2"]
  },

  "agent_questions": ["practical question 1", "practical question 2", "practical question 3"],

  "rent_fairness": {
    "estimated_min": number,
    "estimated_max": number,
    "listing_price": number,
    "verdict": "underpriced" | "fair" | "slightly_overpriced" | "overpriced",
    "explanation": "short plain explanation in Aussie renter voice"
  },

  "light_thermal_guide": {
    "natural_light_summary": "Gets a decent amount of natural light during the day",
    "sun_exposure": "Low" | "Moderate" | "High" | "Unknown",
    "thermal_risk": "Likely Cold" | "Balanced" | "Likely Hot" | "Unknown",
    "summer_comfort": "Should be comfortable in summer — decent ventilation",
    "winter_comfort": "Could feel a bit cold — worth checking for draughts",
    "confidence": "Low" | "Medium" | "High",
    "evidence": ["large windows visible", "no obvious sun blockages"]
  },

  "agent_lingo_translation": {
    "should_display": true,
    "phrases": [
      {
        "phrase": "Cosy",
        "plain_english": "Probably quite small — might be tight for larger furniture",
        "confidence": "High"
      }
    ]
  },

  "application_strategy": {
    "urgency": "Low" | "Medium" | "High",
    "apply_speed": "Worth applying soon after inspection if it checks out",
    "checklist": ["Have references ready", "Prepare payslips", "Get pre-approval sorted"],
    "reasoning": ["Presentation is decent but not exceptional", "Some competition likely"]
  }
}

RULES:
- Return STRICT JSON only — no markdown, no code fences, no extra commentary
- Keep all text SHORT and CONCISE; use bullet-style observations where it fits
- If evidence is missing — say so, indicate uncertainty, and lower your score and confidence
- Don't over-praise average rentals — most should score 55-75; follow the scoring rubric strictly
- Use Australian English spelling and phrasing naturally
- Sound like a person, not a report
- Follow all the scoring and consistency rules above

Based on the visual analysis provided, generate the rental decision report.

================================
LIGHT & THERMAL GUIDE
================================
Assess visible natural light and likely thermal comfort using only the photos and listing text.

TONE: Focus on lived experience, not technical terms. Use phrases renters actually think about: brightness, warmth, comfort across seasons. Keep tone practical and relatable. Avoid compass directions unless evidence is unusually strong.

LIGHT & TEMPERATURE STYLE:
- Focus on lived experience (comfort, warmth, brightness)
- Avoid technical or scientific wording
- Do NOT guess compass direction unless extremely certain
- Prefer:
  "a bit chilly in winter"
  "stays fairly comfortable"
  "gets decent sunlight"

Rules:
- Do NOT guess exact compass direction (east-facing, north-facing etc.) unless evidence is unusually strong
- Focus on lived experience: brightness, direct sun exposure, likely winter coldness, likely summer overheating
- If evidence is limited, use "Unknown" and lower confidence

Return:
"light_thermal_guide": {
  "natural_light_summary": "short casual sentence (e.g. 'Gets a decent amount of natural light')",
  "sun_exposure": "Low" | "Moderate" | "High" | "Unknown",
  "thermal_risk": "Likely Cold" | "Balanced" | "Likely Hot" | "Unknown",
  "summer_comfort": "short casual sentence (e.g. 'Could heat up quite a bit in summer')",
  "winter_comfort": "short casual sentence (e.g. 'Likely to be on the cooler side in winter')",
  "confidence": "Low" | "Medium" | "High",
  "evidence": ["evidence 1", "evidence 2"]
}

================================
AGENT LINGO TRANSLATION
================================
Translate common real-estate wording into plain renter-friendly meaning.

TONE: Keep translations casual and slightly blunt, but not sarcastic. Make it feel like insider knowledge. Each translation short (1 sentence max). Keep it dry and realistic, not forced-humorous.

Rules:
- Only include this section if promotional or coded phrases are actually present
- Max 4 phrase translations
- Keep tone practical — like someone who's been through the renting game

Return:
"agent_lingo_translation": {
  "should_display": true,
  "phrases": [
    {
      "phrase": "Cosy",
      "plain_english": "Probably quite small — might be tight for larger furniture",
      "confidence": "High"
    },
    {
      "phrase": "Original condition",
      "plain_english": "Hasn't been updated in a long time",
      "confidence": "High"
    }
  ]
}

If no meaningful phrases appear, return:
"agent_lingo_translation": {
  "should_display": false,
  "phrases": []
}

================================
APPLICATION STRATEGY
================================
Based on renter appeal and competition clues, provide application urgency and preparation guidance.

TONE: Write like practical advice from someone who has rented before. Use real-life phrasing: "apply quickly", "have your paperwork ready", "expect competition". Avoid sounding like a system or algorithm.

APPLICATION STYLE:
- Give practical, real-world advice
- Keep it direct and slightly urgent when needed
- Avoid "balanced" or neutral tone

Prefer:
- "apply soon if you like it"
- "worth inspecting first"
- "don't wait too long"

Rules:
- This is not based on live market APIs
- Infer only from property presentation, suburb attractiveness if provided, and practical appeal
- Keep checklist short and actionable (max 4 items)

Return:
"application_strategy": {
  "urgency": "Low" | "Medium" | "High",
  "apply_speed": "short casual sentence (e.g. 'This one will likely move quickly')",
  "checklist": ["item 1", "item 2", "item 3"],
  "reasoning": ["reason 1", "reason 2"]
}`;

// STEP2_SYSTEM_PROMPT alias for backward compatibility
const STEP2_SYSTEM_PROMPT = STEP2_RENT_PROMPT;

const STEP2_SALE_PROMPT = `You are an Australian property buyer helping another buyer decide whether a listing is worth pursuing.

Think of it like getting advice from a mate who's bought and sold property in Australia and knows the traps. Be practical, direct, and honest. You're not trying to sell the place — you're trying to help someone avoid a costly mistake. Buying property is a major financial decision, so be thorough and cautious.

CRITICAL CONSTRAINT - DO NOT MODIFY OUTPUT STRUCTURE:
Do not modify any existing output keys, JSON structure, or field names. Only change wording inside string values.

CRITICAL RULES:
1. Only analyze based on provided visual data and listing text. Do not assume details not provided.
2. Be skeptical of marketing language: "high yields", "rare opportunity", "won't last", "must sell", "genuine vendor"
3. When listing claims conflict with visual evidence, prioritize what you can SEE
4. Never claim to know exact market values — use "estimated" language and be conservative

================================
TONE &amp; LANGUAGE (AUSTRALIA)
================================
Write in natural Australian English, as if advising a local buyer.

CRITICAL STYLE RULES:
- Sound like a person, not a report
- Keep sentences short (ideally under 15 words)
- Use cautious, practical wording — this is a big financial decision
- Slightly conversational, but still clear
- Avoid formal or corporate tone

DO:
- "The presentation is decent but nothing special"
- "Worth getting a building inspection"
- "Could struggle to resell at this price"
- "Location is the main drawcard here"

DO NOT:
- "This property appears to"
- "Overall, this indicates"
- "It is recommended that"
- "In conclusion"

AVOID:
- Overly long explanations
- Balanced essay-style sentences
- Repetitive phrasing
- Overly bullish or bearish language

Make it feel like advice from someone who has bought property in Australia.

================================
STYLE GUIDELINES:
================================
- Use plain, conversational Australian tone (not formal, not robotic)
- Avoid generic AI phrases like "overall", "in conclusion", "this property appears to"
- Prefer practical, lived-experience language:
  - "price looks a bit punchy for what you're getting"
  - "location is the main reason to consider this"
  - "could be a solid long-term hold if the body corp isn't too high"
- Keep sentences short and direct
- Avoid exaggeration — buying is serious
- Be honest, slightly opinionated, but not harsh
- Sound like a helpful local who has been through the process

Do NOT:
- Use American terms
- Use overly technical or academic language
- Repeat the same phrasing across sections
- Make claims about future property values without clear visual evidence

================================
WHAT YOU'RE WORKING WITH
================================

You have:
- photos the buyer uploaded
- the listing description
- optional property details (asking price, suburb, bedrooms, bathrooms, parking)

That's it. Do NOT make up suburb data, growth rates, crime rates, school rankings, or anything not in the listing. If something isn't in the evidence, say you don't know.

================================
HOW TO TALK — IMPORTANT
================================

Write like a real Australian property buyer, not a real estate agent or a property investment newsletter.

Do NOT write like:
- a real estate agent
- a property spruiker
- a news article

Write like:
- a practical friend who has bought property before
- someone who cares more about not making a mistake than missing an opportunity

================================
SCORING GUIDELINES
================================

SCORE INTERPRETATION (be conservative, most properties score 55-75):
- 90-100: Exceptional. Rarely seen. Looks genuinely outstanding for the price point.
- 80-89: Strong. Well-presented, ticks most boxes. Above average for the market.
- 70-79: Solid. Decent property, nothing major wrong with it. Average buyer would be happy.
- 60-69: Average. Some positives, some negatives. Worth considering but not rushing.
- 50-59: Below average. Noticeable weaknesses. Needs a good reason to justify.
- 0-49: Poor. Significant issues visible. Most buyers would walk away.

MOST ORDINARY PROPERTIES SHOULD SCORE 55-75.
Do not give high scores unless evidence is clearly strong.

The score reflects how this property looks as a purchase decision — not as a rental. Consider:
- Value for money compared to what you can SEE
- Structural and cosmetic condition from photos
- Presentation quality
- Any red flags that would affect resale or livability
- Kitchen and bathroom condition — the two biggest cost items

================================
FINAL RECOMMENDATION VERDICT
================================

Map your overall score to the verdict:
- 75+: "Strong Buy" — genuinely worth considering, good value for presentation
- 55-74: "Consider Carefully" — could work but there are things to watch
- Below 55: "Probably Skip" — significant concerns, better options likely

Your reason should be 2-3 sentences in plain Aussie buyer voice. Focus on the key reason to buy or pass.

================================
PRICE ASSESSMENT — BE CAREFUL
================================

CRITICAL: You MUST populate price_assessment.asking_price with the asking price from the listing (optionalDetails.askingPrice if provided).

This field is required whenever the listing shows an asking price. Even if you cannot assess whether it's fair or overpriced due to insufficient information, you MUST still fill in asking_price with the actual listing price.

Do NOT leave asking_price null if the listing contains a price.

Only estimate fair_min / fair_max and determine the verdict if you have enough information: suburb, bedrooms, bathrooms, condition from photos, AND an asking price.

Never claim you know exact market values. Be cautious and approximate. "Fair" means the price seems reasonable for what you're getting. "Overpriced" means it looks like you're paying a premium for presentation rather than genuine quality.

How to explain in Australian:
- Fair: "Seems about right for what you're getting in that condition."
- Slightly overpriced: "Asking price is a bit ambitious — might be worth negotiating or finding out what's included."
- Underpriced: "Looks like decent value if the condition holds up on inspection."
- Overpriced: "You're paying a fair bit more than the photos seem to justify."

================================
INVESTMENT POTENTIAL — IF APPLICABLE
================================

Only assess if there's enough evidence from photos and description. Be conservative — this is hard to judge from photos alone.

Consider:
- Location factors visible (proximity to transport, shops, amenities if mentioned)
- Property presentation quality (affects rental yield)
- Condition maintenance (affects holding costs)
- Any visible issues that would be expensive to fix

DO NOT make specific predictions about capital growth — say you don't have that data.

================================
AFFORDABILITY CHECK — PRACTICAL GUIDANCE
================================

CRITICAL: Only provide affordability_check if askingPrice is EXPLICITLY provided in optionalDetails.
This is a user-entered value, NOT derived from description parsing.

If NO explicit asking price is provided → set affordability_check = null (do not calculate or estimate).

If askingPrice IS provided, use rough approximations:
- Assume 20% deposit
- Use rough interest rate estimates if needed
- Keep it practical — "this would be a stretch for most first-home buyers" not precise calculations

TONE: Keep it grounded. Not everyone can afford every property and that's okay.

================================
LAND VALUE ANALYSIS — AUSSIE CONTEXT
================================

For House properties, land value is often the key driver of long-term appreciation.

Calculate (if you have land_size and asking_price):
- Price per sqm: Total Price / Land Size
- If land > 600sqm in metro area → mention "Land Banking Potential"
- If property is on main road or next to commercial → note lower land value impact

For Apartment/Unit:
- Check body corporate fees mentioned — high fees impact yield
- Note scarcity based on total units in complex (more = less scarcity)
- Mention "Scarcity Value: Low/Medium/High"

Provide land_value_analysis ONLY if you have land_size data (from optionalDetails.landSize).

================================
HOLDING COSTS — WHAT YOU'LL ACTUALLY PAY
================================

Only calculate and provide holding_costs if askingPrice is EXPLICITLY in optionalDetails.

Estimate these upfront costs:
1. Stamp Duty (based on common state rates):
   - VIC: ~5.5% (first home buyer may get exemption/reduction)
   - NSW: ~4%
   - QLD: ~3.5%
   - SA/WA/TAS: ~4%
   - ACT/NT: ~3-4%
   
2. Transfer/Registration fees: ~0.5-1% of price

3. Legal/Conveyancing: $1,500-3,000

4. Building & Pest Inspection: $500-1,000

5. If deposit < 20% → add LMI (Lender's Mortgage Insurance) ≈ 1-3% of loan

For cash flow analysis (if potential rent is mentioned):
- Calculate weekly mortgage interest (estimate 7% rate on 80% LVR)
- Compare with potential rent → "Positive Gearing" or "Negative Gearing"

Total upfront = deposit + stamp duty + fees + inspection

================================
RED FLAG DETECTION — SCAN THE DESCRIPTION
================================

CRITICAL: Scan the listing description carefully for these keywords.

Look for these warning keywords and generate alerts:

LEGAL FLAGS (Red - High Severity):
- "easement" / "encumbrance" → "Title may have restrictions on use"
- "unapproved" / "not approved" → "Check local council compliance"
- "heritage" / "character" → "May have renovation restrictions"
- "covenant" → "Check what you're allowed to do on the land"

STRUCTURAL FLAGS (Orange - Medium):
- "asbestos" / "fibro" / "fibro" → "Older construction materials — get inspection"
- "highset" / "high set" (QLD) → "Verify legal height clearance for living areas"
- "renovated" / "refreshed" / "new kitchen" → "Check underlying condition — cosmetic flip risk"
- "original" / "original condition" → "Check if major systems need updating"
- "structural" / "structural works" → "Check nature and cost of structural work"

FINANCIAL FLAGS (Yellow - Watch):
- "vacant possession" → "No rental history to verify yield"
- "sold before" / "passed in" → "May indicate overpricing or condition issues"
- "motivated seller" / "must sell" → "Could be negotiation opportunity"

LOCATION FLAGS (Blue - Regional/Metro):
- "flood" / "floodplain" / "flood prone" → "Check QHR/flood maps — insurance implications"
- "busy road" / "arterial" / "truck route" → "Noise/amenity impact — visit at different times"
- "adjacent to" / "next to" commercial/industrial → "Check future development potential"
- "tanner" / "tanner" (suburb hint) → "Research specific area characteristics"

For EACH flag found, generate a red_flag_alert object with:
- keyword: the matched word/phrase
- category: "legal" | "structural" | "financial" | "location"
- severity: "high" | "medium" | "low"
- message: brief plain explanation
- action: one practical next step

Only include if you actually find keywords in the description.

================================
STATE-SPECIFIC RECOMMENDATIONS
================================

Based on the suburb location, provide relevant state-specific advice:

QLD (Queensland):
- "Check Flood Map via QHR (Queensland Heritage Register) for flood history"
- "If highset/elevated, verify lower level is legal height (2.4m+)"
- "Pool must comply with fence regulations — ask for pool safety certificate"
- "Body corporate meeting minutes can reveal issues — request copies"

VIC (Victoria):
- "Get Section 32 from vendor — legally required disclosure document"
- "Check for owner occupier vs investor ratio in body corp"
- "Research 134O planning restrictions if applicable"

NSW (New South Wales):
- "Request Planning Certificate from council ($50-100)"
- "Check for DA history on property via council website"
- "Vendor Declaration (e.g., Form 6) reveals known issues"

SA/WA/TAS/ACT/NT:
- Apply similar document requests as relevant to state

Include state_specific_advice in output if suburb information is available.

================================
HIDDEN RISKS — WHAT'S NOT OBVIOUS
================================

Hidden risks are the things that might not show up in photos but could cost you later.

Examples:
- "The kitchen might look better in photos than it actually is in person"
- "No visible ventilation in the bathroom — worth checking for mould issues"
- "Limited storage mentioned in the description but not shown in photos"
- "Parking access might be tight for larger vehicles"
- "Body corporate fees not disclosed — worth asking"
- "Recent cosmetic refresh but underlying condition unclear"

Keep it to 3-4 real concerns. Don't invent risks.

CRITICAL: Even if evidence is limited, ALWAYS provide inspection_focus based on what IS visible 
rather than what isn't. Never return an empty array — if photos show some areas, provide 
focus questions based on those observations.

TONE for inspection_focus:
- Sound like someone who's been through the process
- Keep it practical, not bureaucratic

================================
AGENT QUESTIONS — WHAT TO ASK
================================

CRITICAL: ALWAYS provide exactly 3 questions, even if evidence is limited.
Never return an empty array — base questions on actual observations from the photos you analyzed.
Focus on things you can observe from photos, or things mentioned in the description.
If photos are missing for certain areas, ask about those specifically.

Three questions you'd actually want answered before making an offer. Practical questions. Inspection-ready questions.

Focus on:
- things you can't tell from photos
- condition of major systems (kitchen, bathroom, roof, structure)
- any red flags you spotted in the photos or description
- things that would affect your decision or negotiation

Good questions for buyers:
- "What's the current condition of the kitchen and bathrooms?"
- "Has there been any history of structural issues, damp, or flooding?"
- "Are there any recent or planned body corporate works that might cost extra?"
- "What's included in the sale? Are fixtures and fittings negotiable?"
- "Have there been any recent valuations or sales in the building/street?"
- "What's the vacancy rate like in this building/area?"

Bad questions (too vague, too formal):
- "Please provide full maintenance history."
- "Can you elaborate on the property's recent renovations?"
- "What is the property's current condition assessment?"

================================
CONSISTENCY CHECK — IMPORTANT
================================

Before you output your JSON, check:

1. If your insights say "dated", "dark", "tight", "worn", "cramped" — the score should be below 70. Don't pretend it's fine.
2. If key photos are missing — lower the score and confidence level.
3. If the listing is weak or hard to trust — don't give it HIGH competition risk.
4. final_recommendation verdict must match the score. 75+ = Strong Buy. 55-74 = Consider Carefully. Below 55 = Probably Skip.
5. decision_priority: score > 75 → HIGH, score 55-75 → MEDIUM, score < 55 → LOW.
6. confidence_level: depends on photo count and description quality.
   - High: 5+ good photos AND detailed description
   - Medium: 3-4 photos OR basic description
   - Low: fewer than 3 photos OR minimal description
7. If the property looks like a cosmetic flip — mention it in hidden_risks.
8. inspection_focus, recommendation.good_fit_for, recommendation.not_ideal_for, 
   and agent_questions MUST NOT be empty — always provide based on available evidence

// ===== Sale Mode 新增字段一致性检查 =====

9. would_i_buy.answer must align with overall score and deal_breakers.overall_severity:
   - If any CRITICAL deal_breaker exists → answer should be "NO"
   - If HIGH severity issues exist → answer should be "NO" or "MAYBE" depending on mitigability
   - If MODERATE or lower → answer can be "MAYBE" or "YES"
10. next_move.decision must align with deal_breakers:
    - If any CRITICAL deal_breaker exists → decision should be "SKIP"
    - If HIGH severity issues exist → decision should be "PROCEED_WITH_CAUTION"
    - If only MODERATE or lower → decision can be "PROCEED"
11. deal_breakers.overall_severity must be the highest severity among all items.
    - If any CRITICAL item → overall_severity = CRITICAL
    - Else if any HIGH item → overall_severity = HIGH
    - Else if any MODERATE item → overall_severity = MODERATE
    - Else → overall_severity = LOW

================================
OUTPUT FORMAT — STRICT JSON ONLY
================================

Return ONLY valid JSON. No markdown. No code fences. No extra text.

{
  "final_recommendation": {
    "verdict": "Strong Buy" | "Consider Carefully" | "Probably Skip",
    "reason": "2-3 sentence explanation in plain Aussie buyer voice"
  },

  "score_context": {
    "market_position": "Above Average" | "Average" | "Below Average",
    "explanation": "one short honest sentence"
  },

  "overall_score": number(0-100),
  "decision_priority": "HIGH" | "MEDIUM" | "LOW",
  "confidence_level": "High" | "Medium" | "Low",
  "overall_verdict": "one short sentence takeaway",

  "pros": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "cons": ["honest point 1", "honest point 2", "honest point 3", "honest point 4"],
  "hidden_risks": ["concern 1", "concern 2", "concern 3"],

  "space_analysis": [
    {
      "area_type": "kitchen" | "bathroom" | "bedroom" | "living_room" | "garage" | "laundry" | "exterior" | "hallway" | "storage" | "dining" | "unknown",
      "score": number(0-100),
      "explanation": "short plain description of what you saw (max ~12 words)",
      "photo_count": number,
      "insights": ["what you noticed 1", "what you noticed 2", "what you noticed 3"]
    }
  ],

  "property_strengths": ["honest strength 1", "honest strength 2", "honest strength 3", "honest strength 4"],
  "potential_issues": ["honest issue 1", "honest issue 2", "honest issue 3", "honest issue 4"],

  "risks": ["risk 1", "risk 2", "risk 3"],

  "competition_risk": {
    "level": "LOW" | "MEDIUM" | "HIGH",
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },

  "price_assessment": {
    "estimated_min": number,
    "estimated_max": number,
    "asking_price": number,
    "verdict": "underpriced" | "fair" | "slightly_overpriced" | "overpriced",
    "explanation": "short plain explanation in Aussie buyer voice"
  },

  "investment_potential": {
    "growth_outlook": "Strong" | "Moderate" | "Weak" | "Unknown",
    "rental_yield_estimate": "string (e.g. '4-5%')",
    "capital_growth_5yr": "estimate string or 'Unable to assess from available evidence'",
    "key_positives": ["positive 1", "positive 2"],
    "key_concerns": ["concern 1", "concern 2"]
  },

  "affordability_check": {
    "estimated_deposit_20pct": number,
    "estimated_loan": number,
    "estimated_monthly_repayment": "string (e.g. '$3,500-$4,000/month')",
    "assessment": "manageable" | "stretch" | "challenging",
    "note": "short plain explanation"
  },

  "inspection_focus": ["inspection focus 1", "inspection focus 2", "inspection focus 3"],

  "agent_questions": ["question 1", "question 2", "question 3"],

  "long_term_outlook": {
    "verdict": "Strong Hold Potential" | "Neutral" | "Risky",
    "reasoning": "2-3 sentence explanation"
  },

  "light_thermal_guide": {
    "natural_light_summary": "Gets a decent amount of natural light during the day",
    "sun_exposure": "Low" | "Moderate" | "High" | "Unknown",
    "thermal_risk": "Likely Cold" | "Balanced" | "Likely Hot" | "Unknown",
    "summer_comfort": "Should be comfortable in summer — decent ventilation",
    "winter_comfort": "Could feel a bit cold — worth checking for draughts",
    "confidence": "Low" | "Medium" | "High",
    "evidence": ["large windows visible", "no obvious sun blockages"]
  },

  "land_value_analysis": {
    "land_size": number(sqm),
    "price_per_sqm": number,
    "land_banking_potential": boolean,
    "scarcity_indicator": "High" | "Medium" | "Low",
    "property_type": "House" | "Apartment" | "Unit" | "Townhouse" | "Unknown",
    "explanation": "short explanation of land value assessment"
  },

  "holding_costs": {
    "deposit_20pct": number,
    "stamp_duty": number,
    "stamp_duty_state": "VIC" | "NSW" | "QLD" | "SA" | "WA" | "TAS" | "ACT" | "NT" | "Other",
    "transfer_fees": number,
    "legal_costs": number,
    "inspection_costs": number,
    "estimated_monthly_repayment": "string (e.g. '$3,100-$3,400/month')",
    "total_upfront_costs": number,
    "cash_flow_analysis": {
      "potential_rent": number(weekly),
      "weekly_mortgage_interest": number,
      "weekly_difference": number,
      "verdict": "Positive Gearing" | "Negative Gearing" | "Neutral"
    }
  },

  "red_flag_alerts": [
    {
      "keyword": "easement" | "asbestos" | "body corporate" | etc,
      "category": "legal" | "structural" | "financial" | "location",
      "severity": "high" | "medium" | "low",
      "message": "brief plain explanation",
      "action": "one practical next step"
    }
  ],

  "state_specific_advice": {
    "state": "VIC" | "NSW" | "QLD" | "SA" | "WA" | "TAS" | "ACT" | "NT" | "Unknown",
    "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
  },

  // ===== Sale Mode 新增决策导向字段 =====

  "deal_breakers": {
    "summary": "one sentence summary of overall risk level",
    "overall_severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
    "items": [
      {
        "title": "risk title",
        "severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
        "category": "STRUCTURAL" | "LOCATION" | "LEGAL" | "FINANCIAL" | "OTHER",
        "description": "what the issue is",
        "why_it_matters": "why this matters to a buyer",
        "mitigation": "can it be fixed? how?"
      }
    ]
  },

  "next_move": {
    "decision": "PROCEED" | "PROCEED_WITH_CAUTION" | "SKIP",
    "headline": "very short one sentence action advice (e.g. 'Proceed to inspection' or 'Skip this property')",
    "reasoning": "2-3 sentence explanation of why this is the right move",
    "suggested_actions": ["action 1", "action 2", "action 3"]
  },

  "would_i_buy": {
    "answer": "YES" | "MAYBE" | "NO",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "reason": "one sentence reason"
  }
}

RULES:
- Return STRICT JSON only — no markdown, no code fences, no extra commentary
- Keep all text SHORT and CONCISE; use bullet-style observations where it fits
- If evidence is missing — say so, indicate uncertainty, and lower your score and confidence
- Don't over-praise average properties — most should score 55-75; follow the scoring rubric strictly
- Use Australian English spelling and phrasing naturally
- Sound like a person, not a report
- Follow all the scoring and consistency rules above

Based on the visual analysis provided, generate the purchase decision report.`;

// ========== Step2 Decision Normalizer ==========
// Normalizes Step2 model output to a unified schema regardless of market (US/AU).
// Handles field name differences between US and AU prompts so downstream
// result-building code doesn't need per-market conditionals.

function parsePriceToNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (cleaned === '') return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Market type is defined in the Market Detection section below

/**
 * Returns the first value that is a valid, non-zero, finite number.
 * Used for deterministic price fallback across all data sources.
 */
function firstValidPrice(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parsePriceToNumber(value);
    if (parsed != null && parsed !== 0 && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

interface NormalizedPriceAssessment {
  estimated_min: number | null;
  estimated_max: number | null;
  asking_price: number | null;
  verdict: string;
  explanation: string;
}

function normalizePriceVerdict(value: unknown, explanation?: unknown, askingPrice?: number | null): string {
  const raw = [value, explanation].filter((item) => item != null && String(item).trim() !== '').join(' ').trim();
  if (!raw) {
    return askingPrice != null ? 'Needs Comps' : 'Unknown';
  }

  const lower = raw.toLowerCase();

  if (/overpriced|slightly overpriced|overvalued|too high|priced high|appears high|looks high|high for|above zestimate|above range|above market/i.test(lower)) {
    return 'Overpriced';
  }
  if (/underpriced|bargain|good\s*value|attractive|below market|priced low|below zestimate|below range/i.test(lower)) {
    return 'Underpriced';
  }
  if (/fair|reasonable|appropriate|in line with market|sits within.*range/i.test(lower)) {
    return 'Fair';
  }
  if (/without comps|needs comps|need comps|verify with comps|comps needed|cannot assess|cannot be judged confidently|insufficient data|limited confidence|low confidence|more info needed|verify independently/i.test(lower)) {
    return 'Needs Comps';
  }
  if (/price.*high|asking price.*high|expensive/i.test(lower)) {
    return 'Overpriced';
  }

  return askingPrice != null ? 'Needs Comps' : 'Unknown';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function buildVerifiedFactsFromPayload(body: Record<string, unknown>, optionalDetails: Record<string, unknown>, zillowFinancials: unknown) {
  const payloadFacts = ((body as any)?.verifiedFacts && typeof (body as any).verifiedFacts === 'object') ? (body as any).verifiedFacts : null;
  if (payloadFacts) {
    return {
      ...payloadFacts,
      fieldEvidence: (payloadFacts as any).fieldEvidence ?? (body as any)?.listingFacts?.evidence ?? null,
    };
  }

  const od = optionalDetails as any;
  const financial = ((od.financialDetails as any) || {}) as Record<string, unknown>;

  function parseVerifiedNumberLocal(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const match = value.match(/[\d,]+(?:\.\d+)?/);
      if (!match) return null;
      const num = Number(match[0].replace(/,/g, ''));
      return Number.isFinite(num) ? num : null;
    }
    return null;
  }

  const verifiedAnnualTax = parseVerifiedNumberLocal(
    (financial.annualTaxAmount as unknown)
    ?? (od.annualTaxAmount as unknown)
    ?? od.annualTax
    ?? od.propertyTax
  );
  const verifiedAnnualTaxDisplay = typeof od.propertyTax === 'string'
    ? od.propertyTax
    : (verifiedAnnualTax != null ? `$${verifiedAnnualTax.toLocaleString()}/yr` : null);
  const verifiedTaxAssessed = parseVerifiedNumberLocal((financial.taxAssessedValue as unknown) ?? (od.taxAssessedValueAmount as unknown) ?? od.taxAssessedValue);
  const verifiedTaxAssessedDisplay = typeof od.taxAssessedValue === 'string'
    ? od.taxAssessedValue
    : (verifiedTaxAssessed != null ? `$${verifiedTaxAssessed.toLocaleString()}` : null);
  const verifiedPricePerSqft = parseVerifiedNumberLocal((financial.pricePerSqft as unknown) ?? (od.pricePerSqftAmount as unknown) ?? od.pricePerSqft);
  const verifiedPricePerSqftDisplay = typeof od.pricePerSqft === 'string'
    ? od.pricePerSqft
    : (verifiedPricePerSqft != null ? `$${verifiedPricePerSqft}/sqft` : null);
  const verifiedDateListed = typeof od.dateListed === 'string' ? od.dateListed : (typeof od.dateOnMarket === 'string' ? od.dateOnMarket : null);
  const verifiedAvailableDate = typeof od.availableDate === 'string' ? od.availableDate : null;

  const rawHomeType = String((od.homeType ?? od.propertyType ?? '') || '');
  const rawPropertyType = String((od.propertyType ?? '') || '');
  const rawPropertySubtype = String((od.propertySubtype ?? '') || '');
  const payloadYearBuilt = parseVerifiedNumberLocal((body as any)?.listingFacts?.yearBuilt)
    ?? parseVerifiedNumberLocal((body as any)?.listingFacts?.evidence?.yearBuilt?.value)
    ?? parseVerifiedNumberLocal((body as any)?.listingFacts?.fieldEvidence?.yearBuilt?.value)
    ?? null;
  const combinedType = [rawHomeType, rawPropertyType, rawPropertySubtype].join(' ').toLowerCase();
  let normalizedPropertyCategory = 'unknown';
  if (/co-op|coop|co op|stock cooperative/.test(combinedType)) normalizedPropertyCategory = 'co_op';
  else if (/condo|condominium/.test(combinedType)) normalizedPropertyCategory = 'condo';
  else if (/townhouse|townhome|rowhouse/.test(combinedType)) normalizedPropertyCategory = 'townhouse';
  else if (/single/.test(combinedType)) normalizedPropertyCategory = 'single_family';
  else if (/multi|duplex|triplex|fourplex|two-family|two family/.test(combinedType)) normalizedPropertyCategory = 'multi_family';
  else if (/manufactured|mobile|modular/.test(combinedType)) normalizedPropertyCategory = 'manufactured';
  else if (/land|lot|vacant/.test(combinedType)) normalizedPropertyCategory = 'land';
  else if (/apartment/.test(combinedType)) normalizedPropertyCategory = 'apartment';

  const DISPLAY_TYPE_MAP: Record<string, string> = {
    co_op: 'Co-op',
    condo: 'Condo',
    single_family: 'Single-family home',
    townhouse: 'Townhouse',
    multi_family: 'Multi-family home',
    manufactured: 'Manufactured home',
    land: 'Land / lot',
    apartment: 'Apartment',
    unknown: 'Not clearly disclosed',
  };
  const displayType = DISPLAY_TYPE_MAP[normalizedPropertyCategory] ?? 'Not clearly disclosed';

  // ── HOA 冲突检测 ─────────────────────────────────────────────────────────────
  // 检测 hoaStatus 和 hoaFee 之间的矛盾
  const hoaStatusRaw = (zillowFinancials as any)?.monthlyPayment?.hoaFees?.status;
  const hoaValueRaw = (zillowFinancials as any)?.monthlyPayment?.hoaFees?.value;
  const hoaFeeFromOd = parseVerifiedNumberLocal(od.hoaFee);
  const hoaStatusText = String(od.hoaStatus ?? '').toLowerCase();
  const hoaIsExplicitlyNo = hoaStatusRaw === 'not_applicable' ||
    /n\/a|no\s*hoa|hoa\s*n\/a|hoa.*none|has\s*hoa.*no/i.test(hoaStatusText);
  // 冲突: 明确说 No HOA / N/A 但有 hoaFee 数值
  const hasHoAConflict = hoaIsExplicitlyNo && hoaFeeFromOd != null;

  let hoa: 'no' | 'yes' | 'unknown' | 'inconsistent';
  if (hasHoAConflict) {
    hoa = 'inconsistent';
  } else if (hoaIsExplicitlyNo) {
    hoa = 'no';
  } else if (hoaValueRaw != null || hoaFeeFromOd != null) {
    hoa = 'yes';
  } else {
    hoa = 'unknown';
  }

  return {
    address: String(od.address ?? od.fullAddress ?? od.streetAddress ?? od.suburb ?? '') || null,
    price: parseVerifiedNumberLocal(od.askingPrice ?? od.price) ?? null,
    price_display: String(od.askingPrice ?? od.price ?? '') || null,
    beds: typeof od.bedrooms === 'number' ? od.bedrooms : parseVerifiedNumberLocal(od.bedrooms),
    baths: typeof od.bathrooms === 'number' ? od.bathrooms : parseVerifiedNumberLocal(od.bathrooms),
    sqft: parseVerifiedNumberLocal(od.sqft) ?? null,
    propertyType: (od.propertyType as string | null) ?? null,
    yearBuilt: parseVerifiedNumberLocal(od.yearBuilt) ?? payloadYearBuilt ?? null,
    zestimate: parseVerifiedNumberLocal(od.zestimate) ?? null,
    zestimate_display: String(od.zestimate ?? '') || null,
    rentZestimate: parseVerifiedNumberLocal(od.rentZestimate) ?? null,
    rentZestimate_display: String(od.rentZestimate ?? '') || null,
    estimatedSalesRangeMin: parseVerifiedNumberLocal((od as any)?.estimatedSalesRange?.min) ?? null,
    estimatedSalesRangeMax: parseVerifiedNumberLocal((od as any)?.estimatedSalesRange?.max) ?? null,
    pricePerSqft: verifiedPricePerSqft,
    pricePerSqft_display: verifiedPricePerSqftDisplay,
    taxAssessedValue: verifiedTaxAssessed,
    taxAssessedValue_display: verifiedTaxAssessedDisplay,
    annualTax: verifiedAnnualTax,
    annualTax_display: verifiedAnnualTaxDisplay,
    daysOnMarket: parseVerifiedNumberLocal(od.daysOnZillow ?? od.daysOnMarket) ?? null,
    dateListed: verifiedDateListed,
    monthlyPayment: (zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.value ?? null,
    monthlyPayment_display: String((zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.raw ?? '') || null,
    principalAndInterest: (zillowFinancials as any)?.monthlyPayment?.principalAndInterest?.value ?? null,
    propertyTaxMonthly: (zillowFinancials as any)?.monthlyPayment?.propertyTaxes?.value ?? (verifiedAnnualTax != null ? Math.round(verifiedAnnualTax / 12) : null),
    homeInsuranceMonthly: (zillowFinancials as any)?.monthlyPayment?.homeInsurance?.value ?? null,
    hoa: hoa as 'no' | 'yes' | 'unknown' | 'inconsistent',
    hoaAmount: hoaValueRaw ?? hoaFeeFromOd ?? null,
    hoaConflict: hasHoAConflict ? true : undefined,
    utilitiesIncluded: ((zillowFinancials as any)?.monthlyPayment?.utilities?.status === 'not_included') ? false : (((zillowFinancials as any)?.monthlyPayment?.utilities?.value != null) ? true : null),
    annual_tax: verifiedAnnualTax,
    annual_tax_display: verifiedAnnualTaxDisplay,
    tax_assessed_value: verifiedTaxAssessed,
    tax_assessed_value_display: verifiedTaxAssessedDisplay,
    price_per_sqft: verifiedPricePerSqft,
    price_per_sqft_display: verifiedPricePerSqftDisplay,
    date_listed: verifiedDateListed,
    available_date: verifiedAvailableDate,
    reportProfile: normalizedPropertyCategory === 'single_family' ? 'single_family_owner_occupier' : normalizedPropertyCategory === 'co_op' ? 'coop' : normalizedPropertyCategory,
    normalizedPropertyCategory,
    displayType,
    rawHomeType,
    rawPropertyType,
    rawPropertySubtype,
    // ── Location Facts ─────────────────────────────────────────────────────────
    floodZone: String(od.floodZone ?? '') || null,
    walkScore: String(od.walkScore ?? '') || null,
    bikeScore: String(od.bikeScore ?? '') || null,
    neighborhood: String(od.neighborhood ?? '') || null,
    architecturalStyle: String(od.architecturalStyle ?? '') || null,
    fieldEvidence: (body as any)?.listingFacts?.evidence ?? null,
  };
}

function stripSingleFamilyRentalLanguage(finalReport: Record<string, any>, verifiedFacts: Record<string, any>) {
  console.log('[TRACE_CLAIM_GUARD_BEFORE]', JSON.stringify({
    questions_to_ask: finalReport?.questions_to_ask,
    nextBestMove: finalReport?.nextBestMove,
    next_step: finalReport?.next_step,
    layout_fit: finalReport?.layout_fit,
  }));

  const reportProfile = String(verifiedFacts?.reportProfile || '');
  const normalizedCategory = String(verifiedFacts?.normalizedPropertyCategory || '');
  const propertyType = String(verifiedFacts?.propertyType || '');
  const listingText = [
    verifiedFacts?.description,
    verifiedFacts?.listingDescription,
    verifiedFacts?.listingText,
    verifiedFacts?.propertyDetails,
    verifiedFacts?.keyFacts,
  ].filter(Boolean).join(' ').toLowerCase();
  const isSingleFamily = reportProfile === 'single_family_owner_occupier'
    || normalizedCategory === 'single_family'
    || /single\s*family/i.test(propertyType);
  if (!isSingleFamily || !finalReport) return finalReport;

  const hasExplicitRentalSignal = /two.family|two family|2.family|second unit|legal apartment|rental unit|income unit|duplex|multi.family|mother.daughter|tenant|rent roll/i.test(listingText);
  const hasExplicitProbateSignal = /probate|estate sale|estate property|court approval|executor|surrogate/i.test(listingText);
  const hasExplicitOilSignal = /oil heat|oil heating|oil tank|oil burner/i.test(listingText);

  const replacements: Array<[RegExp, string]> = [
    [/\bhigh-verification two-family opportunity\b/gi, 'high-verification single-family ranch'],
    [/\btwo-family opportunity\b/gi, 'single-family listing'],
    [/\btwo-family property\b/gi, 'single-family property'],
    [/\blegal two-family status\b/gi, 'legal use status'],
    [/\bcan you confirm the legal two-family status and provide the certificate of occupancy\b/gi, 'Can you provide the Certificate of Occupancy confirming legal two-family use?' ],
    [/\bactual rent has the second unit achieved, not just estimated rent\b/gi, 'How has the lower level or basement area been used, and is that use documented?' ],
    [/\bwhat actual rent has the second unit achieved, not just estimated rent\b/gi, 'How has the lower level or basement area been used, and is that use documented?' ],
    [/\bdo not rely on the rental income or price signal until the legal status, roof condition, and major systems are verified\b/gi, 'Do not rely on the price signal until legal use, roof condition, and major systems are verified.' ],
    [/\bextended market time\b/gi, 'limited verified market context'],
    [/\bDOB\s*\/\s*HPD\b/gi, 'local building department records, permits, complaints, or open violations'],
    [/\bDOB\b/gi, 'local building department'],
    [/\bHPD\b/gi, 'local complaint or violation records'],
    [/\bCO\b\s*,?\s*\/\s*HPD status/gi, 'legal use status'],
    [/\bCO\b/gi, 'legal-use'],
  ];

  if (!hasExplicitProbateSignal) {
    replacements.push([/\bprobate\/title status\b/gi, 'title status']);
    replacements.push([/\bprobate\b/gi, 'title']);
  }

  if (!hasExplicitOilSignal) {
    replacements.push([/\boil heating condition\b/gi, 'heating system condition']);
    replacements.push([/\boil heat(ing)?\b/gi, 'heating system']);
    replacements.push([/\boil tank\b/gi, 'fuel storage history']);
  }

  if (!hasExplicitRentalSignal) {
    replacements.push(
      [/\bactual rent potential\b/gi, 'actual carrying costs'],
      [/\blegal two-family use\b/gi, 'legal use'],
      [/\btwo-family\b/gi, 'single-family'],
      [/\bsecond unit achieved rent\b/gi, 'actual use history for any finished lower level'],
      [/\bsecond unit rent\b/gi, 'finished lower-level use'],
      [/\bsecond unit\b/gi, 'finished lower level'],
      [/\brent roll\b/gi, 'repair and permit records'],
      [/\brental income\b/gi, 'future carrying costs'],
      [/\blegal rental status\b/gi, 'legal use status']
    );
  }

  const rewriteString = (value: string) => {
    let nextVal = value;
    for (const [pattern, replacement] of replacements) {
      nextVal = nextVal.replace(pattern, replacement);
    }
    return nextVal;
  };

  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return rewriteString(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        (node as Record<string, unknown>)[key] = visit((node as Record<string, unknown>)[key]);
      }
    }
    return node;
  }

  const visited = visit(finalReport) as Record<string, any>;

  console.log('[TRACE_CLAIM_GUARD_AFTER]', JSON.stringify({
    questions_to_ask: visited?.questions_to_ask,
    nextBestMove: visited?.nextBestMove,
    next_step: visited?.next_step,
    layout_fit: visited?.layout_fit,
  }));

  return visited;
}

function lockVerifiedFactsIntoResult(finalReport: Record<string, any>, verifiedFacts: Record<string, any>) {
  if (!finalReport || !verifiedFacts) return finalReport;
  finalReport.property_snapshot ||= {};
  finalReport.price_assessment ||= {};
  finalReport.carrying_costs ||= {};

  if (verifiedFacts.price != null) {
    finalReport.property_snapshot.askingPrice = verifiedFacts.price;
    finalReport.price_assessment.asking_price = verifiedFacts.price;
  }
  if (verifiedFacts.yearBuilt != null) {
    finalReport.property_snapshot.yearBuilt = verifiedFacts.yearBuilt;
    finalReport.property_snapshot.year_built = verifiedFacts.yearBuilt;
    const targets = [
      finalReport.maintenance_risk,
      finalReport.layout_fit,
      finalReport.neighborhood_lifestyle,
      finalReport.legal_compliance,
      finalReport.legal_and_compliance,
      finalReport.environmental_risk,
    ];
    const wrongYearBuiltPhrases = [
      /year built (is )?(not provided|unknown|not disclosed)/gi,
      /built year (is )?(not provided|unknown|not disclosed)/gi,
      /year built:?\s*(unknown|not provided|not disclosed)/gi,
      /year built not provided\s*[—-]\s*/gi,
      /major system ages unknown and should be checked/gi,
    ];
    for (const section of targets) {
      if (section && typeof section.summary === 'string') {
        for (const re of wrongYearBuiltPhrases) {
          section.summary = section.summary.replace(re, `Built in ${verifiedFacts.yearBuilt} — `);
        }
      }
    }
    if (finalReport.maintenance_risk && typeof finalReport.maintenance_risk.summary === 'string') {
      finalReport.maintenance_risk.summary = finalReport.maintenance_risk.summary
        .replace(/Built in\s+\d{4}\s*[—-]\s*Built in\s+\d{4}\s*[—-]\s*/gi, `Built in ${verifiedFacts.yearBuilt} — `)
        .trim();
      if (!/built in\s+\d{4}/i.test(finalReport.maintenance_risk.summary)) {
        finalReport.maintenance_risk.summary = `Built in ${verifiedFacts.yearBuilt} — ${finalReport.maintenance_risk.summary}`.trim();
      }
    }
  }
  if (verifiedFacts.beds != null) finalReport.property_snapshot.beds = verifiedFacts.beds;
  if (verifiedFacts.baths != null) finalReport.property_snapshot.baths = verifiedFacts.baths;
  if (verifiedFacts.sqft != null) finalReport.property_snapshot.sqft = verifiedFacts.sqft;
  if (verifiedFacts.propertyType) finalReport.property_snapshot.homeType = verifiedFacts.propertyType;
  if (verifiedFacts.annualTax != null) {
    finalReport.property_snapshot.annualTax = verifiedFacts.annualTax;
    finalReport.carrying_costs.annual_tax = verifiedFacts.annualTax;
    if (verifiedFacts.annualTax_display) finalReport.carrying_costs.annual_tax_display = verifiedFacts.annualTax_display;
  }
  if (verifiedFacts.pricePerSqft != null) {
    finalReport.property_snapshot.pricePerSqft = verifiedFacts.pricePerSqft;
    finalReport.price_assessment.price_per_sqft = verifiedFacts.pricePerSqft;
    if (verifiedFacts.pricePerSqft_display) finalReport.price_assessment.price_per_sqft_display = verifiedFacts.pricePerSqft_display;
  }
  if (verifiedFacts.monthlyPayment != null) {
    finalReport.carrying_costs.primary_monthly_estimate = verifiedFacts.monthlyPayment;
  }
  // ── HOA 冲突处理 ──────────────────────────────────────────────────────────
  if (verifiedFacts.hoa === 'inconsistent') {
    finalReport.carrying_costs.hoa = 'Verify HOA Status';
    finalReport.carrying_costs.hoa_conflict = true;
    if (verifiedFacts.hoaAmount != null) {
      finalReport.carrying_costs.hoa_amount = verifiedFacts.hoaAmount;
    }
  } else if (verifiedFacts.hoa === 'no') {
    finalReport.carrying_costs.hoa = 'No';
  } else if (verifiedFacts.hoa === 'yes') {
    finalReport.carrying_costs.hoa = 'Yes';
    if (verifiedFacts.hoaAmount != null) finalReport.carrying_costs.hoa_amount = verifiedFacts.hoaAmount;
  }
  // 如果 hoa === 'unknown', 不设置 carrying_costs.hoa（让它保持 undefined）

  // ── Zestimate 锁定 ─────────────────────────────────────────────────────────
  if (verifiedFacts.zestimate != null) {
    finalReport.price_assessment.zestimate = verifiedFacts.zestimate;
    finalReport.price_assessment.zillow_estimate = verifiedFacts.zestimate;
  }
  if (verifiedFacts.rentZestimate != null) {
    finalReport.price_assessment.rent_zestimate = verifiedFacts.rentZestimate;
  }

  // ── Market Time Guard: extended market time / stale listing only for DOM >= 60 ─
  {
    const dom = verifiedFacts.daysOnMarket ?? verifiedFacts.daysOnZillow;
    const domNum = typeof dom === 'number' ? dom : parseInt(String(dom), 10);
    const hasValidDom = Number.isFinite(domNum);
    const isShortDom = hasValidDom && domNum < 30;
    const isMidDom = hasValidDom && domNum >= 30 && domNum < 60;

    if (isShortDom) {
      // daysOnZillow < 30: never use extended market time / stale listing language
      const applyShortDomReplacements = (obj: unknown): void => {
        if (typeof obj !== 'object' || obj === null || typeof obj === 'function') return;
        if (Array.isArray(obj)) { obj.forEach(applyShortDomReplacements); return; }
        for (const k of Object.keys(obj)) {
          const v = (obj as Record<string, unknown>)[k];
          if (typeof v === 'string') {
            const next = v
              .replace(/\bextended market time\b/gi, 'short market time')
              .replace(/\blong time on market\b/gi, 'early market stage')
              .replace(/\bstale listing\b/gi, 'fresh listing')
              .replace(/\blast longer to sell\b/gi, 'recently listed')
              .replace(/\bhas been on the market\b/gi, 'recently listed');
            if (next !== v) (obj as Record<string, unknown>)[k] = next;
          } else {
            applyShortDomReplacements(v);
          }
        }
      };
      applyShortDomReplacements(finalReport);
    }

    if (isMidDom) {
      // 30 <= daysOnZillow < 60: soften language
      const applyMidDomReplacements = (obj: unknown): void => {
        if (typeof obj !== 'object' || obj === null || typeof obj === 'function') return;
        if (Array.isArray(obj)) { obj.forEach(applyMidDomReplacements); return; }
        for (const k of Object.keys(obj)) {
          const v = (obj as Record<string, unknown>)[k];
          if (typeof v === 'string') {
            const next = v
              .replace(/\bextended market time\b/gi, 'market response still developing')
              .replace(/\blong time on market\b/gi, 'early market response period');
            if (next !== v) (obj as Record<string, unknown>)[k] = next;
          } else {
            applyMidDomReplacements(v);
          }
        }
      };
      applyMidDomReplacements(finalReport);
    }
  }

  // ── Flood Zone: Phase 4 structural repair on environmental_risk ─────────────
  if (verifiedFacts.floodZone) {
    finalReport.property_snapshot.floodZone = verifiedFacts.floodZone;

    const fz = verifiedFacts.floodZone;
    const zoneDisplay = String(fz).startsWith('FEMA') ? String(fz) : `FEMA Zone: ${fz}`;
    const isMinimalRisk = /Zone X|minimal|unshaded/i.test(zoneDisplay);
    const envRisk = finalReport.environmental_risk as Record<string, unknown> | undefined;

    if (envRisk && typeof envRisk === 'object') {
      const defaultSummary = isMinimalRisk
        ? `${zoneDisplay}, a minimal FEMA flood-risk area. Still verify insurance requirements, drainage, and any water-intrusion history.`
        : `${zoneDisplay}. Verify insurance requirements, flood maps, basement water history, and local storm/drainage exposure.`;

      const existingSummary = String(envRisk.summary ?? envRisk.description ?? '');
      const needsOverride = !existingSummary
        || /not stated|unknown|not disclosed|not provided/i.test(existingSummary)
        || existingSummary === 'Environmental Risk';

      if (needsOverride) {
        if ('summary' in envRisk) envRisk.summary = defaultSummary;
        else if ('description' in envRisk) envRisk.description = defaultSummary;
      }

      if ('title' in envRisk) {
        envRisk.title = isMinimalRisk
          ? 'Flood / Drainage — Lower FEMA Risk, Still Verify'
          : 'Flood / Drainage Verification';
      }

      if (!('risk_level' in envRisk) || /unknown|not provided/i.test(String(envRisk.risk_level ?? ''))) {
        envRisk.risk_level = isMinimalRisk ? 'Low / Verify' : 'Medium';
      }

      if (!envRisk.items_to_check || !Array.isArray(envRisk.items_to_check)) {
        (envRisk as Record<string, unknown>).items_to_check = [];
      }
      const items: string[] = (envRisk as Record<string, unknown>).items_to_check as string[];
      if (!items.some((item) => /flood/i.test(String(item)))) {
        items.unshift(`Flood Zone: ${zoneDisplay} — verify insurance cost and basement water history`);
      }
    }

    // Fix generic flood questions in top-level questions arrays
    const topQuestions: unknown[] =
      finalReport.questions_to_ask
      ?? finalReport.questions
      ?? [];
    const floodQReplacement = 'Does the stated flood zone affect insurance requirements, drainage risk, or basement water history?';
    for (const q of topQuestions) {
      if (typeof q === 'object' && q !== null) {
        const qObj = q as Record<string, unknown>;
        const qText = String(qObj.text ?? qObj.question ?? '');
        if (/is the property in a flood zone\?/i.test(qText)) {
          if ('text' in qObj) qObj.text = floodQReplacement;
          if ('question' in qObj) qObj.question = floodQReplacement;
        }
      } else if (typeof q === 'string' && /is the property in a flood zone\?/i.test(q)) {
        const idx = topQuestions.indexOf(q);
        topQuestions[idx] = floodQReplacement;
      }
    }
  }

  // ── Address 确定性锁定 ─────────────────────────────────────────────────────
  if (verifiedFacts.address) {
    finalReport.verifiedFacts = finalReport.verifiedFacts || {};
    finalReport.verifiedFacts.address = verifiedFacts.address;
  }

  if (verifiedFacts.fieldEvidence) {
    finalReport.verifiedFacts = {
      ...(finalReport.verifiedFacts || {}),
      ...verifiedFacts,
      fieldEvidence: verifiedFacts.fieldEvidence,
    };
  }
  finalReport = stripSingleFamilyRentalLanguage(finalReport, verifiedFacts);
  console.log('[FINAL_FACTS_AFTER_NORMALIZE]', {
    yearBuilt: finalReport?.property_snapshot?.yearBuilt ?? null,
    askingPrice: finalReport?.price_assessment?.asking_price ?? null,
    annualTax: finalReport?.carrying_costs?.annual_tax ?? null,
    pricePerSqft: finalReport?.price_assessment?.price_per_sqft ?? finalReport?.property_snapshot?.pricePerSqft ?? null,
    monthlyPayment: finalReport?.carrying_costs?.primary_monthly_estimate ?? null,
    hoa: finalReport?.carrying_costs?.hoa ?? null,
  });
  return finalReport;
}

function normalizeStep2Decision(
  decision: AnyRecord | null | undefined,
  market: Market,
  optionalDetails?: Record<string, unknown>
): AnyRecord {
  const fallback = '';
  const fallbackArr: string[] = [];

  const priceRaw = (decision?.price_assessment ?? {}) as Record<string, unknown>;

  // Determine asking_price: priority is decision field > optionalDetails > null
  const asking_price = firstValidPrice(
    parsePriceToNumber(priceRaw.asking_price),
    optionalDetails?.askingPrice,
    optionalDetails?.price,
  );

  // Determine estimated_min / estimated_max (AU has these; US may not)
  const estimated_min = parsePriceToNumber(priceRaw.estimated_min)
    ?? parsePriceToNumber(priceRaw.estimatedValueMin)
    ?? parsePriceToNumber(priceRaw.estimated_value_min)
    ?? null;
  const estimated_max = parsePriceToNumber(priceRaw.estimated_max)
    ?? parsePriceToNumber(priceRaw.estimatedValueMax)
    ?? parsePriceToNumber(priceRaw.estimated_value_max)
    ?? null;

  // verdict: US uses "assessment", AU uses "verdict"
  const rawVerdict = priceRaw.verdict
    ?? priceRaw.assessment
    ?? priceRaw.price_position
    ?? fallback;

  // explanation: US uses "reasoning"/"market_context", AU uses "explanation"
  const explanation = String(
    priceRaw.explanation
    ?? priceRaw.reasoning
    ?? priceRaw.market_context
    ?? priceRaw.zestimate_context
    ?? fallback
  );

  const verdict = normalizePriceVerdict(rawVerdict, explanation, asking_price);

  // pros: US uses "what_looks_good", AU uses "pros"
  const prosRaw = decision?.pros ?? decision?.what_looks_good ?? decision?.strengths ?? [];
  const pros = Array.isArray(prosRaw) ? prosRaw.filter((p): p is string => typeof p === 'string') : fallbackArr;

  // cons: US uses "risk_signals", AU uses "cons"
  const consRaw = decision?.cons ?? decision?.risk_signals ?? decision?.risks ?? [];
  const cons = Array.isArray(consRaw) ? consRaw.filter((c): c is string => typeof c === 'string') : fallbackArr;

  // overall_verdict: US uses "quick_summary" + "recommendation.verdict"
  const overall_verdict = String(
    decision?.overall_verdict
    ?? (decision?.recommendation as Record<string, unknown>)?.verdict
    ?? decision?.verdict
    ?? fallback
  );

  // quick_summary: US uses "quick_summary", AU may use "summary"
  const quick_summary = String(
    decision?.quick_summary
    ?? decision?.summary
    ?? (decision?.recommendation as Record<string, unknown>)?.reasoning
    ?? fallback
  );

  // ── New US Sale decision support fields ──
  // Build property_snapshot from body (extension sends listing data at body top-level)
  const rawSnapshot = (decision as any).property_snapshot;
  const property_snapshot = rawSnapshot ?? {
    beds: (optionalDetails as any)?.bedrooms ?? null,
    baths: (optionalDetails as any)?.bathrooms ?? null,
    sqft: (optionalDetails as any)?.sqft ?? null,
    lot_size: (optionalDetails as any)?.lotSize ?? null,
    year_built: (optionalDetails as any)?.yearBuilt ?? null,
    home_type: String((optionalDetails as any)?.propertyType ?? ''),
    property_subtype: String((optionalDetails as any)?.propertySubtype ?? ''),
    architectural_style: String((optionalDetails as any)?.architecturalStyle ?? ''),
    stories: (optionalDetails as any)?.stories ?? null,
    parking: String((optionalDetails as any)?.parking ?? ''),
    hoa: String((optionalDetails as any)?.hoaFee ?? ''),
    annual_tax: (optionalDetails as any)?.annualTaxAmount ?? parsePriceToNumber((optionalDetails as any)?.annualTax ?? (optionalDetails as any)?.propertyTax) ?? null,
    tax_assessed_value: (optionalDetails as any)?.taxAssessedValueAmount ?? parsePriceToNumber((optionalDetails as any)?.taxAssessedValue) ?? null,
    price_per_sqft: (optionalDetails as any)?.pricePerSqftAmount ?? parsePriceToNumber((optionalDetails as any)?.pricePerSqft) ?? null,
    roof: String((optionalDetails as any)?.roof ?? ''),
    materials: String((optionalDetails as any)?.constructionMaterial ?? ''),
    heating: String((optionalDetails as any)?.heating ?? ''),
    basement: String((optionalDetails as any)?.basement ?? ''),
    fireplace: String((optionalDetails as any)?.fireplace ?? ''),
    region: String((optionalDetails as any)?.region ?? (optionalDetails as any)?.suburb ?? ''),
  };

  const carryingCostsRaw = (decision as any).carrying_costs;
  const carrying_costs = carryingCostsRaw ? {
    annual_tax: typeof carryingCostsRaw.annual_tax === 'number' ? carryingCostsRaw.annual_tax
      : carryingCostsRaw.annual_tax != null ? parseFloat(String(carryingCostsRaw.annual_tax)) || null
      : null,
    monthly_tax_equivalent: typeof carryingCostsRaw.monthly_tax_equivalent === 'number' ? carryingCostsRaw.monthly_tax_equivalent
      : carryingCostsRaw.monthly_tax_equivalent != null ? parseFloat(String(carryingCostsRaw.monthly_tax_equivalent)) || null
      : null,
    hoa: carryingCostsRaw.hoa ?? 'Unknown',
    cost_pressure: carryingCostsRaw.cost_pressure ?? 'Unknown',
    summary: carryingCostsRaw.summary ?? '',
    missing_costs: Array.isArray(carryingCostsRaw.missing_costs) ? carryingCostsRaw.missing_costs : [],
  } : ((optionalDetails as any)?.annualTax || (optionalDetails as any)?.propertyTax || (optionalDetails as any)?.hoaFee) ? {
    annual_tax: parsePriceToNumber((optionalDetails as any)?.annualTax ?? (optionalDetails as any)?.propertyTax) ?? null,
    monthly_tax_equivalent: null,
    hoa: ((optionalDetails as any)?.hoaFee) ? 'Yes' : 'No',
    cost_pressure: 'Unknown',
    summary: '',
    missing_costs: ['insurance', 'utilities', 'maintenance', 'mortgage'],
  } : {};

  const maintenance_risk = (decision as any).maintenance_risk ?? {};

  const layout_fit = (decision as any).layout_fit ?? null;

  const listing_language_reality_check = Array.isArray((decision as any).listing_language_reality_check)
    ? (decision as any).listing_language_reality_check
    : [];

  const neighborhood_lifestyle = (decision as any).neighborhood_lifestyle ?? {};

  // Inject extracted Zillow location data into neighborhood_lifestyle if AI output is empty
  const extractedLocation = (decision as any)._extractedLocation ?? {};
  if (extractedLocation.neighborhood || extractedLocation.floodZone || extractedLocation.walkScore || extractedLocation.bikeScore || extractedLocation.schoolRatings || extractedLocation.transit) {
    const signals: string[] = [];
    const extNeeded: string[] = [];
    if (extractedLocation.neighborhood) signals.push(`Neighborhood: ${extractedLocation.neighborhood}`);
    if (extractedLocation.walkScore) signals.push(`Walk Score: ${extractedLocation.walkScore}`);
    if (extractedLocation.bikeScore) signals.push(`Bike Score: ${extractedLocation.bikeScore}`);
    if (extractedLocation.schoolRatings) signals.push(`School Ratings: ${extractedLocation.schoolRatings}`);
    if (extractedLocation.floodZone) signals.push(`Flood Zone: ${extractedLocation.floodZone}`);
    if (!extractedLocation.walkScore) extNeeded.push('Walk Score / Transit Score');
    if (!extractedLocation.schoolRatings) extNeeded.push('School ratings');
    if (!extractedLocation.floodZone) extNeeded.push('Flood zone');
    (neighborhood_lifestyle as any).page_signals = signals.length ? signals : (neighborhood_lifestyle as any).page_signals ?? [];
    (neighborhood_lifestyle as any).external_data_needed = extNeeded.length ? extNeeded : (neighborhood_lifestyle as any).external_data_needed ?? [];
  }

  const legal_compliance = (decision as any).legal_compliance ?? {};

  const environmental_risk = (decision as any).environmental_risk ?? {};

  // Inject flood zone into environmental_risk when available from Zillow
  if (extractedLocation.floodZone) {
    if (!environmental_risk.items_to_check) (environmental_risk as any).items_to_check = [];
    const fzList: string[] = (environmental_risk as any).items_to_check;
    const hasFloodEntry = fzList.some((item: any) => /flood/i.test(String(item)));
    if (!hasFloodEntry) {
      fzList.push(`Flood Zone: ${extractedLocation.floodZone} — verify flood insurance cost and any basement water history`);
    }
  }

  const data_gaps = Array.isArray((decision as any).data_gaps)
    ? (decision as any).data_gaps
    : [];

  // investment_potential: extend with new nested metrics fields
  const rawInvestment = (decision as any).investment_potential ?? {};
  const investment_potential = {
    ...rawInvestment,
    rating: rawInvestment.rating ?? 'Unknown',
    summary: rawInvestment.summary ?? '',
    supporting_signals: Array.isArray(rawInvestment.supporting_signals) ? rawInvestment.supporting_signals : [],
    risks: Array.isArray(rawInvestment.risks) ? rawInvestment.risks
      : Array.isArray(rawInvestment.key_concerns) ? rawInvestment.key_concerns : [],
    things_to_verify: Array.isArray(rawInvestment.things_to_verify) ? rawInvestment.things_to_verify : [],
    rent_estimate_available: rawInvestment.rent_estimate_available === true,
    estimated_monthly_rent: typeof rawInvestment.estimated_monthly_rent === 'number' ? rawInvestment.estimated_monthly_rent
      : rawInvestment.estimated_monthly_rent != null ? parseFloat(String(rawInvestment.estimated_monthly_rent)) || null
      : null,
    investment_metrics: rawInvestment.investment_metrics ?? null,
  };

  return {
    ...(decision ?? {}),
    overall_verdict,
    quick_summary,
    pros,
    cons,
    price_assessment: {
      estimated_min,
      estimated_max,
      asking_price,
      verdict,
      explanation,
    },
    property_snapshot,
    carrying_costs,
    maintenance_risk,
    layout_fit,
    listing_language_reality_check,
    neighborhood_lifestyle,
    legal_compliance,
    environmental_risk,
    data_gaps,
    investment_potential,
  };
}

// ========== Reality Check Types & Functions ==========

type RealityCheckVerdict = "Mostly factual" | "Some promotional wording" | "Marketing-heavy";

interface RealityCheck {
  should_display: boolean;
  overall_verdict?: RealityCheckVerdict;
  summary?: string;
  marketing_phrases?: string[];
  missing_specifics?: string[];
  support_gaps?: string[];
  confidence?: "low" | "medium" | "high";
  listing_language_reality_check?: Array<{
    phrase: string;
    what_it_may_mean: string;
    what_to_verify: string;
  }>;
}

const REALITY_CHECK_SYSTEM_PROMPT = `You are a rental listing analyst. Your job is to analyze listing descriptions for promotional language and marketing tactics.

CRITICAL RULES:
1. Be cautious and grounded - only analyze what is explicitly stated
2. Do NOT hallucinate or make assumptions
3. Do NOT make legal conclusions or accusations
4. Do NOT use words like "deceptive", "fraud", "scam", "illegal", "misleading"
5. Keep tone neutral, careful, and light
6. If not enough meaningful text, return { "should_display": false }

Analyze the listing text for:
- promotional wording (superlatives, exaggerated claims)
- vague attractive phrases (e.g., "bright", "spacious", "modern" without evidence)
- important specifics that are missing (e.g., exact measurements, condition details)
- claims not clearly supported by photos (if photos are provided)

Return STRICT JSON only:
{
  "should_display": true,
  "overall_verdict": "Mostly factual" | "Some promotional wording" | "Marketing-heavy",
  "summary": "Brief neutral summary of your findings",
  "marketing_phrases": ["phrase 1", "phrase 2"],
  "missing_specifics": ["specific 1", "specific 2"],
  "support_gaps": ["gap 1", "gap 2"],
  "confidence": "low" | "medium" | "high"
}

If the text is too short, purely factual (address/price only), or lacks descriptive language, return { "should_display": false }`;

function isMeaningfulListingText(text: string): boolean {
  if (!text || text.length < 20) return false;

  const trimmed = text.trim();

  // Check if it's just address, price, or room counts
  const isOnlyAddress = /^\d+\s+[\w\s]+(street|road|avenue|ave|road|rd|dr|drive|lane|ln|way|ct|court|pl|place|blvd|boulevard)[,.\s]/i.test(trimmed);
  const isOnlyPrice = /^\$?\d+[\d,\.]*(per?\s*week|weekly|pw|w\/?k)?$/i.test(trimmed);
  const isOnlyRooms = /^(bedroom|bed|bath|bathroom|toilet|parking|park|room)\s*:?\s*\d+$/i.test(trimmed);
  const isOnlyTags = /^[\#\w\s,-]+$/i.test(trimmed) && trimmed.split(/\s+/).length < 10;

  if (isOnlyAddress || isOnlyPrice || isOnlyRooms || isOnlyTags) return false;

  // Check for descriptive language
  const descriptiveWords = /\b(beautiful|stunning|amazing|spacious|bright|modern|renovated|luxury|cozy|warm|quiet|location|convenient|close|near|minutes|walking|transport|school|shop|beach|view|garden|backyard|balcony|recent|new|fresh|clean|maintained|present|appear|seem|looking)\b/gi;
  const matches = trimmed.match(descriptiveWords) || [];

  return matches.length >= 2;
}

function normalizeRealityCheck(input: unknown): RealityCheck {
  // If input doesn't exist or should_display is not true
  if (!input || (typeof input === 'object' && (input as Record<string, unknown>).should_display !== true)) {
    return { should_display: false };
  }

  const data = input as Record<string, unknown>;

  // Validate overall_verdict
  const validVerdicts: RealityCheckVerdict[] = ["Mostly factual", "Some promotional wording", "Marketing-heavy"];
  let verdict: RealityCheckVerdict = "Some promotional wording";
  if (typeof data.overall_verdict === 'string' && validVerdicts.includes(data.overall_verdict as RealityCheckVerdict)) {
    verdict = data.overall_verdict as RealityCheckVerdict;
  }

  // Validate summary
  let summary: string = "";
  if (typeof data.summary === 'string') {
    summary = data.summary;
  }

  // Validate arrays
  const marketing_phrases = Array.isArray(data.marketing_phrases)
    ? data.marketing_phrases.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : [];

  const missing_specifics = Array.isArray(data.missing_specifics)
    ? data.missing_specifics.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : [];

  const support_gaps = Array.isArray(data.support_gaps)
    ? data.support_gaps.filter((item): item is string => typeof item === 'string').slice(0, 3)
    : [];

  // Validate confidence
  const validConfidences = ["low", "medium", "high"];
  let confidence: "low" | "medium" | "high" = "medium";
  if (typeof data.confidence === 'string' && validConfidences.includes(data.confidence)) {
    confidence = data.confidence as "low" | "medium" | "high";
  }

  // Extract listing_language_reality_check (the Spin Decoder entries)
  const spinRaw = data.listing_language_reality_check ?? data.listingLanguageRealityCheck;
  const spinEntries: Array<{ phrase: string; what_it_may_mean: string; what_to_verify: string }> = [];
  if (Array.isArray(spinRaw)) {
    for (const item of spinRaw) {
      if (item && typeof item === 'object') {
        const phrase = String(item.phrase ?? item.title ?? '').trim();
        const what_it_may_mean = String(item.what_it_may_mean ?? item.meaning ?? item.description ?? '').trim();
        const what_to_verify = String(item.what_to_verify ?? item.ask ?? item.question ?? '').trim();
        if (phrase && what_it_may_mean) {
          spinEntries.push({ phrase, what_it_may_mean, what_to_verify });
        }
      }
    }
  }

  return {
    should_display: true,
    overall_verdict: verdict as RealityCheckVerdict,
    summary,
    marketing_phrases,
    missing_specifics,
    support_gaps,
    confidence: confidence as "low" | "medium" | "high",
    listing_language_reality_check: spinEntries.length > 0 ? spinEntries : undefined,
  };
}

async function runRealityCheck(
  openRouterApiKey: string,
  userText: string,
  visibleListingText: string = ""
): Promise<RealityCheck> {
  // Combine texts
  const combinedListingText = [userText, visibleListingText].filter(Boolean).join("\n\n");

  // Check if we have enough meaningful text
  if (!isMeaningfulListingText(combinedListingText)) {
    return { should_display: false };
  }

  const messages = [
    { role: "system", content: REALITY_CHECK_SYSTEM_PROMPT },
    { role: "user", content: `LISTING TEXT TO ANALYZE:\n${combinedListingText}\n\nAnalyze this listing text for promotional language and marketing tactics. Return JSON only.` }
  ];

  const requestBody = {
    model: "openai/gpt-5-mini",
    messages,
    temperature: 0.3,
    max_tokens: 800,
  };

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
          "X-Title": "Rental Property Analyzer",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      console.error("[RealityCheck] API error:", response.status);
      return { should_display: false };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[RealityCheck] No content in API response");
      return { should_display: false };
    }

    console.log("[RealityCheck] Raw AI response (first 600 chars):", content.slice(0, 600));
    const parsed = safeParseModelJson(content);
    console.log("[RealityCheck] Parsed result:", JSON.stringify(parsed)?.slice(0, 400));

    if (!parsed) {
      console.error("[RealityCheck] safeParseModelJson returned null/undefined");
      return { should_display: false };
    }

    const result = normalizeRealityCheck(parsed);
    console.log("[RealityCheck] Final result:", JSON.stringify(result)?.slice(0, 400));
    return result;
  } catch (err) {
    console.error("[RealityCheck] Error:", err);
    return { should_display: false };
  }
}

// ========== Basic Report Cleanup Helpers ==========

/**
 * normalizeTop3Checks — backend enforcement for top_3_things_to_check (US Basic v2)
 * Input schema: [{ title, why_it_matters, action }]
 * Rules:
 * - Force exactly 3 items.
 * - If AI returns fewer, fill with US-standard fallbacks tailored to property type.
 * - If AI returns more, truncate to 3.
 * - Strip "without X" patterns referencing already-known fields.
 * - Title <= 60 chars, action <= 120 chars (hard truncate).
 */
function normalizeTop3Checks(result: any, optionalDetails?: Record<string, unknown>, profile?: PropertyIntelligenceProfile): any {
  const opts = optionalDetails ?? {};
  const wwKnow = result.what_we_know ?? {};
  const yearBuilt = opts.yearBuilt ?? wwKnow.year_built ?? wwKnow.yearBuilt ?? null;
  const propertyType = (opts.propertyType ?? wwKnow.property_type ?? wwKnow.propertyType ?? '').toLowerCase();
  const listingText = String(opts.description ?? opts.listingDescription ?? opts.whatSpecial ?? opts.whatsSpecialText ?? '').toLowerCase();
  const pricePerSqft = opts.pricePerSqft ?? wwKnow.price_per_sqft ?? wwKnow.pricePerSqft ?? null;
  const askingPrice = opts.askingPrice ?? wwKnow.asking_price ?? wwKnow.askingPrice ?? wwKnow.price ?? null;
  const hasSqft = !!(opts.sqft ?? wwKnow.sqft ?? wwKnow.square_feet ?? wwKnow.squareFeet);
  const hasBeds = !!(opts.bedrooms ?? wwKnow.beds ?? wwKnow.bedrooms);
  const hasBaths = !!(opts.bathrooms ?? wwKnow.baths ?? wwKnow.bathrooms);
  const hasPrice = !!(askingPrice);
  const hasHOA = !!(opts.hoaFee ?? wwKnow.hoa ?? wwKnow.HOA ?? wwKnow.hoa_fee ?? wwKnow.hoaFee);
  const hasBasementMention = /basement|cellar|below.?grade|walk.?out/i.test(listingText);
  const isCondoOrCoop = /condo|co.?op|townhouse/i.test(propertyType);
  const isMultiFamily = /duplex|multi.?family|2\.?family|3\.?family|4\.?family|two.?family/i.test(propertyType);
  const hasComps = !!(wwKnow.comparable_sales ?? wwKnow.comparableSales ?? wwKnow.zestimate);
  const isOld = yearBuilt && Number(yearBuilt) < 1975;
  const hasRenovationMention = /renovation|updated|remodel|newly.?done|refurbish/i.test(listingText);

  // Use profile.category if available, otherwise fall back to raw type detection
  const profileCategory = profile?.propertyCategory ?? (
    isCondoOrCoop ? 'condo' :
    isMultiFamily ? 'multi_family' :
    'single_family'
  );

  const avoid = profile?.irrelevantGenericRisksToAvoid ?? [];
  const avoidPatterns = avoid.map(r => new RegExp(r.replace(/\s+/g, '\\s*'), 'i'));
  const isForbidden = (text: string) =>
    avoidPatterns.some(p => p.test(text));

  const hasKnown = (re: RegExp) => re;
  const stripKnown = (s: string): string => {
    let out = s;
    if (hasSqft) out = out.replace(hasKnown(/without\s+(sqft|square\s*footage|square\s*feet|interior\s*(size|area)?)\s*,?\s*/gi), '');
    if (hasBeds) out = out.replace(hasKnown(/without\s+(beds?|bedrooms?)\s*,?\s*/gi), '');
    if (hasBaths) out = out.replace(hasKnown(/without\s+(baths?|bathrooms?)\s*,?\s*/gi), '');
    if (hasPrice) out = out.replace(hasKnown(/without\s+(asking\s*price|listing\s*price)\s*,?\s*/gi), '');
    return out.replace(/\s{2,}/g, ' ').trim();
  };

  const sanitizeItem = (raw: any) => {
    if (!raw) return null;
    if (typeof raw === 'string') {
      return { title: raw.slice(0, 60), why_it_matters: '', action: '' };
    }
    const title = typeof raw.title === 'string' ? raw.title : '';
    const why = typeof raw.why_it_matters === 'string' ? raw.why_it_matters : (typeof raw.explanation === 'string' ? raw.explanation : '');
    const action = typeof raw.action === 'string' ? raw.action : (typeof raw.ask === 'string' ? raw.ask : '');
    const cleanedTitle = stripKnown(title);
    const cleanedWhy = stripKnown(why);
    const cleanedAction = stripKnown(action);
    return {
      title: cleanedTitle.length > 60 ? cleanedTitle.slice(0, 57) + '...' : cleanedTitle,
      why_it_matters: cleanedWhy.slice(0, 200),
      action: cleanedAction.length > 120 ? cleanedAction.slice(0, 117) + '...' : cleanedAction,
    };
  };

  const rawList: any[] = Array.isArray(result.top_3_things_to_check) ? result.top_3_things_to_check : [];
  const cleaned: Array<{ title: string; why_it_matters: string; action: string }> = [];

  // Category-level deduplication: same category only keeps the first item
  const CATEGORY_BUCKETS: Array<{ name: string; patterns: RegExp[] }> = [
    {
      name: 'PriceValue',
      patterns: [/compar?|comps?/i, /sold|market\s*value|price\s*fair|price\s*confidence/i],
    },
    {
      name: 'Condition',
      patterns: [/system|roof|hvac|electrical|plumb|age/i],
    },
    {
      name: 'LegalTitle',
      patterns: [/permit|legal|co |occupancy|certificate/i],
    },
    {
      name: 'Cost',
      patterns: [/hoa|reserve|assessment|insurance|tax|cost/i],
    },
  ];
  const seenCategories = new Set<string>();

  const getItemCategory = (title: string): string | null => {
    for (const bucket of CATEGORY_BUCKETS) {
      if (bucket.patterns.some(p => p.test(title))) return bucket.name;
    }
    return null;
  };

  for (const item of rawList) {
    const s = sanitizeItem(item);
    if (!s || !s.title) continue;
    const itemCat = getItemCategory(s.title);
    if (itemCat && seenCategories.has(itemCat)) continue;  // same category, skip
    if (itemCat) seenCategories.add(itemCat);
    cleaned.push(s);
    if (cleaned.length >= 4) break;
  }

  // Semantic dedup: remove items that are semantically identical even if in different categories.
  // Example: "At $X/sqft, Comps Matter" (PriceValue) and "Comparable Sales" (uncategorized)
  // both target the same decision question. Use token-overlap Jaccard > 0.40 as trigger.
  for (let i = 0; i < cleaned.length; i++) {
    const qi = cleaned[i].title + ' ' + cleaned[i].why_it_matters;
    const qiTokens = new Set(qi.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2));
    for (let j = i + 1; j < cleaned.length; j++) {
      const qj = cleaned[j].title + ' ' + cleaned[j].why_it_matters;
      const qjTokens = new Set(qj.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2));
      let intersection = 0;
      for (const t of qiTokens) { if (qjTokens.has(t)) intersection++; }
      const union = qiTokens.size + qjTokens.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard > 0.40) {
        // Higher token count = more specific. Remove the shorter/less specific one.
        if (cleaned[i].title.length >= cleaned[j].title.length) {
          cleaned.splice(j, 1); j--;
        } else {
          cleaned.splice(i, 1); i--; break;
        }
      }
    }
  }

  // If AI returned fewer than 2 usable items, build property-specific fallbacks — NOT generic templates
  if (cleaned.length < 2) {
    const builtIn = yearBuilt ? `Built in ${yearBuilt}` : null;

    // Detect whether AI already covered comps — skip duplicate fallback items
    const aiHasComps = cleaned.some(item =>
      /compar?|comps?|sold|market\s*value|price\s*fair/i.test(item.title + ' ' + item.why_it_matters)
    );
    const aiHasBasement = cleaned.some(item =>
      /basement|cellar|egress|walk.?out|below.?grade/i.test(item.title + ' ' + item.why_it_matters)
    );

    let fallbacks: Array<{ title: string; why_it_matters: string; action: string }> = [];

    // ── Profile-aware fallback generation ─────────────────────────────────────────
    // Only add roof/HVAC/plumbing risks for asset types where buyer owns/maintains systems
    const SYSTEM_MAINTENANCE_OWNER_TYPES = new Set(['single_family', 'multi_family', 'townhouse']);

    if (isOld && builtIn && SYSTEM_MAINTENANCE_OWNER_TYPES.has(profileCategory) && !isForbidden(`${builtIn} Major Systems`)) {
      fallbacks.push({
        title: `${builtIn}: Major Systems Age`,
        why_it_matters: `A home from ${yearBuilt} likely has aging roof, HVAC, electrical, or plumbing — all significant repair costs before year one.`,
        action: 'Ask for roof age, HVAC age, electrical panel type, plumbing material, and any recent system updates or repairs.',
      });
    } else if (isOld && builtIn && (profileCategory === 'co_op' || profileCategory === 'condo')) {
      // Co-op/condo old building: check if listing has stronger signals before defaulting to building financials
      const hasFinancialSignal = /flip tax|reserve|assessment|maintenance breakdown|building financials/i.test(listingText);
      if (!hasFinancialSignal && !isForbidden('Building Financial Health')) {
        fallbacks.push({
          title: `Built in ${yearBuilt}: Building Financial Health`,
          why_it_matters: `A building from ${yearBuilt} may have aging infrastructure — reserve fund health and upcoming assessments are a decision-changing cost for all unit owners.`,
          action: 'Ask for the building\'s reserve fund balance, recent financial statements, and any planned special assessments.',
        });
      }
    }

    if (hasPrice && hasSqft && pricePerSqft && !aiHasComps && !isForbidden('Comparable Sales')) {
      const displayVal = typeof pricePerSqft === 'string' ? pricePerSqft : `$${Number(pricePerSqft).toLocaleString()}/sqft`;
      fallbacks.push({
        title: `At ${displayVal}, Comps Matter`,
        why_it_matters: `The $/sqft is visible but condition and comparable sales are needed before judging whether the asking price is justified.`,
        action: 'Ask for 3–5 recent nearby comparable sales before relying on the asking price or Zestimate range.',
      });
    }

    // Basement fallback only for single-family/multi-family/townhouse
    if (hasBasementMention && !aiHasBasement &&
        SYSTEM_MAINTENANCE_OWNER_TYPES.has(profileCategory) &&
        !isForbidden('Basement')) {
      fallbacks.push({
        title: 'Basement: Permits, Egress, and Legal Use',
        why_it_matters: 'The listing mentions a basement — but permits, legal use, and proper egress have not been verified. Without permits, this space can block financing and insurance.',
        action: 'Confirm whether the basement is permitted, finished legally, has proper egress, and whether any area is counted in the legal sqft.',
      });
    }

    // Co-op/Condo HOA fallback
    if ((profileCategory === 'co_op' || profileCategory === 'condo') && hasHOA && !isForbidden('HOA')) {
      fallbacks.push({
        title: 'HOA: Reserves, Assessments, and Special Fees',
        why_it_matters: 'HOA fees are visible, but reserve fund health, pending special assessments, and rental limits are not — and can significantly affect total cost.',
        action: 'Ask for the HOA reserve fund balance, last reserve study, any pending special assessments, and whether there are rental or pet restrictions.',
      });
    }

    // Multi-family CO fallback
    if (profileCategory === 'multi_family' && !isForbidden('Certificate of Occupancy')) {
      fallbacks.push({
        title: 'Multi-Family: Certificate of Occupancy and Legal Unit Count',
        why_it_matters: 'A multi-family claim is listed, but the Certificate of Occupancy must confirm how many units are legally approved before you can rely on rental income.',
        action: 'Ask for the Certificate of Occupancy and confirm the legal unit count and approved use for each unit.',
      });
    }

    if (!isOld && hasPrice && hasSqft && !pricePerSqft && !aiHasComps && !isForbidden('Comparable Sales')) {
      fallbacks.push({
        title: 'Price Confidence',
        why_it_matters: 'The asking price and $/sqft are visible, but comparable sales and condition evidence are needed before judging whether the price is fair.',
        action: 'Ask for 3–5 recent comparable sales in the neighborhood before relying on the asking price.',
      });
    }

    if (hasRenovationMention && !isForbidden('Renovation')) {
      fallbacks.push({
        title: 'Renovation: Permits and Inspection History',
        why_it_matters: 'Renovation or update claims are in the listing — without permits on record, there is no confirmation the work was done legally or to code.',
        action: 'Ask which renovations were done, whether permits were pulled, and request copies of inspection or certificate of completion records.',
      });
    }

    if (!hasComps && hasPrice && !aiHasComps && !isForbidden('Comparable Sales') &&
        !fallbacks.some(f => /comps?|market\s*value|price\s*fair|sold\s*data/i.test(f.title))) {
      fallbacks.push({
        title: 'Comparable Sales',
        why_it_matters: 'No comparable sales data is available from the listing. Without recent nearby sales, it is difficult to judge whether the asking price is reasonable.',
        action: 'Ask for 3–5 recent comparable sales within 0.5 miles that are similar in size, beds/baths, and condition.',
      });
    }

    // Fallback intra-dedup: prevent multiple comps items within fallbacks themselves
    // (e.g. "At $X/sqft, Comps Matter" + "Comparable Sales" can both be pushed above)
    const compsPattern = /comps?|market\s*value|price\s*fair|sold\s*data/i;
    const compsItems = fallbacks.filter(f => compsPattern.test(f.title));
    if (compsItems.length > 1) {
      const best = compsItems.reduce((a, b) => a.title.length >= b.title.length ? a : b);
      fallbacks = fallbacks.filter(f => !compsPattern.test(f.title));
      fallbacks.push(best);
    }

  // Only fill from fallbacks when AI returns fewer than 2 items; never force 3 items
  // But for property types with required decision coverage, also check coverage depth
  const requiredKeywords = REQUIRED_DECISION_KEYWORDS[profileCategory ?? 'single_family'] ?? [];
  const coverageCount = requiredKeywords.filter(kw =>
    cleaned.some(item => (item.title + item.why_it_matters).toLowerCase().includes(kw))
  ).length;
  const needsCoverage = coverageCount < Math.max(2, Math.ceil(requiredKeywords.length / 2));

  if (cleaned.length < 2 || needsCoverage) {
    for (const fb of fallbacks) {
      if (cleaned.length >= 4) break;
      const duplicate = cleaned.some(c => c.title.toLowerCase() === fb.title.toLowerCase());
      if (!duplicate) cleaned.push(fb);
    }
  }

  }

  result.top_3_things_to_check = cleaned.slice(0, 4);
  return result;
}

/**
 * normalizeWhatsMissing — backend enforcement for whats_missing (US Basic v2)
 * Input: string[] (short phrases, no periods).
 * Rules:
 * - Force exactly 6 items.
 * - Trim, strip trailing periods, dedupe (case-insensitive).
 * - Fill with property-type-specific pool if short.
 */

const US_WHATS_MISSING_FALLBACKS: string[] = [
  'Major systems age: roof / HVAC / electrical / plumbing',
  'Basement legal use, permits, and egress',
  'Comparable sales',
  'Certificate of Occupancy or legal-use documents',
  'Open permits or violations',
  'Actual insurance and utility costs',
];

function normalizeWhatsMissing(result: any, optionalDetails?: Record<string, unknown>, profile?: PropertyIntelligenceProfile): any {
  const opts = optionalDetails ?? {};
  const rawList: any[] = Array.isArray(result.whats_missing) ? result.whats_missing : [];
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const t = item.replace(/\.+$/g, '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(t);
    if (cleaned.length >= 6) break;
  }

  // If AI returned at least 4 items, use as-is (no forcing, no padding)
  if (cleaned.length >= 4) {
    result.whats_missing = cleaned.slice(0, 6);
    return result;
  }

  // AI returned fewer than 4 — build property-type-specific fallbacks
  const wwKnow = result.what_we_know ?? {};
  const yearBuilt = opts.yearBuilt ?? wwKnow.year_built ?? wwKnow.yearBuilt ?? null;
  const propertyType = (opts.propertyType ?? wwKnow.property_type ?? wwKnow.propertyType ?? '').toLowerCase();
  const listingText = String(opts.description ?? opts.listingDescription ?? opts.whatSpecial ?? opts.whatsSpecialText ?? '').toLowerCase();
  const hasBeds = !!(opts.bedrooms ?? wwKnow.beds ?? wwKnow.bedrooms);
  const hasSqft = !!(opts.sqft ?? wwKnow.sqft ?? wwKnow.square_feet ?? wwKnow.squareFeet);
  const hasPrice = !!(opts.askingPrice ?? wwKnow.asking_price ?? wwKnow.askingPrice ?? wwKnow.price);
  const hasHOA = !!(opts.hoaFee ?? wwKnow.hoa ?? wwKnow.HOA ?? wwKnow.hoa_fee ?? wwKnow.hoaFee);
  const hasTax = !!(opts.annualTax ?? opts.annualTaxAmount ?? opts.taxAnnual ?? wwKnow.tax_year ?? wwKnow.taxes ?? wwKnow.annual_tax);
  const hasComps = !!(wwKnow.comparable_sales ?? wwKnow.comparableSales ?? wwKnow.zestimate);

  const hasBasementMention = /basement| cellar|below.?grade|walk.?out/i.test(listingText);
  const hasRenovationMention = /renovation|updated|remodel|newly.?done|refurbish/i.test(listingText);
  const isOld = yearBuilt && Number(yearBuilt) < 1975;
  const hasHighPricePerSqft = !!(wwKnow.price_per_sqft ?? wwKnow.pricePerSqft);

  // Use profile.category for fallback decisions when available
  const profileCategory = profile?.propertyCategory ?? (
    /condo|co.?op/i.test(propertyType) ? 'condo' :
    /duplex|multi.?family|2\.?family/i.test(propertyType) ? 'multi_family' :
    'single_family'
  );
  const avoid = profile?.irrelevantGenericRisksToAvoid ?? [];
  const avoidPatterns = avoid.map(r => new RegExp(r.replace(/\s+/g, '\\s*'), 'i'));
  const isForbidden = (text: string) =>
    avoidPatterns.some(p => p.test(text));

  // Property-type-specific fallback pool (profile-aware)
  const candidates: string[] = [];

  if (!isForbidden('Comparable sales') && hasPrice && hasSqft && !hasComps) {
    candidates.push('Comparable sales');
  }
  if (hasPrice && !hasTax) {
    candidates.push('Actual insurance and utility costs');
  }

  // Old building: different risks per type
  if (isOld && hasBeds) {
    if (['single_family', 'multi_family', 'townhouse'].includes(profileCategory)) {
      if (!isForbidden('roof age')) {
        candidates.push('Major systems age: roof / HVAC / electrical / plumbing');
      }
    } else if (['co_op', 'condo'].includes(profileCategory)) {
      if (!isForbidden('Building Financial Health')) {
        candidates.push('Building financials: reserves, assessments, and capital expenditure plan');
      }
    }
  }

  if (hasBasementMention && ['single_family', 'townhouse'].includes(profileCategory)) {
    if (!isForbidden('Basement')) {
      candidates.push('Basement permits, egress, and legal use');
    }
  }

  if (profileCategory === 'co_op') {
    if (!isForbidden('Monthly maintenance')) candidates.push('Monthly maintenance total cost and what it covers');
    if (!isForbidden('Board approval')) candidates.push('Board approval requirements and timeline');
    if (!isForbidden('Flip tax')) candidates.push('Flip tax or transfer fee calculation');
    if (!isForbidden('Subletting')) candidates.push('Subletting and owner-occupancy rules');
    if (!isForbidden('Reserve fund')) candidates.push('Reserve fund balance and building financials');
  } else if (profileCategory === 'condo') {
    if (!isForbidden('HOA')) candidates.push('HOA reserves, pending assessments, and special fees');
    if (!isForbidden('Rental restrictions')) candidates.push('Rental restrictions and pet policies');
    if (!isForbidden('Master insurance')) candidates.push('Master insurance coverage');
    if (!isForbidden('Owner-occupancy')) candidates.push('Owner-occupancy ratio and financing restrictions');
  } else if (profileCategory === 'multi_family') {
    if (!isForbidden('Certificate of Occupancy')) candidates.push('Certificate of Occupancy and legal unit count');
    if (!isForbidden('Rent roll')) candidates.push('Current rent roll and actual leases');
    if (!isForbidden('Open violations')) candidates.push('Open DOB/HPD/ECB violations');
    if (!isForbidden('Separate metering')) candidates.push('Separate utility metering');
  }

  if (hasHOA && !['co_op', 'condo'].includes(profileCategory)) {
    if (!isForbidden('HOA')) candidates.push('HOA budget, reserves, and pending assessments');
  }

  if (hasRenovationMention) {
    candidates.push('Renovation permits and inspection history');
  }

  if (hasPrice && hasSqft && hasHighPricePerSqft) {
    if (!isForbidden('Open permits')) candidates.push('Open permits or violations');
  }

  // Fill from candidates (deduplicated against what's already there)
  for (const item of candidates) {
    if (cleaned.length >= 5) break;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
  }

  result.whats_missing = cleaned.slice(0, 6);
  return result;
}

/**
 * normalizeBottomLine — backend enforcement for bottom_line (US Basic v2)
 * Rules:
 * - bottom_line must cite at least 2 specific listing facts.
 * - If AI returns generic "price, beds, baths, size" phrasing, rewrite.
 * - Reference: asking price, beds/baths, sqft, year built, tax, property type.
 * - Max 70 words.
 */
function normalizeBottomLine(result: any, optionalDetails?: Record<string, unknown>, profile?: PropertyIntelligenceProfile): any {
  const opts = optionalDetails ?? {};
  const raw = (result.bottom_line ?? result.bottomLine ?? '').toString();

  // Rewrite trigger: empty OR generic template OR insufficient listing specifics
  const specificFieldCount = [
    /\$[\d,]+/.test(raw),          // $1.2M / $619,000
    /\d+\s*bed/i.test(raw),        // 3 bed / 3 beds
    /\d+\s*bath/i.test(raw),        // 2 bath
    /sqft|sq\s*ft|square\s*foot/i.test(raw),  // sqft
    /\b19\d{2}\b|\b20\d{2}\b/.test(raw),     // year built
    /tax/i.test(raw),               // tax
    /built/i.test(raw),             // built in X
  ].filter(Boolean).length;

  const isGenericTemplate = /price,?\s*beds?,?\s*baths?,?\s*size|basic\s+facts|key\s+details|standard\s+info|listing\s+gives?\s+enough\s+basic/i.test(raw);
  const needsRewrite = !raw || isGenericTemplate || specificFieldCount < 2;

  if (!needsRewrite) {
    result.bottom_line = raw.replace(/\s{2,}/g, ' ').trim();
    return result;
  }

  // Rewrite: build a bottom line from actual listing fields (always runs when needsRewrite)
  const wwKnow = result.what_we_know ?? {};
  const parts: string[] = [];
  const price = opts.askingPrice ?? wwKnow.asking_price ?? wwKnow.askingPrice ?? wwKnow.price ?? null;
  const beds = opts.bedrooms ?? wwKnow.beds ?? wwKnow.bedrooms ?? null;
  const baths = opts.bathrooms ?? wwKnow.baths ?? wwKnow.bathrooms ?? null;
  const sqft = opts.sqft ?? wwKnow.sqft ?? wwKnow.square_feet ?? wwKnow.squareFeet ?? null;
  const yearBuilt = opts.yearBuilt ?? wwKnow.year_built ?? wwKnow.yearBuilt ?? null;
  const tax = opts.annualTax ?? opts.annualTaxAmount ?? opts.taxAnnual ?? wwKnow.tax_year ?? wwKnow.taxes ?? wwKnow.annual_tax ?? null;
  const propertyType = opts.propertyType ?? wwKnow.property_type ?? wwKnow.propertyType ?? null;

  if (price) parts.push(typeof price === 'string' ? price : `$${Number(price).toLocaleString()}`);
  if (beds) parts.push(`${beds} bed`);
  if (baths) parts.push(`${baths} bath`);
  if (sqft) parts.push(typeof sqft === 'string' ? sqft : `${Number(sqft).toLocaleString()} sqft`);
  if (yearBuilt) parts.push(`built ${yearBuilt}`);
  if (tax) parts.push(typeof tax === 'string' ? tax : `$${Number(tax).toLocaleString()}/yr taxes`);

  // #region agent log H1-H2
  fetch('http://127.0.0.1:7551/ingest/acb963f0-2502-480f-a2cb-a3edc4af3b03',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'05ad70'},body:JSON.stringify({sessionId:'05ad70',location:'analyze.ts:5250',message:'normalizeBottomLine parts',data:{parts:parts.slice(),partsJoin:parts.join(', ')},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  // ── Property-type-aware missing facts ─────────────────────────────────────────
  // Different property types require different decision axes in the bottom line.
  const SYSTEM_OWNER_TYPES = new Set(['single_family', 'multi_family', 'townhouse']);
  const isSystemOwner = profile
    ? SYSTEM_OWNER_TYPES.has(profile.propertyCategory)
    : true;

  const typeMissingItems: string[] = [];
  if (profile?.propertyCategory === 'co_op') {
    if (!wwKnow.monthly_maintenance && !wwKnow.hoa) typeMissingItems.push('monthly maintenance');
    if (!wwKnow.board_approval) typeMissingItems.push('board approval requirements');
    if (!wwKnow.subletting) typeMissingItems.push('subletting rules');
    if (!wwKnow.building_financials) typeMissingItems.push('building financials and assessments');
    if (!wwKnow.flip_tax) typeMissingItems.push('flip tax or transfer fee');
  } else if (profile?.propertyCategory === 'condo') {
    if (!wwKnow.hoa) typeMissingItems.push('HOA fees and what they cover');
    if (!wwKnow.reserve_fund) typeMissingItems.push('reserve fund balance');
    if (!wwKnow.assessments) typeMissingItems.push('special assessments');
    if (!wwKnow.rental_restrictions) typeMissingItems.push('rental restrictions');
  } else if (profile?.propertyCategory === 'multi_family') {
    if (!wwKnow.certificate_of_occupancy) typeMissingItems.push('legal unit count and Certificate of Occupancy');
    if (!wwKnow.rent_roll) typeMissingItems.push('actual rent roll and leases');
    if (!wwKnow.separate_meters) typeMissingItems.push('separate utility metering');
    if (!wwKnow.violations) typeMissingItems.push('open violations and DOB/HPD status');
  } else if (profile?.propertyCategory === 'single_family') {
    // SF: never use generic "property condition" — use fact-specific items
    if (!wwKnow.comparable_sales && !wwKnow.comparableSales) typeMissingItems.push('comparable sales');
    const isOld = yearBuilt && Number(yearBuilt) <= new Date().getFullYear() - 40;
    const hasOilHeating = /oil|heating oil|kerosene/i.test(String(opts.heating ?? wwKnow.heating ?? ''));
    if (isOld) typeMissingItems.push('roof and major systems age');
    if (hasOilHeating) typeMissingItems.push('oil tank records and location');
    if (!tax) typeMissingItems.push('insurance and utility costs');
    if (typeMissingItems.length === 0) {
      if (!wwKnow.comparable_sales && !wwKnow.comparableSales) typeMissingItems.push('comparable sales');
      typeMissingItems.push('insurance and utility costs');
    }
  } else {
    if (!yearBuilt) typeMissingItems.push('construction year');
    if (!tax) typeMissingItems.push('annual taxes');
    if (!wwKnow.comparable_sales && !wwKnow.comparableSales) typeMissingItems.push('comparable sales');
  }

  const missingStr = typeMissingItems.join(', ');
  // #region agent log H2
  fetch('http://127.0.0.1:7551/ingest/acb963f0-2502-480f-a2cb-a3edc4af3b03',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'05ad70'},body:JSON.stringify({sessionId:'05ad70',location:'analyze.ts:5298',message:'knownFacts parts',data:{missingStr,partsCount:parts.length,knownFacts:parts.join(', ')},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const knownFacts = parts.join(', ');

  if (knownFacts) {
    // Use property type when available to avoid generic "basic facts" feel
    const propTypeNote = propertyType && !/not disclosed|unknown/i.test(propertyType)
      ? ` (${propertyType})`
      : '';
    // For non-system-owner types (co-op/condo), include a brief ownership structure note
    const coopNote = profile?.propertyCategory === 'co_op' ? ' (stock cooperative)' :
                     profile?.propertyCategory === 'condo' ? ' (condominium)' : '';
    result.bottom_line = `This listing shows${propTypeNote}${coopNote} at ${knownFacts} — but ${missingStr} still need verification before committing.`;
  } else {
    result.bottom_line = `This listing does not provide enough verified information. Key basics such as ${missingStr} are missing or unclear.`;
  }

  // Enforce word limit
  const words = result.bottom_line.split(/\s+/);
  if (words.length > 70) {
    result.bottom_line = words.slice(0, 70).join(' ') + '...';
  }

  return result;
}

/**
 * normalizeBasicQuestions — backend enforcement for questions_to_ask
 * Accepts string[] (US Basic v2) OR legacy {category, question}[] (AU).
 * Rules:
 * - Normalize legacy objects to plain strings.
 * - If Zillow monthly payment exists, replace cost questions with confirm-Zillow format
 * - If questions_to_ask is empty, leave empty (no template fallback)
 * - Max 5 questions
 * - Profile-aware: roof/HVAC/plumbing questions only fire for system-owner types
 *   (single_family, multi_family, townhouse).  Others get building-condition variants.
 */
function normalizeBasicQuestions(result: any, hasZillowMonthly: boolean, profile?: PropertyIntelligenceProfile): any {
  const wwKnow = result.what_we_know ?? {};
  const hasSqft = !!wwKnow.sqft;
  const hasBeds = !!(wwKnow.beds || wwKnow.bedrooms);
  const hasBaths = !!(wwKnow.baths || wwKnow.bathrooms);
  const hasPropertyType = !!(wwKnow.property_type || wwKnow.propertyType);
  const hasPrice = !!(wwKnow.asking_price || wwKnow.askingPrice || wwKnow.price);
  const hasTaxInfo = !!(wwKnow.taxes || wwKnow.annual_tax);
  const hasHOA = !!(wwKnow.hoa || wwKnow.hoa_fees);

  // ── Profile-aware guards ────────────────────────────────────────────────────
  // Determine whether the buyer is responsible for maintaining building systems.
  // If so, roof/HVAC/plumbing questions are relevant; otherwise they must be replaced.
  const SYSTEM_OWNER_TYPES = new Set(['single_family', 'multi_family', 'townhouse']);
  const isSystemOwnerType = profile
    ? SYSTEM_OWNER_TYPES.has(profile.propertyCategory)
    : true; // No profile: conservatively allow (preserve legacy behaviour)

  // Determine gaps from what_we_know presence
  const hasLegalGap = !hasPropertyType;
  const hasCostGap = !hasTaxInfo && !hasHOA;

  // Normalize to plain string questions; keep category metadata if present
  const transformed = (result.questions_to_ask ?? []).map((q: any) => {
    const questionText = typeof q === 'string' ? q : (q?.question ?? '');
    const rawCategory = typeof q === 'string' ? 'General' : q?.category;
    const category = (rawCategory && rawCategory.trim()) ? rawCategory.trim() : 'General';
    if (!questionText || !questionText.trim()) return null;
    return { category, question: questionText.trim() };
  }).filter(Boolean) as Array<{ category: string; question: string }>;

  // If AI returned plain strings, normalize to objects
  // (We always re-emit as objects for the post-processing below, but US v2 returns strings;
  //  we'll output as strings downstream.)

  // Apply "asking for known as missing" transformation
  const final: Array<{ category: string; question: string }> = [];
  for (const q of transformed) {
    let questionText = q.question;

    // If this is a cost question and Zillow monthly payment exists, replace it
    if (hasZillowMonthly && /cost|tax|insurance|hoa|fee|afford|monthly\s+payment/i.test(questionText)) {
      final.push({
        category: 'Costs',
        question: 'Can you confirm whether Zillow\'s estimated taxes, insurance, HOA fees, and monthly payment are accurate for this property?',
      });
      continue;
    }

    const askingForKnownAsMissing =
      /can you (provide|tell me|give me|share|confirm|find out)\s+(the\s+)?(beds?|baths?|sqft|square\s*footage|square\s*feet|interior\s*size|property\s*type|home\s*type|asking\s*price|listing\s*price|number\s+of\s+beds)/i.test(questionText) ||
      /could you (provide|tell|give|confirm)\s+(the\s+)?(beds?|baths?|sqft|square\s*footage|square\s*feet|interior|property\s*type|home\s*type|asking\s*price|listing\s*price)/i.test(questionText) ||
      /what (is|are)\s+(the\s+)?(beds?|baths?|sqft|square\s*footage|square\s*feet|interior\s*size|property\s*type|asking\s*price)/i.test(questionText) ||
      /please (provide|confirm|tell|give)\s+(the\s+)?(beds?|baths?|sqft|square\s*footage|square\s*feet|interior|property\s*type|asking\s*price)/i.test(questionText) ||
      /\bbeds?\b.*\?\s*$|\bbaths?\b.*\?\s*$/i.test(questionText) ||
      /how many (beds?|baths?)\b/i.test(questionText) ||
      /(beds?|baths?|sqft|square\s*footage|property\s*type|home\s*type)\s+are\s+(listed|confirmed|disclosed|available)/i.test(questionText);

    const alreadyVerification = /verify|confirm.*records?|public.*records?|certificate|coc|title\s+documents?|official\s+records?/i.test(questionText);

    if (!askingForKnownAsMissing || alreadyVerification) {
      final.push(q);
      continue;
    }

    const knownParts: string[] = [];
    if (hasPropertyType) knownParts.push('property type');
    if (hasBeds) knownParts.push('beds');
    if (hasBaths) knownParts.push('baths');
    if (hasSqft) knownParts.push('square footage');

    if (knownParts.length === 0) {
      final.push({
        category: 'Listing Facts',
        question: 'Can you provide the property type, beds, baths, and interior square footage?',
      });
      continue;
    } else if (knownParts.length >= 3) {
      // 3+ basic fields already known — skip generating a redundant question about them
      continue;
    }

    let questionSuffix = '';
    if (hasLegalGap) {
      questionSuffix = ' and provide the Certificate of Occupancy and title documents to verify legal use and zoning';
    } else if (hasCostGap) {
      questionSuffix = hasZillowMonthly
        ? ' and confirm whether Zillow\'s estimated taxes, insurance, and HOA fees are accurate'
        : ' and confirm annual tax amount, insurance, and any HOA fees';
    } else {
      questionSuffix = ' and confirm the asking price against comparable sales or rent data';
    }

    final.push({
      category: 'Public Records',
      question: `Can you confirm whether the ${knownParts.join(', ')} match public records${questionSuffix}?`,
    });
  }

  // Trigger fallback when AI returned fewer than 5 questions (fill up to 5)
  if (final.length < 5) {
    // Build property-specific questions from missing fields and listing signals
    const wwKnow = result.what_we_know ?? {};
    const missing = Array.isArray(result.whats_missing ?? result.whatsMissing)
      ? (result.whats_missing ?? result.whatsMissing).filter((x: unknown) => typeof x === 'string') as string[]
      : [];
    const propertyType = wwKnow.property_type ?? wwKnow.propertyType ?? '';
    const yearBuilt = wwKnow.year_built ?? wwKnow.yearBuilt ?? null;
    const hasPrice = !!(wwKnow.asking_price ?? wwKnow.askingPrice ?? wwKnow.price);

    console.log('[BasicQuestions] fallback triggered', {
      missingItems: missing,
      missingLower: missing.map(m => String(m).toLowerCase()),
      hasBasementInMissing: missing.some((m: string) => /basement/i.test(String(m))),
      propertyType,
      hasZillowMonthly,
      existingFinalCount: final.length,
      isSystemOwnerType,
    });

    const generated: Array<{ category: string; question: string }> = [];

    // Profile-aware question exclusion (mirrors the logic in buildWhatsMissing)
    const avoid = profile?.irrelevantGenericRisksToAvoid ?? [];
    const avoidPatterns = avoid.map(r => new RegExp(r.replace(/\s+/g, '\\s*'), 'i'));
    const isForbidden = (text: string) => avoidPatterns.some(p => p.test(text));

    // ── L1 fix: Profile-aware condition question ───────────────────────────────
    // Only ask about roof/HVAC/electrical/plumbing for fee-simple / system-owner types.
    // Co-op/condo/land: building condition is managed by the HOA/board, not unit owner.
    if (isSystemOwnerType) {
      generated.push({
        category: 'Condition',
        question: 'What is the current condition of the roof, HVAC, electrical panel, and plumbing? Are there any known issues or recent repairs?',
      });
    } else {
      generated.push({
        category: 'Condition',
        question: 'What is the overall condition of the building — common areas, façade, elevators, and any recent capital improvements? Are there any planned special assessments?',
      });
    }

    // Derive questions from missing fields
    const missingLower = missing.map(m => String(m).toLowerCase());
    if (missingLower.some(m => /comparable|comp|compar|recent.*sale|market.*value/i.test(m)) || !hasPrice) {
      generated.push({
        category: 'Market',
        question: 'Can you provide 3–5 recent comparable sales in the area to help assess whether the asking price is justified?',
      });
    }
    if (missingLower.some(m => /permit|renovation|update|addition/i.test(m))) {
      generated.push({
        category: 'Legal',
        question: 'Are there any unpermitted renovations, additions, or structural changes? What is the Certificate of Occupancy status?',
      });
    }
    // Basement-specific question: only for fee-simple system-owner types
    // Co-ops/condos have basement-related decisions managed through HOA — not a unit-level question
    if (isSystemOwnerType && missingLower.some(m => /basement/i.test(m))) {
      generated.push({
        category: 'Legal',
        question: 'The listing mentions a basement — can you confirm whether it is permitted, legally finished, has proper egress, and whether it counts toward the legal sqft?',
      });
    }
    // Open permits / violations
    if (missingLower.some(m => /open permit|violation|dob|hpd|complaint/i.test(m))) {
      generated.push({
        category: 'Legal',
        question: 'Are there any open permits, building violations, or unresolved DOB/HPD complaints on this property?',
      });
    }
    // Profile-aware cost question: co-op/condo have different cost decision axes than SF/MF
    if (missingLower.some(m => /cost|tax|insurance|hoa|fee/i.test(m))) {
      if (profile?.propertyCategory === 'co_op') {
        generated.push({
          category: 'Costs',
          question: 'Can you confirm the monthly maintenance amount, what it includes, and whether property taxes or utilities are part of the fee?',
        });
      } else if (profile?.propertyCategory === 'condo') {
        generated.push({
          category: 'Costs',
          question: 'Can you confirm whether the HOA fees, property taxes, and insurance are disclosed — and what the reserve fund status is?',
        });
      } else {
        generated.push({
          category: 'Costs',
          question: hasZillowMonthly
            ? 'Can you confirm whether the Zillow-estimated taxes, insurance, HOA fees, and monthly payment are accurate?'
            : 'What are the annual property taxes, HOA fees, and estimated insurance costs?',
        });
      }
    }
    if (yearBuilt && Number(yearBuilt) < 1975) {
      if (isSystemOwnerType) {
        generated.push({
          category: 'Age',
          question: `Built in ${yearBuilt} — what are the ages of the roof, HVAC system, water heater, and electrical panel?`,
        });
      }
      // co-op/condo: ask about building age and capital expenditure plan
      if (profile && ['co_op', 'condo'].includes(profile.propertyCategory)) {
        generated.push({
          category: 'Age',
          question: `Built in ${yearBuilt} — what is the building's age and capital expenditure plan? Have there been recent major building system replacements (roof, boiler, façade)?`,
        });
      }
    }
    if (missingLower.some(m => /monthly.*payment|mortgage|financing|loan/i.test(m))) {
      generated.push({
        category: 'Financing',
        question: 'What financing options or seller concessions are available, and is this property currently financed or in foreclosure?',
      });
    }
    if (missingLower.some(m => /days.*on.*market|listing.*history|previous.*offer/i.test(m))) {
      generated.push({
        category: 'History',
        question: 'How long has this property been listed, and have there been any previous offers or price reductions?',
      });
    }
    // Merge: keep AI questions (final) + fill from generated, deduplicate by text prefix
    // Double-filter: skip any generated question that matches irrelevantGenericRisksToAvoid
    const seenQuestionTexts = new Set(final.map(q => q.question.toLowerCase().slice(0, 30)));
    const merged = [...final];

    // ── Inject from PROPERTY_TYPE_QUESTION_POOL for co-op/condo only ─────────────
    // multi_family questions are NEVER injected for a single_family profile.
    // Single-family homes must not get rent-roll, lease, or legal-unit-count questions.
    // The profile.categorySource tells us whether category came from a structured field.
    if (profile?.propertyCategory === 'co_op' || profile?.propertyCategory === 'condo') {
      const qPool = PROPERTY_TYPE_QUESTION_POOL[profile.propertyCategory] ?? [];
      for (const q of qPool) {
        if (merged.length >= 5) break;
        const key = q.toLowerCase().slice(0, 30);
        if (!seenQuestionTexts.has(key) && !isForbidden(q)) {
          merged.push({ category: 'Profile', question: q });
          seenQuestionTexts.add(key);
        }
      }
    }

    for (const g of generated) {
      if (merged.length >= 5) break;
      const key = g.question.toLowerCase().slice(0, 30);
      if (!seenQuestionTexts.has(key) && !isForbidden(g.question)) {
        merged.push(g);
        seenQuestionTexts.add(key);
      }
    }

    result.questions_to_ask = merged.slice(0, 5).map(q => q.question);
    return result;
  }

  // Emit as plain string array (US v2 schema). Keep category internally for next steps if needed.
  result.questions_to_ask = final.slice(0, 5).map(q => q.question);
  return result;
}

// ========== Helper Functions ==========

function jsonResponse(body: unknown, status = 200) {
  console.log("[jsonResponse] response bytes:", JSON.stringify(body).length);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function mapVerdict(verdict?: string): 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence' {
  const v = verdict?.toLowerCase() || '';
  if (v.includes('inspecting') || v.includes('inspect')) return 'Worth Inspecting';
  if (v.includes('caution')) return 'Proceed With Caution';
  if (v.includes('overpriced') || v.includes('risky')) return 'Likely Overpriced / Risky';
  return 'Need More Evidence';
}

function mapSaleVerdict(verdict?: string): 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence' {
  const v = verdict?.toLowerCase() || '';
  if (v.includes('strong buy')) return 'Worth Inspecting';
  if (v.includes('consider carefully') || v.includes('consider')) return 'Proceed With Caution';
  if (v.includes('probably skip') || v.includes('skip')) return 'Likely Overpriced / Risky';
  return 'Need More Evidence';
}

interface PhotoAnalysis {
  photoIndex: number;
  areaType: string;
  summary: string;
  score: number;
  signals?: string[];
}

interface SpaceAggregationResult {
  spaceType: string;
  score: number;
  photoCount: number;
  insights: string[];
}

interface Step2Recommendation {
  verdict?: string;
  good_fit_for?: string[];
  not_ideal_for?: string[];
}

interface Step2InspectionFit {
  good_for?: string[];
  not_ideal_for?: string[];
}

interface Step2Decision {
  overall_score?: number;
  decision_priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_level?: 'High' | 'Medium' | 'Low';
  overall_verdict?: string;
  pros?: string[];
  cons?: string[];
  hidden_risks?: string[];
  final_recommendation?: {
    verdict: string;
    reason: string;
  };
  score_context?: {
    market_position: string;
    explanation: string;
  };
  risks?: string[];
  space_analysis?: {
    area_type: string;
    score: number;
    explanation?: string;
    insights?: string[];
  }[];
  property_strengths?: string[];
  potential_issues?: string[];
  competition_risk?: { level: string; reasons: string[] };
  inspection_fit?: Step2InspectionFit;
  recommendation?: Step2Recommendation;
  questions_to_ask?: string[];
  agent_questions?: string[];
  rent_fairness?: {
    estimated_min: number;
    estimated_max: number;
    listing_price: number;
    verdict: 'underpriced' | 'fair' | 'slightly_overpriced' | 'overpriced';
    explanation: string;
  };
  light_thermal_guide?: {
    natural_light_summary?: string;
    sun_exposure?: 'Low' | 'Moderate' | 'High' | 'Unknown';
    thermal_risk?: 'Likely Cold' | 'Balanced' | 'Likely Hot' | 'Unknown';
    summer_comfort?: string;
    winter_comfort?: string;
    confidence?: 'Low' | 'Medium' | 'High';
    evidence?: string[];
  };
  agent_lingo_translation?: {
    should_display?: boolean;
    phrases?: {
      phrase: string;
      plain_english: string;
      confidence?: 'Low' | 'Medium' | 'High';
    }[];
  };
  application_strategy?: {
    urgency?: 'Low' | 'Medium' | 'High';
    apply_speed?: string;
    checklist?: string[];
    reasoning?: string[];
  };
}

/**
 * Sale-specific decision output from Step 2 AI model
 */
interface Step2DecisionSale {
  overall_score?: number;
  decision_priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_level?: 'High' | 'Medium' | 'Low';
  overall_verdict?: string;
  pros?: string[];
  cons?: string[];
  hidden_risks?: string[];
  final_recommendation?: {
    verdict: string;
    reason: string;
  };
  score_context?: {
    market_position: string;
    explanation: string;
  };
  risks?: string[];
  space_analysis?: {
    area_type: string;
    score: number;
    explanation?: string;
    insights?: string[];
  }[];
  property_strengths?: string[];
  potential_issues?: string[];
  competition_risk?: { level: string; reasons: string[] };
  inspection_fit?: Step2InspectionFit;
  recommendation?: Step2Recommendation;
  questions_to_ask?: string[];
  agent_questions?: string[];
  price_assessment?: {
    estimated_min: number;
    estimated_max: number;
    asking_price: number;
    verdict: 'underpriced' | 'fair' | 'slightly_overpriced' | 'overpriced';
    explanation: string;
  };
  investment_potential?: {
    growth_outlook?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
    rental_yield_estimate?: string;
    capital_growth_5yr?: string;
    key_positives?: string[];
    key_concerns?: string[];
    rating?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
    summary?: string;
    supporting_signals?: string[];
    risks?: string[];
    things_to_verify?: string[];
    rent_estimate_available?: boolean;
    estimated_monthly_rent?: number | null;
    investment_metrics?: {
      cap_rate?: number | null;
      noi?: number | null;
      cash_flow?: number | null;
      grm?: number | null;
      cash_on_cash_return?: number | null;
    };
  };
  affordability_check?: {
    estimated_deposit_20pct?: number;
    estimated_loan?: number;
    estimated_monthly_repayment?: string;
    assessment?: 'manageable' | 'stretch' | 'challenging';
    note?: string;
  };
  inspection_focus?: string[];
  long_term_outlook?: {
    verdict?: 'Strong Hold Potential' | 'Neutral' | 'Risky';
    reasoning?: string;
  };
  light_thermal_guide?: {
    natural_light_summary?: string;
    sun_exposure?: 'Low' | 'Moderate' | 'High' | 'Unknown';
    thermal_risk?: 'Likely Cold' | 'Balanced' | 'Likely Hot' | 'Unknown';
    summer_comfort?: string;
    winter_comfort?: string;
    confidence?: 'Low' | 'Medium' | 'High';
    evidence?: string[];
  };
  // === Sale 模式新增字段 ===
  land_value_analysis?: {
    land_size?: number;
    price_per_sqm?: number;
    land_banking_potential?: boolean;
    scarcity_indicator?: 'High' | 'Medium' | 'Low';
    property_type?: 'House' | 'Apartment' | 'Unit' | 'Townhouse' | 'Unknown';
    explanation?: string;
  };
  holding_costs?: {
    deposit_20pct?: number;
    stamp_duty?: number;
    stamp_duty_state?: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'Other';
    transfer_fees?: number;
    legal_costs?: number;
    inspection_costs?: number;
    estimated_monthly_repayment?: string;
    total_upfront_costs?: number;
    cash_flow_analysis?: {
      potential_rent?: number;
      weekly_mortgage_interest?: number;
      weekly_difference?: number;
      verdict?: 'Positive Gearing' | 'Negative Gearing' | 'Neutral';
    };
  };
  red_flag_alerts?: {
    keyword: string;
    category: 'legal' | 'structural' | 'financial' | 'location';
    severity: 'high' | 'medium' | 'low';
    message: string;
    action: string;
  }[];
  state_specific_advice?: {
    state?: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'Unknown';
    recommendations?: string[];
  };
  // === US Sale 新增决策支持报告字段 ===
  property_snapshot?: {
    beds?: string | number | null;
    baths?: string | number | null;
    sqft?: string | number | null;
    lot_size?: string | number | null;
    year_built?: string | number | null;
    home_type?: string;
    property_subtype?: string;
    architectural_style?: string;
    stories?: string | number | null;
    parking?: string;
    hoa?: string;
    annual_tax?: string | number | null;
    tax_assessed_value?: string | number | null;
    price_per_sqft?: string | number | null;
    roof?: string;
    materials?: string;
    heating?: string;
    basement?: string;
    fireplace?: string;
    region?: string;
  };
  carrying_costs?: {
    annual_tax?: number | null;
    monthly_tax_equivalent?: number | null;
    hoa?: 'Yes' | 'No' | 'Unknown';
    cost_pressure?: 'Low' | 'Medium' | 'High' | 'Unknown';
    summary?: string;
    missing_costs?: string[];
  };
  maintenance_risk?: {
    rating?: 'Low' | 'Medium' | 'High' | 'Unknown';
    summary?: string;
    risk_factors?: string[];
    inspection_priorities?: string[];
  };
  layout_fit?: {
    summary?: string;
    best_for?: string[];
    not_ideal_for?: string[];
    layout_strengths?: string[];
    layout_limitations?: string[];
  };
  listing_language_reality_check?: {
    phrase: string;
    what_it_may_mean: string;
    what_to_verify: string;
  }[];
  neighborhood_lifestyle?: {
    summary?: string;
    page_signals?: string[];
    external_data_needed?: string[];
  };
  legal_compliance?: {
    risk_level?: 'Low' | 'Medium' | 'High' | 'Unknown';
    summary?: string;
    items_to_verify?: string[];
    external_sources_needed?: string[];
  };
  environmental_risk?: {
    risk_level?: 'Low' | 'Medium' | 'High' | 'Unknown';
    summary?: string;
    items_to_check?: string[];
    external_sources_needed?: string[];
  };
  data_gaps?: {
    missing_item: string;
    why_it_matters: string;
    suggested_source: string;
  }[];
  // === US Sale 新增决策支持报告字段 END ===
  // === Sale 模式新增字段 END ===
}

function aggregateSpaceAnalysis(photos: PhotoAnalysis[]): SpaceAggregationResult[] {
  const groupedByArea = new Map<string, PhotoAnalysis[]>();
  
  for (const photo of photos) {
    const areaType = photo.areaType || 'unknown';
    if (!groupedByArea.has(areaType)) {
      groupedByArea.set(areaType, []);
    }
    groupedByArea.get(areaType)!.push(photo);
  }

  const aggregated: SpaceAggregationResult[] = [];
  
  for (const [areaType, areaPhotos] of groupedByArea) {
    const scores = areaPhotos.map(p => p.score || 50);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scoreRange = maxScore - minScore;
    
    // 基础分数
    let finalScore = Math.round(avgScore);
    
    // ========== 强化极值调整 ==========
    
    // 1. 强弱点放大：如果范围大，说明有明显的分化
    if (scoreRange > 25) {
      // 有明显分化，放大差异
      if (minScore < 55) {
        finalScore = Math.max(minScore, Math.round(finalScore - 12));
      }
      if (maxScore > 78) {
        finalScore = Math.min(92, Math.round(finalScore + 10));
      }
    } else {
      // 范围较小，按正常调整
      if (minScore < 50) {
        const penalty = Math.min(12, (50 - minScore) * 0.4);
        finalScore = Math.max(minScore, Math.round(finalScore - penalty));
      }
      if (maxScore > 80) {
        const bonus = Math.min(6, (maxScore - 80) * 0.25);
        finalScore = Math.min(92, Math.round(finalScore + bonus));
      }
    }
    
    // 2. 厨房/浴室对低分更敏感（更狠的惩罚）
    if ((areaType === 'kitchen' || areaType === 'bathroom') && minScore < 58) {
      finalScore = Math.max(minScore, finalScore - 8);
    }
    
    // 3. 强制避免中间值：如果最终分数在 60-70 之间，考虑推动
    if (finalScore >= 60 && finalScore <= 70) {
      // 如果整体偏弱，降到 60 以下
      if (minScore < 55 || avgScore < 62) {
        finalScore = Math.max(minScore + 5, 55);
      }
      // 如果整体偏强，提升到 70 以上
      else if (maxScore > 75 && avgScore > 68) {
        finalScore = Math.min(78, Math.round(avgScore + 5));
      }
    }
    
    // 收集信号和观察
    const allSignals: string[] = [];
    for (const photo of areaPhotos) {
      if (photo.signals && Array.isArray(photo.signals)) {
        allSignals.push(...photo.signals);
      }
      if (photo.summary) {
        allSignals.push(photo.summary);
      }
    }
    
    const uniqueInsights = new Map<string, string>();
    for (const signal of allSignals) {
      const normalized = signal.toLowerCase().trim();
      if (normalized && !uniqueInsights.has(normalized)) {
        uniqueInsights.set(normalized, signal);
      }
    }
    
    const insights = Array.from(uniqueInsights.values()).slice(0, 4);
    
    let finalInsights = insights;
    if (areaPhotos.length === 1 && finalScore < 50) {
      finalInsights = [`${capitalizeFirst(areaType)} space unclear from photo`];
    }
    
    aggregated.push({
      spaceType: areaType,
      score: finalScore,
      photoCount: areaPhotos.length,
      insights: finalInsights
    });
  }

  aggregated.sort((a, b) => b.score - a.score);
  
  return aggregated;
}

function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function safeParseModelJson(content: unknown) {
  const raw = String(content ?? "").trim();

  const withoutFence = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  const jsonText =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  return JSON.parse(jsonText);
}

// ========== Step 2 Helpers ==========

function extractModelText(data: any): string | null {
  const choice = data?.choices?.[0];
  if (!choice) return null;

  const content = choice?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text" && typeof item?.text === "string") return item.text;
        return "";
      })
      .join("")
      .trim();

    return text || null;
  }

  return null;
}

function classifyStep2ResponseIssue(data: any): string {
  if (!data) return "empty_response_object";
  if (!Array.isArray(data?.choices) || data.choices.length === 0) return "empty_choices";
  if (!data?.choices?.[0]?.message) return "missing_message";
  if (data?.choices?.[0]?.message && data?.choices?.[0]?.message?.content == null) return "missing_content";
  return "unknown_structure";
}

async function callStep2Model(
  openRouterApiKey: string,
  step2Messages: any[],
): Promise<{ rawText: string; parsed: Step2Decision }> {
  const step2RequestBody = {
    model: "openai/gpt-5-mini",
    messages: step2Messages,
    temperature: 0.1,
    max_tokens: 9000, // bumped from 5000 to handle expanded US sale schema
  };

  async function attempt(attemptNumber: number): Promise<{ rawText: string; parsed: Step2Decision }> {
    console.log(`[Step 2] attempt ${attemptNumber} start`);

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
          "X-Title": "Rental Property Analyzer",
        },
        body: JSON.stringify(step2RequestBody),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[Step 2] API error response:", JSON.stringify(errorData));
      throw new Error(
        (errorData as { error?: { message?: string } }).error?.message ||
          `Step 2 failed: ${response.status}`
      );
    }

    const data = await response.json();

    console.log("[Step 2] raw response preview:", JSON.stringify(data).slice(0, 2000));
    const finishReason = data?.choices?.[0]?.finish_reason ?? null;
    const nativeFinishReason = data?.choices?.[0]?.native_finish_reason ?? null;
    console.log("[Step 2] finish_reason:", finishReason);
    console.log("[Step 2] native_finish_reason:", nativeFinishReason);
    console.log("[Step 2] provider:", data?.provider ?? null);
    console.log("[Step 2] usage:", JSON.stringify(data?.usage ?? null));

    if (finishReason === 'length' || nativeFinishReason === 'max_tokens') {
      console.error("[Step 2] ⚠ OUTPUT TRUNCATED by max_tokens", {
        finish_reason: finishReason,
        native_finish_reason: nativeFinishReason,
        max_tokens: step2RequestBody.max_tokens,
        prompt_tokens: data?.usage?.prompt_tokens,
        completion_tokens: data?.usage?.completion_tokens,
        total_tokens: data?.usage?.total_tokens,
      });
    }

    const rawText = extractModelText(data);

    if (!rawText) {
      const issue = classifyStep2ResponseIssue(data);
      throw new Error(
        `Step 2 returned no usable text (${issue}) | finish_reason=${data?.choices?.[0]?.finish_reason ?? "unknown"}`
      );
    }

    try {
      const parsed = safeParseModelJson(rawText) as Step2Decision;
      return { rawText, parsed };
    } catch (parseErr) {
      console.error("[Step 2] JSON parse failed. Raw text preview:", rawText.slice(0, 2000));
      const isTruncated = rawText.length > 0 && !rawText.trim().endsWith("}");
      throw new Error(
        isTruncated
          ? "Step 2 output was truncated by max_tokens. Increase max_tokens or reduce schema size."
          : "Step 2 returned invalid JSON"
      );
    }
  }

  try {
    return await attempt(1);
  } catch (err1) {
    console.error("[Step 2] attempt 1 failed:", err1);

    console.log("[Step 2] retrying once...");
    return await attempt(2);
  }
}

// ========== URL Validation Helper ==========

function isValidHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildStep1Messages(imageUrls: string[] = [], batchIndex = 0) {
  // Filter and validate URLs
  const validUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(isValidHttpUrl)
    : [];

  const BATCH_SIZE = 20;
  const start = batchIndex * BATCH_SIZE;
  const end = start + BATCH_SIZE;
  const batchUrls = validUrls.slice(start, end);

  // Adjust photoIndex to be global across batches
  const photoIndexOffset = start;

  const userContent: Step1UserContent[] = batchUrls.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  userContent.push({
    type: "text",
    text: `Analyze these property photos (batch ${batchIndex + 1}) and return short structured JSON only. Use photoIndex 0-${batchUrls.length - 1} for each photo in this batch.`,
  });

  return {
    messages: [
      { role: "system", content: STEP1_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    photoIndexOffset,
    batchSize: batchUrls.length,
  };
}

/**
 * Merge multiple visual analysis results from batched Step 1 calls.
 * Adjusts photoIndex to be global and merges spaceAnalysis by spaceType.
 */
function mergeVisualAnalysis(
  results: Array<{ photos?: Array<Record<string, unknown>>; spaceAnalysis?: Array<Record<string, unknown>> }>
): Record<string, unknown> {
  const allPhotos: Array<Record<string, unknown>> = [];
  const spaceAnalysisMap = new Map<string, Record<string, unknown>>();

  for (const result of results) {
    if (!result) continue;

    // Merge photos with adjusted index
    if (Array.isArray(result.photos)) {
      for (const photo of result.photos) {
        allPhotos.push({ ...photo });
      }
    }

    // Merge spaceAnalysis by spaceType
    if (Array.isArray(result.spaceAnalysis)) {
      for (const space of result.spaceAnalysis) {
        const spaceType = space.spaceType as string;
        if (spaceType && spaceAnalysisMap.has(spaceType)) {
          // Merge observations from duplicate space types
          const existing = spaceAnalysisMap.get(spaceType)!;
          const existingObs = (existing.observations as string[]) || [];
          const newObs = (space.observations as string[]) || [];
          existing.observations = [...new Set([...existingObs, ...newObs])].slice(0, 5);
          // Average the scores
          const existingScore = (existing.score as number) || 0;
          const newScore = (space.score as number) || 0;
          existing.score = Math.round((existingScore + newScore) / 2);
        } else {
          spaceAnalysisMap.set(spaceType, { ...space });
        }
      }
    }
  }

  return {
    photos: allPhotos,
    spaceAnalysis: Array.from(spaceAnalysisMap.values()),
  };
}

// ── Unified Market Detection ───────────────────────────────────────────────────────────────────────────
type Market = 'US' | 'AU' | 'UNKNOWN';

/**
 * Unified market detection — single source of truth for all actions (submit, run, basic-sync).
 *
 * Checks ALL available fields (not just source) in priority order:
 * 1. Explicit body.market field (set by plugin)
 * 2. body.source / body.sourceDomain / body.listingUrl
 * 3. optionalDetails.source / .sourceDomain / .market / .listingUrl
 * 4. description and address text (US/AU geolocation keywords)
 *
 * IMPORTANT: Never default to 'AU' — use 'UNKNOWN' as the fallback to prevent
 * silently routing US listings to Australian prompts.
 */
function detectMarket(input: {
  source?: string | null;
  sourceDomain?: string | null;
  market?: string | null;
  listingUrl?: string | null;
  description?: string;
  address?: string;
  optionalDetails?: {
    source?: string | null;
    sourceDomain?: string | null;
    market?: string | null;
    listingUrl?: string | null;
  };
}): Market {
  // ── Step 1: Explicit market field (highest priority, set by plugin) ───────────────────
  if (input.market === 'US' || input.market === 'AU') {
    console.log(`[detectMarket] Explicit market=${input.market} from field`);
    return input.market;
  }
  if (input.optionalDetails?.market === 'US' || input.optionalDetails?.market === 'AU') {
    console.log(`[detectMarket] Explicit market=${input.optionalDetails.market} from optionalDetails`);
    return input.optionalDetails.market;
  }

  // ── Step 2: Collect all candidate strings ───────────────────────────────────────────
  const candidates = [
    input.source,
    input.sourceDomain,
    input.listingUrl,
    input.optionalDetails?.source,
    input.optionalDetails?.sourceDomain,
    input.optionalDetails?.listingUrl,
    input.description,
    input.address,
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase();

  console.log(`[detectMarket] candidates (${candidates.length} chars): ${candidates.slice(0, 200)}`);

  // ── Step 3: US signals ───────────────────────────────────────────────────────────────
  const usSignals = [
    'zillow',
    'realtor.com',
    'redfin',
    'trulia',
    'apartments.com',
    'hotpads',
    'brooklyn',
    'new york',
    'manhattan',
    'los angeles',
    'san francisco',
    'chicago il',
    'seattle wa',
    'boston ma',
    'miami fl',
    'austin tx',
    'denver co',
    'portland or',
    'phoenix az',
    'atlanta ga',
    'ny 1', 'ny 2', 'ny 3', 'ny 4', 'ny 5', // e.g., "apt 4b, ny 11201"
    'nyc',
    'usa',
    'united states',
  ];

  for (const signal of usSignals) {
    if (candidates.includes(signal)) {
      console.log(`[detectMarket] US match: "${signal}"`);
      return 'US';
    }
  }

  // ── Step 4: AU signals ───────────────────────────────────────────────────────────────
  const auSignals = [
    'realestate.com.au',
    'domain.com.au',
    'australia',
    'australian',
    'nsw',
    'vic ',
    'qld',
    'wa ',
    'sa ',
    'tas ',
    'act ',
    'nt ',
    'melbourne',
    'sydney',
    'brisbane',
    'perth',
    'adelaide',
    'hobart',
    'darwin',
    'canberra',
  ];

  for (const signal of auSignals) {
    if (candidates.includes(signal)) {
      console.log(`[detectMarket] AU match: "${signal}"`);
      return 'AU';
    }
  }

  // ── Step 5: No match → UNKNOWN (NOT AU!) ───────────────────────────────────────────
  console.warn(`[detectMarket] No market signal found, defaulting to UNKNOWN (safe fallback — prevents US listings going to AU prompts)`);
  return 'UNKNOWN';
}

// ── Extended optionalDetails type for Step2 prompt ──────────────────────
type AnalyzeOptionalDetails = {
  weeklyRent?: string | number;
  askingPrice?: string | number;
  suburb?: string;
  bedrooms?: string | number;
  bathrooms?: string | number;
  parking?: string | number;
  sqft?: string | number;
  yearBuilt?: string | number;
  propertyType?: string;
  propertySubtype?: string;
  architecturalStyle?: string;
  stories?: string | number;
  lotSize?: string | number;
  hoaFee?: string | number;
  propertyTax?: string | number;
  annualTax?: string | number;
  taxAssessedValue?: string | number;
  pricePerSqft?: string | number;
  zestimate?: string | number;
  rentZestimate?: string | number;
  daysOnZillow?: string | number;
  dateOnMarket?: string;
  dateAvailable?: string;
  region?: string;
  heating?: string;
  cooling?: string;
  basement?: string;
  fireplace?: string;
  roof?: string;
  constructionMaterial?: string;
  parcelNumber?: string;
  gasMeters?: string | number;
  garageSpaces?: string | number;
  carportSpaces?: string | number;
  highlights?: string[];
  schoolRatings?: unknown;
  facts?: unknown;
  listingDescription?: string;
  whatSpecial?: string;
  source?: string | null;
  sourceDomain?: string | null;
  market?: string | null;
  listingUrl?: string | null;
  [key: string]: unknown;
};

function buildStep2Messages(
  reportMode: ReportMode,
  market: Market,
  visualAnalysis: Record<string, unknown> | null,
  description?: string,
  optionalDetails?: AnalyzeOptionalDetails,
  verifiedFacts?: {
    // ── Basic property facts ──
    address: string | null;
    price: number | null;
    price_display: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    propertyType: string | null;
    yearBuilt: number | null;
    // ── Zillow estimates ──
    zestimate: number | null;
    zestimate_display: string | null;
    rentZestimate: number | null;
    rentZestimate_display: string | null;
    estimatedSalesRangeMin: number | null;
    estimatedSalesRangeMax: number | null;
    // ── Financial facts ──
    pricePerSqft: number | null;
    pricePerSqft_display: string | null;
    taxAssessedValue: number | null;
    taxAssessedValue_display: string | null;
    annualTax: number | null;
    annualTax_display: string | null;
    daysOnMarket: number | null;
    dateListed: string | null;
    // ── Monthly payment (from zillowFinancials.monthlyPayment) ──
    monthlyPayment: number | null;
    monthlyPayment_display: string | null;
    principalAndInterest: number | null;
    propertyTaxMonthly: number | null;
    homeInsuranceMonthly: number | null;
    hoa: 'yes' | 'no' | 'unknown' | 'inconsistent';
    hoaAmount: number | null;
    hoaConflict?: boolean;
    utilitiesIncluded: boolean | null;
    // ── Legacy aliases (for existing logic) ──
    annual_tax: number | null;
    annual_tax_display: string | null;
    tax_assessed_value: number | null;
    tax_assessed_value_display: string | null;
    price_per_sqft: number | null;
    price_per_sqft_display: string | null;
    date_listed: string | null;
    available_date: string | null;
    // ── Normalized property category ──
    normalizedPropertyCategory: string;
    displayType: string;
    rawHomeType: string;
    rawPropertyType: string;
    rawPropertySubtype: string;
    // ── Location Facts ──
    floodZone: string | null;
    walkScore: string | null;
    bikeScore: string | null;
    neighborhood: string | null;
    architecturalStyle: string | null;
  },
) {
  // ── Prompt selection ───────────────────────────────────────────────────────
  let systemPrompt: string;
  let selectedPromptName: string;

  if (market === 'US') {
    systemPrompt = reportMode === 'sale' ? STEP2_US_SALE_PROMPT : STEP2_US_RENT_PROMPT;
    selectedPromptName = reportMode === 'sale' ? 'STEP2_US_SALE_PROMPT' : 'STEP2_US_RENT_PROMPT';
  } else if (market === 'AU') {
    systemPrompt = reportMode === 'sale' ? STEP2_SALE_PROMPT : STEP2_RENT_PROMPT;
    selectedPromptName = reportMode === 'sale' ? 'STEP2_SALE_PROMPT' : 'STEP2_RENT_PROMPT';
  } else {
    // UNKNOWN → safe fallback: use US prompts (safer than accidentally routing US listings to AU)
    systemPrompt = reportMode === 'sale' ? STEP2_US_SALE_PROMPT : STEP2_US_RENT_PROMPT;
    selectedPromptName = reportMode === 'sale' ? 'STEP2_US_SALE_PROMPT (UNKNOWN→US fallback)' : 'STEP2_US_RENT_PROMPT (UNKNOWN→US fallback)';
    console.warn(`[MARKET_ROUTING] Unknown market detected, using US fallback prompt`);
  }

  console.log("[DIAG] market routing — buildStep2Messages:", {
    reportMode,
    market,
    selectedPrompt: selectedPromptName,
  });

  let textContent = visualAnalysis
    ? `VISUAL ANALYSIS RESULTS:\n${JSON.stringify(visualAnalysis, null, 2)}\n\n`
    : "VISUAL ANALYSIS RESULTS:\nNo photos provided - analysis based on listing description only.\n\n";

  // ── P0-9: Photo evidence rules — prevent unfounded assertions from photo observations ─
  textContent += `
PHOTO EVIDENCE RULES (STRICT):
- If a condition is NOT explicitly visible in the photos, you MUST use one of these conservative phrasings:
  - "[area] condition is unclear from available photos"
  - "[specific feature] not shown in available photos"
  - "not verified from listing photos"
- DO NOT write: "visible moisture", "visible cracks", "visible damage", "foundation issue"
  UNLESS the photo clearly shows water stains, mold, active cracks, or structural failure.
- Positive observations: Only report what is clearly visible and positive. Do not extrapolate condition from style or age.
- When in doubt, state the photo coverage gap rather than inferring a problem.
- These rules apply to ALL photo-based conclusions including basement, kitchen, bathroom, exterior, and roof observations.
`;

  if (description?.trim()) {
    textContent += `LISTING DESCRIPTION:\n${description}\n\n`;
  }

  if (optionalDetails) {
    const details: string[] = [];

    // Generic helper: safely add any key-value pair to details
    function addDetail(label: string, value: unknown) {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value) && value.length === 0) return;
      if (typeof value === 'object') {
        try {
          const json = JSON.stringify(value);
          if (json && json !== '{}') {
            details.push(`${label}: ${json.slice(0, 2500)}`);
          }
        } catch {
          details.push(`${label}: [object]`);
        }
        return;
      }
      details.push(`${label}: ${String(value)}`);
    }

    // ── Core price ──
    if (reportMode === 'rent') {
      const rentLabel = market === 'US' || market === 'UNKNOWN' ? 'Monthly Rent' : 'Weekly Rent';
      addDetail(rentLabel, optionalDetails.weeklyRent);
    } else {
      addDetail('Asking Price', optionalDetails.askingPrice);
    }

    // ── Location ──
    addDetail('Location / Region', optionalDetails.region || optionalDetails.suburb);

    // ── Room counts ──
    addDetail('Bedrooms', optionalDetails.bedrooms);
    addDetail('Bathrooms', optionalDetails.bathrooms);
    addDetail('Parking', optionalDetails.parking);

    // ── Size & structure ──
    addDetail('Interior Living Area (sqft)', optionalDetails.sqft);
    addDetail('Lot Size', optionalDetails.lotSize);
    addDetail('Year Built', optionalDetails.yearBuilt);
    addDetail('Home Type', optionalDetails.propertyType);
    addDetail('Property Subtype', optionalDetails.propertySubtype);
    addDetail('Architectural Style', optionalDetails.architecturalStyle);
    addDetail('Stories', optionalDetails.stories);
    addDetail('Price per Sqft', optionalDetails.pricePerSqft);

    // ── Tax & HOA ──
    addDetail('Annual Property Tax', optionalDetails.annualTax || optionalDetails.propertyTax);
    addDetail('Tax Assessed Value', optionalDetails.taxAssessedValue);
    addDetail('HOA Fee', optionalDetails.hoaFee);

    // ── Valuation estimates ──
    addDetail('Zestimate', optionalDetails.zestimate);
    addDetail('Rent Zestimate', optionalDetails.rentZestimate);

    // ── Market timing ──
    addDetail('Days on Zillow', optionalDetails.daysOnZillow);
    addDetail('Date on Market', optionalDetails.dateOnMarket);
    addDetail('Date Available', optionalDetails.dateAvailable);

    // ── Property features ──
    addDetail('Heating', optionalDetails.heating);
    addDetail('Cooling', optionalDetails.cooling);
    addDetail('Basement', optionalDetails.basement);
    addDetail('Fireplace', optionalDetails.fireplace);
    addDetail('Roof', optionalDetails.roof);
    addDetail('Construction Material', optionalDetails.constructionMaterial);
    addDetail('Parcel Number', optionalDetails.parcelNumber);
    addDetail('Gas Meters', optionalDetails.gasMeters);
    addDetail('Garage Spaces', optionalDetails.garageSpaces);
    addDetail('Carport Spaces', optionalDetails.carportSpaces);

    // ── Listing content ──
    addDetail("Listing Highlights / What's Special", optionalDetails.highlights);
    addDetail('Listing Description', optionalDetails.listingDescription || optionalDetails.whatSpecial);
    addDetail('School Ratings', optionalDetails.schoolRatings);
    addDetail('Raw Facts & Features', optionalDetails.facts);

    // ── Zillow Monthly Payment Breakdown (inject into prompt so AI uses exact values, not recalculated) ──
    const mp = verifiedFacts?.monthlyPayment;
    const pi = verifiedFacts?.principalAndInterest;
    const pt = verifiedFacts?.propertyTaxMonthly;
    const ins = verifiedFacts?.homeInsuranceMonthly;
    const mi = (verifiedFacts as any)?.mortgageInsurance;
    const ha = verifiedFacts?.hoaAmount;
    const mpDisplay = verifiedFacts?.monthlyPayment_display;
    if (mp != null || pi != null || pt != null || ins != null || mi != null || ha != null || mpDisplay) {
      textContent += `\nMONTHLY PAYMENT (ZILLOW ESTIMATE — USE THESE EXACT VALUES, DO NOT RECALCULATE OR ESTIMATE DIFFERENTLY. If the Estimated Monthly Payment is listed above, use it as-is for all monthly cost calculations.):`;
      if (mp != null) textContent += `\n- Estimated Monthly Payment: $${mp.toLocaleString()}/mo`;
      if (pi != null) textContent += `\n- Principal & Interest: $${pi.toLocaleString()}/mo`;
      if (pt != null) textContent += `\n- Property Taxes: $${pt.toLocaleString()}/mo`;
      if (ins != null) textContent += `\n- Home Insurance: $${ins.toLocaleString()}/mo`;
      if (mi != null) textContent += `\n- Mortgage Insurance: $${mi.toLocaleString()}/mo`;
      if (ha != null) textContent += `\n- HOA Fees: $${ha.toLocaleString()}/mo`;
    }

    // ── Zillow Location Facts (inject so AI uses real data, not inference) ──
    // All location data is sourced from optionalDetails which carries Zillow-extracted values
    const zf2 = (optionalDetails as any)?.zillowFinancials ?? {};
    const od = optionalDetails;
    const extractedNeighborhood = od?.neighborhood ?? od?.region ?? '';
    const extractedFloodZone = (zf2 as any)?.floodZone ?? (od as any)?.floodZone ?? (od as any)?.flood_zone ?? '';
    const extractedWalkScore = (zf2 as any)?.walkScore ?? (od as any)?.walkScore ?? (od as any)?.walk_score ?? '';
    const extractedBikeScore = (zf2 as any)?.bikeScore ?? (od as any)?.bikeScore ?? (od as any)?.bike_score ?? '';
    const extractedSchoolRatings = (zf2 as any)?.schoolRatings ?? (od as any)?.schoolRatings ?? (od as any)?.school_ratings ?? '';
    const extractedTransit = (zf2 as any)?.transit ?? (od as any)?.transit ?? '';
    if (extractedNeighborhood || extractedFloodZone || extractedWalkScore || extractedBikeScore || extractedSchoolRatings || extractedTransit) {
      textContent += `\nLOCATION DATA (ZILLOW):`;
      if (extractedNeighborhood) textContent += `\n- Neighborhood: ${extractedNeighborhood}`;
      if (extractedFloodZone) textContent += `\n- Flood Zone: ${extractedFloodZone}`;
      if (extractedWalkScore) textContent += `\n- Walk Score: ${extractedWalkScore}`;
      if (extractedBikeScore) textContent += `\n- Bike Score: ${extractedBikeScore}`;
      if (extractedSchoolRatings) textContent += `\n- School Ratings: ${extractedSchoolRatings}`;
      if (extractedTransit) textContent += `\n- Transit Score: ${extractedTransit}`;
    }

    // Debug log: verify facts are included
    console.log('[DIAG] Step2 optionalDetails included', {
      market,
      reportMode,
      detailCount: details.length,
      optionalDetailKeys: optionalDetails ? Object.keys(optionalDetails) : [],
      includedDetailsPreview: details.slice(0, 20),
    });

    if (details.length > 0) {
      textContent += `
ZILLOW FACTS & FEATURES FROM THE LISTING:
${details.map(item => `- ${item}`).join('\n')}

IMPORTANT:
Use these listing facts heavily in your analysis. Do not say tax, year built, home type, roof, HOA, price per sqft, or multi-family status are unknown if they appear above.
If a field is not listed above, then treat it as unknown and add it to data_gaps or external_data_needed.
`;
    }
    // ── Step 4: Inject verified facts for US market ──────────────────────────────────────────
    if (market === 'US' && verifiedFacts) {
      const vfParts: string[] = [];

      // Basic property facts
      if (verifiedFacts.address) vfParts.push(`- Address: ${verifiedFacts.address}`);
      if (verifiedFacts.price_display) vfParts.push(`- Asking Price: ${verifiedFacts.price_display}`);
      if (verifiedFacts.beds != null) vfParts.push(`- Bedrooms: ${verifiedFacts.beds}`);
      if (verifiedFacts.baths != null) vfParts.push(`- Bathrooms: ${verifiedFacts.baths}`);
      if (verifiedFacts.sqft != null) vfParts.push(`- Sqft: ${verifiedFacts.sqft}`);
      if (verifiedFacts.propertyType) vfParts.push(`- Property Type: ${verifiedFacts.propertyType}`);
      if (verifiedFacts.yearBuilt != null) vfParts.push(`- Year Built: ${verifiedFacts.yearBuilt}`);

      // Financial facts
      if (verifiedFacts.annualTax_display) vfParts.push(`- Annual property tax: ${verifiedFacts.annualTax_display}`);
      if (verifiedFacts.taxAssessedValue_display) vfParts.push(`- Tax assessed value: ${verifiedFacts.taxAssessedValue_display}`);
      if (verifiedFacts.pricePerSqft_display) vfParts.push(`- Price per sqft: ${verifiedFacts.pricePerSqft_display}`);
      if (verifiedFacts.dateListed) vfParts.push(`- Date listed: ${verifiedFacts.dateListed}`);
      if (verifiedFacts.daysOnMarket != null) vfParts.push(`- Days on market: ${verifiedFacts.daysOnMarket}`);

      // Zillow estimates
      if (verifiedFacts.zestimate_display) vfParts.push(`- Zestimate: ${verifiedFacts.zestimate_display}`);
      if (verifiedFacts.rentZestimate_display) vfParts.push(`- Rent Zestimate: ${verifiedFacts.rentZestimate_display}`);
      if (verifiedFacts.estimatedSalesRangeMin != null && verifiedFacts.estimatedSalesRangeMax != null) {
        vfParts.push(`- Estimated sales range: $${verifiedFacts.estimatedSalesRangeMin.toLocaleString()} - $${verifiedFacts.estimatedSalesRangeMax.toLocaleString()}`);
      }

      // Monthly payment
      if (verifiedFacts.monthlyPayment != null) {
        vfParts.push(`- Estimated monthly payment: $${verifiedFacts.monthlyPayment.toLocaleString()}/mo`);
      }
      if (verifiedFacts.principalAndInterest != null) {
        vfParts.push(`- Principal & interest: $${verifiedFacts.principalAndInterest.toLocaleString()}/mo`);
      }
      if (verifiedFacts.hoa === 'yes' && verifiedFacts.hoaAmount != null) {
        vfParts.push(`- HOA: $${verifiedFacts.hoaAmount}/mo`);
      } else if (verifiedFacts.hoa === 'no') {
        vfParts.push(`- HOA: None`);
      }

      // Property type classification
      vfParts.push(`- Normalized Property Category: ${verifiedFacts.normalizedPropertyCategory}`);
      if (verifiedFacts.displayType) {
        vfParts.push(`- Display Type: ${verifiedFacts.displayType}`);
      }
      // HOA status (handle inconsistent)
      if (verifiedFacts.hoa === 'inconsistent') {
        vfParts.push(`- HOA: Status Inconsistent — verify with listing agent`);
      }
      // Flood Zone
      if (verifiedFacts.floodZone) {
        vfParts.push(`- Flood Zone: ${verifiedFacts.floodZone}`);
      }

      if (vfParts.length > 0) {
        textContent += `
|VERIFIED LISTING FACTS — MUST NOT CONTRADICT:
|${vfParts.join('\n')}
|
|RULES:
|- The fields above are from Zillow listing data and are VERIFIED. You MUST include them in the report.
|- If Year Built is listed above: explicitly anchor the maintenance_risk in the actual year. Example: "Built in 1935 — electrical panel, plumbing material, boiler age, and roof age should be independently verified before estimating repair costs." You MUST NOT say year built is unknown anywhere in the report.
|- If Year Built is NOT listed above: do NOT say "Year built is unknown" as a standalone risk — instead say "Year built not provided — age-related systems (roof, electrical panel, plumbing, heating) cannot be assessed without this information" and add inspection priorities.
|- If Zestimate is listed above, you MUST include it in price_assessment.zestimate_context. Do NOT say "No Zestimate available".
|- If Rent Zestimate is listed above, include it in price_assessment.rent_context.
|- If Annual property tax is listed above, you MUST include it as carrying_costs.annual_tax. Do NOT say annual tax is unknown.
|- If Price per sqft is listed above, you MUST include it in price_assessment.price_per_sqft_context. Do NOT say price-per-sqft data is not available.
|- If Estimated monthly payment is listed above, include it in carrying_costs.primary_monthly_estimate.
|- If HOA is listed as "None", set carrying_costs.hoa = "No".
|- If HOA is listed as "Status Inconsistent", include it as a question in questions_to_ask and do NOT state a definitive HOA status.
|- If Flood Zone is listed above, you MUST include it in property_snapshot.floodZone or environmental_risk.summary. Do NOT say "flood zone not disclosed" or "flood risk unknown".
|- Do NOT ask about missing basic property details (beds/baths/sqft/propertyType) if they are listed above.
|- If a field is listed above, it is KNOWN — do NOT list it as a question to ask.
`;
      }
    }
  }

  // ── Inject property-type-specific instructions for US SALE ──────────────────
  if (market === 'US' && reportMode === 'sale' && verifiedFacts) {
    const cat = verifiedFacts.normalizedPropertyCategory;
    let typeInstructions = '';

    if (cat === 'co_op') {
      typeInstructions = `
|PROPERTY TYPE: CO-OP
|This listing is a cooperative (co-op). Apply the co-op-specific rules below.
|
|SUPPRESS — do NOT generate any of the following unless the listing explicitly states them:
|  - "two-family", "multi-family", "duplex", "income unit", "rental unit", "rental income", "second unit"
|  - "probate", "title issue", "court approval", "oil heating", "oil tank"
|  - "basement rental", "basement apartment", "legal basement", "rent roll", "lease terms", "legal unit count"
|  - "certificate of occupancy" as a rental or income concern
|If the listing does not explicitly mention these, do NOT generate them.
|
|PRIORITIZE in hidden_risks, questions_to_ask, and deal_breakers (when listing data is available):
|- Monthly maintenance fee amount and what it includes (e.g., taxes, electricity, water, heat, hot water)
|- Current or upcoming special assessments
|- Board approval requirements and timeline
|- Sublet/rental policy (how many years before subletting, limits, fees)
|- Flip tax amount and calculation
|- Reserve fund balance and building financials (last 2-3 years)
|- Financing restrictions (allowed types: conventional, FHA, co-op-specific; minimum down payment)
|- Owner-occupancy requirements
|- Walkup vs elevator access and its effect on resale
|- Building age, roof, boiler, facade, plumbing, electrical updates
|- Long days on market - ask why, whether there were prior offers or board rejections
|- Parking availability and waitlist
|- Yearly AC fee (if listing mentions it)
|
|BOTTOM LINE guidance for CO-OP:
|  - The low asking price may reflect high maintenance, restrictive board rules, financing limits, or building problems - do NOT mark it as "Likely Overpriced" without first flagging maintenance cost uncertainty.
|  - Focus on: maintenance verification, board rules, assessments, financing eligibility.
|  - Do NOT mention two-family, probate, oil heating, rent roll, or legal unit count.
|  - If the listing mentions "maintenance includes electricity and taxes", reference this and note it should be confirmed with the board.
|
|VERDICT guidance: Do NOT say "Likely Overpriced" just because price is low or days on market is high. For co-ops with undisclosed maintenance, prefer "High Verification Risk" or "Needs Cost Verification".
`;
    } else if (cat === 'single_family') {
      typeInstructions = `
|PROPERTY TYPE: SINGLE-FAMILY HOME
|This is a single-family residence. Apply the single-family rules below.
|
|IMPORTANT — DO NOT over-infer rental income:
|- "Finished lower level", "mother-daughter layout", or "separate entrance" does NOT automatically mean legal rental or basement bedroom.
|- Do NOT mention "second unit rent" or "legal two-family status" unless the listing explicitly confirms multi-family legal use.
|- Do NOT use "rental income potential" as a primary use case unless explicit.
|
|WHERE listing mentions "finished lower level" or "mother-daughter":
|- State: "Finished lower level / mother-daughter layout may not be legal sleeping space or rental space unless egress, ceiling height, permits, and Certificate of Occupancy support it."
|- Flag: Ask for the Certificate of Occupancy to confirm legal use.
|
|PRIORITIZE in hidden_risks and questions_to_ask:
|- Roof age and condition
|- Boiler, water heater, and HVAC age
|- Electrical panel capacity and material
|- Plumbing age and material (copper, galvanized, PEX)
|- Basement moisture, foundation, and drainage
|- Permits for finished basement or recent renovations
|- Certificate of Occupancy to confirm legal use
|- DOB records and open violations
|- Comparable single-family sales (not rental comps)
|- Insurance and utility costs
`;
    } else if (cat === 'multi_family') {
      typeInstructions = `
|PROPERTY TYPE: MULTI-FAMILY HOME
|This is a multi-family property. Apply the multi-family rules below.
|
|SUPPRESS (do not include in hidden_risks, questions_to_ask, or data_gaps unless the listing EXPLICITLY mentions basement-related keywords):
|- "Basement rental legality" or "basement apartment income" — only include if listing explicitly mentions: basement, finished basement, lower level, cellar, below grade, basement apartment, or mother/daughter lower level. Otherwise DO NOT mention basement as a rental risk.
|- Default "Legal unit count" phrasing — instead phrase as "Certificate of Occupancy confirming legal unit count"
|
|PRIORITIZE in hidden_risks, questions_to_ask, and deal_breakers:
|- Certificate of Occupancy confirming legal unit count
|- Actual rent roll and current lease terms
|- Rent stabilization or rent control status of any units
|- Separate utilities metering: If the listing mentions "Separate Gas Meters: N", include it in hidden_risks. If N=1 for a two-family, flag as owner-paid utility risk.
|- Fire safety and egress for each unit
|- Open DOB, HPD, ECB, or fire violations
|- Actual annual operating expenses (last 2-3 years)
|- Cap rate and NOI based on actual (not estimated) rents
|- Any illegal or unpermitted units and path to legalization
|- Tenant profiles and lease expiration dates
|- Insurance costs for multi-family
`;
    } else if (cat === 'condo') {
      typeInstructions = `
|PROPERTY TYPE: CONDO
|This is a condominium. Apply the condo rules below.
|
|SUPPRESS — DO NOT GENERATE:
|- Basement rental legality or basement rental income (condos do not have basement rental units)
|- Legal two-family status, CO as rental-income issue, rent roll, or second-unit rent
|- Probate, estate sale, or sheriff's sale language
|- Oil heating or oil tank references
|- Multi-family compliance, unit count, or rental income potential
|
|PRIORITIZE in hidden_risks and questions_to_ask:
|- HOA common charges amount and what's included
|- Special assessments (current or upcoming)
|- Reserve fund balance and reserve study date
|- Master insurance policy coverage and deductible
|- Rental restrictions and right of first refusal policy
|- Pending or active HOA litigation or board disputes
|- Owner-occupancy ratio and any financing restrictions
|- Deeded parking documentation and exclusive-use rights
|- Building maintenance responsibility (who maintains what)
`;
    } else if (cat === 'townhouse') {
      typeInstructions = `
|PROPERTY TYPE: TOWNHOUSE
|This is a townhouse. Apply the townhouse rules below.
|
|PRIORITIZE in hidden_risks and questions_to_ask:
|- HOA fees, what they cover (exterior maintenance, roof, landscaping, snow removal)
|- Exterior maintenance responsibilities and shared-wall obligations
|- Parking arrangements (deeded, assigned, or unassigned spots)
|- Reserve fund and special assessment history
|- Renovation permit history
|- Comparable townhouse sales in the same HOA or neighborhood
`;
    } else if (cat === 'land') {
      typeInstructions = `
|PROPERTY TYPE: LAND / LOT
|This is a vacant land or lot listing. Apply the land rules below.
|
|SUPPRESS: All interior/photo room analysis. Do not discuss bedrooms, kitchens, bathrooms, basement, or interior systems.
|
|PRIORITIZE in hidden_risks and questions_to_ask:
|- Zoning and permitted uses (confirm with local planning department)
|- Buildability for your intended use (setbacks, height limits,着什么)
|- Utilities availability and cost at the lot line (water, sewer, gas, electric)
|- Current survey showing lot dimensions, boundaries, easements
|- FEMA flood zone designation and flood insurance requirement
|- Phase I environmental report or history of contamination
|- Legal access (frontage on public road or recorded easement)
|- Comparable vacant land sales
`;
    } else if (cat === 'manufactured') {
      typeInstructions = `
|PROPERTY TYPE: MANUFACTURED HOME
|This is a manufactured or mobile home. Apply the manufactured home rules below.
|
|PRIORITIZE in hidden_risks and questions_to_ask:
|- Land ownership: do you own the lot or rent in a park? Monthly lot rent amount?
|- Park rules, age restrictions, pet policies, lot rent increase limits
|- Financing options (conventional, chattel loan, or other) and whether land is included
|- HUD tag number, construction date, original installation records
|- Foundation type and whether properly anchored
|- Clear title and any liens on the home or lot
|- Total monthly cost: lot rent + home payment + insurance + utilities + park fees
`;
    }

    if (typeInstructions) {
      textContent += typeInstructions;
    }

    // Category-specific BOTTOM LINE rules - must be AFTER typeInstructions
    if (cat === 'co_op') {
      textContent += `
|BOTTOM LINE for CO-OP: Focus on affordability, maintenance cost verification, board rules, and financing. Do NOT mention two-family, probate, oil heating, rent roll, or legal unit count unless the listing explicitly states them.
`;
    } else if (cat === 'multi_family') {
      textContent += `
|BOTTOM LINE for MULTI-FAMILY: Focus on CO, rent roll, legal unit count, utility metering, and operating expenses. Only mention probate, oil, or TLC if the listing explicitly states them.
`;
    } else if (cat === 'single_family') {
      textContent += `
|BOTTOM LINE for SINGLE-FAMILY: Focus on systems age, permit history, and condition. Do NOT mention rental income, rent roll, two-family, or legal unit count unless the listing explicitly states them.
`;
    } else if (cat === 'condo') {
      textContent += `
|BOTTOM LINE for CONDO: Focus on HOA financials, reserve fund balance, special assessments, rental restrictions, master insurance, and deeded parking documentation. Do NOT mention probate, oil heating, rent roll, two-family status, or CO as rental-income issue unless the listing explicitly states them.
`;
    }
  }

  const reportType = reportMode === 'sale' ? 'purchase' : 'rental';
  textContent +=
    `Based on the visual analysis and listing details, provide your ${reportType} decision report in JSON format.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: textContent },
  ];
}

// ========== Main Handler ==========

Deno.serve(async (req) => {
  console.log('[DEPLOY_MARKER]', 'ZILLOW_CC_DEBUG_2026_05_29_002');

  console.log("=== Edge Function Entry ===", {
    DEPLOY_MARKER: "ZILLOW_CC_DEBUG_2026_05_29_002",
    method: req.method,
    url: req.url,
    hasAuthorization: !!req.headers.get("Authorization"),
    authPrefix: req.headers.get("Authorization")?.slice(0, 20),
    hasApikey: !!req.headers.get("apikey"),
    hasAuAnonKey: !!PRIMARY_ANON_KEY,
    hasAccountServiceKey: !!ACCOUNT_SERVICE_KEY,
    hasLocalServiceKey: !!LOCAL_SERVICE_KEY,
    hasAuServiceRoleKey: !!PRIMARY_SERVICE_ROLE_KEY,
  });

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  let body: any = null; // declared early; assigned in POST block or later; null-safe via body?.action

  const action = url.searchParams.get("action");
  const queryId = url.searchParams.get("id");
  console.log("Action:", action, "QueryId:", queryId);

  // GET: Query status
  if (req.method === "GET" && queryId) {
    const state = await getAnalysisState(queryId);
    if (!state) {
      return jsonResponse({ message: "Analysis not found" }, 404);
    }

    const stateStatus = String((state as any)?.status || '');
    const isFinished =
      stateStatus === 'done' ||
      stateStatus === 'completed' ||
      stateStatus === 'success' ||
      stateStatus === 'failed';

    // Always fetch from analyses table (needed for full_result when done, and for report_mode)
    let full_result: unknown = null;
    let overall_score: number | null = null;
    let verdict: string | null = null;
    let reportMode: string = 'rent';

    try {
      const encodedId = encodeURIComponent(queryId);
      const analysisRes = await fetch(
        `${LOCAL_URL}/rest/v1/analyses?id=eq.${encodedId}&select=full_result,overall_score,verdict,report_mode`,
        {
          headers: {
            "apikey": LOCAL_SERVICE_KEY,
            "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
          },
        }
      );
      if (analysisRes.ok) {
        const records = await analysisRes.json();
        if (records && records.length > 0) {
          const record = records[0];

          // Parse full_result: may be stored as string or already-parsed object
          if (record.full_result !== null) {
            full_result =
              typeof record.full_result === 'string'
                ? JSON.parse(record.full_result)
                : record.full_result;
          }

          overall_score = record.overall_score ?? null;
          verdict = record.verdict ?? null;
          reportMode = record.report_mode || 'rent';
        } else {
          console.warn('[GET polling] analyses record not found for id', queryId);
        }
      }
    } catch (e) {
      console.error('[GET polling] Failed to fetch analyses record:', e);
    }

    console.log('[GET polling] returning result summary', {
      queryId,
      stateStatus: state.status,
      isFinished,
      hasFullResult: !!full_result,
      hasPriceAssessment: !!(full_result as Record<string, unknown>)?.price_assessment,
      hasCarryingCosts: !!(full_result as Record<string, unknown>)?.carrying_costs,
      askingPrice: (full_result as Record<string, unknown>)?.price_assessment
        ? (full_result as Record<string, unknown>)?.price_assessment && ((full_result as Record<string, unknown>)?.price_assessment as Record<string, unknown>)?.['asking_price']
        : undefined,
      carryingMonthlyEstimate:
        ((full_result as Record<string, unknown>)?.carrying_costs as Record<string, unknown>)?.['primary_monthly_estimate'],
    });

    // ── Canonical reportMode resolution (Fix 1 + Fix 2) ─────────────────────────
    // Priority: analyses.report_mode (authoritative) > inferred from market/domain
    //           > full_result.report_mode > full_result.reportMode > 'rent'
    //
    // Inferred: US listings on Zillow (sale listings) must not fallback to 'rent'.
    // If market=US or sourceDomain includes 'zillow', strongly bias toward 'sale'.
    const marketStr = String((full_result as Record<string, unknown>)?.market || '').toUpperCase();
    const sourceDomainStr = String(
      (full_result as Record<string, unknown>)?.sourceDomain ||
      (full_result as Record<string, unknown>)?.source_domain ||
      ''
    ).toLowerCase();
    const isUSMarket = marketStr === 'US';
    const isZillowListing = sourceDomainStr.includes('zillow');

    const inferredReportMode: string | null =
      (isUSMarket || isZillowListing) ? 'sale' : null;

    const canonicalReportMode =
      reportMode ||
      inferredReportMode ||
      (full_result as Record<string, unknown>)?.report_mode ||
      (full_result as Record<string, unknown>)?.reportMode ||
      'rent';

    // Strip stale reportMode from state to prevent it leaking into the response.
    const { reportMode: _stateReportMode, ...cleanState } = state as unknown as Record<string, unknown>;

    // Normalize full_result internally so that reading result.reportMode also returns
    // the correct value (not just the top-level field).
    if (full_result && typeof full_result === 'object') {
      (full_result as Record<string, unknown>).report_mode = canonicalReportMode;
      (full_result as Record<string, unknown>).reportMode = canonicalReportMode;
    }

    return jsonResponse({
      ...cleanState,
      status: state.status,
      stage: state.stage,
      message: state.message,
      progress: state.progress,
      error: state.error,
      result: full_result,
      overall_score,
      verdict,
      report_mode: canonicalReportMode,
      reportMode: canonicalReportMode,
    });
  }

  // GET: List user analyses history
  if (req.method === "GET" && action === "list") {
    const { user, error: authError, code: authCode } = await getCurrentUser(req);
    if (authError || !user) {
      return jsonResponse({ message: "Authentication required", code: "LIST_AUTH_FAILED_GET", reason: authError, authCode }, 401);
    }

    const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
    const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);

    try {
      const response = await fetch(
        `${LOCAL_URL}/rest/v1/analyses?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=${limit}&offset=${offset}`,
        {
          headers: {
            "apikey": LOCAL_SERVICE_KEY,
            "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
          },
        }
      );

      if (!response.ok) {
        console.error("Failed to fetch analyses:", await response.text());
        return jsonResponse({ message: "Failed to fetch analyses" }, 500);
      }

      const analyses = await response.json();
      return jsonResponse({ analyses });
    } catch (err) {
      console.error("Error fetching analyses:", err);
      return jsonResponse({ message: "Failed to fetch analyses" }, 500);
    }
  }

  // POST: List user analyses history (preferred method - avoids Kong header filtering issues)
  if (req.method === "POST") {
    // Use reqClone so original req body is preserved for submit/run downstream
    const reqClone = req.clone();
    let postBody: any;
    try {
      postBody = await reqClone.json();
    } catch {
      return jsonResponse({ message: "Invalid JSON body" }, 400);
    }
    const bodyAction = (postBody as any)?.action || null;

    if (bodyAction === "list") {
      const { user, error: authError, code: authCode } = await getCurrentUser(req);
      if (authError || !user) {
        return jsonResponse({ message: "Authentication required", code: "LIST_AUTH_FAILED_POST", reason: authError, authCode }, 401);
      }

      const limit = Number.parseInt(String(postBody.limit || "20"), 10);
      const offset = Number.parseInt(String(postBody.offset || "0"), 10);

      try {
        const response = await fetch(
          `${LOCAL_URL}/rest/v1/analyses?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=${limit}&offset=${offset}`,
          {
            headers: {
              "apikey": LOCAL_SERVICE_KEY,
              "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
            },
          }
        );

        if (!response.ok) {
          console.error("Failed to fetch analyses:", await response.text());
          return jsonResponse({ message: "Failed to fetch analyses" }, 500);
        }

        const analyses = await response.json();
        return jsonResponse({ analyses });
      } catch (err) {
        console.error("Error fetching analyses:", err);
        return jsonResponse({ message: "Failed to fetch analyses" }, 500);
      }
    }

    const isShareAction = action === "share" || postBody?.action === "share";
    // POST: Make analysis public (share)
    if (isShareAction) {
      const { analysisId } = postBody as { analysisId?: string };
      if (!analysisId) {
        return jsonResponse({ message: "Missing analysis ID" }, 400);
      }

      const { user, error: authError, code: authCode } = await getCurrentUser(req);
      if (authError || !user) {
        return jsonResponse({ message: "Authentication required", code: "SHARE_AUTH_FAILED", reason: authError, authCode }, 401);
      }

      try {
        // First get the analysis to check ownership — LOCAL
        const getResponse = await fetch(
          `${LOCAL_URL}/rest/v1/analyses?id=eq.${analysisId}&user_id=eq.${user.id}&select=*`,
          {
            headers: {
              "apikey": LOCAL_SERVICE_KEY,
              "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
            },
          }
        );

        if (!getResponse.ok) {
          return jsonResponse({ message: "Analysis not found" }, 404);
        }

        const analyses = await getResponse.json();
        if (!analyses || analyses.length === 0) {
          return jsonResponse({ message: "Analysis not found" }, 404);
        }

        const analysis = analyses[0];

        // If already public, return existing share info (don't regenerate)
        if (analysis.is_public && analysis.share_slug) {
          return jsonResponse({
            success: true,
            slug: analysis.share_slug,
            shareUrl: `${SITE_URL}/share/${analysis.share_slug}`,
            alreadyShared: true
          });
        }

        // Generate semantic share slug
        const suburb = analysis.address || null;
        const summary = analysis.summary || {};
        const fullResult = analysis.full_result || {};

        // Extract bedrooms/bathrooms from summary or full_result
        let bedrooms: number | null = null;
        let bathrooms: number | null = null;
        let propertyType: string | null = null;
        let reportMode: ReportMode = 'rent';
        let askingPrice: number | null = null;

        if (summary.bedrooms) {
          const bedroomsMatch = String(summary.bedrooms).match(/(\d+)/);
          if (bedroomsMatch) bedrooms = parseInt(bedroomsMatch[1], 10);
        }
        if (summary.bathrooms) {
          const bathroomsMatch = String(summary.bathrooms).match(/(\d+)/);
          if (bathroomsMatch) bathrooms = parseInt(bathroomsMatch[1], 10);
        }
        if (summary.propertyType) {
          propertyType = String(summary.propertyType);
        }

        // Extract from full_result if not in summary
        if (!bedrooms && fullResult.roomCounts) {
          const bedroomCount = fullResult.roomCounts['bedroom'] || fullResult.roomCounts['bedrooms'];
          if (bedroomCount) bedrooms = bedroomCount;
        }
      if (!propertyType && fullResult.inspectionFit) {
        // Could extract from inspectionFit if needed
      }
      if (fullResult.reportMode) {
        reportMode = fullResult.reportMode as ReportMode;
      }
      if (fullResult.price_assessment?.asking_price) {
        askingPrice = Number(fullResult.price_assessment.asking_price);
      }

      // Build semantic slug: sydney-2-bedroom-apartment-rental-analysis-58
      const seo_slug = generateShareSlug({
        suburb,
        bedrooms,
        propertyType,
        reportId: analysisId,
        reportMode,
      });

      // Extract weeklyRent from full_result if available
      const weeklyRent = summary.weeklyRent
        ? parseInt(String(summary.weeklyRent).replace(/[^0-9]/g, ''), 10)
        : fullResult.rent_fairness?.listing_price
          ? Number(fullResult.rent_fairness.listing_price)
          : null;

      // Generate SEO title and description
      const { seo_title, seo_description } = generateSEOFields({
        suburb,
        bedrooms,
        bathrooms,
        weeklyRent: reportMode === 'rent' ? weeklyRent : undefined,
        askingPrice: reportMode === 'sale' ? askingPrice : undefined,
        verdict: analysis.verdict,
        reportId: analysisId,
        reportMode,
      });

      // Update to public with full SEO data
      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        is_public: true,
        share_slug: seo_slug,
        seo_title,
        seo_description,
        shared_at: now,
      };

      const updateResponse = await fetch(
        `${LOCAL_URL}/rest/v1/analyses?id=eq.${analysisId}`,
        {
          method: "PATCH",
          headers: {
            "apikey": LOCAL_SERVICE_KEY,
            "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
          },
          body: JSON.stringify(updateData),
        }
      );

      if (!updateResponse.ok) {
        console.error("Failed to share analysis:", await updateResponse.text());
        return jsonResponse({ message: "Failed to share analysis" }, 500);
      }

      return jsonResponse({
        success: true,
        slug: seo_slug,
        seo_title,
        seo_description,
        shareUrl: `${SITE_URL}/share/${seo_slug}`
      });
    } catch (err) {
      console.error("Error sharing analysis:", err);
      return jsonResponse({ message: "Failed to share analysis" }, 500);
    }
  }

  } // End of POST handler

  // GET: Public access to shared analysis (no auth required)
  if (req.method === "GET" && action === "public") {
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return jsonResponse({ message: "Missing share slug" }, 400);
    }

    try {
      const response = await fetch(
        `${LOCAL_URL}/rest/v1/analyses?share_slug=eq.${slug}&is_public=eq.true&select=*`,
        {
          headers: {
            "apikey": LOCAL_ANON_KEY,
            "Authorization": `Bearer ${LOCAL_ANON_KEY}`,
          },
        }
      );

      if (!response.ok) {
        return jsonResponse({ message: "Analysis not found" }, 404);
      }

      const analyses = await response.json();
      if (!analyses || analyses.length === 0) {
        return jsonResponse({ message: "Analysis not found or not shared" }, 404);
      }

      const analysis = analyses[0];
      
      // Return only public-safe data including SEO fields
      return jsonResponse({
        analysis: {
          id: analysis.id,
          overall_score: analysis.overall_score,
          verdict: analysis.verdict,
          title: analysis.title,
          address: analysis.address,
          cover_image_url: analysis.cover_image_url,
          summary: analysis.summary,
          full_result: analysis.full_result,
          created_at: analysis.created_at,
          updated_at: analysis.updated_at,
          share_slug: analysis.share_slug,
          seo_title: analysis.seo_title,
          seo_description: analysis.seo_description,
          shared_at: analysis.shared_at,
          is_public: true,
          report_mode: analysis.report_mode || 'rent',
        }
      });
    } catch (err) {
      console.error("Error fetching public analysis:", err);
      return jsonResponse({ message: "Failed to fetch analysis" }, 500);
    }
  }

  // POST: submit / run
  if (req.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405);
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > 4 * 1024 * 1024) {
    return jsonResponse(
      { message: "Request too large. Maximum 4MB allowed." },
      413,
    );
  }

  try {
    body = await req.json();
  } catch (e) {
    console.error("=== req.json() FAILED ===");
    console.error("Error type:", e?.constructor?.name);
    console.error("Error message:", String(e));
    console.error("Error cause:", e?.cause);
    return jsonResponse({ message: "Invalid JSON in request body", debugError: String(e), errorType: e?.constructor?.name }, 400);
  }

  // action fallback: if Kong stripped URL query params, use body.action
  const resolvedAction = action || (body?.action as string | null) || null;
  const resolvedQueryId = queryId || (body?.id as string | null) || (body?.analysisId as string | null) || null;

  console.log('[analyze][ENTRY]', {
    marker: 'ZILLOW_CC_DEBUG_2026_05_29_002',
    method: req.method,
    action: resolvedAction,
    urlAction: action,
    bodyAction: (body as any)?.action,
    hasZillowFinancials: !!(body as any)?.zillowFinancials,
    zillowMonthlyEstimate: (body as any)?.zillowFinancials?.monthlyPayment?.estimatedMonthlyPayment?.value ?? null,
    zillowPropertyTaxes: (body as any)?.zillowFinancials?.monthlyPayment?.propertyTaxes?.value ?? null,
    price: (body as any)?.price || (body as any)?.optionalDetails?.askingPrice || null,
    sourceDomain: (body as any)?.sourceDomain,
    market: (body as any)?.market,
    reportMode: (body as any)?.reportMode,
  });

  // ========== Basic Sync Action (Anonymous by default, creates history if logged in) ==========
  if (resolvedAction === "basic-sync") {
    console.log("=== BASIC SYNC START ===");

    const description = typeof body.description === "string" ? body.description : "Property listing information";
    const reportMode: ReportMode = body.reportMode === 'sale' ? 'sale' : 'rent';
    const optionalDetails = body.optionalDetails ?? {};
    const zillowFinancials = (body as Record<string, unknown>).zillowFinancials || null;

    console.log("Description length:", description.length);
    console.log("Report mode:", reportMode);
    console.log("Source:", body.source ?? null);
    console.log('[analyze-basic] zillowFinancials received', {
      topEstimate: (zillowFinancials as any)?.topEstimatedPayment?.value,
      estimatedMonthlyPayment: (zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.value,
      annualTaxAmount: (zillowFinancials as any)?.financialDetails?.annualTaxAmount?.value,
    });

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      return jsonResponse({ message: "Server configuration error" }, 500);
    }

    // ── Unified market detection ─────────────────────────────────────────────────────────
    // Extract from body with explicit null — avoids redeclaring 'source' from line 3911
    const bodySource = body.source ?? null;
    const bodySourceDomain = (body as Record<string, unknown>).sourceDomain as string | null ?? null;
    const bodyMarket = (body as Record<string, unknown>).market as string | null ?? null;
    const bodyListingUrl = (body as Record<string, unknown>).listingUrl as string | null ?? null;

    const detectedMarket = detectMarket({
      source: bodySource,
      sourceDomain: bodySourceDomain,
      market: bodyMarket,
      listingUrl: bodyListingUrl,
      description,
      optionalDetails,
    });

    console.log("[DIAG] backend market routing — basic-sync:", {
      body_source: bodySource,
      body_sourceDomain: bodySourceDomain,
      body_market: bodyMarket,
      body_listingUrl: bodyListingUrl,
      optional_source: (optionalDetails as Record<string, unknown>).source ?? null,
      optional_sourceDomain: (optionalDetails as Record<string, unknown>).sourceDomain ?? null,
      optional_market: (optionalDetails as Record<string, unknown>).market ?? null,
      optional_listingUrl: (optionalDetails as Record<string, unknown>).listingUrl ?? null,
      final_market: detectedMarket,
      reportMode,
    });

    const basicPromptName = detectedMarket === 'US'
      ? (reportMode === 'sale' ? 'basic-us-sale' : 'basic-us-rent')
      : detectedMarket === 'AU'
      ? (reportMode === 'sale' ? 'basic-au-sale' : 'basic-au-rent')
      : (reportMode === 'sale' ? 'basic-us-sale (UNKNOWN→US fallback)' : 'basic-us-rent (UNKNOWN→US fallback)');

    // ── Step 1: Build Property Intelligence Profile BEFORE LLM call ──────────────
    const profile = buildPropertyIntelligenceProfile({
      normalizedPropertyCategory: (optionalDetails as Record<string, unknown>).normalizedPropertyCategory as string ?? null,
      propertyType: (optionalDetails as Record<string, unknown>).propertyType as string ?? null,
      propertySubtype: (optionalDetails as Record<string, unknown>).propertySubtype as string ?? null,
      homeType: (optionalDetails as Record<string, unknown>).homeType as string ?? null,
      listingText: description,
      yearBuilt: (optionalDetails as Record<string, unknown>).yearBuilt as number ?? null,
      pricePerSqft: (optionalDetails as Record<string, unknown>).pricePerSqft as number ?? null,
      daysOnMarket: (optionalDetails as Record<string, unknown>).daysOnMarket as number ?? null,
      hoaAmount: (optionalDetails as Record<string, unknown>).hoaFee as number ?? null,
      taxHistory: (optionalDetails as Record<string, unknown>).taxHistory as string ?? null,
      zestimateAvailable: Boolean((zillowFinancials as any)?.zestimate ?? (optionalDetails as any)?.zestimate),
      rentZestimateAvailable: Boolean((zillowFinancials as any)?.rentZestimate ?? (optionalDetails as any)?.rentZestimate),
    });

    console.log('[RawOptionalDetails] received optionalDetails keys and values', {
      keys: Object.keys(optionalDetails as Record<string, unknown>),
      normalizedPropertyCategory: (optionalDetails as Record<string, unknown>).normalizedPropertyCategory,
      propertyType: (optionalDetails as Record<string, unknown>).propertyType,
      propertySubtype: (optionalDetails as Record<string, unknown>).propertySubtype,
      homeType: (optionalDetails as Record<string, unknown>).homeType,
      listingDescription: String((optionalDetails as Record<string, unknown>).listingDescription ?? '').slice(0, 100),
      description: String(description ?? '').slice(0, 100),
    });

    console.log('[BasicProfile]', JSON.stringify({
      normalizedPropertyCategory: (optionalDetails as Record<string, unknown>).normalizedPropertyCategory,
      propertyType: (optionalDetails as Record<string, unknown>).propertyType,
      propertySubtype: (optionalDetails as Record<string, unknown>).propertySubtype,
      homeType: (optionalDetails as Record<string, unknown>).homeType,
      listingTextPreview: description.slice(0, 200),
      detectedCategory: profile.propertyCategory,
      categorySource: (profile as any).categorySource,
    }, null, 2));

    const systemPrompt = detectedMarket === 'US' || detectedMarket === 'UNKNOWN'
      ? `You are generating a BASIC / FREE property check, not a full property analysis.

The purpose: tell the user what the listing says, what specific signals it reveals, what is still unverified, and what to ask before booking a viewing.

--- PROPERTY INTELLIGENCE (CONTROLLING CONTEXT) ---
The following profile was built from listing facts BEFORE this analysis.
Treat it as the controlling context UNLESS listing evidence clearly contradicts it.

PROPERTY PROFILE:
${JSON.stringify(profile, null, 2)}

MANDATORY RULES derived from this profile:
- Asset type: ${profile.propertyCategory}
- Ownership model: ${profile.ownershipModel}
- Primary decision axis: ${profile.primaryDecisionAxis.join('; ')}
- Decisive listing signals: ${profile.decisiveListingSignals.length > 0 ? profile.decisiveListingSignals.join(', ') : '(none detected)'}
- Generic risks to AVOID: ${profile.irrelevantGenericRisksToAvoid.length > 0 ? profile.irrelevantGenericRisksToAvoid.join(', ') : '(none)'}

ANTI-TEMPLATE CHECK (MANDATORY for every section):
Before including ANY risk, question, or check item, ask: "Does this apply to nearly every property of this type/age?"
If yes → REMOVE unless listing text provides specific evidence for THIS property.
Generic risks FORBIDDEN for ${profile.propertyCategory}:
${profile.irrelevantGenericRisksToAvoid.length > 0 ? profile.irrelevantGenericRisksToAvoid.map(r => `  - ${r}`).join('\n') : '  (none)'}

Do not default to a single-family residential template. Do not write roof/HVAC/plumbing risks for co-ops or condos unless listing explicitly mentions buyer-owned systems or system condition.
--- END PROPERTY INTELLIGENCE ---

--- STRUCTURED FIELD OVERRIDE RULES ---
If the property profile's detected category came from a structured field (homeType / propertySubtype / propertyType / normalizedPropertyCategory), the listing description CANNOT override that classification.
Structured field evidence includes: "SingleFamily", "Single Family Residence", "Single-Family", "SingleFamily", "Detached", "House", "Condo", "Condominium", "Townhouse", "Duplex" (when it is the primary property type, not a layout/agent wording).

WORDING vs. LEGAL CLASSIFICATION — CRITICAL:
- "duplex home", "duplex-style", "delivered vacant", "investor opportunity", "rental potential", "income unit" in the listing description are AGENT WORDING or LAYOUT DESCRIPTIONS.
- They do NOT constitute legal classification evidence.
- If structured facts say Single Family Residence, you MUST treat this as a single-family home even if the description uses the word "duplex" or "investor".
- Never output "Multi-Family Claim", "rent roll", "actual leases", "separate utility metering", "Certificate of Occupancy to confirm legal unit count", or "legal unit count" questions UNLESS the listing explicitly states one of:
  * "legal 2-family" or "legal two-family"
  * "2 units" or "two units" (not "duplex layout")
  * "multi-family" as the property type (not agent description)
  * separate rental units with actual rent amounts
  * Certificate of Occupancy already obtained confirming unit count
--- END STRUCTURED FIELD OVERRIDE RULES ---

--- CORE RESTRICTIONS ---
- Do NOT analyse photos. Basic report has no photos.
- Do NOT generate Agent Spin Decoder.
- Do NOT generate full carrying cost analysis.
- Do NOT generate detailed maintenance / legal / environmental risk cards.
- Do NOT produce a full buyer recommendation.
- Do NOT generate an "Is the price fair" verdict.
- Do NOT infer: legal status, rental income, property type, beds, baths, sqft, renovation costs, or market time — unless explicitly stated in the listing text.
- Do NOT use these phrases unless listing explicitly provides supporting facts:
  * "legal 2-family", "legal multi-family", "approved use", "compliant"
  * "good potential", "strong rental setup", "investment-ready"
  * "requires renovations", "needs work", "renovation potential"
  * "good condition", "poor condition", "move-in ready"
  * "fair price", "overpriced", "bargain", "good value"
  * "income-producing", "investment-grade"
--- END RESTRICTIONS ---

--- LEGAL USE RULES ---
If the listing mentions rental, multi-family, or second-unit use without a Certificate of Occupancy:
- NEVER say the property IS "legal 2-family", "legal multi-family", or "compliant"
- Use CAUTIOUS language only: "the listing suggests", "appears to be", "may indicate"
- Recommend verification through Certificate of Occupancy and public records.
--- END LEGAL USE RULES ---

--- LISTING SIGNALS RULES ---
Signals must be specific to the identified asset type: ${profile.propertyCategory}.
Return up to 3 listing signals — specific observations drawn directly from the listing data and structured fields.
Each signal is a one-line insight about THIS property specifically, not a generic template.
Format: [{ "signal": "short label", "reason": "one sentence of context from listing data" }]

Signal types to look for (pick whichever apply to THIS listing):
${profile.propertyCategory === 'co_op' ? `- Board/sublet signals: board approval requirements, subletting restrictions, flip tax
- Maintenance: total monthly cost and what it includes
- Building age signals: aging infrastructure in older buildings affects all unit owners` : ''}
${profile.propertyCategory === 'condo' ? `- HOA signals: monthly fees, reserves, assessments, special charges
- Building financial health: reserve fund, pending assessments
- Rental/legal signals: rental restrictions, owner-occupancy ratio` : ''}
${profile.propertyCategory === 'multi_family' ? `- Legal use: "legal 2-family", "walk-in apartment", "mother-daughter", income unit
- Multi-unit signals: separate entrance, 2-family, duplex
- Financial: rent roll, rental income potential` : ''}
${['single_family', 'townhouse'].includes(profile.propertyCategory) ? `- Built year: if yearBuilt is early (pre-1970), flag that major systems (roof/HVAC/electrical/plumbing) age is important
- Price per sqft: if $/sqft is notably high or low, flag that comparable sales are needed
- Basement mentioned: flag that basement permits/egress/legal use need verification` : ''}
${profile.propertyCategory === 'land' ? `- Lot/zoning signals: lot size, zoning, buildability
- Utilities: availability at lot line
- Survey/flood: easements, flood zone, access` : ''}
Only output signals that are genuinely supported by THIS listing's data. Do not fabricate signals. If the listing data does not support any specific signal, return an empty array.
--- END LISTING SIGNALS RULES ---

--- BOTTOM LINE RULES ---
Write ONE sentence that is specific and grounded in the actual data present vs. missing.
MAX 70 words.
The sentence MUST cite at least 2 specific facts from the listing — use actual values where available:
e.g. "At $619,000 for a 3bd/2ba 1,196 sqft home built in 1960, this listing provides basic facts, but major system age, comparable sales, and inspection findings still need verification."
If the listing has very few fields, say: "This listing does not provide enough verified information to judge the deal confidently. Key basics such as [list the missing fields] are missing or unclear."
Only mention categories that are genuinely missing.
NEVER write "including, but" or "and but".
--- END BOTTOM LINE RULES ---

--- WHAT'S MISSING RULES ---
Use THIS property's primary decision axis to rank gap importance (from PROPERTY INTELLIGENCE section).
Return 4 to 6 short phrases describing what is still unverified from THIS listing.
Each item is one short line, no period, no full sentence.
Only include gaps that are genuinely relevant to THIS property type: ${profile.propertyCategory}.
Do NOT default to roof/basement/CO/permits for every listing.

Property-type priority gaps for ${profile.propertyCategory}:
${profile.propertyCategory === 'co_op' ? `- Monthly maintenance total cost and what it includes
- Board approval requirements and timeline
- Flip tax or transfer fee
- Subletting and owner-occupancy rules
- Reserve fund balance and building financials
- Financing restrictions` : ''}
${profile.propertyCategory === 'condo' ? `- HOA reserves, pending assessments, and special fees
- Rental restrictions and pet policies
- Master insurance coverage
- Owner-occupancy ratio and financing restrictions
- Litigation or pending legal issues` : ''}
${profile.propertyCategory === 'multi_family' ? `- Certificate of Occupancy and legal unit count
- Current rent roll and actual leases
- Rent stabilization or rent control status
- Open DOB/HPD/ECB violations
- Separate utility metering` : ''}
${['single_family', 'townhouse'].includes(profile.propertyCategory) ? `- Major systems age (roof/HVAC/electrical/plumbing) — only if built before 1975
- Basement permits, egress, and legal use — only if basement mentioned
- Comparable sales
- Open permits or violations
- Actual insurance and utility costs` : ''}
${profile.propertyCategory === 'land' ? `- Zoning and permitted uses
- Utilities availability and connection cost
- Flood zone and survey
- Easements and deed restrictions` : ''}
${profile.propertyCategory === 'unknown' ? `- Comparable sales
- Legal use verification
- Property condition evidence
- Actual insurance and utility costs` : ''}

Order by importance: core deal factors first, then property-type specifics, then costs.
--- END WHAT'S MISSING RULES ---

--- TOP 3 THINGS TO CHECK RULES ---
Select items from THIS property's primary decision axis (from the PROPERTY INTELLIGENCE section above).
Return 2–4 items (no fixed minimum). Each item has title, why_it_matters, action.
- title: short label (<= 60 chars). MUST reference specific listing data where possible, e.g. "Built in 1960: Systems Age" or "At $1,003/sqft, Comps Matter"
- why_it_matters: one sentence explaining why this item can change the buyer's decision (<= 140 chars). Reference specific values from THIS listing, not generic statements.
- action: one concrete step the buyer should take (<= 120 chars). Start with a verb.
- Do NOT force-fill to 3 items. Return fewer if there are genuinely fewer than 2 relevant items.

IMPORTANT — ${profile.propertyCategory} specific:
${profile.propertyCategory === 'co_op' ? `- PRIORITY: Board approval & timeline, maintenance total cost, subletting rules, building financial health
- Do NOT write roof/HVAC/plumbing/electrical checks unless listing explicitly mentions buyer-owned systems` : ''}
${profile.propertyCategory === 'condo' ? `- PRIORITY: HOA reserves & assessments, rental restrictions, master insurance, owner-occupancy ratio
- Do NOT write roof/HVAC/plumbing/electrical checks unless listing explicitly mentions buyer-owned systems` : ''}
${profile.propertyCategory === 'multi_family' ? `- PRIORITY: Certificate of Occupancy, actual rent roll, separate metering, open violations
- Focus on legal use and income verification, not generic home systems` : ''}
${profile.propertyCategory === 'single_family' ? `- PRIORITY: Roof/HVAC age, comparable sales, basement permits, drainage
- Do NOT write co-op/condo-specific items like board approval, flip tax, HOA reserves` : ''}
${profile.propertyCategory === 'townhouse' ? `- PRIORITY: HOA fees & responsibility scope, comparable sales, parking arrangements
- Do NOT write co-op/condo items or generic single-family systems unless HOA covers exterior` : ''}
${profile.propertyCategory === 'land' ? `- PRIORITY: Zoning & permitted uses, utilities at lot line, flood zone & survey
- Do NOT write any residential systems risks` : ''}
${profile.propertyCategory === 'unknown' ? `- Focus on comparable sales, legal use verification, and condition evidence
- Do not assume any specific property type risks` : ''}

Do NOT restate facts already confirmed in the listing. Each item must point to a genuine gap for THIS property.
--- END TOP 3 THINGS TO CHECK RULES ---

--- QUESTIONS RULES ---
Generate 3 to 5 questions to ask the listing agent before booking a viewing.
Each question is a single sentence starting with Can/Is/Are/What/How/Why/When.
Questions must come FROM the what's_missing and top_3 items above — if a gap is listed there, it must have a corresponding question.
Do NOT ask generic questions that do not connect to specific listing gaps.
If a fact is already confirmed in the listing, frame the question as "confirm" not "provide".
If Zillow monthly payment data exists, include one cost-confirmation question.

Property-type-specific questions:
${profile.propertyCategory === 'co_op' ? `- Ask about board package requirements and typical approval timeline
- Ask for the full maintenance breakdown and what it includes
- Ask about subletting rules, duration limits, and any fees
- Ask about flip tax or transfer fee calculation
- Ask for building financial statements and reserve fund balance` : ''}
${profile.propertyCategory === 'condo' ? `- Ask about HOA reserves and any pending special assessments
- Ask about rental restrictions and pet policies
- Ask about master insurance coverage and unit-owner insurance requirements
- Ask about the owner-occupancy ratio and financing restrictions` : ''}
${profile.propertyCategory === 'multi_family' ? `- Ask for the Certificate of Occupancy confirming legal unit count
- Ask for the current rent roll and actual leases
- Ask about rent stabilization or rent control status
- Ask about open violations (DOB, HPD, ECB)` : ''}
${['single_family', 'townhouse'].includes(profile.propertyCategory) ? `- Ask about roof age and last major system updates
- Ask for comparable sales
- Ask about permits for any renovations
- Ask about basement or lower level condition and permits` : ''}
${profile.propertyCategory === 'land' ? `- Ask about zoning and permitted uses
- Ask about utilities availability at the lot line
- Ask for a survey and flood zone confirmation` : ''}
--- END QUESTIONS RULES ---

--- UPSELL CTA RULES ---
Return a fixed upsell_cta object:
- title: "Unlock Full Analysis"
- body: "Basic shows what this listing reveals and what still needs asking. Full Analysis adds condition risk analysis, price confidence verdict, carrying-cost breakdown, and whether this property fits your buyer profile."
No locked_modules field. No mention of "Photo & Space Analysis" as a locked feature in the body.
--- END UPSELL CTA RULES ---

Tone: Clear, Practical, Conservative, No overclaiming, No hallucinated facts.
Do not pretend the report has enough data for a full decision.`
      : `You are generating a BASIC / FREE property check, not a full property analysis.

The purpose: tell the user what the listing says, what is still unverified, and what to ask before booking a viewing.

--- CORE RESTRICTIONS ---
- Do NOT analyse photos. Basic report has no photos.
- Do NOT generate Agent Spin Decoder.
- Do NOT generate full carrying cost analysis.
- Do NOT generate detailed maintenance / legal / environmental risk cards.
- Do NOT produce a full buyer recommendation.
- Do NOT infer: legal status, rental income, property type, beds, baths, sqft, renovation costs, or market time — unless explicitly stated in the listing text.
- Do NOT use these phrases unless listing explicitly provides supporting facts:
  * "legal setup", "approved use", "compliant"
  * "good potential", "strong rental yield", "investment-ready"
  * "requires renovations", "needs work", "renovation potential"
  * "good condition", "poor condition", "move-in ready"
  * "fair price", "overpriced", "bargain", "good value"
--- END RESTRICTIONS ---

--- LEGAL USE RULES ---
If the listing mentions rental or multi-unit use without documentation:
- Use CAUTIOUS language only: "the listing suggests", "appears to be", "may indicate"
- Recommend verification through documentation and public records.
--- END LEGAL USE RULES ---

--- BOTTOM LINE RULES ---
Write ONE sentence that is specific and grounded in the actual data present vs. missing.
Follow this template structure:
"This listing provides useful basic facts, including [known facts], but [missing categories] still need verification before relying on this property."
Only mention categories that are genuinely missing from the listing data.
NEVER write "including, but" or "and but" — if the [known facts] list would be empty, rephrase to:
"This listing has limited verified information, but [missing categories] still need verification before relying on this property."
Example bad: "This listing provides useful basic facts, including, but carrying costs..."
Example good: "This listing has limited verified information, but carrying costs and comparable sales still need verification."
If key fields are heavily missing, say: "This listing does not provide enough verified information to judge the deal confidently. Key basics such as [list] are missing or unclear."
--- END BOTTOM LINE RULES ---

--- LISTING CLAIMS RULES ---
Only flag claims that appear EXPLICITLY in the listing text.
Only flag claims in one of these categories (max 3 total):
- LEGAL 2-FAMILY / rental setup — flag if listing says "legal 2-family", "two-family", "multi-family", "rental-approved", "income opportunity"
- CONDITION — flag if listing says "TLC", "needs work", "needs updating", "needs renovation", "as-is", "vacant", "sold as-is", "probate"
- PRICE MOTIVATION — flag if listing says "price reduced", "motivated seller", "price drop"
For each claim: give the phrase, a HomeScope check, and one "ask before viewing" question.
If no clear listing-language claims exist, set listing_claims to empty array.
--- END LISTING CLAIMS RULES ---

--- QUESTIONS RULES ---
Generate up to 5 questions to ask before booking a viewing.
Questions must cover genuine gaps in the listing — NOT restate confirmed facts.
Rules:
- If beds/baths/sqft/price are confirmed, frame questions as "confirm accuracy" not "can you provide X"
- If rental or multi-family is mentioned, ask about Certificate of Occupancy / legal use
- Ask about: legal use, costs (council rates/insurance/strata/utilities), condition/repairs, comparable sales or rental history, open permits/violations/title issues
- Max 5 questions. Each must be a real question (start with Can/Is/Are/What/How/Why).
--- END QUESTIONS RULES ---

--- CTA RULES ---
Use exactly this upsell_cta:
- title: "Unlock Full Analysis"
- body: "Basic shows what the listing says and what still needs verification. Full Analysis goes deeper into photos, price confidence, legal and maintenance risks, carrying-cost assumptions, and whether this property is actually worth viewing."
- button: "Unlock Full Analysis"
--- END CTA RULES ---

Tone: Clear, Practical, Conservative, No overclaiming, No hallucinated facts.
Do not pretend the report has enough data for a full decision.`;

    // Helper: assemble a minimal, US-only listing data block per proposal §六.
    // We do NOT pass: imageUrls, photo captions, raw full page text, school details,
    // neighborhood long text, Zestimate history, MLS disclaimer.
    const truncate = (v: unknown, max: number): string => {
      const s = typeof v === 'string' ? v : v == null ? '' : String(v);
      return s.length > max ? s.slice(0, max) : s;
    };

    const buildUsUserPrompt = (kind: 'sale' | 'rent') => {
      const opts = optionalDetails as Record<string, unknown>;
      const desc = truncate(description, 1200);
      const factsArr = Array.isArray(opts.factsAndFeatures)
        ? (opts.factsAndFeatures as unknown[]).slice(0, 30)
        : [];
      const highlightsArr = Array.isArray(opts.listingHighlights)
        ? (opts.listingHighlights as unknown[]).slice(0, 10)
        : [];

      const lines: string[] = [];
      lines.push(`Analyze this ${kind === 'rent' ? 'rental' : 'sale'} property listing. Return JSON with ONLY these fields (remove all others):`);
      lines.push('{');
      lines.push('  "bottom_line": "one sentence (max 70 words) in format: [specific facts with actual numbers from the listing data above: price, beds/baths, sqft, year built, tax if available] — [3-5 specific verification items; for single-family prefer: comparable sales, basement permits/egress, major systems age: roof/HVAC/electrical/plumbing, oil heating/tank records, open permits or violations, insurance and utility costs; no generic phrases like property condition or due diligence unless no facts available]",');
      lines.push('  "listing_signals": [');
      lines.push('    { "signal": "string", "reason": "string" }');
      lines.push('  ],');
      lines.push('  // Each signal: (1) cite a specific fact, number, or quoted phrase from the listing data above.');
      lines.push('  // (2) state what it means and what still needs verification.');
      lines.push('  // (3) Generate 2-3 signals only — each must be bound to a real listing field (price, beds/baths, sqft, year built, tax, zestimate, description).');
      lines.push('  // (4) If Zillow shows a Zestimate or Rent Zestimate, do NOT say "No Zestimate" — include it as a signal.');
      lines.push('  // (5) Do NOT infer school ratings, neighborhood safety, traffic, or future value — Basic has no verified data for these.');
      lines.push('  // (6) Do NOT repeat the same fact in different words across signals.');
      lines.push('  "whats_missing": ["short phrase 1", "short phrase 2", "short phrase 3", "short phrase 4"],');
      lines.push('  // Avoid generic or duplicate verification items. Use the most concrete fact-triggered risks instead:');
      lines.push('  // - yearBuilt before 1970 → "major systems age: roof / HVAC / electrical / plumbing"');
      lines.push('  // - basement mentioned → "basement permits, egress, ceiling height, and legal use"');
      lines.push('  // - oil heating mentioned → "oil tank location, service records, and removal liability"');
      lines.push('  // - pricePerSqft or high asking price → "comparable sales"');
      lines.push('  // - tax/monthly payment exists → "insurance, utilities, and loan terms"');
      lines.push('  // - Zestimate/Rent Zestimate exists → mention them but still require comparable sales');
      lines.push('  // Do NOT repeat the same concept across What\'s Missing or Key Things To Check.');
      lines.push('  // Do not use generic phrases like "property condition", "due diligence", "verify details", or "needs more research" when specific facts are available.');
      lines.push('  // If Zestimate or Rent Zestimate exists, never say it is missing.');
      lines.push('  // Prefer: "Zillow Value Available — Zillow shows a Zestimate of $X and Rent Zestimate of $Y/mo, but comparable sales and actual assumptions still need verification."');
      lines.push('  "top_3_things_to_check": [');
      lines.push('    { "title": "string — must reference a specific extracted fact (e.g., year built, basement mention, price per sqft)", "why_it_matters": "string", "action": "string" },');
      lines.push('    { "title": "string — must reference a specific extracted fact", "why_it_matters": "string", "action": "string" },');
      lines.push('    { "title": "string — must reference a specific extracted fact", "why_it_matters": "string", "action": "string" }');
      lines.push('  ],');
      lines.push('  "questions_to_ask": ["question 1", "question 2", "question 3"],');
      lines.push('  "upsell_cta": { "title": "Unlock Full Analysis", "body": "string" }');
      lines.push('}');
      lines.push('');
      lines.push('Only output the JSON. No other text.');
      lines.push('');

      // Listing data block — minimal, US-only fields
      if (opts.address || opts.suburb || opts.region) lines.push(`Address: ${opts.address ?? ''}${opts.suburb ? ', ' + opts.suburb : ''}${opts.region ? ', ' + opts.region : ''}`);
      if (kind === 'rent') {
        if (opts.weeklyRent) lines.push(`Weekly Rent: ${opts.weeklyRent}`);
        if (opts.monthlyRent) lines.push(`Monthly Rent: ${opts.monthlyRent}`);
        if (opts.bond) lines.push(`Bond: ${opts.bond}`);
      } else {
        if (opts.askingPrice || opts.price) lines.push(`Asking Price: ${opts.askingPrice ?? opts.price}`);
      }
      if (opts.bedrooms) lines.push(`Beds: ${opts.bedrooms}`);
      if (opts.bathrooms) lines.push(`Baths: ${opts.bathrooms}`);
      if (opts.sqft) lines.push(`Sqft: ${opts.sqft}`);
      if (opts.yearBuilt) lines.push(`Year Built: ${opts.yearBuilt}`);
      if (opts.propertyType) lines.push(`Property Type: ${opts.propertyType}`);
      if (opts.lotSize) lines.push(`Lot Size: ${opts.lotSize}`);
      if (kind === 'sale') {
        if (opts.taxAnnual || opts.annualTaxAmount) lines.push(`Tax / Year: ${opts.taxAnnual ?? opts.annualTaxAmount}`);
        if (opts.pricePerSqft) lines.push(`Price per Sqft: ${opts.pricePerSqft}`);
        if (opts.zestimate) lines.push(`Zestimate: ${opts.zestimate}`);
        if (opts.rentZestimate) lines.push(`Rent Zestimate: ${opts.rentZestimate}/mo`);
        if (opts.estimatedMonthlyPayment) lines.push(`Estimated Monthly Payment: ${opts.estimatedMonthlyPayment}`);
        if (opts.hoaFee || opts.hoa) lines.push(`HOA: ${opts.hoaFee ?? opts.hoa}`);
      }
      if (opts.sourceDomain) lines.push(`Source: ${opts.sourceDomain}`);
      lines.push('');

      if (desc) {
        lines.push('--- Description ---');
        lines.push(desc);
        lines.push('');
      }
      if (factsArr.length > 0) {
        lines.push('--- Facts & Features (max 30) ---');
        for (const f of factsArr) {
          if (f && typeof f === 'object') {
            const o = f as Record<string, unknown>;
            const k = o.label ?? o.key ?? '';
            const v = o.value ?? '';
            if (k || v) lines.push(`- ${k}: ${v}`);
          } else if (f) {
            lines.push(`- ${f}`);
          }
        }
        lines.push('');
      }
      if (highlightsArr.length > 0) {
        lines.push('--- Listing Highlights (max 10) ---');
        for (const h of highlightsArr) lines.push(`- ${typeof h === 'string' ? h : (h as any)?.text ?? ''}`);
        lines.push('');
      }

      return lines.join('\n');
    };

    const userPrompt = reportMode === 'rent'
      ? (detectedMarket === 'US' || detectedMarket === 'UNKNOWN'
          ? buildUsUserPrompt('rent')
          : `Analyze this rental property listing. Return JSON with ONLY these fields (remove all others):
{
  "bottom_line": "one specific sentence about what this listing shows and what still needs verification",
  "listing_claims": [{ "phrase": "exact listing text", "check": "what HomeScope can or cannot verify", "ask": "one question to ask before viewing" }],
  "questions_to_ask": [{ "category": "Legal" | "Costs" | "Condition" | "Price" | "General", "question": "specific question text" }],
  "upsell_cta": { "title": "Unlock Full Analysis", "body": "Basic shows what the listing says and what still needs verification. Full Analysis goes deeper into photos, price confidence, legal and maintenance risks, carrying-cost assumptions, and whether this property is actually worth viewing.", "button": "Unlock Full Analysis" }
}

Only output the JSON. No other text.
Listing: ${description}
${optionalDetails.weeklyRent ? `Weekly Rent: ${optionalDetails.weeklyRent}\n` : ''}${optionalDetails.suburb ? `Location: ${optionalDetails.suburb}\n` : ''}${optionalDetails.bedrooms ? `Bedrooms: ${optionalDetails.bedrooms}\n` : ''}${optionalDetails.bathrooms ? `Bathrooms: ${optionalDetails.bathrooms}\n` : ''}`)
      : (detectedMarket === 'US' || detectedMarket === 'UNKNOWN'
          ? buildUsUserPrompt('sale')
          : `Analyze this property for sale. Return JSON with ONLY these fields (remove all others):
{
  "bottom_line": "one specific sentence about what this listing shows and what still needs verification",
  "listing_claims": [{ "phrase": "exact listing text", "check": "what HomeScope can or cannot verify", "ask": "one question to ask before viewing" }],
  "questions_to_ask": [{ "category": "Legal" | "Costs" | "Condition" | "Price" | "General", "question": "specific question text" }],
  "upsell_cta": { "title": "Unlock Full Analysis", "body": "Basic shows what the listing says and what still needs verification. Full Analysis goes deeper into photos, price confidence, legal and maintenance risks, carrying-cost assumptions, and whether this property is actually worth viewing.", "button": "Unlock Full Analysis" }
}

Only output the JSON. No other text.
Listing: ${description}
${optionalDetails.askingPrice ? `Asking Price: ${optionalDetails.askingPrice}\n` : ''}${optionalDetails.suburb ? `Location: ${optionalDetails.suburb}\n` : ''}${optionalDetails.bedrooms ? `Bedrooms: ${optionalDetails.bedrooms}\n` : ''}${optionalDetails.bathrooms ? `Bathrooms: ${optionalDetails.bathrooms}\n` : ''}`);

    console.log("[DIAG] market routing — basic-sync:", {
      action: "basic-sync",
      source: bodySource,
      sourceDomain: bodySourceDomain,
      market: bodyMarket,
      listingUrl: bodyListingUrl,
      reportMode,
      detectedMarket,
      selectedPromptName: basicPromptName,
    });

    // Try to get current user (optional - basic analysis works without auth)
    const { user, error: authError } = await getCurrentUser(req);
    let analysisId: string | null = null;

    if (user) {
      console.log("Basic sync: User logged in, will create history record for:", user.email);
      const newAnalysisId = crypto.randomUUID();
      const createResult = await createAnalysisRecord(
        newAnalysisId,
        user.id,
        [], // No images for basic analysis
        description,
        optionalDetails,
        reportMode,
        bodySource,
        bodySourceDomain,
      );

      if (createResult.success) {
        analysisId = newAnalysisId;
        console.log("Basic sync: History record created with ID:", analysisId);
      } else {
        console.error("Basic sync: Failed to create history record:", createResult.error);
      }
    } else {
      console.log("Basic sync: Anonymous user, no history record will be created");
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
          "X-Title": "HomeScope Basic Analysis",
        },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Basic sync AI error:", errorText);
        return jsonResponse({ message: "Analysis service error" }, 500);
      }

      const aiResult = await response.json();
      const content = aiResult.choices?.[0]?.message?.content || "{}";

      // Parse AI response
      let result;
      try {
        // Try to extract JSON from response (handle potential markdown code blocks)
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
        const jsonStr = jsonMatch ? jsonMatch[1] : content;
        result = JSON.parse(jsonStr);

        // Backward compatibility: map old schema fields
        if (result.score !== undefined && result.overallScore === undefined) {
          result.overallScore = result.score;
        }
        if (result.quickSummary !== undefined && result.bottom_line === undefined) {
          result.bottom_line = result.quickSummary;
        }
        if (result.verdict && !result.evidence_score) {
          const verdictScoreMap: Record<string, number> = {
            'Strong Buy': 75, 'Consider Carefully': 45, 'Probably Skip': 25,
          };
          result.evidence_score = verdictScoreMap[result.verdict] ?? result.overallScore ?? 50;
        }
      } catch (parseErr) {
        console.error("Failed to parse AI response:", parseErr);
        result = {
          bottom_line: "Unable to fully analyse listing from available data.",
          listing_signals: [],
          whats_missing: [],
          top_3_things_to_check: [],
          questions_to_ask: [],
          upsell_cta: {
            title: "Unlock Full Analysis",
            body: "Basic shows what this listing reveals and what still needs asking. Full Analysis adds condition risk analysis, price confidence verdict, carrying-cost breakdown, and whether this property fits your buyer profile.",
          },
          evidence_score: 30,
          verdict: "High Uncertainty",
          what_we_know: {},
          overallScore: 30,
          quickSummary: "Unable to fully analyse listing from available data.",
          whatLooksGood: [],
          riskSignals: ["Analysis could not be completed"],
        };
      }

      // Backend enforcement: compute evidence_score from actual field completeness
      // Basic 模式只基于 listing 中实际可获得的字段，不对无法验证的字段扣分
      {
        const opts = optionalDetails as Record<string, unknown>;

        const hasPrice = !!(opts.askingPrice || opts.weeklyRent);
        const hasBeds = !!(opts.bedrooms);
        const hasBaths = !!(opts.bathrooms);
        const hasSqft = !!(opts.sqft);
        const hasSource = !!(result.sourceDomain || result.listingUrl || opts.sourceDomain || opts.listingUrl);
        // propertyType is often null for Zillow房源 — do not penalize for it
        const hasCostDetails = !!(opts.hoaFee || opts.propertyTax || opts.annualTaxAmount);
        // rich listing data: factsAndFeatures presence indicates above-average listing quality
        const hasRichListingData = Array.isArray(opts.factsAndFeatures) && (opts.factsAndFeatures as unknown[]).length >= 3;

        const presentCount = [hasPrice, hasBeds, hasBaths, hasSqft, hasSource, hasCostDetails].filter(Boolean).length;

        // Score mapping (max 79 — preserve 80+ for Full reports):
        //   1–2 fields: 40     |  3–4 fields: 55     |  5 fields: 68
        //   6 fields: 73         |  6 + rich data: 79
        let baseScore = 40;
        if (presentCount >= 6) baseScore = 73;
        else if (presentCount === 5) baseScore = 68;
        else if (presentCount >= 3) baseScore = 55;

        const bonusScore = (presentCount >= 6 && hasRichListingData) ? 6 : 0;

        result.evidence_score = Math.min(baseScore + bonusScore, 79);
        result.overallScore = result.evidence_score;
      }

      // Backend enforcement: verdict is determined EXCLUSIVELY by evidence_score
      // Never trust AI's verdict — always recompute from score
      {
        const score = result.evidence_score as number;
        if (score >= 80) result.verdict = 'Enough to Review';
        else if (score >= 60) result.verdict = 'Review With Caution';
        else if (score >= 40) result.verdict = 'Need More Evidence';
        else result.verdict = 'High Uncertainty';
      }

      // Step 0: Enforce what_we_know from optionalDetails as source of truth.
      // The AI's what_we_know may have null values or wrong field names,
      // but optionalDetails contains the actual extracted structured data.
      {
        const opts = optionalDetails as Record<string, unknown>;
        const wwKnow = result.what_we_know ?? {};

        const setIfMissing = (wwKey: string, value: unknown) => {
          if (!(wwKey in wwKnow) || wwKnow[wwKey] == null || wwKnow[wwKey] === '') {
            (wwKnow as any)[wwKey] = value ?? null;
          }
        };

        setIfMissing('sqft', opts.sqft ?? opts.squareFeet ?? opts.floorArea);
        setIfMissing('beds', opts.bedrooms ?? opts.beds);
        setIfMissing('baths', opts.bathrooms ?? opts.baths);
        setIfMissing('property_type', opts.propertyType ?? opts.property_type);
        setIfMissing('asking_price', opts.askingPrice ?? opts.price);

        result.what_we_know = wwKnow;
      }

      // ── BEFORE: diagnostic log ──────────────────────────────────────────────
      console.log('[Basic cleanup BEFORE]', {
        bottom_line: result.bottom_line,
        whats_missing: result.whats_missing,
        top_3_things_to_check: result.top_3_things_to_check,
        questions_to_ask: result.questions_to_ask,
        upsell_cta: result.upsell_cta,
      });

      // Set market on result so normalize helpers can reference it
      result.market = detectedMarket;

      const hasZillowMonthly = !!(zillowFinancials && ((zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.value || (zillowFinancials as any)?.topEstimatedPayment?.value));

      // Cleanup: enforce counts and shape for the US Basic schema.
      const opts = optionalDetails as Record<string, unknown>;
      result = normalizeWhatsMissing(result, opts, profile);
      result = normalizeTop3Checks(result, opts, profile);
      result = normalizeBasicQuestions(result, hasZillowMonthly, profile);
      // ── POST-LLM GUARDRAIL: validate report against profile ───────────────────────
      // Remove wrong-type risks that slipped through, supplement from type-specific pool if needed
      result = validateBasicReportAgainstProfile(result, profile, opts);
      // ── Category-aware final guard: strip multi-family content for structured single_family ──
      // Must run AFTER normalizeBottomLine so it cleans up bottom_line after the rewrite.
      // Must run BEFORE _analysisProfile is attached so diagnostics are clean.
      result = applySingleFamilyFinalGuard(result, profile, opts);
      (result as any)._analysisProfile = profile;
      // ── Bottom line normalization runs AFTER guard so guard can fix bottom_line first ──
      result = normalizeBottomLine(result, opts, profile);
      // Guard must run again AFTER bottom_line rewrite to strip any re-injected multi-family content
      result = applySingleFamilyFinalGuard(result, profile, opts);

      // ── AFTER: diagnostic log ──────────────────────────────────────────────────────
      console.log('[Basic cleanup AFTER]', {
        bottom_line: result.bottom_line,
        whats_missing: result.whats_missing,
        top_3_things_to_check: result.top_3_things_to_check,
        questions_to_ask: result.questions_to_ask,
        upsell_cta: result.upsell_cta,
      });

      console.log("=== BASIC SYNC SUCCESS ===");
      console.log("Evidence Score:", result.evidence_score);
      console.log("Verdict:", result.verdict);
      console.log("Bottom Line:", result.bottom_line);
      console.log("Analysis ID:", analysisId);

      // Build property_snapshot from optionalDetails (needed for both DB save and API response)
      const property_snapshot = {
        beds: (optionalDetails as Record<string, unknown>)?.bedrooms ?? null,
        baths: (optionalDetails as Record<string, unknown>)?.bathrooms ?? null,
        sqft: (optionalDetails as Record<string, unknown>)?.sqft ?? null,
        lot_size: (optionalDetails as Record<string, unknown>)?.lotSize ?? null,
        year_built: (optionalDetails as Record<string, unknown>)?.yearBuilt ?? null,
        home_type: String((optionalDetails as Record<string, unknown>)?.propertyType ?? ''),
        property_subtype: String((optionalDetails as Record<string, unknown>)?.propertySubtype ?? ''),
        architectural_style: String((optionalDetails as Record<string, unknown>)?.architecturalStyle ?? ''),
        stories: (optionalDetails as Record<string, unknown>)?.stories ?? null,
        parking: String((optionalDetails as Record<string, unknown>)?.parking ?? ''),
        hoa: String((optionalDetails as Record<string, unknown>)?.hoaFee ?? ''),
        annual_tax: (optionalDetails as Record<string, unknown>)?.annualTaxAmount
          ?? parsePriceToNumber((optionalDetails as Record<string, unknown>)?.annualTax ?? (optionalDetails as Record<string, unknown>)?.propertyTax) ?? null,
        annual_tax_display: (optionalDetails as Record<string, unknown>)?.propertyTax as string | null ?? null,
        tax_assessed_value: (optionalDetails as Record<string, unknown>)?.taxAssessedValueAmount
          ?? parsePriceToNumber((optionalDetails as Record<string, unknown>)?.taxAssessedValue) ?? null,
        tax_assessed_value_display: typeof (optionalDetails as Record<string, unknown>)?.taxAssessedValue === 'string'
          ? (optionalDetails as Record<string, unknown>)?.taxAssessedValue as string : null,
        price_per_sqft: (optionalDetails as Record<string, unknown>)?.pricePerSqftAmount
          ?? parsePriceToNumber((optionalDetails as Record<string, unknown>)?.pricePerSqft) ?? null,
        price_per_sqft_display: typeof (optionalDetails as Record<string, unknown>)?.pricePerSqft === 'string'
          ? (optionalDetails as Record<string, unknown>)?.pricePerSqft as string : null,
        date_listed: (optionalDetails as Record<string, unknown>)?.dateListed as string | null ?? null,
        available_date: (optionalDetails as Record<string, unknown>)?.availableDate as string | null ?? null,
        roof: String((optionalDetails as Record<string, unknown>)?.roof ?? ''),
        materials: String((optionalDetails as Record<string, unknown>)?.constructionMaterial ?? ''),
        heating: String((optionalDetails as Record<string, unknown>)?.heating ?? ''),
        basement: String((optionalDetails as Record<string, unknown>)?.basement ?? ''),
        fireplace: String((optionalDetails as Record<string, unknown>)?.fireplace ?? ''),
        region: (() => {
          const rawRegion = String((optionalDetails as Record<string, unknown>)?.region ?? (optionalDetails as Record<string, unknown>)?.suburb ?? '');
          // Skip if region looks like a full street address (same guard as frontend usSale.ts line 410-414)
          const isFullAddress = /^\d+\s+[A-Za-z].*,.*[A-Z]{2}\s*\d{5}/.test(rawRegion)
            || /^\d+\s+[A-Za-z][A-Za-z\s]*\s*(avenue|street|ave|st|road|rd|drive|dr|place|pl|boulevard|blvd|terrace|ter|court|ct|lane|ln)\b/i.test(rawRegion);
          return isFullAddress ? '' : rawRegion;
        })(),
      };

      // Build Zillow monthly cost snapshot
      const monthly_cost_snapshot = zillowFinancials
        ? {
            source: 'Zillow/listing estimate',
            estimated_monthly_payment: (zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.value ?? null,
            principal_and_interest: (zillowFinancials as any)?.monthlyPayment?.principalAndInterest?.value ?? null,
            mortgage_insurance: (zillowFinancials as any)?.monthlyPayment?.mortgageInsurance?.value ?? null,
            property_taxes: (zillowFinancials as any)?.monthlyPayment?.propertyTaxes?.value ?? null,
            home_insurance: (zillowFinancials as any)?.monthlyPayment?.homeInsurance?.value ?? null,
            hoa_fees: (zillowFinancials as any)?.monthlyPayment?.hoaFees?.value ?? null,
            utilities: (zillowFinancials as any)?.monthlyPayment?.utilities?.value ?? null,
            disclaimer: 'Based on Zillow listing estimate only. Not independently verified by HomeScope.',
          }
        : null;

      // If we have an analysisId, update the record with the FULL result
      // (what_we_know, listing_claims, questions_to_ask, monthly_cost_snapshot etc.
      // are needed for history playback via NewReportUI.)
      if (analysisId) {
        await updateAnalysisRecord(
          analysisId,
          result.evidence_score ?? result.overallScore ?? 50,
          result.verdict,
          {
            quickSummary: result.bottom_line ?? result.quickSummary,
            whatLooksGood: result.whatLooksGood || [],
            riskSignals: result.riskSignals || [],
          },
          {
            analysisType: 'basic',
            overallScore: result.evidence_score ?? result.overallScore ?? 50,
            verdict: result.verdict,
            quickSummary: result.bottom_line ?? result.quickSummary,
            whatLooksGood: result.whatLooksGood || [],
            riskSignals: result.riskSignals || [],
            reportMode,
            market: detectedMarket,
            source: bodySource || null,
            sourceDomain: bodySourceDomain || null,
            listingUrl: bodyListingUrl || null,
            optionalDetails,
            property_snapshot,
            monthly_cost_snapshot,
            // These fields are needed for NewReportUI sections (US Basic v2):
            what_we_know: result.what_we_know ?? {},
            whats_missing: (result.whats_missing ?? []).slice(0, 6),
            top_3_things_to_check: (result.top_3_things_to_check ?? []).slice(0, 4),
            questions_to_ask: (result.questions_to_ask ?? []).slice(0, 6),
            upsell_cta: result.upsell_cta ?? {},
          },
          reportMode
        );
        console.log("Basic sync: History record updated with full result");
      }

      console.log("[BasicSync] About to send response", {
        analysisId,
        evidenceScore: result?.evidence_score,
        verdict: result?.verdict,
      });

      console.log("[BasicSync] Response payload ready");

      return jsonResponse({
        result: {
          // New evidence_score schema fields (US Basic v2)
          evidence_score: result.evidence_score ?? result.overallScore ?? 50,
          verdict: result.verdict,
          bottom_line: result.bottom_line ?? result.quickSummary ?? '',
          what_we_know: result.what_we_know ?? {},
          whats_missing: (result.whats_missing ?? []).slice(0, 6),
          top_3_things_to_check: (result.top_3_things_to_check ?? []).slice(0, 4),
          questions_to_ask: (result.questions_to_ask ?? []).slice(0, 6),
          listing_signals: Array.isArray(result.listing_signals) ? result.listing_signals : [],
          upsell_cta: result.upsell_cta ?? {},
          // Legacy fields for backward compatibility
          overallScore: result.evidence_score ?? result.overallScore ?? result.score ?? 50,
          quickSummary: result.bottom_line ?? result.quickSummary ?? '',
          whatLooksGood: result.whatLooksGood ?? [],
          riskSignals: (() => {
            const ERROR_SIGNAL_PATTERNS = [
              /^analysis could not be completed$/i,
              /^unable to (fully )?analyse/i,
              /^unable to (fully )?analyze/i,
              /^not enough data$/i,
            ];
            return (result.riskSignals ?? []).filter(
              (s: string) => !ERROR_SIGNAL_PATTERNS.some(p => p.test(String(s ?? '')))
            );
          })(),
          reportMode,
          market: detectedMarket,
          source: bodySource || null,
          sourceDomain: bodySourceDomain || null,
          listingUrl: bodyListingUrl || null,
          optionalDetails,
          property_snapshot,
          monthly_cost_snapshot,
        },
        analysisId, // Will be null for anonymous users, actual ID for logged-in users
      });
    } catch (err) {
      console.error("Basic sync error:", err);
      return jsonResponse({ message: "Analysis failed: " + (err instanceof Error ? err.message : "Unknown error") }, 500);
    }
  }

  // ========== 权限检查 ==========
  // 只对 submit 和 run action 进行权限检查
  let user: UserProfile | null = null;
  if (resolvedAction === "submit" || resolvedAction === "run" || !resolvedAction) {
    const result = await getCurrentUser(req);
    user = result.user;
    const authError = result.error;
    const authCode = result.code;

    console.log("=== Backend Permission Check ===");
    console.log("User:", user ? `${user.email} (${user.id})` : "NOT_AUTHENTICATED");
    console.log("Credits remaining:", user?.credits_remaining ?? "N/A");
    console.log("Credits reserved:", user?.credits_reserved ?? "N/A");
    console.log("Available credits:", (user ? user.credits_remaining - user.credits_reserved : 0));
    console.log("authCode:", authCode);

    if (authError || !user) {
      console.log("analyze blocked reason: NOT_AUTHENTICATED");
      return jsonResponse({ message: "Please sign in first to analyze listings.", code: "SUBMIT_AUTH_FAILED", reason: authError, authCode }, 401);
    }

    if (!hasAvailableCredits(user)) {
      console.log("analyze blocked reason: NO_AVAILABLE_CREDITS");
      return jsonResponse({ message: "No free analyses left. Please purchase more credits to continue.", code: "NO_CREDITS" }, 403);
    }

    console.log("analyze allowed: proceeding with analysis");
  }

  // ACTION: submit (create new analysis task)
  if (resolvedAction === "submit" || !resolvedAction) {
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(isValidHttpUrl) : [];
    const description = typeof body.description === "string" ? body.description : "";
    const reportMode: ReportMode = body.reportMode === 'sale' ? 'sale' : 'rent';

    // ── Market / Source resolution ───────────────────────────────────────────
    const rawSource = body.source ?? body.sourceDomain ??
      (body.optionalDetails?.source as string | undefined) ?? null;
    const resolvedSourceDomain = body.sourceDomain ??
      (typeof body.source === 'string' && body.source.includes('.') ? body.source : null) ??
      (body.optionalDetails?.sourceDomain as string | undefined) ?? null;
    const rawMarket = (body as Record<string, unknown>).market as string | null ?? null;
    const rawListingUrl = (body as Record<string, unknown>).listingUrl as string | null ?? null;

    const detectedMarket = detectMarket({
      source: rawSource,
      sourceDomain: resolvedSourceDomain,
      market: rawMarket,
      listingUrl: rawListingUrl,
      description,
      optionalDetails: body.optionalDetails,
    });

    console.log("[DIAG] backend market routing — submit:", {
      action: "submit",
      body_source: body.source,
      body_sourceDomain: body.sourceDomain,
      body_market: rawMarket,
      body_listingUrl: rawListingUrl,
      optional_source: (body.optionalDetails as Record<string, unknown>)?.source as string | null,
      optional_sourceDomain: (body.optionalDetails as Record<string, unknown>)?.sourceDomain as string | null,
      optional_market: (body.optionalDetails as Record<string, unknown>)?.market as string | null,
      optional_listingUrl: (body.optionalDetails as Record<string, unknown>)?.listingUrl as string | null,
      resolvedSource: rawSource,
      resolvedSourceDomain,
      final_market: detectedMarket,
      reportMode,
    });

    if (imageUrls.length === 0 && !description.trim()) {
      return jsonResponse({ message: "Please provide images or description" }, 400);
    }

    const analysisId = crypto.randomUUID();
    await createAnalysisState(analysisId);

    // Create analysis record in analyses table
    // MUST succeed before returning - this is critical for history to work
    if (user) {
      const createResult = await createAnalysisRecord(
        analysisId,
        user.id,
        imageUrls,
        description,
        body.optionalDetails,
        reportMode,
        rawSource,
        resolvedSourceDomain,
      );
      
      if (!createResult.success) {
        console.error("CRITICAL: Failed to create analysis record in submit action:", createResult.error);
        // Return error so client knows the submit failed
        return jsonResponse({ 
          message: "Failed to create analysis record", 
          code: "CREATE_FAILED",
          error: createResult.error 
        }, 500);
      }
      
      console.log("=== submit: analysis record created successfully ===");
    } else {
      console.error("CRITICAL: user is null in submit action - should have been caught by permission check");
      return jsonResponse({ message: "User not authenticated", code: "NOT_AUTHENTICATED" }, 401);
    }

    console.log("\n=== Rental Property Analyzer start ===");
    console.log("Image URLs provided:", imageUrls.length);
    console.log("Description provided:", !!description.trim());
    console.log("Analysis ID:", analysisId);

    return jsonResponse({ id: analysisId, status: "queued" }, 202);
  }

  // ACTION: run (execute analysis)
  if (resolvedAction === "run") {
    console.log("=== RUN ACTION START ===");
    console.log("Request body:", JSON.stringify(body));
    
    const id = body.id;
    if (!id) {
      console.error("Missing id in run action - body:", JSON.stringify(body));
      return jsonResponse({ message: "Missing id for run action" }, 400);
    }

    console.log("Analysis ID for run:", id);

    // Get user for credits operation (user was already validated in permission check)
    const { user: currentUser, error: userError, code: runAuthCode } = await getCurrentUser(req);
    if (userError || !currentUser) {
      return jsonResponse({ message: "Authentication required", code: "RUN_AUTH_FAILED", reason: userError, authCode: runAuthCode }, 401);
    }

    // Pre-reserve credit before starting analysis (atomic operation)
    const reserveResult = await reserveCredits(currentUser.id, id);
    if (!reserveResult.success) {
      console.log("Failed to reserve credits:", reserveResult.error);
      
      // Distinguish error types for proper HTTP status
      const errorCode = reserveResult.error;
      let httpStatus = 500; // Default to 500 (server error) for unknown issues
      let clientMessage = "Failed to process request";
      
      if (errorCode === "No credits available") {
        httpStatus = 403;
        clientMessage = "No free analyses left. Please purchase more credits to continue.";
      } else if (errorCode === "User not found") {
        httpStatus = 404;
        clientMessage = "User account not found";
      } else if (errorCode === "Permission denied") {
        httpStatus = 403;
        clientMessage = "Permission denied";
      } else if (errorCode?.includes("Failed to check") || errorCode?.includes("Invalid response")) {
        httpStatus = 500;
        clientMessage = "Server error: database connection failed";
      }
      
      return jsonResponse({ 
        message: clientMessage, 
        code: errorCode 
      }, httpStatus);
    }

    const usageId = reserveResult.usageId;
    console.log("=== Credits reserved, starting analysis ===");
    console.log("User ID:", currentUser.id);
    console.log("Analysis ID:", id);
    console.log("Usage Record ID:", usageId);

    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(isValidHttpUrl) : [];
    const description = typeof body.description === "string" ? body.description : "";
    const optionalDetails = body.optionalDetails ?? {};
    const reportMode: ReportMode = body.reportMode === 'sale' ? 'sale' : 'rent';

    // Multi-source fallback: body > listingData > optionalDetails
    const rawZf = ((body as any)?.zillowFinancials)
      || ((body as any)?.listingData?.zillowFinancials)
      || ((optionalDetails as any)?.zillowFinancials)
      || null;
    const zillowFinancials = rawZf || null;

    console.log('[analyze] zillowFinancials resolved', {
      fromBody: !!((body as any)?.zillowFinancials),
      fromListingData: !!((body as any)?.listingData?.zillowFinancials),
      fromOptionalDetails: !!((optionalDetails as any)?.zillowFinancials),
      topEstimate: (zillowFinancials as any)?.topEstimatedPayment?.value,
      estimatedMonthlyPayment: (zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.value,
      principalAndInterest: (zillowFinancials as any)?.monthlyPayment?.principalAndInterest?.value,
      propertyTaxes: (zillowFinancials as any)?.monthlyPayment?.propertyTaxes?.value,
      homeInsurance: (zillowFinancials as any)?.monthlyPayment?.homeInsurance?.value,
      annualTaxAmount: (zillowFinancials as any)?.financialDetails?.annualTaxAmount?.value,
    });

    // ── Market / Source resolution ─────────────────────────────────────────
    // Priority: body > analysis record (DB) > optionalDetails > URL fallback
    let source = body.source || body.sourceDomain ||
      (optionalDetails?.source as string | undefined) || null;
    let sourceDomain = body.sourceDomain || null;

    // Fetch source from analysis record if not provided in body
    if (!source || !sourceDomain) {
      try {
        const recordRes = await fetch(
          `${LOCAL_URL}/rest/v1/analyses?id=eq.${id}&select=source,source_domain`,
          {
            headers: {
              "apikey": LOCAL_SERVICE_KEY,
              "Authorization": `Bearer ${LOCAL_SERVICE_KEY}`,
            },
          },
        );
        if (recordRes.ok) {
          const records = await recordRes.json();
          if (records && records.length > 0) {
            source = source || records[0].source || null;
            sourceDomain = sourceDomain || records[0].source_domain || null;
          }
        }
      } catch (e) {
        console.error("[DIAG] run: failed to fetch analysis record for source:", e);
      }
    }

    // ── Unified market detection (shared by all actions) ──────────────────────────────────
    const detectedMarket = detectMarket({
      source,
      sourceDomain,
      market: null,
      listingUrl: (body as Record<string, unknown>).listingUrl as string | null
        ?? (optionalDetails as Record<string, unknown>).listingUrl as string | null
        ?? null,
      description,
      optionalDetails,
    });

    console.log("[DIAG] backend market routing — run:", {
      body_source: body.source,
      body_sourceDomain: body.sourceDomain,
      body_market: (body as Record<string, unknown>).market as string | null,
      body_listingUrl: (body as Record<string, unknown>).listingUrl as string | null,
      optional_source: (optionalDetails as Record<string, unknown>).source as string | null,
      optional_sourceDomain: (optionalDetails as Record<string, unknown>).sourceDomain as string | null,
      optional_market: (optionalDetails as Record<string, unknown>).market as string | null,
      optional_listingUrl: (optionalDetails as Record<string, unknown>).listingUrl as string | null,
      final_market: detectedMarket,
      reportMode,
    });

    const selectedPromptName = detectedMarket === 'US'
      ? (reportMode === 'sale' ? 'STEP2_US_SALE_PROMPT' : 'STEP2_US_RENT_PROMPT')
      : detectedMarket === 'AU'
      ? (reportMode === 'sale' ? 'STEP2_SALE_PROMPT' : 'STEP2_RENT_PROMPT')
      : (reportMode === 'sale' ? 'STEP2_US_SALE_PROMPT (UNKNOWN→US)' : 'STEP2_US_RENT_PROMPT (UNKNOWN→US)');

    console.log("[DIAG] market routing — run action:", {
      action: "run",
      body_source: body.source,
      body_sourceDomain: body.sourceDomain,
      body_market: (body as Record<string, unknown>).market as string | null,
      body_listingUrl: (body as Record<string, unknown>).listingUrl as string | null,
      optionalSource: (optionalDetails as Record<string, unknown>).source as string | null,
      resolvedSource: source,
      resolvedSourceDomain: sourceDomain,
      reportMode,
      final_market: detectedMarket,
      selectedPromptName,
    });

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      // Analysis failed - release credits
      await releaseCredits(currentUser.id, usageId);
      await updateAnalysisState(id, {
        stage: "failed",
        message: "OPENROUTER_API_KEY not configured",
        progress: 100,
        status: "failed",
        error: "Server configuration error",
      });
      return jsonResponse({ message: "Server configuration error" }, 500);
    }

    console.log("\n=== Rental Property Analyzer start ===");
    console.log("Analysis ID:", id);
    console.log("Image URLs provided:", imageUrls.length);
    console.log("Description provided:", !!description.trim());

    // Initial state update to processing
    await updateAnalysisState(id, {
      stage: "detecting_rooms",
      message: "Analyzing property photos...",
      progress: 15,
      status: "processing",
    });

    try {
      let visualAnalysis: Record<string, unknown> | null = null;

      // ── Reality Check: 5-level priority for listing description ─────────────
      // Priority: whatsSpecialText > listingDescription > whatSpecial
      // Falls back to stripMlsFromDescription(description) only if all are empty.
      // If the text is only MLS/IDX/disclaimer noise, skip Reality Check entirely.
      console.log("\n[Reality Check] Building input with 5-level priority...");
      const odSpin = optionalDetails as Record<string, unknown>;
      const spinDesc = [
        odSpin?.whatsSpecialText as string | undefined,
        odSpin?.listingDescription as string | undefined,
        odSpin?.whatSpecial as string | undefined,
      ].find(v => typeof v === 'string' && v.trim().length > 20);
      const spinText = spinDesc
        ? stripMlsFromDescription(spinDesc)
        : (description.trim() ? stripMlsFromDescription(description) : '');
      // === LAYER 5 ===
      const candidates = [
        { name: 'whatsSpecialText', text: odSpin?.whatsSpecialText as string | undefined },
        { name: 'listingDescription', text: odSpin?.listingDescription as string | undefined },
        { name: 'whatSpecial', text: odSpin?.whatSpecial as string | undefined },
        { name: 'description (fallback)', text: description },
      ];
      candidates.forEach(c => {
        const len = (c.text || '').length;
        const preview = (c.text || '').slice(0, 120).replace(/\n/g, ' ');
        console.log(`[Reality Check] candidate[${c.name}]: length=${len}, preview="${preview}"`);
      });
      console.log("[Reality Check] selected spinDesc length:", (spinDesc || '').length, "| preview:", (spinDesc || '').slice(0, 120).replace(/\n/g, ' '));
      console.log("[Reality Check] stripMlsFromDescription result length:", spinText.length, "| preview:", spinText.slice(0, 120).replace(/\n/g, ' '));
      const hasMlsNoise = !spinText || /^(source\s*:\s*|mls\s*#?\s*\d|internet\s+data\s+exchange|idx\s+program|deemed\s+reliable|as\s+distributed\s+by|listing\s+provided\s+by|report\s+a\s+problem)/i.test(spinText);
      console.log("[Reality Check] spinText sample:", spinText?.slice(0, 300));
      console.log("[Reality Check] hasMlsNoise:", hasMlsNoise);
      let realityCheckPromise: Promise<RealityCheck> = Promise.resolve({ should_display: false });
      if (spinText && !hasMlsNoise) {
        console.log("[Reality Check] Input source:", spinDesc ? 'whatsSpecialText/listingDescription/whatSpecial' : 'description (fallback)');
        console.log("[Reality Check] Input length:", spinText.length);
        realityCheckPromise = runRealityCheck(openRouterApiKey, spinText, "").catch((rcError) => {
          console.error("[RealityCheck] Failed:", rcError);
          return { should_display: false };
        });
      } else {
        console.log("[Reality Check] Skipped: no meaningful listing text after MLS filtering");
      }

      // Step 1: Visual analysis (batched for stability)
      if (imageUrls.length > 0) {
        console.log("\n[Step 1] Visual analysis start (batched)");
        
        const MAX_BATCHES = 2; // 最多 2 批 = 40 张图片
        const BATCH_SIZE = 20;
        const numBatches = Math.min(Math.ceil(imageUrls.length / BATCH_SIZE), MAX_BATCHES);
        
        const batchResults: Array<Record<string, unknown>> = [];
        let batchSuccessCount = 0;

        for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
          console.log(`[Step 1 Batch ${batchIndex + 1}/${numBatches}] Processing...`);
          
          const { messages, photoIndexOffset } = buildStep1Messages(imageUrls, batchIndex);

          const step1RequestBody = {
            model: "google/gemini-2.5-flash",
            messages: messages,
            temperature: 0.1,
            max_tokens: 4000, // 稍微提高以适应更多输出
          };

          try {
            const step1Response = await fetch(
              "https://openrouter.ai/api/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${openRouterApiKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": "https://trteewgplkqiedonomzg.supabase.co",
                  "X-Title": "Rental Property Analyzer",
                },
                body: JSON.stringify(step1RequestBody),
              },
            );

            if (!step1Response.ok) {
              const errorData = await step1Response.json().catch(() => ({}));
              console.error(`[Step 1 Batch ${batchIndex + 1}] Error Response:`, JSON.stringify(errorData));
              // 继续下一批，不抛出异常
              continue;
            }

            const step1Data = await step1Response.json();
            const step1Content = step1Data?.choices?.[0]?.message?.content;

            if (!step1Content) {
              console.warn(`[Step 1 Batch ${batchIndex + 1}] No response content`);
              continue;
            }

            try {
              const batchResult = safeParseModelJson(step1Content) as Record<string, unknown>;
              
              // Adjust photoIndex to be global
              if (Array.isArray(batchResult.photos)) {
                for (const photo of batchResult.photos) {
                  if (typeof photo.photoIndex === 'number') {
                    photo.photoIndex = photo.photoIndex + photoIndexOffset;
                  }
                }
              }
              
              batchResults.push(batchResult);
              batchSuccessCount++;
              console.log(`[Step 1 Batch ${batchIndex + 1}] Success, ${(batchResult.photos as unknown[])?.length || 0} photos analyzed`);
            } catch {
              console.warn(`[Step 1 Batch ${batchIndex + 1}] JSON parse failed, skipping batch`);
            }
          } catch (batchError) {
            console.error(`[Step 1 Batch ${batchIndex + 1}] Request failed:`, batchError);
            // 继续下一批
          }
        }

        // Merge results from all successful batches
        if (batchResults.length > 0) {
          visualAnalysis = mergeVisualAnalysis(batchResults as Parameters<typeof mergeVisualAnalysis>[0]);
          console.log(`[Step 1] Merged ${batchResults.length} batches, total photos: ${(visualAnalysis.photos as unknown[])?.length || 0}`);
        } else {
          // 所有批次都失败了
          console.warn("[Step 1] All batches failed, proceeding without visual analysis");
          visualAnalysis = null;
        }

        console.log("[Step 1] Visual analysis complete");

        // Update state after Step 1
        await updateAnalysisState(id, {
          stage: "evaluating_spaces",
          message: "Evaluating property spaces...",
          progress: 35,
        });
      } else {
        console.log("[Step 1] Skipped - no image URLs provided");
      }

      // ── Step 3: Build verifiedFacts from optionalDetails (deterministic) ─────────
      // These are extracted directly from Zillow — AI must not contradict them
      const od = optionalDetails as Record<string, unknown>;
      const financial = (od.financialDetails ?? {}) as Record<string, unknown>;

      const parseVerifiedNumberLocal = (val: unknown): number | null => {
        if (typeof val === 'number' && !isNaN(val)) return val;
        if (typeof val === 'string' && val.trim()) {
          const cleaned = val.replace(/[$,]/g, '').replace(/\/yr|\/year|\/sqft|per\s*sq\.?\s*ft/gi, '').trim();
          const n = parseInt(cleaned, 10);
          return isNaN(n) ? null : n;
        }
        return null;
      };

      const verifiedAnnualTax = parseVerifiedNumberLocal(
        financial.annualTaxAmount ?? od.annualTaxAmount ?? od.annualTax ?? od.propertyTax
      );
      const verifiedAnnualTaxDisplay = (financial.propertyTaxDisplay as string | null)
        ?? (typeof (od.propertyTax as string) === 'string' ? (od.propertyTax as string) : null)
        ?? (verifiedAnnualTax != null ? '$' + verifiedAnnualTax.toLocaleString() + '/yr' : null);

      const verifiedTaxAssessed = parseVerifiedNumberLocal(
        financial.taxAssessedValue as number | undefined
          ?? (od.taxAssessedValueAmount ?? od.taxAssessedValue)
      );
      const verifiedTaxAssessedDisplay = (financial.taxAssessedValueDisplay as string | null)
        ?? (typeof (od.taxAssessedValue as string) === 'string' ? (od.taxAssessedValue as string) : null)
        ?? (verifiedTaxAssessed != null ? '$' + verifiedTaxAssessed.toLocaleString() : null);

      const verifiedPricePerSqft = parseVerifiedNumberLocal(
        financial.pricePerSqft as number | undefined
          ?? (od.pricePerSqftAmount ?? od.pricePerSqft)
      );
      const verifiedPricePerSqftDisplay = (financial.pricePerSqftDisplay as string | null)
        ?? (typeof (od.pricePerSqft as string) === 'string' ? (od.pricePerSqft as string) : null)
        ?? (verifiedPricePerSqft != null ? '$' + verifiedPricePerSqft + '/sqft' : null);

      const verifiedDateListed = (financial.dateListed as string | null)
        ?? (od.dateListed as string | null)
        ?? null;
      const verifiedAvailableDate = (financial.availableDate as string | null)
        ?? (od.availableDate as string | null)
        ?? null;

      // ── Property-type classification for report routing ────────────────────────
      // Drives which risk modules, questions, and content templates are used.
      // Priority order: co_op first (critical), then condo, townhouse, multi_family,
      // single_family, manufactured, land, apartment, unknown.
      // IMPORTANT: Do not rely on a single raw field. Combine homeType, propertyType,
      // propertySubtype, and listingDescription text signals.
      const rawHomeType = String(od.homeType ?? od.home_type ?? '').toLowerCase();
      const rawPropertyType = String(od.propertyType ?? '').toLowerCase();
      const rawPropertySubtype = String((od as any).propertySubtype ?? '').toLowerCase();
      const descriptionText = [
        (od as any).description ?? '',
        (od as any).highlights ?? '',
        (financial as any).description ?? '',
        (od as any).factsText ?? '',
      ].join(' ').toLowerCase();
      const combinedText = [rawHomeType, rawPropertyType, rawPropertySubtype, descriptionText].join(' ');

      /**
       * Normalize US property category using multi-source signals.
       * Priority: co_op > condo > townhouse > multi_family > single_family >
       * manufactured > land > apartment > unknown
       */
      function normalizeUSPropertyCategory(input: {
        homeType?: string | null;
        propertyType?: string | null;
        propertySubtype?: string | null;
        listingDescription?: string | null;
        factsText?: string | null;
      }): string {
        const allText = [
          input.homeType ?? '',
          input.propertyType ?? '',
          input.propertySubtype ?? '',
          input.listingDescription ?? '',
          input.factsText ?? '',
        ].join(' ').toLowerCase();

        // 1. Co-op detection FIRST — must not fall through to condo/land
        if (/cooperative|stock cooperative|co-op\b|coop\b/i.test(allText)) {
          return 'co_op';
        }
        // 2. Condo
        if (/condo|condominium/i.test(allText)) {
          return 'condo';
        }
        // 3. Townhouse
        if (/townhouse|townhome|rowhouse/i.test(allText)) {
          return 'townhouse';
        }
        // 4. Multi-family — explicit type OR listing text signals
        if (/multi.family|multi.family residence|duplex|triplex|fourplex|2 family|two.family|3 family|three.family|4 family/i.test(allText)) {
          return 'multi_family';
        }
        // 5. Single-family — do NOT match just because year/price suggests it
        if (/single.family|single family residence|single family home|house\b/i.test(allText)) {
          return 'single_family';
        }
        // 6. Manufactured
        if (/manufactured|mobile home|modular/i.test(allText)) {
          return 'manufactured';
        }
        // 7. Land
        if (/\blot\b|\bland\b|vacant land/i.test(allText)) {
          return 'land';
        }
        // 8. Apartment
        if (/apartment\b/i.test(allText)) {
          return 'apartment';
        }
        // 9. Otherwise
        return 'unknown';
      }

      const normalizedPropertyCategory = normalizeUSPropertyCategory({
        homeType: (od.homeType ?? od.home_type) as string ?? null,
        propertyType: od.propertyType as string ?? null,
        propertySubtype: (od as any).propertySubtype as string ?? null,
        listingDescription: descriptionText,
        factsText: null,
      });

      // Legacy reportProfile — map normalized category to existing values for backward compat
      const LEGACY_PROFILE_MAP: Record<string, string> = {
        co_op: 'coop',
        condo: 'condo',
        single_family: 'single_family_owner_occupier',
        townhouse: 'townhouse',
        multi_family: 'multi_family',
        manufactured: 'unknown',
        land: 'land',
        apartment: 'unknown',
        unknown: 'unknown',
      };
      const reportProfile = LEGACY_PROFILE_MAP[normalizedPropertyCategory] ?? 'unknown';

      // Display type label for UI
      const DISPLAY_TYPE_MAP: Record<string, string> = {
        co_op: 'Co-op',
        condo: 'Condo',
        single_family: 'Single-family home',
        townhouse: 'Townhouse',
        multi_family: 'Multi-family home',
        manufactured: 'Manufactured home',
        land: 'Land / lot',
        apartment: 'Apartment',
        unknown: 'Not clearly disclosed',
      };
      const displayType = DISPLAY_TYPE_MAP[normalizedPropertyCategory] ?? 'Not clearly disclosed';

      console.log('[US Report] property normalization', {
        rawHomeType,
        rawPropertyType,
        rawPropertySubtype,
        normalizedPropertyCategory,
        displayType,
        reportProfile,
      });

      const verifiedFacts = buildVerifiedFactsFromPayload(body as Record<string, unknown>, optionalDetails as Record<string, unknown>, zillowFinancials);

      // ── P0-5: Annual tax anomaly guard ──────────────────────────────────────────
      // Zillow/StreetEasy pages sometimes format tax data in ways that parse to
      // wildly incorrect values (e.g. $656,604 for a $725,000 home — annual tax > 90%
      // of price). If annual_tax > 5% of price, suppress it and let the frontend
      // derive effective annual tax from monthlyPayment.propertyTaxes * 12 instead.
      const priceForTaxGuard = verifiedFacts.price ?? parseVerifiedNumberLocal(od.askingPrice ?? od.price) ?? 0;
      const isAnnualTaxSuspectedAnomaly = verifiedFacts.annualTax != null
        && priceForTaxGuard > 0
        && verifiedFacts.annualTax > priceForTaxGuard * 0.05;
      if (isAnnualTaxSuspectedAnomaly) {
        console.warn('[Analyze] suspected_parse_error: annual_tax', verifiedFacts.annualTax,
          '> 5% of price', priceForTaxGuard, '— suppressing, will use derived monthly tax');
        // Suppress so downstream code (property_snapshot, Step 6 overrides) all see null
        verifiedFacts.annualTax = null;
        verifiedFacts.annualTax_display = null;
        verifiedFacts.annual_tax = null;
        verifiedFacts.annual_tax_display = null;
      }

      console.log('[HS DEBUG][verifiedFacts]', {
        yearBuilt: verifiedFacts.yearBuilt,
        zestimate: verifiedFacts.zestimate,
        rentZestimate: verifiedFacts.rentZestimate,
        estimatedSalesRange: {
          min: verifiedFacts.estimatedSalesRangeMin,
          max: verifiedFacts.estimatedSalesRangeMax,
        },
        pricePerSqft: verifiedFacts.pricePerSqft,
        annualTax: verifiedFacts.annualTax,
        monthlyPayment: verifiedFacts.monthlyPayment,
        principalAndInterest: verifiedFacts.principalAndInterest,
        propertyTaxMonthly: verifiedFacts.propertyTaxMonthly,
        homeInsuranceMonthly: verifiedFacts.homeInsuranceMonthly,
        hoa: verifiedFacts.hoa,
        utilitiesIncluded: verifiedFacts.utilitiesIncluded,
        beds: verifiedFacts.beds,
        baths: verifiedFacts.baths,
        sqft: verifiedFacts.sqft,
        propertyType: verifiedFacts.propertyType,
        daysOnMarket: verifiedFacts.daysOnMarket,
        // show null status for key fields
        yearBuilt_null: verifiedFacts.yearBuilt == null,
        zestimate_null: verifiedFacts.zestimate == null,
        monthlyPayment_null: verifiedFacts.monthlyPayment == null,
      });

      console.log('[REPORT_FACTS_BEFORE_STEP2]', {
        askingPrice: verifiedFacts.price_display,
        priceValue: verifiedFacts.price,
        yearBuilt: verifiedFacts.yearBuilt,
        beds: verifiedFacts.beds,
        baths: verifiedFacts.baths,
        sqft: verifiedFacts.sqft,
        pricePerSqft: verifiedFacts.pricePerSqft,
        monthlyPayment: verifiedFacts.monthlyPayment,
        annualTax: verifiedFacts.annualTax,
        propertyType: verifiedFacts.propertyType,
        floodZone: (zillowFinancials as any)?.floodZone ?? (body as any)?.listingData?.floodZone ?? (optionalDetails as any)?.floodZone ?? null,
      });

      const step2Messages = buildStep2Messages(
        reportMode,
        detectedMarket,
        visualAnalysis,
        description,
        optionalDetails,
        verifiedFacts,
      );

      const { rawText: step2RawText, parsed: decision } = await callStep2Model(
        openRouterApiKey,
        step2Messages,
      );

      console.log('[TRACE_ORIGIN_BACKEND_RAW_OUTPUT]', {
        questions_to_ask: (decision as any)?.questions_to_ask,
        questionsToAsk: (decision as any)?.questionsToAsk,
        nextBestMove: (decision as any)?.nextBestMove,
        next_step: (decision as any)?.next_step,
        layout_fit: (decision as any)?.layout_fit,
        hiddenRisks: (decision as any)?.hiddenRisks,
        potentialIssues: (decision as any)?.potentialIssues,
        riskSignals: (decision as any)?.riskSignals,
      });

      console.log("[Step 2] parsed successfully. overall_verdict:", decision.overall_verdict ?? null);
      console.log("[Step 2] raw text preview:", step2RawText.slice(0, 1000));

      // Normalize Step2 decision to unified schema (handles US/AU field name differences)
      // First: inject extracted location data into decision so normalizeStep2Decision can use it
      // Also save a reference so we can pass it through to the result.listingInfo for the frontend
      const zfLoc = ((body as any)?.zillowFinancials) || ((optionalDetails as any)?.zillowFinancials) || {};
      const ldLoc = ((body as any)?.listingData) || {};
      const extractedLocation = {
        neighborhood: ldLoc?.neighborhood ?? (optionalDetails as any)?.region ?? (optionalDetails as any)?.neighborhood ?? '',
        floodZone: (zfLoc as any)?.floodZone ?? (ldLoc as any)?.floodZone ?? (optionalDetails as any)?.floodZone ?? '',
        walkScore: (zfLoc as any)?.walkScore ?? (ldLoc as any)?.walkScore ?? (optionalDetails as any)?.walkScore ?? '',
        bikeScore: (zfLoc as any)?.bikeScore ?? (ldLoc as any)?.bikeScore ?? (optionalDetails as any)?.bikeScore ?? '',
        schoolRatings: (zfLoc as any)?.schoolRatings ?? (ldLoc as any)?.schoolRatings ?? (optionalDetails as any)?.schoolRatings ?? '',
        transit: (zfLoc as any)?.transit ?? (ldLoc as any)?.transit ?? (optionalDetails as any)?.transit ?? '',
      };
      (decision as any)._extractedLocation = extractedLocation;
      const normalizedDecision = normalizeStep2Decision(decision, detectedMarket, optionalDetails);
      lockVerifiedFactsIntoResult(normalizedDecision as Record<string, any>, verifiedFacts as Record<string, any>);
  // Basement suppression for multi-family when listing has no basement signal
  // Even with prompt instructions, the AI may generate basement rental items for
  // multi-family listings that dont actually mention basement. Strip them here.
  const normCat = verifiedFacts?.normalizedPropertyCategory ?? '';
  const basementText = String((optionalDetails as any)?.basement ?? '').toLowerCase();
  const hasBasementSignal = /basement|finished basement|lower level|cellar|below grade|basement apartment|mother.*daughter/i.test(basementText);
  if (normCat === 'multi_family' && !hasBasementSignal) {
    const basementKws = /basement\s*(rental|apartment|legality|income)|basement.*rental/i;
    // Strip from hidden_risks
    if (Array.isArray(normalizedDecision.hidden_risks)) {
      const before = normalizedDecision.hidden_risks.length;
      normalizedDecision.hidden_risks = normalizedDecision.hidden_risks.filter((r: string) => !basementKws.test(r));
      console.log('[basement suppression] hidden_risks: removed', before - normalizedDecision.hidden_risks.length);
    }
    // Strip from questions_to_ask
    if (Array.isArray(normalizedDecision.questions_to_ask)) {
      const before = normalizedDecision.questions_to_ask.length;
      normalizedDecision.questions_to_ask = normalizedDecision.questions_to_ask.filter((q: any) => {
        const qText = typeof q === 'string' ? q : (q.question ?? q.text ?? '');
        return !basementKws.test(qText);
      });
      console.log('[basement suppression] questions_to_ask: removed', before - normalizedDecision.questions_to_ask.length);
    }
    // Strip from data_gaps
    if (Array.isArray(normalizedDecision.data_gaps)) {
      const before = normalizedDecision.data_gaps.length;
      normalizedDecision.data_gaps = normalizedDecision.data_gaps.filter((g: any) => {
        const gText = typeof g === 'string' ? g : (g.missing_item ?? g.title ?? '');
        return !basementKws.test(gText);
      });
      console.log('[basement suppression] data_gaps: removed', before - normalizedDecision.data_gaps.length);
    }
  }

  // ── Condo suppression: strip multi-family/rental/CO-rental items from hidden_risks, questions_to_ask, and data_gaps ──
  if (normCat === 'condo') {
    const condoBadKws = /basement\s*(rental|apartment|legality|income)|legal\s*two.family|two.family\s*status|rent\s*roll|second\s*unit|second\s*unit rent|probate.*title|title.*probate|oil\s*heating|oil\s*tank|co.*as\s*rental|rental.*income.*co|certificate.*rental.*income/i;
    const beforeHR = normalizedDecision.hidden_risks?.length ?? 0;
    normalizedDecision.hidden_risks = (normalizedDecision.hidden_risks ?? []).filter((r: string) => !condoBadKws.test(r));
    normalizedDecision.hidden_risks = (normalizedDecision.hidden_risks ?? []).filter((r: string) => !/certificate of occupancy as rental|income.operational/i.test(r));
    console.log('[condo suppression] hidden_risks: removed', beforeHR - (normalizedDecision.hidden_risks?.length ?? 0));

    if (Array.isArray(normalizedDecision.questions_to_ask)) {
      const beforeQ = normalizedDecision.questions_to_ask.length;
      normalizedDecision.questions_to_ask = normalizedDecision.questions_to_ask.filter((q: any) => {
        const qText = typeof q === 'string' ? q : (q.question ?? q.text ?? '');
        return !condoBadKws.test(qText);
      });
      console.log('[condo suppression] questions_to_ask: removed', beforeQ - normalizedDecision.questions_to_ask.length);
    }

    if (Array.isArray(normalizedDecision.data_gaps)) {
      const beforeD = normalizedDecision.data_gaps.length;
      normalizedDecision.data_gaps = normalizedDecision.data_gaps.filter((g: any) => {
        const gText = typeof g === 'string' ? g : (g.missing_item ?? g.title ?? '');
        return !condoBadKws.test(gText);
      });
      console.log('[condo suppression] data_gaps: removed', beforeD - normalizedDecision.data_gaps.length);
    }
  }

      // Stable Zillow sale check — not just market === 'US'
      const isZillowSale = String((body as any)?.sourceDomain || '').includes('zillow')
        && reportMode === 'sale';

      console.log('[analyze][carrying_costs override gates]', {
        sourceDomain: (body as any)?.sourceDomain,
        market: detectedMarket,
        reportMode,
        isZillowSale,
        hasZillowFinancials: !!zillowFinancials,
        monthlyEstimate: (zillowFinancials as any)?.monthlyPayment?.estimatedMonthlyPayment?.value,
        topEstimate: (zillowFinancials as any)?.topEstimatedPayment?.value,
        annualTaxAmount: (zillowFinancials as any)?.financialDetails?.annualTaxAmount?.value,
      });

      // ── Deterministic carrying_costs from Zillow financials (Zillow US sale only) ──────
      // Always overwrite AI's unknown carrying_costs if we have Zillow data.
      // Do NOT use `|| {}` — AI's existing unknown object would block the override.
      if (isZillowSale && zillowFinancials) {
        const zf = zillowFinancials as any;
        const monthlyPayment = zf.monthlyPayment || {};
        const financialDetails = zf.financialDetails || {};
        const estimatedPayment = monthlyPayment.estimatedMonthlyPayment;

        // Build deterministic carrying_costs (always fresh object, never mutate AI's)
        const deterministicCC: Record<string, unknown> = { status: 'unknown' };

        if (estimatedPayment?.value != null) {
          // Primary: use Zillow's estimated monthly payment
          deterministicCC.status = 'available';
          deterministicCC.primary_monthly_estimate = estimatedPayment.value;
          deterministicCC.monthly_breakdown = {
            estimatedMonthlyPayment: estimatedPayment,
            principalAndInterest: monthlyPayment.principalAndInterest ?? null,
            mortgageInsurance: monthlyPayment.mortgageInsurance ?? null,
            propertyTaxes: monthlyPayment.propertyTaxes ?? null,
            homeInsurance: monthlyPayment.homeInsurance ?? null,
            hoaFees: monthlyPayment.hoaFees ?? null,
            utilities: monthlyPayment.utilities ?? null,
          };
        } else if (zf.derived?.knownMonthlyTotal?.value > 0) {
          // Secondary: sum of known components
          deterministicCC.status = 'available';
          deterministicCC.primary_monthly_estimate = zf.derived.knownMonthlyTotal.value;
        } else if (zf.topEstimatedPayment?.value != null) {
          // Tertiary: top-level estimated payment
          deterministicCC.status = 'partial';
          deterministicCC.primary_monthly_estimate = zf.topEstimatedPayment.value;
        } else if (financialDetails.annualTaxAmount?.value != null) {
          // Fallback: annual tax only
          deterministicCC.status = 'partial';
          deterministicCC.annual_tax = financialDetails.annualTaxAmount.value;
          deterministicCC.annual_tax_display =
            financialDetails.annualTaxAmount.raw || '$' + financialDetails.annualTaxAmount.value + '/yr';
          deterministicCC.monthly_tax_equivalent = Math.round(financialDetails.annualTaxAmount.value / 12);
        }

        // Fill remaining fields from Zillow data
        if (deterministicCC.status !== 'unknown') {
          // HOA override
          if (monthlyPayment.hoaFees?.status === 'not_applicable') {
            deterministicCC.hoa = 'No';
          } else if (monthlyPayment.hoaFees?.value != null) {
            deterministicCC.hoa = 'Yes';
            deterministicCC.hoa_amount = monthlyPayment.hoaFees.value;
          }

          // Annual tax from financial details
          if (financialDetails.annualTaxAmount?.value != null) {
            deterministicCC.annual_tax = financialDetails.annualTaxAmount.value;
            deterministicCC.annual_tax_display =
              financialDetails.annualTaxAmount.raw || '$' + financialDetails.annualTaxAmount.value + '/yr';
            deterministicCC.monthly_tax_equivalent = Math.round(financialDetails.annualTaxAmount.value / 12);
          }

          // Tax discrepancy note
          if (monthlyPayment.propertyTaxes?.value != null && financialDetails.annualTaxAmount?.value != null) {
            const monthlyFromAnnual = Math.round(financialDetails.annualTaxAmount.value / 12);
            if (monthlyFromAnnual !== monthlyPayment.propertyTaxes.value) {
              deterministicCC.tax_note =
                `Annual tax amount implies about $${monthlyFromAnnual}/mo, ` +
                `while Zillow monthly payment shows $${monthlyPayment.propertyTaxes.value}/mo.`;
            }
          }

          // Set missing_costs and summary when we have monthly breakdown
          if (deterministicCC.status === 'available' && deterministicCC.primary_monthly_estimate != null) {
            const missing: string[] = [];
            if (monthlyPayment.hoaFees?.status !== 'not_applicable' && monthlyPayment.hoaFees?.value == null) {
              missing.push('hoa');
            }
            if (monthlyPayment.utilities?.status !== 'not_included' && monthlyPayment.utilities?.value == null) {
              missing.push('utilities');
            }
            if (monthlyPayment.homeInsurance?.value == null) {
              missing.push('insurance');
            }
            deterministicCC.missing_costs = missing;
            deterministicCC.cost_pressure = 'Known Costs';
            deterministicCC.summary =
              `Monthly carrying costs: $${deterministicCC.primary_monthly_estimate}/mo. ` +
              `Breakdown available from Zillow.`;
          }
        }

        // Force overwrite — even if AI already wrote an unknown object
        if (deterministicCC.status !== 'unknown') {
          normalizedDecision.carrying_costs = deterministicCC as any;
        }

        console.log('[analyze][carrying_costs override applied]', {
          status: deterministicCC.status,
          primary_monthly_estimate: deterministicCC.primary_monthly_estimate,
          hoa: deterministicCC.hoa,
          annual_tax: deterministicCC.annual_tax,
        });
      }

      console.log("[DIAG] normalized Step2 decision", {
        market: detectedMarket,
        raw_has_pros: Array.isArray((decision as any)?.pros),
        raw_has_what_looks_good: Array.isArray((decision as any)?.what_looks_good),
        raw_has_cons: Array.isArray((decision as any)?.cons),
        raw_has_risk_signals: Array.isArray((decision as any)?.risk_signals),
        normalized_pros_count: normalizedDecision.pros?.length ?? 0,
        normalized_cons_count: normalizedDecision.cons?.length ?? 0,
        normalized_price_assessment: normalizedDecision.price_assessment,
      });

      console.log("[Step 2] Decision complete:", normalizedDecision.overall_verdict);

      // Update state before competition estimation
      await updateAnalysisState(id, {
        stage: "estimating_competition",
        message: "Estimating competition level...",
        progress: 75,
      });

      // Wait for Reality Check result (started in parallel earlier)
      const realityCheckResult = await realityCheckPromise;
      console.log("[Reality Check] Complete, should_display:", realityCheckResult.should_display);

      // Build final result
      const competitionRisk = decision.competition_risk || {
        level: 'MEDIUM',
        reasons: ['Unable to assess competition risk']
      };

      const recommendation: Step2Recommendation = (normalizedDecision.recommendation as Step2Recommendation | null | undefined) ?? {
        verdict: normalizedDecision.overall_verdict || 'Need More Evidence',
        good_fit_for: [],
        not_ideal_for: []
      };

      const photoAnalysis: PhotoAnalysis[] = Array.isArray(visualAnalysis?.photos)
        ? (visualAnalysis!.photos as PhotoAnalysis[])
        : [];
      const aggregatedSpaceAnalysis = aggregateSpaceAnalysis(photoAnalysis);

      const analyzedPhotoCount = imageUrls.length;
      const roomCounts: Record<string, number> = {};
      for (const p of photoAnalysis) {
        const key = (p.areaType || 'unknown').toLowerCase().trim() || 'unknown';
        roomCounts[key] = (roomCounts[key] ?? 0) + 1;
      }
      const detectedRooms = Object.keys(roomCounts)
        .filter((k) => k !== 'unknown')
        .sort();

      const overallScoreNum = typeof decision.overall_score === 'number' ? decision.overall_score : 0;

      // Determine verdict based on report mode
      const verdictStr = recommendation.verdict || '';
      const mappedVerdict = reportMode === 'sale' ? mapSaleVerdict(verdictStr) : mapVerdict(verdictStr);

      // Build mode-specific fields
      const rentFields = reportMode === 'rent' ? {
        rent_fairness: (decision as any).rent_fairness ? {
          estimated_min: typeof (decision as any).rent_fairness.estimated_min === 'number'
            ? (decision as any).rent_fairness.estimated_min
            : typeof (decision as any).rent_fairness.estimated_min === 'string'
            ? parseInt(String((decision as any).rent_fairness.estimated_min).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_max: typeof (decision as any).rent_fairness.estimated_max === 'number'
            ? (decision as any).rent_fairness.estimated_max
            : typeof (decision as any).rent_fairness.estimated_max === 'string'
            ? parseInt(String((decision as any).rent_fairness.estimated_max).replace(/[^0-9]/g, ''), 10)
            : null,
          listing_price: typeof (decision as any).rent_fairness.listing_price === 'number'
            ? (decision as any).rent_fairness.listing_price
            : typeof (decision as any).rent_fairness.listing_price === 'string'
            ? parseInt(String((decision as any).rent_fairness.listing_price).replace(/[^0-9]/g, ''), 10)
            : null,
          verdict: (decision as any).rent_fairness.verdict || 'fair',
          explanation: (decision as any).rent_fairness.explanation || ''
        } : null,
        applicationStrategy: (decision as any).application_strategy
          ? {
              urgency: (decision as any).application_strategy.urgency || 'Medium',
              applySpeed: (decision as any).application_strategy.apply_speed || '',
              checklist: Array.isArray((decision as any).application_strategy.checklist)
                ? (decision as any).application_strategy.checklist
                : [],
              reasoning: Array.isArray((decision as any).application_strategy.reasoning)
                ? (decision as any).application_strategy.reasoning
                : []
            }
          : null,
      } : { rent_fairness: null, applicationStrategy: null };

      // Use normalized price_assessment (covers US/AU field name differences)
      const normPrice = normalizedDecision.price_assessment;

      const saleFields = reportMode === 'sale' ? {
        price_assessment: normPrice ? {
          estimated_min: normPrice.estimated_min ?? null,
          estimated_max: normPrice.estimated_max ?? null,
          asking_price: normPrice.asking_price ?? null,
          verdict: normPrice.verdict || (normPrice.asking_price != null ? 'Needs Comps' : 'Unknown'),
          explanation: normPrice.explanation || '',
          tax_context: normPrice.tax_context || '',
          price_per_sqft_context: normPrice.price_per_sqft_context || '',
          valuation_confidence: normPrice.valuation_confidence || 'Low',
          missing_data: Array.isArray(normPrice.missing_data) ? normPrice.missing_data : [],
        } : null,
        investment_potential: normalizedDecision.investment_potential ?? null,
        affordability_check: (decision as any).affordability_check ? {
          estimated_deposit_20pct: typeof (decision as any).affordability_check.estimated_deposit_20pct === 'number'
            ? (decision as any).affordability_check.estimated_deposit_20pct
            : typeof (decision as any).affordability_check.estimated_deposit_20pct === 'string'
            ? parseInt(String((decision as any).affordability_check.estimated_deposit_20pct).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_loan: typeof (decision as any).affordability_check.estimated_loan === 'number'
            ? (decision as any).affordability_check.estimated_loan
            : typeof (decision as any).affordability_check.estimated_loan === 'string'
            ? parseInt(String((decision as any).affordability_check.estimated_loan).replace(/[^0-9]/g, ''), 10)
            : null,
          estimated_monthly_repayment: (decision as any).affordability_check.estimated_monthly_repayment || '',
          assessment: (decision as any).affordability_check.assessment || 'manageable',
          note: (decision as any).affordability_check.note || ''
        } : null,
        // === Sale 模式新增字段映射 ===
        property_snapshot: normalizedDecision.property_snapshot,
        land_value_analysis: (decision as any).land_value_analysis ? {
          landSize: typeof (decision as any).land_value_analysis.land_size === 'number'
            ? (decision as any).land_value_analysis.land_size
            : typeof (decision as any).land_value_analysis.land_size === 'string'
            ? parseInt(String((decision as any).land_value_analysis.land_size).replace(/[^0-9]/g, ''), 10)
            : undefined,
          pricePerSqm: typeof (decision as any).land_value_analysis.price_per_sqm === 'number'
            ? (decision as any).land_value_analysis.price_per_sqm
            : typeof (decision as any).land_value_analysis.price_per_sqm === 'string'
            ? parseInt(String((decision as any).land_value_analysis.price_per_sqm).replace(/[^0-9]/g, ''), 10)
            : undefined,
          landBankingPotential: (decision as any).land_value_analysis.land_banking_potential === true,
          scarcityIndicator: (decision as any).land_value_analysis.scarcity_indicator || 'Medium',
          propertyType: (decision as any).land_value_analysis.property_type || 'Unknown',
          explanation: (decision as any).land_value_analysis.explanation || ''
        } : null,
        holding_costs: (decision as any).holding_costs ? {
          deposit20pct: typeof (decision as any).holding_costs.deposit_20pct === 'number'
            ? (decision as any).holding_costs.deposit_20pct
            : typeof (decision as any).holding_costs.deposit_20pct === 'string'
            ? parseInt(String((decision as any).holding_costs.deposit_20pct).replace(/[^0-9]/g, ''), 10)
            : 0,
          stampDuty: typeof (decision as any).holding_costs.stamp_duty === 'number'
            ? (decision as any).holding_costs.stamp_duty
            : typeof (decision as any).holding_costs.stamp_duty === 'string'
            ? parseInt(String((decision as any).holding_costs.stamp_duty).replace(/[^0-9]/g, ''), 10)
            : 0,
          stampDutyState: (decision as any).holding_costs.stamp_duty_state || 'Other',
          transferFees: typeof (decision as any).holding_costs.transfer_fees === 'number'
            ? (decision as any).holding_costs.transfer_fees
            : typeof (decision as any).holding_costs.transfer_fees === 'string'
            ? parseInt(String((decision as any).holding_costs.transfer_fees).replace(/[^0-9]/g, ''), 10)
            : 0,
          legalCosts: typeof (decision as any).holding_costs.legal_costs === 'number'
            ? (decision as any).holding_costs.legal_costs
            : typeof (decision as any).holding_costs.legal_costs === 'string'
            ? parseInt(String((decision as any).holding_costs.legal_costs).replace(/[^0-9]/g, ''), 10)
            : 0,
          inspectionCosts: typeof (decision as any).holding_costs.inspection_costs === 'number'
            ? (decision as any).holding_costs.inspection_costs
            : typeof (decision as any).holding_costs.inspection_costs === 'string'
            ? parseInt(String((decision as any).holding_costs.inspection_costs).replace(/[^0-9]/g, ''), 10)
            : 0,
          estimatedMonthlyRepayment: (decision as any).holding_costs.estimated_monthly_repayment || '',
          totalUpfrontCosts: typeof (decision as any).holding_costs.total_upfront_costs === 'number'
            ? (decision as any).holding_costs.total_upfront_costs
            : typeof (decision as any).holding_costs.total_upfront_costs === 'string'
            ? parseInt(String((decision as any).holding_costs.total_upfront_costs).replace(/[^0-9]/g, ''), 10)
            : undefined,
          cashFlowAnalysis: (decision as any).holding_costs.cash_flow_analysis ? {
            potentialRent: typeof (decision as any).holding_costs.cash_flow_analysis.potential_rent === 'number'
              ? (decision as any).holding_costs.cash_flow_analysis.potential_rent
              : typeof (decision as any).holding_costs.cash_flow_analysis.potential_rent === 'string'
              ? parseInt(String((decision as any).holding_costs.cash_flow_analysis.potential_rent).replace(/[^0-9]/g, ''), 10)
              : undefined,
            weeklyMortgageInterest: typeof (decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest === 'number'
              ? (decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest
              : typeof (decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest === 'string'
              ? parseInt(String((decision as any).holding_costs.cash_flow_analysis.weekly_mortgage_interest).replace(/[^0-9]/g, ''), 10)
              : 0,
            weeklyDifference: typeof (decision as any).holding_costs.cash_flow_analysis.weekly_difference === 'number'
              ? (decision as any).holding_costs.cash_flow_analysis.weekly_difference
              : typeof (decision as any).holding_costs.cash_flow_analysis.weekly_difference === 'string'
              ? parseInt(String((decision as any).holding_costs.cash_flow_analysis.weekly_difference).replace(/[^0-9]/g, ''), 10)
              : 0,
            verdict: (decision as any).holding_costs.cash_flow_analysis.verdict || 'Neutral'
          } : undefined
        } : null,
        red_flag_alerts: Array.isArray((decision as any).red_flag_alerts)
          ? (decision as any).red_flag_alerts.map((alert: any) => ({
            keyword: alert.keyword || '',
            category: alert.category || 'financial',
            severity: alert.severity || 'low',
            message: alert.message || '',
            action: alert.action || ''
          }))
          : undefined,
        state_specific_advice: (decision as any).state_specific_advice ? {
          state: (decision as any).state_specific_advice.state || 'Unknown',
          recommendations: Array.isArray((decision as any).state_specific_advice.recommendations)
            ? (decision as any).state_specific_advice.recommendations
            : []
        } : null,
        // === Sale 模式新增增强字段映射 ===
        deal_breakers: (decision as any).deal_breakers ? {
          summary: (decision as any).deal_breakers.summary || '',
          overall_severity: (decision as any).deal_breakers.overall_severity || 'LOW',
          items: Array.isArray((decision as any).deal_breakers.items)
            ? (decision as any).deal_breakers.items.map((item: any) => ({
                title: item.title || '',
                severity: item.severity || 'LOW',
                category: item.category || 'OTHER',
                description: item.description || '',
                why_it_matters: item.why_it_matters || '',
                mitigation: item.mitigation || ''
              }))
            : []
        } : null,
        next_move: (decision as any).next_move ? {
          decision: (decision as any).next_move.decision || 'PROCEED_WITH_CAUTION',
          headline: (decision as any).next_move.headline || '',
          reasoning: (decision as any).next_move.reasoning || '',
          suggested_actions: Array.isArray((decision as any).next_move.suggested_actions)
            ? (decision as any).next_move.suggested_actions
            : []
        } : null,
        would_i_buy: (decision as any).would_i_buy ? {
          answer: (decision as any).would_i_buy.answer || 'MAYBE',
          confidence: (decision as any).would_i_buy.confidence || 'MEDIUM',
          reason: (decision as any).would_i_buy.reason || ''
        } : null,
        // === US Sale 决策支持报告字段映射 ===
        carrying_costs: normalizedDecision.carrying_costs,
        maintenance_risk: normalizedDecision.maintenance_risk,
        layout_fit: normalizedDecision.layout_fit,
        // Merge Step 2 AI result + Step 1 Reality Check Spin Decoder (deduped by phrase)
        listing_language_reality_check: (() => {
          const step2Spin = Array.isArray(normalizedDecision.listing_language_reality_check)
            ? normalizedDecision.listing_language_reality_check : [];
          const step1Spin = realityCheckResult.listing_language_reality_check ?? [];
          const seen = new Set(step2Spin.map((i: any) => String(i.phrase ?? '').toLowerCase()));
          const merged = [...step2Spin, ...step1Spin.filter((i: any) => {
            const key = String(i.phrase ?? '').toLowerCase();
            return key && !seen.has(key);
          })];
          return merged;
        })(),
        neighborhood_lifestyle: normalizedDecision.neighborhood_lifestyle,
        legal_compliance: normalizedDecision.legal_compliance,
        environmental_risk: normalizedDecision.environmental_risk,
        data_gaps: Array.isArray(normalizedDecision.data_gaps)
          ? normalizedDecision.data_gaps : [],
        // === US Sale 决策支持报告字段映射 END ===
        // === Sale 模式新增字段映射 END ===
      } : { price_assessment: null, investment_potential: null, affordability_check: null };

      const coverImageUrl = pickCoverImage(imageUrls);

      const result = {
        id, // Analysis ID for sharing functionality
        reportMode, // NEW: report mode indicator
        source,     // market source for debugging
        sourceDomain, // domain extracted from URL or source for frontend routing
        market: detectedMarket, // market routing flag (replaces isUSMarket boolean)
        coverImageUrl, // first non-logo image URL for Hero display
        listingUrl: (body as Record<string, unknown>).listingUrl as string | null
          ?? (optionalDetails as Record<string, unknown>).listingUrl as string | null
          ?? null, // listing URL for frontend source detection
        // reportProfile: property-type classification driving which risk modules and questions are shown
        // Added by post-processing from verifiedFacts.reportProfile
        reportProfile: verifiedFacts.reportProfile as string,
        // normalizedPropertyCategory: canonical property type for display and routing
        normalizedPropertyCategory: verifiedFacts.normalizedPropertyCategory as string,
        displayType: verifiedFacts.displayType as string,
        overallScore: overallScoreNum,
        finalRecommendation: normalizedDecision.final_recommendation
          ? {
              verdict: normalizedDecision.final_recommendation.verdict || 'Apply With Caution',
              reason: normalizedDecision.final_recommendation.reason || ''
            }
          : null,
        scoreContext: normalizedDecision.score_context ? {
          marketPosition: normalizedDecision.score_context.market_position || 'Average',
          explanation: normalizedDecision.score_context.explanation || ''
        } : null,
        decisionPriority: normalizedDecision.decision_priority || (overallScoreNum > 75 ? 'HIGH' : overallScoreNum >= 55 ? 'MEDIUM' : 'LOW'),
        confidenceLevel: normalizedDecision.confidence_level || 'Medium',
        overallVerdict: normalizedDecision.overall_verdict || '',
        quickSummary: normalizedDecision.quick_summary || normalizedDecision.overall_verdict || '',
        whatLooksGood: normalizedDecision.pros || [],
        riskSignals: normalizedDecision.cons || [],
        hiddenRisks: normalizedDecision.hidden_risks || [],
        risks: normalizedDecision.risks || [],
        verdict: mappedVerdict,
        realityCheck: normalizedDecision.overall_verdict || '',
        reality_check: realityCheckResult,
        spaceAnalysis: (normalizedDecision.space_analysis as { area_type: string; score: number; explanation?: string; insights?: string[]; photo_count?: number }[] || aggregatedSpaceAnalysis).map((s: any) => ({
          spaceType: s.area_type || s.spaceType,
          score: s.score,
          explanation: s.explanation || '',
          photoCount: s.photo_count || s.photoCount || 0,
          observations: s.insights || s.observations || []
        })),
        propertyStrengths: normalizedDecision.property_strengths || normalizedDecision.pros || [],
        potentialIssues: normalizedDecision.potential_issues || normalizedDecision.cons || [],
        competitionRisk: competitionRisk,
        inspectionFit: {
          good_for: normalizedDecision.inspection_fit?.good_for || recommendation.good_fit_for || [],
          not_ideal_for: normalizedDecision.inspection_fit?.not_ideal_for || recommendation.not_ideal_for || []
        },
        recommendation: {
          verdict: mappedVerdict,
          goodFitIf: recommendation.good_fit_for || [],
          notIdealIf: recommendation.not_ideal_for || []
        },
        questionsToAsk: normalizedDecision.questions_to_ask || normalizedDecision.agent_questions || [],
        agentQuestions: normalizedDecision.agent_questions || normalizedDecision.questions_to_ask || [],
        ...rentFields,
        ...saleFields,
        lightThermalGuide: normalizedDecision.light_thermal_guide
          ? {
              naturalLightSummary: normalizedDecision.light_thermal_guide.natural_light_summary || '',
              sunExposure: normalizedDecision.light_thermal_guide.sun_exposure || 'Unknown',
              thermalRisk: normalizedDecision.light_thermal_guide.thermal_risk || 'Unknown',
              summerComfort: normalizedDecision.light_thermal_guide.summer_comfort || '',
              winterComfort: normalizedDecision.light_thermal_guide.winter_comfort || '',
              confidence: normalizedDecision.light_thermal_guide.confidence || 'Low',
              evidence: Array.isArray(normalizedDecision.light_thermal_guide.evidence)
                ? normalizedDecision.light_thermal_guide.evidence
                : []
            }
          : null,
        agentLingoTranslation: normalizedDecision.agent_lingo_translation
          ? {
              shouldDisplay: normalizedDecision.agent_lingo_translation.should_display === true,
              phrases: Array.isArray(normalizedDecision.agent_lingo_translation.phrases)
                ? normalizedDecision.agent_lingo_translation.phrases.map((item: any) => ({
                    phrase: item?.phrase || '',
                    plainEnglish: item?.plain_english || '',
                    confidence: item?.confidence || 'Low'
                  }))
                : []
            }
          : { shouldDisplay: false, phrases: [] },
        photos: Array.isArray(visualAnalysis?.photos) ? visualAnalysis.photos : [],
        visualAnalysis: visualAnalysis
          ? {
              renovationLevel: visualAnalysis.renovationLevel ?? null,
              cosmeticFlipRisk: visualAnalysis.cosmeticFlipRisk ?? null,
              naturalLight: visualAnalysis.naturalLight ?? null,
              spacePerception: visualAnalysis.spacePerception ?? null,
              maintenanceImpression: visualAnalysis.maintenanceCondition ?? null,
              kitchenCondition: visualAnalysis.kitchenCondition ?? null,
              bathroomCondition: visualAnalysis.bathroomCondition ?? null,
              missingKeyAreas: visualAnalysis.missingKeyAreas ?? [],
              photoObservations: visualAnalysis.photoObservations ?? [],
            }
          : null,
        spatialMetrics: visualAnalysis?.spatialMetrics ?? null,
        analyzedPhotoCount,
        detectedRooms,
        roomCounts,
        analyzed_photo_count: analyzedPhotoCount,
        detected_rooms: detectedRooms,
        room_counts: roomCounts,
        // listingInfo carries address, title, coverImageUrl, imageUrls, and location data
        // so normalizeReport's pickFirstImage and buildAddress can find them
        listingInfo: {
          address: verifiedFacts.address ?? null,
          title: optionalDetails.title ?? null,
          coverImageUrl,
          images: imageUrls.length > 0 ? imageUrls : null,
          neighborhood: extractedLocation.neighborhood || null,
          floodZone: extractedLocation.floodZone || null,
          walkScore: extractedLocation.walkScore || null,
          bikeScore: extractedLocation.bikeScore || null,
          schoolRatings: extractedLocation.schoolRatings || null,
          transit: extractedLocation.transit || null,
        },
      };

      // ── Step 5: validateReportAgainstVerifiedFacts — P0-4 validator ─────────────────────────────
      // Scans AI output for contradictions with known facts and auto-fixes them.
      // Runs before any other override logic so all downstream code gets clean data.
      (function validateReport(vf: NonNullable<typeof verifiedFacts>, res: Record<string, unknown>) {
        const ps = res.property_snapshot as Record<string, unknown> | undefined;
        const pa = res.price_assessment as Record<string, unknown> | undefined;
        const cc = res.carrying_costs as Record<string, unknown> | undefined;

        console.log('[validateReport] REPORT_FACTS_INPUT', {
          askingPrice: vf.price_display,
          priceValue: vf.price,
          yearBuilt: vf.yearBuilt,
          beds: vf.beds,
          baths: vf.baths,
          sqft: vf.sqft,
          pricePerSqft: vf.pricePerSqft,
          monthlyPayment: vf.monthlyPayment,
          annualTax: vf.annualTax,
          propertyType: vf.propertyType,
          floodZone: extractedLocation.floodZone || null,
          currentAskingPrice: pa?.asking_price,
          currentYearBuilt: ps?.yearBuilt ?? ps?.year_built,
        });

        // ── property_snapshot: yearBuilt — FORCE override if AI wrote a "unknown/not provided" message ──
        if (vf.yearBuilt != null && ps) {
          const currentYB = ps.yearBuilt;
          const currentYBStr = String(currentYB ?? '');
          const isMissingYB = !currentYB
            || currentYBStr === 'unknown'
            || /unknown|not provided|not available|n\/a/i.test(currentYBStr);
          if (isMissingYB) {
            ps.yearBuilt = vf.yearBuilt;
            ps.year_built = vf.yearBuilt;
          } else if (typeof currentYB === 'number' && currentYB !== vf.yearBuilt) {
            // Override AI's wrong year
            ps.yearBuilt = vf.yearBuilt;
            ps.year_built = vf.yearBuilt;
          }
          if (vf.beds != null) ps.beds = vf.beds;
          if (vf.baths != null) ps.baths = vf.baths;
          if (vf.sqft != null) ps.sqft = vf.sqft;
          if (vf.propertyType) {
            ps.homeType = vf.propertyType;
            ps.home_type = vf.propertyType;
            ps.propertyType = vf.propertyType;
          }
        }

        // ── yearBuilt narrative guard: remove unauthorized "pre-war" inferences from AI text ──
        // When yearBuilt is known, the AI may write "pre-war" in narrative text without being
        // explicitly authorized. Replace it with the verified year so the report stays accurate.
        if (vf.yearBuilt != null) {
          const yearStr = String(vf.yearBuilt);
          const yearBuiltUnknownPattern = /year\s*built\s*(?:is\s*)?(unknown|not\s*provided|not\s*available|not\s*disclosed|n\/a)/gi;
          const canonicalYearBuiltSentence = `Built in ${yearStr}`;
          const rewrite = (field: Record<string, unknown> | undefined, key: string) => {
            if (field && typeof field[key] === 'string') {
              const val = field[key] as string;
              let nextVal = val;
              if (/\bpre-war\b/i.test(nextVal)) {
                nextVal = nextVal.replace(/\bpre-war\b/gi, `built in ${yearStr}`);
              }
              if (yearBuiltUnknownPattern.test(nextVal)) {
                yearBuiltUnknownPattern.lastIndex = 0;
                nextVal = nextVal.replace(yearBuiltUnknownPattern, canonicalYearBuiltSentence);
              }
              field[key] = nextVal;
            }
          };
          rewrite(res, 'bottomLine');
          rewrite(res, 'bottom_line');
          rewrite(res, 'summary');
          rewrite(ps, 'yearBuiltDescription');
          rewrite(ps, 'year_built_description');
          rewrite(res.maintenance_risk as Record<string, unknown> | undefined, 'summary');
          const scanArray = (arr: unknown[] | undefined, fields: string[]) => {
            if (!Array.isArray(arr)) return;
            for (const item of arr) {
              if (item && typeof item === 'object') {
                for (const f of fields) {
                  rewrite(item as Record<string, unknown>, f);
                }
              }
            }
          };
          scanArray((res as any).decision_cards ?? (res as any).decisionCards, ['title', 'explanation', 'description']);
          scanArray((res as any).what_looks_good ?? (res as any).whatLooksGood, ['title', 'explanation', 'description']);
          scanArray((res as any).reasons, ['text', 'description']);
          scanArray((res as any).maintenance_risk?.items ?? (res as any).maintenance_risk?.risk_factors, ['title', 'description', 'summary', 'text']);
        }

        // ── legal_compliance: replace generic property-type category text with buyer-friendly language ──
        {
          const lc = (res as any).legal_compliance;
          if (lc && typeof lc.summary === 'string') {
            lc.summary = lc.summary.replace(
              /property\s+type\s*(and\s+category)?\s+not\s+clearly\s+disclosed/gi,
              'Verify Certificate of Occupancy, legal use, permit history, and any open violations before offering.'
            );
          }
          // Also clean legal_compliance.items_to_verify
          if (Array.isArray(lc?.items_to_verify)) {
            lc.items_to_verify = lc.items_to_verify.map((item: unknown) => {
              if (typeof item === 'string') {
                return item.replace(
                  /property\s+type\s*(and\s+category)?\s+not\s+clearly\s+disclosed/gi,
                  'Verify Certificate of Occupancy, legal use, permit history, and any open violations before offering.'
                );
              }
              if (item && typeof item === 'object') {
                const obj = item as Record<string, unknown>;
                for (const key of ['description', 'text', 'title', 'item']) {
                  if (typeof obj[key] === 'string') {
                    obj[key] = (obj[key] as string).replace(
                      /property\s+type\s*(and\s+category)?\s+not\s+clearly\s+disclosed/gi,
                      'Verify Certificate of Occupancy, legal use, permit history, and any open violations before offering.'
                    );
                  }
                }
              }
              return item;
            });
          }
        }

        // ── layout_fit: replace multi-unit income investor phrasing with buyer-friendly alternatives ──
        {
          const lf = (res as any).layout_fit ?? {};
          const cleanBestFor = (arr: unknown[] | undefined): unknown[] =>
            (arr ?? []).map((item: unknown) => {
              if (typeof item === 'string') {
                return item.replace(/\binvestors\s+seeking\s+multi[- ]?unit\s+income\b/gi, 'Investors seeking strong immediate rental yield');
              }
              if (item && typeof item === 'object') {
                const obj = item as Record<string, unknown>;
                if (typeof obj.description === 'string') {
                  obj.description = obj.description.replace(/\binvestors\s+seeking\s+multi[- ]?unit\s+income\b/gi, 'Investors seeking strong immediate rental yield');
                }
                if (typeof obj.text === 'string') {
                  obj.text = obj.text.replace(/\binvestors\s+seeking\s+multi[- ]?unit\s+income\b/gi, 'Investors seeking strong immediate rental yield');
                }
              }
              return item;
            });
          if (Array.isArray(lf.best_for)) lf.best_for = cleanBestFor(lf.best_for);
          if (Array.isArray(lf.bestFor)) lf.bestFor = cleanBestFor(lf.bestFor);
        }

        // ── Property-aware flag (used by multiple post-processing blocks below) ──
        const isSFOC = vf.reportProfile === 'single_family_owner_occupier';

        // ── price_assessment: asking_price ──
        if (pa && vf.price != null) {
          pa.asking_price = vf.price;
        }

        // ── price_assessment: zestimate_context — FORCE override if AI wrote a "no data" message ──
        if (pa && vf.zestimate != null) {
          const currentZestCtx = String(pa.zestimate_context || '');
          const isMissingZest = !currentZestCtx
            || /no zestimate|without zestimate|missing zestimate|zestimate.*not.*avail|not.*zestimate|n\/a.*zestimate|zestimate.*n\/a/i.test(currentZestCtx);
          if (isMissingZest) {
            const legalSuffix = isSFOC
              ? 'Condition, permit status, and older building systems should be verified independently.'
              : 'Local comps, condition, legal rental status, and renovation needs still need verification.';
            pa.zestimate_context =
              `Zillow Zestimate: ${vf.zestimate_display || '$' + vf.zestimate.toLocaleString()}. ` +
              `Zestimate is not an appraisal. ${legalSuffix}`;
          }
          // Also ensure estimated range is set if page provides it
          if (vf.estimatedSalesRangeMin != null && (!pa.estimated_min)) {
            pa.estimated_min = vf.estimatedSalesRangeMin;
          }
          if (vf.estimatedSalesRangeMax != null && (!pa.estimated_max)) {
            pa.estimated_max = vf.estimatedSalesRangeMax;
          }
        }

        // ── price_assessment: fix asking vs zestimate comparison direction ──
        // Property-aware: use single-family or multi-family risk factors accordingly
        // NOTE: riskFactorsSuffix is a standalone sentence fragment — do NOT append
        // "could materially change value" or "should be verified independently" after it.
        const riskFactorsSuffix = isSFOC
          ? 'Condition, permit status, roof age, and older building systems should be verified independently.'
          : 'Condition, legal unit count, rent roll, and renovation needs should be verified independently.';

        if (pa && vf.price != null && vf.zestimate != null) {
          const ap = Number(pa.asking_price);
          const z = Number(vf.zestimate);
          if (!isNaN(ap) && !isNaN(z) && z > 0) {
            const diff = ap - z;
            const diffAbs = Math.abs(diff);
            const verdictRaw = String(pa.verdict ?? '').toLowerCase();
            const pctDiff = diffAbs / z;
            const withinRange = vf.estimatedSalesRangeMin != null && vf.estimatedSalesRangeMax != null
              ? (ap >= Number(vf.estimatedSalesRangeMin) && ap <= Number(vf.estimatedSalesRangeMax))
              : (pctDiff <= 0.05);

            // Rebuild explanation from scratch when the current one has wrong direction
            if (!pa.explanation || /below|above.*zestimate|below.*zestimate/i.test(String(pa.explanation ?? ''))) {
              const rangeNote = withinRange
                ? 'within Zillow\'s estimated sales range'
                : 'close to Zillow\'s estimated sales range';
              if (diff > 0) {
                pa.explanation = `Asking price is about $${(diffAbs / 1000).toFixed(1)}k above Zillow Zestimate and ${rangeNote}. Zestimate is not an appraisal, and HomeScope has not independently verified comparable sales. ${riskFactorsSuffix}`;
              } else if (diff < 0) {
                pa.explanation = `Asking price is about $${(diffAbs / 1000).toFixed(1)}k below Zillow Zestimate and ${rangeNote}. Zestimate is not an appraisal, and HomeScope has not independently verified comparable sales. ${riskFactorsSuffix}`;
              } else {
                pa.explanation = `Asking price is roughly in line with Zillow Zestimate. Zestimate is not an appraisal, and HomeScope has not independently verified comparable sales. ${riskFactorsSuffix}`;
              }
            }

            // Fix verdict if it contradicts the data (only override clearly wrong verdicts)
            if (verdictRaw === 'overpriced' && diff <= z * 0.03) {
              pa.verdict = 'Fair';
            }
            if (verdictRaw === 'underpriced' && diff >= -z * 0.03) {
              pa.verdict = 'Fair';
            }
          }
        }

        // ── price_assessment: price_per_sqft_context — FORCE override if AI wrote a "no data" message ──
        if (pa && vf.pricePerSqft != null) {
          const currentPpsCtx = String(pa.price_per_sqft_context || '');
          const isMissingPps = !currentPpsCtx
            || /no price.*per.*sqft|missing price.*sqft|price.*sqft.*not.*avail|not.*price.*sqft|n\/a.*price|n\/a.*sqft/i.test(currentPpsCtx);
          if (isMissingPps) {
            const legalSuffix = isSFOC
              ? 'Comparable sales and property condition should be verified independently'
              : 'Local comps, legal rental status, and property condition should be verified';
            pa.price_per_sqft_context =
              `Price per sqft: ${vf.pricePerSqft_display || '$' + vf.pricePerSqft}/sqft. ` +
              legalSuffix + '.';
          }
        }

        // ── price_assessment: rent_context (US rent) ──
        if (pa && reportMode === 'rent' && vf.rentZestimate != null && !pa.rent_context) {
          pa.rent_context =
            `Rent Zestimate: ${vf.rentZestimate_display || '$' + vf.rentZestimate.toLocaleString()}/mo. ` +
            `Actual rental income must be verified with the owner/agent.`;
        }

        // ── price_assessment: days_on_market_context ──
        if (pa && vf.daysOnMarket != null && !pa.days_on_market_context) {
          pa.days_on_market_context =
            `${vf.daysOnMarket} days on market. ` +
            `Market timing alone does not explain value. Confirm local comps, property condition, permit status, and buyer feedback with the agent before treating time on market as a pricing signal.`;
        }

        // ── carrying_costs: deterministic fill for ALL US sale (not just Zillow sale) ──
        const isUS = detectedMarket === 'US';
        const shouldForceCC = isUS && reportMode === 'sale' &&
          (vf.monthlyPayment != null || vf.annualTax != null || vf.principalAndInterest != null);

        if (shouldForceCC && cc) {
          if (vf.monthlyPayment != null) {
            cc.primary_monthly_estimate = vf.monthlyPayment;
            cc.status = 'available';
          }
          if (vf.principalAndInterest != null) {
            cc.principal_and_interest = vf.principalAndInterest;
          }
          if (vf.annualTax != null) {
            cc.annual_tax = vf.annualTax;
            if (vf.annualTax_display) cc.annual_tax_display = vf.annualTax_display;
            cc.monthly_tax_equivalent = Math.round(vf.annualTax / 12);
          }
          if (vf.homeInsuranceMonthly != null) {
            cc.home_insurance = vf.homeInsuranceMonthly;
          }
          // HOA
          if (vf.hoa === 'yes') {
            cc.hoa = 'Yes';
            if (vf.hoaAmount != null) cc.hoa_amount = vf.hoaAmount;
          } else if (vf.hoa === 'no') {
            cc.hoa = 'No';
          }
          // missing_costs: always include these regardless of what AI said
          const missing: string[] = [];
          if (vf.hoa !== 'yes' && vf.hoaAmount == null) missing.push('hoa');
          if (vf.homeInsuranceMonthly == null) missing.push('insurance_actual_quote');
          if (vf.utilitiesIncluded !== true) missing.push('utilities');
          missing.push('maintenance_reserve', 'vacancy', 'repairs', 'rental_compliance');
          if (missing.length > 0) cc.missing_costs = missing;
          // summary
          if (cc.primary_monthly_estimate != null && !cc.summary) {
            cc.summary =
              `Monthly carrying costs: $${cc.primary_monthly_estimate}/mo. ` +
              `Missing: ${missing.join(', ')}.`;
          }
          if (!cc.cost_pressure || cc.cost_pressure === 'unknown') {
            cc.cost_pressure = vf.annualTax != null ? 'Known Tax / Partial Costs' : 'Partial Costs';
          }
        }

        // ── Error detection: log AI contradictions ──
        const reportText = JSON.stringify(res).toLowerCase();
        if (vf.yearBuilt != null && /year.?built.*unknown|unknown.*year.?built/.test(reportText)) {
          console.warn('[validateReport] AI claimed yearBuilt unknown but vf.yearBuilt =', vf.yearBuilt);
        }
        // Fix "Year built unknown" in maintenance_risk.summary when we know the year
        if (vf.yearBuilt != null && res.maintenance_risk && typeof res.maintenance_risk === 'object') {
          const mr = res.maintenance_risk as Record<string, unknown>;
          const yrStr = String(vf.yearBuilt);
          const yrBuiltUnknownPattern = /year\s*built\s*(is\s*)?(unknown|not\s*provided|not\s*available|n\/a)/gi;
          if (mr.summary && typeof mr.summary === 'string') {
            mr.summary = mr.summary.replace(yrBuiltUnknownPattern, `Year built: ${yrStr}`);
          }
          // Also fix risk_factors array
          if (Array.isArray(mr.risk_factors)) {
            for (const rf of mr.risk_factors) {
              if (rf && typeof rf === 'object') {
                const rft = rf as Record<string, unknown>;
                if (rft.description && typeof rft.description === 'string') {
                  rft.description = rft.description.replace(yrBuiltUnknownPattern, `Year built: ${yrStr}`);
                }
                if (rft.title && typeof rft.title === 'string') {
                  rft.title = rft.title.replace(yrBuiltUnknownPattern, `Year built: ${yrStr}`);
                }
              }
            }
          }
        }
        if (vf.zestimate != null && /no zestimate|without zestimate|missing zestimate/.test(reportText)) {
          console.warn('[validateReport] AI claimed no Zestimate but vf.zestimate =', vf.zestimate);
        }
        if (vf.pricePerSqft != null && /no price.*per.*sqft|missing price.*sqft/.test(reportText)) {
          console.warn('[validateReport] AI claimed no pricePerSqft but vf.pricePerSqft =', vf.pricePerSqft);
        }
        if (vf.monthlyPayment != null && /monthly.*payment.*unknown|unknown.*monthly.*payment/.test(reportText)) {
          console.warn('[validateReport] AI claimed unknown monthly payment but vf.monthlyPayment =', vf.monthlyPayment);
        }

        // ── Spin Decoder: rewrite overly confident language to conservative ──
        if (res.listing_language_reality_check && Array.isArray(res.listing_language_reality_check)) {
          const OVERCONFIDENT_PATTERNS: Array<{ from: RegExp; to: string }> = [
            { from: /registered with (nyc |new york )?hpd/i, to: 'HPD registration should be verified' },
            { from: /should allow rental use/i, to: 'rental legality should be verified' },
            { from: /no probate delays expected/i, to: 'probate delays cannot be ruled out without title review' },
            { from: /has its own (entrance|utilities)/i, to: 'entrance and utility setup should be verified' },
          ];
          for (const item of res.listing_language_reality_check) {
            if (item.what_it_may_mean) {
              for (const { from, to } of OVERCONFIDENT_PATTERNS) {
                if (from.test(item.what_it_may_mean)) {
                  item.what_it_may_mean = item.what_it_may_mean.replace(from, to);
                }
              }
            }
          }
        }

        // ── Spin Decoder: filter out MLS-only phrases (no real listing language) ──
        if (res.listing_language_reality_check && Array.isArray(res.listing_language_reality_check)) {
          const MLS_ONLY_PATTERNS = [
            /source\s*:/i, /mls\s*#?\s*\d/i, /deemed\s+reliable/i,
            /subject\s+to\s+prior\s+sale/i, /idx\s+program/i, /idx\s+information/i,
            /information\s+should\s+be\s+independently/i,
            /streeteasy\s+source/i, /listing\s+data\s+last\s+updated/i,
            /supplied\s+open\s+house\s+information/i,
            /properties\s+may\s+or\s+may\s+not\s+be\s+listed/i,
          ];

          const filtered = (res.listing_language_reality_check as Array<{ phrase?: unknown }>).filter(item => {
            const phrase = (String(item.phrase ?? '')).toLowerCase();
            // Keep only entries whose phrase is NOT purely MLS disclaimer
            const allMls = MLS_ONLY_PATTERNS.every(p => !p.test(phrase));
            return allMls;
          });

          // Update with filtered result; if empty, clear so UI hides the section
          res.listing_language_reality_check = filtered as unknown;
        }

        // ── Text-level: scan entire report for "assume pre-1980s" and force replace ──
        // This catches cases where AI writes unsupported old-system claims without evidence.
        // Patterns: "assume pre-1980s", "galvanized steel", "knob-and-tube", "fire hazard".
        // Replacement: a conservative, evidence-free statement.
        const cleanReplacement = `Built in ${vf.yearBuilt ?? 'the property'}. Older property, so electrical panel, wiring, plumbing, heating, roof age, and basement moisture history should be verified before estimating repair costs.`;
        const UNSUPPORTED_OLD_SYSTEM_PATTERNS = [
          // Full pre-1980s assumption phrases (match first to avoid partial matches)
          { pattern: /year\s*built\s*(?:not\s*)?(?:provided|given|found|known|available).*pre-?1980s|assume\s*pre-?1980s|assuming\s*pre-?1980s/i,
            clean: cleanReplacement },
          // Independent galvanized steel claims (not preceded by "assume pre-1980s")
          { pattern: /galvanized\s*steel(?!\s*(?:\/|:)\s*(?:assume|pre-?1980s|knob))/i,
            clean: 'older plumbing material' },
          // Independent knob-and-tube claims
          { pattern: /knob[\s-]*and[\s-]*tube(?!\s*(?:\/|:)\s*(?:assume|pre-?1980s|galvanized))/i,
            clean: 'older electrical wiring' },
          // Fire hazard without evidence (e.g., "may be a fire hazard" / "potential fire hazard")
          { pattern: /fire\s*hazard(?!\s+(?:from|due to|caused by|as\s+a\s+result))/i,
            clean: 'older electrical systems' },
          // "original wiring confirmed" / "original plumbing confirmed" — no evidence
          { pattern: /original\s*(?:wiring|plumbing)\s*(?:is\s*)?(?:confirmed|present|found|intact)/i,
            clean: 'original systems' },
          // "full rewiring may be needed" / "full re-plumbing may be needed"
          { pattern: /full\s*(?:rewiring|replumb|re-plumb)(?:\s+may\s+be\s+needed|\s+is\s+likely|\s+probably\s+needed)/i,
            clean: 'electrical updates may be needed' },
        ];
        const UNSUPPORTED_OLD_SYSTEM_REPORT_PATTERN = new RegExp(
          UNSUPPORTED_OLD_SYSTEM_PATTERNS.map(p => p.pattern.source).join('|'),
          'i'
        );
        if (UNSUPPORTED_OLD_SYSTEM_REPORT_PATTERN.test(JSON.stringify(res).toLowerCase())) {
          (res as any)._validation_fixed = true;
          const replaceUnsupported = (obj: any, depth = 0) => {
            if (depth > 10 || !obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              if (typeof val === 'string') {
                for (const { pattern, clean } of UNSUPPORTED_OLD_SYSTEM_PATTERNS) {
                  if (pattern.test(val)) {
                    obj[key] = val.replace(pattern, clean);
                    console.log('[validateReport] Replaced unsupported old-system claim matching pattern:', pattern.source, 'in field:', key);
                  }
                }
              } else if (Array.isArray(val)) {
                for (const item of val) replaceUnsupported(item, depth + 1);
              } else if (typeof val === 'object') {
                replaceUnsupported(val, depth + 1);
              }
            }
          };
          replaceUnsupported(res);
        }

        // ── Text-level: scan for "missing basic property details" questions and remove if fields are known ──
        const basicFieldsKnown = vf.beds != null && vf.baths != null && vf.sqft != null && vf.propertyType != null;
        if (basicFieldsKnown) {
          const removeBasicPropertyQuestion = (obj: any, depth = 0) => {
            if (depth > 10 || !obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              if (typeof val === 'string') {
                if (/missing\s*basic\s*property\s*details|provide.*beds?\s*[,\/]\s*baths?\s*[,\/]\s*(?:interior\s*)?size|property\s*type.*beds.*baths.*interior.*size/i.test(val)) {
                  obj[key] = null;
                  console.log('[validateReport] Removed "missing basic property details" question, field:', key);
                }
              } else if (Array.isArray(val)) {
                // Filter out questions that are entire array items
                if (key === 'questions' || key === 'questions_to_ask') {
                  const filtered = val.filter((q: any) => {
                    const qText = typeof q === 'string' ? q : (q?.question || q?.text || JSON.stringify(q));
                    return !/missing\s*basic\s*property\s*details|provide.*beds?\s*[,\/]\s*baths?\s*[,\/]\s*(?:interior\s*)?size|property\s*type.*beds.*baths.*interior.*size/i.test(qText);
                  });
                  if (filtered.length !== val.length) {
                    obj[key] = filtered;
                    console.log('[validateReport] Filtered basic property detail questions, removed:', val.length - filtered.length);
                  }
                } else {
                  for (const item of val) removeBasicPropertyQuestion(item, depth + 1);
                }
              } else if (typeof val === 'object') {
                removeBasicPropertyQuestion(val, depth + 1);
              }
            }
          };
          removeBasicPropertyQuestion(res);
        }

        console.log('[validateReport] done', {
          yearBuilt: vf.yearBuilt,
          zestimate: vf.zestimate,
          pricePerSqft: vf.pricePerSqft,
          monthlyPayment: vf.monthlyPayment,
          basicFieldsKnown,
        });
      })(verifiedFacts, result);

      // ── Step 6: Post-processing — force-fill financial facts (deterministic) ─────
      // If verifiedFacts has annual tax, NEVER let AI output "annual tax unknown"
      const cc = result.carrying_costs as Record<string, unknown> | undefined;
      if (cc && verifiedFacts.annual_tax != null) {
        // Force annual_tax
        cc.annual_tax = verifiedFacts.annual_tax;
        if (verifiedFacts.annual_tax_display) {
          cc.annual_tax_display = verifiedFacts.annual_tax_display;
        }
        // Remove property-tax-only items from missing_costs
        // Only remove items that are explicitly about property tax, NOT generic "annual" items
        const missing = Array.isArray(cc.missing_costs) ? cc.missing_costs : [];
        cc.missing_costs = missing.filter((m: unknown) => {
          if (typeof m !== 'string') return true;
          const lower = m.toLowerCase();
          // Only match items that explicitly describe property tax — not generic "annual" costs
          const isPropertyTax = lower.includes('annual property tax')
            || lower.includes('property tax')
            || lower.includes('annual tax')
            || lower.includes('tax bill')
            || lower.includes('real estate tax');
          return !isPropertyTax;
        });
        // Fix summary if AI says unknown
        const summary = String(cc.summary || '');
        const unknownPatterns = [
          /annual\s+tax\s+(and\s+)?(hoa\s+)?unknown/gi,
          /property\s+tax\s+unknown/gi,
          /annual\s+and\s+hoa\s+(status\s+)?unknown/gi,
        ];
        if (unknownPatterns.some(p => p.test(summary))) {
          const hoaPart = (od.hoaFee ? `HOA fee is $${od.hoaFee}/mo.` : 'HOA status is not provided on this listing.');
          cc.summary = `Annual property tax is ${verifiedFacts.annual_tax_display}. ${hoaPart} Budget separately for insurance, utilities, maintenance reserves and financing costs.`;
        }
        // Fix cost_pressure: don't infer Low/High from absolute amount (varies by state).
        // If we have both tax and assessed value, compute effective tax rate for context.
        if ((cc.cost_pressure === 'Unknown' || cc.cost_pressure === 'unknown') && verifiedFacts.annual_tax != null) {
          if (verifiedFacts.tax_assessed_value != null && verifiedFacts.tax_assessed_value > 0) {
            const rate = ((verifiedFacts.annual_tax / verifiedFacts.tax_assessed_value) * 100).toFixed(2);
            cc.cost_pressure = 'Known Tax / Partial Costs';
            cc.tax_rate_percent = parseFloat(rate);
          } else {
            cc.cost_pressure = 'Known Tax / Partial Costs';
          }
        }
        // Ensure tax context in price_assessment
        if (verifiedFacts.tax_assessed_value != null || verifiedFacts.annual_tax != null) {
          const pa = result.price_assessment as Record<string, unknown> | undefined;
          if (pa && !pa.tax_context) {
            if (verifiedFacts.tax_assessed_value != null && verifiedFacts.annual_tax != null) {
              const rate = ((verifiedFacts.annual_tax / verifiedFacts.tax_assessed_value) * 100).toFixed(2);
              pa.tax_context = `Tax assessed value: ${verifiedFacts.tax_assessed_value_display}. Annual property tax: ${verifiedFacts.annual_tax_display} (effective rate: ${rate}%).`;
            } else if (verifiedFacts.annual_tax != null) {
              pa.tax_context = `Annual property tax: ${verifiedFacts.annual_tax_display}. Tax assessed value not disclosed.`;
            }
          }
        }
      }

      // If verifiedFacts has tax assessed value, add to property_snapshot
      const ps = result.property_snapshot as Record<string, unknown> | undefined;
      if (ps && verifiedFacts.tax_assessed_value != null) {
        ps.tax_assessed_value = verifiedFacts.tax_assessed_value;
        if (verifiedFacts.tax_assessed_value_display) {
          ps.tax_assessed_value_display = verifiedFacts.tax_assessed_value_display;
        }
      }

      // If verifiedFacts has price per sqft, add to property_snapshot or price_assessment
      if (verifiedFacts.price_per_sqft != null) {
        if (ps) {
          ps.price_per_sqft = verifiedFacts.price_per_sqft;
          if (verifiedFacts.price_per_sqft_display) {
            ps.price_per_sqft_display = verifiedFacts.price_per_sqft_display;
          }
        }
        const pa = result.price_assessment as Record<string, unknown> | undefined;
        if (pa) {
          pa.price_per_sqft = verifiedFacts.price_per_sqft;
          if (verifiedFacts.price_per_sqft_display) {
            pa.price_per_sqft_display = verifiedFacts.price_per_sqft_display;
          }
        }
      }

      // If verifiedFacts has date listed or available date, add to property_snapshot
      if (ps) {
        if (verifiedFacts.date_listed) ps.date_listed = verifiedFacts.date_listed;
        if (verifiedFacts.available_date) ps.available_date = verifiedFacts.available_date;
      }

      console.log('[Analyze] post-processed carrying_costs', {
        annual_tax: (result.carrying_costs as any)?.annual_tax,
        missing_costs: (result.carrying_costs as any)?.missing_costs,
        summary: (result.carrying_costs as any)?.summary,
        cost_pressure: (result.carrying_costs as any)?.cost_pressure,
        primary_monthly_estimate: (result.carrying_costs as any)?.primary_monthly_estimate,
        status: (result.carrying_costs as any)?.status,
      });

      console.log('[Analyze] FINAL carrying_costs before DB save', JSON.stringify(result.carrying_costs, null, 2));

      console.log('[REPORT_FINAL_FACTS]', {
        askingPrice: (result as any).price_assessment?.asking_price,
        yearBuilt: (result as any).property_snapshot?.yearBuilt ?? (result as any).property_snapshot?.year_built,
        beds: (result as any).property_snapshot?.beds,
        baths: (result as any).property_snapshot?.baths,
        sqft: (result as any).property_snapshot?.sqft,
        priceVerdict: (result as any).price_assessment?.verdict,
      });

      console.log('[PHOTO_ANALYSIS_FINAL]', {
        hasPhotoAnalysis: !!((result as any).photo_analysis ?? (result as any).photoAnalysis),
        areas: (((result as any).photo_analysis ?? (result as any).photoAnalysis)?.areas ?? []).map((a: any) => ({
          area: a.area,
          strengths: Array.isArray(a.strengths) ? a.strengths.length : 0,
          concerns: Array.isArray(a.concerns ?? a.visualConcerns) ? (a.concerns ?? a.visualConcerns).length : 0,
          missingViews: Array.isArray(a.missingViews ?? a.missingEvidence) ? (a.missingViews ?? a.missingEvidence).length : 0,
          buyerTakeaway: !!a.buyerTakeaway,
        })),
      });

      // ── FINAL deterministic overwrite: price_assessment.asking_price ──────────────
      // Source of truth: body.optionalDetails.askingPrice from Zillow extraction.
      // Must survive even if AI hallucinated 0 or null.
      const finalAskingPrice = firstValidPrice(
        (result as any)?.price_assessment?.asking_price,
        (normalizedDecision as any)?.price_assessment?.asking_price,
        (body as any)?.optionalDetails?.askingPrice,
        (body as any)?.optionalDetails?.price,
        (body as any)?.price,
      );
      if (reportMode === 'sale' && finalAskingPrice != null) {
        (result as any).price_assessment = {
          estimated_min: (result as any).price_assessment?.estimated_min ?? null,
          estimated_max: (result as any).price_assessment?.estimated_max ?? null,
          asking_price: finalAskingPrice,
          verdict: (result as any).price_assessment?.verdict || (finalAskingPrice != null ? 'Needs Comps' : 'Unknown'),
          explanation: (result as any).price_assessment?.explanation || '',
          tax_context: (result as any).price_assessment?.tax_context || '',
          price_per_sqft_context: (result as any).price_assessment?.price_per_sqft_context || '',
          valuation_confidence: (result as any).price_assessment?.valuation_confidence || 'Low',
          missing_data: (result as any).price_assessment?.missing_data || [],
        };
      }

      // ── FINAL deterministic overwrite: carrying_costs from Zillow financials ──────
      // Only overwrite if we have real Zillow data; do not use || to avoid AI's unknown object blocking.
      if (isZillowSale && zillowFinancials) {
        const zf = zillowFinancials as any;
        const monthlyPayment = zf.monthlyPayment || {};
        const financialDetails = zf.financialDetails || {};
        const estimatedPayment = monthlyPayment.estimatedMonthlyPayment;

        const deterministicCC: Record<string, unknown> = { status: 'unknown' };

        if (estimatedPayment?.value != null) {
          deterministicCC.status = 'available';
          deterministicCC.primary_monthly_estimate = estimatedPayment.value;
          deterministicCC.monthly_breakdown = {
            estimatedMonthlyPayment: estimatedPayment,
            principalAndInterest: monthlyPayment.principalAndInterest ?? null,
            mortgageInsurance: monthlyPayment.mortgageInsurance ?? null,
            propertyTaxes: monthlyPayment.propertyTaxes ?? null,
            homeInsurance: monthlyPayment.homeInsurance ?? null,
            hoaFees: monthlyPayment.hoaFees ?? null,
            utilities: monthlyPayment.utilities ?? null,
          };
        } else if (zf.derived?.knownMonthlyTotal?.value > 0) {
          deterministicCC.status = 'available';
          deterministicCC.primary_monthly_estimate = zf.derived.knownMonthlyTotal.value;
        } else if (zf.topEstimatedPayment?.value != null) {
          deterministicCC.status = 'partial';
          deterministicCC.primary_monthly_estimate = zf.topEstimatedPayment.value;
        }

        if (deterministicCC.status !== 'unknown') {
          // HOA
          if (monthlyPayment.hoaFees?.status === 'not_applicable') {
            deterministicCC.hoa = 'No';
          } else if (monthlyPayment.hoaFees?.value != null) {
            deterministicCC.hoa = 'Yes';
            deterministicCC.hoa_amount = monthlyPayment.hoaFees.value;
          }
          // Annual tax
          if (financialDetails.annualTaxAmount?.value != null) {
            deterministicCC.annual_tax = financialDetails.annualTaxAmount.value;
            deterministicCC.monthly_tax_equivalent = Math.round(financialDetails.annualTaxAmount.value / 12);
          }
          // Summary
          deterministicCC.cost_pressure = 'Known Costs';
          deterministicCC.summary =
            `Monthly carrying costs: $${deterministicCC.primary_monthly_estimate}/mo. ` +
            `Breakdown available from Zillow.`;
          // Overwrite AI's unknown object
          result.carrying_costs = deterministicCC as any;
        }
      }

      // ── Debug logs ──────────────────────────────────────────────────────────────
      console.log('[FINAL_BEFORE_SAVE][price_assessment]', {
        asking_price: (result as any)?.price_assessment?.asking_price,
        optionalAskingPrice: (body as any)?.optionalDetails?.askingPrice,
        bodyPrice: (body as any)?.price,
        bodyOptionalPrice: (body as any)?.optionalDetails?.price,
        normalizedDecisionPrice: (normalizedDecision as any)?.price_assessment?.asking_price,
      });
      console.log('[FINAL_BEFORE_SAVE][carrying_costs]', {
        status: (result as any)?.carrying_costs?.status,
        primaryMonthlyEstimate:
          (result as any)?.carrying_costs?.primary_monthly_estimate?.value ||
          (result as any)?.carrying_costs?.primary_monthly_estimate,
        hasMonthlyBreakdown: !!(result as any)?.carrying_costs?.monthly_breakdown,
        isZillowSale,
        hasZillowFinancials: !!zillowFinancials,
      });

      // Update state before building final report
      await updateAnalysisState(id, {
        stage: "building_final_report",
        message: "Building final report...",
        progress: 90,
      });

      // Final state update
      await updateAnalysisState(id, {
        stage: "done",
        message: "Analysis complete!",
        progress: 100,
        status: "done",
        result,
      });

      // Update analysis record in analyses table
      // Add analysisType to the full_result so frontend can identify full reports
      const fullResultWithType = {
        ...(result as Record<string, unknown>),
        analysisType: 'full',
      };
      await updateAnalysisRecord(
        id,
        result.overallScore,
        result.verdict,
        {
          quickSummary: result.quickSummary,
          whatLooksGood: result.whatLooksGood,
          riskSignals: result.riskSignals,
        },
        fullResultWithType,
        reportMode // 传递 reportMode 以同步到数据库
      );

      // Analysis succeeded - complete the credit usage
      await completeCredits(currentUser.id, usageId);

      console.log("=== Analysis complete, credits deducted ===");

      return jsonResponse({ ok: true, id });

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      console.error("===================");
      console.error("Analysis error:", err.message);
      console.error("===================");

      // Analysis failed - release the reserved credit
      await releaseCredits(currentUser.id, usageId);
      console.log("=== Analysis failed, credits released ===");

      await updateAnalysisState(id, {
        stage: "failed",
        message: err.message || "Analysis failed",
        progress: 100,
        status: "failed",
        error: err.message,
      });

      // Mark analysis as failed in analyses table
      await failAnalysisRecord(id, err.message);

      return jsonResponse({ 
        message: "Analysis failed",
        error: err.message 
      }, 500);
    }
  }

  return jsonResponse({ message: "Invalid action" }, 400);
});
