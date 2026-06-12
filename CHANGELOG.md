# Changelog

## 1.7.3 (2026-06-12)

### Improvements
- Restored the README to the intended pre-1.7.2 structure instead of embedding 1.7.2 release notes directly in the main product overview.
- Added the official website link to the README top navigation and repository links section for quicker access.

## 1.7.2 (2026-06-12)

### Improvements
- Optimized heavy webview UI paths, including Bash cards, Edit/Write preview cards, and workflow/history detail rendering, to reduce lag from large command output and diffs.
- Deferred expensive edit and overwrite diff preview rendering until expansion, while keeping visible summaries lightweight by default.
- Improved history replay responsiveness by lazily hydrating execution-detail drawers instead of eagerly rendering all process DOM.
- Refined readonly diff-preview workflows and related preview plumbing so multi-file review remains view-only and more stable.
- Rewrote the README into clean UTF-8 bilingual release documentation and synced version metadata for the new release.

### Fixes
- Fixed overwrite write-preview actions using the wrong confirm/reject path, so overwrite approval now correctly uses the write confirmation flow.
- Removed an invalid collapsible-card call from system messages that could create avoidable runtime instability.
- Kept manual stop, friendly error rendering, task change review, and recent UI polish aligned with the 1.7.x interaction model after the latest changes.

## 1.7.1 (2026-06-11)

### Fixes
- Reduced Auto completion-gate over-continuation so completed Chinese summaries are less likely to be reopened for repeated self-check loops.
- Preserved already-visible final drafts when extra verification is needed, with follow-up validation rendered as a separate verification card instead of replacing the answer.
- Localized visible task checklist labels, summaries, and statuses in Chinese UI, and hid priority badges when every todo has the same priority.
- Clarified task/todo tool guidance so visible todo content follows the user's language and high priority is reserved for truly blocking work.

## 1.7.0 (2026-06-11)

### Features
- Added assistant reply footer actions for copy, retry, contextual continue, and feedback, with archived actions hidden until hover to avoid layout jumps.
- Added a header context-usage badge with staged colors and exact token counts on hover.
- Added clickable URL and local file-path links in rendered summaries, including Windows paths inside Markdown tables.
- Saved the MIMO message-handling policy as project documentation and wired routing behavior for common user-message categories.

### Improvements
- Improved MiMo-series model identification, friendly error explanations, and interruption recovery so failures distinguish agent, model, API, local environment, and user-action causes where possible.
- Refined task, confirmation, feedback, preference, and product-experience routing so complex tasks build a framework before staged execution and verification.
- Updated built-in skills with clearer output conventions, including richer Git commit summaries with a one-line summary and bullet details.
- Relaxed Safe Mode networking for explicit public HTTP/HTTPS downloads after URL safety checks while keeping internal/unsafe targets blocked or reviewed.
- Allowed workspace-outside files to be opened for read-oriented navigation, while external mutations are guarded with backup creation.
- Improved web search reliability with a DuckDuckGo-first path and Bing fallback.

### Fixes
- Fixed stale `Processed` metadata chips by removing elapsed/token clutter from completed execution drawers and history snapshots.
- Fixed `mimo-v2.5-pro` context metadata to use the corrected 1M context window.
- Fixed UI confusion where reply footer source labels always showed `AGENT` and added clearer action placement on the left side.
- Improved send/stop icon rendering and feedback hover affordance.

## 1.6.9 (2026-06-10)

### Improvements
- Added the new adversarial, chat-loop, progress-summary, and input-preprocessing agent modules to support richer long-running workflows and recovery handoffs.
- Expanded internal progress and reasoning orchestration so multi-stage runs share clearer summaries and state handoff logic.

### Fixes
- Fixed artifact summary extraction so final responses no longer append code-like shell fragments such as canvas or command snippets as fake deliverable files.
- Kept Chinese final summaries using the localized 交付文件： heading while preserving real generated file paths.

