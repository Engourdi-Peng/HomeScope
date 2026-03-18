// ===== HomeScope Extension - Background Script =====
// 完整的认证状态流转：
// - send_magic_link: 发送 Magic Link
// - check_auth_status: 通过 Edge Function 验证 token 有效性
// - authenticated: 已认证状态
// - not_authenticated: 未认证状态
// - auth_error: 认证错误状态

// ===== 常量配置 =====
const SUPABASE_URL = 'https://trteewgplkqiedonomzg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const AUTH_STATUS_API = `${SUPABASE_URL}/functions/v1/auth-status`;
const ANALYZE_API = `${SUPABASE_URL}/functions/v1/analyze`;
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const MAGIC_LINK_REDIRECT_TO = 'https://www.tryhomescope.com/auth/callback';

// ===== Storage Keys =====
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER: 'user'
};

// ===== Auth 状态类型 =====
const AUTH_STATES = {
  NOT_AUTHENTICATED: 'not_authenticated',
  AUTHENTICATED: 'authenticated',
  AUTH_ERROR: 'auth_error',
  SENDING_MAGIC_LINK: 'sending_magic_link',
  MAGIC_LINK_SENT: 'magic_link_sent',
  CHECKING_AUTH: 'checking_auth'
};

// ===== 1. Google OAuth 登入（直接透過 Chrome Identity API）=====
async function signInWithGoogle() {
  try {
    // 使用 chrome.identity.launchWebAuthFlow 開啟 Google 授權頁面
    // 請求 OpenID Connect 的 ID token
    const redirectUrl = chrome.identity.getRedirectURL();

    // 建構 Google OAuth 授權 URL
    const clientId = '90653417049-9fdu8du4su8hi306jcd4lu69fsrtvbcg.apps.googleusercontent.com';
    const scope = encodeURIComponent('openid email profile');
    const state = Math.random().toString(36).substring(2, 15);
    const nonce = Math.random().toString(36).substring(2, 15);

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=id_token` +
      `&scope=${scope}` +
      `&state=${state}` +
      `&nonce=${nonce}` +
      `&hd=tryhomescope.com` +
      `&prompt=select_account`;

    console.log('HomeScope: Starting Google OAuth flow...');

    const result = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    });

    if (!result) {
      throw new Error('No response from Google OAuth');
    }

    // 解析 id_token
    const url = new URL(result);
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const idToken = hashParams.get('id_token');

    if (!idToken) {
      // 檢查是否有錯誤
      const error = hashParams.get('error');
      if (error) {
        throw new Error(`Google OAuth error: ${error}`);
      }
      throw new Error('No ID token received');
    }

    // 解析 JWT payload 取得用戶資訊
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    const email = payload.email;
    const name = payload.name || email.split('@')[0];

    // 用 id_token 向 Supabase 換取 session
    const sessionResponse = await fetch(`${AUTH_URL}/token?grant_type=id_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        "provider": "google",
        "id_token": idToken,
        "options": {
          "data": {
            "hd": "tryhomescope.com"
          }
        }
      })
    });

    if (!sessionResponse.ok) {
      const errorData = await sessionResponse.json().catch(() => ({}));
      throw new Error(errorData.msg || errorData.message || 'Failed to sign in with Supabase');
    }

    const sessionData = await sessionResponse.json();

    // 保存 tokens
    await saveTokens(
      sessionData.access_token,
      sessionData.refresh_token,
      sessionData.user
    );

    // 通知所有 popup 更新狀態
    chrome.runtime.sendMessage({
      action: 'auth_status_changed',
      authenticated: true,
      user: sessionData.user
    });

    console.log('HomeScope: Google OAuth successful, user:', email);

    return {
      success: true,
      user: sessionData.user
    };

  } catch (error) {
    console.error('HomeScope: Google OAuth error:', error);
    return {
      success: false,
      error: error.message || 'Failed to sign in with Google'
    };
  }
}

// ===== 2. 從 storage 獲取 token =====
async function getTokens() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
    STORAGE_KEYS.USER
  ]);
  return {
    accessToken: result[STORAGE_KEYS.ACCESS_TOKEN],
    refreshToken: result[STORAGE_KEYS.REFRESH_TOKEN],
    user: result[STORAGE_KEYS.USER]
  };
}

// ===== 2. 保存 token 到 storage =====
async function saveTokens(accessToken, refreshToken, user) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
    [STORAGE_KEYS.REFRESH_TOKEN]: refreshToken,
    [STORAGE_KEYS.USER]: user
  });
}

// ===== 3. 清除 token =====
async function clearTokens() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
    STORAGE_KEYS.USER
  ]);
}

// ===== 4. 刷新 token =====
async function refreshAccessToken(refreshToken) {
  try {
    const response = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user
    };
  } catch (error) {
    console.error('HomeScope: Token refresh error', error);
    return null;
  }
}

