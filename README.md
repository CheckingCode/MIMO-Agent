<p align="center">
  <img src="assets/mimo-agent-icon.png" alt="MiMo Logo" width="128" height="128">
</p>

<h1 align="center">MiMo</h1>

<p align="center">
  <strong>小米 MiMo 大模型驱动的智能 AI 编程助手</strong>
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
  <strong>🇨🇳 中文</strong> | <a href="#-english">🇬🇧 English</a> | <a href="#-changelog">📋 Changelog</a>
</p>

---

## 🌟 推荐仓库

如果你正在寻找一个能在 VS Code 中直接读代码、改文件、跑命令、做审查并支持任务恢复的 AI 编程助手，推荐关注这个仓库：

[![GitHub Repo](https://img.shields.io/badge/GitHub-YSP0Github%2FMIMO--Agent-181717?style=for-the-badge&logo=github)](https://github.com/YSP0Github/MIMO-Agent)
[![Star](https://img.shields.io/badge/Star-支持%20MiMo-yellow?style=for-the-badge&logo=github)](https://github.com/YSP0Github/MIMO-Agent/stargazers)

欢迎 Star、Fork 或提交 Issue。你的 Star 能帮助更多开发者发现 MiMo，也会鼓励项目持续改进。

---

## ✨ 功能亮点

### 🤖 智能对话
- **多轮对话** — 支持连续对话，AI 记住上下文，越聊越懂你
- **图片理解** — 直接粘贴图片（Ctrl+V），AI 分析代码截图、错误信息、UI 设计稿
- **语音输入** — 支持本地语音输入能力（可在界面启用后使用）

### 🛠️ 强大的工具能力

| 工具 | 能力 |
|------|------|
| 📄 文件操作 | 读取、创建、编辑文件，支持精确的代码修改 |
| 💻 终端命令 | 执行 Bash / PowerShell 命令，安装依赖、运行测试 |
| 🔍 代码搜索 | 全局搜索代码、按文件名查找、正则匹配 |
| 📊 Git 操作 | 查看状态、差异、日志，创建分支、提交更改 |
| 🌐 网页搜索 | 使用 DuckDuckGo 搜索技术文档和解决方案 |
| 🕷️ 网页抓取 | 获取网页内容进行分析和学习 |

### 🎯 四种工作模式

| 模式 | 图标 | 说明 | 最佳场景 |
|------|------|------|----------|
| **自动** | 🔄 | AI 自主决定何时使用工具 | 日常编程、快速问答 |
| **轮询** | ⏩ | 自动继续直到任务完成 | 复杂任务、批量重构 |
| **规划** | 📋 | 先只读分析再执行 | 大型项目、架构设计 |
| **对决** | ⚔️ | 疯狂程序猿 vs 多维审查团 | 代码审查、安全审计 |

### 🧭 任务恢复
- **推理循环检测** — 自动识别模型重复思考、卡住不动的情况
- **Fresh model 恢复** — 在同一会话中切换到新的模型调用继续收尾
- **中断交接总结** — 达到轮次上限时输出已完成内容、改动文件、验证状态和下一步恢复建议

### 🔒 安全执行（沙箱模式）
- **Safe Mode** — 轻量级本地保护：命令检查、工作区边界检查、超时、输出限制
- **Docker Mode** — 容器级隔离，更强的安全保障
- **Git 快照** — 执行风险命令前自动创建备份，出错随时回滚
- **命令审计** — 记录所有执行的命令，完整可追溯

### 🌍 多语言支持
- 中文 / English 一键切换
- 设置界面自动跟随 VS Code 语言设置

### 📝 历史记录管理
- 自动保存所有对话历史
- 全文搜索（标题 + 消息内容）
- 一键导出为 Markdown 或 JSON

---

## 🚀 快速开始

### 第一步：安装扩展

在 VS Code 扩展市场搜索 **MiMo** 并安装，或直接点击：

[![Install](https://img.shields.io/badge/Install-MiMo-blueviolet?style=for-the-badge&logo=visual-studio-code)](vscode:extension/mimo-agent.mimo-agent)

### 第二步：配置 API Key

1. 按 `Ctrl+Shift+P`，输入 `MiMo: Settings`
2. 在 **API Key** 栏输入你的密钥
3. 根据需要调整模型、温度等参数
4. 点击 **Save and Apply**

> MiMo 支持所有 OpenAI 兼容的 API 接口，包括小米 MiMo 官方 API、OpenAI、DeepSeek 等。

### 第三步：开始对话

按 `Ctrl+Shift+P` 输入 `MiMo: New Chat Window`，或用 `MiMo: Open Chat` 打开聊天视图。

---

## 💡 使用示例

| 场景 | 你 | MiMo |
|------|-----|------|
| 分析项目 | 帮我分析一下这个项目的代码结构 | 自动扫描目录 → 读取关键文件 → 给出架构说明 |
| 代码重构 | 把这个函数重构成更简洁的版本 | 读取代码 → 理解逻辑 → 直接修改文件 |
| Bug 修复 | 运行测试报错了，帮我看看 | 执行测试 → 分析错误 → 提供修复方案 |
| 图片理解 | [粘贴一张错误截图] | 识别截图 → 分析原因 → 给出解决方案 |
| 代码审查 | 帮我审查 src/api.ts 的代码质量 | CrazyCoder + Multi-reviewer → 生成审查报告 |

---

## ⚙️ 配置选项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `api.api_key` | API 密钥 | — |
| `api.base_url` | API 端点地址 | `https://token-plan-cn.xiaomimimo.com/v1` |
| `api.model` | 默认模型 | `mimo-v2.5-pro` |
| `agent.max_tokens` | 最大 Token 数 | `8192` |
| `agent.max_rounds` / `mimo.maxRounds` | 最大工具调用轮次，`0` 表示不限轮次 | `0` |
| `agent.temperature` | 温度（越高越随机） | `0.7` |
| `agent.enable_thinking` / `mimo.enableThinking` | 是否启用 MiMo thinking | `false` |
| `sandbox.mode` | 沙箱模式 (`safe` / `docker`) | `safe` |

配置优先级：`~/.mimo/settings.json` > 环境变量 > VS Code 设置 > 默认值。

更多配置请查看扩展设置界面。

---

## 🔧 命令面板

| 命令 | 说明 |
|------|------|
| `MiMo: Open Chat` | 打开当前聊天视图 |
| `MiMo: New Chat Window` | 新建聊天窗口 |
| `MiMo: Settings` | 打开设置界面 |
| `MiMo: Clear Conversation` | 清空当前对话 |
| `MiMo: Explain Code` | 解释选中的代码 |
| `MiMo: Review Code` | 审查选中的代码 |
| `MiMo: Refactor Code` | 重构选中的代码 |

模型和工作模式可在聊天界面底部切换。

---

## 📋 系统要求

- **VS Code** 1.85.0 或更高版本
- **API Key** — 支持 OpenAI 兼容接口（小米 MiMo API、OpenAI、DeepSeek 等）
- **Docker**（可选）— 如需使用 Docker 沙箱模式

---

## 🐛 问题反馈

1. 在 [GitHub Issues](https://github.com/YSP0Github/MIMO-Agent/issues) 提交反馈
2. 加入社区讨论

---

## 📜 许可证

MIT License

---

## 🙏 致谢

- [小米 MiMo](https://github.com/XiaoMi/MiMo) — 强大的大语言模型
- [VS Code](https://code.visualstudio.com/) — 优秀的代码编辑器

---

<p align="center">
  <a href="https://github.com/YSP0Github/MIMO-Agent">
    <img src="https://img.shields.io/badge/GitHub-推荐仓库-181717?style=for-the-badge&logo=github" alt="GitHub repository">
  </a>
  <a href="https://github.com/YSP0Github/MIMO-Agent/stargazers">
    <img src="https://img.shields.io/badge/Star-支持项目-yellow?style=for-the-badge&logo=github" alt="Star MiMo on GitHub">
  </a>
</p>

<p align="center">
  <strong>如果觉得好用，请给个 Star 支持一下！</strong>
</p>

---

# 🇬🇧 English

<p align="center">
  <a href="#">🇨🇳 中文</a> | <strong>🇬🇧 English</strong> | <a href="#-changelog">📋 Changelog</a>
</p>

<p align="center">
  <strong>Intelligent AI coding assistant powered by Xiaomi MiMo LLM</strong>
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

---

## 🌟 Recommended Repository

If you want an AI coding assistant that can read code, edit files, run commands, review changes, and recover interrupted tasks inside VS Code, this repository is worth watching:

[![GitHub Repo](https://img.shields.io/badge/GitHub-YSP0Github%2FMIMO--Agent-181717?style=for-the-badge&logo=github)](https://github.com/YSP0Github/MIMO-Agent)
[![Star](https://img.shields.io/badge/Star-Support%20MiMo-yellow?style=for-the-badge&logo=github)](https://github.com/YSP0Github/MIMO-Agent/stargazers)

Stars, forks, and issues are welcome. A Star helps more developers discover MiMo and supports ongoing improvements.

---

## ✨ Highlights

### 🤖 Smart Conversation
- **Multi-turn dialogue** — AI remembers context across messages
- **Image understanding** — Paste images directly (Ctrl+V) to analyze code screenshots
- **Voice input** — Supports local voice input when enabled in the UI

### 🛠️ Powerful Tool Capabilities

| Tool | Capability |
|------|------------|
| 📄 File Operations | Read, create, edit files with precise code modifications |
| 💻 Terminal Commands | Execute Bash / PowerShell commands, install dependencies, run tests |
| 🔍 Code Search | Global code search, file name lookup, regex matching |
| 📊 Git Operations | View status, diff, log; create branches, commit changes |
| 🌐 Web Search | Search technical docs and solutions via DuckDuckGo |
| 🕷️ Web Scraping | Fetch and analyze web page content |

### 🎯 Four Work Modes

| Mode | Icon | Description | Best For |
|------|------|-------------|----------|
| **Auto** | 🔄 | AI decides when to use tools | Daily coding, quick Q&A |
| **Polling** | ⏩ | Auto-continues until task is complete | Complex tasks, batch refactoring |
| **Plan** | 📋 | Read-only analysis first, then execute | Large projects, architecture design |
| **Duel** | ⚔️ | CrazyCoder vs Multi-dimension Reviewer | Code review, security audits |

### 🧭 Task Recovery
- **Reasoning loop detection** — Detects repeated thinking loops and stalled model calls
- **Fresh model recovery** — Starts a new model call in the same conversation to produce a handoff or final answer
- **Interrupted-task summary** — When the round budget is reached, MiMo reports completed work, changed files, validation status, and the next recovery step

### 🔒 Safe Execution (Sandbox)
- **Safe Mode** — Lightweight local protection: command checks, workspace boundary checks, timeouts
- **Docker Mode** — Container-level isolation for stronger security
- **Git Snapshots** — Automatic backup before risky commands, rollback anytime
- **Command Audit** — Full logging of all executed commands

### 🌍 Multi-language Support
- Switch between Chinese / English with one click
- Settings page auto-follows VS Code language setting

### 📝 History Management
- Auto-save all conversation history
- Full-text search (titles + message content)
- One-click export to Markdown or JSON

---

## 🚀 Quick Start

### Step 1: Install

Search for **MiMo** in the VS Code extension marketplace and install:

[![Install](https://img.shields.io/badge/Install-MiMo-blueviolet?style=for-the-badge&logo=visual-studio-code)](vscode:extension/mimo-agent.mimo-agent)

### Step 2: Configure API Key

1. Press `Ctrl+Shift+P`, type `MiMo: Settings`
2. Enter your API key in the **API Key** field
3. Adjust model, temperature, and other parameters as needed
4. Click **Save and Apply**

> MiMo supports all OpenAI-compatible APIs, including Xiaomi MiMo API, OpenAI, DeepSeek, and more.

### Step 3: Start Chatting

Press `Ctrl+Shift+P` and type `MiMo: New Chat Window`, or use `MiMo: Open Chat` to open the chat view.

---

## 💡 Usage Examples

| Scenario | You | MiMo |
|----------|-----|------|
| Analyze Project | Help me analyze this project code structure | Scans directories -> Reads key files -> Provides architecture overview |
| Refactoring | Refactor this function to be more concise | Reads code -> Understands logic -> Modifies files directly |
| Bug Fixing | Tests are failing, help me look into it | Runs tests -> Analyzes errors -> Provides fix -> Verifies |
| Image Understanding | [Paste an error screenshot] | Recognizes content -> Analyzes error -> Provides solution |
| Code Review | Review code quality in src/api.ts | CrazyCoder + Multi-reviewer -> Generates review report |

---

## ⚙️ Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `api.api_key` | API Key | — |
| `api.base_url` | API endpoint URL | `https://token-plan-cn.xiaomimimo.com/v1` |
| `api.model` | Default model | `mimo-v2.5-pro` |
| `agent.max_tokens` | Max output tokens | `8192` |
| `agent.max_rounds` / `mimo.maxRounds` | Max tool-calling rounds; `0` means unlimited | `0` |
| `agent.temperature` | Temperature (higher = more random) | `0.7` |
| `agent.enable_thinking` / `mimo.enableThinking` | Enable MiMo thinking mode | `false` |
| `sandbox.mode` | Sandbox mode (`safe` / `docker`) | `safe` |

Configuration priority: `~/.mimo/settings.json` > environment variables > VS Code settings > defaults.

More settings available in the extension Settings UI.

---

## 🔧 Command Palette

| Command | Description |
|---------|-------------|
| `MiMo: Open Chat` | Open the chat view |
| `MiMo: New Chat Window` | Create a new chat window |
| `MiMo: Settings` | Open settings UI |
| `MiMo: Clear Conversation` | Clear the current conversation |
| `MiMo: Explain Code` | Explain the selected code |
| `MiMo: Review Code` | Review the selected code |
| `MiMo: Refactor Code` | Refactor the selected code |

Model and work mode are switched inside the chat UI.

---

## 📋 Requirements

- **VS Code** 1.85.0 or higher
- **API Key** — OpenAI-compatible API (Xiaomi MiMo, OpenAI, DeepSeek, etc.)
- **Docker** (optional) — Required for Docker sandbox mode

---

## 🐛 Issues & Feedback

1. Open a [GitHub Issue](https://github.com/YSP0Github/MIMO-Agent/issues)
2. Join the community discussion

---

## 📜 License

MIT License

---

## 🙏 Acknowledgments

- [Xiaomi MiMo](https://github.com/XiaoMi/MiMo) — Powerful large language model
- [VS Code](https://code.visualstudio.com/) — Amazing code editor

---

<p align="center">
  <a href="https://github.com/YSP0Github/MIMO-Agent">
    <img src="https://img.shields.io/badge/GitHub-Recommended%20Repo-181717?style=for-the-badge&logo=github" alt="GitHub repository">
  </a>
  <a href="https://github.com/YSP0Github/MIMO-Agent/stargazers">
    <img src="https://img.shields.io/badge/Star-Support%20the%20Project-yellow?style=for-the-badge&logo=github" alt="Star MiMo on GitHub">
  </a>
</p>

<p align="center">
  <strong>If you find this useful, please give us a Star!</strong>
</p>

---

# 📋 Changelog

<p align="center">
  <a href="#">🇨🇳 中文</a> | <a href="#-english">🇬🇧 English</a> | <strong>📋 Changelog</strong>
</p>

### v1.5.4
- ✨ 新增回合叙述系统：每轮开始时展示任务复杂度、轮次预算、停滞状态与模式提示 / Added round narration system showing task complexity, budget, stall status, and mode hints
- ✨ 增强工具动作描述：可读标签如“读取 src/agent.ts”、“搜索 pattern” / Enhanced tool action descriptions with human-readable labels
- ✨ 新增结构化进度跟踪：完成数、错误数、无进展数、进展工具数、只读成功数 / Added structured progress tracking per round
- ✨ 引入模块化 webview 消息组件（ChatBubble、CodeBlock、DiffView、StreamingRenderer、ThinkingBlock、ToolCard）/ Introduced modular webview message components
- ⚡ 改进 Agent 停滞检测：只读成功按工具调用计数而非布尔值 / Improved stall detection: read-only success counts individual tool calls
- 🔧 重构 webview 消息模块为独立组件文件 / Refactored webview messages into separate component files
- 🎨 增强聊天 UI 样式（思考块、工具卡片、diff 视图）/ Enhanced chat UI styles

### v1.5.2
- 🔧 修复发布包缺少运行时依赖导致 `command 'mimo-agent.chat' not found` 的问题 / Fixed missing runtime dependencies in published VSIX
- ⚡ 推理模式切换不再在聊天区显示多余的确认消息 / Reasoning mode switch no longer shows redundant confirmation

### v1.5.0
- ✨ 新增自动补全门控，复杂任务必须有工作区证据或验证状态才能结束 / Added auto completion gate for complex tasks
- 📊 新增轻量级 agent trace 日志（`~/.mimo/traces/*.jsonl`）/ Added agent trace logging
- 🔧 新增 provider profile 存储，支持多 API 配置切换 / Added provider profile storage
- ⚙️ 设置界面支持 active provider profile 和快速预设（MiMo、DeepSeek、OpenAI）/ Settings UI supports provider profiles with quick presets
- 🔒 强化系统提示补全契约：编辑后验证、报告验证状态 / Strengthened system prompt completion contract

### v1.4.9
- ✨ 新增依赖安装策略（项目依赖自动安装、系统软件需确认）/ Added dependency install policy
- ⚙️ 设置界面新增依赖安装控制项 / Added dependency install controls to settings UI
- 🔧 安装超时状态清晰报告 / Clear timeout reporting for installs
- 🌍 启动时刷新 webview 默认语言，中文界面即时生效 / Refreshed default webview language on startup

### v1.4.8
- 🔧 强化连接恢复、移除预工具轮次超时、过滤泄露的 tool-call 标签 / Hardened connection recovery
- ⚡ 收紧 Auto 路由、上下文压缩和重试节奏，减少卡顿与假死感 / Tightened Auto routing and context compression
- 🌍 修复中文模式下输入框、模式切换与历史按钮文案跟随问题 / Fixed Chinese mode UI text issues
- 📝 重写历史记录展示路径，直接渲染最终 transcript / Rewrote history replay to render final transcript directly
- 🧵 精简 Processed 折叠头，仅保留处理时间与 token 使用量 / Simplified Processed header
- 🧠 为长任务新增滚动上下文自动压缩记忆 / Added rolling context compression for long tasks
- 🧭 修复 Infinite 模式误用 Auto 短流程提示的问题 / Fixed Infinite mode misusing Auto prompt
- 🔍 为 Infinite 增加复杂任务完成门，缺少探索或验证证据时继续推进 / Added completion gate for Infinite mode

### v1.4.7
- 🌍 修复中文模式下模型切换提示未跟随语言的问题 / Fixed model switch prompt not following language

### v1.4.6
- 🌍 修复中文模式下模型切换提示仍显示英文的问题 / Fixed model switch prompt showing English in Chinese mode

### v1.4.5
- 🔧 修复历史记录回放时思考状态无法收口、一直转圈的问题 / Fixed thinking state stuck spinning during history replay
- ⚡ 优化历史消息回放的 done 事件补齐逻辑 / Improved done event补全 for history replay

### v1.4.4
- 🌍 补全模式国际化文案，新增 Infinite 模式中文显示 / Completed mode i18n, added Infinite mode Chinese text
- 🔗 统一语言切换按钮文本 / Unified language switch button text

### v1.4.3
- 🔧 移除冗余 activationEvents / Removed redundant activationEvents
- ⚡ 优化扩展激活性能 / Optimized extension activation performance

### v1.4.2
- 🔧 修复推理循环恢复机制 / Fixed reasoning loop recovery mechanism
- 🛡️ 新增三级循环恢复 / Added three-tier loop recovery
- 🌍 修复设置页面多语言 / Fixed settings page multi-language support

### v1.4.1
- 🔧 修复图标不显示问题 / Fixed icon not displaying issue
- 🔗 更新仓库链接 / Updated repository links

### v1.4.0
- ✨ 设置界面支持多语言 / Settings page supports multi-language
- 🔄 推理循环检测优化 / Optimized reasoning loop detection
- 🛡️ 新增三级循环恢复机制 / Added three-tier loop recovery
- 🧭 达到轮次上限时输出恢复交接总结 / Added recovery handoff summary when max rounds are reached

### v1.3.0
- ⚔️ 新增对决模式 / Added Duel Mode (CrazyCoder + Multi-dimension Review)
- 🖼️ 新增图片粘贴支持 / Added image paste support (Ctrl+V)
- 📁 优化历史记录管理 / Improved history management

### v1.2.0
- 🔒 新增沙箱安全执行 / Added sandbox execution (Safe Mode + Docker Mode)
- 📋 新增规划模式 / Added Plan Mode (analyze first, then execute)
- ⚡ 工具调用并行执行优化 / Parallel tool execution optimization

### v1.1.0
- 🌍 新增多语言支持 / Added multi-language support (Chinese / English)
- 🎤 新增语音输入 / Added voice input
- 💬 优化对话体验 / Improved conversation experience

### v1.0.0
- 🎉 首次发布 / Initial release
