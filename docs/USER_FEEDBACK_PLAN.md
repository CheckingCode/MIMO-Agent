# MiMo Agent VSCode 扩展 - 用户反馈渠道建设方案

> 文档版本：v1.0  
> 创建时间：2026年6月10日  
> 作者：MiMo团队

---

## 目录

1. [方案概述](#方案概述)
2. [反馈类型设计](#反馈类型设计)
3. [技术架构方案](#技术架构方案)
4. [前端UI设计](#前端ui设计)
5. [数据存储方案](#数据存储方案)
6. [后端服务设计](#后端服务设计)
7. [实现计划](#实现计划)
8. [成本估算](#成本估算)

---

## 方案概述

### 背景

MiMo Agent VSCode扩展处于初始测试阶段，用户在使用过程中可能遇到各种问题。为了快速收集用户反馈、定位问题、改进产品，需要建立一个高效的用户反馈渠道。

### 设计目标

1. **低门槛**：用户一键提交反馈，无需离开扩展
2. **高价值**：自动收集上下文信息，减少用户描述成本
3. **可追溯**：反馈与用户会话、系统状态关联
4. **隐私安全**：敏感信息本地处理，可选上传
5. **可扩展**：支持多种反馈类型和后续处理流程

### 方案特点

- **本地优先**：反馈数据默认存储在本地，用户可选择上传
- **异步处理**：不阻塞用户正常使用
- **智能分析**：自动提取错误日志、会话历史
- **双向反馈**：支持开发者回复用户反馈

---

## 反馈类型设计

### 反馈分类体系

```
用户反馈
├── 🐛 Bug报告
│   ├── 功能异常
│   ├── 崩溃/无响应
│   ├── 界面问题
│   └── 性能问题
├── 💡 功能建议
│   ├── 新功能请求
│   ├── 功能改进
│   └── 体验优化
├── 📝 使用咨询
│   ├── 配置问题
│   ├── 使用方法
│   └── 兼容性问题
└── 🎉 正面反馈
    └── 使用心得/感谢
```

### 反馈内容结构

```typescript
interface FeedbackItem {
    // 基础信息
    id: string;                    // 反馈ID
    type: FeedbackType;           // 反馈类型
    category: string;             // 详细分类
    title: string;                // 标题
    description: string;          // 详细描述
    
    // 用户信息
    userId?: string;              // 用户标识（可选匿名）
    email?: string;               // 联系邮箱（可选）
    
    // 系统信息（自动收集）
    systemInfo: SystemInfo;
    
    // 上下文信息
    context: FeedbackContext;
    
    // 附件
    attachments: Attachment[];
    
    // 元数据
    status: FeedbackStatus;       // 状态
    priority: FeedbackPriority;   // 优先级
    createdAt: Date;
    updatedAt: Date;
    
    // 开发者回复
    replies: FeedbackReply[];
}

interface SystemInfo {
    extensionVersion: string;     // 扩展版本
    vscodeVersion: string;        // VS Code版本
    osPlatform: string;           // 操作系统
    osRelease: string;            // 系统版本
    nodeVersion: string;          // Node.js版本
    modelUsed: string;            // 使用的模型
    apiEndpoint: string;          // API端点
}

interface FeedbackContext {
    conversationId?: string;      // 会话ID
    lastMessages?: ChatMessage[]; // 最近对话（脱敏）
    errorLogs?: string[];         // 错误日志
    screenshots?: string[];       // 截图路径
    stepsToReproduce?: string;    // 复现步骤
    expectedBehavior?: string;    // 期望行为
    actualBehavior?: string;      // 实际行为
}

type FeedbackType = 'bug' | 'feature' | 'question' | 'positive';
type FeedbackStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed';
type FeedbackPriority = 'low' | 'medium' | 'high' | 'critical';
```

### 反馈表单字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 反馈类型 | 下拉选择 | ✅ | Bug/建议/咨询/正面 |
| 标题 | 文本输入 | ✅ | 简要描述问题 |
| 详细描述 | 多行文本 | ✅ | 详细说明 |
| 复现步骤 | 多行文本 | 🔶 | Bug必填 |
| 期望行为 | 多行文本 | 🔶 | Bug必填 |
| 联系邮箱 | 文本输入 | ❌ | 需要回复时填写 |
| 截图上传 | 文件上传 | ❌ | 最多3张 |
| 附加日志 | 文件上传 | ❌ | 可选 |

---

## 技术架构方案

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Feedback UI │  │ Feedback     │  │ Local        │          │
│  │  (Webview)   │←→│ Manager      │←→│ Storage      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                    │
│         │                 │                 │                    │
│  ┌──────┴─────────────────┴─────────────────┴──────┐           │
│  │              Feedback Collector                  │           │
│  │  - System Info    - Error Logs    - Screenshots  │           │
│  └──────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ (可选，用户授权)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Feedback Service (远程)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  REST API    │  │ Storage      │  │ Notification │          │
│  │  Endpoint    │  │ Service      │  │ Service      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户操作 → 触发反馈 → 收集上下文 → 本地存储 → (可选)上传服务 → 开发者处理 → 回复用户
```

---

## 前端UI设计

### 反馈入口位置

1. **主入口**：聊天界面底部的反馈按钮（💡图标）
2. **快捷键**：`Ctrl+Shift+F` 打开反馈面板
3. **错误触发**：API调用失败时弹出快速反馈入口
4. **命令面板**：`MiMo: Submit Feedback`

### 反馈面板布局

```
┌─────────────────────────────────────────────────────────────────┐
│  💬 Submit Feedback                                    [×]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  反馈类型:  [🐛 Bug报告 ▼]                                      │
│                                                                 │
│  标题:      [_________________________________]                 │
│                                                                 │
│  详细描述:  [_________________________________]                 │
│             [_________________________________]                 │
│             [_________________________________]                 │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  📋 自动收集的上下文信息                              [展开 ▼]  │
│                                                                 │
│  ┌─ 系统信息 ─────────────────────────────────────────────┐    │
│  │ 版本: 1.7.0 | VS Code: 1.92.0 | OS: Windows 10       │    │
│  │ 模型: mimo-v2.5-pro | 端点: api.xiaomimimo.com        │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ☐ 包含最近对话记录（自动脱敏）                                  │
│  ☐ 包含错误日志                                                 │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  📷 添加截图（最多3张）                                          │
│     [+] [image1.png] [image2.png]                              │
│                                                                 │
│  联系邮箱（可选）: [_________________________________]          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                           [取消]  [提交反馈]    │
└─────────────────────────────────────────────────────────────────┘
```

### 错误快速反馈弹窗

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ API调用失败                                  [×]           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  错误信息: Rate limit exceeded (429)                            │
│                                                                 │
│  [复制错误详情]  [提交Bug报告]  [忽略]                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Webview组件结构

```
src/webview/components/
├── feedback/
│   ├── FeedbackPanel.ts        # 主反馈面板
│   ├── FeedbackForm.ts         # 反馈表单
│   ├── FeedbackHistory.ts      # 历史反馈列表
│   ├── FeedbackDetail.ts       # 反馈详情/回复
│   ├── QuickFeedback.ts        # 快速反馈弹窗
│   └── ScreenshotUploader.ts   # 截图上传组件
```

---

## 数据存储方案

### 本地存储结构

```
~/.mimo/
├── feedback/                    # 反馈数据目录
│   ├── index.json              # 反馈索引
│   ├── {feedback-id}/          # 单条反馈
│   │   ├── metadata.json       # 反馈元数据
│   │   ├── content.json        # 反馈内容
│   │   ├── context.json        # 上下文信息
│   │   └── attachments/        # 附件目录
│   │       ├── screenshot-1.png
│   │       └── error.log
│   └── queue/                  # 待上传队列
│       └── {feedback-id}.json
└── ...
```

### 本地存储实现

```typescript
// src/feedback/localStore.ts
export class FeedbackLocalStore {
    private feedbackDir: string;
    
    constructor(mimoHome: string) {
        this.feedbackDir = path.join(mimoHome, 'feedback');
        this.ensureDirExists();
    }
    
    // 保存反馈
    async saveFeedback(feedback: FeedbackItem): Promise<void> {
        const feedbackPath = path.join(this.feedbackDir, feedback.id);
        await fs.promises.mkdir(feedbackPath, { recursive: true });
        
        // 保存元数据
        await this.writeJson(path.join(feedbackPath, 'metadata.json'), {
            id: feedback.id,
            type: feedback.type,
            status: feedback.status,
            createdAt: feedback.createdAt,
        });
        
        // 保存内容
        await this.writeJson(path.join(feedbackPath, 'content.json'), {
            title: feedback.title,
            description: feedback.description,
            category: feedback.category,
            stepsToReproduce: feedback.stepsToReproduce,
            expectedBehavior: feedback.expectedBehavior,
            actualBehavior: feedback.actualBehavior,
        });
        
        // 保存上下文
        await this.writeJson(path.join(feedbackPath, 'context.json'), feedback.context);
        
        // 更新索引
        await this.updateIndex(feedback);
    }
    
    // 获取反馈列表
    async getFeedbackList(options?: {
        type?: FeedbackType;
        status?: FeedbackStatus;
        limit?: number;
    }): Promise<FeedbackItem[]> {
        // 实现略
    }
    
    // 获取单条反馈
    async getFeedback(id: string): Promise<FeedbackItem | null> {
        // 实现略
    }
    
    // 删除反馈
    async deleteFeedback(id: string): Promise<void> {
        // 实现略
    }
}
```

### 隐私保护措施

1. **敏感信息脱敏**：
   - API Key、Token 自动替换为 `[REDACTED]`
   - 用户输入中的邮箱、手机号等自动隐藏
   - 文件路径保留相对路径，隐藏用户名

2. **用户控制**：
   - 默认不上传，用户手动确认
   - 可选择是否包含对话记录
   - 可随时删除本地反馈数据

3. **数据最小化**：
   - 只收集必要的调试信息
   - 截图自动模糊处理敏感区域
   - 日志自动过滤个人信息

---

## 后端服务设计

### 方案A：轻量级方案（推荐起步）

使用 GitHub Issues 作为反馈存储，无需自建服务。

```typescript
// src/feedback/githubSubmitter.ts
export class GitHubFeedbackSubmitter {
    private repoOwner = 'XiaomiMiMo';
    private repoName = 'mimo-agent-vscode';
    
    async submit(feedback: FeedbackItem): Promise<string> {
        // 构建 Issue 内容
        const title = `[${feedback.type.toUpperCase()}] ${feedback.title}`;
        const body = this.buildIssueBody(feedback);
        
        // 使用 GitHub API 创建 Issue
        const response = await fetch(
            `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/issues`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `token ${this.getGitHubToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title,
                    body,
                    labels: this.getLabels(feedback),
                }),
            }
        );
        
        const issue = await response.json();
        return issue.html_url;
    }
    
    private buildIssueBody(feedback: FeedbackItem): string {
        return `
## 反馈信息

**类型**: ${feedback.type}
**分类**: ${feedback.category}
**版本**: ${feedback.systemInfo.extensionVersion}

### 问题描述

${feedback.description}

${feedback.stepsToReproduce ? `### 复现步骤\n\n${feedback.stepsToReproduce}` : ''}
${feedback.expectedBehavior ? `### 期望行为\n\n${feedback.expectedBehavior}` : ''}
${feedback.actualBehavior ? `### 实际行为\n\n${feedback.actualBehavior}` : ''}

### 系统信息

| 项目 | 值 |
|------|-----|
| 扩展版本 | ${feedback.systemInfo.extensionVersion} |
| VS Code版本 | ${feedback.systemInfo.vscodeVersion} |
| 操作系统 | ${feedback.systemInfo.osPlatform} ${feedback.systemInfo.osRelease} |
| 使用模型 | ${feedback.systemInfo.modelUsed} |
| API端点 | ${feedback.systemInfo.apiEndpoint} |

### 对话上下文

\`\`\`
${this.sanitizeConversation(feedback.context.lastMessages)}
\`\`\`

### 错误日志

\`\`\`
${feedback.context.errorLogs?.join('\n') || '无'}
\`\`\`

---
*由 MiMo Agent VSCode 扩展自动提交*
        `.trim();
    }
    
    private getLabels(feedback: FeedbackItem): string[] {
        const labels = ['feedback', feedback.type];
        if (feedback.priority === 'critical') labels.push('priority: critical');
        return labels;
    }
}
```

**优点**：
- 零成本，无需自建服务
- GitHub Issue 自带通知、标签、里程碑功能
- 社区可见，增加透明度

**缺点**：
- 依赖 GitHub，可能有访问限制
- 无法存储大型附件
- 不适合私有反馈

### 方案B：自建服务方案（规模化后）

```typescript
// src/feedback/apiSubmitter.ts
export class ApiFeedbackSubmitter {
    private apiBase = 'https://feedback.xiaomimimo.com/api';
    
    async submit(feedback: FeedbackItem): Promise<string> {
        // 上传附件
        const attachmentUrls = await this.uploadAttachments(feedback.attachments);
        
        // 提交反馈
        const response = await fetch(`${this.apiBase}/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Extension-Version': feedback.systemInfo.extensionVersion,
            },
            body: JSON.stringify({
                ...feedback,
                attachments: attachmentUrls,
            }),
        });
        
        const result = await response.json();
        return result.id;
    }
    
    async getReplies(feedbackId: string): Promise<FeedbackReply[]> {
        const response = await fetch(`${this.apiBase}/feedback/${feedbackId}/replies`);
        return response.json();
    }
}
```

---

## 实现计划

### 阶段1：基础框架（1-2周）

- [ ] 创建反馈数据模型 (`src/feedback/types.ts`)
- [ ] 实现本地存储 (`src/feedback/localStore.ts`)
- [ ] 实现系统信息收集 (`src/feedback/systemInfo.ts`)
- [ ] 实现敏感信息脱敏 (`src/feedback/sanitizer.ts`)

### 阶段2：UI组件（2-3周）

- [ ] 创建反馈面板 (`src/webview/components/feedback/FeedbackPanel.ts`)
- [ ] 实现反馈表单 (`src/webview/components/feedback/FeedbackForm.ts`)
- [ ] 实现截图上传 (`src/webview/components/feedback/ScreenshotUploader.ts`)
- [ ] 添加快捷键和命令

### 阶段3：提交功能（1-2周）

- [ ] 实现 GitHub Issues 提交 (`src/feedback/githubSubmitter.ts`)
- [ ] 添加离线队列支持
- [ ] 实现提交状态跟踪

### 阶段4：增强功能（可选）

- [ ] 反馈历史查看
- [ ] 开发者回复通知
- [ ] 自动错误上报（需用户授权）
- [ ] 反馈分析仪表板

---

## 成本估算

### 开发成本

| 阶段 | 工时 | 说明 |
|------|------|------|
| 阶段1：基础框架 | 1-2周 | 数据模型、本地存储 |
| 阶段2：UI组件 | 2-3周 | 界面开发 |
| 阶段3：提交功能 | 1-2周 | GitHub集成 |
| 阶段4：增强功能 | 2-3周 | 可选 |
| **总计** | **6-10周** | 1人开发 |

### 运营成本

| 项目 | 成本 | 说明 |
|------|------|------|
| GitHub Issues | 免费 | 公开仓库 |
| 自建服务（如需要） | ~$50/月 | 轻量级服务器 |
| 存储（截图等） | ~$10/月 | 对象存储 |

---

## 总结

本方案采用**本地优先、异步上传**的架构，通过以下方式平衡用户体验和反馈质量：

1. **一键反馈**：用户无需离开扩展即可提交
2. **智能收集**：自动收集系统信息和错误日志
3. **隐私保护**：敏感信息自动脱敏，用户控制上传
4. **灵活部署**：可先用GitHub Issues，后期迁移到自建服务

建议从**方案A（GitHub Issues）**起步，快速验证反馈渠道的有效性，后期根据需求决定是否升级到自建服务。

---

*文档结束*
