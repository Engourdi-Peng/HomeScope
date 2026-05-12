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
  if (!listingData) return result;

  const isV2 = isV2Data(listingData);

  // Build listingInfo
  const listingInfo: ListingInfo = {};

  // Title: prefer title, fallback to address
  if (isV2) {
    listingInfo.title = (listingData as ListingDataV2).title || null;
    listingInfo.address = (listingData as ListingDataV2).address || null;
    listingInfo.price = (listingData as ListingDataV2).price || null;
    listingInfo.priceAmount = (listingData as ListingDataV2).priceAmount || null;
    listingInfo.bedrooms = (listingData as ListingDataV2).bedrooms || null;
    listingInfo.bathrooms = (listingData as ListingDataV2).bathrooms || null;
    listingInfo.parking = (listingData as ListingDataV2).parking || null;
    listingInfo.coverImageUrl = ((listingData as ListingDataV2).imageUrls?.length ?? 0) > 0
      ? (listingData as ListingDataV2).imageUrls![0]
      : null;
  } else {
    // V1 格式: content.js 返回的原始格式
    // { title, address, priceText, bedrooms, bathrooms, parking, imageUrls, ... }
    listingInfo.title = (listingData as ListingData).title || null;
    listingInfo.address = (listingData as ListingData).address || null;
    listingInfo.price = (listingData as ListingData).priceText || (listingData as ListingData).price || null;
    listingInfo.bedrooms = (listingData as ListingData).bedrooms ?? null;
    listingInfo.bathrooms = (listingData as ListingData).bathrooms ?? null;
    listingInfo.parking = (listingData as ListingData).parking ?? null;
    listingInfo.coverImageUrl = ((listingData as ListingData).imageUrls?.length ?? 0) > 0
      ? (listingData as ListingData).imageUrls![0]
      : null;
  }

  // Remove null values
  const cleanListingInfo: ListingInfo = {};
  for (const [key, value] of Object.entries(listingInfo)) {
    if (value != null) {
      (cleanListingInfo as Record<string, unknown>)[key] = value;
    }
  }

  return {
    ...result,
    listingInfo: Object.keys(cleanListingInfo).length > 0 ? cleanListingInfo : null,
  };
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

    const verdict = verdictMap[basicResult.verdict || ''] || 'Need More Evidence';
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

const noop = (..._args: unknown[]) => {};

function sendMessage<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response as T);
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

// ── Shared extraction result type ──
interface ExtractionResult {
  data: ListingData | ListingDataV2 | null;
  error: string | null;
  detection: PropertyDetection | null;
}

/**
 * Ensures the content script is loaded and performs a lightweight EXTRACT_LISTING.
 * Returns { data, error, detection } — never throws.
 * Used by both initial page load and tab-switch / URL-change refresh.
 */
async function ensureContentScriptThenExtractListing(
  tabId: number
): Promise<ExtractionResult> {
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

      // Wait for content script to initialize (retry PING until ready)
      let reconnected = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          const pongResult = await sendMessageWithTimeout<{ ready: boolean }>(
            { action: 'PONG' },
            tabId,
            500
          );
          if (pongResult.success && pongResult.data?.ready === true) {
            reconnected = true;
            noop(`[ExtApp] Content script ready after ${(i + 1) * 100}ms`);
            break;
          }
        } catch {
          // Still not ready
        }
      }
      if (!reconnected) {
        noop('[ExtApp] Content script may not be fully loaded after injection');
      }
    } catch (err: any) {
      noop('[ExtApp] executeScript failed:', err.message, err);
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
        noop('[ExtApp] executeScript failed:', err?.message || String(err));
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
  let pingResult: { ready: boolean; url?: string; title?: string; readyState?: string } | null = null;

  // Step 1: 获取当前激活 tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
      return;
    }
    tabId = tab.id;
    pingResult = { ready: true, url: tab.url, title: tab.title, readyState: tab.status };
  } catch {
    dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
    return;
  }

  // Step 2: Ping + inject + EXTRACT_LISTING (shared path)
  const result = await ensureContentScriptThenExtractListing(tabId);

  // Step 3: Dispatch unified result
  dispatchExtractionResult(dispatch, result, pingResult);
  dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'ready' });
}

