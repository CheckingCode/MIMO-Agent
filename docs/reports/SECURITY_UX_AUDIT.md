# MiMo Agent 安全漏洞与用户体验审计报告

**审计日期**: 2026-06-09  
**审计范围**: 安全漏洞、数据保护、用户体验不足  
**代码版本**: v1.4.5  

---

## 📊 审计摘要

| 类别 | 发现数量 | 严重程度 |
|------|----------|----------|
| 🔴 严重安全漏洞 | 2 | 高 |
| 🟡 中等安全问题 | 4 | 中 |
| 🟢 低风险问题 | 3 | 低 |
| 😊 用户体验问题 | 5 | 中 |

---

## 🔴 严重安全漏洞

### 1. MCP 服务器环境变量泄露风险

**位置**: `src/mcp.ts:77-81`

```typescript
const env = { ...process.env, ...this.config.env };
this.process = spawn(this.config.command, this.config.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
});
```

**问题**: 
- 将整个 `process.env` 传递给外部 MCP 服务器进程
- 可能泄露敏感环境变量（API 密钥、数据库密码等）
- 恶意 MCP 服务器可以读取所有环境变量

**风险等级**: 🔴 严重  
**影响**: 敏感信息泄露、凭证被盗

**修复建议**:
```typescript
// 只传递必要的环境变量
const safeEnvVars = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL'];
const safeEnv: Record<string, string> = {};
for (const key of safeEnvVars) {
    if (process.env[key]) {
        safeEnv[key] = process.env[key]!;
    }
}
const env = { ...safeEnv, ...this.config.env };
```

---

### 2. 命令注入绕过风险

**位置**: `src/safety.ts:350-420`

**问题**: 
虽然实现了多层命令安全检查，但存在以下绕过风险：

1. **编码绕过**: Unicode 字符可能绕过正则表达式检查
   ```bash
   # 示例：使用 Unicode 字符绕过
   rm -rf /  # 被阻止
   ｒｍ -rf /  # 可能绕过（全角字符）
   ```

2. **变量展开绕过**: 
   ```bash
   # 示例：使用变量展开
   cmd="rm -rf /"
   eval $cmd  # 可能绕过检查
   ```

3. **多命令链接绕过**:
   ```bash
   # 示例：使用换行符或分号
   ls; rm -rf /  # 可能绕过单命令检查
   ```

**风险等级**: 🔴 严重  
**影响**: 任意命令执行、系统破坏

**修复建议**:
```typescript
// 1. 添加 Unicode 规范化
function normalizeCommand(cmd: string): string {
    return cmd.normalize('NFKC').replace(/[\uFF00-\uFFEF]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
    });
}

// 2. 检查所有命令分隔符
const COMMAND_SEPARATORS = /[;&|`$\n\r]/;
if (COMMAND_SEPARATORS.test(cmd)) {
    return { blocked: true, reason: '检测到命令分隔符' };
}

// 3. 递归检查所有子命令
function checkAllSubCommands(cmd: string): boolean {
    const subCommands = cmd.split(/[;&|]+/);
    return subCommands.every(sub => isCommandSafe(sub.trim()).safe);
}
```

---

## 🟡 中等安全问题

### 3. API 密钥内存暴露

**位置**: `src/api.ts:113`, `src/config.ts:109-116`

**问题**: 
- API 密钥在内存中以明文形式存储
- 可能通过内存转储、调试器或日志泄露
- 没有实现密钥轮换或过期机制

**风险等级**: 🟡 中等  
**影响**: API 密钥泄露、未授权访问

**修复建议**:
```typescript
// 1. 使用加密存储
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

class SecureKeyStore {
    private key: Buffer;
    private encryptedKeys: Map<string, Buffer> = new Map();
    
    constructor(masterKey: Buffer) {
        this.key = masterKey;
    }
    
    storeKey(id: string, apiKey: string): void {
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(apiKey, 'utf8'),
            cipher.final()
        ]);
        this.encryptedKeys.set(id, Buffer.concat([iv, encrypted]));
    }
    
    getKey(id: string): string | null {
        const data = this.encryptedKeys.get(id);
        if (!data) return null;
        const iv = data.slice(0, 16);
        const encrypted = data.slice(16);
        const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
        return Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]).toString('utf8');
    }
}

