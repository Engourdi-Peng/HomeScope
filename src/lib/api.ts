import { supabase } from './supabase';
import { SUPABASE_PROJECT_REF, SUPABASE_ANON_KEY } from '../../shared/config';
import type { AnalyzeRequest, AnalysisProgress, AnalysisResult, AnalysisSummary, AnalysisHistoryResponse, AnalysisDetailResponse } from '../types';

// Supabase Edge Function URL
const API_BASE_URL = import.meta.env.VITE_API_URL || `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/analyze`;

// ========== Utility Helpers ==========

/** Decode JWT payload (no verify). Returns { exp, iat, aud } or null. */
function decodeJwtPayload(token: string): { exp?: number; iat?: number; aud?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const raw = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(raw) as { exp?: number; iat?: number; aud?: string };
  } catch {
    return null;
  }
}

/**
 * Get current session and validate authentication
 * Returns session with access_token for authenticated API calls
 */
async function getAuthenticatedSession(): Promise<{ session: any; user: any }> {
  const { data: { session } } = await supabase.auth.getSession();
  
  const user = session?.user ?? null;
  
  console.log('=== Auth Session Check ===');
  console.log('Session exists:', !!session);
  console.log('Access token exists:', !!session?.access_token);
  console.log('User email:', user?.email || 'N/A');
  
  return { session, user };
}

/**
 * Build headers for authenticated API calls
 * Must include both apikey (anon key) and Authorization (user token)
 */
function buildAuthHeaders(session: any): HeadersInit {
  const token = session?.access_token;
  const tokenPreview = token ? token.substring(0, 10) : 'NONE';
  
  console.log('=== Building Auth Headers ===');
  console.log('Authorization token preview:', tokenPreview);
  console.log('Token is anon key?', token === SUPABASE_ANON_KEY);
  console.log('Token starts with eyJ?', token?.startsWith('eyJ'));
  
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
  };
}


// ========== Storage Upload Functions ==========

/**
 * Upload a single image file to Supabase Storage
 * @param file - The image File object (should be pre-compressed)
 * @returns Promise<string> - The public URL of the uploaded image
 */
