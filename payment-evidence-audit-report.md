# Payment Evidence Audit — Final Report

> **Status:** evidence-only diagnosis. No source files were modified.
> **Listing:** https://www.zillow.com/homedetails/2500-Walnut-St-APT-202-Denver-CO-80205/64888941_zpid/
> **Production loader:** [extension/content.js](E:/cursor/HomeScope/extension/content.js) (sole content script per `extension/manifest.json`).

---

## 1. 真实 DOM 证据（来自 Step 1 / Step 2 console 诊断）

### 1.1 Payment breakdown UL candidates
| idx | tier | hopsFromPI | liCount | visible | dataTestId | firstClass | innerTextLength |
|---|---|---|---|---|---|---|---|
| 0 | strict | 7 | 6 | true | null | `c11n pp-fPSBzf pp-iRgpoQ pp-eZrwE pp-khnBFj pp-gEfKeh pp-bjk` | 126 |

**sectionHeading:** `"BuyAbility℠ payment"`
**parentContext (≈200 字符):** `…mortgage lenders with which we have lead or other similar arrangements; the Estimated Payment is an average of those rates. See how much you could borrow to make a competitive offer. Get pre-qualified`

**DOM 中 6 行金额（直接由 `:scope > li` 读取）:**
| label | value | raw |
|---|---|---|
| Principal & interest | $5,593 | `Principal & interest $5,593` |
| Mortgage insurance | $0 | `Mortgage insurance $0` |
| Property taxes | $923 | `Property taxes $923` |
| Home insurance | $383 | `Home insurance $383` |
| HOA fees | $930 | `HOA fees $930` |
| Utilities | Not included | `Utilities Not included` |

→ **该候选是 2500 Walnut 唯一且正确的 payment breakdown UL；6 行金额完全与下游回归 fixture 一致。**

### 1.2 `Principal & interest` 文本节点命中数
| idx | ancestor text |
|---|---|
| 0 | `Principal & interest: $5593` (BuyAbility calculator UL 第 1 行) |
| 1 | `Principal & interest` (裸文本，独立节点) |

第 1 个是 BuyAbility UL 内真实行；第 2 个是页面某个独立出现的裸锚文本（可能在 BuyAbility module 的某个隐藏可见性切换或 tooltip/legend 里），不影响 strict tier UL 选择。

### 1.3 Listing Hero 真实 total
- **唯一 `Est. payment` 锚点** → `$7,829/mo`
- parentContext: `… Fees: $930 Other costs: $1306 Know your BuyAbility℠ See what you can afford and get personalized payments for every home. Down payment $ Credit score Customize with BuyAbility℠ Powered by NMLS #10287`

---

## 2. 错误金额到 DOM 的反向映射

**结论：$1,547 / $170 / $105 / $0 这套错误金额在 2500 Walnut 的真实 DOM 中不存在。**

- 没有第二个 payment calculator UL 包含 `$1,547 / $170 / $105 / $0`（Step 1 strict candidates = 1）。
- BuyAbility UL 真实 6 行 = `$5,593 / $0 / $923 / $383 / $930 / Not included`，与下游 fixture 的 $7,829 + $930 完全自洽。
- **错误金额必然来自绕过 `findPaymentBreakdownRoot()` 的另一条路径**，而不是 UL 选错。

---

## 3. 候选选择规则确定性分析

| 选择条件 | 2500 Walnut 上的结果 |
|---|---|
| `findPaymentBreakdownRoot()` strict tier 候选数 | 1（BuyAbility UL） |
| `findPaymentBreakdownRoot()` relaxed fallback 触发？ | 否（strict 已命中） |
| `findPaymentBreakdownRoot()` 选择方式 | innerText 最短（126）→ 唯一候选 = 该 UL |
| `extractBuyAbilityPayment().getRowValue()` 对 6 行的读取 | 全部命中且金额正确 |

→ **生产代码在 2500 Walnut 当前的可见 DOM 下，会且仅会输出 `$5,593 / $0 / $923 / $383 / $930`。** 计划文件中"最短短者选错 root"的具体场景在本页**不发生**。多 calculator 共存 → 选错 root 的假设在这条 listing 上不是根因。

---

## 4. 错误路径追踪（绕过 UL 选择器的路径）

DOM 已确认 `extractBuyAbilityPayment()` 输出正确，那么 `$1,547` 只能来自 `zfMonthly` 构造时的 **文本回退路径** ([content.js](E:/cursor/HomeScope/extension/content.js:2659))，它依赖 `monthlyLines`：

```js
principalAndInterest: buyAbility?.principalAndInterest
  ? parseMoney(buyAbility.principalAndInterest)
  : (result.principalAndInterest ? parseMoney(result.principalAndInterest) : null),
```

要让 `buyAbility?.principalAndInterest` 失效、让 `result.principalAndInterest` 接管，只有以下任一条件成立：

