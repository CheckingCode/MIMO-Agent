import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { MiMoAgent } from '../agent';
import { AgentMode } from '../agent';
import { HistoryManager } from '../history';
import { saveSetting, getSettingsPanel, loadConfig } from '../config';
import { renderMarkdown } from '../markdown';
import { ContentPart, ChatMessage, MiMoAPI } from '../api';

/**
 * Auto-clean old plan files in ~/.mimo/plans/
 * Rules:
 *  - Max total size: 10MB
 *  - Max file count: 50
 *  - Always keep the 10 most recent files
 * Runs after each plan save; no-ops on error.
 */
function cleanOldPlans(dir: string): void {
    try {
        const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
        const MAX_COUNT = 50;
        const KEEP_RECENT = 10;

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const fp = path.join(dir, f);
                const stat = fs.statSync(fp);
                return { name: f, path: fp, size: stat.size, mtime: stat.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime); // newest first

        if (files.length <= KEEP_RECENT) return; // too few to clean

        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        const needsClean = files.length > MAX_COUNT || totalSize > MAX_SIZE_BYTES;
        if (!needsClean) return;

        // Delete oldest files (starting after KEEP_RECENT), stop when under both limits
        let freed = 0;
        let deleted = 0;
        for (let i = KEEP_RECENT; i < files.length; i++) {
            // Check after each deletion: stop when BOTH size and count are within limits
            const currentSize = totalSize - freed;
            const currentCount = files.length - deleted;
            if (currentSize <= MAX_SIZE_BYTES && currentCount <= MAX_COUNT) break;

            const f = files[i];
            try {
                fs.unlinkSync(f.path);
                freed += f.size;
                deleted++;
            } catch { /* skip files that can't be deleted (locked, permissions) */ }
        }
    } catch { /* ignore cleanup errors */ }
}

function extractText(content: string | ContentPart[] | null | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.filter(p => p.type === 'text').map(p => p.text || '').join('');
}

function extractInputHistory(messages: ChatMessage[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'user') continue;
        const text = extractText(msg.content).trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= 50) break;
    }
    return result;
}

