// ===== HomeScope Extension - Popup Script =====
// 插件 v2: 纯 Magic Link 登录，不依赖 Google OAuth

const popup = document.getElementById('homescope-popup');

// ===== 1. 渲染：加载中 =====
function renderLoading(message = 'Checking...') {
  popup.innerHTML = `
    <div class="homescope-popup-title">
      <h2>HomeScope</h2>
      <p>Property Analyzer</p>
    </div>
    <div class="homescope-popup-loading">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

// ===== 2. 渲染：Magic Link 入口 =====
function renderMagicLinkEntry(error = '') {
  popup.innerHTML = `
    <div class="homescope-popup-title">
      <h2>HomeScope</h2>
      <p>Property Analyzer</p>
    </div>
    ${error ? `<p class="homescope-popup-error">${error}</p>` : ''}
    <div class="homescope-popup-signin-container">
      <p class="homescope-popup-description">
        输入邮箱，我们会发送一个登录链接给你。<br/>
        点击链接后插件自动登录。
      </p>
      <form class="homescope-popup-form" id="magic-link-form">
        <input
          type="email"
          id="magic-email-input"
          placeholder="your@email.com"
          required
          autocomplete="email"
        />
        <button type="submit" class="homescope-popup-primary-btn" id="send-link-btn">
          发送登录链接
        </button>
      </form>
    </div>
    <div class="homescope-popup-footer">
      <a href="https://www.tryhomescope.com/pricing" target="_blank">查看定价</a>
    </div>
  `;

  document.getElementById('magic-link-form').addEventListener('submit', handleMagicLinkSubmit);
}

// ===== 3. 渲染：Magic Link 已发送 =====
function renderMagicLinkSent(email) {
  const safe = String(email).replace(/</g, '');
  popup.innerHTML = `
    <div class="homescope-popup-title">
      <h2>HomeScope</h2>
      <p>Property Analyzer</p>
    </div>
    <div class="homescope-popup-success">
      <p>登录链接已发送到</p>
      <p class="homescope-popup-email">${safe}</p>
      <div class="homescope-popup-instructions">
        请用本机 Chrome 打开邮件链接；会在本站完成登录并自动同步到扩展。
      </div>
      <p id="magic-link-hint" class="homescope-popup-error" style="display:none;text-align:left;line-height:1.4;margin-top:8px;"></p>
      <button type="button" id="check-login-btn" class="homescope-popup-refresh-btn">
        我已点击链接，刷新状态
      </button>
      <button type="button" id="back-btn" class="homescope-popup-back-btn">
        返回
      </button>
    </div>
    <div class="homescope-popup-footer">
      <a href="https://www.tryhomescope.com/pricing" target="_blank">查看定价</a>
    </div>
  `;

  document.getElementById('check-login-btn').addEventListener('click', () => refreshMagicLinkPopupStatus(email));
  document.getElementById('back-btn').addEventListener('click', renderMagicLinkEntry);
}

async function refreshMagicLinkPopupStatus(email) {
  const btn = document.getElementById('check-login-btn');
  const hint = document.getElementById('magic-link-hint');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在检查…';
  }
  if (hint) {
    hint.style.display = 'none';
    hint.innerHTML = '';
  }
  try {
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
    if (response?.state === 'authenticated' && response?.user) {
      renderLoggedIn(response.user);
      return;
    }
    if (hint) {
      hint.innerHTML =
        '仍未检测到登录。若邮件链接打开的是网站而不是扩展页，请从扩展<strong>重新发送</strong>登录链接；并在 Supabase → Authentication → URL Configuration 中加入扩展回调地址（见后台日志）。';
      hint.style.display = 'block';
    }
  } catch (e) {
    if (hint) {
      hint.textContent = '检查失败，请稍后重试。';
      hint.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '我已点击链接，刷新状态';
    }
  }
}

// ===== 4. 渲染：已登录 =====
function renderLoggedIn(user) {
  const email = user?.email || 'User';
  const firstLetter = (email || 'U').charAt(0).toUpperCase();

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
      <a
        href="https://www.tryhomescope.com/account"
        target="_blank"
        class="homescope-popup-secondary-btn"
      >
        前往账户
      </a>
      <button id="logout-btn" class="homescope-popup-text-btn">退出登录</button>
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

// ===== 5. 事件：Magic Link 提交 =====
async function handleMagicLinkSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('magic-email-input');
  const btn = document.getElementById('send-link-btn');
  const email = (emailInput?.value || '').trim();

  if (!email) {
    renderMagicLinkEntry('请输入邮箱地址。');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '发送中...';
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'send_magic_link',
      email
    });

    if (response?.success) {
      renderMagicLinkSent(email);
    } else {
      renderMagicLinkEntry(response?.error || '发送失败，请重试。');
    }
  } catch (error) {
    console.error('[POPUP] send_magic_link error:', error);
    renderMagicLinkEntry('发送失败，请检查网络后重试。');
  }
}

// ===== 6. 事件：退出登录 =====
async function handleLogout() {
  renderLoading('正在登出...');

  try {
    await chrome.runtime.sendMessage({ action: 'logout' });
    renderMagicLinkEntry();
  } catch (error) {
    console.error('[POPUP] logout error:', error);
    renderMagicLinkEntry();
  }
}

// ===== 7. 监听 background 广播的 auth_status_changed =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'auth_status_changed') {
    if (message.authenticated && message.user) {
      renderLoggedIn(message.user);
    } else {
      renderMagicLinkEntry();
    }
  }
});

// ===== 8. 初始化 =====
async function init() {
  renderLoading('Checking...');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });

    if (response.state === 'authenticated' && response.user) {
      renderLoggedIn(response.user);
    } else {
      renderMagicLinkEntry();
    }
  } catch (error) {
    console.error('[POPUP] init error:', error);
    renderMagicLinkEntry();
  }
}

init();
