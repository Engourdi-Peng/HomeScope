import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteLayout } from '../components/SiteLayout';
import {
  fetchArticleList,
  fetchArticleCategories,
} from '../lib/articles/client';
import type { ArticleSummary, ArticleCategory } from '../lib/articles/types';

const SITE_URL = 'https://www.tryhomescope.com';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function BlogIndexPage() {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 12;

  useEffect(() => {
    fetchArticleCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchArticleList({ page, limit, category: activeCategory, q: query })
      .then((res) => {
        if (cancelled) return;
        setArticles(res.rows || []);
        setTotal(res.total || 0);
      })
      .catch((err) => {
        if (cancelled) return;
        // 后端错误文本可能是裸 JSON，不直接展示给用户
        const raw = err instanceof Error ? err.message : 'Failed to load articles';
        const friendly = /401|UNAUTHORIZED|auth/i.test(raw)
          ? "We're having trouble loading articles right now. Please try again in a moment."
          : "Articles couldn't be loaded. Please refresh the page.";
        setError(friendly);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, activeCategory, query]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const featured = articles[0];
  const rest = articles.slice(1);

  useEffect(() => {
    const title = query
      ? `Blog — "${query}" | HomeScope`
      : activeCategory
        ? `Blog — ${categories.find((c) => c.slug === activeCategory)?.name ?? 'Category'} | HomeScope`
        : 'HomeScope Blog — Insights on Listings, Buying, and Renting Smarter';
    const description =
      'Practical guides for reviewing Zillow and realestate.com.au listings, comparing homes, and asking the right questions before you tour.';
    document.title = title;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const url = activeCategory
      ? `${SITE_URL}/blog/category/${activeCategory}`
      : query
        ? `${SITE_URL}/blog?q=${encodeURIComponent(query)}`
        : `${SITE_URL}/blog`;
    canonical.href = url;
  }, [activeCategory, categories, query]);

  return (
    <SiteLayout>
      <div className="mb-10 text-center">
        <h1 className="text-3xl md:text-4xl font-light tracking-tight text-stone-900 mb-3">
          HomeScope Blog
        </h1>
        <p className="text-stone-600 max-w-2xl mx-auto">
          Insights, checklists, and real-world walk-throughs for buyers and renters reviewing Zillow and realestate.com.au listings.
        </p>
      </div>

      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <nav aria-label="Article categories" className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={() => { setActiveCategory(undefined); setPage(1); }}
            className={`px-3 py-1.5 rounded-full border transition-colors ${
              !activeCategory
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => { setActiveCategory(cat.slug); setPage(1); }}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                activeCategory === cat.slug
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </nav>
        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); setPage(1); }}
          className="flex items-center gap-2"
        >
          <label htmlFor="blog-search" className="sr-only">Search articles</label>
          <input
            id="blog-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles…"
            className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
          />
        </form>
      </div>

      {error && (
        <div className="p-4 mb-6 rounded-2 bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white/60 rounded-2xl border border-stone-200 p-6 animate-pulse">
              <div className="h-40 bg-stone-100 rounded-xl mb-4" />
              <div className="h-4 bg-stone-100 rounded mb-2 w-3/4" />
              <div className="h-3 bg-stone-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!loading && articles.length === 0 && (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-stone-100 text-stone-400 mb-5" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="13" y2="17" />
            </svg>
          </div>
          <p className="text-stone-500 text-sm">No articles published yet. Check back soon.</p>
        </div>
      )}

      {!loading && featured && (
        <article className="mb-12">
          <Link to={`/blog/${featured.slug}`} className="block group">
            <div className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] grid md:grid-cols-2">
              <div className="aspect-[16/10] md:aspect-auto bg-stone-100 overflow-hidden">
                {featured.cover_image_url ? (
                  <img
                    src={featured.cover_image_url}
                    alt={featured.cover_alt || featured.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-stone-200 to-stone-300" aria-hidden="true" />
                )}
              </div>
              <div className="p-6 md:p-10 flex flex-col justify-center">
                <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">Featured</p>
                <h2 className="text-2xl md:text-3xl font-semibold text-stone-900 leading-tight mb-3 group-hover:underline decoration-stone-300">
                  {featured.title}
                </h2>
                {featured.excerpt && (
                  <p className="text-stone-600 mb-4 leading-relaxed line-clamp-3">{featured.excerpt}</p>
                )}
                <p className="text-xs text-stone-500">
                  {formatDate(featured.published_at)}{featured.reading_time_minutes ? ` · ${featured.reading_time_minutes} min read` : ''}
                </p>
              </div>
            </div>
          </Link>
        </article>
      )}

      {!loading && rest.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rest.map((article) => (
            <Link
              key={article.id}
              to={`/blog/${article.slug}`}
              className="group block bg-white/70 rounded-2xl border border-stone-200 overflow-hidden hover:border-stone-400 transition-colors"
            >
              <div className="aspect-[16/9] bg-stone-100 overflow-hidden">
                {article.cover_image_url ? (
                  <img
                    src={article.cover_image_url}
                    alt={article.cover_alt || article.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-stone-200 to-stone-300" aria-hidden="true" />
                )}
              </div>
              <div className="p-5">
                <h3 className="text-base font-semibold text-stone-900 leading-snug mb-2 line-clamp-2 group-hover:underline decoration-stone-300">
                  {article.title}
                </h3>
                {article.excerpt && (
                  <p className="text-sm text-stone-500 leading-relaxed mb-3 line-clamp-2">{article.excerpt}</p>
                )}
                <p className="text-xs text-stone-400">
                  {formatDate(article.published_at)}{article.reading_time_minutes ? ` · ${article.reading_time_minutes} min read` : ''}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-10 flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                p === page
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </SiteLayout>
  );
}

export default BlogIndexPage;