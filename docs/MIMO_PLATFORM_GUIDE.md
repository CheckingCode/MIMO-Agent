# 小米 MiMo API 开放平台完整指南

> 文档来源：https://platform.xiaomimimo.com/docs/zh-CN/welcome
> 更新时间：2026年6月10日

---

## 目录

1. [平台概述](#平台概述)
2. [模型能力与参数](#模型能力与参数)
3. [API调用方式](#api调用方式)
4. [价格体系](#价格体系)
5. [工具调用能力](#工具调用能力)
6. [多模态理解能力](#多模态理解能力)
7. [集成工具配置](#集成工具配置)
8. [最佳实践](#最佳实践)

---

## 平台概述

**Xiaomi MiMo API 开放平台** 提供小米自研AI模型的高性能推理服务，兼容 OpenAI 和 Anthropic API 格式。

### 核心特点

- **兼容性**：支持 OpenAI 和 Anthropic 两种API协议
- **多模型支持**：文本生成、语音识别、语音合成、多模态理解
- **灵活计费**：按量付费和Token Plan套餐两种方式
- **全球服务**：国内外均有服务节点

### 官方资源

| 资源 | 地址 |
|------|------|
| 控制台 | https://platform.xiaomimimo.com/#/console |
| API Keys管理 | https://platform.xiaomimimo.com/#/console/api-keys |
| 用量统计 | https://platform.xiaomimimo.com/#/console/usage |
| 文档中心 | https://platform.xiaomimimo.com/docs/zh-CN/welcome |

---

## 模型能力与参数

### 文本生成模型

| 模型系列 | 模型ID | 能力支持 | 上下文长度 | 最大输出 |
|----------|--------|----------|------------|----------|
| **Pro系列** | `mimo-v2.5-pro` | 文本生成、深度思考、流式输出、函数调用、结构化输出、网页搜索 | 1M | 128K |
| **Pro系列** | `mimo-v2-pro` | 文本生成、深度思考、流式输出、函数调用、结构化输出、网页搜索 | 1M | 128K |
| **Omni系列** | `mimo-v2.5` | 文本生成、全模态理解、深度思考、流式输出、函数调用、结构化输出、网页搜索 | 1M | 128K |
| **Omni系列** | `mimo-v2-omni` | 文本生成、全模态理解、深度思考、流式输出、函数调用、结构化输出、网页搜索 | 256K | 128K |
| **Flash系列** | `mimo-v2-flash` | 文本生成、深度思考、流式输出、函数调用、结构化输出、网页搜索 | 256K | 64K |

### 语音识别模型 (ASR)

| 模型ID | 能力支持 | 上下文长度 | 最大输出 | 速率限制 |
|--------|----------|------------|----------|----------|
| `mimo-v2.5-asr` | 语音识别 | 8K | 2K | RPM: 100, TPM: 10K |

### 语音合成模型 (TTS)

| 模型ID | 能力支持 | 上下文长度 | 最大输出 | 速率限制 |
|--------|----------|------------|----------|----------|
| `mimo-v2.5-tts` | 语音合成 | 8K | 8K | RPM: 100, TPM: 10M |
| `mimo-v2.5-tts-voiceclone` | 语音合成 + 音色克隆 | 8K | 8K | RPM: 100, TPM: 10M |
| `mimo-v2.5-tts-voicedesign` | 语音合成 + 音色设计 | 8K | 8K | RPM: 100, TPM: 10M |
| `mimo-v2-tts` | 语音合成 | 8K | 8K | RPM: 100, TPM: 10M |

### 速率限制说明

- **RPM (Requests Per Minute)**：每分钟最大请求数（单账户下所有API Key调用同一模型的总和）
- **TPM (Tokens Per Minute)**：每分钟最大Token交互量

### 模型选择指南

| 使用场景 | 推荐模型 |
|----------|----------|
| 复杂推理、深度分析、长文档处理 | `mimo-v2.5-pro` |
| 图像、音频、视频内容理解 | `mimo-v2.5` 或 `mimo-v2-omni` |
| 低成本、快速响应 | `mimo-v2-flash` |
| 语音转文字 (中英文) | `mimo-v2.5-asr` |
| 文字转语音 (标准预设音色) | `mimo-v2.5-tts` |
| 音色克隆 (上传音频样本) | `mimo-v2.5-tts-voiceclone` |
| 自定义音色设计 | `mimo-v2.5-tts-voicedesign` |

---

## API调用方式

### 认证方式

支持两种认证方法（任选其一）：

1. **api-key 头部认证**：
```json
api-key: $MIMO_API_KEY
Content-Type: application/json
```

2. **Authorization Bearer 认证**：
```json
Authorization: Bearer $MIMO_API_KEY
Content-Type: application/json
```

### 端点地址

| 协议 | 端点 |
|------|------|
| OpenAI兼容 | `https://api.xiaomimimo.com/v1/chat/completions` |
| Anthropic兼容 | `https://api.xiaomimimo.com/anthropic/v1/messages` |

### Token Plan 端点

| 协议 | 端点 |
|------|------|
| OpenAI兼容 | `https://token-plan-cn.xiaomimimo.com/v1/chat/completions` |
| Anthropic兼容 | `https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages` |

### Python SDK 示例 (OpenAI格式)

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/v1"
)

completion = client.chat.completions.create(
    model="mimo-v2.5-pro",
    messages=[
        {
            "role": "system",
            "content": "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024."
        },
        {
            "role": "user",
            "content": "please introduce yourself"
        }
    ],
    max_completion_tokens=1024,
    temperature=1.0,
    top_p=0.95,
    stream=False
)
```

### Python SDK 示例 (Anthropic格式)

```python
import os
from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ.get("MIMO_API_KEY"),
    base_url="https://api.xiaomimimo.com/anthropic"
)

message = client.messages.create(
    model="mimo-v2.5-pro",
    max_tokens=1024,
    system="You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024.",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "please introduce yourself"
                }
            ]
        }
    ],
    top_p=0.95,
    stream=False
)
```

### curl 示例 (OpenAI格式)

```bash
curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
--header "api-key: $MIMO_API_KEY" \
--header "Content-Type: application/json" \
--data-raw '{
    "model": "mimo-v2.5-pro",
    "messages": [
        {
            "role": "system",
            "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
        },
        {
            "role": "user",
            "content": "please introduce yourself"
        }
    ],
    "max_completion_tokens": 1024,
    "temperature": 1.0,
    "top_p": 0.95,
    "stream": false
}'
```

### curl 示例 (Anthropic格式)

```bash
curl --location --request POST 'https://api.xiaomimimo.com/anthropic/v1/messages' \
--header "api-key: $MIMO_API_KEY" \
--header "Content-Type: application/json" \
--data-raw '{
    "model": "mimo-v2.5-pro",
    "max_tokens": 1024,
    "system": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "please introduce yourself"
                }
            ]
        }
    ],
    "top_p": 0.95,
    "stream": false
}'
```

### 推荐系统提示词

**中文版：**
```
你是MiMo（中文名称也是MiMo），是小米公司研发的AI智能助手。
今天的日期：{date} {week}，你的知识截止日期是2024年12月。
```

**英文版：**
```
You are MiMo, an AI assistant developed by Xiaomi.
Today's date: {date} {week}. Your knowledge cutoff date is December 2024.
```

---

## 价格体系

### 计费说明

- **计费单位**：中国：¥ / M tokens；海外：$ / M tokens
- **缓存命中**：当请求前缀内容命中Prompt Cache时，按缓存命中价格计费
- **缓存写入**：限时免费
- **ASR系列**：按输入音频时长计费（精确到秒，最终按时计费）
- **网页搜索**：按调用次数独立计费，不包含在Token价格内

### 国内价格 (2026年5月27日起生效)

#### MiMo-V2.5系列

| 模型 | 输入 (缓存命中) | 输入 (缓存未命中) | 输出 |
|------|-----------------|-------------------|------|
| `mimo-v2.5-pro` | ¥0.025 | ¥3.00 | ¥6.00 |
| `mimo-v2.5` | ¥0.02 | ¥1.00 | ¥2.00 |

#### MiMo-V2系列

| 模型 | 输入 (缓存命中) | 输入 (缓存未命中) | 输出 |
|------|-----------------|-------------------|------|
| `mimo-v2-pro` | ¥0.025 | ¥3.00 | ¥6.00 |
| `mimo-v2-omni` | ¥0.02 | ¥1.00 | ¥2.00 |
| `mimo-v2-flash` | ¥0.07 | ¥0.70 | ¥2.10 |

#### ASR系列

| 模型 | 输入音频时长 |
|------|--------------|
| `mimo-v2.5-asr` | ¥0.5 /h |

#### TTS系列

`mimo-v2.5-tts`、`mimo-v2.5-tts-voiceclone`、`mimo-v2.5-tts-voicedesign`、`mimo-v2-tts` 限时免费

### 重要通知

- **mimo-v2-pro 和 mimo-v2-omni** 已于2026年6月1日00:00 (GMT+8) 自动路由到V2.5（按V2.5价格计费），将于6月30日完全下线。建议尽快切换到新版模型。

---

## 工具调用能力

### 网页搜索

**核心能力：**
- 灵活搜索模式：支持强制搜索和意图识别（意图识别开启时，模型自主决定是否搜索）
- 早期搜索源返回：流式响应中，第一个数据包返回所有搜索源
- 混合多工具调用：可与自定义函数和工具配合使用
- 灵活响应模式：支持流式和非流式响应

**使用前提：** 需先在控制台→插件管理中激活网页搜索插件

**请求格式：**

```json
{
  "tools": [
    {
      "type": "web_search",
      "max_keyword": 3,
      "force_search": true,
      "limit": 1,
      "user_location": {
        "type": "approximate",
        "country": "China",
        "region": "Hubei",
        "city": "Wuhan"
      }
    }
  ]
}
```

**参数说明：**
- `max_keyword`：每次搜索轮次的最大关键词数（控制调用频率和成本）
- `force_search`：强制搜索模式
- `limit`：返回结果数量限制
- `user_location`：用户位置信息（可选）

### 函数调用 (Function Calling)

支持标准的OpenAI函数调用格式，可定义自定义工具供模型调用。

---

## 多模态理解能力

### 图像理解

支持图像URL和Base64编码两种输入方式。

**请求格式：**

```json
{
  "model": "mimo-v2.5",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/image.png"
          }
        },
        {
          "type": "text",
          "text": "请描述图片内容"
        }
      ]
    }
  ]
}
```

### 音频理解

支持音频文件输入，可进行音频内容分析和理解。

### 视频理解

支持视频文件输入，可进行视频内容分析和理解。

### 语音识别 (ASR)

将语音转换为文字，支持中英文。

---

## 集成工具配置

### Claude Code 配置

#### 基本设置

1. **安装 Claude Code CLI**：
```bash
npm install -g @anthropic-ai/claude-code
```

2. **创建/编辑 `settings.json`**（路径：`~/.claude/settings.json`）：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.xiaomimimo.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "YOUR_MIMO_API_KEY",
    "ANTHROPIC_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "mimo-v2.5-pro"
  }
}
```

