import React from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { useAppState, useActions } from '../store';

function formatReportDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function getScoreColor(score?: number) {
  if (!score) return 'var(--text-muted)';
  if (score >= 75) return '#16a34a'; // green-600
  if (score >= 50) return '#ea580c'; // amber-600
  return '#dc2626'; // red-600
}

export function HistorySection() {
  const { history, historyLoading, viewingHistoryId } = useAppState();
  const { navigateToReport } = useActions();

  if (historyLoading) {
    return (
      <section className="ext-reports-section">
        <div className="ext-section-label">Recent analyses</div>
        <div className="ext-loading-state">
          <div className="ext-spinner" />
          <span>Loading history...</span>
        </div>
      </section>
    );
  }

  if (!history || history.length === 0) {
    return null;
  }

  const displayHistory = history.slice(0, 8);

  return (
    <section className="ext-reports-section">
      <div className="ext-section-label">Recent analyses</div>
      <ul className="ext-report-list">
        {displayHistory.map((item) => {
          const isActive = viewingHistoryId === item.id;
          const title = item.address || item.title || 'Property Analysis';
          const score =
            item.full_result?.overallScore ??
            item.overall_score ??
            null;
          const clickable = !!(item.full_result && item.status === 'done');

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`ext-report-row${isActive ? ' ext-report-row--active' : ''}${!clickable ? ' ext-report-row--disabled' : ''}`}
                onClick={() => {
                  if (clickable && item.full_result) navigateToReport(item.full_result);
                }}
                disabled={!clickable}
              >
                {item.cover_image_url ? (
                  <img
                    src={item.cover_image_url}
                    alt=""
                    className="ext-report-thumb"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="ext-report-thumb ext-report-thumb--placeholder" aria-hidden>
                    🏠
                  </div>
                )}
                <div className="ext-report-mid">
                  <div className="ext-report-title" title={title}>
                    {title}
                  </div>
                  <div className="ext-report-meta-row">
                    <span className="ext-report-date">{formatReportDate(item.created_at)}</span>
                    {score != null && item.status === 'done' && (
                      <span className="ext-report-score" style={{ fontWeight: 600, color: getScoreColor(score) }}>
                        Score: {Math.round(score)}
                      </span>
                    )}
                  </div>
                  {item.address && item.title && (
                    <div className="ext-report-address" title={item.address}>
                      {item.address}
                    </div>
                  )}
                </div>
                {clickable && <ChevronRight size={18} className="ext-report-chevron" strokeWidth={2} />}
              </button>
            </li>
          );
        })}
      </ul>

      {history.length > 0 && (
        <div className="ext-view-more-wrap">
          <a
            href="https://www.tryhomescope.com/account"
            target="_blank"
            rel="noopener noreferrer"
            className="ext-view-more"
          >
            View more <ExternalLink size={12} />
          </a>
        </div>
      )}
    </section>
  );
}
