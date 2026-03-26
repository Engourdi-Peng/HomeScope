/**
 * 图片提取工具
 */

import {
  IMAGE_BLACKLIST_PATTERNS,
  IMAGE_MIN_WIDTH,
  IMAGE_MIN_HEIGHT,
} from '../../../shared/constants';

export function isPropertyImage(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.toLowerCase();
  for (const pattern of IMAGE_BLACKLIST_PATTERNS) {
    if (pattern.test(u)) return false;
  }
  return true;
}

export function upgradeToHiRes(url: string): string {
  return url
    .replace(/\?\.*$/, '')
    .replace(/\/\d+px\//, '/1200px/')
    .replace(/\/[\w-]+-[\w-]+\.(\w+)$/, '/1200px.$1');
}

export function isLargeEnoughImage(img: HTMLImageElement): boolean {
  return img.width >= IMAGE_MIN_WIDTH && img.height >= IMAGE_MIN_HEIGHT;
}

export function extractFromSrcset(srcset: string | null): string[] {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map(s => s.trim().split(' ')[0])
    .filter(u => u.startsWith('http') && isPropertyImage(u));
}

export function extractFromPictureSources(doc: Document): string[] {
  const images: string[] = [];
  for (const source of doc.querySelectorAll('picture source')) {
    const srcset = source.getAttribute('srcset');
    extractFromSrcset(srcset).forEach(u => images.push(upgradeToHiRes(u)));
  }
  return images;
}

export function extractFromImgTags(doc: Document, hostname?: string): string[] {
  const images: string[] = [];
  for (const img of doc.querySelectorAll('img')) {
    const candidates = [
      img.src,
      img.getAttribute('data-src'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-srcset'),
      img.getAttribute('srcset'),
    ].filter(Boolean) as string[];

    for (const src of candidates) {
      if (!src.startsWith('http') || !isPropertyImage(src)) continue;
      if (hostname && !src.includes(hostname)) continue;
      images.push(upgradeToHiRes(src));
    }
  }
  return images;
}

export function extractOgImage(doc: Document): string | null {
  const meta = doc.querySelector('meta[property="og:image"]');
  const content = meta?.getAttribute('content');
  if (content && isPropertyImage(content)) return content;
  return null;
}

export function extractFromScripts(doc: Document): string[] {
  const images: string[] = [];
  const imgPattern = /(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?)/gi;
  for (const script of doc.querySelectorAll('script')) {
    try {
      const text = script.textContent || '';
      let match;
      while ((match = imgPattern.exec(text)) !== null) {
        const url = match[1];
        if (isPropertyImage(url)) images.push(upgradeToHiRes(url.split('?')[0]));
      }
    } catch {}
  }
  return images;
}

export function countPropertyImages(doc: Document): number {
  let count = 0;
  for (const img of doc.querySelectorAll('img')) {
    if (isLargeEnoughImage(img) && isPropertyImage(img.src)) {
      count++;
    }
  }
  return count;
}

export function deduplicateImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const normalized = url.split('?')[0].toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(url);
    }
  }
  return result;
}
