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
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useAppState, useActions } from '../store';
import { ReportShell } from '../../shared/report/ReportShell';
import { ResultCard } from '../../components/ResultCard';

export function ExtensionResultView() {
  const { analysisPhase, analysisProgress, analysisError, analysisResult, listingData, extractionCached } = useAppState();
  const { retryAnalysis, navigateToHome, startAnalysis, refreshPhotos } = useActions();
  const hasStartedAnalysis = React.useRef(false);

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

  // Unified nav bar — mirrors web ResultCard header, adapted for sidepanel
  const NavBar = (
    <div className="flex items-center justify-between mb-8">
      <button
        onClick={navigateToHome}
        className="group flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors"
      >
        <div className="w-7 h-7 rounded-full border border-stone-200 flex items-center justify-center bg-white/80 group-hover:bg-white transition-colors">
          <ArrowLeft size={12} strokeWidth={1.5} />
        </div>
        <span className="text-xs font-medium">Back</span>
      </button>

      <svg xmlns="http://www.w3.org/2000/svg" width="110" height="18" viewBox="0 0 254.145 41.04">
        <g id="logo2" transform="translate(-81.15 -88.79)">
          <path id="_3" data-name="3" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.065,33.065,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328A9.553,9.553,0,0,1,138.96-28.3a9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.013,59.013,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,172.02-18.2a10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,188.39-18.9a17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018,3.851,3.851,0,0,0,3.4,1.912Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23a7.473,7.473,0,0,1,4.59-1.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477,3.676,3.676,0,0,0-3.325-1.7,3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7,3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.3-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
          <path id="_2" data-name="2" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935a10.254,10.254,0,0,1-5.8-1.642,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.37-6.905,10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09a17.2,17.2,0,0,1,1.28,6.79q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21a9.451,9.451,0,0,0,1.17-5.09A9.4,9.4,0,0,0,44.887-16.3a3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018,3.851,3.851,0,0,0,3.4,1.917ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.3-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
          <path id="_1" data-name="1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
        </g>
      </svg>

      {/* Logo on the right — Back button is on the left */}
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
      {extractionCached && (
        <div className="mb-4 text-center">
          <button
            type="button"
            onClick={refreshPhotos}
            className="text-xs text-stone-400 hover:text-stone-600 transition-colors underline underline-offset-2"
          >
            Refresh photos
          </button>
        </div>
      )}
      <ResultCard
        result={analysisResult}
        onBack={navigateToHome}
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
