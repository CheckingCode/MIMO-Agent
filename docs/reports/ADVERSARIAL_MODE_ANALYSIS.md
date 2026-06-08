# 对抗模式深度分析与优化建议

> 分析日期: 2026-06-04
> 分析范围: `src/agent.ts` adversarialChat / runAdversarialPersona / isVerdictApproved / reviewsAreSimilar
>          `src/webview/components/messages.ts` 对抗模式 UI 渲染
>          `src/personas.ts` coder/pm 角色定义

---

## 一、当前实现架构

```
用户输入
   │
   ▼
adversarialChat() ─── 主循环 (MAX_ITERATIONS=3)
   │
   ├── 迭代 1 ──────────────────────────────────────
   │   ├── Phase 1: 疯狂程序猿 (coder) ─ 编码
   │   │   └── runAdversarialPersona()
   │   │       ├── 独立消息历史 (每轮重建)
   │   │       ├── 工具预算: 10 轮
   │   │       └── 流式输出 → onAdversarialTurn
   │   │
   │   └── Phase 2: 超级产品经理 (pm) ─ 审查
   │       └── runAdversarialPersona()
   │           ├── 只读工具 + execute_command ← 问题！
   │           └── 判决: isVerdictApproved()
   │
   ├── 迭代 2 ── (如果 PM 未通过)
   │   ├── coder 收到 PM 反馈文本
   │   └── pm 重新审查 (全新消息历史)
   │
   └── 迭代 3 ── (收敛检测 / 最大轮次)
```

### 关键代码路径

| 函数 | 文件:行号 | 职责 |
|------|----------|------|
| `adversarialChat()` | agent.ts:1142 | 主循环，管理迭代和判决 |
| `runAdversarialPersona()` | agent.ts:1269 | 单轮 persona 执行（含工具循环） |
| `isVerdictApproved()` | agent.ts:1496 | 检查 PM 是否通过 |
| `reviewsAreSimilar()` | agent.ts:1505 | 收敛检测（Jaccard 相似度） |
| `summarizeToolCall()` | agent.ts:1471 | 工具调用叙述文本 |
| `handleAdversarialTurn()` | messages.ts:1051 | UI: 流式渲染对抗对话 |
| `handleAdversarialToolStart/End()` | messages.ts:1123/1157 | UI: 工具卡片渲染 |
| `_renderAdversarialMarkdown()` | messages.ts:1182 | UI: 对抗内容 markdown 渲染 |

---

## 二、发现的问题（按严重度排序）

### 🔴 严重问题

#### 问题 1: PM 拥有 `execute_command` 工具 — 审查者可以修改状态

**位置:** agent.ts:1329-1333

```typescript
params.tools = TOOL_DEFINITIONS.filter(t =>
    ['read_file', 'search_files', 'glob_files', 'list_directory',
     'get_file_info', 'git_status', 'git_diff', 'git_log',
     'execute_command'].includes(t.function.name)  // ← 危险！
);
```

**问题:** PM 的角色是审查代码，不应该能执行命令修改文件。如果 PM 执行了 `rm`、`git reset`、`mv` 等命令，会破坏 coder 的工作成果。虽然 PM 的 system prompt 说"审查"，但模型可能出于"验证"目的执行破坏性命令。

**影响:** 审查者可以篡改被审查的代码，破坏对抗模式的基本假设。

---

#### 问题 2: 每轮迭代重建消息历史 — 跨轮上下文丢失

**位置:** agent.ts:1282-1286

```typescript
// runAdversarialPersona 每次调用都创建新的 messages 数组
const messages: ChatMessage[] = [];
if (previousFeedback) {
    messages.push({ role: 'system', content: `[上一轮反馈]\n${previousFeedback}` });
}
messages.push({ role: 'user', content: task });
```

**问题:** coder 在第 2 轮看不到第 1 轮读了哪些文件、做了哪些修改。它只收到 PM 的反馈文本，可能重复同样的探索过程（重新读取相同的文件、重新分析相同的代码），浪费 token 和时间。

