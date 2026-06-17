import React from 'react';
import { AppProvider, useAppState } from './store';
import { ExtensionHeader } from './components/ExtensionHeader';
import { ListingSummary } from './components/ListingSummary';
import { AnalyseSection } from './components/AnalyseSection';
import { HistorySection } from './components/HistorySection';
import { AccountSection } from './components/AccountSection';
import { ExtensionResultView } from './components/ExtensionResultView';
import { AuthGateSection } from './components/AuthGateSection';
import { HowItWorksSection } from './components/HowItWorksSection';

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

  // Page B: 报告结果页 — 直接渲染 ExtensionResultView（与 web Result.tsx 结构同构）
  if (currentView === 'report') {
    return (
      <div className="ext-app--report">
        <ExtensionResultView />
      </div>
    );
  }

  // Page A: 首页
  return (
    <div className="ext-app">
      <ExtensionHeader />
      <div className="ext-content">
        <ListingSummary />
        <AnalyseSection />
        <AuthGateSection />
        <HistorySection />
        <AccountSection />
        <HowItWorksSection />
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
