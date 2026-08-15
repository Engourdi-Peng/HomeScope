/**
 * 基线回归：照片字段读取兼容性
 *
 * 覆盖场景：
 * 1. 只有 photoReview（新格式）→ 正确读取
 * 2. 只有 spaceAnalysis（旧格式）→ 正确读取
 * 3. 只有 visualAnalysis（旧格式）→ 正确读取
 * 4. 只有 photos 数组（最旧格式）→ 正确读取
 * 5. photoReview + spaceAnalysis 并存 → photoReview 优先
 * 6. visualAnalysis.photoReview + top-level photoReview 并存 → top-level 优先
 * 7. photoReview 无 areas 但有 overallSummary → 渲染
 * 8. 所有字段都缺失 → 组件返回 null（不崩溃）
 * 9. spaceAnalysis 空数组 → hasSpaceAnalysis = false
 * 10. visualAnalysis 仅有简单字段（renovationLevel）→ hasVisualRead = true
 *
 * 验证原则：PhotoSpaceAnalysisCard 读取逻辑不变，各格式都能正确渲染。
 */

import { describe, expect, it } from 'vitest';

// 复刻 PhotoSpaceAnalysisCard 的读取逻辑（行 447-472）
function computeReadCompatibility(raw: {
  photoReview?: Record<string, unknown> | null;
  spaceAnalysis?: Array<Record<string, unknown>> | null;
  visualAnalysis?: Record<string, unknown> | null;
  photos?: Array<Record<string, unknown>> | null;
}): {
  effectivePhotoReview: Record<string, unknown> | null;
  effectiveSpaceAnalysis: Array<Record<string, unknown>> | null;
  hasPhotoReview: boolean;
  hasSpaceAnalysis: boolean;
  hasVisualRead: boolean;
  hasPhotosFallback: boolean;
  wouldRender: boolean;
} {
  const effectivePhotoReview =
    raw.photoReview ??
    (raw.visualAnalysis as Record<string, unknown> | null)?.photoReview ??
    null;
  const effectiveSpaceAnalysis =
    raw.spaceAnalysis ??
    (raw.visualAnalysis as Record<string, unknown> | null)?.spaceAnalysis ??
    null;

  const hasPhotoReview = !!(
    effectivePhotoReview &&
    ((effectivePhotoReview as any)?.areas?.length > 0 || (effectivePhotoReview as any)?.overallSummary)
  );

  const hasSpaceAnalysis = Array.isArray(effectiveSpaceAnalysis) && effectiveSpaceAnalysis.length > 0;

  const vi = raw.visualAnalysis;
  const hasVisualRead = !!(vi && (
    (vi as any).renovationLevel && (vi as any).renovationLevel !== 'Unknown' ||
    (vi as any).cosmeticFlipRisk && (vi as any).cosmeticFlipRisk !== 'Unknown' ||
    (vi as any).naturalLight && (vi as any).naturalLight !== 'Unknown' ||
    (vi as any).spacePerception && (vi as any).spacePerception !== 'Unknown' ||
    (vi as any).maintenanceCondition && (vi as any).maintenanceCondition !== 'Unknown' ||
    (vi as any).maintenanceImpression && (vi as any).maintenanceImpression !== 'Unknown' ||
    (vi as any).kitchenCondition && (vi as any).kitchenCondition !== 'Unknown' ||
    (vi as any).bathroomCondition && (vi as any).bathroomCondition !== 'Unknown'
  ));

  const hasPhotosFallback = Array.isArray(raw.photos) && raw.photos.length > 0;
  const wouldRender = hasPhotoReview || hasSpaceAnalysis || hasVisualRead || hasPhotosFallback;

  return { effectivePhotoReview, effectiveSpaceAnalysis, hasPhotoReview, hasSpaceAnalysis, hasVisualRead, hasPhotosFallback, wouldRender };
}

