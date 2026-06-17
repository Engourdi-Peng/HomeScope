// @ts-nocheck — chrome global type not in tsconfig.libs (pre-existing errors suppressed)
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type {
  AppState,
  AppAction,
  PageStatus,
  PropertyStatus,
  ListingData,
  AnalysisResult,
  ExtUser,
  PropertyDetection,
  ListingDataV2,
  PageStateInfo,
} from './types';
import type { AnalysisSummary, ListingInfo } from '../../shared/types/analysis';
import { PING_TIMEOUT_MS, EXTRACTION_COOLDOWN_MS } from '../../shared/constants';
import { ExtractionErrorCode, getUserErrorMessage } from '../../shared/errors';

// ===== Helper: Inject listingInfo into analysis result =====
//
// IMPORTANT: This function MERGES frontend-extracted listingData with backend-returned
// result data, rather than overwriting backend data with frontend data.
//
// Merge strategy:
// - Backend result has higher priority for ALL fields except the ones that need
//   to be refreshed from the live page (e.g. current URL, session-specific data).
// - Frontend listingData provides fallback values only when backend doesn't have them.
// - For images: prefer backend's analysis images > frontend's thumbnail images.
//
function isV2Data(data: ListingData | ListingDataV2 | null): data is ListingDataV2 {
  // V2: 有 listingUrl 或同时有 images 和 source
  // V1: 没有 listingUrl，有 source 但没有 images
  if (!data) return false;
  // 如果有 listingUrl，必定是 V2
  if ('listingUrl' in data && data.listingUrl) return true;
  // 如果有 images，必定是 V2
  if ('images' in data && Array.isArray((data as any).images) && (data as any).images.length > 0) return true;
  // 如果有 source 但没有 images 且没有 listingUrl，是 V1
  if ('source' in data && !('images' in data)) return false;
  return false;
}

function injectListingInfo(result: AnalysisResult, listingData: ListingData | ListingDataV2 | null): AnalysisResult {
  // If no frontend listingData, return result as-is
  if (!listingData) return result;

  const isV2 = isV2Data(listingData);

  // Get the first frontend image URL (thumbnail, lower priority)
  let frontendFirstImageUrl: string | null = null;
  if (isV2) {
    frontendFirstImageUrl = ((listingData as ListingDataV2).imageUrls?.length ?? 0) > 0
      ? (listingData as ListingDataV2).imageUrls![0]
      : null;
  } else {
    frontendFirstImageUrl = ((listingData as ListingData).imageUrls?.length ?? 0) > 0
      ? (listingData as ListingData).imageUrls![0]
      : null;
  }

  // Get backend's existing listingInfo (from analysis result)
  const backendListingInfo = result?.listingInfo as Record<string, unknown> | null;
  const backendHasImages = Array.isArray(backendListingInfo?.images) && (backendListingInfo.images as unknown[]).length > 0;
  const backendFirstImage = backendHasImages
    ? (backendListingInfo!.images as string[])[0]
    : (backendListingInfo?.coverImageUrl as string | undefined);

  // Merge listingInfo: backend takes priority, frontend provides fallback
  const mergedListingInfo: ListingInfo = {};

  // Helper to get value from merged sources (backend first, then frontend fallback)
  const getMergedString = (
    field: keyof ListingInfo,
    frontendValue: unknown
  ): string | null => {
    // Backend first (analysis result has authoritative data)
    const backendValue = backendListingInfo?.[field];
    if (backendValue != null) {
      if (typeof backendValue === 'string' && backendValue.trim()) return backendValue.trim();
      if (backendValue != null && String(backendValue).trim()) return String(backendValue).trim();
    }
    // Frontend fallback
    if (frontendValue != null) {
      if (typeof frontendValue === 'string' && frontendValue.trim()) return frontendValue.trim();
      if (String(frontendValue).trim()) return String(frontendValue).trim();
    }
    return null;
  };

  const getMergedNumber = (
    field: keyof ListingInfo,
    frontendValue: unknown
  ): number | null => {
    // Backend first (analysis result has authoritative data)
    const backendValue = backendListingInfo?.[field];
    if (backendValue != null) {
      if (typeof backendValue === 'number') return backendValue;
    }
    // Frontend fallback
    if (frontendValue != null) {
      if (typeof frontendValue === 'number') return frontendValue;
      const parsed = parseFloat(String(frontendValue));
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  };

  // Get frontend values based on V1/V2 format
  const getFrontendString = (field: keyof ListingInfo): string | null => {
    if (isV2) {
      const v = (listingData as ListingDataV2)[field];
      if (typeof v === 'string' && v.trim()) return v.trim();
      return null;
    } else {
      // V1 format: price uses priceText field
      if (field === 'price') {
        const v = (listingData as ListingData).priceText || (listingData as ListingData).price;
        if (typeof v === 'string' && v.trim()) return v.trim();
        return null;
      }
      const v = (listingData as ListingData)[field];
      if (typeof v === 'string' && v.trim()) return v.trim();
      return null;
    }
  };

  const getFrontendNumber = (field: keyof ListingInfo): number | null => {
    if (isV2) {
      const v = (listingData as ListingDataV2)[field];
      if (typeof v === 'number') return v;
      return null;
    } else {
      const v = (listingData as ListingData)[field];
      if (typeof v === 'number') return v;
      return null;
    }
  };

  // Build merged listingInfo — backend values take priority, frontend provides fallback
  const title = getMergedString('title', getFrontendString('title'));
  const address = getMergedString('address', getFrontendString('address'));
  const price = getMergedString('price', getFrontendString('price'));
  const priceAmount = getMergedNumber('priceAmount', getFrontendNumber('priceAmount'));
  const bedrooms = getMergedNumber('bedrooms', getFrontendNumber('bedrooms'));
  const bathrooms = getMergedNumber('bathrooms', getFrontendNumber('bathrooms'));
  const parking = getMergedNumber('parking', getFrontendNumber('parking'));
  const sqft = getMergedNumber('sqft', getFrontendNumber('sqft'));
  const propertyType = getMergedString('propertyType', getFrontendString('propertyType'));
  const yearBuilt = getMergedNumber('yearBuilt', getFrontendNumber('yearBuilt'));
  const annualTax = getMergedString('annualTax', getFrontendString('annualTax'));
  const floodZone = getMergedString('floodZone', getFrontendString('floodZone'));
  const heating = getMergedString('heating', getFrontendString('heating'));
  const cooling = getMergedString('cooling', getFrontendString('cooling'));
  const basement = getMergedString('basement', getFrontendString('basement'));

  // Image: prefer backend (analysis images) > frontend (thumbnails)
  // Backend first image comes from analysis, frontend is just a fallback
  const effectiveCoverImageUrl = backendFirstImage ?? frontendFirstImageUrl ?? null;

  // Backend's images array (from analysis) is more valuable than frontend's
  // Only copy frontend images if backend doesn't have any
  const backendImages = backendListingInfo?.images as string[] | undefined;
  const frontendImages = frontendFirstImageUrl ? [frontendFirstImageUrl] : [];

  if (title != null) mergedListingInfo.title = title;
  if (address != null) mergedListingInfo.address = address;
  if (price != null) mergedListingInfo.price = price;
  if (priceAmount != null) mergedListingInfo.priceAmount = priceAmount;
  if (bedrooms != null) mergedListingInfo.bedrooms = bedrooms;
  if (bathrooms != null) mergedListingInfo.bathrooms = bathrooms;
  if (parking != null) mergedListingInfo.parking = parking;
  if (sqft != null) mergedListingInfo.sqft = sqft;
  if (propertyType != null) mergedListingInfo.propertyType = propertyType;
  if (yearBuilt != null) mergedListingInfo.yearBuilt = yearBuilt;
  if (annualTax != null) mergedListingInfo.annualTax = annualTax;
  if (floodZone != null) mergedListingInfo.floodZone = floodZone;
  if (heating != null) mergedListingInfo.heating = heating;
  if (cooling != null) mergedListingInfo.cooling = cooling;
  if (basement != null) mergedListingInfo.basement = basement;
  if (effectiveCoverImageUrl != null) mergedListingInfo.coverImageUrl = effectiveCoverImageUrl;

  // Images: use backend images if available, otherwise use frontend images
  if (backendImages?.length) {
    mergedListingInfo.images = backendImages;
  } else if (frontendImages.length) {
    mergedListingInfo.images = frontendImages;
  }

  // Inject top-level images array for pickFirstImage() fallback
  // Use backend images (more reliable from analysis) or frontend as fallback
  const resultWithImages = { ...result } as AnalysisResult & { images?: string[] };
  if (backendImages?.length) {
    resultWithImages.images = backendImages;
  } else if (frontendFirstImageUrl) {
    resultWithImages.images = [frontendFirstImageUrl];
  }

  return {
    ...resultWithImages,
    listingInfo: Object.keys(mergedListingInfo).length > 0 ? mergedListingInfo : null,
  };
}

// ===== URL Guard Helpers =====

/** 检查 URL 是否可以注入 content script（排除浏览器内部页面） */
function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://') ||
    url.startsWith('devtools://') ||
    url.startsWith('file://') ||
    url.startsWith('resource://')
  );
}

