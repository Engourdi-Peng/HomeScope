import React from 'react';
import { ArrowRight, Check, Camera } from 'lucide-react';
import { useAppState, useActions } from '../store';

// Analysis phases in order
const ANALYSIS_PHASES = [
  'reading_page',
  'opening_gallery',
  'collecting_photos',
  'sending_data',
  'analysing',
  'generating_report',
] as const;

type AnalysisPhaseType = typeof ANALYSIS_PHASES[number];

const PHASE_DISPLAY: Record<AnalysisPhaseType, { label: string }> = {
  reading_page: { label: 'Reading page data' },
  opening_gallery: { label: 'Opening gallery' },
  collecting_photos: { label: 'Collecting photos' },
  sending_data: { label: 'Sending data' },
  analysing: { label: 'Analysing property' },
  generating_report: { label: 'Generating report' },
};

interface PhaseItemProps {
  phase: AnalysisPhaseType;
  index: number;
  isDone: boolean;
  isActive: boolean;
}

function PhaseItem({ phase, index, isDone, isActive }: PhaseItemProps) {
  const display = PHASE_DISPLAY[phase];

  return (
    <div className={`ext-phase-item ${isDone ? 'ext-phase-item--done' : ''} ${isActive ? 'ext-phase-item--active' : ''}`}>
      <div className="ext-phase-indicator">
        {isDone ? (
          <Check size={12} strokeWidth={3} />
        ) : isActive ? (
          <div className="ext-phase-spinner" />
        ) : (
          <span className="ext-phase-number">{index + 1}</span>
        )}
      </div>
      <span className="ext-phase-label">{display.label}</span>
    </div>
  );
}

interface AnalysisProgressPanelProps {
  phase: string;
  progress: number;
}

function AnalysisProgressPanel({ phase, progress }: AnalysisProgressPanelProps) {
  return (
    <div className="ext-analysis-progress-panel ext-panel">
      <div className="ext-phase-list">
        {ANALYSIS_PHASES.map((p, idx) => {
          const phaseIdx = ANALYSIS_PHASES.indexOf(p as AnalysisPhaseType);
          const currentIdx = ANALYSIS_PHASES.indexOf(phase as AnalysisPhaseType);
          const isDone = phaseIdx < currentIdx;
          const isActive = p === phase;

          return (
            <PhaseItem
              key={p}
              phase={p as AnalysisPhaseType}
              index={idx}
              isDone={isDone}
              isActive={isActive}
            />
          );
        })}
      </div>
      <div className="ext-phase-progress-bar">
        <div className="ext-phase-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="ext-phase-hint">
        <Camera size={12} />
        <span>We&apos;ll open the photo gallery to collect all images for a more accurate analysis.</span>
      </div>
    </div>
  );
}

