import { useEffect, useState } from 'react';
import { Zap, Sparkles, ArrowRight } from 'lucide-react';

interface FirstInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBasicAnalysis: () => void;
  onDeepAnalysis: () => void;
  creditsRemaining: number;
}

/**
 * First Install Modal - 首次安装弹窗
 * 用户首次安装插件并登录后显示此弹窗
 */
export function FirstInstallModal({
  isOpen,
  onClose,
  onBasicAnalysis,
  onDeepAnalysis,
  creditsRemaining,
}: FirstInstallModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
    }
  }, [isOpen]);

  if (!isOpen && !visible) return null;

  const handleBasicClick = () => {
    setVisible(false);
    setTimeout(() => {
      onBasicAnalysis();
      onClose();
    }, 300);
  };

  const handleDeepClick = () => {
    setVisible(false);
    setTimeout(() => {
      onDeepAnalysis();
      onClose();
    }, 300);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          setVisible(false);
          setTimeout(onClose, 300);
        }}
      />

      {/* Modal Content */}
      <div
        className={`relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 transform transition-all duration-300 ${
          visible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-stone-900 mb-2">
            Welcome to HomeScope!
          </h2>
          <p className="text-sm text-stone-600">
            Try our free basic analysis or use your {creditsRemaining} deep analysis{creditsRemaining !== 1 ? 'es' : ''}
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {/* Basic Analysis - Free */}
          <button
            onClick={handleBasicClick}
            className="w-full p-4 bg-stone-50 hover:bg-stone-100 border-2 border-stone-200 hover:border-stone-300 rounded-xl transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-stone-900">Basic Analysis</span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    Free
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  Quick scan of listing + first 4 photos
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Deep Analysis - Uses Credits */}
          {creditsRemaining > 0 && (
            <button
              onClick={handleDeepClick}
              className="w-full p-4 bg-stone-900 hover:bg-stone-800 rounded-xl transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Deep Analysis</span>
                    <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full font-medium">
                      {creditsRemaining} left
                    </span>
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">
                    Full report with all photos analyzed
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          )}
        </div>

        {/* Skip */}
        <button
          onClick={() => {
            setVisible(false);
            setTimeout(onClose, 300);
          }}
          className="w-full mt-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
