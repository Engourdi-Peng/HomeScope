/**
 * HomeScope Background Service Worker
 * Handles auth, API communication, and analysis submission.
 */

// ===== Injected config (replaced by vite at build time) =====
const SUPABASE_URL = __SUPABASE_URL__;
const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
const MAGIC_LINK_REDIRECT = __MAGIC_LINK_REDIRECT__;

// ===== Image collection DISABLED =====
// REMOVED: chrome.webRequest.onCompleted auto-collected gallery images on page load.
// Policy: "严禁后台预抓图库图片" — image collection is now exclusively user-triggered.
// All gallery image collection must go through the START_USER_EXTRACTION flow in content.js.

// tabId → listingUrl mapping (valid for service worker lifetime)
const _tabListingMap = new Map();

// OAuth flow tracking
const _oauthFlows = new Map();

const LOG_PREFIX = '[HomeScope BG]';

// Canonical storage keys (ONLY these are used for persistent session)
const HS_SESSION_KEY = 'hs_session';
const HS_USER_KEY = 'hs_user';
const HS_AUTH_MIGRATED_KEY = 'hs_auth_migrated';

// In-memory runtime cache
let _cachedAuth = null;
// Listeners waiting for auth changes
let _authListeners = [];
// Whether legacy session migration has been attempted this session
let _migrationAttempted = false;
// Refresh lock: prevents concurrent token refresh (race condition fix)
let _refreshLock = null;

// ── Helper: normalise Supabase user object to ExtUser ──
function toExtUser(supabaseUser) {
  if (!supabaseUser) return null;
  const meta = supabaseUser.user_metadata || {};
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    avatar: meta.avatar_url || meta.picture || meta.avatar,
  };
}

// ----- One-time legacy migration -----
async function migrateLegacySession() {
  if (_migrationAttempted) return;
  _migrationAttempted = true;

  // Check if already migrated
  const migrationFlag = await chrome.storage.local.get(HS_AUTH_MIGRATED_KEY);
  if (migrationFlag[HS_AUTH_MIGRATED_KEY] === true) {
    return;
  }

  // Try chrome.storage.local for sb-*-auth-token key
  const allStorage = await chrome.storage.local.get(null);
  let legacySession = null;
  for (const [key, val] of Object.entries(allStorage)) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token') && val) {
      try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        const sess = parsed?.currentSession || parsed;
        if (sess?.access_token && sess?.user) {
          legacySession = { access_token: sess.access_token, refresh_token: sess.refresh_token, user: sess.user };
          break;
        }
      } catch (_) {}
    }
  }

  // Migration complete — cookies fallback removed (no legacy users, privacy-safe)

  if (legacySession) {
    const extUser = toExtUser(legacySession.user);
    const session = { access_token: legacySession.access_token, refresh_token: legacySession.refresh_token || '' };
    await chrome.storage.local.set({
      [HS_SESSION_KEY]: session,
      [HS_USER_KEY]: extUser,
      [HS_AUTH_MIGRATED_KEY]: true,
    });
    _cachedAuth = { user: extUser, session };
  } else {
    // No legacy session found — just mark migration complete
    await chrome.storage.local.set({ [HS_AUTH_MIGRATED_KEY]: true });
  }
}

// ----- Primary session getter (cache → migrated storage only) -----
// NOTE: Prefer getAuth() for API calls — it auto-refreshes expired tokens.
// Use getSession() only when you need to check login state without making API calls.
async function getSession() {
  // 1. In-memory cache
  if (_cachedAuth) {
    return _cachedAuth;
  }

  // 2. One-time legacy migration (runs at most once per service worker lifetime)
  await migrateLegacySession();

  // 3. Canonical storage keys ONLY
  const stored = await chrome.storage.local.get([HS_SESSION_KEY, HS_USER_KEY]);
  if (stored[HS_SESSION_KEY] && stored[HS_USER_KEY]) {
    _cachedAuth = { session: stored[HS_SESSION_KEY], user: stored[HS_USER_KEY] };
    return _cachedAuth;
  }

  return null;
}

// ----- Auth getter for API calls: refreshes token if needed, then returns session -----
// Use this instead of getSession() for any handler that makes API calls.
async function getAuth() {
  await refreshSessionIfNeeded();
  return getSession();
}

