import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getSettingsPanel, loadConfig, saveSetting } from '../config';
import { MiMoAgent } from '../agent';

// Simple i18n for settings page
type SettingsLang = 'en' | 'zh';
let settingsLang: SettingsLang = vscode.env.language.startsWith('zh') ? 'zh' : 'en';

const settingsTranslations: Record<SettingsLang, Record<string, string>> = {
    en: {
        'title': 'MiMo Settings',
        'subtitle': 'Model call settings are saved in <code>~/.mimo/settings.json</code>. VS Code settings and environment variables remain compatible fallbacks, but this file is the primary runtime config.',
        'open.config': 'Open Config File',
        'save.apply': 'Save and Apply',
        'provider': 'Provider Preset',
        'provider.hint': 'OpenAI-compatible endpoint presets are provided for common domestic and international model services. You can still choose Custom compatible for any other provider.',
        'api.connection': 'API Connection',
        'active.profile': 'Active Profile ID',
        'provider.profiles': 'Provider Profiles JSON',
        'provider.profiles.hint': 'Optional CC-switch style profiles. Each profile supports id, name, base_url, model, api_key, and models.',
        'profile.select': 'API Profile',
        'profile.name': 'Name',
        'provider.select': 'Provider',
        'provider.mimo': 'MiMo',
        'provider.mimo_balance': 'MiMo Balance',
        'provider.mimo_token_plan': 'MiMo Token Plan',
        'provider.deepseek': 'DeepSeek',
        'provider.openai': 'OpenAI',
        'provider.qwen': 'Qwen / DashScope',
        'provider.zhipu': 'Zhipu GLM',
        'provider.moonshot': 'Moonshot / Kimi',
        'provider.volcengine': 'Volcengine Ark',
        'provider.siliconflow': 'SiliconFlow',
        'provider.qianfan': 'Baidu Qianfan',
        'provider.hunyuan': 'Tencent Hunyuan',
        'provider.openrouter': 'OpenRouter',
        'provider.groq': 'Groq',
        'provider.gemini': 'Google Gemini',
        'provider.mistral': 'Mistral AI',
        'provider.xai': 'xAI Grok',
        'provider.custom': 'Custom compatible',
        'provider.add.with': 'Provider',
        'profile.add': 'Add',
        'profile.delete': 'Delete',
        'profile.json': 'JSON',
        'model.add': 'Add Model',
        'model.add.card': 'Add Model',
        'model.card.copy': 'Copy',
        'model.card.delete': 'Delete',
        'model.card.details': 'Details',
        'model.card.collapse': 'Collapse',
        'model.card.default': 'Default',
        'model.card.model': 'Model ID',
        'model.manager.hint': 'Each card is one runnable model with its own API key, endpoint, and model ID. Copy a card when two models share most settings.',
        'mimo.endpoint.note.title': 'MiMo API note',
        'mimo.endpoint.note.balance': 'Regular MiMo balance: use the API key from the regular MiMo console with Base URL https://api.xiaomimimo.com/v1.',
        'mimo.endpoint.note.token': 'Token Plan: use the Token Plan key with Base URL https://token-plan-cn.xiaomimimo.com/v1. The two keys are not interchangeable.',
        'api.key.show': 'Show API Key',
        'api.key.hide': 'Hide API Key',
        'model.list.title': 'Model List',
        'model.list.hint': 'Each API profile keeps its own model IDs. Click a chip to make it the default model, or remove unused IDs.',
        'model.new.label': 'Add model IDs',
        'model.new.placeholder': 'model-id, model-id-2',
        'model.connection': 'Model Connection',
        'api.key': 'API Key',
        'base.url': 'Base URL',
        'api.endpoint': 'API Endpoint',
        'api.endpoint.chat': 'Chat Completions',
        'api.endpoint.responses': 'Responses',
        'default.model': 'Default Model',
        'model.list': 'Model List (one per line)',
        'generation': 'Generation',
        'max.tokens': 'Max Tokens',
        'temperature': 'Temperature',
        'top.p': 'Top P',
        'command.timeout': 'Command Timeout (s)',
        'max.tool.output': 'Max Tool Output',
        'enable.thinking': 'Enable model thinking controls when the provider supports them',
        'reasoning.profile': 'Reasoning Profile',
        'reasoning.turbo': 'Turbo',
        'reasoning.fast': 'Fast',
        'reasoning.balanced': 'Balanced',
        'reasoning.deep': 'Deep',
        'reasoning.max': 'Max',
        'preset.fast': 'Fast coding',
        'preset.balanced': 'Balanced',
        'preset.long': 'Long task',
        'generation.hint': 'Generation settings affect coding speed, stability, and how much output/tool context MiMo can handle per turn.',
        'generation.tokens.hint': 'Higher token budgets help long coding tasks but increase cost and latency.',
        'generation.timeout.hint': 'Longer command timeout is useful for installs, tests, and data processing scripts.',
        'generation.output.hint': 'Tool output is compacted when it exceeds this limit to keep the UI responsive.',
        'notifications.title': 'Notifications',
        'completion.sound': 'Play a sound when a task completes',
        'completion.sound.volume': 'Volume',
        'completion.sound.hint': 'MiMo plays a short local chime after a live task finishes. History replay and restored conversations stay silent.',
        'memory.title': 'Learning Memory',
        'memory.enabled': 'Enable local long-term memory',
        'memory.learn': 'Learn explicit preferences from chat',
        'memory.max.items': 'Max memory items',
        'memory.max.injected': 'Memories injected per turn',
        'memory.hint': 'MiMo stores learned preferences locally in ~/.mimo/memory.json. It only learns explicit preference-like messages and filters likely secrets.',
        'sandbox.title': 'Sandbox and Command Safety',
        'sandbox.mode': 'Sandbox Mode',
        'sandbox.safe': 'Safe Mode (default local guarded execution)',
        'sandbox.docker': 'Docker (stronger isolation, requires Docker Desktop)',
        'docker.image': 'Docker Image',
        'memory.limit': 'Memory Limit',
        'cpu.limit': 'CPU Limit',
        'prefer.sandbox': 'Prefer sandboxed execution; fall back from Docker to Safe Mode when Docker is unavailable',
        'git.snapshot': 'Create optional Git snapshot before risky commands (off by default)',
        'audit.logs': 'Record command audit logs',
        'block.network': 'Block common network commands in Safe Mode',
        'sandbox.hint': 'Safe Mode adds command checks, workspace boundary checks, timeouts, output limits, optional Git snapshots, and audit logs. Git snapshots are off by default because they create commits.',
        'dependency.title': 'Dependency Install Policy',
        'dependency.enabled': 'Enable dependency install policy',
        'dependency.project.mode': 'Project dependency installs',
        'dependency.project.auto': 'Auto install project dependencies',
        'dependency.project.confirm': 'Ask before project dependency installs',
        'dependency.project.disabled': 'Disable project dependency installs',
        'dependency.system.mode': 'System software installs',
        'dependency.system.confirm': 'Always ask before system installs',
        'dependency.system.disabled': 'Disable system installs',
        'dependency.long.timeout': 'Long install timeout (s)',
        'dependency.hint': 'Project package manager installs can run automatically and wait longer. System software installs always require confirmation unless disabled.',
        'saved.success': 'Saved to ~/.mimo/settings.json and applied.',
        'saved.failed': 'Save failed. Check settings file permissions.',
    },
    zh: {
        'title': 'MiMo 设置',
        'subtitle': '模型调用设置保存在 <code>~/.mimo/settings.json</code>。VS Code 设置和环境变量仍可作为备用方案，但此文件是主要运行时配置。',
        'open.config': '打开配置文件',
        'save.apply': '保存并应用',
        'provider': '提供商预设',
        'provider.hint': '为常见国内外模型服务提供 OpenAI 兼容接口预设；未覆盖的服务仍可选择自定义兼容。',
        'active.profile': '当前配置 ID',
        'provider.profiles': '模型配置 Profiles JSON',
        'provider.profiles.hint': '可选的 CC-switch 风格配置。每个 profile 支持 id、name、base_url、model、api_key 和 models。',
        'profile.select': 'API 配置',
        'profile.name': '名称',
        'profile.add': '新增',
        'profile.delete': '删除',
        'profile.json': 'JSON',
        'model.add': '添加模型',
        'model.new.placeholder': 'model-id，多个可用逗号或换行',
        'model.connection': '模型连接',
        'api.key': 'API Key',
        'base.url': 'Base URL',
        'default.model': '默认模型',
        'model.list': '模型列表（每行一个）',
        'generation': '生成参数',
        'max.tokens': '最大 Tokens',
        'temperature': 'Temperature',
        'top.p': 'Top P',
        'command.timeout': '命令超时 (秒)',
        'max.tool.output': '工具最大输出',
        'enable.thinking': '启用模型思考控制（当提供商支持时）',
        'reasoning.profile': '推理策略',
        'reasoning.turbo': '极速',
        'reasoning.fast': '快速',
        'reasoning.balanced': '均衡',
        'reasoning.deep': '深入',
        'reasoning.max': '极限',
        'preset.fast': '快速编码',
        'preset.balanced': '均衡',
        'preset.long': '长任务',
        'generation.hint': '生成参数会影响编码速度、稳定性，以及 MiMo 每轮可处理的输出和工具上下文。',
        'generation.tokens.hint': '更高 token 预算适合长任务，但会增加成本和等待时间。',
        'generation.timeout.hint': '更长命令超时适合安装依赖、运行测试和数据处理脚本。',
        'generation.output.hint': '工具输出超过该限制会被压缩，以保持界面流畅。',
        'notifications.title': '通知提醒',
        'completion.sound': '任务完成时播放音效',
        'completion.sound.volume': '音量',
        'completion.sound.hint': 'MiMo 会在实时任务完成后播放一声本地短提示音；历史回放和恢复对话不会播放。',
        'memory.title': '学习记忆',
        'memory.enabled': '启用本地长期记忆',
        'memory.learn': '从聊天中学习明确偏好',
        'memory.max.items': '最大记忆条数',
        'memory.max.injected': '每轮注入的记忆条数',
        'memory.hint': 'MiMo 会把学到的偏好本地保存到 ~/.mimo/memory.json，只学习明确的偏好类消息，并过滤疑似密钥内容。',
        'sandbox.title': '沙箱和命令安全',
        'sandbox.mode': '沙箱模式',
        'sandbox.safe': '安全模式（默认本地受保护执行）',
        'sandbox.docker': 'Docker（更强隔离，需要 Docker Desktop）',
        'docker.image': 'Docker 镜像',
        'memory.limit': '内存限制',
        'cpu.limit': 'CPU 限制',
        'prefer.sandbox': '优先使用沙箱执行；当 Docker 不可用时回退到安全模式',
        'git.snapshot': '执行风险命令前创建可选 Git 快照（默认关闭）',
        'audit.logs': '记录命令审计日志',
        'block.network': '在安全模式下阻止常见网络命令',
        'sandbox.hint': '安全模式会添加命令检查、工作区边界检查、超时、输出限制、可选 Git 快照和审计日志。Git 快照默认关闭，因为它会创建提交。',
        'dependency.title': '依赖安装策略',
        'dependency.enabled': '启用依赖安装策略',
        'dependency.project.mode': '项目依赖安装',
        'dependency.project.auto': '自动安装项目依赖',
        'dependency.project.confirm': '安装项目依赖前询问',
        'dependency.project.disabled': '禁止安装项目依赖',
        'dependency.system.mode': '系统软件安装',
        'dependency.system.confirm': '系统安装前始终询问',
        'dependency.system.disabled': '禁止系统安装',
        'dependency.long.timeout': '长安装超时 (秒)',
        'dependency.hint': '项目包管理器安装可以自动执行并等待更久；系统级软件安装必须确认，或可直接禁用。',
        'saved.success': '已保存到 ~/.mimo/settings.json 并应用。',
        'saved.failed': '保存失败。请检查设置文件权限。',
    },
};

