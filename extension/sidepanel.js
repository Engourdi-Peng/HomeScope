// ===== HomeScope Extension - Side Panel Script =====

const gateView = document.getElementById('gate-view');
const loggedInView = document.getElementById('logged-in-view');
const loggedInEmail = document.getElementById('logged-in-email');
const btnLogin = document.getElementById('btn-login');
const gateIconImg = document.getElementById('gate-icon-img');
const loggingInView = document.getElementById('logging-in-view');
const loggingInIconImg = document.getElementById('logging-in-icon-img');
const loggingInStatus = document.getElementById('logging-in-status');
const loginError = document.getElementById('login-error');

// 设置 logo 图片
if (gateIconImg) {
  gateIconImg.src = chrome.runtime.getURL('icon.png');
}
if (loggingInIconImg) {
  loggingInIconImg.src = chrome.runtime.getURL('icon.png');
}

// 关闭按钮
document.getElementById('sidepanel-close').addEventListener('click', () => {
  window.close();
});

// ===== 初始化：检查登录状态 =====
async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
    if (response.state === 'authenticated' && response.user) {
      showLoggedInView(response.user.email);
    } else {
      showGateView();
    }
  } catch (err) {
    console.error('HomeScope SidePanel: check_auth_status error', err);
    showGateView();
  }
}

// ===== 显示未登录门禁视图 =====
function showGateView() {
  gateView.style.display = 'flex';
  loggedInView.style.display = 'none';
  loggingInView.classList.remove('active');
  if (btnLogin) btnLogin.disabled = false;
  if (loginError) loginError.style.display = 'none';
}

// ===== 显示已登录视图 =====
function showLoggedInView(email) {
  gateView.style.display = 'none';
  loggedInView.style.display = 'flex';
  loggingInView.classList.remove('active');
  if (loginError) loginError.style.display = 'none';
  if (email && loggedInEmail) loggedInEmail.textContent = email;
}

// ===== 显示登录中视图 =====
function showLoggingInView() {
  gateView.style.display = 'none';
  loggedInView.style.display = 'none';
  loggingInView.classList.add('active');
  if (btnLogin) btnLogin.disabled = true;
  if (loginError) loginError.style.display = 'none';
}

// ===== 显示登录错误 =====
function showLoginError(msg) {
  if (loginError) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }
  loggingInView.classList.remove('active');
  gateView.style.display = 'flex';
  if (btnLogin) btnLogin.disabled = false;
}

// ===== 点击"立即登录"：直接触发 Google OAuth（Monica 风格）=====
// 整个 OAuth 在 chrome.identity.launchWebAuthFlow 里完成，
// 它会弹出 Google 登录窗口，用户完成登录后返回 id_token，
// background 保存 token 后通过 auth_status_changed 通知侧栏。
btnLogin.addEventListener('click', async () => {
  showLoggingInView();
  if (loggingInStatus) loggingInStatus.textContent = '正在打开 Google 登录...';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'sign_in_with_google' });

    if (result.success && result.user) {
      // background 已保存 token，直接显示已登录
      showLoggedInView(result.user.email);
    } else {
      showLoginError(result.error || '登录失败，请重试');
    }
  } catch (err) {
    console.error('HomeScope: sign_in_with_google error', err);
    showLoginError('登录失败，请检查网络后重试');
  }
});

// ===== 监听 background 发来的 auth_status_changed =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'auth_status_changed') {
    if (message.authenticated && message.user) {
      showLoggedInView(message.user.email);
    } else {
      showGateView();
    }
  }
});

// ===== 启动 =====
init();

console.log('HomeScope SidePanel: Loaded');
