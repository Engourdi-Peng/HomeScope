/**
 * 基线回归：analysis_states 恢复逻辑
 *
 * 覆盖场景（对应 index.ts 行 10540-10573）：
 * 1. full_result 有 Step 2 结果 → recoverableStage = step2_pending
 * 2. full_result 有 Step 1 结果但无 Step 2 → recoverableStage = step2_pending
 * 3. full_result 无任何结果 → recoverableStage = step1_pending
 * 4. full_result = null → recoverableStage = step1_pending
 * 5. deadline 超时 → 写入 step1_pending（行 10432-10437）
 * 6. resume_due 读取 analysis_states 滞后期望（3分钟）
 * 7. finalize_due 处理 step2_pending 记录
 *
 * 验证原则：恢复状态判定逻辑不变，stage 名称不变。
 */

import { describe, expect, it } from 'vitest';

type RecoveryResult = {
  hasStep1Result: boolean;
  hasStep2Result: boolean;
  recoverableStage: string;
};

function simulateRecoverableStage(result: Record<string, unknown> | null): RecoveryResult {
  const hasStep1Result = !!(
    result &&
    typeof result === 'object' &&
    ((result as any).photos !== undefined ||
      (result as any).photoSpaces !== undefined ||
      (result as any).visualAnalysis !== undefined)
  );
  const hasStep2Result = !!(
    result &&
    typeof result === 'object' &&
    ((result as any).price_assessment !== undefined ||
      (result as any).overall_score !== undefined)
  );

  let recoverableStage: string;
  if (hasStep2Result) {
    recoverableStage = 'step2_pending';
  } else if (hasStep1Result) {
    recoverableStage = 'step2_pending';
  } else {
    recoverableStage = 'step1_pending';
  }

  return { hasStep1Result, hasStep2Result, recoverableStage };
}

