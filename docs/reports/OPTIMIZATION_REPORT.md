# MiMo Agent VS Code 扩展 — 详细优化建议

## 📊 项目概览

| 指标 | 现状 |
|------|------|
| 代码行数 | ~1,200 行 TS + ~1,000 行内嵌 HTML/CSS/JS |
| 功能模块 | Agent、API、Tools、Safety、Config、History、Skills、Markdown、Webview |
| 编译状态 | ✅ 通过 |
| 外部依赖 | 仅 `vscode` 类型定义，无运行时依赖 |

---

## 🔴 高优先级 — Bug / 安全风险

### 1. `tools.ts` — `edit_file` 字符串替换缺陷

**文件**: `src/tools.ts` 第202行

```typescript
const newContent = content.replace(args.old_text, args.new_text);
```

**问题**:
- `String.replace()` 只替换**第一个**匹配项
- 如果 `old_text` 包含正则特殊字符（`$`, `\`, `(`, `)` 等），会被当作正则模式解析
- 没有检查是否真正替换成功（0 匹配时静默返回）

**修复方案**:
```typescript
async function toolEditFile(args: Record<string, any>, workspace: string): Promise<string> {
    const full = resolvePath(args.path, workspace);
    const { safe, reason } = isPathSafe(full, workspace);
    if (!safe) return `Safety: ${reason}`;
    if (!fs.existsSync(full)) return `File not found: ${args.path}`;

    const content = fs.readFileSync(full, 'utf-8');
    const count = content.split(args.old_text).length - 1;

    if (count === 0) {
        return `Error: old_text not found in file. No changes made.`;
    }

    // Split and join to replace ALL occurrences
    const newContent = content.split(args.old_text).join(args.new_text);
    fs.writeFileSync(full, newContent, 'utf-8');
    return `Replaced (${count} match${count > 1 ? 'es' : ''}, all replaced)`;
}
```

---

### 2. `safety.ts` — 命令注入可被绕过

**文件**: `src/safety.ts` 第28-38行

**当前检查**:
```typescript
const first = cmd.toLowerCase().trim().split(/\s+/)[0] || '';
if (BLOCKED_COMMANDS.has(first)) { ... }
```

**可绕过的方式**:
```
sudo rm -rf /          → "sudo" 不在黑名单
/bin/rm -rf /          → "/bin/rm" 不在黑名单  
cmd /c del file        → "cmd" 不在黑名单
powershell -c Remove-Item file  → "powershell" 不在黑名单
```

**修复方案**:
```typescript
const BLOCKED_COMMANDS = new Set([
    'rm', 'rmdir', 'del', 'format', 'shutdown', 'reboot',
    'taskkill', 'net', 'reg', 'cipher', 'diskpart', 'fdisk', 'mkfs',
    'Remove-Item', 'Clear-RecycleBin', 'Stop-Process', 'Stop-Computer',
]);

// Strip common prefixes
const STRIP_PREFIXES = ['sudo', '/bin/', '/usr/bin/', '/sbin/', 'cmd /c', 'cmd.exe /c'];

export function isCommandBlocked(cmd: string): { blocked: boolean; reason: string } {
    // Check raw command patterns first
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(cmd)) {
            return { blocked: true, reason: 'Command matches dangerous pattern' };
        }
    }

    // Strip common prefixes and re-check
    let stripped = cmd.trim();
    for (const prefix of STRIP_PREFIXES) {
        if (stripped.toLowerCase().startsWith(prefix.toLowerCase())) {
            stripped = stripped.slice(prefix.length).trim();
        }
    }

    const first = stripped.toLowerCase().split(/\s+/)[0] || '';
    if (BLOCKED_COMMANDS.has(first) || BLOCKED_COMMANDS.has(stripped.split(/\s+/)[0])) {
        return { blocked: true, reason: `Command '${first}' is blocked` };
    }

    return { blocked: false, reason: '' };
}
```

---

### 3. `extension.ts` — 私有属性访问 + 硬编码延迟

**文件**: `src/extension.ts` 第54行

```typescript
setTimeout(() => {
    chatProvider['handleUserMessage'](prompt);
}, 300);
```

**问题**:
- 使用 `['handleUserMessage']` 访问私有方法（TypeScript 类型不安全）
- 300ms 延迟不可靠，webview 可能还没准备好

**修复方案**:
```typescript
// chatProvider.ts 中添加公共方法
private pendingMessage: string | null = null;