// ===== 5. 发送 Magic Link =====
async function sendMagicLink(email) {
  try {
    const response = await fetch(`${AUTH_URL}/magiclink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        email,
        options: {
          redirect_to: MAGIC_LINK_REDIRECT_TO
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        state: AUTH_STATES.AUTH_ERROR,
        error: data.error_description || data.msg || 'Failed to send magic link'
      };
    }

    return {
      success: true,
      state: AUTH_STATES.MAGIC_LINK_SENT,
      message: 'Magic link sent! Check your email and click the link, then come back and refresh.'
    };
  } catch (error) {
    console.error('HomeScope: Send magic link error', error);
    return {
      success: false,
      state: AUTH_STATES.AUTH_ERROR,
      error: error.message || 'Failed to send magic link'
    };
  }
}

// ===== 6. 检查认证状态（通过 Edge Function 验证 token）=====
async function checkAuthStatus() {
  const { accessToken, refreshToken, user } = await getTokens();

  // 没有 token，直接返回未认证
  if (!accessToken) {
    return {
      state: AUTH_STATES.NOT_AUTHENTICATED,
      user: null
    };
  }

  try {
    // 调用 Edge Function 验证 token 有效性
    const response = await fetch(AUTH_STATUS_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (response.ok && data.valid) {
      // Token 有效，返回已认证状态
      return {
        state: AUTH_STATES.AUTHENTICATED,
        user: data.user || user
      };
    }

    // Token 无效，尝试刷新
    if (refreshToken) {
      console.log('HomeScope: Token invalid, attempting refresh...');
      const newTokens = await refreshAccessToken(refreshToken);

      if (newTokens) {
        // 刷新成功，重新验证
        await saveTokens(newTokens.accessToken, newTokens.refreshToken, newTokens.user);

        const retryResponse = await fetch(AUTH_STATUS_API, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${newTokens.accessToken}`,
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          }
        });

        const retryData = await retryResponse.json();

        if (retryResponse.ok && retryData.valid) {
          return {
            state: AUTH_STATES.AUTHENTICATED,
            user: retryData.user || newTokens.user
          };
        }
      }
    }

    // 刷新失败或 token 仍然无效
    await clearTokens();
    return {
      state: AUTH_STATES.NOT_AUTHENTICATED,
      user: null,
      error: data.error || 'Session expired'
    };

  } catch (error) {
    console.error('HomeScope: Auth status check error', error);
    return {
      state: AUTH_STATES.AUTH_ERROR,
      user: null,
      error: error.message || 'Failed to check auth status'
    };
  }
}

// ===== 7. 退出登录 =====
async function logout() {
  await clearTokens();
  return {
    success: true,
    state: AUTH_STATES.NOT_AUTHENTICATED
  };
}

