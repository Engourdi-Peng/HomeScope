import { useState, useEffect } from 'react';
import { Zap, Shield, MapPin, ChevronLeft, Share2 } from 'lucide-react';

const CHROME_WEBSTORE_URL = 'https://chromewebstore.google.com/detail/homescope/cajiemkghnjbidpmgfppebamgjhamjoi';

function ChromeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="white" />
      <circle cx="24" cy="24" r="22" stroke="#dadce0" strokeWidth="1.5" />
      <path d="M24 10C16.268 10 10 16.268 10 24h14C24 18.485 26.5 14 31 14c-3.5 0-5.5 3-5.5 3s0 10 10 17c10-7 10-17 10-17S37 14 33.5 14C29 14 26.5 18.485 24 24V10z" fill="#4285F4" />
      <path d="M10 24c0-7.732 6.268-14 14-14v4c-3.5 0-7 3.485-7 10H10z" fill="#EA4335" />
      <path d="M24 38c7.732 0 14-6.268 14-14H33c0 3.515-2.5 8-9 8 5.5 0 9-4.485 9-10H24V38z" fill="#34A853" />
      <path d="M10 24H24v4C19.5 28 17 32.515 17 36c-6.268 0-7-8-7-12z" fill="#FBBC05" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 37.749 26.598" fill="#e4e3e1" xmlns="http://www.w3.org/2000/svg">
      <path d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-898.351 97.648)" />
    </svg>
  );
}

export function ExtensionPromo() {
  const [isChrome, setIsChrome] = useState<boolean | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isChromium = ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR');
    setIsChrome(isChromium);
  }, []);

  const handleInstall = () => {
    window.open(CHROME_WEBSTORE_URL, '_blank');
  };

  return (
    <div className="mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
      <div className="bg-gradient-to-br from-stone-50 to-amber-50 rounded-[2rem] border border-stone-200/60 p-8 md:p-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* 左侧文案 */}
          <div>
            <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <Zap size={14} />
              Browser Extension
            </div>
            <h2 className="text-2xl md:text-3xl font-semibold text-stone-900 mb-3 leading-tight">
              Smart AI Insights for Realestate.com.au
            </h2>
            <p className="text-stone-600 leading-relaxed mb-6 text-sm md:text-base">
              Get the full picture of any rental listing with one click. No more screenshots or manual digging — HomeScope does the heavy lifting for you.
            </p>
            <ul className="space-y-3 mb-6">
              {[
                { icon: Zap, text: 'One-click AI property analysis' },
                { icon: MapPin, text: 'Deep insights on location & value' },
                { icon: Shield, text: '100% Private & Secure' },
              ].map(({ icon: Icon, text }, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-stone-600">
                  <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <Icon size={13} className="text-amber-600" />
                  </div>
                  {text}
                </li>
              ))}
            </ul>

            {isChrome === false ? (
              <div className="inline-flex items-center gap-2 bg-stone-200 text-stone-500 font-medium px-5 py-3 rounded-full text-sm">
                Available on Google Chrome
              </div>
            ) : (
              <button
                onClick={handleInstall}
                className="inline-flex items-center gap-3 bg-stone-900 hover:bg-stone-800 text-white font-semibold px-7 py-3 rounded-full transition-colors shadow-sm hover:shadow-md"
              >
                <ChromeIcon size={20} />
                <span>Add to Chrome</span>
              </button>
            )}

            {/* 信任背书已移除：插件需积分购买 */}
          </div>

          {/* 右侧：真实插件 UI 模拟 */}
          <div className="hidden md:flex justify-center">
            <div className="relative">
              {/* 插件面板容器 */}
              <div className="bg-[#FDFCF9] rounded-2xl shadow-2xl border border-stone-200 w-[280px] overflow-hidden">
                {/* 顶部导航栏 */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-200 bg-[#FDFCF9]">
                  <div className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 transition-colors cursor-pointer">
                    <ChevronLeft size={13} strokeWidth={1.5} />
                    <span className="text-[11px] font-medium">Back</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 transition-colors cursor-pointer">
                    <Share2 size={13} strokeWidth={1.5} />
                    <span className="text-[11px] font-medium">Share</span>
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  {/* 房源摘要卡片 */}
                  <div className="bg-white rounded-xl p-3 border border-stone-200">
                    <div className="flex gap-2.5">
                      {/* 缩略图占位 */}
                      <div className="w-14 h-14 bg-stone-100 rounded-lg flex items-center justify-center shrink-0">
                        <HomeIcon />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-stone-800 leading-tight mb-0.5">
                          1/45 Broad St, Sydney NSW 2000
                        </div>
                        <div className="text-[11px] font-bold text-stone-900 mb-0.5">$580/wk</div>
                        <div className="text-[10px] text-stone-400">2 bed · 1 bath · 1 parking</div>
                      </div>
                    </div>
                  </div>

                  {/* 房间分析标签 */}
                  <div className="bg-white rounded-xl p-3 border border-stone-200">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2 py-0.5 bg-green-50 text-[10px] font-medium text-green-700 rounded-full border border-green-200">bathroom good</span>
                      <span className="px-2 py-0.5 bg-stone-50 text-[10px] font-medium text-stone-600 rounded-full border border-stone-200">kitchen checked</span>
                      <span className="px-2 py-0.5 bg-amber-50 text-[10px] font-medium text-amber-700 rounded-full border border-amber-200">outdoor bonus</span>
                      <span className="px-2 py-0.5 bg-stone-50 text-[10px] font-medium text-stone-600 rounded-full border border-stone-200">garage bonus</span>
                      <span className="px-2 py-0.5 bg-amber-50 text-[10px] font-medium text-amber-700 rounded-full border border-amber-200">mobility consideration</span>
                    </div>
                  </div>

                  {/* 深色分析报告区 */}
                  <div className="bg-[#282828] rounded-xl p-3 text-white">
                    {/* 评分区 */}
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-[9px] font-medium uppercase tracking-widest text-[#B3B3B3] mb-1">Overall Score</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-light tracking-tight text-white">78</span>
                          <span className="text-sm font-light text-[#B3B3B3]">/100</span>
                        </div>
                      </div>
                      <div className="px-2 py-1 bg-green-500/20 text-green-400 border border-green-500/40 rounded-full text-[9px] font-semibold uppercase tracking-wider">
                        High Priority
                      </div>
                    </div>

                    {/* Verdict */}
                    <div className="mb-2">
                      <div className="text-[9px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-1">Verdict</div>
                      <p className="text-[11px] text-white leading-snug">
                        Solid rental with genuine appeal — worth inspecting soon if the location works for you.
                      </p>
                    </div>

                    {/* Understood */}
                    <div className="pt-2 border-t border-white/10">
                      <div className="text-[9px] font-medium uppercase tracking-widest text-[#AAAAAA] mb-1">Understood</div>
                      <p className="text-[10px] text-[#D6D6D6] leading-relaxed">
                        Analysed 15 screenshots across 9 spaces: bathroom, dining, outdoor, garage, hallway, driveway, living room, bedroom & more.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 装饰光晕 */}
              <div className="absolute -inset-2 bg-gradient-to-r from-amber-100 to-amber-50 rounded-[1.5rem] opacity-40 blur-xl -z-10" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