public sendMessage(text: string): void {
    if (!this.view) {
        this.pendingMessage = text;
        return;
    }
    this.handleUserMessage(text);
}

// 在 resolveWebviewView 中处理待发送消息
// ... existing code ...
setTimeout(() => {
    // ... existing postToWebview calls ...
    if (this.pendingMessage) {
        this.handleUserMessage(this.pendingMessage);
        this.pendingMessage = null;
    }
}, 100);

// extension.ts 中
chatProvider.sendMessage(prompt);
```

---

### 4. `markdown.ts` — HTML 转义顺序错误

**文件**: `src/markdown.ts` 第14-17行

```typescript
let s = escapeHtml(text);
// Code blocks: ```lang\n...\n```
s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    return '<pre><code>' + code.trimEnd() + '</code></pre>';
});
```

**问题**: 先转义 HTML，再匹配代码块。但代码块内容已经被转义了，导致 `<pre><code>` 内的特殊字符被双重转义。

**修复方案**:
```typescript
export function renderMarkdown(text: string): string {
    if (!text) return '';

    // Process code blocks FIRST (before HTML escaping)
    let s = text;
    const codeBlocks: string[] = [];
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push(escapeHtml(code.trimEnd()));
        return placeholder;
    });

    // Now escape HTML for the rest
    s = escapeHtml(s);

    // Restore code blocks
    codeBlocks.forEach((code, i) => {
        s = s.replace(`__CODE_BLOCK_${i}__`, `<pre><code>${code}</code></pre>`);
    });

    // Inline code: `...`
    s = s.replace(/`([^\n]+?)`/g, '<code>$1</code>');

    // ... rest of markdown processing ...
}
```

---

## 🟡 中优先级 — 代码质量 / 可维护性

### 5. `chatProvider.ts` — 单文件过大 (38KB)

**问题**: HTML、CSS、JS 全部内嵌在 TypeScript 模板字符串中，难以维护。

**建议**: 分离为独立文件

```
src/webview/
├── chatProvider.ts    ← 逻辑
├── styles.css         ← 样式
├── app.js             ← 前端逻辑
└── template.ts        ← HTML 模板加载器
```

```typescript
// template.ts
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'app.js')
    );
    
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${webview.cspSource} 'unsafe-inline';
                     script-src 'nonce-${getNonce()}';
                     img-src ${webview.cspSource} https:;
                     connect-src https:;">
        <link rel="stylesheet" href="${styleUri}">
    </head>
    <body>
        <!-- HTML content here -->
        <script nonce="${getNonce()}" src="${scriptUri}"></script>
    </body>
    </html>`;
}
```

---

### 6. `agent.ts` — 对话管理无持久化

**问题**: 对话存储在内存 `Map` 中，VSCode 重启后全部丢失。

**建议**: 使用 `ExtensionContext.globalState` 持久化

```typescript
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
        this.loadConversations();  // 加载持久化数据
    }

    private loadConversations(): void {
        const saved = this.context.globalState.get<Record<string, ConversationState>>('conversations');
        if (saved) {
            for (const [id, conv] of Object.entries(saved)) {
                this.conversations.set(id, conv);
            }
            // 恢复 activeId
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

    removeConversation(id: string): void {
        this.conversations.delete(id);
        if (this.activeId === id) {
            const remaining = Array.from(this.conversations.keys());
            this.activeId = remaining.length > 0 ? remaining[remaining.length - 1] : '';
        }
        this.saveConversations();  // 持久化
    }

    // ... 其他修改数据的方法也需要调用 saveConversations()
}
```

---

### 7. `config.ts` — 缺少配置验证

**问题**: API Key 为空时只警告，不阻止使用；配置值没有范围检查。

**修复方案**:
```typescript
export interface ConfigValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function validateConfig(config: MiMoConfig): ConfigValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!config.apiKey) {
        errors.push('API key is required. Set "mimo.apiKey" in settings or MIMO_API_KEY env var.');
    }

    // Range checks
    if (config.maxTokens < 1 || config.maxTokens > 128000) {
        errors.push('maxTokens must be between 1 and 128000');
    }
    if (config.temperature < 0 || config.temperature > 2) {
        errors.push('temperature must be between 0 and 2');
    }
    if (config.maxRounds < 1 || config.maxRounds > 100) {
        errors.push('maxRounds must be between 1 and 100');
    }
    if (config.maxOutputLen < 100 || config.maxOutputLen > 100000) {
        warnings.push('maxOutputLen should be between 100 and 100000');
    }

    // URL validation
    try {
        new URL(config.baseUrl);
    } catch {
        errors.push(`Invalid base URL: ${config.baseUrl}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}