3. **创建/编辑 `.claude.json`**（路径：`~/.claude.json`）：

```json
{
  "hasCompletedOnboarding": true
}
```

4. **重启终端**使配置生效

#### 启用1M长上下文

在模型ID后添加 `[1m]` 后缀：
```json
{
  "ANTHROPIC_MODEL": "mimo-v2.5-pro[1m]"
}
```

#### VS Code 插件配置

在VS Code设置中搜索 `Claude Code: Environment Variables`，添加：

```json
{
  "claudeCode.preferredLocation": "panel",
  "claudeCode.selectedModel": "mimo-v2.5-pro",
  "claudeCode.environmentVariables": [
    {
      "name": "ANTHROPIC_BASE_URL",
      "value": "https://api.xiaomimimo.com/anthropic"
    },
    {
      "name": "ANTHROPIC_AUTH_TOKEN",
      "value": "YOUR_MIMO_API_KEY"
    }
  ]
}
```

### 支持的集成工具

平台支持多种主流AI编程工具的集成：

| 工具 | 配置文档 |
|------|----------|
| OpenCode | https://platform.xiaomimimo.com/static/docs/integration/opencode.md |
| Claude Code | https://platform.xiaomimimo.com/static/docs/integration/claudecode.md |
| OpenClaw | https://platform.xiaomimimo.com/static/docs/integration/openclaw.md |
| Hermes Agent | https://platform.xiaomimimo.com/static/docs/integration/hermes-agent.md |
| Kilo Code | https://platform.xiaomimimo.com/static/docs/integration/kilocode.md |
| Cherry Studio | https://platform.xiaomimimo.com/static/docs/integration/cherrystudio.md |
| Qwen Code | https://platform.xiaomimimo.com/static/docs/integration/qwencode.md |
| CodeBuddy | https://platform.xiaomimimo.com/static/docs/integration/codebuddy.md |
| Cline | https://platform.xiaomimimo.com/static/docs/integration/cline.md |

