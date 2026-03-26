/**
 * 文本提取工具
 */

export function getText(doc: Document, selector: string): string {
  try {
    const el = doc.querySelector(selector);
    return el?.textContent?.trim() || '';
  } catch {
    return '';
  }
}

export function getAllText(doc: Document, selector: string): string[] {
  try {
    return Array.from(doc.querySelectorAll(selector))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getAttr(doc: Document, selector: string, attr: string): string {
  try {
    return doc.querySelector(selector)?.getAttribute(attr) || '';
  } catch {
    return '';
  }
}

export function getBodyText(doc: Document): string {
  return doc.body?.innerText || '';
}

export function getMetaContent(doc: Document, name: string): string {
  return getAttr(doc, `meta[name="${name}"]`, 'content') ||
         getAttr(doc, `meta[property="${name}"]`, 'content');
}

export function findLongestParagraph(doc: Document, minLength = 80): string {
  let longest = '';
  for (const el of doc.querySelectorAll('p, div')) {
    const t = el.textContent?.trim() || '';
    if (
      t.length > longest.length &&
      t.length > minLength &&
      !t.toLowerCase().includes('cookie') &&
      !t.toLowerCase().includes('sign in') &&
      !t.toLowerCase().includes('login')
    ) {
      longest = t;
    }
  }
  return longest;
}

export function isNonPropertyPage(doc: Document): boolean {
  const title = doc.title.toLowerCase();
  const bodyText = getBodyText(doc);
  const hasLoginForm = bodyText.includes('Sign In') && bodyText.includes('Password') && bodyText.length < 2000;
  return title.includes('search') || title.includes('login') || title.includes('sign in') || hasLoginForm;
}