```

---

### 8. `tools.ts` — `fetch_url` 没有重定向限制

**文件**: `src/tools.ts` 第309-331行

**问题**: 重定向跟随没有深度限制，可能导致无限循环。

**修复方案**:
```typescript
async function toolFetchUrl(args: Record<string, any>): Promise<string> {
    return fetchUrlRecursive(args.url, args.max_length || 5000, 0, 5);
}

async function fetchUrlRecursive(
    url: string, 
    maxLen: number, 
    depth: number, 
    maxRedirects: number
): Promise<string> {
    if (depth >= maxRedirects) {
        return `Error: Too many redirects (max ${maxRedirects})`;
    }

    const httpMod = require('http');
    const httpsMod = require('https');

    return new Promise((resolve) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? httpsMod : httpMod;
        
        const req = transport.get(url, { timeout: 15000 }, (res: any) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).toString();
                fetchUrlRecursive(redirectUrl, maxLen, depth + 1, maxRedirects).then(resolve);
                return;
            }

            let data = '';
            res.on('data', (c: Buffer) => (data += c.toString('utf-8')));
            res.on('end', () => {
                if (data.length > maxLen) {
                    data = data.slice(0, maxLen) + '\n... (truncated)';
                }
                resolve(data);
            });
        });

        req.on('error', (e: Error) => resolve(`Fetch failed: ${e.message}`));
        req.on('timeout', () => {
            req.destroy();
            resolve('Fetch timeout (15s)');
        });
    });
}
```

---

### 9. `agent.ts` — 错误处理语义重复

**文件**: `src/agent.ts` 第245-256行

**当前代码**:
```typescript
catch (e: any) {
    if (signal.aborted) { ... }
    events.onDone(`API error: ${e.message}`);
    events.onError(`API error: ${e.message}`);
    conv.messages.pop();
    // ...
}
```

**问题**: 
- `onDone` 和 `onError` 都被调用，语义重复
- `messages.pop()` 只移除最后一条，但如果有多轮工具调用可能不够

**修复方案**:
```typescript
catch (e: any) {
    if (signal.aborted) {
        events.onDone('(stopped by user)');
        this.abortController = null;
        return '(stopped by user)';
    }
    
    const errorMsg = `API error: ${e.message}`;
    events.onError(errorMsg);
    events.onDone(errorMsg);
    
    // Remove the last user message since we couldn't process it
    const lastUserIdx = conv.messages.findLastIndex(m => m.role === 'user');
    if (lastUserIdx !== -1) {
        conv.messages.splice(lastUserIdx, 1);
    }
    
    this.abortController = null;
    return errorMsg;
}
```

---

## 🟢 低优先级 — 增强功能

### 10. 缺少单元测试

**建议**: 添加测试框架和测试用例

```
tests/
├── agent.test.ts
├── tools.test.ts
├── safety.test.ts
├── markdown.test.ts
└── config.test.ts
```

**package.json 新增**:
```json
{
    "scripts": {
        "test": "jest --config jest.config.js",
        "test:watch": "jest --watch"
    },
    "devDependencies": {
        "jest": "^29.0.0",
        "@types/jest": "^29.0.0",
        "ts-jest": "^29.0.0",
        "@vscode/test-electron": "^2.3.0"
    }
}
```

**示例测试** (`tests/safety.test.ts`):
```typescript
import { isCommandBlocked, isPathSafe } from '../src/safety';