// ----- Save session to canonical storage -----
async function saveSession(session, user, source = 'unknown') {
  try {
    await chrome.storage.local.set({
      [HS_SESSION_KEY]: session,
      [HS_USER_KEY]: user,
    });

    // 立即重新读取验证
    const verification = await chrome.storage.local.get([HS_SESSION_KEY, HS_USER_KEY]);
    const verified = verification[HS_SESSION_KEY] && verification[HS_USER_KEY];

    _cachedAuth = { user, session };
    _authListeners.forEach((cb) => cb(user));
  } catch (err) {
    console.error(`${LOG_PREFIX} saveSession: FAILED — ${err.message}`);
    throw err;
  }
}

// ----- Clear session -----
async function clearSession(reason = 'unknown') {
  await chrome.storage.local.remove([HS_SESSION_KEY, HS_USER_KEY]);
  _cachedAuth = null;
  _authListeners.forEach((cb) => cb(null));
}

// ----- Broadcast auth change to all extension contexts -----
function broadcastAuthChanged(authenticated, user) {
  try {
    chrome.runtime.sendMessage(
      { action: 'auth_status_changed', authenticated, user: user || undefined },
      () => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          // tab 可能已关闭，这是预期的，无需日志
        }
      }
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} broadcastAuthChanged: EXCEPTION —`, err.message);
  }
}

// ----- Send Magic Link via Supabase Auth API -----
async function rpcSendMagicLink(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email, options: { email_redirect_to: MAGIC_LINK_REDIRECT } }),
  });
  const data = await res.json();
  if (data.error) {
    console.error(`${LOG_PREFIX} send_magic_link: error=${data.error.message}`);
  }
  return data;
}

// ----- Token refresh -----
// Note: getSession() is called INSIDE the lock to prevent concurrent requests
// from reading the same stale refresh_token before the lock is acquired.
// Without this, two simultaneous requests would both read the old token,
// both hit "Already Used", and the second one would wrongly clear the session.
async function refreshSessionIfNeeded() {
  // 如果已有刷新在进行中，等待它完成
  if (_refreshLock) {
    const result = await _refreshLock;
    if (result) {
      return result;
    }
    // 如果等待的结果是失败，清空锁让当前请求继续尝试
    _refreshLock = null;
  }

  // 加锁后立即获取 session（避免并发请求读取到相同的旧 token）
  _refreshLock = (async () => {
    const stored = await getSession();
    if (!stored?.session?.refresh_token) {
      return stored;
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ refresh_token: stored.session.refresh_token }),
      });

      if (res.ok) {
        const data = await res.json();
        await saveSession(data, stored.user);
        return { session: data, user: stored.user };
      } else {
        // 读取错误响应体
        let errBody = {};
        try { errBody = await res.json(); } catch (_) {}
        const errMsg = errBody?.error_description || errBody?.msg || errBody?.message || '';
        const errCode = errBody?.error || '';

        // 区分错误类型
        const isReuseError = errMsg.toLowerCase().includes('already used');
        const isInvalidGrant = errCode === 'invalid_grant' || res.status === 400;

        if (isInvalidGrant) {
          if (isReuseError) {
            // 竞态：另一方已用旧 token 刷新成功，当前 token 已被替换。
            // 先重新读取 storage 确认：如果已经有新 token，说明竞态，无需清 session。
            const recheck = await getSession();
            if (!recheck?.session?.refresh_token) {
              // storage 已空，确实需要重登
              await clearSession('refresh_failure');
              broadcastAuthChanged(false, null);
            } else {
              // storage 还有 token，假设是竞态（另一方已刷新），跳过清 session
            }
          } else {
            // 其他 invalid_grant（真正过期、被撤销等）
            await clearSession('refresh_failure');
            broadcastAuthChanged(false, null);
          }
        } else {
          // 网络问题、服务器错误 — 暂时保留旧 session
        }
        return null;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: FAILED (network exception) — ${err.message} — keeping session, will retry later`);
      return null;
    } finally {
      _refreshLock = null;
    }
  })();

  return _refreshLock;
}