// ===== Provider =====

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const refreshUserDataAndHistory = useCallback(async (user: ExtUser) => {
    try {
      const userData = await sendMessage<{
        status: string;
        data?: { credits_remaining: number };
      }>({ action: 'get_user_data' });

      if (userData.status === 'success' && userData.data) {
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
    const checkAuth = async () => {
      try {
        const authResult = await sendMessage<{
          state: string;
          user?: ExtUser;
        }>({ action: 'check_auth_status' });

        if (authResult.state === 'authenticated' && authResult.user) {
          await refreshUserDataAndHistory(authResult.user);
        } else {
          dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out' });
        }
      } catch (err) {
        noop('[ExtApp] Auth check failed:', err);
        dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out' });
      }
    };

    checkAuth();
  }, [refreshUserDataAndHistory]);

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

  // ---- Tab 切换 / URL 变化时自动轻量读取（仅在已登录时生效）----
  useEffect(() => {
    if (state.authStatus !== 'logged_in') return;

    let currentWindowId: number | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
          const pingResult = { url: activeTab.url, title: activeTab.title, readyState: activeTab.status };
          const result = await ensureContentScriptThenExtractListing(activeTab.id);
          // 静默更新：保持当前 analysisPhase 不变，仅更新卡片数据
          dispatchExtractionResult(dispatch, result, pingResult);
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
      dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: 'Tab unavailable' });
      return;
    }

    const pingResult = { url: tab.url, title: tab.title, readyState: tab.status };
    const result = await ensureContentScriptThenExtractListing(tab.id);
    dispatchExtractionResult(dispatch, result, pingResult);
    dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'ready' });
  }, []);

  /** 刷新所有：页面数据 + 用户积分 + 历史记录 */
  const refreshAll = useCallback(async () => {
    // 1. 刷新页面数据
    await refreshPageData();

    // 2. 刷新用户积分
    if (state.user) {
      sendMessage<{
        status: string;
        data?: { credits_remaining: number };
      }>({ action: 'get_user_data' }).then((userData) => {
        if (userData?.status === 'success' && userData.data) {
          dispatch({
            type: 'SET_AUTH_STATUS',
            authStatus: 'logged_in',
            credits: userData.data.credits_remaining,
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

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: 'Tab unavailable' });
      return;
    }

    const currentUrl = tab.url || '';

    // Step 2: Prevent Chrome internal pages (chrome://, about:, etc.)
    // Chrome extensions cannot inject content scripts into these pages
    if (currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://') || currentUrl.startsWith('about:') || currentUrl.startsWith('edge://') || currentUrl.startsWith('brave://')) {
      dispatch({
        type: 'SET_ANALYSIS_PHASE',
        phase: 'error',
        error: 'Please navigate to a property listing page (e.g., realestate.com.au). This extension cannot run on browser settings or new tab pages.',
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
    await ensureContentScriptLoaded(tab.id);

    // Step 4: Send START_USER_EXTRACTION
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'reading_page' });

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
        { action: 'START_USER_EXTRACTION', bypassCache },
        tab.id,
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
      if (response.detection && !response.detection.canAnalyze) {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: "This doesn't look like a property listing page" });
      } else {
        noop('[ExtApp] startAnalysis: extraction failed:', errorMsg, 'code:', response.code);
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
  }, [state.cooldownEndsAt, state.lastExtractedUrl, state.extractionCached, state.listingData]);

  /**
   * Poll for analysis status from frontend.
   * Separated so it runs in the React side panel context (not background).
   * This avoids Service Worker termination issues that caused sendResponse loss.
   */
  async function pollAnalysisStatus(analysisId: string) {
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLL_MS = 120_000; // 2 minutes max for frontend polling

    const startTime = Date.now();

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

        if (statusResponse.status === 'done' && statusResponse.result) {
          // Override reportMode from API (source of truth from analyses table)
          const reportMode = (statusResponse as any).report_mode as string | undefined;
          const resultWithListingInfo = injectListingInfo(statusResponse.result, state.listingData);
          
          // Apply reportMode override from API response
          if (reportMode && resultWithListingInfo) {
            (resultWithListingInfo as AnalysisResult).reportMode = reportMode as 'rent' | 'sale';
          }

          // Analysis completed successfully
          dispatch({ type: 'SET_ANALYSIS_RESULT', result: resultWithListingInfo });
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'done' });
          dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });

          // Set 20s cooldown to prevent rapid re-triggers
          dispatch({ type: 'SET_COOLDOWN', cooldownEndsAt: Date.now() + EXTRACTION_COOLDOWN_MS });

          // Refresh credits
          const userData = await sendMessage<{
            status: string;
            data?: { credits_remaining: number };
          }>({ action: 'get_user_data' });
          if (userData.status === 'success' && userData.data) {
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
        // Note: 'extracting' and 'image' are NOT included in collecting_photos because
        // they incorrectly match backend stages like 'detecting_rooms' and 'extracting_strengths_and_issues'
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
        noop('[ExtApp] pollAnalysisStatus: error —', err);
        // Continue polling despite errors
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Timeout after max poll duration
    dispatch({
      type: 'SET_ANALYSIS_PHASE',
      phase: 'error',
      error: 'Analysis timed out. Please check history later.',
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

      noop('[ExtApp] submitAnalysis (basic): sending to background', {
        hasDescription: !!listingData.description,
        descriptionLen: listingData.description?.length || 0,
        descriptionPreview: listingData.description?.substring(0, 100),
        hasTitle: !!listingData.title,
        hasPrice: !!listingData.price,
      });

      try {
        // Send message to background to handle basic-sync API call (anonymous)
        const response = await sendMessage<{
          status: string;
          result?: AnalysisResult;
          error?: string;
          analysisId?: string | null;
        }>({
          action: 'analyze_basic',
          data: listingData,
        });

        noop('[ExtApp] submitAnalysis (basic): received response', {
          responseStatus: response.status,
          hasResult: !!response.result,
          hasError: !!response.error,
          error: response.error,
          hasAnalysisId: !!response.analysisId,
        });

        // Basic-sync returns { status: 'done', result: ... }
        const isSuccess = response.status === 'success' || response.status === 'done';
        noop('[ExtApp] submitAnalysis (basic): checking success', {
          responseStatus: response.status,
          isSuccess,
          hasResult: !!response.result,
          error: response.error,
        });
        if (isSuccess && response.result) {
          // Convert BasicAnalysisResult to AnalysisResult format for ResultCard compatibility
          noop('[ExtApp] submitAnalysis (basic): converting to full result format...');
          const fullResult = convertBasicToFullResult(response.result);
          noop('[ExtApp] submitAnalysis (basic): fullResult.overallScore:', fullResult.overallScore);

          // Store analysisId if returned (indicates user is logged in and history record was created)
          const analysisId = response.analysisId;
          if (analysisId) {
            noop('[ExtApp] submitAnalysis (basic): history record created, analysisId:', analysisId);
            fullResult.id = analysisId;
            // Refresh history for logged-in users
            sendMessage<{
              status: string;
              analyses?: AnalysisSummary[];
            }>({ action: 'get_analysis_history', limit: 8, offset: 0 }).then((historyResponse) => {
              if (historyResponse.status === 'success' && historyResponse.analyses) {
                dispatch({ type: 'SET_HISTORY', history: historyResponse.analyses });
              }
            }).catch(() => {});
          }

          // Inject listing info into result
          noop('[ExtApp] submitAnalysis (basic): injecting listing info...');
          const resultWithListingInfo = injectListingInfo(fullResult, listingData);
          noop('[ExtApp] submitAnalysis (basic): resultWithListingInfo.listingInfo:', resultWithListingInfo.listingInfo);
          dispatch({ type: 'SET_ANALYSIS_RESULT', result: resultWithListingInfo });
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'done' });
          dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });
          noop('[ExtApp] submitAnalysis (basic): dispatched all actions, should navigate to report');
          return;
        }

        // Handle errors
        dispatch({
          type: 'SET_ANALYSIS_PHASE',
          phase: 'error',
          error: response.error || 'Basic analysis failed',
        });
      } catch (err) {
        noop('[ExtApp] submitAnalysis (basic) error:', err);
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: String(err) });
      }
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
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: String(err) });
    }
  }

  const retryAnalysis = useCallback(async () => {
    dispatch({ type: 'RESET_ANALYSIS' });
    await startAnalysis({ bypassCache: true });
  }, [startAnalysis]);

  /** Force a fresh image extraction, bypassing the URL result cache */
  const refreshPhotos = useCallback(async () => {
    dispatch({ type: 'RESET_ANALYSIS' });
    dispatch({ type: 'SET_EXTRACTION_CACHED', extractionCached: false, lastExtractedUrl: null });
    await startAnalysis({ bypassCache: true });
  }, [startAnalysis]);

  const logout = useCallback(async () => {
    try {
      await sendMessage({ action: 'logout' });
      dispatch({ type: 'SET_AUTH_STATUS', authStatus: 'logged_out' });
      dispatch({ type: 'RESET_ANALYSIS' });
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
      return;
    }

    // Otherwise, start a new analysis: reset state + switch view + trigger analysis
    dispatch({ type: 'RESET_ANALYSIS' });
    dispatch({ type: 'SET_CURRENT_VIEW', view: 'report' });
    // startAnalysis will be called by ExtensionResultView once the view mounts
  }, []);

  const navigateToHome = useCallback(() => {
    dispatch({ type: 'SET_CURRENT_VIEW', view: 'home' });
    // Refresh user credits when returning to home
    sendMessage<{
      status: string;
      data?: { credits_remaining: number };
    }>({ action: 'get_user_data' }).then((userData) => {
      if (userData?.status === 'success' && userData.data) {
        dispatch({
          type: 'SET_AUTH_STATUS',
          authStatus: 'logged_in',
          credits: userData.data.credits_remaining,
        });
      }
    }).catch(() => {
      // Silently ignore refresh failures
    });
  }, []);

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
    try {
      const result = await sendMessage<{
        status: string;
        slug?: string;
        shareUrl?: string;
        error?: string;
      }>({ action: 'share_analysis', analysisId });

      if (result.status === 'success' && result.slug && result.shareUrl) {
        return { slug: result.slug, shareUrl: result.shareUrl };
      }
      throw new Error(result.error || 'Failed to share analysis');
    } catch (err) {
      noop('[ExtApp] shareAnalysis error:', err);
      throw err;
    }
  }, []);

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
