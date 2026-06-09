import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useAppState, useActions } from '../store';
import { getAnalysisProgressSteps } from '../analysisProgressSteps';

// ========== PhaseItem ==========
interface PhaseItemProps {
  label: string;
  isDone: boolean;
  isActive: boolean;
}

function PhaseItem({ label, isDone, isActive }: PhaseItemProps) {
  return (
    <div className={`ext-phase-item ${isDone ? 'ext-phase-item--done' : ''} ${isActive ? 'ext-phase-item--active' : ''}`}>
      <div className="ext-phase-indicator">
        {isDone ? (
          <Check size={12} strokeWidth={3} />
        ) : isActive ? (
          <div className="ext-phase-spinner" />
        ) : null}
      </div>
      <span className="ext-phase-label">{label}</span>
    </div>
  );
}

// ========== AnalysisProgressPanel ==========
interface AnalysisProgressPanelProps {
  phase: string;
  progress: number;
  isBasic: boolean;
}

function AnalysisProgressPanel({ phase, progress, isBasic }: AnalysisProgressPanelProps) {
  const steps = getAnalysisProgressSteps(isBasic ? 'basic' : 'full');

  const currentIndex = steps.findIndex(s => s.key === phase);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  return (
    <div className="ext-analysis-progress-panel ext-panel">
      <div className="ext-phase-list">
        {steps.map((step, index) => {
          const isDone = index < safeIndex;
          const isActive = index === safeIndex;
          return (
            <PhaseItem
              key={step.key}
              label={step.label}
              isDone={isDone}
              isActive={isActive}
            />
          );
        })}
      </div>
      <div className="ext-phase-progress-bar">
        <div className="ext-phase-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      {!isBasic && (
        <div className="ext-phase-hint">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          <span>Unlock Full Analysis for AI photo review and hidden risk detection.</span>
        </div>
      )}
    </div>
  );
}

// ========== useCooldownRemaining ==========
function useCooldownRemaining() {
  const { cooldownEndsAt } = useAppState();
  const [remaining, setRemaining] = React.useState<number>(0);
  React.useEffect(() => {
    if (cooldownEndsAt === null) { setRemaining(0); return; }
    const tick = () => { const r = Math.max(0, cooldownEndsAt - Date.now()); setRemaining(r); };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [cooldownEndsAt]);
  return remaining;
}

// ========== AnalyseSection ==========
/**
 * Handles Deep Analysis CTA for logged-in users.
 *
 * - Shows "Start Deep Analysis" primary button when logged in + has credits
 * - Shows analysis progress panel during any analysis (basic or full)
 * - Shows credits-unavailable state with muted "Get more deep analyses" button
 *
 * Note:
 *   - Basic Analysis entry for ALL users is in GateView (primary for logged-out, secondary for logged-in)
 *   - Logged-out conversion entry is in FreemiumEntry
 */
export function AnalyseSection() {
  const { analysisPhase, analysisProgress, credits, authStatus, propertyDetection, analysisType } = useAppState();
  const { retryAnalysis, startAnalysis } = useActions();
  const cooldownRemaining = useCooldownRemaining();
  const cooldownSecs = Math.ceil(cooldownRemaining / 1000);

  const isLoggedIn = authStatus === 'logged_in';
  const isAnalysing = ['preparing', 'reading_page', 'opening_gallery', 'collecting_photos', 'sending_data', 'analysing', 'generating_report'].includes(analysisPhase);
  const isInCooldown = cooldownRemaining > 0;
  const isNoCredits = credits <= 0;
  const isError = analysisPhase === 'error';
  const isDone = analysisPhase === 'done';
  const hasCredits = credits > 0;
  const isBasic = analysisType === 'basic';

  const isDisabled = isAnalysing || isInCooldown;

  const getDeepLabel = (): { main: string; sub1?: string; sub2?: string } => {
    if (isInCooldown) return { main: `Please wait ${cooldownSecs}s` };
    if (isError) return { main: 'Analysis failed · Tap to retry' };
    if (isNoCredits && isLoggedIn) return { main: 'No deep analyses remaining · Get more credits' };
    if (isDone) return { main: 'Deep Analysis', sub1: `Uses 1 credit · ${credits} deep analyses left`, sub2: 'Includes photos, hidden risks, costs and investment context' };
    const tier = propertyDetection?.tier;
    if (tier === 'partial') return { main: 'Deep Analysis', sub1: 'Uses 1 credit · Partial analysis', sub2: 'Includes photos, hidden risks, costs and investment context' };
    return { main: 'Deep Analysis', sub1: `Uses 1 credit · ${credits} deep analyses left`, sub2: 'Includes photos, hidden risks, costs and investment context' };
  };

  const handleDeepClick = () => {
    if (isDisabled) return;
    if (isError) {
      retryAnalysis();
    } else {
      startAnalysis({ bypassCache: true, analysisType: 'full' });
    }
  };

  const deepLabel = getDeepLabel();
  const showArrow = isDone && !isAnalysing && !isInCooldown && !isError;

  const btnClass = [
    'ext-cta',
    isAnalysing && 'ext-cta--loading',
    isError && 'ext-cta--error',
  ].filter(Boolean).join(' ');

  const showPrimaryBtn = isLoggedIn && hasCredits && !isAnalysing && !isError;
  const showMutedBtn = isNoCredits && isLoggedIn && !isAnalysing && !isError;

  return (
    <div className="ext-cta-block">
      {/* Primary: Start Deep Analysis — shown only when credits available */}
      {showPrimaryBtn && (
        <>
          <button
            type="button"
            className={`${btnClass} ext-cta--primary`}
            onClick={handleDeepClick}
            disabled={isDisabled}
          >
            <span className="ext-cta-label">Start Deep Analysis</span>
            {showArrow && <ArrowRight size={18} strokeWidth={2.25} className="ext-cta-icon" aria-hidden />}
          </button>
          {deepLabel.sub1 && <p className="ext-cta-sub">{deepLabel.sub1}</p>}
          {deepLabel.sub2 && <p className="ext-cta-sub-2">{deepLabel.sub2}</p>}
        </>
      )}

      {/* Muted: Get more credits when exhausted */}
      {showMutedBtn && (
        <button
          type="button"
          className="ext-cta ext-cta--muted"
          onClick={() => window.open('https://www.tryhomescope.com/pricing', '_blank')}
        >
          <span className="ext-cta-label">Get more deep analyses</span>
          <span className="ext-cta-sub-label">No analyses remaining</span>
        </button>
      )}

      {/* Analysis progress — shown for BOTH basic and full */}
      {isAnalysing && (
        <>
          <p className="ext-deep-audit-hint">
            {isBasic
              ? 'Free analysis in progress. No sign-in required.'
              : "Deep audit in progress. Trust us, it's better than trekking to a dud inspection in the rain."}
          </p>
          <AnalysisProgressPanel phase={analysisPhase} progress={analysisProgress} isBasic={isBasic} />
        </>
      )}

      {/* Analysis error */}
      {isError && (
        <button type="button" className={btnClass} onClick={handleDeepClick}>
          {deepLabel.main}
        </button>
      )}

      {/* Not logged in — secondary prompt */}
      {!isLoggedIn && !isAnalysing && (
        <p className="ext-cta-sub">
          <span>Sign in for full analysis with photo review and hidden risk detection</span>
        </p>
      )}
    </div>
  );
}
