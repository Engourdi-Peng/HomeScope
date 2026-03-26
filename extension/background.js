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
 *   1. User clicks login in side panel → background opens website login page
 *   2. User completes Google OAuth or Magic Link on website
 *   3. AuthCallback.tsx injects a <script> tag that calls chrome.runtime.sendMessage
 *   4. Background receives sync_session_from_site, saves session, closes the callback tab
 *   5. background.saveSession() persists to hs_session/hs_user + updates cache
 *   6. background.broadcastAuthChanged() notifies all extension contexts
 *
 * Legacy migration:
 *   - On first run after this refactor, migrate any existing session from
 *     old storage locations (sb-*-auth-token keys, Supabase cookies) to the
 *     canonical hs_session/hs_user keys. Mark migration complete in
 *     hs_auth_migrated so this is a one-time operation only.
 */

// ===== Injected config (replaced by vite at build time) =====
const SUPABASE_URL = __SUPABASE_URL__;
const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
const MAGIC_LINK_REDIRECT = __MAGIC_LINK_REDIRECT__;

const LOG_PREFIX = '[HomeScope BG]';

// ===== Image collection DISABLED =====
// REMOVED: chrome.webRequest.onCompleted auto-collected gallery images on page load.
// Policy: "严禁后台预抓图库图片" — image collection is now exclusively user-triggered.
// All gallery image collection must go through the START_USER_EXTRACTION flow in content.js.
// The HS_IMAGES_KEY storage, isMainGalleryImage(), _saveImageToCache(), and webRequest listener
// below were deleted as part of this policy change.

// ===== tabId → listingUrl mapping (valid for service worker lifetime) =====
const _tabListingMap = new Map();

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

// ----- Helper: normalise Supabase user object to ExtUser -----
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
async function getSession() {
  // 1. In-memory cache
  if (_cachedAuth) return _cachedAuth;

  // 2. One-time legacy migration (runs at most once per service worker lifetime)
  await migrateLegacySession();

  // 3. Canonical storage keys ONLY
  const stored = await chrome.storage.local.get([HS_SESSION_KEY, HS_USER_KEY]);
  if (stored[HS_SESSION_KEY] && stored[HS_USER_KEY]) {
    _cachedAuth = { session: stored[HS_SESSION_KEY], user: stored[HS_USER_KEY] };
    console.log(`${LOG_PREFIX} getSession: loaded from canonical storage, userId=${stored[HS_USER_KEY]?.id}`);
    return _cachedAuth;
  }

  console.log(`${LOG_PREFIX} getSession: no session found`);
  return null;
}

// ----- Save session to canonical storage -----
async function saveSession(session, user) {
  try {
    await chrome.storage.local.set({
      [HS_SESSION_KEY]: session,
      [HS_USER_KEY]: user,
    });
    _cachedAuth = { user, session };
    console.log(`${LOG_PREFIX} saveSession: written hs_session (access_token=${!!session.access_token}) and hs_user (id=${user?.id})`);
    _authListeners.forEach((cb) => cb(user));
    console.log(`${LOG_PREFIX} saveSession: notifying ${_authListeners.length} auth listeners`);
    console.log(`${LOG_PREFIX} saveSession: success, userId=${user?.id}`);
  } catch (err) {
    console.error(`${LOG_PREFIX} saveSession: FAILED —`, err.message);
    throw err;
  }
}

