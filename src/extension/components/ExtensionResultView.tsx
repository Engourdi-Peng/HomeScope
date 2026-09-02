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
    const result = history?.find((item, index) => {
      const fullResult = item.full_result as AnalysisResult | undefined;

      if (!fullResult) {
        return false;
      }
      if (fullResult.analysisType !== 'full') {
        return false;
      }

      // Check URL match
      if (url) {
        const historyUrl = fullResult?.listingUrl || '';
        if (urlsMatch(url, historyUrl)) {
          return true;
        }
      }

      // Check address match (try multiple sources)
      if (address) {
        // 1. item.address (from history)
        if (item.address) {
          const addrMatch1 = addressesMatch(address, item.address);
          if (addrMatch1) return true;
        }
        // 2. fullResult.listingInfo.address
        const resultAddress = (fullResult as any)?.listingInfo?.address;
        if (resultAddress) {
          const addrMatch2 = addressesMatch(address, resultAddress);
          if (addrMatch2) return true;
        }
        // 3. fullResult.address (top-level)
        const topAddress = (fullResult as any)?.address;
        if (topAddress) {
          const addrMatch3 = addressesMatch(address, topAddress);
          if (addrMatch3) return true;
        }
      }

      return false;
    });

    return result;
  };

  const hasFullReport = React.useMemo(() => {
    return !!findMatchingHistoryItem(currentUrl, currentAddress);
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

  // NavBar：sticky 整条顶栏，Back 左、Share 右，滚动报告时始终固定在顶部
  //
  // 实现要点（确保真正"固定在顶部"）：
  //  1. 不使用负 margin（`-mt-*`）—— sticky 依赖元素的正常盒模型计算；
  //     负 margin 会让"自然位置"提前到达视口顶部，导致它在不该黏住时黏住，
  //     或在应该黏住时下方留出不必要的空白。
  //  2. 背景必须**完全不透明** + 与 ReportShell 的 `bg-[#FDFCF9]` 一致，
  //     否则报告内容（深色 HeroSection / 各 section）滚动到顶栏区域时会
  //     透过来，视觉上感觉"没黏住"。同时给一个细微的底部边框作为视觉锚点。
  //  3. `z-50` 必须大于任何报告内容的 z-index（报告 section 不设 z-index，
  //     所以 z-50 已足够）。
  //  4. NavBar 现在被**移到了 ReportShell 外面**——直接作为 `.ext-app--report`
  //     的子元素。这样 sticky 的滚动祖先就是 `.ext-app--report`（它有
  //     `overflow-y: auto`），行为完全可预期，不再受 ReportShell 内部
  //     `overflow-x-hidden` 边角情况影响；同时 NavBar 横跨整个 sidepanel
  //     宽度，不被 ReportShell 的 `max-w-[1200px]` 内边距收缩。
  const NavBar = (
    <div
      className="
        sticky top-0 z-50
        w-full
        bg-[#FDFCF9]
        border-b border-stone-200
        py-3
      "
      style={{
        // 兜底：保证背景色完全不透明，避免 Tailwind JIT 在扩展里漏编译
        backgroundColor: '#FDFCF9',
      }}
    >
      <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8">
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
    </div>
  );

  // Loading state
  if (isAnalysing) {
    return (
      <>
        {NavBar}
        <ReportShell mode="extension">
          <PhaseProgressInline phase={analysisPhase} progress={analysisProgress} isBasic={currentAnalysisType === 'basic'} />
        </ReportShell>
      </>
    );
  }

  // Error state
  if (isError) {
    return (
      <>
        {NavBar}
        <ReportShell mode="extension">
          <ErrorStateInline error={analysisError} onRetry={retryAnalysis} onBack={navigateToHome} />
        </ReportShell>
      </>
    );
  }

  // No result yet (but no error either — e.g. network failed before getting result)
  if (!hasResult) {
    return (
      <>
        {NavBar}
        <ReportShell mode="extension">
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
      </>
    );
  }

  // Has result: use ReportScreen (handles both basic and full analysis)
  return (
    <>
      {NavBar}
      <ReportShell mode="extension">
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
    </>
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
