// ===== Fallbacks — 统一 fallback 文案库 =====
// 所有前端展示层的 fallback 文案集中管理，分为：
// A. 模块级 fallback
// B. Deal-Changing Risk Action Fallback
// C. Questions 动态生成函数
// D. Listing Claims Fallbacks
// E. Property-Type-Specific Risk Action Fallbacks
// F. Property-Type-Specific Question Fallback Generators
// G. Question Suppression by Property Type

// ── A. 模块级 fallback ────────────────────────────────────────────────────────

export const MODULE_FALLBACKS = {
  HERO_BOTTOM_LINE: 'This listing provides some useful basic signals, but several important decision details are still missing or unverified.',
  HERO_NEXT_BEST_MOVE_DEFAULT: 'Request additional details and verify key risks before your next step.',
  PRICE_ANALYSIS_UNKNOWN: 'Price cannot be judged confidently from the available data.',
  PRICE_ANALYSIS_OVERPRICED: 'The asking price appears high relative to visible condition, market time, or unverified assumptions.',
  PRICE_ANALYSIS_FAIR: 'Asking price may be within a plausible range for this property type and location, but verify with comparable sales before treating it as a fair deal.',
  PRICE_ANALYSIS_GOOD_VALUE: 'The asking price may be attractive relative to visible condition and market data, but confirm with comps.',
  CARRYING_COSTS_NO_DATA: 'Monthly cost estimate is not available from the current listing data. Ask the agent or listing agent for Zillow estimated monthly payment, property tax amount, HOA fees, and insurance estimate.',
  CARRYING_COSTS_WARNING: 'Full cost assumptions are not available. Treat this as a rough planning number only. Financing terms, insurance, repairs, utilities, vacancy, and maintenance reserves may not be included.',
  PHOTO_COVERAGE_LIMITED: 'Photo coverage is limited. Ask for additional photos before viewing.',
  PHOTO_COVERAGE_REASONABLE: 'Photo coverage looks reasonable, but still verify condition in person.',
  PHOTO_MISSING_INTERIOR: 'Only exterior photos were available. Interior condition could not be assessed.',
  PHOTO_LIMITED_CONDITION: 'Interior photos are available, but basement, kitchen, bathroom, roof, and mechanical systems still require verification.',
  FIT_NOT_IDEAL_DEFAULT: 'Verify key risks and conduct a full inspection before committing.',
  FIT_BEST_FOR_DEFAULT: 'Buyers who prioritize location and are willing to invest in verification.',
} as const;

// ── B. Deal-Changing Risk Action Fallback ─────────────────────────────────────

export const RISK_ACTION_FALLBACKS = {
  maintenance: 'Ask for the roof age, boiler age, electrical panel details, plumbing history, HVAC condition, and recent repair records before viewing. Also inspect basement cracks, drainage, moisture intrusion, and foundation condition.',
  // SFOC variant — for single-family owner-occupier profiles
  legal_sfoc_nyc: 'Ask for the Certificate of Occupancy and check NYC DOB records and permits for recent renovations before making an offer.',
  legal_sfoc_general: 'Ask for legal-use documents, permits for recent updates, and check local building department or county records before making an offer.',
  // Multi-family / rental variant — includes rental income verification
  legal_nyc: 'Ask for the Certificate of Occupancy and check NYC DOB, HPD, and ACRIS records before relying on rental income or making an offer.',
  legal_general: 'Ask for the Certificate of Occupancy and check local building department and county records before relying on rental income or making an offer.',
  environmental_nyc: 'Check FEMA flood maps, NYC flood maps, basement water history, and insurance quotes before estimating monthly costs.',
  environmental_general: 'Check local flood maps, FEMA flood maps, and basement water history before estimating monthly costs.',
  price: 'Request recent comparable sales and active listings within 0.5 miles to justify the asking price.',
  market: 'Ask the listing agent why the property has been on market this long and whether there have been any offers or price reductions.',
  default: 'Verify this risk with a licensed inspector and relevant public records before making any commitment.',
} as const;

// ── C. Questions 动态生成函数（替代旧静态 fallback 列表）───────────────
// Basic 模式下的 fallback 问题按已知字段动态生成，不再使用静态列表。
// 调用 buildBasicQuestionFallbacks(context) 来获取 fallback 问题。

