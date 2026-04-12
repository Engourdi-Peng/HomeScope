/**
 * HomeScope Background Service Worker
 *
 * Auth architecture: background is the SINGLE SOURCE OF TRUTH for extension auth.
 *
 * Session storage:
 *   - Primary (persistent): chrome.storage.local { hs_session, hs_user }
 *   - Runtime cache: _cachedAuth (in-memory, avoids repeated storage reads)
 *
 * Auth flow:
 *   1. User clicks login in side panel → background opens website login page with flowId
 *   2. User completes Google OAuth on website
 *   3. AuthCallback.tsx injects a <script> tag that calls chrome.runtime.sendMessage
 *   4. Background receives sync_session_from_site
 *      - ALWAYS saves session (even if flow validation fails — fallback for race conditions)
 *      - ALWAYS broadcasts auth change to extension contexts
 *      - ONLY closes the callback tab if flowId is present (extension-initiated flow)
 *        → web-initiated login (no flowId): tab stays open, user sees the success page
 *
 * Tab-closing policy:
 *   - Extension flow (flowId exists): close the callback tab after session sync
 *   - Web flow (no flowId): do NOT close any tab — user should see the success message
 */

// ===== Injected config (replaced by vite at build time) =====
const SUPABASE_URL = __SUPABASE_URL__;
const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
const MAGIC_LINK_REDIRECT = __MAGIC_LINK_REDIRECT__;

// ===== Image collection DISABLED =====
// REMOVED: chrome.webRequest.onCompleted auto-collected gallery images on page load.
// Policy: "严禁后台预抓图库图片" — image collection is now exclusively user-triggered.
// All gallery image collection must go through the START_USER_EXTRACTION flow in content.js.

// ===== tabId → listingUrl mapping (valid for service worker lifetime) =====
const _tabListingMap = new Map();

// ===== OAuth Flow Management (双重校验) =====
// 记录扩展发起的 OAuth 登录流程，用于回调时验证
const _oauthFlows = new Map();
// flow 超时时间：10 分钟
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

