# 🔍 MiMo Agent VS Code 插件 — 代码质量与风险审计报告

> **版本**: v1.5.2  
> **审计日期**: 2026-06-07  
> **审计范围**: 全部源码 (`src/`, `webview/`, `test/`, 配置文件)  
> **审计模式**: 只读分析，零文件修改

---

## 📊 审计摘要

| 维度 | 评级 | 说明 |
|------|------|------|
| **安全性** | ⚠️ 中高风险 | 存在多个可被利用的安全漏洞 |
| **代码质量** | ⚠️ 中等 | 架构整体合理，但存在单体文件和一致性问题 |
| **可维护性** | ⚠️ 中等 | agent.ts 过大（2800+ 行），缺乏模块化 |
| **测试覆盖** | ❌ 不足 | 测试文件存在但无法验证覆盖率 |
| **依赖管理** | ✅ 良好 | 无外部 npm 运行时依赖，纯 Node.js 实现 |

---

## 🚨 严重问题 (Critical / High)

### C-1: 命令注入漏洞 — `hooks.ts`
- **文件**: `src/hooks.ts:73, 110`
- **严重程度**: 🔴 严重 (Critical)
- **描述**: `interpolate()` 方法将 `${tool_name}`, `${tool_path}`, `${tool_result}`, `${workspace}` 直接插入 shell 命令字符串，然后通过 `child_process.exec()` 执行。**没有任何转义处理**。
- **攻击向量**:
  ```
  // 用户配置 hooks:
  { "command": "echo '${tool_path}'", "tools": ["write_file"] }
  
  // 如果 tool_path 包含: test'; rm -rf / #
  // 实际执行: echo 'test'; rm -rf / #'
  ```
- **影响**: 攻击者可通过精心构造的文件名/路径实现任意命令执行
- **修复建议**: 
  1. 使用 `child_process.execFile` 替代 `exec`，将变量作为参数传递而非字符串拼接
  2. 或对所有变量进行严格的 shell 转义（参考 `desktop.ts` 的 `shellEscape`）

### C-2: Shell 命令注入 — `desktop.ts`
- **文件**: `src/desktop.ts:89+` (desktopScreenshot, desktopKeyPress 等)
- **严重程度**: 🔴 严重 (Critical)
- **描述**: 虽然有 `shellEscape()` 函数，但 `windowTitle` 参数直接拼入 PowerShell 脚本字符串，转义不完整：
  ```typescript
  // desktopScreenshot 中
  const psScript = options?.windowTitle
    ? `... $hwnd = (Get-Process | Where-Object {$_.MainWindowTitle -like '*${options.windowTitle}*'})...`
  ```
  PowerShell 的 `-like` 操作符使用通配符，`*` 已经被硬编码，但 `windowTitle` 中的特殊字符（如 `$`, `` ` ``, `;`）可能绕过转义。
- **影响**: 通过恶意窗口标题实现 PowerShell 注入

### C-3: MCP 服务器进程注入 — `mcp-client.ts`
- **文件**: `src/mcp-client.ts`
- **严重程度**: 🟠 高 (High)
- **描述**: MCP 服务器配置来自 `settings.json`，直接用于 `child_process.spawn(command, args, { env })`。恶意 MCP 配置可执行任意命令。
- **缓解因素**: 配置文件在 `~/.mimo/` 下，需要用户手动编辑
- **修复建议**: 添加 MCP 服务器命令白名单验证，或在 UI 中显示警告

### C-4: 安全检查绕过 — `safety.ts` 命令提取
- **文件**: `src/safety.ts` — `extractInnerCommand()`
- **严重程度**: 🟠 高 (High)
- **描述**: 递归提取内部命令的逻辑复杂，通过以下方式可能绕过：
  1. 变量展开: `CMD=rm; $CMD -rf /`
  2. 编码绕过: base64 编码命令
  3. 新行注入: `safe_command\nrm -rf /`
  4. 进程替换: `diff <(rm -rf /) <(echo)`
  5. Here-string: `cat <<'EOF'\nrm -rf /\nEOF`
- **根因**: 使用正则表达式解析 shell 语法本质上不可靠

### C-5: SSRF 检查可绕过 — `safety.ts`
- **文件**: `src/safety.ts` — `checkUrlSSRF()` / `checkHostSSRF()`
- **严重程度**: 🟠 高 (High)
- **描述**: 
  1. DNS 重绑定攻击: 第一次解析为公网 IP，第二次解析为内网 IP
  2. IPv6 环回地址: `[::1]` 未被检查
  3. 十进制 IP: `2130706433` (= 127.0.0.1) 未被检查
  4. 八进制 IP: `0177.0.0.1` 未被检查
  5. URL 编码: `%31%32%37%2e%30%2e%30%2e%31` 可能绕过
  6. 双重解析: `http://attacker.com@127.0.0.1/`

