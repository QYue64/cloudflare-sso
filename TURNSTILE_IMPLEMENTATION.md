# Cloudflare Turnstile 人机验证实施说明

本项目已接入 Cloudflare Turnstile，可在系统配置中按场景启用人机验证。

## 已实现能力

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 后端配置 API | 已完成 | 管理员可读取和保存 Turnstile 配置 |
| 公开配置 API | 已完成 | 前端可读取 Site Key 和启用场景，不返回 Secret Key |
| 后端验证 | 已完成 | 登录、注册、忘记密码、更换邮箱可按开关验证 Turnstile token |
| 密钥存储 | 已完成 | Secret Key 使用项目现有 `encryptSecret()` 加密后写入 `app_settings` |
| 登录页 | 已完成 | 启用后提交登录前必须完成人机验证 |
| 注册页 | 已完成 | 启用后发送注册验证码前必须完成人机验证 |
| 忘记密码 | 已完成 | 启用后发送重置密码验证码前必须完成人机验证 |
| 更换邮箱 | 已完成 | 启用后发送换绑邮箱验证码前必须完成人机验证 |
| 系统配置页 | 已完成 | 在“系统配置”中编辑 Turnstile 开关、Site Key、Secret Key 和启用场景 |

## API

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/admin/turnstile` | 管理员 | 获取完整配置，包含解密后的 Secret Key |
| `POST /api/admin/turnstile` | 管理员 | 保存配置 |
| `GET /api/public/turnstile` | 公开 | 获取前端所需配置，不包含 Secret Key |

## 配置字段

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否启用 Turnstile |
| `siteKey` | 前端渲染 Turnstile widget 使用 |
| `secretKey` | 后端调用 Cloudflare 校验接口使用，加密存储 |
| `enableOnLogin` | 登录时启用 |
| `enableOnRegister` | 注册发送验证码时启用 |
| `enableOnPasswordReset` | 忘记密码发送验证码时启用 |
| `enableOnEmailChange` | 更换邮箱发送验证码时启用 |

## Cloudflare 配置步骤

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 进入 `Turnstile`。
3. 点击 `Add Site`。
4. Domain 填写 SSO 域名，例如 `sso.aiku.qzz.io`。
5. Widget Mode 推荐选择 `Managed`。
6. 创建后复制 `Site Key` 和 `Secret Key`。
7. 在统一登陆平台后台进入“系统配置”，打开“Turnstile 人机验证”并填入密钥。

## 安全说明

- Secret Key 不会通过公开接口返回。
- 前端只提交 Turnstile token，最终校验在 Worker 后端完成。
- 后端校验时会尽量传递 `CF-Connecting-IP` 或 `X-Forwarded-For` 作为远端 IP。
- 配置复用已有 `app_settings` 表，不需要新增数据库表。
