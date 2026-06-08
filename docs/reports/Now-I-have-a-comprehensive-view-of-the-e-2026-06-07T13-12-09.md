Now I have a comprehensive view of the entire plugin. Let me provide the full assessment.

---

## 📋 MiMo Agent VS Code 插件 — 完整代码评估报告

### 一、项目概览

| 项目属性 | 值 |
|---------|---|
| **名称** | `mimo-agent` (显示名: MiMo) |
| **版本** | v1.5.2 |
| **发布者** | mimo-agent |
| **许可证** | MIT |
| **仓库** | [YSP0Github/MIMO-Agent](https://github.com/YSP0Github/MIMO-Agent) |
| **VS Code 最低版本** | 1.85.0 |
| **主入口** | `./out/extension.js` |
| **默认模型** | `mimo-v2.5-pro` |
| **默认 API 端点** | `https://token-plan-cn.xiaomimimo.com/v1` |

### 二、文件结构（29 个源文件，~620KB）

```
src/
├── agent.ts          (183KB) — 核心 Agent 引擎，~3800+ 行
├── agentTypes.ts     (3.3KB) — 类型定义
├── agentErrors.ts    (2.1KB) — 友好错误消息
├── api.ts            (15.6KB) — OpenAI 兼容 API 客户端
├── browser.ts        (4.4KB) — Puppeteer 无头浏览器自动化
├── config.ts         (14.5KB) — 配置加载与持久化
├── context.ts        (19.7KB) — 上下文压缩与管理
├── dependencyInstall.ts (4.7KB) — 依赖安装策略
├── desktop.ts        (22.1KB) — 桌面端集成
├── extension.ts      (4.4KB) — VS Code 扩展激活入口
├── handoff.ts        (1.4KB) — 中断交接摘要
├── history.ts        (16.9KB) — 对话历史持久化
├── hooks.ts          (6.8KB) — 钩子系统
├── markdown.ts       (9.3KB) — Markdown 处理
├── mcp.ts            (13.7KB) — MCP 服务器管理
├── memory.ts         (11.0KB) — 长期记忆管理
├── modelCapabilities.ts (2.9KB) — 模型能力推断
├── personas.ts       (24.3KB) — 人格系统（程序员/PM/审查者等）
├── prompt.ts         (17.3KB) — 系统提示词构建
├── router.ts         (10.5KB) — 意图路由与分类
├── safety.ts         (15.7KB) — 安全检查与沙箱策略
├── sandbox.ts        (12.2KB) — 安全/Docker 沙箱
├── skills.ts         (4.4KB) — 技能系统
├── subagent.ts       (10.1KB) — 子代理系统
├── tokenTracker.ts   (7.1KB) — Token 用量追踪
├── tools.ts          (71.4KB) — 工具定义与执行引擎
├── workflow.ts       (15.3KB) — 多阶段工作流引擎
├── utils/
│   └── fileLock.ts   (4.0KB) — 文件锁
└── webview/
    ├── chatProvider.ts   (93.8KB) — 聊天 Webview Provider
    ├── main.ts           (18.9KB) — Webview 入口
    ├── settingsProvider.ts (32.0KB) — 设置界面 Provider
    ├── styles.css        (56.8KB) — 样式表
    ├── components/
    │   ├── commandPalette.ts (4.1KB)
    │   ├── header.ts        (4.0KB)
    │   ├── imageUpload.ts   (5.9KB)
    │   ├── input.ts         (13.4KB)
    │   ├── messages.ts      (118.8KB) ← 最大前端文件
    │   ├── panels.ts        (13.1KB)
    │   └── taskChecklist.ts (3.1KB)
    ├── core/
    │   ├── bus.ts     (1.1KB)
    │   ├── i18n.ts    (17.8KB)
    │   ├── store.ts   (3.3KB)
    │   └── vscode.ts  (3.7KB)
    └── utils/
```

### 三、核心架构分析

#### 1. Agent 引擎 (`agent.ts` — 183KB)

这是整个插件最核心的文件，包含 `MiMoAgent` 类，关键机制：

| 机制 | 实现细节 |
|------|---------|
| **3 阶段循环检测** | ① 固定模式重复 ② N-gram 提取（≥20 字符） ③ 原始文本回退（≥600 字符） |
| **推理流实时检测** | 每 200+ 字符触发一次，最小 300 字符阈值，检测到即中止 |
| **自动模式续行** | 基于任务复杂度、轮次限制、近期工具活动（探索/变异/验证，40-60 条消息窗口） |
| **轮次预算** | 复杂度感知 → 建议/软/硬上限 + 单轮超时（`ROUND_TIMEOUT_MS`） |
| **无限模式** | `maxRounds=0`，`hardMultiplier` 和 `stallLimit` 守护 |
| **上下文溢出处理** | 记忆压缩 → `manageContext()` 回退（maxMessages:18, maxToolResultChars:600） → 重试 |
| **预算耗尽** | `finalizeWithFreshModel()` — Handoff 模式，取最后 8 条消息，生成 SUMMARY/RECOVERY 格式 |
| **输入预处理** | LLM 驱动的拼写/歧义修正，<5 字符或斜杠命令跳过 |
| **并发保护** | `activeChats` Map 防止同一会话并发发送 |

#### 2. 工具系统 (`tools.ts` — 71.4KB)

| 工具 | 能力 |
|------|------|
| `read_file` | 读取文件，支持 offset/limit |
| `write_file` | 创建/覆盖文件 |
| `edit_file` | 精确文本替换 |
| `execute_command` | Shell 命令执行（带安全检查） |
| `search_files` | 正则搜索 |
| `glob_files` | Glob 文件查找 |
| `list_directory` | 目录列表 |
| `git_*` | Git 操作（status/diff/log/commit） |
| `web_search` | DuckDuckGo 搜索 |
| `fetch_url` | 网页抓取（curl 回退，`-s -L -k`） |
| `get_file_info` | 文件元信息 |
| `browser_*` | Puppeteer 浏览器自动化 |
| `spawn_subagent` | 子代理生成 |
| `run_workflow` | 多阶段工作流执行 |

#### 3. 安全层 (`safety.ts` + `sandbox.ts`)

- **Safe Mode**: 命令黑名单检查、工作区边界、超时、输出限制
- **Docker Mode**: 容器隔离
- **Git 快照**: 风险命令前自动备份
- **命令审计**: 完整日志记录
- **`confirmEdit`**: 文件修改前预览确认（⚠️ 实际写入发生在确认时）

#### 4. 对决模式 (`agent.ts` 内)

- **Phase 1**: 程序员执行编码
- **Phase 2**: 多维并行审查（config 共享，code snippet 上限 8K，context 上限 4K）
- **Phase 3**: PM 裁判判定
- **收敛**: 问题按 severity+file+description 去重排序
- **自动降级**: 不适合的任务自动退回 Auto 模式

#### 5. 子代理 & 工作流 (`subagent.ts` + `workflow.ts`)

- **子代理类型**: `explore`（只读）和 `general`（全工具，禁止递归生成子代理）
- **工作流**: 支持 `parallel` / `sequential` / 多阶段流水线
- **推理力度配置**: `turbo` → `fast` → `balanced` → `deep` → `max`，影响 token/轮次倍数和温度

#### 6. 配置系统 (`config.ts`)

**优先级链**: `~/.mimo/settings.json` > 环境变量 > VS Code 设置 > 默认值

**API Key 3 源回退**: `MIMO_TP_API_KEY` → `MIMO_API_KEY` → `OPENAI_API_KEY`

**Provider Profiles**: 支持多 provider 配置切换，最多 50 个

#### 7. 意图路由 (`router.ts`)

- **快速启发式**: 中英文正则模式匹配（greeting/question/debug/refactor 等）
- **模型分类**: LLM 驱动的精确分类回退
- **11 种意图类别**: greeting, question, code_task, explanation, refactor, debug, search, review, config, creative, multi_step

#### 8. Webview 前端

- **chatProvider.ts** (93.8KB): 聊天视图 Provider
- **messages.ts** (118.8KB): 消息渲染，最大的前端文件
- **i18n.ts** (17.8KB): 国际化支持
- **styles.css** (56.8KB): 完整样式

### 四、值得关注的设计亮点

1. **健壮的循环检测**: 3 阶段 + 实时推理流检测，防止 AI 陷入死循环
2. **优雅的中断恢复**: Handoff 模式确保预算耗尽时不会丢失已完成的工作
3. **多层安全防护**: 沙箱 + 命令审计 + Git 快照 + 文件修改预览
4. **对决模式**: 程序员 vs 审查团的对抗式代码审查，多维度并行
5. **子代理隔离**: 消息历史独立，不污染主对话
6. **OpenAI 兼容**: 可对接任意 OpenAI 兼容 API（小米 MiMo、OpenAI、DeepSeek 等）

### 五、潜在改进方向

| 领域 | 发现 | 建议 |
|------|------|------|
| **文件体积** | `agent.ts` (183KB)、`messages.ts` (118.8KB) 过大 | 考虑拆分为更小的模块 |
| **Stub API** | `ttsGenerate()` / `audioEdit()` 返回 null | 明确标记 TODO 或移除 |
| **curl 回退** | `fetch_url` 使用 `-k` 跳过证书验证 | 考虑提供选项控制，或仅对明确标记的 URL 跳过 |
| **输入截断** | `MAX_INPUT_LENGTH = 100,000` 静默截断 | 建议给用户提示 |
| **模型能力推断** | 基于 URL 和模型名字符串匹配 | 随模型增多可能需更灵活的配置方式 |
| **测试覆盖** | `src/test/` 目录存在 | 建议确认覆盖率是否达标（项目指令要求 ≥80%） |
| **browser.ts** | 使用 `require('puppeteer-core')` 动态加载 | 确保 graceful degradation |

### 六、总结

这是一个功能非常完整的 AI 编程助手插件，架构设计成熟度较高。核心亮点包括 3 阶段循环检测、对决模式的多维审查、子代理隔离、多阶段工作流引擎，以及完善的中断恢复机制。代码量约 620KB（29 个源文件），以 `agent.ts` 为绝对核心（183KB，占 30%）。整体代码风格一致，中文注释清晰，配置体系分层合理。

---

*以上为纯读取评估，未修改任何文件。*