/** 检查 URL 是否是支持的房产网站 */
function isSupportedPropertyUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // 支持 realestate.com.au（含子域名）和 zillow.com（含子域名）
    return (
      host === 'realestate.com.au' ||
      host.endsWith('.realestate.com.au') ||
      host === 'zillow.com' ||
      host.endsWith('.zillow.com')
    );
  } catch {
    return false;
  }
}

/** 返回 URL 友好错误信息的统一函数 */
function getUrlErrorInfo(url: string | undefined): { code: 'UNSUPPORTED_BROWSER_PAGE' | 'UNSUPPORTED_SITE'; message: string } | null {
  if (!url) return null;
  if (!isInjectableUrl(url)) {
    return { code: 'UNSUPPORTED_BROWSER_PAGE', message: getUserErrorMessage(ExtractionErrorCode.UNSUPPORTED_BROWSER_PAGE) };
  }
  if (!isSupportedPropertyUrl(url)) {
    return { code: 'UNSUPPORTED_SITE', message: getUserErrorMessage(ExtractionErrorCode.UNSUPPORTED_SITE) };
  }
  return null;
}

// ===== Convert BasicAnalysisResult to AnalysisResult =====
// Handles both backend format: { overallScore, verdict, quickSummary, ... }
// And legacy format: { listingOverview, textAnalysis, decision, ... }
import type { BasicAnalysisResult } from '../../shared/types/analysis';

interface BasicSyncResult {
  overallScore?: number;
  verdict?: string;
  quickSummary?: string;
  whatLooksGood?: string[];
  riskSignals?: string[];
  reportMode?: 'rent' | 'sale';
  optionalDetails?: Record<string, unknown>;
  sourceDomain?: string | null;
  // Allow any additional fields from Step2 full_result to pass through
  [key: string]: unknown;
}

function convertBasicToFullResult(basicResult: BasicSyncResult): AnalysisResult {
  // Check if this is the new backend format (has overallScore)
  if (basicResult.overallScore !== undefined) {
    // New backend format - direct mapping
    const verdictMap: Record<string, AnalysisResult['verdict']> = {
      'Strong Buy': 'Worth Inspecting',
      'Consider Carefully': 'Need More Evidence',
      'Probably Skip': 'Likely Overpriced / Risky',
    };

    const priorityMap: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'> = {
      'Worth Inspecting': 'HIGH',
      'Need More Evidence': 'MEDIUM',
      'Probably Skip': 'LOW',
    };

    const rawVerdict = basicResult.verdict || '';
    // New Basic v2 verdict values are not in the old map; pass them through as-is.
    // Only apply the old legacy mapping for the three original values.
    const verdict = verdictMap[rawVerdict] ?? (rawVerdict || 'Need More Evidence');
    const overallScore = basicResult.overallScore || 50;

    // Calculate priority based on score
    let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (overallScore >= 65) priority = 'HIGH';
    else if (overallScore < 45) priority = 'LOW';

    const result: AnalysisResult = {
      reportMode: basicResult.reportMode || 'rent',
      analysisType: 'basic',
      overallScore,
      verdict,
      quickSummary: basicResult.quickSummary || 'Basic analysis complete.',
      whatLooksGood: basicResult.whatLooksGood || [],
      riskSignals: basicResult.riskSignals || [],
      realityCheck: '',
      questionsToAsk: [],
      decisionPriority: priority,
      confidenceLevel: 'Low',
    };

    // Add upgrade prompt for basic analysis
    (result as any).upgradePrompt = {
      title: 'Upgrade to Full Analysis',
      features: [
        'AI-powered visual analysis of listing photos',
        'Detailed space-by-space scoring',
        'Competition risk assessment',
        'Agent lingo translation',
      ],
    };

    // Pass through ALL additional fields from the Step2 result (including sourceDomain, pros, cons, etc.)
    // This ensures US Sale fields reach the ResultCard without explicit per-field mapping
    const passthroughFields = [
      'market', 'source', 'listingUrl', 'sourceDomain', 'pros', 'cons',
      'price_assessment', 'investment_potential',
      'carrying_costs', 'maintenance_risk', 'layout_fit', 'listing_language_reality_check',
      'neighborhood_lifestyle', 'legal_compliance',
      'data_gaps', 'questions_to_ask', 'recommendation', 'property_snapshot',
      'room_by_room',
      // US Basic v2 schema fields
      'whats_missing', 'top_3_things_to_check',
      'what_we_know', 'evidence_score', 'bottom_line', 'upsell_cta',
      'listing_signals', 'questions_to_ask', 'verdict',
    ];
    for (const field of passthroughFields) {
      if (field in basicResult) {
        (result as any)[field] = (basicResult as any)[field] ?? null;
      }
    }

    return result;
  }

  // Legacy BasicAnalysisResult format
  const recommendationMap: Record<string, AnalysisResult['verdict']> = {
    high: 'Worth Inspecting',
    medium: 'Need More Evidence',
    low: 'Likely Overpriced / Risky',
  };
  const verdict = recommendationMap[(basicResult as BasicAnalysisResult).decision?.recommendation || ''] || 'Need More Evidence';

  // Calculate overall score based on recommendation
  const scoreMap: Record<string, number> = {
    high: 75,
    medium: 50,
    low: 25,
  };
  const overallScore = scoreMap[(basicResult as BasicAnalysisResult).decision?.recommendation || ''] || 50;

  // Build decision priority
  const priorityMap: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'> = {
    high: 'HIGH',
    medium: 'MEDIUM',
    low: 'LOW',
  };

  const typedResult = basicResult as BasicAnalysisResult;
  const result: AnalysisResult = {
    reportMode: typedResult.reportMode,
    analysisType: 'basic',
    overallScore,
    verdict,
    quickSummary: typedResult.decision?.summary || 'Basic analysis complete.',
    whatLooksGood: typedResult.textAnalysis?.pros || [],
    riskSignals: typedResult.textAnalysis?.cons || [],
    realityCheck: typedResult.textAnalysis?.riskKeywords?.join('. ') || '',
    questionsToAsk: typedResult.decision?.actions || [],
    decisionPriority: priorityMap[typedResult.decision?.recommendation || ''] || 'MEDIUM',
    confidenceLevel: 'Low',
  };

  // Attach basic analysis specific fields for ResultCard compatibility
  (result as any).listingOverview = typedResult.listingOverview;
  (result as any).textAnalysis = typedResult.textAnalysis;
  (result as any).decision = typedResult.decision;
  (result as any).upgradePrompt = typedResult.upgradePrompt;

  return result;
}

// ===== Initial State =====

const initialState: AppState = {
  pageStatus: 'loading',
  propertyStatus: 'idle',
  propertyDetection: null,
  listingData: null,
  readError: null,
  readErrorCode: null,
  pageState: null,
  authStatus: 'checking',
  user: null,
  credits: 0,
  analysisPhase: 'idle',
  analysisProgress: 0,
  analysisError: null,
  analysisResult: null,
  history: [],
  historyLoading: false,
  viewingHistoryId: null,
  currentView: 'home',
  cooldownEndsAt: null,
  extractionCached: false,
  lastExtractedUrl: null,
  sourceTabId: null,
  currentAnalysisType: 'basic',
};

