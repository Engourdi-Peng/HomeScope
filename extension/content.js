(function() {
  'use strict';

  // ===== 0. 网站 /auth/callback?from_extension=1 登录后，页面 postMessage → 写入扩展 storage =====
  function isHomescopeWebOrigin(origin) {
    try {
      const u = new URL(origin);
      if (u.protocol !== 'https:') return false;
      const h = u.hostname.toLowerCase();
      return h === 'tryhomescope.com' || h === 'www.tryhomescope.com';
    } catch {
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isHomescopeWebOrigin(event.origin)) return;
    const d = event.data;
    if (!d || d.source !== 'homescope-auth-bridge' || d.type !== 'HOMESCOPE_PUSH_SESSION_TO_EXTENSION') return;
    const p = d.payload;
    if (!p || !p.access_token) return;
    chrome.runtime.sendMessage(
      {
        action: 'ingest_session_from_web',
        accessToken: p.access_token,
        refreshToken: p.refresh_token || '',
        user: p.user || null
      },
      () => void chrome.runtime.lastError
    );
  });

  // ===== 常量配置 =====
  const ANALYZE_BUTTON_ID = 'homescope-analyze-btn';
  const OVERLAY_ID = 'homescope-overlay';
  const PROPERTY_KEYWORDS = ['bedroom', 'bathroom', 'rent', 'sqft', 'sqm', 'bed', 'bath', 'toilet'];

  // ===== 1. 检测是否为房源页面 =====
  function isPropertyPage() {
    const pageText = document.body.innerText.toLowerCase();
    let matchCount = 0;

    for (const keyword of PROPERTY_KEYWORDS) {
      if (pageText.includes(keyword)) {
        matchCount++;
      }
    }

    // 检查价格符号
    const pricePattern = /[\$£€]\s*\d+/;
    if (pricePattern.test(pageText)) {
      matchCount++;
    }

    return matchCount >= 2;
  }

  // ===== 2. 提取页面数据 =====
  function extractPageData() {
    const data = {
      title: '',
      price: '',
      description: '',
      image_urls: [],
      url: window.location.href
    };

    // title: 尝试获取 h1
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim() || '';

    // 如果没有 h1，尝试其他常见标题选择器
    if (!data.title) {
      const titleSelectors = ['[data-testid="title"]', '.listing-title', '.property-title', 'h2'];
      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el?.textContent?.trim()) {
          data.title = el.textContent.trim();
          break;
        }
      }
    }

    // price: 正则匹配价格
    const pricePattern = /[\$£€]\s*[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:week|month|mo|w))?/gi;
    const priceMatch = document.body.innerText.match(pricePattern);
    data.price = priceMatch?.[0] || '';

    // description: 页面文本前 2000 字符
    const bodyText = document.body.innerText || '';
    data.description = bodyText.slice(0, 2000);

    // image_urls: 最多 10 张图片
    const images = Array.from(document.images)
      .filter(img => img.src && img.naturalWidth > 100)
      .slice(0, 10)
      .map(img => img.src);

    data.image_urls = images;

    return data;
  }

  // ===== 3. 创建浮动按钮 =====
  function createAnalyzeButton() {
    if (document.getElementById(ANALYZE_BUTTON_ID)) {
      return;
    }

    const btn = document.createElement('button');
    btn.id = ANALYZE_BUTTON_ID;
    btn.textContent = 'Analyze Property';
    btn.title = 'Analyze this property with HomeScope';

    btn.addEventListener('click', handleAnalyzeClick);

    document.body.appendChild(btn);
  }

  // ===== 4. 处理分析点击 =====
  async function handleAnalyzeClick(event) {
    event.preventDefault();
    event.stopPropagation();

    // 显示 loading 状态
    showOverlay('loading');

    // 提取页面数据
    const pageData = extractPageData();

    try {
      // 发送消息给 background.js
      const response = await chrome.runtime.sendMessage({
        action: 'analyze',
        data: pageData
      });

      // 根据响应显示结果
      if (response.status === 'success') {
        showOverlay('success', response.result);
      } else if (response.status === 'not_authenticated') {
        showOverlay('not_authenticated');
      } else {
        showOverlay('error', response.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('HomeScope: Analyze error', error);
      showOverlay('error', error.message || 'Request failed');
    }
  }

  // ===== 5. Overlay 显示控制 =====
  function showOverlay(state, data = null) {
    let overlay = document.getElementById(OVERLAY_ID);

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'homescope-overlay';
      document.body.appendChild(overlay);
    }

    let content = '';

    switch (state) {
      case 'loading':
        content = `
          <div class="homescope-overlay-content">
            <div class="homescope-spinner"></div>
            <p>Analyzing...</p>
          </div>
        `;
        break;

      case 'success':
        const result = data || {};
        const score = result.overallScore || result.overall_score || 'N/A';
        const verdict = result.verdict || result.finalRecommendation?.verdict || '';
        const summary = result.quickSummary || result.summary?.quickSummary || '';
        const risks = result.risks || result.riskSignals || [];

        content = `
          <div class="homescope-overlay-content homescope-result">
            <button class="homescope-close-btn" onclick="document.getElementById('${OVERLAY_ID}').classList.remove('homescope-overlay-open')">&times;</button>
            <h3>Analysis Result</h3>
            <div class="homescope-score">
              <span class="homescope-score-label">Score:</span>
              <span class="homescope-score-value">${score}</span>
              <span class="homescope-score-max">/ 10</span>
            </div>
            ${verdict ? `<p class="homescope-verdict">${verdict}</p>` : ''}
            ${summary ? `<p class="homescope-summary">${summary}</p>` : ''}
            ${risks.length > 0 ? `
              <div class="homescope-risks">
                <h4>Risks:</h4>
                <ul>
                  ${risks.map(r => `<li>${r}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
          </div>
        `;
        break;

      case 'not_authenticated':
        content = `
          <div class="homescope-overlay-content homescope-login-prompt">
            <button class="homescope-close-btn" onclick="document.getElementById('${OVERLAY_ID}').classList.remove('homescope-overlay-open')">&times;</button>
            <h3>Sign In Required</h3>
            <p>Please sign in to analyze properties.</p>
            <button class="homescope-popup-btn" id="homescope-open-popup">
              Sign In
            </button>
          </div>
        `;
        break;

      case 'error':
        content = `
          <div class="homescope-overlay-content homescope-error">
            <button class="homescope-close-btn" onclick="document.getElementById('${OVERLAY_ID}').classList.remove('homescope-overlay-open')">&times;</button>
            <h3>Analysis Failed</h3>
            <p>${data || 'Please try again.'}</p>
          </div>
        `;
        break;
    }

    overlay.innerHTML = content;

    // 绑定打开 sidepanel 的按钮事件
    if (state === 'not_authenticated') {
      setTimeout(() => {
        const popupBtn = document.getElementById('homescope-open-popup');
        if (popupBtn) {
          popupBtn.addEventListener('click', () => {
            chrome.sidePanel.open({ path: 'sidepanel.html' });
          });
        }
      }, 100);
    }

    // 显示 overlay
    overlay.classList.add('homescope-overlay-open');
  }

  // ===== 6. 初始化 =====
  function init() {
    if (isPropertyPage()) {
      createAnalyzeButton();
    }
  }

  // 页面加载完成后检测
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
