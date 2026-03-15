import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { User, LogOut, Sparkles, Settings } from 'lucide-react';

interface UserMenuProps {
  onLoginClick: () => void;
}

export function UserMenu({ onLoginClick }: UserMenuProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, creditsRemaining, signOut, isLoading } = useAuth();

  // 加载中或未登录：始终显示 Sign In 按钮，避免刷新后因 getSession 慢而看不到登录入口
  if (isLoading && !user) {
    return (
      <button
        onClick={onLoginClick}
        className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-xl font-medium text-sm hover:bg-stone-800 transition-colors opacity-90"
      >
        <User size={18} />
        Sign In
      </button>
    );
  }

  // 未登录状态
  if (!isAuthenticated) {
    return (
      <button
        onClick={onLoginClick}
        className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-xl font-medium text-sm hover:bg-stone-800 transition-colors"
      >
        <User size={18} />
        Sign In
      </button>
    );
  }

  // 已登录状态
  return (
    <div className="flex items-center gap-4">
      {/* 免费次数显示 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
        <Sparkles size={16} className="text-amber-600" />
        <span className="text-sm font-medium text-amber-800">
          {creditsRemaining} {creditsRemaining === 1 ? 'analysis' : 'analyses'} left
        </span>
      </div>

      {/* 用户信息 - 可点击进入账户页面 */}
      <button
        onClick={() => navigate('/account')}
        className="flex items-center gap-3 hover:bg-stone-50 rounded-xl p-1 -ml-1 transition-colors"
      >
        {user?.user_metadata?.avatar_url ? (
          <img
            src={user.user_metadata.avatar_url}
            alt="Avatar"
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 bg-stone-200 rounded-full flex items-center justify-center">
            <User size={16} className="text-stone-500" />
          </div>
        )}
        <span className="text-sm text-stone-700 hidden sm:block">
          {user?.email}
        </span>
      </button>

      {/* 设置/账户按钮 */}
      <button
        onClick={() => navigate('/account')}
        className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
        title="Account Settings"
      >
        <Settings size={18} />
      </button>

      {/* 登出按钮 */}
      <button
        onClick={signOut}
        className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
        title="Sign out"
      >
        <LogOut size={18} />
      </button>
    </div>
  );
}
