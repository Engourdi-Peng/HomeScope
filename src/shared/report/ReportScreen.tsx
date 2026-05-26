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
import { normalizeReportResult } from '../../lib/reportAdapters';
import { NewReportUI } from '../../components/report/NewReportUI';

type ReportScreenProps = {
  mode: 'web' | 'extension';
  result: AnalysisResult | BasicAnalysisResult;
  onBack: () => void;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
  onUpgrade?: () => void;
  analysisId?: string;
  /** 跳过外层 ReportShell 包裹（用于 extension 模式，外部已包 Shell） */
  noShell?: boolean;
};

export function ReportScreen({ mode, result, onBack, onShare, onUpgrade, analysisId, noShell }: ReportScreenProps) {
  const isExtension = mode === 'extension';

  // Detect share page to suppress back button
  const isSharePage =
    typeof window !== 'undefined' &&
    !!window.location.pathname.includes('/share/');

  const showBackButton = mode !== 'extension' && !isSharePage;

  // ── New unified path: normalize → NewReportUI ─────────────────────────────
  try {
    const normalizedReport = normalizeReportResult(result);

    const newContent = (
      <NewReportUI
        report={normalizedReport}
        mode={mode}
        showBackButton={showBackButton}
        onShare={onShare}
        analysisId={analysisId}
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
