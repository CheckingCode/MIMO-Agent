# MiMo Agent 四种模式深度分析与优化建议

> 分析日期: 2026-06-04
> 分析范围: Auto / Plan / Polling / Adversarial 四种模式的理论预期、实现逻辑、问题与优化

---

## 一、模式架构总览

```
用户输入
   │
   ▼
agent.chat(convId)
   │
   ├── mode === 'adversarial'?
   │   └── YES → adversarialChat() [独立方法，跳过路由]
   │
   ├── classifyIntent() ← router.ts (API 调用)
   │   └── needsTools === false?
   │       └── YES → handleDirectResponse() [单次 API，无工具]
   │
   └── 进入工具循环 (max 50 rounds)
       │
       ├── mode === 'plan' && !planConfirmed?
       │   └── 禁用工具，输出纯文本计划 → 保存 Plan.md → 等待用户确认
       │
       ├── mode === 'plan' && planConfirmed?
       │   └── 启用工具，按 Plan.md 执行
       │
       ├── mode === 'polling'?
       │   └── 禁用并行，edit/write 需用户预览确认
       │
       └── mode === 'auto' (默认)
           └── 标准工具循环，并行读取，顺序写入
```

---

## 二、各模式详细分析

### 2.1 Auto 模式（默认）

**理论预期:** 最高效的模式。模型自主分析需求、读取文件、编写代码，无需用户干预。适合简单到中等复杂度的任务。

**实际实现:**

1. **意图路由** (router.ts): 先用一次廉价 API 调用分类用户输入
   - `greeting`/`question`/`explanation` → 跳过工具，直接回答
   - `code_task`/`refactor`/`debug`/`search` → 进入工具循环

2. **系统提示** (agent.ts:693): `[Mode: Auto] 快速分析需求，直接动手实现。不要过度探索，直接开始写代码。`

3. **工具循环**: 最多 50 轮，只读工具并行（最多 6 个），写入工具顺序执行

**问题:**

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| A1 | 意图路由消耗额外 API 调用 | 中 | 每次用户输入都先调一次路由 API（~150 token），简单任务如 "hi" 也要等路由响应 |
| A2 | 路由分类不准确时回退太保守 | 低 | 路由失败时默认 `needsTools=true`，可能导致简单问题触发不必要的工具调用 |
| A3 | 无进度反馈机制 | 低 | 50 轮工具循环中，用户只看到工具卡片，不知道整体进度 |
| A4 | 系统提示过于通用 | 低 | Auto 模式的系统提示没有针对任务类型做差异化（如 debug 任务应该先看错误日志） |

**与 Claude Code 对比:**
- Claude Code 没有意图路由，所有输入都进入工具循环 — 更简单但可能浪费 token
- Claude Code 有更强的上下文感知（自动索引代码库），Auto 模式没有

---

### 2.2 Plan 模式

**理论预期:** 先规划后执行。模型先输出结构化计划，用户确认后再执行。适合复杂任务、多文件重构、架构变更。

**实际实现:**

**Phase 1 — 规划** (agent.ts:657-683):
- 禁用所有工具 (`tools = undefined`)
- 系统提示要求输出结构化 markdown 计划
- 模型只能输出文本，不能读写文件

**Phase 1 完成** (chatProvider.ts:655-664):
- 自动将计划保存到工作区 `Plan.md`
- 发送 `planReady` 消息到 webview

**Phase 1 UI** (messages.ts:1009-1042):
- 显示计划确认卡片：「确认执行」/「拒绝重新规划」

**Phase 2 — 执行** (agent.ts:684-688):
- 启用工具
- 系统提示：「用户已确认 Plan.md 中的计划。严格按照计划执行。」

