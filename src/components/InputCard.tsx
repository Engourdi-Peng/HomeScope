import type { AnalysisStage, Photo, OptionalDetails as OptionalDetailsType } from '../types';
import { DescriptionInput } from './DescriptionInput';
import { OptionalDetails } from './OptionalDetails';
import { ArrowRight, Check, Circle, Loader2, Sparkles } from 'lucide-react';

interface InputCardProps {
  photos: Photo[];
  onPhotosChange: (photos: Photo[]) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  optionalDetails: OptionalDetailsType;
  onOptionalDetailsChange: (value: OptionalDetailsType) => void;
  onSubmit: () => void;
  isLoading: boolean;
  isComplete?: boolean;
  activeStage?: AnalysisStage | null;
  analyzingCount?: number;
  detectedRooms?: string[];
  progressPct?: number;
  progressLabel?: string;
  creditsRemaining?: number;
  isAuthenticated?: boolean;
}

const LOADING_STAGES: { key: AnalysisStage; label: string }[] = [
  { key: 'upload_received', label: 'Upload received' },
  { key: 'detecting_rooms', label: 'Detecting rooms' },
  { key: 'evaluating_spaces', label: 'Evaluating spaces' },
  { key: 'extracting_strengths_and_issues', label: 'Identifying strengths and issues' },
  { key: 'estimating_competition', label: 'Estimating competition' },
  { key: 'building_final_report', label: 'Preparing final report' },
];

function StageRow({
  stage,
  activeStage,
}: {
  stage: (typeof LOADING_STAGES)[number];
  activeStage: AnalysisStage | null | undefined;
}) {
  const activeIndex = LOADING_STAGES.findIndex((s) => s.key === activeStage);
  const rowIndex = LOADING_STAGES.findIndex((s) => s.key === stage.key);

  const isActive = activeStage === stage.key;
  const isComplete = activeIndex !== -1 && rowIndex !== -1 && rowIndex < activeIndex;

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2 transition-colors ${
        isActive
          ? 'bg-white/80 backdrop-blur text-stone-900 border border-stone-200 shadow-sm'
          : isComplete
            ? 'text-green-700'
            : 'text-stone-500'
      }`}
    >
      {isComplete ? (
        <Check size={14} className="shrink-0" />
      ) : isActive ? (
        <Loader2 size={14} className="animate-spin shrink-0" />
      ) : (
        <Circle size={14} className="shrink-0" />
      )}
      <span className="text-xs font-medium">{stage.label}</span>
    </div>
  );
}

export function InputCard({
  photos,
  onPhotosChange,
  description,
  onDescriptionChange,
  optionalDetails,
  onOptionalDetailsChange,
  onSubmit,
  isLoading,
  isComplete,
  activeStage,
  analyzingCount,
  detectedRooms,
  progressPct,
  progressLabel,
  creditsRemaining = 0,
  isAuthenticated = false,
}: InputCardProps) {
  const isDisabled = photos.length === 0 && description.trim() === '';

  return (
    <div className="w-full">
      {/* Single column - Listing Narrative with photo support */}
      <div className="mb-8">
        <DescriptionInput
          value={description}
          onChange={onDescriptionChange}
          photos={photos}
          onPhotosChange={onPhotosChange}
        />
      </div>

      {/* Separator line */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-stone-200 to-transparent my-8 opacity-60"></div>

      {/* Optional Details Toggle */}
      <OptionalDetails 
        value={optionalDetails} 
        onChange={onOptionalDetailsChange} 
      />

      {/* Loading Progress (stage-based) */}
      {isLoading && (
        <div className="mt-10 p-5 bg-white/60 backdrop-blur rounded-2xl border border-stone-200 shadow-[0_8px_30px_rgba(0,0,0,0.06)] animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
          <div className="flex items-start gap-3 text-stone-700">
            {isComplete ? (
              <Sparkles size={18} className="mt-0.5 shrink-0 text-amber-500 animate-pulse" />
            ) : (
              <Loader2 size={18} className="animate-spin mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {isComplete ? 'Analysis complete' : 'Analyzing your property listing'}
              </div>
              {!isComplete && (
                <div className="text-xs text-stone-500 mt-0.5 space-y-0.5">
                  {progressLabel && <div>{progressLabel}</div>}
                  <div>
                    Analyzing {typeof analyzingCount === 'number' ? analyzingCount : 0} screenshots
                  </div>
                  {detectedRooms !== undefined && (
                    <div>
                      Detected rooms:{' '}
                      {detectedRooms && detectedRooms.length > 0 ? detectedRooms.join(', ') : 'Detecting…'}
                    </div>
                  )}
                </div>
              )}
              {isComplete && (
                <div className="text-xs text-stone-500 mt-0.5">
                  Generating your report…
                </div>
              )}
            </div>
          </div>

          {!isComplete && typeof progressPct === 'number' && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium uppercase tracking-widest text-stone-500">Progress</span>
                <span className="text-[10px] font-medium uppercase tracking-widest text-stone-500">
                  {Math.max(0, Math.min(100, Math.round(progressPct)))}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-stone-900 transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                />
              </div>
            </div>
          )}

          {!isComplete && (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {LOADING_STAGES.map((stage) => (
                <StageRow key={stage.key} stage={stage} activeStage={activeStage} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate Button */}
      <div className="flex flex-col items-center mt-8">
        <button
          onClick={onSubmit}
          disabled={isDisabled || isLoading}
          className={`
            group relative inline-flex items-center justify-center gap-3 px-10 py-4 
            rounded-full transition-all duration-300 shadow-[0_8px_30px_rgba(28,25,23,0.15)] 
            hover:shadow-[0_8px_30px_rgba(28,25,23,0.25)] hover:-translate-y-0.5
            ${isDisabled || isLoading
              ? 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none hover:shadow-none hover:translate-y-0'
              : 'bg-stone-900 hover:bg-stone-800 text-white'
            }
          `}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              <span className="font-medium tracking-widest uppercase text-[11px]">Analyzing Property...</span>
            </span>
          ) : (
            <>
              <span className="font-medium tracking-widest uppercase text-[11px]">Analyze Listing</span>
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" strokeWidth={2} />
            </>
          )}
        </button>
        
        {/* Credits remaining display */}
        {isAuthenticated && !isLoading && (
          <div className="mt-3 text-xs text-stone-500">
            {creditsRemaining > 0 ? (
              <>You have {creditsRemaining} free analyses left</>
            ) : (
              <span className="text-red-500 font-medium">Free analyses used</span>
            )}
          </div>
        )}
        {!isAuthenticated && !isLoading && (
          <div className="mt-3 text-xs text-stone-500">
            Sign in to analyze listings
          </div>
        )}
      </div>
    </div>
  );
}
