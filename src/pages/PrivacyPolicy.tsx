import { Shield, Eye, Lock, Mail, ArrowLeft, Database, Users, FileText, Globe, Server, Trash2 } from 'lucide-react';

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
              <p className="text-sm text-stone-500">Last updated: June 2026</p>
            </div>
          </div>

          <div className="prose prose-stone max-w-none space-y-8">
            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Eye size={18} className="text-stone-500" />
                Introduction
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                This Privacy Policy explains how HomeScope ("we", "us", or "our") collects, uses, discloses, and safeguards your information when you use our AI-powered property analysis service, including our website (https://www.tryhomescope.com) and browser extension ("HomeScope"). We are committed to protecting your personal information in accordance with the Australian Privacy Act 1988 and the Australian Privacy Principles (APPs).
              </p>
              <p className="text-sm text-stone-600 leading-relaxed mt-2">
                <strong>This Privacy Policy is provided in compliance with Google Chrome Web Store requirements for browser extensions that access user data.</strong>
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Globe size={18} className="text-stone-500" />
                Supported Websites
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                HomeScope is designed to work with the following property listing websites:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li><strong>realestate.com.au</strong> (Australia)</li>
                <li><strong>Zillow</strong> (United States)</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                The extension will only access content on these websites when you explicitly click "Analyze" on a property listing page. We do not access or collect data from any other websites.
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
              
              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">Property Listing Data</h3>
              <p className="text-sm text-stone-600 leading-relaxed mb-2">When you request a property analysis, we may collect:</p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>Property address</li>
                <li>Listing price and price history</li>
                <li>Property details (beds, baths, square footage, year built)</li>
                <li>Listing descriptions and text content</li>
                <li>Property images and image URLs</li>
                <li>Page URL of the listing</li>
                <li>AI-generated analysis results and reports</li>
              </ul>

              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">Account Information</h3>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>Email address</li>
                <li>Authentication data and session tokens</li>
                <li>User ID</li>
                <li>Subscription plan (Basic or Full)</li>
                <li>Credit/point balance and purchase history</li>
              </ul>

              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">Technical Data</h3>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>IP address</li>
                <li>Browser type and version</li>
                <li>Device information</li>
                <li>Extension version</li>
                <li>Operating system</li>
              </ul>

              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">Usage Data</h3>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>Analysis history (for Full plan users)</li>
                <li>Feature usage patterns</li>
                <li>Timestamps of analysis requests</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <FileText size={18} className="text-stone-500" />
                Browser Extension Data Collection
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                Our browser extension collects data only through <strong>user-initiated actions</strong>:
              </p>
              <ol className="list-decimal list-inside text-sm text-stone-600 space-y-3 ml-2">
                <li><strong>User-Initiated Analysis</strong> - The extension only accesses property listing content when you actively click "Analyze" on a supported property page. No data is collected automatically or in the background.</li>
                <li><strong>Image Collection</strong> - When you request an analysis with image support, we programmatically access the photo gallery on the listing page. Images are collected solely for AI-powered visual analysis and sent to our AI processing service.</li>
                <li><strong>No Background Tracking</strong> - We do not track your browsing activity, monitor pages you visit, or collect data when you are not actively using the analysis feature.</li>
                <li><strong>Local Storage</strong> - Authentication session data is stored locally in your browser's chrome.storage.local and is automatically cleared when you sign out or uninstall the extension.</li>
              </ol>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Server size={18} className="text-stone-500" />
                AI Processing
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                To generate analysis results, the following data may be sent to third-party AI service providers:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>Property listing text and descriptions</li>
                <li>Property images (for Full plan analyses)</li>
                <li>Analysis parameters you select</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                <strong>AI Service Providers:</strong> We use OpenRouter and/or OpenAI as our AI processing providers. These providers process your data solely for the purpose of generating the requested property analysis.
              </p>
              <p className="text-sm text-stone-600 leading-relaxed mt-2">
                <strong>Data Use Limitation:</strong> Your property data is used ONLY to generate the requested analysis. We do not use your data for advertising, building user profiles, or any purpose unrelated to HomeScope services.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Database size={18} className="text-stone-500" />
                Data Storage
              </h2>
              
              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">Basic Plan (No Account Required)</h3>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>Analysis is performed without saving your history</li>
                <li>No property data, images, or results are stored on our servers</li>
                <li>Only anonymous usage metrics may be collected</li>
              </ul>

              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">Full Plan (Logged-in Users)</h3>
              <p className="text-sm text-stone-600 leading-relaxed mb-2">When you create an account and use the Full plan, we store:</p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>Your account information (email, user ID)</li>
                <li>Analysis history with property details</li>
                <li>Property images and AI analysis results</li>
                <li>Subscription and purchase history</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed mt-3">
                Data is stored on secure Supabase servers with encryption at rest and in transit.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Users size={18} className="text-stone-500" />
                Third-Party Services
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                We share your data with the following third-party service providers:
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-stone-600">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="text-left py-2 font-medium">Service</th>
                      <th className="text-left py-2 font-medium">Purpose</th>
                      <th className="text-left py-2 font-medium">Data Shared</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-medium">Supabase</td>
                      <td className="py-2">Database, authentication, backend</td>
                      <td className="py-2">Account info, analysis history</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-medium">OpenRouter</td>
                      <td className="py-2">AI model routing</td>
                      <td className="py-2">Property text, images</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-medium">OpenAI</td>
                      <td className="py-2">AI language processing</td>
                      <td className="py-2">Property text, images</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2 font-medium">Paddle / Stripe</td>
                      <td className="py-2">Payment processing</td>
                      <td className="py-2">Transaction data, email</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium">Vercel</td>
                      <td className="py-2">Website hosting</td>
                      <td className="py-2">Technical logs, usage data</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Lock size={18} className="text-stone-500" />
                Data Sharing and Disclosure
              </h2>
              
              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">What We Do NOT Do</h3>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                We are committed to protecting your privacy. HomeScope does NOT:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li><strong>Sell your personal data</strong> - We never sell, rent, or trade your personal information</li>
                <li><strong>Use data for advertising</strong> - Your data is not used for targeted advertising</li>
                <li><strong>Read unrelated websites</strong> - We only access realestate.com.au and Zillow when you use Analyze</li>
                <li><strong>Access passwords or cookies</strong> - We do not read passwords, banking credentials, or cookies</li>
                <li><strong>Monitor browsing history</strong> - We do not track websites you visit outside of HomeScope</li>
                <li><strong>Background surveillance</strong> - No data is collected in the background</li>
              </ul>

              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2">When We May Share Data</h3>
              <p className="text-sm text-stone-600 leading-relaxed">
                We may disclose your information only for legal requirements, protection of rights, or in connection with a business transfer (with prior notice to users).
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Shield size={18} className="text-stone-500" />
                Your Privacy Rights
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                Under the Australian Privacy Principles, you have the right to:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li><strong>Access</strong> - Request a copy of the personal information we hold about you</li>
                <li><strong>Correction</strong> - Ask us to correct inaccurate or incomplete information</li>
                <li><strong>Deletion</strong> - Request erasure of your personal information</li>
                <li><strong>Opt-out</strong> - Object to direct marketing (we do not engage in this)</li>
                <li><strong>Complaint</strong> - Lodge a complaint with the OAIC</li>
              </ul>

              <h3 className="text-base font-medium text-stone-800 mt-4 mb-2 flex items-center gap-2">
                <Trash2 size={16} className="text-stone-500" />
                How to Delete Your Data
              </h3>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                You can delete your data through the following methods:
              </p>
              <ol className="list-decimal list-inside text-sm text-stone-600 space-y-2 ml-2">
                <li><strong>Delete Analysis History (Full Plan)</strong> - Access your account settings in the extension or website to remove individual or all analysis records</li>
                <li><strong>Delete Your Account</strong> - Email a472018670@gmail.com with "Account Deletion Request" in the subject line. We process requests within 30 days.</li>
                <li><strong>Uninstall the Extension</strong> - This clears all locally stored session data. Server data (Full plan) remains until deletion is requested.</li>
                <li><strong>Immediate Data Deletion</strong> - Email a472018670@gmail.com. Response within 72 hours with verification confirmation.</li>
              </ol>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Eye size={18} className="text-stone-500" />
                Cookie and Tracking Policy
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                <strong>Our browser extension does NOT use cookies, trackers, or any form of user monitoring.</strong>
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li>We do not set, read, or modify any third-party cookies</li>
                <li>We do not track your browsing activity across websites</li>
                <li>We do not embed analytics trackers or advertising identifiers</li>
                <li>All communication uses secure API calls with session tokens</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Database size={18} className="text-stone-500" />
                Data Retention
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                We retain personal information only for as long as necessary to provide services and meet legal obligations:
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-stone-600">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="text-left py-2 font-medium">Data Type</th>
                      <th className="text-left py-2 font-medium">Retention Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="py-2">Local session data</td>
                      <td className="py-2">Until sign out or uninstall</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2">Basic plan analyses</td>
                      <td className="py-2">Not stored on servers</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2">Full plan analysis history</td>
                      <td className="py-2">Until deletion requested</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2">Account data</td>
                      <td className="py-2">Until deletion requested</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-2">Technical logs</td>
                      <td className="py-2">30 days</td>
                    </tr>
                    <tr>
                      <td className="py-2">Payment records</td>
                      <td className="py-2">7 years (legal requirement)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
                <Mail size={18} className="text-stone-500" />
                Contact Us
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">
                If you have any questions about this Privacy Policy, wish to exercise your privacy rights, or have a privacy concern, please contact us:
              </p>
              <ul className="list-disc list-inside text-sm text-stone-600 space-y-1 ml-2">
                <li><strong>Email:</strong> a472018670@gmail.com</li>
                <li><strong>Website:</strong> https://www.tryhomescope.com/contact</li>
              </ul>
              <p className="text-sm text-stone-600 leading-relaxed mt-4">
                For complaints about potential privacy breaches, you can also contact the Office of the Australian Information Commissioner (OAIC) at <a href="https://www.oaic.gov.au" className="text-blue-600 hover:underline">https://www.oaic.gov.au</a>.
              </p>
            </section>

            <section className="pt-6 border-t border-stone-200">
              <p className="text-xs text-stone-400">
                This policy is governed by Australian law. We are committed to complying with the Privacy Act 1988 and the Australian Privacy Principles (APPs).
              </p>
            </section>
          </div>
        </div>

        <div className="text-center pt-8 pb-4">
          <p className="text-xs text-stone-400 font-medium">
            HomeScope - AI-Powered Property Analysis
          </p>
        </div>
      </div>
    </div>
  );
}
