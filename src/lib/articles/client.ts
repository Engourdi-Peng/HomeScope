/**
 * 文章公开 API 客户端
 *
 * 浏览器侧通过 Edge Function `articles-public` 读取数据，避开直接访问 Supabase
 * REST 带来的字段过滤差异。所有调用走 Vercel Functions 同源代理，回退到
 * Supabase URL 兜底。
 */
import type {
  Article,
  ArticleDetailResponse,
  ArticleListResponse,
  ArticleCategory,
} from './types';
import { SUPABASE_ANON_KEY } from '../../../shared/config';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  (typeof process !== 'undefined' && process.env?.SUPABASE_URL) ||
  'https://trteewgplkqiedonomzg.supabase.co';

const PUBLIC_FN = `${SUPABASE_URL}/functions/v1/articles-public`;

interface FetchOptions {
  signal?: AbortSignal;
}

function buildHeaders(): Record<string, string> {
  // Supabase 网关对所有 Edge Function 调用都要求 apikey + Authorization 头，
  // 即使 verify_jwt=false 也要带，否则会在到达函数前返回 401。
  // 用 anon key（公开、不可写），有用户 session 时换成 access_token 更佳，
  // 但当前公开端点不需要鉴权，统一 anon 即可。
  const headers: Record<string, string> = {
    Accept: 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: SUPABASE_ANON_KEY ? `Bearer ${SUPABASE_ANON_KEY}` : '',
  };
  return headers;
}

async function fetchJson<T>(action: string, params: Record<string, string | number | undefined> = {}, opts: FetchOptions = {}): Promise<T> {
  const url = new URL(PUBLIC_FN);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    signal: opts.signal,
    headers: buildHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`articles-public ${action} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchArticleList(opts: {
  page?: number;
  limit?: number;
  category?: string;
  tag?: string;
  q?: string;
  signal?: AbortSignal;
} = {}): Promise<ArticleListResponse> {
  return fetchJson<ArticleListResponse>(
    'list',
    {
      page: opts.page ?? 1,
      limit: opts.limit ?? 12,
      category: opts.category,
      tag: opts.tag,
      q: opts.q,
    },
    { signal: opts.signal }
  );
}

export async function fetchArticleBySlug(slug: string, opts: FetchOptions = {}): Promise<ArticleDetailResponse> {
  return fetchJson<ArticleDetailResponse>('get', { slug }, opts);
}

export async function fetchArticleRedirect(slug: string): Promise<string | null> {
  const data = await fetchJson<{ redirect: string | null }>('redirect', { slug });
  return data.redirect;
}

export async function fetchArticleCategories(): Promise<ArticleCategory[]> {
  const data = await fetchJson<{ categories: ArticleCategory[] }>('categories');
  return data.categories || [];
}

/** 用于服务端 HTML 渲染：在 Vercel 函数内直接读取。 */
export const ARTICLES_PUBLIC_BASE = PUBLIC_FN;

export type { Article, ArticleDetailResponse, ArticleListResponse, ArticleCategory };