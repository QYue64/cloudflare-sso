# 生产部署配置说明

## 配置文件说明

### `wrangler.jsonc` - 开源模板配置
- 这是提交到 Git 的公开配置文件
- 包含占位符配置（如 `replace-with-your-d1-database-id`）
- 用于文档和开源分享

### `wrangler.production.jsonc` - 生产环境配置
- **不提交到 Git**（已添加到 `.gitignore`）
- 包含真实的生产环境配置：
  - D1 数据库 ID
  - 生产域名（ISSUER、PAGES_ORIGIN）
  - Worker 名称
- 仅在本地使用，用于部署到生产环境

## 部署命令

所有部署命令已配置为自动使用生产配置：

```bash
# 部署 Worker
npm run deploy:worker

# 部署 Pages
npm run deploy:pages

# 远程数据库迁移
npm run db:migrate:remote
```

## 首次设置步骤

1. 复制生产配置模板：
   ```bash
   cp wrangler.production.jsonc.example wrangler.production.jsonc
   ```

2. 编辑 `wrangler.production.jsonc`，填入你的真实配置：
   - `database_id`: 你的 D1 数据库 ID
   - `ISSUER`: 你的 SSO 域名
   - `PAGES_ORIGIN`: 你的 Pages 域名

3. 确保 `wrangler.production.jsonc` 已添加到 `.gitignore`

## 注意事项

⚠️ **重要**: 永远不要将 `wrangler.production.jsonc` 提交到 Git！

- 该文件包含生产环境的敏感信息
- 已通过 `.gitignore` 排除
- 每个部署环境应有自己的生产配置文件

## 当前生产配置

你的生产环境配置：
- **Worker**: private-oidc
- **D1 数据库**: private-oidc (`99e354ca-1152-4289-9ce7-5133b522fd20`)
- **Pages 项目**: private-oidc-pages
- **生产域名**: https://sso.aiku.qzz.io