// 2. 实现密钥轮换
interface ApiKeyMetadata {
    createdAt: Date;
    expiresAt: Date;
    lastUsed: Date;
    rotationCount: number;
}
```

---

### 4. 内存系统敏感数据过滤不完整

**位置**: `src/memory.ts:31-36`

```typescript
const SECRET_PATTERNS = [
    /sk-[a-z0-9_-]{12,}/i,
    /(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
    /\b[A-Za-z0-9+/]{32,}={0,2}\b/,
];
```

**问题**: 
- 只过滤了部分敏感数据模式
- 可能遗漏其他类型的密钥（AWS、Azure、GCP 等）
- Base64 模式过于宽泛，可能误判

**风险等级**: 🟡 中等  
**影响**: 敏感数据持久化存储

**修复建议**:
```typescript
const SECRET_PATTERNS = [
    // 通用密钥格式
    /sk-[a-z0-9_-]{12,}/i,
    /(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/i,
    
    // 云服务商特定格式
    /AKIA[0-9A-Z]{16}/,  // AWS Access Key
    /(?:AWS|aws).*(?:secret|key).*(?:=|:).{20,}/i,
    /(?:Azure|azure).*(?:key|secret).*(?:=|:).{20,}/i,
    
    // 私钥
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
    
    // JWT Token
    /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./,
    
    // 数据库连接字符串
    /(?:mongodb|postgres|mysql|redis):\/\/.*@/i,
    
    // 通用长字符串（提高阈值）
    /\b[A-Za-z0-9+/]{64,}={0,2}\b/,
];
```

---

### 5. 文件路径遍历防护不足

**位置**: `src/safety.ts:443-458`

```typescript
export function isPathSafe(filePath: string, workspace: string): { safe: boolean; reason: string } {
    const resolved = path.resolve(filePath);
    const wsResolved = path.resolve(workspace);
    const rel = path.relative(wsResolved, resolved);

    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        return { safe: false, reason: `Path is outside workspace: ${resolved}` };
    }
    // ...
}
```

**问题**: 
- 只检查了 `..` 路径遍历
- 没有处理符号链接（symlink）绕过
- 没有规范化 Unicode 字符

**风险等级**: 🟡 中等  
**影响**: 访问工作区外的文件

**修复建议**:
```typescript
export function isPathSafe(filePath: string, workspace: string): { safe: boolean; reason: string } {
    // 1. 规范化路径（处理 Unicode）
    const normalizedInput = path.normalize(filePath);
    
    // 2. 解析绝对路径
    const resolved = path.resolve(workspace, normalizedInput);
    
    // 3. 检查符号链接
    try {
        const realPath = fs.realpathSync(resolved);
        const realWorkspace = fs.realpathSync(workspace);
        
        if (!realPath.startsWith(realWorkspace)) {
            return { safe: false, reason: `符号链接指向工作区外: ${realPath}` };
        }
    } catch (err) {
        // 文件不存在，继续检查路径本身
    }
    
    // 4. 检查路径遍历
    const wsResolved = path.resolve(workspace);
    const rel = path.relative(wsResolved, resolved);
    
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        return { safe: false, reason: `Path is outside workspace: ${resolved}` };
    }
    
    // 5. 检查受保护目录
    for (const p of PROTECTED_DIRS) {
        const pResolved = path.resolve(p);
        if (isSameOrInsidePath(resolved, pResolved)) {
            return { safe: false, reason: `路径在受保护目录: ${p}` };
        }
    }
    
    return { safe: true, reason: '' };
}
```

---

### 6. 日志敏感信息泄露

**位置**: `src/sandbox.ts:130-140`

```typescript
const logFile = path.join(LOG_DIR, `commands-${date}.log`);
const entry = [
    `[${new Date().toISOString()}]`,
    `workspace: ${workspace}`,
    `command: ${command}`,
    `exit_code: ${result.code}`,
    // ...
];
```

**问题**: 
- 命令日志可能包含敏感信息（密码、密钥等）
- 日志文件没有访问权限控制
- 没有日志轮转和清理机制

**风险等级**: 🟡 中等  
**影响**: 敏感信息持久化存储

**修复建议**:
```typescript
// 1. 敏感信息脱敏
function sanitizeCommand(cmd: string): string {
    // 移除可能的密码
    let sanitized = cmd.replace(/(-p|--password|--passwd)\s+\S+/gi, '$1 [REDACTED]');
    // 移除环境变量赋值中的敏感值
    sanitized = sanitized.replace(/(API_KEY|SECRET|TOKEN|PASSWORD)=\S+/gi, '$1=[REDACTED]');
    return sanitized;
}

// 2. 设置日志文件权限
function initLogDir(): void {
    if (logInitialized) return;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 }); // 只有所有者可访问
        logInitialized = true;
    } catch {
        // ...
    }
}

