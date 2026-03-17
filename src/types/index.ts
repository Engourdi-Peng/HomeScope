// Analysis stages for progress tracking
export type AnalysisStage =
  | 'upload_received'
  | 'detecting_rooms'
  | 'evaluating_spaces'
  | 'extracting_strengths_and_issues'
  | 'estimating_competition'
  | 'building_final_report'
  | 'done'
  | 'failed';

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
  score: number; // 0-100
  explanation?: string; // short description of condition (max 12 words)
  photoCount: number; // number of photos analyzed for this space
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

export interface AnalysisResult {
  id?: string;
  overallScore: number;
  finalRecommendation?: FinalRecommendation | null;
  
  // Score Context (NEW)
  scoreContext?: ScoreContext | null;
  
  // Agent Questions (NEW)
  agentQuestions?: string[];
  
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  quickSummary: string;
  whatLooksGood: string[];
  riskSignals: string[];
  realityCheck: string;
  questionsToAsk: string[];

  // Decision Priority (NEW)
  decisionPriority: 'HIGH' | 'MEDIUM' | 'LOW';
  
  // AI Confidence Level (NEW)
  confidenceLevel: 'High' | 'Medium' | 'Low';
  
  // Hidden Risk Signals (NEW)
  hiddenRisks?: string[];
  
  // Potential Risks (NEW)
  risks?: string[];
  
  // Inspection Fit (NEW)
  inspectionFit?: {
    good_for: string[];
    not_ideal_for: string[];
  };
  
  // Trust-building metadata
  analyzedPhotoCount?: number;
  detectedRooms?: string[];
  roomCounts?: Record<string, number>;

  // New structured fields for the 7-section layout
  spaceAnalysis?: SpaceAnalysisItem[];
  propertyStrengths?: string[];
  potentialIssues?: string[];
  competitionRisk?: CompetitionRisk;
  recommendation?: Recommendation;
  
  // Legacy fields
  photoCondition?: {
    renovationLevel: 'Modern' | 'Mixed' | 'Dated' | 'Original';
    cosmeticFlipRisk: 'Low' | 'Medium' | 'High';
    naturalLight: 'Low' | 'Medium' | 'Good';
    spacePerception: 'Smaller Than Expected' | 'Fair' | 'Spacious';
    maintenanceImpression: 'Good' | 'Average' | 'Questionable';
  };
  visualAnalysis?: VisualAnalysisResult;
  spatialMetrics?: SpatialMetrics | null;

  // Reality Check module (optional)
  reality_check?: RealityCheck;

  // Rent Fairness (optional)
  rent_fairness?: RentFairness;
}

export interface AnalyzeRequest {
  imageUrls: string[]; // Supabase Storage public URLs
  description: string;
  optionalDetails?: OptionalDetails;
}

// Two-step API request structure
export interface TwoStepAnalyzeRequest {
  step1Photos?: string[]; // Only first 4 photos for visual analysis
  description: string;
  optionalDetails?: OptionalDetails;
}

// Two-step API response
export interface TwoStepAnalyzeResult {
  step1VisualAnalysis: VisualAnalysisResult;
  step2Decision: RentalDecisionResult;
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