export async function uploadImageToStorage(file: File): Promise<string> {
  // Ensure file is a true File instance (convert from Blob if needed)
  let uploadFile: File = file;
  if (!(file instanceof File)) {
    const blob = file as Blob;
    uploadFile = new File([blob], blob.type ? 'image.jpg' : 'image.jpg', {
      type: blob.type || 'image/jpeg'
    });
  }

  // Debug logging
  console.log('Uploading file:', uploadFile);
  console.log('File type:', uploadFile.type);
  console.log('Is File:', uploadFile instanceof File);

  const ext = uploadFile.name.split('.').pop() || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = `uploads/${fileName}`;

  console.log('Upload path:', filePath);
  console.log('Content-Type:', uploadFile.type || 'image/jpeg');

  // Use Supabase SDK for upload
  const { data, error } = await supabase.storage
    .from('listing-images')
    .upload(filePath, uploadFile, {
      contentType: uploadFile.type || 'image/jpeg',
      upsert: false,
    });

  if (error) {
    console.error('Storage upload error:', error);
    throw error;
  }

  console.log('Upload success:', data);

  // Return public URL
  const { data: urlData } = supabase.storage
    .from('listing-images')
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

/**
 * Upload multiple images to Supabase Storage
 * @param files - Array of image File objects (pre-compressed)
 * @returns Promise<string[]> - Array of public URLs
 */
export async function uploadImagesToStorage(files: File[]): Promise<string[]> {
  const uploadPromises = files.map((file) => uploadImageToStorage(file));
  return Promise.all(uploadPromises);
}

// ========== Step 1: Submit - 创建分析任务 ==========
export async function submitAnalysis(data: AnalyzeRequest): Promise<{ id: string; status: string }> {
  const url = `${API_BASE_URL}?action=submit`;
  console.log('submitAnalysis URL:', url);

  // Get authenticated session with user token
  const { session, user } = await getAuthenticatedSession();
  
  // Must have valid user session with access token
  if (!session?.access_token) {
    console.error('submitAnalysis: No access token - user not authenticated');
    throw new Error('Please sign in first to analyze listings.');
  }
  
  console.log('submitAnalysis: User email:', user?.email);

  // #region agent log
  const token = session.access_token as string;
  const tokenLen = token?.length ?? 0;
  const tokenParts = token ? token.split('.').length : 0;
  const tokenIsAnon = token === SUPABASE_ANON_KEY;
  const payload = decodeJwtPayload(token);
  const nowSec = Math.floor(Date.now() / 1000);
  const isExpired = payload?.exp != null && nowSec > payload.exp;
  console.log('[DEBUG JWT] tokenLen=%s tokenParts=%s tokenIsAnon=%s isExpired=%s payload=%o', tokenLen, tokenParts, tokenIsAnon, isExpired, payload);
  fetch('http://127.0.0.1:7873/ingest/14e98dc4-2a4e-4ddd-8421-c56a70cfbbc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c16c5f'},body:JSON.stringify({sessionId:'c16c5f',location:'api.ts:submitAnalysis',message:'JWT diagnostic',data:{tokenLen,tokenParts,tokenIsAnon,payloadExp:payload?.exp,payloadIat:payload?.iat,payloadAud:payload?.aud,nowSec,isExpired},timestamp:Date.now(),hypothesisId:'A,B,C,E'})}).catch(()=>{});
  // #endregion

  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify(data),
  });

  // Debug: 打印实际发送的请求头
  console.log('=== Actual Request Sent ===');
  console.log('Full headers sent:', {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session?.access_token}`,
  });
  console.log('Authorization token (full):', session?.access_token);

  // 改进错误处理：先读取 response body，再解析
  const raw = await response.text();
  
  let responsePayload: any = null;
  let parseError: string | null = null;
  
  if (raw) {
    try {
      responsePayload = JSON.parse(raw);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
      responsePayload = { raw };
    }
  }

  console.error('=== submitAnalysis Error Response ===');
  console.error('HTTP Status:', response.status);
  console.error('Raw response:', raw);
  console.error('Parsed payload:', responsePayload);
  console.error('JSON parse error:', parseError);

  if (!response.ok) {
    // 优先使用后端返回的 error/code/message
    const errorMessage = responsePayload?.error || responsePayload?.message || `submitAnalysis failed: ${response.status}`;
    const errorCode = responsePayload?.code;
    
    console.error('Error code:', errorCode);
    console.error('Error message:', errorMessage);
    
    // 如果后端返回权限错误，解析错误信息
    if (errorCode === 'NOT_AUTHENTICATED') {
      throw new Error('Please sign in first to analyze listings.');
    }
    if (errorCode === 'NO_CREDITS') {
      throw new Error('No credits remaining. Please purchase more credits to continue.');
    }
    throw new Error(errorMessage);
  }

  // 成功时也尝试解析返回的 JSON
  if (responsePayload) {
    return responsePayload;
  }
  
  // 如果没有 payload 但 response 成功，尝试再次解析
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid response from server');
  }
}

// ========== Step 2: Run - 执行分析 ==========
export async function runAnalysis(id: string, data: AnalyzeRequest): Promise<{ ok: boolean; id: string }> {
  const url = `${API_BASE_URL}?action=run`;
  console.log('runAnalysis URL:', url, 'id:', id);

  // Get authenticated session with user token
  const { session, user } = await getAuthenticatedSession();
  
  // Must have valid user session with access token
  if (!session?.access_token) {
    console.error('runAnalysis: No access token - user not authenticated');
    throw new Error('Please sign in first to analyze listings.');
  }
  
  console.log('runAnalysis: User email:', user?.email);

  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      id,
      imageUrls: data.imageUrls,
      description: data.description,
      optionalDetails: data.optionalDetails,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to run analysis' }));
    // 如果后端返回权限错误，解析错误信息
    if (error.code === 'NOT_AUTHENTICATED') {
      throw new Error('Please sign in first to analyze listings.');
    }
    if (error.code === 'NO_CREDITS') {
      throw new Error('No credits remaining. Please purchase more credits to continue.');
    }
    throw new Error(error.message || 'Failed to run analysis');
  }

  return response.json();
}

// ========== Step 3: Poll - 轮询状态 ==========
export async function getAnalysisProgress(analysisId: string): Promise<AnalysisProgress> {
  const url = `${API_BASE_URL}?id=${analysisId}`;
  console.log('getAnalysisProgress URL:', url);
  
  // Get authenticated session with user token
  const { session } = await getAuthenticatedSession();
  
  // Must have valid user session with access token
  if (!session?.access_token) {
    console.error('getAnalysisProgress: No access token - user not authenticated');
    throw new Error('Please sign in first to check analysis progress.');
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(session),
  });

  if (!response.ok) {
    throw new Error('Failed to get analysis progress');
  }

  return response.json();
}

// ========== 兼容旧版 - 不再使用 ==========
export async function analyzeListing(_data: AnalyzeRequest): Promise<{ id?: string; status?: string; overallScore?: number } | AnalysisResult> {
  throw new Error('Use submitAnalysis + runAnalysis instead');
}

// ========== Image Compression for Storage Upload =========-

export interface CompressedFile {
  file: File;
  originalSize: number;
  compressedSize: number;
}

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 1280;
const TARGET_QUALITY = 0.7;

/**
 * Compress an image file for upload to Supabase Storage
 * Returns a compressed File object (not base64)
 */
export async function compressImageForUpload(file: File): Promise<CompressedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        let quality = TARGET_QUALITY;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Keep reducing quality until under 500KB
        while (dataUrl.length > 500 * 1024 && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        // Convert dataURL to File object
        const base64 = dataUrl.split(',')[1];
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const compressedFile = new File([byteArray], file.name, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });

        resolve({
          file: compressedFile,
          originalSize: file.size,
          compressedSize: compressedFile.size,
        });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Legacy function - kept for backward compatibility but returns File instead of base64
// Use compressImageForUpload instead
export async function compressImage(file: File): Promise<{ base64: string; originalSize: number; compressedSize: number }> {
  const compressed = await compressImageForUpload(file);

  // Convert File back to base64 for any legacy code that might need it
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({
        base64,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(compressed.file);
  });
}

// ========== Analysis History Functions ==========

/**
 * Get user's analysis history
 * @param limit - Number of records to fetch (default 20)
 * @param offset - Number of records to skip (default 0)
 */
export async function getAnalysisHistory(limit = 20, offset = 0): Promise<AnalysisSummary[]> {
  const { session } = await getAuthenticatedSession();

  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }

  const url = `${API_BASE_URL}?action=list&limit=${limit}&offset=${offset}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(session),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch history' }));
    throw new Error(error.message || 'Failed to fetch history');
  }

  const data: AnalysisHistoryResponse = await response.json();
  return data.analyses || [];
}

