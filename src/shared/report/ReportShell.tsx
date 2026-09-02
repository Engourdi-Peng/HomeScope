/**
 * ReportShell
 *
 * Shared page shell for the result/report view.
 * Responsible for: background, container width, padding, font baseline.
 *
 * Platform differences (minimal, only what's necessary):
 * - web: full-page layout with background decoration, min-h-screen, centered
 * - extension: panel container, h-full, panel-scroll
 *
 * Visual tokens (background, font, padding, container max-width) are
 * IDENTICAL between web and extension so the report content renders the
 * same way in both surfaces. Only width / scroll behavior adapt to the
 * narrower sidepanel.
 */
import React from 'react';

type ReportShellProps = {
  mode: 'web' | 'extension';
  children: React.ReactNode;
};

const SHARED_CLASSES =
  'text-stone-800 font-sans relative flex flex-col items-center selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden';

const SHARED_INNER_CLASSES = 'relative z-10 w-full max-w-[1200px]';

export function ReportShell({ mode, children }: ReportShellProps) {
  if (mode === 'web') {
    return (
      <div
        className={`min-h-screen py-12 px-4 sm:px-6 lg:px-8 ${SHARED_CLASSES}`}
        style={{ backgroundColor: '#FDFCF9' }}
      >
        <div className={SHARED_INNER_CLASSES}>{children}</div>
      </div>
    );
  }

  // extension: panel container — same visual tokens as web; only the
  // container is sized for the sidepanel. No fixed decoration background.
  return (
    <div
      className={`min-h-screen py-4 px-4 sm:px-6 lg:px-8 ${SHARED_CLASSES}`}
      style={{ backgroundColor: '#FDFCF9' }}
    >
      <div className={SHARED_INNER_CLASSES}>{children}</div>
    </div>
  );
}
