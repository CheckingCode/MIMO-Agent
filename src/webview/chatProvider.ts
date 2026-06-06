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
import { ContentPart, ChatMessage } from '../api';

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

function sanitizeMode(value: unknown): AgentMode | undefined {
    return value === 'auto' || value === 'polling' || value === 'plan' || value === 'adversarial'
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
    if (Array.isArray(s.models)) {
        out.models = s.models
            .map(v => sanitizeString(v, 128))
            .filter((v): v is string => !!v)
            .slice(0, 50);
    }
    const maxTokens = sanitizeNumber(s.max_tokens, 256, 131072);
    if (maxTokens !== undefined) out.max_tokens = Math.round(maxTokens);
    const temperature = sanitizeNumber(s.temperature, 0, 2);
    if (temperature !== undefined) out.temperature = temperature;
    const topP = sanitizeNumber(s.top_p, 0, 1);
    if (topP !== undefined) out.top_p = topP;
    const sandboxCpu = sanitizeNumber(s.sandbox_cpu, 1, 8);
    if (sandboxCpu !== undefined) out.sandbox_cpu = Math.round(sandboxCpu);
    const sandboxMode = sanitizeString(s.sandbox_mode, 32);
    if (sandboxMode && ['safe', 'docker'].includes(sandboxMode)) out.sandbox_mode = sandboxMode;
    for (const key of ['enable_thinking', 'sandbox_enabled', 'sandbox_git_snapshot', 'sandbox_logging', 'sandbox_network_disabled']) {
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

export class ChatViewProvider {
    private panels = new Map<string, PanelState>();
    private panel?: vscode.WebviewPanel;  // current/active panel reference
    private agent: MiMoAgent;
    private history: HistoryManager;
    private cssContent: string = '';
    private replaySeq = 0;

    constructor(
        private readonly extensionUri: vscode.Uri,
        agent: MiMoAgent,
    ) {
        this.agent = agent;
        this.history = new HistoryManager();
        this.loadCss();
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

    /** Create a new MIMO panel (always creates fresh) */
    show(_forceNew = true) {
        // Always create new panel 鈥?each click = new window
        const splitEditor = this.panels.size === 0;
        this.createPanel(splitEditor);
    }

    private createPanel(splitEditor = false): string {
        const panelId = `mimo-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const convId = this.agent.createConversation();

        const column = splitEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
        const panel = vscode.window.createWebviewPanel(
            'mimo-agent.chat',
            'MiMo Chat',
            { viewColumn: column, preserveFocus: false },
            {
                enableScripts: true,
                localResourceRoots: [this.extensionUri],
                retainContextWhenHidden: true,
            },
        );
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'mimo-agent-icon.svg');

        // Track this panel
        const state: PanelState = { panel, convId, convIds: [convId], activeConvId: convId, messageQueue: [] };
        this.panels.set(panelId, state);

        // Update current panel references
        this.panel = panel;
        state.pendingInit = { firstId: convId, fresh: true };

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
                    post({ type: 'setLang', lang: 'zh' });

                    // ALWAYS initialize 鈥?no dependency on pendingInit
                    const st = this.panels.get(panelId);
                    let myConvId = st?.activeConvId;
                    if (!myConvId) break;
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
                    const model = this.agent.getModel(myConvId);
                    post({ type: 'modelList', models: this.agent.getModelList(), current: model });
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
                        post({ type: 'modelList', models: this.agent.getModelList(), current: conv.model });
                        post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(conv.model) });
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
                            post({ type: 'modelList', models: this.agent.getModelList(), current: nextConv.model });
                            post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(nextConv.model) });
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
                            this.history.save(msg.id, msg.title, conv4.messages, conv4.model, {
                                mode: conv4.mode,
                                personaId: conv4.personaId,
                                activeSkillPrompt: conv4.activeSkillPrompt,
                            });
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
                    if (this.agent.isConvRunning(sendConvId)) {
                        // Only THIS conversation is busy 鈥?queue for this panel
                        if (st) {
                            st.messageQueue.push({ text, images });
                            panel.webview.postMessage({
                                type: 'messageQueued',
                                text,
                                queueLength: st.messageQueue.length,
                            });
                        }
                    } else {
                        await this.handleUserMessage(text, images, sendConvId, panel);
                    }
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
                    this.agent.setModel(msg.model, stModel?.activeConvId);
                    post({ type: 'modelCaps', caps: this.agent.getModelCapabilities(msg.model) });
                    break;
                }
                case 'setMode': {
                    const stMode = this.panels.get(panelId);
                    this.agent.setMode(msg.mode, stMode?.activeConvId);
                    const modeDescs: Record<string, string> = {
                        auto: 'Auto mode: the agent works autonomously.',
                        plan: 'Plan mode: generate a plan first, then execute after confirmation.',
                        polling: 'Polling mode: edits show previews for confirmation.',
                        adversarial: 'Duel mode: builder and reviewer collaborate.',
                    };
                    post({ type: 'system', text: modeDescs[msg.mode] || `Mode switched: ${msg.mode}` });
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
                case 'planConfirm': {
                    const stPlan = this.panels.get(panelId);
                    this.agent.confirmPlan(true, stPlan?.activeConvId);
                    post({ type: 'system', text: 'Plan confirmed. Starting execution...' });
                    const planRef = stPlan?.planPath
                        ? `Read the plan file ${stPlan.planPath} and execute the plan.`
                        : 'Execute the confirmed plan.';
                    await this.handleUserMessage(planRef, [], stPlan?.activeConvId || convId, panel);
                    break;
                }
                case 'planReject': {
                    const stReject = this.panels.get(panelId);
                    this.agent.confirmPlan(false, stReject?.activeConvId);
                    post({ type: 'system', text: 'Plan rejected. Please describe the requirement again.' });
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
                            });
                            foundPanel.activeConvId = id;
                            foundPanel.panel.title = histConv.title;
                            foundPanel.panel.webview.postMessage({ type: 'tabList', tabs: this.getTabList(foundPanel.convIds, foundPanel.activeConvId), activeId: id });
                            foundPanel.panel.webview.postMessage({ type: 'convTitle', title: histConv.title, convId: id });
                            foundPanel.panel.webview.postMessage({ type: 'clearMessages' });
                            this.replayConversation(histConv.messages, foundPanel.panel);
                            foundPanel.panel.webview.postMessage({ type: 'modelList', models: this.agent.getModelList(), current: histConv.model });
                            foundPanel.panel.webview.postMessage({ type: 'modelCaps', caps: this.agent.getModelCapabilities(histConv.model) });
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
                            });
                            newState.convIds.push(id);
                            newState.activeConvId = id;
                            newState.panel.title = histConv.title;
                            newState.panel.webview.postMessage({ type: 'tabList', tabs: this.getTabList(newState.convIds, newState.activeConvId), activeId: id });
                            newState.panel.webview.postMessage({ type: 'convTitle', title: histConv.title, convId: id });
                            newState.panel.webview.postMessage({ type: 'clearMessages' });
                            this.replayConversation(histConv.messages, newState.panel);
                            newState.panel.webview.postMessage({ type: 'modelList', models: this.agent.getModelList(), current: histConv.model });
                            newState.panel.webview.postMessage({ type: 'modelCaps', caps: this.agent.getModelCapabilities(histConv.model) });
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
                    if (s.max_tokens !== undefined) saveSetting('agent.max_tokens', s.max_tokens);
                    if (s.temperature !== undefined) saveSetting('agent.temperature', s.temperature);
                    if (s.top_p !== undefined) saveSetting('agent.top_p', s.top_p);
                    if (s.enable_thinking !== undefined) saveSetting('agent.enable_thinking', s.enable_thinking);
                    if (s.sandbox_enabled !== undefined) saveSetting('sandbox.enabled', s.sandbox_enabled);
                    if (s.sandbox_mode !== undefined) saveSetting('sandbox.mode', s.sandbox_mode);
                    if (s.sandbox_image !== undefined) saveSetting('sandbox.image', s.sandbox_image);
                    if (s.sandbox_memory !== undefined) saveSetting('sandbox.memory_limit', s.sandbox_memory);
                    if (s.sandbox_cpu !== undefined) saveSetting('sandbox.cpu_limit', s.sandbox_cpu);
                    if (s.sandbox_git_snapshot !== undefined) saveSetting('sandbox.git_snapshot', s.sandbox_git_snapshot);
                    if (s.sandbox_logging !== undefined) saveSetting('sandbox.logging', s.sandbox_logging);
                    if (s.sandbox_network_disabled !== undefined) saveSetting('sandbox.network_disabled', s.sandbox_network_disabled);
                    // Hot-reload: re-read config and update agent in memory
                    const newConfig = loadConfig();
                    this.agent.updateConfig(newConfig);
                    post({ type: 'system', text: 'Settings saved and applied.' });
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
                        if (workspace && !isPathInside(workspace, filePath)) {
                            vscode.window.showWarningMessage('Cannot open file outside the current workspace.');
                            break;
                        }
                        const uri = vscode.Uri.file(filePath);
                        const position = new vscode.Position(Math.max(0, line - 1), 0);
                        const range = new vscode.Range(position, position);
                        const column = msg.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
                        await vscode.window.showTextDocument(uri, { selection: range, viewColumn: column });
                    } catch (e: any) {
                        vscode.window.showWarningMessage(`Cannot open file: ${e.message}`);
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
        if (this.agent.isConvRunning(activeId)) {
            post({ type: 'system', text: 'This conversation is already running. Wait for completion or stop it first.' });
            return;
        }

        // Auto-title from first user message (max 20 chars)
        if (!conv.title || conv.title === 'New Chat' || conv.title === '新对话' || conv.title === 'Untitled') {
            // Generate a concise title: take first meaningful content, max 20 chars
            let rawTitle = text.replace(/\n/g, ' ').trim();
            // Remove common prefixes
            rawTitle = rawTitle.replace(/^(please|help me|can you|could you|i want to|i need to)\s+/i, '');
            // Take first 20 chars
            conv.title = rawTitle.substring(0, 20).trim();
            if (rawTitle.length > 20) conv.title += '...';
            // Fallback if empty
            if (!conv.title) conv.title = 'New Chat';

            const st6 = this.findStateByPanel(panel);
            post({ type: 'tabList', tabs: this.getTabList(st6?.convIds, activeId), activeId });
            // Update the VSCode editor tab title + header input
            panel.title = conv.title;
            post({ type: 'convTitle', title: conv.title, convId: activeId });
        }

        // Show user message with optional images
        post({ type: 'userMessage', text, images: images || null });
        post({ type: 'busy' });

        let responseText = '';
        let hasToolCalls = false;
        let totalToolCalls = 0;
        try {
        // Build event handlers 鈥?store for potential reconnection
        const handlers = {
            onToken: (token: string) => {
                    responseText += token;
                    // Always show text 鈥?the new prompt enforces conciseness
                    post({ type: 'streamHtml', html: renderMarkdown(responseText) });
                },
                onReasoning: (token: string) => {
                    post({ type: 'reasoning', token });
                },
                onToolCallStart: (name: string, args: Record<string, any>) => {
                    hasToolCalls = true;
                    totalToolCalls++;
                    post({ type: 'toolCallStart', name, args });
                },
                onToolCallEnd: (name: string, result: string, isError: boolean, elapsed: number) => {
                    post({ type: 'toolCallEnd', name, result, isError, elapsed });
                },
                onRoundStart: (round: number) => {
                    hasToolCalls = false;
                    responseText = '';
                    post({ type: 'roundStart', round });
                },
                onStatus: (status: string) => {
                    post({ type: 'status', text: status });
                },
                onModelSwitched: (model: string) => {
                    post({ type: 'modelSwitched', model });
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
                    // Only show text for the final round (no tool calls)
                    if (!hasToolCalls) {
                        post({ type: 'streamHtml', html: renderMarkdown(response || responseText) });
                    }
                    post({ type: 'done', response });
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
                    this.history.save(activeId, conv.title, msgs, conv.model, {
                        mode: conv.mode,
                        personaId: conv.personaId,
                        activeSkillPrompt: conv.activeSkillPrompt,
                    });
                    // Plan mode: auto-save plan text to ~/.mimo/plans/, show confirm buttons
                    // Skip if response is a greeting/direct reply (not an actual plan)
                    const _hasPlanMarkers = looksLikePlanResponse(response);
                    if (conv.mode === 'plan' && !conv.planConfirmed && response && _hasPlanMarkers) {
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
                    post({ type: 'error', error });
                },
            };

            await this.agent.chat(text, handlers, images, activeId);
        } catch (e: any) {
            post({ type: 'error', error: e.message });
        } finally {
            post({ type: 'idle' });

            // Process next message in queue (if any)
            this.processNextQueued(panel, convId);
        }
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

    private async handleSkillInvocation(skillName: string, text: string, convId?: string, targetPanel?: vscode.WebviewPanel) {
        const panel = targetPanel || this.panel;
        if (!panel) return;
        const post = (msg: any) => panel.webview.postMessage(msg);
        if (!convId) return;
        const activeId = convId;
        const conv = this.agent.getConversation(activeId);
        if (!conv) return;

        post({ type: 'userMessage', text: `[${skillName}] ${text}` });
        post({ type: 'busy' });

        let responseText = '';
        let hasToolCalls = false;
        let totalToolCalls = 0;
        try {
            await this.agent.chatWithSkill(skillName, text, {
                onToken: (token) => {
                    responseText += token;
                    post({ type: 'streamHtml', html: renderMarkdown(responseText) });
                },
                onReasoning: (token) => post({ type: 'reasoning', token }),
                onToolCallStart: (name, args) => {
                    hasToolCalls = true;
                    totalToolCalls++;
                    post({ type: 'toolCallStart', name, args });
                },
                onToolCallEnd: (name, result, isError, elapsed) => post({ type: 'toolCallEnd', name, result, isError, elapsed }),
                onRoundStart: (round) => {
                    hasToolCalls = false;
                    responseText = '';
                    post({ type: 'roundStart', round });
                },
                onStatus: (status) => post({ type: 'status', text: status }),
                onModelSwitched: (model) => post({ type: 'modelSwitched', model }),
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
                    if (!hasToolCalls) {
                        post({ type: 'streamHtml', html: renderMarkdown(response || responseText) });
                    }
                    post({ type: 'done', response });
                    const convUsage = this.agent.getTokenTracker().getConversationUsage(activeId);
                    if (convUsage) {
                        post({ type: 'conversationUsage', usage: {
                            totalTokens: convUsage.totalTokens,
                            callCount: convUsage.callCount,
                        }});
                    }
                    const msgs = this.agent.getMessages(activeId);
                    this.history.save(activeId, conv.title, msgs, conv.model, {
                        mode: conv.mode,
                        personaId: conv.personaId,
                        activeSkillPrompt: conv.activeSkillPrompt,
                    });
                },
                onError: (error) => post({ type: 'error', error }),
            });
        } catch (e: any) {
            post({ type: 'error', error: e.message });
        } finally {
            post({ type: 'idle' });
            this.processNextQueued(panel, convId);
        }
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

        const model = conv.model;
        this.postToWebview({ type: 'modelList', models: this.agent.getModelList(), current: model }, p);
        this.postToWebview({ type: 'modelCaps', caps: this.agent.getModelCapabilities(model) }, p);
        this.postToWebview({ type: 'restoreMode', mode: conv.mode, label: conv.mode }, p);
        this.postToWebview(this.agent.isConvRunning(convId) ? { type: 'busy' } : { type: 'idle' }, p);

        // Refresh history list
        this.postToWebview({ type: 'historyList', items: this.history.list() }, p);

        // Only do full message replay on FIRST restore (retainContextWhenHidden preserves DOM)
        if (st7?.restored) return;

        // Fresh conversation with no messages 鈥?keep welcome page
        if (conv.messages.length === 0) {
            if (st7) st7.restored = true;
            return;
        }

        // Full replay with tool cards, reasoning, round markers
        this.postToWebview({ type: 'clearMessages' }, p);
        this.replayConversation(conv.messages, p);
        if (st7) st7.restored = true;
    }

    /**
     * Replay a conversation history to the webview, including tool cards,
     * reasoning blocks, round markers.
     *
     * SAFETY DESIGN:
     * - Replays all saved messages, but yields between render steps to prevent UI freeze
     * - Defers each renderMarkdown to setImmediate so Node.js event loop
     *   is never blocked for more than one render call (~10-50ms)
     * - Batches lightweight events (non-markdown) into one postMessage
     * - Each markdown render is sent individually after setImmediate
     */
    private replayConversation(messages: ChatMessage[], targetPanel?: vscode.WebviewPanel): void {
        const replayId = ++this.replaySeq;
        this.postToWebview({ type: 'historyReplayStart', replayId, totalMessages: messages.length }, targetPanel);
        const replayMessages = messages;
        const skippedCount = 0;

        // Build a fallback map: tool_call_id 鈫?tool name from assistant messages
        const toolNameFallback = new Map<string, string>();
        for (const m of replayMessages) {
            if (m.role === 'assistant' && m.tool_calls) {
                for (const tc of m.tool_calls) {
                    toolNameFallback.set(tc.id, tc.function.name);
                }
            }
        }

        // Build tool results map
        const toolResults = new Map<string, any>();
        for (const m of replayMessages) {
            if (m.role === 'tool' && m.tool_call_id) {
                const contentStr = extractText(m.content);
                const isError = contentStr.startsWith('Safety:') || contentStr.startsWith('Tool error:');
                const toolName = m._toolName || toolNameFallback.get(m.tool_call_id) || 'tool';
                toolResults.set(m.tool_call_id, {
                    type: 'toolCallEnd',
                    name: toolName,
                    result: contentStr || '(no result)',
                    isError,
                    elapsed: m._toolElapsed || 0,
                });
            }
        }

        // Show "skipped earlier messages" notice
        if (skippedCount > 0) {
            this.postToWebview({
                type: 'system',
                text: `Showing recent ${replayMessages.length} messages out of ${messages.length}; skipped ${skippedCount} older messages for faster loading.`,
            }, targetPanel);
        }

        // 鈹€鈹€ Build replay plan: separate light events from heavy markdown renders 鈹€鈹€
        // Light events (userMessage, roundStart, toolCall*, reasoning) are cheap.
        // streamHtml requires renderMarkdown which is CPU-intensive (highlight.js).
        // We batch all light events first, then render markdown one-by-one with setImmediate.

        type ReplayStep =
            | { kind: 'light'; events: any[] }
            | { kind: 'markdown'; text: string };

        const steps: ReplayStep[] = [];
        const lightBatch: any[] = [];
        let round = 0;

        const flushLight = () => {
            if (lightBatch.length > 0) {
                steps.push({ kind: 'light', events: lightBatch.splice(0) });
            }
        };

        for (const m of replayMessages) {
            if (m.role === 'user') {
                const text = extractText(m.content);
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
                lightBatch.push({ type: 'userMessage', text, images });
            } else if (m.role === 'assistant') {
                round++;
                lightBatch.push({ type: 'roundStart', round });

                if (m.reasoning_content) {
                    const text = m.reasoning_content;
                    const chunkSize = 4000;
                    for (let i = 0; i < text.length; i += chunkSize) {
                        lightBatch.push({ type: 'reasoning', token: text.slice(i, i + chunkSize) });
                    }
                }

                if (m.tool_calls && m.tool_calls.length > 0) {
                    for (const tc of m.tool_calls) {
                        let args: Record<string, any> = {};
                        try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }
                        lightBatch.push({ type: 'toolCallStart', name: tc.function.name, args });
                        const result = toolResults.get(tc.id);
                        if (result) lightBatch.push(result);
                    }
                }

                const text = extractText(m.content);
                if (text) {
                    // Flush accumulated light events before a heavy markdown step
                    flushLight();
                    steps.push({ kind: 'markdown', text });
                }
            }
        }
        flushLight();

        // Append the 'done' event as a final light step
        const lastAssistant = [...replayMessages].reverse().find(
            (m: any) => m.role === 'assistant' && extractText(m.content)
        );
        if (lastAssistant) {
            lightBatch.push({ type: 'done', response: extractText(lastAssistant.content) });
            flushLight();
        }

        // 鈹€鈹€ Execute steps: light = immediate, markdown = deferred via setImmediate 鈹€鈹€
        let stepIdx = 0;

        const runNext = () => {
            if (stepIdx >= steps.length) return;

            const step = steps[stepIdx++];

            if (step.kind === 'light') {
                // Lightweight events 鈥?send immediately, continue
                for (let i = 0; i < step.events.length; i += 25) {
                    this.postToWebview({ type: 'replayBatch', replayId, events: step.events.slice(i, i + 25) }, targetPanel);
                }
                // If next step is also light, chain immediately (no yield needed)
                // If next is markdown, it will yield via setImmediate
                if (stepIdx < steps.length && steps[stepIdx].kind === 'light') {
                    runNext();
                } else {
                    // Either done, or next is markdown 鈥?yield to let UI breathe
                    setImmediate(runNext);
                }
            } else {
                // Heavy: renderMarkdown runs in setImmediate to avoid blocking Node.js
                setImmediate(() => {
                    const html = renderMarkdown(step.text);
                    if (replayId !== this.replaySeq) return;
                    this.postToWebview({ type: 'replayBatch', replayId, events: [{ type: 'streamHtml', html }] }, targetPanel);
                    // Continue to next step after yielding
                    runNext();
                });
            }
        };

        runNext();
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
        <div class="setting-group"><label>Temperature</label><input type="number" id="set-temperature" min="0" max="2" step="0.1"></div>
        <div class="setting-group"><label>Max Tokens</label><input type="number" id="set-maxtokens" min="256" max="131072"></div>
        <div class="setting-group"><label><input type="checkbox" id="set-thinking"> Enable thinking mode</label></div>
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
        <textarea id="input" placeholder="Type a message... (Ctrl+V to paste images)" rows="1"></textarea>
        <div id="input-bottom">
            <div style="position:relative">
                <button class="mode-trigger" id="mode-trigger">
                    <span class="mode-label" id="mode-label" data-i18n="auto">Auto</span>
                    <span class="mode-arrow">v</span>
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
                </div>
            </div>
            <select id="model-select"></select>
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