// 生成唯一的 flowId
function generateFlowId() {
  return `hs_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// 清理超时的 flow
function cleanupExpiredFlows() {
  const now = Date.now();
  for (const [flowId, flow] of _oauthFlows.entries()) {
    if (now - flow.createdAt > FLOW_TIMEOUT_MS) {
      _oauthFlows.delete(flowId);
      console.log(`${LOG_PREFIX} [flow] expired and cleaned: ${flowId}`);
    }
  }
}

// 开始 OAuth 流程时调用
function startOAuthFlow(loginTabId, callbackTabId) {
  const flowId = generateFlowId();
  _oauthFlows.set(flowId, {
    loginTabId,
    callbackTabId,
    createdAt: Date.now(),
    used: false,
  });
  console.log(`${LOG_PREFIX} [flow] started: ${flowId}, loginTab=${loginTabId}, callbackTab=${callbackTabId}`);
  return flowId;
}

// 验证 OAuth 流程
function validateOAuthFlow(flowId, senderTabId) {
  cleanupExpiredFlows();
  
  const flow = _oauthFlows.get(flowId);
  if (!flow) {
    console.warn(`${LOG_PREFIX} [flow] validate FAILED: flowId=${flowId} not found or expired`);
    return { valid: false, reason: 'FLOW_NOT_FOUND' };
  }
  
  if (flow.used) {
    console.warn(`${LOG_PREFIX} [flow] validate FAILED: flowId=${flowId} already used`);
    return { valid: false, reason: 'FLOW_ALREADY_USED' };
  }
  
  // 双重校验：flowId 匹配 + sender.tab.id 匹配预期 callbackTabId
  if (flow.callbackTabId !== senderTabId) {
    // 竞态条件处理：如果 callbackTabId 还未更新，但 senderTabId 是有效的 callback tab
    if (flow.callbackTabId === null && senderTabId !== null) {
      console.warn(`${LOG_PREFIX} [flow] validate WARNING: callbackTabId not yet updated (race condition), updating to senderTabId=${senderTabId}`);
      flow.callbackTabId = senderTabId;
    } else {
      console.warn(`${LOG_PREFIX} [flow] validate FAILED: sender.tab.id mismatch. expected=${flow.callbackTabId}, got=${senderTabId}`);
      return { valid: false, reason: 'TAB_ID_MISMATCH' };
    }
  }
  
  // 标记为已使用（防止重放攻击）
  flow.used = true;
  _oauthFlows.delete(flowId);
  
  console.log(`${LOG_PREFIX} [flow] validate SUCCESS: ${flowId}`);
  return { valid: true, flow };
}

const LOG_PREFIX = '[HomeScope BG]';

// ===== Auth: single source of truth =====

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

// ── Token redaction helper (只打印前6后4位) ──
function redactToken(token) {
  if (!token || typeof token !== 'string') return 'null';
  if (token.length <= 12) return token.substring(0, 3) + '...';
  return token.substring(0, 6) + '...' + token.substring(token.length - 4);
}

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

  console.log(`${LOG_PREFIX} migrateLegacySession: checking for legacy session...`);

  // Check if already migrated
  const migrationFlag = await chrome.storage.local.get(HS_AUTH_MIGRATED_KEY);
  if (migrationFlag[HS_AUTH_MIGRATED_KEY] === true) {
    console.log(`${LOG_PREFIX} migrateLegacySession: already migrated, skipping`);
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
          console.log(`${LOG_PREFIX} migrateLegacySession: found legacy session in storage key=${key}`);
          break;
        }
      } catch (_) {}
    }
  }

  // Try Supabase cookie fallback
  if (!legacySession) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: '.supabase.co' });
      for (const c of cookies) {
        if (c.name.startsWith('sb-') && c.name.endsWith('-auth-token') && c.value) {
          try {
            const decoded = decodeURIComponent(c.value);
            const parsed = JSON.parse(decoded);
            const sess = parsed?.currentSession || parsed;
            if (sess?.access_token && sess?.user) {
              legacySession = { access_token: sess.access_token, refresh_token: sess.refresh_token, user: sess.user };
              console.log(`${LOG_PREFIX} migrateLegacySession: found legacy session in cookie name=${c.name}`);
              break;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  if (legacySession) {
    const extUser = toExtUser(legacySession.user);
    const session = { access_token: legacySession.access_token, refresh_token: legacySession.refresh_token || '' };
    await chrome.storage.local.set({
      [HS_SESSION_KEY]: session,
      [HS_USER_KEY]: extUser,
      [HS_AUTH_MIGRATED_KEY]: true,
    });
    _cachedAuth = { user: extUser, session };
    console.log(`${LOG_PREFIX} migrateLegacySession: migrated successfully, userId=${extUser?.id}`);
  } else {
    // No legacy session found — just mark migration complete
    await chrome.storage.local.set({ [HS_AUTH_MIGRATED_KEY]: true });
    console.log(`${LOG_PREFIX} migrateLegacySession: no legacy session, migration marked complete`);
  }
}

// ----- Primary session getter (cache → migrated storage only) -----
// NOTE: Prefer getAuth() for API calls — it auto-refreshes expired tokens.
// Use getSession() only when you need to check login state without making API calls.
async function getSession() {
  // 1. In-memory cache
  if (_cachedAuth) {
    console.log(`${LOG_PREFIX} getSession: cache HIT → userId=${_cachedAuth.user?.id}, hasAccessToken=${!!_cachedAuth.session?.access_token}, hasRefreshToken=${!!_cachedAuth.session?.refresh_token}`);
    return _cachedAuth;
  }

  // 2. One-time legacy migration (runs at most once per service worker lifetime)
  await migrateLegacySession();

  // 3. Canonical storage keys ONLY
  const stored = await chrome.storage.local.get([HS_SESSION_KEY, HS_USER_KEY]);
  if (stored[HS_SESSION_KEY] && stored[HS_USER_KEY]) {
    _cachedAuth = { session: stored[HS_SESSION_KEY], user: stored[HS_USER_KEY] };
    console.log(`${LOG_PREFIX} getSession: canonical storage HIT → userId=${stored[HS_USER_KEY]?.id}, hasAccessToken=${!!stored[HS_SESSION_KEY]?.access_token}, hasRefreshToken=${!!stored[HS_SESSION_KEY]?.refresh_token}, accessToken=${redactToken(stored[HS_SESSION_KEY]?.access_token)}`);
    return _cachedAuth;
  }

  console.log(`${LOG_PREFIX} getSession: no session found (cache miss + storage miss)`);
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
  console.log(`${LOG_PREFIX} saveSession: called from="${source}" userId=${user?.id}`);
  console.log(`${LOG_PREFIX} saveSession: session payload — hasAccessToken=${!!session?.access_token}, hasRefreshToken=${!!session?.refresh_token}, accessToken=${redactToken(session?.access_token)}`);

  try {
    await chrome.storage.local.set({
      [HS_SESSION_KEY]: session,
      [HS_USER_KEY]: user,
    });
    console.log(`${LOG_PREFIX} saveSession: written to chrome.storage.local`);

    // 立即重新读取验证
    const verification = await chrome.storage.local.get([HS_SESSION_KEY, HS_USER_KEY]);
    const verified = verification[HS_SESSION_KEY] && verification[HS_USER_KEY];
    console.log(`${LOG_PREFIX} saveSession: verification=${verified ? 'PASS' : 'FAIL'} — re-read hasSession=${!!verification[HS_SESSION_KEY]}, hasUser=${!!verification[HS_USER_KEY]}`);

    _cachedAuth = { user, session };
    console.log(`${LOG_PREFIX} saveSession: in-memory cache updated`);
    _authListeners.forEach((cb) => cb(user));
    console.log(`${LOG_PREFIX} saveSession: notifying ${_authListeners.length} auth listeners`);
    console.log(`${LOG_PREFIX} saveSession: complete, userId=${user?.id}`);
  } catch (err) {
    console.error(`${LOG_PREFIX} saveSession: FAILED — ${err.message}`);
    throw err;
  }
}

// ----- Clear session -----
async function clearSession(reason = 'unknown') {
  console.log(`${LOG_PREFIX} clearSession: reason="${reason}"`);
  await chrome.storage.local.remove([HS_SESSION_KEY, HS_USER_KEY]);
  console.log(`${LOG_PREFIX} clearSession: removed hs_session and hs_user from storage`);
  _cachedAuth = null;
  console.log(`${LOG_PREFIX} clearSession: in-memory cache cleared`);
  _authListeners.forEach((cb) => cb(null));
  console.log(`${LOG_PREFIX} clearSession: notified ${_authListeners.length} listeners`);
}

// ----- Broadcast auth change to all extension contexts -----
function broadcastAuthChanged(authenticated, user) {
  console.log(`${LOG_PREFIX} broadcastAuthChanged: BEFORE — authenticated=${authenticated}, userId=${user?.id || 'none'}`);
  try {
    chrome.runtime.sendMessage(
      { action: 'auth_status_changed', authenticated, user: user || undefined },
      () => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          console.warn(`${LOG_PREFIX} broadcastAuthChanged: chrome.runtime.lastError=`, lastErr.message);
        } else {
          console.log(`${LOG_PREFIX} broadcastAuthChanged: sent OK`);
        }
      }
    );
    console.log(`${LOG_PREFIX} broadcastAuthChanged: AFTER — message dispatched`);
  } catch (err) {
    console.error(`${LOG_PREFIX} broadcastAuthChanged: EXCEPTION —`, err.message);
  }
}

// ----- Send Magic Link via Supabase Auth API -----
async function rpcSendMagicLink(email) {
  console.log(`${LOG_PREFIX} send_magic_link: email=${email}`);
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
  } else {
    console.log(`${LOG_PREFIX} send_magic_link: success`);
  }
  return data;
}

// ----- Token refresh -----
async function refreshSessionIfNeeded() {
  const stored = await getSession();
  if (!stored?.session?.refresh_token) {
    console.log(`${LOG_PREFIX} refreshSessionIfNeeded: skip — no refresh_token (session=${!!stored}, refresh_token=${!!stored?.session?.refresh_token})`);
    return stored;
  }

  console.log(`${LOG_PREFIX} refreshSessionIfNeeded: attempting refresh...`);
  console.log(`${LOG_PREFIX} refreshSessionIfNeeded: refresh_token=${redactToken(stored.session.refresh_token)}`);
  console.log(`${LOG_PREFIX} refreshSessionIfNeeded: userId=${stored.user?.id}`);

  try {
    const refreshUrl = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
    console.log(`${LOG_PREFIX} refreshSessionIfNeeded: POST ${refreshUrl}`);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token: stored.session.refresh_token }),
    });

    console.log(`${LOG_PREFIX} refreshSessionIfNeeded: response status=${res.status}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`${LOG_PREFIX} refreshSessionIfNeeded: SUCCESS — new access_token=${redactToken(data.access_token)}, hasRefreshToken=${!!data.refresh_token}`);
      await saveSession(data, stored.user);
      console.log(`${LOG_PREFIX} refreshSessionIfNeeded: session updated in storage`);
      return { session: data, user: stored.user };
    } else {
      // 读取错误响应体（用于诊断）
      let errBody = {};
      try {
        errBody = await res.json();
      } catch (_) {}
      const errMsg = errBody?.error_description || errBody?.msg || errBody?.message || '';
      const errCode = errBody?.error || '';
      console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: FAILED status=${res.status} error_code="${errCode}" error_msg="${errMsg}"`);

      // 区分错误类型：
      // - invalid_grant: refresh_token 无效或已过期（用户需重新登录）
      // - invalid_request / malformed: 请求本身有问题
      if (errCode === 'invalid_grant' || res.status === 400) {
        console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: invalid_grant detected — clearing session (user must re-login)`);
        await clearSession('refresh_failure');
        broadcastAuthChanged(false, null);
      } else {
        // 其他错误（网络问题、服务器错误）— 暂时保留旧 session
        console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: non-token error (status=${res.status}) — keeping session, will retry later`);
      }
      return null;
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: FAILED (network exception) — ${err.message} — keeping session, will retry later`);
    return null;
  }
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
      console.log(`${LOG_PREFIX} check_auth_status: checking...`);
      try {
        await refreshSessionIfNeeded();
        const auth = await getSession();
        const state = auth?.user ? 'authenticated' : 'unauthenticated';
        console.log(`${LOG_PREFIX} check_auth_status: state=${state}, userId=${auth?.user?.id}`);
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
      console.log(`${LOG_PREFIX} initiate_google_oauth: opening login page`);
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
        
        console.log(`${LOG_PREFIX} initiate_google_oauth: opened login page, flowId=${flowId}`);
        sendResponse({ success: true, opened_login_page: true, flowId });
      } catch (err) {
        console.error(`${LOG_PREFIX} initiate_google_oauth: error —`, err.message);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'logout': {
      console.log(`${LOG_PREFIX} message: logout received`);
      try {
        await clearSession('user_action');
        broadcastAuthChanged(false, null);
        console.log(`${LOG_PREFIX} logout: complete`);
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
      console.log(`${LOG_PREFIX} message: sync_session_from_site received`);
      try {
        const p = message.payload;
        const flowId = p?.flowId;
        console.log(`${LOG_PREFIX} sync_session_from_site: payload check — hasAccessToken=${!!p?.access_token}, hasRefreshToken=${!!p?.refresh_token}, userId=${p?.user?.id || 'missing'}, flowId=${flowId || 'MISSING'}, accessToken=${redactToken(p?.access_token)}`);

        if (!p?.access_token || !p?.user) {
          console.error(`${LOG_PREFIX} sync_session_from_site: INVALID payload — missing access_token or user`);
          sendResponse({ success: false, error: 'Invalid session payload' });
          return;
        }

        // 获取 callback tab id（content script → background 的标准 sender）
        const senderTabId = sender?.tab?.id ?? null;
        console.log(`${LOG_PREFIX} sync_session_from_site: senderTabId=${senderTabId}, flowId=${flowId}`);

        // 双重校验：验证 flowId 和 sender.tab.id
        // 注意：即使校验失败（竞态条件等），仍然保存 session 以确保用户体验
        if (flowId) {
          const validation = validateOAuthFlow(flowId, senderTabId);
          if (!validation.valid) {
            console.warn(`${LOG_PREFIX} sync_session_from_site: flow validation FAILED (${validation.reason}) — saving session anyway (fallback mode, tab will NOT be closed)`);
            // 继续保存 session，但不关闭标签页
          } else {
            console.log(`${LOG_PREFIX} sync_session_from_site: flow validation PASSED`);
          }
        } else {
          // 旧版兼容：如果没有 flowId，检查是否有合法的 callback tab
          if (senderTabId == null) {
            const tabs = await chrome.tabs.query({ url: '*://*.tryhomescope.com/auth/callback*' });
            const fallbackTabId = tabs[0]?.id ?? null;
            console.warn(`${LOG_PREFIX} sync_session_from_site: no flowId, using fallback tab detection: ${fallbackTabId}`);
            if (fallbackTabId == null) {
              console.error(`${LOG_PREFIX} sync_session_from_site: BLOCKED — no flowId and no callback tab detected`);
              sendResponse({ success: false, error: 'No valid OAuth flow found' });
              return;
            }
          }
        }

        const session = { access_token: p.access_token, refresh_token: p.refresh_token || '' };
        const extUser = toExtUser(p.user);
        console.log(`${LOG_PREFIX} sync_session_from_site: calling saveSession...`);
        await saveSession(session, extUser, 'oauth_callback');

        console.log(`${LOG_PREFIX} sync_session_from_site: calling broadcastAuthChanged(true, userId=${extUser?.id})...`);
        broadcastAuthChanged(true, extUser);
        console.log(`${LOG_PREFIX} sync_session_from_site: complete, userId=${extUser?.id}`);

        // ── 关闭回调标签页的条件（双重保护）──
        // 条件 1: flowId 存在（扩展主动发起的登录流程）
        // 条件 2: senderTabId 有效（background 有权限关闭的标签页）
        // 普通网页登录（无 flowId）时，即使 background 收到了 session 也不关闭任何标签页
        if (flowId && senderTabId != null) {
          console.log(`${LOG_PREFIX} sync_session_from_site: closing callback tab ${senderTabId} (extension-initiated flow)...`);
          chrome.tabs.remove(senderTabId).catch((err) => {
            console.warn(`${LOG_PREFIX} sync_session_from_site: failed to close tab — ${err.message}`);
          });
        } else {
          console.log(`${LOG_PREFIX} sync_session_from_site: NOT closing tab — flowId=${flowId || 'null'} (web-initiated login, tab stays open)`);
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

      // Step 2: Map listingData → AnalyzeRequest body
      const listingData = message.data;
      const imageUrls = listingData?.imageUrls || listingData?.images || [];
      const description = listingData?.description || listingData?.rawText || '';
      const requestBody = {
        imageUrls,
        description,
        // 自动检测的报告模式（来自 content.js detectReportMode）
        reportMode: listingData?.reportMode || 'sale',
        optionalDetails: {
          weeklyRent: listingData?.price || listingData?.priceText,
          suburb: listingData?.address,
          bedrooms: listingData?.bedrooms != null ? String(listingData.bedrooms) : undefined,
          bathrooms: listingData?.bathrooms != null ? String(listingData.bathrooms) : undefined,
          parking: listingData?.parking != null ? String(listingData.parking) : undefined,
        },
      };

      // Step 3: action=submit — create analysis record and return analysisId
      try {
        const submitRes = await fetch(`${SUPABASE_URL}/functions/v1/analyze?action=submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
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
        console.log(`${LOG_PREFIX} analyze: submitted, analysisId=${analysisId}`);

        // Step 4: action=run — fire analysis job (fire-and-forget)
        fetch(`${SUPABASE_URL}/functions/v1/analyze?action=run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
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
              'apikey': SUPABASE_ANON_KEY,
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
              'apikey': SUPABASE_ANON_KEY,
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
            'apikey': SUPABASE_ANON_KEY,
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
        console.log(`${LOG_PREFIX} REGISTER_LISTING_TAB tabId=${tabId} url=${listingUrl}`);
      }
      sendResponse({ success: true });
      break;
    }

    case 'REGISTER_LISTING_FROM_CS': {
      const tabId = sender.tab?.id;
      const listingUrl = message.listingUrl;
      if (tabId && listingUrl) {
        _tabListingMap.set(tabId, listingUrl);
        console.log(`${LOG_PREFIX} REGISTER_LISTING_FROM_CS tabId=${tabId} url=${listingUrl}`);
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

// ----- Sleep helper -----
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch?.(() => {});

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

  console.log(`${LOG_PREFIX} [flow] callback detected: tabId=${tabId}, url=${url.substring(0, 150)}`);

  let flowId = extractFlowIdFromTabUrl(url);

  // 无 flow_id 时：OAuth 隐式回跳常把 query 清掉，用「同一 tab = 扩展打开的 loginTab」兜底
  if (!flowId) {
    for (const [fid, flow] of _oauthFlows.entries()) {
      if (flow.used) continue;
      if (flow.loginTabId === tabId) {
        flowId = fid;
        flow.callbackTabId = tabId;
        console.log(`${LOG_PREFIX} [flow] linked callback tab ${tabId} to flow ${flowId} via loginTabId match (no flow_id in URL)`);
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
    console.log(`${LOG_PREFIX} [flow] callback tab linked to flow: ${flowId}, tabId=${tabId}, previousCallbackTabId=${prevCallbackTabId}, loginTabId=${flow.loginTabId}, used=${flow.used}`);
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

// ===== Token refresh scheduler (prevents 7-day Supabase expiry) =====
// Runs on extension startup and periodically to keep the session alive.
// Only re-schedules on success; failure means token is expired → user must re-login.

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours — well within Supabase 7-day window
let _refreshTimer = null;

async function scheduleTokenRefresh() {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }

  _refreshTimer = setTimeout(async () => {
    console.log(`${LOG_PREFIX} [scheduler] refreshing token...`);
    const result = await refreshSessionIfNeeded();
    if (result) {
      console.log(`${LOG_PREFIX} [scheduler] refresh OK, re-scheduling`);
      scheduleTokenRefresh();
    } else {
      console.log(`${LOG_PREFIX} [scheduler] refresh failed (token expired), will not re-schedule`);
    }
  }, REFRESH_INTERVAL_MS);
}

// Kick off on every service worker startup
scheduleTokenRefresh();

// Re-schedule when Chrome restarts (fires once per browser session)
chrome.runtime.onStartup.addListener(() => {
  console.log(`${LOG_PREFIX} [startup] browser started, scheduling token refresh`);
  scheduleTokenRefresh();
});

// Re-schedule when extension is updated or reloaded
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${LOG_PREFIX} [installed] reason=${details.reason}, scheduling token refresh`);
  scheduleTokenRefresh();
});