function isPathInside(parent: string, child: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
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

function sanitizeMode(value: unknown): AgentMode | undefined {
    return value === 'auto' || value === 'polling' || value === 'plan' || value === 'adversarial' || value === 'infinite'
        ? value
        : undefined;
}

function looksLikePlanResponse(response: string): boolean {
    const text = (response || '').trim();
    if (text.length < 120) return false;
    const headings = text.match(/^#{1,3}\s+\S.+$/gm)?.length ?? 0;
    const checklist = text.match(/^\s*[-*]\s+\[[ xX]\]\s+\S/gm)?.length ?? 0;
    const numbered = text.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0;
    const lower = text.toLowerCase();
    const englishHits = [
        'implementation', 'plan', 'steps', 'tasks', 'files',
        'risks', 'validation', 'acceptance', 'execute', 'todo',
    ].filter(k => lower.includes(k)).length;
    const hasChinesePlanMarker = ['计划', '步骤', '任务', '文件', '风险', '验证', '实现', '方案']
        .some(k => text.includes(k));
    return checklist >= 2
        || numbered >= 3
        || (headings >= 2 && (englishHits > 0 || hasChinesePlanMarker))
        || (headings >= 1 && englishHits >= 2);
}

function summarizeTitleFromInput(input: string): string {
    let text = (input || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    text = text.replace(/^(请|帮我|麻烦|能不能|可以不可以|你帮我|我想|我希望|please|help me|can you|could you|i want to|i need to)\s*/i, '');
    text = text.replace(/[，。！？；:：,.!?;]+$/g, '');

    const semanticTitle = summarizeSemanticTitle(text);
    if (semanticTitle) return semanticTitle;

    const rules: Array<[RegExp, string]> = [
        [/搜(?:索|一下|一搜)?(.+?)(?:，|。|然后|并|并且|$)/, '搜索$1'],
        [/查(?:找|一下|一查)?(.+?)(?:，|。|然后|并|并且|$)/, '查找$1'],
        [/(?:修复|修一下|解决|排查)(.+?)(?:，|。|然后|并|并且|$)/, '修复$1'],
        [/(?:优化|提升|加速)(.+?)(?:，|。|然后|并|并且|$)/, '优化$1'],
        [/(?:生成|创建|新建)(.+?)(?:，|。|然后|并|并且|$)/, '生成$1'],
        [/(?:写|撰写)(.+?)(?:，|。|然后|并|并且|$)/, '写作$1'],
        [/(?:翻译)(.+?)(?:，|。|然后|并|并且|$)/, '翻译$1'],
        [/(?:总结|概括)(.+?)(?:，|。|然后|并|并且|$)/, '总结$1'],
        [/(?:解释|说明)(.+?)(?:，|。|然后|并|并且|$)/, '解释$1'],
        [/(?:对比|比较)(.+?)(?:，|。|然后|并|并且|$)/, '对比$1'],
    ];
    for (const [pattern, format] of rules) {
        const match = text.match(pattern);
        if (match?.[1]) {
            text = format.replace('$1', match[1].trim());
            break;
        }
    }

    text = text
        .replace(/(?:然后|并且|并|以此为题|作为|为我|给我).*/g, '')
        .replace(/[《》"“”'`*_#\[\]{}()（）]/g, '')
        .replace(/\s+/g, '');
    if (!text) return 'New Chat';

    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const maxLen = hasChinese ? 18 : 48;
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen);
}

function summarizeSemanticTitle(text: string): string | null {
    const clean = (text || '').trim();
    if (!clean) return null;
    const lower = clean.toLowerCase();

    const topicRules: Array<[RegExp, string]> = [
        [/\b(?:mimo|mmo\s*mimo|mmomimo)\b|米墨/i, 'MiMo'],
        [/\bvs\s*code\b|\bvscode\b/i, 'VS Code 插件'],
        [/\bwebview\b/i, 'Webview'],
        [/\bagent\b|智能体/i, 'Agent'],
        [/大模型|模型/i, '模型'],
    ];
    const issueRules: Array<[RegExp, string]> = [
        [/无限循环|死循环|循环|loop|stall|卡住|卡死|重复工具|重复调用/i, '循环防护'],
        [/标题|title|总结|摘要|summary/i, '标题总结'],
        [/上传|图片|image|vision/i, '图片处理'],
        [/stop|停止|中断|取消/i, '停止逻辑'],
        [/webview|前端|界面|ui/i, '界面体验'],
        [/报错|错误|异常|error|exception/i, '错误处理'],
    ];

    const topics = topicRules
        .filter(([pattern]) => pattern.test(clean))
        .map(([, label]) => label);
    const issues = issueRules
        .filter(([pattern]) => pattern.test(clean))
        .map(([, label]) => label);

    const uniqueTopics = Array.from(new Set(topics));
    const uniqueIssues = Array.from(new Set(issues));
    if (uniqueTopics.length === 0 && uniqueIssues.length === 0) return null;

    let action = '分析';
    if (/修复|修一下|解决|fix|repair/.test(lower)) {
        action = '修复';
    } else if (/优化|改进|提升|方案|建议|想法|optimi[sz]e|improve|proposal/.test(lower)) {
        action = '优化';
    } else if (/实现|新增|添加|create|add|implement/.test(lower)) {
        action = '实现';
    }

    const topic = uniqueTopics[0] || '';
    const issue = uniqueIssues.slice(0, 2).join('与');
    if (topic && issue) return compactTitle(`${topic} ${issue}${action}`);
    if (issue) return compactTitle(`${issue}${action}`);
    return compactTitle(`${topic}${action}`);
}

function compactTitle(title: string): string {
    const clean = title.replace(/\s+/g, ' ').trim();
    if (!clean) return 'New Chat';
    const hasChinese = /[\u4e00-\u9fff]/.test(clean);
    const maxLen = hasChinese ? 18 : 48;
    return clean.length > maxLen ? clean.slice(0, maxLen).trim() : clean;
}

function sanitizeAiTitle(raw: string, fallback: string): string {
    let title = (raw || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^["'“”‘’《》\s]+|["'“”‘’《》\s]+$/g, '')
        .replace(/^(标题|title)\s*[:：]\s*/i, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    title = title.replace(/[。！？.!?]+$/g, '').trim();
    if (!title) return fallback;
    const hasChinese = /[\u4e00-\u9fff]/.test(title);
    const maxLen = hasChinese ? 18 : 48;
    if (title.length > maxLen) title = title.slice(0, maxLen).trim();
    return title || fallback;
}

function sanitizeImages(input: unknown): Array<{ dataUrl: string; name: string; size: number }> | undefined {
    if (!Array.isArray(input)) return undefined;
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const MAX_IMAGES = 8;
    const out: Array<{ dataUrl: string; name: string; size: number }> = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const dataUrl = sanitizeString(raw.dataUrl, Math.ceil(MAX_IMAGE_BYTES * 1.4));
        if (!dataUrl || !/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) continue;
        const size = sanitizeNumber(raw.size, 0, MAX_IMAGE_BYTES) ?? 0;
        const name = sanitizeString(raw.name, 256) || 'image';
        out.push({ dataUrl, name, size });
        if (out.length >= MAX_IMAGES) break;
    }
    return out.length > 0 ? out : undefined;
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
                const profileModel = sanitizeString(raw.model, 128) || '';
                const apiKey = sanitizeString(raw.api_key, 4096) || '';
                const profileModels = Array.isArray(raw.models)
                    ? raw.models.map(v => sanitizeString(v, 128)).filter((v): v is string => !!v).slice(0, 100)
                    : [];
                if (!id || !baseUrl || !/^https?:\/\//i.test(baseUrl)) return undefined;
                return { id, name, provider, base_url: baseUrl.replace(/\/+$/, ''), model: profileModel, api_key: apiKey, models: profileModels };
            })
            .filter(Boolean)
            .slice(0, 50);
    }
    if (Array.isArray(s.models)) {
        out.models = s.models
            .map(v => sanitizeString(v, 128))
            .filter((v): v is string => !!v)
            .slice(0, 50);
    }
    const maxTokens = sanitizeNumber(s.max_tokens, 256, 65536);
    if (maxTokens !== undefined) out.max_tokens = Math.round(maxTokens);
    const temperature = sanitizeNumber(s.temperature, 0, 2);
    if (temperature !== undefined) out.temperature = temperature;
    const topP = sanitizeNumber(s.top_p, 0, 1);
    if (topP !== undefined) out.top_p = topP;
    const reasoningEffort = sanitizeString(s.reasoning_effort, 16);
    if (reasoningEffort) {
        const normalizedReasoning =
            reasoningEffort === 'off' || reasoningEffort === 'low' ? 'fast' :
            reasoningEffort === 'auto' || reasoningEffort === 'medium' ? 'balanced' :
            reasoningEffort === 'high' ? 'deep' :
            ['turbo', 'fast', 'balanced', 'deep', 'max'].includes(reasoningEffort) ? reasoningEffort : undefined;
        if (normalizedReasoning) {
            out.reasoning_effort = normalizedReasoning;
            out.enable_thinking = normalizedReasoning === 'deep' || normalizedReasoning === 'max';
        }
    }
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
    const sandboxCpu = sanitizeNumber(s.sandbox_cpu, 1, 8);
    if (sandboxCpu !== undefined) out.sandbox_cpu = Math.round(sandboxCpu);
    const sandboxMode = sanitizeString(s.sandbox_mode, 32);
    if (sandboxMode && ['safe', 'docker'].includes(sandboxMode)) out.sandbox_mode = sandboxMode;
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

function sanitizeSkill(input: unknown): { name: string; description: string; tools?: string[]; prompt: string } | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    const name = sanitizeString(raw.name, 80);
    const description = sanitizeString(raw.description, 500);
    const prompt = sanitizeString(raw.prompt, 50_000);
    if (!name || !/^[\w.-]+$/.test(name) || description === undefined || !prompt) return null;
    const tools = Array.isArray(raw.tools)
        ? raw.tools.map(v => sanitizeString(v, 80)).filter((v): v is string => !!v).slice(0, 50)
        : undefined;
    return { name, description, prompt, tools };
}

function trimWebviewToolResult(result: string, maxChars = 3_500): string {
    if (!result || result.length <= maxChars) return result || '';
    const head = result.slice(0, Math.floor(maxChars * 0.7));
    const tail = result.slice(-Math.floor(maxChars * 0.25));
    return `${head}\n\n... output truncated for Webview responsiveness (${result.length} chars). Showing head and tail only. ...\n\n${tail}`;
}

function createReasoningPostQueue(post: (msg: any) => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let buffer = '';
    const MAX_BUFFER_CHARS = 6_000;

    const flush = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (!buffer) return;
        const token = buffer;
        buffer = '';
        post({ type: 'reasoning', token });
    };

    return {
        push(token: string) {
            if (!token) return;
            buffer += token;
            if (buffer.length > MAX_BUFFER_CHARS) {
                buffer = buffer.slice(-MAX_BUFFER_CHARS);
            }
            if (buffer.length >= 1_500) {
                flush();
                return;
            }
            if (!timer) {
                timer = setTimeout(flush, 900);
            }
        },
        flush,
        cancel() {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
            buffer = '';
        },
    };
}

function createStreamingRenderQueue(post: (msg: any) => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastText = '';
    let lastRenderedText = '';

    const renderNow = (text: string) => {
        if (text === lastRenderedText) return;
        lastRenderedText = text;
        try {
            post({ type: 'streamHtml', html: renderMarkdown(text) });
        } catch (e: any) {
            post({ type: 'error', error: `Render failed: ${e?.message || String(e)}` });
        }
    };

    return {
        schedule(text: string) {
            lastText = text;
            if (timer) return;
            const delay = text.length > 30_000 ? 1800 : text.length > 12_000 ? 1000 : 500;
            timer = setTimeout(() => {
                timer = undefined;
                renderNow(lastText);
            }, delay);
        },
        flush(text?: string) {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
            renderNow(text ?? lastText);
        },
        cancel() {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
        },
    };
}

function renderAssistantMarkdown(post: (msg: any) => void, type: 'assistantUpdate' | 'finalAnswer', text: string): void {
    if (!text.trim()) return;
    try {
        post({ type, html: renderMarkdown(text) });
    } catch (e: any) {
        post({ type: 'error', error: `Render failed: ${e?.message || String(e)}` });
    }
}

interface TurnChangeFile {
    path: string;
    added: number;
    removed: number;
    action?: string;
    source?: 'tool';
    hasToolDiff?: boolean;
}

interface TurnChangeTracker {
    files: Map<string, TurnChangeFile>;
}

interface PanelState {
    panel: vscode.WebviewPanel;
    convId: string;        // initial conversation ID (for init)
    convIds: string[];     // all conversation IDs belonging to this panel
    activeConvId: string;  // currently active conversation in THIS panel
    pendingInit?: { firstId: string; fresh: boolean };
    activeHandlers?: any;
    /** Message queue: messages sent while agent is running */
    messageQueue: Array<{ text: string; images?: Array<{ dataUrl: string; name: string; size: number }> }>;
    /** Voice input state 鈥?per-panel */
    voiceProcess?: ReturnType<typeof exec> | null;
    voiceResultFile?: string;
    voicePsFile?: string;
    /** Track whether initial restore has been done (avoid full replay on every visibility change) */
    restored?: boolean;
    /** Plan mode: per-panel plan file path and ID */
    planPath?: string;
    planId?: string;
}

interface SerializedChatPanelState {
    kind?: string;
    convIds?: string[];
    activeConvId?: string;
}

export class ChatViewProvider {
    private panels = new Map<string, PanelState>();
    private panel?: vscode.WebviewPanel;  // current/active panel reference
    private agent: MiMoAgent;
    private history: HistoryManager;
    private cssContent: string = '';
    private replaySeq = 0;
    private pendingHistorySaves = new Map<string, {
        title: string;
        messages: ChatMessage[];
        model: string;
        metadata: Partial<Pick<import('../history').HistoryConversation, 'mode' | 'personaId' | 'activeSkillPrompt' | 'inputHistory' | 'modelEndpointId'>>;
    }>();
    private historySaveTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        agent: MiMoAgent,
        private readonly windowSessionId?: string,
    ) {
        this.agent = agent;
        this.history = new HistoryManager(loadConfig().workspace, windowSessionId);
        this.loadCss();
    }

    private queueHistorySave(
        id: string,
        title: string,
        messages: ChatMessage[],
        model: string,
        metadata: Partial<Pick<import('../history').HistoryConversation, 'mode' | 'personaId' | 'activeSkillPrompt' | 'inputHistory' | 'modelEndpointId'>> = {},
    ): void {
        this.pendingHistorySaves.set(id, { title, messages, model, metadata });
        if (this.historySaveTimer) return;
        this.historySaveTimer = setTimeout(() => {
            this.historySaveTimer = undefined;
            const saves = Array.from(this.pendingHistorySaves.entries());
            this.pendingHistorySaves.clear();
            setImmediate(() => {
                for (const [convId, save] of saves) {
                    try {
                        this.history.save(convId, save.title, save.messages, save.model, save.metadata);
                    } catch {
                        // Best effort; UI responsiveness matters more than history persistence.
                    }
                }
            });
        }, 1200);
    }

    private historyMetadata(conv: import('../agentTypes').ConversationState): Partial<Pick<import('../history').HistoryConversation, 'mode' | 'personaId' | 'activeSkillPrompt' | 'modelEndpointId'>> {
        return {
            mode: conv.mode,
            personaId: conv.personaId,
            activeSkillPrompt: conv.activeSkillPrompt,
            modelEndpointId: conv.modelEndpointId,
        };
    }

    private attachUiSnapshot(convId: string, snapshot: any): void {
        if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.assistantHtml !== 'string') return;
        if (snapshot.assistantHtml.length > 750_000) return;
        const messages = this.agent.getMessages(convId);
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                messages[i]._uiSnapshot = snapshot;
                return;
            }
        }
    }

    flushHistorySaves(): void {
        if (this.historySaveTimer) {
            clearTimeout(this.historySaveTimer);
            this.historySaveTimer = undefined;
        }
        const saves = Array.from(this.pendingHistorySaves.entries());
        this.pendingHistorySaves.clear();
        for (const [convId, save] of saves) {
            try {
                this.history.save(convId, save.title, save.messages, save.model, save.metadata);
            } catch {
                // Best effort during shutdown.
            }
        }
    }

    refreshModelLists(): void {
        const models = this.agent.getModelOptions();
        for (const st of this.panels.values()) {
            const panel = st.panel;
            const current = this.agent.getModelSelectionValue(st.activeConvId);
            panel.webview.postMessage({ type: 'modelList', models, current });
            panel.webview.postMessage({ type: 'modelCaps', caps: this.agent.getModelCapabilities(current) });
            panel.webview.postMessage({ type: 'settingsData', settings: getSettingsPanel() });
        }
    }

    setModelForOpenPanels(model: string): void {
        for (const st of this.panels.values()) {
            if (st.activeConvId) this.agent.setModel(model, st.activeConvId);
        }
        this.refreshModelLists();
    }

    private modelListMessage(convId: string): { type: 'modelList'; models: any[]; current: string } {
        return {
            type: 'modelList',
            models: this.agent.getModelOptions(),
            current: this.agent.getModelSelectionValue(convId),
        };
    }

    private loadCss(): void {
        try {
            const cssPath = path.join(this.extensionUri.fsPath, 'out', 'webview', 'styles.css');
            this.cssContent = fs.readFileSync(cssPath, 'utf-8');
        } catch {
            try {
                const cssPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'styles.css');
                this.cssContent = fs.readFileSync(cssPath, 'utf-8');
            } catch {
                this.cssContent = '/* CSS not found */';
            }
        }
    }

    private async generateAiTitle(input: string): Promise<string | null> {
        const cfg = loadConfig();
        if (!cfg.apiKey || !cfg.baseUrl) return null;
        const fallback = summarizeTitleFromInput(input);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
            const api = new MiMoAPI(cfg.apiKey, cfg.baseUrl);
            const result = await api.chatCompletion({
                model: 'mimo-v2',
                messages: [
                    {
                        role: 'system',
                        content: [
                            'You generate concise chat titles.',
                            'Return only one title, no quotes, no explanation.',
                            'Prefer the pattern: subject + core problem + action.',
                            'Chinese input: 8 to 18 Chinese characters.',
                            'English input: 3 to 6 words.',
                            'Do not copy filler like "help me", "can you", "what do you think", or screenshot labels.',
                            'Do not mention files unless they are the main topic.',
                        ].join(' '),
                    },
                    {
                        role: 'user',
                        content: `Create a concise title for this user request:\n\n${input.slice(0, 1800)}`,
                    },
                ],
                max_tokens: 32,
                temperature: 0.2,
                top_p: 0.8,
                stream_options: null,
                extra_body: { thinking: { type: 'disabled' } },
            }, controller.signal);
            const title = sanitizeAiTitle(result, fallback);
            return title && title !== 'New Chat' ? title : null;
        } catch (e) {
            console.warn('[MiMo] AI title generation failed:', e);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    private scheduleAiTitle(
        activeId: string,
        panel: vscode.WebviewPanel,
        text: string,
        fallbackTitle: string,
    ): void {
        this.generateAiTitle(text).then((title) => {
            if (!title || title === fallbackTitle) return;
            const conv = this.agent.getConversation(activeId);
            if (!conv || conv.title !== fallbackTitle) return;
            conv.title = title;
            const st = this.findStateByPanel(panel);
            panel.webview.postMessage({ type: 'tabList', tabs: this.getTabList(st?.convIds, activeId), activeId });
            panel.title = title;
            panel.webview.postMessage({ type: 'convTitle', title, convId: activeId });
            try {
                const msgs = this.agent.getMessages(activeId);
                this.queueHistorySave(activeId, conv.title, msgs, conv.model, this.historyMetadata(conv));
            } catch { /* best effort only */ }
        });
    }

    /** Create a new MIMO panel (always creates fresh) */
    show(_forceNew = true) {
        // Always create new panel 鈥?each click = new window
        const splitEditor = this.panels.size === 0;
        this.createPanel(splitEditor);
    }

    restorePanel(panel: vscode.WebviewPanel, state: unknown): void {
        this.createPanel(false, panel, this.sanitizeSerializedPanelState(state));
    }

    private sanitizeSerializedPanelState(state: unknown): SerializedChatPanelState | undefined {
        if (!state || typeof state !== 'object') return undefined;
        const raw = state as Record<string, unknown>;
        const convIds = Array.isArray(raw.convIds)
            ? raw.convIds
                .map(id => sanitizeString(id, 120))
                .filter((id): id is string => !!id)
                .slice(0, 20)
            : [];
        const activeConvId = sanitizeString(raw.activeConvId, 120);
        if (convIds.length === 0 && !activeConvId) return undefined;
        return {
            kind: sanitizeString(raw.kind, 40),
            convIds,
            activeConvId,
        };
    }

    private ensureRestoredConversation(id: string): boolean {
        if (!id) return false;
        if (this.agent.getConversation(id)) return true;
        const histConv = this.history.load(id);
        if (!histConv) return false;
        this.agent.loadConversation(id, histConv.title, histConv.messages, histConv.model, {
            mode: sanitizeMode(histConv.mode),
            personaId: histConv.personaId,
            activeSkillPrompt: histConv.activeSkillPrompt,
            modelEndpointId: histConv.modelEndpointId,
        });
        return true;
    }

    private resolveRestoredConversationIds(restored?: SerializedChatPanelState): { convIds: string[]; activeConvId: string; fresh: boolean } {
        const requested = Array.from(new Set([
            ...(restored?.convIds || []),
            restored?.activeConvId || '',
        ].filter(Boolean)));
        const convIds = requested.filter(id => this.ensureRestoredConversation(id));
        let activeConvId = restored?.activeConvId && convIds.includes(restored.activeConvId)
            ? restored.activeConvId
            : convIds[0];
        if (!activeConvId) {
            activeConvId = this.agent.createConversation();
            convIds.push(activeConvId);
            return { convIds, activeConvId, fresh: true };
        }
        return { convIds, activeConvId, fresh: false };
    }

    private createPanel(
        splitEditor = false,
        restoredPanel?: vscode.WebviewPanel,
        restoredState?: SerializedChatPanelState,
    ): string {
        const panelId = `mimo-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const restored = this.resolveRestoredConversationIds(restoredState);
        const convId = restored.activeConvId;

        const column = splitEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
        const panel = restoredPanel || vscode.window.createWebviewPanel(
            'mimo-agent.chat',
            'MiMo Chat',
            { viewColumn: column, preserveFocus: false },
            {
                enableScripts: true,
                localResourceRoots: [this.extensionUri],
                retainContextWhenHidden: true,
            },
        );
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'mimo-agent-icon.svg');
        const activeConv = this.agent.getConversation(convId);
        if (activeConv) panel.title = activeConv.title;

        // Track this panel
        const state: PanelState = { panel, convId, convIds: restored.convIds, activeConvId: convId, messageQueue: [] };
        this.panels.set(panelId, state);

        // Update current panel references
        this.panel = panel;
        state.pendingInit = { firstId: convId, fresh: restored.fresh };

        // On panel close 鈥?remove from map
        panel.onDidDispose(() => {
            this.panels.delete(panelId);
            if (this.panel === panel) this.panel = undefined;
        }, null, []);

        panel.webview.html = this.getHtml(panel.webview);

        // Handle visibility changes 鈥?restore state when panel is shown again
        panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.visible) {
                // restoreStateToWebview already posts busy/idle + history
                this.restoreStateToWebview(panel);
            }
        });

        // Handle messages from webview 鈥?capture panelId and convId in closure
        panel.webview.onDidReceiveMessage(async (msg) => {
            const post = (m: any) => panel.webview.postMessage(m);

            switch (msg.type) {
                case 'ready': {
                    const initialLang = vscode.env.language.startsWith('zh') ? 'zh' : 'en';
                    post({ type: 'setLang', lang: initialLang });

                    // ALWAYS initialize 鈥?no dependency on pendingInit
                    const st = this.panels.get(panelId);
                    let myConvId = st?.activeConvId;
                    if (!myConvId) break;
                    this.agent.setUiLang(initialLang, myConvId);
                    console.log(`[MiMo] ready: panelId=${panelId}, myConvId=${myConvId}, convCount=${this.agent.getConversation(myConvId)?.messages.length ?? 'N/A'}`);

                    // 1. Verify conversation exists 鈥?if not, create fresh one
                    let initConv = this.agent.getConversation(myConvId);
                    if (!initConv && st) {
                        // Conversation was lost 鈥?create fresh one for this panel
                        const freshId = this.agent.createConversation();
                        st.convIds = [freshId];
                        st.activeConvId = freshId;
                        initConv = this.agent.getConversation(freshId);
                        myConvId = freshId;
                    }

                    // 2. Tab list + title
                    post({ type: 'tabList', tabs: this.getTabList(st?.convIds, myConvId), activeId: myConvId });
                    if (initConv) post({ type: 'convTitle', title: initConv.title, convId: myConvId });

                    // 2. API key check
                    if (!this.agent.hasApiKey()) {
                        post({ type: 'error', error: 'API key is not configured. Set mimo.apiKey in VS Code settings or api.api_key in ~/.mimo/settings.json.' });
                    }

                    // 3. Model info
                    const model = this.agent.getModelSelectionValue(myConvId);
                    post(this.modelListMessage(myConvId));
                    post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(model) });

                    // 4. Skills
                    post({
                        type: 'skillList',
                        skills: this.agent.getSkills().map(s => ({
                            name: s.name,
                            description: s.description,
                            source: s.source,
                        })),
                    });

                    // 5. Restore conversation if it has messages (full replay with reasoning, tool cards, etc.)
                    if (initConv && initConv.messages.length > 0) {
                        post({ type: 'clearMessages' });
                        this.replayConversation(initConv.messages);
                        post({ type: 'restoreMode', mode: initConv.mode, label: initConv.mode });
                    }

                    // 6. Consume pendingInit (cleanup)
                    if (st?.pendingInit && st.pendingInit.firstId === myConvId) {
                        st.pendingInit = undefined;
                    }

                    // 7. History list
                    post({ type: 'historyList', items: this.history.list() });
                    break;
                }
                case 'newChat': {
                    // Open a new editor panel with a fresh conversation
                    vscode.commands.executeCommand('mimo-agent.newChat');
                    break;
                }
                case 'switchChat': {
                    this.agent.switchConversation(msg.id);
                    const conv = this.agent.getConversation(msg.id);
                    const st2 = this.panels.get(panelId);
                    // Update this panel's active conversation
                    if (st2) st2.activeConvId = msg.id;
                    post({ type: 'tabList', tabs: this.getTabList(st2?.convIds), activeId: msg.id });
                    post({ type: 'clearMessages' });
                    if (conv) {
                        this.replayConversation(conv.messages, panel);
                        post(this.modelListMessage(msg.id));
                        post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(this.agent.getModelSelectionValue(msg.id)) });
                        post({ type: 'restoreMode', mode: conv.mode, label: conv.mode });
                        // Restore busy state (only if THIS conversation is running)
                        post(this.agent.isConvRunning(msg.id) ? { type: 'busy' } : { type: 'idle' });
                    }
                    break;
                }
                case 'closeChat': {
                    // Don't delete 鈥?just switch to another conversation in THIS panel
                    const st3 = this.panels.get(panelId);
                    if (st3) {
                        // Remove from panel's conversation list
                        st3.convIds = st3.convIds.filter(id => id !== msg.id);
                        // Switch to remaining conversation or create new one
                        const nextId = st3.convIds.length > 0
                            ? st3.convIds[st3.convIds.length - 1]
                            : this.agent.createConversation();
                        if (!st3.convIds.includes(nextId)) st3.convIds.push(nextId);
                        st3.activeConvId = nextId;

                        post({ type: 'tabList', tabs: this.getTabList(st3.convIds), activeId: nextId });
                        const nextConv = this.agent.getConversation(nextId);
                        if (nextConv) {
                            post({ type: 'clearMessages' });
                            this.replayConversation(nextConv.messages, panel);
                            post(this.modelListMessage(nextId));
                            post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(this.agent.getModelSelectionValue(nextId)) });
                            post({ type: 'restoreMode', mode: nextConv.mode, label: nextConv.mode });
                        }
                    }
                    break;
                }
                case 'renameChat': {
                    this.agent.setTitle(msg.id, msg.title);
                    const st4 = this.panels.get(panelId);
                    post({ type: 'tabList', tabs: this.getTabList(st4?.convIds), activeId: st4?.activeConvId });
                    // Sync title to header input and panel tab
                    if (st4 && msg.id === st4.activeConvId) {
                        panel.title = msg.title;
                        panel.webview.postMessage({ type: 'convTitle', title: msg.title, convId: msg.id });
                    }
                    // Sync title to history
                    try {
                        const conv4 = this.agent.getConversation(msg.id);
                        if (conv4) {
                            this.queueHistorySave(msg.id, msg.title, conv4.messages, conv4.model, this.historyMetadata(conv4));
                        }
                    } catch { /* ignore */ }
                    break;
                }
                case 'send': {
                    const st = this.panels.get(panelId);
                    const sendConvId = st?.activeConvId || convId;
                    const text = sanitizeString(msg.text, 200_000) || '';
                    const images = sanitizeImages(msg.images);
                    if (!text && !images?.length) break;
                    if (this.agent.isConvBusy(sendConvId)) {
                        post({ type: 'system', text: 'A message is already running. Wait for it to finish or press Stop before sending another message.' });
                        post({ type: 'clearQueue' });
                    } else {
                        await this.handleUserMessage(text, images, sendConvId, panel);
                    }
                    break;
                }
                case 'interruptAndSend': {
                    const st = this.panels.get(panelId);
                    const sendConvId = st?.activeConvId || convId;
                    const text = sanitizeString(msg.text, 200_000) || '';
                    const images = sanitizeImages(msg.images);
                    if (!text && !images?.length) break;
                    if (st) st.messageQueue = [];

                    if (this.agent.isConvBusy(sendConvId)) {
                        post({ type: 'system', text: vscode.env.language.startsWith('zh') ? '正在中断当前任务，并切换到选中的排队消息...' : 'Interrupting the current run and switching to the selected queued message...' });
                        this.agent.abort(sendConvId);
                        const idle = await this.waitForConversationIdle(sendConvId, 10_000);
                        if (!idle) {
                            post({ type: 'system', text: vscode.env.language.startsWith('zh') ? '当前任务仍在收尾，稍后再试。' : 'The current run is still winding down. Try again shortly.' });
                            break;
                        }
                    }

                    await this.handleUserMessage(text, images, sendConvId, panel);
                    break;
                }
                case 'setUiLang': {
                    const stLang = this.panels.get(panelId);
                    const lang = msg.lang === 'en' ? 'en' : 'zh';
                    this.agent.setUiLang(lang, stLang?.activeConvId || convId);
                    break;
                }
                case 'clear': {
                    const stClear = this.panels.get(panelId);
                    this.agent.reset(stClear?.activeConvId);
                    post({ type: 'clearMessages' });
                    break;
                }
                case 'skill': {
                    const stSkill = this.panels.get(panelId);
                    await this.handleSkillInvocation(msg.skill, msg.text, stSkill?.activeConvId, panel);
                    break;
                }
                case 'setModel': {
                    const stModel = this.panels.get(panelId);
                    const modelConvId = stModel?.activeConvId;
                    this.agent.setModel(msg.model, modelConvId);
                    if (modelConvId) post(this.modelListMessage(modelConvId));
                    post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(msg.model) });
                    break;
                }
                case 'setMode': {
                    const stMode = this.panels.get(panelId);
                    this.agent.setMode(msg.mode, stMode?.activeConvId);
                    post({ type: 'modeSwitched', mode: msg.mode });
                    break;
                }
                case 'stop': {
                    const stStop = this.panels.get(panelId);
                    // Immediately update UI 鈥?don't wait for agent to finish
                    post({ type: 'idle' });
                    // Clear message queue so queued messages don't auto-send
                    if (stStop) stStop.messageQueue = [];
                    // Clear webview queue display too
                    post({ type: 'clearQueue' });
                    // Abort the agent 鈥?only if we have a valid convId
                    if (stStop?.activeConvId) {
                        this.agent.abort(stStop.activeConvId);
                    }
                    break;
                }
                case 'editConfirm':
                    this.agent.confirmEdit(msg.previewId, true);
                    break;
                case 'editReject':
                    this.agent.confirmEdit(msg.previewId, false);
                    break;
                case 'writeConfirm':
                    this.agent.confirmWrite(msg.previewId, true, msg.newPath);
                    break;
                case 'writeReject':
                    this.agent.confirmWrite(msg.previewId, false);
                    break;
                case 'askUserConfirm':
                    this.agent.confirmAskUser(msg.previewId, msg.answer);
                    break;
                case 'taskChangesUndo': {
                    const result = await this.agent.undoWorkspaceChanges(String(msg.patch || ''));
                    post({ type: 'taskChangesUndoResult', id: msg.id, ...result });
                    if (result.ok) {
                        const summary = await this.agent.getWorkspaceChangeSummary();
                        post({ type: 'taskChangesRefresh', summary });
                    }
                    break;
                }
                case 'historySnapshot': {
                    const stSnap = this.panels.get(panelId);
                    const snapConvId = stSnap?.activeConvId || convId;
                    const convSnap = this.agent.getConversation(snapConvId);
                    if (convSnap) {
                        this.attachUiSnapshot(snapConvId, msg.snapshot);
                        this.queueHistorySave(snapConvId, convSnap.title, convSnap.messages, convSnap.model, this.historyMetadata(convSnap));
                    }
                    break;
                }
                case 'planConfirm': {
                    const stPlan = this.panels.get(panelId);
                    this.agent.confirmPlan(true, stPlan?.activeConvId);
                    post({ type: 'system', text: vscode.env.language.startsWith('zh') ? '计划已确认，开始执行...' : 'Plan confirmed. Starting execution...' });
                    const planRef = stPlan?.planPath
                        ? `Read the plan file ${stPlan.planPath} and execute the plan.`
                        : 'Execute the confirmed plan.';
                    await this.handleUserMessage(planRef, [], stPlan?.activeConvId || convId, panel);
                    break;
                }
                case 'planReject': {
                    const stReject = this.panels.get(panelId);
                    this.agent.confirmPlan(false, stReject?.activeConvId);
                    post({ type: 'system', text: vscode.env.language.startsWith('zh') ? '计划已拒绝，请重新描述需求。' : 'Plan rejected. Please describe the requirement again.' });
                    break;
                }
                case 'planModify': {
                    const stMod = this.panels.get(panelId);
                    this.agent.confirmPlan(false, stMod?.activeConvId);
                    post({ type: 'system', text: `Plan modification requested: ${msg.feedback}` });
                    await this.handleUserMessage(
                        `Please revise the plan based on this feedback:\n\n${msg.feedback}\n\nAnalyze the requirement again and output the revised plan.`,
                        [], stMod?.activeConvId || convId, panel
                    );
                    break;
                }
                case 'historyList':
                    post({ type: 'historyList', items: this.history.list() });
                    break;
                case 'historyLoad': {
                    const histConv = this.history.load(msg.id);
                    if (histConv) {
                        const id = histConv.id;

                        // Check if this conversation is already open in any panel
                        let foundPanel: PanelState | null = null;
                        for (const [, st] of this.panels) {
                            if (st.convIds.includes(id)) {
                                foundPanel = st;
                                break;
                            }
                        }

                        if (foundPanel) {
                            // Already open 鈥?just reveal/focus that panel
                            foundPanel.panel.reveal(vscode.ViewColumn.Active, false);
                            this.agent.loadConversation(id, histConv.title, histConv.messages, histConv.model, {
                                mode: sanitizeMode(histConv.mode),
                                personaId: histConv.personaId,
                                activeSkillPrompt: histConv.activeSkillPrompt,
                                modelEndpointId: histConv.modelEndpointId,
                            });
                            foundPanel.activeConvId = id;
                            foundPanel.panel.title = histConv.title;
                            foundPanel.panel.webview.postMessage({ type: 'tabList', tabs: this.getTabList(foundPanel.convIds, foundPanel.activeConvId), activeId: id });
                            foundPanel.panel.webview.postMessage({ type: 'convTitle', title: histConv.title, convId: id });
                            foundPanel.panel.webview.postMessage({ type: 'clearMessages' });
                            this.replayConversation(histConv.messages, foundPanel.panel);
                            foundPanel.panel.webview.postMessage(this.modelListMessage(id));
                            foundPanel.panel.webview.postMessage({ type: 'modelCaps', caps: this.agent.getModelCapabilities(this.agent.getModelSelectionValue(id)) });
                            foundPanel.panel.webview.postMessage({ type: 'restoreMode', mode: histConv.mode || 'auto', label: histConv.mode || 'auto' });
                            foundPanel.panel.webview.postMessage({ type: 'restoreInputHistory', items: histConv.inputHistory || extractInputHistory(histConv.messages) });
                        } else {
                            // Not open 鈥?create a NEW panel (don't touch current one)
                            const newPanelId = this.createPanel(false);
                            const newState = this.panels.get(newPanelId)!;
                            this.agent.loadConversation(id, histConv.title, histConv.messages, histConv.model, {
                                mode: sanitizeMode(histConv.mode),
                                personaId: histConv.personaId,
                                activeSkillPrompt: histConv.activeSkillPrompt,
                                modelEndpointId: histConv.modelEndpointId,
                            });
                            newState.convIds.push(id);
                            newState.activeConvId = id;
                            newState.panel.title = histConv.title;
                            newState.panel.webview.postMessage({ type: 'tabList', tabs: this.getTabList(newState.convIds, newState.activeConvId), activeId: id });
                            newState.panel.webview.postMessage({ type: 'convTitle', title: histConv.title, convId: id });
                            newState.panel.webview.postMessage({ type: 'clearMessages' });
                            this.replayConversation(histConv.messages, newState.panel);
                            newState.panel.webview.postMessage(this.modelListMessage(id));
                            newState.panel.webview.postMessage({ type: 'modelCaps', caps: this.agent.getModelCapabilities(this.agent.getModelSelectionValue(id)) });
                            newState.panel.webview.postMessage({ type: 'restoreMode', mode: histConv.mode || 'auto', label: histConv.mode || 'auto' });
                            newState.panel.webview.postMessage({ type: 'restoreInputHistory', items: histConv.inputHistory || extractInputHistory(histConv.messages) });
                        }
                    }
                    break;
                }
                case 'historyDelete':
                    this.history.delete(msg.id);
                    post({ type: 'historyList', items: this.history.list() });
                    break;
                case 'historySearch': {
                    const results = this.history.search(msg.query || '');
                    post({ type: 'historyList', items: results });
                    break;
                }
                case 'exportMarkdown': {
                    const conv = this.history.load(msg.id);
                    if (conv) {
                        const md = this.history.exportMarkdown(conv);
                        if (md) {
                            post({ type: 'exportResult', format: 'markdown', content: md, title: conv.title });
                        }
                    }
                    break;
                }
                case 'exportJson': {
                    const conv = this.history.load(msg.id);
                    if (conv) {
                        const json = this.history.exportJson(conv);
                        if (json) {
                            post({ type: 'exportResult', format: 'json', content: json, title: conv.title });
                        }
                    }
                    break;
                }
                case 'exportAllJson': {
                    const allJson = this.history.exportAllJson();
                    post({ type: 'exportResult', format: 'json', content: allJson, title: 'All_Conversations' });
                    break;
                }
                case 'getSettings':
                    post({ type: 'settingsData', settings: getSettingsPanel() });
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('mimo-agent.settings');
                    break;
                case 'saveSettings': {
                    const s = sanitizeSettings(msg.settings);
                    if (s.api_key !== undefined) saveSetting('api.api_key', s.api_key);
                    if (s.base_url !== undefined) saveSetting('api.base_url', s.base_url);
                    if (s.model !== undefined) saveSetting('api.model', s.model);
                    if (s.models !== undefined) saveSetting('api.models', s.models);
                    if (s.active_provider_profile !== undefined) saveSetting('api.active_provider_profile', s.active_provider_profile);
                    if (s.active_route !== undefined) saveSetting('api.active_route', s.active_route);
                    if (s.provider_profiles !== undefined) saveSetting('api.provider_profiles', s.provider_profiles);
                    if (s.max_tokens !== undefined) saveSetting('agent.max_tokens', s.max_tokens);
                    if (s.temperature !== undefined) saveSetting('agent.temperature', s.temperature);
                    if (s.top_p !== undefined) saveSetting('agent.top_p', s.top_p);
                    if (s.reasoning_effort !== undefined) saveSetting('agent.reasoning_effort', s.reasoning_effort);
                    if (s.enable_thinking !== undefined) saveSetting('agent.enable_thinking', s.enable_thinking);
                    if (s.max_output_len !== undefined) saveSetting('safety.max_output_len', s.max_output_len);
                    if (s.command_timeout !== undefined) saveSetting('safety.command_timeout', s.command_timeout);
                    if (s.sandbox_enabled !== undefined) saveSetting('sandbox.enabled', s.sandbox_enabled);
                    if (s.sandbox_mode !== undefined) saveSetting('sandbox.mode', s.sandbox_mode);
                    if (s.sandbox_image !== undefined) saveSetting('sandbox.image', s.sandbox_image);
                    if (s.sandbox_memory !== undefined) saveSetting('sandbox.memory_limit', s.sandbox_memory);
                    if (s.sandbox_cpu !== undefined) saveSetting('sandbox.cpu_limit', s.sandbox_cpu);
                    if (s.sandbox_git_snapshot !== undefined) saveSetting('sandbox.git_snapshot', s.sandbox_git_snapshot);
                    if (s.sandbox_logging !== undefined) saveSetting('sandbox.logging', s.sandbox_logging);
                    if (s.sandbox_network_disabled !== undefined) saveSetting('sandbox.network_disabled', s.sandbox_network_disabled);
                    if (s.dependency_install_enabled !== undefined) saveSetting('dependency_install.enabled', s.dependency_install_enabled);
                    if (s.dependency_install_project_mode !== undefined) saveSetting('dependency_install.project_mode', s.dependency_install_project_mode);
                    if (s.dependency_install_system_mode !== undefined) saveSetting('dependency_install.system_mode', s.dependency_install_system_mode);
                    if (s.dependency_install_long_timeout_sec !== undefined) saveSetting('dependency_install.long_timeout_sec', s.dependency_install_long_timeout_sec);
                    if (s.memory_enabled !== undefined) saveSetting('memory.enabled', s.memory_enabled);
                    if (s.memory_learn_from_explicit_preferences !== undefined) saveSetting('memory.learn_from_explicit_preferences', s.memory_learn_from_explicit_preferences);
                    if (s.memory_max_items !== undefined) saveSetting('memory.max_items', s.memory_max_items);
                    if (s.memory_max_injected !== undefined) saveSetting('memory.max_injected', s.memory_max_injected);
                    // Hot-reload: re-read config and update agent in memory
                    const newConfig = loadConfig();
                    this.agent.updateConfig(newConfig);
                    this.refreshModelLists();
                    if (!msg.silent) {
                        post({ type: 'system', text: vscode.env.language.startsWith('zh') ? '设置已保存并生效。' : 'Settings saved and applied.' });
                    }
                    post({ type: 'settingsData', settings: getSettingsPanel() });
                    break;
                }
                case 'openUrl': {
                    // Open URL in default browser 鈥?only allow http(s) protocols
                    try {
                        const rawUrl = sanitizeString(msg.url, 2048);
                        if (!rawUrl) break;
                        const parsed = vscode.Uri.parse(rawUrl, true);
                        if (parsed.scheme === 'http' || parsed.scheme === 'https') {
                            await vscode.env.openExternal(parsed);
                        }
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`Cannot open URL: ${e.message}`);
                    }
                    break;
                }
                case 'openFile': {
                    // Open file in VSCode editor (optionally in split column)
                    try {
                        let filePath = sanitizeString(msg.path, 4096);
                        if (!filePath) break;
                        const line = sanitizeNumber(msg.line, 1, 1_000_000) || 1;
                        // Resolve relative paths against workspace
                        if (filePath && !filePath.match(/^[A-Z]:\\/i) && !filePath.startsWith('/')) {
                            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                            if (workspace) {
                                filePath = path.join(workspace, filePath);
                            }
                        }
                        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                        const mimoPlansDir = path.join(os.homedir(), '.mimo', 'plans');
                        const allowOutsideWorkspace = isPathInside(mimoPlansDir, filePath);
                        if (workspace && !allowOutsideWorkspace && !isPathInside(workspace, filePath)) {
                            vscode.window.showWarningMessage('Cannot open file outside the current workspace.');
                            post({ type: 'fileOpenResult', path: msg.path, ok: false, error: 'outside_workspace' });
                            break;
                        }
                        const uri = vscode.Uri.file(filePath);
                        const position = new vscode.Position(Math.max(0, line - 1), 0);
                        const range = new vscode.Range(position, position);
                        const column = msg.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
                        await vscode.window.showTextDocument(uri, { selection: range, viewColumn: column });
                        post({ type: 'fileOpenResult', path: msg.path, ok: true });
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`Cannot open file: ${e.message}`);
                        post({ type: 'fileOpenResult', path: msg.path, ok: false, error: e.message });
                    }
                    break;
                }
                // 鈹€鈹€ Skill management 鈹€鈹€
                case 'skillList':
                    post({
                        type: 'skillList',
                        skills: this.agent.getSkills().map(s => ({
                            name: s.name,
                            description: s.description,
                            source: s.source,
                        })),
                    });
                    break;
                case 'skillSave': {
                    const skill = sanitizeSkill(msg.skill);
                    const ok = skill ? this.agent.saveSkill(skill) : false;
                    post({ type: 'system', text: ok ? `Skill "${skill!.name}" saved.` : 'Failed to save skill.' });
                    post({
                        type: 'skillList',
                        skills: this.agent.getSkills().map(s => ({
                            name: s.name,
                            description: s.description,
                            source: s.source,
                        })),
                    });
                    break;
                }
                case 'skillDelete': {
                    const name = sanitizeString(msg.name, 80);
                    const ok = !!name && this.agent.deleteSkill(name);
                    post({ type: 'system', text: ok ? `Skill "${name}" deleted.` : 'Failed to delete skill.' });
                    post({
                        type: 'skillList',
                        skills: this.agent.getSkills().map(s => ({
                            name: s.name,
                            description: s.description,
                            source: s.source,
                        })),
                    });
                    break;
                }
                case 'voiceInput': {
                    // Start continuous PowerShell speech recognition (manual stop)
                    const ps1 = path.join(os.tmpdir(), 'mimo_voice.ps1');
                    const resultFile = path.join(os.tmpdir(), 'mimo_voice_result.txt');
                    try { fs.unlinkSync(resultFile); } catch { /* ignore */ }
                    // Escape single quotes for PowerShell string literal safety
                    const safeResultPath = resultFile.replace(/\\/g, '\\\\').replace(/'/g, "''");
                    fs.writeFileSync(ps1, `Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognizer
$rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Continuous)
$rec.add_FrameStateChanged({
    param($s,$e)
    if ($e.FrameState -eq [System.Speech.Recognition.SpeechRecognizerState]::Listening) {
        "Listening..." | Out-File -FilePath '${safeResultPath}' -Encoding utf8
    }
})
$rec.add_SpeechRecognized({
    param($s,$e)
    if ($e.Result.Text) {
        $e.Result.Text | Out-File -FilePath '${safeResultPath}' -Append -Encoding utf8
    }
})
while ($true) { Start-Sleep -Milliseconds 100 }
`);
                    const ps = exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { windowsHide: true });
                    const stVoice = this.panels.get(panelId);
                    if (stVoice) {
                        stVoice.voiceProcess = ps;
                        stVoice.voiceResultFile = resultFile;
                        stVoice.voicePsFile = ps1;
                    }
                    break;
                }
                case 'voiceStop': {
                    // Stop recording and return accumulated text
                    const stVoiceStop = this.panels.get(panelId);
                    if (stVoiceStop?.voiceProcess) {
                        try { stVoiceStop.voiceProcess.kill(); } catch { /* ignore */ }
                        stVoiceStop.voiceProcess = null;
                    }
                    let text = '';
                    try {
                        if (stVoiceStop?.voiceResultFile) {
                            const raw = fs.readFileSync(stVoiceStop.voiceResultFile, 'utf8');
                            // Filter out "Listening..." marker and join lines
                            text = raw.split('\n')
                                .map(l => l.trim())
                                .filter(l => l && l !== 'Listening...')
                                .join('');
                            try { fs.unlinkSync(stVoiceStop.voiceResultFile!); } catch { /* ignore */ }
                        }
                    } catch { /* no result file */ }
                    try { if (stVoiceStop?.voicePsFile) fs.unlinkSync(stVoiceStop.voicePsFile); } catch { /* ignore */ }
                    post({ type: 'voiceResult', text, error: '' });
                    break;
                }
            }
        });

        return panelId;
    }

    private getTabList(convIds?: string[], activeId?: string) {
        const all = this.agent.getAllConversations();
        const filtered = convIds ? all.filter(c => convIds.includes(c.id)) : all;
        return filtered.map(c => ({
            id: c.id,
            title: c.title,
            active: c.id === activeId,
        }));
    }

    /** Find the PanelState that owns a given panel */
    private findStateByPanel(panel: vscode.WebviewPanel): PanelState | undefined {
        for (const [, st] of this.panels) {
            if (st.panel === panel) return st;
        }
        return undefined;
    }

    async handleUserMessage(text: string, images?: Array<{dataUrl: string; name: string; size: number}>, convId?: string, targetPanel?: vscode.WebviewPanel) {
        const panel = targetPanel || this.panel;
        if (!panel) return;
        // Local post function 鈥?always sends to THIS panel, no race condition
        const post = (msg: any) => panel.webview.postMessage(msg);
        // MUST have a valid convId 鈥?never fall back to global activeId
        if (!convId) return;
        const activeId = convId;
        console.log(`[MiMo] handleUserMessage: convId=${activeId}, msgCount=${this.agent.getConversation(activeId)?.messages.length ?? 'N/A'}`);
        const conv = this.agent.getConversation(activeId);
        if (!conv) return;
        if (this.agent.isConvBusy(activeId)) {
            post({ type: 'system', text: 'This conversation is already running. Wait for completion or stop it first.' });
            return;
        }

        // Auto-title from first user message.
        if (!conv.title || conv.title === 'New Chat' || conv.title === '新对话' || conv.title === 'Untitled') {
            conv.title = summarizeTitleFromInput(text);
            const fallbackTitle = conv.title;

            const st6 = this.findStateByPanel(panel);
            post({ type: 'tabList', tabs: this.getTabList(st6?.convIds, activeId), activeId });
            // Update the VSCode editor tab title + header input
            panel.title = conv.title;
            post({ type: 'convTitle', title: conv.title, convId: activeId });
            this.scheduleAiTitle(activeId, panel, text, fallbackTitle);
        }

        // Show user message with optional images
        const turnStartedAt = Date.now();
        const baselineChanges = await this.agent.getWorkspaceChangeSummary();
        const baselinePatch = baselineChanges?.patch || '';
        const turnToolChanges: TurnChangeTracker = { files: new Map() };
        post({ type: 'userMessage', text, images: images || null });
        post({ type: 'busy' });

        let responseText = '';
        let committedResponseText = '';
        let finalAnswerEmitted = false;
        let hasToolCalls = false;
        let totalToolCalls = 0;
        let turnHadError = false;
        const startedAsPlanExecution = conv.mode === 'plan' && !!conv.planConfirmed;
        const pendingToolArgs: Array<{ name: string; args: Record<string, any> }> = [];
        const streamRender = createStreamingRenderQueue(post);
        const reasoningPost = createReasoningPostQueue(post);
        const commitAssistantUpdate = () => {
            streamRender.cancel();
            renderAssistantMarkdown(post, 'assistantUpdate', responseText);
            committedResponseText += responseText;
            responseText = '';
        };
        const emitFinalAnswer = (response: string) => {
            if (finalAnswerEmitted) return;
            const responseToEmit = (() => {
                if (!response) return responseText;
                if (!committedResponseText) return response;
                if (response.startsWith(committedResponseText)) {
                    return response.slice(committedResponseText.length);
                }
                if (committedResponseText.includes(response.trim())) return responseText;
                return responseText || response;
            })();
            if (responseToEmit.trim()) {
                renderAssistantMarkdown(post, 'finalAnswer', responseToEmit);
            }
            finalAnswerEmitted = true;
            responseText = '';
        };
        try {
        // Build event handlers 鈥?store for potential reconnection
        const handlers = {
                onToken: (token: string) => {
                    responseText += token;
                    streamRender.schedule(responseText);
                },
                onAssistantUpdate: (text: string) => {
                    streamRender.cancel();
                    renderAssistantMarkdown(post, 'assistantUpdate', text);
                    committedResponseText += text;
                    responseText = '';
                },
                onFinalAnswer: (text: string) => {
                    streamRender.cancel();
                    emitFinalAnswer(text);
                },
                onThoughtSummary: (text: string) => {
                    reasoningPost.push(text);
                },
                onReasoning: (token: string) => {
                    reasoningPost.push(token);
                },
                onToolCallStart: (name: string, args: Record<string, any>) => {
                    pendingToolArgs.push({ name, args });
                    reasoningPost.flush();
                    if (responseText.trim()) {
                        commitAssistantUpdate();
                    }
                    hasToolCalls = true;
                    totalToolCalls++;
                    post({ type: 'toolCallStart', name, args });
                },
                onToolCallEnd: (name: string, result: string, isError: boolean, elapsed: number) => {
                    const index = pendingToolArgs.findIndex(item => item.name === name);
                    const matched = index >= 0 ? pendingToolArgs.splice(index, 1)[0] : undefined;
                    this.recordTurnToolChange(turnToolChanges, name, matched?.args || {}, isError);
                    post({ type: 'toolCallEnd', name, result: trimWebviewToolResult(result), isError, elapsed });
                },
                onRoundStart: (round: number) => {
                    reasoningPost.flush();
                    hasToolCalls = false;
                    responseText = '';
                    post({ type: 'roundStart', round });
                },
                onRoundEnd: (_round: number) => {
                    reasoningPost.flush();
                    // Flush accumulated text at end of each round so interleaved
                    // text output (thinking → text → tools) renders in real time
                    // instead of being held until onDone.
                    if (responseText) {
                        commitAssistantUpdate();
                    }
                },
                onStatus: (status: string) => {
                    post({ type: 'status', text: status });
                },
                onModelSwitched: (model: string, reason?: 'chat' | 'image') => {
                    post({ type: 'modelSwitched', model, reason });
                },
                onTokenUsage: (usage: any) => {
                    post({ type: 'tokenUsage', usage });
                },
                onEditPreview: (previewId: string, path: string, oldText: string, newText: string, matchCount: number) => {
                    post({ type: 'editPreview', previewId, path, oldText, newText, matchCount });
                },
                onWritePreview: (previewId: string, filePath: string, content: string, isCreate: boolean) => {
                    post({ type: 'writePreview', previewId, filePath, content, isCreate });
                },
                onAskUser: (previewId: string, question: string, options: string[]) => {
                    post({ type: 'askUser', previewId, question, options });
                },
                onStopGuard: (info: any) => {
                    post({ type: 'stopGuard', ...info });
                },
                onWorkflowStart: (totalPhases: number, totalTasks: number) => {
                    post({ type: 'workflowStart', totalPhases, totalTasks });
                },
                onWorkflowPhaseStart: (phaseIndex: number, title: string, mode: string, taskCount: number) => {
                    post({ type: 'workflowPhaseStart', phaseIndex, title, mode, taskCount });
                },
                onWorkflowTaskStart: (phaseIndex: number, taskIndex: number, label: string) => {
                    post({ type: 'workflowTaskStart', phaseIndex, taskIndex, label });
                },
                onWorkflowTaskEnd: (phaseIndex: number, taskIndex: number, result: any) => {
                    post({ type: 'workflowTaskEnd', phaseIndex, taskIndex, result });
                },
                onWorkflowPhaseEnd: (phaseIndex: number, result: any) => {
                    post({ type: 'workflowPhaseEnd', phaseIndex, result });
                },
                onWorkflowEnd: (result: any) => {
                    post({ type: 'workflowEnd', result });
                },
                onAdversarialTurn: (persona: string, name: string, icon: string, phase: string, content: string, iteration: number) => {
                    post({ type: 'adversarialTurn', persona, name, icon, phase, content, iteration });
                },
                onAdversarialToolStart: (persona: string, toolName: string, args: Record<string, any>) => {
                    post({ type: 'adversarialToolStart', persona, toolName, args });
                },
                onAdversarialToolEnd: (persona: string, toolName: string, result: string, isError: boolean, elapsed: number) => {
                    post({ type: 'adversarialToolEnd', persona, toolName, result, isError, elapsed });
                },
                onDone: (response: string) => {
                    reasoningPost.flush();
                    const elapsedSec = Math.max(0, (Date.now() - turnStartedAt) / 1000);
                    const stoppedByUser = response === '(stopped by user)';
                    if (!stoppedByUser) {
                        streamRender.cancel();
                        emitFinalAnswer(response);
                    } else if (responseText.trim()) {
                        commitAssistantUpdate();
                    }
                    this.annotateLastAssistantElapsed(activeId, elapsedSec);
                    post({ type: 'done', response, elapsedSec });
                    // Send conversation-level usage summary
                    const convUsage = this.agent.getTokenTracker().getConversationUsage(activeId);
                    if (convUsage) {
                        post({ type: 'conversationUsage', usage: {
                            totalTokens: convUsage.totalTokens,
                            callCount: convUsage.callCount,
                        }});
                    }
                    // Auto-save to history
                    const msgs = this.agent.getMessages(activeId);
                    this.queueHistorySave(activeId, conv.title, msgs, conv.model, this.historyMetadata(conv));
                    this.postTaskChanges(post, baselinePatch, turnToolChanges);
                    // Plan mode: auto-save plan text to ~/.mimo/plans/, show confirm buttons
                    // Skip if response is a greeting/direct reply (not an actual plan)
                    const _hasPlanMarkers = looksLikePlanResponse(response);
                    if (conv.mode === 'plan' && !startedAsPlanExecution && response && _hasPlanMarkers) {
                        try {
                            // Use user home ~/.mimo/plans/ (not workspace .mimo)
                            const mimoPlansDir = path.join(os.homedir(), '.mimo', 'plans');
                            fs.mkdirSync(mimoPlansDir, { recursive: true });
                            // Unique filename: plan-{convId}-{timestamp}.md
                            const planId = `plan-${activeId}-${Date.now()}`;
                            const planFilename = `${planId}.md`;
                            const planPath = path.join(mimoPlansDir, planFilename);
                            fs.writeFileSync(planPath, response, 'utf-8');
                            // Store plan path in per-panel state
                            const stPlan2 = this.findStateByPanel(panel);
                            if (stPlan2) {
                                stPlan2.planPath = planPath;
                                stPlan2.planId = planId;
                            }
                            // Auto-clean old plan files
                            cleanOldPlans(mimoPlansDir);
                        } catch { /* ignore save errors */ }
                        post({ type: 'planReady', planContent: response, planPath: this.findStateByPanel(panel)?.planPath });
                    }
                },
                onError: (error: string) => {
                    turnHadError = true;
                    this.agent.releaseConversation(activeId);
                    reasoningPost.flush();
                    this.saveRecoverySnapshot(activeId, conv);
                    const stErr = this.findStateByPanel(panel);
                    if (stErr) stErr.messageQueue = [];
                    post({ type: 'systemI18n', key: 'recovery.snapshot.saved' });
                    post({ type: 'clearQueue' });
                    post({ type: 'error', error });
                },
            };

            await this.agent.chat(text, handlers, images, activeId);
        } catch (e: any) {
            turnHadError = true;
            this.agent.releaseConversation(activeId);
            const stErr = this.findStateByPanel(panel);
            if (stErr) stErr.messageQueue = [];
            post({ type: 'clearQueue' });
            post({ type: 'error', error: e.message });
        } finally {
            reasoningPost.cancel();
            streamRender.cancel();
            if (turnHadError) this.agent.releaseConversation(activeId);
            post({ type: 'idle' });

            // Process next queued message only after successful completion.
            // Failed provider/model calls should unlock the UI and wait for the user
            // to adjust model or generation settings before retrying.
            if (!turnHadError) {
                this.processNextQueued(panel, convId);
            }
        }
    }

    private async waitForConversationIdle(convId: string, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!this.agent.isConvBusy(convId)) return true;
            await new Promise(resolve => setTimeout(resolve, 120));
        }
        return !this.agent.isConvBusy(convId);
    }

    private processNextQueued(panel: vscode.WebviewPanel, convId?: string): void {
        // Find the panel's queue
        for (const [, st] of this.panels) {
            if (st.panel === panel && st.messageQueue.length > 0) {
                const next = st.messageQueue.shift()!;
                panel.webview.postMessage({ type: 'queueProcessed', remaining: st.messageQueue.length });
                // Process the queued message
                this.handleUserMessage(next.text, next.images, convId, panel).catch(e => {
                    console.error('[MiMo] Queued message handling failed:', e);
                });
                return;
            }
        }
    }

    private saveRecoverySnapshot(activeId: string, conv: any): void {
        try {
            const msgs = this.agent.getMessages(activeId);
            this.queueHistorySave(activeId, conv.title, msgs, conv.model, this.historyMetadata(conv));
        } catch {
            // Best-effort recovery only.
        }
    }

    private annotateLastAssistantElapsed(convId: string, elapsedSec: number): void {
        const messages = this.agent.getMessages(convId);
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                messages[i]._elapsedSec = Number(elapsedSec.toFixed(1));
                return;
            }
        }
    }

    private normalizeTurnChangePath(filePath: string): string {
        return String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    }

    private lineCount(text: string): number {
        if (!text) return 0;
        return text.split(/\r\n|\r|\n/).length;
    }

    private estimateEditCounts(args: Record<string, any>): { added: number; removed: number } {
        if (typeof args.old_text === 'string' || typeof args.new_text === 'string') {
            return {
                added: this.lineCount(String(args.new_text || '')),
                removed: this.lineCount(String(args.old_text || '')),
            };
        }
        if (typeof args.line_start === 'number' && typeof args.line_end === 'number') {
            const removed = Math.max(0, Math.floor(args.line_end) - Math.floor(args.line_start) + 1);
            return { added: this.lineCount(String(args.new_text || '')), removed };
        }
        return { added: 0, removed: 0 };
    }

    private recordTurnToolChange(
        tracker: TurnChangeTracker,
        name: string,
        args: Record<string, any>,
        isError: boolean,
    ): void {
        if (isError) return;
        const mutationTools = new Set(['write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file']);
        if (!mutationTools.has(name)) return;

        const pathArg = name === 'move_file' || name === 'copy_file'
            ? String(args.destination || args.dest || args.to || '')
            : String(args.path || args.filePath || args.file || '');
        if (!pathArg) return;

        let added = 0;
        let removed = 0;
        let action = 'edit';
        let hasToolDiff = false;
        if (name === 'write_file') {
            added = this.lineCount(String(args.content || ''));
            action = args.isCreate === false ? 'write' : 'write';
            hasToolDiff = true;
        } else if (name === 'edit_file') {
            const counts = this.estimateEditCounts(args);
            added = counts.added;
            removed = counts.removed;
            action = 'edit';
            hasToolDiff = typeof args.old_text === 'string' || typeof args.new_text === 'string';
        } else if (name === 'delete_file') {
            action = 'delete';
            removed = 1;
        } else if (name === 'move_file') {
            action = 'move';
            added = 1;
            removed = 1;
        } else if (name === 'copy_file') {
            action = 'copy';
            added = 1;
        }

        const key = this.normalizeTurnChangePath(pathArg);
        const existing = tracker.files.get(key);
        if (existing) {
            existing.added += added;
            existing.removed += removed;
            existing.hasToolDiff = existing.hasToolDiff || hasToolDiff;
            if (existing.action !== action) existing.action = 'edit';
            return;
        }
        tracker.files.set(key, {
            path: pathArg,
            added,
            removed,
            action,
            source: 'tool',
            hasToolDiff,
        });
    }

    private fileKeysMatch(a: string, b: string): boolean {
        const left = this.normalizeTurnChangePath(a);
        const right = this.normalizeTurnChangePath(b);
        if (!left || !right) return false;
        return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
    }

    private filterSummaryToTurnChanges(summary: any, tracker: TurnChangeTracker): any | null {
        const turnFiles = Array.from(tracker.files.values());
        if (turnFiles.length === 0) return null;
        if (!summary || !Array.isArray(summary.files)) return null;

        const filtered = summary.files.filter((file: any) =>
            turnFiles.some(turnFile => this.fileKeysMatch(turnFile.path, file.path || '')),
        );
        if (filtered.length === 0) return null;
        const patch = this.filterPatchToTurnChanges(String(summary.patch || ''), tracker);
        return {
            ...summary,
            files: filtered,
            totalAdded: filtered.reduce((sum: number, file: any) => sum + (file.added || 0), 0),
            totalRemoved: filtered.reduce((sum: number, file: any) => sum + (file.removed || 0), 0),
            patch,
            canUndo: patch ? summary.canUndo : false,
            warning: patch ? summary.warning : (summary.warning || '本轮文件已记录，但没有可安全隔离的 Git patch；可查看工具记录，自动撤销不可用。'),
        };
    }

    private filterPatchToTurnChanges(patch: string, tracker: TurnChangeTracker): string {
        const text = String(patch || '').trimEnd();
        if (!text) return '';
        const turnFiles = Array.from(tracker.files.values());
        const blocks = text
            .split(/(?=^diff --git\s+)/m)
            .map(block => block.trimEnd())
            .filter(Boolean);
        const kept = blocks.filter(block => {
            const firstLine = block.split(/\r?\n/, 1)[0] || '';
            const match = firstLine.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
            if (!match) return false;
            const left = match[1] || '';
            const right = match[2] || '';
            return turnFiles.some(file =>
                this.fileKeysMatch(file.path, left) || this.fileKeysMatch(file.path, right),
            );
        });
        return kept.length ? kept.join('\n') + '\n' : '';
    }

    private buildToolOnlyTurnSummary(tracker: TurnChangeTracker, warning?: string): any | null {
        const files = Array.from(tracker.files.values()).sort((a, b) => a.path.localeCompare(b.path));
        if (files.length === 0) return null;
        return {
            id: `turn_changes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            files,
            totalAdded: files.reduce((sum, file) => sum + (file.added || 0), 0),
            totalRemoved: files.reduce((sum, file) => sum + (file.removed || 0), 0),
            patch: '',
            createdAt: Date.now(),
            canUndo: false,
            warning: warning || '本卡片只汇总本轮对话中由 MiMo 工具修改的文件；未使用 Git diff，因此可查看记录但不能自动撤销。',
        };
    }

    private async handleSkillInvocation(skillName: string, text: string, convId?: string, targetPanel?: vscode.WebviewPanel) {
        const panel = targetPanel || this.panel;
        if (!panel) return;
        const post = (msg: any) => panel.webview.postMessage(msg);
        if (!convId) return;
        const activeId = convId;
        const conv = this.agent.getConversation(activeId);
        if (!conv) return;

        post({ type: 'userMessage', text: `[${skillName}] ${text}` });
        const turnStartedAt = Date.now();
        const baselineChanges = await this.agent.getWorkspaceChangeSummary();
        const baselinePatch = baselineChanges?.patch || '';
        const turnToolChanges: TurnChangeTracker = { files: new Map() };
        post({ type: 'busy' });

        let responseText = '';
        let committedResponseText = '';
        let finalAnswerEmitted = false;
        let hasToolCalls = false;
        let totalToolCalls = 0;
        const pendingToolArgs: Array<{ name: string; args: Record<string, any> }> = [];
        const streamRender = createStreamingRenderQueue(post);
        const reasoningPost = createReasoningPostQueue(post);
        const commitAssistantUpdate = () => {
            streamRender.cancel();
            renderAssistantMarkdown(post, 'assistantUpdate', responseText);
            committedResponseText += responseText;
            responseText = '';
        };
        const emitFinalAnswer = (response: string) => {
            if (finalAnswerEmitted) return;
            const responseToEmit = (() => {
                if (!response) return responseText;
                if (!committedResponseText) return response;
                if (response.startsWith(committedResponseText)) {
                    return response.slice(committedResponseText.length);
                }
                if (committedResponseText.includes(response.trim())) return responseText;
                return responseText || response;
            })();
            if (responseToEmit.trim()) {
                renderAssistantMarkdown(post, 'finalAnswer', responseToEmit);
            }
            finalAnswerEmitted = true;
            responseText = '';
        };
        try {
            await this.agent.chatWithSkill(skillName, text, {
                onToken: (token) => {
                    responseText += token;
                    streamRender.schedule(responseText);
                },
                onAssistantUpdate: (text: string) => {
                    streamRender.cancel();
                    renderAssistantMarkdown(post, 'assistantUpdate', text);
                    committedResponseText += text;
                    responseText = '';
                },
                onFinalAnswer: (text: string) => {
                    streamRender.cancel();
                    emitFinalAnswer(text);
                },
                onThoughtSummary: (text: string) => reasoningPost.push(text),
                onReasoning: (token) => reasoningPost.push(token),
                onToolCallStart: (name, args) => {
                    pendingToolArgs.push({ name, args });
                    reasoningPost.flush();
                    if (responseText.trim()) {
                        commitAssistantUpdate();
                    }
                    hasToolCalls = true;
                    totalToolCalls++;
                    post({ type: 'toolCallStart', name, args });
                },
                onToolCallEnd: (name, result, isError, elapsed) => {
                    const index = pendingToolArgs.findIndex(item => item.name === name);
                    const matched = index >= 0 ? pendingToolArgs.splice(index, 1)[0] : undefined;
                    this.recordTurnToolChange(turnToolChanges, name, matched?.args || {}, isError);
                    post({ type: 'toolCallEnd', name, result: trimWebviewToolResult(result), isError, elapsed });
                },
                onRoundStart: (round) => {
                    reasoningPost.flush();
                    hasToolCalls = false;
                    responseText = '';
                    post({ type: 'roundStart', round });
                },
                onRoundEnd: (_round: number) => {
                    reasoningPost.flush();
                    if (responseText) {
                        commitAssistantUpdate();
                    }
                },
                onStatus: (status) => post({ type: 'status', text: status }),
                onModelSwitched: (model, reason) => post({ type: 'modelSwitched', model, reason }),
                onTokenUsage: (usage) => {
                    post({ type: 'tokenUsage', usage });
                },
                onEditPreview: (previewId: string, path: string, oldText: string, newText: string, matchCount: number) => {
                    post({ type: 'editPreview', previewId, path, oldText, newText, matchCount });
                },
                onWritePreview: (previewId: string, filePath: string, content: string, isCreate: boolean) => {
                    post({ type: 'writePreview', previewId, filePath, content, isCreate });
                },
                onAskUser: (previewId: string, question: string, options: string[]) => {
                    post({ type: 'askUser', previewId, question, options });
                },
                onStopGuard: (info: any) => {
                    post({ type: 'stopGuard', ...info });
                },
                onWorkflowStart: (totalPhases: number, totalTasks: number) => {
                    post({ type: 'workflowStart', totalPhases, totalTasks });
                },
                onWorkflowPhaseStart: (phaseIndex: number, title: string, mode: string, taskCount: number) => {
                    post({ type: 'workflowPhaseStart', phaseIndex, title, mode, taskCount });
                },
                onWorkflowTaskStart: (phaseIndex: number, taskIndex: number, label: string) => {
                    post({ type: 'workflowTaskStart', phaseIndex, taskIndex, label });
                },
                onWorkflowTaskEnd: (phaseIndex: number, taskIndex: number, result: any) => {
                    post({ type: 'workflowTaskEnd', phaseIndex, taskIndex, result });
                },
                onWorkflowPhaseEnd: (phaseIndex: number, result: any) => {
                    post({ type: 'workflowPhaseEnd', phaseIndex, result });
                },
                onWorkflowEnd: (result: any) => {
                    post({ type: 'workflowEnd', result });
                },
                onAdversarialTurn: (persona: string, name: string, icon: string, phase: string, content: string, iteration: number) => {
                    post({ type: 'adversarialTurn', persona, name, icon, phase, content, iteration });
                },
                onAdversarialToolStart: (persona: string, toolName: string, args: Record<string, any>) => {
                    post({ type: 'adversarialToolStart', persona, toolName, args });
                },
                onAdversarialToolEnd: (persona: string, toolName: string, result: string, isError: boolean, elapsed: number) => {
                    post({ type: 'adversarialToolEnd', persona, toolName, result, isError, elapsed });
                },
                onDone: (response: string) => {
                    reasoningPost.flush();
                    const elapsedSec = Math.max(0, (Date.now() - turnStartedAt) / 1000);
                    streamRender.cancel();
                    if (response === '(stopped by user)' && responseText.trim()) {
                        commitAssistantUpdate();
                    } else {
                        emitFinalAnswer(response);
                    }
                    this.annotateLastAssistantElapsed(activeId, elapsedSec);
                    post({ type: 'done', response, elapsedSec });
                    const convUsage = this.agent.getTokenTracker().getConversationUsage(activeId);
                    if (convUsage) {
                        post({ type: 'conversationUsage', usage: {
                            totalTokens: convUsage.totalTokens,
                            callCount: convUsage.callCount,
                        }});
                    }
                    const msgs = this.agent.getMessages(activeId);
                    this.queueHistorySave(activeId, conv.title, msgs, conv.model, this.historyMetadata(conv));
                    this.postTaskChanges(post, baselinePatch, turnToolChanges);
                },
                onError: (error) => {
                    reasoningPost.flush();
                    this.saveRecoverySnapshot(activeId, conv);
                    post({ type: 'systemI18n', key: 'recovery.snapshot.saved' });
                    post({ type: 'error', error });
                },
            });
        } catch (e: any) {
            post({ type: 'error', error: e.message });
        } finally {
            reasoningPost.cancel();
            streamRender.cancel();
            post({ type: 'idle' });
            this.processNextQueued(panel, convId);
        }
    }

    private postTaskChanges(post: (msg: any) => void, baselinePatch = '', turnToolChanges?: TurnChangeTracker): void {
        if (!turnToolChanges || turnToolChanges.files.size === 0) return;
        void this.agent.getWorkspaceChangeSummary()
            .then(summary => {
                const filteredSummary = this.filterSummaryToTurnChanges(summary, turnToolChanges);
                if (!filteredSummary) {
                    const toolOnly = this.buildToolOnlyTurnSummary(turnToolChanges);
                    if (toolOnly) post({ type: 'taskChanges', summary: toolOnly });
                    return;
                }
                summary = filteredSummary;
                if (summary && baselinePatch.trim()) {
                    const samePatch = summary.patch === baselinePatch && summary.patch.trim();
                    if (samePatch) {
                        summary.canUndo = false;
                        summary.warning = '本轮确有工具修改，但当前 Git patch 与任务开始前一致；已按本轮工具记录展示文件，自动撤销不可用。';
                    } else {
                        summary.canUndo = false;
                        summary.warning = '任务开始前已有未提交改动；本卡片只保留本轮工具涉及的文件，自动撤销不可用，请审核 diff 后手动处理。';
                    }
                } else if (summary && summary.canUndo !== false) {
                    summary.canUndo = true;
                }
                if (summary && summary.files.length > 0) {
                    post({ type: 'taskChanges', summary });
                }
            })
            .catch(() => {
                const toolOnly = this.buildToolOnlyTurnSummary(
                    turnToolChanges,
                    '未能读取 Git diff；已按本轮 MiMo 工具记录展示修改文件。自动撤销不可用。',
                );
                if (toolOnly) post({ type: 'taskChanges', summary: toolOnly });
            });
    }

    /**
     * Restore conversation state to webview after panel re-resolution.
     * Called when the sidebar panel becomes visible again after being hidden.
     */
    private restoreStateToWebview(targetPanel?: vscode.WebviewPanel): void {
        // Use THIS panel's active conversation, not the global one
        const p = targetPanel || this.panel;
        const st7 = p ? this.findStateByPanel(p) : undefined;
        const convId = st7?.activeConvId;
        if (!convId) return;
        const conv = this.agent.getConversation(convId);
        if (!conv) return;

        // Always sync lightweight state (tabs, title, model, busy)
        this.postToWebview({ type: 'tabList', tabs: this.getTabList(st7?.convIds, convId), activeId: convId }, p);
        this.postToWebview({ type: 'convTitle', title: conv.title, convId }, p);
        if (p) p.title = conv.title;

        const model = this.agent.getModelSelectionValue(convId);
        this.postToWebview(this.modelListMessage(convId), p);
        this.postToWebview({ type: 'modelCaps', caps: this.agent.getModelCapabilities(model) }, p);
        this.postToWebview({ type: 'restoreMode', mode: conv.mode, label: conv.mode }, p);
        this.postToWebview(this.agent.isConvRunning(convId) ? { type: 'busy' } : { type: 'idle' }, p);

        // Refresh history list
        this.postToWebview({ type: 'historyList', items: this.history.list() }, p);

        // Only restore messages on FIRST restore (retainContextWhenHidden preserves DOM).
        if (st7?.restored) return;

        // Fresh conversation with no messages 鈥?keep welcome page
        if (conv.messages.length === 0) {
            if (st7) st7.restored = true;
            return;
        }

        // Render a lightweight history transcript instead of replaying live events.
        this.postToWebview({ type: 'clearMessages' }, p);
        this.replayConversation(conv.messages, p);
        if (st7) st7.restored = true;
    }

    /**
     * Build a lightweight transcript snapshot for history viewing.
     * History must not replay live tool/reasoning events: that caused duplicate
     * "Processed" drawers, delayed rendering, and a frozen-feeling webview.
     */
    private buildHistoryTurns(messages: ChatMessage[]): any[] {
        const turns: any[] = [];
        let current: {
            user: { text: string; images: any[] | null };
            assistantTexts: string[];
            hasDetails: boolean;
            details: Array<{ type: 'reasoning' | 'tool'; title: string; body: string; elapsedSec?: number; isError?: boolean }>;
            elapsedSec: number;
            estimatedTokens: number;
            snapshot?: any;
        } | null = null;

        const flush = () => {
            if (!current) return;
            const visibleText = current.assistantTexts.map(s => s.trim()).filter(Boolean).pop() || '';
            const assistantHtml = visibleText ? renderMarkdown(visibleText) : '';
            const tokens = current.estimatedTokens || (visibleText ? Math.ceil(visibleText.length / 3) : 0);
            if (current.user.text || current.user.images?.length || assistantHtml) {
                turns.push({
                    user: current.user,
                    assistantHtml,
                    meta: {
                        hasDetails: current.hasDetails,
                        details: current.details,
                        elapsedSec: current.elapsedSec > 0 ? Number(current.elapsedSec.toFixed(1)) : 0,
                        tokens,
                    },
                    snapshot: current.snapshot,
                });
            }
            current = null;
        };

        for (const m of messages) {
            if (m.role === 'user') {
                flush();
                let images: any[] | null = null;
                if (Array.isArray(m.content)) {
                    const imgParts = m.content.filter((p: any) => p.type === 'image_url');
                    if (imgParts.length > 0) {
                        images = imgParts.map((p: any) => ({
                            name: 'image',
                            dataUrl: p.image_url?.url || '',
                        }));
                    }
                }
                current = {
                    user: { text: extractText(m.content), images },
                    assistantTexts: [],
                    hasDetails: false,
                    details: [],
                    elapsedSec: 0,
                    estimatedTokens: 0,
                    snapshot: undefined,
                };
                continue;
            }

            if (!current) continue;

            if (m.role === 'assistant') {
                const text = extractText(m.content);
                if (text.trim()) {
                    current.assistantTexts.push(text);
                    current.estimatedTokens += Math.ceil(text.length / 3);
                }
                if (typeof m._elapsedSec === 'number' && m._elapsedSec > 0) {
                    current.elapsedSec = m._elapsedSec;
                }
                if (m._uiSnapshot && typeof m._uiSnapshot === 'object') {
                    current.snapshot = m._uiSnapshot;
                }
                if (m.reasoning_content) {
                    current.hasDetails = true;
                    const reasoning = String(m.reasoning_content);
                    current.details.push({
                        type: 'reasoning',
                        title: 'reasoning',
                        body: reasoning,
                    });
                    current.estimatedTokens += Math.ceil(reasoning.length / 3);
                }
                if (m.tool_calls && m.tool_calls.length > 0) {
                    current.hasDetails = true;
                }
            } else if (m.role === 'tool') {
                current.hasDetails = true;
                const toolText = extractText(m.content);
                current.details.push({
                    type: 'tool',
                    title: m._toolName || 'tool',
                    body: toolText,
                    elapsedSec: Number(m._toolElapsed || 0),
                    isError: /^(Safety:|Tool error:|Unknown tool|Blocked by)/.test(toolText),
                });
                if (current.elapsedSec <= 0) {
                    current.elapsedSec += Number(m._toolElapsed || 0);
                }
            }
        }
        flush();
        return turns;
    }

    private replayConversation(messages: ChatMessage[], targetPanel?: vscode.WebviewPanel): void {
        const replayId = ++this.replaySeq;
        this.postToWebview({ type: 'historyReplayStart', replayId, totalMessages: messages.length }, targetPanel);
        const turns = this.buildHistoryTurns(messages);
        this.postToWebview({ type: 'historyRender', replayId, turns }, targetPanel);
    }

    private postToWebview(msg: any, targetPanel?: vscode.WebviewPanel) {
        const p = targetPanel || this.panel;
        if (p) p.webview.postMessage(msg);
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'app.js')
        );
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src 'unsafe-inline' https://fonts.googleapis.com;
             font-src https://fonts.gstatic.com;
             script-src 'nonce-${nonce}';
             img-src 'self' data: blob:;">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${this.cssContent}</style>
