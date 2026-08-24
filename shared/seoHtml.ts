/**
 * 共享的 SEO HTML 渲染工具
 *
 * 用于 Vercel Serverless 与 Edge Middleware 输出包含正确 meta、JSON-LD
 * 与 OG/Twitter 标签的 HTML。Share 页与未来的 Article/Blog 页都复用此模板。
 */

export interface SeoTags {
  title: string;
  description: string;
  /** 绝对 URL，缺省时使用默认值 SITE_URL。 */
  canonicalUrl: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: 'website' | 'article' | 'profile';
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  robots?: 'index,follow' | 'noindex,nofollow' | 'noindex,follow';
  /** 注入到 <head> 末尾的额外原始 HTML（如 JSON-LD）。 */
  extraHead?: string;
  /** 可选：替换主内容容器；用于在客户端 hydrate 之外注入正文摘要。 */
  mainHtml?: string;
}

const DEFAULT_OG_IMAGE = 'https://www.tryhomescope.com/og-default.png';

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * 在已经渲染好的 index.html 基础上替换/注入 meta。
 * 优先保留原页面已经声明的 tag，避免重复输出。
 */
export function injectSeoTags(baseHtml: string, tags: SeoTags): string {
  let html = baseHtml;

  const ogTitle = tags.ogTitle ?? tags.title;
  const ogDescription = tags.ogDescription ?? tags.description;
  const ogImage = tags.ogImage ?? DEFAULT_OG_IMAGE;
  const ogType = tags.ogType ?? 'website';
  const twitterTitle = tags.twitterTitle ?? tags.title;
  const twitterDescription = tags.twitterDescription ?? tags.description;
  const twitterImage = tags.twitterImage ?? ogImage;
  const robots = tags.robots ?? 'index,follow';

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(tags.title)}</title>`);
  html = html.replace(
    /<meta\s+name=["']description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="description" content="${escapeHtml(tags.description)}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:title["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:image["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:url["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:url" content="${escapeHtml(tags.canonicalUrl)}" />`
  );
  html = html.replace(
    /<meta\s+property=["']og:type["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta property="og:type" content="${escapeHtml(ogType)}" />`
  );
  html = html.replace(
    /<meta\s+name=["']twitter:title["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:title" content="${escapeHtml(twitterTitle)}" />`
  );
  html = html.replace(
    /<meta\s+name=["']twitter:description["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:description" content="${escapeHtml(twitterDescription)}" />`
  );
  html = html.replace(
    /<meta\s+name=["']twitter:image["']\s+content=["'][^"']*["'][^>]*>/i,
    `<meta name="twitter:image" content="${escapeHtml(twitterImage)}" />`
  );

  if (!/<meta\s+name=["']robots["']/.test(html)) {
    html = html.replace('</head>', `<meta name="robots" content="${escapeHtml(robots)}" /></head>`);
  }
  if (!/<link\s+rel=["']canonical["']/.test(html)) {
    html = html.replace(
      '</head>',
      `<link rel="canonical" href="${escapeHtml(tags.canonicalUrl)}" /></head>`
    );
  }

  if (tags.extraHead) {
    html = html.replace('</head>', `${tags.extraHead}</head>`);
  }

  if (tags.mainHtml) {
    // The base html has <div id="root"></div>; we leave it so React can hydrate,
    // and append a noscript summary after it for crawlers that don't execute JS.
    html = html.replace(
      /<div\s+id=["']root["']><\/div>/i,
      `<div id="root"></div><noscript>${tags.mainHtml}</noscript>`
    );
  }

  return html;
}

/**
 * 构建一个最小化的 404 HTML 页面，统一给爬虫 noindex 信号。
 */
export function buildNotFoundHtml(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>Not Found | HomeScope</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #f6f7fb; color: #111827; margin: 0; padding: 0; }
  main { max-width: 560px; margin: 96px auto; padding: 32px; text-align: center; }
  h1 { font-size: 28px; margin: 0 0 12px; }
  p { color: #4b5563; line-height: 1.6; margin: 0 0 24px; }
  a { color: #4f46e5; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Page not found</h1>
  <p>${escapeHtml(message)}</p>
  <a href="/">Return to HomeScope</a>
</main>
</body>
</html>`;
}

/**
 * 构建 Article JSON-LD。
 */
export function articleJsonLd(opts: {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
}): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: opts.title,
    description: opts.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': opts.url },
    url: opts.url,
    image: opts.imageUrl ? [opts.imageUrl] : undefined,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: { '@type': 'Person', name: opts.authorName },
    publisher: {
      '@type': 'Organization',
      name: 'HomeScope',
      logo: { '@type': 'ImageObject', url: 'https://www.tryhomescope.com/logo.svg' },
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>): string {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}