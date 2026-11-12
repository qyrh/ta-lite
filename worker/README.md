# 团队代理（Cloudflare Worker）部署

作用：把 DeepSeek / 智谱的 Key 放在 Cloudflare Worker 的 Secret 里，同事的浏览器只拿一个“访问口令”。
这样即使网页是公开的，也拿不到真实 Key；也不需要租服务器（Worker 免费额度足够小团队用）。

## 1. 准备

- 一个 Cloudflare 账号（免费）
- 本机 Node.js（用来跑 `wrangler`）
- DeepSeek Key（`platform.deepseek.com`）；可选智谱 Key（`open.bigmodel.cn`）

## 2. 部署

```powershell
cd web-lite/worker

npx wrangler login
npx wrangler deploy
```

首次部署会提示创建 Worker，名字是 `ta-lite-proxy`。记下输出的地址，例如：

```
https://ta-lite-proxy.你的账号.workers.dev
```

设置三个 Secret（按提示粘贴，输入不会回显）：

```powershell
npx wrangler secret put ACCESS_TOKEN
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GLM_API_KEY      # 可选；不用 GLM 可以不设
```

`ACCESS_TOKEN` 自己定一个长口令（例如 24 位随机串），发给同事；它和网页“设置 → 团队代理 → 访问口令”一致。

## 3. 验证

```powershell
curl https://ta-lite-proxy.你的账号.workers.dev/v1/health
```

返回 `{"ok":true,"keys":{"deepseek":true,...}}` 即 Key 已配好（只回布尔，不回 Key）。

## 4. 在网页里填

打开轻量版网页 → 设置：
- 接入方式：**团队代理**
- 代理地址：`https://ta-lite-proxy.你的账号.workers.dev`
- 访问口令：你设置的 `ACCESS_TOKEN`
- 代理供应商：DeepSeek（或 GLM）
- 保存 → 测试连接

## 5. 收紧来源（建议）

部署后把 `wrangler.toml` 里的：

```toml
[vars]
ALLOWED_ORIGIN = "*"
```

改成你的网页地址，例如：

```toml
[vars]
ALLOWED_ORIGIN = "https://yourname.github.io"
```

再 `npx wrangler deploy`。这样别的网站即使知道口令也不能在浏览器里直接调用（注意：口令仍是共享密钥，别公开）。

## 6. 免费额度与限制

- Workers 免费计划每天 10 万次请求；小团队足够。
- 请求体上限受 Cloudflare 限制；试卷图片已在浏览器压到 1600px JPEG，通常每张 < 500KB。
- 模型白名单：`deepseek-flash` / `deepseek-v4-pro` / `glm-4-flash` / `glm-4.6v-flash` / `glm-4v-flash`。
- 不要把这套代理当成公开 API：口令泄露等于 Key 泄露，发现异常立即在 Cloudflare 控制台轮换 Secret。

## 7. 不想用 Cloudflare？

`worker/index.js` 是标准 Fetch API，可稍改后部署到 Deno Deploy、Vercel Edge、Netlify Edge 等；
核心是“校验访问口令 → 注入 Authorization → 转发 → 脱敏错误”。不要在前端代码里写 Key。