export interface BasicQuestionContext {
  hasPrice: boolean;
  hasBeds: boolean;
  hasBaths: boolean;
  hasSqft: boolean;
  hasPropertyType: boolean;
  hasCondition: boolean;
  hasLegalUse: boolean;
  hasCosts: boolean;
  hasComps: boolean;
  hasZillowMonthly: boolean;
  isUS: boolean;
  isAU: boolean;
  /** reportProfile drives which questions to show (legacy, use normalizedPropertyCategory for new code) */
  reportProfile?: string;
  /** Canonical property-type category for routing to type-specific questions */
  normalizedPropertyCategory?: string;
}

/**
 * 从 what_we_know 结构中提取已知字段状态。
 * 兼容 snake_case 和 camelCase 字段名。
 */
export function extractKnownFacts(wwKnow: any): Omit<BasicQuestionContext, 'isUS' | 'isAU' | 'normalizedPropertyCategory'> {
  const has = (v: unknown) => v != null && v !== '';
  return {
    hasPrice:        has(wwKnow?.asking_price ?? wwKnow?.askingPrice ?? wwKnow?.price),
    hasBeds:         has(wwKnow?.beds ?? wwKnow?.bedrooms),
    hasBaths:        has(wwKnow?.baths ?? wwKnow?.bathrooms),
    hasSqft:         has(wwKnow?.sqft ?? wwKnow?.square_feet ?? wwKnow?.squareFeet ?? wwKnow?.floor_area),
    hasPropertyType: has(wwKnow?.property_type ?? wwKnow?.propertyType ?? wwKnow?.home_type ?? wwKnow?.homeType),
    // condition 来自 photo analysis 信号
    hasCondition:    false,
    // legal use — 检查 whats_missing 中是否有相关 gap
    hasLegalUse:     false,
    // costs — 检查是否有 tax/insurance/HOA 数据
    hasCosts:        has(wwKnow?.taxes ?? wwKnow?.annual_tax ?? wwKnow?.insurance ?? wwKnow?.hoa),
    // comps — 检查是否有 comparable sales 数据
    hasComps:        has(wwKnow?.comparable_sales ?? wwKnow?.comparableSales ?? wwKnow?.zestimate),
  };
}

/** Extended context including the new normalizedPropertyCategory field */
export type ExtendedBasicQuestionContext = BasicQuestionContext & {
  normalizedPropertyCategory?: string;
};

/**
 * 按已知/未知字段动态生成 Basic 模式的 fallback 问题。
 * normalizedPropertyCategory / reportProfile 控制是否显示 multi-family/rental 相关问题：
 * - co_op: co-op-specific questions (board, sublet, maintenance, assessments, financing)
 * - single_family: SF-specific questions (roof, boiler, electrical, CO, permits)
 * - multi_family: MF-specific questions (CO, rent roll, leases, rent stabilization)
 * - condo: condo-specific questions (common charges, reserves, rental limits)
 * - townhouse: townhouse-specific questions (HOA, exterior, parking)
 * - land: land-specific questions (zoning, utilities, survey, flood zone)
 * - manufactured: manufactured-specific questions (land ownership, park rules, HUD)
 * - unknown / fallback: generic questions
 *
 * If normalizedPropertyCategory is available, use it; otherwise fall back to reportProfile.
 */
