# ioDrive 部署指南

本文档提供详细的部署步骤，帮助你在 15 分钟内完成 ioDrive 的部署。

## 前置要求

- Cloudflare 免费账号（或付费账号）
- 一个托管在 Cloudflare DNS 上的域名
- 基本的命令行操作能力

## 第一步：Fork 仓库

1. 访问 [Cloudflare-ioDrive 仓库](https://github.com/Mareixcode/Cloudflare-Drive)
2. 点击右上角的 **Fork** 按钮
3. 选择你的 GitHub 账号，点击 **Create fork**

## 第二步：准备 Cloudflare 资源

### 2.1 创建 R2 存储桶

R2 是 Cloudflare 的对象存储服务，用于存储上传的文件。

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 在左侧菜单找到 **R2**，点击进入
3. 点击 **创建存储桶**
4. 填写存储桶名称，例如 `iodrive`
   - 名称只能包含小写字母、数字和连字符
   - 全局唯一，不能与其他用户重复
5. 点击 **创建存储桶**
6. 创建完成后，在存储桶页面点击 **管理 R2 API 令牌**
7. 点击 **创建 API 令牌**
8. 权限选择 **管理员读/写**
9. 点击 **创建 API 令牌**
10. **重要**：记录以下信息，稍后需要填写到 GitHub Secrets：
    - Access Key ID
    - Secret Access Key（只显示一次，务必保存）

### 2.2 创建 D1 数据库

D1 是 Cloudflare 的 SQLite 数据库，用于存储元数据（分享记录、日志等）。

1. 在 Cloudflare Dashboard 左侧菜单找到 **Workers & Pages**
2. 点击 **D1**
3. 点击 **创建数据库**
4. 填写数据库名称，例如 `iodrive-meta`
5. 点击 **创建数据库**
6. 创建后，在数据库详情页面找到 **数据库 ID**
   - 格式类似：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
7. **重要**：记录数据库 ID，稍后需要填写到 GitHub Secrets

### 2.3 创建 Turnstile 站点

Turnstile 是 Cloudflare 的人机验证服务，用于防止滥用。

1. 在 Cloudflare Dashboard 左侧菜单找到 **Turnstile**
2. 点击 **添加站点**
3. 填写站点名称，例如 `iodrive-production`
4. 选择 **托管** 模式
5. 在域名部分填写你计划使用的域名，例如：
   - `drive.example.com`（如果使用子域名）
   - `example.com`（如果使用根域名）
6. 点击 **创建站点**
7. 创建后，在站点详情页面找到：
   - **站点密钥**（Site Key）
   - **密钥**（Secret Key）
8. **重要**：记录这两个密钥，稍后需要填写到 GitHub Secrets

### 2.4 创建 Cloudflare API 令牌

API 令牌用于 GitHub Actions 自动部署到 Cloudflare。

1. 点击右上角头像 → **我的个人资料**
2. 在左侧菜单找到 **API 令牌**
3. 点击 **创建令牌**
4. 选择 **编辑 Cloudflare Workers** 模板
5. 在权限配置中，确保包含以下权限：
   - Account - Cloudflare Workers - Edit
   - Account - Workers Scripts - Edit
   - **Account - D1 - Edit**（必需，用于自动迁移数据库）
6. 在账户资源中选择你的 Cloudflare 账户
7. 点击 **继续以显示摘要**
8. 点击 **创建令牌**
9. **重要**：复制令牌值，只显示一次，务必保存

### 2.5 获取 Cloudflare 账户 ID

1. 在 Cloudflare Dashboard 首页
2. 右侧 **API** 区域可以看到 **账户 ID**
3. **重要**：记录账户 ID，稍后需要填写到 GitHub Secrets

## 第三步：配置 GitHub Secrets

1. 访问你 Fork 后的仓库
2. 点击 **Settings** 标签
3. 在左侧菜单找到 **Secrets and variables** → **Actions**
4. 点击 **New repository secret**
5. 按照下表逐个添加 Secrets

### 必需的 Secrets（共 10 个）

| Secret 名称 | 值 | 说明 |
|-------------|---|------|
| `CLOUDFLARE_API_TOKEN` | 2.4 步骤创建的 API 令牌 | 用于部署和数据库迁移 |
| `CLOUDFLARE_ACCOUNT_ID` | 2.5 步骤获取的账户 ID | 你的 Cloudflare 账户 ID |
| `CLOUDFLARE_D1_API_TOKEN` | 2.4 步骤创建的 API 令牌（也可以使用同一个） | 必需，需包含 D1 Edit 权限 |
| `META_DB_ID` | 2.2 步骤获取的数据库 ID | D1 数据库 ID |
| `ADMIN_PASS` | 你设置的管理员密码 | 建议使用强密码，至少 12 位 |
| `JWT_SECRET` | 随机生成的密钥 | 运行 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TURNSTILE_SECRET` | 2.3 步骤获取的密钥 | Turnstile 密钥 |
| `TURNSTILE_SITE_KEY` | 2.3 步骤获取的站点密钥 | Turnstile 站点密钥 |
| `R2_ACCESS_KEY` | 2.1 步骤获取的 Access Key ID | R2 API 访问密钥 |
| `R2_SECRET_KEY` | 2.1 步骤获取的 Secret Access Key | R2 API 密钥 |

### 可选的 Secrets

| Secret 名称 | 值 | 说明 |
|-------------|---|------|
| `S3_ACCESS_KEY` | S3 Access Key | 仅在启用 S3 同步时需要 |
| `S3_SECRET_KEY` | S3 Secret Key | 仅在启用 S3 同步时需要 |
| `CACHE_KV_ID` | KV 命名空间 ID | 可选，用于提升性能 |

### 生成 JWT_SECRET

在终端运行以下命令生成随机密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

如果没有 Node.js，可以使用在线工具生成随机字符串，长度至少 64 字符。

## 第四步：配置域名 DNS

确保你的域名已托管在 Cloudflare DNS 上：

1. 在 Cloudflare Dashboard 点击 **添加站点**
2. 输入你的域名（如 `example.com`）
3. 按照提示添加 DNS 记录
4. 如果需要使用子域名（如 `drive.example.com`），添加 CNAME 记录：
   - 名称：`drive`
   - 目标：你的 Worker 域名（部署后会获得）

## 第五步：一键部署

1. 访问你 Fork 后的仓库
2. 点击 **Actions** 标签
3. 在左侧工作流列表中找到 **🚀 一键部署 ioDrive**
4. 点击 **Run workflow**
5. 填写配置参数：

### 必填参数

- **Worker 名称**：自定义，例如 `iodrive`
- **域名**：你的域名，例如 `example.com`
- **路由前缀**：子域名前缀，例如 `drive`（最终访问 `drive.example.com`）
- **R2 存储桶名称**：2.1 步骤创建的存储桶名称（留空则使用 Worker 名称）
- **R2 公开访问域名**：R2 公开域名，例如 `r2.example.com`
  - 如果不需要 R2 公开访问，可以填写虚拟域名
  - 需要在 Cloudflare DNS 中配置 CNAME 指向 R2
- **管理员用户名**：默认 `admin`，可自定义

### 可选参数

- **是否启用 S3 同步**：如需同步到其他 S3 存储则填 `true`，否则 `false`
- **S3 端点**：仅在启用 S3 时填写，例如 `s3.amazonaws.com`
- **S3 存储桶**：仅在启用 S3 时填写
- **S3 区域**：仅在启用 S3 时填写，例如 `us-east-1`
- **KV 缓存命名空间 ID**：可选，填写你创建的 KV 命名空间 ID

6. 点击 **运行** 按钮
7. 等待部署完成（约 2-3 分钟）
8. 部署成功后会显示访问地址

## 第六步：验证部署

### 6.1 访问管理后台

部署成功后，访问 `https://<路由前缀>.<域名>`，例如 `https://drive.example.com`

你应该能看到登录页面。

### 6.2 登录测试

使用你配置的管理员账号和密码登录：
- 用户名：默认 `admin`，或你自定义的用户名
- 密码：你在 GitHub Secrets 中设置的 `ADMIN_PASS`

### 6.3 测试核心功能

1. **文件上传**
   - 点击上传区域，选择一个小文件（< 20MB）
   - 等待上传完成
   - 检查文件列表是否显示新上传的文件

2. **文件分享**
   - 点击文件右侧的分享按钮
   - 复制分享链接
   - 在新标签页打开分享链接
   - 完成 Turnstile 验证
   - 测试下载功能

3. **公共上传**
   - 访问 `/upload` 页面
   - 测试公共上传功能

4. **检查 R2 存储桶**
   - 进入 Cloudflare Dashboard → R2
   - 打开你的存储桶
   - 确认上传的文件已存在

5. **检查 D1 数据库**
   - 进入 Cloudflare Dashboard → Workers & Pages → D1
   - 打开你的数据库
   - 运行 SQL 查询：`SELECT * FROM kv WHERE category = 'share' LIMIT 10;`
   - 确认有分享记录

## 第七步：配置 R2 公开访问（可选）

如果你需要直接通过 R2 域名访问文件（用于提升下载速度），需要配置 R2 公开访问：

1. 在 Cloudflare Dashboard → R2
2. 打开你的存储桶
3. 点击 **设置** → **公开访问**
4. 启用公开访问
5. 在 Cloudflare DNS 中添加 CNAME 记录：
   - 名称：`r2`（或你想要的子域名）
   - 目标：`<你的存储桶名称>.<账户ID>.r2.cloudflarestorage.com`
6. 在 GitHub Secrets 的 `R2_PUBLIC_DOMAIN` 中填写 `r2.example.com`

## 常见问题

### 部署失败：缺少 Secret

**错误信息**：`❌ 缺少 Secret: XXX`

**解决方案**：
- 检查 GitHub Secrets 是否配置完整
- 确保 Secret 名称完全匹配（区分大小写）
- 特别检查 `CLOUDFLARE_D1_API_TOKEN` 和 `META_DB_ID`

### 部署失败：D1 迁移失败

**错误信息**：`D1 migration failed`

**解决方案**：
- 确保 `CLOUDFLARE_D1_API_TOKEN` 包含 D1 Edit 权限
- 手动运行迁移命令：
  ```bash
  npx wrangler d1 migrations apply META_DB --remote
  ```

### 登录后文件列表为空

**可能原因**：
- R2 存储桶名称配置错误
- R2 API 令牌权限不足

**解决方案**：
- 检查 wrangler.toml 中的 `R2_BUCKET` 是否与实际存储桶名称一致
- 确保 R2 API 令牌有读写权限
- 在 Cloudflare Dashboard → R2 中手动上传一个测试文件

### 上传文件失败

**可能原因**：
- R2 API 令牌权限不足
- 存储桶未创建
- 文件大小超过限制

**解决方案**：
- 检查 R2 API 令牌权限
- 确认存储桶已创建
- 检查文件大小（单文件限制 20MB，分片上传无限制）

### Turnstile 验证失败

**可能原因**：
- Turnstile 站点未创建
- 域名配置不匹配
- 密钥配置错误

**解决方案**：
- 确保 Turnstile 站点已创建
- 检查站点配置的域名是否包含你的部署域名
- 确认 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET` 配置正确

### 文件下载速度慢

**可能原因**：
- 未配置 R2 公开访问
- 使用了 S3 后端但未优化

**解决方案**：
- 配置 R2 公开访问（见第七步）
- 使用 Cloudflare CDN 加速
- 考虑使用更近的 S3 区域

## 后续维护

### 更新代码

当你 Fork 的仓库有更新时：

1. 进入你的仓库
2. 点击 **Sync fork** 按钮
3. 点击 **Update branch**
4. 推送到 `main` 分支会自动触发部署

### 备份数据

定期备份以下数据：

- R2 存储桶中的文件
- D1 数据库数据（使用 wrangler 导出）

### 监控日志

在 Cloudflare Dashboard → Workers → 你的 Worker → 日志 中查看运行日志。

## 安全建议

1. **定期更换密钥**
   - 定期更换 `ADMIN_PASS` 和 `JWT_SECRET`
   - 轮换 API 令牌

2. **启用 IP 白名单**（可选）
   - 在 Cloudflare WAF 中配置 IP 白名单
   - 限制管理后台访问

3. **启用 HTTPS**
   - Cloudflare 默认提供免费 SSL 证书
   - 确保强制 HTTPS 重定向

4. **定期审计**
   - 定期检查 GitHub Secrets
   - 审查 API 令牌权限
   - 检查访问日志

## 下一步

部署完成后，你可以：

- 配置自定义域名
- 启用 S3 多后端同步
- 配置内容审核
- 启用 WebDAV 网盘挂载
- 配置随机图片 API

详细配置请参考 [README.md](README.md)。

## 获取帮助

如果遇到问题：

1. 查看本文档的「常见问题」部分
2. 查看 [GitHub Issues](https://github.com/Mareixcode/Cloudflare-Drive/issues)
3. 提交新的 Issue，包含：
   - 错误信息
   - 部署环境信息
   - 已尝试的解决方案
