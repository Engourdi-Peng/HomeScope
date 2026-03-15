import { FileText, AlertTriangle, CheckCircle, ArrowLeft } from 'lucide-react';

export function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHptaW5pbWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080" 
          alt="Modern architecture" 
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale" 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[800px]">
        <button 
          onClick={() => window.history.back()} 
          className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900 mb-8 transition-colors"
        >
          <ArrowLeft className="w-8 h-8" />
        </button>

        <div className="bg-white rounded-[2rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] border border-stone-200 p-8 md:p-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
              <FileText size={24} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-stone-900">Terms of Service</h1>
              <p className="text-sm text-stone-500">Last updated: March 2026</p>
            </div>
          </div>

          <div className="prose prose-stone max-w-none space-y-8">
            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                Acceptance of Terms
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                By accessing and using our rental property analysis service ("Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by these terms, please do not use this Service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                Description of Service
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                We provide an AI-powered rental property analysis service that helps users evaluate rental listings before attending inspections. The Service analyses listing photos and descriptions to provide insights about property quality, potential issues, and competition levels.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                User Accounts and Credits
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                To use our Service, you must create an account. We provide free analyses credits as part of our service. Key terms:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li>Free credits are provided for personal, non-commercial use</li>
                <li>Credits cannot be transferred or sold</li>
                <li>We reserve the right to modify credit allocation at any time</li>
                <li>Account sharing is prohibited</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-stone-500" />
                Disclaimer of Warranties
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                <strong>Important:</strong> Our Service provides AI-generated analysis for informational purposes only. The analysis is:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2 mb-3">
                <li>Not a professional property inspection or valuation</li>
                <li>Not a substitute for legal or financial advice</li>
                <li>Based on limited visual information from listing photos</li>
                <li>Subject to limitations inherent in AI technology</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed">
                We do not guarantee the accuracy, completeness, or reliability of any analysis. Users should always conduct their own due diligence, attend physical inspections, and seek professional advice before making rental decisions.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-stone-500" />
                Limitation of Liability
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                To the maximum extent permitted by Australian law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses resulting from your use of the Service. Our total liability shall not exceed the amount you have paid us, if any.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                User Conduct and Restrictions
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                You agree not to:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li>Use the Service for any illegal or unauthorized purpose</li>
                <li>Attempt to gain unauthorized access to any part of the Service</li>
                <li>Upload or transmit viruses or malicious code</li>
                <li>Interfere with or disrupt the Service</li>
                <li>Use automated tools to access the Service without permission</li>
                <li>Resell or commercialise the Service without authorization</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                Intellectual Property
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                The Service, including all content, features, and functionality, is owned by us and is protected by Australian and international copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, modify, or create derivative works from any part of the Service without our prior written consent.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                Termination
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                We may terminate or suspend your account and access to the Service immediately, without prior notice or liability, for any reason, including breach of these Terms. Upon termination, your right to use the Service will immediately cease.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                Governing Law
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                These Terms shall be governed by and construed in accordance with the laws of New South Wales, Australia. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts of New South Wales.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-stone-500" />
                Changes to Terms
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                We reserve the right to modify these Terms at any time. We will provide notice of material changes by posting the updated Terms on our website. Your continued use of the Service after such changes constitutes acceptance of the new Terms.
              </p>
            </section>

            <section className="pt-6 border-t border-stone-200">
              <p className="text-xs text-stone-400">
                By using this Service, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
              </p>
            </section>
          </div>
        </div>

        <div className="text-center pt-8 pb-4">
          <p className="text-xs text-stone-400 font-medium">
            AI Rental Decision Assistant
          </p>
        </div>
      </div>
    </div>
  );
}
