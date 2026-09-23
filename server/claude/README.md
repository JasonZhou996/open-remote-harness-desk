# Claude Code 服务

这是三端 Web 的 Claude 服务组件，使用 CloudCLI 服务端代码和 Claude Agent SDK，提供真实会话、项目、附件、模型/权限控制以及本项目实现的定时任务。

- 服务入口：`server/index.ts`，默认本机端口 3001。
- 模块：`server/modules/`；类型和服务工具：`server/shared/`。
- 网页：仓库中的 `web/claude/`，由统一网关提供。
- 开发：`npm run server:dev`；检查：`npm run typecheck`；构建：`npm run build:server`。
- 构建输出：`dist-server/`；环境文件和数据不纳入 Git。

上游独立网页、Electron、命令行安装器、自动更新器和发布工具不属于本组件。保留的代码按 [LICENSE](LICENSE) 和 [NOTICE](NOTICE) 维护，来源见仓库根 `THIRD_PARTY_NOTICES.md`。
