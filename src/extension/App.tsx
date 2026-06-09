import { AppProvider, useAppState } from './store';
import { ExtensionHeader } from './components/ExtensionHeader';
import { ListingSummary } from './components/ListingSummary';
import { AnalyseSection } from './components/AnalyseSection';
import { HistorySection } from './components/HistorySection';
import { AccountSection } from './components/AccountSection';
import { GateView, FreemiumEntry } from './components/GateView';
import { ExtensionResultView } from './components/ExtensionResultView';
import { HowToUseCard } from './components/HowToUseCard';

function AppContent() {
  const { authStatus, currentView } = useAppState();

  if (authStatus === 'checking') {
    return (
      <div className="ext-app">
        <div className="ext-loading-state" style={{ height: '100%' }}>
          <div className="ext-spinner" />
          <span>Loading HomeScope...</span>
        </div>
      </div>
    );
  }

  // 结果页优先 — 即使是未登录用户查看了 guest basic report，也要显示结果页
  if (currentView === 'report') {
    return (
      <div className="ext-app--report">
        <ExtensionResultView />
      </div>
    );
  }

  // Freemium 未登录首页：展示房产卡片 + 免费分析入口 + 登录引导
  if (authStatus === 'logged_out') {
    return (
      <div className="ext-app">
        <ExtensionHeader />
        <div className="ext-content">
          <ListingSummary />
          <GateView />
          <AnalyseSection />
          <FreemiumEntry />
          <HowToUseCard />
        </div>
      </div>
    );
  }

  // 已登录首页：AnalyseSection（Deep 入口） + GateView（Basic 入口） + HistorySection + AccountSection
  return (
    <div className="ext-app">
      <ExtensionHeader />
      <div className="ext-content">
        <ListingSummary />
        <AnalyseSection />
        <GateView variant="secondary" />
        <HistorySection />
        <AccountSection />
        <HowToUseCard />
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
