# 修复：首次响应直接中断需要重试

## 问题描述
用户反映 MIMO 插件首次响应经常直接中断（显示空响应或 "(no response)"），需要手动重试才能正常工作。

## 根因分析

### 根因 1：SSE 流意外中断时静默返回空结果 (api.ts:519-537)

当 SSE 流因网络抖动、代理超时、服务端过早关闭连接等原因中断时：
- `res.on('end')` 触发并 resolve 一个 **空结果** (`content=''`, `toolCalls=[]`)
- 因为不是 error，`isRetryableStreamError` 不匹配
- `chatCompletionsStream` 的重试循环不会触发
- Agent 收到空结果，显示 "(no response)"

**首次更容易触发**：第一次请求时连接池是冷的，DNS/TLS/代理建立延迟更长，更容易出现"连接建立了但数据流不完整"。

### 根因 2：`res.on('end')` 丢失 buffer 中的残余数据

SSE 解析使用 `buffer += chunk` + `\n` 分割。如果最后一个 chunk 不以 `\n` 结尾（连接在最后一行数据传输中中断），buffer 中的残余数据会被丢弃，导致丢失最后一部分响应内容。

### 根因 3：非流式请求缺少重试机制 (api.ts:283)

`chatCompletion`（非流式）没有像 `chatCompletionsStream` 那样的重试逻辑，遇到可重试错误直接失败。

## 修复内容

### Fix 1：空响应检测 + 自动重试 (api.ts:378-385)
在 `chatCompletionsStream` 中，当 `doChatCompletionsStream` 返回空结果时，抛出 `unexpected end of data: empty stream response` 错误。该错误匹配 `isRetryableStreamError` 中的 `unexpected end of data` 模式，会触发自动重试（最多 4 次，指数退避）。

### Fix 2：`res.on('end')` 时 flush buffer 残余数据 (api.ts:547-587)
在流结束时检查 buffer 中是否有未处理的残余 SSE 数据。如果有，尝试解析并合并到结果中，避免数据丢失。

### Fix 3：非流式请求添加重试逻辑 (api.ts:283-304)
将 `chatCompletion` 重命名为 `doChatCompletion`（private），新增 `chatCompletion` 公开方法包裹重试逻辑，与流式路径保持一致。

## 验证结果
- ✅ TypeScript 编译通过
- ✅ 全部 111 个测试通过
- ✅ `isRetryableStreamError` 已包含 `unexpected end of data` 模式

## 受影响文件
- `src/api.ts` — 核心修复（3 处改动）
