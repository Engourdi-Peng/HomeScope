// ===== HomeScope Extension - OAuth/Magic Link Callback =====
// 用户点击邮箱里的 Magic Link 后，Supabase 跳转到此页面
// 此页面解析 URL hash 中的 tokens，写入 storage，通知 background，然后自动关闭

(async function() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.substring(1));
  const searchParams = new URLSearchParams(url.search.substring(1));

  let accessToken  = hash.get('access_token');
  let refreshToken = hash.get('refresh_token');
  const expiresIn    = hash.get('expires_in');
  const tokenType    = hash.get('token_type');
  const error        = hash.get('error_description') || hash.get('error') ||
    searchParams.get('error_description') || searchParams.get('error');

  // PKCE / 部分配置下邮件链接为 ?code=... 而非 hash 里的 access_token
  const authCode = searchParams.get('code');
  if (!accessToken && authCode) {
    console.log('[CB] Found auth code in query, exchanging via background...');
    try {
      const exchanged = await chrome.runtime.sendMessage({
        action: 'exchange_magic_code',
        code: authCode
      });
      if (exchanged?.success) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('success').style.display = 'block';
        console.log('[CB] Code exchange OK, user:', exchanged.user?.email);
        setTimeout(() => { try { window.close(); } catch {} }, 2500);
        return;
      }
      throw new Error(exchanged?.error || 'Code exchange failed');
    } catch (e) {
      console.error('[CB] Code exchange:', e);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      document.getElementById('error-message').textContent =
        e.message || 'Could not complete login. Try sending a new magic link from the extension.';
      return;
    }
  }

  if (error) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-message').textContent = error;
    console.error('[CB] Magic Link error:', error);
    return;
  }

  if (!accessToken) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error-message').textContent = 'No access token in callback URL.';
    console.error('[CB] No access_token in URL hash');
    return;
  }

  // 从 JWT payload 解析用户信息
  let user = null;
  try {
    const parts = accessToken.split('.');
    if (parts.length >= 2) {
      const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
      user = JSON.parse(atob(padded));
    }
  } catch (e) {
    console.warn('[CB] JWT decode failed, using fallback');
  }

  if (!user) {
    user = {
      id:    hash.get('user_id') || hash.get('sub'),
      email: hash.get('user_email') || hash.get('email')
    };
  }

  // 写入 chrome.storage.local
  await chrome.storage.local.set({
    access_token:  accessToken,
    refresh_token: refreshToken || '',
    user:          user
  });

  // 通知 background script
  try {
    await chrome.runtime.sendMessage({
      action: 'magic_link_callback',
      accessToken,
      refreshToken: refreshToken || '',
      user
    });
  } catch (e) {
    console.warn('[CB] sendMessage to background failed (may be unavailable):', e.message);
  }

  // 显示成功并自动关闭
  document.getElementById('loading').style.display = 'none';
  document.getElementById('success').style.display = 'block';
  console.log('[CB] Magic Link login successful, user:', user?.email);

  setTimeout(() => {
    try { window.close(); } catch {}
  }, 2500);
})();
