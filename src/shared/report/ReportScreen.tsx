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
};

export function ReportScreen({ mode, result, onBack, onShare, onUpgrade, analysisId, noShell, shareState, onShareClick }: ReportScreenProps) {
  const isExtension = mode === 'extension';

  // Detect share page to suppress back button
  const isSharePage =
    typeof window !== 'undefined' &&
    !!window.location.pathname.includes('/share/');

  const showBackButton = mode !== 'extension' && !isSharePage;

  // ── New unified path: normalize → buildReportViewModel → NewReportUI ──────────
  try {
    const normalizedReport = normalizeReportResult(result);
    const isBasic = normalizedReport.meta.isBasic;
    const viewModel = buildReportViewModel(result, result?.listingInfo, normalizedReport);

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
