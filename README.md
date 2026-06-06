<p align="center">
  <img src="assets/mimo-agent-icon.png" alt="MiMo Logo" width="128" height="128">
</p>

<h1 align="center">MiMo</h1>

<p align="center">
  <strong>小米 MiMo 大模型驱动的智能 AI 编程助手</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=mimo-agent.mimo">
    <img src="https://img.shields.io/visual-studio-marketplace/v/mimo-agent.mimo.svg?label=VS%20Code%20Marketplace" alt="VS Code Marketplace">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mimo-agent.mimo">
    <img src="https://img.shields.io/visual-studio-marketplace/i/mimo-agent.mimo.svg" alt="Installs">
  </a>
  <a href="https://github.com/anthropics/claude-code/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
</p>

<p align="center">
  <strong>🇨🇳 中文</strong> | <a href="#-english">🇬🇧 English</a> | <a href="#-changelog">📋 Changelog</a>
</p>

---

## ✨ 功能亮点

### 🤖 智能对话
- **多轮对话** — 支持连续对话，AI 记住上下文，越聊越懂你
- **图片理解** — 直接粘贴图片（Ctrl+V），AI 分析代码截图、错误信息、UI 设计稿
- **语音输入** — 点击麦克风按钮，用语音描述你的需求

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

[![Install](https://img.shields.io/badge/Install-MiMo-blueviolet?style=for-the-badge&logo=visual-studio-code)](vscode:extension/mimo-agent.mimo)

### 第二步：配置 API Key

1. 按 `Ctrl+Shift+P`，输入 `MiMo: Open Settings`
2. 在 **API Key** 栏输入你的密钥
3. 根据需要调整模型、温度等参数
4. 点击 **Save and Apply**

> MiMo 支持所有 OpenAI 兼容的 API 接口，包括小米 MiMo 官方 API、OpenAI、DeepSeek 等。

### 第三步：开始对话

按 `Ctrl+Shift+P` 输入 `MiMo: New Chat`，或在侧边栏点击 **MiMo** 图标后点击 **+** 按钮。

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
| `api.base_url` | API 端点地址 | `https://api.openai.com/v1` |
| `api.model` | 默认模型 | `mimo-v2.5-pro` |
| `agent.max_tokens` | 最大 Token 数 | `8192` |
| `agent.temperature` | 温度（越高越随机） | `0.7` |
| `sandbox.mode` | 沙箱模式 (`safe` / `docker`) | `safe` |

更多配置请查看扩展设置界面。

---

## 🔧 命令面板

| 命令 | 说明 |
|------|------|
| `MiMo: New Chat` | 新建对话 |
| `MiMo: Open Settings` | 打开设置界面 |
| `MiMo: Switch Model` | 切换当前使用的模型 |
| `MiMo: Switch Mode` | 切换工作模式 |

---

## 📋 系统要求

- **VS Code** 1.85.0 或更高版本
- **API Key** — 支持 OpenAI 兼容接口（小米 MiMo API、OpenAI、DeepSeek 等）
- **Docker**（可选）— 如需使用 Docker 沙箱模式

---

## 🐛 问题反馈

1. 在 [GitHub Issues](https://github.com/your-repo/mimo-agent-vscode/issues) 提交反馈
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
  <a href="https://marketplace.visualstudio.com/items?itemName=mimo-agent.mimo">
    <img src="https://img.shields.io/visual-studio-marketplace/v/mimo-agent.mimo.svg?label=VS%20Code%20Marketplace" alt="VS Code Marketplace">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mimo-agent.mimo">
    <img src="https://img.shields.io/visual-studio-marketplace/i/mimo-agent.mimo.svg" alt="Installs">
  </a>
  <a href="https://github.com/anthropics/claude-code/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
</p>

---

## ✨ Highlights

### 🤖 Smart Conversation
- **Multi-turn dialogue** — AI remembers context across messages
- **Image understanding** — Paste images directly (Ctrl+V) to analyze code screenshots
- **Voice input** — Click the mic button to describe your needs by voice

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

[![Install](https://img.shields.io/badge/Install-MiMo-blueviolet?style=for-the-badge&logo=visual-studio-code)](vscode:extension/mimo-agent.mimo)

### Step 2: Configure API Key

1. Press `Ctrl+Shift+P`, type `MiMo: Open Settings`
2. Enter your API key in the **API Key** field
3. Adjust model, temperature, and other parameters as needed
4. Click **Save and Apply**

> MiMo supports all OpenAI-compatible APIs, including Xiaomi MiMo API, OpenAI, DeepSeek, and more.

### Step 3: Start Chatting

Press `Ctrl+Shift+P` and type `MiMo: New Chat`, or click the **MiMo** icon in the sidebar and hit **+**.

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
| `api.base_url` | API endpoint URL | `https://api.openai.com/v1` |
| `api.model` | Default model | `mimo-v2.5-pro` |
| `agent.max_tokens` | Max output tokens | `8192` |
| `agent.temperature` | Temperature (higher = more random) | `0.7` |
| `sandbox.mode` | Sandbox mode (`safe` / `docker`) | `safe` |

More settings available in the extension Settings UI.

---

## 🔧 Command Palette

| Command | Description |
|---------|-------------|
| `MiMo: New Chat` | Create a new conversation |
| `MiMo: Open Settings` | Open settings UI |
| `MiMo: Switch Model` | Switch the active model |
| `MiMo: Switch Mode` | Switch work mode |

---

## 📋 Requirements

- **VS Code** 1.85.0 or higher
- **API Key** — OpenAI-compatible API (Xiaomi MiMo, OpenAI, DeepSeek, etc.)
- **Docker** (optional) — Required for Docker sandbox mode

---

## 🐛 Issues & Feedback

1. Open a [GitHub Issue](https://github.com/your-repo/mimo-agent-vscode/issues)
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
  <strong>If you find this useful, please give us a Star!</strong>
</p>

---

# 📋 Changelog

<p align="center">
  <a href="#">🇨🇳 中文</a> | <a href="#-english">🇬🇧 English</a> | <strong>📋 Changelog</strong>
</p>

### v1.4.0
- ✨ 设置界面支持多语言 / Settings page supports multi-language
- 🔄 推理循环检测优化 / Optimized reasoning loop detection
- 🛡️ 新增三级循环恢复机制 / Added three-tier loop recovery

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