**问题:**

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| P1 | `planConfirmed` 执行后不重置 | **高** | 用户在同一个对话中发送第二个请求时，直接进入 Phase 2（带工具），不会再生成新计划。用户以为会重新规划，实际上直接执行了。 |
| P2 | Plan.md 无条件保存 | 中 | 即使模型输出错误/空内容，也会保存到 Plan.md，可能覆盖之前的有效计划 |
| P3 | Phase 2 不验证计划执行进度 | 中 | 模型收到「按计划执行」后，没有机制检查是否真的按步骤执行了，也没有进度追踪 |
| P4 | 拒绝后需手动重新输入 | 低 | 用户点击「拒绝」后，必须自己重新描述需求，没有「修改计划」选项 |
| P5 | 计划格式无验证 | 低 | 系统提示要求结构化格式，但没有验证模型是否真的输出了正确的格式 |
| P6 | 意图路由浪费 | 低 | Plan 模式也要经过意图路由，但既然用户主动选了 Plan 模式，路由是多余的 |

**与 Claude Code 对比:**
- Claude Code 的 Plan 模式是进入一个只读的探索阶段，模型可以读文件但不能写
- MiMo 的 Plan 模式完全禁用工具，模型只能凭空规划 — 可能导致计划不切实际（不了解代码库现状）

---

### 2.3 Polling 模式

**理论预期:** 人机协作模式。每一步文件修改都需用户确认，适合对代码变更要求严格的场景（生产环境、关键系统）。

**实际实现:**

1. **禁用并行** (agent.ts:883): 所有工具顺序执行，确保预览一次只显示一个

2. **编辑预览** (agent.ts:908-911):
   - `edit_file` → `handleEditPreview()`: 显示 old/new diff，等待用户确认
   - `write_file` → `handleWritePreview()`: 显示文件内容预览，等待用户确认

3. **命令确认** (tools.ts:639-649): `execute_command` 中标记为 `needsConfirm` 的命令弹出 VSCode 确认对话框

4. **系统提示** (agent.ts:690): `[Mode: Polling] 编辑/写入文件时会显示预览让用户确认`

**问题:**

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| Q1 | 禁用并行过于激进 | **高** | `read_file`、`search_files`、`glob_files` 等只读工具也被强制顺序执行。这些工具不会修改任何东西，应该可以并行。当前实现让 Polling 模式比 Auto 模式慢 3-6 倍。 |
| Q2 | tools.ts 中 edit/write 确认是死代码 | 中 | agent.ts 已经拦截了 `edit_file`/`write_file` 走预览流程，tools.ts 中的 `showWarningMessage` 确认对话框永远不会触发 |
| Q3 | delete_file 没有预览 | 中 | `delete_file` 在 Polling 模式下只弹一个 VSCode 确认框，没有显示要删除的文件内容或影响分析 |
| Q4 | execute_command 确认不一致 | 低 | 只有标记为 `needsConfirm` 的命令才需要确认，但什么命令需要确认的判断逻辑在 safety.ts 中，用户无法自定义 |
| Q5 | 预览阻塞整个循环 | 低 | 用户不点击确认/拒绝，整个 agent 循环就卡住了。没有超时机制 |
| Q6 | 意图路由浪费 | 低 | 同 Plan 模式，Polling 模式也经过不必要的意图路由 |

**与 Claude Code 对比:**
- Claude Code 有 `polling` 模式，但只对写入操作需要确认，只读操作可以并行
- Claude Code 的 polling 模式有更好的 diff 渲染（side-by-side）

---

### 2.4 Adversarial 模式

**理论预期:** 双角色对抗。Coder 负责实现，PM 负责审查，通过多轮迭代提升代码质量。适合对质量要求高的任务。

**实际实现:** 已在 `ADVERSARIAL_MODE_ANALYSIS.md` 中详细分析。

**关键问题（补充）:**

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| V1 | 跳过意图路由但不处理简单输入 | 中 | 用户在 Adversarial 模式下说 "hi"，会直接进入对抗流程（创建 coder/pm 角色、调用 API），浪费资源 |
| V2 | 无中止控制器 | 中 | `adversarialChat()` 在 `chat()` 创建 abortController 之前就返回了，signal 始终为 undefined |
| V3 | PM 有 execute_command | 高 | 已在 ADVERSARIAL_MODE_ANALYSIS.md 中详述 |