</head>
<body>
<div id="header">
    <input type="text" id="conv-title" class="conv-title-input" value="New Chat" spellcheck="false">
    <div id="header-actions">
        <button class="tb-icon" id="btn-lang" title="Language"></button>
        <button class="tb-icon" id="btn-history" title="History"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
        <button class="btn-new-flat" id="btn-new" title="New Chat">+</button>
        <button class="tb-icon" id="btn-settings" title="Settings"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
    </div>
</div>

<div id="history-panel" class="panel hidden">
    <div class="panel-header"><span>History</span><button class="panel-close" id="close-history">&times;</button></div>
    <div style="padding:6px 12px;border-bottom:1px solid var(--vscode-editorWidget-border)">
        <input type="text" id="history-search" placeholder="Search history..." style="width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;padding:4px 8px;font-size:11px;font-family:var(--vscode-font-family);outline:none">
    </div>
    <div class="panel-body" id="history-list"><div class="panel-empty">No history yet</div></div>
    <div style="padding:6px 12px;border-top:1px solid var(--vscode-editorWidget-border);display:flex;gap:4px">
        <button class="save-btn" id="export-md" style="flex:1;font-size:10px;padding:4px 8px">Export MD</button>
        <button class="save-btn" id="export-json" style="flex:1;font-size:10px;padding:4px 8px">Export JSON</button>
    </div>
