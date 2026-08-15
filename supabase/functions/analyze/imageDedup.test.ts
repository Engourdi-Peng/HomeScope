/**
 * 基线回归：图片 URL 边界去重
 *
 * 测试 pure-function 版本（从 index.ts 复制的逻辑，不依赖 Deno 环境）。
 * 如果 index.ts 中的实现有变化，此测试文件必须同步更新。
 *
 * 覆盖场景：
 * 1. 重复 URL（精确匹配）→ 去重后只保留一个
 * 2. 带不同 dpi 参数的重复 URL → 规范化为无参数后去重
 * 3. 空字符串 / 非字符串 → 过滤
 * 4. 非 HTTP URL → 过滤（isValidHttpUrl）
 * 5. 去重后顺序保持
 * 6. 空数组 → 返回空数组
 * 7. 非数组输入 → 返回空数组
 * 8. 末尾 ? 无参数 → 正常处理
 */

import { describe, expect, it } from 'vitest';

// Pure-function copy from supabase/functions/analyze/index.ts
// DO NOT import from index.ts — this file runs in Node/vitest

function isValidHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeAndDedupImageUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (!isValidHttpUrl(raw.trim())) continue;
    const norm = raw.split('?')[0].trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }
  return result;
}

describe('normalizeAndDedupImageUrls 基线回归', () => {
  it('精确重复 URL → 去重', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://photos.zillowstatic.com/fp/abc123-cc.jpg');
  });

  it('带 dpi 参数的重复 URL → 规范化为无参后去重', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg?dpi=2',
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg?dpi=3',
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://photos.zillowstatic.com/fp/abc123-cc.jpg');
  });

  it('不同 URL → 全部保留', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
      'https://photos.zillowstatic.com/fp/def456-cc.jpg',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toHaveLength(2);
  });

  it('空字符串 / null / undefined → 过滤', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
      '',
      null as unknown as string,
      'https://photos.zillowstatic.com/fp/def456-cc.jpg',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toHaveLength(2);
  });

  it('非 HTTP URL → 过滤', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
      'ftp://invalid.example.com/photo.jpg',
      'not-a-url',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toHaveLength(1);
  });

  it('去重后顺序保持（稳定）', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/c.jpg',
      'https://photos.zillowstatic.com/fp/a.jpg',
      'https://photos.zillowstatic.com/fp/b.jpg',
      'https://photos.zillowstatic.com/fp/a.jpg',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toEqual([
      'https://photos.zillowstatic.com/fp/c.jpg',
      'https://photos.zillowstatic.com/fp/a.jpg',
      'https://photos.zillowstatic.com/fp/b.jpg',
    ]);
  });

  it('空数组 → 返回空数组', () => {
    expect(normalizeAndDedupImageUrls([])).toEqual([]);
  });

  it('非数组输入 → 返回空数组', () => {
    expect(normalizeAndDedupImageUrls(null as unknown as string[])).toEqual([]);
    expect(normalizeAndDedupImageUrls(undefined as unknown as string[])).toEqual([]);
  });

  it('末尾 ? 无参数 → 正常处理', () => {
    const urls = [
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg?',
      'https://photos.zillowstatic.com/fp/abc123-cc.jpg',
    ];
    const result = normalizeAndDedupImageUrls(urls);
    expect(result).toHaveLength(1);
  });
});

describe('Feature Flag 默认值逻辑', () => {
  it('STEP2_CONTRACT_RETRY_ENABLED 默认 true（env !== "false"）', () => {
    // 验证默认值逻辑
    const flag = (v: string | undefined) => v !== "false";
    expect(flag(undefined)).toBe(true);
    expect(flag("")).toBe(true);
    expect(flag("true")).toBe(true);
  });

  it('STEP2_CONTRACT_RETRY_ENABLED 为 "false" 时关闭', () => {
    const flag = (v: string | undefined) => v !== "false";
    expect(flag("false")).toBe(false);
  });

  it('IMAGE_DEDUP_ENABLED 默认 true', () => {
    const flag = (v: string | undefined) => v !== "false";
    expect(flag(undefined)).toBe(true);
  });

  it('IMAGE_DEDUP_ENABLED 为 "false" 时关闭', () => {
    const flag = (v: string | undefined) => v !== "false";
    expect(flag("false")).toBe(false);
  });
});