---

## 三、跨模式共性问题

### 3.1 意图路由的定位问题

**现状:** Auto/Plan/Polling 三种模式都经过 `classifyIntent()` 路由。

**问题:**
- Plan 和 Polling 是用户主动选择的模式，意图路由是多余的（用户已经知道要做什么）
- 路由消耗一次额外的 API 调用（~150 token + 网络延迟）
- 路由分类错误会导致行为异常（如 code_task 被分为 greeting）

**建议:** 只在 Auto 模式下使用意图路由，其他模式跳过。

### 3.2 系统提示缺乏差异化

**现状:** 四种模式共用同一个 `buildSystemPrompt()`，只是在末尾追加一行模式标签。

**问题:**
- Auto 模式的系统提示说「不要过度探索，直接写代码」，但 debug 任务需要先探索
- Plan 模式的系统提示说「输出计划后停止」，但没有告诉模型如何评估可行性
- Polling 模式的系统提示说「显示预览」，但没有告诉模型如何组织预览信息

**建议:** 每种模式有独立的系统提示变体，或根据意图分类动态调整。

### 3.3 无模式切换提示

**现状:** 用户切换模式后，没有提示新模式的行为变化。

**问题:** 用户从 Auto 切到 Polling，不知道现在每个编辑都需要确认，可能以为系统卡住了。

**建议:** 切换模式时显示简短的行为说明。

### 3.4 模式状态不持久化 `planConfirmed`

**现状:** `planConfirmed` 存在 `ConversationState` 中并持久化，但：
- 关闭 VSCode 再打开，`planConfirmed` 仍为 true
- 用户无法看到当前是 Phase 1 还是 Phase 2
- 没有「重新规划」的快捷方式

---

## 四、优化方案

### 方案 1: 智能路由（Auto 模式专用）

```typescript
// 只在 Auto 模式下使用意图路由
if (conv.mode === 'auto') {
    const intent = await classifyIntent(api, userInput, conv.model, signal);
    if (!intent.needsTools) {
        return this.handleDirectResponse(userInput, conv, events, signal, convId);
    }
    // 根据意图调整行为
    if (intent.category === 'debug') {
        systemContent += '\n优先查看错误日志和堆栈信息，从错误出发反向排查。';
    } else if (intent.category === 'refactor') {
        systemContent += '\n先读取目标文件，分析现有结构，再制定重构方案。';
    }
}
// Plan/Polling/Adversarial 模式跳过路由
```

### 方案 2: Plan 模式增强

```typescript
// 2a. Phase 1 允许只读工具（让模型真正了解代码库）
if (conv.mode === 'plan' && !conv.planConfirmed) {
    tools = TOOL_DEFINITIONS.filter(t => 
        ['read_file', 'search_files', 'glob_files', 'list_directory',
         'get_file_info', 'git_status', 'git_diff'].includes(t.function.name)
    );
    toolChoice = 'auto';
    systemContent += '\n\n你可以使用只读工具来了解代码库现状，但不能修改任何文件。';
}

// 2b. 计划执行后重置 planConfirmed
// 在 chat() 的 finally 块中：
if (conv.mode === 'plan' && conv.planConfirmed) {
    conv.planConfirmed = false; // 下次需要重新规划
}

// 2c. 拒绝时允许附加修改意见
case 'planReject':
    // 弹出输入框让用户说「哪里不满意」
    // 然后将修改意见作为下一次规划的上下文
```

### 方案 3: Polling 模式并行优化

```typescript
// 只对写入工具禁用并行，只读工具仍然并行
const MUTATING_TOOLS = new Set(['edit_file', 'write_file', 'delete_file', 'execute_command']);
const isParallel = PARALLEL_TOOLS.has(tc.function.name)
    && !this.mcpManager.isMcpTool(tc.function.name)
    && !(conv.mode === 'polling' && MUTATING_TOOLS.has(tc.function.name));
```

