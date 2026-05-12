# Chrome 扩展上线准备清单

## ✅ 已完成的修改

### 1. 更新 manifest.json (2026-04-15)
- ✅ `support_url` 已改为公开链接：`https://www.tryhomescope.com/support`
- ✅ 添加了 512 图标配置到 manifest
- ✅ 隐私政策链接正确：`https://www.tryhomescope.com/privacy`
- ✅ 服务条款链接确认：`https://www.tryhomescope.com/terms`

---

## ⚠️ 仍需处理的事项

### 🔴 必须完成（否则审核会被拒）

#### 1. 准备图标文件

**要求**：
- 需要提供 `extension/icon.png` 文件
- 建议尺寸：**512×512 像素**（PNG 格式）
- 同时建议提供多尺寸版本：
  - `icon-16.png` (16×16)
  - `icon-48.png` (48×48)
  - `icon-128.png` (128×128)
  - `icon-512.png` (512×512)

**最简单方案**：使用现有的 `public/logo.svg` 转换为 512×512 的 PNG

**转换方法**：
```bash
# 如果安装了 ImageMagick
convert public/logo.svg -resize 512x512 extension/icon-512.png

# 或者使用在线工具：
# https://cloudconvert.com/svg-to-png
# https://www.icoconverter.com/
```

**更新 manifest 引用**（如果使用多尺寸文件）：
```json
"icons": {
  "16": "icon-16.png",
  "48": "icon-48.png",
  "128": "icon-128.png",
  "512": "icon-512.png"
}
```

---

#### 2. 确保 ToS 和 Support 页面可访问

已验证（2026-04-15）：
- ✅ https://tryhomescope.com/terms - 可访问
- ✅ https://tryhomescope.com/support - 可访问
- ✅ https://tryhomescope.com/privacy - 可访问

---

### 🟡 建议优化（提升通过率）

#### 3. 扩展描述中添加权限说明

在 `extension/README.md` 或商店描述中添加：

```
## Permissions

This extension requires the following permissions:

- **storage** - Stores your authentication session locally in your browser
- **tabs** - Used to detect property listings and enable communication between the side panel and property pages
- **sidePanel** - Allows the extension to run in Chrome's side panel

## Host Permissions

- **realestate.com.au** - Only accessed when you click "Analyze" to extract property data
- **tryhomescope.com** - For authentication and API communication
- **Supabase** - For secure authentication services

We do not collect any data in the background. All data access is user-initiated.
```

---

#### 4. 构建并测试扩展

```bash
# 在项目根目录执行
npm run build:extension

# 加载到 Chrome
# 1. 打开 chrome://extensions/
# 2. 开启"开发者模式"
# 3. 点击"加载已解压的扩展程序"
# 4. 选择 extension/dist 目录
```

**测试清单**：
- [ ] 扩展图标正常显示
- [ ] 点击扩展图标可打开侧边栏
- [ ] 在 Realestate.com.au 房源页面能正常分析
- [ ] 登录流程正常（OAuth）
- [ ] 侧边栏能正确显示分析结果

---

## 📊 当前合规性评分

| 检查项 | 状态 | 备注 |
|--------|------|------|
| Manifest V3 | ✅ | 符合 |
| 权限最小化 | ✅ | 仅 3 个必要权限 |
| 隐私政策 | ✅ | 完善且公开 |
| support_url | ✅ | 已更新为公开 URL |
| Terms of Service | ✅ | 已存在 |
| 图标文件 | ⚠️ | **需要准备** |
| Host Permissions 说明 | ⚠️ | 建议在描述中补充 |

**综合评分**：8.5/10（图标文件准备完成后）

---

## 🚀 提交步骤

1. **准备图标** → 生成 512×512 PNG 放置到 `extension/icon.png`
2. **重新构建** → `npm run build:extension`
3. **本地测试** → 加载 `extension/dist` 到 Chrome 验证功能
4. **创建开发者账号** → Chrome Web Store 开发者账号（一次性 $5 费用）
5. **打包上传** → 将 `extension/dist` 目录打包为 ZIP
6. **填写商店信息**：
   - 扩展名称：HomeScope
   - 描述：详细说明功能（建议 1000+ 字符）
   - 类别：Productivity
   - 截图：至少 2-3 张（1280×800 或 640×400）
   - 宣传图片：440×280（可选但推荐）
7. **提交审核** → 等待 3-7 个工作日

---

## 📞 需要帮助？

- **图标设计**：可以使用 Figma 或 Canva 制作（搜索 "app icon 512x512"）
- **商店截图**：在 Chrome 中打开侧边栏，使用截图工具捕获
- **描述优化**：参考成功扩展的商店页面结构

---

**最后更新**：2026-04-15
**状态**：等待图标文件准备