// ----- Clear session -----
async function clearSession() {
  await chrome.storage.local.remove([HS_SESSION_KEY, HS_USER_KEY]);
  _cachedAuth = null;
  _authListeners.forEach((cb) => cb(null));
  console.log(`${LOG_PREFIX} logout: session cleared`);
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
    console.log(`${LOG_PREFIX} refreshSessionIfNeeded: no refresh token, skipped`);
    return stored;
  }

  console.log(`${LOG_PREFIX} refreshSessionIfNeeded: refreshing...`);
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
      console.log(`${LOG_PREFIX} refreshSessionIfNeeded: success`);
      return { session: data, user: stored.user };
    } else {
      const errText = await res.text();
      console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: FAILED (${res.status}) — clearing session`);
      await clearSession();
      broadcastAuthChanged(false, null);
      return null;
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} refreshSessionIfNeeded: FAILED (network) — clearing session`);
    await clearSession();
    broadcastAuthChanged(false, null);
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
        const auth = await getSession();
        if (!auth?.user) {
          sendResponse({ status: 'success', data: { credits_remaining: 0 } });
          return;
        }
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?select=credits_remaining&id=eq.${auth.user.id}`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.session?.access_token || SUPABASE_ANON_KEY}` } }
        );
        if (res.ok) {
          const rows = await res.json();
          sendResponse({ status: 'success', data: { credits_remaining: rows?.[0]?.credits_remaining ?? 0 } });
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
        const loginUrl = `${siteBase}/login?from=extension`;
        await chrome.tabs.create({ url: loginUrl, active: true });
        console.log(`${LOG_PREFIX} initiate_google_oauth: opened login page`);
        sendResponse({ success: true, opened_login_page: true });
      } catch (err) {
        console.error(`${LOG_PREFIX} initiate_google_oauth: error —`, err.message);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'logout': {
      console.log(`${LOG_PREFIX} logout: requested`);
      try {
        await clearSession();
        broadcastAuthChanged(false, null);
        sendResponse({ success: true });
      } catch (err) {
        console.error(`${LOG_PREFIX} logout: error —`, err.message);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    // Canonical bridge: website AuthCallback forwards session here via injected <script>
    case 'sync_session_from_site': {
      console.log(`${LOG_PREFIX} sync_session_from_site: received`);
      try {
        const p = message.payload;
        if (!p?.access_token || !p?.user) {
          console.error(`${LOG_PREFIX} sync_session_from_site: invalid payload`);
          sendResponse({ success: false, error: 'Invalid session payload' });
          return;
        }
        // 记录回调标签页 ID，后续用于关闭它
        const callbackTabId = sender?.tab?.id;
        console.log(`${LOG_PREFIX} sync_session_from_site: userId=${p.user.id}, callbackTabId=${callbackTabId}`);
        const session = { access_token: p.access_token, refresh_token: p.refresh_token || '' };
        const extUser = toExtUser(p.user);
        await saveSession(session, extUser);
        broadcastAuthChanged(true, extUser);
        console.log(`${LOG_PREFIX} sync_session_from_site: success, saved session for userId=${extUser?.id}`);

        // 关闭回调标签页（由扩展打开的，background 有权限关闭）
        if (callbackTabId != null) {
          console.log(`${LOG_PREFIX} sync_session_from_site: closing callback tab ${callbackTabId}...`);
          chrome.tabs.remove(callbackTabId).catch((err) => {
            console.warn(`${LOG_PREFIX} sync_session_from_site: failed to close tab —`, err.message);
          });
        } else {
          console.warn(`${LOG_PREFIX} sync_session_from_site: no callbackTabId, cannot auto-close`);
        }

        sendResponse({ success: true, user: extUser });
      } catch (err) {
        console.error(`${LOG_PREFIX} sync_session_from_site: error —`, err.message);
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'analyze': {
      // Step 1: Get session
      const auth = await getSession();
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
        optionalDetails: {
          weeklyRent: listingData?.price || listingData?.priceText,
          suburb: listingData?.address,
          bedrooms: listingData?.bedrooms != null ? String(listingData.bedrooms) : undefined,
          bathrooms: listingData?.bathrooms != null ? String(listingData.bathrooms) : undefined,
          parking: listingData?.parking != null ? String(listingData.parking) : undefined,
        },
      };

      // Step 3: action=submit — create analysis record
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

        // Step 5: Poll for result
        let result = null;
        const startTime = Date.now();
        const MAX_POLL_MS = 60_000;

        while (Date.now() - startTime < MAX_POLL_MS) {
          await sleep(2000);

          const pollRes = await fetch(
            `${SUPABASE_URL}/functions/v1/analyze?id=${analysisId}`,
            {
              method: 'GET',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${session.access_token}`,
              },
            }
          );

          if (!pollRes.ok) continue;
          const progress = await pollRes.json();

          if (progress.status === 'done' && progress.result) {
            result = progress.result;
            break;
          }
          if (progress.status === 'failed') {
            sendResponse({ status: 'error', error: progress.error || 'Analysis failed' });
            return;
          }
        }

        if (result) {
          sendResponse({ status: 'success', result });
        } else {
          sendResponse({ status: 'error', error: 'Analysis timed out. Please try again.' });
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} analyze: error —`, err.message);
        sendResponse({ status: 'error', error: err.message });
      }
      break;
    }

    case 'get_analysis_history': {
      try {
        const auth = await getSession();
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
chrome.tabs.onUpdated.addListener(() => {});

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