describe('Safety checks', () => {
    test('blocks rm command', () => {
        expect(isCommandBlocked('rm -rf /').blocked).toBe(true);
    });

    test('blocks sudo prefix', () => {
        expect(isCommandBlocked('sudo rm -rf /').blocked).toBe(true);
    });

    test('blocks /bin/rm', () => {
        expect(isCommandBlocked('/bin/rm file').blocked).toBe(true);
    });

    test('allows safe commands', () => {
        expect(isCommandBlocked('ls -la').blocked).toBe(false);
    });

    test('blocks paths outside workspace', () => {
        expect(isPathSafe('/etc/passwd', '/home/user/workspace').safe).toBe(false);
    });
});
```

---

### 11. 缺少结构化日志

**建议**: 添加统一的日志系统

```typescript
// src/logger.ts
import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export class Logger {
    private static outputChannel = vscode.window.createOutputChannel('MiMo Agent');
    private static level: LogLevel = LogLevel.INFO;

    static setLevel(level: LogLevel): void {
        this.level = level;
    }

    static debug(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.DEBUG) {
            this.outputChannel.appendLine(
                `[DEBUG] ${this.timestamp()} ${this.format(message, args)}`
            );
        }
    }

    static info(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.INFO) {
            this.outputChannel.appendLine(
                `[INFO]  ${this.timestamp()} ${this.format(message, args)}`
            );
        }
    }

    static warn(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.WARN) {
            this.outputChannel.appendLine(
                `[WARN]  ${this.timestamp()} ${this.format(message, args)}`
            );
        }
    }

    static error(message: string, error?: Error): void {
        if (this.level <= LogLevel.ERROR) {
            this.outputChannel.appendLine(
                `[ERROR] ${this.timestamp()} ${message}`
            );
            if (error?.stack) {
                this.outputChannel.appendLine(error.stack);
            }
        }
    }

    private static timestamp(): string {
        return new Date().toISOString();
    }

    private static format(message: string, args: any[]): string {
        if (args.length === 0) return message;
        return message + ' ' + args.map(a => 
            typeof a === 'object' ? JSON.stringify(a) : String(a)
        ).join(' ');
    }

    static show(): void {
        this.outputChannel.show();
    }
}
```

**使用示例**:
```typescript
import { Logger } from './logger';

// 在 agent.ts 中
Logger.info('Chat started', { model: conv.model, mode: conv.mode });
Logger.error('API call failed', e);
```

---

### 12. Webview 安全性 — CSP 配置加强

**当前**:
```
script-src 'nonce-${nonce}';
```

**建议**: 限制更严格
```
default-src 'none';
style-src ${webview.cspSource} 'unsafe-inline';
script-src 'nonce-${nonce}';
img-src ${webview.cspSource} https:;
connect-src https:;
font-src ${webview.cspSource};
```

---

### 13. `package.json` — 补充开发依赖

```json
{
    "devDependencies": {
        "@types/vscode": "^1.85.0",
        "@types/node": "^20.0.0",
        "typescript": "^5.3.0",
        "@vscode/vsce": "^2.22.0",
        "@vscode/test-electron": "^2.3.0",
        "jest": "^29.0.0",
        "@types/jest": "^29.0.0",
        "ts-jest": "^29.0.0",
        "eslint": "^8.0.0",
        "@typescript-eslint/eslint-plugin": "^6.0.0",
        "@typescript-eslint/parser": "^6.0.0"
    },
    "scripts": {
        "compile": "tsc -p ./",
        "watch": "tsc -watch -p ./",
        "package": "vsce package",
        "lint": "eslint src --ext .ts",
        "test": "jest --config jest.config.js",
        "test:watch": "jest --watch"
    }
}
```

---

## 📋 优化优先级清单

| 优先级 | 项目 | 难度 | 影响 | 状态 |
|--------|------|------|------|------|
| 🔴 P0 | edit_file 替换 bug | 低 | 功能缺陷 | 待修复 |
| 🔴 P0 | 命令注入绕过 | 低 | 安全风险 | 待修复 |
| 🔴 P0 | 私有方法访问 | 低 | 代码质量 | 待修复 |
| 🔴 P0 | Markdown 双重转义 | 低 | 显示 bug | 待修复 |
| 🟡 P1 | 分离 webview 资源 | 中 | 可维护性 | 待优化 |
| 🟡 P1 | 对话持久化 | 中 | 用户体验 | 待实现 |
| 🟡 P1 | 配置验证 | 低 | 健壮性 | 待实现 |
| 🟡 P1 | 重定向限制 | 低 | 安全 | 待修复 |
| 🟡 P1 | 错误处理优化 | 低 | 代码质量 | 待优化 |
| 🟢 P2 | 单元测试 | 高 | 质量保障 | 待实现 |
| 🟢 P2 | 结构化日志 | 中 | 调试体验 | 待实现 |
| 🟢 P2 | CSP 加强 | 低 | 安全 | 待优化 |

---

## 🚀 快速开始修复

如果时间有限，建议按以下顺序修复（预计 2-3 小时）：

1. **edit_file bug** — 5 分钟
2. **命令注入** — 10 分钟
3. **私有方法访问** — 10 分钟
4. **Markdown 转义** — 15 分钟
5. **配置验证** — 15 分钟
6. **重定向限制** — 10 分钟
7. **错误处理** — 15 分钟
8. **对话持久化** — 30 分钟
9. **结构化日志** — 20 分钟

---

*报告生成时间: 2026-06-01*