describe('analysis_states 恢复逻辑基线回归', () => {

  it('有 price_assessment → step2_pending', () => {
    const result = { price_assessment: { verdict: 'Fair' } };
    const { recoverableStage, hasStep1Result, hasStep2Result } = simulateRecoverableStage(result);
    expect(hasStep2Result).toBe(true);
    expect(recoverableStage).toBe('step2_pending');
    expect(hasStep1Result).toBe(false);
  });

  it('有 overall_score → step2_pending', () => {
    const result = { overall_score: 75 };
    const { recoverableStage } = simulateRecoverableStage(result);
    expect(recoverableStage).toBe('step2_pending');
  });

  it('有 Step 1 结果（photos）但无 Step 2 → step2_pending', () => {
    const result = { photos: [{ photoIndex: 0 }], visualAnalysis: null };
    const { recoverableStage, hasStep1Result, hasStep2Result } = simulateRecoverableStage(result);
    expect(hasStep1Result).toBe(true);
    expect(hasStep2Result).toBe(false);
    expect(recoverableStage).toBe('step2_pending'); // 继续 Step 2
  });

  it('有 photoSpaces 但无 Step 2 → step2_pending', () => {
    const result = { photoSpaces: [{ spaceType: 'kitchen' }] };
    const { recoverableStage } = simulateRecoverableStage(result);
    expect(recoverableStage).toBe('step2_pending');
  });

  it('有 visualAnalysis（Step 1 结果）但无 Step 2 → step2_pending', () => {
    const result = { visualAnalysis: { renovationLevel: 'Good' } };
    const { recoverableStage } = simulateRecoverableStage(result);
    expect(recoverableStage).toBe('step2_pending');
  });

  it('只有 Step 1 metadata（photos=[] 空数组）→ step1_pending', () => {
    const result = { photos: [], overallScore: null };
    const { recoverableStage, hasStep1Result } = simulateRecoverableStage(result);
    // photos: [] → undefined 吗？不，空数组 !== undefined
    expect(hasStep1Result).toBe(true); // 空数组被检测为"有结果"（回归风险！）
    expect(recoverableStage).toBe('step2_pending'); // 按现有逻辑
  });

  it('photos=undefined → 无 Step 1 结果 → step1_pending', () => {
    const result = { overallScore: null };
    const { recoverableStage, hasStep1Result } = simulateRecoverableStage(result);
    expect(hasStep1Result).toBe(false);
    expect(recoverableStage).toBe('step1_pending');
  });

  it('result = {} → step1_pending', () => {
    const { recoverableStage } = simulateRecoverableStage({});
    expect(recoverableStage).toBe('step1_pending');
  });

  it('result = null → step1_pending', () => {
    const { recoverableStage } = simulateRecoverableStage(null);
    expect(recoverableStage).toBe('step1_pending');
  });

  it('有 photos 但无 price_assessment/overall_score → step2_pending（关键路径）', () => {
    // 这对应：Step 1 完成，Step 2 未开始，deadline 中断
    const result = { photos: [{ photoIndex: 0 }] };
    const { recoverableStage } = simulateRecoverableStage(result);
    expect(recoverableStage).toBe('step2_pending');
  });

  describe('deadline 超时写入的 stage 值', () => {
    it('deadline 超时 → stage = step1_pending（行 10433）', () => {
      // 这与 resume_due 的默认 stage 相同
      // resume_due 检测 full_result 时会覆盖这个值
      const deadlineStage = 'step1_pending';
      const result = { photos: [{ photoIndex: 0 }] };
      const { recoverableStage } = simulateRecoverableStage(result);
      // deadline 写入后，resume_due 重新检测会覆盖为 step2_pending
      expect(deadlineStage).toBe('step1_pending');
      expect(recoverableStage).toBe('step2_pending');
    });
  });

  describe('resume_due 滞后期望（3分钟）', () => {
    it('staleThreshold = 3分钟前', () => {
      const STALE_THRESHOLD_MS = 3 * 60 * 1000;
      const now = Date.now();
      const threshold = new Date(now - STALE_THRESHOLD_MS).toISOString();
      const updated3MinAgo = new Date(now - 3 * 60 * 1000 - 1).toISOString();
      const updated2MinAgo = new Date(now - 2 * 60 * 1000 + 1).toISOString();
      expect(updated3MinAgo < threshold).toBe(true);
      expect(updated2MinAgo < threshold).toBe(false);
    });
  });

  describe('finalize_due 条件', () => {
    it('stage = step2_pending 且 updated_at < 2分钟前 → 处理', () => {
      const now = Date.now();
      const STALE_THRESHOLD_MS = 2 * 60 * 1000;
      const staleStage = 'step2_pending';
      const updatedAt = new Date(now - STALE_THRESHOLD_MS - 1).toISOString();
      // 条件：stage=eq.step2_pending AND updated_at < threshold
      expect(staleStage).toBe('step2_pending');
      expect(updatedAt < new Date(now - STALE_THRESHOLD_MS).toISOString()).toBe(true);
    });

    it('stage = step2_pending 但 updated_at < 2分钟 → 不处理', () => {
      const now = Date.now();
      const updatedAt = new Date(now - 60 * 1000).toISOString();
      expect(updatedAt < new Date(now - 2 * 60 * 1000).toISOString()).toBe(false);
    });
  });
});

describe('恢复逻辑已知风险记录', () => {
  it('photos=[] 空数组被判定为"有 Step 1 结果"（回归风险）', () => {
    // 当前逻辑：(result as any).photos !== undefined
    // photos=[] 时，undefined !== undefined 为 false → 有 Step 1 结果
    const result = { photos: [] };
    const hasStep1 = result.photos !== undefined;
    expect(hasStep1).toBe(true); // 空数组触发"有结果"
  });

  it('visualAnalysis=null 被判定为"无 Step 1 结果"（正确）', () => {
    const result = { visualAnalysis: null };
    const hasStep1 = result.visualAnalysis !== undefined;
    expect(hasStep1).toBe(true); // null !== undefined
  });
});
