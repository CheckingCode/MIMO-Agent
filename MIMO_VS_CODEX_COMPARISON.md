# MiMo Agent v1.3.0 vs OpenAI Codex CLI — 详细对比分析

> 评估时间: 2026-06-02
> MiMo Agent: v1.3.0 (VSCode Extension)
> OpenAI Codex: CLI Agent (open-source, MIT)

---

## 1. 产品定位

| 维度 | MiMo Agent | OpenAI Codex CLI |
|------|-----------|-----------------|
| **形态** | VSCode 侧边栏扩展 (GUI) | 终端命令行工具 (CLI) |
| **交互方式** | 图形界面 + 聊天 | 纯文本终端交互 |
| **目标用户** | VSCode 开发者 | 终端开发者 |
| **开源** | ❌ 闭源 | ✅ MIT 开源 |
| **模型** | MiMo 系列 (小米) | OpenAI o3/o4-mini/codex-mini |
| **运行环境** | VSCode Webview | 系统终端 |

---

## 2. 核心工具对比

### 2.1 工具列表

| 工具类别 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|---------|-------------------|-----------------|------|
| **文件读取** | ✅ read_file (offset/limit) | ✅ shell (cat/less) | 🟢 |
| **文件写入** | ✅ write_file | ✅ shell (echo/tee) | 🟢 |
| **文件编辑** | ✅ edit_file (精确替换) | ✅ apply_patch (结构化 diff) | 🟡 |
| **目录列表** | ✅ list_directory | ✅ shell (ls) | 🟢 |
| **文件搜索** | ✅ search_files (ripgrep) | ✅ shell (grep/rg) | 🟢 |
| **文件匹配** | ✅ glob_files | ✅ shell (find) | 🟢 |
| **文件删除** | ✅ delete_file | ✅ shell (rm) | 🟢 |
| **文件移动** | ✅ move_file | ✅ shell (mv) | 🟢 |
| **文件复制** | ✅ copy_file | ✅ shell (cp) | 🟢 |
| **文件信息** | ✅ get_file_info | ✅ shell (stat) | 🟢 |
| **命令执行** | ✅ execute_command | ✅ shell | 🟢 |
| **Git 操作** | ✅ 6 个专用工具 | ✅ shell (git ...) | 🟢 |
| **网络搜索** | ✅ web_search | ❌ 无 | ✅ MiMo 领先 |
| **URL 抓取** | ✅ fetch_url | ❌ 无 (沙箱无网络) | ✅ MiMo 领先 |
| **apply_patch** | ❌ 无 | ✅ 结构化代码编辑 | 🟡 Codex 领先 |
| **工具总数** | **17** | **2 (shell + apply_patch)** | — |

### 2.2 关键差异分析

#### Codex 的 `apply_patch` 工具

Codex 使用 `apply_patch` 进行结构化代码编辑，格式如下：

```
*** Begin Patch
*** Update File: src/app.ts
@@ -10, +10 @@
- const old = 'value';
+ const newValue = 'updated';
*** End Patch
```

**优势**:
- 一次操作可修改多个文件
- 包含上下文行，更精确
- 类似 `git diff` 格式，易于审查

**MiMo 的 `edit_file`**:
- 每次只能修改一个文件
- 使用精确文本匹配
- 不包含上下文，可能匹配错误

**评估**: Codex 的 apply_patch 在批量编辑场景更高效，但 MiMo 的 edit_file 更简单直观。**🟡 中等差距**。

#### MiMo 的专用工具 vs Codex 的 shell

Codex 将几乎所有操作都通过 `shell` 工具完成（`ls`、`cat`、`git`、`npm` 等），只有 `apply_patch` 是独立工具。

MiMo 将操作拆分为 17 个专用工具，每个工具有明确的参数和返回格式。

**Codex 的优势**:
- 更灵活 — 可以执行任何 shell 命令
- 更简单 — 只需一个工具
- 支持管道和组合命令

**MiMo 的优势**:
- 更安全 — 每个工具有独立的安全检查
- 更结构化 — 返回值格式统一
- 更易解析 — AI 不需要处理 shell 输出格式