export function buildBasicQuestionFallbacks(ctx: BasicQuestionContext & { normalizedPropertyCategory?: string }): Array<{ text: string; category: string; tagColor: string }> {
  const { hasPrice, hasBeds, hasBaths, hasSqft, hasPropertyType, hasCondition, hasLegalUse, hasCosts, hasComps, hasZillowMonthly, isUS, isAU, reportProfile, normalizedPropertyCategory } = ctx;
  const effectiveCategory = normalizedPropertyCategory ?? reportProfile ?? 'unknown';

  // Route to property-type-specific generators
  switch (effectiveCategory) {
    case 'co_op':
      return buildCoopQuestionFallbacks();
    case 'single_family':
    case 'single_family_owner_occupier':
      return buildSingleFamilyQuestionFallbacks();
    case 'multi_family':
      return buildMultiFamilyQuestionFallbacks();
    case 'condo':
      return buildCondoQuestionFallbacks();
    case 'townhouse':
      return buildTownhouseQuestionFallbacks();
    case 'land':
      return buildLandQuestionFallbacks();
    case 'manufactured':
      return buildManufacturedQuestionFallbacks();
    default: {
      // Generic fallback for 'unknown' or 'apartment'
      const questions: Array<{ text: string; category: string; tagColor: string }> = [];

      // 1. Comparable Sales
      if (!hasComps || hasPrice) {
        questions.push({
          text: isUS
            ? 'Can you provide recent comparable sales to support the asking price?'
            : 'Can you provide recent comparable sales to support the asking price?',
          category: 'Price',
          tagColor: 'bg-amber-100 text-amber-700',
        });
      }

      // 2. Legal Use / Certificate of Occupancy
      if (!hasLegalUse) {
        questions.push({
          text: isUS
            ? 'Can you provide the Certificate of Occupancy or legal-use documents?'
            : 'Can you provide official documents confirming the approved use of the property?',
          category: 'Legal',
          tagColor: 'bg-violet-100 text-violet-700',
        });
      }

      // 3. Costs
      if (hasZillowMonthly) {
        questions.push({
          text: isUS
            ? 'Can you provide the actual insurance quote, average utility costs, and any owner-paid expenses beyond the Zillow estimate?'
            : 'Can you confirm whether the estimated costs are accurate for this property?',
          category: 'Costs',
          tagColor: 'bg-teal-100 text-teal-700',
        });
      } else if (!hasCosts) {
        questions.push({
          text: isUS
            ? 'Can you provide the actual insurance quote, average utility costs, and any owner-paid expenses beyond the listed taxes and HOA?'
            : 'What are the council rates, strata fees, insurance, and other ongoing costs?',
          category: 'Costs',
          tagColor: 'bg-teal-100 text-teal-700',
        });
      }

      // 4. Beds / Baths / Sqft
      const allBasicKnown = hasBeds && hasBaths && hasSqft && hasPropertyType;
      if (!allBasicKnown) {
        questions.push({
          text: isUS
            ? 'Can you confirm whether the listed property details match public records and the Certificate of Occupancy?'
            : 'Can you confirm whether the listed property details match official records?',
          category: isUS ? 'Public Records' : 'Records',
          tagColor: 'bg-violet-100 text-violet-700',
        });
      }

      // 5. Property Condition
      if (!hasCondition) {
        questions.push({
          text: 'Can you provide more detail on the property condition, repairs, renovations, or major system updates, if any?',
          category: 'Condition',
          tagColor: 'bg-orange-100 text-orange-700',
        });
      }

      // 6. Open violations (US)
      if (isUS) {
        questions.push({
          text: 'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?',
          category: 'Legal',
          tagColor: 'bg-violet-100 text-violet-700',
        });
      }

      return questions;
    }
  }
}

/**
 * 已废弃的静态 fallback 列表。
 * 仅保留用于非 Basic 模式的 Deep 报告 fallback。
 * Basic 模式应使用 buildBasicQuestionFallbacks()。
 * Deep 模式请在 NewReportUI 中使用 getFallbackQuestions()（支持 reportProfile 参数）。
 * @deprecated Basic 模式请使用 buildBasicQuestionFallbacks()
 */
export const QUESTION_FALLBACKS_BASIC = [
  'Can you confirm whether the listed property details match public records and legal-use documents?',
  'Can you provide the Certificate of Occupancy or legal-use documents?',
  'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?',
  'What are the estimated annual property taxes, insurance, and any HOA fees?',
  'Can you provide recent comparable sales to support the asking price?',
] as const;

/**
 * @deprecated Deep 模式的问题应使用 buildBasicQuestionFallbacks() 或 getFallbackQuestions()。
 * 这些函数支持 normalizedPropertyCategory 参数，可以根据房源类型返回不同的问题。
 */
export const QUESTION_FALLBACKS = [
  'How old are the roof, boiler, electrical panel, plumbing, and HVAC systems?',
  'Has the basement had water intrusion, flooding, mold, drainage issues, or foundation repairs?',
  'Can you provide recent comparable sales to support the asking price?',
  'What are the real monthly costs including insurance, utilities, repairs, vacancy, and maintenance reserve?',
  'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?',
  'Can you provide the Certificate of Occupancy or legal-use documents?',
] as const;

// ── D. Listing Claims Fallbacks ─────────────────────────────────────────────────
// 用于 Basic Report 的 "Listing Claims to Verify" 模块。
// 每个条目包含关键词模式（匹配 listing 文本）和对应的解码文案。
// Basic 模式不依赖图片，只基于 listing 文本提取 claims。