## 1.6.8 (2026-06-09)`r`n`r`n### Improvements
- Added visible command-purpose narration for shell commands and richer workflow task progress so long runs no longer appear as unexplained Bash-only activity.
- Expanded interrupted-run handoff summaries with validation status plus changed and inspected file context.

### Fixes
- Reduced personalized-instruction warning spam by allowing safety-scoped restrictions and documentation examples while still blocking instructions that disable core agent abilities.
- Added instruction-validation warning de-duplication so unchanged project instructions are not reported every turn.

## 1.6.7 (2026-06-09)

### Fixes
- Fixed MiMo image messages on `mimo-v2.5-pro` so they can auto-switch to the built-in `mimo-v2.5` vision fallback even when the active model profile only lists the Pro model.

## 1.6.6 (2026-06-09)

### Improvements
- Added more provider presets to Settings and Add Model, covering Qwen/DashScope, Zhipu GLM, Moonshot/Kimi, Volcengine Ark, SiliconFlow, Baidu Qianfan, Tencent Hunyuan, OpenRouter, Groq, Google Gemini, Mistral AI, and xAI Grok.
- Extended provider detection for saved profiles so common OpenAI-compatible domestic and international endpoints keep their provider labels instead of falling back to Custom.
- Updated README version notes for the expanded provider preset list.

## 1.6.5 (2026-06-09)

### Improvements
- Simplified chat model picker labels so saved model-card routes display as short model names instead of long endpoint/model route strings.
- Kept one chat model option per Settings model card instead of expanding each card's legacy `models` array into extra dropdown entries.
- Final summaries now include exact generated or verified artifact paths, such as synthesized audio files, so users can find deliverables immediately.
- Added provider selection to Settings model cards and Add Model, with MiMo, DeepSeek, OpenAI, and custom OpenAI-compatible presets.
- Replaced the native chat model dropdown with a grouped modern model picker and made mode/model/reasoning controls lighter without visible borders.
- Fixed provider parameter failures leaving chat stuck in a busy state, and capped saved/requested Max Tokens at 65536 to avoid invalid `max_tokens` requests.

### Fixes
- Prevented repeated Settings saves from generating increasingly long model profile IDs.

## 1.6.4 (2026-06-09)

### Improvements
- Compact Settings model cards into one-line summaries with expandable details for editing API keys, base URLs, and model IDs.
- Widened the generation settings section so parameter controls use the full settings page width.

### Fixes
- Fixed the API key eye icon not toggling visibility when the click landed on the SVG icon instead of the button.

## 1.6.3 (2026-06-09)

### Improvements
- Reworked Settings model management into a direct model-card list where each model has its own API key, base URL, model ID, default selection, copy, and delete controls.
- Added a show/hide API key toggle in each model card.

## 1.6.2 (2026-06-09)

### Improvements
- Split Settings into separate API connection and model list cards so provider credentials and per-profile model IDs are easier to manage.

### Fixes
- Fixed the dedicated Settings page becoming unresponsive because the generated webview script could contain an invalid regular expression.
- Made Open Config File create `~/.mimo/settings.json` when the file does not exist yet.

## 1.6.1 (2026-06-09)

### Fixes
- Improved dropdown ergonomics: the History panel and mode selector now close when clicking outside them.
- Added Escape-key dismissal for the History panel and mode selector popup.

## 1.6.0 (2026-06-09)

### Features
- Added a built-in `mimo_multimodal` MCP bridge so text/Pro models can indirectly handle screenshots, images, audio, video, transcription, and TTS by delegating media work to MiMo multimodal/TTS models first.
- Added multimodal MCP tools for image analysis, audio analysis, video analysis, audio transcription, and speech synthesis output files.
- Added task scheduling support with `schedule_tasks`, allowing MiMo to split multi-task requests, estimate complexity, infer dependencies, and choose a better execution order instead of blindly following user order.
- Added a real `update_todos` tool with visible checklist rendering so long tasks can show planned, active, and completed steps.
- Exposed `run_workflow` to the model for planned sequential/parallel workflow execution when tasks can be decomposed safely.
- Added VS Code window-state restoration support so MiMo chat windows can be remembered and restored more naturally after VS Code restarts.

