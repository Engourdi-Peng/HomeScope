import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserMenu } from '../components/UserMenu';
import { LoginModal } from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';

// Hook to set page SEO meta tags
function usePageSEO(title: string, description: string) {
  useState(() => {
    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', description);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', description);
  });
}

export function RealEstateToolsPage() {
  const { isAuthenticated } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Set page SEO
  usePageSEO(
    'realestate.com.au Rental Analysis Tool | HomeScope',
    'AI-powered analysis for realestate.com.au listings. Upload screenshots, get instant insights on space quality, hidden risks, competition level and inspection checklist – built for Australian renters.'
  );

  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-16 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0 opacity-[0.04] mix-blend-multiply pointer-events-none overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1560518883-ce09059eeffa?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxMXx8aG91c2luZyUyMHByb3BlcnR5JTIwYXVzdHJhbGlhJTIwcmVudWFsJTIwY29tcGxlfGVufDF8fGZ8MTc3NDExMzQ2OHww&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Australian property"
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[1200px]">
        {/* Top Navigation */}
        <div className="flex justify-between items-center mb-12">
          {/* Logo */}
          <Link to="/" className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="180" height="30" viewBox="0 0 254.145 41.04">
              <g id="group_1" data-name="Group 1" transform="translate(-81.15 -88.79)">
                <path id="path_2" data-name="Path 2" d="M128.43,1.62q-5.76,0-8.685-2.925A10.642,10.642,0,0,1,116.82-9.18h6.39a4.362,4.362,0,0,0,1.215,3.262,5.361,5.361,0,0,0,3.87,1.193,9.1,9.1,0,0,0,4.23-.832A3.1,3.1,0,0,0,134.01-8.73a2.489,2.489,0,0,0-1.417-2.07,33.064,33.064,0,0,0-4.342-1.98,41.918,41.918,0,0,1-5.333-2.317,11.549,11.549,0,0,1-3.668-3.1,7.615,7.615,0,0,1-1.53-4.838,9.444,9.444,0,0,1,3.06-7.47,12,12,0,0,1,8.235-2.7,12.951,12.951,0,0,1,6.03,1.328,9.553,9.553,0,0,1,3.915,3.578,9.36,9.36,0,0,1,1.35,4.9h-6.57a2.9,2.9,0,0,0-1.283-2.52,5.888,5.888,0,0,0-3.442-.9,6.653,6.653,0,0,0-3.488.878A3.058,3.058,0,0,0,124.2-22.86a2.568,2.568,0,0,0,1.462,1.98,36.236,36.236,0,0,0,4.342,2.025,59.009,59.009,0,0,1,5.378,2.475,11.824,11.824,0,0,1,3.645,3.06A7.311,7.311,0,0,1,140.58-8.6,10.017,10.017,0,0,1,137.7-1.35Q134.82,1.62,128.43,1.62Zm27.315,0q-5.13,0-7.9-3.285t-2.768-9.5q0-6.3,2.857-9.742a9.808,9.808,0,0,1,7.988-3.443q4.95,0,7.447,2.272t2.768,6.908h-6.255a3.5,3.5,0,0,0-1.058-2.34,4.231,4.231,0,0,0-2.812-.765q-4.5,0-4.5,6.435,0,3.915,1.035,5.648t3.87,1.732a3,3,0,0,0,2.565-.922,5.571,5.571,0,0,0,.9-2.543h6.255q-.405,4.725-2.812,7.133T155.745,1.62Zm25.83.315a10.253,10.253,0,0,1-5.8-1.643,10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93,16.409,16.409,0,0,1,1.372-6.907,10.967,10.967,0,0,1,3.848-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71,10.652,10.652,0,0,1,3.757,4.725,17.2,17.2,0,0,1,1.283,6.795q0,6.21-2.835,9.72A9.761,9.761,0,0,1,181.575,1.935Zm0-6.3a3.8,3.8,0,0,0,3.42-1.845,9.451,9.451,0,0,0,1.17-5.085,9.4,9.4,0,0,0-1.192-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.238,5.018A3.851,3.851,0,0,0,181.575-4.365Zm27.4-20.07A9.925,9.925,0,0,1,214.29-23a9.913,9.913,0,0,1,3.69,4.163,14.5,14.5,0,0,1,1.35,6.5,14.726,14.726,0,0,1-1.373,6.57,10.237,10.237,0,0,1-3.735,4.275A9.652,9.652,0,0,1,208.98,0a8.452,8.452,0,0,1-4.59-1.215V7.83h-6.525V-24.39h6.525V-23A7.473,7.473,0,0,1,208.98-24.435Zm-.18,18.5a3.71,3.71,0,0,0,3.195-1.778,8.015,8.015,0,0,0,1.215-4.613,8.209,8.209,0,0,0-1.08-4.477A3.676,3.676,0,0,0,208.8-18.5a3.5,3.5,0,0,0-3.173,1.688,8.347,8.347,0,0,0-1.058,4.477A8.91,8.91,0,0,0,205.628-7.7A3.465,3.465,0,0,0,208.8-5.94Zm21.51-3.24a6.475,6.475,0,0,0,1.485,3.78,3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q223.83-5.04,223.83-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.783-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(90 122)" fill="#1c1917"/>
                <path id="path_3" data-name="Path 3" d="M18.63-19.8V-32.76h6.525V1.62H18.63V-13.725H9.675V1.62H3.15V-32.76H9.675V-19.8ZM41.49,1.935A10.254,10.254,0,0,1,35.685.293a10.5,10.5,0,0,1-3.8-4.658,17.049,17.049,0,0,1-1.327-6.93A16.409,16.409,0,0,1,31.928-18.2a10.967,10.967,0,0,1,3.847-4.658,10,10,0,0,1,5.715-1.665,10.035,10.035,0,0,1,5.85,1.71A10.652,10.652,0,0,1,51.1-18.09,17.2,17.2,0,0,1,52.38-11.3q0,6.21-2.835,9.72A9.761,9.761,0,0,1,41.49,1.935Zm0-6.3A3.8,3.8,0,0,0,44.91-6.21,9.451,9.451,0,0,0,46.08-11.3a9.4,9.4,0,0,0-1.193-4.995,3.775,3.775,0,0,0-3.4-1.935,3.867,3.867,0,0,0-3.375,1.913,8.979,8.979,0,0,0-1.26,5.017,9.106,9.106,0,0,0,1.237,5.018A3.851,3.851,0,0,0,41.49-4.365ZM106.335-9.18A6.475,6.475,0,0,0,107.82-5.4a3.946,3.946,0,0,0,2.97,1.215q3.51,0,3.96-2.79h6.525q-1.665,8.91-10.485,8.91a9.9,9.9,0,0,1-8.01-3.488Q99.855-5.04,99.855-11.3a17.121,17.121,0,0,1,1.35-7.088,10.277,10.277,0,0,1,3.8-4.568,10.467,10.467,0,0,1,5.782-1.575q5.355,0,7.943,3.623t2.587,9.742q0,1.305-.045,1.98Zm8.37-5.4a5.993,5.993,0,0,0-1.327-2.88,3.363,3.363,0,0,0-2.588-.99q-3.33,0-4.23,3.87Z" transform="translate(78 122)" fill="#707070"/>
                <path id="path_1" data-name="Path 1" d="M898.351-97.643V-71.05h9.227V-89.8l4.956,4.956V-71.05h9.289V-89.8l4.956,4.956V-71.05H936.1V-89.8l-8.043-7.848-7.442,6.5-6.486-6.5-6.547,5.4v-5.4Z" transform="translate(-763.436 194.985)" fill="#e17100"/>
              </g>
            </svg>
          </Link>

          <UserMenu onLoginClick={() => setIsLoginModalOpen(true)} />
        </div>

        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-[44px] font-light tracking-[-0.5px] text-[#1c1917] leading-[1.15] mb-4">
            Best AI Tool for realestate.com.au Listings in Australia
          </h1>
          <p className="text-[18px] text-[#57534e] max-w-2xl mx-auto leading-relaxed font-light mb-4">
            Analyze properties directly from realestate.com.au screenshots
          </p>
          <p className="text-xs text-stone-500 text-center italic max-w-xl mx-auto">
            This is an independent third-party AI tool. Not affiliated with, endorsed by, or connected to realestate.com.au or REA Group. All analysis is for informational purposes only.
          </p>
        </div>

        {/* Features Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-5xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 text-center">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-stone-900 mb-2">Space Quality Analysis</h3>
            <p className="text-sm text-stone-500">Get AI insights on room sizes, natural light, and overall property presentation from listing photos.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 text-center">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-stone-900 mb-2">Hidden Risks Detection</h3>
            <p className="text-sm text-stone-500">Identify staging signs, maintenance issues, and red flags before you attend the inspection.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 text-center">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-stone-900 mb-2">Inspection Checklist</h3>
            <p className="text-sm text-stone-500">Receive a tailored checklist of questions to ask the agent at the inspection.</p>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] p-8 md:p-10 mb-12 max-w-4xl mx-auto">
          <h2 className="text-center text-[22px] md:text-[24px] font-semibold text-[#292524] mb-8">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center mx-auto mb-4 text-lg font-semibold">1</div>
              <h3 className="text-base font-semibold text-[#292524] mb-2">Upload Screenshots</h3>
              <p className="text-sm text-[#78716c]">Take screenshots from a realestate.com.au listing and upload them.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center mx-auto mb-4 text-lg font-semibold">2</div>
              <h3 className="text-base font-semibold text-[#292524] mb-2">AI Analysis</h3>
              <p className="text-sm text-[#78716c]">Our AI analyses the listing photos and description for risks and quality.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center mx-auto mb-4 text-lg font-semibold">3</div>
              <h3 className="text-base font-semibold text-[#292524] mb-2">Get Your Report</h3>
              <p className="text-sm text-[#78716c]">Receive a detailed report with pros, cons, risks and a final verdict.</p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center mb-12">
          <Link
            to="/"
            className="inline-flex items-center justify-center px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-full transition-colors"
          >
            Try It Now – It's Free to Start
          </Link>
          <p className="text-xs text-stone-400 mt-4">
            3 free reports with Starter plan from AU$6.99
          </p>
        </div>

        {/* Footer Disclaimer */}
        <div className="text-center pt-8 pb-4 border-t border-[rgba(231,229,228,0.8)]">
          <p className="text-xs text-stone-500 mb-3 italic max-w-xl mx-auto">
            This is an independent third-party AI tool. Not affiliated with, endorsed by, or connected to realestate.com.au or REA Group. All analysis is for informational purposes only.
          </p>
          <div className="flex justify-center gap-6 mb-3">
            <Link to="/privacy" className="text-[13px] text-[#a8a29e] hover:text-[#57534e] transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-[13px] text-[#a8a29e] hover:text-[#57534e] transition-colors">
              Terms of Service
            </Link>
          </div>
          <p className="text-[13px] text-[#a8a29e] font-medium">AI Rental Decision Assistant</p>
        </div>

        <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
      </div>
    </div>
  );
}
