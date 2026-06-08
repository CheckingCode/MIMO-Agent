# MiMo Agent vs Claude Code — 详细对比分析与改进建议

> 生成时间: 2026-06-02
> 版本: MiMo Agent v1.0.0

---

## 目录

1. [已修复的 UI 问题](#1-已修复的-ui-问题)
2. [架构层面分析](#2-架构层面分析)
3. [UI/UX 层面分析](#3-uiux-层面分析)
4. [功能层面分析](#4-功能层面分析)
5. [关键差距总结](#5-关键差距总结)
6. [改进建议优先级](#6-改进建议优先级)
7. [核心建议](#7-核心建议)
8. [附录：具体实现方案](#8-附录具体实现方案)

---

## 1. 已修复的 UI 问题

### 问题列表


| 问题                    | 原因                                                                                                        | 修复方案                                                    | 状态      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------- |
| **用户消息粘性遮挡**    | `.msg-user` 设置了 `position:sticky;top:0;z-index:10`，每条用户消息都粘在顶部叠在一起，遮挡下方内容和输入框 | 移除 sticky 定位，改为普通卡片式布局                        | ✅ 已修复 |
| **输入区域被遮挡**      | 输入区没有 z-index 保护，被其他元素覆盖                                                                     | 添加`z-index:20` 确保输入区始终可点击                       | ✅ 已修复 |
| **Header 按钮失效**     | 历史/设置按钮被下方元素遮挡                                                                                 | 添加`z-index:30` 和 `pointer-events:auto`                   | ✅ 已修复 |
| **Mode 弹窗定位错误**   | 父 div 缺少`position:relative`，`bottom:100%` 计算错误                                                      | 修复为`bottom:calc(100% + 4px)`                             | ✅ 已修复 |
| **所有按钮点击无响应**  | 缺少`pointer-events:auto`，某些元素无法接收点击事件                                                         | 为所有交互元素添加`pointer-events:auto` 和 `:active` 反馈   | ✅ 已修复 |
| **工具卡片点击困难**    | padding 太小，点击区域不足                                                                                  | 增大 padding（6px→8px），添加`pointer-events:auto`         | ✅ 已修复 |
| **发送按钮无反馈**      | 缺少`:active` 状态                                                                                          | 添加缩放效果（`transform:scale(.95)`），改为圆形按钮        | ✅ 已修复 |
| **JavaScript 语法错误** | HTML 实体（`&#10140;`、`&#9632;`）在 `<script>` 标签内不被解析，导致 `Invalid or unexpected token` 错误     | 将 JS 中的 HTML 实体替换为 Unicode 字符（`➡`、`■`、`▸`） | ✅ 已修复 |
| **Webview 初始化时序**  | `postToWebview` 在 webview 未就绪时被调用                                                                   | 添加`view` 检查，未就绪时打印日志而非崩溃                   | ✅ 已修复 |

### CSS 修改清单

```css
/* 1. 用户消息 — 从 sticky 改为普通卡片 */
.msg-user {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 12px;
  padding: 10px 16px;
  margin: 0 0 6px 0;
  white-space: pre-wrap;
  word-break: break-word;
  /* 移除了: position:sticky; top:0; z-index:10; backdrop-filter */
}

/* 2. 输入区域 — 确保始终可点击 */
#input-area {
  padding: 12px 16px 8px;
  flex-shrink: 0;
  position: relative;
  z-index: 20;
}

/* 3. Header — 确保按钮可点击 */
#header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-editorWidget-border);
  flex-shrink: 0;
  gap: 6px;
  background: var(--vscode-sideBar-background);
  position: relative;
  z-index: 30;
}

/* 4. 发送按钮 — 圆形 + 点击反馈 */
#send {
  background: var(--mimo-orange);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all .15s;
  pointer-events: auto;
}
#send:hover {
  background: var(--mimo-orange-hover);
  transform: scale(1.08);
}
#send:active {
  transform: scale(.95);
}

/* 5. 所有交互元素 — 添加 pointer-events */
.tb-icon, .tab, .mode-trigger, .mode-option,
#model-select, .history-item, .save-btn,
.tool-header, .thinking-toggle, .img-add,
.panel-close, .tab-close, .history-del,
.img-rm, #btn-new, .msg-assistant a {
  pointer-events: auto;
}
```

---

## 2. 架构层面分析

### 2.1 UI 框架


| 维度         | MiMo Agent                                            | Claude Code                      | 差距评估 |
| ------------ | ----------------------------------------------------- | -------------------------------- | -------- |
| **框架选择** | 纯 vanilla JS，所有代码内嵌在 TypeScript 模板字符串中 | React + 组件化架构，使用 JSX/TSX | 🔴 巨大  |
| **代码量**   | 972 行单文件（HTML/CSS/JS 混合）                      | 数百个独立组件文件               | 🔴 巨大  |
| **可维护性** | 极低 — 修改任何部分都需要理解整个文件                | 高 — 每个组件职责单一           | 🔴 巨大  |
| **可测试性** | 几乎无法测试 — UI 逻辑与 DOM 操作耦合                | 组件可独立测试                   | 🔴 巨大  |

**MiMo Agent 当前架构：**

```
src/webview/chatProvider.ts (972 行)
├── CSS 样式 (~170 行)
├── HTML 结构 (~60 行)
├── JavaScript 逻辑 (~420 行)
└── TypeScript 类 (~320 行)
```

**Claude Code 架构：**

```
src/
├── components/
│   ├── ChatView.tsx
│   ├── MessageList.tsx
│   ├── MessageItem.tsx
│   ├── ToolCallCard.tsx
│   ├── InputArea.tsx
│   ├── ModeSelector.tsx
│   ├── ModelSelector.tsx
│   ├── TabBar.tsx
│   └── ...
├── hooks/
│   ├── useChat.ts
│   ├── useTools.ts
│   └── ...
├── state/
│   ├── chatStore.ts
│   └── ...
├── styles/
│   ├── variables.css
│   ├── components.css
│   └── ...
└── utils/
    ├── markdown.ts
    └── ...
```

### 2.2 状态管理


| 维度         | MiMo Agent                                                 | Claude Code                                           | 差距评估 |
| ------------ | ---------------------------------------------------------- | ----------------------------------------------------- | -------- |
| **状态存储** | 全局变量（`var streamingMsg`, `var isBusy`, `var images`） | React hooks + 状态机（useState, useReducer, Zustand） | 🔴 巨大  |
| **状态更新** | 手动 DOM 操作（`innerHTML`, `createElement`）              | 声明式 UI — 状态变化自动更新视图                     | 🔴 巨大  |
| **数据流**   | 混乱 — 消息处理、UI 更新、事件绑定交织                    | 清晰 — 单向数据流，易于追踪和调试                    | 🔴 巨大  |

**MiMo Agent 的状态管理问题：**

```javascript
// 当前：全局变量 + 手动 DOM 操作
var streamingMsg = null;
var isBusy = false;
var rawHtml = '';
var images = [];
var currentVision = true;
var queuedMsg = null;

// 更新 UI 需要手动操作 DOM
function setBusy(busy) {
    isBusy = busy;
    if (busy) {
        sendBtn.innerHTML = '■';
        sendBtn.className = 'stop-btn';
    } else {
        sendBtn.innerHTML = '➜';
        sendBtn.className = '';
    }
}
```

**Claude Code 的状态管理：**

```typescript
// 推荐：使用 React hooks 或 Zustand
interface ChatState {
    streamingMsg: Message | null;
    isBusy: boolean;
    images: Image[];
    messages: Message[];
}

const useChatStore = create<ChatState>((set) => ({
    streamingMsg: null,
    isBusy: false,
    images: [],
    messages: [],
    setBusy: (busy) => set({ isBusy: busy }),
    addMessage: (msg) => set((state) => ({
        messages: [...state.messages, msg]
    })),
}));
```

### 2.3 类型安全


| 维度                | MiMo Agent                                  | Claude Code                 | 差距评估 |
| ------------------- | ------------------------------------------- | --------------------------- | -------- |
| **TypeScript 使用** | TypeScript 类处理消息通信，但 JS 部分无类型 | 全 TypeScript，完整类型定义 | 🟡 中等  |
| **接口定义**        | 基础的 message type 定义                    | 完整的接口、类型、泛型      | 🟡 中等  |
| **IDE 支持**        | JS 部分无自动补全和错误检查                 | 完整的 IntelliSense         | 🟡 中等  |

---

## 3. UI/UX 层面分析

### 3.1 消息渲染


| 维度              | MiMo Agent               | Claude Code                     | 差距评估 |
| ----------------- | ------------------------ | ------------------------------- | -------- |
| **Markdown 渲染** | 简单正则替换，无语法高亮 | 完整 Markdown 解析器 + 代码高亮 | 🔴 巨大  |
| **代码块**        | 灰色背景，无语言标识     | 语法高亮 + 语言标签 + 复制按钮  | 🔴 巨大  |
| **Diff 视图**     | 简单的绿/红行标记        | 完整的并排 Diff 视图 + 行号     | 🔴 巨大  |
| **表格渲染**      | 基础 HTML table          | 美化表格 + 排序 + 溢出处理      | 🟡 中等  |
| **链接处理**      | 纯文本链接               | 可点击链接 + 文件路径跳转       | 🟡 中等  |

**MiMo Agent 的 Markdown 渲染器问题：**

```typescript
// src/markdown.ts — 当前实现
export function renderMarkdown(text: string): string {
    if (!text) return '';
    let s = escapeHtml(text);  // 先转义 HTML

    // 问题：代码块内容已被转义，导致双重转义
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
        return '<pre><code>' + code.trimEnd() + '</code></pre>';
    });

    // 问题：无语法高亮
    // 问题：无复制按钮
    // 问题：无语言标识
}
```

**推荐改进方案：**

```typescript
// 使用 highlight.js 实现语法高亮
import hljs from 'highlight.js';

export function renderMarkdown(text: string): string {
    if (!text) return '';

    // 1. 提取代码块（避免转义）
    const codeBlocks: Array<{lang: string; code: string}> = [];
    let s = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push({ lang, code });
        return `__CODE_BLOCK_${idx}__`;
    });

    // 2. 转义 HTML
    s = escapeHtml(s);

    // 3. 恢复代码块（带语法高亮）
    codeBlocks.forEach(({ lang, code }, i) => {
        const highlighted = lang && hljs.getLanguage(lang)
            ? hljs.highlight(code, { language: lang }).value
            : escapeHtml(code);

        s = s.replace(
            `__CODE_BLOCK_${i}__`,
            `<div class="code-block">
                <div class="code-header">
                    <span class="code-lang">${lang || 'text'}</span>
                    <button class="copy-btn" onclick="copyCode(this)">复制</button>
                </div>
                <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
            </div>`
        );
    });

    // 4. 其他 Markdown 处理...
    return s;
}
```

### 3.2 


| 维度          | MiMo Agent              | Claude Code                      | 差距评估 |
| ------------- | ----------------------- | -------------------------------- | -------- |
| **卡片设计**  | 简单的黄色边框卡片      | 精美的卡片 + 状态图标 + 进度条   | 🔴 巨大  |
| **状态指示**  | 文字 "Running..."       | 动画图标 + 进度条 + 状态颜色     | 🔴 巨大  |
| **结果展示**  | 纯文本，截断到 500 字符 | 完整展示 + 语法高亮 + 折叠       | 🔴 巨大  |
| **Diff 展示** | 简单的 +/- 行标记       | 并排 Diff 视图 + 行号 + 语法高亮 | 🔴 巨大  |
| **文件预览**  | 无                      | 内嵌文件预览 + 点击打开          | 🟡 中等  |

**MiMo Agent 当前工具卡片：**

```html
<div class="tool-card">
    <div class="tool-header">
        <div class="tool-icon">E</div>
        <span class="tool-name">edit_file</span>
        <span class="tool-args">src/app.ts</span>
        <span class="tool-chevron">▸</span>
    </div>
    <div class="tool-body">
        <div class="tool-result">Running...</div>
    </div>
</div>
```

**推荐改进方案：**

```html
<div class="tool-card" data-status="running">
    <div class="tool-header">
        <div class="tool-icon-wrapper">
            <div class="tool-icon">E</div>
            <div class="tool-status-indicator"></div>
        </div>
        <div class="tool-info">
            <span class="tool-name">edit_file</span>
            <span class="tool-args">src/app.ts</span>
        </div>
        <div class="tool-meta">
            <span class="tool-elapsed">2.3s</span>
            <span class="tool-chevron">▸</span>
        </div>
    </div>
    <div class="tool-body">
        <div class="tool-progress">
            <div class="progress-bar"></div>
        </div>
        <div class="tool-diff">
            <div class="diff-header">
                <span class="diff-file">src/app.ts</span>
                <span class="diff-stats">+3 -1</span>
            </div>
            <div class="diff-content">
                <div class="diff-line del">
                    <span class="line-num">42</span>
                    <span class="line-content">- const old = 'value';</span>
                </div>
                <div class="diff-line add">
                    <span class="line-num">42</span>
                    <span class="line-content">+ const newValue = 'updated';</span>
                </div>
            </div>
        </div>
        <div class="tool-result">
            <span class="result-success">✓ File updated successfully</span>
        </div>
    </div>
</div>
```

### 3.3 输入体验


| 维度           | MiMo Agent                   | Claude Code            | 差距评估 |
| -------------- | ---------------------------- | ---------------------- | -------- |
| **输入框**     | 单行 textarea，自动扩展      | 多行编辑器，支持快捷键 | 🟡 中等  |
| **命令补全**   | 无                           | `/` 触发命令补全菜单   | 🟡 中等  |
| **快捷键**     | Enter 发送，Shift+Enter 换行 | 丰富的快捷键组合       | 🟡 中等  |
| **历史记录**   | 上下箭头浏览历史             | 完整的历史搜索         | 🟢 小    |
| **图片上传** | 拖拽 + 粘贴 + 文件选择       | 同等支持               | 🟢 小    |

**MiMo Agent 输入框当前实现：**

```javascript
// 基础的 textarea
<textarea id="input" placeholder="Ask MiMo..." rows="1"></textarea>

// 简单的快捷键
input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
    }
});
```

**推荐改进方案：**

```javascript
// 1. 添加命令补全
const COMMANDS = [
    { name: '/clear', desc: 'Clear conversation' },
    { name: '/debug', desc: 'Debug and fix errors' },
    { name: '/doc', desc: 'Generate documentation' },
    { name: '/explain', desc: 'Explain code/concept' },
    { name: '/review', desc: 'Code review' },
    { name: '/test', desc: 'Generate tests' },
];

input.addEventListener('input', function(e) {
    const text = this.value;
    if (text.startsWith('/')) {
        showCommandPalette(text);
    }
});

function showCommandPalette(query) {
    const filtered = COMMANDS.filter(c =>
        c.name.startsWith(query)
    );
    // 显示补全菜单...
}

// 2. 添加更多快捷键
input.addEventListener('keydown', function(e) {
    // Ctrl+Enter — 强制发送（即使正在运行）
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        forceSend();
        return;
    }

    // Escape — 清空输入
    if (e.key === 'Escape') {
        this.value = '';
        hideCommandPalette();
        return;
    }

    // Tab — 接受补全建议
    if (e.key === 'Tab' && commandPaletteVisible) {
        e.preventDefault();
        acceptSuggestion();
        return;
    }
});
```

### 3.4 主题适配


| 维度          | MiMo Agent           | Claude Code           | 差距评估 |
| ------------- | -------------------- | --------------------- | -------- |
| **颜色变量**  | 使用 VSCode CSS 变量 | 深度集成 + 自定义变量 | 🟡 中等  |
| **动画过渡**  | 基础 transition      | 流畅的动画 + 微交互   | 🟡 中等  |
| **暗色/亮色** | 自动跟随 VSCode 主题 | 完整的主题支持        | 🟢 小    |
| **响应式**    | 基础 flex 布局       | 自适应 + 最小宽度保护 | 🟢 小    |

---

## 4. 功能层面分析

### 4.1 对话持久化


| 维度         | MiMo Agent      | Claude Code        | 差距评估 |
| ------------ | --------------- | ------------------ | -------- |
| **存储位置** | 内存（Map）     | 磁盘 + globalState | 🔴 巨大  |
| **重启恢复** | ❌ 丢失所有对话 | ✅ 完整恢复        | 🔴 巨大  |
| **历史搜索** | 基础列表        | 全文搜索 + 筛选    | 🟡 中等  |
| **导出功能** | 无              | Markdown/JSON 导出 | 🟡 中等  |

**MiMo Agent 当前实现：**

```typescript
// agent.ts — 纯内存存储
export class MiMoAgent extends EventEmitter {
    private conversations = new Map<string, ConversationState>();
    private activeId: string = '';

    createConversation(): string {
        const id = Date.now().toString();
        this.conversations.set(id, {
            id,
            title: 'New Chat',
            messages: [],
            model: this.config.model,
            mode: 'auto',
        });
        this.activeId = id;
        return id;
        // 问题：重启后全部丢失
    }
}
```

**推荐改进方案：**

```typescript
// agent.ts — 使用 VSCode globalState 持久化
export class MiMoAgent extends EventEmitter {
    constructor(
        private config: MiMoConfig,
        extensionPath: string,
        private context: vscode.ExtensionContext,  // 新增
    ) {
        super();
        this.api = new MiMoAPI(config.apiKey, config.baseUrl);
        this.systemPrompt = buildSystemPrompt(config.workspace);
        this.skills = loadSkills(extensionPath);
        this.loadConversations();  // 启动时加载
    }

    private loadConversations(): void {
        const saved = this.context.globalState.get<Record<string, ConversationState>>('conversations');
        if (saved) {
            for (const [id, conv] of Object.entries(saved)) {
                this.conversations.set(id, conv);
            }
            const lastActive = this.context.globalState.get<string>('activeConversationId');
            if (lastActive && this.conversations.has(lastActive)) {
                this.activeId = lastActive;
            }
        }
    }

    private saveConversations(): void {
        const data = Object.fromEntries(this.conversations);
        this.context.globalState.update('conversations', data);
        this.context.globalState.update('activeConversationId', this.activeId);
    }

    createConversation(): string {
        const id = Date.now().toString();
        this.conversations.set(id, {
            id,
            title: 'New Chat',
            messages: [],
            model: this.config.model,
            mode: 'auto',
        });
        this.activeId = id;
        this.saveConversations();  // 持久化
        return id;
    }

    // 所有修改数据的方法都需要调用 saveConversations()
}
```

### 4.2 工具系统


| 维度         | MiMo Agent     | Claude Code         | 差距评估 |
| ------------ | -------------- | ------------------- | -------- |
| **工具数量** | 8 个基础工具   | 20+ 工具 + MCP 协议 | 🔴 巨大  |
| **工具质量** | 基础实现       | 精心优化 + 错误处理 | 🔴 巨大  |
| **安全检查** | 基础命令过滤   | 多层安全检查 + 沙箱 | 🟡 中等  |
| **扩展性**   | 硬编码工具列表 | MCP 协议 + 插件系统 | 🔴 巨大  |

**MiMo Agent 工具列表：**

1. `read_file` — 读取文件
2. `write_file` — 写入文件
3. `edit_file` — 编辑文件
4. `list_directory` — 列出目录
5. `search_files` — 搜索文件
6. `execute_command` — 执行命令
7. `fetch_url` — 获取 URL
8. `glob_files` — 文件匹配

**Claude Code 工具列表（参考）：**

1. `read_file` — 读取文件（支持 offset/limit）
2. `write_file` — 写入文件（自动创建目录）
3. `edit_file` — 精确编辑（支持 replace_all）
4. `list_directory` — 列出目录（支持递归）
5. `search_files` — 正则搜索（支持 glob 过滤）
6. `execute_command` — 执行命令（支持超时、后台运行）
7. `fetch_url` — 获取 URL（支持重定向限制）
8. `glob_files` — 文件匹配（支持多种模式）
9. `create_directory` — 创建目录
10. `delete_file` — 删除文件
11. `move_file` — 移动/重命名文件
12. `copy_file` — 复制文件
13. `get_file_info` — 获取文件信息
14. `git_status` — Git 状态
15. `git_diff` — Git 差异
16. `git_commit` — Git 提交
17. `git_push` — Git 推送
18. `git_pull` — Git 拉取
19. `web_search` — 网络搜索
20. `browser_open` — 打开浏览器
21. `browser_click` — 点击元素
22. `browser_type` — 输入文本
23. `screenshot` — 截图
24. `mcp_call` — MCP 工具调用

### 4.3 安全层


| 维度         | MiMo Agent   | Claude Code         | 差距评估 |
| ------------ | ------------ | ------------------- | -------- |
| **命令过滤** | 基础黑名单   | 多层检查 + 前缀剥离 | 🟡 中等  |
| **路径验证** | 基础路径检查 | 完整的路径遍历防护  | 🟡 中等  |
| **敏感文件** | 扩展名过滤   | 内容检测 + 权限检查 | 🟡 中等  |
| **沙箱执行** | 无           | 可选沙箱模式        | 🟡 中等  |

**MiMo Agent 安全层问题：**

```typescript
// safety.ts — 当前实现
const BLOCKED_COMMANDS = new Set([
    'rm', 'rmdir', 'del', 'format', 'shutdown', 'reboot',
    'taskkill', 'net', 'reg', 'cipher', 'diskpart',
]);

export function isCommandBlocked(cmd: string): { blocked: boolean; reason: string } {
    const first = cmd.toLowerCase().trim().split(/\s+/)[0] || '';
    if (BLOCKED_COMMANDS.has(first)) {
        return { blocked: true, reason: `Command '${first}' is blocked` };
    }
    return { blocked: false, reason: '' };
    // 问题：可被绕过
    // sudo rm -rf /    → "sudo" 不在黑名单
    // /bin/rm file     → "/bin/rm" 不在黑名单
    // cmd /c del file  → "cmd" 不在黑名单
}
```

**推荐改进方案：**

```typescript
const BLOCKED_COMMANDS = new Set([
    'rm', 'rmdir', 'del', 'format', 'shutdown', 'reboot',
    'taskkill', 'net', 'reg', 'cipher', 'diskpart', 'fdisk', 'mkfs',
    'Remove-Item', 'Clear-RecycleBin', 'Stop-Process', 'Stop-Computer',
]);

const STRIP_PREFIXES = [
    'sudo', '/bin/', '/usr/bin/', '/sbin/',
    'cmd /c', 'cmd.exe /c', 'powershell -c', 'powershell.exe -c',
];

export function isCommandBlocked(cmd: string): { blocked: boolean; reason: string } {
    // 1. 检查原始命令模式
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(cmd)) {
            return { blocked: true, reason: 'Command matches dangerous pattern' };
        }
    }

    // 2. 剥离常见前缀
    let stripped = cmd.trim();
    for (const prefix of STRIP_PREFIXES) {
        if (stripped.toLowerCase().startsWith(prefix.toLowerCase())) {
            stripped = stripped.slice(prefix.length).trim();
        }
    }

    // 3. 检查剥离后的命令
    const first = stripped.toLowerCase().split(/\s+/)[0] || '';
    if (BLOCKED_COMMANDS.has(first)) {
        return { blocked: true, reason: `Command '${first}' is blocked` };
    }

    return { blocked: false, reason: '' };
}
```

### 4.4 流式输出


| 维度           | MiMo Agent         | Claude Code | 差距评估 |
| -------------- | ------------------ | ----------- | -------- |
| **SSE 支持**   | ✅ 完整支持        | ✅ 完整支持 | 🟢 小    |
| **打字机效果** | ✅ 基础支持        | ✅ 流畅动画 | 🟢 小    |
| **中断支持**   | ✅ AbortController | ✅ 完整支持 | 🟢 小    |
| **重试机制**   | ✅ 429 重试        | ✅ 完整重试 | 🟢 小    |

### 4.5 多模型支持


| 维度         | MiMo Agent            | Claude Code     | 差距评估 |
| ------------ | --------------------- | --------------- | -------- |
| **模型列表** | ✅ 配置化             | ✅ 动态获取     | 🟢 小    |
| **能力感知** | ✅ vision/tts 标记    | ✅ 完整能力矩阵 | 🟢 小    |
| **动态切换** | ✅ 支持               | ✅ 支持         | 🟢 小    |
| **模型参数** | ✅ temperature/tokens | ✅ 完整参数     | 🟢 小    |

---

## 5. 关键差距总结

### 🔴 巨大差距（需要重大重构）

#### 1. UI 架构

- **现状**: MiMo 用 vanilla JS 内嵌，972 行单文件
- **目标**: React 组件化，模块分离
- **影响**: 代码难以维护、无法复用、状态混乱
- **工作量**: 2-3 周

#### 2. 消息渲染

- **现状**: 简单正则替换，无语法高亮
- **目标**: 完整 Markdown 解析 + 代码高亮 + Diff 视图
- **影响**: 用户体验差，专业感不足
- **工作量**: 3-5 天

#### 3. 工具可视化

- **现状**: 简单卡片，文字状态
- **目标**: 丰富可视化：进度条、状态图标、Diff 对比
- **影响**: 工具执行过程不直观
- **工作量**: 1-2 周

#### 4. 对话持久化

- **现状**: 内存存储，重启丢失
- **目标**: 完整持久化 + 历史搜索
- **影响**: 用户体验差，数据丢失
- **工作量**: 1-2 天

### 🟡 中等差距（可逐步改进）

1. **输入体验** — 命令补全、快捷键、多行编辑
2. **错误处理** — 错误边界、重试按钮、详细堆栈
3. **安全层深度** — 多层检查、沙箱模式
4. **工具数量和质量** — 更多工具、更好的实现

### 🟢 小差距（快速可追）

1. **多模型支持** ✅ 已有基础实现
2. **图片支持** ✅ 已有基础实现
3. **流式输出** ✅ 已有完整实现
4. **思维链展示** ✅ 已有基础实现
5. **Skills 系统** ✅ 已有基础实现

---

## 6. 改进建议优先级

### 短期（1-2 天）— 快速提升体验


| 优先级 | 任务                                          | 预计时间 | 影响             |
| ------ | --------------------------------------------- | -------- | ---------------- |
| 1      | **添加代码语法高亮** — 引入 highlight.js     | 2-3 小时 | 用户感知最明显   |
| 2      | **修复对话持久化** — 使用 VSCode globalState | 1-2 小时 | 解决数据丢失问题 |
| 3      | **改进工具卡片** — 添加状态图标和进度指示    | 2-3 小时 | 提升专业感       |
| 4      | **改进 Markdown 渲染** — 支持表格、任务列表  | 2-3 小时 | 提升阅读体验     |

**总预计时间**: 1-2 天
**预期效果**: 体验提升 50% 以上

### 中期（1-2 周）— 架构升级


| 优先级 | 任务                                          | 预计时间 | 影响         |
| ------ | --------------------------------------------- | -------- | ------------ |
| 1      | **分离 webview 资源** — HTML/CSS/JS 独立文件 | 1-2 天   | 提升可维护性 |
| 2      | **引入轻量 UI 框架** — Preact 或 Solid.js    | 2-3 天   | 组件化基础   |
| 3      | **组件化重构** — Message、ToolCard、Input 等 | 3-5 天   | 代码复用     |
| 4      | **状态管理** — 使用 Zustand 或类似方案       | 1-2 天   | 状态清晰     |

**总预计时间**: 1-2 周
**预期效果**: 架构现代化，可维护性大幅提升

### 长期（1-2 月）— 追平 Claude


| 优先级 | 任务                                            | 预计时间 | 影响     |
| ------ | ----------------------------------------------- | -------- | -------- |
| 1      | **完整工具生态** — 参考 Claude 的工具设计      | 2-3 周   | 功能完整 |
| 2      | **MCP 协议支持** — 标准化工具接口              | 2-3 周   | 扩展性   |
| 3      | **高级可视化** — Diff 视图、文件树、执行时间线 | 2-3 周   | 用户体验 |
| 4      | **插件系统** — 允许用户自定义工具和技能        | 2-3 周   | 生态建设 |

**总预计时间**: 1-2 月
**预期效果**: 功能和体验追平 Claude Code

---

## 7. 核心建议

### MiMo Agent 的优势

1. **零依赖** — 无运行时 npm 包，VSIX 仅 68KB
2. **基础功能齐全** — 流式输出、工具调用、多模型、图片支持
3. **Skills 系统** — 可扩展的技能模板
4. **安全层** — 基础的安全检查

### 最值得投入的 3 件事

#### 1. 代码高亮（1 天）

- **为什么**: 用户感知最明显，代码是 AI 编程助手的核心输出
- **怎么做**: 引入 highlight.js，修改 markdown.ts
- **效果**: 立竿见影，专业感提升 100%

#### 2. 对话持久化（半天）

- **为什么**: 数据丢失是最差的用户体验
- **怎么做**: 使用 VSCode globalState，修改 agent.ts
- **效果**: 解决用户最痛的问题

#### 3. 工具卡片优化（1 天）

- **为什么**: 工具执行是 Agent 的核心能力
- **怎么做**: 添加状态图标、进度指示、结果美化
- **效果**: 提升专业感和可信度

### 实施路线图

```
Week 1: 快速提升
├── Day 1-2: 代码高亮 + 对话持久化
├── Day 3-4: 工具卡片优化
└── Day 5: 测试 + 修复

Week 2-3: 架构升级
├── 分离 webview 资源
├── 引入 Preact/Solid.js
├── 组件化重构
└── 状态管理

Week 4-8: 功能完善
├── 完整工具生态
├── MCP 协议支持
├── 高级可视化
└── 插件系统
```

---

## 8. 附录：具体实现方案

### 8.1 代码高亮实现

**步骤 1: 安装 highlight.js**

```bash
npm install highlight.js
```

**步骤 2: 修改 markdown.ts**

```typescript
import hljs from 'highlight.js';

export function renderMarkdown(text: string): string {
    if (!text) return '';

    // 1. 提取代码块
    const codeBlocks: Array<{lang: string; code: string}> = [];
    let s = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push({ lang, code });
        return `__CODE_BLOCK_${idx}__`;
    });

    // 2. 转义 HTML
    s = escapeHtml(s);

    // 3. 恢复代码块（带语法高亮）
    codeBlocks.forEach(({ lang, code }, i) => {
        const highlighted = lang && hljs.getLanguage(lang)
            ? hljs.highlight(code, { language: lang }).value
            : escapeHtml(code);

        s = s.replace(
            `__CODE_BLOCK_${i}__`,
            `<div class="code-block">
                <div class="code-header">
                    <span class="code-lang">${lang || 'text'}</span>
                    <button class="copy-btn" onclick="copyCode(this)">复制</button>
                </div>
                <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
            </div>`
        );
    });

    // 4. 其他 Markdown 处理
    // ...
}
```

**步骤 3: 添加 CSS**

```css
.code-block {
    margin: 8px 0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--vscode-editorWidget-border);
}

.code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: var(--vscode-textCodeBlock-background);
    border-bottom: 1px solid var(--vscode-editorWidget-border);
    font-size: 11px;
}

.code-lang {
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
}

.copy-btn {
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
    transition: all .15s;
}

.copy-btn:hover {
    color: var(--vscode-foreground);
    border-color: var(--vscode-foreground);
}

.code-block pre {
    margin: 0;
    padding: 12px;
    background: var(--vscode-textCodeBlock-background);
    overflow-x: auto;
}

.code-block code {
    background: none;
    padding: 0;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    line-height: 1.5;
}
```

**步骤 4: 添加 JavaScript**

```javascript
function copyCode(btn) {
    const code = btn.closest('.code-block').querySelector('code');
    navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => btn.textContent = '复制', 2000);
    });
}
```

### 8.2 对话持久化实现

**步骤 1: 修改 extension.ts**

```typescript
export function activate(context: vscode.ExtensionContext) {
    const config = loadConfig();

    // 传递 context 给 agent
    agent = new MiMoAgent(config, context.extensionPath, context);

    // ...
}
```

**步骤 2: 修改 agent.ts**

```typescript
export class MiMoAgent extends EventEmitter {
    constructor(
        private config: MiMoConfig,
        extensionPath: string,
        private context: vscode.ExtensionContext,
    ) {
        super();
        this.api = new MiMoAPI(config.apiKey, config.baseUrl);
        this.systemPrompt = buildSystemPrompt(config.workspace);
        this.skills = loadSkills(extensionPath);
        this.loadConversations();
    }

    private loadConversations(): void {
        const saved = this.context.globalState.get<Record<string, ConversationState>>('conversations');
        if (saved) {
            for (const [id, conv] of Object.entries(saved)) {
                this.conversations.set(id, conv);
            }
            const lastActive = this.context.globalState.get<string>('activeConversationId');
            if (lastActive && this.conversations.has(lastActive)) {
                this.activeId = lastActive;
            }
        }
    }

    private saveConversations(): void {
        const data = Object.fromEntries(this.conversations);
        this.context.globalState.update('conversations', data);
        this.context.globalState.update('activeConversationId', this.activeId);
    }

    // 修改所有数据变更方法...
    createConversation(): string { /* ... */ this.saveConversations(); }
    removeConversation(id: string): void { /* ... */ this.saveConversations(); }
    // ...
}
```

### 8.3 工具卡片优化实现

**步骤 1: 修改 CSS**

```css
.tool-card {
    margin: 4px 0;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 8px;
    background: var(--vscode-editor-background);
    overflow: hidden;
    font-size: 11px;
    transition: all .2s;
}

.tool-card[data-status="running"] {
    border-color: var(--mimo-orange);
}

.tool-card[data-status="success"] {
    border-color: #4CAF50;
}

.tool-card[data-status="error"] {
    border-color: var(--vscode-errorForeground);
}

.tool-icon-wrapper {
    position: relative;
    width: 20px;
    height: 20px;
}

.tool-status-indicator {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-descriptionForeground);
    border: 2px solid var(--vscode-editor-background);
}

.tool-card[data-status="running"] .tool-status-indicator {
    background: var(--mimo-orange);
    animation: pulse 1.5s infinite;
}

.tool-card[data-status="success"] .tool-status-indicator {
    background: #4CAF50;
}

.tool-card[data-status="error"] .tool-status-indicator {
    background: var(--vscode-errorForeground);
}
```

**步骤 2: 修改 JavaScript**

```javascript
function addToolCard(name, args) {
    var card = document.createElement('div');
    card.className = 'tool-card';
    card.setAttribute('data-status', 'running');
    card._toolName = name;
    card._toolArgs = args;

    var summary = toolSummary(name, args);
    card.innerHTML = `
        <div class="tool-header">
            <div class="tool-icon-wrapper">
                <div class="tool-icon">${toolIcon(name)}</div>
                <div class="tool-status-indicator"></div>
            </div>
            <div class="tool-info">
                <span class="tool-name">${escapeHtml(name)}</span>
                <span class="tool-args">${escapeHtml(summary)}</span>
            </div>
            <div class="tool-meta">
                <span class="tool-elapsed"></span>
                <span class="tool-chevron">▸</span>
            </div>
        </div>
        <div class="tool-body">
            <div class="tool-result">Running...</div>
        </div>
    `;

    card.querySelector('.tool-header').addEventListener('click', function() {
        card.classList.toggle('expanded');
    });

    messagesDiv.appendChild(card);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return card;
}

// 更新工具状态
function updateToolCardStatus(card, status, elapsed) {
    card.setAttribute('data-status', status);
    if (elapsed) {
        card.querySelector('.tool-elapsed').textContent = elapsed.toFixed(1) + 's';
    }
}
```

---

## 总结

MiMo Agent 已经具备了 AI 编程助手的核心基础功能，主要差距在 **UI 精致度** 和 **架构可维护性**。

**短期目标**（1-2 天）：快速提升体验

- 代码高亮
- 对话持久化
- 工具卡片优化

**中期目标**（1-2 周）：架构现代化

- 分离资源文件
- 引入 UI 框架
- 组件化重构

**长期目标**（1-2 月）：追平 Claude

- 完整工具生态
- MCP 协议支持
- 高级可视化

通过以上改进，MiMo Agent 可以从一个基础的 AI 聊天工具，升级为一个专业级的 AI 编程助手。

---

*文档生成时间: 2026-06-02*
*维护者: MiMo Agent Team*