// 3. 实现日志轮转
function rotateLogs(): void {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 天
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    
    for (const file of files) {
        const filePath = path.join(LOG_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
        }
    }
}
```

---

## 🟢 低风险问题

### 7. HTTP 请求超时配置不合理

**位置**: `src/api.ts:145, 236`

```typescript
timeout: 60_000,  // 非流式请求
timeout: 120_000, // 流式请求
```

**问题**: 
- 超时时间过长，可能导致资源耗尽
- 没有实现请求取消机制

**风险等级**: 🟢 低  
**影响**: 资源耗尽、用户体验差

**修复建议**:
```typescript
// 1. 动态超时配置
interface TimeoutConfig {
    connect: number;    // 连接超时
    read: number;       // 读取超时
    total: number;      // 总超时
}

const DEFAULT_TIMEOUT: TimeoutConfig = {
    connect: 5_000,     // 5 秒
    read: 30_000,       // 30 秒
    total: 60_000,      // 1 分钟
};

// 2. 实现请求取消
class CancellableRequest {
    private controller: AbortController | null = null;
    
    cancel(): void {
        if (this.controller) {
            this.controller.abort();
            this.controller = null;
        }
    }
    
    async fetch(url: string, options: RequestInit): Promise<Response> {
        this.controller = new AbortController();
        return fetch(url, { ...options, signal: this.controller.signal });
    }
}
```

---

### 8. 错误信息泄露内部细节

**位置**: `src/agentErrors.ts`

**问题**: 
- 某些错误信息可能泄露内部实现细节
- 没有区分用户可见错误和开发者可见错误

**风险等级**: 🟢 低  
**影响**: 信息泄露

**修复建议**:
```typescript
// 1. 分离用户错误和开发者错误
interface ErrorDisplay {
    userMessage: string;      // 显示给用户
    developerMessage: string; // 记录到日志
    errorCode: string;        // 错误代码
}

// 2. 根据环境显示不同详细程度
function getErrorDisplay(error: Error, isDev: boolean): ErrorDisplay {
    const base = getFriendlyError(error);
    
    return {
        userMessage: isDev ? base.message : '操作失败，请稍后重试',
        developerMessage: base.message,
        errorCode: base.code,
    };
}
```

---

### 9. 依赖版本固定

**位置**: `package.json`

**问题**: 
- 某些依赖使用了宽松版本范围
- 可能引入有漏洞的依赖版本

**风险等级**: 🟢 低  
**影响**: 供应链攻击

**修复建议**:
```json
{
    "dependencies": {
        "vscode": "^1.74.0"  // 宽松
    }
}
```

改为：
```json
{
    "dependencies": {
        "vscode": "1.74.0"  // 固定版本
    }
}
```

---

## 😊 用户体验问题

### 10. 错误恢复指导不足

**问题**: 
- 错误消息虽然友好，但缺少具体恢复步骤
- 用户不知道如何修复问题

**改进建议**:
```typescript
interface ErrorRecovery {
    message: string;
    actions: RecoveryAction[];
    documentation?: string;
}

interface RecoveryAction {
    label: string;
    description: string;
    command?: string;
}

// 示例
const API_KEY_MISSING: ErrorRecovery = {
    message: 'API 密钥未配置',
    actions: [
        {
            label: '打开设置',
            description: '在 VS Code 设置中配置 API 密钥',
            command: 'workbench.action.openSettings',
        },
        {
            label: '查看文档',
            description: '了解如何获取 API 密钥',
        },
    ],
    documentation: 'https://docs.example.com/api-key-setup',
};
```

---

### 11. 进度反馈不清晰

**问题**: 
- 长时间操作缺乏详细进度
- 用户不知道当前处于哪个阶段

**改进建议**:
```typescript
interface ProgressInfo {
    stage: string;           // 当前阶段
    progress: number;        // 进度百分比 (0-100)
    estimatedTime?: number;  // 预计剩余时间（秒）
    details?: string;        // 详细信息
}

// 示例
const stages: ProgressInfo[] = [
    { stage: '分析代码', progress: 0, details: '正在读取文件...' },
    { stage: '分析代码', progress: 30, details: '已读取 5/10 个文件' },
    { stage: '生成修复', progress: 60, details: '正在生成修复方案...' },
    { stage: '应用修复', progress: 90, details: '正在写入文件...' },
    { stage: '完成', progress: 100, details: '已修复 3 个问题' },
];
```

---

### 12. 确认对话框信息不足

**问题**: 
- 危险操作确认对话框缺少详细信息
- 用户无法做出明智决定

**改进建议**:
```typescript
interface ConfirmationDialog {
    title: string;
    message: string;
    details: string[];
    risks: string[];
    alternatives?: string[];
    confirmLabel: string;
    cancelLabel: string;
}