// ===== Reducer =====

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PAGE_STATUS':
      return { ...state, pageStatus: action.pageStatus };

    case 'SET_PROPERTY_STATUS':
      return {
        ...state,
        propertyStatus: action.propertyStatus,
        listingData: action.listingData !== undefined ? action.listingData : state.listingData,
        propertyDetection: action.propertyDetection !== undefined ? action.propertyDetection : state.propertyDetection,
        readError: action.readError !== undefined ? action.readError : null,
      };

    case 'SET_AUTH_STATUS':
      return {
        ...state,
        authStatus: action.authStatus,
        user: action.user !== undefined ? action.user : state.user,
        credits: action.credits !== undefined ? action.credits : state.credits,
      };

    case 'SET_ANALYSIS_PHASE':
      return {
        ...state,
        analysisPhase: action.phase,
        analysisError: action.error ?? null,
      };

    case 'SET_ANALYSIS_PROGRESS':
      return { ...state, analysisProgress: action.progress };

    case 'SET_ANALYSIS_RESULT':
      return { ...state, analysisResult: action.result };

    case 'SET_HISTORY':
      return { ...state, history: action.history };

    case 'SET_HISTORY_LOADING':
      return { ...state, historyLoading: action.loading };

    case 'SET_VIEWING_HISTORY':
      return { ...state, viewingHistoryId: action.id };

    case 'SET_CURRENT_VIEW':
      return { ...state, currentView: action.view };

    case 'SET_PAGE_STATE':
      return { ...state, pageState: action.pageState };

    case 'SET_READ_ERROR':
      return {
        ...state,
        readErrorCode: action.errorCode,
        readError: action.errorMessage,
        pageStatus: 'error' as PageStatus,
        propertyStatus: 'error' as PropertyStatus,
      };

    case 'SET_COOLDOWN':
      return { ...state, cooldownEndsAt: action.cooldownEndsAt };

    case 'SET_EXTRACTION_CACHED':
      return {
        ...state,
        extractionCached: action.extractionCached,
        lastExtractedUrl: action.lastExtractedUrl,
      };

    case 'SET_SOURCE_TAB_ID':
      return { ...state, sourceTabId: action.sourceTabId };

    case 'SET_CURRENT_ANALYSIS_TYPE':
      return { ...state, currentAnalysisType: action.analysisType };

    case 'RESET_ANALYSIS':
      return {
        ...state,
        analysisPhase: 'idle',
        analysisProgress: 0,
        analysisError: null,
        analysisResult: null,
        viewingHistoryId: null,
        // Do NOT reset cooldownEndsAt, extractionCached, lastExtractedUrl
      };

    default:
      return state;
  }
}

// ===== Context =====

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  actions: {
    refreshPageData: () => Promise<void>;
    refreshAll: () => Promise<void>;
    startAnalysis: (options?: { bypassCache?: boolean }) => Promise<void>;
    retryAnalysis: () => Promise<void>;
    refreshPhotos: () => Promise<void>;
    logout: () => Promise<void>;
    loadHistory: () => Promise<void>;
    viewHistoryItem: (id: string) => void;
    viewHistoryResult: (result: AnalysisResult) => void;
    navigateToReport: (result: AnalysisResult | null) => void;
    navigateToHome: () => void;
    sendMagicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
    initiateGoogleOAuth: () => Promise<{ success: boolean; error?: string }>;
    shareAnalysis: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  };
}

const AppContext = createContext<AppContextValue | null>(null);

// ===== Message helper =====

const noop = (..._args: unknown[]) => { if (_args.length) console.warn('[ExtApp]', ..._args); };

function sendMessage<T = unknown>(message: Record<string, unknown>, timeoutMs = 30000): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const resolveOnce = (value: T | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      settled = true;
      noop('[ExtApp] sendMessage: TIMEOUT after', timeoutMs, 'ms for action:', message.action);
      resolveOnce(undefined);
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timer);
      if (settled) return;
      if (chrome.runtime.lastError) {
        noop('[ExtApp] sendMessage: lastError =', chrome.runtime.lastError.message, 'for action:', message.action);
        resolveOnce(undefined);
      } else {
        resolveOnce(response as T);
      }
    });
  });
}

/** 带超时的 sendMessage — 返回结构化结果，便于错误处理 */
interface SendMessageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function sendMessageWithTimeout<T>(
  message: Record<string, unknown>,
  tabId: number,
  timeoutMs: number
): Promise<SendMessageResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'TIMEOUT' });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, data: response as T });
      }
    });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Dedup: throttle get_user_data calls from the sidepanel ──
// Background token refresh on every getAuth() call was creating a feedback loop
// (refresh → save → broadcast → sidepanel refetch → refresh ...). Together with
// the JWT exp check in background.js, this sidepanel-side throttle provides
// defense in depth: even if multiple useEffects re-fire, we only hit the
// background at most once per USER_DATA_DEDUPE_MS.
const USER_DATA_DEDUPE_MS = 5_000;
let _lastUserDataFetchAt = 0;
let _userDataInFlight: Promise<{ status: string; data?: { credits_remaining: number } } | undefined> | null = null;

function fetchUserDataDeduped(): Promise<{ status: string; data?: { credits_remaining: number } } | undefined> {
  const now = Date.now();
  if (_userDataInFlight) {
    // Reuse the in-flight request to avoid parallel calls
    return _userDataInFlight;
  }
  if (now - _lastUserDataFetchAt < USER_DATA_DEDUPE_MS) {
    // Throttled — return undefined so callers treat as "skip this time"
    return Promise.resolve(undefined);
  }
  _lastUserDataFetchAt = now;
  _userDataInFlight = sendMessage<{ status: string; data?: { credits_remaining: number } }>({ action: 'get_user_data' })
    .finally(() => { _userDataInFlight = null; });
  return _userDataInFlight;
}

// ── Shared extraction result type ──
interface ExtractionResult {
  data: ListingData | ListingDataV2 | null;
  error: string | null;
  detection: PropertyDetection | null;
}

/**
 * Wait for content script to be ready with exponential backoff.
 * Retries up to `retries` times with increasing delay (200ms + i*200ms).
 */
async function waitForContentReady(tabId: number, retries = 5): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await sendMessageWithTimeout<{ ready: boolean }>(
        { action: 'PONG' },
        tabId,
        1000
      );
      if (result.success && result.data?.ready) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 200 + i * 200));
  }
  return false;
}

/**
 * Ensures the content script is loaded and performs a lightweight EXTRACT_LISTING.
 * Returns { data, error, detection } — never throws.
 * Used by both initial page load and tab-switch / URL-change refresh.
 */
