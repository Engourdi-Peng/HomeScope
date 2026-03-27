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
import type { AnalysisSummary } from '../../shared/types/analysis';
import { PING_TIMEOUT_MS, EXTRACTION_COOLDOWN_MS } from '../../shared/constants';
import { ExtractionErrorCode, getUserErrorMessage } from '../../shared/errors';

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

/** 带超时的 sendMessage */
async function sendMessageWithTimeout<T = unknown>(
  message: Record<string, unknown>,
  tabId: number,
  timeoutMs: number
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response as T);
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
    const pong: { ready: boolean } | null = await sendMessageWithTimeout(
      { action: 'PONG' },
      tabId,
      1000
    );
    pingOk = pong?.ready === true;
  } catch {}

  // Step 2: Inject if needed
  if (!pingOk) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    } catch {}
  }

  // Step 3: Extract lightweight listing data (no gallery images)
  try {
    const extractResult = await sendMessageWithTimeout<{
      data?: ListingData | ListingDataV2;
      error?: string;
      detection?: PropertyDetection;
    }>({ action: 'EXTRACT_LISTING', includeGalleryImages: false }, tabId, 8000);

    if (!extractResult) {
      return {
        data: null,
        error: 'No response from page (timeout or tab inactive). Reload the listing page and try again.',
        detection: null,
      };
    }

    if (extractResult.error) {
      return {
        data: null,
        error: String(extractResult.error),
        detection: extractResult.detection ?? null,
      };
    }

    if (!extractResult.data) {
      return {
        data: null,
        error: 'Could not read listing data. Try again.',
        detection: extractResult.detection ?? null,
      };
    }

    const data = extractResult.data as ListingData | ListingDataV2;
    return {
      data,
      error: null,
      detection: extractResult.detection ?? null,
    };
  } catch (err) {
    return { data: null, error: String(err), detection: null };
  }
}

/**
 * Pure ping + inject: ensures content script is loaded, returns whether it succeeded.
 * Used by startAnalysis (no EXTRACT_LISTING call needed there).
 */
async function ensureContentScriptLoaded(tabId: number): Promise<boolean> {
  let pingOk = false;
  try {
    const pong: { ready: boolean } | null = await sendMessageWithTimeout(
      { action: 'PONG' },
      tabId,
      1000
    );
    pingOk = pong?.ready === true;
  } catch {}

  if (!pingOk) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Verify injection worked
      try {
        const pong2: { ready: boolean } | null = await sendMessageWithTimeout(
          { action: 'PONG' },
          tabId,
          1000
        );
        pingOk = pong2?.ready === true;
      } catch {}
    } catch {}
  }

  return pingOk;
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
      console.error('[ExtApp] Refresh user data failed:', err);
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
      console.error('[ExtApp] Load history failed:', err);
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
        console.error('[ExtApp] Auth check failed:', err);
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
        if (stage.includes('uploading') || stage.includes('Reading')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'reading_page' });
        } else if (stage.includes('gallery') || stage.includes('gallery_open') || stage.includes('opening_gallery')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'opening_gallery' });
        } else if (stage.includes('photo') || stage.includes('Collecting') || stage.includes('extracting') || stage.includes('image')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'collecting_photos' });
        } else if (stage.includes('send') || stage.includes('uploading') || stage.includes('sending')) {
          dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });
        } else if (stage.includes('analyse') || stage.includes('evaluating') || stage.includes('strengths') || stage.includes('competition')) {
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
   *   6. Submit to analyze API
   *   7. On success: SET_ANALYSIS_PHASE('done'), set cooldown
   */
  const startAnalysis = useCallback(async (options?: { bypassCache?: boolean }) => {
    const bypassCache = options?.bypassCache ?? false;

    // Step 1: Check cooldown
    const now = Date.now();
    if (!bypassCache && state.cooldownEndsAt !== null && now < state.cooldownEndsAt) {
      console.log('[ExtApp] startAnalysis: in cooldown, aborting');
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

    // Step 2: Check URL cache
    if (!bypassCache && state.lastExtractedUrl === currentUrl && state.extractionCached && state.listingData) {
      console.log('[ExtApp] startAnalysis: URL cache hit, skipping extraction');
      dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });
      await submitAnalysis(state.listingData as ListingData | ListingDataV2);
      return;
    }

    // Step 3: Ensure content script is loaded (reuse shared helper)
    await ensureContentScriptLoaded(tab.id);

    // Step 4: Send START_USER_EXTRACTION
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'reading_page' });

    let extractResult: { success: boolean; data?: ListingData | ListingDataV2; error?: string; detection?: PropertyDetection; code?: string } | null = null;
    try {
      extractResult = await sendMessageWithTimeout<{ success: boolean; data?: ListingData | ListingDataV2; error?: string; detection?: PropertyDetection; code?: string }>(
        { action: 'START_USER_EXTRACTION', bypassCache },
        tab.id,
        15000
      );
    } catch {}

    if (!extractResult || !extractResult.success || !extractResult.data) {
      const detection = extractResult?.detection;
      if (detection && !detection.canAnalyze) {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: "This doesn't look like a property listing page" });
      } else {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'error', error: extractResult?.error || 'Could not extract listing data. Please refresh and try again.' });
      }
      return;
    }

    const listingData = extractResult.data as ListingData | ListingDataV2;
    dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'detected', listingData, propertyDetection: extractResult.detection ?? null });

    // Mark URL as cached
    dispatch({ type: 'SET_EXTRACTION_CACHED', extractionCached: true, lastExtractedUrl: currentUrl });

    // Step 5: Submit to analyze API
    await submitAnalysis(listingData);
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
          // Analysis completed successfully
          dispatch({ type: 'SET_ANALYSIS_RESULT', result: statusResponse.result });
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
          } else if (stage.includes('photo') || stage.includes('Collecting') || stage.includes('extracting') || stage.includes('image')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'collecting_photos' });
          } else if (stage.includes('send') || stage.includes('uploading') || stage.includes('sending')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });
          } else if (stage.includes('analyse') || stage.includes('evaluating') || stage.includes('strengths') || stage.includes('competition')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'analysing' });
          } else if (stage.includes('生成') || stage.includes('building') || stage.includes('final') || stage.includes('report')) {
            dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'generating_report' });
          }

          if (statusResponse.progress != null) {
            dispatch({ type: 'SET_ANALYSIS_PROGRESS', progress: statusResponse.progress });
          }
        }
      } catch (err) {
        console.error('[ExtApp] pollAnalysisStatus: error —', err);
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
   * Shared API submission step. Separated so it can be called directly after a cache hit.
   * Now returns analysisId immediately and polls from frontend.
   */
  async function submitAnalysis(listingData: ListingData | ListingDataV2) {
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });

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
      console.error('[ExtApp] Logout failed:', err);
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
      console.error('[ExtApp] Google OAuth failed:', err);
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
      console.error('[ExtApp] shareAnalysis error:', err);
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