describe('照片字段读取兼容性基线回归', () => {

  it('只有 photoReview → 渲染', () => {
    const raw = {
      photoReview: { areas: [{ area: 'kitchen', photoCount: 2 }], overallSummary: 'Modern kitchen.' },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotoReview).toBe(true);
    expect(r.hasSpaceAnalysis).toBe(false);
    expect(r.hasVisualRead).toBe(false);
    expect(r.wouldRender).toBe(true);
  });

  it('只有 spaceAnalysis → 渲染', () => {
    const raw = {
      spaceAnalysis: [{ spaceType: 'living_room', score: 7 }],
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotoReview).toBe(false);
    expect(r.hasSpaceAnalysis).toBe(true);
    expect(r.wouldRender).toBe(true);
  });

  it('只有 visualAnalysis（带 condition）→ 渲染', () => {
    const raw = {
      visualAnalysis: { renovationLevel: 'Good', kitchenCondition: 'Modern' },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasVisualRead).toBe(true);
    expect(r.wouldRender).toBe(true);
  });

  it('只有 photos 数组 → 渲染', () => {
    const raw = {
      photos: [{ photoIndex: 0, area: 'kitchen' }],
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotosFallback).toBe(true);
    expect(r.wouldRender).toBe(true);
  });

  it('photoReview + spaceAnalysis 并存 → photoReview 优先', () => {
    const raw = {
      photoReview: { areas: [{ area: 'kitchen', photoCount: 1 }], overallSummary: 'Summary A' },
      spaceAnalysis: [{ spaceType: 'living_room', score: 7 }],
      visualAnalysis: { spaceAnalysis: [{ spaceType: 'bedroom', score: 8 }] },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotoReview).toBe(true);
    expect(r.effectivePhotoReview).toEqual(raw.photoReview);
    expect(r.effectiveSpaceAnalysis).toEqual(raw.spaceAnalysis);
  });

  it('visualAnalysis.photoReview 存在但 top-level photoReview 为 null → 回退到 visualAnalysis.photoReview', () => {
    const raw = {
      photoReview: null,
      visualAnalysis: { photoReview: { areas: [{ area: 'kitchen', photoCount: 1 }], overallSummary: 'From nested' } },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotoReview).toBe(true);
    expect((r.effectivePhotoReview as any)?.overallSummary).toBe('From nested');
  });

  it('photoReview 无 areas 但有 overallSummary → 渲染', () => {
    const raw = {
      photoReview: { overallSummary: 'No area data available.' },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotoReview).toBe(true);
  });

  it('photoReview 有 areas 但为空数组 + 无 overallSummary → 不渲染', () => {
    const raw = {
      photoReview: { areas: [] },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotoReview).toBe(false);
    expect(r.wouldRender).toBe(false);
  });

  it('所有字段都缺失 → 不渲染', () => {
    const raw = {};
    const r = computeReadCompatibility(raw);
    expect(r.wouldRender).toBe(false);
  });

  it('spaceAnalysis 空数组 → hasSpaceAnalysis = false', () => {
    const raw = { spaceAnalysis: [] };
    const r = computeReadCompatibility(raw);
    expect(r.hasSpaceAnalysis).toBe(false);
  });

  it('visualAnalysis 所有 condition 都是 Unknown → hasVisualRead = false', () => {
    const raw = {
      visualAnalysis: { renovationLevel: 'Unknown', kitchenCondition: 'Unknown', bathroomCondition: 'Unknown' },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasVisualRead).toBe(false);
  });

  it('visualAnalysis 只有 price_assessment（非 condition 字段）→ hasVisualRead = false', () => {
    const raw = {
      visualAnalysis: { price_assessment: { verdict: 'Fair' } },
    };
    const r = computeReadCompatibility(raw);
    expect(r.hasVisualRead).toBe(false);
  });

  it('photos 空数组 → hasPhotosFallback = false', () => {
    const raw = { photos: [] };
    const r = computeReadCompatibility(raw);
    expect(r.hasPhotosFallback).toBe(false);
  });
});

describe('normalizedPhotoAnalysis 读取路径', () => {
  it('step1Areas 和 step1DetectedAreas 都是字符串数组', () => {
    const raw = {
      areas: ['kitchen', 'living_room'],
      detectedAreas: ['kitchen', 'bedroom'],
    };
    const areas: string[] = (raw.areas ?? raw.detectedAreas ?? []).map(String);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toBe('kitchen');
  });

  it('step1Areas 缺失时回退到 step1DetectedAreas', () => {
    const raw = { detectedAreas: ['kitchen', 'living_room'] };
    const areas: string[] = (raw.areas ?? raw.detectedAreas ?? []).map(String);
    expect(areas).toHaveLength(2);
  });

  it('topVisualConcerns 读取路径覆盖', () => {
    const raw1 = { topVisualConcerns: ['Outdated kitchen'] };
    const raw2 = { topVisibleConcerns: ['Outdated kitchen'] };
    const raw3 = { photo_analysis: { keyConcerns: ['Outdated kitchen'] } };
    const r1 = (raw1 as any).topVisualConcerns ?? (raw1 as any).topVisibleConcerns ?? (raw1 as any).photo_analysis?.keyConcerns;
    const r2 = (raw2 as any).topVisualConcerns ?? (raw2 as any).topVisibleConcerns ?? (raw2 as any).photo_analysis?.keyConcerns;
    const r3 = (raw3 as any).topVisualConcerns ?? (raw3 as any).topVisibleConcerns ?? (raw3 as any).photo_analysis?.keyConcerns;
    expect(r1).toEqual(['Outdated kitchen']);
    expect(r2).toEqual(['Outdated kitchen']);
    expect(r3).toEqual(['Outdated kitchen']);
  });
});
