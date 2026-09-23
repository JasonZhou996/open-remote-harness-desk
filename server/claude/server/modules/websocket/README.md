# Claude 会话 WebSocket

`index.ts` 导出 `createWebSocketServer`、`connectedClients` 和 `WS_OPEN_STATE`。

- `websocket-server.service.ts` / `websocket-auth.service.ts`：连接建立、鉴权与心跳。
- `chat-websocket.service.ts`：`/ws` 的发送、停止、订阅与权限回复。
- `chat-run-registry.service.ts`：运行会话、序号、事件重放和终态。
- `chat-session-writer.service.ts`：将提供方事件关联到应用会话。
- `websocket-state.service.ts`：连接注册表。

启动时从 `server/index.ts` 传入实际 Claude runtime。当前组件不提供上游 `/shell` 或插件 WebSocket；终端由本项目统一网关提供。
