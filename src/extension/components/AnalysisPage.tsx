/**
 * AnalysisPage
 *
 * Handles the analysis process UI only (loading, error, empty states).
 * Does NOT render the final result — that is handled by ExtensionResultView.
 *
 * When analysis succeeds, store calls navigateToReport() which switches
 * currentView='report' in App.tsx, causing ExtensionResultView to render.
 */
import React from 'react';
import { useAppState, useActions } from '../store';

const PHASE_STEPS = [
  { key: 'reading_page', label: 'Reading page data...', icon: '1' },
  { key: 'extracting_images', label: 'Extracting listing details...', icon: '2' },
  { key: 'analysing', label: 'Analysing property...', icon: '3' },
  { key: 'generating_report', label: 'Generating report...', icon: '4' },
] as const;

function getPhaseIndex(phase: string): number {
  const idx = PHASE_STEPS.findIndex(s => s.key === phase);
  return idx >= 0 ? idx : 0;
}

function PhaseProgress({ phase, progress }: { phase: string; progress: number }) {
  if (['idle', 'done', 'error', 'no_credits'].includes(phase)) return null;
  const currentIndex = getPhaseIndex(phase);
  const isAnalysing = ['reading_page', 'extracting_images', 'analysing', 'generating_report'].includes(phase);

  return (
    <div className="ext-phase-container">
      <div className="ext-phase-list">
        {PHASE_STEPS.map((step, index) => {
          const isDone = index < currentIndex || (phase === 'done' && index === PHASE_STEPS.length - 1);
          const isActive = index === currentIndex && isAnalysing;
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

function ErrorState({ error, onRetry, onBack }: { error: string | null; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="ext-analysis-error">
      <div className="ext-analysis-error-icon">⚠️</div>
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

function EmptyState() {
  return (
    <div className="ext-analysis-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
      <span className="ext-analysis-empty-text">Waiting for analysis...</span>
    </div>
  );
}

export function AnalysisPage() {
  const { analysisPhase, analysisProgress, analysisError, listingData } = useAppState();
  const { retryAnalysis, navigateToHome, startAnalysis } = useActions();
  const hasStartedAnalysis = React.useRef(false);

  // Auto-start analysis when in report view and data is available
  React.useEffect(() => {
    if (analysisPhase === 'idle' && !hasStartedAnalysis.current && listingData) {
      hasStartedAnalysis.current = true;
      startAnalysis();
    }
  }, [analysisPhase, listingData, startAnalysis]);

  if (analysisPhase === 'error') {
    return <ErrorState error={analysisError} onRetry={retryAnalysis} onBack={navigateToHome} />;
  }

  if (!listingData && analysisPhase === 'idle') {
    return <EmptyState />;
  }

  // Analysis in progress
  return <PhaseProgress phase={analysisPhase} progress={analysisProgress} />;
}
