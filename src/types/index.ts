// Re-export all types from shared module (single source of truth)
export type {
  AnalysisStage,
  Photo,
  OptionalDetails,
  CompetitionRisk,
  FinalRecommendation,
  RentFairness,
  InspectionFit,
  VisualAnalysisResult,
  RealityCheck,
  AnalysisResult,
  AnalysisProgress,
  AnalyzeRequest,
  AnalysisSummary,
  AnalysisHistoryResponse,
  AnalysisDetailResponse,
  PricePeriod,
  ParserType,
  AnalysisTier,
  ExtractionSource,
  ExtractedListingData,
  PropertyDetection,
  ListingDataV2,
  // Basic analysis types
  BasicAnalysisResult,
  BasicListingOverview,
  BasicTextAnalysis,
  BasicDecision,
  BasicUpgradePrompt,
} from '../../shared/types/analysis';

// Legacy flat listing structure (still used by content script and store)
export interface ListingData {
  source?: { url: string; domain: string; parserType: string };
  title?: string;
  address?: string;
  price?: string;
  priceText?: string;
  pricePeriod?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: number | null;
  description?: string;
  imageUrls?: string[];
  extractionConfidence?: number;
}

// ===== Website-specific UI types =====

export interface RentalDecisionResult {
  overallScore: number;
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  quickSummary: string;
  whatLooksGood: string[];
  riskSignals: string[];
  realityCheck: string;
  questionsToAsk: string[];
}

export interface SpatialMetrics {
  buildIntegrity: 'Strong' | 'Adequate' | 'Inconsistent' | 'Unknown';
  passiveLight: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unknown';
  maintenanceDepth: 'Well Maintained' | 'Average' | 'Superficial' | 'Unknown';
}

export interface SpaceAnalysisItem {
  spaceType: 'kitchen' | 'bathroom' | 'bedroom' | 'living_room' | 'garage' | 'laundry' | 'exterior' | 'hallway' | 'storage' | 'dining' | 'unknown';
  score: number;
  explanation?: string;
  photoCount: number;
  observations: string[];
}

export interface Recommendation {
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  goodFitIf: string[];
  notIdealIf: string[];
}

export type RealityCheckVerdict = "Mostly factual" | "Some promotional wording" | "Marketing-heavy";
export type RentFairnessVerdict = "underpriced" | "fair" | "slightly_overpriced" | "overpriced";

export interface LightThermalGuide {
  naturalLightSummary?: string;
  sunExposure?: 'Low' | 'Moderate' | 'High' | 'Unknown';
  thermalRisk?: 'Likely Cold' | 'Balanced' | 'Likely Hot' | 'Unknown';
  summerComfort?: string;
  winterComfort?: string;
  confidence?: 'Low' | 'Medium' | 'High';
  evidence?: string[];
}

export interface AgentLingoTranslation {
  shouldDisplay?: boolean;
  phrases?: {
    phrase: string;
    plainEnglish: string;
    confidence?: 'Low' | 'Medium' | 'High';
  }[];
}

export interface ApplicationStrategy {
  urgency?: 'Low' | 'Medium' | 'High';
  applySpeed?: string;
  checklist?: string[];
  reasoning?: string[];
}

export interface ScoreContext {
  marketPosition: 'Above Average' | 'Average' | 'Below Average';
  explanation: string;
}