async function ensureContentScriptThenExtractListing(
  tabId: number
): Promise<ExtractionResult> {
  // Step 0: 获取 tab URL 并做 URL guard
  let tabUrl: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab.url;
  } catch {
    return {
      data: null,
      error: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE),
      detection: null,
    };
  }

  const urlError = getUrlErrorInfo(tabUrl);
  if (urlError) {
    return {
      data: null,
      error: urlError.message,
      detection: null,
    };
  }

  // Step 1: PING — check if content script is already loaded
  let pingOk = false;
  try {
    const pongResult = await sendMessageWithTimeout<{ ready: boolean }>(
      { action: 'PONG' },
      tabId,
      1000
    );
    pingOk = pongResult.success && pongResult.data?.ready === true;
    if (!pingOk) {
      noop('[ExtApp] PING failed:', pongResult.error || 'unknown');
    }
  } catch (err) {
    noop('[ExtApp] PING exception:', err);
  }

  // Step 2: Inject if needed (only if PING failed)
  if (!pingOk) {
    try {
      noop('[ExtApp] Content script not responding, attempting injection...');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      noop('[ExtApp] content.js injected successfully');

      // Wait for content script to initialize with backoff retry
      const ready = await waitForContentReady(tabId, 5);
      if (!ready) {
        noop('[ExtApp] Content script may not be fully loaded after injection');
        return {
          data: null,
          error: 'Content script not ready after injection. Please refresh the page and try again.',
          detection: null,
        };
      }
    } catch (err: any) {
      // 仅对可注入页面打印严重错误；chrome:// 等页面预期失败，不打印
      if (isInjectableUrl(tabUrl)) {
        noop('[ExtApp] executeScript failed:', err.message, err);
      }
      // 注入失败，返回明确错误
      return {
        data: null,
        error: `Failed to inject content script: ${err.message}. Please refresh the page.`,
        detection: null,
      };
    }
  }

  // Step 2b: Verify tab is still valid after injection attempt
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || activeTab.id !== tabId) {
      return {
        data: null,
        error: 'Tab was closed or switched during injection. Please try again.',
        detection: null,
      };
    }
  } catch (err: any) {
    noop('[ExtApp] Tab verification failed:', err.message);
    return {
      data: null,
      error: 'Failed to verify tab status. Please try again.',
      detection: null,
    };
  }

  // Step 3: Extract lightweight listing data (no gallery images)
  try {
    noop('[ExtApp] Sending EXTRACT_LISTING message...');
    const extractResult = await sendMessageWithTimeout<{
      data?: ListingData | ListingDataV2;
      error?: string;
      detection?: PropertyDetection;
    }>({ action: 'EXTRACT_LISTING', includeGalleryImages: false }, tabId, 8000);

    noop('[ExtApp] EXTRACT_LISTING result:', JSON.stringify({
      success: extractResult.success,
      hasData: !!extractResult.data,
      dataKeys: extractResult.data ? Object.keys(extractResult.data) : [],
      error: extractResult.error
    }));

    // 通信失败（timeout 或错误）
    if (!extractResult.success) {
      return {
        data: null,
        error: extractResult.error || 'Failed to communicate with content script. Please try again.',
        detection: null,
      };
    }

    // 内容脚本返回业务错误
    if (extractResult.error) {
      return {
        data: null,
        error: String(extractResult.error),
        detection: extractResult.detection ?? null,
      };
    }

    // 缺少数据
    if (!extractResult.data) {
      return {
        data: null,
        error: 'Could not read listing data. Try again.',
        detection: null,
      };
    }

    // extractResult.data 是 content script 返回的 { data: listingData, error, detection }
    // 需要取出其中的 data 字段才是真正的 listing 数据
    const innerData = (extractResult.data as { data: ListingData | ListingDataV2 }).data;
    const innerDetection = (extractResult.data as { detection?: PropertyDetection }).detection;

    const data = innerData as ListingData | ListingDataV2;
    return {
      data,
      error: null,
      detection: innerDetection ?? null,
    };
  } catch (err) {
    return { data: null, error: String(err), detection: null };
  }
}

/**
 * Pure ping + inject: ensures content script is loaded, returns whether it succeeded.
 * Uses retry mechanism to handle transient connection failures.
 * Used by startAnalysis (no EXTRACT_LISTING call needed there).
 */
async function ensureContentScriptLoaded(tabId: number): Promise<boolean> {
  const PING_TIMEOUT_MS = 3000;  // 3 秒超时，给繁忙页面足够时间
  const MAX_RETRIES = 3;

  // 获取 tab URL 用于错误分类
  let tabUrl: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab.url;
  } catch {
    return false;
  }

  // URL guard — 不可注入页面直接返回 false（不报错）
  if (!isInjectableUrl(tabUrl)) return false;
  if (!isSupportedPropertyUrl(tabUrl)) return false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let pingOk = false;
    let lastError = '';

    try {
      const pongResult = await sendMessageWithTimeout<{ ready: boolean; instanceId?: string }>(
        { action: 'PONG' },
        tabId,
        PING_TIMEOUT_MS
      );
      pingOk = pongResult.success && pongResult.data?.ready === true;
      if (pingOk) {
        if (attempt > 1) {
          noop(`[ExtApp] PING succeeded on attempt ${attempt}`);
        }
        return true;
      }
      lastError = pongResult.error || 'PONG returned !ready';
    } catch (err: any) {
      lastError = err?.message || String(err);
    }

      noop(`[ExtApp] PING attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`);

    // 最后一次尝试失败后才注入
    if (attempt === MAX_RETRIES) {
      try {
        noop('[ExtApp] Content script not responding, injecting...');
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        noop('[ExtApp] content.js injected successfully');

        // 注入后验证
        const verifyResult = await sendMessageWithTimeout<{ ready: boolean }>(
          { action: 'PONG' },
          tabId,
          PING_TIMEOUT_MS
        );
        pingOk = verifyResult.success && verifyResult.data?.ready === true;

        if (pingOk) {
          noop('[ExtApp] Content script ready after injection');
          return true;
        }
        noop('[ExtApp] Content script injected but not ready');
        return false;
      } catch (err: any) {
        // 非可注入页面的 executeScript 失败预期，不需要警告
        if (isInjectableUrl(tabUrl)) {
          noop('[ExtApp] executeScript failed:', err?.message || String(err));
        }
        return false;
      }
    }

    // 短暂等待后再重试
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return false;
}

// ── Unified dispatch helper for extraction results ──
function dispatchExtractionResult(
  dispatch: React.Dispatch<AppAction>,
  result: ExtractionResult,
  pingResult?: { url?: string; title?: string; readyState?: string } | null
) {
  if (!result.data) {
    // Not a property page or extraction failed
    const canAnalyze = result.detection?.canAnalyze ?? false;
    dispatch({
      type: 'SET_PROPERTY_STATUS',
      propertyStatus: canAnalyze ? 'error' : 'not_listing',
      listingData: null,
      propertyDetection: result.detection,
      readError: result.error,
    });
  } else {
    noop('[dispatchExtractionResult] Dispatching SET_PROPERTY_STATUS with detected, data keys:', result.data ? Object.keys(result.data) : []);
    dispatch({
      type: 'SET_PROPERTY_STATUS',
      propertyStatus: 'detected',
      listingData: result.data,
      propertyDetection: result.detection,
      readError: null,
    });

    // Also populate pageState for debugging / observability
    if (pingResult) {
      const stateInfo: PageStateInfo = {
        url: pingResult.url ?? '',
        title: pingResult.title ?? '',
        readyState: (pingResult.readyState ?? 'unknown') as DocumentReadyState,
        isPropertyLike: true,
        extractionStage: 'initial',
        basicSignals: result.detection?.signals as PageStateInfo['basicSignals'],
      };
      dispatch({ type: 'SET_PAGE_STATE', pageState: stateInfo });
    }
  }
}

/** Layer A: 稳定的页面数据接入函数 */
async function initializePageData(dispatch: React.Dispatch<AppAction>) {
  dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'loading' });

  let tabId: number | undefined;
  let tabUrl: string | undefined;
  let tabTitle: string | undefined;
  let tabStatus: string | undefined;
  let pingResult: { ready: boolean; url?: string; title?: string; readyState?: string } | null = null;

  // Step 1: 获取当前激活 tab
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
      return;
    }
    tabId = activeTab.id;
    tabUrl = activeTab.url;
    tabTitle = activeTab.title;
    tabStatus = activeTab.status;
    pingResult = { ready: true, url: tabUrl, title: tabTitle, readyState: tabStatus };

    // Step 2: URL guard — 排除不可注入页面和非支持网站
    // 必须放在 try block 内，因为 activeTab 在这里才有效
    const urlError = getUrlErrorInfo(tabUrl);
    if (urlError) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: urlError.code, errorMessage: urlError.message });
      return;
    }
  } catch {
    dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
    return;
  }

  // Step 3: Ping + inject + EXTRACT_LISTING (shared path)
  const result = await ensureContentScriptThenExtractListing(tabId!);

  // Step 3: Dispatch unified result
  dispatchExtractionResult(dispatch, result, pingResult);

  // Step 4: Save the source tab ID so subsequent analysis calls use the correct tab
  // even after the user focuses the sidepanel
  if (result.data && tabId != null) {
    dispatch({ type: 'SET_SOURCE_TAB_ID', sourceTabId: tabId });
  }

  dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'ready' });
}

