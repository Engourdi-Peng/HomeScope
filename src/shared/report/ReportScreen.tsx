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

// Helper to check if result is the legacy BasicAnalysisResult format (has 'decision' property)
function isLegacyBasicResult(result: AnalysisResult | BasicAnalysisResult): result is BasicAnalysisResult {
  return 'decision' in result && result.decision !== undefined;
}

// Helper to check if result is a basic analysis (new format, has analysisType: 'basic')
function isNewBasicResult(result: AnalysisResult | BasicAnalysisResult): result is AnalysisResult {
  return 'analysisType' in result && (result as AnalysisResult).analysisType === 'basic';
}

export function ReportScreen({ mode, result, onBack, onShare, onUpgrade, analysisId, noShell }: ReportScreenProps) {
  // Check if this is a legacy basic analysis result (has 'decision' property)
  const isLegacyBasic = isLegacyBasicResult(result);
  const isNewBasic = isNewBasicResult(result);
  const isExtension = mode === 'extension';

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
