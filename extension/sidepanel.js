// ===== HomeScope Extension - Side Panel Script =====
// 插件 v2: 纯 Magic Link 登录

const gateView       = document.getElementById('gate-view');
const gateIconImg    = document.getElementById('gate-icon-img');
const loggedInView   = document.getElementById('logged-in-view');
const loggedInEmail  = document.getElementById('logged-in-email');
const gateDesc       = document.getElementById('gate-desc');
const gateContent    = document.getElementById('gate-content');
const loginError     = document.getElementById('login-error');

/** 最近一次发送 Magic Link 的邮箱（用于刷新失败时保留界面） */
let lastMagicEmail = '';

// 设置 logo
if (gateIconImg) gateIconImg.src = chrome.runtime.getURL('icon.png');

// 关闭按钮
document.getElementById('sidepanel-close').addEventListener('click', () => window.close());

// ===== 视图切换 =====

function showGateView(error = '') {
  gateView.style.display = 'flex';
  loggedInView.style.display = 'none';
  if (loginError) {
    loginError.textContent = error;
    loginError.style.display = error ? 'block' : 'none';
  }
}

function showLoggedInView(email) {
  gateView.style.display = 'none';
  loggedInView.style.display = 'flex';
  if (email && loggedInEmail) loggedInEmail.textContent = email;
}

// ===== 事件：发送 Magic Link =====
async function handleSendMagicLink(e) {
  e.preventDefault();
  const emailInput = document.getElementById('magic-email');
  const email = (emailInput?.value || '').trim();

  if (!email) {
    if (loginError) {
      loginError.textContent = '请输入邮箱地址。';
      loginError.style.display = 'block';
    }
    return;
  }

  const btn = document.getElementById('send-magic-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '发送中...';
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: 'send_magic_link', email });
    if (response?.success) {
      lastMagicEmail = email;
      showMagicLinkSentView(email, '');
    } else {
      if (loginError) {
        loginError.textContent = response?.error || '发送失败，请重试。';
        loginError.style.display = 'block';
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = '发送登录链接';
      }
    }
  } catch (err) {
    console.error('[SIDEPANEL] send_magic_link error:', err);
    if (loginError) {
      loginError.textContent = '发送失败，请检查网络后重试。';
      loginError.style.display = 'block';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '发送登录链接';
    }
  }
}

// 显示"已发送"视图
function showMagicLinkSentView(email, hintText = '') {
  const safeEmail = (email || lastMagicEmail || '').replace(/</g, '');
  if (gateContent) gateContent.style.display = 'none';
  const hintDisplay = hintText ? 'block' : 'none';
  const safeHint = String(hintText).replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (gateDesc) gateDesc.innerHTML = `
    <p>登录链接已发送到</p>
    <p style="color:#fff;font-weight:500;margin:4px 0;">${safeEmail}</p>
    <p style="margin-top:8px;">请用<strong>本机 Chrome</strong>打开邮件里的链接；会先打开本站登录页并完成登录，会话会自动同步到扩展（请保持扩展已安装并启用）。</p>
    <p id="magic-link-hint" style="display:${hintDisplay};color:#f87171;font-size:12px;margin-top:12px;text-align:left;line-height:1.5;">${safeHint}</p>
    <button id="check-login-btn" type="button" style="
      margin-top:20px;padding:10px 20px;background:#2563eb;color:#fff;
      border:none;border-radius:8px;font-size:14px;cursor:pointer;width:100%;
    ">我已点击链接，刷新状态</button>
    <button id="retry-btn" type="button" style="
      margin-top:8px;padding:8px;background:transparent;color:#888;
      border:none;font-size:13px;cursor:pointer;width:100%;
    ">重新输入邮箱</button>
  `;

  document.getElementById('check-login-btn')?.addEventListener('click', onRefreshMagicLinkStatus);
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    lastMagicEmail = '';
    if (gateContent) gateContent.style.display = 'block';
    if (gateDesc) {
      gateDesc.innerHTML = '输入邮箱，我们会发送一个登录链接给你。';
      gateDesc.style.display = 'block';
    }
    if (loginError) loginError.style.display = 'none';
  });
}

async function onRefreshMagicLinkStatus() {
  const btn = document.getElementById('check-login-btn');
  const hint = document.getElementById('magic-link-hint');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在检查…';
  }
  if (hint) {
    hint.style.display = 'none';
    hint.textContent = '';
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
    if (response?.state === 'authenticated' && response?.user) {
      showLoggedInView(response.user.email || response.user.user_metadata?.email);
      return;
    }
    const failMsg =
      '仍未检测到登录。请确认：① 已从<strong>扩展里</strong>发送 Magic Link（不要用网站登录发邮件）；② 点邮件链接后是否打开了带 <code>from_extension=1</code> 的地址（如 …/auth/callback?from_extension=1）；③ 在 Supabase → Authentication → Redirect URLs 中已加入该完整地址（扩展后台日志里会打印）。完成后回到此处再点刷新。';
    if (hint) {
      hint.innerHTML = failMsg;
      hint.style.display = 'block';
    }
  } catch (err) {
    console.error('[SIDEPANEL] check_auth_status', err);
    if (hint) {
      hint.textContent = '检查失败：' + (err.message || '请稍后重试');
      hint.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '我已点击链接，刷新状态';
    }
  }
}

// ===== 事件：退出登录 =====
async function handleLogout() {
  try {
    await chrome.runtime.sendMessage({ action: 'logout' });
    init();
  } catch (err) {
    init();
  }
}

// ===== 监听 background 广播 =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'auth_status_changed') {
    if (message.authenticated && message.user) {
      showLoggedInView(message.user.email);
    } else {
      showGateView();
    }
  }
});

// ===== 初始化 =====
async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
    if (response.state === 'authenticated' && response.user) {
      showLoggedInView(response.user.email);
    } else {
      showGateView();
    }
  } catch (err) {
    showGateView();
  }
}

// 已登录视图的退出按钮
document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

// 门禁视图的发送链接表单
document.getElementById('magic-link-form')?.addEventListener('submit', handleSendMagicLink);

init();
