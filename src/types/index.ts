// Re-export all types from shared module
// This ensures website and extension use the same type definitions
export * from '../../shared/types/analysis';

// Additional website-specific types can be added below if needed

export interface AnalysisProgress {
  id?: string;
  stage: AnalysisStage;
  message: string;
  progress?: number;
  status?: "queued" | "processing" | "done" | "failed";
  result?: AnalysisResult;
  error?: string;
}

export interface OptionalDetails {
  weeklyRent?: string;
  suburb?: string;
  bedrooms?: string;
  bathrooms?: string;
  parking?: string;
}

export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
}

// Step 1: Visual Analysis Result (image-only analysis)
export interface VisualAnalysisResult {
  kitchenCondition: 'Good' | 'Average' | 'Poor';
  bathroomCondition: 'Good' | 'Average' | 'Poor';
  renovationLevel: 'Modern' | 'Mixed' | 'Dated' | 'Original';
  naturalLight: 'Good' | 'Medium' | 'Low';
  spacePerception: 'Spacious' | 'Fair' | 'Smaller Than Expected';
  maintenanceCondition: 'Good' | 'Average' | 'Questionable';
  cosmeticFlipRisk: 'Low' | 'Medium' | 'High';
  missingKeyAreas: string[];
  photoQualityObservations: string[];
}

// Step 2: Rental Decision Result (final output)
export interface RentalDecisionResult {
  overallScore: number;
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  quickSummary: string;
  whatLooksGood: string[];
  riskSignals: string[];
  realityCheck: string;
  questionsToAsk: string[];
}

// Spatial Metrics for UI cards
export interface SpatialMetrics {
  buildIntegrity: 'Strong' | 'Adequate' | 'Inconsistent' | 'Unknown';
  passiveLight: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unknown';
  maintenanceDepth: 'Well Maintained' | 'Average' | 'Superficial' | 'Unknown';
}

// Space Analysis for individual room types
export interface SpaceAnalysisItem {
  spaceType: 'kitchen' | 'bathroom' | 'bedroom' | 'living_room' | 'garage' | 'laundry' | 'exterior' | 'hallway' | 'storage' | 'dining' | 'unknown';
  score: number;
  explanation?: string;
  photoCount: number;
  observations: string[];
}

// Competition Risk Assessment
export interface CompetitionRisk {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

// Recommendation Section
export interface Recommendation {
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  goodFitIf: string[];
  notIdealIf: string[];
}

// Reality Check module
export type RealityCheckVerdict = "Mostly factual" | "Some promotional wording" | "Marketing-heavy";

export interface RealityCheck {
  should_display: boolean;
  overall_verdict?: RealityCheckVerdict;
  summary?: string;
  marketing_phrases?: string[];
  missing_specifics?: string[];
  support_gaps?: string[];
  confidence?: "low" | "medium" | "high";
}

// Rent Fairness for price evaluation
export type RentFairnessVerdict = "underpriced" | "fair" | "slightly_overpriced" | "overpriced";

export interface RentFairness {
  estimated_min: number;
  estimated_max: number;
  listing_price: number;
  verdict: RentFairnessVerdict;
  explanation: string;
}

// Light & Thermal Guide
export interface LightThermalGuide {
  naturalLightSummary?: string;
  sunExposure?: 'Low' | 'Moderate' | 'High' | 'Unknown';
  thermalRisk?: 'Likely Cold' | 'Balanced' | 'Likely Hot' | 'Unknown';
  summerComfort?: string;
  winterComfort?: string;
  confidence?: 'Low' | 'Medium' | 'High';
  evidence?: string[];
}

// Agent Lingo Translation
export interface AgentLingoTranslation {
  shouldDisplay?: boolean;
  phrases?: {
    phrase: string;
    plainEnglish: string;
    confidence?: 'Low' | 'Medium' | 'High';
  }[];
}

// Application Strategy
export interface ApplicationStrategy {
  urgency?: 'Low' | 'Medium' | 'High';
  applySpeed?: string;
  checklist?: string[];
  reasoning?: string[];
}

// Score Context for market position (NEW)
export interface ScoreContext {
  marketPosition: 'Above Average' | 'Average' | 'Below Average';
  explanation: string;
}

// Combined Analysis Result (backward compatible)
export interface FinalRecommendation {
  verdict: 'Strong Apply' | 'Apply With Caution' | 'Not Recommended';
  reason: string;
}

// ========== Account / History Types ==========

export interface AnalysisSummary {
  id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  overall_score?: number;
  verdict?: string;
  title?: string;
  address?: string;
  cover_image_url?: string;
  summary?: {
    quickSummary?: string;
    whatLooksGood?: string[];
    riskSignals?: string[];
  };
  full_result?: AnalysisResult;
  created_at: string;
  updated_at: string;
}

export interface AnalysisHistoryResponse {
  analyses: AnalysisSummary[];
}

export interface AnalysisDetailResponse {
  analysis: AnalysisSummary;
}