function t(key: string): string {
    if (settingsLang === 'zh') {
        const zhProviderFallback: Record<string, string> = {
            'provider.select': '服务商',
        'provider.mimo': 'MiMo',
        'provider.mimo_balance': 'MiMo 普通余额',
        'provider.mimo_token_plan': 'MiMo Token Plan',
            'provider.deepseek': 'DeepSeek',
            'provider.openai': 'OpenAI',
            'provider.qwen': '通义千问 / DashScope',
            'provider.zhipu': '智谱 GLM',
            'provider.moonshot': 'Moonshot / Kimi',
            'provider.volcengine': '火山方舟',
            'provider.siliconflow': '硅基流动',
            'provider.qianfan': '百度千帆',
            'provider.hunyuan': '腾讯混元',
            'provider.openrouter': 'OpenRouter',
            'provider.groq': 'Groq',
            'provider.gemini': 'Google Gemini',
            'provider.mistral': 'Mistral AI',
            'provider.xai': 'xAI Grok',
            'provider.custom': '自定义兼容',
            'provider.add.with': '新增服务商',
        };
        if (zhProviderFallback[key]) return zhProviderFallback[key];
    }
    const zhModelFallback: Record<string, string> = {
        'model.add.card': '新增模型',
        'model.card.copy': '复制',
        'model.card.delete': '删除',
        'model.card.details': '详情',
        'model.card.collapse': '收起',
        'model.card.default': '默认',
        'model.card.model': '模型 ID',
        'model.manager.hint': '每张卡片就是一个可运行模型，拥有自己的 API Key、Base URL 和模型 ID。配置相近时可以复制后再改。',
        'mimo.endpoint.note.title': 'MiMo API 与 Base URL 区别',
        'mimo.endpoint.note.balance': '普通余额：使用 MiMo 普通余额控制台的 API Key，Base URL 填 https://api.xiaomimimo.com/v1。',
        'mimo.endpoint.note.token': 'Token Plan：使用 Token Plan 的 API Key，Base URL 填 https://token-plan-cn.xiaomimimo.com/v1。两套 Key 不通用。',
        'api.key.show': '查看 API Key',
        'api.key.hide': '隐藏 API Key',
    };
    if (settingsLang === 'zh' && zhModelFallback[key]) return zhModelFallback[key];
    const zhFallback: Record<string, string> = {
        'api.connection': 'API 连接',
        'model.list.title': '模型列表',
        'model.list.hint': '每个 API 配置都有自己的模型 ID 列表。点击标签设为默认模型，也可以移除不用的模型。',
        'model.new.label': '添加模型 ID',
    };
    if (settingsLang === 'zh' && zhFallback[key]) return zhFallback[key];
    return settingsTranslations[settingsLang][key] || settingsTranslations['en'][key] || key;
}

function sanitizeString(value: unknown, maxLen: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/\x00/g, '').trim().slice(0, maxLen);
}

function sanitizeNumber(value: unknown, min: number, max: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(max, Math.max(min, value));
}

function sanitizeBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function detectProviderFromBaseUrl(baseUrl: string): string {
    const normalized = String(baseUrl || '').toLowerCase();
    if (normalized.includes('xiaomimimo') || normalized.includes('mimo')) return 'mimo';
    if (normalized.includes('deepseek')) return 'deepseek';
    if (normalized.includes('openai.com')) return 'openai';
    if (normalized.includes('dashscope.aliyuncs.com')) return 'qwen';
    if (normalized.includes('open.bigmodel.cn') || normalized.includes('api.z.ai')) return 'zhipu';
    if (normalized.includes('moonshot.cn') || normalized.includes('moonshot.ai')) return 'moonshot';
    if (normalized.includes('volces.com')) return 'volcengine';
    if (normalized.includes('siliconflow')) return 'siliconflow';
    if (normalized.includes('qianfan.baidubce.com')) return 'qianfan';
    if (normalized.includes('hunyuan.cloud.tencent.com')) return 'hunyuan';
    if (normalized.includes('openrouter.ai')) return 'openrouter';
    if (normalized.includes('groq.com')) return 'groq';
    if (normalized.includes('generativelanguage.googleapis.com')) return 'gemini';
    if (normalized.includes('mistral.ai')) return 'mistral';
    if (normalized.includes('api.x.ai')) return 'xai';
    return 'custom';
}

