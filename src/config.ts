import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SandboxConfig, DEFAULT_SANDBOX_CONFIG } from './sandbox';
import { McpServerConfig } from './mcp';

export interface MiMoConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    models: string[];
    maxTokens: number;
    maxRounds: number;
    temperature: number;
    topP: number;
    enableThinking: boolean;
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
    /** Raw settings from ~/.mimo/settings.json (for hooks, etc.) */
    settings: Record<string, any>;
}

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

    // Priority for model-call settings: ~/.mimo/settings.json > env > VS Code settings > defaults.
    const apiKey = settings?.api?.api_key
        || settings?.api?.apiKey
        || process.env.MIMO_API_KEY
        || process.env.MIMO_TP_API_KEY
        || process.env.OPENAI_API_KEY
        || cfg.get<string>('apiKey')
        || '';

    const baseUrl = settings?.api?.base_url
        || process.env.MIMO_BASE_URL
        || process.env.OPENAI_BASE_URL
        || cfg.get<string>('baseUrl')
        || 'https://token-plan-cn.xiaomimimo.com/v1';

    const model = settings?.api?.model
        || process.env.MIMO_MODEL
        || process.env.OPENAI_MODEL
        || cfg.get<string>('model')
        || 'mimo-v2.5-pro';

    return {
        apiKey,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        model,
        models: settings?.api?.models || [],
        maxTokens: settings?.agent?.max_tokens ?? cfg.get<number>('maxTokens') ?? 8192,
        maxRounds: settings?.agent?.max_rounds ?? cfg.get<number>('maxRounds') ?? 100,
        temperature: settings?.agent?.temperature ?? cfg.get<number>('temperature') ?? 0.7,
        topP: settings?.agent?.top_p ?? 0.95,
        enableThinking: settings?.agent?.enable_thinking ?? cfg.get<boolean>('enableThinking') ?? false,
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
        settings,
    };
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
    return {
        api_key: s?.api?.api_key || s?.api?.apiKey || '',
        base_url: s?.api?.base_url || 'https://token-plan-cn.xiaomimimo.com/v1',
        model: s?.api?.model || 'mimo-v2.5-pro',
        models: s?.api?.models || [],
        max_tokens: s?.agent?.max_tokens ?? 8192,
        temperature: s?.agent?.temperature ?? 0.7,
        top_p: s?.agent?.top_p ?? 0.95,
        enable_thinking: s?.agent?.enable_thinking ?? false,
        max_output_len: s?.safety?.max_output_len ?? 5000,
        command_timeout: s?.safety?.command_timeout ?? 120,
        sandbox_enabled: s?.sandbox?.enabled ?? false,
        sandbox_mode: s?.sandbox?.mode || 'safe',
        sandbox_image: s?.sandbox?.image || 'node:20-alpine',
        sandbox_memory: s?.sandbox?.memory_limit || '512m',
        sandbox_cpu: s?.sandbox?.cpu_limit ?? 1,
        sandbox_git_snapshot: s?.sandbox?.git_snapshot ?? true,
        sandbox_logging: s?.sandbox?.logging ?? true,
        sandbox_network_disabled: s?.sandbox?.network_disabled ?? true,
    };
}
