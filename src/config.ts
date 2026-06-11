import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SandboxConfig, DEFAULT_SANDBOX_CONFIG } from './sandbox';
import { McpServerConfig } from './mcp';
import { ApiEndpointMode, normalizeApiEndpointMode } from './api';

const MAX_MODEL_TOKENS = 131072;
const DEFAULT_MIMO_MODELS = [
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'mimo-v2.5-asr',
    'mimo-v2.5-tts-voiceclone',
    'mimo-v2.5-tts-voicedesign',
    'mimo-v2.5-tts',
    'mimo-v2-pro',
    'mimo-v2-mini',
];

export type ProviderProfileSetting = {
    id: string;
    name: string;
    provider?: string;
    show_in_picker?: boolean;
    base_url: string;
    api_endpoint: ApiEndpointMode;
    model: string;
    api_key: string;
    models: string[];
};

export type ModelRouteSetting = {
    endpoint_id: string;
    model: string;
};

export interface MiMoConfig {
    apiKey: string;
    baseUrl: string;
    apiEndpoint: ApiEndpointMode;
    model: string;
    models: string[];
    activeProviderProfile: string;
    activeRoute: ModelRouteSetting;
    providerProfiles: ProviderProfileSetting[];
    maxTokens: number;
    maxRounds: number;
    temperature: number;
    topP: number;
    enableThinking: boolean;
    reasoningEffort: 'turbo' | 'fast' | 'balanced' | 'deep' | 'max';
    maxOutputLen: number;
    commandTimeout: number;
    workspace: string;
    sandbox: SandboxConfig;
    mcpServers: McpServerConfig[];
    adversarial: {
        maxIterations: number;
        toolBudget: number;
        reviewDimensions: string[];
        enableVerification: boolean;
        convergenceThreshold: number;
    };
    infinite: {
        maxRounds: number;
        hardMultiplier: number;
        stallLimit: number;
    };
    context: {
        autoCompress: boolean;
        summarizeAtPercent: number;
        summarizeAtMessages: number;
        keepRecentMessages: number;
        maxSummaryTokens: number;
    };
    memory: {
        enabled: boolean;
        learnFromExplicitPreferences: boolean;
        maxItems: number;
        maxInjected: number;
    };
    dependencyInstall: {
        enabled: boolean;
        projectMode: 'auto' | 'confirm' | 'disabled';
        systemMode: 'confirm' | 'disabled';
        longTimeoutSec: number;
    };
    /** Raw settings from ~/.mimo/settings.json (for hooks, etc.) */
    settings: Record<string, any>;
}

type ResolvedProviderSelection = {
    activeProfile?: ProviderProfileSetting;
    activeProviderProfile: string;
    activeRoute?: ModelRouteSetting;
    model?: string;
};