function sanitizeSettings(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') return {};
    const s = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    const apiKey = sanitizeString(s.api_key, 4096);
    if (apiKey !== undefined) out.api_key = apiKey;

    const baseUrl = sanitizeString(s.base_url, 2048);
    if (baseUrl && /^https?:\/\//i.test(baseUrl)) out.base_url = baseUrl.replace(/\/+$/, '');

    const model = sanitizeString(s.model, 128);
    if (model !== undefined) out.model = model;

    const apiEndpoint = sanitizeString(s.api_endpoint, 32);
    if (apiEndpoint && ['chat_completions', 'responses'].includes(apiEndpoint)) out.api_endpoint = apiEndpoint;

    const activeProviderProfile = sanitizeString(s.active_provider_profile, 80);
    if (activeProviderProfile !== undefined) out.active_provider_profile = activeProviderProfile;
    if (s.active_route && typeof s.active_route === 'object') {
        const rawRoute = s.active_route as Record<string, unknown>;
        const endpointId = sanitizeString(rawRoute.endpoint_id, 80);
        const routeModel = sanitizeString(rawRoute.model, 128);
        if (endpointId && routeModel) out.active_route = { endpoint_id: endpointId, model: routeModel };
    }

    if (Array.isArray(s.provider_profiles)) {
        out.provider_profiles = s.provider_profiles
            .map((profile) => {
                if (!profile || typeof profile !== 'object') return undefined;
                const raw = profile as Record<string, unknown>;
                const id = sanitizeString(raw.id, 80);
                const name = sanitizeString(raw.name, 120) || id;
                const provider = sanitizeString(raw.provider, 80) || detectProviderFromBaseUrl(String(raw.base_url || ''));
                const baseUrl = sanitizeString(raw.base_url, 2048);
                const apiEndpoint = sanitizeString(raw.api_endpoint, 32);
                const profileModel = sanitizeString(raw.model, 128) || '';
                const apiKey = sanitizeString(raw.api_key, 4096) || '';
                const profileModels = Array.isArray(raw.models)
                    ? raw.models.map(v => sanitizeString(v, 128)).filter((v): v is string => !!v).slice(0, 100)
                    : [];
                if (!id || !baseUrl || !/^https?:\/\//i.test(baseUrl)) return undefined;
                return {
                    id,
                    name,
                    provider,
                    base_url: baseUrl.replace(/\/+$/, ''),
                    api_endpoint: apiEndpoint === 'responses' ? 'responses' : 'chat_completions',
                    model: profileModel,
                    api_key: apiKey,
                    models: profileModels,
                };
            })
            .filter(Boolean)
            .slice(0, 50);
    }

    if (Array.isArray(s.models)) {
        out.models = s.models
            .map(v => sanitizeString(v, 128))
            .filter((v): v is string => !!v)
            .slice(0, 100);
    }

    const maxTokens = sanitizeNumber(s.max_tokens, 256, 65536);
    if (maxTokens !== undefined) out.max_tokens = Math.round(maxTokens);

    const temperature = sanitizeNumber(s.temperature, 0, 2);
    if (temperature !== undefined) out.temperature = temperature;

    const topP = sanitizeNumber(s.top_p, 0, 1);
    if (topP !== undefined) out.top_p = topP;

    const maxOutputLen = sanitizeNumber(s.max_output_len, 1000, 200000);
    if (maxOutputLen !== undefined) out.max_output_len = Math.round(maxOutputLen);

    const commandTimeout = sanitizeNumber(s.command_timeout, 5, 3600);
    if (commandTimeout !== undefined) out.command_timeout = Math.round(commandTimeout);

    const completionSoundVolume = sanitizeNumber(s.ui_completion_sound_volume, 0, 100);
    if (completionSoundVolume !== undefined) out.ui_completion_sound_volume = Math.round(completionSoundVolume);

    const reasoningEffort = sanitizeString(s.reasoning_effort, 16);
    if (reasoningEffort && ['turbo', 'fast', 'balanced', 'deep', 'max'].includes(reasoningEffort)) {
        out.reasoning_effort = reasoningEffort;
    }

    const dependencyLongTimeout = sanitizeNumber(s.dependency_install_long_timeout_sec, 60, 3600);
    if (dependencyLongTimeout !== undefined) out.dependency_install_long_timeout_sec = Math.round(dependencyLongTimeout);
    const memoryMaxItems = sanitizeNumber(s.memory_max_items, 10, 500);
    if (memoryMaxItems !== undefined) out.memory_max_items = Math.round(memoryMaxItems);
    const memoryMaxInjected = sanitizeNumber(s.memory_max_injected, 0, 20);
    if (memoryMaxInjected !== undefined) out.memory_max_injected = Math.round(memoryMaxInjected);

    const dependencyProjectMode = sanitizeString(s.dependency_install_project_mode, 32);
    if (dependencyProjectMode && ['auto', 'confirm', 'disabled'].includes(dependencyProjectMode)) {
        out.dependency_install_project_mode = dependencyProjectMode;
    }

    const dependencySystemMode = sanitizeString(s.dependency_install_system_mode, 32);
    if (dependencySystemMode && ['confirm', 'disabled'].includes(dependencySystemMode)) {
        out.dependency_install_system_mode = dependencySystemMode;
    }

    const sandboxMode = sanitizeString(s.sandbox_mode, 32);
    if (sandboxMode && ['safe', 'docker'].includes(sandboxMode)) out.sandbox_mode = sandboxMode;

    const sandboxCpu = sanitizeNumber(s.sandbox_cpu, 1, 16);
    if (sandboxCpu !== undefined) out.sandbox_cpu = Math.round(sandboxCpu);

    for (const key of ['enable_thinking', 'ui_completion_sound', 'sandbox_enabled', 'sandbox_git_snapshot', 'sandbox_logging', 'sandbox_network_disabled', 'dependency_install_enabled', 'memory_enabled', 'memory_learn_from_explicit_preferences']) {
        const value = sanitizeBoolean(s[key]);
        if (value !== undefined) out[key] = value;
    }

    const sandboxImage = sanitizeString(s.sandbox_image, 200);
    if (sandboxImage !== undefined) out.sandbox_image = sandboxImage;

    const sandboxMemory = sanitizeString(s.sandbox_memory, 32);
    if (sandboxMemory !== undefined) out.sandbox_memory = sandboxMemory;

    return out;
}

function applySettings(input: unknown): boolean {
    const s = sanitizeSettings(input);
    let ok = true;
    if (s.api_key !== undefined) ok = saveSetting('api.api_key', s.api_key) && ok;
    if (s.base_url !== undefined) ok = saveSetting('api.base_url', s.base_url) && ok;
    if (s.api_endpoint !== undefined) ok = saveSetting('api.api_endpoint', s.api_endpoint) && ok;
    if (s.model !== undefined) ok = saveSetting('api.model', s.model) && ok;
    if (s.models !== undefined) ok = saveSetting('api.models', s.models) && ok;
    if (s.active_provider_profile !== undefined) ok = saveSetting('api.active_provider_profile', s.active_provider_profile) && ok;
    if (s.active_route !== undefined) ok = saveSetting('api.active_route', s.active_route) && ok;
    if (s.provider_profiles !== undefined) ok = saveSetting('api.provider_profiles', s.provider_profiles) && ok;
    if (s.max_tokens !== undefined) ok = saveSetting('agent.max_tokens', s.max_tokens) && ok;
    if (s.temperature !== undefined) ok = saveSetting('agent.temperature', s.temperature) && ok;
    if (s.top_p !== undefined) ok = saveSetting('agent.top_p', s.top_p) && ok;
    if (s.enable_thinking !== undefined) ok = saveSetting('agent.enable_thinking', s.enable_thinking) && ok;
    if (s.reasoning_effort !== undefined) ok = saveSetting('agent.reasoning_effort', s.reasoning_effort) && ok;
    if (s.max_output_len !== undefined) ok = saveSetting('safety.max_output_len', s.max_output_len) && ok;
    if (s.command_timeout !== undefined) ok = saveSetting('safety.command_timeout', s.command_timeout) && ok;
    if (s.ui_completion_sound !== undefined) ok = saveSetting('ui.completion_sound', s.ui_completion_sound) && ok;
    if (s.ui_completion_sound_volume !== undefined) ok = saveSetting('ui.completion_sound_volume', s.ui_completion_sound_volume) && ok;
    if (s.sandbox_enabled !== undefined) ok = saveSetting('sandbox.enabled', s.sandbox_enabled) && ok;
    if (s.sandbox_mode !== undefined) ok = saveSetting('sandbox.mode', s.sandbox_mode) && ok;
    if (s.sandbox_image !== undefined) ok = saveSetting('sandbox.image', s.sandbox_image) && ok;
    if (s.sandbox_memory !== undefined) ok = saveSetting('sandbox.memory_limit', s.sandbox_memory) && ok;
    if (s.sandbox_cpu !== undefined) ok = saveSetting('sandbox.cpu_limit', s.sandbox_cpu) && ok;
    if (s.sandbox_git_snapshot !== undefined) ok = saveSetting('sandbox.git_snapshot', s.sandbox_git_snapshot) && ok;
    if (s.sandbox_logging !== undefined) ok = saveSetting('sandbox.logging', s.sandbox_logging) && ok;
    if (s.sandbox_network_disabled !== undefined) ok = saveSetting('sandbox.network_disabled', s.sandbox_network_disabled) && ok;
    if (s.dependency_install_enabled !== undefined) ok = saveSetting('dependency_install.enabled', s.dependency_install_enabled) && ok;
    if (s.dependency_install_project_mode !== undefined) ok = saveSetting('dependency_install.project_mode', s.dependency_install_project_mode) && ok;
    if (s.dependency_install_system_mode !== undefined) ok = saveSetting('dependency_install.system_mode', s.dependency_install_system_mode) && ok;
    if (s.dependency_install_long_timeout_sec !== undefined) ok = saveSetting('dependency_install.long_timeout_sec', s.dependency_install_long_timeout_sec) && ok;
    if (s.memory_enabled !== undefined) ok = saveSetting('memory.enabled', s.memory_enabled) && ok;
    if (s.memory_learn_from_explicit_preferences !== undefined) ok = saveSetting('memory.learn_from_explicit_preferences', s.memory_learn_from_explicit_preferences) && ok;
    if (s.memory_max_items !== undefined) ok = saveSetting('memory.max_items', s.memory_max_items) && ok;
    if (s.memory_max_injected !== undefined) ok = saveSetting('memory.max_injected', s.memory_max_injected) && ok;
    return ok;
}

function providerPresetOptionsHtml(): string {
    const entries = [
        'mimo_balance',
        'mimo_token_plan',
        'deepseek',
        'openai',
        'qwen',
        'zhipu',
        'moonshot',
        'volcengine',
        'siliconflow',
        'qianfan',
        'hunyuan',
        'openrouter',
        'groq',
        'gemini',
        'mistral',
        'xai',
        'custom',
    ];
    return entries
        .map((value) => `<option value="${value}">${t(`provider.${value}`)}</option>`)
        .join('');
}

export class SettingsProvider {
    private panel?: vscode.WebviewPanel;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agent: MiMoAgent,
        private readonly onSettingsApplied?: () => void,
    ) {}

    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active, false);
            this.panel.webview.postMessage({ type: 'settingsData', settings: getSettingsPanel() });
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'mimo-agent.settings',
            'MiMo Settings',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'mimo-agent-icon.svg');
        panel.onDidDispose(() => { this.panel = undefined; });
        panel.webview.html = this.getHtml(panel.webview);
        panel.webview.onDidReceiveMessage((msg) => {
            if (!msg || !msg.type) return;
            if (msg.type === 'ready') {
                panel.webview.postMessage({ type: 'settingsData', settings: getSettingsPanel() });
            } else if (msg.type === 'saveSettings') {
                const ok = applySettings(msg.settings);
                this.agent.updateConfig(loadConfig());
                this.onSettingsApplied?.();
                panel.webview.postMessage({ type: 'saveResult', ok, settings: getSettingsPanel() });
            } else if (msg.type === 'openSettingsFile') {
                const settingsPath = path.join(os.homedir(), '.mimo', 'settings.json');
                const settingsDir = path.dirname(settingsPath);
                if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
                if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, '{}\n', 'utf-8');
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(settingsPath));
            }
        });
    }

    private getHtml(_webview: vscode.Webview): string {
        const nonce = getNonce();
        const csp = [
            "default-src 'none'",
            `script-src 'nonce-${nonce}'`,
            "style-src 'unsafe-inline'",
        ].join('; ');
        const initialSettingsJson = JSON.stringify(getSettingsPanel()).replace(/[<>&]/g, (ch) => {
            if (ch === '<') return '\\u003c';
            if (ch === '>') return '\\u003e';
            return '\\u0026';
        });
        const pageTranslationsJson = JSON.stringify(
            Object.fromEntries(Object.keys(settingsTranslations.en).map((key) => [key, t(key)])),
        ).replace(/[<>&]/g, (ch) => {
            if (ch === '<') return '\\u003c';
            if (ch === '>') return '\\u003e';
            return '\\u0026';
        });
        return `<!DOCTYPE html>
<html lang="${settingsLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${t('title')}</title>
<style>
:root{color-scheme:dark light}
body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px}
.page{max-width:1120px;margin:0 auto;padding:24px 28px 40px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;border-bottom:1px solid var(--vscode-editorWidget-border);padding-bottom:16px}
h1{font-size:22px;margin:0 0 6px;font-weight:650}
.sub{color:var(--vscode-descriptionForeground);line-height:1.5}
.actions{display:flex;gap:8px;white-space:nowrap}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:4px;padding:7px 12px;cursor:pointer}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:hover{filter:brightness(1.08)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.section{border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:16px;background:var(--vscode-sideBar-background)}
.section.full{grid-column:1 / -1}
.section h2{font-size:14px;margin:0 0 14px;font-weight:650}
.field{display:grid;gap:6px;margin-bottom:12px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.generation-section{display:grid;gap:14px}
.param-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.param-grid .field{margin-bottom:0}
.generation-band{border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:12px;background:var(--vscode-input-background)}
.generation-band-title{font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:8px}
.preset-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.preset-btn{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);padding:6px 8px}
.preset-btn:hover{border-color:var(--vscode-focusBorder)}
.preference-strip{display:grid;grid-template-columns:max-content max-content minmax(170px,.55fr) minmax(0,1fr);align-items:center;gap:8px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px 12px;background:color-mix(in srgb,var(--vscode-input-background) 78%,transparent)}
.preference-strip-title{font-size:12px;font-weight:650;color:var(--vscode-foreground)}
.preference-strip .check{margin:0;white-space:nowrap}
.preference-strip .hint{margin:0}
.volume-control{display:grid;grid-template-columns:max-content minmax(90px,1fr) 40px;align-items:center;gap:8px}
.volume-control label,.volume-value{font-size:12px;color:var(--vscode-descriptionForeground)}
.volume-control input[type="range"]{padding:0}
.profile-bar{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:end;margin-bottom:12px}
.model-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
.model-list{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 12px;min-height:30px}
.model-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;padding:4px 7px;background:var(--vscode-input-background)}
.model-chip:hover{border-color:var(--vscode-focusBorder)}
.model-chip.active{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px color-mix(in srgb,var(--vscode-focusBorder) 55%,transparent)}
.model-chip button{padding:0 4px;background:transparent;color:var(--vscode-descriptionForeground);border:0}
.model-section .hint{margin-top:8px}
.endpoint-note{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 14px}
.endpoint-note-card{border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px 12px;background:color-mix(in srgb,var(--vscode-input-background) 82%,transparent)}
.endpoint-note-title{font-size:12px;font-weight:650;margin-bottom:4px;color:var(--vscode-foreground)}
.endpoint-note-text{font-size:12px;line-height:1.45;color:var(--vscode-descriptionForeground)}
.endpoint-note code{font-family:var(--vscode-editor-font-family);font-size:11px;color:var(--vscode-foreground)}
.models-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
.models-toolbar .hint{margin:0;max-width:650px}
.model-add-controls{display:grid;grid-template-columns:170px auto auto;gap:8px;align-items:center}
.profile-cards{display:grid;gap:10px}
.profile-card{border:1px solid var(--vscode-editorWidget-border);border-radius:6px;background:var(--vscode-input-background);padding:0;overflow:hidden}
.profile-card.active{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px color-mix(in srgb,var(--vscode-focusBorder) 45%,transparent)}
.profile-card-head{display:grid;grid-template-columns:24px minmax(180px,1.05fr) minmax(76px,max-content) minmax(150px,.9fr) minmax(220px,1.3fr) minmax(132px,max-content);align-items:center;gap:12px;padding:8px 12px;min-height:44px;user-select:none}
.profile-drag-handle{display:inline-flex;align-items:center;justify-content:center;width:22px;height:28px;border:1px solid transparent;border-radius:5px;color:var(--vscode-descriptionForeground);cursor:grab;font-size:16px;line-height:1}
.profile-drag-handle:hover{border-color:var(--vscode-editorWidget-border);background:color-mix(in srgb,var(--vscode-input-background) 70%,var(--vscode-foreground) 8%);color:var(--vscode-foreground)}
.profile-drag-handle:active{cursor:grabbing}
.profile-card.dragging{opacity:.35;border-style:dashed}
.profile-card.drag-over-top{border-top:2px solid var(--vscode-focusBorder)}
.profile-card.drag-over-bottom{border-bottom:2px solid var(--vscode-focusBorder)}
.profile-card-title{display:flex;align-items:center;gap:8px;font-weight:650;min-width:0}
.profile-card-title span,.profile-card-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.profile-card-summary{color:var(--vscode-descriptionForeground);font-size:12px}
.provider-pill{display:inline-flex;align-items:center;width:max-content;max-width:100%;border:1px solid var(--vscode-editorWidget-border);border-radius:999px;padding:2px 8px;color:var(--vscode-descriptionForeground);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.profile-card-actions{display:flex;gap:8px;white-space:nowrap;justify-content:flex-end;min-width:0}
.profile-card-actions button{background:transparent;color:var(--vscode-textLink-foreground);padding:3px 5px}
.profile-card-grid{display:none;grid-template-columns:1fr 1fr;gap:10px 12px;border-top:1px solid var(--vscode-editorWidget-border);padding:12px}
.profile-card.open .profile-card-grid{display:grid}
.api-key-wrap{display:grid;grid-template-columns:1fr auto;gap:6px}
.api-key-toggle{width:34px;min-width:34px;padding:0;display:inline-flex;align-items:center;justify-content:center}
.api-key-toggle svg{width:16px;height:16px;display:block}
.default-radio{width:auto}
.compact-actions{display:flex;gap:8px;margin-bottom:12px}
.raw-profiles{display:none}
.raw-profiles.open{display:grid}
.mini-hints{display:grid;gap:8px}
.mini-hint{border-left:2px solid var(--vscode-focusBorder);padding-left:9px;color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.45}
label{font-size:12px;color:var(--vscode-descriptionForeground)}
input,textarea,select{box-sizing:border-box;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;padding:7px 8px;font-family:var(--vscode-font-family);font-size:13px}
textarea{min-height:96px;resize:vertical}
.check{display:flex;align-items:center;gap:8px;margin:9px 0}
.check input{width:auto;flex:0 0 auto}
.hint{font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.45}
.status{display:none;margin:0 0 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:9px 12px;color:var(--vscode-foreground);background:var(--vscode-input-background)}
.status.show{display:block}
.status.ok{border-color:color-mix(in srgb,#4caf50 45%,var(--vscode-editorWidget-border));background:rgba(76,175,80,.1)}
.status.error{border-color:color-mix(in srgb,#f44336 45%,var(--vscode-editorWidget-border));background:rgba(244,67,54,.1)}
.toast{position:fixed;top:18px;right:22px;z-index:20;display:none;max-width:min(420px,calc(100vw - 44px));border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px 12px;background:var(--vscode-editorWidget-background,var(--vscode-input-background));box-shadow:0 10px 28px rgba(0,0,0,.32);color:var(--vscode-foreground)}
.toast.show{display:block}
.toast.ok{border-color:rgba(76,175,80,.55)}
.toast.error{border-color:rgba(244,67,54,.55)}
@media (max-width:980px){
  .models-toolbar{flex-direction:column;align-items:stretch}
  .models-toolbar .hint{max-width:none}
  .model-add-controls{grid-template-columns:minmax(160px,1fr) auto auto}
  .profile-card-head{grid-template-columns:24px minmax(0,1.1fr) max-content minmax(0,1fr);grid-auto-flow:row}
  .profile-card-actions{grid-column:1 / -1;justify-content:flex-end;flex-wrap:wrap}
  .profile-card-summary:last-of-type{grid-column:1 / -1}
}
@media (max-width:760px){
  .grid,.row,.param-grid,.preset-row,.profile-bar,.model-row,.profile-card-head,.profile-card-grid,.model-add-controls,.endpoint-note,.preference-strip{grid-template-columns:1fr}
  .top{display:block}
  .actions{margin-top:12px;white-space:normal}
  .section.full{grid-column:auto}
  .profile-card-actions{justify-content:flex-start}
  .profile-drag-handle{align-self:start}
  .preference-strip .check{white-space:normal}
}
</style>
</head>
<body>
<div class="page">
  <div class="top">
    <div>
      <h1>${t('title')}</h1>
      <div class="sub">${t('subtitle')}</div>
    </div>
    <div class="actions">
      <button class="secondary" id="open-file">${t('open.config')}</button>
      <button id="save">${t('save.apply')}</button>
    </div>
  </div>
  <div class="status" id="status" role="status" aria-live="polite"></div>

  <div class="grid">
    <section class="section full model-section">
      <h2>${t('model.list.title')}</h2>
      <div class="endpoint-note">
        <div class="endpoint-note-card">
          <div class="endpoint-note-title">${t('mimo.endpoint.note.title')} - MiMo</div>
          <div class="endpoint-note-text">${t('mimo.endpoint.note.balance')}</div>
        </div>
        <div class="endpoint-note-card">
          <div class="endpoint-note-title">${t('mimo.endpoint.note.title')} - Token Plan</div>
          <div class="endpoint-note-text">${t('mimo.endpoint.note.token')}</div>
        </div>
      </div>
      <div class="models-toolbar">
        <div class="hint">${t('model.manager.hint')}</div>
        <div class="model-add-controls">
          <select id="profile_add_provider" aria-label="${t('provider.add.with')}">
            ${providerPresetOptionsHtml()}
          </select>
          <button class="secondary" id="profile_add" type="button">${t('model.add.card')}</button>
          <button class="secondary" id="toggle_raw_profiles" type="button">${t('profile.json')}</button>
        </div>
      </div>
      <div class="profile-cards" id="profile_cards"></div>
      <div class="field raw-profiles" id="raw_profiles_wrap"><label for="provider_profiles">${t('provider.profiles')}</label><textarea id="provider_profiles" spellcheck="false" placeholder='[{"id":"deepseek-chat","name":"Deepseek Chat","base_url":"https://api.deepseek.com/v1","model":"deepseek-chat","api_key":"","models":["deepseek-chat"]}]'></textarea></div>
      <input id="models" type="hidden">
      <input id="active_provider_profile" type="hidden">
    </section>

    <section class="section full generation-section">
      <h2>${t('generation')}</h2>
      <div class="param-grid">
        <div class="field"><label for="max_tokens">${t('max.tokens')}</label><input id="max_tokens" type="number" min="256" max="65536"></div>
        <div class="field"><label for="temperature">${t('temperature')}</label><input id="temperature" type="number" min="0" max="2" step="0.1"></div>
        <div class="field"><label for="top_p">${t('top.p')}</label><input id="top_p" type="number" min="0" max="1" step="0.05"></div>
        <div class="field"><label for="command_timeout">${t('command.timeout')}</label><input id="command_timeout" type="number" min="5" max="3600"></div>
      </div>
      <div class="field"><label for="max_output_len">${t('max.tool.output')}</label><input id="max_output_len" type="number" min="1000" max="200000"></div>
      <div class="field">
        <label for="reasoning_effort">${t('reasoning.profile')}</label>
        <select id="reasoning_effort">
          <option value="turbo">${t('reasoning.turbo')}</option>
          <option value="fast">${t('reasoning.fast')}</option>
          <option value="balanced">${t('reasoning.balanced')}</option>
          <option value="deep">${t('reasoning.deep')}</option>
          <option value="max">${t('reasoning.max')}</option>
        </select>
      </div>
      <label class="check"><input id="enable_thinking" type="checkbox"> ${t('enable.thinking')}</label>
      <div class="preference-strip">
        <div class="preference-strip-title">${t('notifications.title')}</div>
        <label class="check"><input id="ui_completion_sound" type="checkbox"> ${t('completion.sound')}</label>
        <div class="volume-control">
          <label for="ui_completion_sound_volume">${t('completion.sound.volume')}</label>
          <input id="ui_completion_sound_volume" type="range" min="0" max="100" step="5">
          <span class="volume-value" id="ui_completion_sound_volume_value">70%</span>
        </div>
        <div class="hint">${t('completion.sound.hint')}</div>
      </div>
      <div class="generation-band">
        <div class="generation-band-title">${t('generation')}</div>
        <div class="preset-row">
          <button class="preset-btn" type="button" data-preset="fast">${t('preset.fast')}</button>
          <button class="preset-btn" type="button" data-preset="balanced">${t('preset.balanced')}</button>
          <button class="preset-btn" type="button" data-preset="long">${t('preset.long')}</button>
        </div>
      </div>
      <div class="mini-hints">
        <div class="mini-hint">${t('generation.hint')}</div>
        <div class="mini-hint">${t('generation.tokens.hint')}</div>
        <div class="mini-hint">${t('generation.timeout.hint')}</div>
        <div class="mini-hint">${t('generation.output.hint')}</div>
      </div>
    </section>

    <section class="section">
      <h2>${t('sandbox.title')}</h2>
      <div class="row">
        <div class="field">
          <label for="sandbox_mode">${t('sandbox.mode')}</label>
          <select id="sandbox_mode">
            <option value="safe">${t('sandbox.safe')}</option>
            <option value="docker">${t('sandbox.docker')}</option>
          </select>
        </div>
        <div class="field"><label for="sandbox_image">${t('docker.image')}</label><input id="sandbox_image" placeholder="node:20-alpine"></div>
      </div>
      <div class="row">
        <div class="field"><label for="sandbox_memory">${t('memory.limit')}</label><input id="sandbox_memory" placeholder="512m"></div>
        <div class="field"><label for="sandbox_cpu">${t('cpu.limit')}</label><input id="sandbox_cpu" type="number" min="1" max="16"></div>
      </div>
      <label class="check"><input id="sandbox_enabled" type="checkbox"> ${t('prefer.sandbox')}</label>
      <label class="check"><input id="sandbox_git_snapshot" type="checkbox"> ${t('git.snapshot')}</label>
      <label class="check"><input id="sandbox_logging" type="checkbox"> ${t('audit.logs')}</label>
      <label class="check"><input id="sandbox_network_disabled" type="checkbox"> ${t('block.network')}</label>
      <div class="hint">${t('sandbox.hint')}</div>
    </section>

    <section class="section">
      <h2>${t('dependency.title')}</h2>
      <label class="check"><input id="dependency_install_enabled" type="checkbox"> ${t('dependency.enabled')}</label>
      <div class="row">
        <div class="field">
          <label for="dependency_install_project_mode">${t('dependency.project.mode')}</label>
          <select id="dependency_install_project_mode">
            <option value="auto">${t('dependency.project.auto')}</option>
            <option value="confirm">${t('dependency.project.confirm')}</option>
            <option value="disabled">${t('dependency.project.disabled')}</option>
          </select>
        </div>
        <div class="field">
          <label for="dependency_install_system_mode">${t('dependency.system.mode')}</label>
          <select id="dependency_install_system_mode">
            <option value="confirm">${t('dependency.system.confirm')}</option>
            <option value="disabled">${t('dependency.system.disabled')}</option>
          </select>
        </div>
      </div>
      <div class="field"><label for="dependency_install_long_timeout_sec">${t('dependency.long.timeout')}</label><input id="dependency_install_long_timeout_sec" type="number" min="60" max="3600"></div>
      <div class="hint">${t('dependency.hint')}</div>
    </section>

    <section class="section">
      <h2>${t('memory.title')}</h2>
      <label class="check"><input id="memory_enabled" type="checkbox"> ${t('memory.enabled')}</label>
      <label class="check"><input id="memory_learn_from_explicit_preferences" type="checkbox"> ${t('memory.learn')}</label>
      <div class="row">
        <div class="field"><label for="memory_max_items">${t('memory.max.items')}</label><input id="memory_max_items" type="number" min="10" max="500" step="10"></div>
        <div class="field"><label for="memory_max_injected">${t('memory.max.injected')}</label><input id="memory_max_injected" type="number" min="0" max="20"></div>
      </div>
      <div class="hint">${t('memory.hint')}</div>
    </section>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const translations = ${pageTranslationsJson};
const initialSettings = ${initialSettingsJson};
const providerDefaults = {
  mimo_balance:{provider:'mimo_balance',id:'mimo-balance',name:'MiMo Balance',base_url:'https://api.xiaomimimo.com/v1',api_endpoint:'chat_completions',model:'mimo-v2.5-pro',models:['mimo-v2.5-pro','mimo-v2.5','mimo-v2.5-asr','mimo-v2.5-tts-voiceclone','mimo-v2.5-tts-voicedesign','mimo-v2.5-tts','mimo-v2-pro']},
  mimo_token_plan:{provider:'mimo_token_plan',id:'mimo-token-plan',name:'MiMo Token Plan',base_url:'https://token-plan-cn.xiaomimimo.com/v1',api_endpoint:'chat_completions',model:'mimo-v2.5-pro',models:['mimo-v2.5-pro','mimo-v2.5','mimo-v2.5-asr','mimo-v2.5-tts-voiceclone','mimo-v2.5-tts-voicedesign','mimo-v2.5-tts','mimo-v2-pro']},
  mimo:{provider:'mimo_token_plan',id:'mimo-token-plan',name:'MiMo Token Plan',base_url:'https://token-plan-cn.xiaomimimo.com/v1',api_endpoint:'chat_completions',model:'mimo-v2.5-pro',models:['mimo-v2.5-pro','mimo-v2.5','mimo-v2.5-asr','mimo-v2.5-tts-voiceclone','mimo-v2.5-tts-voicedesign','mimo-v2.5-tts','mimo-v2-pro']},
  deepseek:{provider:'deepseek',id:'deepseek',name:'DeepSeek',base_url:'https://api.deepseek.com/v1',api_endpoint:'chat_completions',model:'deepseek-chat',models:['deepseek-chat','deepseek-reasoner']},
  openai:{provider:'openai',id:'openai',name:'OpenAI',base_url:'https://api.openai.com/v1',api_endpoint:'responses',model:'gpt-4o',models:['gpt-4o','gpt-4o-mini']},
  qwen:{provider:'qwen',id:'qwen',name:'Qwen / DashScope',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',api_endpoint:'chat_completions',model:'qwen-plus',models:['qwen-plus','qwen-max','qwen-turbo','qwen-long']},
  zhipu:{provider:'zhipu',id:'zhipu',name:'Zhipu GLM',base_url:'https://open.bigmodel.cn/api/paas/v4',api_endpoint:'chat_completions',model:'glm-4-plus',models:['glm-4-plus','glm-4-air','glm-4-flash']},
  moonshot:{provider:'moonshot',id:'moonshot',name:'Moonshot / Kimi',base_url:'https://api.moonshot.cn/v1',api_endpoint:'chat_completions',model:'moonshot-v1-8k',models:['moonshot-v1-8k','moonshot-v1-32k','moonshot-v1-128k']},
  volcengine:{provider:'volcengine',id:'volcengine',name:'Volcengine Ark',base_url:'https://ark.cn-beijing.volces.com/api/v3',api_endpoint:'chat_completions',model:'doubao-1-5-pro-32k-250115',models:['doubao-1-5-pro-32k-250115','doubao-1-5-lite-32k-250115']},
  siliconflow:{provider:'siliconflow',id:'siliconflow',name:'SiliconFlow',base_url:'https://api.siliconflow.cn/v1',api_endpoint:'chat_completions',model:'Qwen/Qwen2.5-72B-Instruct',models:['Qwen/Qwen2.5-72B-Instruct','deepseek-ai/DeepSeek-V3','deepseek-ai/DeepSeek-R1']},
  qianfan:{provider:'qianfan',id:'qianfan',name:'Baidu Qianfan',base_url:'https://qianfan.baidubce.com/v2',api_endpoint:'chat_completions',model:'ernie-4.0-turbo-8k',models:['ernie-4.0-turbo-8k','ernie-3.5-8k','ernie-speed-8k']},
  hunyuan:{provider:'hunyuan',id:'hunyuan',name:'Tencent Hunyuan',base_url:'https://api.hunyuan.cloud.tencent.com/v1',api_endpoint:'chat_completions',model:'hunyuan-turbos-latest',models:['hunyuan-turbos-latest','hunyuan-large','hunyuan-standard']},
  openrouter:{provider:'openrouter',id:'openrouter',name:'OpenRouter',base_url:'https://openrouter.ai/api/v1',api_endpoint:'chat_completions',model:'openai/gpt-4o-mini',models:['openai/gpt-4o-mini','anthropic/claude-3.5-sonnet','google/gemini-2.0-flash-001','deepseek/deepseek-chat']},
  groq:{provider:'groq',id:'groq',name:'Groq',base_url:'https://api.groq.com/openai/v1',api_endpoint:'chat_completions',model:'llama-3.3-70b-versatile',models:['llama-3.3-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768']},
  gemini:{provider:'gemini',id:'gemini',name:'Google Gemini',base_url:'https://generativelanguage.googleapis.com/v1beta/openai',api_endpoint:'chat_completions',model:'gemini-2.0-flash',models:['gemini-2.0-flash','gemini-1.5-pro','gemini-1.5-flash']},
  mistral:{provider:'mistral',id:'mistral',name:'Mistral AI',base_url:'https://api.mistral.ai/v1',api_endpoint:'chat_completions',model:'mistral-large-latest',models:['mistral-large-latest','mistral-small-latest','codestral-latest']},
  xai:{provider:'xai',id:'xai',name:'xAI Grok',base_url:'https://api.x.ai/v1',api_endpoint:'chat_completions',model:'grok-3-mini',models:['grok-3-mini','grok-3','grok-2-vision-1212']},
  custom:{provider:'custom',id:'custom',name:'Custom Model',base_url:'https://api.example.com/v1',api_endpoint:'chat_completions',model:'custom-model',models:['custom-model']},
};
const providerEntries = ['mimo_balance','mimo_token_plan','deepseek','openai','qwen','zhipu','moonshot','volcengine','siliconflow','qianfan','hunyuan','openrouter','groq','gemini','mistral','xai','custom'];
let profiles = [];
let activeProfileId = '';
function trimTrailingSlashes(value){
  let text = String(value || '').trim();
  while (text.endsWith('/')) text = text.slice(0, -1);
  return text;
}
function providerLabel(provider){
  const key = 'provider.' + (provider || 'custom');
  return translations[key] || translations['provider.custom'] || 'Custom compatible';
}
function providerOptions(selected){
  return providerEntries.map(value => '<option value="'+escapeAttr(value)+'"'+(value === selected ? ' selected' : '')+'>'+escapeHtml(providerLabel(value))+'</option>').join('');
}
function endpointOptions(selected){
  const entries = [
    { value: 'chat_completions', label: translations['api.endpoint.chat'] || 'Chat Completions' },
    { value: 'responses', label: translations['api.endpoint.responses'] || 'Responses' },
  ];
  return entries.map(item => '<option value="'+escapeAttr(item.value)+'"'+(item.value === selected ? ' selected' : '')+'>'+escapeHtml(item.label)+'</option>').join('');
}
function normalizeProvider(profile){
  const raw = String(profile?.provider || '').trim().toLowerCase();
  if (providerDefaults[raw]) return raw;
  return detectProvider(profile || {});
}
function normalizeProfile(profile){
  const id = String(profile?.id || '').trim() || makeProfileId(profile?.name || 'profile');
  const models = Array.isArray(profile?.models) ? profile.models.map(v => String(v || '').trim()).filter(Boolean) : [];
  const model = String(profile?.model || models[0] || '').trim();
  if (model && !models.includes(model)) models.unshift(model);
  return {
    id,
    name: String(profile?.name || id).trim() || id,
    provider: normalizeProvider(profile),
    base_url: trimTrailingSlashes(profile?.base_url),
    api_endpoint: String(profile?.api_endpoint || 'chat_completions') === 'responses' ? 'responses' : 'chat_completions',
    model,
    api_key: String(profile?.api_key || ''),
    models,
  };
}
function profileCardTitle(profile){
  return profile.name || profile.model || profile.id || 'Model';
}
function makeProfileId(name){
  const base = String(name || 'profile').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'') || 'profile';
  let id = base;
  let i = 2;
  while (profiles.some(p => p.id === id)) id = base + '-' + i++;
  return id;
}
function makeStableProfileId(model, existing){
  const base = String(model || 'model').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'') || 'model';
  const used = existing || new Set();
  let id = base;
  let i = 2;
  while (used.has(id)) id = base + '-' + i++;
  used.add(id);
  return id;
}
function detectProvider(s){
  const explicit = String(s.provider || '').trim().toLowerCase();
  if (providerDefaults[explicit]) return explicit;
  const base = (s.base_url || '').toLowerCase();
  if (base.includes('deepseek')) return 'deepseek';
  if (base.includes('openai.com')) return 'openai';
  if (base.includes('xiaomimimo')) return 'mimo';
  if (base.includes('dashscope.aliyuncs.com')) return 'qwen';
  if (base.includes('open.bigmodel.cn') || base.includes('api.z.ai')) return 'zhipu';
  if (base.includes('moonshot.cn') || base.includes('moonshot.ai')) return 'moonshot';
  if (base.includes('volces.com')) return 'volcengine';
  if (base.includes('siliconflow')) return 'siliconflow';
  if (base.includes('qianfan.baidubce.com')) return 'qianfan';
  if (base.includes('hunyuan.cloud.tencent.com')) return 'hunyuan';
  if (base.includes('openrouter.ai')) return 'openrouter';
  if (base.includes('groq.com')) return 'groq';
  if (base.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (base.includes('mistral.ai')) return 'mistral';
  if (base.includes('api.x.ai')) return 'xai';
  return 'custom';
}
function applyProviderToProfile(profile, provider){
  const next = providerDefaults[provider] || providerDefaults.custom;
  profile.provider = next.provider;
  const oldModel = String(profile.model || '').trim();
  const shouldReplaceModel = !oldModel || Object.values(providerDefaults).some(def => def.models.includes(oldModel));
  if (!String(profile.name || '').trim() || Object.values(providerDefaults).some(def => def.name === profile.name)) {
    profile.name = next.name;
  }
  if (profile.provider !== 'custom') {
    profile.base_url = next.base_url;
    if (shouldReplaceModel) profile.model = next.model;
  } else if (!profile.base_url) {
    profile.base_url = next.base_url;
    if (!profile.model) profile.model = next.model;
  }
  profile.models = profile.model ? [profile.model] : [];
  return profile;
}
function defaultPresetProfiles(settings){
  const apiKey = String(settings?.api_key || '');
  return [
    {...providerDefaults.mimo_balance, api_key: apiKey},
    {...providerDefaults.mimo_token_plan, api_key: apiKey},
    {...providerDefaults.deepseek, api_key: ''},
    {...providerDefaults.openai, api_key: ''},
  ];
}
function getActiveProfile(){
  return profiles.find(p => p.id === activeProfileId) || profiles[0];
}
function syncActiveProfileFromFields(){
  syncProfilesFromCards();
  renderProfiles();
}
function syncProfilesFromCards(){
  const cards = Array.from(document.querySelectorAll('[data-profile-id]'));
  for (const card of cards) {
    const id = card.getAttribute('data-profile-id');
    const p = profiles.find(item => item.id === id);
    if (!p) continue;
    const name = card.querySelector('[data-field="name"]')?.value?.trim();
    const provider = card.querySelector('[data-field="provider"]')?.value || detectProvider(p);
    const model = card.querySelector('[data-field="model"]')?.value?.trim();
    const baseUrl = card.querySelector('[data-field="base_url"]')?.value;
    const apiEndpoint = card.querySelector('[data-field="api_endpoint"]')?.value;
    const apiKey = card.querySelector('[data-field="api_key"]')?.value;
    p.name = name || model || p.id;
    p.provider = provider;
    p.model = model || p.model || p.id;
    p.base_url = trimTrailingSlashes(baseUrl);
    p.api_endpoint = apiEndpoint === 'responses' ? 'responses' : 'chat_completions';
    p.api_key = apiKey || '';
    p.models = p.model ? [p.model] : [];
  }
}
function flattenProfiles(list){
  const out = [];
  const usedIds = new Set();
  for (const profile of list || []) {
    const p = normalizeProfile(profile);
    const modelIds = p.models.length ? p.models : (p.model ? [p.model] : []);
    if (modelIds.length === 0) {
      out.push(normalizeProfile(p));
      continue;
    }
    if (modelIds.length === 1) {
      const one = normalizeProfile({...p, model:modelIds[0], models:[modelIds[0]]});
      if (usedIds.has(one.id)) one.id = makeStableProfileId(one.id, usedIds);
      else usedIds.add(one.id);
      out.push(one);
      continue;
    }
    for (const modelId of modelIds) {
      const model = String(modelId || '').trim();
      if (!model) continue;
      out.push(normalizeProfile({
        ...p,
        id: makeStableProfileId((p.id || p.provider || 'profile') + '-' + model, usedIds),
        name: model === p.model ? p.name : (p.name ? p.name + ' / ' + model : model),
        model,
        models: [model],
      }));
    }
  }
  return out;
}
function renderProfiles(){
  if (!profiles.some(p => p.id === activeProfileId)) activeProfileId = profiles[0]?.id || '';
  $('active_provider_profile').value = activeProfileId || '';
  $('provider_profiles').value = JSON.stringify(profiles, null, 2);
  const cards = $('profile_cards');
  cards.innerHTML = profiles.map(p => {
    const active = p.id === activeProfileId ? ' active open' : '';
    const checked = p.id === activeProfileId ? ' checked' : '';
    return '<div class="profile-card'+active+'" data-profile-id="'+escapeAttr(p.id)+'">'
      + '<div class="profile-card-head">'
      + '<div class="profile-drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</div>'
      + '<label class="profile-card-title"><input class="default-radio" type="radio" name="default_profile" data-action="default"'+checked+'>'
      + '<span>'+escapeHtml(profileCardTitle(p))+'</span></label>'
      + '<div class="provider-pill">'+escapeHtml(providerLabel(p.provider || detectProvider(p)))+'</div>'
      + '<div class="profile-card-summary">'+escapeHtml(p.model || '')+'</div>'
      + '<div class="profile-card-summary">'+escapeHtml(p.base_url || '')+'</div>'
      + '<div class="profile-card-actions">'
      + '<button class="secondary" type="button" data-action="toggle-details">'+escapeHtml(p.id === activeProfileId ? (translations['model.card.collapse'] || 'Collapse') : (translations['model.card.details'] || 'Details'))+'</button>'
      + '<button class="secondary" type="button" data-action="copy">'+escapeHtml(translations['model.card.copy'] || 'Copy')+'</button>'
      + '<button class="secondary" type="button" data-action="delete">'+escapeHtml(translations['model.card.delete'] || 'Delete')+'</button>'
      + '</div></div>'
      + '<div class="profile-card-grid">'
      + '<div class="field"><label>'+escapeHtml(translations['provider.select'] || 'Provider')+'</label><select data-field="provider">'+providerOptions(p.provider || detectProvider(p))+'</select></div>'
      + '<div class="field"><label>'+escapeHtml(translations['profile.name'] || 'Name')+'</label><input data-field="name" value="'+escapeAttr(p.name || '')+'" placeholder="MiMo Pro"></div>'
      + '<div class="field"><label>'+escapeHtml(translations['model.card.model'] || 'Model ID')+'</label><input data-field="model" value="'+escapeAttr(p.model || '')+'" placeholder="mimo-v2.5-pro"></div>'
      + '<div class="field"><label>'+escapeHtml(translations['base.url'] || 'Base URL')+'</label><input data-field="base_url" value="'+escapeAttr(p.base_url || '')+'" placeholder="https://.../v1"></div>'
      + '<div class="field"><label>'+escapeHtml(translations['api.endpoint'] || 'API Endpoint')+'</label><select data-field="api_endpoint">'+endpointOptions(p.api_endpoint || 'chat_completions')+'</select></div>'
      + '<div class="field"><label>'+escapeHtml(translations['api.key'] || 'API Key')+'</label><div class="api-key-wrap"><input data-field="api_key" type="password" autocomplete="off" value="'+escapeAttr(p.api_key || '')+'" placeholder="sk-..."><button class="secondary api-key-toggle" type="button" data-action="toggle-key" title="'+escapeAttr(translations['api.key.show'] || 'Show API Key')+'">'+eyeIcon(false)+'</button></div></div>'
      + '</div></div>';
  }).join('');
}
function eyeIcon(hidden){
  const slash = hidden ? '<path d="M4 4l16 16"/>' : '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'+slash+'</svg>';
}
function renderModels(){
  const p = getActiveProfile();
  const models = p?.models || [];
  $('models').value = models.join('\\n');
}
function loadProfileToFields(profile){
  const p = profile ? normalizeProfile(profile) : getActiveProfile();
  $('models').value = (p?.models || []).join('\\n');
  renderModels();
}
function fill(s){
  profiles = flattenProfiles(s.provider_profiles || []).filter(p => p.id && p.base_url);
  if (profiles.length === 0) {
    profiles = flattenProfiles(defaultPresetProfiles(s));
  }
  const activeRoute = s.active_route || {};
  activeProfileId = profiles.find(p => p.id === activeRoute.endpoint_id && (!activeRoute.model || p.model === activeRoute.model))?.id
    || profiles.find(p => p.id === s.active_provider_profile)?.id
    || profiles.find(p => p.model === activeRoute.model)?.id
    || profiles[0].id;
  renderProfiles();
  loadProfileToFields(getActiveProfile());
  $('max_tokens').value = s.max_tokens ?? 8192;
  $('temperature').value = s.temperature ?? 0.7;
  $('top_p').value = s.top_p ?? 0.95;
  $('max_output_len').value = s.max_output_len ?? 5000;
  $('command_timeout').value = s.command_timeout ?? 120;
  $('enable_thinking').checked = !!s.enable_thinking;
  $('ui_completion_sound').checked = s.ui_completion_sound !== false;
  $('ui_completion_sound_volume').value = s.ui_completion_sound_volume ?? 70;
  updateCompletionVolumeLabel();
  $('reasoning_effort').value = s.reasoning_effort || (s.enable_thinking ? 'deep' : 'balanced');
  $('sandbox_enabled').checked = !!s.sandbox_enabled;
  $('sandbox_mode').value = s.sandbox_mode || 'safe';
  $('sandbox_image').value = s.sandbox_image || 'node:20-alpine';
  $('sandbox_memory').value = s.sandbox_memory || '512m';
  $('sandbox_cpu').value = s.sandbox_cpu ?? 1;
  $('sandbox_git_snapshot').checked = s.sandbox_git_snapshot === true;
  $('sandbox_logging').checked = s.sandbox_logging !== false;
  $('sandbox_network_disabled').checked = s.sandbox_network_disabled !== false;
  $('dependency_install_enabled').checked = s.dependency_install_enabled !== false;
  $('dependency_install_project_mode').value = s.dependency_install_project_mode || 'auto';
  $('dependency_install_system_mode').value = s.dependency_install_system_mode || 'confirm';
  $('dependency_install_long_timeout_sec').value = s.dependency_install_long_timeout_sec ?? 600;
  $('memory_enabled').checked = s.memory_enabled !== false;
  $('memory_learn_from_explicit_preferences').checked = s.memory_learn_from_explicit_preferences !== false;
  $('memory_max_items').value = s.memory_max_items ?? 120;
  $('memory_max_injected').value = s.memory_max_injected ?? 8;
}
function collect(){
  syncProfilesFromCards();
  renderProfiles();
  const active = getActiveProfile() || {};
  return {
    api_key:active.api_key || '',
    base_url:active.base_url || '',
    api_endpoint:active.api_endpoint || 'chat_completions',
    model:active.model || '',
    models:active.models || [],
    active_provider_profile:active.id || '',
    provider_profiles:(()=>{try{return JSON.parse($('provider_profiles').value || '[]')}catch{return profiles}})(),
    active_route:{endpoint_id:active.id || '',model:active.model || ''},
    max_tokens:Number($('max_tokens').value),
    temperature:Number($('temperature').value),
    top_p:Number($('top_p').value),
    max_output_len:Number($('max_output_len').value),
    command_timeout:Number($('command_timeout').value),
    enable_thinking:$('enable_thinking').checked,
    ui_completion_sound:$('ui_completion_sound').checked,
    ui_completion_sound_volume:Number($('ui_completion_sound_volume').value),
    reasoning_effort:$('reasoning_effort').value,
    sandbox_enabled:$('sandbox_enabled').checked,
    sandbox_mode:$('sandbox_mode').value,
    sandbox_image:$('sandbox_image').value,
    sandbox_memory:$('sandbox_memory').value,
    sandbox_cpu:Number($('sandbox_cpu').value),
    sandbox_git_snapshot:$('sandbox_git_snapshot').checked,
    sandbox_logging:$('sandbox_logging').checked,
    sandbox_network_disabled:$('sandbox_network_disabled').checked,
    dependency_install_enabled:$('dependency_install_enabled').checked,
    dependency_install_project_mode:$('dependency_install_project_mode').value,
    dependency_install_system_mode:$('dependency_install_system_mode').value,
    dependency_install_long_timeout_sec:Number($('dependency_install_long_timeout_sec').value),
    memory_enabled:$('memory_enabled').checked,
    memory_learn_from_explicit_preferences:$('memory_learn_from_explicit_preferences').checked,
    memory_max_items:Number($('memory_max_items').value),
    memory_max_injected:Number($('memory_max_injected').value),
  };
}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escapeAttr(s){return escapeHtml(s).replace(new RegExp(String.fromCharCode(96),'g'),'&#96;');}
let toastTimer = null;
function showSaveFeedback(ok, text){
  const status = $('status');
  const toast = $('toast');
  const cls = ok ? 'ok' : 'error';
  if (status) {
    status.textContent = text;
    status.className = 'status show ' + cls;
  }
  if (toast) {
    toast.textContent = text;
    toast.className = 'toast show ' + cls;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 3600);
  }
}
function updateCompletionVolumeLabel(){
  const value = Math.max(0, Math.min(100, Number($('ui_completion_sound_volume')?.value || 70)));
  const label = $('ui_completion_sound_volume_value');
  if (label) label.textContent = value + '%';
}
let previewAudioCtx = null;
let lastCompletionPreviewAt = 0;
function getPreviewAudioContext(){
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  previewAudioCtx = previewAudioCtx || new AudioCtor();
  return previewAudioCtx;
}
function previewTone(ctx, start, frequency, duration, gainValue){
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
}
async function playCompletionPreview(force){
  const slider = $('ui_completion_sound_volume');
  const raw = Number(slider?.value ?? 70);
  const volume = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 70)) / 100;
  if (volume <= 0) return;
  const now = Date.now();
  if (!force && now - lastCompletionPreviewAt < 380) return;
  lastCompletionPreviewAt = now;
  try {
    const ctx = getPreviewAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') return;
    const start = ctx.currentTime + 0.02;
    previewTone(ctx, start, 659.25, 0.15, 0.18 * volume);
    previewTone(ctx, start + 0.11, 880, 0.22, 0.15 * volume);
  } catch {
  }
}
window.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type === 'settingsData') fill(msg.settings || {});
  if (msg.type === 'saveResult') {
    showSaveFeedback(msg.ok, msg.ok ? translations['saved.success'] : translations['saved.failed']);
    if (msg.settings) fill(msg.settings);
  }
});
$('save').addEventListener('click', () => vscode.postMessage({type:'saveSettings', settings: collect()}));
$('ui_completion_sound_volume').addEventListener('input', () => {
  updateCompletionVolumeLabel();
  void playCompletionPreview(false);
});
$('ui_completion_sound_volume').addEventListener('change', () => {
  void playCompletionPreview(true);
});
$('open-file').addEventListener('click', () => vscode.postMessage({type:'openSettingsFile'}));
$('profile_add').addEventListener('click', () => {
  syncProfilesFromCards();
  const provider = $('profile_add_provider')?.value || 'custom';
  const preset = providerDefaults[provider] || providerDefaults.custom;
  const id = makeProfileId(preset.id || preset.model || 'model');
  profiles.push(normalizeProfile({...preset,id,api_key:''}));
  activeProfileId = id;
  renderProfiles();
  renderModels();
});
$('profile_cards').addEventListener('input', e => {
  const target = e.target;
  if (target?.matches?.('[data-field="provider"]')) return;
  syncProfilesFromCards();
  renderModels();
});
$('profile_cards').addEventListener('change', e => {
  const target = e.target;
  if (!target?.matches?.('[data-field="provider"]')) return;
  const card = target.closest('[data-profile-id]');
  const id = card?.getAttribute?.('data-profile-id');
  const p = profiles.find(item => item.id === id);
  if (!p) return;
  syncProfilesFromCards();
  applyProviderToProfile(p, target.value || 'custom');
  renderProfiles();
  renderModels();
});
$('profile_cards').addEventListener('click', e => {
  const target = e.target?.closest?.('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  const card = target.closest('[data-profile-id]');
  const id = card?.getAttribute?.('data-profile-id');
  const p = profiles.find(item => item.id === id);
  if (!p) return;
  if (action === 'default') {
    activeProfileId = p.id;
    renderModels();
    renderProfiles();
    return;
  }
  if (action === 'copy') {
    syncProfilesFromCards();
    const copyId = makeProfileId((p.id || p.model || 'model') + '-copy');
    profiles.push(normalizeProfile({...p,id:copyId,name:(p.name || p.model || 'Model') + ' Copy'}));
    activeProfileId = copyId;
    renderProfiles();
    renderModels();
    return;
  }
  if (action === 'delete') {
    if (profiles.length <= 1) return;
    profiles = profiles.filter(item => item.id !== p.id);
    if (activeProfileId === p.id) activeProfileId = profiles[0]?.id || '';
    renderProfiles();
    renderModels();
    return;
  }
  if (action === 'toggle-details') {
    const isOpen = card.classList.toggle('open');
    target.textContent = isOpen ? (translations['model.card.collapse'] || 'Collapse') : (translations['model.card.details'] || 'Details');
    return;
  }
  if (action === 'toggle-key') {
    const input = card.querySelector('[data-field="api_key"]');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    target.innerHTML = eyeIcon(!visible);
    target.title = visible ? (translations['api.key.show'] || 'Show API Key') : (translations['api.key.hide'] || 'Hide API Key');
  }
});
// ── Drag-and-drop reorder for profile cards ──
{
  let draggedId = null;
  const clearIndicators = () => {
    $('profile_cards').querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  };
  $('profile_cards').addEventListener('dragstart', e => {
    const handle = e.target?.closest?.('.profile-drag-handle');
    if (!handle) {
      e.preventDefault();
      return;
    }
    syncProfilesFromCards();
    const card = handle.closest?.('.profile-card[data-profile-id]');
    if (!card) return;
    draggedId = card.getAttribute('data-profile-id');
    if (!draggedId) return;
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    }
  });
  $('profile_cards').addEventListener('dragend', e => {
    const card = e.target?.closest?.('.profile-card');
    if (card) card.classList.remove('dragging');
    clearIndicators();
    draggedId = null;
  });
  $('profile_cards').addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearIndicators();
    const card = e.target?.closest?.('.profile-card[data-profile-id]');
    if (!card || card.getAttribute('data-profile-id') === draggedId) return;
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      card.classList.add('drag-over-top');
    } else {
      card.classList.add('drag-over-bottom');
    }
  });
  $('profile_cards').addEventListener('dragleave', e => {
    const card = e.target?.closest?.('.profile-card');
    if (card) card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  $('profile_cards').addEventListener('drop', e => {
    e.preventDefault();
    clearIndicators();
    if (!draggedId) return;
    const targetCard = e.target?.closest?.('.profile-card[data-profile-id]');
    if (!targetCard) return;
    const targetId = targetCard.getAttribute('data-profile-id');
    if (targetId === draggedId) return;
    const fromIdx = profiles.findIndex(p => p.id === draggedId);
    let toIdx = profiles.findIndex(p => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const rect = targetCard.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertAfter = e.clientY >= midY;
    const [item] = profiles.splice(fromIdx, 1);
    // After splice, adjust toIdx: target shifts left if source was before it
    if (fromIdx < toIdx) toIdx--;
    if (insertAfter) toIdx++;
    profiles.splice(toIdx, 0, item);
    renderProfiles();
    renderModels();
  });
}
$('toggle_raw_profiles').addEventListener('click', () => {
  syncProfilesFromCards();
  renderProfiles();
  $('raw_profiles_wrap').classList.toggle('open');
});
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.getAttribute('data-preset');
    if (preset === 'fast') {
      $('max_tokens').value = 8192; $('temperature').value = 0.4; $('top_p').value = 0.9;
      $('command_timeout').value = 90; $('max_output_len').value = 4000;
      $('reasoning_effort').value = 'fast'; $('enable_thinking').checked = false;
    } else if (preset === 'balanced') {
      $('max_tokens').value = 32768; $('temperature').value = 0.7; $('top_p').value = 0.95;
      $('command_timeout').value = 120; $('max_output_len').value = 8000;
      $('reasoning_effort').value = 'balanced'; $('enable_thinking').checked = false;
    } else if (preset === 'long') {
      $('max_tokens').value = 65536; $('temperature').value = 0.5; $('top_p').value = 0.9;
      $('command_timeout').value = 600; $('max_output_len').value = 20000;
      $('reasoning_effort').value = 'deep'; $('enable_thinking').checked = true;
    }
  });
});
fill(initialSettings);
vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
    return text;
}