---

## API详细规范

### 消息角色类型

| 角色 | 说明 | 内容格式 |
|------|------|----------|
| `system` | 开发者提供的系统指令 | string 或 TextContentPart[] |
| `developer` | 开发者提供的指令（与system相同） | string 或 TextContentPart[] |
| `user` | 用户发送的消息 | string 或 ContentPart[]（支持文本、图像、音频、视频） |
| `assistant` | 模型回复的消息 | string 或 TextContentPart[] |
| `tool` | 工具调用结果 | string 或 TextContentPart[] |

### 用户消息内容类型

#### 文本内容
```json
{
  "type": "text",
  "text": "你的文本内容"
}
```

#### 图像内容
```json
{
  "type": "image_url",
  "image_url": {
    "url": "https://example.com/image.png 或 base64编码"
  }
}
```

#### 音频内容
```json
{
  "type": "input_audio",
  "input_audio": {
    "data": "https://example.com/audio.mp3 或 base64编码"
  }
}
```

#### 视频内容
```json
{
  "type": "video_url",
  "video_url": {
    "url": "https://example.com/video.mp4 或 base64编码",
    "fps": 2,  // 可选，帧率范围 [0.1, 10.0]，默认2
    "media_resolution": "default"  // 可选，"default" 或 "max"
  }
}
```