export function loadConfig(): MiMoConfig {
    const cfg = vscode.workspace.getConfiguration('mimo');
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    // Try to load from ~/.mimo/settings.json
    const mimoHome = path.join(os.homedir(), '.mimo');
    let settings: Record<string, any> = {};
    try {
        const settingsPath = path.join(mimoHome, 'settings.json');
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
    } catch { /* ignore */ }

    const providerProfiles = sanitizeProviderProfiles(settings?.api?.provider_profiles);
    const baseUrlBeforeProfile = settings?.api?.base_url
        || process.env.MIMO_BASE_URL
        || process.env.OPENAI_BASE_URL
        || cfg.get<string>('baseUrl')
        || 'https://token-plan-cn.xiaomimimo.com/v1';
    const requestedRoute = sanitizeModelRoute(settings?.api?.active_route);
    const resolvedSelection = resolveActiveProviderSelection(providerProfiles, {
        requestedRoute,
        savedActiveProviderProfile: sanitizeString(settings?.api?.active_provider_profile, 80),
        baseUrl: baseUrlBeforeProfile,
        apiEndpoint: settings?.api?.api_endpoint,
        savedModel: settings?.api?.model
            || process.env.MIMO_MODEL
            || process.env.OPENAI_MODEL
            || cfg.get<string>('model')
            || 'mimo-v2.5-pro',
    });
    const activeProviderProfile = resolvedSelection.activeProviderProfile;
    const activeProfile = resolvedSelection.activeProfile;

    // Priority for model-call settings: active profile > ~/.mimo/settings.json > env > VS Code settings > defaults.
    const apiKey = activeProfile?.api_key
        || settings?.api?.api_key
        || settings?.api?.apiKey
        || process.env.MIMO_API_KEY
        || process.env.MIMO_TP_API_KEY
        || process.env.OPENAI_API_KEY
        || cfg.get<string>('apiKey')
        || '';

    const baseUrl = activeProfile?.base_url || baseUrlBeforeProfile;
    const apiEndpoint = normalizeApiEndpointMode(activeProfile?.api_endpoint || settings?.api?.api_endpoint);

    const model = resolvedSelection.model
        || activeProfile?.model
        || settings?.api?.model
        || process.env.MIMO_MODEL
        || process.env.OPENAI_MODEL
        || cfg.get<string>('model')
        || 'mimo-v2.5-pro';
    const configuredModels = Array.isArray(activeProfile?.models) && activeProfile.models.length > 0
        ? activeProfile.models
        : Array.isArray(settings?.api?.models)
            ? settings.api.models
            : [];
    const models = configuredModels.length > 0
        ? configuredModels
        : /xiaomi|mimo/i.test(`${baseUrl} ${model}`)
            ? DEFAULT_MIMO_MODELS
            : [model].filter(Boolean);

    return {
        apiKey,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiEndpoint,
        model,
        models,
        activeProviderProfile: activeProviderProfile || '',
        activeRoute: resolvedSelection.activeRoute || { endpoint_id: activeProviderProfile || '', model },
        providerProfiles,
        maxTokens: Math.min(
            MAX_MODEL_TOKENS,
            Math.max(256, settings?.agent?.max_tokens ?? cfg.get<number>('maxTokens') ?? 8192),
        ),
        maxRounds: settings?.agent?.max_rounds ?? cfg.get<number>('maxRounds') ?? 0,
        temperature: settings?.agent?.temperature ?? cfg.get<number>('temperature') ?? 0.7,
        topP: settings?.agent?.top_p ?? 0.95,
        enableThinking: settings?.agent?.enable_thinking ?? cfg.get<boolean>('enableThinking') ?? false,
        reasoningEffort: sanitizeReasoningEffort(
            settings?.agent?.reasoning_effort
            ?? (settings?.agent?.enable_thinking === true ? 'deep' : settings?.agent?.enable_thinking === false ? 'fast' : 'balanced'),
        ),
        maxOutputLen: settings?.safety?.max_output_len ?? 5000,
        commandTimeout: settings?.safety?.command_timeout ?? 120,
        workspace,
        sandbox: {
            enabled: settings?.sandbox?.enabled ?? DEFAULT_SANDBOX_CONFIG.enabled,
            mode: settings?.sandbox?.mode || DEFAULT_SANDBOX_CONFIG.mode,
            image: settings?.sandbox?.image || DEFAULT_SANDBOX_CONFIG.image,
            memoryLimit: settings?.sandbox?.memory_limit || DEFAULT_SANDBOX_CONFIG.memoryLimit,
            cpuLimit: settings?.sandbox?.cpu_limit ?? DEFAULT_SANDBOX_CONFIG.cpuLimit,
            timeoutSec: settings?.sandbox?.timeout ?? DEFAULT_SANDBOX_CONFIG.timeoutSec,
            gitSnapshot: settings?.sandbox?.git_snapshot ?? DEFAULT_SANDBOX_CONFIG.gitSnapshot,
            logging: settings?.sandbox?.logging ?? DEFAULT_SANDBOX_CONFIG.logging,
            networkDisabled: settings?.sandbox?.network_disabled ?? DEFAULT_SANDBOX_CONFIG.networkDisabled,
        },
        mcpServers: settings?.mcp?.servers || [],
        adversarial: {
            maxIterations: cfg.get<number>('adversarial.maxIterations')
                ?? settings?.adversarial?.max_iterations ?? 5,
            toolBudget: cfg.get<number>('adversarial.toolBudget')
                ?? settings?.adversarial?.tool_budget ?? 10,
            reviewDimensions: cfg.get<string[]>('adversarial.reviewDimensions')
                ?? settings?.adversarial?.review_dimensions ?? ['security', 'performance', 'ux'],
            enableVerification: cfg.get<boolean>('adversarial.enableVerification')
                ?? settings?.adversarial?.enable_verification ?? true,
            convergenceThreshold: cfg.get<number>('adversarial.convergenceThreshold')
                ?? settings?.adversarial?.convergence_threshold ?? 2,
        },
        infinite: {
            maxRounds: cfg.get<number>('infinite.maxRounds')
                ?? settings?.infinite?.max_rounds ?? 160,
            hardMultiplier: cfg.get<number>('infinite.hardMultiplier')
                ?? settings?.infinite?.hard_multiplier ?? 1.6,
            stallLimit: cfg.get<number>('infinite.stallLimit')
                ?? settings?.infinite?.stall_limit ?? 4,
        },
        context: {
            autoCompress: cfg.get<boolean>('context.autoCompress')
                ?? settings?.context?.auto_compress ?? true,
            summarizeAtPercent: Math.max(30, Math.min(95,
                cfg.get<number>('context.summarizeAtPercent')
                ?? settings?.context?.summarize_at_percent ?? 70,
            )),
            summarizeAtMessages: Math.max(16, Math.min(200,
                cfg.get<number>('context.summarizeAtMessages')
                ?? settings?.context?.summarize_at_messages ?? 48,
            )),
            keepRecentMessages: Math.max(8, Math.min(80,
                cfg.get<number>('context.keepRecentMessages')
                ?? settings?.context?.keep_recent_messages ?? 18,
            )),
            maxSummaryTokens: Math.max(400, Math.min(4000,
                cfg.get<number>('context.maxSummaryTokens')
                ?? settings?.context?.max_summary_tokens ?? 1200,
            )),
        },
        memory: {
            enabled: settings?.memory?.enabled ?? cfg.get<boolean>('memory.enabled') ?? true,
            learnFromExplicitPreferences: settings?.memory?.learn_from_explicit_preferences ?? true,
            maxItems: Math.max(10, Math.min(500, settings?.memory?.max_items ?? 120)),
            maxInjected: Math.max(0, Math.min(20, settings?.memory?.max_injected ?? 8)),
        },
        dependencyInstall: {
            enabled: cfg.get<boolean>('dependencyInstall.enabled')
                ?? settings?.dependency_install?.enabled ?? true,
            projectMode: sanitizeDependencyProjectMode(
                cfg.get<string>('dependencyInstall.projectMode')
                ?? settings?.dependency_install?.project_mode,
            ),
            systemMode: sanitizeDependencySystemMode(
                cfg.get<string>('dependencyInstall.systemMode')
                ?? settings?.dependency_install?.system_mode,
            ),
            longTimeoutSec: Math.max(60, Math.min(3600,
                cfg.get<number>('dependencyInstall.longTimeoutSec')
                ?? settings?.dependency_install?.long_timeout_sec ?? 600,
            )),
        },
        settings,
    };
}