export const LISTING_CLAIM_FALLBACKS: Array<{
  keyword: RegExp;
  phrase: string;
  homeScopeCheck: string;
  askBeforeViewing: string;
}> = [
  {
    keyword: /legal 2-family|two.family|multi.family|rental.approved/i,
    phrase: 'LEGAL 2-FAMILY',
    homeScopeCheck: 'Listing-stated only. Confirm through Certificate of Occupancy and public records.',
    askBeforeViewing: 'Can you provide the Certificate of Occupancy or legal-use documents?',
  },
  {
    keyword: /\bTLC\b|needs work|needs updating|needs renovation|needs repair/i,
    phrase: 'Needs TLC',
    homeScopeCheck: 'This may mean repairs, renovations, or system updates are needed.',
    askBeforeViewing: 'Are any repairs, renovations, or major system updates needed?',
  },
  {
    keyword: /\svacant\b|delivered vacant|tenant vacated/i,
    phrase: 'Delivered Vacant',
    homeScopeCheck: 'Vacant properties can have maintenance, security, insurance, or deterioration concerns.',
    askBeforeViewing: 'How long has it been vacant, and have utilities, heating, plumbing, and security been maintained?',
  },
  {
    keyword: /sold as.is|as.is\b|as is\b/i,
    phrase: 'Sold As-Is',
    homeScopeCheck: 'As-is sales typically indicate the seller will not make repairs or provide credits.',
    askBeforeViewing: 'Is the asking price reflective of the as-is condition, and are repairs needed before financing?',
  },
  {
    keyword: /motivated seller|price reduced|price drop|price adjustment/i,
    phrase: 'Motivated Seller / Price Reduced',
    homeScopeCheck: 'Price reductions may signal pricing concerns, condition issues, or weak demand.',
    askBeforeViewing: "Why has the price been reduced, and what is the seller's motivation?",
  },
];

// ── E. Property-Type-Specific Risk Action Fallbacks ─────────────────────────────

export const PROPERTY_TYPE_RISK_ACTIONS = {
  // ── Co-op ──────────────────────────────────────────────────────────────────
  coop_board: 'Ask about board approval requirements, application timeline, rejection history, and whether the building has a right of first refusal.',
  coop_sublet: 'Confirm the sublet policy — how many years of ownership before subletting is allowed, any limits on duration or number of times, and any fees involved.',
  coop_assessment: 'Ask about any current or upcoming special assessments, and review the last 3 years of financial statements and reserve fund balance.',
  coop_maintenance: 'Ask for the full monthly maintenance breakdown, what utilities are included, and whether there are any planned increases or special charges.',
  coop_financing: 'Confirm which financing types are allowed (conventional, FHA, co-op financing), minimum down payment requirements, and any acquisition fees or flip taxes.',
  coop_building: 'Ask about recent or upcoming roof, boiler, facade, elevator, plumbing, or electrical updates, and review the building\'s capital expenditure plan.',
  coop_reserve: 'Ask for the reserve fund balance and the building\'s financial statements for the last 2–3 years to assess fiscal health.',
  coop_walkup: 'Confirm whether the building is a walkup or has elevator access, and how this affects the unit\'s desirability and resale value.',

  // ── Condo ──────────────────────────────────────────────────────────────────
  condo_common_charges: 'Ask for the current common charges, any pending special assessments, and the reserve fund balance.',
  condo_rental_limits: 'Confirm whether the building has rental restrictions, age limits, or a right of first refusal on resales.',
  condo_litigation: 'Ask whether the HOA or building is currently involved in any litigation, and review the last 3 years of meeting minutes.',
  condo_reserves: 'Review the HOA\'s reserve study, reserve fund balance, and upcoming special assessments before submitting an offer.',
  condo_insurance: 'Confirm the building\'s master insurance policy coverage and whether unit-owner insurance is required.',
  condo_owner_occupancy: 'Ask about the current owner-occupancy ratio and any financing restrictions.',

  // ── Townhouse ────────────────────────────────────────────────────────────────
  townhouse_exterior: 'Clarify exterior maintenance responsibilities, roof responsibility, and any shared-wall or HOA obligations in the governing documents.',
  townhouse_hoa: 'Ask for the HOA documents, monthly fees, special assessments history, and what is covered by the HOA vs. the unit owner.',
  townhouse_parking: 'Confirm parking arrangements, whether assigned spots are deeded or rented, and any guest parking rules.',
  townhouse_insurance: 'Clarify insurance requirements — does the HOA carry a master policy, or is the unit owner solely responsible?',

  // ── Land ─────────────────────────────────────────────────────────────────────
  land_zoning: 'Verify zoning with the local planning department, confirm buildability for your intended use, and check for any overlay districts or use restrictions.',
  land_utilities: 'Confirm availability and cost of water, sewer, gas, and electric connections — off-grid alternatives may add significant cost.',
  land_survey: 'Request a current survey showing lot dimensions, boundaries, easements, encroachments, and FEMA flood zone designation.',
  land_flood: 'Check FEMA flood maps and confirm whether flood insurance is required — land in flood zones may be difficult to finance or insure.',
  land_env: 'Ask for any Phase I environmental report, well water tests, septic inspections, or records of prior use.',
  land_access: 'Confirm legal access to the property — frontage on a public road or recorded easement is required for most financing.',

  // ── Manufactured ─────────────────────────────────────────────────────────────
  manufactured_land: 'Clarify whether you own the land or rent the lot — lot rent, park rules, and lot rent increase limits are critical to total cost of ownership.',
  manufactured_park: 'Review the park\'s rules, age restrictions, pet policies, and any recent or pending park sales or rent increases.',
  manufactured_financing: 'Confirm financing options — many lenders have limited products for manufactured homes, especially if the land is not owned.',
  manufactured_title: 'Verify clear title and confirm the HUD tag / data plate is present — without these, resale may be difficult.',
  manufactured_foundation: 'Ask about the foundation type, when the home was installed, whether it was properly anchored, and if any renovation permits were pulled.',
  manufactured_hud: 'Confirm the HUD tag number and review the home\'s construction date, original installation, and any prior owners.',
} as const;

