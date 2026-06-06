import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { MiMoAPI, ChatMessage, ContentPart, ToolCall } from './api';
import { TOOL_DEFINITIONS, executeTool } from './tools';
import { buildSystemPrompt, loadInstructions, validateInstructions } from './prompt';
import { MiMoConfig } from './config';
import { Skill, loadSkills, renderSkill, saveUserSkill, deleteUserSkill } from './skills';
import { manageContext, getContextStats, summarizeContext, recordTokenUsage } from './context';
import { McpManager } from './mcp';
import { detectPersona, buildPersonaPrompt, getPersona } from './personas';
import { runSubAgent, SubAgentOptions, SubAgentResult, SubAgentEvents } from './subagent';
import { HookManager } from './hooks';
import { TokenTracker, TokenUsage } from './tokenTracker';
import { executeWorkflow, WorkflowPhase, WorkflowResult, WorkflowEvents } from './workflow';
import { classifyIntent, IntentResult, checkAdversarialSuitability, quickClassifyIntent } from './router';

export interface AgentEvents {
    onToken: (token: string) => void;
    onReasoning: (token: string) => void;
    onToolCallStart: (name: string, args: Record<string, any>) => void;
    onToolCallEnd: (name: string, result: string, isError: boolean, elapsed: number) => void;
    onRoundStart: (round: number) => void;
    onDone: (response: string) => void;
    onError: (error: string) => void;
    onStatus: (status: string) => void;
    onModelSwitched?: (model: string) => void;
    onTokenUsage?: (usage: TokenUsage) => void;
    onEditPreview?: (previewId: string, path: string, oldText: string, newText: string, matchCount: number) => void;
    onWritePreview?: (previewId: string, filePath: string, content: string, isCreate: boolean) => void;
    // Workflow events
    onWorkflowStart?: (totalPhases: number, totalTasks: number) => void;
    onWorkflowPhaseStart?: (phaseIndex: number, title: string, mode: string, taskCount: number) => void;
    onWorkflowTaskStart?: (phaseIndex: number, taskIndex: number, label: string) => void;
    onWorkflowTaskEnd?: (phaseIndex: number, taskIndex: number, result: any) => void;
    onWorkflowPhaseEnd?: (phaseIndex: number, result: any) => void;
    onWorkflowEnd?: (result: WorkflowResult) => void;
    // Adversarial mode events
    onAdversarialTurn?: (persona: 'programmer' | 'pm', name: string, icon: string, phase: 'speak' | 'tool' | 'review' | 'verdict', content: string, iteration: number) => void;
    onAdversarialToolStart?: (persona: 'programmer' | 'pm', toolName: string, args: Record<string, any>) => void;
    onAdversarialToolEnd?: (persona: 'programmer' | 'pm', toolName: string, result: string, isError: boolean, elapsed: number) => void;
    // Interactive user input
    onAskUser?: (previewId: string, question: string, options: string[]) => void;
}

interface PendingEdit {
    previewId: string;
    path: string;
    oldText: string;
    newText: string;
    resolve: (result: string) => void;
}

interface PendingWrite {
    previewId: string;
    path: string;
    content: string;
    resolve: (result: string) => void;
}

interface PendingAsk {
    previewId: string;
    resolve: (answer: string) => void;
}

export type AgentMode = 'auto' | 'polling' | 'plan' | 'adversarial';

interface ModelCapabilities {
    vision: boolean;
    tts: boolean;
    reasoning: boolean;
    thinkingControl: boolean;
    description: string;
}

function normalizeModelName(model: string): string {
    return (model || '').trim().toLowerCase();
}

function inferProvider(baseUrl: string, model: string): string {
    const value = `${baseUrl || ''} ${model || ''}`.toLowerCase();
    if (value.includes('xiaomi') || value.includes('mimo')) return 'mimo';
    if (value.includes('openai.com') || value.includes('gpt-') || value.includes('o1') || value.includes('o3') || value.includes('o4')) return 'openai';
    if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
    if (value.includes('deepseek')) return 'deepseek';
    if (value.includes('ollama')) return 'ollama';
    return 'openai-compatible';
}

function inferModelCapabilities(model: string, baseUrl = ''): ModelCapabilities {
    const name = normalizeModelName(model);
    const provider = inferProvider(baseUrl, model);
    const vision = /(vision|vl|multimodal|gpt-4o|gpt-4\.1|o3|o4|claude-3|gemini|qwen-vl|llava|mimo-v2\.5(?!-pro|-lite|-flash|-tts))/i.test(name);
    const tts = /(tts|audio|speech)/i.test(name);
    const reasoning = /(reason|thinking|o1|o3|o4|deepseek-r1|qwen3|mimo-v2\.5-pro)/i.test(name);
    return {
        vision,
        tts,
        reasoning,
        thinkingControl: provider === 'mimo',
        description: provider === 'mimo'
            ? 'MiMo-compatible model'
            : provider === 'openai-compatible'
                ? 'OpenAI-compatible model'
                : `${provider} model`,
    };
}

/**
 * Friendly error messages for common API errors.
 * Maps error patterns to user-friendly Chinese messages.
 */
const ERROR_MESSAGES: Record<string, string> = {
    'ECONNREFUSED': 'Cannot connect to the API server. Check baseUrl, network, and proxy settings.',
    'ECONNRESET': 'The API connection was reset. The network or upstream server may be unstable.',
    'ETIMEDOUT': 'The API request timed out. Check network speed, proxy, or provider status.',
    'ENOTFOUND': 'Cannot resolve the API host. Check baseUrl and DNS settings.',
    'socket hang up': 'The API connection closed unexpectedly. Try again shortly.',
    'DEPTH_ZERO_SELF_SIGNED_CERT': 'TLS certificate verification failed because the certificate is self-signed.',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE': 'TLS certificate verification failed. Check system time and certificate configuration.',
    '429': 'The API rate limit was reached.',
    '401': 'The API key is invalid or expired. Check your extension settings, environment variables, or ~/.mimo/settings.json.',
    '403': 'The API key does not have permission for this request or model.',
    '404': 'The API endpoint or model was not found. Check baseUrl and model settings.',
    '500': 'The API server returned an internal error. Try again shortly.',
    '502': 'The API gateway returned an error. The provider may be under maintenance.',
    '503': 'The API service is temporarily unavailable. Try again shortly.',
};

/**
 * Get a friendly error message for an API error.
 */
function getFriendlyError(error: Error): string {
    const msg = error.message || '';

    for (const [pattern, friendly] of Object.entries(ERROR_MESSAGES)) {
        if (msg.includes(pattern)) {
            let result = `FAILED: ${friendly}`;

            if (msg.includes('429')) {
                const retryMatch = msg.match(/retry-after[:\s]+(\d+)/i);
                const waitTime = retryMatch ? parseInt(retryMatch[1]) : 30;
                result += `\n\nWait about ${waitTime} seconds and retry.`;
            }

            if (msg.includes('401') || msg.includes('403')) {
                result += '\n\nCheck the API key, baseUrl, selected model, and provider-side model permissions.';
            }

            return result;
        }
    }

    return `FAILED: ${msg}`;
}

/** Structured issue tracked across adversarial rounds */
export interface TrackedIssue {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    file: string;
    line?: number;
    description: string;
    dimension: string;
    round: number;
    resolved: boolean;
    resolvedRound?: number;
}

export interface ConversationState {
    id: string;
    title: string;
    messages: ChatMessage[];
    model: string;
    planConfirmed?: boolean; // Plan mode: has user confirmed the plan?
    mode: AgentMode;
    /** Persisted persona ID across conversation turns */
    personaId?: string;
    /** Active skill prompt injected into system prompt */
    activeSkillPrompt?: string;
}

export class MiMoAgent extends EventEmitter {
    private api: MiMoAPI;
    private systemPrompt: string;
    /** Cached personalized instructions from MIMO.md / Agent.md / claude.md */
    private personalizedInstructions: string = '';
    private skills: Map<string, Skill>;
    private conversations = new Map<string, ConversationState>();
    private activeId: string = '';
    /** Per-conversation abort controllers — each conversation runs independently */
    private abortControllers = new Map<string, AbortController>();
    /** Conversations that have been explicitly stopped by the user */
    private stoppingConversations = new Set<string>();
    private mcpManager: McpManager;
    private hookManager: HookManager;
    private tokenTracker: TokenTracker;
    private pendingEdits = new Map<string, PendingEdit>();
    private pendingWrites = new Map<string, PendingWrite>();
    private pendingAsks = new Map<string, PendingAsk>();

    // ── Input boundary handling ──
    /** Max input length before truncation */
    private static readonly MAX_INPUT_LENGTH = 100_000; // 100k chars
    /** Track active chats per conversation to prevent concurrent sends */
    private activeChats = new Map<string, Promise<string>>();
    /** Track recent inputs for repeated input detection */
    private recentInputs = new Map<string, { count: number; lastTime: number }>();

    private static readonly DEFAULT_MODELS = [
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'gpt-4o',
        'gpt-4o-mini',
        'deepseek-chat',
        'qwen-plus',
    ];

