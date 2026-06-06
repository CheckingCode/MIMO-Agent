/**
 * i18n — Simple language switching for MiMo Agent webview.
 */

type Lang = 'en' | 'zh';

const translations: Record<Lang, Record<string, string>> = {
    en: {
        'new': 'New',
        'history': 'History',
        'settings': 'Settings',
        'clear': 'Clear',
        'send': 'Send',
        'stop': 'Stop',
        'save': 'Save Settings',
        'auto': 'Auto',
        'polling': 'Polling',
        'plan': 'Plan',
        'adversarial': 'Duel',
        'auto.desc': 'AI decides when to use tools',
        'polling.desc': 'Auto-continue until task complete',
        'plan.desc': 'Read-only analysis + web search, then execute',
        'adversarial.desc': '🐵 CrazyCoder vs 🦊 Multi-dimension review',
        'adversarial.guide': 'Best for: coding, bug fixing, refactoring, docs. Not for: software automation, simple Q&A.',
        'welcome.desc': 'AI coding assistant powered by Xiaomi MiMo LLM.',
        'welcome.hint': 'Click <strong>+</strong> to start a New Conversation, or type below.',
        'welcome.desc.1': 'AI coding assistant powered by Xiaomi MiMo LLM.',
        'welcome.desc.2': 'Your personal AI pair programmer.',
        'welcome.desc.3': 'Code faster with MiMo by your side.',
        'welcome.desc.4': 'Ask me anything about your code.',
        'welcome.desc.5': 'Let\'s build something great together.',
        'welcome.hint.1': 'Click <strong>+</strong> to start a New Conversation, or type below.',
        'welcome.hint.2': 'Type your request below and press Enter.',
        'welcome.hint.3': 'Ready to code. What shall we work on?',
        'welcome.hint.4': 'Describe your task and I\'ll get started.',
        'welcome.hint.5': 'I\'m here to help. Just ask!',
        'no.history': 'No history yet',
        'retry': '↻ Retry',
        'copied': 'Copied!',
        'copy': 'Copy',
        'thinking': 'Thinking...',
        'thought': 'Thought',
        'round': 'Round',
        'model.switched': 'Model switched to',
        'mode.switched': 'Mode switched to',
        'settings.saved': 'Settings saved and applied.',
        'sandbox': '🔒 Sandbox (Docker)',
        'sandbox.enable': 'Enable Docker Sandbox',
        'sandbox.image': 'Docker Image',
        'sandbox.memory': 'Memory Limit',
        'sandbox.cpu': 'CPU Limit',
        'api.key': 'API Key',
        'base.url': 'Base URL',
        'model.label': 'Model',
        'temperature': 'Temperature',
        'max.tokens': 'Max Tokens',
        'max.rounds': 'Max Rounds',
        'enable.thinking': 'Enable Thinking',
        'paste.hint': 'Ask MiMo... (Ctrl+V to paste image)',
        'mcp': 'MCP Servers',
        'mcp.none': 'No MCP servers configured',
        'edit.accept': 'Accept',
        'edit.reject': 'Reject',
        'summary.title': 'Run Summary',
        'ask.other': 'Other',
        'voice.input': 'Voice Input',
        'voice.recording': 'Recording...',
        // Settings page
        'settings.title': 'MiMo Settings',
        'settings.subtitle': 'Model call settings are saved in <code>~/.mimo/settings.json</code>. VS Code settings and environment variables remain compatible fallbacks, but this file is the primary runtime config.',
        'settings.open.config': 'Open Config File',
        'settings.save.apply': 'Save and Apply',
        'settings.model.connection': 'Model Connection',
        'settings.api.key': 'API Key',
        'settings.base.url': 'Base URL',
        'settings.default.model': 'Default Model',
        'settings.model.list': 'Model List (one per line)',
        'settings.generation': 'Generation',
        'settings.max.tokens': 'Max Tokens',
        'settings.temperature': 'Temperature',
        'settings.top.p': 'Top P',
        'settings.command.timeout': 'Command Timeout (s)',
        'settings.max.tool.output': 'Max Tool Output',
        'settings.enable.thinking': 'Enable model thinking controls when the provider supports them',
        'settings.sandbox.title': 'Sandbox and Command Safety',
        'settings.sandbox.mode': 'Sandbox Mode',
        'settings.sandbox.safe': 'Safe Mode (default local guarded execution)',
        'settings.sandbox.docker': 'Docker (stronger isolation, requires Docker Desktop)',
        'settings.docker.image': 'Docker Image',
        'settings.memory.limit': 'Memory Limit',
        'settings.cpu.limit': 'CPU Limit',
        'settings.prefer.sandbox': 'Prefer sandboxed execution; fall back from Docker to Safe Mode when Docker is unavailable',
        'settings.git.snapshot': 'Create an automatic Git snapshot before risky commands',
        'settings.audit.logs': 'Record command audit logs',
        'settings.block.network': 'Block common network commands in Safe Mode',
        'settings.sandbox.hint': 'Safe Mode adds command checks, workspace boundary checks, timeouts, output limits, Git snapshots, and audit logs. It is faster and dependency-light, but Docker remains the stronger isolation option when available.',
        'settings.saved.success': 'Saved to ~/.mimo/settings.json and applied.',
        'settings.saved.failed': 'Save failed. Check settings file permissions.',
    },
    zh: {
        'new': '新对话',
        'history': '历史记录',
        'settings': '设置',
        'clear': '清空',
        'send': '发送',
        'stop': '停止',
        'save': '保存设置',
        'auto': '自动',
        'polling': '轮询',
        'plan': '规划',
        'adversarial': '对决模式',
        'auto.desc': 'AI 自动决定是否使用工具',
        'polling.desc': '自动继续直到任务完成',
        'plan.desc': '只读分析 + 网络搜索，生成计划后执行',
        'adversarial.desc': '🐵 疯狂程序猿 vs 🦊 多维审查团',
        'adversarial.guide': '适合：写代码、修Bug、重构、写文档 | 不适合：操控软件、简单问答',
        'welcome.desc': '小米 MiMo 大模型驱动的 AI 编程助手',
        'welcome.hint': '点击 <strong>+</strong> 新建对话，或直接输入消息',
        'welcome.desc.1': '小米 MiMo 大模型驱动的 AI 编程助手',
        'welcome.desc.2': '你的专属 AI 编程搭档',
        'welcome.desc.3': 'MiMo 帮你写代码更快更好',
        'welcome.desc.4': '关于代码的任何问题都可以问我',
        'welcome.desc.5': '一起创造一些厉害的东西吧',
        'welcome.hint.1': '点击 <strong>+</strong> 新建对话，或直接输入消息',
        'welcome.hint.2': '在下方输入你的需求，按回车发送',
        'welcome.hint.3': '准备好了，想做点什么？',
        'welcome.hint.4': '描述你的任务，我马上开始',
        'welcome.hint.5': '我在这里，随时为你效劳',
        'no.history': '暂无历史记录',
        'retry': '↻ 重试',
        'copied': '已复制!',
        'copy': '复制',
        'thinking': '思考中...',
        'thought': '已思考',
        'round': '轮次',
        'model.switched': '模型已切换为',
        'mode.switched': '模式已切换为',
        'settings.saved': '设置已保存并立即生效',
        'sandbox': '🔒 沙箱 (Docker)',
        'sandbox.enable': '启用 Docker 沙箱',
        'sandbox.image': 'Docker 镜像',
        'sandbox.memory': '内存限制',
        'sandbox.cpu': 'CPU 限制',
        'api.key': 'API Key',
        'base.url': 'Base URL',
        'model.label': '模型',
        'temperature': 'Temperature',
        'max.tokens': '最大 Tokens',
        'max.rounds': '最大轮次',
        'enable.thinking': '启用思考模式',
        'paste.hint': '输入消息... (Ctrl+V 粘贴图片)',
        'mcp': 'MCP 服务器',
        'mcp.none': '未配置 MCP 服务器',
        'edit.accept': '接受',
        'edit.reject': '拒绝',
        'summary.title': '运行摘要',
        'ask.other': '其他',
        'voice.input': '语音输入',
        'voice.recording': '录音中...',
        // Settings page
        'settings.title': 'MiMo 设置',
        'settings.subtitle': '模型调用设置保存在 <code>~/.mimo/settings.json</code>。VS Code 设置和环境变量仍可作为备用方案，但此文件是主要运行时配置。',
        'settings.open.config': '打开配置文件',
        'settings.save.apply': '保存并应用',
        'settings.model.connection': '模型连接',
        'settings.api.key': 'API Key',
        'settings.base.url': 'Base URL',
        'settings.default.model': '默认模型',
        'settings.model.list': '模型列表（每行一个）',
        'settings.generation': '生成参数',
        'settings.max.tokens': '最大 Tokens',
        'settings.temperature': 'Temperature',
        'settings.top.p': 'Top P',
        'settings.command.timeout': '命令超时 (秒)',
        'settings.max.tool.output': '工具最大输出',
        'settings.enable.thinking': '启用模型思考控制（当提供商支持时）',
        'settings.sandbox.title': '沙箱和命令安全',
        'settings.sandbox.mode': '沙箱模式',
        'settings.sandbox.safe': '安全模式（默认本地受保护执行）',
        'settings.sandbox.docker': 'Docker（更强隔离，需要 Docker Desktop）',
        'settings.docker.image': 'Docker 镜像',
        'settings.memory.limit': '内存限制',
        'settings.cpu.limit': 'CPU 限制',
        'settings.prefer.sandbox': '优先使用沙箱执行；当 Docker 不可用时回退到安全模式',
        'settings.git.snapshot': '在执行风险命令前自动创建 Git 快照',
        'settings.audit.logs': '记录命令审计日志',
        'settings.block.network': '在安全模式下阻止常见网络命令',
        'settings.sandbox.hint': '安全模式添加了命令检查、工作区边界检查、超时、输出限制、Git 快照和审计日志。它更快且依赖更少，但 Docker 仍然是可用时更强的隔离选项。',
        'settings.saved.success': '已保存到 ~/.mimo/settings.json 并应用。',
        'settings.saved.failed': '保存失败。请检查设置文件权限。',
    },
};

let currentLang: Lang = 'zh';

export function setLang(lang: Lang): void {
    currentLang = lang;
    // Update all translatable elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            const text = t(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                (el as HTMLInputElement).placeholder = text;
            } else {
                el.textContent = text;
            }
        }
    });
}

export function getLang(): Lang {
    return currentLang;
}

/** Get a welcome message pair (desc + hint) based on a seed (e.g. conversation ID) */
export function getWelcomePair(seed: string): { desc: string; hint: string } {
    // Simple hash from string to pick one of 5 variants
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    const idx = (Math.abs(hash) % 5) + 1;
    return {
        desc: t(`welcome.desc.${idx}`),
        hint: t(`welcome.hint.${idx}`),
    };
}

export function toggleLang(): Lang {
    const newLang = currentLang === 'en' ? 'zh' : 'en';
    setLang(newLang);
    return newLang;
}

/**
 * Get the display text for the language toggle button.
 * Shows the language you CAN switch TO, not the current one.
 */
export function getLangToggleText(): string {
    return currentLang === 'zh' ? 'EN' : '中';
}

export function t(key: string): string {
    return translations[currentLang][key] || translations['en'][key] || key;
}