**评估**: 各有优劣。**🟢 互有胜负**。

---

## 3. 安全与沙箱

| 维度 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|------|-------------------|-----------------|------|
| **命令过滤** | ✅ 黑名单 + 模式匹配 | ❌ 无命令过滤 (靠沙箱) | ✅ MiMo 领先 |
| **前缀剥离** | ✅ sudo/bin/cmd/powershell | ❌ 无 | ✅ MiMo 领先 |
| **路径验证** | ✅ 工作区限制 | ❌ 无路径限制 | ✅ MiMo 领先 |
| **敏感文件** | ✅ 扩展名过滤 | ❌ 无 | ✅ MiMo 领先 |
| **沙箱执行** | ❌ 无沙箱 | ✅ macOS Seatbelt / Linux Docker | 🔴 Codex 领先 |
| **网络隔离** | ❌ 无 (命令可访问网络) | ✅ 沙箱内禁用网络 | 🔴 Codex 领先 |
| **文件系统隔离** | ❌ 无 | ✅ 仅当前目录可写 | 🔴 Codex 领先 |

### Codex 沙箱机制

**macOS**: 使用 Apple 的 `sandbox-exec` (Seatbelt)
- 仅允许读取当前目录
- 禁止网络访问
- 禁止访问系统目录

**Linux**: 使用 Docker 容器
- 仅挂载当前目录为可写
- 禁止网络访问
- 隔离的文件系统

### 评估

Codex 的沙箱是**硬件级隔离**，即使 AI 执行 `rm -rf /` 也不会影响系统。MiMo 的安全层是**软件级过滤**，虽然能拦截已知危险命令，但理论上可被绕过。

**差距**: 🔴 **巨大** — 沙箱是 Codex 最大的安全优势。

---

## 4. 审批模式

| 模式 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|------|-------------------|-----------------|------|
| **建议模式** | ✅ Auto (AI 自动决定) | ✅ suggest (每步需确认) | 🟢 |
| **自动编辑** | ✅ Polling (自动继续) | ✅ auto-edit (文件操作自动) | 🟢 |
| **全自动** | ✅ Plan (纯规划) | ✅ full-auto (沙箱全自动) | 🟡 |
| **模式切换** | ✅ UI 弹窗选择 | ✅ CLI 参数/配置 | 🟢 |

### 差异

- MiMo 的 **Polling 模式**: AI 自动继续执行，直到任务完成
- Codex 的 **full-auto 模式**: 在沙箱内全自动执行，无需确认

Codex 的 full-auto 更安全（因为有沙箱），MiMo 的 Polling 更灵活（无需沙箱）。

**评估**: 🟢 **互有胜负**。

---

## 5. 项目配置

| 维度 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|------|-------------------|-----------------|------|
| **配置文件** | `~/.mimo/settings.json` | `~/.codex/config.yaml` | 🟢 |
| **项目指令** | ❌ 无项目级配置 | ✅ `AGENTS.md` | 🔴 Codex 领先 |
| **系统提示** | ✅ prompt.ts 构建 | ✅ AGENTS.md + 系统提示 | 🟡 |
| **Skills 系统** | ✅ 7 个 .md 技能文件 | ❌ 无 | ✅ MiMo 领先 |

### Codex 的 `AGENTS.md`

Codex 支持在项目根目录放置 `AGENTS.md` 文件，作为项目级的系统提示：

```markdown
# Project Guidelines

## Code Style
- Use TypeScript strict mode
- Prefer const over let
- Use async/await over .then()

## Testing
- Run `npm test` before committing
- All new features need unit tests

## Architecture
- Follow MVC pattern
- Keep components under 200 lines
```

**优势**:
- 每个项目可以有独立的 AI 行为配置
- 团队共享同一份 AI 指令
- 类似 `.cursorrules` / `CLAUDE.md`

**MiMo 的 Skills 系统**:
- 7 个内置技能 (debug/doc/explain/git/refactor/review/test)
- 通过 `/skill_name` 触发
- 支持自定义 .md 技能文件

**评估**: 两者思路不同 — Codex 用 AGENTS.md 做项目级配置，MiMo 用 Skills 做任务级模板。**🟡 互有胜负**。