### C-6: Sandbox Git 快照回滚脆弱 — `sandbox.ts`
- **文件**: `src/sandbox.ts`
- **严重程度**: 🟡 中 (Medium)
- **描述**: Git 自动快照回滚依赖 `log.stdout.includes('[MiMo] Auto-snapshot')` 字符串匹配。如果 git 输出被本地化（中文环境）或日志格式改变，回滚将静默失败。
- **修复建议**: 使用 git tag 或 ref 而非 stdout 字符串匹配

---

## ⚠️ 中等问题 (Medium)

### M-1: `agent.ts` 单体文件 — 2800+ 行
- **文件**: `src/agent.ts`
- **严重程度**: 🟡 中 (Medium)
- **描述**: 单个文件包含：工具执行、循环检测、上下文溢出处理、人物系统、代码审查模式、重复防护、计划模式、上下文压缩等所有核心逻辑。
- **影响**: 可维护性差，测试困难，修改一个功能可能意外影响其他功能
- **修复建议**: 拆分为 `toolExecutor.ts`, `loopDetector.ts`, `contextManager.ts`, `planMode.ts` 等模块

### M-2: Silent Error Catching — 多处
- **文件**: `src/sandbox.ts` (日志写入), `src/browser.ts` (浏览器关闭), `src/file-lock.ts` (清理)
- **严重程度**: 🟡 中 (Medium)
- **描述**: 多处使用 `catch { /* ignore */ }` 或 `catch(() => {})` 吞掉错误。调试时无法追踪问题根因。
- **修复建议**: 至少记录到 debug 日志

### M-3: 硬编码路径 — `sandbox.ts`, `browser.ts`
- **文件**: `src/sandbox.ts:logDir`, `src/browser.ts:findChromePath()`
- **严重程度**: 🟡 低-中 (Low-Medium)
- **描述**: 
  - 日志目录硬编码为 `os.tmpdir()/mimo-logs/`，无配置选项
  - Chrome 路径硬编码为常见位置，不支持自定义安装路径（除了环境变量 `PUPPETEER_EXECUTABLE_PATH`）

### M-4: 内存关键词提取 — 固定置信度
- **文件**: `src/memory.ts`
- **严重程度**: 🟡 低 (Low)
- **描述**: 关键词提取使用固定置信度 `0.82`，不反映实际相关性。存储的记忆可能质量参差不齐。
- **影响**: 知识检索噪音大，可能返回不相关的结果

### M-5: `tokenUsage.ts` 多窗口竞争
- **文件**: `src/tokenUsage.ts`
- **严重程度**: 🟡 低-中 (Low-Medium)
- **描述**: 虽然有原子写入和文件锁，但读-修改-写操作不是原子的。两个 VS Code 窗口可能同时读取相同数据，各自修改后写入，导致一个窗口的更新丢失。
- **缓解因素**: 最终会通过磁盘合并自愈，但短期内统计数据不准确

