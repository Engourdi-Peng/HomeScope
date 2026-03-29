/**
 * ReportShell
 *
 * Shared page shell for the result/report view.
 * Responsible for: background, container width, padding, font baseline.
 *
 * Platform differences (minimal, only what's necessary):
 * - web: full-page layout with background decoration, min-h-screen, centered
 * - extension: panel container, h-full, panel-scroll
 */
import React from 'react';

type ReportShellProps = {
  mode: 'web' | 'extension';
  children: React.ReactNode;
};

export function ReportShell({ mode, children }: ReportShellProps) {
  if (mode === 'web') {
    return (
      <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
        {/* Background decoration — matches existing web Result.tsx */}
        <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080"
            alt=""
            className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent" />
        </div>
        <div className="relative z-10 w-full max-w-[56rem]">
          {children}
        </div>
      </div>
    );
  }

  // extension: panel container — no fixed decoration background (600-720px sidepanel
  // cannot accommodate a full-bleed Unsplash photo; use clean solid background).
  // NOTE: intentionally no overflow: hidden here — .ext-app--report (App.tsx) is the
  // scroll container; ReportShell's children (NavBar sticky, ResultCard) must be
  // descendants of that scroll container, not of an intermediate overflow clip.
  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 selection:bg-stone-200 selection:text-stone-900">
      <div className="relative z-10 w-full max-w-[56rem]">
        {children}
      </div>
    </div>
  );
}
