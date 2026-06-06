---
name: git
description: Git operations and commit message generation
---

Git 操作助手。请根据以下需求执行 Git 操作：

{{input}}

## 操作流程

### 第一步：了解状态
1. 执行 git status 查看当前状态
2. 执行 git log --oneline -10 查看最近提交
3. 执行 git diff 查看未提交的修改

### 第二步：执行操作
根据用户需求选择操作：

**查看类**
- git status — 工作区状态
- git log --oneline -20 — 最近提交
- git diff — 未暂存的修改
- git diff --staged — 已暂存的修改
- git blame file — 文件修改历史

**提交类**
- git add — 添加文件到暂存区
- git commit — 提交修改
- git commit -m "message" — 直接提交

**分支类**
- git branch — 查看分支
- git checkout branch — 切换分支
- git checkout -b branch — 创建并切换
- git merge branch — 合并分支

### 第三步：生成 Commit Message
格式：
\`\`\`
<type>(<scope>): <subject>

<body>
\`\`\`

type 类型：
- feat: 新功能
- fix: 修复 bug
- docs: 文档修改
- style: 代码格式（不影响功能）
- refactor: 重构
- test: 添加测试
- chore: 构建/工具修改
- perf: 性能优化

### 第四步：验证
1. 提交前检查 git status 确认没有误提交
2. 提交后检查 git log 确认提交成功
3. 如果推送，检查远程是否成功

## 注意事项
- 不要提交敏感信息（密钥、密码等）
- 提交前确认代码可以编译/运行
- 一次提交只做一件事
- commit message 要清晰描述改动
