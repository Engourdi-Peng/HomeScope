// ===== Fallbacks — 统一 fallback 文案库 =====
// 所有前端展示层的 fallback 文案集中管理，分为三类：
// A. 模块级 fallback
// B. Deal-Changing Risk Action Fallback
// C. Questions 兜底列表

// ── A. 模块级 fallback ────────────────────────────────────────────────────────

export const MODULE_FALLBACKS = {
  HERO_BOTTOM_LINE: 'Based on available data, this property has significant factors worth verifying before making a decision.',
  HERO_NEXT_BEST_MOVE_DEFAULT: 'Request additional details and verify key risks before your next step.',
  PRICE_ANALYSIS_UNKNOWN: 'Price cannot be judged confidently from the available data.',
  PRICE_ANALYSIS_OVERPRICED: 'The asking price appears high relative to visible condition, market time, or unverified assumptions.',
  PRICE_ANALYSIS_FAIR: 'The asking price appears reasonable relative to available market data, but always verify with comps.',
  PRICE_ANALYSIS_GOOD_VALUE: 'The asking price may be attractive relative to visible condition and market data, but confirm with comps.',
  CARRYING_COSTS_NO_DATA: 'Monthly cost estimate is not available from the current listing data.',
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
  legal_nyc: 'Ask for the Certificate of Occupancy and check NYC DOB, HPD, and ACRIS records before relying on rental income or making an offer.',
  legal_general: 'Ask for the Certificate of Occupancy and check local building department and county records before relying on rental income or making an offer.',
  environmental_nyc: 'Check FEMA flood maps, NYC flood maps, basement water history, and insurance quotes before estimating monthly costs.',
  environmental_general: 'Check local flood maps, FEMA flood maps, and basement water history before estimating monthly costs.',
  price: 'Request recent comparable sales and active listings within 0.5 miles to justify the asking price.',
  market: 'Ask the listing agent why the property has been on market this long and whether there have been any offers or price reductions.',
  default: 'Verify this risk with a licensed inspector and relevant public records before making any commitment.',
} as const;

// ── C. Questions 兜底列表 ─────────────────────────────────────────────────────

export const QUESTION_FALLBACKS = [
  'Is this property legally registered as a two-family with NYC HPD, and what does the Certificate of Occupancy allow?',
  'Are there any open DOB or HPD violations, permits, complaints, or unresolved building issues?',
  'What actual rent has the second unit achieved, not just estimated rent?',
  'How old are the roof, boiler, electrical panel, plumbing, and HVAC systems?',
  'What is the electrical panel amperage, and is it adequate for two-family use with separate meters?',
  'Has the basement had water intrusion, flooding, mold, drainage issues, or foundation repairs?',
  'Can you provide recent comparable sales and actual rental comps to justify the asking price?',
  'What are the real monthly costs including insurance, utilities, repairs, vacancy, and maintenance reserve?',
] as const;
