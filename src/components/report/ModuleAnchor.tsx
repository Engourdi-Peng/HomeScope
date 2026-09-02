/**
 * ModuleAnchor — Phase A scaffolding component
 *
 * Renders a strong visual anchor at the start of each report module so users
 * can locate sections at a glance. Currently used as a "label chip" with
 * 3px teal left accent + numbered chip + uppercase label + progress text.
 *
 * Phase B (next iteration) will:
 *   - Read `isActive` from a useScrollSpy hook driven by IntersectionObserver
 *   - Toggle the `.report-module-anchor--active` class on the root
 *   - Wire smooth-scroll on click for in-page jumps
 *
 * Currently a pure presentational component — safe to use in any context.
 */
import * as React from 'react';

export interface ModuleAnchorProps {
  /** 1-based section number (e.g. 1, 2, 3). When omitted, no chip is rendered. */
  index?: number;
  /** Total number of modules in this report. Required when `index` is provided. */
  total?: number;
  /** Uppercase label that names the module (e.g. "Location", "Risk Categories"). */
  label: string;
  /** Optional override for the active state. Default `false`. Phase B will drive this. */
  isActive?: boolean;
  /** Optional className passthrough. */
  className?: string;
  /** Optional id for in-page anchors. */
  id?: string;
}

export function ModuleAnchor({
  index,
  total,
  label,
  isActive = false,
  className = '',
  id,
}: ModuleAnchorProps): React.ReactElement {
  const showProgress = typeof index === 'number' && typeof total === 'number' && total > 0;
  const formattedIndex =
    typeof index === 'number' ? String(index).padStart(2, '0') : null;
  const formattedTotal =
    typeof total === 'number' ? String(total).padStart(2, '0') : null;

  const rootClassName = [
    'report-module-anchor',
    isActive ? 'report-module-anchor--active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <header className={rootClassName} id={id}>
      {formattedIndex !== null && (
        <span
          className="report-module-anchor__index"
          aria-label={`Module ${index}${formattedTotal ? ` of ${total}` : ''}`}
        >
          {formattedIndex}
        </span>
      )}
      <span className="report-module-anchor__label">{label}</span>
      {showProgress && (
        <span className="report-module-anchor__progress" aria-hidden="true">
          {formattedIndex}/{formattedTotal}
        </span>
      )}
    </header>
  );
}

export default ModuleAnchor;