    // Model capabilities: what each model supports
    static readonly MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
        'mimo-v2.5-pro': { vision: false, tts: false, reasoning: true, thinkingControl: true, description: 'MiMo reasoning model' },
        'mimo-v2.5': { vision: true, tts: false, reasoning: true, thinkingControl: true, description: 'MiMo multimodal model' },
        'MiMo-V2.5': { vision: true, tts: false, reasoning: true, thinkingControl: true, description: 'MiMo multimodal model' },
        'mimo-v2.5-tts': { vision: false, tts: true, reasoning: false, thinkingControl: true, description: 'MiMo speech model' },
        'MiMo-V2.5-TTS': { vision: false, tts: true, reasoning: false, thinkingControl: true, description: 'MiMo speech model' },
        'mimo-v2-lite': { vision: false, tts: false, reasoning: false, thinkingControl: true, description: 'MiMo lightweight model' },
        'mimo-v2-flash': { vision: false, tts: false, reasoning: false, thinkingControl: true, description: 'MiMo fast model' },
    };

    getModelCapabilities(model: string): ModelCapabilities {
        return MiMoAgent.MODEL_CAPABILITIES[model] || inferModelCapabilities(model, this.config.baseUrl);
    }

    private shouldSendThinkingControl(model: string): boolean {
        return this.getModelCapabilities(model).thinkingControl;
    }

    private buildChatParams(
        model: string,
        messages: ChatMessage[] | Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: any }>,
        options: Record<string, any> = {},
    ): Record<string, any> {
        const params: Record<string, any> = {
            model,
            messages,
            max_tokens: options.max_tokens ?? this.config.maxTokens,
            temperature: options.temperature ?? this.config.temperature,
            top_p: options.top_p ?? this.config.topP,
            stream_options: options.stream_options ?? { include_usage: true },
            ...options,
        };
        if (params.stream_options === null) delete params.stream_options;
        if (!this.config.enableThinking && this.shouldSendThinkingControl(model)) {
            params.extra_body = {
                ...(params.extra_body || {}),
                thinking: { type: 'disabled' },
            };
        }
        return params;
    }

    private findVisionModel(currentModel: string): string | null {
        const candidates = [currentModel, ...this.getModelList()];
        for (const model of candidates) {
            if (this.getModelCapabilities(model).vision) return model;
        }
        return null;
    }

    constructor(
        private config: MiMoConfig,
        private extensionPath: string,
        private context?: vscode.ExtensionContext,
    ) {
        super();
        this.api = new MiMoAPI(config.apiKey, config.baseUrl);
        this.systemPrompt = buildSystemPrompt(config.workspace);
        this.skills = loadSkills(extensionPath);
        this.mcpManager = new McpManager();
        this.hookManager = new HookManager(config.settings || {});
        this.tokenTracker = new TokenTracker();
        if (this.context) {
            this.loadConversations();
        }
        // Connect to MCP servers asynchronously
        this.initMcp();
    }

    /** Public cleanup method for extension deactivation */
    dispose(): void {
        this.mcpManager.disconnectAll();
    }

    /** Hot-reload config after settings change (no restart needed) */
    updateConfig(newConfig: MiMoConfig): void {
        this.config = newConfig;
        this.api = new MiMoAPI(newConfig.apiKey, newConfig.baseUrl);
        this.systemPrompt = buildSystemPrompt(newConfig.workspace);
        this.hookManager = new HookManager(newConfig.settings || {});
    }

    private async initMcp(): Promise<void> {
        const mcpServers = this.config.mcpServers || [];
        if (mcpServers.length === 0) return;
        try {
            const tools = await this.mcpManager.connectAll(mcpServers);
            if (tools.length > 0) {
                console.log(`[MiMo] MCP: ${tools.length} tools loaded from ${mcpServers.length} server(s)`);
            }
        } catch (e: any) {
            console.error(`[MiMo] MCP init error: ${e.message}`);
        }
    }

    // ── Persistence ──

    private loadConversations(): void {
        if (!this.context) return;
        const saved = this.context.globalState.get<Record<string, ConversationState>>('mimo.conversations');
        if (saved) {
            for (const [id, conv] of Object.entries(saved)) {
                this.conversations.set(id, conv);
            }
            const lastActive = this.context.globalState.get<string>('mimo.activeConversationId');
            if (lastActive && this.conversations.has(lastActive)) {
                this.activeId = lastActive;
            }
        }
    }

    private saveConversations(): void {
        if (!this.context) return;
        const data = Object.fromEntries(this.conversations);
        this.context.globalState.update('mimo.conversations', data);
        this.context.globalState.update('mimo.activeConversationId', this.activeId);
    }

    hasApiKey(): boolean {
        return !!this.config.apiKey;
    }

    getModelList(): string[] {
        return this.config.models.length > 0
            ? this.config.models
            : MiMoAgent.DEFAULT_MODELS;
    }

    // ── Conversation management ──

    createConversation(): string {
        // Unique ID: timestamp + random suffix (no collision even in same ms)
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.conversations.set(id, {
            id,
            title: '新对话',
            messages: [],
            model: this.config.model,
            mode: 'auto',
        });
        // DO NOT set this.activeId — panels manage their own active conversation
        this.saveConversations();
        return id;
    }

    switchConversation(id: string): boolean {
        // Just verify the conversation exists — panels manage their own active conversation
        return this.conversations.has(id);
    }

    getActiveId(): string {
        return this.activeId;
    }

    getActive(): ConversationState | undefined {
        return this.conversations.get(this.activeId);
    }

    getConversation(id: string): ConversationState | undefined {
        return this.conversations.get(id);
    }

    getAllConversations(): ConversationState[] {
        return Array.from(this.conversations.values());
    }

    loadConversation(
        id: string,
        title: string,
        messages: ChatMessage[],
        model: string,
        options: Partial<Pick<ConversationState, 'mode' | 'personaId' | 'activeSkillPrompt'>> = {},
    ): void {
        this.conversations.set(id, {
            id,
            title,
            messages: [...messages],
            model,
            mode: options.mode || 'auto',
            personaId: options.personaId,
            activeSkillPrompt: options.activeSkillPrompt,
        });
        // DO NOT set this.activeId — panels manage their own active conversation
        this.saveConversations();
    }

    removeConversation(id: string): void {
        this.conversations.delete(id);
        // Panels manage their own active conversation — no global activeId update needed
        this.saveConversations();
    }

    setTitle(id: string, title: string): void {
        const conv = this.conversations.get(id);
        if (conv) {
            conv.title = title;
            this.saveConversations();
        }
    }

    // ── Per-conversation getters ──

    getMessages(id: string): ChatMessage[] {
        const conv = this.conversations.get(id);
        return conv ? [...conv.messages] : [];
    }

    getModel(id: string): string {
        const conv = this.conversations.get(id);
        return conv?.model || this.config.model;
    }

    getMode(id: string): AgentMode {
        const conv = this.conversations.get(id);
        return conv?.mode || 'auto';
    }

    // ── Per-conversation setters ──

    setModel(model: string, convId?: string): void {
        const conv = this.conversations.get(convId || this.activeId);
        if (conv) {
            conv.model = model;
            this.saveConversations();
        }
    }

    setMode(mode: AgentMode, convId?: string): void {
        const conv = this.conversations.get(convId || this.activeId);
        if (conv) {
            conv.mode = mode;
            this.saveConversations();
        }
    }

    reset(convId?: string): void {
        const conv = this.conversations.get(convId || this.activeId);
        if (conv) {
            conv.messages = [];
            this.saveConversations();
        }
    }

    // ── Skills ──

    getSkills(): Skill[] {
        return Array.from(this.skills.values());
    }

    /** Reload skills from both builtin and user directories */
    reloadSkills(): void {
        this.skills = loadSkills(this.extensionPath);
    }

    /** Save or update a user skill */
    saveSkill(skill: { name: string; description: string; tools?: string[]; prompt: string }): boolean {
        const ok = saveUserSkill(skill);
        if (ok) this.reloadSkills();
        return ok;
    }

    /** Delete a user skill */
    deleteSkill(name: string): boolean {
        const ok = deleteUserSkill(name);
        if (ok) this.reloadSkills();
        return ok;
    }

    // ── Edit Preview ──

    /** Confirm or reject a pending edit preview */
    confirmEdit(previewId: string, approved: boolean): void {
        const pending = this.pendingEdits.get(previewId);
        if (!pending) return;
        this.pendingEdits.delete(previewId);
        if (approved) {
            // Execute the actual edit
            const fs = require('fs');
            try {
                const content = fs.readFileSync(pending.path, 'utf-8');
                const newContent = content.split(pending.oldText).join(pending.newText);
                fs.writeFileSync(pending.path, newContent, 'utf-8');
                pending.resolve(`Replaced (approved by user)`);
            } catch (e: any) {
                pending.resolve(`Edit failed: ${e.message}`);
            }
        } else {
            pending.resolve('Edit rejected by user');
        }
    }

    /**
     * Confirm or reject the plan in Plan mode.
     * When confirmed, the next chat() call will enable tools for execution.
     */
    confirmPlan(approved: boolean, convId?: string): void {
        const conv = this.conversations.get(convId || this.activeId);
        if (!conv || conv.mode !== 'plan') return;
        conv.planConfirmed = approved;
        this.saveConversations();
    }

    /**
     * Handle a run_workflow tool call: execute multi-phase parallel/sequential workflow.
     */
    private async handleWorkflow(args: Record<string, any>, events: AgentEvents, signal?: AbortSignal, convId?: string): Promise<string> {
        const phases = args.phases as WorkflowPhase[];
        if (!phases || phases.length === 0) return 'Error: run_workflow requires at least one phase';

        const conv = this.conversations.get(convId || this.activeId);
        const model = conv?.model || this.config.model;

        // Inject model into tasks that don't specify one
        for (const phase of phases) {
            for (const task of phase.tasks) {
                if (!task.model) task.model = model;
            }
        }

        const workflowEvents: WorkflowEvents = {
            onWorkflowStart: (totalPhases, totalTasks) => {
                events.onWorkflowStart?.(totalPhases, totalTasks);
            },
            onWorkflowPhaseStart: (pi, title, mode, taskCount) => {
                events.onWorkflowPhaseStart?.(pi, title, mode, taskCount);
            },
            onWorkflowTaskStart: (pi, ti, label) => {
                events.onWorkflowTaskStart?.(pi, ti, label);
            },
            onWorkflowTaskEnd: (pi, ti, result) => {
                events.onWorkflowTaskEnd?.(pi, ti, result);
            },
            onWorkflowPhaseEnd: (pi, result) => {
                events.onWorkflowPhaseEnd?.(pi, result);
            },
            onWorkflowEnd: (result) => {
                events.onWorkflowEnd?.(result);
            },
            onStatus: (s) => events.onStatus(s),
            onReasoning: (t) => events.onReasoning(t),
        };

        const result = await executeWorkflow(
            phases,
            this.api,
            this.config.workspace,
            this.mcpManager,
            {
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                topP: this.config.topP,
                maxOutputLen: this.config.maxOutputLen,
                commandTimeout: this.config.commandTimeout,
                sandbox: this.config.sandbox,
                enableThinking: this.config.enableThinking,
            },
            workflowEvents,
            signal,
        );

        // Format result as text for the tool response
        let output = `## Workflow Complete\n\n`;
        output += `**${result.phases.length} phases**, **${result.totalToolCalls} tool calls**, **${(result.elapsed / 1000).toFixed(1)}s**\n\n`;

        for (let pi = 0; pi < result.phases.length; pi++) {
            const phase = result.phases[pi];
            output += `### Phase ${pi + 1}: ${phase.title} (${phase.mode})\n`;
            for (const task of phase.results) {
                const status = task.error ? '❌' : '✅';
                output += `- ${status} **${task.label}** (${task.toolCalls} tools, ${(task.elapsed / 1000).toFixed(1)}s)\n`;
                if (task.output && task.output.length > 0) {
                    const preview = task.output.substring(0, 300);
                    output += `  > ${preview}${task.output.length > 300 ? '...' : ''}\n`;
                }
            }
            output += '\n';
        }

        return output;
    }

    /**
     * Handle edit_file with preview: send diff to webview, wait for user approval.
     */
    private handleEditPreview(args: Record<string, any>, events: AgentEvents): Promise<string> {
        const fs = require('fs');
        const { isPathSafe, resolvePath } = require('./safety');

        const fullPath = resolvePath(args.path, this.config.workspace);
        const { safe, reason } = isPathSafe(fullPath, this.config.workspace);
        if (!safe) return Promise.resolve(`Safety: ${reason}`);
        if (!fs.existsSync(fullPath)) return Promise.resolve(`File not found: ${args.path}`);

        const content = fs.readFileSync(fullPath, 'utf-8');
        const count = content.split(args.old_text).length - 1;
        if (count === 0) return Promise.resolve('old_text not found. Ensure exact match including whitespace.');

        const previewId = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Send preview to webview
        events.onEditPreview?.(previewId, args.path, args.old_text, args.new_text, count);

        // Return a promise that resolves when user confirms or rejects
        return new Promise<string>((resolve) => {
            this.pendingEdits.set(previewId, {
                previewId,
                path: fullPath,
                oldText: args.old_text,
                newText: args.new_text,
                resolve,
            });
        });
    }

    /**
     * Handle write_file with preview: send content to webview, wait for user approval.
     */
    private handleWritePreview(args: Record<string, any>, events: AgentEvents): Promise<string> {
        const fs = require('fs');
        const { isPathSafe, resolvePath } = require('./safety');

        const fullPath = resolvePath(args.path, this.config.workspace);
        const { safe, reason } = isPathSafe(fullPath, this.config.workspace);
        if (!safe) return Promise.resolve(`Safety: ${reason}`);

        const isCreate = !fs.existsSync(fullPath);

        const previewId = `write_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Send preview to webview
        events.onWritePreview?.(previewId, args.path, args.content, isCreate);

        // Return a promise that resolves when user confirms or rejects
        return new Promise<string>((resolve) => {
            this.pendingWrites.set(previewId, {
                previewId,
                path: fullPath,
                content: args.content,
                resolve,
            });
        });
    }

    /** Handle ask_user tool: show question to user and wait for response */
    private handleAskUser(args: Record<string, any>, events: AgentEvents): Promise<string> {
        const previewId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const question = args.question || '';
        const options = (args.options as string[]) || [];

        events.onAskUser?.(previewId, question, options);

        return new Promise<string>((resolve) => {
            this.pendingAsks.set(previewId, { previewId, resolve });
        });
    }

    private canPauseForUserDecision(conv: ConversationState): boolean {
        return conv.mode === 'polling' || (conv.mode === 'plan' && !conv.planConfirmed);
    }

    private withoutUserPauseTools(tools: typeof TOOL_DEFINITIONS | undefined): typeof TOOL_DEFINITIONS | undefined {
        return tools?.filter(t => t.function.name !== 'ask_user');
    }

    private buildAutonomousAskUserResult(args: Record<string, any>, mode: AgentMode): string {
        const question = String(args.question || '').trim();
        const options = Array.isArray(args.options)
            ? args.options.map((o: any) => String(o)).filter(Boolean)
            : [];
        const optionText = options.length > 0 ? ` Options: ${options.join(' | ')}.` : '';
        return [
            `User interruption is disabled in ${mode} mode.`,
            question ? `Question the model tried to ask: ${question}` : '',
            optionText,
            'Make the best autonomous decision now. Prefer the safest reversible option that satisfies the user request, document the assumption, continue execution, and do not call ask_user again for this branch.',
        ].filter(Boolean).join('\n');
    }

    /** Confirm or reject a pending write preview */
    confirmWrite(previewId: string, approved: boolean, newPath?: string): void {
        const pending = this.pendingWrites.get(previewId);
        if (!pending) return;
        this.pendingWrites.delete(previewId);

        const path = require('path');
        const { isPathSafe, resolvePath } = require('./safety');
        const targetPath = newPath ? resolvePath(newPath, this.config.workspace) : pending.path;
        const { safe, reason } = isPathSafe(targetPath, this.config.workspace);
        if (!safe) {
            pending.resolve(`Safety: ${reason}`);
            return;
        }

        if (approved) {
            const fs = require('fs');
            try {
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(targetPath, pending.content, 'utf-8');
                pending.resolve(`Written to ${targetPath} (approved by user)`);
            } catch (e: any) {
                pending.resolve(`Write failed: ${e.message}`);
            }
        } else {
            pending.resolve('Write rejected by user');
        }
    }

    /** Answer a pending ask_user question */
    confirmAskUser(previewId: string, answer: string): void {
        const pending = this.pendingAsks.get(previewId);
        if (!pending) return;
        this.pendingAsks.delete(previewId);
        pending.resolve(answer);
    }

    // ── Abort (per-conversation) ──

    /** Abort a specific conversation, or all if no convId given */
    abort(convId?: string): void {
        if (convId) {
            this.stoppingConversations.add(convId);
            const ac = this.abortControllers.get(convId);
            if (ac) { ac.abort(); this.abortControllers.delete(convId); }
        } else {
            for (const [id] of this.abortControllers) this.stoppingConversations.add(id);
            for (const [, ac] of this.abortControllers) ac.abort();
            this.abortControllers.clear();
        }
    }

    /** Fast check: should this conversation stop? (signal OR explicit stop) */
    private isStopping(convId: string, signal?: AbortSignal): boolean {
        return signal?.aborted === true || this.stoppingConversations.has(convId);
    }

    /**
     * Detect if reasoning text contains a repeated loop pattern.
     * Uses a multi-phase approach with progressively more aggressive detection:
     * 1. Strip known prefixes → detect short repeating phrases (the most common loop type)
     * 2. N-gram extraction → find the most repeated substring of any length
     * 3. Raw text fallback → strict check on unstripped text
     */
    private detectReasoningLoop(text: string): { detected: boolean; count: number } {
        const MIN_REPEATS = 5; // Higher threshold to avoid false positives on normal reasoning patterns
        const MIN_TEXT_LEN = 300; // Don't check very short reasoning

        if (text.length < MIN_TEXT_LEN) return { detected: false, count: 0 };

        // Phase 1: Strip known persona/intent prefixes and detect short repeating phrases
        // e.g. "[意图: code_task] 需要工具 — Proceed with tools 让我看第一个结果"
        // After stripping, the real action description (unique per round) remains.
        const cleaned = text.replace(
            /\[(?:Role|意图|Context)[^\]]*\]\s*/g, ''
        ).replace(
            /Proceed with tools[\s—-]*/g, ''
        ).replace(
            /需要工具[\s—-]*/g, ''
        ).replace(
            /让我[看查检]?\S{0,8}[，。.]\s*/g, ''
        ).replace(
            /现在[让我]?\S{0,8}[，。.]\s*/g, ''
        ).replace(
            /\s+/g, ' '
        ).trim();

        // Try multiple pattern lengths: shorter patterns catch more loop types
        for (const patLen of [20, 30, 40, 60]) {
            if (cleaned.length < patLen * MIN_REPEATS) continue;
            const pattern = cleaned.slice(-patLen);
            // Skip if pattern is mostly whitespace/punctuation
            if (/^[\s—\-.:,;!?]+$/.test(pattern)) continue;
            // Scan a wide window (up to 3000 chars back)
            const scanStart = Math.max(0, cleaned.length - 3000);
            const region = cleaned.slice(scanStart, cleaned.length - patLen);
            let count = 0;
            let pos = 0;
            while ((pos = region.indexOf(pattern, pos)) !== -1) {
                count++;
                pos += patLen;
            }
            if (count >= MIN_REPEATS) {
                return { detected: true, count: count + 1 };
            }
        }

        // Phase 2: N-gram extraction — find the most repeated substring of any length
        // This catches loops that don't match a fixed pattern length
        if (cleaned.length >= 400) {
            const bestRepeat = this.findMostRepeatedSubstring(cleaned);
            if (bestRepeat && bestRepeat.count >= MIN_REPEATS && bestRepeat.length >= 20) {
                return { detected: true, count: bestRepeat.count };
            }
        }

        // Phase 3: Raw text fallback — very strict check on unstripped text
        if (text.length >= 600) {
            const rawPat = text.slice(-50);
            if (rawPat.length >= 50) {
                const rawStart = Math.max(0, text.length - 2000);
                const rawRegion = text.slice(rawStart, text.length - 50);
                let rawCount = 0;
                let rawPos = 0;
                while ((rawPos = rawRegion.indexOf(rawPat, rawPos)) !== -1) {
                    rawCount++;
                    rawPos += 50;
                }
                if (rawCount >= 8) {
                    return { detected: true, count: rawCount + 1 };
                }
            }
        }

        return { detected: false, count: 0 };
    }

    /**
     * Find the most frequently repeated substring in text.
     * Uses sliding window with short-to-long pattern extraction.
     * Returns the pattern with the highest repetition count (min length 15).
     */
    private findMostRepeatedSubstring(text: string): { pattern: string; count: number; length: number } | null {
        let bestPattern = '';
        let bestCount = 0;

        // Try pattern lengths from short to long
        for (let patLen = 15; patLen <= 60; patLen += 5) {
            if (text.length < patLen * 4) break;

            // Sample positions: last N chars as potential patterns
            const sampleCount = Math.min(5, Math.floor(text.length / patLen));
            for (let s = 0; s < sampleCount; s++) {
                const endPos = text.length - s * patLen;
                const pattern = text.slice(endPos - patLen, endPos);
                if (/^[\s—\-.:,;!?]+$/.test(pattern)) continue;

                // Count occurrences in the full text
                let count = 0;
                let pos = 0;
                while ((pos = text.indexOf(pattern, pos)) !== -1) {
                    count++;
                    pos += patLen;
                }

                if (count > bestCount) {
                    bestCount = count;
                    bestPattern = pattern;
                }
            }
        }

        return bestPattern ? { pattern: bestPattern, count: bestCount, length: bestPattern.length } : null;
    }

    /** Mark a conversation's agent as finished */
    private finishChat(convId?: string): void {
        const id = convId || this.activeId;
        if (id) {
            this.abortControllers.delete(id);
            this.stoppingConversations.delete(id);
            // Reset planConfirmed so next message in plan mode triggers a new plan
            const conv = this.conversations.get(id);
            if (conv?.mode === 'plan' && conv.planConfirmed) {
                conv.planConfirmed = false;
                this.saveConversations();
            }
        }
    }

    /** Check if ANY conversation is running */
    isRunning(): boolean {
        return this.abortControllers.size > 0;
    }

    /** Check if a specific conversation is running */
    isConvRunning(convId: string): boolean {
        return this.abortControllers.has(convId);
    }

    getTokenTracker(): TokenTracker {
        return this.tokenTracker;
    }

    // ── Chat ──

    /**
     * Check if input is repeated (same input sent multiple times in short period).
     */
    private isRepeatedInput(input: string, convId: string): boolean {
        const key = `${convId}:${input.trim().toLowerCase()}`;
        const now = Date.now();
        const prev = this.recentInputs.get(key);

        if (prev && now - prev.lastTime < 60_000) { // Within 1 minute
            prev.count++;
            prev.lastTime = now;
            if (prev.count >= 3) return true; // 3+ times = repeated
        } else {
            this.recentInputs.set(key, { count: 1, lastTime: now });
        }

        // Clean up expired records
        for (const [k, v] of this.recentInputs) {
            if (now - v.lastTime > 300_000) this.recentInputs.delete(k); // 5 min expiry
        }

        return false;
    }

    async chat(userInput: string, events: AgentEvents, images?: Array<{dataUrl: string; name: string; size: number}>, conversationId?: string, skillPrompt?: string): Promise<string> {
        const convId = conversationId || this.activeId;
        const conv = this.conversations.get(convId);
        if (!conv) {
            events.onDone('No active conversation');
            events.onError('No active conversation');
            return 'No active conversation';
        }

        // ── Input boundary checks ──

        // 1. Empty / whitespace-only input
        if (!userInput || /^\s*$/.test(userInput)) {
            events.onToken('请输入您的问题。');
            events.onDone('请输入您的问题。');
            return '请输入您的问题。';
        }

        // 2. Repeated input detection
        if (this.isRepeatedInput(userInput, convId)) {
            const msg = '您已多次发送相同问题。如果您对之前的回答不满意，请尝试换个方式描述，或指出具体哪里有问题。';
            events.onToken(msg);
            events.onDone(msg);
            return msg;
        }

        // 3. Long input truncation
        let processedInput = userInput;
        if (userInput.length > MiMoAgent.MAX_INPUT_LENGTH) {
            const truncated = userInput.substring(0, MiMoAgent.MAX_INPUT_LENGTH);
            const warning = `\n\n⚠️ 输入过长（${userInput.length} 字符），已截断至 ${MiMoAgent.MAX_INPUT_LENGTH} 字符。如需处理完整内容，请分段发送或将文件路径传给 read_file 工具。`;
            processedInput = truncated + warning;
            events.onReasoning(`[Input truncated: ${userInput.length} → ${MiMoAgent.MAX_INPUT_LENGTH} chars]`);
        }

        // 4. Concurrent send prevention
        if (this.activeChats.has(convId)) {
            events.onToken('上一条消息正在处理中，请等待完成后再发送。');
            events.onDone('上一条消息正在处理中，请等待完成后再发送。');
            return '上一条消息正在处理中，请等待完成后再发送。';
        }

        // Wrap chat execution in activeChats tracking
        const chatPromise = this.doChat(processedInput, conv, events, images, convId, skillPrompt);
        this.activeChats.set(convId, chatPromise);

        try {
            return await chatPromise;
        } finally {
            this.activeChats.delete(convId);
        }
    }

    /**
     * Internal chat implementation (called by chat() after input validation).
     */
    private async doChat(
        userInput: string,
        conv: ConversationState,
        events: AgentEvents,
        images?: Array<{dataUrl: string; name: string; size: number}>,
        convId?: string,
        skillPrompt?: string,
    ): Promise<string> {
        const effectiveConvId = convId || this.activeId;

        // Wrap events.onReasoning to collect system annotations for history replay
        const _origReasoning = events.onReasoning.bind(events);
        const _systemAnnotations: string[] = [];
        events.onReasoning = (token: string) => {
            if (token.startsWith('[')) _systemAnnotations.push(token);
            _origReasoning(token);
        };

        // Reload system prompt each turn — picks up MIMO.md changes without restart
        this.systemPrompt = buildSystemPrompt(this.config.workspace);
        this.personalizedInstructions = loadInstructions(this.config.workspace);

        // Validate personalized instructions and warn user about issues
        if (this.personalizedInstructions) {
            const validation = validateInstructions(this.personalizedInstructions);
            if (validation.errors.length > 0) {
                events.onReasoning(`[⚠️ 指令问题] ${validation.errors.join(' | ')}`);
            }
            if (validation.warnings.length > 0) {
                events.onReasoning(`[⚠️ 指令警告] ${validation.warnings.join(' | ')}`);
            }
        }

        // Persist skill prompt in conversation state for follow-up turns
        if (skillPrompt) {
            conv.activeSkillPrompt = skillPrompt;
        }

        if (!this.config.apiKey) {
            const errorMsg = 'API key is not configured. Set "mimo.apiKey" in VS Code settings, set MIMO_API_KEY, or add api.api_key to ~/.mimo/settings.json.';
            events.onDone(errorMsg);
            events.onError(errorMsg);
            return errorMsg;
        }

        // Auto-fallback: if images are sent with a non-vision model, switch to a configured vision model.
        if (images && images.length > 0) {
            const caps = this.getModelCapabilities(conv.model);
            if (!caps.vision) {
                const fallbackModel = this.findVisionModel(conv.model);
                if (!fallbackModel) {
                    const msg = `Current model "${conv.model}" is not known to support images. Add a vision-capable model to settings (api.models) or switch models before sending images.`;
                    events.onDone(msg);
                    events.onError(msg);
                    return msg;
                }
                const oldModel = conv.model;
                conv.model = fallbackModel;
                events.onReasoning(`[Auto-switched model: ${oldModel} -> ${fallbackModel} for image support]`);
                events.onStatus(`Model auto-switched to ${fallbackModel} for vision`);
                events.onModelSwitched?.(fallbackModel);
                this.saveConversations();
            }
        }


        // Adversarial mode: dual-brain execution
        if (conv.mode === 'adversarial') {
            return this.adversarialChat(userInput, events, images, effectiveConvId);
        }

        // Build user message content (with optional images)
        let userContent: string | ContentPart[];
        if (images && images.length > 0) {
            userContent = [{ type: 'text', text: userInput }];
            for (const img of images) {
                userContent.push({ type: 'image_url', image_url: { url: img.dataUrl } });
            }
        } else {
            userContent = userInput;
        }
        console.log(`[MiMo chat] Starting: convId=${effectiveConvId}, existing messages=${conv.messages.length}`);
        // Clear any stale stopping state from a previous run
        this.stoppingConversations.delete(effectiveConvId);
        conv.messages.push({ role: 'user', content: userContent });
        const abortController = new AbortController();
        this.abortControllers.set(effectiveConvId, abortController);
        const signal = abortController.signal;

        // ── Greeting / trivial input detection: shortcuts for all modes ──
        // Run BEFORE persona detection to avoid wasting CPU on trivial inputs
        const _input = userInput.trim();
        const _lower = _input.toLowerCase();
        const PURE_GREETINGS = ['hi', 'hello', 'hey', '你好', '嗨', '哈喽', 'ok', '好的', '嗯', '收到', '谢谢', 'thx', 'thanks'];
        const isTrivial =
            PURE_GREETINGS.includes(_lower) ||                          // exact greeting match
            _input.length <= 3 ||                                       // very short: "?", "？", "hi!", "ok"
            /^[!?！？。，、.\-~～…]+$/.test(_input) ||                  // pure punctuation
            /^[\p{Emoji}\s]+$/u.test(_input);                           // pure emoji
        if (isTrivial) {
            return this.handleDirectResponse(userInput, conv, events, signal, effectiveConvId);
        }

        // Detect expert persona with conversation-level persistence
        // Strategy: re-detect each turn. If no strong signal, keep the previous persona.
        // Detect persona: always allow specific triggers (debug, review, architecture, refactor)
        // Only skip persisted persona fallback for generic analytical tasks
        const isComplexOrAnalytical = /分析|对比|差距|比较|评估|评价/i.test(userInput);
        let persona = detectPersona(userInput);
        if (persona) {
            // New strong signal → switch persona and persist
            conv.personaId = persona.id;
            events.onReasoning(`[Role: ${persona.icon} ${persona.nameZh}]`);
        } else if (!isComplexOrAnalytical && conv.personaId) {
            // No strong signal → fall back to persisted persona from earlier turn
            // (skip if input is complex/analytical — don't distract the model)
            const persisted = getPersona(conv.personaId);
            if (persisted) {
                persona = persisted;
                events.onReasoning(`[Role: ${persisted.icon} ${persisted.nameZh} (continued)]`);
            }
        }

        // ── Intent Router: classify before tool loop (Auto mode only) ──
        // Plan/Polling/Adversarial modes skip routing — user already chose the mode.
        let taskComplexity: 'simple' | 'moderate' | 'complex' = 'moderate';
        try {
            if (conv.mode === 'auto') {
                events.onStatus('分析意图...');
                const quickIntent = quickClassifyIntent(userInput);
                const intent = quickIntent || await classifyIntent(this.api, userInput, conv.model, signal);
                events.onReasoning(`[意图: ${intent.category}] ${intent.needsTools ? '需要工具' : '直接回答'} — ${intent.plan}`);

                if (intent.source === 'heuristic') {
                    events.onReasoning('[Router] Used local fast-path classification');
                }

                // Capture complexity for dynamic round budget
                if (intent.complexity) {
                    taskComplexity = intent.complexity;
                }

                // Apply router's suggested persona
                // Priority: router's LLM suggestion > keyword detection
                // (router uses full LLM context analysis, keyword is just substring matching)
                if (intent.suggestedPersona) {
                    const suggested = getPersona(intent.suggestedPersona);
                    if (suggested) {
                        if (!persona) {
                            // No keyword match — use router's suggestion
                            persona = suggested;
                            conv.personaId = suggested.id;
                            events.onReasoning(`[Role: ${suggested.icon} ${suggested.nameZh} (suggested)]`);
                        } else if (persona.id !== suggested.id) {
                            // Keyword and router disagree — prefer router (LLM is more accurate)
                            persona = suggested;
                            conv.personaId = suggested.id;
                            events.onReasoning(`[Role: ${suggested.icon} ${suggested.nameZh} (router override)]`);
                        }
                        // If they agree, keep the keyword-detected persona (no change)
                    }
                }

                // If no tools needed: simple text-only response (with persona)
                if (!intent.needsTools) {
                    return this.handleDirectResponse(userInput, conv, events, signal, effectiveConvId, persona);
                }
            }
        } catch (e: any) {
            // Ensure cleanup on classifyIntent or handleDirectResponse exception
            if (this.isStopping(effectiveConvId, signal)) {
                events.onDone('(stopped by user)');
            } else {
                events.onDone(`Error: ${e.message}`);
                events.onError(e.message);
            }
            this.finishChat(effectiveConvId);
            return `(error: ${e.message})`;
        }

        // Use the user-visible Max Rounds setting as the actual stop line.
        // Complexity is still reported, but it must not silently override the setting.
        const COMPLEXITY_ROUNDS = { simple: 10, moderate: 30, complex: 50 };
        const configuredMaxRounds = Math.max(1, Math.floor(this.config.maxRounds || 100));
        const suggestedRounds = COMPLEXITY_ROUNDS[taskComplexity] || 30;
        const MAX_ROUNDS = configuredMaxRounds;
        if (taskComplexity !== 'moderate') {
            events.onReasoning(`[Complexity: ${taskComplexity}; suggested ${suggestedRounds}, max ${MAX_ROUNDS} rounds]`);
        } else {
            events.onReasoning(`[Round budget: max ${MAX_ROUNDS} rounds]`);
        }
        const ROUND_TIMEOUT_MS = 90_000; // 90 seconds per round max
        let reasoningLoopCount = 0; // Track consecutive reasoning loops
        let consecutiveRateRetries = 0;

        for (let round = 1; round <= MAX_ROUNDS; round++) {
            if (this.isStopping(effectiveConvId, signal)) {
                events.onDone('(stopped by user)');
                this.finishChat(effectiveConvId);
                return '(stopped by user)';
            }
            const roundStartTime = Date.now();
            events.onRoundStart(round);
            events.onStatus(`Processing round ${round}...`);

            let systemContent = persona
                ? buildPersonaPrompt(this.systemPrompt, persona)
                : this.systemPrompt;

            // Inject active skill prompt into system content (not user message)
            if (conv.activeSkillPrompt) {
                systemContent += `\n\n## Active Skill\n${conv.activeSkillPrompt}`;
            }
            let toolChoice: string | undefined = 'auto';
            let tools: typeof TOOL_DEFINITIONS | undefined = TOOL_DEFINITIONS;

            // Merge MCP tools with built-in tools
            const mcpTools = this.mcpManager.getAllToolDefinitions();
            if (mcpTools.length > 0) {
                tools = [...(tools || []), ...mcpTools];
            }

            // Plan mode: skip plan for greetings / simple chat — respond directly
            if (conv.mode === 'plan' && !conv.planConfirmed) {
                const _trimmed = userInput.trim().toLowerCase();
                const GREETINGS = ['hi', 'hello', 'hey', '你好', '嗨', '哈喽', 'ok', '好的', '嗯', '收到', '谢谢', 'thx', 'thanks'];
                if (GREETINGS.includes(_trimmed) || userInput.trim().length <= 5) {
                    return this.handleDirectResponse(userInput, conv, events, signal, effectiveConvId, persona);
                }
            }

            if (conv.mode === 'plan' && !conv.planConfirmed) {
                // Plan mode, phase 1: Analyze + output plan, read-only + web search tools
                tools = TOOL_DEFINITIONS.filter(t =>
                    ['read_file', 'search_files', 'glob_files', 'list_directory',
                     'get_file_info', 'git_status', 'git_diff', 'git_log',
                     'web_search', 'fetch_url', 'ask_user'].includes(t.function.name)
                );
                toolChoice = 'auto';
                systemContent += `\n\n[Mode: Plan — 分析阶段]
你正在"规划模式"下工作。当前是第一阶段：分析需求并制定计划。

你的任务：
1. 使用只读工具（读取文件、搜索、查看目录）了解代码库现状
2. 仔细分析用户的需求（表面需求 vs 真实目标）
3. 制定详细的执行计划
4. 以结构化的 markdown 格式输出你的计划

计划格式：
## 需求分析
（用户想要什么，关键约束，验收标准）

## 实现方案
（具体怎么做，分步骤列出，每步预估工作量）

## 涉及文件
（要修改/创建哪些文件，每个文件要做什么改动）

## 风险与对策
（可能遇到的问题，如何规避）

## 预期结果
（完成后是什么样子，如何验证）

⚠️ 输出计划后立即停止。不要修改任何文件，不要开始执行。
系统会自动将你的计划保存到 .mimo/plans/ 目录中。

💡 当你遇到以下情况时，使用 ask_user 工具向用户确认：
- 需求有多种理解方式
- 存在多种实现方案需要用户选择
- 涉及技术选型需要用户决策`;
            } else if (conv.mode === 'plan' && conv.planConfirmed) {
                // Plan mode, phase 2: Execute the plan
                systemContent += `\n\n[Mode: Plan — 执行阶段]
用户已确认计划。现在按照计划执行。

执行原则：
- 严格按照计划中的步骤逐一完成，不要偏离计划
- 每完成一步，简要报告进度
- 如果发现计划中有问题，暂停并说明原因
- 修改后立即验证（语法检查、测试）`;
            } else if (conv.mode === 'polling') {
                systemContent += `\n\n[Mode: Polling] 轮询模式 — 自主执行，但保持透明。

执行原则：
- 每完成一个逻辑步骤，输出进度（不需要用户确认）
- 文件编辑会显示预览供用户审核
- 遇到需要用户决策的分支点时，使用 ask_user 工具暂停并询问
- 最终输出完整的工作报告（改了什么、为什么、验证结果）`;
            } else {
                // Auto mode (default)
                systemContent += `\n\n[Mode: Auto] 自动模式 — 高效执行。

节奏：理解 → 实现 → 验证 → 总结
- 快速理解需求（读 1-3 个关键文件）
- 直接动手实现（不要过度规划）
- 每步验证（改完就测）
- 简洁总结（说了就停）
每个阶段不超过 2 轮工具调用。`;
            }

            if (!this.canPauseForUserDecision(conv)) {
                tools = this.withoutUserPauseTools(tools);
                systemContent += `\n\n[Autonomous decision policy]
Do not ask the user for clarification or confirmation during this run. If a choice is needed, infer intent from the request, repository context, and recent conversation. Choose the safest reversible path that best satisfies the user, state the assumption briefly, continue execution, and verify the result.`;
            }

            // Apply context management: smart summarization when context is high, else sliding window
            const preStats = getContextStats(conv.messages, conv.model);
            let managedMessages: ChatMessage[];
            if (preStats.percent > 65) {
                events.onReasoning(`[Context: ${preStats.percent}% — compressing with summarization...]`);
                managedMessages = await summarizeContext(conv.messages, this.api, conv.model, {}, signal);
            } else {
                managedMessages = manageContext(conv.messages, conv.model);
            }

            // Safety: if still over budget after compression, force sliding window
            const postStats = getContextStats(managedMessages, conv.model);
            if (postStats.percent > 90) {
                events.onReasoning(`[Context: ${postStats.percent}% — still over budget, applying sliding window...]`);
                managedMessages = manageContext(managedMessages, conv.model);
            }

            const params: Record<string, any> = this.buildChatParams(conv.model, [
                { role: 'system' as const, content: systemContent },
                ...managedMessages,
            ]);

            // Log context usage
            const stats = getContextStats(managedMessages, conv.model);
            if (stats.percent > 70) {
                events.onReasoning(`[Context: ${stats.percent}% used (~${stats.used}/${stats.total} tokens)]`);
            }
            if (tools) params.tools = tools;
            if (toolChoice) params.tool_choice = toolChoice;

            let content: string;
            let toolCalls: ToolCall[];
            let reasoningContent = '';
            let reasoningBuffer = '';
            let lastDetectionLen = 0; // throttle: only re-check every 300+ chars
            let reasoningLoopDetected = false; // guard: prevent multiple abort triggers
            let loopAbortController: AbortController | null = null;
            try {
                loopAbortController = new AbortController();
                signal.addEventListener('abort', () => loopAbortController?.abort(), { once: true });
                const result = await this.api.chatCompletionsStream(params, {
                    onToken: (t) => events.onToken(t),
                    onReasoning: (t) => {
                        // Guard: stop processing after loop detection to avoid duplicate triggers
                        if (reasoningLoopDetected) return;

                        reasoningContent += t;
                        reasoningBuffer += t;

                        // Reasoning loop detection: throttled to every 200+ chars
                        // Lower threshold catches loops faster before they waste tokens
                        if (reasoningContent.length - lastDetectionLen > 200 && reasoningContent.length > 300) {
                            lastDetectionLen = reasoningContent.length;
                            const loop = this.detectReasoningLoop(reasoningContent);
                            if (loop.detected) {
                                reasoningLoopDetected = true;
                                loopAbortController?.abort();
                                events.onReasoning(`\n\n⚠️ 检测到推理循环（重复 ${loop.count} 次），已自动中断。`);
                                reasoningBuffer = '';
                                return;
                            }
                        }

                        // Only emit reasoning in chunks, not every token
                        if (reasoningBuffer.length > 50) {
                            events.onReasoning(reasoningBuffer);
                            reasoningBuffer = '';
                        }
                    },
                }, loopAbortController.signal);
                // Flush remaining reasoning buffer
                if (reasoningBuffer) {
                    events.onReasoning(reasoningBuffer);
                    reasoningBuffer = '';
                }
                content = result.content;
                toolCalls = result.toolCalls;
                if (result.reasoningContent) {
                    reasoningContent = result.reasoningContent;
                }
                // Track token usage (API usage or estimate)
                if (result.usage) {
                    const callRecord = {
                        id: `call_${Date.now()}`,
                        convId: this.activeId,
                        model: conv.model,
                        round,
                        usage: result.usage,
                        timestamp: Date.now(),
                        elapsed: 0,
                    };
                    this.tokenTracker.addCall(callRecord);
                    recordTokenUsage(result.usage);
                    events.onTokenUsage?.(result.usage);
                } else {
                    // Fallback: estimate tokens when API doesn't return usage
                    const estTokens = Math.ceil(((content || '').length + reasoningContent.length) / 3);
                    if (estTokens > 0) {
                        events.onTokenUsage?.({ promptTokens: 0, completionTokens: estTokens, totalTokens: estTokens });
                    }
                }
            } catch (e: any) {
                // Reasoning loop detected — inject guidance and retry
                if (reasoningLoopDetected) {
                    this.clearInternalStop(effectiveConvId);
                    reasoningLoopCount++;

                    // Remove incomplete assistant message if it was pushed (safety check)
                    const lastMsg = conv.messages[conv.messages.length - 1];
                    if (lastMsg?.role === 'assistant' && !lastMsg.content && !lastMsg.tool_calls) {
                        conv.messages.pop();
                    }

                    // 第一次循环：注入强引导，告诉模型立即执行
                    if (reasoningLoopCount === 1) {
                        conv.messages.push({
                            role: 'system',
                            content: '[紧急指令] 检测到推理循环。立即停止重新规划！基于当前工作区状态，直接输出最终结果或执行一个具体工具调用。不要解释，不要分析，直接行动。',
                        } as any);
                        events.onReasoning(`\n\n[Recovery] Reasoning loop detected once. Injected execute-now guidance.`);
                        round--; // Re-run this round
                        continue;
                    }

                    // 第二次循环：保存工作状态，新建模型调用继续
                    if (reasoningLoopCount === 2) {
                        events.onReasoning(`\n\n[Recovery] Reasoning loop repeated. Switching to a fresh model call.`);

                        // 保存当前已完成的工作摘要
                        const progressSummary = this.buildProgressSummary(conv, 'loop recovery - switching to fresh model', {
                            round,
                            maxRounds: MAX_ROUNDS,
                        });

                        // 新建一个独立的模型调用来继续任务
                        const continuationResult = await this.continueWithFreshModel(
                            conv,
                            progressSummary,
                            events,
                        );

                        if (continuationResult) {
                            conv.messages.push({
                                role: 'assistant',
                                content: continuationResult,
                            });
                            events.onToken(continuationResult);
                            events.onDone(`(recovered from reasoning loop)`);
                            this.finishChat(effectiveConvId);
                            return continuationResult;
                        }

                        // 如果新模型调用也失败，输出进度总结
                        events.onReasoning(`\n\n[Recovery] Fresh model call failed. Returning current progress summary.`);
                        const fallback = this.buildProgressSummary(conv, 'loop recovery failed', {
                            round,
                            maxRounds: MAX_ROUNDS,
                        });
                        events.onDone(fallback);
                        this.finishChat(effectiveConvId);
                        return fallback;
                    }

                    // 第三次及以上循环：强制退出
                    events.onReasoning(`\n\n[Recovery] Reasoning loop repeated ${reasoningLoopCount} times. Returning current progress summary.`);
                    const fallback = this.buildProgressSummary(conv, 'reasoning loop detected repeatedly', {
                        round,
                        maxRounds: MAX_ROUNDS,
                    });
                    events.onDone(fallback);
                    this.finishChat(effectiveConvId);
                    return fallback;
                }
                if (this.isStopping(effectiveConvId, signal)) {
                    events.onDone('(stopped by user)');
                    this.finishChat(effectiveConvId);
                    return '(stopped by user)';
                }
                // 429 rate limit — wait and retry (max 3 times per round)
                if (e.message?.includes('429')) {
                    consecutiveRateRetries++;
                    if (consecutiveRateRetries > 3) {
                        const summary = this.buildProgressSummary(conv, 'rate limited too many times', {
                            round,
                            maxRounds: MAX_ROUNDS,
                        });
                        events.onDone(summary);
                        events.onError('Rate limited');
                        this.finishChat(effectiveConvId);
                        return summary;
                    }
                    const waitSec = 5 * consecutiveRateRetries;
                    events.onReasoning(`[Rate limited, waiting ${waitSec}s...]`);
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                    round--; // Repeat this round
                    continue;
                }
                // Don't retry if user clicked stop
                if (this.isStopping(effectiveConvId, signal)) {
                    events.onDone('(stopped by user)');
                    this.finishChat(effectiveConvId);
                    return '(stopped by user)';
                }
                // Context overflow — try aggressive compression
                if (e.message?.includes('context') || e.message?.includes('too long') || e.message?.includes('max_tokens') || e.message?.includes('400')) {
                    events.onReasoning(`[上下文溢出，正在压缩...]`);
                    // Aggressively compress: keep only last 10 messages
                    if (conv.messages.length > 15) {
                        const firstUser = conv.messages.findIndex(m => m.role === 'user');
                        const recent = conv.messages.slice(-10);
                        conv.messages = [
                            ...(firstUser >= 0 ? [conv.messages[firstUser]] : []),
                            { role: 'system', content: '[Earlier conversation compressed to save context]' } as any,
                            ...recent,
                        ];
                        round--; // Retry this round with compressed context
                        continue;
                    }
                }
                // Model access error — suggest switching model
                if (e.message?.includes('400') && (e.message?.includes('not exist') || e.message?.includes('not have access') || e.message?.includes('may not'))) {
                    const configured = this.getModelList().join(', ');
                    const hint = `Current model: ${conv.model}. Check that this model exists on the configured baseUrl, that the API key has access, and that api.models is configured correctly. Available configured models: ${configured || '(none)'}.`;
                    const summary = `${this.buildProgressSummary(conv, 'model access or compatibility error', {
                        round,
                        maxRounds: MAX_ROUNDS,
                    })}
Model error: ${hint}`;
                    events.onDone(summary);
                    events.onError(`Model error: ${hint}`);
                    conv.messages.pop();
                    this.finishChat(effectiveConvId);
                    return summary;
                }
                const friendlyError = getFriendlyError(e);
                const summary = `${this.buildProgressSummary(conv, 'task interrupted by API or runtime error', {
                    round,
                    maxRounds: MAX_ROUNDS,
                })}
${friendlyError}`;
                events.onDone(summary);
                events.onError(e.message);
                conv.messages.pop();
                this.finishChat(effectiveConvId);
                return summary;
            }

            consecutiveRateRetries = 0;
            const assistantMsg: ChatMessage = { role: 'assistant', content };
            // Some OpenAI-compatible APIs require reasoning_content to be present
            // when tool_calls exist, even if it is empty.
            // Prepend system annotations so they're preserved in history replay
            const annotations = _systemAnnotations.length > 0 ? _systemAnnotations.join('\n') + '\n' : '';
            assistantMsg.reasoning_content = annotations + (reasoningContent || '');
            if (toolCalls.length > 0) {
                assistantMsg.tool_calls = toolCalls;
                // When tool_calls exist, content should be null (not empty string)
                // to match the model's actual response format and avoid API 400 errors.
                if (!content) {
                    assistantMsg.content = null as any;
                }
            }
            conv.messages.push(assistantMsg);
            this.saveConversations();

            if (toolCalls.length === 0) {
                // Fallback: if API returned reasoning but no content, use reasoning as response
                // This handles models that only generate thinking tokens for simple queries
                reasoningLoopCount = 0;
                const finalResponse = content || reasoningContent || '(no response)';
                events.onDone(finalResponse);
                this.finishChat(effectiveConvId);
                return finalResponse;
            }

            // Per-round timeout check (after API call, before tool execution)
            if (Date.now() - roundStartTime > ROUND_TIMEOUT_MS) {
                events.onReasoning(`\n\n⚠️ Round ${round} timed out after ${((Date.now() - roundStartTime) / 1000).toFixed(0)}s, stopping tools.`);
                break;
            }

            // ── Parallel tool execution: batch read-only tools ──
            const PARALLEL_TOOLS = new Set([
                'read_file', 'search_files', 'glob_files', 'list_directory',
                'get_file_info', 'git_status', 'git_diff', 'git_log',
                'fetch_url', 'web_search', 'git_worktree_list', 'read_notebook',
            ]);
            const MAX_PARALLEL = 6;

            // Build execution plan: group consecutive parallelizable tools
            interface ToolTask { index: number; tc: ToolCall; args: Record<string, any>; parallel: boolean; }
            const tasks: ToolTask[] = toolCalls.map((tc, i) => {
                let args: Record<string, any> = {};
                try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
                const isParallel = PARALLEL_TOOLS.has(tc.function.name)
                    && !this.mcpManager.isMcpTool(tc.function.name);
                    // Note: PARALLEL_TOOLS only contains read-only tools, safe to parallelize even in polling mode.
                    // Mutating tools (edit_file, write_file, delete_file) are never in PARALLEL_TOOLS.
                return { index: i, tc, args, parallel: isParallel };
            });

            // Group into batches
            const batches: ToolTask[][] = [];
            let currentBatch: ToolTask[] = [];
            for (const task of tasks) {
                if (task.parallel) {
                    currentBatch.push(task);
                } else {
                    if (currentBatch.length > 0) { batches.push(currentBatch); currentBatch = []; }
                    batches.push([task]);
                }
            }
            if (currentBatch.length > 0) batches.push(currentBatch);

            // Execute each tool (shared logic)
            const execToolCall = async (task: ToolTask): Promise<{ result: string; elapsed: number }> => {
                const { tc, args } = task;
                const t0 = Date.now();
                let result: string;

                if (tc.function.name === 'spawn_subagent') {
                    result = await this.handleSpawnSubAgent(args, events, signal, effectiveConvId);
                } else if (tc.function.name === 'ask_user') {
                    result = this.canPauseForUserDecision(conv)
                        ? await this.handleAskUser(args, events)
                        : this.buildAutonomousAskUserResult(args, conv.mode);
                } else if (tc.function.name === 'edit_file' && events.onEditPreview && conv.mode === 'polling') {
                    result = await this.handleEditPreview(args, events);
                } else if (tc.function.name === 'write_file' && events.onWritePreview && conv.mode === 'polling') {
                    result = await this.handleWritePreview(args, events);
                } else if (tc.function.name === 'run_workflow') {
                    result = await this.handleWorkflow(args, events, signal, effectiveConvId);
                } else {
                    const preHook = await this.hookManager.runPreHooks(tc.function.name, args, this.config.workspace);
                    if (!preHook.proceed) {
                        result = `Blocked by pre-hook:\n${preHook.output}`;
                    } else {
                        result = this.mcpManager.isMcpTool(tc.function.name)
                            ? await this.mcpManager.callTool(tc.function.name, args)
                            : await executeTool(
                                tc.function.name, args, this.config.workspace,
                                this.config.maxOutputLen, this.config.commandTimeout,
                                this.config.sandbox, conv.mode,
                            );
                        const postHook = await this.hookManager.runPostHooks(tc.function.name, args, result, this.config.workspace);
                        if (postHook.output) result += `\n[Hooks] ${postHook.output}`;
                        if (postHook.shouldBlock) result = `Blocked by post-hook:\n${postHook.output}\n${result}`;
                    }
                }

                // Auto-fallback: if fetch_url fails, retry with Bash curl
                if (tc.function.name === 'fetch_url' && result.startsWith('Tool error:') && args.url) {
                    const url = args.url;
                    // Security: validate URL format — only allow safe URL characters
                    const isValidUrl = /^https?:\/\/[^\s'";`$|&(){}!#]+$/i.test(url);
                    if (isValidUrl) {
                        const curlFlags = url.includes('.pdf') || url.includes('.zip') ? '-L -k' : '-s -L -k';
                        const timeout = this.config.commandTimeout || 15;
                        // Escape for double-quoted string: strip ! and ' which can break bash
                        const safeUrl = url.replace(/[!'"]/g, '');
                        events.onReasoning(`[fetch_url failed, trying Bash curl as fallback]`);
                        const fallbackResult = await executeTool(
                            'execute_command',
                            { command: `curl ${curlFlags} --max-time ${timeout} "${safeUrl}" 2>&1 | head -200` },
                            this.config.workspace,
                            this.config.maxOutputLen,
                            this.config.commandTimeout,
                            this.config.sandbox,
                            conv.mode,
                        );
                        if (!fallbackResult.startsWith('Tool error:')) {
                            result = fallbackResult;
                        }
                    }
                }

                return { result, elapsed: (Date.now() - t0) / 1000 };
            };

            // Execute batches
            const toolResults: string[] = new Array(toolCalls.length);
            const toolElapsedTimes: number[] = new Array(toolCalls.length);
            for (const batch of batches) {
                if (this.isStopping(effectiveConvId, signal)) break;

                // Round timeout: stop executing remaining tool batches if round took too long
                if (Date.now() - roundStartTime > ROUND_TIMEOUT_MS) {
                    events.onReasoning(`\n\n⚠️ Round ${round} tool execution timed out after ${((Date.now() - roundStartTime) / 1000).toFixed(0)}s, skipping remaining tools.`);
                    break;
                }

                if (batch.length > 1) {
                    // Parallel batch: fire all start events immediately
                    for (const task of batch) {
                        events.onToolCallStart(task.tc.function.name, task.args);
                    }
                    events.onStatus(`Executing ${batch.length} tools in parallel...`);

                    // Execute with concurrency cap
                    const queue = [...batch];
                    const results: Array<{ result: string; elapsed: number } | null> = new Array(batch.length).fill(null);

                    const runNext = async (pos: number): Promise<void> => {
                        if (this.isStopping(effectiveConvId, signal)) return;
                        const task = queue[pos];
                        const res = await execToolCall(task);
                        results[pos] = res;
                    };

                    // Simple concurrency limiter
                    const executeAll = async (): Promise<Array<{ result: string; elapsed: number }>> => {
                        const executing: Promise<void>[] = [];
                        for (let i = 0; i < batch.length; i++) {
                            const p = runNext(i).then(() => {
                                executing.splice(executing.indexOf(p), 1);
                            });
                            executing.push(p);
                            if (executing.length >= MAX_PARALLEL) {
                                await Promise.race(executing);
                            }
                        }
                        await Promise.all(executing);
                        return results as Array<{ result: string; elapsed: number }>;
                    };

                    const settled = await executeAll();

                    // Fire end events and store results in original order
                    for (let j = 0; j < batch.length; j++) {
                        const task = batch[j];
                        const res = settled[j];
                        const isError = res.result.startsWith('Safety:') || res.result.startsWith('Tool error:') || res.result.startsWith('Unknown tool') || res.result.startsWith('Blocked by');
                        events.onToolCallEnd(task.tc.function.name, res.result, isError, res.elapsed);
                        toolResults[task.index] = res.result;
                        toolElapsedTimes[task.index] = res.elapsed;
                    }
                } else {
                    // Sequential: single tool
                    if (this.isStopping(effectiveConvId, signal)) break;
                    const task = batch[0];
                    events.onToolCallStart(task.tc.function.name, task.args);
                    events.onStatus(`Executing ${task.tc.function.name}...`);

                    const { result, elapsed } = await execToolCall(task);
                    const isError = result.startsWith('Safety:') || result.startsWith('Tool error:') || result.startsWith('Unknown tool') || result.startsWith('Blocked by');
                    events.onToolCallEnd(task.tc.function.name, result, isError, elapsed);
                    toolResults[task.index] = result;
                    toolElapsedTimes[task.index] = elapsed;
                }
            }

            // Push all results in original order (with replay metadata)
            for (let i = 0; i < toolCalls.length; i++) {
                conv.messages.push({
                    role: 'tool',
                    tool_call_id: toolCalls[i].id,
                    content: toolResults[i] || '(aborted)',
                    _toolName: toolCalls[i].function.name,
                    _toolElapsed: toolElapsedTimes[i] || 0,
                });
            }
            this.saveConversations();
            reasoningLoopCount = 0;
        }

        // MAX_ROUNDS reached — produce a usable handoff instead of a bare stop.
        const progressSummary = this.buildProgressSummary(conv, 'maximum round budget reached', {
            round: MAX_ROUNDS,
            maxRounds: MAX_ROUNDS,
        });
        const finalSummary = await this.finalizeWithFreshModel(conv, progressSummary, events, signal);
        const summary = finalSummary || progressSummary;
        conv.messages.push({ role: 'assistant', content: summary });
        this.saveConversations();
        events.onToken(summary);
        events.onDone(summary);
        events.onError(`Stopped after ${MAX_ROUNDS} rounds — task may be incomplete`);
        this.finishChat(effectiveConvId);
        return summary;
    }

    // ── Input Preprocessing ──

    /**
     * Preprocess user input: fix typos, clarify intent, generate structured prompt.
     * Uses a lightweight call to the model with a preprocessing system prompt.
     */
    async preprocessInput(rawInput: string): Promise<string> {
        // Skip preprocessing for very short or slash commands
        if (rawInput.length < 5 || rawInput.startsWith('/')) return rawInput;

        const preprocessPrompt = `You are a prompt optimizer. The user's input may contain typos, unclear logic, or incomplete instructions.
Your job: rewrite it into a clear, structured, actionable prompt for a coding assistant.

Rules:
1. Fix typos and grammar (保持原始语言，不要翻译)
2. If the intent is ambiguous, rewrite with the MOST LIKELY interpretation
3. If a technical term is misspelled, correct it (e.g., "reacr" → "React")
4. If the request is vague ("fix this"), add the most likely specifics based on context
5. If the request contains multiple steps, structure them clearly
6. If the request references something not specified, add a placeholder like "[请指定具体文件]"
7. NEVER change the user's intent — only clarify it
8. If the input is already clear and well-structured, return it unchanged
9. Output ONLY the optimized prompt, nothing else

User input:
${rawInput}`;

        try {
            const result = await this.api.chatCompletionsStream({
                model: this.config.model,
                messages: [
                    { role: 'system' as const, content: preprocessPrompt },
                    { role: 'user' as const, content: rawInput },
                ],
                max_tokens: 500,
                temperature: 0.3,
            }, {});

            const optimized = result.content.trim();
            // Only use if it's meaningfully different (can be shorter if more concise)
            if (optimized && optimized.length > rawInput.length * 0.5 && optimized !== rawInput) {
                return optimized;
            }
            return rawInput;
        } catch {
            return rawInput; // Fallback to original on error
        }
    }

    // ── Adversarial Mode: 疯狂程序猿 vs 超级产品经理 ──

    private static readonly PERSONAS = {
        programmer: {
            id: 'programmer' as const,
            name: '疯狂程序猿',
            icon: '🐵',
            color: '#FF6900',
            systemPrompt: `你是疯狂程序猿 (CrazyCoder)，一个技术狂人。全程使用中文。

## 🚀 你的超级能力
- 闪电般理解代码：读 1-2 个文件就能抓住项目核心
- 代码直觉：看一眼就知道哪里该改，改完就对
- 精准打击：每次 edit_file 都命中要害，不浪费一个调用

## ⚡ 工作节奏
探索 → 写代码 → 说话 → 写代码 → 总结

1. 【少量探索】最多读 3-5 个关键文件
2. 【动手写代码】用 edit_file / write_file 修改文件
3. 【输出文字总结】告诉产品经理你做了什么

如果你连续调用了 5 次以上工具还没有输出文字，你就在犯错。

## 🎯 你的风格
- 直接、略带戏剧性："这代码...它冒犯了我。"
- 🐵 emoji 用在关键观点上
- 中英混用（像真正的中国程序员）
- 写完代码后用一句话说清楚改了什么、为什么这么改

## ⚠️ 禁区（踩到就翻车）
- 反复 list_directory / search_files（你有代码直觉，不需要）
- 读同一个文件多次（一次读完，读懂就干）
- 只读文件不写代码（你是程序员，不是审计员）`,
        },
        pm: {
            id: 'pm' as const,
            name: '超级产品经理',
            icon: '🦊',
            color: '#2196F3',
            systemPrompt: `你是超级产品经理 (SuperPM)，用户体验至上。全程使用中文。

## 🦊 你的审查视角
- 你通过 USER 的眼睛看代码，不关心实现细节
- 你只检查关键问题：功能是否正确、边界情况、用户体验
- 不要逐行审查代码风格 —— 那不是你的职责
- 先看整体是否合理，再看细节是否有问题

## 📋 输出格式（必须严格遵守）
你的回复必须按以下结构输出：

1. **判决**（第一行，必须是以下之一）：
   - VERDICT: APPROVED（代码没问题）
   - VERDICT: REJECTED（有问题需要修复）

2. **亮点**（先说好的，再挑毛病）：
   - 👍 [做得好的地方]

3. **问题列表**（仅当 REJECTED 时，每个问题一行）：
   - ISSUE: [问题描述] — 指出具体的文件和行号

4. **改进建议**（可选）：
   - SUGGESTION: [建议内容]

5. **用户视角反馈**（1-2 句，用通俗语言说明用户会遇到什么）

示例（通过）：
VERDICT: APPROVED
👍 表单验证逻辑完整，错误提示友好
功能实现正确，用户体验良好。

示例（不通过）：
VERDICT: REJECTED
👍 组件结构清晰，命名规范
ISSUE: src/utils.ts:15 — 未处理 null 值，会导致崩溃
ISSUE: 边界情况：输入为空数组时返回错误结果
SUGGESTION: 添加空值检查和边界测试
🦊 用户会遇到：表单提交后突然白屏，没有任何提示

## 风格
- 🦊 emoji 标记关键反馈
- 温暖但直接："这个功能很棒！但是..."
- 每个问题 1-2 句话，不要写长篇大论
- 先肯定再批评，让人愿意接受你的反馈`,
        },
    };

    /** Multi-dimensional review prompts for parallel sub-agent review */
    private static readonly REVIEW_DIMENSIONS: Record<string, { label: string; icon: string; prompt: string }> = {
        security: {
            label: '安全审查',
            icon: '🔒',
            prompt: `你是安全审查专家。专注检查以下安全问题：
- 输入验证和注入风险（XSS, SQL injection, 命令注入, 路径遍历）
- 认证/授权漏洞（权限检查缺失、token 泄露）
- 敏感数据暴露（日志打印敏感信息、硬编码密钥）
- 依赖安全问题（已知漏洞的库）
- 不安全的文件操作（未校验路径、未处理权限）

对每个发现的问题，严格按以下格式输出：
ISSUE: [severity:critical/high/medium/low] [文件路径:行号] [问题描述]

如果没有发现问题，输出：NO_ISSUES`,
        },
        performance: {
            label: '性能审查',
            icon: '⚡',
            prompt: `你是性能审查专家。专注检查以下性能问题：
- 不必要的循环/重复计算（可以在循环外计算的放到循环内）
- 内存泄漏风险（事件监听器未移除、闭包持有大对象）
- 大数据量下的 N+1 问题（循环中发请求/查询）
- 异步操作未正确处理（未 await、Promise 链断裂）
- 不必要的同步阻塞（同步读大文件、同步 HTTP）
- 缺少缓存（重复计算相同结果）

对每个发现的问题，严格按以下格式输出：
ISSUE: [severity:critical/high/medium/low] [文件路径:行号] [问题描述]

如果没有发现问题，输出：NO_ISSUES`,
        },
        ux: {
            label: '用户体验审查',
            icon: '👤',
            prompt: `你是用户体验审查专家。专注检查以下体验问题：
- 错误处理和用户提示是否友好（技术错误暴露给用户？）
- 边界情况下的用户反馈（空输入、超长输入、特殊字符）
- 操作流程是否符合用户直觉（确认步骤、撤销能力）
- 加载/等待状态的处理（有没有 loading 提示？）
- 可访问性问题（颜色对比度、键盘操作、屏幕阅读器）

对每个发现的问题，严格按以下格式输出：
ISSUE: [severity:critical/high/medium/low] [文件路径:行号] [问题描述]

如果没有发现问题，输出：NO_ISSUES`,
        },
    };

    /**
     * Adversarial mode — multi-dimensional code review with iterative improvement.
     *
     * ## 适用场景（产出物可被审查的任务）
     * - ✅ 写代码 / 实现功能：代码可审查，安全/性能/UX 多维度评审
     * - ✅ 修 Bug：可验证是否修复，有明确的对错标准
     * - ✅ 重构代码：结构变化可审查，性能可对比
     * - ✅ 写文档 / 文献综述：文本质量可评审，逻辑可检验
     * - ✅ 整理文件 / 项目结构：可审查但收益一般，单 agent 可能更高效
     *
     * ## 不适用场景（产出物无法被审查的任务）
     * - ❌ 操控软件 / 浏览器自动化：没有产出物可以审查，是连续动作流
     * - ❌ 简单问答 / 闲聊：审查 overhead 完全浪费
     * - ❌ 实时交互 / 调试：多轮审查太慢，打断交互节奏
     * - ❌ 需要外部状态的任务：审查 agent 无法感知外部状态变化
     *
     * ## 核心流程
     * Phase 0: 探索 → Phase 1: 编码 → Phase 1.5: 验证 → Phase 2: 多维并行审查 + PM 汇总 → 收敛判定
     */
    async adversarialChat(userInput: string, events: AgentEvents, images?: Array<{dataUrl: string; name: string; size: number}>, convId?: string): Promise<string> {
        const conv = this.conversations.get(convId || this.activeId);
        if (!conv) return 'No active conversation';

        const effectiveConvId = convId || this.activeId;

        // ── 适用性检测：不适合的任务自动降级为 Auto 模式 ──
        try {
            const suitability = await checkAdversarialSuitability(this.api, userInput, conv.model);
            if (!suitability.suitable) {
                // 降级提示
                events.onReasoning(`[🎭→⚡ 降级] 识别为「${suitability.category}」— ${suitability.reason}，对决模式不适合此任务，自动切换为 Auto 模式`);

                // 临时切换为 auto 模式，直接委托 doChat，避免 chat() 的并发保护误判当前会话正在运行。
                const originalMode = conv.mode;
                conv.mode = 'auto';
                try {
                    return await this.doChat(userInput, conv, events, images, effectiveConvId);
                } finally {
                    // 恢复对决模式（不影响后续对话的模式选择）
                    conv.mode = originalMode;
                }
            }
        } catch {
            // 检测失败，继续用对决模式（安全降级）
        }

        // Clear any stale stopping state from a previous run
        if (effectiveConvId) this.stoppingConversations.delete(effectiveConvId);

        // Create AbortController for adversarial mode (chat() creates it for normal mode,
        // but adversarialChat is called before that point)
        const abortController = new AbortController();
        this.abortControllers.set(effectiveConvId, abortController);
        const signal = abortController.signal;
        const MAX_ITERATIONS = this.config.adversarial.maxIterations;
        const coder = MiMoAgent.PERSONAS.programmer;
        const pm = MiMoAgent.PERSONAS.pm;

        // Save user message to conversation
        let userContent: string | ContentPart[];
        if (images && images.length > 0) {
            userContent = [{ type: 'text', text: userInput }];
            for (const img of images) {
                userContent.push({ type: 'image_url', image_url: { url: img.dataUrl } });
            }
        } else {
            userContent = userInput;
        }
        conv.messages.push({ role: 'user', content: userContent });

        // Announce adversarial mode start
        const reviewDims = this.config.adversarial.reviewDimensions;
        events.onReasoning([
            `[🎭 对决模式] ${coder.icon} ${coder.name} vs ${pm.icon} ${pm.name} | 审查维度: ${reviewDims.join(', ')}`,
            `[适用] 写代码 ✅ 修Bug ✅ 重构 ✅ 写文档 ✅ | 操控软件 ❌ 简单问答 ❌`,
        ].join('\n'));

        // ── Phase 0: 探索阶段 — 收集代码上下文 ──
        let codeContext = '';
        try {
            events.onStatus('🔍 收集代码上下文...');
            const exploreResult = await runSubAgent(
                {
                    type: 'explore',
                    task: `分析以下任务涉及的代码文件、依赖关系和项目结构。找到相关的源文件、配置文件、测试文件。\n\n任务：${userInput}\n\n请输出：\n1. 相关文件列表（路径+简要说明）\n2. 关键代码结构（类/函数/模块关系）\n3. 需要特别注意的边界情况`,
                    maxRounds: 5,
                },
                this.api, this.config.workspace, this.mcpManager,
                {
                    maxTokens: this.config.maxTokens,
                    temperature: this.config.temperature,
                    topP: this.config.topP,
                    maxOutputLen: this.config.maxOutputLen,
                    commandTimeout: this.config.commandTimeout,
                    sandbox: this.config.sandbox,
                    enableThinking: this.config.enableThinking,
                },
                { onStatus: (s) => events.onStatus(`[探索] ${s}`) },
                signal,
            );
            codeContext = exploreResult.output;
            events.onReasoning(`[探索完成] 收集了 ${exploreResult.toolCalls} 个工具调用的上下文 (${(exploreResult.elapsed / 1000).toFixed(1)}s)`);
        } catch (e: any) {
            events.onReasoning(`[探索失败] ${e.message}，继续执行...`);
        }

        let lastCoderResult = '';
        const reviewHistory: string[] = [];
        const coderMessages: ChatMessage[] = []; // Persistent across iterations
        const rounds: Array<{ iteration: number; verdict: string; issueCount: number; elapsed: number }> = [];
        const allIssues: TrackedIssue[] = [];
        const startTime = Date.now();
        let exitReason: 'completed' | 'stopped' | 'error' | 'max_iterations' = 'max_iterations';
        let issueCounter = 0;
        let lastDiffSnapshot = '';

        for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
            if (this.isStopping(convId || this.activeId, signal)) {
                exitReason = 'stopped';
                events.onDone('(stopped by user)');
                this.finishChat(convId);
                return '(stopped by user)';
            }

            // ── Phase 1: 疯狂程序猿 编码 ──
            events.onStatus(`${coder.icon} ${coder.name} 正在编码... (第 ${iteration} 轮)`);

            const coderContext = iteration === 1
                ? userInput
                : `请根据产品经理的反馈修复所有问题。不要重复读取已经读过的文件，直接修复问题。`;

            try {
                const coderResult = await this.runAdversarialPersona(
                    conv, coder, coderContext, events, iteration, 'speak',
                    iteration > 1 ? reviewHistory[reviewHistory.length - 1] : undefined,
                    convId,
                    iteration > 1 ? coderMessages : undefined, // Accumulate context after first round
                );
                lastCoderResult = coderResult.response;
                // Update coderMessages with the full accumulated history
                coderMessages.length = 0;
                coderMessages.push(...coderResult.messages);
            } catch (e: any) {
                events.onError(`${coder.name} error: ${e.message}`);
                exitReason = 'error';
                break;
            }

            try {
                lastDiffSnapshot = await executeTool(
                    'git_diff',
                    {},
                    this.config.workspace,
                    this.config.maxOutputLen,
                    this.config.commandTimeout,
                    this.config.sandbox,
                    conv.mode,
                );
                if (lastDiffSnapshot.startsWith('Tool error:')) {
                    lastDiffSnapshot = '';
                }
            } catch {
                lastDiffSnapshot = '';
            }

            if (this.isStopping(convId || this.activeId, signal)) break;

            // ── Phase 1.5: 验证阶段 — 确认上轮严重问题已修复 ──
            if (iteration > 1 && this.config.adversarial.enableVerification) {
                const criticalIssues = allIssues.filter(
                    i => !i.resolved && (i.severity === 'critical' || i.severity === 'high')
                );
                if (criticalIssues.length > 0) {
                    events.onStatus(`🔍 验证修复... (${criticalIssues.length} 个严重问题)`);
                    try {
                        const verifyResult = await runSubAgent(
                            {
                                type: 'explore',
                                task: `验证以下问题是否已被修复。读取相关文件，检查代码是否已正确修改。\n\n待验证的问题：\n${criticalIssues.map(i => `- ${i.id} ${i.file}:${i.line || '?'} [${i.severity}] ${i.description}`).join('\n')}\n\n对每个问题，输出：\n- FIXED: [问题ID] [简要说明如何确认已修复]\n或\n- NOT_FIXED: [问题ID] [为什么认为未修复]`,
                                maxRounds: 3,
                            },
                            this.api, this.config.workspace, this.mcpManager,
                            {
                                maxTokens: this.config.maxTokens,
                                temperature: this.config.temperature,
                                topP: this.config.topP,
                                maxOutputLen: this.config.maxOutputLen,
                                commandTimeout: this.config.commandTimeout,
                                sandbox: this.config.sandbox,
                                enableThinking: this.config.enableThinking,
                            },
                            { onStatus: (s) => events.onStatus(`[验证] ${s}`) },
                            signal,
                        );

                        // Update issue status based on verification
                        const fixedPattern = /FIXED:\s*\[?(issue-\d+)\]?/gi;
                        let fixMatch: RegExpExecArray | null;
                        while ((fixMatch = fixedPattern.exec(verifyResult.output)) !== null) {
                            const issue = allIssues.find(i => i.id === fixMatch![1]);
                            if (issue) {
                                issue.resolved = true;
                                issue.resolvedRound = iteration;
                            }
                        }
                        const fixedCount = criticalIssues.filter(i => i.resolved).length;
                        events.onReasoning(`[验证完成] ${fixedCount}/${criticalIssues.length} 个严重问题已确认修复`);
                    } catch (e: any) {
                        events.onReasoning(`[验证失败] ${e.message}，继续审查...`);
                    }
                }
            }

            // ── Phase 2: 多维并行审查 + PM 汇总 ──
            events.onStatus(`🔍 多维审查中... (第 ${iteration} 轮)`);

            // 2a. Run parallel review sub-agents for each dimension
            const codeSnippet = lastCoderResult.substring(0, 8000);
            const contextSnippet = codeContext ? `\n\n项目上下文：\n${codeContext.substring(0, 4000)}` : '';
            const subAgentConfig = {
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                topP: this.config.topP,
                maxOutputLen: this.config.maxOutputLen,
                commandTimeout: this.config.commandTimeout,
                sandbox: this.config.sandbox,
                enableThinking: this.config.enableThinking,
            };

            const dimensionResults: Array<{ dim: string; label: string; icon: string; output: string }> = [];
            const reviewPromises = reviewDims.map(async (dim) => {
                const dimDef = MiMoAgent.REVIEW_DIMENSIONS[dim];
                if (!dimDef) return null;
                try {
                    const result = await runSubAgent(
                        {
                            type: 'explore',
                            task: `${dimDef.prompt}\n\n---\n原始需求：${userInput}\n\n${coder.name}的实现：\n${codeSnippet}${contextSnippet}`,
                            maxRounds: 3,
                        },
                        this.api, this.config.workspace, this.mcpManager, subAgentConfig,
                        { onStatus: (s) => events.onStatus(`[${dimDef.icon} ${dimDef.label}] ${s}`) },
                        signal,
                    );
                    return { dim, label: dimDef.label, icon: dimDef.icon, output: result.output };
                } catch (e: any) {
                    events.onReasoning(`[${dimDef.icon} ${dimDef.label}] 审查失败: ${e.message}`);
                    return null;
                }
            });

            const reviewResults = (await Promise.all(reviewPromises)).filter(Boolean) as typeof dimensionResults;
            dimensionResults.push(...reviewResults);

            // Extract structured issues from each dimension
            for (const dr of dimensionResults) {
                const extracted = this.extractIssues(dr.output, dr.dim, iteration, issueCounter);
                allIssues.push(...extracted.issues);
                issueCounter = extracted.nextId;
            }

            // 2b. PM synthesizes all dimension results
            events.onStatus(`${pm.icon} ${pm.name} 综合审查... (第 ${iteration} 轮)`);

            const dimensionSummary = dimensionResults.length > 0
                ? dimensionResults.map(dr =>
                    `### ${dr.icon} ${dr.label}\n${dr.output}`
                ).join('\n\n')
                : '(多维审查未返回结果)';

            let pmReview = '';
            try {
                const pmResult = await this.runAdversarialPersona(
                    conv, pm,
                    `你是最终审查者，综合多个专业审查维度的结果做出最终判断。\n\n以下是各维度的审查结果：\n\n${dimensionSummary}\n\n---\n原始需求：${userInput}\n\n${coder.name}的实现摘要：\n${codeSnippet}\n\n当前 git diff 摘要：\n${lastDiffSnapshot ? lastDiffSnapshot.substring(0, 6000) : '(no diff available)'}\n\n必须按下面格式输出，不能省略 VERDICT：\nVERDICT: APPROVED 或 REJECTED\nISSUE: [severity:critical/high/medium/low] [file:line] [问题描述]\nSUGGESTION: [可选改进建议]\n\n判决规则：只要存在 critical/high 问题，或多维审查中有明确未解决问题，必须 REJECTED。只有确认需求完成、没有阻塞问题、且修改可验证时才 APPROVED。`,
                    events, iteration, 'review',
                    undefined, convId,
                );
                pmReview = pmResult.response;
            } catch (e: any) {
                events.onError(`${pm.name} error: ${e.message}`);
                exitReason = 'error';
                break;
            }

            reviewHistory.push(pmReview);

            // Check verdict (structured parsing)
            const verdict = this.parseVerdict(pmReview);
            const pmExtracted = this.extractIssues(pmReview, 'pm', iteration, issueCounter);
            allIssues.push(...pmExtracted.issues);
            issueCounter = pmExtracted.nextId;
            let approved = verdict.approved;
            if (verdict.verdictFound) {
                for (const issue of allIssues) {
                    if (!issue.resolved && issue.file === '(review)' && issue.description.includes('structured VERDICT')) {
                        issue.resolved = true;
                        issue.resolvedRound = iteration;
                    }
                }
            }
            const openSevereIssues = allIssues.filter(
                i => !i.resolved && (i.severity === 'critical' || i.severity === 'high')
            );
            if (approved && openSevereIssues.length > 0) {
                events.onReasoning(`[第 ${iteration} 轮] PM 给出通过，但仍有 ${openSevereIssues.length} 个严重问题未验证，继续迭代`);
                approved = false;
            }

            if (approved && pmExtracted.issues.some(i => !i.resolved)) {
                events.onReasoning(`[Round ${iteration}] PM returned APPROVED but also listed unresolved ISSUE entries. Continuing repair.`);
                approved = false;
            }

            if (!verdict.verdictFound) {
                events.onReasoning(`[第 ${iteration} 轮] ⚠️ ${pm.icon} 未输出标准判决格式，转为继续迭代`);
                approved = false;
                allIssues.push({
                    id: `issue-${++issueCounter}`,
                    severity: 'high',
                    file: '(review)',
                    description: 'PM review did not produce a structured VERDICT. Continue with stricter verification and finalization.',
                    dimension: 'pm',
                    round: iteration,
                    resolved: false,
                });
            }

            // Track round data for quality report
            const roundIssueCount = allIssues.filter(i => i.round === iteration).length;
            rounds.push({
                iteration,
                verdict: approved ? 'APPROVED' : 'REJECTED',
                issueCount: roundIssueCount,
                elapsed: Date.now() - startTime,
            });

            if (approved) {
                // PM approved — emit final verdict
                const verdictSummary = verdict.suggestions.length > 0
                    ? `\n\n💡 改进建议：\n${verdict.suggestions.map(s => `- ${s}`).join('\n')}`
                    : '';
                events.onAdversarialTurn?.(pm.id, pm.name, pm.icon, 'verdict',
                    `✅ **通过！** 经过 ${iteration} 轮对决，代码质量达标。${verdictSummary}\n\n${pmReview}`, iteration);

                this.emitAdversarialReport(rounds, allIssues, events);
                conv.messages.push({ role: 'assistant', content: lastCoderResult, reasoning_content: '' });
                this.saveConversations();

                events.onStatus(`[🎭 对决结束] ${pm.icon} ${pm.name} 通过 ✅ (${iteration} 轮)`);
                events.onDone(lastCoderResult);
                this.finishChat(convId);
                return lastCoderResult;
            }

            // ── 智能收敛判定 ──
            const convergence = this.shouldConverge(allIssues, rounds, iteration, MAX_ITERATIONS);
            if (convergence.converge) {
                const unresolved = allIssues.filter(i => !i.resolved);
                const criticalUnresolved = unresolved.filter(i => i.severity === 'critical' || i.severity === 'high');
                const remainingIssues = criticalUnresolved.length > 0
                    ? `\n\n🔴 未解决的严重问题：\n${criticalUnresolved.map(i => `- [${i.severity}] ${i.file}:${i.line || '?'} — ${i.description}`).join('\n')}`
                    : unresolved.length > 0
                        ? `\n\n残留低优先级问题：\n${unresolved.map(i => `- [${i.severity}] ${i.description}`).join('\n')}`
                        : '';
                events.onAdversarialTurn?.(pm.id, pm.name, pm.icon, 'verdict',
                    `⚠️ **放行** — ${convergence.reason}。${remainingIssues}\n\n${pmReview}`, iteration);

                this.emitAdversarialReport(rounds, allIssues, events);
                conv.messages.push({ role: 'assistant', content: lastCoderResult, reasoning_content: '' });
                this.saveConversations();

                events.onStatus(`[🎭 对决结束] ⚠️ ${convergence.reason} (${iteration} 轮)`);
                events.onDone(lastCoderResult);
                this.finishChat(convId);
                return lastCoderResult;
            }

            // Feed structured issues back to coder for next iteration
            const roundIssues = allIssues.filter(i => i.round === iteration);
            const unresolvedIssues = allIssues.filter(i => !i.resolved);
            const feedbackForCoder = this.buildAdversarialFeedback(
                unresolvedIssues.length > 0 ? unresolvedIssues : roundIssues,
                pmReview,
                lastDiffSnapshot,
            );
            reviewHistory[reviewHistory.length - 1] = feedbackForCoder;
            const issueSummary = roundIssues.length > 0
                ? `${pm.icon} 发现 ${roundIssues.length} 个问题（${roundIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length} 个严重），${coder.icon} 需要修复...`
                : `${pm.icon} 发现问题，${coder.icon} 需要修复...`;
            events.onReasoning(`[第 ${iteration} 轮] ${issueSummary}`);
        }

        // Loop ended — emit quality report
        this.emitAdversarialReport(rounds, allIssues, events);
        conv.messages.push({ role: 'assistant', content: lastCoderResult, reasoning_content: '' });
        this.saveConversations();

        const endMsg = exitReason === 'error'
            ? `[🎭 对决结束] 执行出错 (${rounds.length} 轮)`
            : `[🎭 对决结束] 达到最大轮次 (${MAX_ITERATIONS})`;
        events.onStatus(endMsg);
        const doneMsg = this.buildAdversarialFinalSummary(
            exitReason,
            lastCoderResult,
            allIssues,
            rounds,
            MAX_ITERATIONS,
        );
        events.onDone(doneMsg);
        this.finishChat(convId);
        return doneMsg;
    }

    /**
     * Run a single adversarial persona (coder or PM) with independent message history.
     * Streams output through adversarial-specific events for visual dialogue.
     * @param existingMessages - If provided, append to this array instead of creating new one (for cross-round context).
     */
    private async runAdversarialPersona(
        conv: ConversationState,
        persona: { id: 'programmer' | 'pm'; name: string; icon: string; color: string; systemPrompt: string },
        task: string,
        events: AgentEvents,
        iteration: number,
        phase: 'speak' | 'review',
        previousFeedback?: string,
        convId?: string,
        existingMessages?: ChatMessage[],
    ): Promise<{ response: string; messages: ChatMessage[] }> {
        const signal = this.abortControllers.get(convId || this.activeId)?.signal;

        // Copy existing messages so manageContext compression doesn't corrupt the persistent history
        const messages: ChatMessage[] = existingMessages ? [...existingMessages] : [];
        if (existingMessages) {
            // Accumulating mode: inject PM feedback into the user message so coder sees specific issues
            const taskContent = previousFeedback
                ? `${task}\n\n[产品经理的反馈 — 上一轮]\n${previousFeedback}`
                : task;
            messages.push({ role: 'user', content: taskContent });
        } else {
            // Fresh history: add feedback context if any
            if (previousFeedback) {
                messages.push({ role: 'system', content: `[上一轮反馈]\n${previousFeedback}` });
            }
            messages.push({ role: 'user', content: task });
        }

        let fullResponse = '';

        // Tool budget: configurable rounds of tools, then FORCE text output (no tools)
        // This prevents the model from exploring forever without producing results.
        const TOOL_BUDGET = this.config.adversarial.toolBudget;

        for (let toolRound = 0; toolRound < 100; toolRound++) {
            if (this.isStopping(convId || this.activeId, signal)) break;

            const forceText = toolRound >= TOOL_BUDGET;

            // When forcing text: inject instruction and remove tools
            if (forceText && toolRound === TOOL_BUDGET) {
                messages.push({
                    role: 'user',
                    content: '[系统提示] 你的工具调用配额已用完。现在必须立即输出文字回复，总结你做了什么、改了哪些文件、结果如何。不要再调用任何工具。',
                });
                events.onReasoning(`[第 ${TOOL_BUDGET} 轮] 🐵 工具配额用完，强制输出结果...`);
            }

            // Context management: compress when approaching limits
            const managed = manageContext(messages, conv.model);
            // Replace original array contents with managed result so compression persists
            messages.length = 0;
            messages.push(...managed);

            // Build adversarial system prompt: persona + workspace + personalized instructions
            let advSystemContent = persona.systemPrompt
                + `\n\nWorkspace: ${this.config.workspace}\nCurrent iteration: ${iteration}`;
            advSystemContent += phase === 'review'
                ? `\n\n## Review Contract\nYou are a strict reviewer. Use tools to inspect files when needed, but do not modify files. Your final response MUST include:\nVERDICT: APPROVED or REJECTED\nISSUE: [severity:critical/high/medium/low] [file:line] [description]\nSUGGESTION: [optional]\nApprove only when the requested outcome is implemented and no blocking issue remains.`
                : `\n\n## Builder Contract\nPrefer direct fixes over broad re-analysis. When feedback is provided, fix listed issues first. If a narrow edit fails repeatedly because of encoding or brittle context, re-read the full file and rebuild the smallest coherent section or the whole small file, then validate. Final response must include changed files and verification result.`;
            if (this.personalizedInstructions) {
                advSystemContent += `\n\n## Project/User Instructions\nFollow these unless they conflict with higher-priority safety, tool, or system requirements.\n${this.personalizedInstructions}`;
            }

            const params: Record<string, any> = this.buildChatParams(conv.model, [
                { role: 'system' as const, content: advSystemContent },
                ...managed,
            ]);

            // After tool budget exhausted: NO tools, force text-only response
            if (forceText) {
                params.tools = undefined;
                params.tool_choice = undefined;
            } else if (phase === 'review') {
                // PM: strictly read-only tools (no execute_command — reviewer must not modify state)
                params.tools = TOOL_DEFINITIONS.filter(t =>
                    ['read_file', 'search_files', 'glob_files', 'list_directory',
                     'get_file_info', 'git_status', 'git_diff', 'git_log'].includes(t.function.name)
                );
                params.tool_choice = 'auto';
            } else {
                // Coder: all tools, freely use them
                params.tools = this.withoutUserPauseTools(TOOL_DEFINITIONS);
                params.tool_choice = 'auto';
            }

            // Stream with persona-specific events
            let roundText = '';
            let reasoningText = '';
            const result = await this.api.chatCompletionsStream(params, {
                onToken: (t) => {
                    roundText += t;
                    events.onAdversarialTurn?.(persona.id, persona.name, persona.icon, phase, t, iteration);
                },
                onReasoning: (t) => {
                    reasoningText += t;
                },
            }, signal);

            if (result.reasoningContent) reasoningText = result.reasoningContent;

            if (result.toolCalls.length === 0) {
                // Model produced text without tools — this is the natural final response
                fullResponse = result.content || roundText;
                break;
            }

            // Has tool calls — execute them and continue the loop

            // Execute tool calls
            const assistantMsg: ChatMessage = {
                role: 'assistant', content: result.content || null as any,
                tool_calls: result.toolCalls, reasoning_content: reasoningText || '',
            };
            messages.push(assistantMsg);

            // Collect tool call summaries for narration
            const toolSummaries: string[] = [];

            for (const tc of result.toolCalls) {
                // Check stop signal before each tool execution
                if (this.isStopping(convId || this.activeId, signal)) break;

                let args: Record<string, any> = {};
                try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }

                events.onAdversarialToolStart?.(persona.id, tc.function.name, args);
                const t0 = Date.now();

                const toolResult = this.mcpManager.isMcpTool(tc.function.name)
                    ? await this.mcpManager.callTool(tc.function.name, args)
                    : await executeTool(
                        tc.function.name, args, this.config.workspace,
                        this.config.maxOutputLen, this.config.commandTimeout,
                        this.config.sandbox,
                    );

                const toolElapsed = (Date.now() - t0) / 1000;
                const isError = toolResult.startsWith('Safety:') || toolResult.startsWith('Tool error:');
                events.onAdversarialToolEnd?.(persona.id, tc.function.name, toolResult, isError, toolElapsed);
                events.onToolCallEnd(tc.function.name, toolResult, isError, toolElapsed);

                messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });

                // Generate human-readable summary for narration
                toolSummaries.push(this.summarizeToolCall(tc.function.name, args, isError));
            }

            // Emit narration text so user can see what the persona is doing
            if (toolSummaries.length > 0) {
                const narration = toolSummaries.length === 1
                    ? toolSummaries[0]
                    : `${toolSummaries[0]} 等 ${toolSummaries.length} 项操作`;
                // Small delay to let tool cards render first
                await new Promise(r => setTimeout(r, 50));
                events.onAdversarialTurn?.(persona.id, persona.name, persona.icon, phase, `\n\n> ${narration}\n\n`, iteration);
            }

            fullResponse = result.content || roundText;
        }

        // Append assistant response to messages for context accumulation
        messages.push({ role: 'assistant', content: fullResponse, reasoning_content: '' });
        return { response: fullResponse, messages };
    }

    /**
     * Handle direct responses — no tools needed (greetings, questions, explanations).
     */
    private async handleDirectResponse(
        userInput: string,
        conv: ConversationState,
        events: AgentEvents,
        signal?: AbortSignal,
        convId?: string,
        persona?: ReturnType<typeof detectPersona>,
    ): Promise<string> {
        events.onStatus('正在思考...');

        // Include persona in system prompt if detected
        let systemContent = persona
            ? buildPersonaPrompt(this.systemPrompt, persona)
            : this.systemPrompt;

        // Inject active skill prompt
        if (conv.activeSkillPrompt) {
            systemContent += `\n\n## Active Skill\n${conv.activeSkillPrompt}`;
        }

        // Include conversation history so the model can reference past messages
        const managedMessages = manageContext(conv.messages, conv.model);
        const params: Record<string, any> = this.buildChatParams(conv.model, [
            { role: 'system' as const, content: systemContent },
            ...managedMessages,
        ]);

        let content = '';
        const result = await this.api.chatCompletionsStream(params, {
            onToken: (t) => {
                content += t;
                events.onToken(t);
            },
            onReasoning: (t) => events.onReasoning(t),
        }, signal);

        if (result.usage) recordTokenUsage(result.usage);

        // Save assistant response (user message already pushed by chat())
        conv.messages.push({ role: 'assistant', content: content || result.content, reasoning_content: '' });
        this.saveConversations();

        const response = content || result.content || '(no response)';
        events.onDone(response);
        this.finishChat(convId);
        return response;
    }

    private summarizeToolCall(name: string, args: Record<string, any>, isError: boolean): string {
        const failTag = isError ? ' ❌' : '';
        switch (name) {
            case 'read_file': return `📄 读取了 ${args.path || '文件'}${failTag}`;
            case 'write_file': return `✏️ 写入了 ${args.path || '文件'}${failTag}`;
            case 'edit_file': return `✏️ 编辑了 ${args.path || '文件'}${failTag}`;
            case 'list_directory': return `📁 浏览了 ${args.path || '目录'}${failTag}`;
            case 'search_files': return `🔍 搜索了 "${args.pattern || ''}"${failTag}`;
            case 'execute_command': return `⚡ 执行了命令${failTag}`;
            case 'glob_files': return `📂 匹配了 ${args.pattern || ''}${failTag}`;
            case 'git_status': return `🌿 查看了 git 状态${failTag}`;
            case 'git_diff': return `🌿 查看了 git diff${failTag}`;
            case 'git_log': return `🌿 查看了提交历史${failTag}`;
            case 'git_commit': return `🌿 提交了代码${failTag}`;
            case 'web_search': return `🌐 搜索了 "${args.query || ''}"${failTag}`;
            case 'fetch_url': return `🌐 获取了网页内容${failTag}`;
            default: return `🔧 调用了 ${name}${failTag}`;
        }
    }

    /**
     * Emit an enhanced quality report summarizing the adversarial session.
     * Includes issue tracking stats, severity distribution, and dimension breakdown.
     */
    private emitAdversarialReport(
        rounds: Array<{ iteration: number; verdict: string; issueCount: number; elapsed: number }>,
        allIssues: TrackedIssue[],
        events: AgentEvents,
    ): void {
        if (rounds.length === 0) return;

        const totalElapsed = rounds[rounds.length - 1].elapsed;
        const issueCounts = rounds.map(r => r.issueCount);
        const finalVerdict = rounds[rounds.length - 1].verdict;

        const totalIssues = allIssues.length;
        const resolvedIssues = allIssues.filter(i => i.resolved).length;
        const bySeverity = {
            critical: allIssues.filter(i => i.severity === 'critical').length,
            high: allIssues.filter(i => i.severity === 'high').length,
            medium: allIssues.filter(i => i.severity === 'medium').length,
            low: allIssues.filter(i => i.severity === 'low').length,
        };

        // Group by dimension
        const byDimension = new Map<string, number>();
        for (const issue of allIssues) {
            byDimension.set(issue.dimension, (byDimension.get(issue.dimension) || 0) + 1);
        }
        const dimensionBreakdown = Array.from(byDimension.entries())
            .map(([dim, count]) => `${dim}:${count}`)
            .join(' | ');

        const report = [
            `📊 **对决质量报告**`,
            `━━━━━━━━━━━━━━━━━━`,
            `总轮次: ${rounds.length}`,
            `问题变化: ${issueCounts.join(' → ')}`,
            `问题统计: ${totalIssues} 个发现, ${resolvedIssues} 个已解决${totalIssues > 0 ? ` (${(resolvedIssues / totalIssues * 100).toFixed(0)}%)` : ''}`,
            `严重度分布: 🔴${bySeverity.critical} 🟡${bySeverity.high} 🔵${bySeverity.medium} ⚪${bySeverity.low}`,
            dimensionBreakdown ? `维度分布: ${dimensionBreakdown}` : '',
            `最终判决: ${finalVerdict === 'APPROVED' ? '✅ 通过' : '⚠️ 未完全通过'}`,
            `总耗时: ${(totalElapsed / 1000).toFixed(1)}s`,
        ].filter(Boolean).join('\n');

        events.onReasoning(report);
    }

    /**
     * Extract structured issues from a review sub-agent's output.
     * Parses ISSUE: [severity:critical/high/medium/low] [file:line] [description] format.
     */
    private extractIssues(
        reviewText: string,
        dimension: string,
        round: number,
        startId: number,
    ): { issues: TrackedIssue[]; nextId: number } {
        const issues: TrackedIssue[] = [];
        let nextId = startId;

        // Match: ISSUE: [severity:critical/high/medium/low] [file:line] [description]
        // Also matches: ISSUE: [critical] [file] [description] (without severity: prefix)
        const issueRegex = /ISSUE:\s*\[(?:severity:)?(critical|high|medium|low)\]\s*\[([^\]:]+?)(?::(\d+))?\]\s*(.+)/gi;
        let match;
        while ((match = issueRegex.exec(reviewText)) !== null) {
            issues.push({
                id: `issue-${++nextId}`,
                severity: match[1].toLowerCase() as TrackedIssue['severity'],
                file: match[2].trim(),
                line: match[3] ? parseInt(match[3]) : undefined,
                description: match[4].trim(),
                dimension,
                round,
                resolved: false,
            });
        }

        // Fallback: try simpler ISSUE: format without brackets
        if (issues.length === 0) {
            const simpleRegex = /ISSUE:\s*(.+)/gi;
            while ((match = simpleRegex.exec(reviewText)) !== null) {
                const desc = match[1].trim();
                if (desc.toLowerCase() === 'no_issues') continue;
                issues.push({
                    id: `issue-${++nextId}`,
                    severity: 'medium', // Default severity when not specified
                    file: '(unknown)',
                    description: desc,
                    dimension,
                    round,
                    resolved: false,
                });
            }
        }

        return { issues, nextId };
    }

    /**
     * Smart convergence detection based on issue severity and resolution rate.
     * Replaces the old Jaccard similarity approach.
     */
    private shouldConverge(
        allIssues: TrackedIssue[],
        rounds: Array<{ iteration: number; verdict: string; issueCount: number; elapsed: number }>,
        currentRound: number,
        maxIterations: number,
    ): { converge: boolean; reason: string } {
        const unresolved = allIssues.filter(i => !i.resolved);
        const criticalUnresolved = unresolved.filter(i => i.severity === 'critical' || i.severity === 'high');

        // 1. Only converge when every tracked issue is resolved.
        // The caller already handles explicit PM approval; this path is for ending stalled loops.
        if (unresolved.length === 0 && rounds.length > 0) {
            return { converge: true, reason: '所有跟踪问题已解决' };
        }

        // 2. Max iterations reached
        if (currentRound >= maxIterations) {
            return { converge: true, reason: `达到最大迭代轮次 (${maxIterations})` };
        }

        return { converge: false, reason: '' };
    }

    /**
     * Parse structured verdict from PM review.
     * Supports both structured (VERDICT: APPROVED/REJECTED) and legacy (✅/❌) formats.
     */
    private parseVerdict(review: string): { approved: boolean; issues: string[]; suggestions: string[]; verdictFound: boolean } {
        // Try structured format first
        const verdictMatch = review.match(/VERDICT:\s*(APPROVED|REJECTED)/i);
        if (verdictMatch) {
            const approved = verdictMatch[1].toUpperCase() === 'APPROVED';
            const issues = (review.match(/ISSUE:\s*(.+)/gi) || [])
                .map(m => m.replace(/ISSUE:\s*/i, '').trim());
            const suggestions = (review.match(/SUGGESTION:\s*(.+)/gi) || [])
                .map(m => m.replace(/SUGGESTION:\s*/i, '').trim());
            return { approved, issues, suggestions, verdictFound: true };
        }

        // Fallback: legacy format (✅/❌ emoji)
        const trimmed = review.trim();
        const hasApproval = /^✅/.test(trimmed) || /✅\s*通过/.test(trimmed);
        const hasRejection = /^❌/.test(trimmed) || /❌\s*不通过/.test(trimmed);
        if (hasApproval || hasRejection) {
            return {
                approved: hasApproval && !hasRejection,
                issues: [],
                suggestions: [],
                verdictFound: true,
            };
        }

        // No verdict pattern found — PM failed to produce a proper verdict
        return { approved: false, issues: [], suggestions: [], verdictFound: false };
    }

    private buildAdversarialFeedback(issues: TrackedIssue[], pmReview: string, diffSnapshot: string): string {
        const unresolved = issues
            .filter(i => !i.resolved)
            .filter((issue, idx, arr) => {
                const key = `${issue.severity}|${issue.file}|${issue.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
                return arr.findIndex(other =>
                    `${other.severity}|${other.file}|${other.description.toLowerCase().replace(/\s+/g, ' ').trim()}` === key
                ) === idx;
            })
            .sort((a, b) => {
                const rank = { critical: 0, high: 1, medium: 2, low: 3 };
                return rank[a.severity] - rank[b.severity];
            });

        const issueBlock = unresolved.length > 0
            ? unresolved.map(i => `- ${i.id} [${i.severity}] ${i.file}${i.line ? `:${i.line}` : ''}: ${i.description}`).join('\n')
            : '- No structured issues were extracted. Re-read the PM review and verify the diff.';

        return [
            'Adversarial repair brief:',
            '',
            'Fix these items first, in order. Do not restart broad exploration unless a file is missing.',
            issueBlock,
            '',
            'PM review:',
            pmReview.substring(0, 5000),
            '',
            'Current git diff snapshot:',
            diffSnapshot ? diffSnapshot.substring(0, 5000) : '(no diff available)',
            '',
            'Required next response:',
            '- Apply concrete fixes with tools when needed.',
            '- Run or describe the smallest useful verification.',
            '- Finish with changed files and verification result.',
        ].join('\n');
    }

    private buildAdversarialFinalSummary(
        exitReason: 'completed' | 'stopped' | 'error' | 'max_iterations',
        lastCoderResult: string,
        allIssues: TrackedIssue[],
        rounds: Array<{ iteration: number; verdict: string; issueCount: number; elapsed: number }>,
        maxIterations: number,
    ): string {
        const unresolved = allIssues
            .filter(i => !i.resolved)
            .sort((a, b) => {
                const rank = { critical: 0, high: 1, medium: 2, low: 3 };
                return rank[a.severity] - rank[b.severity];
            });
        const issueText = unresolved.length > 0
            ? unresolved.slice(0, 10).map(i => `- [${i.severity}] ${i.file}${i.line ? `:${i.line}` : ''}: ${i.description}`).join('\n')
            : '- None tracked';

        const status = exitReason === 'error'
            ? 'adversarial mode stopped because one persona failed'
            : `adversarial mode reached the maximum ${maxIterations} iterations`;

        return [
            `Task status: ${status}`,
            `Rounds completed: ${rounds.length}`,
            '',
            'Unresolved issues:',
            issueText,
            '',
            'Latest implementation result:',
            lastCoderResult || '(no implementation result was produced)',
            '',
            'Next action:',
            unresolved.length > 0
                ? 'Continue from the unresolved issue list above, starting with critical/high items, then run the smallest relevant verification.'
                : 'Run the relevant project verification once more and finalize.',
        ].join('\n');
    }

    /**
     * Check if two reviews raise similar core issues (convergence detection).
     * Improved: handles camelCase, file paths, short technical terms, and numbers.
     */
    private reviewsAreSimilar(a: string, b: string): boolean {
        const extractKeywords = (text: string): Set<string> => {
            const lower = text.toLowerCase();
            const words = lower.match(
                /[一-鿿]{2,}|[a-z][a-z0-9]{2,}|\d+\.\d+|[a-z]:\\[^\s]+|\/[a-z][^\s]+/g
            ) || [];
            // Also split camelCase: getUserName → get, user, name
            const expanded: string[] = [];
            for (const w of words) {
                expanded.push(w);
                const camelParts = w.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
                if (camelParts.length > 1) expanded.push(...camelParts);
            }
            // Filter out common stop words
            const stops = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'not', 'but', 'have', 'has', 'can', 'will']);
            return new Set(expanded.filter(w => !stops.has(w)));
        };
        const kwA = extractKeywords(a);
        const kwB = extractKeywords(b);
        if (kwA.size === 0 || kwB.size === 0) return false;
        let intersection = 0;
        for (const w of kwA) { if (kwB.has(w)) intersection++; }
        const union = kwA.size + kwB.size - intersection;
        return (intersection / union) > 0.4; // Slightly lower threshold for better recall
    }

    /**
     * Get the last assistant message content from conversation.
     */
    private getLastAssistantContent(conv: ConversationState): string {
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            const msg = conv.messages[i];
            if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
                return msg.content;
            }
        }
        return '';
    }

    private extractMessageText(content: string | ContentPart[] | null | undefined): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter((part) => part.type === 'text')
                .map((part) => part.text || '')
                .join(' ')
                .trim();
        }
        return '';
    }

    private clearInternalStop(convId: string): void {
        this.stoppingConversations.delete(convId);
        this.abortControllers.delete(convId);
    }

    /**
     * Continue task with a fresh model call when reasoning loop is detected.
     * This is like "switching to a new dish" — the conversation continues,
     * but we start a new model call with clear instructions.
     */
    private async continueWithFreshModel(
        conv: ConversationState,
        progressSummary: string,
        events: AgentEvents,
    ): Promise<string | null> {
        try {
            // Build a fresh message list with clear instructions
            const freshMessages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `[RECOVERY MODE] The previous model call got stuck in a reasoning loop. You are a fresh model call in the same conversation.
Stop thinking. Do not plan again. Do not explain internal reasoning. Act immediately from the current progress.

${progressSummary}

Required behavior:
1. If enough work is already done, output a final user-facing summary now.
2. If work is incomplete, output a concise recovery handoff: completed work, changed files, validation status, exact next command/action.
3. Do not repeat prior analysis. Start the answer with "RECOVERY:" or "SUMMARY:".`,
                },
                // Include the original user request
                ...conv.messages.filter(m => m.role === 'user').slice(0, 1),
                // Include recent tool results for context
                ...conv.messages.filter(m => m.role === 'tool').slice(-5),
            ];

            // Make a fresh API call without tools to force direct output
            const params = {
                model: conv.model,
                messages: freshMessages,
                tools: undefined, // No tools — force text output
                stream: false,
                max_tokens: 2000,
            };

            events.onReasoning(`\n\n[Recovery] Starting a fresh model call...`);

            const content = await this.api.chatCompletion(params);

            if (content && content.length > 10) {
                return content;
            }

            return null;
        } catch (e: any) {
            events.onReasoning(`\n\n[Recovery] Fresh model call failed: ${e.message}`);
            return null;
        }
    }

    /**
     * Ask a fresh model call to produce a useful handoff instead of ending with
     * only "max rounds reached". This preserves session continuity without
     * pretending the task is complete.
     */
    private async finalizeWithFreshModel(
        conv: ConversationState,
        progressSummary: string,
        events: AgentEvents,
        signal?: AbortSignal,
    ): Promise<string | null> {
        try {
            const recentMessages = conv.messages
                .filter(m => m.role === 'assistant' || m.role === 'tool')
                .slice(-8);
            const messages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `[HANDOFF MODE] The agent reached its tool-round budget before a clean final answer.
Stop thinking. Do not call tools. Do not continue implementation. Produce a useful user-facing handoff now.

${progressSummary}

Output format:
- Start with "SUMMARY:" if the task appears mostly complete, otherwise "RECOVERY:".
- Mention what was completed.
- Mention files likely changed or inspected.
- Mention validation status if known.
- Give the next concrete step to resume.
- Keep it concise and do not apologize.`,
                },
                ...conv.messages.filter(m => m.role === 'user').slice(0, 1),
                ...recentMessages,
            ];

            events.onReasoning(`\n\n[Handoff] Generating final recovery summary...`);
            const content = await this.api.chatCompletion({
                model: conv.model,
                messages,
                stream: false,
                max_tokens: Math.min(2000, this.config.maxTokens || 2000),
                temperature: Math.min(this.config.temperature ?? 0.7, 0.4),
            }, signal);

            return content && content.trim().length > 10 ? content.trim() : null;
        } catch (e: any) {
            events.onReasoning(`\n\n[Handoff] Summary generation failed: ${e.message}`);
            return null;
        }
    }

    private buildProgressSummary(
        conv: ConversationState,
        reason: string,
        options: { maxRounds?: number; round?: number; includeLastAssistant?: boolean } = {},
    ): string {
        const goal = (() => {
            for (let i = conv.messages.length - 1; i >= 0; i--) {
                const msg = conv.messages[i];
                if (msg.role === 'user') {
                    const text = this.extractMessageText(msg.content);
                    if (text) return text;
                }
            }
            return 'unknown task';
        })();

        const toolMessages = conv.messages.filter((msg) => msg.role === 'tool');
        const changedFiles = new Set<string>();
        for (const msg of toolMessages) {
            const toolName = msg._toolName || '';
            if ((toolName === 'edit_file' || toolName === 'write_file') && typeof msg.content === 'string') {
                const match = msg.content.match(/([A-Za-z]:\\[^\r\n]+|\/[^\r\n]+)/);
                if (match) changedFiles.add(match[1].trim());
            }
        }

        const latestAssistant = options.includeLastAssistant === false ? '' : this.getLastAssistantContent(conv);
        const lines = [
            `Task status: ${reason}`,
            `Goal: ${goal.slice(0, 240)}`,
            `Completed tool calls: ${toolMessages.length}`,
        ];

        if (typeof options.round === 'number' && typeof options.maxRounds === 'number') {
            lines.push(`Progress: round ${options.round} of ${options.maxRounds}`);
        }

        if (changedFiles.size > 0) {
            lines.push(`Changed files: ${Array.from(changedFiles).slice(0, 8).join(', ')}`);
        }

        if (latestAssistant) {
            lines.push(`Latest model output: ${latestAssistant.slice(0, 400)}`);
        } else if (toolMessages.length > 0) {
            const recentTools = toolMessages
                .slice(-3)
                .map((msg) => `${msg._toolName || 'tool'} -> ${this.extractMessageText(msg.content).slice(0, 160)}`)
                .join(' | ');
            lines.push(`Recent tool results: ${recentTools}`);
        }

        lines.push('Next action: continue from the latest changed files or ask the model to verify and finalize.');
        return lines.join('\n');
    }

    async chatWithSkill(skillName: string, userInput: string, events: AgentEvents, conversationId?: string): Promise<string> {
        const skill = this.skills.get(skillName);
        if (!skill) {
            events.onDone(`Skill '${skillName}' not found`);
            events.onError(`Skill '${skillName}' not found`);
            return `Skill '${skillName}' not found`;
        }
        // Render skill template → inject into system prompt (not user message)
        // This saves context tokens and gives skill instructions more authority
        const rendered = renderSkill(skill, userInput, this.config.workspace);
        return this.chat(userInput, events, undefined, conversationId, rendered);
    }

    // ── Sub-Agent ──

    /**
     * Handle a spawn_subagent tool call within the main agent loop.
     * Returns the sub-agent's output as a string to be fed back as tool result.
     */
    private async handleSpawnSubAgent(
        args: Record<string, any>,
        events: AgentEvents,
        signal?: AbortSignal,
        convId?: string,
    ): Promise<string> {
        const subType = args.type || 'general';
        const task = args.task;
        if (!task) return 'Error: spawn_subagent requires a "task" argument';

        const conv = this.conversations.get(convId || this.activeId);
        const model = args.model || conv?.model || this.config.model;

        events.onReasoning(`[Sub-agent] Spawning ${subType} agent: "${task.substring(0, 80)}..."`);

        const subEvents: SubAgentEvents = {
            onStatus: (s) => events.onStatus(`[Sub-agent] ${s}`),
            onToolCallStart: (name, a) => events.onToolCallStart(`[sub] ${name}`, a),
            onToolCallEnd: (name, result, isError, elapsed) =>
                events.onToolCallEnd(`[sub] ${name}`, result, isError, elapsed),
        };

        const result = await runSubAgent(
            {
                type: subType as any,
                task,
                model,
                maxRounds: subType === 'explore' ? 5 : 10,
                worktree: args.worktree,
            },
            this.api,
            args.worktree || this.config.workspace,
            this.mcpManager,
            {
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                topP: this.config.topP,
                maxOutputLen: this.config.maxOutputLen,
                commandTimeout: this.config.commandTimeout,
                sandbox: this.config.sandbox,
                enableThinking: this.config.enableThinking,
            },
            subEvents,
            signal,
        );

        events.onReasoning(`[Sub-agent] Done: ${result.rounds} rounds, ${result.toolCalls} tool calls, ${(result.elapsed / 1000).toFixed(1)}s`);
        return result.output;
    }

    // ── TTS / Voice (stubs for future implementation) ──

    /**
     * Generate speech audio from text using the TTS model.
     * TODO: implement when MiMo TTS API is available
     */
    async ttsGenerate(text: string, options?: { voice?: string; speed?: number }): Promise<{ audioBase64: string; format: string } | null> {
        // Stub: will call MiMo TTS API when available
        console.log('[MiMo] TTS generate (stub):', text.substring(0, 50));
        return null;
    }

    /**
     * Edit/process audio with AI instructions.
     * TODO: implement when MiMo audio API is available
     */
    async audioEdit(audioData: string, instruction: string): Promise<{ audioBase64: string; format: string } | null> {
        // Stub: will call MiMo audio editing API when available
        console.log('[MiMo] Audio edit (stub):', instruction.substring(0, 50));
        return null;
    }

    /**
     * Public API: spawn a sub-agent directly (outside the tool loop).
     * Useful for programmatic use or future UI integration.
     */
    async spawnSubAgent(
        options: SubAgentOptions,
        events: SubAgentEvents = {},
        signal?: AbortSignal,
    ): Promise<SubAgentResult> {
        return runSubAgent(
            options,
            this.api,
            options.worktree || this.config.workspace,
            this.mcpManager,
            {
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                topP: this.config.topP,
                maxOutputLen: this.config.maxOutputLen,
                commandTimeout: this.config.commandTimeout,
                sandbox: this.config.sandbox,
                enableThinking: this.config.enableThinking,
            },
            events,
            signal,
        );
    }
}