### 请求参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `messages` | array | ✅ | - | 对话消息列表 |
| `model` | string | ✅ | - | 模型ID |
| `max_completion_tokens` | integer | ❌ | 按模型 | 最大生成token数 |
| `temperature` | number | ❌ | 按模型 | 采样温度，范围 [0, 1.5] |
| `top_p` | number | ❌ | 0.95 | 核采样概率阈值，范围 [0.01, 1.0] |
| `frequency_penalty` | number | ❌ | 0 | 频率惩罚，范围 [-2.0, 2.0] |
| `presence_penalty` | number | ❌ | 0 | 存在惩罚，范围 [-2.0, 2.0] |
| `stream` | boolean | ❌ | false | 是否启用流式输出 |
| `stop` | string/array | ❌ | null | 停止序列（最多4个） |
| `tools` | array | ❌ | - | 工具列表（函数、网页搜索） |
| `tool_choice` | string | ❌ | auto | 工具选择方式 |
| `thinking` | object | ❌ | - | 思考模式配置 |
| `response_format` | object | ❌ | - | 响应格式（text或json_object） |
| `audio` | object | ❌ | - | 音频输出参数（TTS模型专用） |

### 思考模式配置

```json
{
  "thinking": {
    "type": "enabled"  // "enabled" 或 "disabled"
  }
}
```

**思考模式特点：**
- `mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro`、`mimo-v2-omni` 默认启用
- `mimo-v2-flash` 默认禁用
- 启用时，模型返回 `reasoning_content` 字段
- 多轮工具调用时，建议保留之前的 `reasoning_content`
- 启用时，`temperature` 和 `top_p` 参数被强制设为默认值（1.0 和 0.95）

### 工具调用配置

#### 函数工具
```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取指定城市的天气信息",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称"
            }
          },
          "required": ["city"]
        },
        "strict": false  // 可选，是否严格遵循schema
      }
    }
  ]
}
```

#### 网页搜索工具
```json
{
  "tools": [
    {
      "type": "web_search",
      "force_search": false,  // 可选，是否强制搜索
      "max_keyword": 5,       // 可选，最大关键词数 [1, 50]
      "limit": 5,             // 可选，最大返回结果数 [1, 50]
      "user_location": {      // 可选，用户位置
        "type": "approximate",
        "country": "China",
        "region": "Beijing",
        "city": "Beijing"
      }
    }
  ]
}
```

