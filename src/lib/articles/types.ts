/**
 * 文章相关共享类型
 */

export type ArticleStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived';

export interface ArticleCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  cover_alt: string | null;
  category_id: string | null;
  tags: string[];
  author_name: string;
  published_at: string | null;
  reading_time_minutes?: number;
}

export interface Article extends ArticleSummary {
  content_html: string;
  status: ArticleStatus;
  updated_at: string;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  og_image_url: string | null;
  noindex: boolean;
}

export interface ArticleListResponse {
  rows: ArticleSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface ArticleDetailResponse {
  article: Article;
  related: ArticleSummary[];
  redirect?: string | null;
}