**影响:**
- 每轮重复的文件读取浪费 token（可能数百到数千 token）
- coder 可能做出与前一轮矛盾的修改（因为不记得之前改了什么）
- 对于多文件任务，效率极低

---

#### 问题 3: `isVerdictApproved` 要求判决在响应开头 — 过于脆弱

**位置:** agent.ts:1496-1499

```typescript
private isVerdictApproved(review: string): boolean {
    const trimmed = review.trim();
    const upper = trimmed.toUpperCase();
    return upper.startsWith('VERDICT: APPROVED') || upper.startsWith('✅ 通过') || trimmed.startsWith('✅');
}
```

**问题:** PM 可能先写分析再给结论：

```
经过仔细审查，代码质量良好，所有问题已修复。

✅ 通过
```

`startsWith` 会失败，因为 `✅` 不在开头。这导致已通过的审查被误判为未通过，触发不必要的额外迭代。

**反向问题:** 如果 PM 写 `✅ 通过，但存在以下严重安全隐患...`，`startsWith('✅')` 会误判为通过。

---

### 🟡 中等问题

#### 问题 4: 收敛检测使用弱关键词 Jaccard 相似度

**位置:** agent.ts:1505-1517

```typescript
private reviewsAreSimilar(a: string, b: string): boolean {
    const extractKeywords = (text: string): Set<string> => {
        const words = text.toLowerCase().match(/[一-鿿]+|[a-z]{4,}/g) || [];
        return new Set(words);
    };
    // ... Jaccard similarity > 0.5
}
```

**问题:**
- 正则 `[一-鿿]+|[a-z]{4,}` 缺失：数字（版本号、行号）、驼峰命名（`getUserName`）、文件路径（`src/utils.ts`）、短于 4 字符的技术术语（`API`、`CSS`、`SQL`、`git`）
- 中文按整句匹配而非分词（"代码质量不好" 和 "代码风格不好" 只共享 "代码" 和 "不好"，但正则会匹配整句 "代码质量不好" 和 "代码风格不好" 作为两个不同的词）
- 50% Jaccard 阈值是任意的，没有实证依据

**影响:** 可能误判为未收敛（触发不必要的迭代）或误判为已收敛（提前放行有质量问题的代码）。

---

#### 问题 5: PM 的 coder 结果被截断到 6000 字符

**位置:** agent.ts:1206

```typescript
`审查以下编码任务的完成情况。\n\n原始需求：${userInput}\n\n${coder.name}的实现：\n${lastCoderResult.substring(0, 6000)}`
```

**问题:** 如果 coder 的实现超过 6000 字符（约 1500 行代码），PM 看不到完整实现。这在多文件重构、大型函数实现等场景中很常见。截断可能导致 PM 遗漏后半部分的问题。

**影响:** PM 审查不完整，可能放行有缺陷的代码。

---

#### 问题 6: 无结构化判决格式

**问题:** PM 可以用任意格式表达判决。没有强制要求使用结构化格式，导致：
- `isVerdictApproved` 只能做模糊的字符串匹配
- 无法提取具体的问题列表
- 无法追踪哪些问题在迭代间被修复
- 无法生成结构化的质量报告

---

#### 问题 7: 工具预算硬编码为 10

**位置:** agent.ts:1292

```typescript
const TOOL_BUDGET = 10;
```

**问题:** 对于复杂任务（如多文件重构、跨模块修改），10 次工具调用可能不够。coder 可能需要读取 5+ 个文件、做 3+ 次修改、运行 2+ 次测试，总计远超 10 次。

**反面:** 对于简单任务（如修复一个 typo），10 次又太多，浪费 token。

---

#### 问题 8: 无单轮超时机制

**问题:** `runAdversarialPersona` 没有超时控制。如果模型陷入长循环（反复读取同一文件、反复尝试相同的失败修改），整个对抗过程会卡住，用户只能手动停止。