---

## 6. 用户体验

| 维度 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|------|-------------------|-----------------|------|
| **界面** | ✅ GUI 侧边栏 | ❌ 纯终端文本 | ✅ MiMo 领先 |
| **代码高亮** | ✅ highlight.js | ❌ 终端无高亮 | ✅ MiMo 领先 |
| **工具卡片** | ✅ 状态指示 + 耗时 | ❌ 纯文本输出 | ✅ MiMo 领先 |
| **Diff 视图** | ✅ 行号 + 颜色 | ❌ 终端 diff | ✅ MiMo 领先 |
| **图片支持** | ✅ 拖拽/粘贴 | ✅ 截图拖拽 | 🟢 |
| **多标签** | ✅ 多对话标签 | ❌ 单对话 | ✅ MiMo 领先 |
| **历史管理** | ✅ 可视化历史列表 | ❌ 无历史 UI | ✅ MiMo 领先 |
| **模型切换** | ✅ 下拉选择 | ✅ 环境变量 | ✅ MiMo 领先 |
| **状态栏** | ✅ 实时状态显示 | ❌ 无 | ✅ MiMo 领先 |
| **错误重试** | ✅ 一键重试 | ❌ 需重新输入 | ✅ MiMo 领先 |

**评估**: MiMo 作为 VSCode 扩展，在用户体验上有**巨大优势**。Codex 作为 CLI 工具，交互体验天然受限。**🟢 MiMo 大幅领先**。

---

## 7. 架构对比

| 维度 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|------|-------------------|-----------------|------|
| **语言** | TypeScript (Node.js) | TypeScript (Node.js) | 🟢 |
| **模块化** | ✅ 12 个组件模块 | ✅ 模块化架构 | 🟢 |
| **构建** | ✅ esbuild (6ms) | ✅ esbuild | 🟢 |
| **开源** | ❌ 闭源 | ✅ MIT 开源 | 🔴 Codex 领先 |
| **社区** | ❌ 无社区 | ✅ GitHub 社区贡献 | 🔴 Codex 领先 |
| **插件系统** | ❌ 无 | ❌ 无 | 🟢 |
| **MCP 支持** | ❌ 无 | ❌ 无 | 🟢 |

**评估**: 架构质量相当，但 Codex 的开源生态是巨大优势。**🟡 中等差距**。

---

## 8. 模型能力

| 维度 | MiMo Agent v1.3.0 | OpenAI Codex CLI | 差距 |
|------|-------------------|-----------------|------|
| **默认模型** | mimo-v2.5-pro | codex-mini / o4-mini | — |
| **推理能力** | ✅ 长推理 | ✅ o3/o4 推理 | 🟡 |
| **多模态** | ✅ 图片输入 (部分模型) | ✅ 图片输入 | 🟢 |
| **上下文窗口** | 1M tokens (mimo-v2.5) | 200K tokens (o3) | ✅ MiMo 领先 |
| **模型切换** | ✅ 5+ 模型动态切换 | ✅ 环境变量切换 | 🟢 |
| **思维链** | ✅ Thinking 模式 | ✅ 推理模型内置 | 🟢 |

**评估**: 模型能力各有优势 — MiMo 上下文更大，Codex 推理更强。**🟢 互有胜负**。

---

## 9. 综合评分

| 类别 | 权重 | MiMo v1.3.0 | Codex CLI | 说明 |
|------|------|-------------|-----------|------|
| 核心工具 | 20% | 85% | 80% | MiMo 工具更多更专用 |
| 安全沙箱 | 15% | 70% | 95% | Codex 沙箱是决定性优势 |
| 用户体验 | 20% | 90% | 50% | GUI >> CLI |
| 架构质量 | 10% | 85% | 85% | 相当 |
| 扩展性 | 10% | 40% | 60% | Codex 开源 + 社区 |
| 模型能力 | 10% | 80% | 85% | Codex 推理略强 |
| 项目配置 | 10% | 60% | 75% | AGENTS.md 是好设计 |
| 生态 | 5% | 30% | 80% | 开源生态 |
| **加权总分** | 100% | **72%** | **76%** | **接近** |

---