### M-6: Browser Automation — `--no-sandbox`
- **文件**: `src/browser.ts:55`
- **严重程度**: 🟡 低-中 (Low-Medium)
- **描述**: Puppeteer 使用 `--no-sandbox` 启动 Chrome。虽然在桌面环境常见，但降低了浏览器沙箱的保护。
- **影响**: 浏览器漏洞可直接影响宿主系统

### M-7: 敏感信息泄露 — `image.ts` / 截图
- **文件**: `src/browser.ts:121-130`, `src/desktop.ts`
- **严重程度**: 🟡 中 (Medium)
- **描述**: 截图保存到 `TEMP` 目录，文件名可预测（`mimo-desktop-{timestamp}.png`）。其他进程可读取。
- **修复建议**: 使用随机文件名，设置文件权限为 600

### M-8: Token Usage 持久化路径暴露
- **文件**: `src/tokenUsage.ts`
- **严重程度**: 🟡 低 (Low)
- **描述**: Token 使用统计保存在 `~/.mimo/token-usage.json`，包含全局 API 使用数据。如果工作目录被共享，可能泄露使用量信息。

---

## ✅ 良好实践 (Positive Findings)

### P-1: 零外部运行时依赖
整个项目仅依赖 VS Code API（`@types/vscode`）和 Node.js 内置模块。浏览器自动化使用可选的 `puppeteer-core`。这大大降低了供应链攻击风险。

### P-2: 文件锁实现 — `file-lock.ts`
使用 `wx` 模式（排他创建）实现原子锁获取，带超时和重试机制。是 Node.js 环境下跨进程锁的标准做法。

### P-3: 多层安全防护 — `safety.ts` + `sandbox.ts`
安全检查包含：命令黑名单 → 管道安全 → SSRF 检查 → 递归命令提取 → 路径检查 → 敏感文件检测。虽然每层都有绕过可能，但多层叠加显著提高了攻击成本。

### P-4: MCP 协议实现 — `mcp-client.ts`
干净的 JSON-RPC 2.0 实现，支持 stdio 传输。协议握手、工具发现、资源管理流程完整。

### P-5: 依赖安装分级管理 — `dependencyInstall.ts`
将依赖安装分为项目依赖和系统依赖两类，分别支持 `auto`/`confirm`/`disabled` 模式。系统安装默认需要确认，是安全的设计决策。

### P-6: Token 计量与限额
支持按调用/对话/全局三个维度追踪 token 使用，带持久化和多窗口合并。这是企业级功能的正确实现。

### P-7: 人格系统 — `personas.ts`
基于加权关键词的自动人格选择，覆盖编程、写作、数据分析、运维等场景。设计清晰，扩展性好。

### P-8: 上下文压缩
Agent 支持对话历史压缩，在 token 逼近上限时自动触发，避免 API 调用失败。

---

## 🔧 测试评估

### 测试文件清单
| 文件 | 用途 |
|------|------|
| `test/suite/extension.test.ts` | 扩展激活测试 |
| `test/suite/safety.test.ts` | 安全检查测试 |
| `test/suite/agent.test.ts` | Agent 核心逻辑测试 |
| `test/suite/tools.test.ts` | 工具注册测试 |
| `test/suite/config.test.ts` | 配置加载测试 |
| `test/suite/memory.test.ts` | 记忆系统测试 |
| `test/runTest.ts` | 测试入口 |

### 测试问题
1. **无法验证覆盖率**: 项目无 `.vscode-test` 配置，无法确认测试是否能实际运行
2. **安全测试不完整**: 缺少命令注入、SSRF 绕过、路径遍历的对抗性测试用例
3. **无集成测试**: 缺少真实 VS Code 环境的端到端测试
4. **无 Hooks 测试**: `hooks.ts` 完全没有测试覆盖

---

## 📋 修复优先级

### 🔴 P0 — 立即修复 (1-2 天)
| ID | 问题 | 修复方案 |
|----|------|---------|
| C-1 | Hooks 命令注入 | 使用 `execFile` + 参数数组，或严格转义 |
| C-2 | Desktop PowerShell 注入 | 对 `windowTitle` 进行 PowerShell 专用转义 |