// 示例
const DELETE_CONFIRMATION: ConfirmationDialog = {
    title: '确认删除文件',
    message: '即将删除以下文件：',
    details: [
        '• src/old-module.ts (2.3 KB)',
        '• src/old-module.test.ts (1.1 KB)',
    ],
    risks: [
        '⚠️ 此操作不可撤销',
        '⚠️ 可能影响其他模块的导入',
    ],
    alternatives: [
        '考虑重命名而非删除',
        '先备份到其他位置',
    ],
    confirmLabel: '确认删除',
    cancelLabel: '取消',
};
```

---

### 13. 学习曲线陡峭

**问题**: 
- 新用户不知道如何开始
- 缺少引导教程

**改进建议**:
```typescript
// 1. 首次使用引导
interface OnboardingStep {
    id: string;
    title: string;
    content: string;
    action?: string;
    highlight?: string; // 高亮的 UI 元素
}

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: 'welcome',
        title: '欢迎使用 MiMo Agent',
        content: '我是你的 AI 编程助手，让我帮你提高开发效率。',
    },
    {
        id: 'first-task',
        title: '尝试第一个任务',
        content: '在聊天框中输入你的需求，例如："帮我优化这段代码的性能"',
        action: '打开聊天',
        highlight: 'chat-input',
    },
    // ...
];

// 2. 上下文帮助
function getContextualHelp(context: {
    fileType?: string;
    recentAction?: string;
    errorOccurred?: boolean;
}): string {
    if (context.errorOccurred) {
        return '遇到问题？点击这里查看常见解决方案';
    }
    if (context.fileType === '.ts') {
        return '提示：你可以让我帮你添加类型定义';
    }
    return '';
}
```

---

## 📋 修复优先级

### 立即修复（1-2 天）
1. ✅ MCP 服务器环境变量泄露（漏洞 1）
2. ✅ 命令注入绕过（漏洞 2）
3. ✅ 日志敏感信息脱敏（问题 6）

### 短期修复（1-2 周）
4. ✅ API 密钥加密存储（问题 3）
5. ✅ 内存系统敏感数据过滤（问题 4）
6. ✅ 文件路径遍历防护（问题 5）

### 中期改进（1 个月）
7. ✅ 错误恢复指导（问题 10）
8. ✅ 进度反馈优化（问题 11）
9. ✅ 确认对话框增强（问题 12）

### 长期规划
10. ✅ 新用户引导（问题 13）
11. ✅ 依赖版本管理（问题 9）
12. ✅ HTTP 超时优化（问题 7）

---

## 🔧 验证检查清单

### 安全验证
- [ ] MCP 服务器只接收必要环境变量
- [ ] 命令安全检查覆盖所有绕过场景
- [ ] API 密钥加密存储且内存中及时清理
- [ ] 日志文件不包含敏感信息
- [ ] 文件路径检查包含符号链接验证
- [ ] 内存系统过滤所有敏感数据模式

### 功能验证
- [ ] 错误消息提供具体恢复步骤
- [ ] 长时间操作显示详细进度
- [ ] 确认对话框包含完整信息
- [ ] 新用户引导流程完整

### 测试用例
```typescript
// 命令注入测试
describe('Command Safety', () => {
    it('should block Unicode bypass attempts', () => {
        expect(isCommandSafe('ｒｍ -rf /').blocked).toBe(true);
    });
    
    it('should block variable expansion', () => {
        expect(isCommandSafe('eval $cmd').blocked).toBe(true);
    });
    
    it('should block command chaining', () => {
        expect(isCommandSafe('ls; rm -rf /').blocked).toBe(true);
    });
});

// 路径遍历测试
describe('Path Safety', () => {
    it('should block symlink traversal', () => {
        // 创建符号链接指向工作区外
        fs.symlinkSync('/etc/passwd', '/workspace/link');
        expect(isPathSafe('/workspace/link', '/workspace').safe).toBe(false);
    });
});
```

---

## 📚 参考资源

- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [VS Code Extension Security](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#extension-security)

---

**审计完成时间**: 2026-06-09  
**审计人员**: MiMo Agent Security Audit  
**下次审计**: 2026-07-09