## 10. 各自独有优势

### MiMo Agent 独有优势

| 优势 | 说明 |
|------|------|
| **GUI 界面** | VSCode 侧边栏，可视化交互 |
| **代码高亮** | highlight.js 190+ 语言 |
| **工具卡片** | 状态指示 + 耗时 + 折叠 |
| **多标签** | 同时管理多个对话 |
| **历史管理** | 可视化历史列表 |
| **错误重试** | 一键重试 |
| **命令补全** | `/` 触发补全菜单 |
| **三种模式** | Auto/Polling/Plan |
| **Skills 系统** | 7 个内置技能 |
| **网络工具** | web_search + fetch_url |
| **上下文窗口** | 1M tokens |
| **极致轻量** | 95 KB VSIX |

### OpenAI Codex CLI 独有优势

| 优势 | 说明 |
|------|------|
| **沙箱安全** | macOS Seatbelt / Docker 隔离 |
| **apply_patch** | 结构化多文件编辑 |
| **开源** | MIT 许可，社区贡献 |
| **AGENTS.md** | 项目级 AI 配置 |
| **推理模型** | o3/o4-mini 推理能力 |
| **零依赖** | npm install 即用 |
| **终端原生** | 适合 CLI 工作流 |
| **网络隔离** | 沙箱内禁用网络 |
| **文件系统隔离** | 仅当前目录可写 |

---

## 11. 差距总结

### 🔴 Codex 大幅领先的维度

| 差距 | 说明 | MiMo 可追平? |
|------|------|-------------|
| **沙箱安全** | 硬件级隔离，即使 AI 失控也安全 | ⚠️ 需要 Docker/VM 集成，工程量大 |
| **开源生态** | MIT 开源，社区贡献 | ❌ 需要项目决策 |
| **apply_patch** | 多文件批量编辑 | ✅ 可实现类似工具 |

### 🟢 MiMo 大幅领先的维度

| 优势 | 说明 | Codex 可追平? |
|------|------|-------------|
| **GUI 界面** | 可视化交互，工具卡片，Diff 视图 | ❌ CLI 天然限制 |
| **代码高亮** | 语法高亮 + 复制按钮 | ❌ 终端无高亮 |
| **多标签** | 多对话并行管理 | ❌ CLI 单对话 |
| **网络工具** | web_search + fetch_url | ⚠️ 沙箱限制网络 |
| **历史管理** | 可视化历史列表 | ❌ CLI 无 UI |

### 🟡 接近的维度

| 维度 | 说明 |
|------|------|
| 核心工具 | 两者都能完成文件/命令/Git 操作 |
| 架构质量 | 都是 TypeScript + 模块化 |
| 模型能力 | 各有优势 |
| 审批模式 | 三种模式对三种模式 |

---

## 12. 结论

> **MiMo Agent v1.3.0 和 OpenAI Codex CLI 是两个不同定位的产品，各有独特优势。**

### 选择建议

| 场景 | 推荐 | 原因 |
|------|------|------|
| VSCode 日常开发 | **MiMo Agent** | GUI 界面 + 代码高亮 + 多标签 |
| 终端工作流 | **Codex CLI** | 终端原生 + 沙箱安全 |
| 安全敏感项目 | **Codex CLI** | 沙箱隔离是决定性优势 |
| 快速原型开发 | **MiMo Agent** | 网络搜索 + URL 抓取 |
| 开源贡献 | **Codex CLI** | MIT 开源 + 社区 |
| 团队协作 | **Codex CLI** | AGENTS.md 项目级配置 |
| 代码审查 | **MiMo Agent** | Diff 视图 + 工具卡片 |
| 多文件重构 | **Codex CLI** | apply_patch 批量编辑 |

### 最值得 MiMo 借鉴的 3 件事

1. **沙箱安全** — 集成 Docker 或 VM 隔离，这是安全性的质变
2. **apply_patch** — 实现多文件批量编辑工具，提升重构效率
3. **AGENTS.md** — 支持项目级 AI 配置文件，团队共享 AI 指令

---

*评估时间: 2026-06-02*
*MiMo Agent v1.3.0 vs OpenAI Codex CLI*