### 🟠 P1 — 短期修复 (1-2 周)
| ID | 问题 | 修复方案 |
|----|------|---------|
| C-3 | MCP 进程注入 | 添加命令白名单 + UI 警告 |
| C-4 | 安全检查绕过 | 补充变量展开/编码/换行等场景的测试和防护 |
| C-5 | SSRF 绕过 | 补充 IPv6、编码、DNS 重绑定防护 |
| C-6 | Git 回滚脆弱 | 改用 git tag 或 reflog |

### 🟡 P2 — 中期改进 (1-2 月)
| ID | 问题 | 修复方案 |
|----|------|---------|
| M-1 | Agent 单体文件 | 拆分为 4-6 个模块 |
| M-2 | 静默错误吞噬 | 至少记录 debug 日志 |
| M-7 | 截图文件暴露 | 随机文件名 + 权限控制 |

### 🟢 P3 — 长期优化
| ID | 问题 | 修复方案 |
|----|------|---------|
| M-4 | 固定置信度 | 基于 TF-IDF 或相似度计算动态置信度 |
| M-5 | Token 竞争 | 改用 SQLite 或添加乐观锁 |

---

## 📐 架构改进建议

### 1. 模块化 `agent.ts`
```
src/
├── agent.ts              → 核心 Agent 类（瘦壳）
├── agent/
│   ├── toolExecutor.ts   → 工具执行与批处理
│   ├── loopDetector.ts   → 循环检测与中断
│   ├── contextManager.ts → 上下文压缩与溢出
│   ├── planMode.ts       → 计划模式逻辑
│   └── reviewMode.ts     → 代码审查模式
```

### 2. 安全层统一
```
src/security/
├── commandChecker.ts     → 命令安全检查（合并 safety.ts 中的命令部分）
├── pathChecker.ts        → 路径安全检查
├── ssrfChecker.ts        → SSRF 防护（增强版）
├── shellEscape.ts        → 统一的 shell 转义工具
└── sandbox.ts            → 沙箱执行环境
```

### 3. Hooks 安全重构
```typescript
// 安全的 hooks 实现
async function runHook(hook: HookConfig, vars: HookVars) {
    // 解析命令为 [executable, ...args]
    const [cmd, ...args] = parseCommand(hook.command);
    
    // 对每个参数进行转义
    const safeArgs = args.map(arg => 
        interpolateVariables(arg, vars, { escape: shellEscape })
    );
    
    // 使用 execFile 而非 exec
    return execFile(cmd, safeArgs, { timeout: hook.timeout * 1000 });
}
```

---

## 📈 代码指标

| 指标 | 值 | 评价 |
|------|-----|------|
| 总文件数 | ~35 (src) + ~20 (webview) | 中等规模 |
| 最大文件 | agent.ts (2800+ 行) | ⚠️ 过大 |
| 外部运行时依赖 | 0 (puppeteer-core 可选) | ✅ 优秀 |
| TypeScript 严格模式 | 关闭 (strict: false) | ⚠️ 建议开启 |
| 安全检查层数 | 5+ (命令/路径/SSRF/沙箱/hooks) | ✅ 深度防御 |
| 测试文件数 | 7 | ⚠️ 不足 |

---

## 🎯 总体评价

**MiMo Agent** 是一个功能丰富的 VS Code AI 编程助手，核心架构合理，安全设计有多层防护，零外部依赖的策略值得肯定。

**主要风险**集中在：
1. **Shell 注入**（hooks.ts, desktop.ts）— 最高优先级
2. **安全检查绕过**（safety.ts 的正则解析固有缺陷）
3. **SSRF 防护不完整**

**主要技术债**：
1. `agent.ts` 单体文件
2. 测试覆盖不足
3. 静默错误处理

建议按 P0 → P1 → P2 优先级逐步修复，重点先堵住命令注入漏洞。

---

*本报告基于 2026-06-07 的代码快照，为只读审计，未修改任何文件。*