function sanitizeString(value: unknown, maxLen: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/\x00/g, '').trim().slice(0, maxLen) || undefined;
}

function sanitizeProviderProfiles(input: unknown): ProviderProfileSetting[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((profile): ProviderProfileSetting | undefined => {
            if (!profile || typeof profile !== 'object') return undefined;
            const raw = profile as Record<string, unknown>;
            const id = sanitizeString(raw.id, 80);
            const name = sanitizeString(raw.name, 120) || id || '';
            const provider = sanitizeString(raw.provider, 80);
            const baseUrl = sanitizeString(raw.base_url, 2048);
            const apiEndpoint = normalizeApiEndpointMode(raw.api_endpoint);
            const model = sanitizeString(raw.model, 128);
            const apiKey = sanitizeString(raw.api_key, 4096);
            const models = Array.isArray(raw.models)
                ? raw.models.map(v => sanitizeString(v, 128)).filter((v): v is string => !!v).slice(0, 100)
                : undefined;
            if (!id || !baseUrl || !/^https?:\/\//i.test(baseUrl)) return undefined;
            return {
                id,
                name,
                provider: provider || inferProviderFromBaseUrl(baseUrl),
                show_in_picker: raw.show_in_picker !== false,
                base_url: baseUrl.replace(/\/+$/, ''),
                api_endpoint: apiEndpoint,
                model: model || '',
                api_key: apiKey || '',
                models: models || [],
            };
        })
        .filter((v): v is ProviderProfileSetting => !!v)
        .slice(0, 50);
}

function inferProviderFromBaseUrl(baseUrl: string): string {
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

function sanitizeModelRoute(input: unknown): ModelRouteSetting | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const raw = input as Record<string, unknown>;
    const endpointId = sanitizeString(raw.endpoint_id, 80);
    const model = sanitizeString(raw.model, 128);
    if (!endpointId || !model) return undefined;
    return { endpoint_id: endpointId, model };
}

function normalizeBaseUrl(value: unknown): string {
    return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function getPrimaryProfileModel(profile?: ProviderProfileSetting): string {
    return sanitizeString(profile?.model, 128)
        || profile?.models?.find(model => typeof model === 'string' && model.trim())?.trim()
        || '';
}

function profileMatchesModel(profile: ProviderProfileSetting | undefined, model: string | undefined): boolean {
    const target = sanitizeString(model, 128);
    if (!profile || !target) return false;
    return getPrimaryProfileModel(profile) === target || profile.models.includes(target);
}

function profileMatchesConnection(profile: ProviderProfileSetting | undefined, baseUrl: string, apiEndpoint: unknown): boolean {
    if (!profile) return false;
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (normalizedBaseUrl && normalizeBaseUrl(profile.base_url) !== normalizedBaseUrl) {
        return false;
    }
    return normalizeApiEndpointMode(profile.api_endpoint) === normalizeApiEndpointMode(apiEndpoint);
}

function resolveActiveProviderSelection(
    profiles: ProviderProfileSetting[],
    options: {
        requestedRoute?: ModelRouteSetting;
        savedActiveProviderProfile?: string;
        baseUrl: string;
        apiEndpoint?: unknown;
        savedModel?: string;
    },
): ResolvedProviderSelection {
    const requestedModel = sanitizeString(options.requestedRoute?.model, 128);
    const savedModel = sanitizeString(options.savedModel, 128);
    const desiredModel = requestedModel || savedModel;
    const requestedProfile = options.requestedRoute?.endpoint_id
        ? profiles.find(profile => profile.id === options.requestedRoute?.endpoint_id)
        : undefined;
    const savedProfile = options.savedActiveProviderProfile
        ? profiles.find(profile => profile.id === options.savedActiveProviderProfile)
        : undefined;
    const sameConnectionProfiles = profiles.filter(profile =>
        profileMatchesConnection(profile, options.baseUrl, options.apiEndpoint),
    );

    const candidates: Array<ProviderProfileSetting | undefined> = [
        requestedProfile && requestedModel && profileMatchesModel(requestedProfile, requestedModel) ? requestedProfile : undefined,
        desiredModel
            ? sameConnectionProfiles.find(profile => profileMatchesModel(profile, desiredModel))
            : undefined,
        savedProfile && desiredModel && profileMatchesModel(savedProfile, desiredModel) ? savedProfile : undefined,
        desiredModel
            ? profiles.find(profile => profileMatchesModel(profile, desiredModel))
            : undefined,
        requestedProfile,
        savedProfile,
        sameConnectionProfiles[0],
    ];

    const activeProfile = candidates.find((profile): profile is ProviderProfileSetting => !!profile);
    const activeProviderProfile = activeProfile?.id
        || options.savedActiveProviderProfile
        || inferActiveProviderProfile(options.baseUrl, profiles)
        || '';
    const resolvedModel = requestedModel && profileMatchesModel(activeProfile, requestedModel)
        ? requestedModel
        : getPrimaryProfileModel(activeProfile) || savedModel || requestedModel;

    return {
        activeProfile,
        activeProviderProfile,
        activeRoute: resolvedModel
            ? {
                endpoint_id: activeProviderProfile,
                model: resolvedModel,
            }
            : undefined,
        model: resolvedModel,
    };
}

function inferActiveProviderProfile(baseUrl: string, profiles: ProviderProfileSetting[]): string {
    const normalized = normalizeBaseUrl(baseUrl);
    const found = profiles.find(p => String(p.base_url || '').replace(/\/+$/, '').toLowerCase() === normalized);
    return found?.id || '';
}

function sanitizeDependencyProjectMode(value: unknown): 'auto' | 'confirm' | 'disabled' {
    return value === 'confirm' || value === 'disabled' ? value : 'auto';
}

function sanitizeDependencySystemMode(value: unknown): 'confirm' | 'disabled' {
    return value === 'disabled' ? 'disabled' : 'confirm';
}

function sanitizeReasoningEffort(value: unknown): 'turbo' | 'fast' | 'balanced' | 'deep' | 'max' {
    if (value === 'turbo' || value === 'fast' || value === 'balanced' || value === 'deep' || value === 'max') return value;
    if (value === 'off' || value === 'low') return 'fast';
    if (value === 'auto' || value === 'medium') return 'balanced';
    if (value === 'high') return 'deep';
    return 'balanced';
}

/**
 * Get the path to ~/.mimo/settings.json
 */
function getSettingsPath(): string {
    return path.join(os.homedir(), '.mimo', 'settings.json');
}

/**
 * Read the full settings.json file
 */
export function readSettings(): Record<string, any> {
    try {
        const p = getSettingsPath();
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    } catch { /* ignore */ }
    return {};
}

/**
 * Save a setting value to ~/.mimo/settings.json
 * Supports dot-path like "api.api_key" or "agent.temperature"
 */
export function saveSetting(dotPath: string, value: any): boolean {
    try {
        const settings = readSettings();
        const parts = dotPath.split('.');
        let obj: any = settings;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') {
                obj[parts[i]] = {};
            }
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;

        const p = getSettingsPath();
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Get current settings as a flat object for the settings panel
 */
export function getSettingsPanel(): Record<string, any> {
    const s = readSettings();
    const providerProfiles = sanitizeProviderProfiles(s?.api?.provider_profiles);
    const resolvedSelection = resolveActiveProviderSelection(providerProfiles, {
        requestedRoute: sanitizeModelRoute(s?.api?.active_route),
        savedActiveProviderProfile: sanitizeString(s?.api?.active_provider_profile, 80),
        baseUrl: s?.api?.base_url || 'https://token-plan-cn.xiaomimimo.com/v1',
        apiEndpoint: s?.api?.api_endpoint,
        savedModel: s?.api?.model || 'mimo-v2.5-pro',
    });
    const activeProviderProfile = resolvedSelection.activeProviderProfile;
    const activeProfile = resolvedSelection.activeProfile;
    const activeRoute = resolvedSelection.activeRoute;
    return {
        api_key: activeProfile?.api_key || s?.api?.api_key || s?.api?.apiKey || '',
        base_url: activeProfile?.base_url || s?.api?.base_url || 'https://token-plan-cn.xiaomimimo.com/v1',
        api_endpoint: normalizeApiEndpointMode(activeProfile?.api_endpoint || s?.api?.api_endpoint),
        model: activeRoute?.model || getPrimaryProfileModel(activeProfile) || s?.api?.model || 'mimo-v2.5-pro',
        models: activeProfile?.models?.length ? activeProfile.models : (s?.api?.models || []),
        active_provider_profile: activeProviderProfile,
        active_route: activeRoute || {
            endpoint_id: activeProviderProfile,
            model: getPrimaryProfileModel(activeProfile) || s?.api?.model || 'mimo-v2.5-pro',
        },
        provider_profiles: providerProfiles,
        max_tokens: Math.min(MAX_MODEL_TOKENS, Math.max(256, s?.agent?.max_tokens ?? 8192)),
        temperature: s?.agent?.temperature ?? 0.7,
        top_p: s?.agent?.top_p ?? 0.95,
        enable_thinking: s?.agent?.enable_thinking ?? false,
        reasoning_effort: sanitizeReasoningEffort(s?.agent?.reasoning_effort ?? (s?.agent?.enable_thinking ? 'deep' : 'fast')),
        max_output_len: s?.safety?.max_output_len ?? 5000,
        command_timeout: s?.safety?.command_timeout ?? 120,
        sandbox_enabled: s?.sandbox?.enabled ?? false,
        sandbox_mode: s?.sandbox?.mode || 'safe',
        sandbox_image: s?.sandbox?.image || 'node:20-alpine',
        sandbox_memory: s?.sandbox?.memory_limit || '512m',
        sandbox_cpu: s?.sandbox?.cpu_limit ?? 1,
        sandbox_git_snapshot: s?.sandbox?.git_snapshot ?? false,
        sandbox_logging: s?.sandbox?.logging ?? true,
        sandbox_network_disabled: s?.sandbox?.network_disabled ?? true,
        dependency_install_enabled: s?.dependency_install?.enabled ?? true,
        dependency_install_project_mode: sanitizeDependencyProjectMode(s?.dependency_install?.project_mode),
        dependency_install_system_mode: sanitizeDependencySystemMode(s?.dependency_install?.system_mode),
        dependency_install_long_timeout_sec: Math.max(60, Math.min(3600, s?.dependency_install?.long_timeout_sec ?? 600)),
        memory_enabled: s?.memory?.enabled ?? true,
        memory_learn_from_explicit_preferences: s?.memory?.learn_from_explicit_preferences ?? true,
        memory_max_items: Math.max(10, Math.min(500, s?.memory?.max_items ?? 120)),
        memory_max_injected: Math.max(0, Math.min(20, s?.memory?.max_injected ?? 8)),
        ui_completion_sound: s?.ui?.completion_sound !== false,
        ui_completion_sound_volume: Math.max(0, Math.min(100, s?.ui?.completion_sound_volume ?? 70)),
    };
}
