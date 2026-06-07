import * as path from 'path';
import * as os from 'os';
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
        'provider.hint': 'OpenAI-compatible endpoint. Deepseek works with https://api.deepseek.com/v1 plus a Deepseek API key.',
        'active.profile': 'Active Profile ID',
        'provider.profiles': 'Provider Profiles JSON',
        'provider.profiles.hint': 'Optional CC-switch style profiles. Each profile supports id, name, base_url, model, api_key, and models.',
        'model.connection': 'Model Connection',
        'api.key': 'API Key',
        'base.url': 'Base URL',
        'default.model': 'Default Model',
        'model.list': 'Model List (one per line)',
        'generation': 'Generation',
        'max.tokens': 'Max Tokens',
        'temperature': 'Temperature',
        'top.p': 'Top P',
        'command.timeout': 'Command Timeout (s)',
        'max.tool.output': 'Max Tool Output',
        'enable.thinking': 'Enable model thinking controls when the provider supports them',
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
        'git.snapshot': 'Create an automatic Git snapshot before risky commands',
        'audit.logs': 'Record command audit logs',
        'block.network': 'Block common network commands in Safe Mode',
        'sandbox.hint': 'Safe Mode adds command checks, workspace boundary checks, timeouts, output limits, Git snapshots, and audit logs. It is faster and dependency-light, but Docker remains the stronger isolation option when available.',
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
        'provider.hint': 'OpenAI 兼容接口。Deepseek 可使用 https://api.deepseek.com/v1 并填写 Deepseek API Key。',
        'active.profile': '当前配置 ID',
        'provider.profiles': '模型配置 Profiles JSON',
        'provider.profiles.hint': '可选的 CC-switch 风格配置。每个 profile 支持 id、name、base_url、model、api_key 和 models。',
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
        'git.snapshot': '在执行风险命令前自动创建 Git 快照',
        'audit.logs': '记录命令审计日志',
        'block.network': '在安全模式下阻止常见网络命令',
        'sandbox.hint': '安全模式会添加命令检查、工作区边界检查、超时、输出限制、Git 快照和审计日志。它更快且依赖更少，但 Docker 可用时隔离更强。',
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

    const activeProviderProfile = sanitizeString(s.active_provider_profile, 80);
    if (activeProviderProfile !== undefined) out.active_provider_profile = activeProviderProfile;

    if (Array.isArray(s.provider_profiles)) {
        out.provider_profiles = s.provider_profiles
            .map((profile) => {
                if (!profile || typeof profile !== 'object') return undefined;
                const raw = profile as Record<string, unknown>;
                const id = sanitizeString(raw.id, 80);
                const name = sanitizeString(raw.name, 120) || id;
                const baseUrl = sanitizeString(raw.base_url, 2048);
                const profileModel = sanitizeString(raw.model, 128) || '';
                const apiKey = sanitizeString(raw.api_key, 4096) || '';
                const profileModels = Array.isArray(raw.models)
                    ? raw.models.map(v => sanitizeString(v, 128)).filter((v): v is string => !!v).slice(0, 100)
                    : [];
                if (!id || !baseUrl || !/^https?:\/\//i.test(baseUrl)) return undefined;
                return { id, name, base_url: baseUrl.replace(/\/+$/, ''), model: profileModel, api_key: apiKey, models: profileModels };
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

    const maxTokens = sanitizeNumber(s.max_tokens, 256, 131072);
    if (maxTokens !== undefined) out.max_tokens = Math.round(maxTokens);

    const temperature = sanitizeNumber(s.temperature, 0, 2);
    if (temperature !== undefined) out.temperature = temperature;

    const topP = sanitizeNumber(s.top_p, 0, 1);
    if (topP !== undefined) out.top_p = topP;

    const maxOutputLen = sanitizeNumber(s.max_output_len, 1000, 200000);
    if (maxOutputLen !== undefined) out.max_output_len = Math.round(maxOutputLen);

    const commandTimeout = sanitizeNumber(s.command_timeout, 5, 3600);
    if (commandTimeout !== undefined) out.command_timeout = Math.round(commandTimeout);

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

    for (const key of ['enable_thinking', 'sandbox_enabled', 'sandbox_git_snapshot', 'sandbox_logging', 'sandbox_network_disabled', 'dependency_install_enabled', 'memory_enabled', 'memory_learn_from_explicit_preferences']) {
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
    if (s.model !== undefined) ok = saveSetting('api.model', s.model) && ok;
    if (s.models !== undefined) ok = saveSetting('api.models', s.models) && ok;
    if (s.active_provider_profile !== undefined) ok = saveSetting('api.active_provider_profile', s.active_provider_profile) && ok;
    if (s.provider_profiles !== undefined) ok = saveSetting('api.provider_profiles', s.provider_profiles) && ok;
    if (s.max_tokens !== undefined) ok = saveSetting('agent.max_tokens', s.max_tokens) && ok;
    if (s.temperature !== undefined) ok = saveSetting('agent.temperature', s.temperature) && ok;
    if (s.top_p !== undefined) ok = saveSetting('agent.top_p', s.top_p) && ok;
    if (s.enable_thinking !== undefined) ok = saveSetting('agent.enable_thinking', s.enable_thinking) && ok;
    if (s.max_output_len !== undefined) ok = saveSetting('safety.max_output_len', s.max_output_len) && ok;
    if (s.command_timeout !== undefined) ok = saveSetting('safety.command_timeout', s.command_timeout) && ok;
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

export class SettingsProvider {
    private panel?: vscode.WebviewPanel;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agent: MiMoAgent,
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
                panel.webview.postMessage({ type: 'saveResult', ok, settings: getSettingsPanel() });
            } else if (msg.type === 'openSettingsFile') {
                const settingsPath = path.join(os.homedir(), '.mimo', 'settings.json');
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
.page{max-width:980px;margin:0 auto;padding:24px 28px 40px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;border-bottom:1px solid var(--vscode-editorWidget-border);padding-bottom:16px}
h1{font-size:22px;margin:0 0 6px;font-weight:650}
.sub{color:var(--vscode-descriptionForeground);line-height:1.5}
.actions{display:flex;gap:8px;white-space:nowrap}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:4px;padding:7px 12px;cursor:pointer}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:hover{filter:brightness(1.08)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.section{border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:16px;background:var(--vscode-sideBar-background)}
.section.full{grid-column:1 / -1}
.section h2{font-size:14px;margin:0 0 14px;font-weight:650}
.field{display:grid;gap:6px;margin-bottom:12px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
label{font-size:12px;color:var(--vscode-descriptionForeground)}
input,textarea,select{box-sizing:border-box;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;padding:7px 8px;font-family:var(--vscode-font-family);font-size:13px}
textarea{min-height:96px;resize:vertical}
.check{display:flex;align-items:center;gap:8px;margin:9px 0}
.check input{width:auto;flex:0 0 auto}
.hint{font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.45}
.status{min-height:18px;margin-top:12px;color:var(--vscode-descriptionForeground)}
@media (max-width:760px){.grid,.row{grid-template-columns:1fr}.top{display:block}.actions{margin-top:12px;white-space:normal}.section.full{grid-column:auto}}
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

  <div class="grid">
    <section class="section">
      <h2>${t('model.connection')}</h2>
      <div class="field"><label for="provider">${t('provider')}</label><select id="provider"><option value="mimo">MiMo</option><option value="deepseek">Deepseek</option><option value="openai">OpenAI</option><option value="custom">Custom</option></select></div>
      <div class="hint">${t('provider.hint')}</div>
      <div class="field"><label for="api_key">${t('api.key')}</label><input id="api_key" type="password" autocomplete="off" placeholder="sk-..."></div>
      <div class="field"><label for="base_url">${t('base.url')}</label><input id="base_url" placeholder="https://.../v1"></div>
      <div class="field"><label for="model">${t('default.model')}</label><input id="model" placeholder="mimo-v2.5-pro"></div>
      <div class="field"><label for="models">${t('model.list')}</label><textarea id="models" spellcheck="false"></textarea></div>
      <div class="field"><label for="active_provider_profile">${t('active.profile')}</label><input id="active_provider_profile" placeholder="mimo"></div>
      <div class="field"><label for="provider_profiles">${t('provider.profiles')}</label><textarea id="provider_profiles" spellcheck="false" placeholder='[{"id":"deepseek","name":"Deepseek","base_url":"https://api.deepseek.com/v1","model":"deepseek-chat","api_key":"","models":["deepseek-chat"]}]'></textarea></div>
      <div class="hint">${t('provider.profiles.hint')}</div>
    </section>

    <section class="section">
      <h2>${t('generation')}</h2>
      <div class="row">
        <div class="field"><label for="max_tokens">${t('max.tokens')}</label><input id="max_tokens" type="number" min="256" max="131072"></div>
        <div class="field"><label for="temperature">${t('temperature')}</label><input id="temperature" type="number" min="0" max="2" step="0.1"></div>
      </div>
      <div class="row">
        <div class="field"><label for="top_p">${t('top.p')}</label><input id="top_p" type="number" min="0" max="1" step="0.05"></div>
        <div class="field"><label for="command_timeout">${t('command.timeout')}</label><input id="command_timeout" type="number" min="5" max="3600"></div>
      </div>
      <div class="field"><label for="max_output_len">${t('max.tool.output')}</label><input id="max_output_len" type="number" min="1000" max="200000"></div>
      <label class="check"><input id="enable_thinking" type="checkbox"> ${t('enable.thinking')}</label>
    </section>

    <section class="section full">
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

    <section class="section full">
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

    <section class="section full">
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
  <div class="status" id="status"></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const translations = ${JSON.stringify(settingsTranslations[settingsLang])};
const providerDefaults = {
  mimo:{base_url:'https://token-plan-cn.xiaomimimo.com/v1',model:'mimo-v2.5-pro',models:['mimo-v2.5-pro','mimo-v2.5']},
  deepseek:{base_url:'https://api.deepseek.com/v1',model:'deepseek-chat',models:['deepseek-chat','deepseek-reasoner']},
  openai:{base_url:'https://api.openai.com/v1',model:'gpt-4o',models:['gpt-4o','gpt-4o-mini']},
};
function detectProvider(s){
  const base = (s.base_url || '').toLowerCase();
  if (base.includes('deepseek')) return 'deepseek';
  if (base.includes('openai.com')) return 'openai';
  if (base.includes('xiaomimimo')) return 'mimo';
  return 'custom';
}
function fill(s){
  $('provider').value = detectProvider(s);
  $('api_key').value = s.api_key || '';
  $('base_url').value = s.base_url || '';
  $('model').value = s.model || '';
  $('models').value = (s.models || []).join('\\n');
  $('active_provider_profile').value = s.active_provider_profile || '';
  $('provider_profiles').value = JSON.stringify(s.provider_profiles || [], null, 2);
  $('max_tokens').value = s.max_tokens ?? 8192;
  $('temperature').value = s.temperature ?? 0.7;
  $('top_p').value = s.top_p ?? 0.95;
  $('max_output_len').value = s.max_output_len ?? 5000;
  $('command_timeout').value = s.command_timeout ?? 120;
  $('enable_thinking').checked = !!s.enable_thinking;
  $('sandbox_enabled').checked = !!s.sandbox_enabled;
  $('sandbox_mode').value = s.sandbox_mode || 'safe';
  $('sandbox_image').value = s.sandbox_image || 'node:20-alpine';
  $('sandbox_memory').value = s.sandbox_memory || '512m';
  $('sandbox_cpu').value = s.sandbox_cpu ?? 1;
  $('sandbox_git_snapshot').checked = s.sandbox_git_snapshot !== false;
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
function applyProviderPreset(provider){
  const preset = providerDefaults[provider];
  if (!preset) return;
  $('base_url').value = preset.base_url;
  $('model').value = preset.model;
  $('models').value = preset.models.join('\\n');
  $('active_provider_profile').value = provider;
}
function collect(){
  return {
    api_key:$('api_key').value,
    base_url:$('base_url').value,
    model:$('model').value,
    models:$('models').value.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean),
    active_provider_profile:$('active_provider_profile').value,
    provider_profiles:(()=>{try{return JSON.parse($('provider_profiles').value || '[]')}catch{return undefined}})(),
    max_tokens:Number($('max_tokens').value),
    temperature:Number($('temperature').value),
    top_p:Number($('top_p').value),
    max_output_len:Number($('max_output_len').value),
    command_timeout:Number($('command_timeout').value),
    enable_thinking:$('enable_thinking').checked,
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
window.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type === 'settingsData') fill(msg.settings || {});
  if (msg.type === 'saveResult') {
    $('status').textContent = msg.ok ? translations['saved.success'] : translations['saved.failed'];
    if (msg.settings) fill(msg.settings);
  }
});
$('save').addEventListener('click', () => vscode.postMessage({type:'saveSettings', settings: collect()}));
$('open-file').addEventListener('click', () => vscode.postMessage({type:'openSettingsFile'}));
$('provider').addEventListener('change', () => applyProviderPreset($('provider').value));
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
