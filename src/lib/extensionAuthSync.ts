import type { Session, User } from '@supabase/supabase-js';

type ExtensionSyncSessionPayload = {
  access_token: string;
  refresh_token: string;
  user: User;
  flowId?: string | null;
};

type ExtensionSyncOptions = {
  flowId?: string | null;
  debug?: boolean;
};

function debugLog(enabled: boolean | undefined, message: string, ...args: unknown[]) {
  if (!enabled) return;
  console.log(message, ...args);
}

function buildPayload(session: Session, options: ExtensionSyncOptions): ExtensionSyncSessionPayload {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user: session.user,
    flowId: options.flowId ?? null,
  };
}

function buildWindowBridgeMessage(payload: ExtensionSyncSessionPayload) {
  return {
    source: 'homescope-auth-bridge',
    type: 'HOMESCOPE_SYNC_SESSION',
    payload,
  };
}

export async function syncSessionToExtension(session: Session, options: ExtensionSyncOptions = {}): Promise<boolean> {
  const payload = buildPayload(session, options);

  debugLog(options.debug, '[AuthSync] login callback received', {
    flowId: payload.flowId ?? null,
    userId: payload.user?.id ?? null,
  });

  try {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      const response = await chrome.runtime.sendMessage({
        action: 'sync_session_from_site',
        payload,
      });
      if (response?.success) {
        debugLog(options.debug, '[AuthSync] session persisted to extension storage', {
          flowId: payload.flowId ?? null,
          userId: payload.user?.id ?? null,
        });
        return true;
      }
      throw new Error(response?.error || 'Extension auth sync failed');
    }
  } catch (error) {
    debugLog(options.debug, '[AuthSync] chrome.runtime sync failed, falling back to window bridge', error);
  }

  window.postMessage(buildWindowBridgeMessage(payload), window.location.origin);
  return false;
}
