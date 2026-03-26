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
        user: action.user ?? null,
        credits: action.credits ?? state.credits,
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

/** Layer A: 稳定的页面数据接入函数 */
async function initializePageData(dispatch: React.Dispatch<AppAction>) {
  dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'loading' });

  // Step 1: 获取当前激活 tab
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
      return;
    }
    tabId = tab.id;
  } catch {
    dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: getUserErrorMessage(ExtractionErrorCode.TAB_UNAVAILABLE) });
    return;
  }

    // Step 2: Ping content script（2000ms 超时）
    let pingResult: { ready: boolean; url?: string; title?: string; readyState?: string } | null = null;
    try {
      pingResult = await sendMessageWithTimeout<{ ready: boolean; url?: string; title?: string; readyState?: string }>(
        { action: 'PONG' },
        tabId,
        PING_TIMEOUT_MS
      );
    } catch {}

    if (pingResult?.ready !== true) {
      // Step 3: 运行时注入 content script（只在此刻需要）
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        // 注入后重试 Ping
        pingResult = await sendMessageWithTimeout<{ ready: boolean; url?: string; title?: string; readyState?: string }>(
          { action: 'PONG' },
          tabId,
          PING_TIMEOUT_MS
        );
      } catch (injectError) {
        dispatch({ type: 'SET_READ_ERROR', errorCode: 'CS_NOT_INJECTED', errorMessage: getUserErrorMessage(ExtractionErrorCode.CS_NOT_INJECTED) });
        return;
      }
    }

  if (pingResult?.ready !== true) {
    dispatch({ type: 'SET_READ_ERROR', errorCode: 'NO_HOST_PERMISSION', errorMessage: getUserErrorMessage(ExtractionErrorCode.NO_HOST_PERMISSION) });
    return;
  }

  // Step 4: 获取轻量页面状态（不用完整提取）
  try {
    const pageState = await sendMessageWithTimeout<{ url: string; title: string; readyState: string; isPropertyLike: boolean; extractionStage: string; basicDetectedSignals?: Record<string, unknown>; detection: PropertyDetection }>(
      { action: 'GET_PAGE_STATE' },
      tabId,
      3000
    );

    const stateInfo: PageStateInfo = {
      url: pageState?.url ?? pingResult?.url ?? '',
      title: pageState?.title ?? pingResult?.title ?? '',
      readyState: (pageState?.readyState ?? pingResult?.readyState ?? 'unknown') as DocumentReadyState,
      isPropertyLike: pageState?.isPropertyLike ?? false,
      extractionStage: (pageState?.extractionStage ?? 'initial') as 'initial' | 'delayed' | 'final',
      basicSignals: pageState?.basicDetectedSignals as PageStateInfo['basicSignals'],
    };

    dispatch({ type: 'SET_PAGE_STATE', pageState: stateInfo });

    // 根据检测结果设置 propertyStatus
    const detection = pageState?.detection;
    if (detection) {
      dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: detection.canAnalyze ? 'detected' : 'not_listing', propertyDetection: detection, listingData: null, readError: null });
    } else {
      dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'idle' });
    }
  } catch {
    // 页面状态获取失败，但 ping 成功，设为 idle
    dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'idle' });
  }

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

  // ---- Actions ----

  /** 刷新页面数据（使用新协议） */
  const refreshPageData = useCallback(async () => {
    dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'loading' });
    dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'reading' });

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      dispatch({ type: 'SET_READ_ERROR', errorCode: 'TAB_UNAVAILABLE', errorMessage: 'Tab unavailable' });
      return;
    }

    // Step 1: 先尝试 PING，只有在 content script 未加载时才注入
    let pingOk = false;
    try {
      const pong: { ready: boolean } | null = await sendMessageWithTimeout(
        { action: 'PONG' },
        tab.id,
        1000
      );
      pingOk = pong?.ready === true;
    } catch {}

    if (!pingOk) {
      // content script 未加载，运行时注入（已有 manifest 自动注入时跳过）
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
      } catch {}
    }

    // Step 2: 提取数据
    try {
      const extractResult = await sendMessageWithTimeout<{
        data?: ListingData | ListingDataV2;
        error?: string;
        detection?: PropertyDetection;
      }>({ action: 'EXTRACT_LISTING', includeGalleryImages: false }, tab.id, 8000);

      if (extractResult?.data && !extractResult.error) {
        const data = extractResult.data as ListingData | ListingDataV2;
        if (data.error === 'NOT_PROPERTY_PAGE') {
          dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'not_listing', propertyDetection: extractResult.detection ?? null });
        } else {
          dispatch({
            type: 'SET_PROPERTY_STATUS',
            propertyStatus: 'detected',
            listingData: data as ListingData | ListingDataV2,
            propertyDetection: extractResult.detection ?? null,
          });
        }
      } else if (extractResult?.error) {
        dispatch({
          type: 'SET_PROPERTY_STATUS',
          propertyStatus: 'error',
          readError: String(extractResult.error),
          listingData: null,
          propertyDetection: extractResult.detection ?? null,
        });
      } else {
        // 超时、content script 无响应、或空响应：保持 error 面板可重试，勿设为 not_listing（ListingSummary 会对 not_listing return null 导致整块消失）
        dispatch({
          type: 'SET_PROPERTY_STATUS',
          propertyStatus: 'error',
          readError:
            extractResult == null
              ? 'No response from page (timeout or tab inactive). Reload the listing page and try again.'
              : 'Could not read listing data. Try again.',
          listingData: null,
          propertyDetection: null,
        });
      }
    } catch (err) {
      dispatch({ type: 'SET_PROPERTY_STATUS', propertyStatus: 'error', readError: String(err) });
    }

    dispatch({ type: 'SET_PAGE_STATUS', pageStatus: 'ready' });
  }, []);

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

    // Step 3: Ensure content script is loaded
    let pingOk = false;
    try {
      const pong: { ready: boolean } | null = await sendMessageWithTimeout(
        { action: 'PONG' },
        tab.id,
        1000
      );
      pingOk = pong?.ready === true;
    } catch {}

    if (!pingOk) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
      } catch {}
    }

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
   * Shared API submission step. Separated so it can be called directly after a cache hit.
   */
  async function submitAnalysis(listingData: ListingData | ListingDataV2) {
    dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'sending_data' });

    try {
      const response = await sendMessage<{
        status: string;
        result?: AnalysisResult;
        error?: string;
      }>({
        action: 'analyze',
        data: listingData,
      });

      if (response.status === 'success' && response.result) {
        dispatch({ type: 'SET_ANALYSIS_RESULT', result: response.result });
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
      } else if (response.status === 'no_credits') {
        dispatch({ type: 'SET_ANALYSIS_PHASE', phase: 'no_credits' });
      } else {
        dispatch({
          type: 'SET_ANALYSIS_PHASE',
          phase: 'error',
          error: response.error || 'Analysis failed',
        });
      }
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

  const value: AppContextValue = {
    state,
    dispatch,
    actions: {
      refreshPageData,
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
