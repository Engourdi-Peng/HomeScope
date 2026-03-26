/**
 * ReportScreen
 *
 * Shared result/report screen.
 * Single entry point used by both web and extension.
 *
 * Web: src/pages/Result.tsx
 * Extension: src/extension/components/ExtensionResultView.tsx
 */
import type { AnalysisResult } from '../../types';
import { ResultCard } from '../../components/ResultCard';
import { ReportShell } from './ReportShell';

type ReportScreenProps = {
  mode: 'web' | 'extension';
  result: AnalysisResult;
  onBack: () => void;
  onShare?: (analysisId: string) => Promise<{ slug: string; shareUrl: string }>;
};

export function ReportScreen({ mode, result, onBack, onShare }: ReportScreenProps) {
  return (
    <ReportShell mode={mode}>
      <ResultCard
        result={result}
        onBack={onBack}
        onShare={onShare}
        hideNav={mode === 'extension'}
      />
    </ReportShell>
  );
}
