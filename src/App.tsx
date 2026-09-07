import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Analytics } from '@vercel/analytics/react';
import { Home } from './pages/Home';
import { ResultPage } from './pages/Result';
import { AccountPage } from './pages/Account';
import { AffiliateDashboardPage } from './pages/AffiliateDashboard';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { SupportPage } from './pages/Support';
import { PricingPage } from './pages/Pricing';
import { PaymentSuccessPage } from './pages/PaymentSuccess';
import { Contact } from './pages/Contact';
import { RefundPolicy } from './pages/RefundPolicy';
import { CheckoutPage } from './pages/Checkout';
import { SharePage } from './pages/Share';
import { AuthCallback } from './pages/AuthCallback';
import { LoginPage } from './pages/Login';
import { AuthCompletePage } from './pages/AuthComplete';
import { AuthorizePage } from './pages/Authorize';
import { ZillowToolsPage } from './pages/ZillowTools';
import { BlogIndexPage } from './pages/Blog';
import { ArticleDetailPage } from './pages/Article';
import { AdminArticlesListPage } from './pages/admin/ArticlesList';
import { AdminArticleEditorPage } from './pages/admin/ArticleEditor';
import { RequireAdmin } from './components/RequireAdmin';
import { useEffect, useState } from 'react';

function AnimatedRoutes() {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState('page-enter');

  useEffect(() => {
    if (displayLocation.pathname !== location.pathname) {
      setTransitionStage('page-exit');
      const timer = setTimeout(() => {
        setDisplayLocation(location);
        setTransitionStage('page-enter');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [location, displayLocation]);

  return (
    <div className={transitionStage}>
      <Routes location={displayLocation}>
        <Route path="/" element={<Home />} />
        <Route path="/result" element={<ResultPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/affiliate" element={<AffiliateDashboardPage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/payment-success" element={<PaymentSuccessPage />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/refund" element={<RefundPolicy />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/share/:slug" element={<SharePage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth-complete" element={<AuthCompletePage />} />
        <Route path="/auth/authorize" element={<AuthorizePage />} />
        <Route path="/tools/zillow" element={<ZillowToolsPage />} />
        <Route path="/blog" element={<BlogIndexPage />} />
        <Route path="/blog/:slug" element={<ArticleDetailPage />} />
        <Route path="/admin/articles" element={<RequireAdmin><AdminArticlesListPage /></RequireAdmin>} />
        <Route path="/admin/articles/new" element={<RequireAdmin><AdminArticleEditorPage /></RequireAdmin>} />
        <Route path="/admin/articles/:id/edit" element={<RequireAdmin><AdminArticleEditorPage /></RequireAdmin>} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <AnimatedRoutes />
      </BrowserRouter>
      <Analytics />
    </AuthProvider>
  );
}

export default App;
