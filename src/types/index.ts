// ===== HomeScope Shared Types =====
// Re-exported from shared module with fallback definitions

// ===== 1. Analysis Stage =====
export type AnalysisStage =
  | 'upload_received'
  | 'detecting_rooms'
  | 'evaluating_spaces'
  | 'extracting_strengths_and_issues'
  | 'estimating_competition'
  | 'building_final_report'
  | 'done'
  | 'failed';

// ===== 2. Optional Details =====
export interface OptionalDetails {
  weeklyRent?: string;
  suburb?: string;
  bedrooms?: string;
  bathrooms?: string;
  parking?: string;
}

// ===== 3. Photo =====
export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
}

// ===== 4. Analysis Result =====
export interface AnalysisResult {
  id?: string;
  overallScore: number;
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  quickSummary: string;
  whatLooksGood: string[];
  riskSignals: string[];
  realityCheck: string;
  questionsToAsk: string[];
  decisionPriority?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceLevel?: 'High' | 'Medium' | 'Low';
  analyzedPhotoCount?: number;
  detectedRooms?: string[];
  roomCounts?: Record<string, number>;
  finalRecommendation?: { verdict: string; reason: string } | null;
  scoreContext?: { marketPosition: string; explanation: string } | null;
  agentQuestions?: string[];
  hiddenRisks?: string[];
  risks?: string[];
  inspectionFit?: { good_for: string[]; not_ideal_for: string[] };
  competitionRisk?: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
  rent_fairness?: { estimated_min?: number; estimated_max?: number; listing_price?: string; verdict: string; explanation: string };
  reality_check?: { should_display: boolean; overall_verdict: string; summary: string; marketing_phrases: string[]; missing_specifics: string[]; support_gaps: string[] };
  spaceAnalysis?: Array<{ spaceType: string; score: number; explanation: string; photoCount: number; observations: string[] }>;
  propertyStrengths?: string[];
  potentialIssues?: string[];
  photoCondition?: { overall: string; details: string[] };
  visualAnalysis?: { photos: Array<{ url: string; labels: string[]; space_type: string; quality_score: number }>; spaceAnalysis: Array<{ spaceType: string; score: number; explanation: string; photoCount: number; observations: string[] }>; overallCondition: string };
  spatialMetrics?: { estimatedAreaSqm: number; commonComparables: string[] } | null;
  recommendation?: { verdict: string; goodFitIf: string[]; notIdealIf: string[] };
  lightThermalGuide?: { naturalLightSummary?: string; sunExposure?: string; thermalRisk?: string; summerComfort?: string; winterComfort?: string; evidence?: string[] } | null;
  agentLingoTranslation?: { shouldDisplay?: boolean; phrases?: { phrase: string; plainEnglish: string; confidence?: string }[] } | null;
  applicationStrategy?: { urgency?: string; applySpeed?: string; checklist?: string[]; reasoning?: string[] } | null;
  australiaInsights?: {
    smartTags: string[];
    comfortCheck: { score: number; verdict: string; details: string[] };
    redFlagDetector: { flags: string[]; severity: 'low' | 'medium' | 'high' };
    agentTranslation: { phrase: string; meaning: string }[];
    trueCost: { weekly: number; annual: number; notes: string[] };
    competitionPlus: { level: 'LOW' | 'MEDIUM' | 'HIGH'; insight: string };
  };
}

// ===== 5. Analysis Progress =====
export interface AnalysisProgress {
  id?: string;
  stage: AnalysisStage;
  message: string;
  progress?: number;
  status?: 'queued' | 'processing' | 'done' | 'failed';
  result?: AnalysisResult;
  error?: string;
}

// ===== 6. Competition Risk =====
export interface CompetitionRisk {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

// ===== 7. Final Recommendation =====
export interface FinalRecommendation {
  verdict: string;
  reason: string;
}

// ===== 8. Rent Fairness =====
export interface RentFairness {
  estimated_min?: number;
  estimated_max?: number;
  listing_price?: string;
  verdict: string;
  explanation: string;
}

// ===== 9. Inspection Fit =====
export interface InspectionFit {
  good_for: string[];
  not_ideal_for: string[];
}

// ===== 10. Visual Analysis Result =====
export interface VisualAnalysisResult {
  photos: Array<{ url: string; labels: string[]; space_type: string; quality_score: number }>;
  spaceAnalysis: Array<{ spaceType: string; score: number; explanation: string; photoCount: number; observations: string[] }>;
  overallCondition: string;
}

// ===== 11. Reality Check =====
export interface RealityCheck {
  should_display: boolean;
  overall_verdict: string;
  summary: string;
  marketing_phrases: string[];
  missing_specifics: string[];
  support_gaps: string[];
}

// ===== 12. Analyze Request =====
export interface AnalyzeRequest {
  imageUrls: string[];
  description: string;
  optionalDetails?: OptionalDetails;
}

// ===== 13. Analysis Summary =====
export interface AnalysisSummary {
  id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  overall_score?: number;
  verdict?: string;
  title?: string;
  address?: string;
  cover_image_url?: string;
  summary?: { quickSummary?: string; whatLooksGood?: string[]; riskSignals?: string[] };
  full_result?: AnalysisResult;
  created_at: string;
  updated_at: string;
}

// ===== 14. API Response Types =====
export interface AnalysisHistoryResponse {
  analyses: AnalysisSummary[];
}

export interface AnalysisDetailResponse {
  analysis: AnalysisSummary;
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
