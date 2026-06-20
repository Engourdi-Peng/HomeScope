import { useState, useEffect } from 'react';
import { Zap, Shield, MapPin, ChevronLeft, Share2, AlertTriangle } from 'lucide-react';
import { LandingReportPreview } from './LandingReportPreview';

const CHROME_WEBSTORE_URL = 'https://chromewebstore.google.com/detail/homescope/cajiemkghnjbidpmgfppebamgjhamjoi';

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
              AI Property Risk Reports for Zillow Listings
            </h2>
            <p className="text-stone-600 leading-relaxed mb-6 text-sm md:text-base">
              Open a supported Zillow listing, click Analyze, and get a clearer picture before you book a showing. HomeScope helps surface pricing questions, photo-based condition signals, missing details, and buyer questions to ask the agent.
            </p>
            <ul className="space-y-3 mb-6">
              {[
                { icon: Zap, text: 'One-click property analysis' },
                { icon: MapPin, text: 'Price, condition, and risk signals' },
                { icon: Shield, text: 'Basic Checks are free' },
                { icon: Shield, text: 'Full Reports include photos and carrying costs' },
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
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="24" cy="24" r="22" fill="white" />
                  <circle cx="24" cy="24" r="22" stroke="#dadce0" strokeWidth="1.5" />
                  <path d="M24 10C16.268 10 10 16.268 10 24h14C24 18.485 26.5 14 31 14c-3.5 0-5.5 3-5.5 3s0 10 10 17c10-7 10-17 10-17S37 14 33.5 14C29 14 26.5 18.485 24 24V10z" fill="#4285F4" />
                  <path d="M10 24c0-7.732 6.268-14 14-14v4c-3.5 0-7 3.485-7 10H10z" fill="#EA4335" />
                  <path d="M24 38c7.732 0 14-6.268 14-14H33c0 3.515-2.5 8-9 8 5.5 0 9-4.485 9-10H24V38z" fill="#34A853" />
                  <path d="M10 24H24v4C19.5 28 17 32.515 17 36c-6.268 0-7-8-7-12z" fill="#FBBC05" />
                </svg>
                <span>Add to Chrome</span>
              </button>
            )}
          </div>

          {/* 右侧：Chrome extension side panel report preview */}
          <div className="flex md:hidden justify-center mt-8">
            <div className="w-full max-w-[322px]">
              <div className="relative">
                <div className="w-[322px] h-[560px] bg-white rounded-[24px] border border-black/5 shadow-[0_25px_80px_-12px_rgba(0,0,0,0.15)] overflow-hidden">
                  <div className="flex items-center justify-between px-4 h-[40px] border-b border-black/[0.08]">
                    <div className="flex items-center gap-1.5 text-[#7a746d]">
                      <ChevronLeft size={13} strokeWidth={1.5} />
                      <span className="text-[11px] font-medium">Back</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[#7a746d]">
                      <Share2 size={13} strokeWidth={1.5} />
                      <span className="text-[11px] font-medium">Share</span>
                    </div>
                  </div>
                  <div className="h-[calc(100%-40px)] overflow-y-auto">
                    <div className="p-[15px]">
                      <div className="bg-[#262624] rounded-[15px] p-5 text-white">
                        <h2 className="text-[15px] font-semibold leading-tight text-[#e8e8e4]">
                          46-26 217th St #1, Bayside, NY 11361
                        </h2>
                        <div className="w-full mt-4">
                          <img
                            src="/listing-photo-example.png"
                            alt="Property"
                            className="w-full aspect-[16/9] object-cover rounded-[10px]"
                          />
                        </div>
                        <div className="mt-7 flex items-baseline gap-1">
                          <span className="text-[56px] font-bold text-[#ffb800] leading-none tracking-tight">66</span>
                          <span className="text-[27px] font-light text-[#b8b8b2]">/100</span>
                        </div>
                        <div className="mt-6 flex items-center justify-center gap-2 border border-[rgba(245,180,0,0.55)] bg-[rgba(245,180,0,0.08)] text-[#f5b400] rounded-[10px] px-3 py-2.5 font-bold">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="text-[13px]">Proceed With Caution</span>
                        </div>
                        <div className="mt-4 border border-[rgba(245,180,0,0.45)] rounded-[10px] p-3.5">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#f5b400] mb-2">
                            BOTTOM LINE
                          </div>
                          <p className="text-[15px] font-semibold text-white leading-[1.4]">
                            Worth a closer look — but verify permits, roof age, and older systems first.
                          </p>
                        </div>
                        <p className="mt-5 text-[13px] text-[#d6d6d2] leading-[1.6]">
                          3-bed, 2-bath single-family home built in 1950 in Bayside. The listing shows clean interiors, an updated-looking kitchen, finished lower level, and backyard. Price per sqft is high, so confirm roof age, system updates, and permits before booking a serious viewing.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute -inset-4 bg-gradient-to-r from-amber-100 to-amber-50 rounded-[2rem] opacity-40 blur-xl -z-10" />
              </div>
            </div>
          </div>
          <div className="hidden md:flex justify-center">
            <LandingReportPreview />
          </div>
        </div>
      </div>
    </div>
  );
}
