# Claude 网页

三端 Web 使用的 Claude Code 页面，React + Vite。真实执行通过 `src/services/backend.ts` 连接 `server/claude/`，生产环境由统一网关挂载在 `/claude/app/`。

```bash
npm ci
npm run dev                         # 5180，API/WS 代理至本机 3001
npm run build -- --base=/claude/app/ # 输出 dist/
```

`src/components/` 是页面和交互组件，`src/context/` 管理会话、设置与登录状态。三端切换和系统主题脚本复用 `web/codex/`。本目录不再携带上游演示 API、Code Workspace、套餐购买页或重复设置面板。

仓库结构与部署见根 README。
