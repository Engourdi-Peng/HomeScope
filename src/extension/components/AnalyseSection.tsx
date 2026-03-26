import React from 'react';
import { Sparkles } from 'lucide-react';
import { useAppState, useActions } from '../store';

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

const PHASE_LABELS: Record<string, { main: string; sub?: string }> = {
  idle: { main: 'Analyse this property', sub: 'Uses 1 credit' },
  preparing: { main: 'Preparing extraction...', sub: 'Checking page state' },
  reading_page: { main: 'Reading page data...', sub: 'Extracting listing info' },
  opening_gallery: { main: 'Opening photo gallery...', sub: 'Launching PhotoSwipe' },
  collecting_photos: { main: 'Collecting photos...', sub: 'Scanning all images' },
  sending_data: { main: 'Sending to analysis...', sub: 'Uploading property data' },
  analysing: { main: 'Analysing property...', sub: 'AI evaluation in progress' },
  generating_report: { main: 'Generating report...', sub: 'Building your report' },
  done: { main: 'Analyse this property', sub: 'Uses 1 credit' },
  no_credits: { main: 'No credits remaining', sub: 'Get more credits' },
  error: { main: 'Analysis failed · Tap to retry' },
};

export function AnalyseSection() {
  const { analysisPhase, analysisProgress, propertyStatus, listingData, propertyDetection } = useAppState();
  const { retryAnalysis, navigateToReport } = useActions();
  const cooldownRemaining = useCooldownRemaining();
  const cooldownSecs = Math.ceil(cooldownRemaining / 1000);

  const isAnalysing = ['preparing', 'reading_page', 'opening_gallery', 'collecting_photos', 'sending_data', 'analysing', 'generating_report'].includes(analysisPhase);
  const isInCooldown = cooldownRemaining > 0;
  const canAnalyse = propertyStatus === 'detected' && listingData && !isAnalysing && !isInCooldown;
  const isNoCredits = analysisPhase === 'no_credits';
  const isError = analysisPhase === 'error';
  const isDone = analysisPhase === 'done';

  const getButtonLabel = () => {
    if (isInCooldown) return { main: `Please wait ${cooldownSecs}s`, sub: 'Cooldown active' };
    if (isError) return { main: 'Analysis failed · Tap to retry' };
    if (isNoCredits) return { main: 'No credits remaining', sub: 'Get more credits' };
    if (isDone) return { main: 'Analyse this property', sub: 'Uses 1 credit' };
    if (isAnalysing) return { main: PHASE_LABELS[analysisPhase]?.main ?? 'Working...', sub: PHASE_LABELS[analysisPhase]?.sub };
    const tier = propertyDetection?.tier;
    if (tier === 'partial') {
      return { main: 'Analyse with available data', sub: 'Partial analysis · Uses 1 credit' };
    }
    if (listingData) {
      return { main: 'Analyse this property', sub: 'Uses 1 credit' };
    }
    return { main: 'Not enough listing data', sub: 'Open a full listing page' };
  };

  const handleClick = () => {
    if (isInCooldown) return;
    if (isError) {
      retryAnalysis();
    } else if (canAnalyse) {
      navigateToReport(null);
    } else if (isNoCredits) {
      window.open('https://www.tryhomescope.com/pricing', '_blank');
    }
  };

  const label = getButtonLabel();

  const btnClass = [
    'ext-cta',
    isAnalysing && 'ext-cta--loading',
    (isInCooldown || isNoCredits) && 'ext-cta--disabled',
    isError && 'ext-cta--error',
    (isDone || canAnalyse) && !isAnalysing && !isNoCredits && !isInCooldown && !isError && 'ext-cta--primary',
    !isDone && !canAnalyse && !isAnalysing && !isNoCredits && !isInCooldown && !isError && 'ext-cta--muted',
  ]
    .filter(Boolean)
    .join(' ');

  const showProgress = isAnalysing && analysisProgress > 0;
  const disabled = !canAnalyse && !isError && !isNoCredits && !isDone && !isInCooldown;

  return (
    <div className="ext-cta-block">
      <button type="button" className={btnClass} onClick={handleClick} disabled={disabled}>
        {isAnalysing ? (
          <div className="ext-spinner ext-spinner-sm ext-spinner-on-dark" />
        ) : (
          !isError && !isNoCredits && !isInCooldown && <Sparkles size={18} strokeWidth={2} className="ext-cta-icon" />
        )}
        <span>{label.main}</span>
      </button>

      {showProgress && (
        <div className="ext-progress ext-progress-cta">
          <div className="ext-progress-bar" style={{ width: `${analysisProgress}%` }} />
        </div>
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