// ===== 8. 调用 analyze API（带重试机制）=====
async function callAnalyzeAPI(data) {
  const { accessToken, refreshToken } = await getTokens();

  if (!accessToken || !refreshToken) {
    return { status: 'not_authenticated' };
  }

  // 第一次尝试
  let response = await fetch(ANALYZE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  // 如果 401，尝试刷新 token
  if (response.status === 401 && refreshToken) {
    console.log('HomeScope: Access token expired, refreshing...');

    const newTokens = await refreshAccessToken(refreshToken);

    if (newTokens) {
      // 保存新 token
      await saveTokens(newTokens.accessToken, newTokens.refreshToken, newTokens.user);

      // 使用新 token 重试
      response = await fetch(ANALYZE_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${newTokens.accessToken}`,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
    } else {
      // 刷新失败，清除 token
      await clearTokens();
      return { status: 'not_authenticated' };
    }
  }

  // 处理响应
  if (response.ok) {
    const result = await response.json();
    return { status: 'success', result };
  } else if (response.status === 401 || response.status === 403) {
    const errorData = await response.json().catch(() => ({}));
    return {
      status: 'error',
      error: errorData.message || (response.status === 401 ? 'Please sign in again' : 'No credits available')
    };
  } else {
    return { status: 'error', error: 'Analysis failed, please try again' };
  }
}

// ===== 9. 打开侧边栏面板（Monica 式登录入口）=====
async function openSidePanel() {
  try {
    // 先确保 side panel 已启用并指向 sidepanel.html
    await chrome.sidePanel.setOptions({
      path: 'sidepanel.html',
      enabled: true
    });

    // 打开当前窗口的侧边栏
    await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });

    return { success: true };
  } catch (error) {
    console.error('HomeScope: Failed to open side panel', error);
    // Fallback: 尝试直接用 tabs 打开（用户禁用了 side panel 时）
    try {
      await chrome.tabs.create({
        url: 'https://www.tryhomescope.com/login?from=extension',
        active: true
      });
      return { success: true, fallback: true };
    } catch (tabError) {
      return { success: false, error: error.message };
    }
  }
}

// ===== 点击扩展图标时打开右侧侧边栏（吸附在浏览器右边）=====
chrome.action.onClicked.addListener(async () => {
  await openSidePanel();
});

// ===== 消息监听 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ===== 用 Google 登入 =====
  if (message.action === 'sign_in_with_google') {
    (async () => {
      const result = await signInWithGoogle();
      sendResponse(result);
    })();
    return true;
  }

  // ===== 发送 Magic Link =====
  if (message.action === 'send_magic_link') {
    (async () => {
      const result = await sendMagicLink(message.email);
      sendResponse(result);
    })();
    return true;
  }

  // ===== 检查认证状态 =====
  if (message.action === 'check_auth_status') {
    (async () => {
      const result = await checkAuthStatus();
      sendResponse(result);
    })();
    return true;
  }

  // ===== 退出登录 =====
  if (message.action === 'logout') {
    (async () => {
      const result = await logout();
      sendResponse(result);
    })();
    return true;
  }

  // ===== 分析功能（来自 content script）=====
  if (message.action === 'analyze') {
    (async () => {
      const result = await callAnalyzeAPI(message.data);
      sendResponse(result);
    })();
    return true;
  }

  // ===== 打开 popup =====
  if (message.action === 'openPopup') {
    chrome.action.openPopup();
    return false;
  }

  // ===== 启动 OAuth 授权流程 =====
  if (message.action === 'start_oauth_flow') {
    (async () => {
      const result = await startOAuthFlow();
      sendResponse(result);
    })();
    return true;
  }

  // ===== 启动扩展授权（从网站登录页面调用）=====
  if (message.action === 'start_extension_auth') {
    (async () => {
      const result = await startExtensionAuth(message.user);
      sendResponse(result);
    })();
    return true;
  }

  // ===== OAuth 回调完成 =====
  if (message.action === 'auth_complete') {
    // oauth-callback.html 完成授权后通知 background
    // 此时 token 已存入 storage，重新检查认证状态并通知所有 popup
    (async () => {
      const result = await checkAuthStatus();
      // 通知所有 popup 更新状态
      chrome.runtime.sendMessage({
        action: 'auth_status_changed',
        authenticated: result.state === AUTH_STATES.AUTHENTICATED,
        user: result.user
      });
    })();
    return false;
  }

  // ===== 打开侧边栏面板（Monica 式登录入口）=====
  if (message.action === 'open_side_panel') {
    (async () => {
      const result = await openSidePanel();
      sendResponse(result);
    })();
    return true;
  }

  return false;
});

// ===== 导出状态常量供 popup 使用 =====
self.AUTH_STATES = AUTH_STATES;

// ===== 9. 启动 OAuth 授权流程 =====
async function startOAuthFlow() {
  try {
    // 构建授权 URL
    const authUrl = `${window.location.origin || 'https://www.tryhomescope.com'}/login?from=extension`;

    // 使用 chrome.identity.launchWebAuthFlow
    // 注意：launchWebAuthFlow 会在授权完成后回调到 redirect_uri
    const callbackUrl = chrome.runtime.getURL('oauth-callback.html');

    // 构建授权 URL（带回调参数）
    const authorizeUrl = `https://www.tryhomescope.com/login?from=extension&callback=${encodeURIComponent(callbackUrl)}`;

    const result = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl,
      interactive: true
    });

    // result 是回调页面的 URL，其中包含了 token 信息
    if (result) {
      // 解析回调 URL 中的参数
      const url = new URL(result);
      const params = new URLSearchParams(url.search);

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const userId = params.get('user_id');
      const userEmail = params.get('user_email');

      if (accessToken) {
        await saveTokens(accessToken, refreshToken, { id: userId, email: userEmail });

        // 通知所有 popup 更新状态
        chrome.runtime.sendMessage({
          action: 'auth_status_changed',
          authenticated: true,
          user: { id: userId, email: userEmail }
        });

        return { success: true };
      }
    }

    return { success: false, error: 'No authorization code received' };
  } catch (error) {
    console.error('OAuth flow error:', error);
    return { success: false, error: error.message };
  }
}

// ===== 10. 处理来自网站登录页面的授权请求 =====
async function startExtensionAuth(userInfo) {
  try {
    // 回调 URL - 用户在网站登录后跳转的页面
    const callbackUrl = chrome.runtime.getURL('oauth-callback.html');

    // 构建授权 URL
    const authorizeUrl = `https://www.tryhomescope.com/auth/authorize?user_id=${userInfo.id}&user_email=${encodeURIComponent(userInfo.email)}&callback=${encodeURIComponent(callbackUrl)}`;

    // 使用 launchWebAuthFlow
    const result = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl,
      interactive: true
    });

    if (result) {
      // 解析回调 URL 中的参数
      const url = new URL(result);
      const hashParams = new URLSearchParams(url.hash.substring(1));

      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (accessToken) {
        await saveTokens(
          accessToken,
          refreshToken,
          { id: userInfo.id, email: userInfo.email }
        );

        return { success: true };
      }
    }

    return { success: false, error: 'No token received' };
  } catch (error) {
    console.error('Extension auth error:', error);
    return { success: false, error: error.message };
  }
}
