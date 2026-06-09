// ===== reportAdapters barrel export =====

export { normalizeReportResult } from './normalizeReport';
export { buildReportViewModel } from './reportViewModel';
export { computeReportProfile } from './usSale';
export { MODULE_FALLBACKS, RISK_ACTION_FALLBACKS, QUESTION_FALLBACKS } from './Fallbacks';
export type {
  ReportViewModel, HeroVM, DecisionCardVM, DealRiskVM, PriceVM,
  CarryingCostVM, CarryingCostItem, PhotoAnalysisVM, SpinDecoderVM,
  FitVM, QuestionVM,
} from './reportViewModel';
export type {
  NormalizedReport,
  Market,
  ReportMode,
  ReportProfile,
  SectionTone,
  ReportMeta,
  HeroData,
  HighlightsData,
  QuickFact,
  SectionItem,
  ReportSection,
} from './types';
