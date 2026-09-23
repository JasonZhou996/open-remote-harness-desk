# Open Remote Harness Desk

[English](README.md) | [简体中文](README.zh-CN.md)

Open Remote Harness Desk 是一个自托管的 AI 编程工作台，支持三种 Harness：**Codex、Claude Code 和 ZCode**。它将 Codex 桌面端的会话状态同步到 Web 端，让你在浏览器里接着工作。网页、会话同步、文件与终端访问、附件和服务接入由本项目提供；模型任务仍由本机安装的工具执行。

目前的入口是 Codex `/`、Claude Code `/claude/app/` 和 ZCode `/zcode`；项目正在准备接入更多 Harness。

![Open Remote Harness Desk 的桌面、折叠屏和手机界面示意图](assets/overview.png)

> **作者声明：** 本项目使用 GPT-6 在一个下午构建。作者没有看过任何一行代码，不对项目质量和安全性作任何保证。

## 为什么做

在我们的使用场景中，官方 Remote 响应较慢；离开电脑后，也不方便接着使用桌面端的会话和功能。重新找项目、交代上下文，会打断正在进行的工作。

这个项目的目标是：**随时随地打开 Web 入口，就能从刚才的地方继续工作。** 在浏览器里接续会话、查看进度、处理审批、访问项目文件和终端，尽量不让环境切换转移注意力。

推荐通过 HTTPS 和登录鉴权将 Web 入口发布到公网。这样无论在哪里，打开浏览器都能继续上一段工作，享受随时随地的 vibe coding 时光。

## 能做什么

- **同步 Codex 桌面端状态**：桌面端正在进行的会话，可在 Web 端查看同一任务的消息、思考与工具进度、运行状态和权限设置；从网页发出的追问和审批也回到原会话，不用复制上下文另起任务。
- **网页版 Claude Code**：Claude 服务通过 Claude Agent SDK 调用本机 `claude` CLI，在浏览器中提供接近桌面端的会话、项目、工具调用、审批和附件等界面与功能。可用 `CLAUDE_CLI_PATH` 指定 CLI；Windows 上无法定位本机 CLI 时，SDK 可能回退到自带的可执行文件。
- **继续现有会话**：在网页中打开并继续本机 Codex 和 Claude Code 会话，查看历史并按项目整理对话。ZCode 通过同一入口连接本机已安装的应用。
- **在 Web 端处理审批**：批准或拒绝 Codex 的命令执行、文件修改和权限请求，回答任务中的选择题或自由输入问题；Claude 网页也能处理工具授权和提问。模型等待确认时，可以直接在浏览器中回应。
- **查看和操作工作区**：Codex 网页提供项目文件浏览与预览、附件上传、终端、代码改动审阅和浏览器面板；无需只靠聊天文字判断任务做到了哪一步。
- **控制每次对话的运行方式**：选择模型、思考强度和权限模式；上传图片或文件，查看工具调用与思考摘要。Claude 网页还可以创建自有定时任务，并为任务选择模型和权限。
- **在浏览器里接着工作**：重新打开原会话、查看进度并发送追问。草稿等界面状态保留在输入它们的浏览器中；同一个网页入口可切换 Codex、Claude Code 和 ZCode。
- **在 Codex 与 Claude Code 之间继续同一项目**：可将同项目会话双向导入另一端，导入进度可见；目标端生成新会话后继续对话。此功能需安装会话转换器。

## 代码在哪里

```text
server/
  gateway/       HTTP/WebSocket 统一入口、鉴权、网页代理、文件与终端
  codex/         Codex 桌面桥接、会话历史、队列、项目与代码审阅
  claude/        Claude Code 服务：会话、项目、附件、权限与自有定时任务
  zcode/         本机 ZCode 的连接中继与网页适配
web/
  codex/         Codex 网页，以及三端共用的切换菜单和系统主题脚本
  claude/        Claude 网页（React + Vite）
  shared/        两端共用的会话导入界面
android/         Android WebView 客户端源码、资源与构建脚本
scripts/         开发、启动、systemd 安装与局域网发现脚本
deploy/          systemd 部署模板
tests/         网关、网页交互与跨端回归检查
```

