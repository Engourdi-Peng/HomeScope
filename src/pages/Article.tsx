import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SiteLayout } from '../components/SiteLayout';
import { fetchArticleBySlug } from '../lib/articles/client';
import type { ArticleDetailResponse } from '../lib/articles/types';

const SITE_URL = 'https://www.tryhomescope.com';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ArticleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ArticleDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchArticleBySlug(slug)
      .then((res) => {
        if (cancelled) return;
        if (res.redirect) {
          navigate(`/blog/${res.redirect}`, { replace: true });
          return;
        }
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load article');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  const article = data?.article;

  useEffect(() => {
    if (!article) return;
    document.title = article.seo_title || `${article.title} | HomeScope`;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = article.seo_description || article.excerpt || '';
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = article.canonical_url || `${SITE_URL}/blog/${article.slug}`;
  }, [article]);

  if (loading) {
    return (
      <SiteLayout>
        <div className="animate-pulse">
          <div className="h-8 bg-stone-100 rounded w-3/4 mb-3" />
          <div className="h-4 bg-stone-100 rounded w-1/3 mb-8" />
          <div className="aspect-[16/9] bg-stone-100 rounded-2xl mb-10" />
          <div className="space-y-2">
            <div className="h-3 bg-stone-100 rounded w-full" />
            <div className="h-3 bg-stone-100 rounded w-11/12" />
            <div className="h-3 bg-stone-100 rounded w-10/12" />
          </div>
        </div>
      </SiteLayout>
    );
  }

  if (error || !article) {
    return (
      <SiteLayout>
        <div className="text-center py-16">
          <h1 className="text-2xl font-semibold text-stone-900 mb-3">Article not found</h1>
          <p className="text-stone-500 mb-6">{error || 'This article may have been unpublished.'}</p>
          <Link to="/blog" className="text-stone-700 underline">Back to the blog</Link>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <nav aria-label="Breadcrumb" className="text-xs text-stone-500 mb-6 flex flex-wrap items-center gap-2">
        <Link to="/" className="hover:text-stone-700">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to="/blog" className="hover:text-stone-700">Blog</Link>
        <span aria-hidden="true">/</span>
        <span className="text-stone-700 line-clamp-1">{article.title}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-semibold text-stone-900 leading-tight mb-4">
          {article.title}
        </h1>
        {article.excerpt && (
          <p className="text-lg text-stone-600 leading-relaxed mb-4">{article.excerpt}</p>
        )}
        <p className="text-sm text-stone-500">
          <span>{article.author_name}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime={article.published_at || ''}>{formatDate(article.published_at)}</time>
          {article.reading_time_minutes ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>{article.reading_time_minutes} min read</span>
            </>
          ) : null}
        </p>
      </header>

      {article.cover_image_url && (
        <figure className="mb-10">
          <img
            src={article.cover_image_url}
            alt={article.cover_alt || article.title}
            className="w-full rounded-2xl object-cover aspect-[16/9]"
          />
          {article.cover_alt && article.cover_alt !== article.title && (
            <figcaption className="mt-2 text-xs text-stone-500">{article.cover_alt}</figcaption>
          )}
        </figure>
      )}

      <article
        className="prose prose-stone max-w-none text-stone-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: article.content_html }}
      />

      {article.tags && article.tags.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <Link
              key={tag}
              to={`/blog?tag=${encodeURIComponent(tag)}`}
              className="text-xs text-stone-600 bg-stone-100 px-2 py-1 rounded-full hover:bg-stone-200"
            >
              #{tag}
            </Link>
          ))}
        </div>
      )}

      {data && data.related.length > 0 && (
        <section className="mt-16">
          <h2 className="text-xl font-semibold text-stone-900 mb-6">Continue reading</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {data.related.map((rel) => (
              <Link key={rel.id} to={`/blog/${rel.slug}`} className="group block bg-white/70 border border-stone-200 rounded-2xl overflow-hidden hover:border-stone-400">
                {rel.cover_image_url && (
                  <div className="aspect-[16/9] bg-stone-100 overflow-hidden">
                    <img
                      src={rel.cover_image_url}
                      alt={rel.cover_alt || rel.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-stone-900 mb-1 line-clamp-2 group-hover:underline">{rel.title}</h3>
                  <p className="text-xs text-stone-500">{formatDate(rel.published_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12 p-6 md:p-8 rounded-2xl bg-stone-50 border border-stone-200 text-center">
        <h2 className="text-lg font-semibold text-stone-900 mb-2">Run a HomeScope Report on a Listing</h2>
        <p className="text-stone-600 mb-4 text-sm">
          Paste any Zillow or realestate.com.au listing to get a buyer-focused risk review in minutes.
        </p>
        <Link
          to="/"
          className="inline-block px-5 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-800"
        >
          Try HomeScope
        </Link>
      </section>
    </SiteLayout>
  );
}

export default ArticleDetailPage;