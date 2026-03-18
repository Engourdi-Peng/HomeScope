// ===== HomeScope Extension - Popup Script =====
// 登入流程：
// 1. 開啟 popup → 檢查登入狀態
// 2. 未登入 → 顯示「用 Google 登入」按鈕
// 3. 已登入 → 顯示用戶資訊和登出按鈕

const popup = document.getElementById('homescope-popup');

// ===== 1. 渲染「用 Google 登入」按鈕 =====
function renderSignIn(error = '') {
  popup.innerHTML = `
    <div class="homescope-popup-title">
      <h2>HomeScope</h2>
      <p>Property Analyzer</p>
    </div>
    ${error ? `<p class="homescope-popup-error">${error}</p>` : ''}
    <div class="homescope-popup-signin-container">
      <p class="homescope-popup-description">
        登入以分析租賃房產，獲取詳細的投資見解。
      </p>
      <button id="google-signin-btn" class="homescope-popup-google-btn">
        <svg class="google-icon" viewBox="0 0 24 24" width="20" height="20">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        用 Google 繼續
      </button>
    </div>
    <div class="homescope-popup-footer">
      <a href="https://www.tryhomescope.com/pricing" target="_blank">查看定價</a>
    </div>
  `;

  // 綁定按鈕事件
  document.getElementById('google-signin-btn').addEventListener('click', handleGoogleSignIn);
}

// ===== 2. 渲染已登入狀態 =====
function renderLoggedIn(user) {
  const email = user?.email || 'User';
  const firstLetter = email.charAt(0).toUpperCase();

  popup.innerHTML = `
    <div class="homescope-popup-title">
      <h2>HomeScope</h2>
      <p>Property Analyzer</p>
    </div>
    <div class="homescope-popup-logged-in">
      <div class="homescope-popup-avatar">${firstLetter}</div>
      <div class="homescope-popup-user-info">
        <p class="homescope-popup-user-email">${email}</p>
      </div>
    </div>
    <div class="homescope-popup-actions">
        <a href="https://www.tryhomescope.com/account" target="_blank" class="homescope-popup-secondary-btn">
        前往帳戶
      </a>
      <button id="logout-btn" class="homescope-popup-text-btn">登出</button>
    </div>
  `;

  // 綁定登出按鈕事件
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

// ===== 3. 渲染載入狀態 =====
function renderLoading(message = '載入中...') {
  popup.innerHTML = `
    <div class="homescope-popup-title">
      <h2>HomeScope</h2>
    </div>
    <div class="homescope-popup-loading">
      <p>${message}</p>
    </div>
  `;
}

// ===== 3. 處理「用 Google 登入」=====
async function handleGoogleSignIn() {
  const btn = document.getElementById('google-signin-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在開啟 Google...';
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: 'sign_in_with_google' });

    if (response.success) {
      renderLoggedIn(response.user);
    } else {
      renderSignIn(response.error || '登入失敗，請重試。');
    }
  } catch (error) {
    console.error('Google sign in error:', error);
    renderSignIn('登入失敗，請重試。');
  }
}

// ===== 處理登出 =====
async function handleLogout() {
  renderLoading('正在登出...');

  try {
    await chrome.runtime.sendMessage({ action: 'logout' });
    renderSignIn();
  } catch (error) {
    console.error('Logout error:', error);
    renderSignIn();
  }
}

// ===== 5. 監聽授權完成消息 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'auth_status_changed') {
    if (message.authenticated && message.user) {
      renderLoggedIn(message.user);
    } else {
      renderSignIn();
    }
  }
  if (message.action === 'auth_complete') {
    // 用户在 oauth-callback 页面完成了授权，刷新登录状态
    init();
  }
});

// ===== 6. 初始化 =====
async function init() {
  renderLoading('Checking...');

  try {
    // 调用 background.js 检查认证状态
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });

    if (response.state === 'authenticated' && response.user) {
      renderLoggedIn(response.user);
    } else {
      renderSignIn();
    }
  } catch (error) {
    console.error('Popup init error:', error);
    renderSignIn();
  }
}

// 启动
init();
