// ===== HomeScope Extension - Background Script =====
// 插件 v2: 独立认证，只走 Magic Link，session 存 chrome.storage.local
// 配置：通过 vite define 注入（见 vite.config.ts），来源为 .env 中的 VITE_SUPABASE_ANON_KEY

// ===== 常量配置（构建时注入，禁止硬编码 fallback） =====
// __SUPABASE_ANON_KEY__ 和 __SUPABASE_PROJECT_REF__ 在 vite build 时被替换为 .env 中的真实值
// define 直接替换标识符，所以这里不加引号

const SUPABASE_PROJECT_REF = __SUPABASE_PROJECT_REF__;   // 如 "trteewgplkqiedonomzg"
const SUPABASE_ANON_KEY   = __SUPABASE_ANON_KEY__;        // 如 "eyJhbGci..."
const SUPABASE_URL        = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const ANALYZE_API = `${SUPABASE_URL}/functions/v1/analyze`;

// 邮件链接走 HTTPS 到本站 /auth/callback（邮件客户端不认 chrome-extension://），页面再通过 postMessage → content 同步到扩展
const MAGIC_LINK_REDIRECT_URL = __MAGIC_LINK_WEB_REDIRECT__;

// ===== 启动时打印脱敏配置（不发真实 key） =====
function _logConfig() {
  const keyPrefix = SUPABASE_ANON_KEY.length > 8 ? SUPABASE_ANON_KEY.slice(0, 8) + '...' : '(empty)';
  console.log('[BG] === Extension Config ===');
  console.log('[BG] SUPABASE_URL:', SUPABASE_URL);
  console.log('[BG] apikey prefix:', keyPrefix);
  console.log('[BG] anonKey is empty?', !SUPABASE_ANON_KEY);
  if (!SUPABASE_ANON_KEY) {
    console.error('[BG] FATAL: SUPABASE_ANON_KEY is empty. Build extension with VITE_SUPABASE_ANON_KEY set in .env');
  }
  console.log('[BG] Magic link redirect_to — add to Supabase → Auth → URL Configuration (Redirect URLs):');
  console.log('[BG]', MAGIC_LINK_REDIRECT_URL);
  console.log('[BG] === End Config ===');
}
_logConfig();

// ===== 断言：确保 key 不为空（构建产物层面） =====
if (!SUPABASE_ANON_KEY) {
  console.error('[BG] CONFIG_ERROR: SUPABASE_ANON_KEY is empty. Set VITE_SUPABASE_ANON_KEY in .env then rebuild.');
}

const STORAGE_KEYS = {
  ACCESS_TOKEN:  'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER:          'user'
};

const AUTH_STATES = {
  NOT_AUTHENTICATED: 'not_authenticated',
  AUTHENTICATED:     'authenticated',
  AUTH_ERROR:        'auth_error'
};

// ===== 工具函数 =====

function decodeJWTPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// ===== 1. Magic Link =====

async function sendMagicLink(email) {
  try {
    console.log('[BG] sendMagicLink redirect_to:', MAGIC_LINK_REDIRECT_URL);

    // 优先 legacy /magiclink（与多数项目兼容），失败再试 /otp（对齐 supabase-js signInWithOtp）
    let response = await fetch(`${AUTH_URL}/magiclink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        email,
        redirect_to: MAGIC_LINK_REDIRECT_URL
      })
    });

    if (!response.ok) {
      response = await fetch(`${AUTH_URL}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          email,
          type: 'magiclink',
          create_user: true,
          options: {
            email_redirect_to: MAGIC_LINK_REDIRECT_URL
          }
        })
      });
    }

    const data = await response.json();
    if (!response.ok) {
      return {
        success: false,
        error: data.error_description || data.msg || data.message || 'Failed to send magic link'
      };
    }

    return {
      success: true,
      message: 'Magic link sent! Check your email and click the link in your browser.',
      redirectHint: MAGIC_LINK_REDIRECT_URL
    };
  } catch (err) {
    console.error('[BG] sendMagicLink exception:', err);
    return { success: false, error: err.message };
  }
}