</div>
<div id="settings-panel" class="panel hidden">
    <div class="panel-header"><span>Settings</span><button class="panel-close" id="close-settings">&times;</button></div>
    <div class="panel-body">
        <div class="setting-group"><label>API Key</label><input type="password" id="set-apikey" placeholder="sk-..."></div>
        <div class="setting-group"><label>Base URL</label><input type="text" id="set-baseurl"></div>
        <div class="setting-group"><label>Model</label><input type="text" id="set-model"></div>
        <div class="setting-group"><label>Active Profile ID</label><input type="text" id="set-active-provider-profile" placeholder="mimo"></div>
        <div class="setting-group"><label>Provider Profiles JSON</label><textarea id="set-provider-profiles" spellcheck="false" style="min-height:74px" placeholder='[{"id":"deepseek","base_url":"https://api.deepseek.com/v1","model":"deepseek-chat"}]'></textarea></div>
        <div class="setting-group"><label>Temperature</label><input type="number" id="set-temperature" min="0" max="2" step="0.1"></div>
        <div class="setting-group"><label>Max Tokens</label><input type="number" id="set-maxtokens" min="256" max="65536"></div>
        <div class="setting-group"><label>Command Timeout (s)</label><input type="number" id="set-command-timeout" min="5" max="3600"></div>
        <div class="setting-group"><label>Max Tool Output</label><input type="number" id="set-max-output-len" min="1000" max="200000"></div>
        <div class="setting-group"><label><input type="checkbox" id="set-thinking"> Enable thinking mode</label></div>
        <div class="setting-group" style="margin-top:12px;padding-top:8px;border-top:1px solid var(--vscode-editorWidget-border)">
            <label style="font-weight:600;color:var(--vscode-foreground)">Memory</label>
        </div>
        <div class="setting-group"><label><input type="checkbox" id="set-memory-enabled" checked> Enable local long-term memory</label></div>
        <div class="setting-group"><label><input type="checkbox" id="set-memory-learn" checked> Learn explicit preferences from chat</label></div>
        <div class="setting-group"><label>Max Memory Items</label><input type="number" id="set-memory-max-items" min="10" max="500" step="10"></div>
        <div class="setting-group"><label>Memories Injected Per Turn</label><input type="number" id="set-memory-max-injected" min="0" max="20" step="1"></div>
        <div class="setting-group" style="margin-top:12px;padding-top:8px;border-top:1px solid var(--vscode-editorWidget-border)">
            <label style="font-weight:600;color:var(--vscode-foreground)">Safety</label>
        </div>
        <div class="setting-group"><label><input type="checkbox" id="set-sandbox-git" checked> Create Git snapshot before risky commands</label></div>
        <div class="setting-group"><label><input type="checkbox" id="set-sandbox-logging" checked> Record command execution logs</label></div>
        <div class="setting-group" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--vscode-editorWidget-border)">
            <label style="font-weight:600;color:var(--vscode-foreground)">Docker Sandbox</label>
        </div>
        <div class="setting-group"><label><input type="checkbox" id="set-sandbox"> Enable Docker sandbox (requires Docker Desktop)</label></div>
        <div class="setting-group"><label>Docker Image</label><input type="text" id="set-sandbox-image" placeholder="node:20-alpine"></div>
        <div class="setting-group"><label>Memory Limit</label><input type="text" id="set-sandbox-memory" placeholder="512m"></div>
        <div class="setting-group"><label>CPU Limit</label><input type="number" id="set-sandbox-cpu" min="1" max="8" step="1"></div>
        <div class="setting-group" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--vscode-editorWidget-border)">
            <label style="font-weight:600;color:var(--vscode-foreground)" data-i18n="settings.dependency.title">Dependency Install Policy</label>
        </div>
        <div class="setting-group"><label><input type="checkbox" id="set-dependency-install-enabled" checked> <span data-i18n="settings.dependency.enabled">Enable dependency install policy</span></label></div>
        <div class="setting-group"><label data-i18n="settings.dependency.project.mode">Project Dependency Installs</label><select id="set-dependency-project-mode"><option value="auto" data-i18n="settings.dependency.project.auto">Auto install project dependencies</option><option value="confirm" data-i18n="settings.dependency.project.confirm">Ask before project dependency installs</option><option value="disabled" data-i18n="settings.dependency.project.disabled">Disable project dependency installs</option></select></div>
        <div class="setting-group"><label data-i18n="settings.dependency.system.mode">System Software Installs</label><select id="set-dependency-system-mode"><option value="confirm" data-i18n="settings.dependency.system.confirm">Always ask before system installs</option><option value="disabled" data-i18n="settings.dependency.system.disabled">Disable system installs</option></select></div>
        <div class="setting-group"><label data-i18n="settings.dependency.long.timeout">Long Install Timeout (s)</label><input type="number" id="set-dependency-long-timeout" min="60" max="3600" step="30"></div>
        <button class="save-btn" id="save-settings">Save Settings</button>
    </div>
