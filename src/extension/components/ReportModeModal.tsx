import React from 'react';
import { useAppState, useActions } from '../store';

/**
 * ReportModeModal — blocking modal shown when the listing type cannot be
 * confidently detected as sale or rent.
 *
 * The store has already set analysisPhase to 'needs_report_mode' BEFORE any
 * analyze request was sent; this modal asks the user to confirm so we don't
 * burn a credit on the wrong report.
 *
 * - "For Sale" / "For Rent" → call forceReextract(content script 链路) → startAnalysis
 *   当 listingType === 'unknown' 时，必须强制重提取特定模式字段（不允许只 toggle 后用 common 直接分析）
 * - "Cancel" → reset to 'idle' (no request sent, no credit consumed)
 */
export function ReportModeModal() {
  const { analysisPhase, listingData } = useAppState();
  const { setReportMode, forceReextract, resetAnalysis, startAnalysis } = useActions();

  if (analysisPhase !== 'needs_report_mode') return null;

  const handleChoose = async (mode: 'sale' | 'rent') => {
    // Step 1: set reportMode (UI affordance)
    setReportMode(mode);

    // Step 2: 当 listingType === 'unknown' 时必须 forceReextract(content script 持有 document)
    // 让 extractor 重新跑 specific(Rent/Sale) 字段,而不是只 toggle listingType 用之前只有 common 的数据
    const wasUnknown = (listingData as any)?.listingType === 'unknown';
    if (wasUnknown) {
      const ok = await forceReextract(mode);
      if (!ok) {
        // forceReextract 失败由 store 内部 dispatch error phase
        return;
      }
    }

    // Step 3: Re-run analysis with forced listingType fields now available.
    // startAnalysis will see reportMode !== 'unknown' and proceed.
    void startAnalysis({ bypassCache: true, analysisType: 'full' });
  };

  const handleCancel = () => {
    // User aborts — go back to idle without firing any analyze request.
    resetAnalysis();
  };

  const addressHint = (listingData?.address || (listingData as any)?.title || 'this listing') as string;

  return (
    <div className="ext-reportmode-overlay" role="dialog" aria-modal="true" aria-labelledby="reportmode-title">
      <div className="ext-reportmode-card">
        <div className="ext-reportmode-eyebrow">One quick check</div>
        <h2 id="reportmode-title" className="ext-reportmode-title">
          Is this listing for sale or for rent?
        </h2>
        <p className="ext-reportmode-sub">
          We couldn&apos;t tell automatically from <strong>{addressHint}</strong>. Pick the right
          type so we generate the matching report. We won&apos;t run any analysis until you confirm.
        </p>

        <div className="ext-reportmode-actions">
          <button
            type="button"
            className="ext-reportmode-btn ext-reportmode-btn--sale"
            onClick={() => handleChoose('sale')}
          >
            For Sale
          </button>
          <button
            type="button"
            className="ext-reportmode-btn ext-reportmode-btn--rent"
            onClick={() => handleChoose('rent')}
          >
            For Rent
          </button>
        </div>

        <button type="button" className="ext-reportmode-cancel" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}