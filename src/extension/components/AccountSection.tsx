import React from 'react';
import { User, LogOut } from 'lucide-react';
import { useAppState, useActions } from '../store';

export function AccountSection() {
  const { user, credits, authStatus } = useAppState();
  const { logout } = useActions();

  if (authStatus !== 'logged_in' || !user) return null;

  const displayName = user.email?.split('@')[0] || 'User';

  return (
    <section className="ext-panel ext-account-panel">
      <div className="ext-account-row">
        <div className="ext-account-main">
          <div className="ext-account-avatar-v2">
            {user.avatar ? <img src={user.avatar} alt="" /> : <User size={20} strokeWidth={1.75} />}
          </div>
          <div className="ext-account-text">
            <div className="ext-account-name-v2">{displayName}</div>
            <div className="ext-account-credits-v2">
              Credits: <span className="ext-account-credits-value">{credits}</span> remaining
            </div>
          </div>
        </div>
        <button type="button" className="ext-icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
          <LogOut size={18} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  );
}
