import { useEffect } from 'react';

/**
 * SEO Meta 标签更新 Hook
 * 用于动态设置页面 meta 标签（用于 SPA 的 SEO）
 */

export interface SEOMeta {
  title?: string;
  description?: string;
  robots?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogUrl?: string;
}

const BASE_URL = 'https://www.tryhomescope.com';

/**
 * 设置页面 SEO meta 标签
 * 私密页使用 noindex，公开分享页使用 index
 */
export function useSEOMeta(meta: SEOMeta) {
  useEffect(() => {
    const updateMeta = () => {
      // Title
      if (meta.title) {
        document.title = meta.title;
      }

      // Description
      const descEl = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (meta.description) {
        if (descEl) {
          descEl.content = meta.description;
        } else {
          const newDesc = document.createElement('meta');
          newDesc.name = 'description';
          newDesc.content = meta.description;
          document.head.appendChild(newDesc);
        }
      }

      // Robots
      const robotsEl = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
      if (meta.robots) {
        if (robotsEl) {
          robotsEl.content = meta.robots;
        } else {
          const newRobots = document.createElement('meta');
          newRobots.name = 'robots';
          newRobots.content = meta.robots;
          document.head.appendChild(newRobots);
        }
      } else {
        // Remove robots meta if not specified
        if (robotsEl) {
          robotsEl.remove();
        }
      }

      // Canonical
      let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (meta.canonical) {
        if (canonicalEl) {
          canonicalEl.href = meta.canonical;
        } else {
          canonicalEl = document.createElement('link');
          canonicalEl.rel = 'canonical';
          canonicalEl.href = meta.canonical;
          document.head.appendChild(canonicalEl);
        }
      } else {
        // Remove canonical if not specified
        if (canonicalEl) {
          canonicalEl.remove();
        }
      }

      // Open Graph
      const ogTitleEl = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
      if (meta.ogTitle) {
        if (ogTitleEl) {
          ogTitleEl.content = meta.ogTitle;
        } else {
          const newOgTitle = document.createElement('meta');
          newOgTitle.setAttribute('property', 'og:title');
          newOgTitle.content = meta.ogTitle;
          document.head.appendChild(newOgTitle);
        }
      }

      const ogDescEl = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
      if (meta.ogDescription) {
        if (ogDescEl) {
          ogDescEl.content = meta.ogDescription;
        } else {
          const newOgDesc = document.createElement('meta');
          newOgDesc.setAttribute('property', 'og:description');
          newOgDesc.content = meta.ogDescription;
          document.head.appendChild(newOgDesc);
        }
      }

      const ogTypeEl = document.querySelector('meta[property="og:type"]') as HTMLMetaElement | null;
      if (meta.ogType) {
        if (ogTypeEl) {
          ogTypeEl.content = meta.ogType;
        } else {
          const newOgType = document.createElement('meta');
          newOgType.setAttribute('property', 'og:type');
          newOgType.content = meta.ogType;
          document.head.appendChild(newOgType);
        }
      }

      const ogUrlEl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null;
      if (meta.ogUrl) {
        if (ogUrlEl) {
          ogUrlEl.content = meta.ogUrl;
        } else {
          const newOgUrl = document.createElement('meta');
          newOgUrl.setAttribute('property', 'og:url');
          newOgUrl.content = meta.ogUrl;
          document.head.appendChild(newOgUrl);
        }
      }
    };

    updateMeta();

    // Restore original meta on unmount
    return () => {
      // Reset to default values
      document.title = 'AI Rental Property Analyzer | HomeScope';
    };
  }, [meta]);
}

/**
 * 私密页 SEO 配置
 * - noindex, nofollow - 不被搜索引擎收录
 * - 不输出 canonical
 */
export function usePrivatePageSEO() {
  useSEOMeta({
    robots: 'noindex,nofollow',
  });
}

/**
 * 公开分享页 SEO 配置
 * - index, follow - 允许被搜索引擎收录
 * - 输出 canonical 和 OG meta
 */
export function usePublicPageSEO(seoTitle: string, seoDescription: string, slug: string) {
  useSEOMeta({
    title: seoTitle,
    description: seoDescription,
    robots: 'index,follow',
    canonical: `${BASE_URL}/share/${slug}`,
    ogTitle: seoTitle,
    ogDescription: seoDescription,
    ogType: 'article',
    ogUrl: `${BASE_URL}/share/${slug}`,
  });
}
