/**
 * 统一静态页面 SEO 元数据：精简版的 useSEOMeta，提供列表式调用。
 */

export interface PageSEO {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}

const SITE_URL = 'https://www.tryhomescope.com';

export const STATIC_PAGE_SEO: Record<string, PageSEO> = {
  '/': {
    title: 'HomeScope | AI Property Analyzer for Zillow & realestate.com.au',
    description:
      'HomeScope turns Zillow and realestate.com.au listings into buyer-focused risk reports — price signals, photo observations, carrying costs, and questions to ask the agent.',
    path: '/',
  },
  pricing: {
    title: 'Pricing — HomeScope',
    description:
      'Pick a HomeScope plan that fits your home search. Run a free Basic Check first, then unlock Full Reports for the listings that matter most.',
    path: '/pricing',
  },
  contact: {
    title: 'Contact — HomeScope',
    description: 'Reach the HomeScope team for support, partnership, or press inquiries.',
    path: '/contact',
  },
  support: {
    title: 'Support — HomeScope',
    description:
      'Get help with HomeScope reports, billing, or your account. Find answers and contact options here.',
    path: '/support',
  },
  privacy: {
    title: 'Privacy Policy — HomeScope',
    description:
      'How HomeScope collects, uses, and protects personal information when you generate property reports.',
    path: '/privacy',
  },
  terms: {
    title: 'Terms of Service — HomeScope',
    description: 'Terms governing your use of HomeScope and the reports it generates.',
    path: '/terms',
  },
  refund: {
    title: 'Refund Policy — HomeScope',
    description: 'Refunds, cancellations, and credit usage on HomeScope plans.',
    path: '/refund',
  },
  blog: {
    title: 'HomeScope Blog — Insights on Listings, Buying, and Renting Smarter',
    description:
      'Practical guides for reviewing Zillow and realestate.com.au listings, comparing homes, and asking the right questions before you tour.',
    path: '/blog',
  },
};

export function applyPageSEO(seo: PageSEO) {
  document.title = seo.title;
  setMeta('description', seo.description);
  setMeta('robots', seo.noindex ? 'noindex,nofollow' : 'index,follow');
  setLinkCanonical(`${SITE_URL}${seo.path}`);
  setMetaProperty('og:title', seo.title);
  setMetaProperty('og:description', seo.description);
  setMetaProperty('og:url', `${SITE_URL}${seo.path}`);
  setMetaProperty('og:type', seo.path === '/blog' ? 'website' : 'website');
  setMetaName('twitter:title', seo.title);
  setMetaName('twitter:description', seo.description);
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function setMetaProperty(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setMetaName(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function setLinkCanonical(href: string) {
  let el = document.querySelector(`link[rel="canonical"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}