// ── F. Property-Type-Specific Question Fallback Generators ─────────────────────

type QuestionFallbackItem = { text: string; category: string; tagColor: string };

/** Co-op: board, sublet, maintenance, assessments, financing, building financials */
export function buildCoopQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'What is the monthly maintenance fee, and what does it include (taxes, utilities, insurance, heat, hot water)?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'Are there current or upcoming special assessments beyond the regular monthly maintenance?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'What are the board approval requirements, application process, and typical timeline for approval?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Is subletting allowed, and if yes, after how many years of ownership and under what limits or fees?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Is there a flip tax, and if so, how is it calculated and when is it due?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'What are the building\'s financials — reserve fund balance, any recent special assessments, and outstanding loans?',
      category: 'Financial',
      tagColor: 'bg-slate-100 text-slate-700',
    },
    {
      text: 'Are there financing restrictions or minimum down payment requirements beyond standard mortgage requirements?',
      category: 'Financing',
      tagColor: 'bg-blue-100 text-blue-700',
    },
    {
      text: 'Have there been recent roof, boiler, facade, elevator, plumbing, or electrical updates? What is the building\'s capital expenditure plan?',
      category: 'Condition',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'Why has this unit been on the market for so long? Have there been previous offers or board rejections?',
      category: 'Market Time',
      tagColor: 'bg-indigo-100 text-indigo-700',
    },
    {
      text: 'Are there owner-occupancy requirements, and what is the current owner-occupancy ratio in the building?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
  ];
}

/** Single-family: roof, boiler, electrical, plumbing, CO, permits, basement moisture, comps */
export function buildSingleFamilyQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'How old is the roof, and when was it last replaced or repaired?',
      category: 'Roof',
      tagColor: 'bg-amber-100 text-amber-700',
    },
    {
      text: 'How old is the boiler, water heater, and HVAC system? When were they last serviced?',
      category: 'Systems',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'What is the electrical panel amperage, and is it adequate for modern usage? Are there any known updates or upgrades?',
      category: 'Systems',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'What is the plumbing material (copper, galvanized, PEX), and how old is the plumbing system?',
      category: 'Systems',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'Can you provide the Certificate of Occupancy to confirm the legal use of the property?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Were permits pulled for any recent renovations or updates to the kitchen, bathrooms, or mechanical systems?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Has the basement had water intrusion, flooding, foundation repairs, or drainage issues?',
      category: 'Basement',
      tagColor: 'bg-blue-100 text-blue-700',
    },
    {
      text: 'Are there any open DOB violations, permits, or unresolved building or code compliance issues?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Can you provide recent comparable single-family sales to support the asking price?',
      category: 'Price',
      tagColor: 'bg-amber-100 text-amber-700',
    },
    {
      text: 'What is the actual average monthly utility cost for this property?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
  ];
}

