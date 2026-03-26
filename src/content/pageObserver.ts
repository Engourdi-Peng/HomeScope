/**
 * 页面观测层核心模块
 * Layer B：处理 DOM 变化、URL 变化、延迟重试
 * 解决 SPA 路由跳转、懒加载内容、动态渲染场景下的读取时机问题
 */

import type { PropertySignals } from '../detectors/propertySignals';
import { RETRY_DELAYS } from '../../shared/constants';

export interface PageState {
  url: string;
  readyState: DocumentReadyState;
  signals: PropertySignals | null;
  extractionStage: 'initial' | 'delayed' | 'final';
  lastUpdated: number;
}

type StateUpdateCallback = (state: PageState) => void;

/** 页面观测器 */
export class PageObserver {
  private mutationObserver: MutationObserver | null = null;
  private currentUrl: string = '';
  private currentState: PageState;
  private updateCallbacks: StateUpdateCallback[] = [];
  private retryTimeouts: ReturnType<typeof setTimeout>[] = [];
  private isObserving = false;

  constructor(
    private getSignals: () => PropertySignals,
    private onStateUpdate?: (state: PageState) => void
  ) {
    this.currentUrl = location.href;
    this.currentState = {
      url: this.currentUrl,
      readyState: document.readyState as DocumentReadyState,
      signals: null,
      extractionStage: 'initial',
      lastUpdated: Date.now(),
    };
    this.updateCallbacks.push(onStateUpdate!);
  }

  /** 启动观测：等 DOM Ready 后开启 MutationObserver + 延迟重试 */
  start() {
    this.hookHistoryAPI();
    this.waitForReady().then(() => {
      this.refreshState('initial');
      this.startMutationObserver();
      this.scheduleRetries();
    });
  }

  /** 停止观测，清理所有资源 */
  destroy() {
    this.mutationObserver?.disconnect();
    for (const t of this.retryTimeouts) clearTimeout(t);
    this.retryTimeouts = [];
    this.isObserving = false;
  }

  /** 注册状态更新回调 */
  onUpdate(cb: StateUpdateCallback) {
    this.updateCallbacks.push(cb);
  }

  /** 手动触发一次状态刷新 */
  refreshState(stage: 'initial' | 'delayed' | 'final' = 'initial') {
    const newUrl = location.href;
    const state: PageState = {
      url: newUrl,
      readyState: document.readyState as DocumentReadyState,
      signals: null,
      extractionStage: stage,
      lastUpdated: Date.now(),
    };

    try {
      state.signals = this.getSignals();
    } catch {}

    this.currentUrl = newUrl;
    this.currentState = state;

    for (const cb of this.updateCallbacks) {
      try { cb(state); } catch {}
    }
  }

  /** 获取当前状态快照 */
  getCurrentState(): PageState {
    return this.currentState;
  }

  // ===== Private =====

  /** 等待 DOM 准备好 */
  private waitForReady(): Promise<void> {
    return new Promise(resolve => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // 给交互式页面一点渲染时间
        setTimeout(resolve, 300);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(resolve, 500);
        }, { once: true });
      }
    });
  }

  /** Hook pushState / replaceState，监听 SPA 路由变化 */
  private hookHistoryAPI() {
    const self = this;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      self.handleUrlChange();
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      self.handleUrlChange();
      return result;
    };

    window.addEventListener('popstate', () => {
      self.handleUrlChange();
    });
  }

  /** URL 变化处理 */
  private handleUrlChange() {
    const newUrl = location.href;
    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl;
      this.refreshState('initial');
    }
  }

  /** 启动 MutationObserver 监听 DOM 变化 */
  private startMutationObserver() {
    if (this.isObserving) return;

    const self = this;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    this.mutationObserver = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const newUrl = location.href;
        if (newUrl !== self.currentUrl) {
          self.currentUrl = newUrl;
          self.refreshState('delayed');
        } else {
          self.refreshState('delayed');
        }
      }, 400);
    });

    // 监听主要内容区域
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.isObserving = true;
  }

  /** 三次延迟重试：T+0ms, T+800ms, T+2000ms */
  private scheduleRetries() {
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      const delay = RETRY_DELAYS[i];
      const stage: 'initial' | 'delayed' | 'final' =
        i === 0 ? 'initial' : i === 1 ? 'delayed' : 'final';

      const timeout = setTimeout(() => {
        this.refreshState(stage);
      }, delay);

      this.retryTimeouts.push(timeout);
    }
  }
}
