/**
 * HomeScope Background Service Worker
 * Handles auth, API communication, and analysis submission.
 */
// ===== Injected config (replaced by vite at build time) =====
const SUPABASE_URL = __SUPABASE_URL__;
const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
const SUPABASE_US_URL = __SUPABASE_US_URL__;
const SUPABASE_US_ANON_KEY = __SUPABASE_US_ANON_KEY__;
const MAGIC_LINK_REDIRECT = __MAGIC_LINK_REDIRECT__;

// ===== Image collection DISABLED =====
// REMOVED: chrome.webRequest.onCompleted auto-collected gallery images on page load.
// Policy: "严禁后台预抓图库图片" �?image collection is now exclusively user-triggered.
// All gallery image collection must go through the START_USER_EXTRACTION flow in content.js.

// tabId �?listingUrl mapping (valid for service worker lifetime)
const _tabListingMap = new Map();

// analysisId �?serverConfig mapping (memory, for fast access)
const _analysisServerMap = new Map();

// storage key prefix for server config persistence across SW restarts
const HS_ANALYSIS_SERVER_PREFIX = 'hs_analysis_server_';

// OAuth flow tracking
const _oauthFlows = new Map();

// Dedupes in-flight analyze_basic requests by dedupeKey to avoid duplicate LLM calls
const _basicDedupeSet = new Set();

const LOG_PREFIX = '[HomeScope BG]';
const DEBUG_MODE = false;

// ── SW keep-alive via chrome.alarms ────────────────────────────────────────
// Prevents MV3 service worker from being killed during long-running analyze requests.
// Alarm fires every ~50s; if SW is already active it has no effect.
const HS_ALIVE_ALARM = 'hs_keep_alive';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HS_ALIVE_ALARM) {
    // No-op ping �?just keeps SW alive
    console.debug(`${LOG_PREFIX} [ALIVE] keep-alive tick`);
  }
});

function ensureAlive() {
  // Creates (or updates) the alarm. periodInMinutes=1 means it fires every ~1 min.
  // The SW lifecycle extends for at least 30s past the last event, so this
  // effectively keeps SW alive as long as the alarm exists.
  chrome.alarms.create(HS_ALIVE_ALARM, { periodInMinutes: 1 });
}

function clearAlive() {
  chrome.alarms.clear(HS_ALIVE_ALARM);
}

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
// Once refresh token is invalid (invalid_grant), permanently stop refresh attempts
let _refreshTokenInvalid = false;
// Guard: when syncing a new session from site, clearSession must NOT wipe it
// (prevents race where refresh failure clears session right before sync_session_from_site saves it)
let _syncingSession = false;
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

// ── Unified Edge Function request headers ──
// All /functions/v1/* calls MUST use this helper.
// - apikey: SUPABASE_ANON_KEY (AU server) or serverConfig.anonKey (US server) �?required for all requests
// - Authorization: Bearer <user access token> if logged in, otherwise Bearer <anon key> for anonymous access
function buildSupabaseFunctionHeaders(accessToken, serverConfig) {
  const anonKey = serverConfig?.anonKey || SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY');
  }
  // Prefer user token if available; fall back to anon key for anonymous requests
  const bearer = accessToken || anonKey;
  return {
    'Content-Type': 'application/json',
    'apikey': anonKey,
    'Authorization': `Bearer ${bearer}`,
  };
}

// ── Helper: Determine API URL based on source domain ──
// US sources (zillow.com, realtor.com) -> US server, AU sources -> AU server
function getAnalyzeApiUrl(sourceDomain) {
  if (sourceDomain && (sourceDomain.includes('zillow') || sourceDomain.includes('realtor'))) {
    if (SUPABASE_US_URL) {
      return { url: SUPABASE_US_URL, anonKey: SUPABASE_US_ANON_KEY, isUS: true };
    }
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, isUS: false };
}

// ── Helper: Derive source info from listingData + URL ──────────────────────────────────────────────
// Returns a unified source info object used by both plugin and backend for market routing.
// This function is the SINGLE SOURCE OF TRUTH for source/market determination in the extension.
function deriveListingSourceInfo(listingData, tabUrl) {
  // listingUrl: prefer listingData.url > tabUrl > listingData.source?.url
  const listingUrl = listingData?.url || tabUrl || listingData?.source?.url || '';

  // ── Step 1: Try listingData.source (most reliable) ─────────────────────────────────────
  const rawSource = listingData?.source;

  // Case A: source is a string (e.g. 'zillow' from ZillowExtractor)
  if (typeof rawSource === 'string' && rawSource) {
    const src = rawSource.toLowerCase();
    if (src.includes('zillow')) {
      return { source: 'zillow', sourceDomain: 'zillow.com', market: 'US', listingUrl };
    }
    if (src.includes('realtor')) {
      return { source: 'realtor', sourceDomain: 'realtor.com', market: 'US', listingUrl };
    }
    if (src.includes('realestate-au') || src === 'realestate-au') {
      return { source: 'realestate-au', sourceDomain: 'realestate.com.au', market: 'AU', listingUrl };
    }
    if (src.includes('domain-au') || src === 'domain-au') {
      return { source: 'domain-au', sourceDomain: 'domain.com.au', market: 'AU', listingUrl };
    }
  }

  // Case B: source is an object { domain, url, parserType }
  if (rawSource && typeof rawSource === 'object') {
    const domain = (rawSource.domain || rawSource.url || '').toLowerCase();
    if (domain.includes('zillow.com') || domain.includes('zillow')) {
      return { source: 'zillow', sourceDomain: domain.includes('.') ? domain : 'zillow.com', market: 'US', listingUrl };
    }
    if (domain.includes('realtor.com') || domain.includes('realtor')) {
      return { source: 'realtor', sourceDomain: domain.includes('.') ? domain : 'realtor.com', market: 'US', listingUrl };
    }
    if (domain.includes('realestate.com.au') || domain.includes('realestate')) {
      return { source: 'realestate-au', sourceDomain: domain.includes('.') ? domain : 'realestate.com.au', market: 'AU', listingUrl };
    }
    if (domain.includes('domain.com.au') || domain.includes('domain')) {
      return { source: 'domain-au', sourceDomain: domain.includes('.') ? domain : 'domain.com.au', market: 'AU', listingUrl };
    }
  }

  // ── Step 2: URL fallback �?NEVER let zillow/realtor return null ───────────────────────
  const urlLower = listingUrl.toLowerCase();
  if (urlLower.includes('zillow.com') || urlLower.includes('zillow')) {
    return { source: 'zillow', sourceDomain: 'zillow.com', market: 'US', listingUrl };
  }
  if (urlLower.includes('realtor.com') || urlLower.includes('realtor')) {
    return { source: 'realtor', sourceDomain: 'realtor.com', market: 'US', listingUrl };
  }
  if (urlLower.includes('realestate.com.au')) {
    return { source: 'realestate-au', sourceDomain: 'realestate.com.au', market: 'AU', listingUrl };
  }
  if (urlLower.includes('domain.com.au')) {
    return { source: 'domain-au', sourceDomain: 'domain.com.au', market: 'AU', listingUrl };
  }

  // ── Step 3: No match found �?UNKNOWN ──────────────────────────────────────────────────
  return { source: null, sourceDomain: '', market: 'UNKNOWN', listingUrl };
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

  // Migration complete �?cookies fallback removed (no legacy users, privacy-safe)

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
    // No legacy session found �?just mark migration complete
    await chrome.storage.local.set({ [HS_AUTH_MIGRATED_KEY]: true });
  }
}