/** Multi-family: CO, rent roll, leases, rent stabilization, utilities, violations */
export function buildMultiFamilyQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'Can you provide the Certificate of Occupancy confirming the legal unit count and approved use for each unit?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Can you provide the current leases and actual rents for each unit — not just estimated rent?',
      category: 'Rent',
      tagColor: 'bg-green-100 text-green-700',
    },
    {
      text: 'Are any units rent-stabilized or rent-controlled? Are there any ongoing rent overcharge proceedings?',
      category: 'Rent',
      tagColor: 'bg-green-100 text-green-700',
    },
    {
      text: 'Are utilities separately metered for each unit, or does the owner pay for any utilities?',
      category: 'Utilities',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'Are there open DOB, HPD, ECB, or fire department violations on this property?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Are there any illegal or unpermitted units? If so, what is the path to legalization?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'What is the actual annual operating expense history for the last 2–3 years — taxes, insurance, utilities, repairs, management fees?',
      category: 'Financial',
      tagColor: 'bg-slate-100 text-slate-700',
    },
    {
      text: 'What is the cap rate and NOI based on actual rents and expenses? Can you provide the full rent roll?',
      category: 'Financial',
      tagColor: 'bg-slate-100 text-slate-700',
    },
    {
      text: 'Are any units currently vacant, and what are the current tenant profiles and lease expiration dates?',
      category: 'Rent',
      tagColor: 'bg-green-100 text-green-700',
    },
    {
      text: 'Has the property undergone any recent renovations or code compliance upgrades? Were permits pulled?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
  ];
}

/** Condo: common charges, assessments, reserves, rental restrictions, litigation */
export function buildCondoQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'What are the current monthly common charges, and what do they cover (taxes, insurance, utilities)?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'Are there any current or upcoming special assessments? When was the last one, and for what amount?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'What is the reserve fund balance, and has a reserve study been completed? Are there any underfunded reserves?',
      category: 'Financial',
      tagColor: 'bg-slate-100 text-slate-700',
    },
    {
      text: 'Are there rental restrictions, pet policies, or age limits in the HOA documents?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Is the HOA or building currently involved in any litigation? Review the last 3 years of meeting minutes.',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'What is the current owner-occupancy ratio, and are there any financing restrictions on this unit?',
      category: 'Financing',
      tagColor: 'bg-blue-100 text-blue-700',
    },
    {
      text: 'What is the master insurance policy coverage, and are unit owners required to carry additional insurance?',
      category: 'Insurance',
      tagColor: 'bg-blue-100 text-blue-700',
    },
    {
      text: 'Can you provide recent comparable condo sales and the HOA\'s financial statements for the last 2 years?',
      category: 'Price',
      tagColor: 'bg-amber-100 text-amber-700',
    },
  ];
}

/** Townhouse: HOA, exterior responsibility, roof, parking, insurance, comps */
export function buildTownhouseQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'What are the monthly HOA fees, and what is covered — exterior maintenance, roof, landscaping, snow removal?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'Clarify the exterior maintenance responsibilities — who is responsible for the roof, siding, and shared walls?',
      category: 'Condition',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'Are there any shared walls, and what are the party wall agreements or responsibilities?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'What are the parking arrangements — deeded spots, assigned spots, or unassigned? Any guest parking?',
      category: 'General',
      tagColor: 'bg-slate-100 text-slate-700',
    },
    {
      text: 'What is the HOA\'s reserve fund status and any history of special assessments?',
      category: 'Financial',
      tagColor: 'bg-slate-100 text-slate-700',
    },
    {
      text: 'Were permits pulled for any recent renovations or updates to the unit or exterior?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Can you provide recent comparable townhouse sales in this HOA or neighborhood to support the asking price?',
      category: 'Price',
      tagColor: 'bg-amber-100 text-amber-700',
    },
  ];
}

