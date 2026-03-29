/**
 * ExtensionResultView
 *
 * Plugin result page view.
 * Delegates entirely to the shared ReportShell + ResultCard components.
 *
 * Flow: App.tsx switches to currentView='report' → renders ExtensionResultView
 *
 * Auto-starts analysis when the view mounts (if not already running).
 * Loading / error / empty states are shown inline here while analysis is in progress.
 * All states share the same ReportShell container for layout consistency.
 * The NavBar is rendered here (not inside ResultCard) to match the web layout.
 */
import React, { useState } from 'react';
import { ArrowLeft, Share2, Copy, CheckCircle } from 'lucide-react';
import { useAppState, useActions } from '../store';
import { ReportShell } from '../../shared/report/ReportShell';
import { ResultCard } from '../../components/ResultCard';

export function ExtensionResultView() {
  const { analysisPhase, analysisProgress, analysisError, analysisResult, listingData, authStatus } = useAppState();
  const { retryAnalysis, navigateToHome, startAnalysis, shareAnalysis } = useActions();
  const hasStartedAnalysis = React.useRef(false);

  // Top bar share state — same logic as ResultCard bottom share
  const [isSharing, setIsSharing] = useState(false);
  const [shareResult, setShareResult] = useState<{ slug: string; shareUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-start analysis when the report view mounts
  React.useEffect(() => {
    if (analysisPhase === 'idle' && !hasStartedAnalysis.current && listingData) {
      hasStartedAnalysis.current = true;
      startAnalysis();
    }
  }, [analysisPhase, listingData, startAnalysis]);

  const isAnalysing = ['preparing', 'reading_page', 'opening_gallery', 'collecting_photos', 'sending_data', 'analysing', 'generating_report'].includes(analysisPhase);
  const isError = analysisPhase === 'error';
  const hasResult = !!analysisResult;

  const handleShare = async (analysisId: string) => {
    if (!analysisId) {
      throw new Error('Analysis ID not found');
    }
    const result = await shareAnalysis(analysisId);
    return { slug: result.slug, shareUrl: result.shareUrl };
  };

  const handleTopBarShare = async () => {
    if (!analysisResult?.id) return;
    setIsSharing(true);
    try {
      const resp = await handleShare(analysisResult.id);
      setShareResult(resp);
      const fullUrl = resp.shareUrl || `${window.location.origin}/share/${resp.slug}`;
      await navigator.clipboard.writeText(fullUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Top bar share failed:', err);
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareLink = () => {
    if (!shareResult) return;
    const fullUrl = shareResult.shareUrl || `${window.location.origin}/share/${shareResult.slug}`;
    navigator.clipboard.writeText(fullUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // NavBar：sticky 整条顶栏，Back 左、Logo 右，滚动报告时始终可见
  const NavBar = (
    <div className="flex items-center justify-between mb-8 sticky top-0 z-50 bg-[#FDFCF9]/95 backdrop-blur-sm py-3 -mt-2">
      <button
        type="button"
        onClick={navigateToHome}
        className="group flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
      >
        <div className="w-7 h-7 rounded-full border border-stone-200 flex items-center justify-center bg-white group-hover:bg-stone-50 transition-colors">
          <ArrowLeft size={12} strokeWidth={1.5} />
        </div>
        <span className="text-xs font-medium">Back</span>
      </button>

      {!shareResult ? (
        <button
          type="button"
          onClick={handleTopBarShare}
          disabled={isSharing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Share2 size={14} strokeWidth={1.5} />
          <span className="text-xs font-medium">
            {isSharing ? 'Sharing...' : 'Share'}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 bg-green-50 text-green-700 px-2.5 py-1 rounded-full">
          {copied ? (
            <>
              <CheckCircle size={12} />
              <span className="text-xs font-medium">Copied!</span>
            </>
          ) : (
            <>
              <CheckCircle size={12} />
              <span className="text-xs font-medium">Copied</span>
              <button
                onClick={handleCopyShareLink}
                className="ml-0.5 p-0.5 hover:bg-green-100 rounded transition-colors cursor-pointer"
                title="Copy link again"
              >
                <Copy size={11} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  // Loading state
  if (isAnalysing) {
    return (
      <ReportShell mode="extension">
        {NavBar}
        <PhaseProgressInline phase={analysisPhase} progress={analysisProgress} />
      </ReportShell>
    );
  }

  // Error state
  if (isError) {
    return (
      <ReportShell mode="extension">
        {NavBar}
        <ErrorStateInline error={analysisError} onRetry={retryAnalysis} onBack={navigateToHome} />
      </ReportShell>
    );
  }

  // No result yet
  if (!hasResult) {
    return (
      <ReportShell mode="extension">
        {NavBar}
        <div className="flex items-center justify-center py-24">
          <div className="ext-spinner" />
        </div>
      </ReportShell>
    );
  }

  // Has result: use ReportShell + ResultCard directly (avoids double-shell nesting)
  // ResultCard receives hideNav=true because nav is provided by this component
  return (
    <ReportShell mode="extension">
      {NavBar}
      <ResultCard
        result={analysisResult}
        onBack={navigateToHome}
        onShare={authStatus === 'logged_in' ? handleShare : undefined}
        hideNav
      />
    </ReportShell>
  );
}

// ===== Inline analysis state components =====

const PHASE_STEPS = [
  { key: 'preparing', label: 'Preparing...', icon: '1' },
  { key: 'reading_page', label: 'Reading page data...', icon: '2' },
  { key: 'opening_gallery', label: 'Opening gallery...', icon: '3' },
  { key: 'collecting_photos', label: 'Collecting photos...', icon: '4' },
  { key: 'sending_data', label: 'Sending data...', icon: '5' },
  { key: 'analysing', label: 'Analysing property...', icon: '6' },
  { key: 'generating_report', label: 'Generating report...', icon: '7' },
] as const;

function getPhaseIndex(phase: string): number {
  const idx = PHASE_STEPS.findIndex(s => s.key === phase);
  return idx >= 0 ? idx : 0;
}

function PhaseProgressInline({ phase, progress }: { phase: string; progress: number }) {
  const currentIndex = getPhaseIndex(phase);

  return (
    <div className="ext-phase-container">
      <div className="ext-phase-list">
        {PHASE_STEPS.map((step, index) => {
          const isDone = index < currentIndex;
          const isActive = index === currentIndex;
          return (
            <div key={step.key} className={`ext-phase-item${isDone ? ' ext-phase-item--done' : ''}${isActive ? ' ext-phase-item--active' : ''}`}>
              <div className="ext-phase-indicator">
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                ) : isActive ? (
                  <div className="ext-phase-spinner" />
                ) : (
                  <span className="ext-phase-number">{step.icon}</span>
                )}
              </div>
              <div className="ext-phase-label">{step.label}</div>
            </div>
          );
        })}
      </div>
      {progress > 0 && (
        <div className="ext-phase-progress-bar">
          <div className="ext-phase-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function ErrorStateInline({ error, onRetry, onBack }: { error: string | null; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="ext-analysis-error">
      <div className="ext-analysis-error-icon">!</div>
      <div className="ext-analysis-error-title">Analysis failed</div>
      {error && <div className="ext-analysis-error-msg">{error}</div>}
      <div className="ext-analysis-error-actions">
        <button type="button" className="ext-btn-secondary-v2" onClick={onRetry}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Retry
        </button>
        <button type="button" className="ext-back-btn" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
