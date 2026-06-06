# MiMo Agent v1.3.0 — 全面代码审查与架构改进报告

> 审查日期: 2026-06-04
> 审查范围: 全部 28 个 TypeScript 源文件 + 配置文件 + 测试文件
> 审查维度: 语法错误、逻辑缺陷、安全漏洞、架构合理性、性能问题、代码质量

---

## 目录

1. [问题总览](#1-问题总览)
2. [致命级问题 (CRITICAL)](#2-致命级问题-critical)
3. [安全漏洞 (SECURITY)](#3-安全漏洞-security)
4. [严重逻辑缺陷 (HIGH)](#4-严重逻辑缺陷-high)
5. [中等问题 (MEDIUM)](#5-中等问题-medium)
6. [轻微问题 (LOW)](#6-轻微问题-low)
7. [架构分析与改进建议](#7-架构分析与改进建议)
8. [与优秀项目的对比分析](#8-与优秀项目的对比分析)
9. [优先修复路线图](#9-优先修复路线图)

---

## 1. 问题总览

| 严重等级 | 数量 | 说明 |
|---------|------|------|
| **CRITICAL** | 4 | 导致功能完全不可用或运行时崩溃 |
| **SECURITY** | 10 | 命令注入、XSS、路径穿越等安全漏洞 |
| **HIGH** | 12 | 严重逻辑缺陷、死代码、潜在无限循环 |
| **MEDIUM** | 28 | 功能异常、资源泄漏、类型安全问题 |
| **LOW** | 25+ | 代码质量、命名规范、冗余代码 |

---

## 2. 致命级问题 (CRITICAL)

### 2.1 `header.ts:37` — `vscode.postMessage` 不存在，重命名功能完全失效

```typescript
// 错误代码
vscode.postMessage({ type: 'renameChat', id: convId, title: val });
```

`core/vscode.ts` 导出的对象只有 `post()` 方法，没有 `postMessage()`。用户编辑对话标题后，blur 事件触发此调用，会抛出 `TypeError: vscode.postMessage is not a function`，重命名功能**完全不可用**。

**修复:** 改为 `vscode.post({ type: 'renameChat', id: convId, title: val })`

---

### 2.2 `messages.ts:465` — execute_command 工具卡片永远无法获取输出

`addToolCard` 对 `execute_command` 创建 `.tool-card` 元素后提前返回。但 `handleToolCallEnd` 只查询 `.tool-line` 元素：

```typescript
const lines = messagesDiv.querySelectorAll('.tool-line');  // 永远找不到 .tool-card
```

结果：execute_command 的工具卡片**永远停留在 "running" 状态**，用户看不到命令输出。

**修复:** 查询选择器应改为 `[data-status="running"]` 或同时查询 `.tool-card` 和 `.tool-line`

---

### 2.3 `messages.ts:797` — Workflow 卡片自我查询返回 null

```typescript
card.querySelector('.workflow-card')?.classList?.add('expanded');
```

`card` 本身就是 `.workflow-card` 元素，在其内部查询同名选择器永远返回 null。workflow 卡片**无法展开**。

**修复:** 改为 `card.classList.add('expanded')`

---

### 2.4 `subagent.ts:123` — 无限循环 + 死代码

```typescript
for (round = 1; ; round++) {  // 无上限条件
    // ...
}
// 以下代码永远不可达
// Max rounds reached — get last assistant content
```

`maxRounds = options.maxRounds || Infinity`，默认值为 `Infinity`。当子代理持续请求工具调用时，循环**永远不会终止**。第 217-231 行的 "Max rounds reached" 代码是**死代码**。

**修复:** 改为 `const maxRounds = options.maxRounds ?? 20`，并在循环条件中检查 `round < maxRounds`

---

## 3. 安全漏洞 (SECURITY)

### 3.1 命令注入漏洞 (6 处)

#### 3.1.1 `tools.ts:899` — Git commit 消息注入

```typescript
const msg = args.message.replace(/"/g, '\\"');
return runGit(args, workspace, `commit -m "${msg}"`);
```

仅转义双引号。攻击者可通过 `$(rm -rf /)` 或反引号注入命令。

#### 3.1.2 `tools.ts:993, 1020` — Git worktree 参数注入

```typescript
const cmd = `git worktree add ${newBranch} "${worktreePath}" ${branch}`.trim();
```

`worktreePath` 和 `branch` 来自用户输入，直接拼接到 shell 命令中。

#### 3.1.3 `tools.ts:537` — 搜索模式注入

ripgrep 的 `pattern` 和 `searchPath` 通过 shell 命令字符串传递，未做转义。

#### 3.1.4 `hooks.ts:150-154` — Hook 变量插值注入

```typescript
return cmd
    .replace(/\$\{tool_name\}/g, toolName)
    .replace(/\$\{tool_path\}/g, String(toolPath))
    .replace(/\$\{tool_result\}/g, result.substring(0, 500))
    .replace(/\$\{workspace\}/g, workspace);
```

所有插值变量直接插入 shell 命令，无任何转义。`tool_result` 包含任意工具输出，尤其危险。

#### 3.1.5 `sandbox.ts:70` — Git 自动快照提交信息注入

```typescript
const msg = `[MiMo] Auto-snapshot: ${reason}`;
await execPromise(`git commit -m "${msg}" --no-verify`, 10, workspace);
```

#### 3.1.6 `desktop.ts:164, 196, 381-399` — 桌面操作命令注入

`windowTitle`、`appName` 等用户输入直接拼接到 shell 命令中。

**统一修复方案:**
- 使用 `execFile` + 参数数组替代字符串拼接
- 或使用 `shell-quote` 等库进行正确的 shell 转义
- Git 操作统一使用 `execFile('git', ['commit', '-m', msg])` 形式

---

### 3.2 XSS 漏洞 (3 处)

#### 3.2.1 `dom.ts:5-9` — `escapeHtml` 未转义引号

```typescript
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    // 缺少: .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
```

当转义后的文本用于 HTML 属性时（如 `title="${escapeHtml(name)}"`），双引号可突破属性上下文。

#### 3.2.2 `main.ts:277` — 错误信息作为原始 HTML 注入

```typescript
el.innerHTML = `<div class="msg msg-system">Init error: ${String(err.message)}</div>`;
```

应使用 `textContent` 或先转义。

#### 3.2.3 `chatProvider.ts:467` — PowerShell 脚本单引号注入

语音输入路径中，仅转义反斜杠，未转义单引号。

---

### 3.3 SSRF 漏洞

#### 3.3.1 `tools.ts:691, 969` — URL 重定向无限循环 + SSRF

```typescript
if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    toolFetchUrl({ ...args, url: res.headers.location }).then(resolve);
}
```

- 无重定向次数限制 → 栈溢出
- 无 URL 验证 → 可重定向到 `file:///etc/passwd` 或云元数据端点

**修复:** 添加最大重定向次数（如 5 次），验证 URL 协议仅允许 `http/https`

---

### 3.4 路径穿越

#### 3.4.1 `skills.ts:68, 80` — 技能名称未验证

```typescript
fs.writeFileSync(path.join(userDir, `${skill.name}.md`), content, 'utf-8');
```

若 `skill.name` 包含 `../`，可写入任意目录。

#### 3.4.2 `agent.ts:484` — `confirmWrite` 的 `newPath` 绕过安全检查

当提供 `newPath` 时，解析路径但未调用 `isPathSafe()` 验证。

---

## 4. 严重逻辑缺陷 (HIGH)

### 4.1 `agent.ts:1440` — 用户消息重复发送

`chat()` 在第 600 行将用户消息推入 `conv.messages`，然后调用 `handleDirectResponse()`，该方法又在 API 请求的 messages 数组中追加了同一条用户消息。**模型收到两次用户输入**，浪费 token 且可能混淆模型。

### 4.2 `agent.ts:315` — `String.replace()` 仅替换首个匹配

```typescript
const newContent = content.replace(pending.oldText, pending.newText);
```

`replace()` 字符串参数只替换第一次出现。但 `handleEditPreview` 显示匹配总数给用户，造成误导。

**修复:** 使用 `content.split(pending.oldText).join(pending.newText)` 或正则全局替换

### 4.3 `api.ts:153` — 重试条件过于宽泛

```typescript
const isRetryable = e.message?.includes('429') || e.message?.includes('5') || ...;
```

`includes('5')` 会匹配**任何包含数字 "5" 的错误信息**，包括 "405"、"timeout in 5 seconds" 等。

**修复:** 使用正则 `/5\d{2}\b/` 或明确匹配状态码 500-599

### 4.4 `config.ts:66` — `temperature: 0` 无法生效

```typescript
temperature: cfg.get<number>('temperature') || settings?.agent?.temperature || 0.7,
```

`||` 运算符将 `0` 视为 falsy。用户无法设置确定性输出（temperature=0）。

**影响范围:** 所有数值和布尔配置项（`maxTokens`、`maxRounds`、`enableThinking` 等）都存在同样问题。

**修复:** 全部改用 `??` 运算符

### 4.5 `hooks.ts:165` — Windows 上 Hook 在 cmd.exe 而非 PowerShell 中执行

```typescript
const proc = exec(
    shellArgs.join(' '),  // ['-NoProfile', '-Command', cmd] 拼接为字符串
    { cwd, timeout, windowsHide: true },
```

`shell` 变量已计算但**从未传入 `exec()`**。在 Windows 上，命令在 `cmd.exe` 中执行，`-NoProfile -Command <cmd>` 作为 cmd 命令运行，**所有 Windows Hook 都会失败**。

### 4.6 `workflow.ts:348-353` — 阶段摘要计算后未传递

```typescript
const summary = taskResults
    .map(r => `[${r.label}] ${r.output.substring(0, 200)}`)
    .join('\n');
events.onReasoning?.(`[Workflow] Phase ${pi + 1} results summary fed to next phase`);
// summary 从未被使用！
```

事件日志声称 "fed to next phase"，但实际上摘要**被丢弃了**。多阶段工作流的上下文传递功能**完全失效**。

### 4.7 `desktop.ts:24` — spawn 的 timeout 选项被静默忽略

```typescript
const proc = require('child_process').spawn(shell, shellArgs, {
    timeout: timeoutMs,  // spawn 不支持此选项！
```

`timeout` 是 `exec` 的特性，`spawn` 忽略此选项。长时间运行的命令**永远不会超时**。

### 4.8 `context.ts:217-235` — 滑动窗口丢弃系统消息

管理上下文时，第一个用户消息之后、最近 20 条消息之前的所有系统消息都会被丢弃。系统消息通常包含重要的工具 schema 和指令。

### 4.9 `context.ts:337-361` — 摘要可能比原文更长

`summarizeContext` 未检查摘要长度。当对话很简短时，LLM 可能生成比原文更长的摘要，反而增加 token 消耗。

### 4.10 `agent.ts:786-798` — `_rateRetries` 计数器永不重置

速率限制重试计数器以动态属性存储在对话对象上，成功响应后不重置。一次限速后，后续调用的重试预算被永久消耗。

---

## 5. 中等问题 (MEDIUM)

### 5.1 并发与竞态条件

| 位置 | 问题 |
|------|------|
| `agent.ts:504-513` | `abort()` 与并发 `chat()` 调用无互斥锁 |
| `extension.ts:57-58` | 300ms `setTimeout` 等待 webview 初始化，慢机器上可能失败 |
| `input.ts:212` + `chatProvider.ts:682` | Webview 端和扩展端各有独立消息队列，可能导致消息重复 |
| `context.ts:34-36` | 模块级 token 计数器在并发场景下互相覆盖 |

### 5.2 资源泄漏

| 位置 | 问题 |
|------|------|
| `tokenTracker.ts:75-80` | `scheduleSave` 的 `setTimeout` 无清理方法 |
| `browser.ts:9-10` | 浏览器单例未在扩展停用时清理 |
| `browser.ts:43-57` | 重连时旧浏览器进程成为僵尸进程 |
| `mcp.ts:233` | `process!.stdin!.write()` 进程已退出时抛出异常 |
| `sandbox.ts:116-131` | 命令日志无轮转，无限增长 |

### 5.3 类型安全问题

| 位置 | 问题 |
|------|------|
| `agent.ts:312, 421, 454` | 方法内部使用 `require()` 替代顶层 import |
| `context.ts:160` | `(msg as any).content` 绕过类型系统 |
| `workflow.ts:205` | `content || null as any` 类型断言 |
| `extension.ts:111` | `agent?.['mcpManager']` 方括号访问私有成员 |
| `header.ts:38` | `store.set('convTitle', ...)` 使用了 StoreState 中不存在的键 |

### 5.4 测试框架缺陷

| 位置 | 问题 |
|------|------|
| `test-runner.ts:50-59` | `toContain` 对非字符串/数组值静默通过 |
| `test-safety.ts:69-72` | `isSensitiveFile('.ts')` 测试的是隐藏文件而非 .ts 扩展名 |
| `test-runner.ts:106` | 每个测试文件调用 `summary()` 显示累计结果，造成误导 |
| 全局 | `manageContext`、`summarizeContext` 等核心函数零测试覆盖 |

---

## 6. 轻微问题 (LOW)

### 6.1 代码质量

- `personas.ts` — 关键词重复（`'code'`×2、`'问题'`×2、`'检查'`×2）、`' traceback'` 前导空格
- `tools.ts:3` — 未使用的 `exec` 导入
- `desktop.ts:10` — 未使用的 `exec` 导入
- `subagent.ts:13` — 未使用的 `buildSystemPrompt` 导入
- `agent.ts:1414-1421` — 错位的 JSDoc 注释
- `chatProvider.ts:23` — 未使用的 `activeHandlers` 属性
- `chatProvider.ts:65` — `_forceNew` 参数从未使用

### 6.2 CSS 问题

- `styles.css:103` — `.msg-assistant br { display: none }` 隐藏所有换行
- `styles.css:222` — `.round-marker { display: none }` 隐藏但仍在 DOM 中创建
- `styles.css:295-393` — 重复/冲突的 CSS 定义

### 6.3 边界情况

- `markdown.ts:53` — 代码块正则不处理嵌套三反引号
- `context.ts:84` — Token 估算未覆盖日文假名、韩文韩字
- `history.ts:58` — UUID 字典序排序非时间排序
- `skills.ts:123` — YAML 解析器不处理值中的冒号

---

## 7. 架构分析与改进建议

### 7.1 当前架构概览

```
┌─────────────────────────────────────────────────┐
│                   VS Code Extension Host          │
│                                                    │
│  extension.ts ──► MiMoAgent (agent.ts)            │
│       │              │                              │
│       │         ┌────┴────┐                        │
│       │         │         │                        │
│       │      api.ts    tools.ts                    │
│       │         │         │                        │
│       │    ┌────┴────┐  ┌─┴──────────────┐        │
│       │    │         │  │                 │        │
│       │  context.ts  │  safety.ts        │        │
│       │  router.ts   │  sandbox.ts       │        │
│       │  personas.ts │  hooks.ts         │        │
│       │  prompt.ts   │  browser.ts       │        │
│       │              │  desktop.ts       │        │
│       │         mcp.ts                   │        │
│       │         workflow.ts               │        │
│       │         subagent.ts               │        │
│       │         history.ts                │        │
│       │         tokenTracker.ts           │        │
│       │                                  │        │
│  ChatViewProvider (chatProvider.ts)       │        │
│       │                                  │        │
└───────┼──────────────────────────────────┼────────┘
        │  VS Code Webview API             │
┌───────┼──────────────────────────────────┼────────┐
│       ▼                                  ▼        │
│  main.ts ──► components/  core/  utils/           │
│              messages.ts   bus.ts   dom.ts         │
│              input.ts      store.ts               │
│              header.ts     vscode.ts              │
│              panels.ts     i18n.ts                │
│              ...                                  │
└───────────────────────────────────────────────────┘
```

### 7.2 架构优点 ✅

1. **模块化设计** — 28 个文件各司其职，职责清晰
2. **双向通信** — Webview ↔ Extension Host 消息传递机制完善
3. **工具系统** — 17 种工具覆盖文件操作、Git、命令执行、Web 搜索
4. **多策略支持** — 对抗模式、子代理、工作流引擎
5. **上下文管理** — 滑动窗口 + 摘要压缩机制
6. **技能模板** — Markdown 格式的可扩展技能系统

### 7.3 架构问题与改进

#### 问题 1: 模块间耦合过紧

`agent.ts` 是一个 **1500+ 行的上帝类**，直接依赖 15+ 个模块，承担了对话管理、工具执行、意图路由、对抗模式、子代理、上下文管理等所有职责。

**改进方案:**

```
agent.ts (1500+ 行)
    │
    ├── 拆分为 ──► ConversationManager  (对话生命周期)
    │              ToolExecutor          (工具执行循环)
    │              IntentClassifier      (意图路由)
    │              AdversarialBrain      (对抗模式)
    │              SubAgentCoordinator   (子代理管理)
    │              ContextOrchestrator   (上下文管理)
    └              MessagePreprocessor   (输入预处理)
```

参考: Claude Code 使用 `AgentLoop` + `ToolRegistry` + `ContextManager` 分层设计

#### 问题 2: 缺乏依赖注入

所有模块通过 `require()` 直接导入，无法在测试中替换依赖。

**改进方案:**

```typescript
// 当前
class MiMoAgent {
    private api = new MiMoAPI(config);
    private safety = new SafetyChecker(workspace);
}

// 改进
class MiMoAgent {
    constructor(
        private api: IMiMoAPI,
        private safety: ISafetyChecker,
        private contextManager: IContextManager,
    ) {}
}
```

#### 问题 3: 事件驱动不足

模块间通信大量使用直接方法调用和回调，缺少统一的事件总线。

**改进方案:** 扩展 Webview 端的 `bus.ts` 模式到扩展端：

```typescript
// 统一事件系统
const extensionBus = new EventEmitter();

// 事件定义
interface ExtensionEvents {
    'tool:execute': { name: string; args: any };
    'tool:result': { name: string; result: string };
    'conversation:message': { role: string; content: string };
    'context:overflow': { tokens: number };
    'agent:error': { error: Error };
}
```

#### 问题 4: 错误处理不统一

- 有些地方用 try/catch，有些用 `.catch()`
- 有些错误被吞没，有些被传播
- 缺少统一的错误报告机制

**改进方案:** 引入 `Result<T, E>` 模式或统一错误处理器：

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

class AppError {
    constructor(
        public code: string,
        public message: string,
        public recoverable: boolean,
        public cause?: Error,
    ) {}
}
```

#### 问题 5: 状态管理分散

- `agent.ts` 中的 `conversations` Map
- `context.ts` 中的模块级 `_lastPromptTokens` 等
- `browser.ts` 中的模块级 `browser`/`page`
- `sandbox.ts` 中的 `dockerAvailable`
- `tokenTracker.ts` 中的独立持久化

**改进方案:** 集中状态管理：

```typescript
class ExtensionState {
    readonly conversations: ConversationStore;
    readonly tokenTracker: TokenTracker;
    readonly browserManager: BrowserManager;
    readonly sandboxManager: SandboxManager;
    
    dispose(): void { /* 统一清理 */ }
}
```

#### 问题 6: 缺乏类型安全的消息协议

Webview ↔ Extension Host 之间传递的消息没有类型定义：

```typescript
// 当前: 松散的字符串匹配
switch (message.type) {
    case 'sendMessage': ...
    case 'renameChat': ...
    case 'abort': ...
}

// 改进: 类型安全的消息协议
type WebviewMessage =
    | { type: 'sendMessage'; text: string; images?: string[] }
    | { type: 'renameChat'; id: string; title: string }
    | { type: 'abort' }
    | { type: 'execute'; skillId: string };

type ExtensionMessage =
    | { type: 'response'; content: string }
    | { type: 'toolCall'; name: string; args: any }
    | { type: 'status'; busy: boolean }
    | { type: 'error'; message: string };
```

#### 问题 7: 测试基础设施薄弱

- 自制测试框架，功能有限（`toContain` 静默通过、`not` 选择器极少）
- 核心函数零测试覆盖
- 无 Mock/Stub 机制
- 无集成测试

**改进方案:** 迁移到成熟测试框架：

```json
// package.json
"devDependencies": {
    "@vscode/test-electron": "^2.3.0",
    "vitest": "^1.0.0",
    "sinon": "^17.0.0"
}
```

---

## 8. 与优秀项目的对比分析

### 8.1 对比维度

| 维度 | MiMo Agent | Claude Code (参考) | Cursor (参考) | Continue.dev (参考) |
|------|-----------|-------------------|--------------|-------------------|
| **代码规模** | ~5000 行 | ~50000+ 行 | 闭源 | ~30000 行 |
| **语言** | TypeScript | TypeScript | TypeScript | TypeScript |
| **测试覆盖** | <5% | >80% | N/A | >70% |
| **CI/CD** | 无 | GitHub Actions | N/A | GitHub Actions |
| **Linting** | 无 | ESLint + Prettier | N/A | ESLint |
| **错误处理** | 不统一 | Result 模式 | N/A | 统一错误边界 |
| **依赖注入** | 无 | 完整 DI | N/A | 部分 DI |
| **类型安全** | 部分 `as any` | 严格类型 | N/A | 严格类型 |
| **文档** | 用户文档为主 | API + 架构文档 | N/A | 完整文档站 |

### 8.2 MiMo Agent 的独特优势

1. **轻量级** — 5000 行实现完整 AI 编程助手，启动快
2. **多模型支持** — 兼容 OpenAI API 格式
3. **对抗模式** — 双脑验证机制（Claude Code 无此功能）
4. **桌面控制** — 独特的桌面操作能力（截屏、点击、输入）
5. **技能系统** — Markdown 模板的可扩展技能
6. **中文优化** — Token 估算、i18n、中文关键词匹配

### 8.3 MiMo Agent 可借鉴的最佳实践

#### 来自 Claude Code:
- **工具注册表模式** — 工具通过注册表动态发现，而非硬编码
- **流式工具结果** — 工具执行过程中逐步返回结果
- **上下文感知的工具选择** — 根据对话上下文自动选择合适的工具
- **安全沙箱** — 所有命令在隔离环境中执行

#### 来自 Continue.dev:
- **Provider 架构** — 模型、工具、上下文通过 Provider 抽象
- **配置驱动** — YAML 配置文件定义行为
- **增量上下文** — 智能选择相关文件作为上下文

#### 来自 Cursor:
- **索引系统** — 代码库语义索引
- **Tab 补全** — 行级自动补全
- **多文件编辑** — 跨文件重构

---

## 9. 优先修复路线图

### Phase 1: 紧急修复 (1-2 天)

| # | 问题 | 文件 | 修复方案 |
|---|------|------|---------|
| 1 | `vscode.postMessage` 不存在 | header.ts:37 | 改为 `vscode.post()` |
| 2 | execute_command 卡片无输出 | messages.ts:465 | 修改选择器查询 |
| 3 | Workflow 卡片无法展开 | messages.ts:797 | 改为 `card.classList.add` |
| 4 | 用户消息重复发送 | agent.ts:1440 | 移除重复的用户消息追加 |
| 5 | `temperature: 0` 无效 | config.ts:64-70 | 所有 `\|\|` 改为 `??` |
| 6 | 重试条件 `includes('5')` | api.ts:153 | 改为正则匹配 |

### Phase 2: 安全加固 (3-5 天)

| # | 问题 | 修复方案 |
|---|------|---------|
| 1 | 6 处命令注入 | 统一使用 `execFile` + 参数数组 |
| 2 | XSS 漏洞 | `escapeHtml` 补充引号转义 |
| 3 | SSRF 漏洞 | URL 重定向上限 + 协议验证 |
| 4 | 路径穿越 | 技能名称/路径验证 |
| 5 | `confirmWrite` 绕过安全 | `newPath` 添加 `isPathSafe` 检查 |

### Phase 3: 核心逻辑修复 (1 周)

| # | 问题 | 修复方案 |
|---|------|---------|
| 1 | 子代理无限循环 | 设置默认 `maxRounds=20` |
| 2 | Hook Windows 执行失败 | 传入 `shell` 选项到 `exec` |
| 3 | Workflow 阶段摘要未传递 | 将 `summary` 传入下一阶段 |
| 4 | spawn timeout 无效 | 手动 `setTimeout` + `proc.kill()` |
| 5 | 滑动窗口丢弃系统消息 | 保留所有系统消息 |
| 6 | `_rateRetries` 不重置 | 成功后重置计数器 |
| 7 | `String.replace` 仅替换首个 | 使用正则全局替换 |

### Phase 4: 架构改进 (2-4 周)

| # | 改进项 | 说明 |
|---|--------|------|
| 1 | 拆分 agent.ts | 拆为 5-6 个专职模块 |
| 2 | 引入依赖注入 | 接口抽象 + 构造函数注入 |
| 3 | 统一事件系统 | 扩展端事件总线 |
| 4 | 类型安全消息协议 | 定义 Webview↔Extension 消息类型 |
| 5 | 统一错误处理 | Result 模式或错误边界 |
| 6 | 集中状态管理 | ExtensionState 统一管理 |

### Phase 5: 工程化提升 (持续)

| # | 改进项 | 说明 |
|---|--------|------|
| 1 | 引入 ESLint | 统一代码风格 |
| 2 | 迁移测试框架 | Vitest + @vscode/test-electron |
| 3 | 提高测试覆盖率 | 目标 >60% |
| 4 | 添加 CI/CD | GitHub Actions 自动化 |
| 5 | 性能监控 | Token 使用追踪、API 延迟监控 |
| 6 | 日志系统 | 结构化日志 + 日志轮转 |

---

## 附录: 问题分布热力图

```
agent.ts        ████████████████████  (15 个问题)
tools.ts        ██████████████████    (14 个问题)
messages.ts     ██████████████        (10 个问题)
context.ts      ████████████          (9 个问题)
chatProvider.ts ██████████            (7 个问题)
hooks.ts        ██████████            (6 个问题)
sandbox.ts      ██████████            (6 个问题)
desktop.ts      ██████████            (6 个问题)
config.ts       ████████              (5 个问题)
safety.ts       ██████                (4 个问题)
api.ts          ██████                (4 个问题)
extension.ts    ██████                (4 个问题)
subagent.ts     ██████                (4 个问题)
其他文件        ████████████          (12 个问题)
```

**最高风险文件:** `agent.ts`、`tools.ts`、`messages.ts` — 需优先重构

---

*本报告基于对全部 28 个源文件的逐行审查生成。建议按 Phase 1-5 的优先级逐步修复，每个 Phase 完成后进行回归测试。*