/** Land: zoning, buildability, utilities, survey, easements, flood zone, env */
export function buildLandQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'What is the current zoning, and does it permit your intended use (residential, commercial, agricultural)?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Has the lot been confirmed as buildable by the local planning or building department? Are there any setback requirements?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Are water, sewer, gas, and electric utilities available at the lot line, or will you need to extend them?',
      category: 'Utilities',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'Can you provide a current survey showing lot dimensions, boundaries, easements, and encroachments?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'What is the FEMA flood zone designation — is flood insurance required, and at what cost?',
      category: 'Insurance',
      tagColor: 'bg-blue-100 text-blue-700',
    },
    {
      text: 'Is there a Phase I environmental report, or any history of contamination, prior industrial use, or underground storage tanks?',
      category: 'Environmental',
      tagColor: 'bg-emerald-100 text-emerald-700',
    },
    {
      text: 'Are there any recorded easements, deed restrictions, or homeowner association rules affecting the lot?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'Can you provide recent comparable vacant land sales in this area to support the asking price?',
      category: 'Price',
      tagColor: 'bg-amber-100 text-amber-700',
    },
  ];
}

/** Manufactured: land ownership, park rules, financing, HUD tag, foundation */
export function buildManufacturedQuestionFallbacks(): QuestionFallbackItem[] {
  return [
    {
      text: 'Do you own the land, or are you renting a lot in a manufactured home park? What is the monthly lot rent?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'What are the park rules, age restrictions, pet policies, and any pending lot rent increases or park sales?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
    {
      text: 'What financing options are available for this home — conventional, chattel loan, or other? Is the land included in the sale?',
      category: 'Financing',
      tagColor: 'bg-blue-100 text-blue-700',
    },
    {
      text: 'Can you confirm the HUD tag number and provide the home\'s construction date, original installation records, and any renovation permits?',
      category: 'Condition',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'What is the foundation type, and is the home properly anchored? Has the skirting been maintained?',
      category: 'Condition',
      tagColor: 'bg-orange-100 text-orange-700',
    },
    {
      text: 'What does the monthly cost total to — lot rent (if any) plus home payment, insurance, utilities, and park fees?',
      category: 'Costs',
      tagColor: 'bg-teal-100 text-teal-700',
    },
    {
      text: 'Is the title clear, and are there any liens on the home or lot?',
      category: 'Legal',
      tagColor: 'bg-violet-100 text-violet-700',
    },
  ];
}

// ── G. Question Suppression by Property Type ────────────────────────────────────
// Questions matching these patterns are suppressed for the given category.

export const QUESTIONS_TO_SUPPRESS_BY_CATEGORY: Record<string, RegExp[]> = {
  co_op: [
    /basement\s*(rental|apartment|unit|income)/i,
    /legal\s*two\s*family/i,
    /second\s*unit\s*rent/i,
    /rental\s*income\s*potential/i,
    /basement\s*bedroom\s*egress/i,
    /certificate\s*of\s*occupancy.*basement/i,
    /renting\s*out\s*the\s*unit/i,
    /income\s*producing\s*potential/i,
  ],
  condo: [
    /basement\s*(rental|apartment|unit|income)/i,
    /legal\s*two\s*family/i,
    /second\s*unit\s*rent/i,
    /rental\s*income\s*potential/i,
  ],
  townhouse: [
    /basement\s*(rental|apartment|unit|income)/i,
    /legal\s*two\s*family/i,
    /second\s*unit\s*rent/i,
    /rental\s*income\s*potential/i,
    /certificate\s*of\s*occupancy.*basement/i,
  ],
  land: [
    /basement/i,
    /roof\s*age/i,
    /boiler/i,
    /electrical\s*panel/i,
    /plumbing\s*(material|age)/i,
    /kitchen\s*renovation/i,
    /bathroom\s*renovation/i,
    /bedroom/i,
    /living\s*room/i,
    /certificate\s*of\s*occupancy.*interior/i,
    /certificate\s*of\s*occupancy.*dwelling/i,
  ],
  manufactured: [
    /basement\s*(rental|apartment|unit|income)/i,
    /legal\s*two\s*family/i,
    /second\s*unit\s*rent/i,
    /rental\s*income\s*potential/i,
  ],
  single_family: [
    // Suppress only if not explicitly multi-family confirmed
    /legal\s*two\s*family.*confirm/i,
    /second\s*unit\s*rent.*confirm/i,
  ],
};