// 邮件链接若为 PKCE，URL 带 ?code= — 在回调页交给 background 换 token
async function exchangeMagicLinkCode(code) {
  const redirectTo = MAGIC_LINK_REDIRECT_URL;
  try {
    let response = await fetch(`${AUTH_URL}/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ auth_code: code })
    });

    if (!response.ok) {
      response = await fetch(`${AUTH_URL}/token?grant_type=authorization_code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_to: redirectTo
        })
      });
    }

    const data = await response.json();
    if (!response.ok) {
      console.error('[BG] exchangeMagicLinkCode failed:', data);
      return { success: false, error: data.error_description || data.msg || data.message || 'Code exchange failed' };
    }

    await saveTokensAndVerify(data.access_token, data.refresh_token, data.user);
    await broadcastAuthChanged(true, data.user);
    return { success: true, user: data.user };
  } catch (err) {
    console.error('[BG] exchangeMagicLinkCode exception:', err);
    return { success: false, error: err.message };
  }
}

// 处理 Magic Link 回调
async function handleMagicLinkCallback(accessToken, refreshToken, user) {
  await saveTokensAndVerify(accessToken, refreshToken, user);
  await broadcastAuthChanged(true, user);
}

// ===== 2. Token 存储读写 =====

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

async function saveTokens(accessToken, refreshToken, user) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACCESS_TOKEN]:  accessToken,
    [STORAGE_KEYS.REFRESH_TOKEN]: refreshToken || '',
    [STORAGE_KEYS.USER]:          user || null
  });
}

async function saveTokensAndVerify(accessToken, refreshToken, user) {
  await saveTokens(accessToken, refreshToken, user);
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
    STORAGE_KEYS.USER
  ]);
  console.log('[BG] tokens saved — access_token exists?', !!stored[STORAGE_KEYS.ACCESS_TOKEN],
    '| user email:', stored[STORAGE_KEYS.USER]?.email);
}

async function clearTokens() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
    STORAGE_KEYS.USER
  ]);
}

// ===== 3. Token 刷新 =====

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

    if (!response.ok) return null;
    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user
    };
  } catch (err) {
    console.error('[BG] refreshAccessToken error:', err);
    return null;
  }
}

// ===== 4. 检查认证状态 =====

async function checkAuthStatus() {
  const { accessToken, refreshToken, user } = await getTokens();

  if (!accessToken) {
    return { state: AUTH_STATES.NOT_AUTHENTICATED, user: null };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    if (response.ok) {
      const serverUser = await response.json();
      return { state: AUTH_STATES.AUTHENTICATED, user: serverUser };
    }

    if (refreshToken) {
      const newTokens = await refreshAccessToken(refreshToken);
      if (newTokens) {
        await saveTokens(newTokens.accessToken, newTokens.refreshToken, newTokens.user);
        return { state: AUTH_STATES.AUTHENTICATED, user: newTokens.user };
      }
    }

    await clearTokens();
    return { state: AUTH_STATES.NOT_AUTHENTICATED, user: null, error: 'Session expired' };

  } catch (err) {
    console.error('[BG] checkAuthStatus exception:', err);
    return { state: AUTH_STATES.AUTH_ERROR, user: null, error: err.message };
  }
}

// ===== 5. 广播登录状态变更 =====

async function broadcastAuthChanged(authenticated, user) {
  try {
    chrome.runtime.sendMessage({
      action: 'auth_status_changed',
      authenticated,
      user: user || null
    });
  } catch (err) {
    // popup/sidepanel 可能已关闭，忽略
  }
}

// ===== 6. 退出登录 =====

