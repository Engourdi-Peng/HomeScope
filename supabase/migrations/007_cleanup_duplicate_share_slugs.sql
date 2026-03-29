-- ========================================
-- 清理重复的 share_slug（保留 updated_at 最新的一笔）
-- ========================================

-- 先查看有多少重复
-- SELECT share_slug, COUNT(*) as cnt
-- FROM public.analyses
-- WHERE share_slug IS NOT NULL AND is_public = TRUE
-- GROUP BY share_slug
-- HAVING COUNT(*) > 1;

-- 对于每个重复的 share_slug，保留 updated_at 最新的一条，将其余的 is_public 设为 false
UPDATE public.analyses a
SET is_public = FALSE
FROM (
  SELECT
    id,
    share_slug,
    ROW_NUMBER() OVER (
      PARTITION BY share_slug
      ORDER BY COALESCE(updated_at, '1970-01-01'::timestamptz) DESC
    ) as rn
  FROM public.analyses
  WHERE share_slug IS NOT NULL
) ranked
WHERE a.id = ranked.id
  AND ranked.rn > 1
  AND a.share_slug IN (
    SELECT share_slug
    FROM public.analyses
    WHERE share_slug IS NOT NULL
    GROUP BY share_slug
    HAVING COUNT(*) > 1
  );
