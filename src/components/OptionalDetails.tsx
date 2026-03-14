import { useState } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';
import type { OptionalDetails as OptionalDetailsType } from '../types';

interface OptionalDetailsProps {
  value: OptionalDetailsType;
  onChange: (value: OptionalDetailsType) => void;
}

export function OptionalDetails({ value, onChange }: OptionalDetailsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (field: keyof OptionalDetailsType, fieldValue: string) => {
    onChange({ ...value, [field]: fieldValue });
  };

  return (
    <div className="flex flex-col items-center mb-8">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800 transition-colors py-2 px-5 rounded-full hover:bg-stone-50 border border-transparent hover:border-stone-200"
      >
        <MapPin size={14} className="text-stone-400" strokeWidth={1.5} />
        <span className="font-medium uppercase tracking-widest text-[10px]">Location & Details</span>
        <ChevronDown size={14} className={`transition-transform duration-500 ${isOpen ? 'rotate-180' : ''}`} strokeWidth={1.5} />
      </button>
      
      <div className={`w-full grid grid-cols-1 md:grid-cols-3 gap-6 transition-all duration-700 ease-in-out origin-top ${isOpen ? 'opacity-100 scale-y-100 h-auto mt-8' : 'opacity-0 scale-y-0 h-0 m-0 overflow-hidden'}`}>
        <InputField 
          label="Price Guide / Rent" 
          placeholder="$500/week" 
          value={value.weeklyRent || ''}
          onChange={(v) => handleChange('weeklyRent', v)}
        />
        <InputField 
          label="Suburb Context" 
          placeholder="e.g. Surry Hills" 
          value={value.suburb || ''}
          onChange={(v) => handleChange('suburb', v)}
        />
        <div className="grid grid-cols-2 gap-4">
          <InputField 
            label="Beds" 
            placeholder="2" 
            type="number"
            value={value.bedrooms || ''}
            onChange={(v) => handleChange('bedrooms', v)}
          />
          <InputField 
            label="Baths" 
            placeholder="1" 
            type="number"
            value={value.bathrooms || ''}
            onChange={(v) => handleChange('bathrooms', v)}
          />
        </div>
      </div>
    </div>
  );
}

function InputField({ label, placeholder, type = "text", value, onChange }: { 
  label: string, 
  placeholder: string, 
  type?: string,
  value: string,
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col space-y-2">
      <label className="text-[10px] font-medium text-stone-500 uppercase tracking-widest pl-1">{label}</label>
      <input 
        type={type} 
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 bg-stone-50/50 border-b border-stone-200 rounded-t-xl outline-none focus:bg-stone-100 focus:border-stone-400 transition-all text-stone-700 placeholder:text-stone-300 font-light text-sm"
      />
    </div>
  );
}
