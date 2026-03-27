import { Shield, Eye, Lock, Mail, ArrowLeft, Database, Users, FileText } from 'lucide-react';

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#FDFCF9] text-stone-800 font-sans relative flex flex-col items-center py-12 px-4 sm:px-6 selection:bg-stone-200 selection:text-stone-900 overflow-x-hidden">
      <div className="fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply pointer-events-none overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1720442617080-c25f9955194c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHptaW5ubWFsaXN0JTIwbW9kZXJuJTIwaG91c2UlMjBleHRlcmlvciUyMGFyY2hpdGVjdHVyZSUyMHdoaXRlfGVufDF8fHx8MTc3MzE5ODI5NHww&ixlib=rb-4.1.0&q=80&w=1080" 
          alt="Modern architecture" 
          className="absolute right-0 top-0 w-full md:w-2/3 h-full object-cover object-right grayscale" 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#FDFCF9] via-[#FDFCF9]/80 to-transparent"></div>
      </div>

      <div className="relative z-10 w-full max-w-[800px]">
        <button
          onClick={() => window.history.back()}
          className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 mb-8 transition-colors"
        >
          <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
            <ArrowLeft size={14} strokeWidth={1.5} />
          </div>
          <span className="text-xs font-medium uppercase tracking-widest">Back</span>
        </button>

        <div className="bg-white rounded-[2rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] border border-stone-200 p-8 md:p-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
              <Shield size={24} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-stone-900">Privacy Policy</h1>
              <p className="text-sm text-stone-500">Last updated: March 2026</p>
            </div>
          </div>

          <div className="prose prose-stone max-w-none space-y-8">
            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Eye size={18} className="text-stone-500" />
                Introduction
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our rental property analysis service, including our website and browser extension ("we", "us", or "our"). We are committed to protecting your personal information in accordance with the Australian Privacy Act 1988 and the Australian Privacy Principles (APPs).
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Eye size={18} className="text-stone-500" />
                Information We Collect
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                We collect the following types of information:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li><strong>Account Information:</strong> Email address and authentication data when you sign up</li>
                <li><strong>Property Data:</strong> Listing photos, descriptions, and property details that you provide or that are accessed from supported property listing pages when you request an analysis</li>
                <li><strong>Usage Data:</strong> Information about how you use our service, including analysis history</li>
                <li><strong>Technical Data:</strong> IP address, browser type, and device information</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <FileText size={18} className="text-stone-500" />
                Browser Extension
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                If you use our browser extension, additional information may be processed as follows:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li>The extension only accesses property listing content when you actively click "Analyze"</li>
                <li>No data is collected in the background</li>
                <li>The extension may read visible content on the current listing page, including text and images, solely to generate the requested analysis</li>
                <li>The extension does not track your browsing activity outside supported property listing pages</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Lock size={18} className="text-stone-500" />
                How We Use Your Information
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                We use your information for the following purposes:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li>To provide rental property analysis services</li>
                <li>To generate AI-based insights and reports based on listing data</li>
                <li>To manage your account and provide customer support</li>
                <li>To improve and optimise our service</li>
                <li>To communicate with you about updates and support</li>
                <li>To comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Database size={18} className="text-stone-500" />
                AI Processing
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                To generate analysis results, property-related data may be processed by third-party AI service providers (for example, via OpenRouter). This data is used only to generate the requested analysis and is not used by us for advertising or unrelated profiling.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Shield size={18} className="text-stone-500" />
                Data Storage and Security
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Your data is stored on secure servers with encryption. We implement appropriate technical and organisational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. We retain your data only as long as necessary for the purposes outlined in this policy.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Users size={18} className="text-stone-500" />
                Sharing Your Information
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                We do not sell your personal information. We may share your information with:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2 mt-2">
                <li>Service providers who assist us in operating our platform</li>
                <li>AI processing providers used to generate analysis results</li>
                <li>Payment processing providers (for example, Paddle as Merchant of Record) to complete transactions and handle refunds, where applicable</li>
                <li>Law enforcement or regulatory bodies when required by law</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                If your payment is processed by Paddle, Paddle's privacy policy and consumer terms may also apply to the processing of payment-related data.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Eye size={18} className="text-stone-500" />
                Your Rights (Australian Privacy Principles)
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                Under the Australian Privacy Principles, you have the right to:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li>Access personal information we hold about you</li>
                <li>Correct inaccurate personal information</li>
                <li>Request deletion of your personal information</li>
                <li>Opt-out of direct marketing (we don't do direct marketing)</li>
                <li>Lodge a complaint with the OAIC if you believe we have breached privacy laws</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Mail size={18} className="text-stone-500" />
                Contact Us
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                If you have any questions about this Privacy Policy or wish to exercise your privacy rights, please contact us.
              </p>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                For complaints about potential privacy breaches, you can also contact the Office of the Australian Information Commissioner (OAIC).
              </p>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                Contact email:{" "}
                <a href="mailto:a472018670@gmail.com" className="text-blue-600 hover:underline">
                  a472018670@gmail.com
                </a>
              </p>
            </section>

            <section className="pt-6 border-t border-stone-200">
              <p className="text-xs text-stone-400">
                This policy is governed by Australian law. We are committed to complying with the Privacy Act 1988 and the Australian Privacy Principles.
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
