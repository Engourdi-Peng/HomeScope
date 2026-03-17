import { Check } from 'lucide-react';
import type { FormEvent } from 'react';

interface PricingCardProps {
  title: string;
  price: string;
  reportCount: string;
  description: string;
  features: string[];
  buttonText: string;
  isPopular?: boolean;
  onBuy?: (productId: string, e?: FormEvent) => void;
  productId?: string;
  isLoading?: boolean;
}

export function PricingCard({
  title,
  price,
  reportCount,
  description,
  features,
  buttonText,
  isPopular = false,
  onBuy,
  productId,
  isLoading = false,
}: PricingCardProps) {
  const handleClick = (e: FormEvent) => {
    if (onBuy && productId) {
      onBuy(productId, e);
    }
  };

  return (
    <div className="relative flex flex-col bg-[rgba(250,250,249,0.4)] border-[0.667px] border-solid border-[rgba(231,229,228,0.8)] rounded-[24px] p-8 h-full">
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <div className="bg-[rgba(255,255,255,0.6)] border-[0.667px] border-solid border-[rgba(231,229,228,0.6)] rounded-full px-4 py-1.5">
            <p className="font-medium text-[10px] tracking-[1px] uppercase text-[#79716b]">
              Most popular
            </p>
          </div>
        </div>
      )}
      
      <div className="mb-6">
        <p className="font-medium text-[14px] tracking-[1.4px] uppercase text-[#292524] mb-2">
          {title}
        </p>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-[40px] font-light text-[#1c1917] tracking-[-1px]">
            {price}
          </span>
        </div>
        <p className="text-sm tracking-[1px] uppercase text-black font-bold mb-3">
          {reportCount}
        </p>
        <p className="text-[15px] font-light text-[#79716b] leading-[24.375px]">
          {description}
        </p>
      </div>

      <div className="flex-1 mb-6">
        <ul className="space-y-3">
          {features.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <Check className="w-4 h-4 text-[#79716b]" strokeWidth={1.5} />
              </div>
              <span className="text-[14px] font-light text-[#292524] leading-[20px]">
                {feature}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="w-full bg-white text-[#292524] border-[0.667px] border-solid border-[#f5f5f4] rounded-full px-6 py-4 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] hover:bg-[#1c1917] hover:border-[#1c1917] hover:text-white hover:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.12)] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-[#f5f5f4] disabled:hover:text-[#292524]"
      >
        <span className="font-medium text-[14px]">
          {isLoading ? 'Processing...' : buttonText}
        </span>
      </button>
    </div>
  );
}
