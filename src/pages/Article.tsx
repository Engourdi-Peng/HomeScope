import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SiteLayout } from '../components/SiteLayout';
import { fetchArticleBySlug, fetchArticleCategories } from '../lib/articles/client';
import type {
  ArticleCategory,
  ArticleDetailResponse,
  ArticleSummary,
} from '../lib/articles/types';

const SITE_URL = 'https://www.tryhomescope.com';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export function ArticleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ArticleDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ArticleCategory[]>([]);

  const contentRef = useRef<HTMLElement | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    fetchArticleCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setToc([]);
    setActiveId(null);
    setProgress(0);
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

  // Build a stable slug → heading id map by walking the rendered article once.
  // Also inject `id` attributes so anchor links and IntersectionObserver work.
  useEffect(() => {
    if (!article || !contentRef.current) return;
    const headings = contentRef.current.querySelectorAll<HTMLElement>('h2, h3');
    const items: TocItem[] = [];
    headings.forEach((h, i) => {
      const level = h.tagName === 'H2' ? 2 : 3;
      const text = (h.textContent || '').trim();
      if (!text) return;
      const id = h.id || `article-h-${i}`;
      h.id = id;
      items.push({ id, text, level: level as 2 | 3 });
    });
    setToc(items);
  }, [article]);

  // Track scroll position: 0 → 1 progress over the whole document.
  useEffect(() => {
    if (!article) return;
    let ticking = false;

    const update = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const viewport = window.innerHeight;
      const fullHeight = doc.scrollHeight;
      const denominator = Math.max(1, fullHeight - viewport);
      const next = Math.min(1, Math.max(0, scrollTop / denominator));
      setProgress((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [article]);

  // Highlight the heading that is currently closest to the top of the viewport.
  useEffect(() => {
    if (!article || toc.length === 0 || !contentRef.current) return;
    const root = contentRef.current;
    const elements = toc
      .map((item) => root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top that is intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Trigger when heading crosses the upper third of the viewport.
        rootMargin: '-96px 0px -66% 0px',
        threshold: [0, 1],
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [article, toc]);

  const categoryName = useMemo(() => {
    if (!article?.category_id) return null;
    return categories.find((c) => c.id === article.category_id)?.name ?? null;
  }, [article, categories]);

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
      {/* Reading progress bar (fixed top, transform-driven) */}
      <div className="article-progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div
          className="article-progress__bar"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <div className="article-enter">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="text-xs text-stone-500 mb-6 flex flex-wrap items-center gap-2">
          <Link to="/" className="hover:text-stone-700">Home</Link>
          <span aria-hidden="true">/</span>
          <Link to="/blog" className="hover:text-stone-700">Blog</Link>
          <span aria-hidden="true">/</span>
          <span className="text-stone-700 line-clamp-1">{article.title}</span>
        </nav>

        {/* Editorial hero */}
        <header className="article-hero mx-auto max-w-3xl pt-8 md:pt-12 pb-10 text-center">
          {categoryName && (
            <p className="article-eyebrow">
              <Link to={`/blog?category=${encodeURIComponent(categoryName)}`} className="hover:underline">
                {categoryName}
              </Link>
            </p>
          )}
          <h1 className="article-hero-title text-4xl md:text-5xl lg:text-6xl mt-4">
            {article.title}
          </h1>
          {article.excerpt && (
            <p className="article-hero-dek mt-6">{article.excerpt}</p>
          )}
          <p className="article-meta mt-6 flex justify-center items-center gap-3 flex-wrap">
            <span>{article.author_name}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={article.published_at || ''}>{formatDate(article.published_at)}</time>
            {article.reading_time_minutes ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{article.reading_time_minutes} min read</span>
              </>
            ) : null}
          </p>
        </header>

        {/* Cover image */}
        {article.cover_image_url && (
          <figure className="mx-auto max-w-4xl mb-12 md:mb-16">
            <img
              src={article.cover_image_url}
              alt={article.cover_alt || article.title}
              className="w-full aspect-[16/9] object-cover rounded-2xl"
            />
            {article.cover_alt && article.cover_alt !== article.title && (
              <figcaption className="mt-3 text-xs text-stone-500 text-center">
                {article.cover_alt}
              </figcaption>
            )}
          </figure>
        )}

        {/* Body + sticky TOC
            Approach: the prose container owns its 720px measure and is horizontally
            centered within the page (like Substack/Medium). The TOC is pulled out
            of normal flow with absolute positioning so it can float in the right
            gutter on wide screens, then snap inline above the article on narrow
            screens. This gives symmetric outer gutters around the body and keeps
            the reading measure stable. */}
        <div className="relative mx-auto w-full max-w-[1200px] px-4 md:px-6">
          {toc.length > 0 ? (
            <div className="hidden xl:grid xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-10 xl:items-start">
              <article
                ref={contentRef}
                className="article-prose"
                style={{ marginLeft: 0, marginRight: 'auto' }}
                dangerouslySetInnerHTML={{ __html: article.content_html }}
              />
              <aside aria-label="Table of contents" className="relative">
                <div className="sticky top-24">
                  <nav className="article-toc">
                    <p className="article-toc__label">In this article</p>
                    <ul className="article-toc__list">
                      {toc.map((item) => (
                        <li key={item.id} className="article-toc__item">
                          <a
                            href={`#${item.id}`}
                            className={`article-toc__link article-toc__link--level-${item.level}${
                              activeId === item.id ? ' is-active' : ''
                            }`}
                          >
                            {item.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </div>
              </aside>
            </div>
          ) : (
            <article
              ref={contentRef}
              className="article-prose mx-auto"
              dangerouslySetInnerHTML={{ __html: article.content_html }}
            />
          )}
        </div>

        {/* Tags */}
        {article.tags && article.tags.length > 0 && (
          <div className="mx-auto max-w-3xl mt-16 pt-10 border-t border-stone-200 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <Link
                key={tag}
                to={`/blog?tag=${encodeURIComponent(tag)}`}
                className="text-xs text-stone-600 bg-stone-100 px-3 py-1.5 rounded-full hover:bg-stone-200"
              >
                #{tag}
              </Link>
            ))}
          </div>
        )}

        {/* Related articles — wide editorial cards for "next read" rhythm */}
        {data && data.related.length > 0 && (
          <section className="mx-auto max-w-3xl mt-20 pt-12 border-t border-stone-200">
            <p className="article-eyebrow mb-3">Continue reading</p>
            <h2 className="article-hero-title text-2xl md:text-3xl mb-8">
              More from HomeScope
            </h2>
            <div className="space-y-6">
              {data.related.map((rel: ArticleSummary) => (
                <Link
                  key={rel.id}
                  to={`/blog/${rel.slug}`}
                  className="group flex gap-5 bg-white/70 border border-stone-200 rounded-2xl overflow-hidden hover:border-stone-400 transition-colors"
                >
                  {rel.cover_image_url && (
                    <div className="w-32 md:w-44 shrink-0 bg-stone-100 overflow-hidden">
                      <img
                        src={rel.cover_image_url}
                        alt={rel.cover_alt || rel.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  )}
                  <div className="py-4 pr-5 flex flex-col justify-center">
                    <h3 className="article-hero-title text-lg md:text-xl mb-2 leading-snug group-hover:underline decoration-stone-300">
                      {rel.title}
                    </h3>
                    {rel.excerpt && (
                      <p className="text-sm text-stone-600 leading-relaxed line-clamp-2 mb-2">
                        {rel.excerpt}
                      </p>
                    )}
                    <p className="text-xs text-stone-500 uppercase tracking-widest">
                      {formatDate(rel.published_at)}
                      {rel.reading_time_minutes ? ` · ${rel.reading_time_minutes} min read` : ''}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Closing CTA — editorial back-matter */}
        <section className="mx-auto max-w-3xl mt-20 mb-8 rounded-2xl bg-stone-900 text-white overflow-hidden">
          <div className="grid md:grid-cols-[1fr_auto] gap-6 md:gap-10 p-8 md:p-12 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-stone-400 mb-3">
                Take it further
              </p>
              <p className="font-serif text-2xl md:text-3xl leading-snug text-balance">
                Ready to read a listing like an analyst? Paste any Zillow URL
                and get a buyer-focused risk review in minutes.
              </p>
            </div>
            <Link
              to="/"
              className="inline-flex items-center justify-center px-6 py-3 bg-white text-stone-900 text-sm font-semibold rounded-lg hover:bg-stone-100 transition-colors whitespace-nowrap"
            >
              Try HomeScope
              <span aria-hidden="true" className="ml-2">→</span>
            </Link>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}

export default ArticleDetailPage;