// ----- JWT helpers: extract `exp` claim from Supabase access_token -----
// Supabase access_token is a JWT. We decode the payload (base64url) WITHOUT
// verifying signature �?the server already verified it on issue. We only need
// the `exp` claim to decide whether to refresh.
//
// Returns the expiry timestamp in seconds, or null if it can't be extracted.
function _getAccessTokenExpirySeconds(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') return null;
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    // base64url �?base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob is available in MV3 service workers
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(json);
    if (typeof payload.exp === 'number') return payload.exp;
    return null;
  } catch (_) {
    return null;
  }
}

// ----- Primary session getter (cache �?migrated storage only) -----
// NOTE: Prefer getAuth() for API calls �?it auto-refreshes expired tokens.
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
// After refresh, re-reads from storage to get the new tokens (not from in-memory cache).
async function getAuth() {
  await refreshSessionIfNeeded();
  // Re-read from storage after refresh so we get the new tokens
  const session = await getSession();
  return session;
}

// ----- Save session to canonical storage -----
// silent: when true, skip broadcasting to sidepanel. Use for background
// housekeeping like token refresh �?those should NOT cause the sidepanel
// to re-render or refetch user data. For real login events (oauth callback),
// pass silent=false (default) to notify the sidepanel.
async function saveSession(session, user, source = 'unknown', silent = false) {
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

    // Only broadcast for real auth events (login/logout), not for background
    // token refresh. Broadcasting on refresh was causing the sidepanel to
    // re-fetch user data, which triggered another refresh, creating a loop.
    if (!silent) {
      broadcastAuthChanged(true, user);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} saveSession: FAILED �?${err.message}`);
    throw err;
  }
}

// ----- Clear session -----
async function clearSession(reason = 'unknown') {
  // Guard: if a new session is being synced in, skip storage clear
  // to avoid wiping the session right before saveSession writes it
  if (_syncingSession) {
    _cachedAuth = null;
    _authListeners.forEach((cb) => cb(null));
    return;
  }
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

// ----- Token refresh (SINGLE-FLIGHT: only background.js calls this) -----
// Rules:
// - Only background.js calls this; sidepanel/store.tsx MUST NOT call refresh directly
// - Only one in-flight refresh at a time (_refreshLock)
// - On invalid_grant / "Already Used": set _refreshTokenInvalid = true, clear session, STOP
// - On success: atomically save full new session (access_token + refresh_token + expires_at)
// - On no refresh_token: return null immediately (do NOT call endpoint)
// - After _refreshTokenInvalid = true: all subsequent refresh attempts return null
// Refresh the access token ONLY IF it is expired or about to expire.
// Supabase access_token lifetime is 1 hour by default. We refresh when there
// is < 5 minutes remaining �?this prevents per-request token churn (which was
// causing infinite refresh/data-fetch loops in the sidepanel).
const TOKEN_REFRESH_BUFFER_SEC = 5 * 60;

async function refreshSessionIfNeeded() {
  // 1. Permanent stop flag �?set after invalid_grant
  if (_refreshTokenInvalid) {
    return null;
  }

  // 2. If another refresh is already in flight, wait for it
  if (_refreshLock) {
    return _refreshLock;
  }

  // 3. Start refresh
  _refreshLock = (async () => {
    const stored = await getSession();

    // 4. No session at all �?return null
    if (!stored?.session) {
      return null;
    }

    // 5. No refresh_token �?return null immediately (do NOT call endpoint)
    if (!stored.session.refresh_token) {
      return null;
    }

    // 6. Skip refresh if access_token still has plenty of life left.
    //    This is the critical fix for the per-request refresh churn loop.
    const expSec = _getAccessTokenExpirySeconds(stored.session.access_token);
    if (expSec != null) {
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = expSec - nowSec;
      if (remainingSec > TOKEN_REFRESH_BUFFER_SEC) {
        return { session: stored.session, user: stored.user };
      }
    }
    // If we can't read exp (no exp claim or decode error), fall through to refresh.

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

        // Atomically save the FULL new session (access_token + refresh_token + user)
        // CRITICAL: must save the new refresh_token, not the old one.
        // Use silent=true so we DON'T broadcast to sidepanel �?token refresh is a
        // background housekeeping operation, not a login event. Broadcasting here
        // was triggering sidepanel to re-fetch user data, which in turn triggered
        // another getAuth() �?refreshSessionIfNeeded() call, creating an infinite
        // refresh loop on every page load.
        await saveSession(data, stored.user, 'refresh', true);
        return { session: data, user: stored.user };
      } else {
        let errBody = {};
        try { errBody = await res.json(); } catch (_) {}
        const errMsg = errBody?.error_description || errBody?.msg || errBody?.message || '';
        const errCode = errBody?.error || '';
        console.error(`${LOG_PREFIX} refreshSessionIfNeeded: refresh failed - status=${res.status}, code=${errCode}, msg=${errMsg}`);

        const isReuseError = errMsg.toLowerCase().includes('already used');
        const isInvalidGrant = errCode === 'invalid_grant' || res.status === 400;

        if (isInvalidGrant) {
          // CRITICAL: permanent stop flag �?prevents infinite retry loops
          _refreshTokenInvalid = true;
          await clearSession('refresh_failure');
          broadcastAuthChanged(false, null);
        }
        // Non-retryable errors (network/server): return null but keep old session for now
        return null;
      }
    } catch (err) {
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

    case 'RATE_WARNING': {
      // Forward rate warning to side panel
      try {
        const warning = message.data;
        chrome.runtime.sendMessage({
          action: 'SHOW_RATE_WARNING',
          data: warning,
        }).catch(() => {
          // Side panel may not be open
        });
      } catch (_) {}
      break;
    }

    case 'RATE_BLOCKED': {
      // Forward hard block to side panel (higher priority than warning)
      try {
        const block = message.data;
        chrome.runtime.sendMessage({
          action: 'SHOW_RATE_BLOCKED',
          data: block,
        }).catch(() => {});
      } catch (_) {}
      break;
    }

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

        // Helper: fetch with automatic retry on 401 (force token refresh)
        async function fetchWithRetry(url, options, retries = 2) {
          for (let attempt = 0; attempt <= retries; attempt++) {
            const res = await fetch(url, options);
            if (res.status === 401 && attempt < retries) {
              await refreshSessionIfNeeded();
              // Get fresh auth after refresh
              const freshAuth = await getAuth();
              if (freshAuth?.session?.access_token) {
                options.headers['Authorization'] = `Bearer ${freshAuth.session.access_token}`;
              }
              continue;
            }
            return res;
          }
          // Final attempt - use anon key as fallback
          return fetch(url, {
            ...options,
            headers: { ...options.headers, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
          });
        }

        const res = await fetchWithRetry(
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
          console.error(`${LOG_PREFIX} get_user_data: HTTP error ${res.status}`);
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
        // 生成 flowId，传递给 login 页面 �?AuthContext �?AuthCallback �?background 关闭标签�?
        const flowId = generateFlowId();

        // �?flowId 通过 URL 参数传递给网站（AuthContext �?AuthCallback�?
        const loginUrl = `${siteBase}/login?from_extension=1&flow_id=${flowId}`;

        // 打开登录页面，background 记录 login tab
        const loginTab = await chrome.tabs.create({ url: loginUrl, active: true });
        const loginTabId = loginTab.id;

        // 记录 flow（callbackTabId 暂时未知，等用户完成 OAuth 后会打开 callback 页面�?
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
        _refreshTokenInvalid = false;
        await clearSession('user_action');
        broadcastAuthChanged(false, null);
        sendResponse({ success: true });
      } catch (err) {
        console.error(`${LOG_PREFIX} logout: error �?${err.message}`);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    // Canonical bridge: website AuthCallback forwards session here via injected <script>
    // 双重校验：只�?扩展发起" + "当前 tab 就是那个被扩展打开�?callback tab"时才允许关闭
    case 'sync_session_from_site': {
      _syncingSession = true;
      try {
        // New login �?reset the invalid token flag so future refresh works
        _refreshTokenInvalid = false;

        const p = message.payload;
        const flowId = p?.flowId;

        if (!p?.access_token || !p?.user) {
          console.error(`${LOG_PREFIX} sync_session_from_site: INVALID payload �?missing access_token or user`);
          sendResponse({ success: false, error: 'Invalid session payload' });
          return;
        }

        const senderTabId = sender?.tab?.id ?? null;
        const extUser = toExtUser(p.user);
        const session = { access_token: p.access_token, refresh_token: p.refresh_token || '' };

        // Always save to AU session �?broadcastAuthChanged is now called inside saveSession
        // after storage write is confirmed (prevents stale-read in sidepanel).
        await saveSession(session, extUser, 'oauth_callback');

        // 双重校验：验�?flowId �?sender.tab.id
        if (flowId) {
          const validation = validateOAuthFlow(flowId, senderTabId);
          if (!validation.valid) {
          }
        } else {
          // 旧版兼容：如果没�?flowId，检查是否有合法�?callback tab
          if (senderTabId == null) {
            const tabs = await chrome.tabs.query({ url: '*://*.tryhomescope.com/auth/callback*' });
            const fallbackTabId = tabs[0]?.id ?? null;
            if (fallbackTabId == null) {
              console.error(`${LOG_PREFIX} sync_session_from_site: BLOCKED �?no flowId and no callback tab detected`);
              sendResponse({ success: false, error: 'No valid OAuth flow found' });
              return;
            }
          }
        }

        // ── 关闭回调标签页的条件（双重保护）──
        if (flowId && senderTabId != null) {
          chrome.tabs.remove(senderTabId).catch((err) => {
          });
        }

        sendResponse({ success: true, user: extUser });
      } catch (err) {
        console.error(`${LOG_PREFIX} sync_session_from_store: EXCEPTION �?${err.message}`);
        sendResponse({ success: false, error: err.message });
      } finally {
        _syncingSession = false;
      }
      break;
    }

    // ===== Helper: derive reportMode from listingData (strict, no default sale) =====
  // Returns 'sale' | 'rent' | null. Never defaults to sale; if both fail we return null
  // and the caller (store) should have blocked before reaching here.
  function deriveReportModeStrict(listingData, tabUrl) {
    if (!listingData && !tabUrl) return null;
    // 1. Explicit reportMode set by the modal
    if (listingData?.reportMode === 'sale' || listingData?.reportMode === 'rent') {
      return listingData.reportMode;
    }
    // 2. listingType inferred by content script (rent | sale | unknown)
    if (listingData?.listingType === 'sale' || listingData?.listingType === 'rent') {
      return listingData.listingType;
    }
    // 3. pricePeriod
    const pp = String(listingData?.pricePeriod || '').toLowerCase();
    if (pp === 'month' || pp === 'week') return 'rent';
    // 4. URL fallback (rent only — homedetails/ is NOT a default for sale)
    const u = String(tabUrl || listingData?.url || '').toLowerCase();
    if (u.includes('/rent/') || u.includes('/rental/') || u.includes('/apartments/') ||
        u.includes('/for-rent/') || u.includes('/community/')) {
      return 'rent';
    }
    return null;
  }

  // ===== Lightweight Basic Analysis (Anonymous, no images, sync) =====
    case 'analyze_basic': {
      const listingData = message.data;

      // ── Dedup: suppress duplicate in-flight requests ─────────────────────────
      const dedupeKey = message._dedupeKey;
      if (dedupeKey && _basicDedupeSet.has(dedupeKey)) {
        sendResponse({ status: 'error', error: 'Duplicate request suppressed. The previous analysis is still in progress.' });
        return;
      }
      if (dedupeKey) {
        _basicDedupeSet.add(dedupeKey);
        setTimeout(() => { _basicDedupeSet.delete(dedupeKey); }, 45000);
      }

      // ── Unified source/market derivation ────────────────────────────────────────────
      const tabUrl = listingData?.tabUrl || listingData?.url || '';
      const { source, sourceDomain, market, listingUrl } = deriveListingSourceInfo(listingData, tabUrl);
      const description = listingData?.description || listingData?.rawText || listingData?.title || 'Property listing information';
      // === LAYER 3a — strict derive; never default to sale ===
      const reportMode = deriveReportModeStrict(listingData, tabUrl);
      if (!reportMode) {
        sendResponse({
          status: 'error',
          error: 'REPORT_MODE_REQUIRED: cannot determine if listing is for sale or for rent.',
          code: 'REPORT_MODE_REQUIRED',
          listingType: 'unknown',
        });
        return;
      }

      // Build optionalDetails: pass ALL property info for comprehensive analysis
      const priceText = listingData?.priceText || listingData?.price || null;
      const optionalDetails = {};
      if (priceText) {
        if (reportMode === 'rent') {
          // US uses monthly rent; AU uses weekly rent — respect pricePeriod when available
          if (market === 'US') {
            optionalDetails.monthlyRent = priceText;
          } else {
            optionalDetails.weeklyRent = priceText;
          }
        } else {
          optionalDetails.askingPrice = priceText;
        }
      }

      // Parse region/neighborhood from full address string.
      // US format: "123 Street, City, ST ZIP" �?region = "City"
      function parseRegionFromAddress(address) {
        if (!address) return null;
        const full = String(address).trim();
        if (/source[:.]|mls|onekey|as distributed by/i.test(full)) return null;
        const usMatch = full.match(/,\s*([^,]+),\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\s*$/);
        if (usMatch) return usMatch[1].trim();
        const usShortMatch = full.match(/,\s*([^,]+)\s*$/);
        if (usShortMatch) return usShortMatch[1].trim();
        return null;
      }

      const fullAddress = listingData?.address || listingData?.suburb || null;
      const parsedRegion = parseRegionFromAddress(fullAddress);

      // Basic property details
      if (listingData?.bedrooms != null) optionalDetails.bedrooms = listingData.bedrooms;
      if (listingData?.bathrooms != null) optionalDetails.bathrooms = listingData.bathrooms;
      // Send full address so backend has it for hero.displayAddress
      if (listingData?.address) optionalDetails.address = listingData.address;
      // suburb = neighborhood/city (parsed from full address)
      if (parsedRegion) optionalDetails.suburb = parsedRegion;
      else if (listingData?.suburb && !listingData?.address) optionalDetails.suburb = listingData.suburb;

      // Zillow/US specific property details
      // Extract propertyFactsV2.identity for fallback field access.
      // content.js extracts homeType/propertyType/propertySubtype into identity but not
      // as top-level listingData fields �?so we need this fallback.
      const identity = listingData?.propertyFactsV2?.identity ?? {};
      if (listingData?.sqft != null) optionalDetails.sqft = listingData.sqft;
      if (listingData?.yearBuilt != null) optionalDetails.yearBuilt = listingData.yearBuilt;
      if (listingData?.propertyType) optionalDetails.propertyType = listingData.propertyType;
      else if (identity?.propertyType) optionalDetails.propertyType = identity.propertyType;
      if (listingData?.homeType) optionalDetails.homeType = listingData.homeType;
      else if (identity?.homeType) optionalDetails.homeType = identity.homeType;
      if (listingData?.propertySubtype) optionalDetails.propertySubtype = listingData.propertySubtype;
      else if (identity?.propertySubtype) optionalDetails.propertySubtype = identity.propertySubtype;
      if (listingData?.lotSize) optionalDetails.lotSize = listingData.lotSize;
      if (listingData?.hoaFee) optionalDetails.hoaFee = listingData.hoaFee;
      if (listingData?.propertyTax) optionalDetails.propertyTax = listingData.propertyTax;
      if (listingData?.annualTaxAmount != null) optionalDetails.annualTaxAmount = listingData.annualTaxAmount;
      if (listingData?.zestimate) optionalDetails.zestimate = listingData.zestimate;
      if (listingData?.rentZestimate) optionalDetails.rentZestimate = listingData.rentZestimate;
      // normalizedPropertyCategory: authoritative category for Basic profile detection.
      // Derive in priority order: normalizedPropertyCategory > propertyType > propertySubtype > homeType.
      if (listingData?.normalizedPropertyCategory) {
        optionalDetails.normalizedPropertyCategory = listingData.normalizedPropertyCategory;
      } else {
        const pt = (listingData?.propertyType ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
        const ps = (listingData?.propertySubtype ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
        const ht = (listingData?.homeType ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
        const normalized =
          /single family|single-family|singlefamily/i.test(pt) ? 'single_family' :
          /condo|condominium/i.test(pt) ? 'condo' :
          /coop|co.op|co-operative|co operative/i.test(pt) ? 'co_op' :
          /duplex|triplex|multi.family|2.family|two.family/i.test(pt) ? 'multi_family' :
          /townhouse/i.test(pt) ? 'townhouse' :
          /land|lot|vacant/i.test(pt) ? 'land' :
          /single family|single-family|singlefamily/i.test(ps) ? 'single_family' :
          /condo|condominium/i.test(ps) ? 'condo' :
          /townhouse/i.test(ps) ? 'townhouse' :
          /single family|single-family|singlefamily/i.test(ht) ? 'single_family' :
          /condo|condominium/i.test(ht) ? 'condo' :
          /townhouse/i.test(ht) ? 'townhouse' :
          null;
        if (normalized) optionalDetails.normalizedPropertyCategory = normalized;
      }
      if (listingData?.daysOnZillow != null) optionalDetails.daysOnZillow = listingData.daysOnZillow;
      if (listingData?.dateOnMarket) optionalDetails.dateOnMarket = listingData.dateOnMarket;
      // region: prefer explicit neighborhood, fallback to parsed city
      if (listingData?.region && !/source[:.]|mls|onekey/i.test(listingData.region)) {
        optionalDetails.region = listingData.region;
      } else if (parsedRegion) {
        optionalDetails.region = parsedRegion;
      }

      // Property features
      if (listingData?.heating) optionalDetails.heating = listingData.heating;
      if (listingData?.cooling) optionalDetails.cooling = listingData.cooling;
      if (listingData?.basement) optionalDetails.basement = listingData.basement;
      if (listingData?.garageSpaces != null) optionalDetails.garageSpaces = listingData.garageSpaces;
      if (listingData?.carportSpaces != null) optionalDetails.carportSpaces = listingData.carportSpaces;
      if (listingData?.constructionMaterial) optionalDetails.constructionMaterial = listingData.constructionMaterial;
      if (listingData?.parcelNumber) optionalDetails.parcelNumber = listingData.parcelNumber;
      if (listingData?.taxAssessedValue != null) optionalDetails.taxAssessedValue = listingData.taxAssessedValue;
      if (listingData?.taxAssessedValueAmount != null) optionalDetails.taxAssessedValueAmount = listingData.taxAssessedValueAmount;
      if (listingData?.annualTaxAmount != null) optionalDetails.annualTaxAmount = listingData.annualTaxAmount;
      if (listingData?.pricePerSqft) optionalDetails.pricePerSqft = listingData.pricePerSqft;
      if (listingData?.pricePerSqftAmount != null) optionalDetails.pricePerSqftAmount = listingData.pricePerSqftAmount;
      if (listingData?.dateListed) optionalDetails.dateListed = listingData.dateListed;
      if (listingData?.availableDate) optionalDetails.availableDate = listingData.availableDate;
      if (listingData?.financialDetails) optionalDetails.financialDetails = listingData.financialDetails;
      if (listingData?.gasMeters != null) optionalDetails.gasMeters = listingData.gasMeters;

      // Highlights/features list
      if (listingData?.highlights && Array.isArray(listingData.highlights)) {
        optionalDetails.highlights = listingData.highlights;
      }

      // Listing description �?用于 Agent Spin Decoder（优先使�?agentMarketingText�?
      const agentMarketingText =
        listingData?.propertyFactsV2?.listingText?.agentMarketingText ||
        listingData?.whatsSpecialText ||
        '';

      const cleanListingDesc =
        agentMarketingText ||
        listingData?.description ||
        '';

// [DEBUG] listing text selected for AI

      if (agentMarketingText && agentMarketingText.trim().length > 20) {
        optionalDetails.whatsSpecialText = agentMarketingText.trim();
        optionalDetails.listingDescription = agentMarketingText.trim();
      } else if (cleanListingDesc && cleanListingDesc.trim().length > 20) {
        optionalDetails.listingDescription = cleanListingDesc.trim();
      }
      // === LAYER 3b ===

      // School ratings
      if (listingData?.schoolRatings && Array.isArray(listingData.schoolRatings)) {
        optionalDetails.schoolRatings = listingData.schoolRatings;
      }

      // Walk Score / Bike Score / Neighborhood / Architectural Style / Flood Zone (from Zillow Facts & Features)
      if (listingData?.walkScore) optionalDetails.walkScore = listingData.walkScore;
      if (listingData?.bikeScore) optionalDetails.bikeScore = listingData.bikeScore;
      if (listingData?.neighborhood) optionalDetails.neighborhood = listingData.neighborhood;
      if (listingData?.architecturalStyle) optionalDetails.architecturalStyle = listingData.architecturalStyle;
      if (listingData?.stories) optionalDetails.stories = listingData.stories;
      if (listingData?.hoaStatus) optionalDetails.hoaStatus = listingData.hoaStatus;
      if (listingData?.floodZone) optionalDetails.floodZone = listingData.floodZone;

      // Additional raw facts for fallback analysis
      if (listingData?.facts && typeof listingData.facts === 'object') {
        optionalDetails.facts = listingData.facts;
      }

      // ── Enrich optionalDetails with source info for backend fallback ─────────────────
      optionalDetails.source = source;
      optionalDetails.sourceDomain = sourceDomain;
      optionalDetails.market = market;
      optionalDetails.listingUrl = listingUrl;

      // ── Zillow financials: deterministic monthly payment breakdown ─────────────────

      // ── Determine server ───────────────────────────────────────────────────────────
      const serverConfig = getAnalyzeApiUrl(sourceDomain);

      // Get auth token if user is logged in (needed for saving basic analysis to history)
      const auth = await getAuth();
      const accessToken = auth?.session?.access_token || null;
      
      const LOG_BASIC_START = Date.now();
      try {
        const url = `${serverConfig.url}/functions/v1/analyze?action=basic-sync`;
        const requestBody = {
          description,
          reportMode,
          optionalDetails,
          source,
          sourceDomain,
          market,
          listingUrl,
          zillowFinancials: listingData?.zillowFinancials || null,
        };
        const response = await fetch(url, {
          method: 'POST',
          headers: buildSupabaseFunctionHeaders(accessToken, serverConfig),
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ message: 'Basic analysis failed' }));
          console.error(`${LOG_PREFIX} analyze_basic: API error in ${Date.now() - LOG_BASIC_START}ms —`, err);
          sendResponse({ status: 'error', error: err.message || 'Basic analysis failed' });
          return;
        }

        const data = await response.json();
        const durationMs = Date.now() - LOG_BASIC_START;
        sendResponse({ status: 'success', result: data.result, analysisId: data.analysisId || null });
      } catch (err) {
        console.error(`${LOG_PREFIX} analyze_basic: error in ${Date.now() - LOG_BASIC_START}ms —`, err.message);
        sendResponse({ status: 'error', error: err.message || 'Basic analysis failed' });
      }
      break;
    }

    case 'analyze': {
      // Prevent SW from being killed during the full submit+run request cycle
      ensureAlive();

      // ── DIAG LOG ──
      const listingDataRaw = message.data;

      // Step 1: Get fresh session (auto-refresh if needed)
      const auth = await getAuth();

      if (!auth?.session?.access_token) {
        clearAlive();
        sendResponse({ status: 'error', error: 'Please sign in first to analyze listings.' });
        return;
      }
      const { session } = auth;

      const listingData = message.data;
      const imageUrls = listingData?.imageUrls || listingData?.images || [];
      const description = listingData?.description || listingData?.rawText || '';
      // ── Unified source/market derivation ────────────────────────────────────────────
      const tabUrl = listingData?.tabUrl || listingData?.url || '';
      // Strict derive; never default to sale
      const reportMode = deriveReportModeStrict(listingData, tabUrl);
      if (!reportMode) {
        sendResponse({
          status: 'error',
          error: 'REPORT_MODE_REQUIRED: cannot determine if listing is for sale or for rent.',
          code: 'REPORT_MODE_REQUIRED',
          listingType: 'unknown',
        });
        return;
      }

      const { source, sourceDomain, market, listingUrl } = deriveListingSourceInfo(listingData, tabUrl);
      const serverConfig = getAnalyzeApiUrl(sourceDomain);

      // Build optionalDetails: pass ALL property info to AI for accurate analysis
      const priceText = listingData?.priceText || listingData?.price || null;
      const priceHidden = listingData?.priceHidden || false;
      const optionalDetails = {};
      if (priceText) {
        if (reportMode === 'rent') {
          if (market === 'US') {
            optionalDetails.monthlyRent = priceText;
          } else {
            optionalDetails.weeklyRent = priceText;
          }
        } else {
          optionalDetails.askingPrice = priceText;
        }
      }
      if (priceHidden) {
        optionalDetails.priceStatus = 'hidden';
      }

      // Parse region/neighborhood from full address string.
      // US format: "123 Street, City, ST ZIP" �?region = "City"
      function parseRegionFromAddress(address) {
        if (!address) return null;
        const full = String(address).trim();
        if (/source[:.]|mls|onekey|as distributed by/i.test(full)) return null;
        const usMatch = full.match(/,\s*([^,]+),\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\s*$/);
        if (usMatch) return usMatch[1].trim();
        const usShortMatch = full.match(/,\s*([^,]+)\s*$/);
        if (usShortMatch) return usShortMatch[1].trim();
        return null;
      }

      const fullAddress = listingData?.address || listingData?.suburb || null;
      const parsedRegion = parseRegionFromAddress(fullAddress);

      // Basic property details
      if (listingData?.bedrooms != null) optionalDetails.bedrooms = listingData.bedrooms;
      if (listingData?.bathrooms != null) optionalDetails.bathrooms = listingData.bathrooms;
      // Send full address so backend has it for hero.displayAddress
      if (listingData?.address) optionalDetails.address = listingData.address;
      // suburb = neighborhood/city (parsed from full address)
      if (parsedRegion) optionalDetails.suburb = parsedRegion;
      else if (listingData?.suburb && !listingData?.address) optionalDetails.suburb = listingData.suburb;

      // Zillow/US specific property details
      // Extract propertyFactsV2.identity for fallback field access.
      // content.js extracts homeType/propertyType/propertySubtype into identity but not
      // as top-level listingData fields �?so we need this fallback.
      const identity = listingData?.propertyFactsV2?.identity ?? {};
      if (listingData?.sqft != null) optionalDetails.sqft = listingData.sqft;
      if (listingData?.yearBuilt != null) optionalDetails.yearBuilt = listingData.yearBuilt;
      if (listingData?.propertyType) optionalDetails.propertyType = listingData.propertyType;
      else if (identity?.propertyType) optionalDetails.propertyType = identity.propertyType;
      if (listingData?.homeType) optionalDetails.homeType = listingData.homeType;
      else if (identity?.homeType) optionalDetails.homeType = identity.homeType;
      if (listingData?.propertySubtype) optionalDetails.propertySubtype = listingData.propertySubtype;
      else if (identity?.propertySubtype) optionalDetails.propertySubtype = identity.propertySubtype;
      if (listingData?.lotSize) optionalDetails.lotSize = listingData.lotSize;
      if (listingData?.hoaFee) optionalDetails.hoaFee = listingData.hoaFee;
      if (listingData?.propertyTax) optionalDetails.propertyTax = listingData.propertyTax;
      if (listingData?.annualTaxAmount != null) optionalDetails.annualTaxAmount = listingData.annualTaxAmount;
      if (listingData?.zestimate) optionalDetails.zestimate = listingData.zestimate;
      if (listingData?.rentZestimate) optionalDetails.rentZestimate = listingData.rentZestimate;
      // normalizedPropertyCategory: authoritative category for Basic profile detection.
      // Derive in priority order: normalizedPropertyCategory > propertyType > propertySubtype > homeType.
      if (listingData?.normalizedPropertyCategory) {
        optionalDetails.normalizedPropertyCategory = listingData.normalizedPropertyCategory;
      } else {
        const pt = (listingData?.propertyType ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
        const ps = (listingData?.propertySubtype ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
        const ht = (listingData?.homeType ?? '').toLowerCase().replace(/[_-]/g, ' ').trim();
        const normalized =
          /single family|single-family|singlefamily/i.test(pt) ? 'single_family' :
          /condo|condominium/i.test(pt) ? 'condo' :
          /coop|co.op|co-operative|co operative/i.test(pt) ? 'co_op' :
          /duplex|triplex|multi.family|2.family|two.family/i.test(pt) ? 'multi_family' :
          /townhouse/i.test(pt) ? 'townhouse' :
          /land|lot|vacant/i.test(pt) ? 'land' :
          /single family|single-family|singlefamily/i.test(ps) ? 'single_family' :
          /condo|condominium/i.test(ps) ? 'condo' :
          /townhouse/i.test(ps) ? 'townhouse' :
          /single family|single-family|singlefamily/i.test(ht) ? 'single_family' :
          /condo|condominium/i.test(ht) ? 'condo' :
          /townhouse/i.test(ht) ? 'townhouse' :
          null;
        if (normalized) optionalDetails.normalizedPropertyCategory = normalized;
      }
      if (listingData?.daysOnZillow != null) optionalDetails.daysOnZillow = listingData.daysOnZillow;
      if (listingData?.dateOnMarket) optionalDetails.dateOnMarket = listingData.dateOnMarket;
      // region: prefer explicit neighborhood, fallback to parsed city
      if (listingData?.region && !/source[:.]|mls|onekey/i.test(listingData.region)) {
        optionalDetails.region = listingData.region;
      } else if (parsedRegion) {
        optionalDetails.region = parsedRegion;
      }

      // Property features
      if (listingData?.heating) optionalDetails.heating = listingData.heating;
      if (listingData?.cooling) optionalDetails.cooling = listingData.cooling;
      if (listingData?.basement) optionalDetails.basement = listingData.basement;
      if (listingData?.garageSpaces != null) optionalDetails.garageSpaces = listingData.garageSpaces;
      if (listingData?.carportSpaces != null) optionalDetails.carportSpaces = listingData.carportSpaces;
      if (listingData?.constructionMaterial) optionalDetails.constructionMaterial = listingData.constructionMaterial;
      if (listingData?.parcelNumber) optionalDetails.parcelNumber = listingData.parcelNumber;
      if (listingData?.taxAssessedValue != null) optionalDetails.taxAssessedValue = listingData.taxAssessedValue;
      if (listingData?.taxAssessedValueAmount != null) optionalDetails.taxAssessedValueAmount = listingData.taxAssessedValueAmount;
      if (listingData?.annualTaxAmount != null) optionalDetails.annualTaxAmount = listingData.annualTaxAmount;
      if (listingData?.pricePerSqft) optionalDetails.pricePerSqft = listingData.pricePerSqft;
      if (listingData?.pricePerSqftAmount != null) optionalDetails.pricePerSqftAmount = listingData.pricePerSqftAmount;
      if (listingData?.dateListed) optionalDetails.dateListed = listingData.dateListed;
      if (listingData?.availableDate) optionalDetails.availableDate = listingData.availableDate;
      if (listingData?.financialDetails) optionalDetails.financialDetails = listingData.financialDetails;
      if (listingData?.gasMeters != null) optionalDetails.gasMeters = listingData.gasMeters;

      // Highlights/features list
      if (listingData?.highlights && Array.isArray(listingData.highlights)) {
        optionalDetails.highlights = listingData.highlights;
      }

      // Listing description �?用于 Agent Spin Decoder（优先使�?agentMarketingText�?
      const agentMarketingText =
        listingData?.propertyFactsV2?.listingText?.agentMarketingText ||
        listingData?.whatsSpecialText ||
        '';

      const cleanListingDesc =
        agentMarketingText ||
        listingData?.description ||
        '';

// [DEBUG] listing text selected for AI

      if (agentMarketingText && agentMarketingText.trim().length > 20) {
        optionalDetails.whatsSpecialText = agentMarketingText.trim();
        optionalDetails.listingDescription = agentMarketingText.trim();
      } else if (cleanListingDesc && cleanListingDesc.trim().length > 20) {
        optionalDetails.listingDescription = cleanListingDesc.trim();
      }
      // === LAYER 3b ===

      // School ratings
      if (listingData?.schoolRatings && Array.isArray(listingData.schoolRatings)) {
        optionalDetails.schoolRatings = listingData.schoolRatings;
      }

      // Walk Score / Bike Score / Neighborhood / Architectural Style (from Zillow Facts & Features)
      if (listingData?.walkScore) optionalDetails.walkScore = listingData.walkScore;
      if (listingData?.bikeScore) optionalDetails.bikeScore = listingData.bikeScore;
      if (listingData?.neighborhood) optionalDetails.neighborhood = listingData.neighborhood;
      if (listingData?.architecturalStyle) optionalDetails.architecturalStyle = listingData.architecturalStyle;
      if (listingData?.stories) optionalDetails.stories = listingData.stories;
      if (listingData?.hoaStatus) optionalDetails.hoaStatus = listingData.hoaStatus;
      if (listingData?.floodZone) optionalDetails.floodZone = listingData.floodZone;

      // Additional raw facts for fallback analysis
      if (listingData?.facts && typeof listingData.facts === 'object') {
        optionalDetails.facts = listingData.facts;
      }

      // ── Enrich optionalDetails with source info for backend fallback ─────────────────
      optionalDetails.source = source;
      optionalDetails.sourceDomain = sourceDomain;
      optionalDetails.market = market;
      optionalDetails.listingUrl = listingUrl;

      const requestBody = {
        imageUrls,
        description,
        reportMode,
        optionalDetails,
        source,
        sourceDomain,
        market,
        listingUrl,
        zillowFinancials: listingData?.zillowFinancials || null,
      };

      // Step 3: action=submit
      try {
        const accessToken = session.access_token;
        const url = `${serverConfig.url}/functions/v1/analyze?action=submit`;
        const submitRes = await fetch(url, {
          method: 'POST',
          headers: buildSupabaseFunctionHeaders(accessToken, serverConfig),
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
          clearAlive();
          return;
        }

        const { id: analysisId } = await submitRes.json();

        // 保存 serverConfig（内�?Map + session storage，防�?MV3 SW 重启后丢失）
        _analysisServerMap.set(analysisId, serverConfig);
        await chrome.storage.session.set({
          [`${HS_ANALYSIS_SERVER_PREFIX}${analysisId}`]: serverConfig,
        });

        // Step 4: action=run �?fire analysis job (fire-and-forget)
        const runAccessToken = session.access_token;
        const runUrl = `${serverConfig.url}/functions/v1/analyze?action=run`;
        fetch(runUrl, {
          method: 'POST',
          headers: buildSupabaseFunctionHeaders(runAccessToken, serverConfig),
          body: JSON.stringify({ id: analysisId, ...requestBody }),
        }).catch((err) => console.error(`${LOG_PREFIX} analyze: run error —`, err.message));

        // Return analysisId immediately �?frontend will poll for status
        sendResponse({ status: 'submitted', analysisId });
        clearAlive(); // SW no longer needs to stay awake �?polling handles the rest
      } catch (err) {
        clearAlive();
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'get_analysis_status': {
      const { analysisId } = message;
      if (!analysisId) {
        sendResponse({ status: 'error', error: 'Missing analysisId' });
        return;
      }

      const auth = await getAuth();
      if (!auth?.session?.access_token) {
        sendResponse({ status: 'error', error: 'Please sign in first.' });
        return;
      }

      // 两层查找 serverConfig：内�?Map �?session storage
      let serverConfig = _analysisServerMap.get(analysisId);

      if (!serverConfig) {
        const stored = await chrome.storage.session.get(`${HS_ANALYSIS_SERVER_PREFIX}${analysisId}`);
        serverConfig = stored[`${HS_ANALYSIS_SERVER_PREFIX}${analysisId}`] || null;
        if (serverConfig) {
          _analysisServerMap.set(analysisId, serverConfig); // 回填内存 Map
        }
      }

      if (!serverConfig) {
        console.error(`${LOG_PREFIX} get_analysis_status: serverConfig not found for analysisId=${analysisId} �?SW may have restarted`);
        sendResponse({ status: 'error', error: 'Analysis server not found. Please restart the analysis.' });
        return;
      }

      try {
        const accessToken = auth.session.access_token;
        const url = `${serverConfig.url}/functions/v1/analyze?id=${analysisId}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: buildSupabaseFunctionHeaders(accessToken, serverConfig),
        });

        if (!res.ok) {
          sendResponse({ status: 'error', error: 'Failed to get analysis status' });
          return;
        }

        const data = await res.json();

        // 分析完成或失败后清理
        if (data.status === 'done' || data.status === 'failed') {
          _analysisServerMap.delete(analysisId);
          await chrome.storage.session.remove(`${HS_ANALYSIS_SERVER_PREFIX}${analysisId}`);
        }

        sendResponse(data);
      } catch (err) {
        console.error(`${LOG_PREFIX} get_analysis_status: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'get_analysis_history': {
      const limit = message.limit ?? 8;
      const offset = message.offset ?? 0;

      // Single AU session �?no region distinction needed
      const auSession = await getSession();
      if (!auSession?.session?.access_token) {
        sendResponse({ status: 'success', analyses: [], code: 'NOT_AUTHENTICATED' });
        return;
      }

      await refreshSessionIfNeeded();
      const refreshed = await getSession();
      const token = refreshed?.session?.access_token;

      if (!token) {
        sendResponse({ status: 'success', analyses: [], code: 'NOT_AUTHENTICATED' });
        return;
      }

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze`, {
          method: 'POST',
          headers: buildSupabaseFunctionHeaders(token, { anonKey: SUPABASE_ANON_KEY }),
          body: JSON.stringify({ action: 'list', limit, offset }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          if (res.status === 401 || errBody?.code === 'NOT_AUTHENTICATED' || errBody?.code === 'NO_TOKEN') {
            sendResponse({ status: 'success', analyses: [], code: 'NOT_AUTHENTICATED' });
          } else {
            sendResponse({ status: 'error', error: 'Failed to load history' });
          }
          return;
        }

        const data = await res.json();
        sendResponse({ status: 'success', analyses: data.analyses || [] });
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

      const { analysisId, sourceDomain } = message;
      if (!analysisId) {
        sendResponse({ status: 'error', error: 'Missing analysisId' });
        return;
      }

      // ── Resolve serverConfig: memory Map �?session storage �?URL fallback ──
      let serverConfig = _analysisServerMap.get(analysisId);

      if (!serverConfig) {
        const stored = await chrome.storage.session.get(`${HS_ANALYSIS_SERVER_PREFIX}${analysisId}`);
        serverConfig = stored[`${HS_ANALYSIS_SERVER_PREFIX}${analysisId}`] || null;
        if (serverConfig) {
          _analysisServerMap.set(analysisId, serverConfig);
        }
      }

      // URL-based fallback: derive server from sourceDomain
      if (!serverConfig) {
        const sd = sourceDomain || '';
        const isUS = sd.includes('zillow') || sd.includes('realtor');
        serverConfig = {
          url: isUS ? (SUPABASE_US_URL || SUPABASE_URL) : SUPABASE_URL,
          anonKey: isUS ? (SUPABASE_US_ANON_KEY || SUPABASE_ANON_KEY) : SUPABASE_ANON_KEY,
          isUS,
        };
      }


      try {
        const accessToken = auth.session.access_token;
        const url = `${serverConfig.url}/functions/v1/analyze?action=share`;
        const res = await fetch(url, {
          method: 'POST',
          headers: buildSupabaseFunctionHeaders(accessToken, serverConfig),
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

        // Guard: 获取 tab URL 并检查是否可注入
        let tabUrl;
        try {
          const tab = await chrome.tabs.get(tabId);
          tabUrl = tab.url;
        } catch {
          sendResponse({ ok: false, code: 'UNSUPPORTED_BROWSER_PAGE', error: 'Cannot access this page' });
          return;
        }

        // Guard: chrome://、about: 等不可注入页�?
        const injectable = tabUrl && !(
          tabUrl.startsWith('chrome://') ||
          tabUrl.startsWith('chrome-extension://') ||
          tabUrl.startsWith('about:') ||
          tabUrl.startsWith('edge://') ||
          tabUrl.startsWith('brave://') ||
          tabUrl.startsWith('devtools://') ||
          tabUrl.startsWith('file://') ||
          tabUrl.startsWith('resource://')
        );
        if (!injectable) {
          sendResponse({ ok: false, code: 'UNSUPPORTED_BROWSER_PAGE', error: 'Cannot inject into this page' });
          return;
        }

        // Guard: 非支持网站（只支�?realestate.com.au �?zillow.com 及其子域名）
        const supportedHosts = ['realestate.com.au', 'zillow.com'];
        const isSupported = (() => {
          try {
            const parsed = new URL(tabUrl);
            const host = parsed.hostname.toLowerCase();
            return supportedHosts.some(h => host === h || host.endsWith('.' + h));
          } catch { return false; }
        })();
        if (!isSupported) {
          sendResponse({ ok: false, code: 'UNSUPPORTED_SITE', error: 'Not a supported property site' });
          return;
        }

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

        // Guard: 获取 tab URL 并检查是否可注入
        let tabUrl;
        try {
          const tab = await chrome.tabs.get(tabId);
          tabUrl = tab.url;
        } catch {
          sendResponse({ error: 'Cannot access this page', code: 'UNSUPPORTED_BROWSER_PAGE' });
          return;
        }

        // Guard: chrome://、about: 等不可注入页�?
        const injectable = tabUrl && !(
          tabUrl.startsWith('chrome://') ||
          tabUrl.startsWith('chrome-extension://') ||
          tabUrl.startsWith('about:') ||
          tabUrl.startsWith('edge://') ||
          tabUrl.startsWith('brave://') ||
          tabUrl.startsWith('devtools://') ||
          tabUrl.startsWith('file://') ||
          tabUrl.startsWith('resource://')
        );
        if (!injectable) {
          sendResponse({ error: 'Cannot inject into this page', code: 'UNSUPPORTED_BROWSER_PAGE' });
          return;
        }

        // Guard: 非支持网站（只支�?realestate.com.au �?zillow.com 及其子域名）
        const supportedHosts = ['realestate.com.au', 'zillow.com'];
        const isSupported = (() => {
          try {
            const parsed = new URL(tabUrl);
            const host = parsed.hostname.toLowerCase();
            return supportedHosts.some(h => host === h || host.endsWith('.' + h));
          } catch { return false; }
        })();
        if (!isSupported) {
          sendResponse({ error: 'Not a supported property site', code: 'UNSUPPORTED_SITE' });
          return;
        }

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

    // ──────────────────────────────────────────────────────────────────
    // FORCE_REEXTRACT — 转发到当前激活标签页的 content script
    // content script 持有 document，调 ZillowExtractor.forceReextract(forcedType)
    // store.tsx 不直接调 extractor（拿不到 DOM）
    // ──────────────────────────────────────────────────────────────────
    case 'FORCE_REEXTRACT': {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) {
          sendResponse({ ok: false, error: 'No active tab for FORCE_REEXTRACT' });
          return;
        }
        const forcedType = message.forcedListingType;
        if (forcedType !== 'rent' && forcedType !== 'sale') {
          sendResponse({ ok: false, error: 'forcedListingType must be rent or sale' });
          return;
        }
        const contentResponse = await chrome.tabs.sendMessage(activeTab.id, {
          action: 'FORCE_REEXTRACT',
          forcedListingType: forcedType,
        });
        sendResponse(contentResponse);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      break;
    }

    default:
      sendResponse({ success: false, error: 'UNKNOWN_ACTION' });
  }
}

// injectContentScript DISABLED �?content script is injected declaratively via
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
  // Supabase OAuth uses in-tab redirect (login �?callback in same tab).
  // callbackTabId matching loginTabId is NORMAL, not an error.
  // Log it for visibility but do NOT fail validation.
  if (callbackTabId != null && flow.loginTabId === callbackTabId) {
  }
  flow.used = true;
  return { valid: true };
}

// ===== OAuth Flow: 监听 callback 标签页打开/更新 =====
// 注意：Supabase OAuth 使用"原地重定�?（在同一个标签页�?/login 重定向到 /auth/callback�?
// 因此需要同时监�?onCreated（外部打开的链接）�?onUpdated（重定向�?

/** 从完�?tab URL 提取 flow_id（query �?hash 片段里的 flow_id�?*/
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
  }
  return null;
}

function handleCallbackTab(tabId, url) {
  // 同时支持 /auth/callback 和根路径 /（Supabase 有时会回跳到根路径带 code 参数�?
  const isCallback =
    url.includes('/auth/callback') ||
    (url.includes('tryhomescope.com/') && url.includes('code='));
  if (!isCallback) return;

  let flowId = extractFlowIdFromTabUrl(url);

  // �?flow_id 时：OAuth 隐式回跳常把 query 清掉，用「同一 tab = 扩展打开�?loginTab」兜�?
  if (!flowId) {
    for (const [fid, flow] of _oauthFlows.entries()) {
      if (flow.used) continue;
      if (flow.loginTabId === tabId) {
        flowId = fid;
        flow.callbackTabId = tabId;
        return;
      }
    }
    return;
  }

  const flow = _oauthFlows.get(flowId);
  if (flow) {
    const prevCallbackTabId = flow.callbackTabId;
    flow.callbackTabId = tabId;
  } else {
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  handleCallbackTab(tab.id, tab.url || '');
});

// 监听标签�?URL 变化（OAuth 完成后从 /login 重定向到 /auth/callback�?
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
