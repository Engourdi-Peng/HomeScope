import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'hs_affiliate_code';
const COOKIE_NAME = 'hs_affiliate_code';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, maxAge: number): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/**
 * Hook to capture and manage affiliate codes from URL params and user input.
 * Priority: User manual input > URL ?ref=CODE (first visit only) > localStorage > cookie
 * 
 * - Captures ?ref=CODE from URL on FIRST VISIT ONLY
 * - Stores code in localStorage and cookie (30 days)
 * - Does NOT overwrite user's manual input with URL ref on subsequent visits
 */
export function useAffiliateCode() {
  // Track if this is the first visit (for URL ref capture)
  const [hasCapturedUrlRef, setHasCapturedUrlRef] = useState(false);
  
  const [affiliateCode, setAffiliateCode] = useState<string>(() => {
    // Initial value: URL ref > localStorage > cookie
    // URL ref is captured on first visit only
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlRef = urlParams.get('ref');
      if (urlRef) {
        return urlRef.trim().toUpperCase();
      }
      return localStorage.getItem(STORAGE_KEY) || getCookie(COOKIE_NAME) || '';
    }
    return '';
  });

  // Capture ref from URL on FIRST VISIT ONLY and save to storage
  useEffect(() => {
    // Only capture URL ref once per page session
    if (hasCapturedUrlRef) {
      return;
    }
    
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');

    if (ref) {
      const code = ref.trim().toUpperCase();
      if (code && code.length > 0) {
        // Store in localStorage
        localStorage.setItem(STORAGE_KEY, code);
        // Store in cookie (30 days)
        setCookie(COOKIE_NAME, code, COOKIE_MAX_AGE);
        // Update state
        setAffiliateCode(code);
        // Mark as captured
        setHasCapturedUrlRef(true);
      }
    } else {
      // No URL ref, just mark as captured to avoid future captures
      setHasCapturedUrlRef(true);
    }
  }, [hasCapturedUrlRef]);

  // Get stored code (for reading from storage, not for overriding user input)
  // This is used primarily for reading the saved code on subsequent visits
  const getStoredCode = useCallback((): string => {
    if (typeof window !== 'undefined') {
      // Priority: localStorage > cookie
      // We do NOT return URL ref here to avoid overriding user's manual input
      const storedCode = localStorage.getItem(STORAGE_KEY) || getCookie(COOKIE_NAME) || '';
      return storedCode;
    }
    return '';
  }, []);

  // Update stored code (for manual input in checkout)
  // This is called when user types in the input box
  const updateCode = useCallback((code: string) => {
    const normalizedCode = code.trim().toUpperCase();
    setAffiliateCode(normalizedCode);
    if (normalizedCode) {
      localStorage.setItem(STORAGE_KEY, normalizedCode);
      setCookie(COOKIE_NAME, normalizedCode, COOKIE_MAX_AGE);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      // Clear cookie by setting max-age to 0
      document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    }
  }, []);

  // Clear stored code
  const clearCode = useCallback(() => {
    updateCode('');
  }, [updateCode]);

  return {
    // Current code value (for display in input box)
    affiliateCode,
    // Get stored code from storage (not URL ref)
    getStoredCode,
    // Update code (for input box onChange)
    updateCode,
    // Clear code
    clearCode,
  };
}

export { STORAGE_KEY, COOKIE_NAME };
