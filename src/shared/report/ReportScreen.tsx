/**
 * ReportScreen
 *
 * Shared result/report screen.
 * Single entry point used by both web and extension.
 *
 * Web: src/pages/Result.tsx
 * Extension: src/extension/components/ExtensionResultView.tsx
 */
import type { AnalysisResult, BasicAnalysisResult } from '../../types';
import { ResultCard } from '../../components/ResultCard';
import { BasicResultCard } from '../../components/BasicResultCard';
import { ReportShell } from './ReportShell';
import { normalizeReportResult, buildReportViewModel } from '../../lib/reportAdapters';
import { NewReportUI } from '../../components/report/NewReportUI';

type ShareStateProps = {
  isSharing?: boolean;
  shareResult?: { slug: string; shareUrl: string } | null;
  copied?: boolean;
};

type ReportScreenProps = {
  mode: 'web' | 'extension';
  result: AnalysisResult | BasicAnalysisResult;
  onBack: () => void;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  onUpgrade?: () => void;
  analysisId?: string;
  /** 跳过外层 ReportShell 包裹（用于 extension 模式，外部已包 Shell） */
  noShell?: boolean;
  /** 外部管理的分享状态，用于 extension 模式同步顶栏和底栏分享状态 */
  shareState?: ShareStateProps;
  /** 外部拦截分享点击（extension 模式用于触发父组件的分享逻辑并自动复制） */
  onShareClick?: () => void;
  /** 当前登录用户的 ID（从 AuthContext 传入；extension 模式传 undefined） */
  userId?: string;
  /** User auth status */
  authStatus?: 'logged_out' | 'logging_in' | 'logged_in';
  /** Available credits */
  credits?: number;
  /** Whether this listing already has a full report */
  hasFullReport?: boolean;
  /** Whether full analysis is currently running */
  isFullRunning?: boolean;
  /** Callback for sign-in action */
  onSignIn?: () => void;
  /** Callback for checkout/purchase action */
  onOpenCheckout?: () => void;
  /** Callback for viewing existing full report */
  onViewFullReport?: () => void;
  /** Hide bottom section (share + feedback modules) for public share page */
  hideBottomSection?: boolean;
};

export function ReportScreen({
  mode,
  result,
  onBack,
  onShare,
  onUpgrade,
  analysisId,
  noShell,
  shareState,
  onShareClick,
  userId,
  authStatus,
  credits,
  hasFullReport,
  isFullRunning,
  onSignIn,
  onOpenCheckout,
  onViewFullReport,
  hideBottomSection,
}: ReportScreenProps) {
  const isExtension = mode === 'extension';

  // Detect share page to suppress back button
  const isSharePage =
    typeof window !== 'undefined' &&
    !!window.location.pathname.includes('/share/');

  const showBackButton = mode !== 'extension' && !isSharePage;

  // ── Derive feedback props ─────────────────────────────────────────────────
  const raw = (result as any)?.raw ?? result;
  const listingAddress =
    (result as any)?.listingInfo?.address ??
    raw?.listingInfo?.address ??
    raw?.property_snapshot?.address ??
    undefined;
  // Stable fingerprint: use address as fingerprint (trimmed, lowercased)
  const listingFingerprint = listingAddress
    ? listingAddress.toLowerCase().trim()
    : undefined;
  const reportType = (result as any)?.meta?.reportMode ??
    (result as any)?.reportMode ??
    undefined;

  // ── New unified path: normalize → buildReportViewModel → NewReportUI ──────────
  try {
    const normalizedReport = normalizeReportResult(result);
    const isBasic = normalizedReport.meta.isBasic;
    const viewModel = buildReportViewModel(result, result?.listingInfo, normalizedReport);

    // ── DEBUG: trace what sections were built ───────────────────────────────
    console.log('[ReportScreen] isBasic:', isBasic, '| sections:', normalizedReport.sections.map(s => s.id).join(', '));
    console.log('[ReportScreen] result keys:', Object.keys(result).join(', '));
    console.log('[ReportScreen] whats_missing from result:', JSON.stringify((result as any).whats_missing ?? []));

    const newContent = (
      <NewReportUI
        report={normalizedReport}
        viewModel={viewModel}
        isBasic={isBasic}
        mode={mode}
        showBackButton={showBackButton}
        onShare={onShare}
        analysisId={analysisId}
        shareState={shareState}
        onShareClick={onShareClick}
        onUpgrade={onUpgrade}
        userId={userId}
        listingFingerprint={listingFingerprint}
        listingAddress={listingAddress}
        reportType={reportType}
        authStatus={authStatus}
        credits={credits}
        hasFullReport={hasFullReport}
        isFullRunning={isFullRunning}
        onSignIn={onSignIn}
        onOpenCheckout={onOpenCheckout}
        onViewFullReport={onViewFullReport}
        hideBottomSection={hideBottomSection}
      />
    );

    if (noShell) return newContent;

    return (
      <ReportShell mode={mode}>
        {newContent}
      </ReportShell>
    );
  } catch (err) {
    console.error('[REPORT_SCREEN_NEW_UI_ERROR]', err);
  }

  // ── Fallback: legacy routing (preserved) ──────────────────────────────────
  // Check if this is a legacy basic analysis result (has 'decision' property)
  const isLegacyBasic = 'decision' in result && result.decision !== undefined;
  const isNewBasic = 'analysisType' in result && (result as AnalysisResult).analysisType === 'basic';

  // Use BasicResultCard ONLY for legacy BasicAnalysisResult format (has 'decision')
  if (isLegacyBasic) {
    const basicContent = (
      <BasicResultCard
        result={result as BasicAnalysisResult}
        onBack={onBack}
        onShare={onShare}
        onUpgrade={onUpgrade}
        hideNav={mode === 'extension'}
        isExtension={isExtension}
        analysisId={analysisId}
        shareState={shareState}
        onShareClick={onShareClick}
      />
    );

    if (noShell) {
      return basicContent;
    }

    return (
      <ReportShell mode={mode}>
        {basicContent}
      </ReportShell>
    );
  }

  // For new basic analysis format (analysisType: 'basic'), use ResultCard with basic mode
  // For AnalysisResult format (full analysis), use ResultCard with full mode
  const content = (
    <ResultCard
      result={result as AnalysisResult}
      onBack={onBack}
      onShare={onShare}
      onUpgrade={isNewBasic ? onUpgrade : undefined}
      hideNav={mode === 'extension'}
      isExtension={isExtension}
      analysisId={analysisId}
      isBasicAnalysis={isNewBasic}
      shareState={shareState}
      onShareClick={onShareClick}
    />
  );

  if (noShell) {
    return content;
  }

  return (
    <ReportShell mode={mode}>
      {content}
    </ReportShell>
  );
}
