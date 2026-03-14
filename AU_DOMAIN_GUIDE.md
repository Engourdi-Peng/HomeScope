# 澳大利亚域名注册指南

## 推荐的 .au 域名后缀

| 后缀 | 适用场景 | 价格(约) |
|------|----------|----------|
| .com.au | 商业网站（最常用） | $15-25/年 |
| .net.au | 网络/科技公司 | $15-25/年 |
| .au | 通用短域名 | $20-30/年 |
| .com.au | 商业网站（最常用） | $15-25/年 |

## 域名推荐（适合房产分析类网站）

基于你的应用功能（房产分析助手），以下是一些建议：

- `propertyhelper.com.au`
- `rentalanalyzer.com.au`
- `propertyassistant.com.au`
- `houzexaminer.com.au`
- `realestatehelper.com.au`

---

## 注册流程

### 步骤 1: 选择注册商

推荐的澳大利亚域名注册商：

1. **Cloudflare** (推荐)
   - 网站: https://www.cloudflare.com
   - 优点: 价格实惠、隐私保护好
   - .com.au: ~$15/年

2. **Namecheap**
   - 网站: https://www.namecheap.com
   - 优点: 界面友好、促销多

3. **GoDaddy**
   - 网站: https://www.godaddy.com
   - 优点: 全球知名

4. **澳大利亚本地注册商**
   - **Netregistry**: https://www.netregistry.com.au
   - **Crazydomains**: https://www.crazydomains.com.au
   - **Melbourne IT**: https://www.melbourneit.com.au

### 步骤 2: .au 域名特殊要求

注册 .au 域名（.com.au, .net.au）需要提供：

1. **澳大利亚商业号码 (ABN)** - 必须
   - 如果没有 ABN，可以考虑注册 .au 域名（无需 ABN）

2. **或者选择无需 ABN 的选项**
   - `.au` 域名相对宽松
   - 某些注册商提供代理服务

### 步骤 3: 注册步骤（以 Cloudflare 为例）

1. 访问 https://www.cloudflare.com/products/registrar/
2. 搜索你想要的域名
3. 选择后缀 (.com.au 或 .au)
4. 添加到购物车
5. 创建账户或登录
6. 完成支付

### 步骤 4: 连接域名到 Vercel

注册域名后，在 Vercel 中配置：

1. 进入 Vercel Dashboard -> 你的项目
2. 点击 "Settings" -> "Domains"
3. 点击 "Add Domain"
4. 输入你的域名（如 `propertyhelper.com.au`）
5. 按照提示配置 DNS 记录
6. Vercel 会自动配置 SSL 证书

---

## 注意事项

1. **DNS 传播时间**: 添加域名后，可能需要 24-48 小时全球生效
2. **SSL 证书**: Vercel 自动提供 Let's Encrypt 证书
3. **续费**: 记得设置自动续费，避免域名过期

---

## 替代方案：先使用默认域名测试

如果你还没有 ABN 或不想立即注册域名，可以：

1. 先使用 Vercel 提供的 `*.vercel.app` 域名进行测试
2. 确认所有功能正常后，再注册 .au 域名
3. 将域名指向 Vercel

这样可以先验证网站功能，再投资域名。