ZCode 页面由本机已安装的 ZCode 提供，本仓库只保存接入代码，不复制其应用包。

网关和各端服务**在代码上分开**。Codex 桥接与 ZCode 中继继续由网关进程承载，Claude 服务独立运行；没有为了目录拆分额外引入服务进程。

## 安装和构建

推荐把构建和部署交给你的 AI 助手；作者也不知道自己的 AI 当初是如何构建出这个项目的。下面列出仓库现有的命令，供你的助手检查和使用。

需要 Node.js 22、npm、Bun、Git，以及本机已安装并完成登录的 Codex、Claude Code、ZCode。Linux 终端使用 `node-pty`，首次安装可能需要本地 C/C++ 构建工具；图片预览使用 Python 3 和 Pillow。

```bash
npm run install:deps       # 安装根目录、Claude 服务、Claude 网页的锁定依赖
npm run build             # 网关与 Codex 网页
npm run build:claude       # Claude 网页，部署到 /claude/app/
npm run build:server:claude
npm run install:converter  # 跨端会话导入所需 transession 0.2.0，需要 Rust/Cargo
```

各组件的 `package-lock.json` 独立锁定依赖版本，运行时使用 Bun 不要求再维护第二份包管理锁文件。生成物不进入 Git。

Claude Code 与 Codex 支持同项目双向会话导入。在项目内新建对话，选择另一端的来源会话；进度分为读取、转换、写入、校验，导入期间其他对话照常使用。安装转换器可使用 `npm run install:converter`。

## 运行

开发网关：

```bash
XARNESS_BUNDLED_CODEX_BIN=/absolute/path/to/codex npm run dev
```

默认监听 `127.0.0.1:8899`。Codex 可执行文件路径必须是绝对路径；完整可选配置见 [.env.example](.env.example)。Claude 单独开发：`npm run start:claude`；网页开发：`npm --prefix web/claude run dev`（代理至本机 3001）。组件单独启动前先确认端口未被现有服务占用。

本机常驻部署使用现有 systemd 服务：

```bash
npm run services:install   # 安装/更新模板并启动统一 target；不重启已运行的服务
npm start
npm run status
./start.sh logs
```

`deploy/` 和 `scripts/start-gateway.sh` 是部署模板，换机器时需调整程序路径、监听地址和可选隧道配置。`npm run restart` 会重启整个工作台并中断运行中的服务连接；日常前端更新不需要重启。

Android 构建见 [android/README.md](android/README.md)。

## 检查

```bash
npm run check
npm test
npm --prefix server/claude run typecheck
node --test tests/unified-start.test.mjs tests/claude-conversation-state.test.mjs tests/claude-workspace.test.mjs
```

`tests/` 下还有按功能划分的浏览器、协议和集成检查。需要模型执行或本机应用的检查必须单独运行，不能把模拟测试当作真实模型验收。本地 `docs/` 不进入 Git。

## 数据与来源

会话、登录凭据、数据库、上传附件和安装包不进入 Git：Codex、Claude、ZCode 各用原有本机数据目录，Claude 数据保留在 `~/.cloudcli/`，服务环境变量在 `server/claude/.env`。Android 签名密钥仅保存在本机。

本项目基于已有开源实现做整合与维护，不包含它们的完整上游产品。仓库保留本项目使用的代码，去掉未使用的 CloudCLI 网页、Electron 代码、发布工具、插件模板和演示用后端。初始提交是剪裁后的版本，不包含剪裁前的文件和旧 Git 历史；上游来源与许可声明保留。

来源与组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。根 [LICENSE](LICENSE) 保留 Codex WebUI 上游 MIT 声明；Claude 服务保留自己的 AGPL 许可与 NOTICE，不能将整个仓库统一视为 MIT。