/**
 * Get a single analysis by ID (for viewing from history)
 * @param id - Analysis ID
 */
export async function getAnalysisById(id: string): Promise<AnalysisSummary> {
  const { session } = await getAuthenticatedSession();

  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }

  const url = `${API_BASE_URL}?action=get&id=${id}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(session),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Analysis not found' }));
    throw new Error(error.message || 'Failed to fetch analysis');
  }

  const data: AnalysisDetailResponse = await response.json();
  if (!data.analysis) {
    throw new Error('Analysis not found');
  }

  return data.analysis;
}

/**
 * Share an analysis (make it public)
 * @param analysisId - Analysis ID to share
 */
export async function shareAnalysis(analysisId: string): Promise<{ success: boolean; slug: string; shareUrl: string }> {
  const { session } = await getAuthenticatedSession();

  if (!session?.access_token) {
    throw new Error('Please sign in first.');
  }

  const response = await fetch(`${API_BASE_URL}?action=share`, {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({ analysisId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to share analysis' }));
    throw new Error(error.message || 'Failed to share analysis');
  }

  return response.json();
}

/**
 * Get a public shared analysis by slug (no auth required)
 * @param slug - Share slug
 */
export async function getPublicAnalysis(slug: string): Promise<AnalysisSummary> {
  const response = await fetch(`${API_BASE_URL}?action=public&slug=${encodeURIComponent(slug)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Analysis not found' }));
    throw new Error(error.message || 'Analysis not found');
  }

  const data = await response.json();
  if (!data.analysis) {
    throw new Error('Analysis not found');
  }

  return data.analysis;
}
