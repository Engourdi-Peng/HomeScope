/**
 * Content Script 通信协议消息类型
 */

// Side Panel -> Content Script
export const MESSAGE_ACTIONS = {
  // 接入层
  PING: 'PING',
  GET_PAGE_STATE: 'GET_PAGE_STATE',
  EXTRACT_LISTING: 'EXTRACT_LISTING',
  REFRESH_EXTRACTION: 'REFRESH_EXTRACTION',

  // 旧版兼容
  GET_PAGE_DATA: 'get_page_data',
  EXTRACT_DATA: 'extract_data',
  DETECT_PAGE: 'detect_page',
} as const;

// Content Script -> Side Panel
export const MESSAGE_RESPONSES = {
  PAGE_STATE: 'PAGE_STATE',
  EXTRACTION_PROGRESS: 'EXTRACTION_PROGRESS',
  EXTRACTION_RESULT: 'EXTRACTION_RESULT',
  EXTRACTION_ERROR: 'EXTRACTION_ERROR',
} as const;

/** 页面状态等级 */
export type ExtractionCompleteness = 'high' | 'medium' | 'low';

/** 分析可信度阈值 */
export const CONFIDENCE_THRESHOLDS = {
  /** 高可信：可立即分析 */
  HIGH: 0.6,
  /** 中可信：可分析但需提示 */
  MEDIUM: 0.35,
  /** 低可信：不可分析 */
  LOW: 0.0,
} as const;

/** 重试延迟配置（ms） */
export const RETRY_DELAYS = [0, 800, 2000] as const;

/** 缓存过期时间（ms） */
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** User-triggered extraction cooldown — prevents rapid re-triggers (ms) */
export const EXTRACTION_COOLDOWN_MS = 20 * 1000;  // 20 seconds

/** In-memory URL cache TTL for extraction results (ms) */
export const EXTRACTION_SESSION_CACHE_TTL_MS = 20 * 1000;  // 20 seconds

/** Content Script Ping 超时（ms） */
export const PING_TIMEOUT_MS = 2000;

/** 图片最小尺寸阈值 */
export const IMAGE_MIN_WIDTH = 100;
export const IMAGE_MIN_HEIGHT = 100;

/** 图片 URL 黑名单关键词 */
export const IMAGE_BLACKLIST_PATTERNS = [
  /\/logo/i,
  /\/icon/i,
  /\/avatar/i,
  /\/button/i,
  /\/badge/i,
  /\/flag/i,
  /\/spacer/i,
  /\/pixel/i,
  /\/tracking/i,
  /\/nav\//i,
  /\/menu\//i,
  /\/header\//i,
  /\/footer\//i,
  /\/banner\//i,
  /\/profile/i,
  /\/user-/i,
];

/** 已知的房产站点配置 */
export const KNOWN_PROPERTY_SITES = {
  'realestate.com.au': {
    id: 'realestate',
    name: 'realestate.com.au',
    pathPatterns: [/\/property\//, /\/rent\//],
    listingIdPattern: /\/(?:property|rent)\/[^\/]+\/(\d+)/,
  },
  'domain.com.au': {
    id: 'domain',
    name: 'domain.com.au',
    pathPatterns: [/\/property\//, /\/rental\//],
    listingIdPattern: /\/(?:property|rental)\/[^\/]+\/(\d+)/,
  },
  'rent.com.au': {
    id: 'rent',
    name: 'rent.com.au',
    pathPatterns: [/\/listings\//, /\/property\//],
    listingIdPattern: /\/listings?\/(\d+)/,
  },
  'allhomes.com.au': {
    id: 'allhomes',
    name: 'allhomes.com.au',
    pathPatterns: [/\/listing\//, /\/rental\//],
    listingIdPattern: /\/listing\/(\d+)/,
  },
  'flatmates.com.au': {
    id: 'flatmates',
    name: 'flatmates.com.au',
    pathPatterns: [/\/rooms\//, /\/listing\//],
    listingIdPattern: /\/listing\/(\d+)/,
  },
} as const;
