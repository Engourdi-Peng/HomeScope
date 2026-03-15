import { RefreshCcw, ArrowLeft, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

export function RefundPolicy() {
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
          className="group flex items-center gap-3 text-stone-500 hover:text-stone-900 mb-8 transition-colors"
        >
          <div className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center bg-white/50 backdrop-blur-md group-hover:bg-white transition-colors">
            <ArrowLeft size={14} strokeWidth={1.5} />
          </div>
          <span className="text-xs font-medium uppercase tracking-widest">Back</span>
        </button>

        <div className="bg-white rounded-[2rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] border border-stone-200 p-8 md:p-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center">
              <RefreshCcw size={24} className="text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-stone-900">Refund Policy</h1>
              <p className="text-sm text-stone-500">Last updated: March 2026</p>
            </div>
          </div>

          <div className="prose prose-stone max-w-none space-y-8">
            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3">
                Refund Eligibility
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Refunds are available for unused report credits within 7 days of purchase.
              </p>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                Once report credits have been used to generate analysis reports, refunds are generally not available, as the service has already been delivered.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3">
                How to Request a Refund
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                If you believe you are eligible for a refund, please contact our support team and include:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li>The email address associated with your account</li>
                <li>The purchase date</li>
                <li>A brief description of the issue</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                Refund requests can be sent to: <a href="mailto:a472018670@gmail.com" className="text-blue-600 hover:underline">a472018670@gmail.com</a>
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3">
                Processing Time
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                If a refund is approved, it will be processed through the original payment method used for the purchase. Depending on your bank or payment provider, it may take 5–10 business days for the refund to appear.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Mail size={18} className="text-stone-500" />
                Contact
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                If you have any questions regarding this Refund Policy, please contact us at: <a href="mailto:a472018670@gmail.com" className="text-blue-600 hover:underline">a472018670@gmail.com</a>
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