function useCooldownRemaining() {
  const { cooldownEndsAt } = useAppState();
  const [remaining, setRemaining] = React.useState<number>(0);

  React.useEffect(() => {
    if (cooldownEndsAt === null) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const r = Math.max(0, cooldownEndsAt - Date.now());
      setRemaining(r);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [cooldownEndsAt]);

  return remaining;
}

const PRIMARY_CTA_MAIN = 'See potential risks';

const PHASE_LABELS: Record<string, { main: string; sub?: string }> = {
  idle: { main: PRIMARY_CTA_MAIN, sub: 'Know before you visit' },
  preparing: { main: 'Preparing extraction...', sub: 'Checking page state' },
  reading_page: { main: 'Reading page data...', sub: 'Extracting listing info' },
  opening_gallery: { main: 'Opening photo gallery...', sub: 'Launching PhotoSwipe' },
  collecting_photos: { main: 'Collecting photos...', sub: 'Scanning all images' },
  sending_data: { main: 'Sending to analysis...', sub: 'Uploading property data' },
  analysing: { main: 'Analysing property...', sub: 'AI evaluation in progress' },
  generating_report: { main: 'Generating report...', sub: 'Building your report' },
  done: { main: PRIMARY_CTA_MAIN, sub: 'Know before you visit' },
  no_credits: { main: 'No credits remaining', sub: 'Get more credits' },
  error: { main: 'Analysis failed · Tap to retry' },
};

export function AnalyseSection() {
  const { analysisPhase, analysisProgress, listingData, propertyDetection } = useAppState();
  const { retryAnalysis, startAnalysis } = useActions();
  const cooldownRemaining = useCooldownRemaining();
  const cooldownSecs = Math.ceil(cooldownRemaining / 1000);

  const isAnalysing = ['preparing', 'reading_page', 'opening_gallery', 'collecting_photos', 'sending_data', 'analysing', 'generating_report'].includes(analysisPhase);
  const isInCooldown = cooldownRemaining > 0;
  const isNoCredits = analysisPhase === 'no_credits';
  const isError = analysisPhase === 'error';
  const isDone = analysisPhase === 'done';

  // Button is always enabled unless: already analysing, in cooldown, or no credits
  const isDisabled = isAnalysing || isInCooldown || isNoCredits;

  const getButtonLabel = () => {
    if (isInCooldown) return { main: `Please wait ${cooldownSecs}s`, sub: 'Cooldown active' };
    if (isError) return { main: 'Analysis failed · Tap to retry' };
    if (isNoCredits) return { main: 'No credits remaining', sub: 'Get more credits' };
    if (isAnalysing) return { main: PHASE_LABELS[analysisPhase]?.main ?? 'Working...', sub: PHASE_LABELS[analysisPhase]?.sub };
    if (isDone) return { main: PRIMARY_CTA_MAIN, sub: 'Know before you visit' };
    const tier = propertyDetection?.tier;
    if (tier === 'partial') {
      return { main: PRIMARY_CTA_MAIN, sub: 'Partial analysis · Uses 1 credit' };
    }
    if (listingData) {
      return { main: PRIMARY_CTA_MAIN, sub: 'Know before you visit' };
    }
    // No listing data yet — button still enabled, will trigger extraction first
    return { main: PRIMARY_CTA_MAIN, sub: 'Reads listing page first' };
  };

  const handleClick = () => {
    if (isDisabled) return;
    if (isError) {
      retryAnalysis();
    } else if (isNoCredits) {
      window.open('https://www.tryhomescope.com/pricing', '_blank');
    } else {
      // Always go through startAnalysis — it handles the full extract + analyze flow,
      // including the case where listingData hasn't been loaded yet.
      startAnalysis({ bypassCache: true });
    }
  };

  const label = getButtonLabel();

  const showPrimaryArrow =
    (isDone || !!listingData) && !isAnalysing && !isNoCredits && !isInCooldown && !isError;

  const btnClass = [
    'ext-cta',
    isAnalysing && 'ext-cta--loading',
    isNoCredits && 'ext-cta--disabled',
    isError && 'ext-cta--error',
    (isDone || !!listingData) && !isAnalysing && !isNoCredits && !isInCooldown && !isError && 'ext-cta--primary',
    !listingData && !isAnalysing && !isNoCredits && !isInCooldown && !isError && 'ext-cta--muted',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="ext-cta-block">
      <button type="button" className={btnClass} onClick={handleClick} disabled={isDisabled}>
        {isAnalysing && <div className="ext-spinner ext-spinner-sm ext-spinner-on-dark" />}
        <span className="ext-cta-label">{label.main}</span>
        {showPrimaryArrow && <ArrowRight size={18} strokeWidth={2.25} className="ext-cta-icon" aria-hidden />}
      </button>

      {isAnalysing && (
        <p className="ext-deep-audit-hint">Deep audit in progress. Trust us, it's better than trekking to a dud inspection in the rain.</p>
      )}

      {isAnalysing && (
        <AnalysisProgressPanel
          phase={analysisPhase}
          progress={analysisProgress}
        />
      )}

      {label.sub && !isAnalysing && (
        <p className="ext-cta-sub">
          {isNoCredits ? (
            <button
              type="button"
              className="ext-link-btn"
              onClick={() => window.open('https://www.tryhomescope.com/pricing', '_blank')}
            >
              {label.sub} →
            </button>
          ) : (
            label.sub
          )}
        </p>
      )}
    </div>
  );
}