### 响应对象结构

#### 非流式响应
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "mimo-v2.5-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "回复内容",
        "reasoning_content": "思考过程（思考模式下）",
        "tool_calls": [...],
        "annotations": [...],  // 网页搜索结果
        "audio": {...}         // TTS输出
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0,
      "image_tokens": 0,
      "video_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0
    },
    "web_search_usage": {
      "tool_usage": 0,
      "page_usage": 0
    }
  }
}
```

#### 流式响应
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "mimo-v2.5-pro",
  "choices": [
    {
      "index": 0,
      "delta": {
        "role": "assistant",
        "content": "部分文本",
        "reasoning_content": "部分思考",
        "tool_calls": [...],
        "annotations": [...],
        "audio": {...}
      },
      "finish_reason": null
    }
  ]
}
```

### finish_reason 说明

| 值 | 说明 |
|----|------|
| `stop` | 模型正常停止（自然停止或遇到stop序列） |
| `length` | 达到最大token数限制 |
| `tool_calls` | 模型调用了工具 |
| `content_filter` | 内容被过滤 |
| `repetition_truncation` | 检测到重复内容 |

### TTS音频参数

```json
{
  "audio": {
    "format": "wav",              // 输出格式：wav, mp3, pcm, pcm16
    "voice": "mimo_default",      // 音色ID
    "optimize_text_preview": false // 是否优化广播文本
  }
}
```

**可用音色：**
- `mimo-v2-tts`: `mimo_default`, `default_en`, `default_zh`
- `mimo-v2.5-tts`: `mimo_default`, `冰糖`, `茉莉`, `苏打`, `白桦`, `Mia`, `Chloe`, `Milo`, `Dean`

---

## 最佳实践

### 1. 思考模式 (Thinking Mode)

在多轮工具调用中，模型会返回 `reasoning_content` 字段。为了获得最佳性能，建议在后续请求中保留所有之前的 `reasoning_content`。

**请求示例：**

```json
{
  "messages": [
    {
      "role": "assistant",
      "content": "你好！我是MiMo。",
      "reasoning_content": "用户刚才让我做自我介绍，这是一个比较简单的请求，但我应该想想他们为什么这么问。"
    },
    {
      "role": "user",
      "content": "河北天气怎么样？"
    }
  ]
}
```

### 2. 上下文管理

- 对于支持1M上下文的模型，可在模型ID后添加 `[1m]` 启用
- 合理使用Prompt Cache可以显著降低成本
- 长对话时注意控制历史消息长度

### 3. 错误处理

- 遇到 `429` 错误时，实施重试和退避策略
- 合理规划请求频率，避免触发速率限制

### 4. 流式输出

- 支持流式和非流式两种响应模式
- 流式输出可提升用户体验
- 网页搜索的流式响应会在第一个数据包返回搜索源

### 5. 成本优化

- 使用缓存命中可降低输入成本（缓存命中价约1/100）
- 网页搜索使用 `max_keyword` 参数控制搜索次数
- 根据场景选择合适的模型（Flash系列成本最低）

### 6. API Key安全

- 将API Key配置在环境变量中，不要硬编码
- 定期轮换API Key
- 监控用量统计，及时发现异常

---

## 更新日志参考

平台会持续更新模型和功能，建议关注：

- **模型发布**：https://platform.xiaomimimo.com/static/docs/updates/model.md
- **功能更新**：https://platform.xiaomimimo.com/static/docs/updates/feature.md
- **模型下线**：https://platform.xiaomimimo.com/static/docs/updates/deprecate.md

---

## 联系与支持

- **控制台**：https://platform.xiaomimimo.com/#/console
- **API Keys管理**：https://platform.xiaomimimo.com/#/console/api-keys
- **用量统计**：https://platform.xiaomimimo.com/#/console/usage
- **文档中心**：https://platform.xiaomimimo.com/docs/zh-CN/welcome

---

*本文档基于小米MiMo API开放平台官方文档整理，如有变动请以官方最新文档为准。*
