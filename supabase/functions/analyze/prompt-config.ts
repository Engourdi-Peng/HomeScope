/**
 * Prompt Router 配置
 * 配置化 source → promptId 映射
 * 未来扩展新网站只需在此添加配置
 */

export type PromptId =
  | 'au-basic'    // 澳洲基础分析
  | 'au-full'     // 澳洲深度分析
  | 'us-basic'    // 美国基础分析
  | 'us-full';    // 美国深度分析

export type ListingSource = 'realestate-au' | 'zillow' | 'future-site';

export interface PromptConfig {
  systemPrompt: string;
  userPromptTemplate: string;
}

/**
 * Prompt 路由表
 * key: source (网站来源)
 * value: { basic: promptId, full: promptId }
 */
export const PROMPT_ROUTE_MAP: Record<string, { basic: PromptId; full: PromptId }> = {
  'realestate-au': {
    basic: 'au-basic',
    full: 'au-full',
  },
  'zillow': {
    basic: 'us-basic',
    full: 'us-full',
  },
  // 未来扩展：
  // 'redfin': { basic: 'us-basic', full: 'us-full' },  // 与 Zillow 共用美国 Prompt
};

/**
 * 根据 source 和 analysisType 获取 promptId
 */
export function getPromptId(source: string, analysisType: 'basic' | 'full'): PromptId {
  const route = PROMPT_ROUTE_MAP[source];
  if (!route) {
    throw new Error(`Unsupported source: ${source}`);
  }
  return route[analysisType];
}

/**
 * 获取所有支持的 source 列表
 */
export function getSupportedSources(): string[] {
  return Object.keys(PROMPT_ROUTE_MAP);
}

/**
 * 判断 source 是否支持
 */
export function isSourceSupported(source: string): boolean {
  return source in PROMPT_ROUTE_MAP;
}