### 方案 4: 模式特定系统提示

```typescript
const MODE_PROMPTS: Record<AgentMode, string> = {
    auto: `你正在"自动模式"下工作。
- 快速分析需求，直接动手实现
- 简单任务直接回答，复杂任务先读文件再写代码
- 每 3-5 个工具调用后输出进度更新`,
    
    plan: `你正在"规划模式"下工作。
- Phase 1: 使用只读工具了解代码库，然后输出结构化计划
- 计划必须包含：需求分析、实现方案、涉及文件、预期结果
- Phase 2: 严格按照已确认的计划执行`,
    
    polling: `你正在"轮询模式"下工作。
- 每个文件修改都会显示预览，等待用户确认
- 只读操作（读取、搜索）可以自由使用
- 在修改前先说明为什么要改，让用户有心理准备`,
    
    adversarial: '', // 对抗模式有自己的 persona prompts
};
```

### 方案 5: 模式切换反馈

```typescript
// chatProvider.ts setMode handler
case 'setMode': {
    const newMode = msg.mode;
    const descriptions: Record<string, string> = {
        auto: '🚀 自动模式 — 模型自主完成任务，无需确认',
        plan: '📋 规划模式 — 先生成计划，确认后执行',
        polling: '👁️ 轮询模式 — 每个文件修改需你确认',
        adversarial: '🎭 对决模式 — Coder vs PM 双角色对抗',
    };
    post({ type: 'system', text: descriptions[newMode] || `模式已切换: ${newMode}` });
    break;
}
```

---

## 五、模式对比矩阵

| 维度 | Auto | Plan | Polling | Adversarial |
|------|------|------|---------|-------------|
| **适用场景** | 日常开发 | 复杂重构 | 生产环境 | 质量敏感 |
| **速度** | ⚡ 最快 | 🐢 中等 | 🐌 最慢 | 🐢 较慢 |
| **用户干预** | 无 | 计划审批 | 每步确认 | 无 |
| **代码质量** | 一般 | 较高 | 高 | 最高 |
| **token 消耗** | 低 | 中 | 中高 | 高（2-3x） |
| **意图路由** | ✅ 有 | ❌ 多余 | ❌ 多余 | ❌ 跳过 |
| **工具并行** | ✅ 是 | N/A | ❌ 全禁 | ✅ 是 |
| **只读工具并行** | ✅ 是 | N/A | ❌ 误禁 | ✅ 是 |
| **内部循环** | 无 | 无 | 无 | ✅ 有 |
| **质量保障** | 无 | 用户审批 | 用户审批 | PM 审查 |

---

## 六、优先级排序

| 优先级 | 优化项 | 工作量 | 影响 |
|--------|--------|--------|------|
| **P0** | Polling 模式：只读工具允许并行 | 15 分钟 | 速度提升 3-6x |
| **P0** | Adversarial：移除 PM 的 execute_command | 5 分钟 | 防止审查者破坏代码 |
| **P1** | Plan 模式：Phase 1 允许只读工具 | 30 分钟 | 计划更切实际 |
| **P1** | Plan 模式：执行后重置 planConfirmed | 10 分钟 | 修复连续对话问题 |
| **P1** | 只在 Auto 模式下使用意图路由 | 15 分钟 | 减少不必要的 API 调用 |
| **P2** | 模式特定系统提示 | 30 分钟 | 提升各模式效果 |
| **P2** | 模式切换反馈 | 15 分钟 | 改善用户体验 |
| **P2** | Plan 拒绝时允许附加意见 | 30 分钟 | 改善规划流程 |
| **P3** | Polling 模式 delete_file 预览 | 1 小时 | 更完整的预览 |
| **P3** | 清理 tools.ts 中的死代码 | 15 分钟 | 代码整洁 |
