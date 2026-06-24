import { ChevronLeft, Share2, AlertTriangle } from 'lucide-react';

const PROPERTY_DATA = {
  address: '46-26 217th St #1, Bayside, NY 11361',
  score: 66,
  verdict: 'Proceed With Caution',
  bottomLine: {
    title: 'BOTTOM LINE',
    text: 'Worth a closer look — but verify permits, roof age, and older systems first.',
  },
  summary:
    '3-bed, 2-bath single-family home built in 1950 in Bayside. The listing shows clean interiors, an updated-looking kitchen, finished lower level, and backyard. Price per sqft is high, so confirm roof age, system updates, and permits before booking a serious viewing.',
  whyItMatters: [
    'Roof age and condition are not visible in photos',
    'Finished lower level may need permit and egress verification',
    'Older home systems could affect inspection, insurance, and repair costs',
  ],
};

export function LandingReportPreview() {
  return (
    <div className="relative">
      {/* 插件面板外层容器 */}
      <div className="w-[322px] h-[560px] bg-white rounded-[24px] border border-black/5 shadow-[0_25px_80px_-12px_rgba(0,0,0,0.15)] overflow-hidden">
        {/* 顶部导航栏 */}
        <div className="flex items-center justify-between px-4 h-[40px] border-b border-black/[0.08]">
          <div className="flex items-center gap-1.5 text-[#7a746d] hover:text-stone-700 transition-colors cursor-pointer">
            <ChevronLeft size={13} strokeWidth={1.5} />
            <span className="text-[11px] font-medium">Back</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#7a746d] hover:text-stone-700 transition-colors cursor-pointer">
            <Share2 size={13} strokeWidth={1.5} />
            <span className="text-[11px] font-medium">Share</span>
          </div>
        </div>

        {/* 主报告卡片区域 - 可滚动 */}
        <div className="h-[calc(100%-40px)] overflow-y-auto">
          <div className="p-[15px]">
            {/* 深色报告卡片 */}
            <div className="bg-[#262624] rounded-[15px] p-5 text-white">
              {/* A. 地址标题 */}
              <h2 className="text-[15px] font-semibold leading-tight text-[#e8e8e4]">
                {PROPERTY_DATA.address}
              </h2>

              {/* B. 房源图片 */}
              <div className="w-full mt-4">
                <img
                  src="/listing-photo-example.png"
                  alt="Property"
                  className="w-full aspect-[16/9] object-cover rounded-[10px]"
                />
              </div>

              {/* C. 分数区 */}
              <div className="mt-7 flex items-baseline gap-1">
                <span className="text-[56px] font-bold text-[#ffb800] leading-none tracking-tight">
                  {PROPERTY_DATA.score}
                </span>
                <span className="text-[27px] font-light text-[#b8b8b2]">/100</span>
              </div>

              {/* D. Verdict 按钮/徽章 */}
              <div className="mt-6">
                <div className="flex items-center justify-center gap-2 border border-[rgba(245,180,0,0.55)] bg-[rgba(245,180,0,0.08)] text-[#f5b400] rounded-[10px] px-3 py-2.5 font-bold">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span className="text-[13px]">{PROPERTY_DATA.verdict}</span>
                </div>
              </div>

              {/* E. Bottom Line 卡片 */}
              <div className="mt-4 border border-[rgba(245,180,0,0.45)] rounded-[10px] p-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#f5b400] mb-2">
                  {PROPERTY_DATA.bottomLine.title}
                </div>
                <p className="text-[15px] font-semibold text-white leading-[1.4]">
                  {PROPERTY_DATA.bottomLine.text}
                </p>
              </div>

              {/* F. Summary paragraph */}
              <p className="mt-5 text-[13px] text-[#d6d6d2] leading-[1.6]">
                {PROPERTY_DATA.summary}
              </p>

              {/* G. Why It Matters */}
              <div className="mt-6">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#aaa7a0] mb-3">
                  Why It Matters
                </div>
                <div className="space-y-3">
                  {PROPERTY_DATA.whyItMatters.map((item, index) => (
                    <div key={index} className="flex items-start gap-2.5">
                      <div className="w-1 h-1 rounded-full bg-[#f5b400] mt-[6px] shrink-0" />
                      <p className="text-[13px] text-white leading-[1.4]">
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* H. 报告模块列表 */}
              <div className="mt-6 bg-[#f5f5f3] rounded-[15px] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7a746d] mb-4">
                  BEFORE YOU BOOK A SHOWING
                </div>
                <div className="space-y-2.5">
                  {['Overall Risk Score', 'Plain-English Bottom Line', 'Price & Monthly Cost Signals',
                    'Missing Details to Verify', 'Photo & Condition Review', 'Agent Language Decoder',
                    'Deal-Changing Risks', 'Questions for the Agent', 'Best Next Step'].map((module) => (
                    <div key={module} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#d4d4d0]" />
                      <span className="text-[13px] text-[#5a5a56]">{module}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 装饰光晕 */}
      <div className="absolute -inset-4 bg-gradient-to-r from-amber-100 to-amber-50 rounded-[2rem] opacity-40 blur-xl -z-10" />
    </div>
  );
}
