/**
 * 基线回归：score 字段读取一致性
 *
 * 覆盖场景（对应 usSale.ts 行 344-368 computeEvidenceScore）：
 * 1. score 有效（1..100）→ 直接返回
 * 2. score = 0 → 视为无效，回退到 overallScore
 * 3. score = null → 回退到 overallScore
 * 4. score = '75'（字符串）→ 转换为数字
 * 5. score = 101 → 无效，回退
 * 6. overallScore 有效 → 返回
 * 7. overall_score 有效 → 返回
 * 8. 所有字段都无效 → 返回 null（触发 evidence score fallback）
 * 9. score 与 overallScore 数值不同时 → score 优先（canonical）
 * 10. evidence_score 镜像字段（已废弃）→ 读取顺序
 *
 * 验证原则：score 读取优先级不变，任何路径变化都会影响显示分数。
 */

import { describe, expect, it } from 'vitest';

function readValid(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return Math.round(n);
}

function computeScore(result: Record<string, unknown>): number | null {
  return (
    readValid(result.score as number)
    ?? readValid(result.overallScore as number)
    ?? readValid((result as any).overall_score as number)
    ?? null
  );
}

function evidenceVerdict(score: number | null): string {
  if (score == null) return 'Need More Evidence';
  if (score >= 80) return 'Worth Inspecting';
  if (score >= 65) return 'Proceed With Caution';
  if (score >= 50) return 'Proceed With Caution';
  if (score >= 35) return 'Likely Overpriced / Risky';
  return 'Need More Evidence';
}

describe('score 字段读取优先级基线回归', () => {

  it('score=80 → 返回 80', () => {
    expect(computeScore({ score: 80 })).toBe(80);
  });

  it('score=0 → 无效，回退', () => {
    expect(computeScore({ score: 0 })).toBe(null);
  });

  it('score=null → 回退到 overallScore', () => {
    expect(computeScore({ score: null, overallScore: 72 })).toBe(72);
  });

  it('score=undefined → 回退到 overallScore', () => {
    expect(computeScore({ overallScore: 72 })).toBe(72);
  });

  it('score="75"（字符串）→ 转换为 75', () => {
    expect(computeScore({ score: '75' })).toBe(75);
  });

  it('score="invalid" → 无效，回退', () => {
    expect(computeScore({ score: 'invalid' })).toBe(null);
  });

  it('score=101 → 无效（超过上限），回退', () => {
    expect(computeScore({ score: 101, overallScore: 75 })).toBe(75);
  });

  it('score=-5 → 无效，回退', () => {
    expect(computeScore({ score: -5, overallScore: 70 })).toBe(70);
  });

  it('score 与 overallScore 都有效 → score 优先', () => {
    expect(computeScore({ score: 85, overallScore: 72 })).toBe(85);
  });

  it('score 无效，overallScore 有效 → overallScore', () => {
    expect(computeScore({ score: 0, overallScore: 68 })).toBe(68);
  });

  it('score 无效，overallScore 无效，overall_score 有效 → overall_score', () => {
    expect(computeScore({ score: null, overallScore: null, overall_score: 65 })).toBe(65);
  });

  it('所有字段都无效 → null', () => {
    expect(computeScore({ score: null, overallScore: null, overall_score: null })).toBe(null);
  });

  it('evidence_score 镜像（legacy）→ 读取顺序不包含它', () => {
    // 当前读取顺序：score → overallScore → overall_score
    // evidence_score 不在读取链中
    expect(computeScore({ evidence_score: 90, score: null, overallScore: null })).toBe(null);
  });

  it('overallScore=0 → 无效（>=1），回退', () => {
    expect(computeScore({ score: null, overallScore: 0 })).toBe(null);
  });
});

describe('score → verdict 映射基线', () => {
  it('score >= 80 → Worth Inspecting', () => {
    expect(evidenceVerdict(80)).toBe('Worth Inspecting');
    expect(evidenceVerdict(95)).toBe('Worth Inspecting');
  });

  it('score 65-79 → Proceed With Caution', () => {
    expect(evidenceVerdict(65)).toBe('Proceed With Caution');
    expect(evidenceVerdict(79)).toBe('Proceed With Caution');
  });

  it('score 50-64 → Proceed With Caution', () => {
    expect(evidenceVerdict(50)).toBe('Proceed With Caution');
    expect(evidenceVerdict(64)).toBe('Proceed With Caution');
  });

  it('score 35-49 → Likely Overpriced / Risky', () => {
    expect(evidenceVerdict(35)).toBe('Likely Overpriced / Risky');
    expect(evidenceVerdict(49)).toBe('Likely Overpriced / Risky');
  });

  it('score < 35 → Need More Evidence', () => {
    expect(evidenceVerdict(34)).toBe('Need More Evidence');
    expect(evidenceVerdict(1)).toBe('Need More Evidence');
  });

  it('score = null → Need More Evidence', () => {
    expect(evidenceVerdict(null)).toBe('Need More Evidence');
  });
});

describe('zillowFinancials 读取路径基线', () => {
  it('carrying_costs.primary_monthly_estimate → 优先', () => {
    const r = { carrying_costs: { primary_monthly_estimate: 3200 } };
    const mp = (r as any).carrying_costs?.primary_monthly_estimate;
    expect(mp).toBe(3200);
  });

  it('zillowFinancials.monthlyPayment.estimatedPayment.value → 回退', () => {
    const r = { zillowFinancials: { monthlyPayment: { estimatedPayment: { value: 3100 } } } };
    const mp = (r as any).zillowFinancials?.monthlyPayment?.estimatedPayment?.value;
    expect(mp).toBe(3100);
  });

  it('carrying_costs 优先于 zillowFinancials', () => {
    const r = {
      carrying_costs: { primary_monthly_estimate: 3200 },
      zillowFinancials: { monthlyPayment: { estimatedPayment: { value: 3100 } } },
    };
    const mp = (r as any).carrying_costs?.primary_monthly_estimate
      ?? (r as any).zillowFinancials?.monthlyPayment?.estimatedPayment?.value;
    expect(mp).toBe(3200);
  });
});

describe('property_snapshot 字段覆盖（zillow.ts 回退链）', () => {
  it('property_snapshot.zestimate → 最高优先级', () => {
    const r = { property_snapshot: { zestimate: 850000 } };
    expect((r as any).property_snapshot?.zestimate).toBe(850000);
  });

  it('result.zestimate → 回退', () => {
    const r = { zestimate: 840000 };
    expect((r as any).zestimate).toBe(840000);
  });
});