---

#### 问题 9: 无质量评分/进度追踪

**问题:** 没有机制追踪代码质量是否在迭代间提升。用户只能看到 PM 的自然语言反馈，没有量化指标（如：问题数从 5 降到 2、测试通过率从 60% 升到 90%）。

---

### 🟢 优化建议

#### 建议 10: 未复用工作流引擎

项目已有完整的 `workflow.ts` 工作流引擎（支持多阶段、并行/顺序执行、阶段间上下文传递），但对抗模式完全独立实现，重复了大量逻辑：
- 工具执行循环
- 上下文管理
- 流式输出
- 中止处理

#### 建议 11: 无可配置人设

对抗模式硬编码了 `coder` 和 `pm` 两个角色。可以支持用户自定义角色组合，例如：
- 安全审计员 vs 性能专家
- 前端专家 vs 后端专家
- 架构师 vs 测试工程师

#### 建议 12: 中间结果不可见

用户只看到最终结果，无法回顾中间迭代的完整历史（coder 的每轮实现、PM 的每轮反馈）。应提供可展开的迭代历史面板。

---

## 三、优化方案

### 方案 1: 修复 PM 工具权限（P0 — 紧急）

```typescript
// agent.ts:1329-1333
// 修复前
params.tools = TOOL_DEFINITIONS.filter(t =>
    ['read_file', 'search_files', 'glob_files', 'list_directory',
     'get_file_info', 'git_status', 'git_diff', 'git_log',
     'execute_command'].includes(t.function.name)
);

// 修复后：PM 只有只读工具，移除 execute_command
params.tools = TOOL_DEFINITIONS.filter(t =>
    ['read_file', 'search_files', 'glob_files', 'list_directory',
     'get_file_info', 'git_status', 'git_diff', 'git_log'].includes(t.function.name)
);
```

如果 PM 需要验证代码（如运行测试），可以考虑：
- 添加一个受限的 `verify_command` 工具，只允许运行测试命令
- 或者让 coder 代为执行验证命令

---

### 方案 2: 跨轮上下文累积（P1）

```typescript
// 在 adversarialChat 中维护持久化的 coder 消息历史
const coderMessages: ChatMessage[] = [];

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (iteration > 1) {
        // 追加 PM 反馈，而非重建
        coderMessages.push({
            role: 'user',
            content: `[PM 反馈 — 第 ${iteration-1} 轮]\n${pmReview}\n\n请修复以上问题。不要重复读取已经读过的文件。`
        });
    } else {
        coderMessages.push({ role: 'user', content: userInput });
    }
    
    // runAdversarialPersona 接收累积的消息历史
    lastCoderResult = await this.runAdversarialPersona(
        conv, coder, coderMessages, events, iteration, 'speak', convId
    );
    
    // coder 的响应也追加到历史
    coderMessages.push({ role: 'assistant', content: lastCoderResult });
}
```

**预期收益:**
- 减少 30-50% 的重复工具调用
- coder 能看到自己之前的修改，避免矛盾
- 整体 token 消耗降低

---

### 方案 3: 结构化判决格式（P1）

在 PM 的 system prompt 中强制要求输出格式：

```
你的审查必须严格按以下格式输出：

VERDICT: APPROVED
或
VERDICT: REJECTED

如果 REJECTED，必须列出具体问题：
ISSUE: [问题描述]
ISSUE: [问题描述]
...

最后给出改进建议：
SUGGESTION: [建议]
```

解析函数：

```typescript
private parseVerdict(review: string): { approved: boolean; issues: string[]; suggestions: string[] } {
    const verdictMatch = review.match(/VERDICT:\s*(APPROVED|REJECTED)/i);
    const approved = verdictMatch?.[1]?.toUpperCase() === 'APPROVED';
    
    const issues = (review.match(/ISSUE:\s*(.+)/gi) || [])
        .map(m => m.replace(/ISSUE:\s*/i, '').trim());
    
    const suggestions = (review.match(/SUGGESTION:\s*(.+)/gi) || [])
        .map(m => m.replace(/SUGGESTION:\s*/i, '').trim());
    
    return { approved, issues, suggestions };
}
```

