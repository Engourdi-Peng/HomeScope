// ===== HomeScope 共享类型定义 =====
// 网站和插件共用同一套类型定义

// ===== 1. 分析进度阶段 =====
export type AnalysisStage =
  | 'upload_received'
  | 'detecting_rooms'
  | 'evaluating_spaces'
  | 'extracting_strengths_and_issues'
  | 'estimating_competition'
  | 'building_final_report'
  | 'done'
  | 'failed';

// ===== 2. 照片类型 =====
export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
}

// ===== 3. 可选详情 =====
export interface OptionalDetails {
  weeklyRent?: string;
  suburb?: string;
  bedrooms?: string;
  bathrooms?: string;
  parking?: string;
}

// ===== 4. 竞争风险 =====
export interface CompetitionRisk {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

// ===== 5. 最终推荐 =====
export interface FinalRecommendation {
  verdict: string;
  reason: string;
}

// ===== 6. 租金评估 =====
export interface RentFairness {
  estimated_min?: number;
  estimated_max?: number;
  listing_price?: string;
  verdict: string;
  explanation: string;
}

// ===== 7. 适合人群 =====
export interface InspectionFit {
  good_for: string[];
  not_ideal_for: string[];
}

// ===== 8. AI 视觉分析结果 =====
export interface VisualAnalysisResult {
  photos: Array<{
    url: string;
    labels: string[];
    space_type: string;
    quality_score: number;
  }>;
  spaceAnalysis: Array<{
    spaceType: string;
    score: number;
    explanation: string;
    photoCount: number;
    observations: string[];
  }>;
  overallCondition: string;
}

// ===== 9. Reality Check 模块 =====
export interface RealityCheck {
  should_display: boolean;
  overall_verdict: string;
  summary: string;
  marketing_phrases: string[];
  missing_specifics: string[];
  support_gaps: string[];
}

// ===== 10. 完整分析结果 =====
export interface AnalysisResult {
  id?: string;

  // 核心评分
  overallScore: number;          // 0-100
  verdict: 'Worth Inspecting' | 'Proceed With Caution' | 'Likely Overpriced / Risky' | 'Need More Evidence';
  quickSummary: string;
  whatLooksGood: string[];
  riskSignals: string[];
  realityCheck: string;
  questionsToAsk: string[];

  // 优先级和置信度
  decisionPriority: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceLevel: 'High' | 'Medium' | 'Low';

  // 分析元数据
  analyzedPhotoCount?: number;
  detectedRooms?: string[];
  roomCounts?: Record<string, number>;

  // 结构化字段
  finalRecommendation?: FinalRecommendation | null;
  scoreContext?: { marketPosition: string; explanation: string } | null;
  agentQuestions?: string[];
  hiddenRisks?: string[];
  risks?: string[];
  inspectionFit?: InspectionFit;
  competitionRisk?: CompetitionRisk;
  rent_fairness?: RentFairness;
  reality_check?: RealityCheck;

  // 视觉分析
  spaceAnalysis?: Array<{
    spaceType: string;
    score: number;
    explanation: string;
    photoCount: number;
    observations: string[];
  }>;
  propertyStrengths?: string[];
  potentialIssues?: string[];

  // 图片质量评估
  photoCondition?: {
    overall: string;
    details: string[];
  };
  visualAnalysis?: VisualAnalysisResult;
  spatialMetrics?: {
    estimatedAreaSqm: number;
    commonComparables: string[];
  } | null;

  // 完整推荐（包含 goodFitIf / notIdealIf）
  recommendation?: {
    verdict: string;
    goodFitIf: string[];
    notIdealIf: string[];
  };

  // Light & Thermal Guide
  lightThermalGuide?: {
    naturalLightSummary?: string;
    sunExposure?: string;
    thermalRisk?: string;
    summerComfort?: string;
    winterComfort?: string;
    evidence?: string[];
  } | null;

  // Agent Lingo Translation
  agentLingoTranslation?: {
    shouldDisplay?: boolean;
    phrases?: { phrase: string; plainEnglish: string; confidence?: string }[];
  } | null;

  // Application Strategy
  applicationStrategy?: {
    urgency?: string;
    applySpeed?: string;
    checklist?: string[];
    reasoning?: string[];
  } | null;

  // 澳洲特色洞察
  australiaInsights?: {
    smartTags: string[];
    comfortCheck: {
      score: number;
      verdict: string;
      details: string[];
    };
    redFlagDetector: {
      flags: string[];
      severity: 'low' | 'medium' | 'high';
    };
    agentTranslation: {
      phrase: string;
      meaning: string;
    }[];
    trueCost: {
      weekly: number;
      annual: number;
      notes: string[];
    };
    competitionPlus: {
      level: 'LOW' | 'MEDIUM' | 'HIGH';
      insight: string;
    };
  };
}

// ===== 11. 分析进度 =====
export interface AnalysisProgress {
  id?: string;
  stage: AnalysisStage;
  message: string;
  progress?: number;
  status?: 'queued' | 'processing' | 'done' | 'failed';
  result?: AnalysisResult;
  error?: string;
}

// ===== 12. 分析请求 =====
export interface AnalyzeRequest {
  imageUrls: string[];
  description: string;
  optionalDetails?: OptionalDetails;
}

// ===== 13. 分析摘要（数据库记录）=====
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

// ===== 14. API 响应类型 =====
export interface AnalysisHistoryResponse {
  analyses: AnalysisSummary[];
}

export interface AnalysisDetailResponse {
  analysis: AnalysisSummary;
}

// ===== 15. 通用房产页面提取类型 =====

export type PricePeriod = 'week' | 'month' | 'year' | 'unknown';
export type ParserType = 'site_specific' | 'generic';
export type AnalysisTier = 'full' | 'partial' | 'none';

export interface ExtractionSource {
  url: string;
  domain: string;
  parserType: ParserType;
  siteName?: string;
}

/**
 * 统一房源提取数据结构
 * 所有解析器（站点专用 + 通用）最终输出此结构
 */
export interface ExtractedListingData {
  source: ExtractionSource;
  title?: string;
  address?: string;
  price?: string;
  priceAmount?: number;
  pricePeriod: PricePeriod;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: number | null;
  propertyType?: string | null;
  description?: string;
  imageUrls: string[];
  features?: string[];
  rawText?: string;
  extractionConfidence: number; // 0.0 ~ 1.0
}

/**
 * 房产页面检测结果
 */
export interface PropertyDetection {
  score: number;           // 0.0 ~ 1.0
  signals: string[];       // 检测到的信号列表
  tier: AnalysisTier;      // 分析等级
  canAnalyze: boolean;
}

/**
 * 兼容旧版 ListingData 的扩展结构
 * Side Panel 内部使用，由 normalizeExtractedData 转换而来
 */
export interface ListingDataV2 {
  source: ExtractionSource;
  title?: string;
  address: string;
  price: string;
  priceAmount?: number;
  pricePeriod: PricePeriod;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  propertyType: string;
  description: string;
  images: string[];
  features: string[];
  extractionConfidence: number;
  // 以下为向后兼容字段
  bond?: string;
  availableDate?: string;
  petsAllowed?: boolean | null;
  agent?: { name: string; agency: string; phone: string };
  listingId?: string;
  listingUrl: string;
  site: string;
}
