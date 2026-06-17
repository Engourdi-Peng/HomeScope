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
import React, { useState, useCallback } from 'react';
import { ArrowLeft, Share2, Copy, CheckCircle } from 'lucide-react';

const noop = (..._args: unknown[]) => {};
import { useAppState, useActions } from '../store';
import { ReportScreen } from '../../shared/report/ReportScreen';
import { ReportShell } from '../../shared/report/ReportShell';
import { getAnalysisProgressSteps } from '../analysisProgressSteps';

export function ExtensionResultView() {
  const { analysisPhase, analysisProgress, analysisError, analysisResult, listingData, authStatus, currentAnalysisType, credits, history, lastExtractedUrl } = useAppState();
  const { retryAnalysis, navigateToHome, startAnalysis, shareAnalysis, initiateGoogleOAuth, navigateToReport } = useActions();
  const hasStartedAnalysis = React.useRef(false);

  // Top bar share state — same logic as ResultCard bottom share
  const [isSharing, setIsSharing] = useState(false);
  const [shareResult, setShareResult] = useState<{ slug: string; shareUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // must be declared before useEffect callbacks that reference it (const = TDZ)
  const hasResult = !!analysisResult;

  // Auto-start: only begin if analysisType is explicitly 'basic' or 'full'
  // Prevents guest auto-starting full analysis when type is ambiguous
  React.useEffect(() => {
    if (analysisPhase === 'idle' && !hasStartedAnalysis.current && listingData) {
      hasStartedAnalysis.current = true;
      const type = currentAnalysisType;
      if (type === 'basic' || type === 'full') {
        startAnalysis({ analysisType: type });
      }
    }
  }, [analysisPhase, listingData, startAnalysis, currentAnalysisType]);

  // Check if current listing already has a full report in history
  // Match by address or URL and require full_result to be available
  // Try multiple sources for the address: listingData, analysisResult
  const currentAddress =
    (listingData as any)?.address ||
    (analysisResult as any)?.listingInfo?.address ||
    (analysisResult as any)?.address ||
    '';
  // Use lastExtractedUrl as the primary URL match source
  const currentUrl = lastExtractedUrl || '';

  // Helper: normalize address for fuzzy matching (extract street number + street name)
  const normalizeAddressForMatch = (addr: string): string => {
    if (!addr) return '';
    return addr
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')  // Remove punctuation
      .replace(/\s+/g, ' ')         // Normalize spaces
      .trim();
  };

  // Helper: extract core address (street number + main street name, ignore unit/apt)
  const extractCoreAddress = (addr: string): string => {
    if (!addr) return '';
    const normalized = normalizeAddressForMatch(addr);
    const parts = normalized.split(' ');
    // Take first 2-4 parts (typically: number, street, type)
    // Skip unit/apt numbers (usually 'apt', 'unit', '#' followed by numbers)
    let coreParts: string[] = [];
    let skipNext = false;
    for (let i = 0; i < parts.length && coreParts.length < 4; i++) {
      if (skipNext) { skipNext = false; continue; }
      const part = parts[i];
      if (['apt', 'unit', 'ste', 'suite', 'floor', 'fl', '#'].includes(part)) {
        skipNext = true;
        continue;
      }
      coreParts.push(part);
    }
    return coreParts.join(' ');
  };

  // Helper: check if core address matches (ignores apt/unit differences)
  const addressesMatch = (addr1: string, addr2: string): boolean => {
    if (!addr1 || !addr2) return false;
    const core1 = extractCoreAddress(addr1);
    const core2 = extractCoreAddress(addr2);
    if (!core1 || !core2) return false;
    // Exact match first
    if (core1 === core2) return true;
    // One contains the other (for cases where one has more detail)
    return core1.includes(core2) || core2.includes(core1);
  };

  // Helper: check URL match with multiple strategies
  const urlsMatch = (url1: string, url2: string): boolean => {
    if (!url1 || !url2) return false;
    try {
      const normalize = (u: string) => {
        try {
          const parsed = new URL(u);
          return parsed.origin + parsed.pathname.replace(/\/$/, '');
        } catch {
          return u.toLowerCase().trim();
        }
      };
      const n1 = normalize(url1);
      const n2 = normalize(url2);
      // Exact match
      if (n1 === n2) return true;
      // Pathname match (ignore query params)
      const parsed1 = new URL(url1);
      const parsed2 = new URL(url2);
      return parsed1.pathname === parsed2.pathname;
    } catch {
      // Fallback: simple string comparison
      return url1.toLowerCase().includes(url2.toLowerCase()) ||
             url2.toLowerCase().includes(url1.toLowerCase());
    }
  };

  // Helper: find a matching history item with full report
  const findMatchingHistoryItem = (url: string, address: string): typeof history[0] | undefined => {
    console.log('[DEBUG findMatchingHistoryItem] START - url:', url, '| address:', address);
    console.log('[DEBUG findMatchingHistoryItem] history.length:', history?.length);

    const result = history?.find((item, index) => {
      const fullResult = item.full_result as AnalysisResult | undefined;
      console.log(`[DEBUG findMatchingHistoryItem] Checking item[${index}]: id=${item.id}`);
      console.log(`[DEBUG findMatchingHistoryItem]   - hasFullResult:`, !!fullResult);
      console.log(`[DEBUG findMatchingHistoryItem]   - analysisType:`, fullResult?.analysisType);
      console.log(`[DEBUG findMatchingHistoryItem]   - item.address:`, item.address);
      console.log(`[DEBUG findMatchingHistoryItem]   - fullResult.listingUrl:`, fullResult?.listingUrl);
      console.log(`[DEBUG findMatchingHistoryItem]   - fullResult.listingInfo?.address:`, (fullResult as any)?.listingInfo?.address);
      console.log(`[DEBUG findMatchingHistoryItem]   - fullResult.address:`, (fullResult as any)?.address);

      if (!fullResult) {
        console.log(`[DEBUG findMatchingHistoryItem]   - SKIP: no fullResult`);
        return false;
      }
      if (fullResult.analysisType !== 'full') {
        console.log(`[DEBUG findMatchingHistoryItem]   - SKIP: analysisType !== 'full' (got:`, fullResult.analysisType, ')');
        return false;
      }

      // Check URL match
      if (url) {
        const historyUrl = fullResult?.listingUrl || '';
        console.log(`[DEBUG findMatchingHistoryItem]   - Checking URL match:`, { url, historyUrl });
        if (urlsMatch(url, historyUrl)) {
          console.log(`[DEBUG findMatchingHistoryItem]   - URL MATCH!`);
          return true;
        }
      }

      // Check address match (try multiple sources)
      if (address) {
        console.log(`[DEBUG findMatchingHistoryItem]   - Checking address match:`, address);
        // 1. item.address (from history)
        if (item.address) {
          const addrMatch1 = addressesMatch(address, item.address);
          console.log(`[DEBUG findMatchingHistoryItem]     - vs item.address (${item.address}):`, addrMatch1);
          if (addrMatch1) return true;
        }
        // 2. fullResult.listingInfo.address
        const resultAddress = (fullResult as any)?.listingInfo?.address;
        if (resultAddress) {
          const addrMatch2 = addressesMatch(address, resultAddress);
          console.log(`[DEBUG findMatchingHistoryItem]     - vs listingInfo.address (${resultAddress}):`, addrMatch2);
          if (addrMatch2) return true;
        }
        // 3. fullResult.address (top-level)
        const topAddress = (fullResult as any)?.address;
        if (topAddress) {
          const addrMatch3 = addressesMatch(address, topAddress);
          console.log(`[DEBUG findMatchingHistoryItem]     - vs top-level address (${topAddress}):`, addrMatch3);
          if (addrMatch3) return true;
        }
      }

      console.log(`[DEBUG findMatchingHistoryItem]   - NO MATCH for this item`);
      return false;
    });

    console.log('[DEBUG findMatchingHistoryItem] END - result:', result ? `MATCHED: ${result.id}` : 'NO MATCH');
    return result;
  };

  const hasFullReport = React.useMemo(() => {
    console.log('[DEBUG hasFullReport] Computing...');
    console.log('[DEBUG hasFullReport] - currentUrl:', currentUrl);
    console.log('[DEBUG hasFullReport] - currentAddress:', currentAddress);
    console.log('[DEBUG hasFullReport] - history length:', history?.length);
    const result = !!findMatchingHistoryItem(currentUrl, currentAddress);
    console.log('[DEBUG hasFullReport] - RESULT:', result);
    return result;
  }, [history, currentAddress, currentUrl]);

  // Define isAnalysing and isError here to avoid TDZ issues
  const isAnalysing = ['preparing', 'reading_page', 'opening_gallery', 'collecting_photos', 'sending_data', 'analysing', 'generating_report'].includes(analysisPhase);
  const isError = analysisPhase === 'error';

  // Check if full analysis is currently running
  const isFullRunning = isAnalysing && currentAnalysisType === 'full';

  // Sign-in handler: initiate OAuth login
  const handleSignIn = useCallback(async () => {
    await initiateGoogleOAuth();
  }, [initiateGoogleOAuth]);

  // Checkout handler: navigate to checkout/account page
  const handleOpenCheckout = useCallback(() => {
    // Open account/credits page in a new tab or navigate
    window.open('/account', '_blank');
  }, []);

  // View existing full report handler
  const handleViewFullReport = React.useCallback(() => {
    const historyItem = findMatchingHistoryItem(currentUrl, currentAddress);
    if (historyItem?.full_result) {
      navigateToReport(historyItem.full_result);
    }
  }, [history, currentUrl, currentAddress, navigateToReport]);

  // Upgrade handler: logged-in → run full analysis; logged-out → trigger login
  // This is now replaced by more granular handlers
  const handleUpgrade = useCallback(async () => {
    if (authStatus === 'logged_out') {
      await initiateGoogleOAuth();
    } else if (credits > 0 && !hasFullReport && !isFullRunning) {
      // Logged in with credits and no existing full report: start full analysis
      await startAnalysis({ analysisType: 'full', bypassCache: true });
    }
  }, [authStatus, credits, hasFullReport, isFullRunning, initiateGoogleOAuth, startAnalysis]);

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
      noop(err);
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
        <PhaseProgressInline phase={analysisPhase} progress={analysisProgress} isBasic={currentAnalysisType === 'basic'} />
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

  // No result yet (but no error either — e.g. network failed before getting result)
  if (!hasResult) {
    return (
      <ReportShell mode="extension">
        {NavBar}
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="ext-spinner" />
          <div className="text-sm text-stone-500 text-center">
            {analysisError ? null : (
              <span>Waiting for analysis result...</span>
            )}
          </div>
          {analysisError && (
            <div className="flex flex-col items-center gap-3 max-w-sm">
              <div className="ext-analysis-error">
                <div className="ext-analysis-error-icon">!</div>
                <div className="ext-analysis-error-title">Analysis failed</div>
                <div className="ext-analysis-error-msg">{analysisError}</div>
              </div>
              <button
                type="button"
                className="ext-btn-secondary-v2"
                onClick={retryAnalysis}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                Retry
              </button>
            </div>
          )}
        </div>
      </ReportShell>
    );
  }

  // Has result: use ReportScreen (handles both basic and full analysis)
  return (
    <ReportShell mode="extension">
      {NavBar}
      <ReportScreen
        mode="extension"
        result={analysisResult}
        onBack={navigateToHome}
        onShare={authStatus === 'logged_in' ? handleShare : undefined}
        onUpgrade={handleUpgrade}
        analysisId={analysisResult?.id}
        noShell
        authStatus={authStatus}
        credits={credits}
        hasFullReport={hasFullReport}
        isFullRunning={isFullRunning}
        onSignIn={handleSignIn}
        onOpenCheckout={handleOpenCheckout}
        onViewFullReport={handleViewFullReport}
      />
    </ReportShell>
  );
}

// ===== Inline analysis state components =====

function getPhaseIndex(phase: string, steps: readonly { key: string }[]): number {
  const idx = steps.findIndex(s => s.key === phase);
  return idx >= 0 ? idx : 0;
}

function PhaseProgressInline({ phase, progress, isBasic }: { phase: string; progress: number; isBasic: boolean }) {
  const steps = getAnalysisProgressSteps(isBasic ? 'basic' : 'full');
  const currentIndex = getPhaseIndex(phase, steps);

  return (
    <div className="ext-phase-container">
      <div className="ext-phase-list">
        {steps.map((step, index) => {
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
                  <span className="ext-phase-number">{index + 1}</span>
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
