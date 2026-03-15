import { useState } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { X, Mail, Chrome, Loader2 } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { signInWithGoogle, signInWithEmailLink, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

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

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    // 简单验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setError('');
      setIsEmailLoading(true);
      await signInWithEmailLink(email.trim());
      setEmailSent(true);
    } catch (err) {
      console.error('Email login error:', err);
      setError('Failed to send magic link. Please try again.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setEmailSent(false);
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
              {emailSent ? 'Check Your Email' : 'Sign In'}
            </h2>
            <p className="text-stone-500">
              {emailSent 
                ? 'We sent a magic link to your email.' 
                : 'Sign in to save your analysis history'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          {emailSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={32} className="text-green-600" />
              </div>
              <p className="text-stone-600 mb-6">
                Click the link in the email we sent to <strong>{email}</strong> to sign in.
              </p>
              <button
                onClick={() => setEmailSent(false)}
                className="text-stone-600 hover:text-stone-900 underline text-sm"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              {/* Google 登录按钮 */}
              <button
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-stone-300 rounded-xl text-stone-700 font-medium hover:bg-stone-50 hover:border-stone-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
              >
                {isLoading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Chrome size={20} />
                )}
                Continue with Google
              </button>

              {/* 分隔线 */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-stone-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-stone-500">or</span>
                </div>
              </div>

              {/* Email Magic Link 登录 */}
              <form onSubmit={handleEmailLogin}>
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  Email address
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-10 pr-4 py-3 border border-stone-300 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200 focus:border-stone-400 transition-colors"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isEmailLoading}
                    className="px-4 py-3 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isEmailLoading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      'Send Link'
                    )}
                  </button>
                </div>
                <p className="mt-3 text-xs text-stone-500">
                  We'll send you a magic link to sign in. No password needed.
                </p>
              </form>
            </>
          )}
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