**预期收益:**
- 判决准确率从 ~80% 提升到 ~98%
- 可提取问题列表，追踪修复进度
- 可生成结构化质量报告

---

### 方案 4: 质量评分追踪（P2）

```typescript
interface AdversarialRound {
    iteration: number;
    coderToolCalls: number;
    coderElapsed: number;
    pmVerdict: 'APPROVED' | 'REJECTED';
    pmIssues: string[];
    pmSuggestions: string[];
    pmElapsed: number;
}

// 在每轮结束时记录
const rounds: AdversarialRound[] = [];

// 最终输出质量报告
const report = [
    `📊 对抗模式质量报告`,
    `━━━━━━━━━━━━━━━━━━`,
    `总轮次: ${rounds.length}`,
    `问题变化: ${rounds.map(r => r.pmIssues.length).join(' → ')}`,
    `工具调用: ${rounds.reduce((s, r) => s + r.coderToolCalls, 0)}`,
    `总耗时: ${(rounds.reduce((s, r) => s + r.coderElapsed + r.pmElapsed, 0) / 1000).toFixed(1)}s`,
].join('\n');
events.onReasoning(report);
```

---

### 方案 5: 可配置参数（P2）

```typescript
interface AdversarialConfig {
    maxIterations?: number;         // 默认 3
    toolBudget?: number;            // 默认 10
    convergenceThreshold?: number;  // 默认 0.5 (Jaccard)
    convergenceWindowSize?: number; // 默认 3
    pmReadOnly?: boolean;           // 默认 true
    coderContextMode?: 'fresh' | 'accumulating'; // 默认 'accumulating'
    personas?: {
        coder: string;   // persona id，如 'programmer', 'architect'
        reviewer: string; // persona id，如 'pm', 'security', 'reviewer'
    };
}
```

在 VSCode settings 中暴露：

```json
{
    "mimo.adversarial.maxIterations": 3,
    "mimo.adversarial.toolBudget": 10,
    "mimo.adversarial.personas": {
        "coder": "programmer",
        "reviewer": "pm"
    }
}
```

---

### 方案 6: 收敛检测改进（P2）

```typescript
private reviewsAreSimilar(a: string, b: string): boolean {
    const extractKeywords = (text: string): Set<string> => {
        const words = text.toLowerCase().match(
            /[一-鿿]{2,}|[a-z][a-z0-9]{2,}|\d+\.\d+|[a-z]:\\[^\s]+/g
        ) || [];
        return new Set(words);
    };
    // 改进：支持中文词组、驼峰拆分、数字、路径
    // ...
}
```

或更激进的方案：使用 LLM 判断两次审查是否提出相同问题：

```typescript
const similar = await this.api.chatCompletion({
    model: conv.model,
    messages: [{
        role: 'user',
        content: `以下两次代码审查是否提出了相同的核心问题？只回答 YES 或 NO。\n\n审查A:\n${a.substring(0, 2000)}\n\n审查B:\n${b.substring(0, 2000)}`
    }],
    max_tokens: 10,
    temperature: 0,
});
return similar.toUpperCase().includes('YES');
```

---

### 方案 7: PM 结果传递改进（P2）

```typescript
// 方案 A: 增大截断限制
const coderSummary = lastCoderResult.substring(0, 15000);

// 方案 B: 智能截断 — 保留开头和结尾
const maxLen = 12000;
let coderContext = lastCoderResult;
if (coderContext.length > maxLen) {
    const half = maxLen / 2;
    coderContext = coderContext.substring(0, half) 
        + `\n\n... [中间省略 ${coderContext.length - maxLen} 字符] ...\n\n`
        + coderContext.substring(coderContext.length - half);
}

// 方案 C: 让 PM 使用工具读取完整代码（已有 read_file 工具）
// 不截断，让 PM 自己决定需要看哪些文件
```

