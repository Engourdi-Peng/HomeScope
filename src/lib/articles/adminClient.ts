/**
 * 文章管理后台 API 客户端
 *
 * 所有写入都通过 Edge Function `articles-admin`，由 service_role 执行。
 * 前端只持有用户 JWT（在 Authorization 头里透传），service_role key 不下发。
 */
import { supabase } from '../supabase';
import type { Article } from './types';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://trteewgplkqiedonomzg.supabase.co';
const ADMIN_FN = `${SUPABASE_URL}/functions/v1/articles-admin`;

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Not authenticated');
  }
  return data.session.access_token;
}

async function call<T>(action: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(ADMIN_FN);
  url.searchParams.set('action', action);
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new Error(
      `articles-admin ${action} failed: ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`
    );
  }
  return (await res.json()) as T;
}

export interface ArticleListAdminResponse {
  rows: Array<Pick<Article, 'id' | 'slug' | 'title' | 'status' | 'published_at' | 'updated_at' | 'scheduled_for' | 'excerpt' | 'category_id' | 'tags' | 'author_name'>>;
  total: number;
}

export async function adminListArticles(opts: { page?: number; limit?: number; status?: string; q?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  if (opts.q) params.set('q', opts.q);
  const qs = params.toString();
  const token = await getAccessToken();
  const url = new URL(ADMIN_FN);
  url.searchParams.set('action', 'list');
  if (qs) url.search = (url.search ? url.search + '&' : '?') + qs;
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`adminListArticles failed: ${res.status}`);
  }
  return (await res.json()) as ArticleListAdminResponse;
}

export async function adminGetArticle(idOrSlug: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const token = await getAccessToken();
  const url = new URL(ADMIN_FN);
  url.searchParams.set('action', 'get');
  url.searchParams.set(isUuid ? 'id' : 'slug', idOrSlug);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new Error(
      `adminGetArticle failed: ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`
    );
  }
  return (await res.json()) as { article: Article };
}

export async function adminCreateArticle(payload: Record<string, unknown>) {
  return call<{ article: Article }>('create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminUpdateArticle(id: string, payload: Record<string, unknown>) {
  return call<{ article: Article }>('update', {
    method: 'POST',
    body: JSON.stringify({ ...payload, id }),
  });
}

export async function adminDeleteArticle(id: string) {
  return call<{ ok: boolean }>(`delete&id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function adminRequestUpload(fileName: string, contentType: string) {
  return call<{ signedUrl: string | null; publicUrl: string; path: string }>('upload', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType }),
  });
}

export async function adminUploadImage(file: File): Promise<string> {
  const meta = await adminRequestUpload(file.name, file.type || 'image/jpeg');
  if (!meta.signedUrl) throw new Error('Failed to obtain signed URL');
  // The signed URL is a relative path; append to base.
  const uploadUrl = meta.signedUrl.startsWith('http')
    ? meta.signedUrl
    : `${SUPABASE_URL}/storage/v1${meta.signedUrl}`;
  const buf = await file.arrayBuffer();
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: buf,
    headers: { 'Content-Type': file.type || 'image/jpeg', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}` },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return meta.publicUrl;
}

export async function adminFetchCategories() {
  return call<{ categories: any[] }>('categories');
}