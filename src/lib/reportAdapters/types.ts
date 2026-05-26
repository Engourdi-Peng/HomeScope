// ===== NormalizedReport — 统一数据模型 =====
// 所有 adapter 的输出格式，NewReportUI 只消费这个结构

export type Market = 'US' | 'AU' | 'UNKNOWN';
export type ReportMode = 'sale' | 'rent' | 'unknown';
export type SectionTone = 'positive' | 'warning' | 'danger' | 'neutral' | 'info';

// ---- meta ----
export interface ReportMeta {
  market: Market;
  reportMode: ReportMode;
  source?: string;
  sourceDomain?: string;
  isBasic: boolean;
  /** Section IDs consumed by TopRisksSection — others skip them */
  usedSectionIds?: string[];
}

// ---- hero ----
export interface HeroData {
  title?: string;
  address?: string;
  score: number | null;
  verdict: string;
  confidence?: string;
  summary?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

// ---- highlights ----
export interface HighlightsData {
  pros: string[];
  cons: string[];
  risks: string[];
}

// ---- quick facts ----
export interface QuickFact {
  label: string;
  value: string;
  helper?: string;
}

// ---- section items ----
export interface SectionItem {
  title: string;
  value?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  badge?: string;
}

// ---- sections ----
export interface ReportSection {
  id: string;
  title: string;
  subtitle?: string;
  tone?: SectionTone;
  items: SectionItem[];
}

// ---- top-level normalized report ----
export interface NormalizedReport {
  meta: ReportMeta;
  hero: HeroData;
  highlights: HighlightsData;
  quickFacts: QuickFact[];
  sections: ReportSection[];
  /** 原始结果透传，方便调试和 fallback */
  raw: any;
}