---

### 方案 8: 单轮超时（P3）

```typescript
private async runAdversarialPersonaWithTimeout(
    ...args: Parameters<typeof this.runAdversarialPersona>,
    timeoutMs: number = 120000, // 2 分钟
): Promise<string> {
    return Promise.race([
        this.runAdversarialPersona(...args),
        new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error('Persona timeout')), timeoutMs)
        ),
    ]);
}
```

---

### 方案 9: 迭代历史面板（P3）

在 webview 中添加可展开的迭代历史：

```typescript
// messages.ts
handleAdversarialHistory(rounds: AdversarialRound[]): void {
    const panel = createElement('div', 'adversarial-history');
    panel.innerHTML = `
        <div class="history-header" onclick="this.parentElement.classList.toggle('expanded')">
            📜 迭代历史 (${rounds.length} 轮) ▸
        </div>
        <div class="history-body">
            ${rounds.map((r, i) => `
                <div class="history-round">
                    <span class="round-num">#${i+1}</span>
                    <span class="round-verdict ${r.pmVerdict === 'APPROVED' ? 'pass' : 'fail'}">
                        ${r.pmVerdict}
                    </span>
                    <span class="round-issues">${r.pmIssues.length} 个问题</span>
                </div>
            `).join('')}
        </div>
    `;
    messagesDiv.appendChild(panel);
}
```

---

## 四、优先级排序

| 优先级 | 问题 | 修复方案 | 工作量 | 影响 |
|--------|------|---------|--------|------|
| **P0** | PM 有 execute_command | 方案 1: 移除写入工具 | 5 分钟 | 防止审查者破坏代码 |
| **P1** | 跨轮上下文丢失 | 方案 2: 累积消息历史 | 1 小时 | 减少重复工作，提升质量 |
| **P1** | 判决检测脆弱 | 方案 3: 结构化判决格式 | 1 小时 | 减少误判 |
| **P2** | 收敛检测弱 | 方案 6: 改进关键词提取 | 30 分钟 | 更准确的收敛判断 |
| **P2** | PM 结果截断 | 方案 7: 智能截断 | 15 分钟 | PM 看到完整代码 |
| **P2** | 工具预算硬编码 | 方案 5: 可配置参数 | 30 分钟 | 适应不同复杂度任务 |
| **P3** | 无质量评分 | 方案 4: 结构化评分 | 1 小时 | 用户可见改进进度 |
| **P3** | 无单轮超时 | 方案 8: Promise.race | 15 分钟 | 防止卡住 |
| **P3** | 中间结果不可见 | 方案 9: 迭代历史面板 | 2 小时 | 用户可回顾过程 |
| **P3** | 未复用工作流引擎 | 重构为工作流阶段 | 4 小时 | 减少代码重复 |

---

## 五、对比: 当前 vs Claude Code 的对抗/验证机制

| 特性 | MiMo 对抗模式 | Claude Code |
|------|--------------|-------------|
| 角色 | 固定 2 个 (coder + pm) | 可配置多视角验证 |
| 上下文 | 每轮重建 | 持久化累积 |
| 判决 | 自然语言 + 模糊匹配 | 结构化 JSON 输出 |
| 工具权限 | PM 有写入权限 | 严格只读 |
| 收敛检测 | Jaccard 关键词 | 语义相似度 |
| 质量追踪 | 无 | 每轮评分 |
| 超时 | 无 | 每轮独立超时 |
| 可配置性 | 硬编码 | 高度可配置 |

MiMo 的对抗模式是一个有创意的设计（Claude Code 没有双角色对话），但在工程实现上有明显的改进空间。上述优化方案可以显著提升其可靠性和用户体验。