// ===== Provider =====

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Destructure frequently-used state slices at the top level so they are
  // always up-to-date in callbacks (avoids stale-closure bugs in useCallback).
  const { listingData, analysisResult } = state;

  const refreshUserDataAndHistory = useCallback(async (user: ExtUser) => {
    try {
      const userData = await fetchUserDataDeduped();

      if (userData && userData.status === 'success' && userData.data) {
        dispatch({
          type: 'SET_AUTH_STATUS',
          authStatus: 'logged_in',
          user,
          credits: userData.data.credits_remaining,
        });
      } else {
        dispatch({
          type: 'SET_AUTH_STATUS',
          authStatus: 'logged_in',
          user,
        });
      }
    } catch (err) {
      noop('[ExtApp] Refresh user data failed:', err);
      dispatch({
        type: 'SET_AUTH_STATUS',
        authStatus: 'logged_in',
        user,
      });
    }

    dispatch({ type: 'SET_HISTORY_LOADING', loading: true });
    try {
      const response = await sendMessage<{
        status: string;
        analyses?: AnalysisSummary[];
      }>({ action: 'get_analysis_history', limit: 8, offset: 0 });

      if (response.status === 'success' && response.analyses) {
        dispatch({ type: 'SET_HISTORY', history: response.analyses });
      }
    } catch (err) {
      noop('[ExtApp] Load history failed:', err);
    } finally {
      dispatch({ type: 'SET_HISTORY_LOADING', loading: false });
    }
  }, []);

  // ---- 初始化：检查认证状态 ----
  useEffect(() => {
    // Guard: skip if already logged in (prevents double dispatch when
    // refreshUserDataAndHistory also updates authStatus inside this same effect).
    if (state.authStatus === 'logged_in') return;

    let cancelled = false;
    const checkAuth = async () => {
      try {
        const authResult = await sendMessage<{
          state: string;
          user?: ExtUser;
        }>({ action: 'check_auth_status' });

        if (cancelled) return;
        if (authResult.state === 'authenticated' && authResult.user) {
          await refreshUserDataAndHistory(authResult.user);
        } else if (!cancelled) {
          dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out' });
        }
      } catch (err) {
        if (!cancelled) {
          noop('[ExtApp] Auth check failed:', err);
          dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out' });
        }
      }
    };

    checkAuth();
    return () => { cancelled = true; };
  }, [state.authStatus, refreshUserDataAndHistory]);

  // ---- 初始化：接入页面数据（Layer A: Ping -> 运行时注入 -> 获取状态）----
  useEffect(() => {
    initializePageData(dispatch);
  }, []);

  // ---- 监听 background 广播的消息 ----
  useEffect(() => {
    const handleMessage = (message: Record<string, unknown>) => {
      if (message.action === 'auth_status_changed') {
        if (message.authenticated && message.user) {
          const user = message.user as ExtUser;
          dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_in', user });
          void refreshUserDataAndHistory(user);
        } else {
          dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out' });
          dispatch({ type: 'SET_HISTORY', history: [] });
        }
      }

      if (message.action === 'analysis_progress') {
        const stage = (message.stage as string) || '';
        const progress = (message.progress as number) || 0;
        dispatch({ type: 'SET_ANALYSIS_PROGRESS', progress });

        // Map backend stage to frontend phase
        // Note: 'extracting' and 'image' are NOT included in collecting_photos because
        // they incorrectly match backend stages like 'detecting_rooms' and 'extracting_strengths_and_issues'
        if (stage.includes('uploading') || stage.includes('Reading')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'reading_page' });
        } else if (stage.includes('gallery') || stage.includes('gallery_open') || stage.includes('opening_gallery')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'opening_gallery' });
        } else if (stage.includes('photo')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'collecting_photos' });
        } else if (stage.includes('send') || stage.includes('uploading') || stage.includes('sending') || stage.includes('upload_received')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });
        } else if (stage.includes('analyse') || stage.includes('evaluating') || stage.includes('strengths') || stage.includes('competition') || stage.includes('detecting') || stage.includes('evaluating') || stage.includes('extracting_strengths')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'analysing' });
        } else if (stage.includes('生成') || stage.includes('building') || stage.includes('final') || stage.includes('report')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'generating_report' });
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [refreshUserDataAndHistory]);

  // ── Tab 切换 / URL 变化时自动轻量读取（仅在已登录时生效）----
  useEffect(() => {
    if (state.authStatus !== 'logged_in') return;

    let currentWindowId: number | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // ── URL 标准化辅助函数 ─────────────────────────────────────
    // 去除跟踪参数和 hash，用于比较两个 URL 是否指向同一页面
    function normalizeUrlForComparison(url: string): string {
      if (!url) return '';
      try {
        const parsed = new URL(url);
        // Strip common tracking parameters
        parsed.searchParams.delete('utm_source');
        parsed.searchParams.delete('utm_medium');
        parsed.searchParams.delete('utm_campaign');
        parsed.searchParams.delete('ref');
        parsed.searchParams.delete('source');
        // Strip hash
        parsed.hash = '';
        return parsed.toString().toLowerCase();
      } catch {
        return url.toLowerCase();
      }
    }

    async function getCurrentWindowId() {
      try {
        const win = await chrome.windows.getCurrent();
        return win.id;
      } catch {
        return null;
      }
    }

    async function handleTabChange(tabId: number, changeInfo?: { url?: string; status?: string }) {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        if (currentWindowId === null) {
          currentWindowId = await getCurrentWindowId();
        }
        // 只处理当前窗口的标签页变化
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.windowId !== currentWindowId) return;
          if (!tab.active) return; // 只处理激活的标签页
        } catch {
          return;
        }

        // 提取当前激活标签页的数据（复用 shared helper）
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.id) return;

          // URL guard — 非支持页面静默跳过
          const urlError = getUrlErrorInfo(activeTab.url);
          if (urlError) return;

          const pingResult = { url: activeTab.url, title: activeTab.title, readyState: activeTab.status };
          const result = await ensureContentScriptThenExtractListing(activeTab.id);

          // ── URL 校验：防止陈旧数据显示 ─────────────────────────────
          // 在搜索结果页→房源详情页切换时，content script 可能在旧页面运行
          // 导致提取到陈旧数据。通过比对提取结果的 URL 与当前 tab URL 来检测
          const extractedUrl = (result.data as any)?.listingUrl || (result.data as any)?.url || '';
          const normalizedExtracted = normalizeUrlForComparison(extractedUrl);
          const normalizedTab = normalizeUrlForComparison(activeTab.url);
          if (extractedUrl && normalizedExtracted !== normalizedTab) {
            noop('[ExtApp] URL mismatch detected, skipping stale data', {
              extracted: extractedUrl,
              current: activeTab.url,
            });
            // 不更新 listingData，保持当前显示的内容
            return;
          }

          // 静默更新：保持当前 analysisPhase 不变，仅更新卡片数据
          dispatchExtractionResult(dispatch, result, pingResult);
          // 更新 sourceTabId：用户切换到了新的房产页面
          if (result.data && activeTab.id != null) {
            dispatch({ type: 'SET_SOURCE_TAB_ID', sourceTabId: activeTab.id });
          }
        } catch {
          // 自动刷新失败不提示，避免干扰用户
        }
      }, 400);
    }

    // chrome.tabs.onActivated
    const onActivated = (activeInfo: { tabId: number; windowId: number }) => {
      void handleTabChange(activeInfo.tabId);
    };

    // chrome.tabs.onUpdated — 仅在 status === 'complete' 时触发
    const onUpdated = (tabId: number, changeInfo: { status?: string; url?: string }) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        void handleTabChange(tabId, changeInfo);
      }
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [state.authStatus]);

  // ---- Actions ----

  /** 刷新页面数据（轻量自动读取 + 展示卡片） */
  const refreshPageData = useCallback(async () => {
    dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'loading' });
    dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'reading' });

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
      return;
    }

    // URL guard
    const urlError = getUrlErrorInfo(tab.url);
    if (urlError) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: urlError.code, errorMessage: urlError.message });
      return;
    }

    const pingResult = { url: tab.url, title: tab.title, readyState: tab.status };
    const result = await ensureContentScriptThenExtractListing(tab.id);
    dispatchExtractionResult(dispatch, result, pingResult);
    if (result.data && tab.id != null) {
      dispatch({ type: 'SET_SOURCE_TAB_ID', sourceTabId: tab.id });
    }
    dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'ready' });
  }, []);

  /** 刷新所有：页面数据 + 用户积分 + 历史记录 */
  const refreshAll = useCallback(async () => {
    // 1. 刷新页面数据
    await refreshPageData();

    // 2. 刷新用户积分
    if (state.user) {
      fetchUserDataDeduped().then((userData) => {
        if (userData?.status === 'success' && userData.data) {
          dispatch({
            type: 'SET_AUTH_STATUS',
            authStatus: 'logged_in',
            credits: userData.data!.credits_remaining,
          });
        }
      }).catch(() => {});
    }

    // 3. 刷新历史记录
    sendMessage<{
      status: string;
      analyses?: AnalysisSummary[];
    }>({ action: 'get_analysis_history', limit: 8, offset: 0 }).then((response) => {
      if (response.status === 'success' && response.analyses) {
        dispatch({ type: 'SET_HISTORY', history: response.analyses });
      }
    }).catch(() => {});
  }, [refreshPageData, state.user]);

  /**
   * User-triggered analysis flow.
   *
   * Flow:
   *   1. Check cooldown — if active, abort silently (UI shows countdown via useEffect)
   *   2. Check URL cache — if cached result exists for current URL, skip extraction
   *   3. Ensure content script is loaded
   *   4. Send START_USER_EXTRACTION → content script opens gallery + collects images
   *   5. Dispatch SET_ANALYSIS_PHASE('sending_data')
   *   6. Submit to analyze API (basic: direct, full: submit+run+poll)
   *   7. On success: SET_ANALYSIS_PHASE('done'), set cooldown
   */
  const startAnalysis = useCallback(async (options?: { bypassCache?: boolean; analysisType?: 'basic' | 'full' }) => {
    const bypassCache = options?.bypassCache ?? false;
    const analysisType = options?.analysisType ?? 'full';

    noop('[ExtApp] startAnalysis called:', { bypassCache, analysisType });

    // Step 1: Check cooldown
    const now = Date.now();
    if (!bypassCache && state.cooldownEndsAt !== null && now < state.cooldownEndsAt) {
      return;
    }

    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'preparing', error: null });
    dispatch({ type: 'SET_ANALYSIS_RESULT', result: null });
    dispatch({ type: 'SET_VIEWING_HISTORY', id: null });

    // Step 1: Determine which tab to use for analysis
    // Prefer the stored source tab ID (captured when sidepanel first loaded),
    // so analysis still works after the user focuses the sidepanel.
    // Fall back to querying the active tab if no source tab is stored.
    let tabId: number;
    let currentUrl: string = '';

    if (state.sourceTabId != null) {
      tabId = state.sourceTabId;
      // Verify the tab still exists and get its URL
      try {
        const tab = await chrome.tabs.get(tabId);
        currentUrl = tab.url || '';
      } catch {
        // Tab no longer exists — fall back to active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Tab unavailable' });
          return;
        }
        tabId = tab.id;
        currentUrl = tab.url || '';
      }
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Tab unavailable' });
        return;
      }
      tabId = tab.id;
      currentUrl = tab.url || '';
    }

    // Step 2: URL guard — prevent injection into chrome:// pages or unsupported sites
    const urlError = getUrlErrorInfo(currentUrl);
    if (urlError) {
      dispatch({
        type: 'SET_ANALYSIS_PHASE',
        phase: 'error',
        error: urlError.message,
      });
      return;
    }

    // Step 3: Check URL cache - validate cached data before reuse
    if (!bypassCache && state.lastExtractedUrl === currentUrl && state.extractionCached && state.listingData) {
      const cached = state.listingData as ListingData | ListingDataV2;
      const hasImages = Array.isArray(cached.imageUrls) && cached.imageUrls.length > 0;
      const hasValidDesc = cached.description && cached.description.trim().length > 30;

      if (hasImages || hasValidDesc) {
        noop('[ExtApp] Cache HIT - valid:', { images: cached.imageUrls?.length, descLen: cached.description?.length });
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });
        await submitAnalysis(cached, analysisType);
        return;
      }

      noop('[ExtApp] Cache HIT but INVALID - bypassing cache (no images/short desc)');
      // Continue to force re-extraction
    }

    // Step 3: Ensure content script is loaded (reuse shared helper)
    await ensureContentScriptLoaded(tabId);

    // Step 4: Send START_USER_EXTRACTION
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'reading_page' });
    dispatch({ type: 'SET_CURRENT_ANALYSIS_TYPE', analysisType });

    // Define the expected response structure from content script
    type ContentScriptResponse = {
      success: boolean;
      data?: ListingData | ListingDataV2;
      error?: string;
      detection?: PropertyDetection;
      code?: string;
    };

    let extractResult: { success: boolean; data?: ContentScriptResponse; error?: string } | null = null;
    try {
      extractResult = await sendMessageWithTimeout<ContentScriptResponse>(
        { action: 'START_USER_EXTRACTION', bypassCache, analysisType },
        tabId,
        60000  // 60秒，给图片多的页面足够时间
      );
    } catch (err) {
      noop('[ExtApp] sendMessageWithTimeout threw:', err);
    }

    // 检查通信层是否成功
    if (!extractResult || !extractResult.success) {
      const errorMsg = extractResult?.error || 'Communication failed';
      noop('[ExtApp] startAnalysis: sendMessageWithTimeout failed:', errorMsg);
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Failed to communicate with content script. Please try again.' });
      return;
    }

    // 检查 content script 返回的业务层数据
    const response = extractResult.data;
    if (!response) {
      noop('[ExtApp] startAnalysis: no data in response');
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'No data received from content script.' });
      return;
    }

    // 处理 content script 的业务错误
    if (!response.success) {
      const errorMsg = response.error || 'Extraction failed';
      const errorCode = response.code;

      // Handle rate limit error - set cooldown and show countdown
      if (errorCode === 'RATE_LIMIT') {
        noop('[ExtApp] startAnalysis: rate limited');
        // Set cooldown to 1 minute (matches content.js RATE_CONFIG.cooldownMs)
        dispatch({ type: 'SET_COOLDOWN', cooldownEndsAt: Date.now() + 60 * 1000 });
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: errorMsg });
        return;
      }

      if (response.detection && !response.detection.canAnalyze) {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: "This doesn't look like a property listing page" });
      } else {
        noop('[ExtApp] startAnalysis: extraction failed:', errorMsg, 'code:', errorCode);
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: errorMsg });
      }
      return;
    }

    // 成功！提取 listingData
    const listingData = response.data;
    if (!listingData) {
      noop('[ExtApp] startAnalysis: listingData is undefined in response.data');
      noop('[ExtApp] response keys:', Object.keys(response));
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Failed to parse listing data. Please try again.' });
      return;
    }

    noop('[ExtApp] startAnalysis: extraction successful, images:', (listingData as any).imageUrls?.length || (listingData as any).images?.length || 0);

    dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'detected', listingData, propertyDetection: response.detection ?? null });

    // Mark URL as cached
    dispatch({ type: 'SET_EXTRACTION_CACHED', extractionCached: true, lastExtractedUrl: currentUrl });

    // Step 5: Submit to analyze API (passes analysisType)
    await submitAnalysis(listingData, analysisType);
  }, [state.cooldownEndsAt, state.lastExtractedUrl, state.extractionCached, state.listingData, state.sourceTabId]);

  /**
   * Poll for analysis status from frontend.
   * Separated so it runs in the React side panel context (not background).
   * This avoids Service Worker termination issues that caused sendResponse loss.
   */
  async function pollAnalysisStatus(analysisId: string) {
    const POLL_INTERVAL_MS = 3000;
    const MAX_POLL_MS = 180_000; // 3 minutes max for full analysis
    const MAX_SW_RETRIES = 3; // Max consecutive SW unavailable retries before giving up

    const startTime = Date.now();
    let swUnavailableCount = 0;

    while (Date.now() - startTime < MAX_POLL_MS) {
      try {
        const statusResponse = await sendMessage<{
          status?: string;
          result?: AnalysisResult;
          error?: string;
          stage?: string;
          progress?: number;
        }>({
          action: 'get_analysis_status',
          analysisId,
        });

        // Guard: SW may be dead mid-poll
        if (!statusResponse) {
          swUnavailableCount++;
          if (swUnavailableCount >= MAX_SW_RETRIES) {
            // After multiple retries, assume analysis failed or is stuck
            dispatch({
              type: 'SET_ANALYSIS_PHASE',
              phase: 'error',
              error: 'Connection lost. Please check history to see if analysis completed.',
            });
            return;
          }
          await sleep(3000);
          continue;
        }

        // Reset counter on successful response
        swUnavailableCount = 0;

        if (statusResponse.status === 'done' && statusResponse.result) {
          const resultWithListingInfo = injectListingInfo(statusResponse.result, state.listingData);
          // Override reportMode from API top-level field (source of truth from analyses table)
          const reportMode = (statusResponse as any).report_mode as string | undefined;
          if (reportMode && resultWithListingInfo) {
            (resultWithListingInfo as AnalysisResult).reportMode = reportMode as 'rent' | 'sale';
          }

          // Analysis completed successfully
          dispatch({ type: 'SET_ANALYSIS_RESULT', result: resultWithListingInfo });
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'done' });
          dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });

          // Set 20s cooldown to prevent rapid re-triggers
          dispatch({ type: 'SET_COOLDOWN', cooldownEndsAt: Date.now() + EXTRACTION_COOLDOWN_MS });

          // Refresh credits — only when logged in (full analysis requires auth)
          if (state.authStatus === 'logged_in') {
            const userData = await fetchUserDataDeduped();
            if (userData && userData.status === 'success' && userData.data) {
              dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_in', credits: userData.data.credits_remaining });
            }

            // Refresh history so new analysis appears immediately
            sendMessage<{
              status: string;
              analyses?: AnalysisSummary[];
            }>({ action: 'get_analysis_history', limit: 8, offset: 0 }).then((response) => {
              if (response.status === 'success' && response.analyses) {
                dispatch({ type: 'SET_HISTORY', history: response.analyses });
              }
            }).catch(() => {});
          }

          return;
        }

        if (statusResponse.status === 'failed') {
          dispatch({
            type: 'SET_ANALYSIS_PHASE',
            phase: 'error',
            error: statusResponse.error || 'Analysis failed',
          });
          return;
        }

        // Update progress based on backend stage
        if (statusResponse.stage) {
          const stage = statusResponse.stage;
          if (stage.includes('uploading') || stage.includes('Reading')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'reading_page' });
          } else if (stage.includes('gallery') || stage.includes('gallery_open') || stage.includes('opening_gallery')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'opening_gallery' });
          } else if (stage.includes('photo')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'collecting_photos' });
          } else if (stage.includes('send') || stage.includes('uploading') || stage.includes('sending') || stage.includes('upload_received')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });
          } else if (stage.includes('analyse') || stage.includes('evaluating') || stage.includes('strengths') || stage.includes('competition') || stage.includes('detecting') || stage.includes('extracting_strengths')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'analysing' });
          } else if (stage.includes('生成') || stage.includes('building') || stage.includes('final') || stage.includes('report')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'generating_report' });
          }

          if (statusResponse.progress != null) {
            dispatch({ type: 'SET_ANALYSIS_PROGRESS', progress: statusResponse.progress });
          }
        }
      } catch (err) {
        // Continue polling despite errors
      }

      await sleep(POLL_INTERVAL_MS);
    }

    // Timeout after max poll duration
    dispatch({
      type: 'SET_ANALYSIS_PHASE',
      phase: 'error',
      error: 'Analysis timed out. Please check history to see if it completed.',
    });
  }

  /**
   * Shared API submission step. Supports both 'basic' (lightweight sync) and 'full' (deep) analysis.
   * - basic: Direct API call to basic-sync endpoint, no auth required, no images, no polling
   * - full: Full async flow (submit + run + poll), requires auth, uses images
   */
  async function submitAnalysis(listingData: ListingData | ListingDataV2, analysisType: 'basic' | 'full' = 'full') {
    noop('[ExtApp] submitAnalysis called:', { analysisType });

    // Basic analysis: lightweight direct path
    if (analysisType === 'basic') {
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'analysing', error: null });

      // Dedup key: url + price uniquely identifies a listing + price combo
      const dedupeKey = `${listingData?.url || listingData?.address || ''}::${listingData?.price || ''}`;

      // Timeout tiers: first attempt 120s (LLM may take 30-60s, backend can take up to ~90s)
      const BASIC_TIMEOUT_MS = 120000;
      const RETRY_TIMEOUT_MS = 120000;

      // Helper: process API response and dispatch result/error
      // Called for both the first attempt and any retry.
      async function processBasicResponse(res, attempt) {
        noop('[ExtApp] submitAnalysis (basic): received response after attempt', attempt, {
          responseStatus: res?.status,
          hasResult: !!res?.result,
          hasError: !!res?.error,
          error: res?.error,
          hasAnalysisId: !!res?.analysisId,
        });

        if (!res) {
          if (attempt === 1) {
            noop('[ExtApp] submitAnalysis (basic): attempt 1 timed out, retrying with dedupe key...');
            const retryRes = await sendMessage<{
              status: string;
              result?: AnalysisResult;
              error?: string;
              analysisId?: string | null;
            }>({ action: 'analyze_basic', data: listingData, _dedupeKey: dedupeKey }, RETRY_TIMEOUT_MS);
            return processBasicResponse(retryRes, 2);
          } else {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Analysis timed out after retry. Please try again.' });
            return;
          }
        }

        const isSuccess = res.status === 'success' || res.status === 'done';
        if (isSuccess && res.result) {
          noop('[ExtApp] submitAnalysis (basic): converting to full result format...');
          const fullResult = convertBasicToFullResult(res.result);
          noop('[ExtApp] submitAnalysis (basic): fullResult.overallScore:', fullResult.overallScore);

          const analysisId = res.analysisId;
          if (analysisId) {
            noop('[ExtApp] submitAnalysis (basic): history record created, analysisId:', analysisId);
            fullResult.id = analysisId;
            // Only refresh history when logged in — guests have no history
            if (state.authStatus === 'logged_in') {
              sendMessage<{ status: string; analyses?: AnalysisSummary[] }>({ action: 'get_analysis_history', limit: 8, offset: 0 }).then((historyResponse) => {
                if (historyResponse?.status === 'success' && historyResponse.analyses) {
                  dispatch({ type: 'SET_HISTORY', history: historyResponse.analyses });
                }
              }).catch(() => {});
            }
          }

          const resultWithListingInfo = injectListingInfo(fullResult, listingData);
          dispatch({ type: 'SET_ANALYSIS_RESULT', result: resultWithListingInfo });
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'done' });
          dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });
          return;
        }

        // Non-timeout error (API returned an error status)
        dispatch({
          type: 'SET_ANALYSIS_PHASE',
          phase: 'error',
          error: res.error || 'Analysis failed. Please try again.',
        });
      }

      noop('[ExtApp] submitAnalysis (basic): sending to background', {
        hasDescription: !!listingData.description,
        descriptionLen: listingData.description?.length || 0,
        hasTitle: !!listingData.title,
        hasPrice: !!listingData.price,
        dedupeKey,
      });

      const response = await sendMessage<{
        status: string;
        result?: AnalysisResult;
        error?: string;
        analysisId?: string | null;
      }>({
        action: 'analyze_basic',
        data: listingData,
        _dedupeKey: dedupeKey,
      }, BASIC_TIMEOUT_MS);

      await processBasicResponse(response, 1);
      return;
    }

    // Full analysis: traditional async flow (requires auth, uses images)
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data', error: null });

  // Guard: ensure listingData is valid
  if (!listingData || typeof listingData !== 'object') {
    noop('[Analytics] submitAnalysis called with invalid listingData:', listingData);
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Invalid listing data' });
    return;
  }

  // DIAG: Enhanced logging for debugging
  noop('[Analytics] submitAnalysis called with:', JSON.stringify({
    hasImageUrls: !!listingData.imageUrls,
    imageUrlsLen: (listingData.imageUrls || []).length,
    imageUrlsFirst3: (listingData.imageUrls || []).slice(0, 3),
    hasImages: !!(listingData as any).images,
    imagesLen: ((listingData as any).images || []).length,
    hasDescription: !!listingData.description,
    descriptionLen: listingData.description?.length || 0,
    descriptionPreview: listingData.description?.substring(0, 100),
    hasTitle: !!listingData.title,
    hasAddress: !!listingData.address,
    hasPrice: !!listingData.price,
    hasReportMode: !!listingData.reportMode,
    reportMode: listingData.reportMode,
    allKeys: Object.keys(listingData)
  }));

  // Ensure we have either images OR description (Edge Function validation requirement)
  // Support both field names: imageUrls (from content script) and images (from ListingDataV2)
  const effectiveImageUrls = listingData.imageUrls ?? (listingData as any).images ?? [];
  noop('[Analytics] effectiveImageUrls count:', effectiveImageUrls.length);

  if (effectiveImageUrls.length === 0 && !listingData.description) {
    const fallbackParts = [
      listingData.title,
      listingData.address,
      `Price: ${listingData.price || 'Not specified'}`,
      listingData.bedrooms ? `${listingData.bedrooms} beds` : null,
      listingData.bathrooms ? `${listingData.bathrooms} baths` : null,
    ].filter(Boolean);
    listingData.description = fallbackParts.join(' | ') || 'Property listing information';
    noop('[Analytics] Added fallback description:', listingData.description);
  }

  // DIAG: Log the actual data being sent
  noop('[Analytics] About to send to background:', JSON.stringify({
    action: 'analyze',
    dataKeys: Object.keys(listingData),
    dataImageUrls: listingData.imageUrls,
    dataImages: (listingData as any).images,
    dataDescription: listingData.description
  }));

  try {
    const response = await sendMessage<{
        status: string;
        analysisId?: string;
        result?: AnalysisResult;
        error?: string;
      }>({
        action: 'analyze',
        data: listingData,
      });

      // Guard: sendMessage returns undefined when SW is dead or times out
      if (!response) {
        dispatch({
          type: 'SET_ANALYSIS_PHASE',
          phase: 'error',
          error: 'Service worker was unavailable. Please try again.',
        });
        return;
      }

      if (response.status === 'submitted' && response.analysisId) {
        // Start polling from frontend
        void pollAnalysisStatus(response.analysisId);
        return;
      }

      if (response.status === 'no_credits') {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'no_credits' });
        return;
      }

      dispatch({
        type: 'SET_ANALYSIS_PHASE',
        phase: 'error',
        error: response.error || 'Analysis failed',
      });
    } catch (err) {
      // Clear invalid cache on failure to force re-extraction on retry
      dispatch({ type: 'SET_EXTRACTION_CACHED', extractionCached: false, lastExtractedUrl: null });
      const msg = err instanceof Error ? err.message : String(err);
      noop('[ExtApp] submitAnalysis: unhandled exception =', msg);
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: msg || 'Analysis failed unexpectedly.' });
    }
  }

  const retryAnalysis = useCallback(async () => {
    // Capture current type BEFORE reset (reset clears currentAnalysisType to 'basic')
    const typeToRetry = state.currentAnalysisType;
    dispatch({ type: 'RESET_ANALYSIS' });
    await startAnalysis({ bypassCache: true, analysisType: typeToRetry });
  }, [startAnalysis, state.currentAnalysisType]);

  /** Force a fresh image extraction, bypassing the URL result cache */
  const refreshPhotos = useCallback(async () => {
    dispatch({ type: 'RESET_ANALYSIS' });
    dispatch({ type: 'SET_EXTRACTION_CACHED', extractionCached: false, lastExtractedUrl: null });
    await startAnalysis({ bypassCache: true, analysisType: 'full' });
  }, [startAnalysis]);

  const logout = useCallback(async () => {
    try {
      await sendMessage({ action: 'logout' });
      dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out', user: null, credits: 0 });
      dispatch({ type: 'RESET_ANALYSIS' });
      dispatch({ type: 'SET_HISTORY', history: [] });
    } catch (err) {
      noop('[ExtApp] Logout failed:', err);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!state.user) return;
    await refreshUserDataAndHistory(state.user);
  }, [refreshUserDataAndHistory, state.user]);

  const viewHistoryItem = useCallback((id: string) => {
    dispatch({ type: 'SET_VIEWING_HISTORY', id });
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'idle' });
    dispatch({ type: 'SET_ANALYSIS_RESULT', result: null });
  }, []);

  const viewHistoryResult = useCallback((result: AnalysisResult) => {
    dispatch({ type: 'SET_ANALYSIS_RESULT', result });
  }, []);

  const navigateToReport = useCallback((result: AnalysisResult | null) => {
    // If a result is passed (e.g. from history), display it
    if (result) {
      dispatch({ type: 'SET_ANALYSIS_RESULT', result });
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'done' });
      dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });
      // Scroll to top when navigating to report
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    // Otherwise, start a new analysis: reset state + switch view + trigger analysis
    dispatch({ type: 'RESET_ANALYSIS' });
    dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });
    // Scroll to top when navigating to report
    window.scrollTo({ top: 0, behavior: 'instant' });
    // startAnalysis will be called by ExtensionResultView once the view mounts
  }, []);

  const navigateToHome = useCallback(() => {
    dispatch({ type: 'SET_CURRENT_VIEW', view: 'home' });
    // Refresh user credits when returning to home — only when logged in
    if (state.user) {
      fetchUserDataDeduped().then((userData) => {
        if (userData?.status === 'success' && userData.data) {
          dispatch({
            type: 'SET_AUTH_STATUS',
            authStatus: 'logged_in',
            credits: userData.data!.credits_remaining,
          });
        }
      }).catch(() => {
        // Silently ignore refresh failures
      });
    }
  }, [state.user]);

  const sendMagicLink = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await sendMessage<{ success: boolean; error?: string }>({
        action: 'send_magic_link',
        email,
      });
      return result;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }, []);

  const initiateGoogleOAuth = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await sendMessage<{ success?: boolean; error?: string }>({ action: 'initiate_google_oauth' });
      if (result?.success) return { success: true };
      return { success: false, error: result?.error || 'Google sign-in failed' };
    } catch (err) {
      noop('[ExtApp] Google OAuth failed:', err);
      return { success: false, error: String(err) };
    }
  }, []);

  const shareAnalysis = useCallback(async (analysisId: string): Promise<{ slug: string; shareUrl: string }> => {
    if (!analysisId) {
      throw new Error('Analysis ID not found');
    }
    // Derive sourceDomain from listingData or analysisResult for server routing
    const sourceDomain =
      (listingData as any)?.sourceDomain ||
      (listingData as any)?.source?.domain ||
      (analysisResult as any)?.sourceDomain ||
      (analysisResult as any)?.listingInfo?.sourceDomain ||
      null;
    try {
      const result = await sendMessage<{
        status: string;
        success?: boolean;
        slug?: string;
        shareUrl?: string;
        error?: string;
      }>({ action: 'share_analysis', analysisId, sourceDomain });

      if ((result.status === 'success' || result.success === true) && result.slug && result.shareUrl) {
        return { slug: result.slug, shareUrl: result.shareUrl };
      }
      throw new Error(result.error || 'Failed to share analysis');
    } catch (err) {
      noop('[ExtApp] shareAnalysis error:', err);
      throw err;
    }
  }, [listingData, analysisResult]);

  const value: AppContextValue = {
    state,
    dispatch,
    actions: {
      refreshPageData,
      refreshAll,
      startAnalysis,
      retryAnalysis,
      refreshPhotos,
      logout,
      loadHistory,
      viewHistoryItem,
      viewHistoryResult,
      navigateToReport,
      navigateToHome,
      sendMagicLink,
      initiateGoogleOAuth,
      shareAnalysis,
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ===== Hooks =====

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx.state;
}

export function useActions() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useActions must be used within AppProvider');
  return ctx.actions;
}