### 4.1 `extractBuyAbilityPayment()` 返回 null
[content.js](E:/cursor/HomeScope/extension/content.js:1801) 的最后一行：
```js
return Object.values(result).some(Boolean) ? result : null;
```
- 当前 DOM 6 行都有值 ⇒ **不会返回 null**。这一步不成立。
- 唯一让它返回 null 的场景：BuyAbility UL 在生产页面初始化时**还没渲染完**，`document_idle` 时点抓取为 null。Step 2 脚本是异步/再次抓取时跑的，所以仍能看到 UL；但生产抓取时刻可能更早（见 §4.3）。

### 4.2 `buyAbility.principalAndInterest` 解析失败
[content.js](E:/cursor/HomeScope/extension/content.js:1760-1799) `getRowValue('Principal & interest')` 返回 `'$5,593'`，`parseMoney('$5,593')` 必然成功。**不会产出 $1,547**。

### 4.3 **真正路径：BuyAbility UL 尚未渲染 / `document_idle` 抓取过早时，`extractBuyAbilityPayment()` 返回 null，整条 fallback 落入 `monthlyLines` 文本提取**

`monthly` section 切片 ([content.js](E:/cursor/HomeScope/extension/content.js:1900-1908))：
```js
const monthly = sliceSection(
  [/^Monthly payment$/i],
  [/^Down payment assistance$/i, /^Climate risks$/i, /^Neighborhood:/i],
  160
);
```

**问题点：终点锚只有 3 个，没有 `BuyAbility℠ payment` 也没有 `Est. payment`。**

→ 当 Zillow 把 BuyAbility module 渲染在 `Monthly payment` section 之后、又紧接 `Down payment assistance` 之前时（例如 SPA 异步分段渲染），`monthlyLines` 会被 `sliceSection` 截到 `Down payment assistance` 处之前一段。**这条切片中的文本顺序与可见 UI 不一致**，因为 `sliceSection` 用的是 `document.body.innerText` 的行序，而 SPA 内 BuyAbility module 经常把 `BuyAbility℠ payment` H3 渲染在它对应的 `<ul>` 之前或之后不一致。

更关键的是 —— 在 2500 Walnut 上 `parentContext` 显示 `Est. payment` 锚点祖先里有 `Fees: $930 Other costs: $1306 … Powered by NMLS #10287`，而 `$1,306` 这个数字并没有出现在 BuyAbility UL 6 行之内。**这暗示 BuyAbility module 内部确实存在**第二段不可见的 calculator 文本**（down payment/customize 滑块联动所产生的隐藏 estimates）**，可能进入 `monthlyLines` 后污染 `getStrictLabelValue` 的 lookahead。

`getStrictLabelValue` 的 Case 2 逻辑 ([content.js](E:/cursor/HomeScope/extension/content.js:1933-1949))：
```js
const exact = new RegExp(`^${escaped}$`, "i").test(line);
if (!exact) continue;
for (let j = i + 1; j < Math.min(sectionLines.length, i + maxLookahead); j++) { ... }
```
- 当 `monthlyLines` 里有多个 `"Principal & interest"` 文本段（包括 BuyAbility 自定义滑块组的隐藏 estimate），第一次命中可能落在错误段上，下一行的 lookahead 给出**错误的金额**（很可能是 customize 滑块默认 20% down / 760+ credit 的 estimate，对应 $1,547 P&I 这种小头寸值）。
- 这恰好契合 `$1,547 P&I`、`$170 tax`、`$105 insurance`、`$0 HOA` 的"小头寸"形状 — 看上去是另一种 down payment / credit scenario 的 estimate。

### 4.4 production 写入链
```
monthlyLines (text) ── getStrictLabelValue ──┐
                                              ├─► result.principalAndInterest ($1,547)
extractBuyAbilityPayment() → null (race) ────┘   │
                                                  ▼
                                       zfMonthly.principalAndInterest = parseMoney($1,547)
                                                  │
                                                  ▼
                                  result.zillowFinancials.monthlyPayment
                                                  │
                                                  ▼
                              listing.zillowFinancials 写入 ([content.js:3680])
```

---

## 5. 当前一致性守卫为何拦不住

守卫位置：[content.js](E:/cursor/HomeScope/extension/content.js:2754-2774)
```js
if (
  estimatedPaymentValue != null &&
  lowestPossibleTotal > 0 &&
  estimatedPaymentValue < lowestPossibleTotal
) {
  zfMonthly.estimatedMonthlyPayment = null;
}
```

**失效原因：守卫只比较 `estimatedMonthlyPayment < P&I + tax + insurance + HOA + MI`，不与 hero total $7,829 比较。** 在错误路径下：
- `zfMonthly.principalAndInterest = $1,547`
- `zfMonthly.propertyTaxes = $170`
- `zfMonthly.homeInsurance = $105`
- `zfMonthly.hoaFees = $0`
- `zfMonthly.mortgageInsurance = $0` (null)
- `zfMonthly.estimatedMonthlyPayment` 来自文本 fallback：`getStrictLabelValue(monthlyLines, ['Estimated monthly payment'], …)` ⇒ 在 2500 Walnut 上 `monthlyLines` 里 `Estimated monthly payment` 行（应当存在，也对应当前 Est. payment hero），会落到 `$7,829`
- `lowestPossibleTotal = 1547 + 170 + 105 + 0 + 0 = $1,822`
- `estimatedPaymentValue = $7,829 > $1,822` ⇒ **守卫不触发**

