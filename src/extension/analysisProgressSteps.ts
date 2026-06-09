/**
 * Unified analysis progress steps configuration.
 * Single source of truth for all UI components that render analysis progress.
 *
 * BASIC: free, no login, text-only extraction, no gallery/photos/images.
 * FULL:  login required, gallery + photo collection, full async analysis.
 */

export type AnalysisType = 'basic' | 'full';

export const BASIC_ANALYSIS_STEPS = [
  { key: 'preparing', label: 'Reading listing page' },
  { key: 'reading_page', label: 'Extracting key facts' },
  { key: 'analysing', label: 'Checking missing evidence' },
  { key: 'generating_report', label: 'Generating basic report' },
] as const;

export const FULL_ANALYSIS_STEPS = [
  { key: 'preparing', label: 'Reading page data' },
  { key: 'reading_page', label: 'Collecting listing data' },
  { key: 'opening_gallery', label: 'Opening gallery' },
  { key: 'collecting_photos', label: 'Collecting photos' },
  { key: 'sending_data', label: 'Sending data' },
  { key: 'analysing', label: 'Analysing property' },
  { key: 'generating_report', label: 'Generating report' },
] as const;

export function getAnalysisProgressSteps(type: AnalysisType) {
  return type === 'basic' ? BASIC_ANALYSIS_STEPS : FULL_ANALYSIS_STEPS;
}

export type StepKey = typeof BASIC_ANALYSIS_STEPS[number]['key'] | typeof FULL_ANALYSIS_STEPS[number]['key'];
