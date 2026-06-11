<p align="center">
  <img src="assets/mimo-agent-icon.png" alt="MiMo Logo" width="128" height="128">
</p>

<h1 align="center">MiMo Agent</h1>

<p align="center">
  <strong>OpenAI-compatible coding agent for VS Code, optimized for Xiaomi MiMo models.</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=mimo-agent.mimo-agent">
    <img src="https://img.shields.io/visual-studio-marketplace/v/mimo-agent.mimo-agent.svg?label=VS%20Code%20Marketplace" alt="VS Code Marketplace">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mimo-agent.mimo-agent">
    <img src="https://img.shields.io/visual-studio-marketplace/i/mimo-agent.mimo-agent.svg" alt="Installs">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <a href="https://github.com/YSP0Github/MIMO-Agent">
    <img src="https://img.shields.io/github/stars/YSP0Github/MIMO-Agent?style=social" alt="GitHub Stars">
  </a>
</p>

<p align="center">
  <strong>中文</strong> | <a href="#english">English</a> | <a href="CHANGELOG.md">Changelog</a>
</p>

---

## 中文

MiMo Agent 是一个运行在 VS Code 中的本地 AI 编程助手，面向 MiMo 及 OpenAI-compatible 模型接口优化。它可以阅读工程、搜索代码、编辑文件、执行命令、查看 diff、管理多轮任务，并提供更适合中文开发流程的交互体验。

当前版本：`v1.7.2`

### 1.7.2 重点更新

- 优化了 Bash、Edit、Write 等工具卡片的渲染性能，减少长输出和大 diff 对聊天界面的卡顿影响。
- 历史消息中的执行过程抽屉改为延迟渲染，大幅降低历史回放时的初始 DOM 压力。
- 改进了 diff / 预览相关体验：覆盖写入预览确认链路更一致，只读预览链路更稳定。
- 增强了错误展示和手动停止提示，让 API / 模型异常与用户主动停止更容易区分。
- 修复并补强了 Plan 模式、历史快照、图片回看、消息复制、模型切换等一批交互细节。

### 核心能力

- 工程内文件读写、编辑、搜索、glob 查找、命令执行、Git 状态与 diff 审查
- 多模型路由与 OpenAI-compatible API 配置
- Auto、Polling、Plan、Adversarial、Infinite 多种工作模式
- 任务拆分、Todo、Workflow、多轮历史记录与快照回放
- 图片输入、思考内容渲染、只读 diff 预览、友好错误展示
- Safe Mode / Docker Mode 安全执行策略

### 快速开始

1. 在 VS Code Marketplace 安装 **MiMo**
2. 打开命令面板，运行 `MiMo: Settings`
3. 配置 API Key、Base URL 和模型
4. 运行 `MiMo: Open Chat`

默认 MiMo Endpoint：

```text
https://token-plan-cn.xiaomimimo.com/v1
```

常用模型示例：

```text
mimo-v2.5-pro
mimo-v2.5
mimo-v2-pro
mimo-v2-mini
```

### 常用命令

- `MiMo: Open Chat`
- `MiMo: New Chat Window`
- `MiMo: Settings`
- `MiMo: Switch Model`
- `MiMo: Clear Conversation`
- `MiMo: Explain Code`
- `MiMo: Review Code`
- `MiMo: Refactor Code`

### 本地开发

```bash
git clone https://github.com/YSP0Github/MIMO-Agent.git
cd MIMO-Agent
npm install
npm run compile
npm test
```

打包：

```bash
npm run package
```

---

<h2 id="english">English</h2>

MiMo Agent is a local AI coding assistant for VS Code, optimized for MiMo and other OpenAI-compatible model endpoints. It can inspect your workspace, search code, edit files, run commands, review diffs, and support longer multi-step coding workflows with a smoother UI for real-world development.

Current version: `v1.7.2`

### 1.7.2 Highlights

- Improved rendering performance for Bash, Edit, and Write tool cards to reduce UI lag from long output and large diffs.
- Deferred heavy execution-detail rendering in history replay, making archived conversations much more responsive.
- Refined diff / preview flows so overwrite previews behave more consistently and readonly preview behavior is more stable.
- Improved friendly error formatting and manual-stop feedback so API/model failures are easier to distinguish from user interruption.
- Fixed and polished a broad set of workflow details around Plan mode, history snapshots, image recall, message copy behavior, and model switching.

### Core Capabilities

- Workspace-aware file read/write/edit, code search, glob search, shell execution, and Git review
- OpenAI-compatible model routing and provider configuration
- Auto, Polling, Plan, Adversarial, and Infinite working modes
- Task scheduling, todos, workflows, history replay, and UI snapshots
- Image input, rendered reasoning, readonly diff preview, and friendly error cards
- Safe Mode and optional Docker isolation

### Quick Start

1. Install **MiMo** from the VS Code Marketplace
2. Run `MiMo: Settings`
3. Configure API Key, Base URL, and model
4. Run `MiMo: Open Chat`

Default MiMo endpoint:

```text
https://token-plan-cn.xiaomimimo.com/v1
```

Common model IDs:

```text
mimo-v2.5-pro
mimo-v2.5
mimo-v2-pro
mimo-v2-mini
```

### Development

```bash
git clone https://github.com/YSP0Github/MIMO-Agent.git
cd MIMO-Agent
npm install
npm run compile
npm test
```

Package the extension:

```bash
npm run package
```

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.
