// ===== HomeScope 共享类型定义 =====
// 网站和插件共用同一套类型定义

// ===== 0. 网站来源 =====
export type ListingSource = 'realestate-au' | 'zillow' | 'future-site';

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
  reportMode?: 'rent' | 'sale';
  source?: ListingSource;  // 网站来源
  weeklyRent?: string;
  askingPrice?: string;
  suburb?: string;
  bedrooms?: string;
  bathrooms?: string;
  parking?: string;
  /** 土地面积 (sqm) - 用于土地价值分析 */
  landSize?: string;
  /** 房产类型 - 用于区分 House/Apartment */
  propertyType?: string;
  /** 美国特有字段 - Zillow */
  sqft?: string;
  zestimate?: string;
  yearBuilt?: string;
  hoaFee?: string;
  propertyTax?: string;
}

// ===== 6a. 售价评估 (Sale 专用) =====
export interface PriceAssessment {
  estimated_min?: number;
  estimated_max?: number;
  asking_price?: number;
  verdict: string;
  explanation: string;
}

// ===== 6b. 投资潜力 (Sale 专用) =====
export interface InvestmentPotential {
  growth_outlook?: 'Strong' | 'Moderate' | 'Weak' | 'Unknown';
  rental_yield_estimate?: string;
  capital_growth_5yr?: string;
  key_positives?: string[];
  key_concerns?: string[];
}

// ===== 6c. 可负担性检查 (Sale 专用) =====
export interface AffordabilityCheck {
  estimated_deposit_20pct?: number;
  estimated_loan?: number;
  estimated_monthly_repayment?: string;
  assessment?: 'manageable' | 'stretch' | 'challenging';
  note?: string;
}

// ===== 6d. 土地价值分析 (Sale 专用) =====
/**
 * 澳洲买房土地价值分析
 * 用于评估土地占比和长期增值潜力
 */
export interface LandValueAnalysis {
  landSize?: number;           // 土地面积 sqm
  pricePerSqm?: number;        // 每平米单价
  landBankingPotential?: boolean;  // 是否具有土地银行潜力
  scarcityIndicator?: 'High' | 'Medium' | 'Low';  // 稀缺性指标
  propertyType?: 'House' | 'Apartment' | 'Unit' | 'Townhouse' | 'Unknown';
  explanation?: string;        // 分析说明
}

// ===== 6e. 持有成本明细 (Sale 专用) =====
/**
 * 澳洲买房持有成本精算
 * 包含首付、印花税、隐性成本等
 */
export interface HoldingCosts {
  deposit20pct: number;
  stampDuty: number;
  stampDutyState?: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'Other';
  transferFees: number;
  legalCosts: number;
  inspectionCosts: number;
  /** 月还款估算字符串，如 "$3,100-$3,400/month" */
  estimatedMonthlyRepayment: string;
  /** 现金流分析（如果有租金数据） */
  cashFlowAnalysis?: {
    potentialRent?: number;        // 潜在租金（每周）
    weeklyMortgageInterest: number; // 每周房贷利息支出
    weeklyDifference: number;      // 每周差额（租金 - 利息）
    verdict: 'Positive Gearing' | 'Negative Gearing' | 'Neutral';
  };
  /** 总 upfront 成本（首付 + 印花税 + 各项费用） */
  totalUpfrontCosts?: number;
}

// ===== 6f. 红色警报 (Sale 专用) =====
/**
 * 澳洲买房风险关键词警报
 * 扫描 description 中的危险信号
 */
export interface RedFlagAlert {
  keyword: string;           // 触发警报的关键词
  category: 'legal' | 'structural' | 'financial' | 'location';
  severity: 'high' | 'medium' | 'low';
  message: string;          // 警报消息
  action: string;            // 建议行动
}

// ===== 6g. 州特殊建议 (Sale 专用) =====
// ===== 6h. Deal Breakers (Sale 专用) =====
// ===== 6i. Next Move (Sale 专用) =====
// ===== 6j. Would I Buy (Sale 专用) =====

/**
 * 澳洲买房风险关键词警报
 * 扫描 description 中的危险信号
 */
export interface RedFlagAlert {
  keyword: string;           // 触发警报的关键词
  category: 'legal' | 'structural' | 'financial' | 'location';
  severity: 'high' | 'medium' | 'low';
  message: string;          // 警报消息
  action: string;            // 建议行动
}

/**
 * Deal Breakers - 致命风险合并模块
 * 将 risks + red_flag_alerts + potentialIssues + hiddenRisks 合并输出
 */
export interface DealBreakerItem {
  title: string;                                    // 风险标题
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';  // 严重级别
  category: 'STRUCTURAL' | 'LOCATION' | 'LEGAL' | 'FINANCIAL' | 'OTHER';  // 分类
  description: string;                              // 具体问题描述
  why_it_matters: string;                           // 为什么重要/严重
  mitigation: string;                               // 是否可解决 + 如何解决
}