### Improvements
- Expanded model/profile routing so API profiles, active routes, and model selection stay aligned across settings, chat, and model switching.
- Improved settings reliability by embedding initial settings data in the webview and removing a generated JavaScript regex that could break the settings page.
- Added stronger completion and progress handling for long tasks, including task schedule/todo progress classification.
- Refined tool cards for schedule, todo, workflow, and large command inputs.

### Fixes
- Fixed the model settings page becoming empty and unclickable because the webview script could fail during initialization.
- Fixed `Update Todos` appearing to exist only as text/checklist rendering without a real callable tool.
- Fixed multi-task execution behavior so dependencies can be represented explicitly before execution.

## 1.5.6 (2026-06-09)

### Improvements
- Added a built-in `mimo_multimodal` MCP server for indirect multimodal support from Pro/text models: image, audio, video understanding, audio transcription, and TTS file generation.
- The built-in multimodal MCP uses `mimo-v2.5` and `mimo-v2.5-tts` by default, with environment overrides for testing Omni/TTS model IDs.
- Added CC-switch-like model switching through `MiMo: Switch Model`, with QuickPick entries grouped by API profile/endpoint and model.
- Grouped the chat model selector by API profile so the same model ID can be selected independently on different base URLs.
- Improved model settings so one API profile can hold multiple model IDs, model IDs can be pasted in batches, and `api.active_route` is kept aligned with the selected profile/model.
- Added local completion detection for explicit git commit/push tasks. When MiMo sees reliable evidence such as `Everything up-to-date`, a clean working tree, an up-to-date tracking branch, or a remote log containing the commit, it now finalizes immediately instead of continuing to inspect.
- Reclassified read-only git shell checks such as `git status`, `git log`, `git diff`, `git show`, and `git remote -v` so they no longer count as state-changing progress that can keep Auto mode alive indefinitely.
- Added a targeted git-delivery convergence instruction to discourage repeated `git status/log/diff` checks after push delivery has already been verified.
- Strengthened reasoning-loop detection with repeated sentence/chunk matching so repeated Thought text is interrupted earlier.

### Fixes
- Fixed simple "git and push" tasks continuing for many extra rounds after the commit had already been pushed or confirmed up to date.
- Fixed `Everything up-to-date` output emitted through stderr/PowerShell wrappers being treated as suspicious instead of valid remote-sync evidence.
- Fixed a stuck Thought recovery path where MiMo could keep reasoning even though git delivery evidence was already sufficient to end the task.
- Fixed edited-file Diff cards showing stale workspace Git diffs on later no-change messages. Diff cards now require file changes recorded by the current turn's mutating tools, and Git diff is only used as a filtered enhancement for those files.
- Added a no-Git fallback for edited-file cards: when Git is unavailable, MiMo still shows the files changed by the current turn from tool records, with automatic undo disabled.
- Added convergence regression tests for completed git push evidence, read-only git command progress classification, and repeated Thought loop detection.

## 1.5.5 (2026-06-08)

### Features
- Added per-window runtime isolation so active conversations, memory, and token usage are separated across VS Code windows, including multiple windows opened on the same workspace.
- Added queued-message controls for long-running tasks: queued messages can be edited, removed, or sent immediately with the new `Run` action, interrupting the current run and starting the selected queued item after the conversation becomes idle.
- Added workspace-level chat history persistence with automatic migration from recent window-scoped history folders, so debug restarts and new windows can still see saved conversations.

