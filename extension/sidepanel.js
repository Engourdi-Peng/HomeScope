// ===== HomeScope Extension - Side Panel Script =====

const LOGIN_URL = 'https://www.tryhomescope.com/login?from=extension';
const gateView = document.getElementById('gate-view');
const loggedInView = document.getElementById('logged-in-view');
const loggedInEmail = document.getElementById('logged-in-email');
const btnLogin = document.getElementById('btn-login');
const gateIconImg = document.getElementById('gate-icon-img');
const loggingInView = document.getElementById('logging-in-view');
const loggingInIconImg = document.getElementById('logging-in-icon-img');

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
  btnLogin.disabled = false;
}

// ===== 显示已登录视图 =====
function showLoggedInView(email) {
  gateView.style.display = 'none';
  loggedInView.style.display = 'flex';
  loggingInView.classList.remove('active');
  if (email) loggedInEmail.textContent = email;
}

// ===== 显示登录中视图 =====
function showLoggingInView() {
  gateView.style.display = 'none';
  loggedInView.style.display = 'none';
  loggingInView.classList.add('active');
  btnLogin.disabled = true;
}

// ===== 点击"立即登录"：通知 background 打开 popup 窗口 =====
btnLogin.addEventListener('click', async () => {
  showLoggingInView();
  try {
    await chrome.runtime.sendMessage({ action: 'open_login_popup' });
  } catch (err) {
    console.error('HomeScope: open_login_popup error', err);
    showGateView();
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