export interface DealBreakers {
  summary: string;                                  // 一句话总结整体风险级别
  overall_severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  items: DealBreakerItem[];
}

/**
 * Next Move - 下一步行动建议
 * 决策导向的最终建议
 */
export interface NextMove {
  decision: 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'SKIP';
  headline: string;           // 非常短的一句话
  reasoning: string;          // 决策理由
  suggested_actions: string[];  // 建议的具体行动
}

/**
 * Would I Buy - Hero Card 判断
 * 一眼定生死的核心判断
 */
export interface WouldIBuy {
  answer: 'YES' | 'MAYBE' | 'NO';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;             // 一句话理由
}

// ===== 6g. 州特殊建议 (Sale 专用) =====
/**
 * 澳洲各州特殊建议
 * 不同州有不同的法律和流程要求
 */
export interface StateSpecificAdvice {
  state: 'VIC' | 'NSW' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT' | 'Unknown';
  recommendations: string[];
}
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
export interface ListingInfo {
  /** 房源标题/名称，优先显示 */
  title?: string;
  /** 房源完整地址 */
  address?: string;
  /** 价格（带格式，如 "$900 per week"） */
  price?: string;
  /** 价格数值（纯数字） */
  priceAmount?: number;
  /** 卧室数 */
  bedrooms?: number | null;
  /** 浴室数 */
  bathrooms?: number | null;
  /** 车位 */
  parking?: number | null;
  /** 封面图 URL（第一张图） */
  coverImageUrl?: string;
}

export interface AnalysisResult {
  id?: string;

  /** 报告模式：rent=租房报告, sale=买房报告 */
  reportMode?: 'rent' | 'sale';

  /** 分析类型：basic=基础分析，full=深度分析（用于区分卡片显示） */
  analysisType?: 'basic' | 'full';

  /** 房源简要信息（用于报告页顶部显示） */
  listingInfo?: ListingInfo | null;

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
  rent_fairness?: RentFairness | null;
  price_assessment?: PriceAssessment | null;
  investment_potential?: InvestmentPotential | null;
  affordability_check?: AffordabilityCheck | null;
  // === Sale 模式新增字段 ===
  land_value_analysis?: LandValueAnalysis | null;   // 土地价值分析
  holding_costs?: HoldingCosts | null;              // 持有成本明细
  red_flag_alerts?: RedFlagAlert[];                 // 红色警报列表
  state_specific_advice?: StateSpecificAdvice | null; // 州特殊建议
  // === Sale 模式新增增强字段 ===
  deal_breakers?: DealBreakers | null;            // Deal Breakers 合并风险模块
  next_move?: NextMove | null;                     // Next Move 行动建议
  would_i_buy?: WouldIBuy | null;                 // Would I Buy 判断
  // === Sale 模式新增字段 END ===
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

  // Upgrade Prompt - For basic analysis, prompt user to upgrade
  upgradePrompt?: BasicUpgradePrompt;

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
  reportMode?: 'rent' | 'sale';
  analysisType?: 'basic' | 'full';
  imageUrls: string[];
  description: string;
  optionalDetails?: OptionalDetails;
}

// ===== 12b. 基础分析结果 =====
// Basic Analysis: 仅基于文本描述，不处理图片
// 与深度分析(Full Analysis)的差异化：快速、简洁、免费

export interface BasicTextAnalysis {
  pros: string[];           // 房源优势 (3-5个)
  cons: string[];           // 需要注意的问题 (3-5个)
  riskKeywords: string[];   // 风险关键词
  priceFairness: 'low' | 'medium' | 'high';
  priceReasoning: string;   // 价格评估理由
}

export interface BasicDecision {
  summary: string;                         // 一句话总结
  recommendation: 'low' | 'medium' | 'high'; // 推荐程度
  actions: string[];                       // 建议行动 (2-3个)
}

export interface BasicUpgradePrompt {
  title: string;
  features: string[];
}

export interface BasicListingOverview {
  address: string;
  price: string;
  bedrooms: number;
  bathrooms: number;
  propertyType: string;
}

/**
 * 基础分析结果
 * 用于无限次免费基础分析功能
 * 注意：基础分析不包含图片分析，仅基于文本描述
 */
export interface BasicAnalysisResult {
  reportMode: 'rent' | 'sale';
  analysisType: 'basic';
  listingOverview: BasicListingOverview;
  textAnalysis: BasicTextAnalysis;
  decision: BasicDecision;
  upgradePrompt: BasicUpgradePrompt;
}

// ===== 13.1 SEO 相关类型 =====

/**
 * 报告 SEO 元信息
 */
export interface ReportSEO {
  seo_slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

/**
 * 报告可见性配置
 */
export interface ReportVisibility {
  is_public: boolean;
  shared_at: string | null;
}

// ===== 13.2 分析摘要（数据库记录）=====
/**
 * 扩展后的分析摘要，包含 SEO 和可见性字段
 */
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
  // SEO 字段
  is_public: boolean;
  share_slug?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  shared_at?: string | null;
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