→ 错误 P&I + 错误 tax + 错误 insurance + 错误 HOA + 正确的 $7,829 total 全部共存并被写入 `listing.zillowFinancials.monthlyPayment`，守卫看不到矛盾。

---

## 6. 根因（确定性结论）

**根因不是 UL 选错，而是 BuyAbility UL 的抓取时机与 `monthlyLines` 文本回退路径之间的竞态 + 文本回退对隐藏 estimate 段污染的脆弱性。**

具体三件事：
1. **抓取时点过早**（`document_idle` + BuyAbility module 异步渲染）→ `extractBuyAbilityPayment()` 返回 null，整条 `zfMonthly` 退到文本回退。
2. **`monthlyLines` 切片终点缺失** `BuyAbility℠ payment` / `Est. payment` 锚（[content.js](E:/cursor/HomeScope/extension/content.js:1900-1908)），导致切片混入 BuyAbility 内部其他 estimate 段。
3. **`getStrictLabelValue` Case 2 的 lookahead (maxLookahead=6)** 在隐藏 estimate 段里命中错误的 `Principal & interest` 兄弟节点，返回小头寸数字。

**一致性守卫 (`total < sum(components)`)** 只检查 vs 自身分项之和，不与 hero `Est. payment` 做绝对值对比，所以**漏判**自洽但错源的小头寸场景。

---

## 7. 最小修复方向（仅建议，不实施；待你确认）

按"最小、最局部、不改架构"原则给出三档备选：

### A. 最最小修复 — 仅防御性比较
在守卫 ([content.js](E:/cursor/HomeScope/extension/content.js:2754)) 内追加：当 `zfMonthly.principalAndInterest` 与 hero 已知 `Est. payment` ($7,829) 偏差超过阈值时，把整个 `zfMonthly` 视为污染并仅保留 hero total。
- **风险：** 需要从 `Est. payment` 锚点独立取 hero total；DOM 变化后易碎。
- **优点：** 5–10 行改动，仅在守卫块内。

### B. 中等修复 — 强制等 UL 渲染
把 `extractZillowData()` 包成 `requestAnimationFrame` + MutationObserver 重试，直到 `findPaymentBreakdownRoot()` 命中且 liCount ≥ 6 后再抓，最多重试 N 次 / T ms。
- **风险：** 引入异步与时延；CDP 与 PR 路径需要兼容。
- **优点：** 直接消除 §4.1 的"抓取过早"竞态。

### C. 局部根治 — 文本回退路径收紧
1. 在 `monthly` section 的 `sliceSection` 终点加 `BuyAbility℠ payment` 与 `Est. payment`，把切片锁在单一致区间。
2. `getStrictLabelValue` 对 `Principal & interest` / `Property taxes` / `Home insurance` / `HOA fees` 在 lookahead 中**跳过包含 `$/mo` 之外的形式**或滑块 estimate 段（隐藏 node 排除）。
3. 守卫增加 hero total 反向校验：若 hero total 与 sum(components) 偏差 > 阈值且 hero total 显著大于 sum，则丢弃文本回退值并把对应字段置 null。

**建议落地顺序：** B → C → A。

---

## 8. 证据清单（供交叉核对）

- [extension/content.js:1718-1756](E:/cursor/HomeScope/extension/content.js) — `findPaymentBreakdownRoot()` strict + relaxed tier + "最短 innerText" 胜出
- [extension/content.js:1760-1801](E:/cursor/HomeScope/extension/content.js) — `extractBuyAbilityPayment()` 6 行读取
- [extension/content.js:1851-1908](E:/cursor/HomeScope/extension/content.js) — `sliceSection` 与 `monthly` section 切片（缺 BuyAbility / Est. payment 终点）
- [extension/content.js:1924-1951](E:/cursor/HomeScope/extension/content.js) — `getStrictLabelValue` Case 2 lookahead=6
- [extension/content.js:2647-2683](E:/cursor/HomeScope/extension/content.js) — 文本回退 6 个字段的 strict label 提取
- [extension/content.js:2731-2752](E:/cursor/HomeScope/extension/content.js) — `zfMonthly` DOM 优先 + 文本回退三目
- [extension/content.js:2754-2774](E:/cursor/HomeScope/extension/content.js) — 一致性守卫（vs sum(components)）
- [extension/content.js:3680](E:/cursor/HomeScope/extension/content.js) — `listing.zillowFinancials` 写入点
- [extension/manifest.json](E:/cursor/HomeScope/extension/manifest.json) — 生产仅加载 `content.js`（不加载模块化 `zillow.ts`）

---

## 9. 调查约束遵守情况

- ✅ 未修改任何文件、配置、测试或运行时状态
- ✅ 未触及 gallery / listing mode / rent / 多单元 / prompt / 评分 / Supabase 后端
- ✅ 未打印整页 DOM；两次诊断脚本均受 200 字符窗口 + 200 KB 输出上限约束