</div>

<div id="toolbar" style="display:none"></div>

<div id="messages">
    <div class="msg msg-welcome">
        <div class="welcome-icon">
            <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="8" y="12" width="112" height="104" rx="18" ry="18" stroke="#FF6900" stroke-width="12"/>
                <path d="M34 96 V38 L64 58 L94 38 V96" stroke="#FF6900" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <p class="welcome-desc"></p>
        <p class="welcome-hint"></p>
    </div>
</div>

<div id="status-bar"><span class="status-dot"></span><span id="status-text"></span><span id="token-counter" class="token-counter" style="display:none;margin-left:auto;font-size:10px;opacity:0.7"></span></div>
<div id="input-area">
    <div id="cmd-palette"></div>
    <div id="input-wrapper" class="mode-auto">
        <div id="image-preview"></div>
        <textarea id="input" data-i18n="paste.hint" placeholder="输入消息... (Ctrl+V 粘贴图片)" rows="1"></textarea>
        <div id="input-bottom">
            <div style="position:relative">
                <button class="mode-trigger" id="mode-trigger">
                    <span class="mode-label" id="mode-label" data-i18n="auto">Auto</span>
                    <span class="select-chevron" aria-hidden="true"></span>
                </button>
                <div id="mode-popup">
                    <div class="mode-option active" data-mode="auto">
                        <span class="mode-option-icon">A</span>
                        <div class="mode-option-info">
                            <span class="mode-option-name" data-i18n="auto">Auto</span>
                            <span class="mode-option-desc" data-i18n="auto.desc">AI decides when to use tools</span>
                        </div>
                    </div>
                    <div class="mode-option" data-mode="polling">
                        <span class="mode-option-icon">P</span>
                        <div class="mode-option-info">
                            <span class="mode-option-name" data-i18n="polling">Polling</span>
                            <span class="mode-option-desc" data-i18n="polling.desc">Auto-continue until task complete</span>
                        </div>
                    </div>
                    <div class="mode-option" data-mode="plan">
                        <span class="mode-option-icon">L</span>
                        <div class="mode-option-info">
                            <span class="mode-option-name" data-i18n="plan">Plan</span>
                            <span class="mode-option-desc" data-i18n="plan.desc">Text-only planning, no tools</span>
                        </div>
                    </div>
                    <div class="mode-option" data-mode="adversarial">
                        <span class="mode-option-icon">D</span>
                        <div class="mode-option-info">
                            <span class="mode-option-name" data-i18n="adversarial">Duel</span>
                            <span class="mode-option-desc" data-i18n="adversarial.desc">CrazyCoder vs SuperPM</span>
                        </div>
                    </div>
                    <div class="mode-option" data-mode="infinite">
                        <span class="mode-option-icon">I</span>
                        <div class="mode-option-info">
                            <span class="mode-option-name" data-i18n="infinite">Infinite</span>
                            <span class="mode-option-desc" data-i18n="infinite.desc">High-budget multi-pass refinement loop</span>
                        </div>
                    </div>
                </div>
            </div>
            <span class="model-select-wrap">
                <select id="model-select" aria-hidden="true" tabindex="-1"></select>
                <button class="model-picker-trigger" id="model-picker-trigger" title="Model">
                    <span id="model-picker-label">Model</span>
                    <span class="select-chevron" aria-hidden="true"></span>
                </button>
                <div id="model-picker-popup" class="model-picker-popup" role="listbox"></div>
            </span>
            <button id="reasoning-effort-btn" class="reasoning-effort-btn" title="Reasoning effort">推理: 均衡</button>
            <input type="file" id="file-input" accept="image/*" multiple style="display:none">
            <button class="tb-icon voice-btn" id="voice-btn" title="Voice input" style="display:none">Mic</button>
            <div style="flex:1"></div>
            <button id="send" title="Send">Send</button>
        </div>
    </div>
</div>

<div id="img-overlay"><img id="overlay-img"></div>

<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
