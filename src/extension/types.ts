/**
 * Extension-local types.
 * Shared types (PropertyDetection, ListingData, ListingDataV2, AnalysisResult, etc.)
 * are defined in shared/types/analysis.ts and re-exported from src/types/index.ts.
 * This module re-exports them for use by other extension modules.
 */

import type {
  PropertyDetection,
  ListingDataV2,
  AnalysisResult,
} from '../types/index';
import type { ListingData } from '../types/index';
export type { PropertyDetection, ListingDataV2, AnalysisResult };
export type { ListingData };

// ── Auth ──
export interface ExtUser {
  id: string;
  email: string;
  avatar?: string;
}

// ── Page state ──
export type PageStatus = 'loading' | 'ready' | 'error';
export type PropertyStatus = 'idle' | 'reading' | 'detected' | 'not_listing' | 'error';

export interface BasicSignals {
  imageCount: number;
  hasPrice: boolean;
  hasAddress: boolean;
  hasBedrooms: boolean;
  hasBathrooms: boolean;
  hasParking: boolean;
  hasDescription: boolean;
  confidence: number;
  tier: string;
  signals: string[];
}

export interface PageStateInfo {
  url: string;
  title: string;
  readyState: DocumentReadyState;
  isPropertyLike: boolean;
  extractionStage: 'initial' | 'delayed' | 'final';
  basicSignals?: BasicSignals;
}

// ── App state ──
export type AuthStatus = 'checking' | 'logged_in' | 'logged_out';
export type AnalysisPhase =
  | 'idle'
  | 'preparing'           // verifying lock / cooldown / URL cache
  | 'reading_page'         // extracting page base data
  | 'opening_gallery'      // opening PhotoSwipe
  | 'collecting_photos'    // paging through gallery
  | 'sending_data'         // submitting to analysis API
  | 'analysing'            // backend AI analysis
  | 'generating_report'    // building final report
  | 'done'
  | 'no_credits'
  | 'error';
export type CurrentView = 'home' | 'report';

export interface AppState {
  pageStatus: PageStatus;
  propertyStatus: PropertyStatus;
  propertyDetection: PropertyDetection | null;
  listingData: ListingData | ListingDataV2 | null;
  readError: string | null;
  readErrorCode: PageReadErrorCode | null;
  pageState: PageStateInfo | null;
  authStatus: AuthStatus;
  user: ExtUser | null;
  credits: number;
  analysisPhase: AnalysisPhase;
  analysisProgress: number;
  analysisError: string | null;
  analysisResult: AnalysisResult | null;
  history: import('../types/index').AnalysisSummary[];
  historyLoading: boolean;
  viewingHistoryId: string | null;
  currentView: CurrentView;
  cooldownEndsAt: number | null;      // timestamp (ms) when cooldown ends; null if not cooling down
  extractionCached: boolean;           // true if current URL has a cached extraction result
  lastExtractedUrl: string | null;     // URL of the most recently cached extraction
}

// ── Actions ──
export type PageReadErrorCode =
  | 'TAB_UNAVAILABLE'
  | 'CS_NOT_INJECTED'
  | 'NO_HOST_PERMISSION'
  | 'EXTRACTION_FAILED'
  | 'UNKNOWN';

export type AppAction =
  | { type: 'SET_PAGE_STATUS'; pageStatus: PageStatus }
  | { type: 'SET_PROPERTY_STATUS'; propertyStatus: PropertyStatus; listingData?: ListingData | ListingDataV2 | null; propertyDetection?: PropertyDetection | null; readError?: string | null }
  | { type: 'SET_AUTH_STATUS'; authStatus: AuthStatus; user?: ExtUser; credits?: number }
  | { type: 'SET_ANALYSIS_PHASE'; phase: AnalysisPhase; error?: string | null }
  | { type: 'SET_ANALYSIS_PROGRESS'; progress: number }
  | { type: 'SET_ANALYSIS_RESULT'; result: AnalysisResult | null }
  | { type: 'SET_HISTORY'; history: import('../types/index').AnalysisSummary[] }
  | { type: 'SET_HISTORY_LOADING'; loading: boolean }
  | { type: 'SET_VIEWING_HISTORY'; id: string | null }
  | { type: 'SET_CURRENT_VIEW'; view: CurrentView }
  | { type: 'SET_PAGE_STATE'; pageState: PageStateInfo }
  | { type: 'SET_READ_ERROR'; errorCode: PageReadErrorCode; errorMessage: string }
  | { type: 'SET_COOLDOWN'; cooldownEndsAt: number | null }
  | { type: 'SET_EXTRACTION_CACHED'; extractionCached: boolean; lastExtractedUrl: string | null }
  | { type: 'RESET_ANALYSIS' };