### Improvements
- Improved Webview responsiveness during long reasoning streams by batching reasoning updates, throttling stream rendering, and avoiding expensive full re-renders for already displayed Thought content.
- Made Thought expansion a lightweight local interaction so completed Thought blocks can open without blocking scrolling or input controls.
- Kept recovery, handoff, and progress prompts aligned with the user's language so Chinese conversations do not drift into English after recovery paths.
- Compacted large command inputs in tool cards and nudged the agent to use file tools for large generated artifacts instead of embedding full HTML/CSS/JS bodies in shell commands.
- Reduced large-project overhead in `list_directory` by making it asynchronous, bounding directory entries, limiting stat calls, and adding a short timeout.
- Raised the minimum Auto mode round budget and disabled aggressive stop protection before 200 rounds to avoid premature "paused by protection" behavior on real long tasks.
- Strengthened duplicate read-only tool guards so repeated broad scans are skipped earlier.
- Moved 1.5.5 release highlights into the README changelog section so the README opens with the MiMo product overview again.
- Preserved user image data and much larger assistant/tool/reasoning payloads in newly saved history records for closer replay fidelity.

### Fixes
- Fixed the main send button state: when MiMo is running and the input box is empty, it now always shows Stop even when queued messages exist.
- Fixed stale queued-message UI after a queued item is sent.
- Fixed debug sessions losing visible history because history was stored under a fresh per-window session directory.
- Fixed cross-window contention by moving runtime state paths to window-scoped storage while keeping saved history workspace-scoped.
- Fixed multi-file change review cards so expanding "edited files" shows every file's diff instead of only the last file's hunks.
- Added file-row diff targeting in the change review card so selecting a file expands the patch and scrolls to that file.
- Included untracked new text files in the task change review card, with generated text patches for review and undo when safe.
- Merged Git diff files with tool-captured edited files in the final change list so external or baseline-modified files are still visible to the user.
- Removed the duplicate compact Changed Files card so completed turns keep a single edited-files review card.
- Added tool-diff fallback for per-file review rows and disabled undo when no safe reversible Git patch is available.
- Fixed history replay image placeholders for newly saved conversations by keeping image URLs instead of replacing them during history normalization.
- Expanded Processed history replay details so long Thought/tool bodies are restored directly instead of showing a short placeholder.
- Added high-fidelity history UI snapshots so newly saved conversations can replay workflow DOM, diff cards, and edited-file cards close to the original run.
- Restored expandable Thought content from history UI snapshots and localized Thought/Thinking labels to Chinese as "思考/思考中" in Chinese mode.
- Preserved edited-file diff patches in history snapshots and added a read-only history diff fallback when saved tool details contain `git_diff` output.
- Synced the webview language selection to the agent runtime so bottom status prompts such as round planning follow English/Chinese UI mode.
- Changed Safe Mode Git auto-snapshot commits to opt-in only; the Git snapshot checkbox is now off by default and no longer creates commits unless explicitly enabled.
- Densified the Settings generation panel with reasoning profile controls, quick presets, and compact parameter guidance so the second settings card no longer feels empty.
- Refined chat layout spacing, indentation, and card rhythm for assistant output, Thought blocks, workflow cards, and edited-file summaries without changing interaction behavior.
- Kept assistant process narration inside the Processed drawer after completion instead of leaving workflow text floating above the final answer.
- Kept only the last final-answer segment outside Processed so earlier streamed narration is folded into the Processed drawer.
- Added a frontend tool-diff fallback edited-files card when no safe isolated Git patch summary is available.
- Included staged Git diffs in task change summaries so files added to the index still appear with a staged badge.
- Reduced wasteful repeated file reads by tracking read_file line ranges per user turn and skipping heavily overlapping ranges with an uncovered-gap hint.
- Prevented pending-action prose such as "let me check/run/verify" from being treated as a final answer, including Chinese variants after prior tools ran.
- Routed local debugging questions about Git, diff cards, VS Code, and MiMo through the tool path instead of direct-answer mode.
- Added an agent-level retry for transient stream errors such as timeouts, reset connections, and socket interruptions.

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

