import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface ListingAnalysisSectionProps {
  className?: string;
}

export function ListingAnalysisSection({ className = '' }: ListingAnalysisSectionProps) {
  const analysisPoints = [
    'Signs of cheap cosmetic renovation',
    'Lighting and angles hide actual space size',
    'Potential wear and aging materials',
    'Likely overpriced for its actual condition',
  ];

  return (
    <div className={`mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out ${className}`}>
      {/* 标题区域 */}
      <div className="text-center mb-8">
        <h2 className="text-[48px] font-medium text-stone-900 leading-[1] mb-4">
          Don't Trust Listing Photos
        </h2>
        <p className="text-2xl text-stone-800 leading-[1.3]">
          Most rental problems only show up after you visit — or worse, after you move in.
        </p>
      </div>

      {/* 内容区域 - 左右两栏 */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* 左侧 - 房源展示 */}
        <div className="flex-1 bg-white rounded-2xl p-8 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)]">
          <p className="text-xs text-stone-500 uppercase tracking-[0.3px] mb-4">
            Looks clean, modern, and "ready to move in"
          </p>
          
          {/* 房源照片 */}
          <div className="w-full h-[290px] rounded-[10px] mb-4 overflow-hidden bg-stone-100">
            <img
              src="/listing-photo-example.png"
              alt="Listing photo - modern interior"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-stone-500" />
            <span className="text-sm text-stone-600">Looks modern and well-maintained</span>
          </div>
        </div>

        {/* 右侧 - HomeScope 分析 */}
        <div className="flex-1 bg-white/60 rounded-2xl border border-stone-200/50 p-8">
          <p className="text-xs text-stone-600 uppercase tracking-[0.3px] mb-6">
            HomeScope Analysis
          </p>

          {/* 分析要点列表 */}
          <div className="flex flex-col gap-4 mb-8">
            {analysisPoints.map((point, index) => (
              <div key={index} className="flex items-center gap-3">
                <AlertCircle size={20} className="text-orange-700 shrink-0" />
                <span className="text-sm text-stone-800">{point}</span>
              </div>
            ))}
          </div>

          {/* 评分区域 */}
          <div className="border-t border-stone-200 pt-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-stone-500 mb-1">Deal Score</p>
              <p className="text-2xl font-semibold text-stone-900">
                78 <span className="text-base font-normal text-stone-400">/ 100</span>
              </p>
            </div>
            <div className="bg-[#ffedd4] px-3 py-1.5 rounded-full">
              <span className="text-xs font-medium text-[#ca3500]">Caution</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
