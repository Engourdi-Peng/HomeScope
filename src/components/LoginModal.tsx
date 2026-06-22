import { useState } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { X, Chrome, Loader2 } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    console.log('🔵 LoginModal: Google login button clicked');
    try {
      setError('');
      console.log('🔵 LoginModal: Calling signInWithGoogle...');
      await signInWithGoogle();
      console.log('🔵 LoginModal: signInWithGoogle returned');
    } catch (err) {
      console.error('🔴 LoginModal: Google login error:', err);
      setError('Failed to sign in with Google. Please try again.');
    }
  };

  if (!isOpen) return null;

  const handleClose = () => {
    setError('');
    onClose();
  };

  // 使用 Portal 将弹窗挂载到 body，绕过祖先元素的 transform 影响
  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
        >
          <X size={20} />
        </button>

        <div className="p-8">
          {/* 标题 */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold text-stone-900 mb-2">
              Sign In
            </h2>
            <p className="text-stone-500">
              Sign in to save your analysis history
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Google 登录按钮 */}
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-stone-300 rounded-xl text-stone-700 font-medium hover:bg-stone-50 hover:border-stone-400 transition-colors"
          >
            <Chrome size={20} />
            Continue with Google
          </button>
        </div>

        {/* 底部说明 */}
        <div className="px-8 py-4 bg-stone-50 border-t border-stone-100">
          <p className="text-xs text-stone-500 text-center">
            New users get <strong>3 analyses</strong> to try out the service.
          </p>
        </div>
      </div>
    </div>
  );

  // 使用 Portal 挂载到 document.body，确保 fixed 定位相对于视口
  return ReactDOM.createPortal(modalContent, document.body);
}
