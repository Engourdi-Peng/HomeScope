// ===== HomeScope Extension - Side Panel Script =====
// 监听来自登录页面的 postMessage（扩展授权成功后的回调）

const loginFrame = document.getElementById('login-frame');

// 关闭按钮：尝试关闭侧边栏（部分浏览器支持 window.close）
document.getElementById('sidepanel-close').addEventListener('click', () => {
  window.close();
});

// 监听来自 iframe 的 postMessage
window.addEventListener('message', async (event) => {
  // 只处理来自 tryhomescope.com 的消息
  if (!event.origin.includes('tryhomescope.com')) {
    return;
  }

  const { type, data } = event.data;

  if (type === 'extension_auth_success') {
    // 登录页通知扩展：用户登录成功，需要同步 token
    // data 包含 { accessToken, refreshToken, user }
    try {
      await chrome.storage.local.set({
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        user: data.user
      });

      // 通知 popup 刷新状态
      chrome.runtime.sendMessage({
        action: 'auth_status_changed',
        authenticated: true,
        user: data.user
      });

      console.log('HomeScope SidePanel: Token saved from login page');
    } catch (err) {
      console.error('HomeScope SidePanel: Failed to save token', err);
    }
  }

  if (type === 'login_closed') {
    // 用户关闭了登录页或登录流程结束，关闭侧边栏
    window.close();
  }
});

// 检测 URL 变化（登录成功后页面会重定向）
let lastUrl = '';

function checkUrlChange() {
  try {
    const currentUrl = loginFrame.contentWindow.location.href;
    if (currentUrl !== lastUrl && lastUrl !== '') {
      // URL 发生变化，可能是登录成功了
      if (currentUrl.includes('/dashboard') || currentUrl.includes('/account') || currentUrl === 'https://www.tryhomescope.com/') {
        // 登录成功，通知 background
        chrome.runtime.sendMessage({
          action: 'check_auth_status'
        }, (response) => {
          if (response.state === 'authenticated' && response.user) {
            chrome.runtime.sendMessage({
              action: 'auth_status_changed',
              authenticated: true,
              user: response.user
            });
          }
        });
      }
    }
    lastUrl = currentUrl;
  } catch (e) {
    // 跨域错误，忽略
  }
}

// 定期检查 URL 变化
setInterval(checkUrlChange, 1500);

console.log('HomeScope SidePanel: Loaded');