// Listen to storage changes to keep listeners in sync
chrome.storage.onChanged.addListener((changes) => {
  if (changes[HS_USER_KEY] || changes[HS_SESSION_KEY]) {
    getSession().then((auth) => {
      _authListeners.forEach((cb) => cb(auth?.user ?? null));
    });
  }
});

// ===== Message handling =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  const { action } = message;

  switch (action) {

    case 'check_auth_status': {
      try {
        await refreshSessionIfNeeded();
        const auth = await getSession();
        const state = auth?.user ? 'authenticated' : 'unauthenticated';
        sendResponse(auth?.user ? { state: 'authenticated', user: auth.user } : { state: 'unauthenticated' });
      } catch (err) {
        console.error(`${LOG_PREFIX} check_auth_status: error —`, err.message);
        sendResponse({ state: 'unauthenticated', error: err.message });
      }
      break;
    }

    case 'get_user_data': {
      try {
        const auth = await getAuth();
        if (!auth?.user) {
          sendResponse({ status: 'success', data: { credits_remaining: 0 } });
          return;
        }
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?select=credits_remaining,credits_reserved&id=eq.${auth.user.id}`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.session?.access_token || SUPABASE_ANON_KEY}` } }
        );
        if (res.ok) {
          const rows = await res.json();
          const remaining = rows?.[0]?.credits_remaining ?? 0;
          const reserved = rows?.[0]?.credits_reserved ?? 0;
          const available = Math.max(0, remaining - reserved);
          sendResponse({ status: 'success', data: { credits_remaining: available } });
        } else {
          sendResponse({ status: 'success', data: { credits_remaining: 0 } });
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} get_user_data: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'send_magic_link': {
      try {
        const { email } = message;
        if (!email) {
          sendResponse({ success: false, error: 'Email is required' });
          return;
        }
        const result = await rpcSendMagicLink(email);
        sendResponse(result.error ? { success: false, error: result.error.message } : { success: true });
      } catch (err) {
        console.error(`${LOG_PREFIX} send_magic_link: exception —`, err.message);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'initiate_google_oauth': {
      try {
        // Derive site base URL from MAGIC_LINK_REDIRECT to avoid hardcoding
        const siteBase = MAGIC_LINK_REDIRECT.split('/auth/callback')[0];
        // 生成 flowId，传递给 login 页面 → AuthContext → AuthCallback → background 关闭标签页
        const flowId = generateFlowId();

        // 将 flowId 通过 URL 参数传递给网站（AuthContext → AuthCallback）
        const loginUrl = `${siteBase}/login?from_extension=1&flow_id=${flowId}`;

        // 打开登录页面，background 记录 login tab
        const loginTab = await chrome.tabs.create({ url: loginUrl, active: true });
        const loginTabId = loginTab.id;

        // 记录 flow（callbackTabId 暂时未知，等用户完成 OAuth 后会打开 callback 页面）
        _oauthFlows.set(flowId, {
          loginTabId,
          callbackTabId: null, // 稍后填充
          createdAt: Date.now(),
          used: false,
        });

        sendResponse({ success: true, opened_login_page: true, flowId });
      } catch (err) {
        console.error(`${LOG_PREFIX} initiate_google_oauth: error —`, err.message);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'logout': {
      try {
        await clearSession('user_action');
        broadcastAuthChanged(false, null);
        sendResponse({ success: true });
      } catch (err) {
        console.error(`${LOG_PREFIX} logout: error — ${err.message}`);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    // Canonical bridge: website AuthCallback forwards session here via injected <script>
    // 双重校验：只有"扩展发起" + "当前 tab 就是那个被扩展打开的 callback tab"时才允许关闭
    case 'sync_session_from_site': {
      try {
        const p = message.payload;
        const flowId = p?.flowId;

        if (!p?.access_token || !p?.user) {
          console.error(`${LOG_PREFIX} sync_session_from_site: INVALID payload — missing access_token or user`);
          sendResponse({ success: false, error: 'Invalid session payload' });
          return;
        }

        // 获取 callback tab id（content script → background 的标准 sender）
        const senderTabId = sender?.tab?.id ?? null;

        // 双重校验：验证 flowId 和 sender.tab.id
        // 注意：即使校验失败（竞态条件等），仍然保存 session 以确保用户体验
        if (flowId) {
          const validation = validateOAuthFlow(flowId, senderTabId);
          if (!validation.valid) {
            console.warn(`${LOG_PREFIX} sync_session_from_site: flow validation FAILED (${validation.reason}) — saving session anyway (fallback mode, tab will NOT be closed)`);
            // 继续保存 session，但不关闭标签页
          }
        } else {
          // 旧版兼容：如果没有 flowId，检查是否有合法的 callback tab
          if (senderTabId == null) {
            const tabs = await chrome.tabs.query({ url: '*://*.tryhomescope.com/auth/callback*' });
            const fallbackTabId = tabs[0]?.id ?? null;
            if (fallbackTabId == null) {
              console.error(`${LOG_PREFIX} sync_session_from_site: BLOCKED — no flowId and no callback tab detected`);
              sendResponse({ success: false, error: 'No valid OAuth flow found' });
              return;
            }
          }
        }

        const session = { access_token: p.access_token, refresh_token: p.refresh_token || '' };
        const extUser = toExtUser(p.user);
        await saveSession(session, extUser, 'oauth_callback');

        broadcastAuthChanged(true, extUser);

        // ── 关闭回调标签页的条件（双重保护）──
        // 条件 1: flowId 存在（扩展主动发起的登录流程）
        // 条件 2: senderTabId 有效（background 有权限关闭的标签页）
        // 普通网页登录（无 flowId）时，即使 background 收到了 session 也不关闭任何标签页
        if (flowId && senderTabId != null) {
          chrome.tabs.remove(senderTabId).catch((err) => {
            console.warn(`${LOG_PREFIX} sync_session_from_site: failed to close tab — ${err.message}`);
          });
        }

        sendResponse({ success: true, user: extUser });
      } catch (err) {
        console.error(`${LOG_PREFIX} sync_session_from_site: EXCEPTION — ${err.message}`);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'analyze': {
      // Step 1: Get fresh session (auto-refresh if needed)
      const auth = await getAuth();
      if (!auth?.session?.access_token) {
        sendResponse({ status: 'error', error: 'Please sign in first to analyze listings.' });
        return;
      }
      const { session } = auth;

      const listingData = message.data;
      const imageUrls = listingData?.imageUrls || listingData?.images || [];
      const description = listingData?.description || listingData?.rawText || '';
      const reportMode = listingData?.reportMode || 'rent';

      // Build optionalDetails: pass price info to AI for accurate analysis
      const priceText = listingData?.priceText || listingData?.price || null;
      const priceHidden = listingData?.priceHidden || false;
      const optionalDetails = {};
      if (priceText) {
        if (reportMode === 'rent') {
          optionalDetails.weeklyRent = priceText;
        } else {
          optionalDetails.askingPrice = priceText;
        }
      }
      if (priceHidden) {
        optionalDetails.priceStatus = 'hidden'; // Mark as "Price on Application"
      }

      // Build request body for analyze function
      const requestBody = { imageUrls, description, reportMode, optionalDetails };

      // Step 3: action=submit
      try {
        const submitRes = await fetch(`${SUPABASE_URL}/functions/v1/analyze?action=submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!submitRes.ok) {
          const err = await submitRes.json().catch(() => ({ message: 'Failed to submit analysis' }));
          if (submitRes.status === 403 || err?.code === 'NO_CREDITS') {
            sendResponse({ status: 'no_credits' });
          } else if (submitRes.status === 401 || err?.code === 'NOT_AUTHENTICATED') {
            sendResponse({ status: 'error', error: 'Session expired. Please sign in again.' });
          } else {
            sendResponse({ status: 'error', error: err.message || 'Failed to submit analysis' });
          }
          return;
        }

        const { id: analysisId } = await submitRes.json();

        // Step 4: action=run — fire analysis job (fire-and-forget)
        fetch(`${SUPABASE_URL}/functions/v1/analyze?action=run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ id: analysisId, ...requestBody }),
        }).catch((err) => console.error(`${LOG_PREFIX} analyze: run error —`, err.message));

        // Return analysisId immediately — frontend will poll for status
        sendResponse({ status: 'submitted', analysisId });
      } catch (err) {
        console.error(`${LOG_PREFIX} analyze: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'get_analysis_status': {
      // Query analysis status and result from backend
      const auth = await getAuth();
      if (!auth?.session?.access_token) {
        sendResponse({ status: 'error', error: 'Please sign in first.' });
        return;
      }

      const { analysisId } = message;
      if (!analysisId) {
        sendResponse({ status: 'error', error: 'Missing analysisId' });
        return;
      }

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/analyze?id=${analysisId}`,
          {
            method: 'GET',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${auth.session.access_token}`,
            },
          }
        );

        if (!res.ok) {
          sendResponse({ status: 'error', error: 'Failed to get analysis status' });
          return;
        }

        const data = await res.json();
        sendResponse(data);
      } catch (err) {
        console.error(`${LOG_PREFIX} get_analysis_status: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'get_analysis_history': {
      try {
        const auth = await getAuth();
        if (!auth?.session?.access_token) {
          sendResponse({ status: 'success', analyses: [] });
          return;
        }
        const limit = message.limit ?? 8;
        const offset = message.offset ?? 0;
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/analyze?action=list&limit=${limit}&offset=${offset}`,
          {
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${auth.session.access_token}`,
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          sendResponse({ status: 'success', analyses: data.analyses || [] });
        } else {
          sendResponse({ status: 'success', analyses: [] });
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} get_analysis_history: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'share_analysis': {
      const auth = await getAuth();
      if (!auth?.session?.access_token) {
        sendResponse({ status: 'error', error: 'Please sign in first.' });
        return;
      }

      const { analysisId } = message;
      if (!analysisId) {
        sendResponse({ status: 'error', error: 'Missing analysisId' });
        return;
      }

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze?action=share`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${auth.session.access_token}`,
          },
          body: JSON.stringify({ analysisId }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: 'Failed to share analysis' }));
          sendResponse({ status: 'error', error: err.message || 'Failed to share analysis' });
          return;
        }

        const data = await res.json();
        sendResponse({ status: 'success', slug: data.slug, shareUrl: data.shareUrl });
      } catch (err) {
        console.error(`${LOG_PREFIX} share_analysis: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'PING': {
      try {
        const tabId = message.tabId || sender.tab?.id;
        if (!tabId) { sendResponse({ ok: false, error: 'NO_TAB_ID' }); return; }
        const response = await chrome.tabs.sendMessage(tabId, { action: 'PONG' });
        sendResponse({ ok: true, url: response?.url, title: response?.title, readyState: response?.readyState });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      break;
    }

    case 'INJECT_CONTENT_SCRIPT': {
      // DISABLED: content.js is injected declaratively via manifest.content_scripts.
      // Background PONG check + executeScript dual-injection caused AUTH_BRIDGE_SOURCE
      // redeclaration errors when manifest injection already loaded the script.
      // Manifest injection is sufficient and guaranteed by Chrome before any messages
      // are processed. Remove this handler entirely if you need programmatic injection.
      sendResponse({ success: true, note: 'disabled - use manifest injection' });
      break;
    }

    case 'GET_ACTIVE_TAB': {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ success: true, data: tab });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'EXTRACT_DATA':
    case 'EXTRACT_LISTING':
    case 'EXTRACT_LISTING_V2':
    case 'START_ANALYSIS':
    case 'GET_PAGE_STATE':
    case 'START_USER_EXTRACTION': {
      try {
        const tabId = message.tabId || sender.tab?.id;
        if (!tabId) { sendResponse({ error: 'NO_TAB_ID' }); return; }
        const response = await chrome.tabs.sendMessage(tabId, message);
        sendResponse(response);
      } catch (err) {
        sendResponse({ error: err.message });
      }
      break;
    }

    case 'REGISTER_LISTING_TAB': {
      const { tabId, listingUrl } = message;
      if (tabId && listingUrl) {
        _tabListingMap.set(tabId, listingUrl);
      }
      sendResponse({ success: true });
      break;
    }

    case 'REGISTER_LISTING_FROM_CS': {
      const tabId = sender.tab?.id;
      const listingUrl = message.listingUrl;
      if (tabId && listingUrl) {
        _tabListingMap.set(tabId, listingUrl);
      }
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ success: false, error: 'UNKNOWN_ACTION' });
  }
}

// injectContentScript DISABLED — content script is injected declaratively via
// manifest.content_scripts. Manifest injection is reliable and avoids double-
// injection issues (AUTH_BRIDGE_SOURCE redeclaration). Kept as a commented
// reference in case programmatic injection is ever needed again:
// async function injectContentScript(tabId) {
//   try { await chrome.tabs.sendMessage(tabId, { action: 'PONG' }); return; } catch (_) {}
//   await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
// }

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// OAuth helpers
function generateFlowId() {
  return `hs_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Validate an OAuth flow by flowId and optional callback tabId */
function validateOAuthFlow(flowId, callbackTabId) {
  const flow = _oauthFlows.get(flowId);
  if (!flow) {
    return { valid: false, reason: 'flow_not_found' };
  }
  if (flow.used) {
    return { valid: false, reason: 'flow_already_used' };
  }
  if (callbackTabId != null && flow.loginTabId === callbackTabId) {
    return { valid: false, reason: 'callback_is_login_tab' };
  }
  flow.used = true;
  return { valid: true };
}

// ===== OAuth Flow: 监听 callback 标签页打开/更新 =====
// 注意：Supabase OAuth 使用"原地重定向"（在同一个标签页从 /login 重定向到 /auth/callback）
// 因此需要同时监听 onCreated（外部打开的链接）和 onUpdated（重定向）

/** 从完整 tab URL 提取 flow_id（query 或 hash 片段里的 flow_id） */
function extractFlowIdFromTabUrl(urlString) {
  try {
    const u = new URL(urlString);
    let fid = u.searchParams.get('flow_id');
    if (fid) return fid;
    if (u.hash && u.hash.length > 1) {
      const hp = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
      fid = hp.get('flow_id');
      if (fid) return fid;
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} [flow] extractFlowIdFromTabUrl parse error: ${e.message}`);
  }
  return null;
}

function handleCallbackTab(tabId, url) {
  // 同时支持 /auth/callback 和根路径 /（Supabase 有时会回跳到根路径带 code 参数）
  const isCallback =
    url.includes('/auth/callback') ||
    (url.includes('tryhomescope.com/') && url.includes('code='));
  if (!isCallback) return;

  let flowId = extractFlowIdFromTabUrl(url);

  // 无 flow_id 时：OAuth 隐式回跳常把 query 清掉，用「同一 tab = 扩展打开的 loginTab」兜底
  if (!flowId) {
    for (const [fid, flow] of _oauthFlows.entries()) {
      if (flow.used) continue;
      if (flow.loginTabId === tabId) {
        flowId = fid;
        flow.callbackTabId = tabId;
        return;
      }
    }
    console.warn(`${LOG_PREFIX} [flow] no flow_id in URL and no loginTabId match for tabId=${tabId}`);
    return;
  }

  const flow = _oauthFlows.get(flowId);
  if (flow) {
    const prevCallbackTabId = flow.callbackTabId;
    flow.callbackTabId = tabId;
  } else {
    console.warn(`${LOG_PREFIX} [flow] flowId=${flowId} not found or expired (may have already been used/consumed)`);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  handleCallbackTab(tab.id, tab.url || '');
});

// 监听标签页 URL 变化（OAuth 完成后从 /login 重定向到 /auth/callback）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  handleCallbackTab(tabId, tab.url || '');
});

// Token refresh scheduler (prevents 7-day Supabase expiry)
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
let _refreshTimer = null;

async function scheduleTokenRefresh() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }

  _refreshTimer = setTimeout(async () => {
    const result = await refreshSessionIfNeeded();
    if (result) {
      scheduleTokenRefresh();
    }
  }, REFRESH_INTERVAL_MS);
}

// Kick off on every service worker startup
scheduleTokenRefresh();

// Re-schedule when Chrome restarts (fires once per browser session)
chrome.runtime.onStartup.addListener(() => {
  scheduleTokenRefresh();
});

// Re-schedule when extension is updated or reloaded
chrome.runtime.onInstalled.addListener((details) => {
  scheduleTokenRefresh();
});
