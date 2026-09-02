import { useState } from 'react';
import { Sparkles, Camera, FileText, LayoutGrid, AlertTriangle, TrendingUp, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { FAQItem } from '../components/FAQItem';
import { PricingCard } from '../components/PricingCard';
import { ListingAnalysisSection } from '../components/ListingAnalysisSection';
import { ExtensionPromo } from '../components/ExtensionPromo';
import { PurchaseModal } from '../components/PurchaseModal';
import { SiteLayout } from '../components/SiteLayout';
import { useAuth } from '../contexts/AuthContext';
import * as Accordion from '@radix-ui/react-accordion';

// 产品配置
const PRODUCTS = [
  {
    id: 'starter',
    title: 'Starter',
    price: '$6.99',
    reportCount: 5,
    description: 'Best for checking a few serious options before you spend time on a showing.',
    features: [
      'Full listing risk review',
      'Photo & condition review',
      'Price confidence & hidden-cost signals',
      'Questions to ask before you tour',
    ],
    buttonText: 'Get 5 Reports',
    isPopular: false,
  },
  {
    id: 'standard',
    title: 'Standard',
    price: '$15.99',
    reportCount: 12,
    description: 'Best for comparing homes and narrowing down your shortlist.',
    features: [
      'Complete Full Property Report for every listing',
      'Compare up to 12 properties',
      'Save reports for later review',
      'Shareable report links',
    ],
    buttonText: 'Get 12 Reports',
    isPopular: true,
  },
  {
    id: 'pro',
    title: 'Pro',
    price: '$39.99',
    reportCount: 35,
    description: 'Best for active buyers reviewing listings throughout a serious home search.',
    features: [
      'Complete Full Property Report for every listing',
      'Compare up to 35 properties',
      'Lowest cost per report',
      'Save and share every report',
    ],
    buttonText: 'Get 35 Reports',
    isPopular: false,
  },
];

export function Home() {
  const { isAuthenticated } = useAuth();
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<typeof PRODUCTS[0] | null>(null);

  const previewImages = [
    '/report-preview-1.png',
    '/report-preview-2.png',
    '/report-preview-3.png',
  ];

  const nextPreview = () => setPreviewIndex((prev) => (prev + 1) % previewImages.length);
  const prevPreview = () => setPreviewIndex((prev) => (prev - 1 + previewImages.length) % previewImages.length);

  // 未登录用户请通过顶栏 UserMenu 登录（SiteLayout 管理的 LoginModal）。
  const requireAuthOrSkip = (): boolean => isAuthenticated;

  const handleSelectProduct = (productId: string) => {
    // 1. 检查登录状态
    if (!requireAuthOrSkip()) {
      return;
    }

    // 2. 打开购买确认 modal
    const product = PRODUCTS.find(p => p.id === productId);
    if (product) {
      setSelectedProduct(product);
    }
  };

  const handlePurchaseModalClose = () => {
    setSelectedProduct(null);
  };

  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHptaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080" 
          alt="Modern architecture" 
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale" 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <SiteLayout>

        {/* 1. Hero */}
        <div className="text-center mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <h1 className="text-3xl md:text-4xl font-light tracking-tight text-stone-900 leading-[1.15] mb-4">
            Know What to Check Before You Tour.
          </h1>
          <p className="text-lg md:text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed font-light mb-2">
            HomeScope turns Zillow listings into buyer-focused risk reports — price signals, photo observations, carrying costs, and questions to ask the agent.
          </p>
          <p className="text-sm text-stone-500 max-w-lg mx-auto">
            Run a free Basic Check first. Unlock a Full Report when a property is worth a closer look.
          </p>
          <p className="text-xs text-stone-500 text-center mt-4 italic max-w-lg mx-auto">
            HomeScope is an independent AI tool. Not affiliated with Zillow, StreetEasy, or any real estate marketplace. Reports are for informational purposes only and are not home inspections, appraisals, legal advice, or financial advice.
          </p>
        </div>

        {/* Extension Promo */}
        <ExtensionPromo />

        {/* 2. Upload Tool - First Screen (已移除：仅支持浏览器扩展分析) */}
        {/* 3. Don't Trust Listing Photos - Analysis Section */}
        <ListingAnalysisSection />

        {/* 3. How It Works */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '200ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Camera size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">1. Open a Supported Listing</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                Open a Zillow property page or paste listing details into HomeScope. Add screenshots if you want extra photo context.
              </p>
            </div>
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <Sparkles size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">2. Run a Basic Check or Full Report</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                Start with a free Basic Check. Unlock a Full Report for deeper photo review, price confidence, carrying costs, and risk analysis.
              </p>
            </div>
            <div className="text-center p-6 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-stone-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900 mb-2">3. Review Your Buyer Report</h3>
              <p className="text-sm text-stone-500 leading-relaxed">
                See the score, key risks, missing information, and questions to ask before viewing or making an offer.
              </p>
            </div>
          </div>
        </div>

        {/* 4. What You Get */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '300ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-8">What You Get</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <LayoutGrid size={24} className="text-green-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Property Risk Score</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  A clear score that summarizes listing strength, risk level, and how much still needs verification.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Detect Hidden Listing Risks</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Spot missing information, weak evidence, dated systems, legal-use concerns, or exaggerated listing claims.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <TrendingUp size={24} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Price Confidence Check</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Understand whether the asking price needs comps, condition checks, or stronger evidence before you trust it.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-5 bg-white/60 rounded-2xl border border-stone-200/50">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <CheckCircle size={24} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-900 mb-1">Should You View It?</h3>
                <p className="text-sm text-stone-500 leading-relaxed">
                  Get a practical next step: keep it on your shortlist, ask more questions, or skip the showing.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Report Preview - 报告预览模块 */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '350ms' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
              {/* 左侧：轮播图片 */}
              <div className="relative p-6 md:p-8">
                <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)]">
                  <img 
                    src={previewImages[previewIndex]} 
                    alt="Report preview" 
                    className="w-full h-full object-contain"
                  />
                  {/* 左右箭头 */}
                  <button 
                    onClick={prevPreview}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                    aria-label="Previous"
                  >
                    <ChevronLeft size={20} className="text-stone-700" />
                  </button>
                  <button 
                    onClick={nextPreview}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                    aria-label="Next"
                  >
                    <ChevronRight size={20} className="text-stone-700" />
                  </button>
                </div>
                {/* 底部圆点指示器 */}
                <div className="flex justify-center gap-2 mt-4">
                  {previewImages.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setPreviewIndex(idx)}
                      className={`w-2.5 h-2.5 rounded-full transition-colors ${
                        idx === previewIndex ? 'bg-amber-500' : 'bg-stone-300'
                      }`}
                      aria-label={`Go to slide ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* 右侧：文案 */}
              <div className="p-6 md:p-10 flex flex-col justify-center">
                <h3 className="text-2xl font-semibold text-stone-900 mb-4">
                  See What You'll Get
                </h3>
                <p className="text-base text-stone-600 leading-relaxed mb-6">
                  A structured buyer report with scores, risks, photo insights, carrying costs, and agent questions.
                </p>
                <button
                  onClick={() => {
                    if (requireAuthOrSkip()) {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-stone-900 hover:bg-stone-800 text-white font-semibold px-6 py-3 transition-colors w-fit"
                >
                  Get 3 Free Full Reports
                </button>
              </div>
            </div>
        </div>

        {/* 4. Pricing */}
        <div className="mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <div className="text-center mb-10">
            <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-stone-500 mb-4">
              Spot Costly Risks Before You Fall for a Listing
            </h2>
            <p className="text-center text-stone-600 font-light mb-3 max-w-2xl mx-auto">
              Get an independent second look at listing details, photo signals, price confidence, and missing information before you book a showing.
            </p>
            <p className="text-center text-stone-700 text-sm font-medium mb-6 max-w-xl mx-auto">
              HomeScope doesn’t sell homes or earn a commission from the sale.
            </p>
            <p className="text-center text-stone-700 text-sm font-medium mb-8 max-w-xl mx-auto">
              Every plan includes the same complete Full Property Report. You're only choosing how many properties to review.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl mx-auto">
            {PRODUCTS.map((product) => (
              <PricingCard
                key={product.id}
                title={product.title}
                price={product.price}
                reportCount={product.reportCount}
                description={product.description}
                features={product.features}
                buttonText={product.buttonText}
                isPopular={product.isPopular}
                onBuy={handleSelectProduct}
                productId={product.id}
              />
            ))}
          </div>
        </div>

        {/* 5. FAQ */}
        <div className="mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out" style={{ animationDelay: '400ms' }}>
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[#a8a29e] mb-8">FAQ</h2>
          <Accordion.Root type="single" collapsible className="bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] px-6 max-w-5xl mx-auto">
            <FAQItem 
              value="analyze-listings"
              question="Can AI analyze Zillow property listings?"
              answer="Yes. HomeScope can analyze supported property listings and extract key details such as price, beds, baths, square footage, year built, taxes, monthly payment estimates, listing claims, and available photos. It then turns those details into a buyer-focused risk report."
            />
            <FAQItem 
              value="evaluate-property"
              question="How should I evaluate a home before booking a showing?"
              answer="Before booking a showing, check the asking price, comparable sales, property age, roof and major systems, permits, basement use, monthly carrying costs, and missing listing details. HomeScope helps organize these checks into a clear report."
            />
            <FAQItem 
              value="check-renting"
              question="What should I check before making an offer?"
              answer="Ask about roof age, HVAC, electrical, plumbing, permits, open violations, basement legality, insurance costs, taxes, and recent comparable sales. A Full Report gives you a focused question list for the agent."
            />
            <FAQItem 
              value="competition"
              question="Can HomeScope tell me if a property is overpriced?"
              answer="HomeScope can flag price concerns and explain when comparable sales are needed, but it is not an appraisal. Use the report as a pre-check before speaking with your agent, lender, inspector, or appraiser."
            />
            <FAQItem 
              value="misleading"
              question="Can AI detect misleading listing photos?"
              answer="HomeScope can point out photo-based condition signals and missing views, such as limited bathroom photos, no roof photos, unclear basement condition, older finishes, or missing mechanical-system photos. It cannot replace an in-person inspection."
            />
          </Accordion.Root>
        </div>

        {/* Final CTA Section */}
        <div className="mb-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
          <div className="bg-stone-900 rounded-2xl text-center px-4 py-16">
            <h2 className="text-2xl md:text-3xl font-light text-white mb-4">
              Start with a free Basic Check.
            </h2>
            <p className="text-base text-stone-300 mb-8 max-w-md mx-auto">
              No credit card. 3 free analyses. Get a clearer read before you book a showing.
            </p>
            <button
              onClick={() => {
                if (requireAuthOrSkip()) {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              className="inline-flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-stone-900 font-medium px-8 py-4 rounded-full transition-colors text-base"
            >
              Get 3 Free Reports
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 购买确认弹窗 */}
        <PurchaseModal
          isOpen={!!selectedProduct}
          onClose={handlePurchaseModalClose}
          product={selectedProduct}
        />
      </SiteLayout>
    </div>
  );
}
