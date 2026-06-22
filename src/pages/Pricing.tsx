import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PricingCard } from '../components/PricingCard';
import { FAQItem } from '../components/FAQItem';
import { UserMenu } from '../components/UserMenu';
import { LoginModal } from '../components/LoginModal';
import { PurchaseModal } from '../components/PurchaseModal';
import { useAuth } from '../contexts/AuthContext';
import * as Accordion from '@radix-ui/react-accordion';

// 产品配置
const PRODUCTS = [
  {
    id: 'starter',
    title: 'Starter',
    price: '$6.99',
    reportCount: '1 FULL PROPERTY REPORT',
    description: 'Best for checking one property before you spend time on a showing.',
    features: [
      'Full listing risk review',
      'Photo & condition review',
      'Price confidence check',
      'Questions to ask the agent',
    ],
    buttonText: 'Buy 1 Report',
    isPopular: false,
  },
  {
    id: 'standard',
    title: 'Standard',
    price: '$15.99',
    reportCount: '3 FULL PROPERTY REPORTS',
    description: 'Best for buyers reviewing a few homes on their shortlist.',
    features: [
      'Everything in Starter',
      'Lower cost per report',
      'Save reports for later review',
      'Shareable report links',
    ],
    buttonText: 'Buy 3 Reports',
    isPopular: true,
  },
  {
    id: 'pro',
    title: 'Pro',
    price: '$39.99',
    reportCount: '10 FULL PROPERTY REPORTS',
    description: 'Best for active buyers reviewing many listings during a serious home search.',
    features: [
      'Everything in Standard',
      'Lowest cost per report',
      'More reports for active searching',
      'Review more properties before you tour',
    ],
    buttonText: 'Buy 10 Reports',
    isPopular: false,
  },
];

export function PricingPage() {
  const { user, isAuthenticated } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [buyingProduct, setBuyingProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<typeof PRODUCTS[0] | null>(null);

  const handleSelectProduct = (productId: string) => {
    // 1. 检查登录状态
    if (!isAuthenticated || !user) {
      setIsLoginModalOpen(true);
      setError('Please sign in to purchase reports.');
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
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-16 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHptaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Modern architecture"
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[1200px]">
        {/* 顶部导航栏 */}
        <div className="flex justify-between items-center mb-12">
          {/* Logo */}
          <Link to="/" className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="180" height="30" viewBox="0 0 254.145 41.04">
              <g id="组_1" data-name="组 1" transform="translate(-81.15 -88.79)">
                <path id="路径_2" data-name="路径 2" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.064,33.064,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328,9.553,9.553,0,0,1,3.915,3.578,9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.009,59.009,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.372-6.907,10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71,10.652,10.652,0,0,1,3.757,4.725,17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018A3.851,3.851,0,0,0,181.575-4.365Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23A7.473,7.473,0,0,1,208.98-24.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477A3.676,3.676,0,0,0,208.8-18.5a3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7A3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
                <path id="路径_3" data-name="路径 3" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935A10.254,10.254,0,0,1,35.685.293a10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,31.928-18.2a10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09,17.2,17.2,0,0,1,52.38-11.3q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21,9.451,9.451,0,0,0,46.08-11.3a9.4,9.4,0,0,0-1.193-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018A3.851,3.851,0,0,0,41.49-4.365ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
                <path id="路径_1" data-name="路径 1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
              </g>
            </svg>
          </Link>

          {/* 右侧用户菜单 */}
          <UserMenu onLoginClick={() => setIsLoginModalOpen(true)} />
        </div>

        {/* 1. 标题区 */}
        <div className="text-center mb-16">
          <h1 className="text-[44px] font-light tracking-[-0.5px] text-[#1c1917] leading-[1.15] mb-4">
            Simple pricing
          </h1>
          <p className="text-[18px] text-[#57534e] max-w-2xl mx-auto leading-relaxed font-light">
            Pay only for the Full Reports you use.
          </p>
          <p className="text-[14px] text-[#a8a29e] max-w-lg mx-auto mt-3">
            Run a free Basic Check first. Unlock a Full Report when a property is worth a closer look.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-md mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm text-center">{error}</p>
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-16 max-w-5xl mx-auto">
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
              isLoading={buyingProduct === product.id}
            />
          ))}
        </div>

        {/* What does a report include? */}
        <div className="bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] p-8 md:p-10 mb-16 max-w-5xl mx-auto">
          <h2 className="text-center text-[22px] md:text-[24px] font-semibold text-[#292524] mb-2">
            What does a Full Report include?
          </h2>
          <p className="text-center text-[15px] text-[#78716c] font-light mb-8">
            Each Full Report analyzes the listing, available photos, and property details to help you decide what to verify before spending time on a home.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3 max-w-2xl mx-auto">
            <ul className="space-y-3 text-[14px] text-[#292524]">
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Overall property score</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Price confidence check</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Photo & space analysis</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Monthly cost breakdown</span>
              </li>
            </ul>
            <ul className="space-y-3 text-[14px] text-[#292524]">
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Potential risks and hidden issues</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Agent language decoder</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Questions to ask before viewing</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#292524] mt-1.5 shrink-0" />
                <span>Next best move for buyers</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="max-w-md mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm text-center">{error}</p>
          </div>
        )}

        {/* 3. FAQ */}
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-[#a8a29e] mb-8">
            Frequently Asked Questions
          </h2>
          <Accordion.Root type="single" collapsible className="bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] px-6">
            <FAQItem
              value="how-it-works"
              question="How does a report work?"
              answer="Open a supported property listing, click Analyze, and start with a free Basic Check. If the property looks worth a closer look, unlock a Full Report for deeper risk analysis, photo review, price confidence, carrying costs, and agent questions. Full Reports usually take 1–3 minutes to generate."
            />
            <FAQItem
              value="expiration"
              question="Do reports expire?"
              answer="Purchased report credits do not expire unless otherwise stated. Reports you generate while signed in are saved to your account so you can review them later."
            />
            <FAQItem
              value="payment"
              question="What payment methods are supported?"
              answer="We support major credit and debit cards through our secure checkout provider. Available payment methods may vary by country and device."
            />
            <FAQItem
              value="refund"
              question="Can I get a refund?"
              answer="Because Full Reports use AI processing immediately, used report credits are generally not refundable. If a report fails to generate or you were charged by mistake, contact support and we'll help."
            />
          </Accordion.Root>
        </div>

        {/* Footer */}
        <div className="text-center pt-16 pb-4 border-t border-[rgba(231,229,228,0.8)] mt-16">
          <div className="flex justify-center gap-6 mb-3">
            <Link to="/privacy" className="text-[13px] text-[#a8a29e] hover:text-[#57534e] transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-[13px] text-[#a8a29e] hover:text-[#57534e] transition-colors">
              Terms of Service
            </Link>
          </div>
          <p className="text-[13px] text-[#a8a29e] font-medium">AI Home Buying Decision Assistant</p>
        </div>

        {/* 登录弹窗 */}
        <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />

        {/* 购买确认弹窗 */}
        <PurchaseModal
          isOpen={!!selectedProduct}
          onClose={handlePurchaseModalClose}
          product={selectedProduct}
        />
      </div>
    </div>
  );
}
