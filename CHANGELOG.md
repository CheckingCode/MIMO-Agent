# Changelog

## 1.5.4 (2026-06-07)

### Features
- Added round narration system that shows task complexity, round budget, stall status, and mode hints at the start of each agent round for better task progress visibility.
- Enhanced tool action descriptions with human-readable labels (e.g. "读取 src/agent.ts", "搜索 pattern", "运行命令 ...").
- Added structured progress tracking per round: completed count, error count, no-progress count, progress tool count, and read-only success count.
- Introduced modular webview message components: `ChatBubble`, `CodeBlock`, `DiffView`, `StreamingRenderer`, `ThinkingBlock`, `ToolCard` for cleaner rendering and future extensibility.

### Improvements
- Improved agent stall detection logic: read-only success now counts individual tool calls instead of boolean, preventing false stall triggers on multi-tool rounds.
- Refactored webview messages module into separate component files under `src/webview/components/messages/`.
- Enhanced chat UI styles for thinking blocks, tool cards, and diff views.

## 1.5.2 (2026-06-07)

### Fixes
- Fixed extension activation failure: removed `node_modules/**` from `.vscodeignore` so runtime dependencies (`highlight.js`, `puppeteer-core`) are included in the published VSIX.
- Fixed `command 'mimo-agent.chat' not found` error caused by missing dependencies in the packaged extension.

### Improvements
- Reasoning mode switch no longer shows redundant "设置已保存并生效" confirmation in chat area.

## 1.5.0 (2026-06-07)

### Features
- Added an Auto completion gate so complex coding tasks do not finalize without workspace evidence or validation status.
- Added lightweight agent trace logging to `~/.mimo/traces/*.jsonl` for round, tool, context compression, and stop-guard diagnostics.
- Added provider profile storage for CC-switch style model configuration in `~/.mimo/settings.json`.
- Added settings UI support for active provider profile and provider profiles JSON, with quick presets for MiMo, Deepseek, and OpenAI-compatible endpoints.

### Improvements
- Strengthened the system prompt completion contract: inspect before finalizing complex tasks, validate after edits, and report validation status.
- Kept provider profile support backward-compatible with existing `api.base_url`, `api.model`, `api.api_key`, and `api.models` settings.

## 1.4.9 (2026-06-07)

### Features
- Added an explicit dependency install policy for project package installs and system software installs.
- Project dependency install commands can run automatically with an extended timeout; system software installs require confirmation or are blocked by settings.
- Added dependency install controls to the settings UI and VS Code configuration schema.

### Fixes
- Passed dependency install policy through main agent, sub-agent, and workflow tool execution paths.
- Preserved command timeout status so install timeouts are reported clearly.
- Refreshed default webview language on startup so Chinese UI text is applied before user interaction.

## 1.4.8 (2026-06-06)

### Fixes
- Hardened connection recovery, removed pre-tool round-timeout stops, filtered leaked tool-call tags, and copied the packaged VSIX to `releases/`.
- 收紧 Auto 路由、上下文压缩和重试节奏，减少卡顿与假死感
- 修复 webview 中文模式下的输入框、模式切换与历史/按钮文案跟随问题
- 优化历史回放收口，减少"思考中"状态残留
- 重写历史记录展示路径，改为直接渲染最终 transcript，避免点击历史时卡顿、重复 `Processed` 和原始记录不一致
- 精简 `Processed` 折叠头，仅保留处理时间与 token 使用量，不再显示工具数量或思考轮次
- 为长任务新增滚动上下文自动压缩记忆，运行时使用 summary + recent messages，保留原始历史记录
- 修复 Infinite 模式误用 Auto 短流程提示的问题，增强复杂任务持续探索、自检和验证要求
- 为 Infinite 增加复杂任务完成门，缺少文件探索或验证证据时会继续推进而不是过早结束

## 1.4.7 (2026-06-06)

### Fixes
- 修复中文模式下模型切换提示未跟随语言的问题
- 统一模型自动切换与语言按钮的本地化显示

## 1.4.6 (2026-06-06)

### Fixes
- 修复中文模式下模型切换提示仍显示英文的问题
- 统一语言切换按钮文本显示

## 1.4.5 (2026-06-06)

### Fixes
- 修复历史记录回放时思考状态无法收口、一直转圈的问题
- 优化历史消息回放的 done 事件补齐逻辑
- 保持回放后的界面状态一致

## 1.4.4 (2026-06-06)

### Fixes
- 补全模式国际化文案，新增 Infinite 模式中文显示
- 统一语言切换按钮文本
- 发布 1.4.4 版本

## 1.4.3 (2026-06-06)

### Fixes
- 移除冗余的 activationEvents（VS Code 自动生成）
- 优化扩展激活性能，减少 UI 阻塞

## 1.4.2 (2026-06-06)

### Fixes
- 修复推理循环检测后的恢复机制
- 新增三级循环恢复：强引导 -> 新模型调用 -> 退出总结
- 修复设置页面多语言支持

## 1.4.1 (2026-06-06)

### Fixes
- 修复图标不显示问题（添加 package.json icon 字段）
- 更新仓库链接指向 MIMO-Agent

## 1.4.0 (2026-06-06)

### Features
- 设置界面支持多语言（跟随 VS Code 语言设置）
- 推理循环检测优化：循环时自动切换新模型继续任务，避免会话中断
- 新增三级循环恢复机制（强引导 -> 新模型调用 -> 退出总结）
