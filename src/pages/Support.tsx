import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, FileText, Mail, ArrowLeft, ExternalLink } from 'lucide-react';

export function SupportPage() {
  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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

      <div className="relative z-10 w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link
            to="/account"
            className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 transition-colors"
          >
            <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
              <ArrowLeft size={14} strokeWidth={1.5} />
            </div>
            <span className="text-xs font-medium uppercase tracking-widest">Back to Account</span>
          </Link>
        </div>

        {/* Support Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-stone-900 mb-3">Support Center</h1>
          <p className="text-stone-600 max-w-xl mx-auto">
            Get help, find answers to common questions, and learn how to make the most of HomeScope.
          </p>
        </div>

        {/* Contact Card */}
        <div className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h2 className="text-xl font-semibold text-stone-900 mb-4">Contact Us</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <Mail size={20} className="text-blue-600" />
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Email Support</h3>
                <a
                  href="mailto:a472018670@gmail.com"
                  className="text-blue-600 hover:underline"
                >
                  a472018670@gmail.com
                </a>
                <p className="text-sm text-stone-500 mt-1">
                  We typically respond within 72 hours.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                <Shield size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Legal & Privacy</h3>
                <div className="space-y-2">
                  <Link
                    to="/privacy"
                    className="flex items-center gap-2 text-blue-600 hover:underline"
                  >
                    Privacy Policy
                    <ExternalLink size={14} />
                  </Link>
                  <Link
                    to="/terms"
                    className="flex items-center gap-2 text-blue-600 hover:underline"
                  >
                    Terms of Service
                    <ExternalLink size={14} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h2 className="text-xl font-semibold text-stone-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-b border-stone-100 pb-6 last:border-0 last:pb-0">
              <h3 className="font-medium text-stone-900 mb-2">
                Why does it take 1–3 minutes?
              </h3>
              <p className="text-stone-600">
                Our AI performs deep analysis on multiple data sources including all listing photos, property descriptions, and location data. This thorough approach ensures you get accurate, actionable insights rather than quick but superficial results.
              </p>
            </div>

            <div className="border-b border-stone-100 pb-6 last:border-0 last:pb-0">
              <h3 className="font-medium text-stone-900 mb-2">
                Why do I need to open the photo gallery?
              </h3>
              <p className="text-stone-600">
                We collect all listing images to ensure a complete and accurate analysis. Photos are essential for detecting visual issues like water stains, cracks, maintenance concerns, and property features that text alone cannot convey.
              </p>
            </div>

            <div className="border-b border-stone-100 pb-6 last:border-0 last:pb-0">
              <h3 className="font-medium text-stone-900 mb-2">
                What if analysis fails?
              </h3>
              <p className="text-stone-600">
                Please try refreshing the page or reloading the extension, then attempt the analysis again. If the issue persists, please contact us at <a href="mailto:a472018670@gmail.com" className="text-blue-600 hover:underline">a472018670@gmail.com</a> and include the property URL and any error messages you see.
              </p>
            </div>

            <div className="border-b border-stone-100 pb-6 last:border-0 last:pb-0">
              <h3 className="font-medium text-stone-900 mb-2">
                What if the report seems inaccurate?
              </h3>
              <p className="text-stone-600">
                While our AI is designed to provide reliable insights, no AI system is perfect. If you notice any obvious errors or discrepancies in the analysis, please reach out to us at <a href="mailto:a472018670@gmail.com" className="text-blue-600 hover:underline">a472018670@gmail.com</a> with the property URL and details about the issue. Your feedback helps us improve our analysis quality for everyone.
              </p>
            </div>

            <div className="border-b border-stone-100 pb-6 last:border-0 last:pb-0">
              <h3 className="font-medium text-stone-900 mb-2">
                Is this financial advice?
              </h3>
              <p className="text-stone-600">
                <strong>No.</strong> HomeScope provides AI-generated insights for informational purposes only. Our analysis is designed to help you make more informed decisions, but it should not be considered financial, legal, or investment advice. Always consult with qualified professionals before making property decisions.
              </p>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-white rounded-3xl p-8 mb-6 shadow-[0_1px_8px_rgba(0,0,0,0.06)] border border-stone-200">
          <h2 className="text-xl font-semibold text-stone-900 mb-6">How It Works</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 font-semibold text-sm">
                1
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Navigate to a rental listing</h3>
                <p className="text-stone-600">
                  Go to any property listing on Realestate.com.au.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 font-semibold text-sm">
                2
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Open the photo gallery</h3>
                <p className="text-stone-600">
                  Click on the first photo to open the full image gallery. Our extension will automatically scroll through all photos.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 font-semibold text-sm">
                3
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Click "Analyse Property"</h3>
                <p className="text-stone-600">
                  Our AI will process the listing data, photos, and location information.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 font-semibold text-sm">
                4
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Wait 1–3 minutes</h3>
                <p className="text-stone-600">
                  Our AI analyzes the property and generates your detailed report. Please keep the page open during this time.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center shrink-0 font-semibold text-sm">
                ✓
              </div>
              <div>
                <h3 className="font-medium text-stone-900 mb-1">Review your report</h3>
                <p className="text-stone-600">
                  Get a comprehensive analysis with scores, potential issues, and actionable insights.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-8 pb-4">
          <p className="text-xs text-stone-400 font-medium">
            AI Rental Decision Assistant
          </p>
        </div>
      </div>
    </div>
  );
}