async function logout() {
  const { refreshToken } = await getTokens();
  if (refreshToken) {
    fetch(`${AUTH_URL}/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${refreshToken}`,
        'apikey': SUPABASE_ANON_KEY
      }
    }).catch(() => {});
  }
  await clearTokens();
  await broadcastAuthChanged(false, null);
  return { success: true, state: AUTH_STATES.NOT_AUTHENTICATED };
}

// ===== 7. 分析 API =====

async function callAnalyzeAPI(data) {
  const { accessToken, refreshToken } = await getTokens();
  if (!accessToken || !refreshToken) return { status: 'not_authenticated' };

  let response = await fetch(ANALYZE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      await saveTokens(newTokens.accessToken, newTokens.refreshToken, newTokens.user);
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
      await clearTokens();
      return { status: 'not_authenticated' };
    }
  }

  if (response.ok) {
    const result = await response.json();
    return { status: 'success', result };
  } else if (response.status === 401 || response.status === 403) {
    const err = await response.json().catch(() => ({}));
    return {
      status: 'error',
      error: err.message || (response.status === 401 ? 'Please sign in again' : 'No credits')
    };
  }
  return { status: 'error', error: 'Analysis failed' };
}

// ===== 8. 获取用户数据 =====

async function getUserData() {
  const { accessToken, refreshToken } = await getTokens();
  if (!accessToken || !refreshToken) return { status: 'not_authenticated' };

  const tryFetch = async (token) => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_data`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      }
    });
    return resp;
  };

  let response = await tryFetch(accessToken);

  if (response.status === 401 && refreshToken) {
    const newTokens = await refreshAccessToken(refreshToken);
    if (newTokens) {
      await saveTokens(newTokens.accessToken, newTokens.refreshToken, newTokens.user);
      response = await tryFetch(newTokens.accessToken);
    } else {
      await clearTokens();
      return { status: 'not_authenticated' };
    }
  }

  if (response.ok) {
    const data = await response.json();
    return { status: 'success', data };
  }

  const errBody = await response.json().catch(() => ({}));
  return {
    status: 'error',
    error: errBody.message || `API error: ${response.status}`
  };
}

// ===== 9. 消息监听 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'send_magic_link') {
    (async () => {
      const result = await sendMagicLink(message.email);
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'check_auth_status') {
    (async () => {
      const result = await checkAuthStatus();
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'logout') {
    (async () => {
      const result = await logout();
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'analyze') {
    (async () => {
      const result = await callAnalyzeAPI(message.data);
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'get_user_data') {
    (async () => {
      const result = await getUserData();
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'magic_link_callback') {
    (async () => {
      const { accessToken, refreshToken, user } = message;
      console.log('[BG] magic_link_callback received, accessToken:', !!accessToken, 'user:', user?.email);
      await handleMagicLinkCallback(accessToken, refreshToken, user);
      sendResponse({ success: true });
    })();
    return true;
  }

  // 网站 /auth/callback?from_extension=1 登录后，由 content script 转发 session
  if (message.action === 'ingest_session_from_web') {
    (async () => {
      const { accessToken, refreshToken, user } = message;
      console.log('[BG] ingest_session_from_web, accessToken:', !!accessToken, 'user:', user?.email);
      if (!accessToken) {
        sendResponse({ success: false, error: 'No access token' });
        return;
      }
      await handleMagicLinkCallback(accessToken, refreshToken, user);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.action === 'exchange_magic_code') {
    (async () => {
      const result = await exchangeMagicLinkCode(message.code);
      sendResponse(result);
    })();
    return true;
  }

  return false;
});

// ===== 启动时注册侧边栏行为：点击图标打开侧边栏 =====

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.warn('[BG] setPanelBehavior failed (may need reload):', err.message);
});

// ===== 点击图标 → 打开侧边栏（fallback） =====

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }, () => {
    if (chrome.runtime.lastError) {
      console.error('[BG] sidePanel.open failed:', chrome.runtime.lastError.message);
    }
  });
});
