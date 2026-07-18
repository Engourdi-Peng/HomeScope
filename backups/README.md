# backups/

**临时重构备份目录**

这个目录存放临时的代码重构备份,**不是正式源码**,不会被任何业务逻辑引用,也不会被打包部署。

## 用途

当对 `supabase/functions/analyze/index.ts` 或其依赖的 prompts 文件做大规模重构时,先在原地以 `.bak-YYYYMMDD` 后缀备份,验证通过后移到本目录保留 1-2 周作为 safety net,然后删除。

## 当前内容

| 文件 | 来源 | 创建日期 | 备注 |
|------|------|----------|------|
| `analyze-index.ts.bak-20260710` | `supabase/functions/analyze/index.ts` | 2026-07-10 | 重构前:内联 ~500KB 的 8 个 Prompt 常量 |
| `analyze-prompts-us-prompts.ts.bak-20260710` | `supabase/functions/analyze/prompts/us-prompts.ts` | 2026-07-10 | 重构前(实际未修改,作为 reference) |
| `analyze-prompts-au-prompts.ts.bak-20260710` | `supabase/functions/analyze/prompts/au-prompts.ts` | 2026-07-10 | 重构前(实际未修改,作为 reference) |

## 注意事项

- **不要**让任何业务代码 import 这些文件
- **不要**在 CI / deploy 脚本里打包这个目录
- **建议**保留 1-2 周,确认线上 US Sale / US Rent / AU Sale / AU Rent 四条路径都无回归后删除
- 如果确认不会回滚,直接 `rm backups/*.bak-*` 即可