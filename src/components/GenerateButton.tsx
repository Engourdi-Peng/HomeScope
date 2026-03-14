import { Loader2, ArrowRight } from 'lucide-react';

interface GenerateButtonProps {
  onClick: () => void;
  isLoading: boolean;
  disabled: boolean;
}

export function GenerateButton({ onClick, isLoading, disabled }: GenerateButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`
        group relative inline-flex items-center justify-center gap-3 px-10 py-4 
        transition-all duration-300 shadow-[0_8px_30px_rgba(28,25,23,0.15)] 
        hover:shadow-[0_8px_30px_rgba(28,25,23,0.25)] hover:-translate-y-0.5
        ${disabled || isLoading
          ? 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none hover:shadow-none hover:translate-y-0'
          : 'bg-stone-900 hover:bg-stone-800 text-white'
        }
      `}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="font-medium tracking-widest uppercase text-[11px]">Analyzing Property...</span>
        </span>
      ) : (
        <>
          <span className="font-medium tracking-widest uppercase text-[11px]">Analyze Listing</span>
          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" strokeWidth={2} />
        </>
      )}
    </button>
  );
}
