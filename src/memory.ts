import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteSync, withFileLockSync } from './utils/fileLock';
import { workspaceDataPath, workspaceWindowDataPath } from './workspaceData';

export type MemoryKind = 'preference' | 'project' | 'correction' | 'workflow';

export interface MemoryItem {
    id: string;
    kind: MemoryKind;
    scope: 'global' | 'workspace';
    workspace?: string;
    text: string;
    confidence: number;
    createdAt: string;
    updatedAt: string;
    hits: number;
    source: 'explicit' | 'heuristic';
}

interface MemoryFile {
    version: 1;
    items: MemoryItem[];
}

export interface MemoryConfig {
    enabled: boolean;
    learnFromExplicitPreferences: boolean;
    maxItems: number;
    maxInjected: number;
}

export interface ToolObservation {
    name: string;
    args: Record<string, any>;
    result: string;
    isError: boolean;
}

const MEMORY_VERSION = 1;
const MAX_TEXT_CHARS = 220;
const SECRET_PATTERNS = [
    /sk-[a-z0-9_-]{12,}/i,
    /(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*\S+/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
    /\b[A-Za-z0-9+/]{32,}={0,2}\b/,
];

function globalMemoryPath(workspace?: string, windowSessionId?: string): string {
    return workspace && windowSessionId
        ? workspaceWindowDataPath(workspace, windowSessionId, 'memory-global.json')
        : path.join(os.homedir(), '.mimo', 'memory.json');
}

function workspaceMemoryPath(workspace: string, windowSessionId?: string): string {
    return windowSessionId
        ? workspaceWindowDataPath(workspace, windowSessionId, 'memory.json')
        : workspaceDataPath(workspace, 'memory.json');
}

function nowIso(): string {
    return new Date().toISOString();
}

function normalizeWorkspace(workspace: string): string {
    return path.resolve(workspace || process.cwd()).toLowerCase();
}

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function isSensitive(text: string): boolean {
    return SECRET_PATTERNS.some(pattern => pattern.test(text));
}

function readMemoryFile(p: string): MemoryFile {
    try {
        if (!fs.existsSync(p)) return { version: MEMORY_VERSION, items: [] };
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (!parsed || parsed.version !== MEMORY_VERSION || !Array.isArray(parsed.items)) {
            return { version: MEMORY_VERSION, items: [] };
        }
        return {
            version: MEMORY_VERSION,
            items: parsed.items
                .filter((item: any) => item && typeof item.text === 'string')
                .map((item: any) => ({
                    id: String(item.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
                    kind: item.kind === 'project' || item.kind === 'correction' || item.kind === 'workflow' ? item.kind : 'preference',
                    scope: item.scope === 'workspace' ? 'workspace' : 'global',
                    workspace: typeof item.workspace === 'string' ? item.workspace : undefined,
                    text: normalizeText(item.text),
                    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.6)),
                    createdAt: String(item.createdAt || nowIso()),
                    updatedAt: String(item.updatedAt || nowIso()),
                    hits: Math.max(0, Number(item.hits) || 0),
                    source: item.source === 'heuristic' ? 'heuristic' : 'explicit',
                }))
                .filter((item: MemoryItem) => item.text && !isSensitive(item.text)),
        };
    } catch {
        return { version: MEMORY_VERSION, items: [] };
    }
}

function writeMemoryFile(p: string, data: MemoryFile): void {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function tokenize(text: string): Set<string> {
    const lower = text.toLowerCase();
    const parts = lower.match(/[\p{Script=Han}]{2,}|[a-z0-9_./-]{3,}/gu) || [];
    return new Set(parts);
}

function scoreMemory(item: MemoryItem, query: string, workspace: string): number {
    const q = tokenize(query);
    const m = tokenize(item.text);
    let overlap = 0;
    for (const token of q) {
        if (m.has(token)) overlap++;
    }
    const scopeBoost = item.scope === 'workspace' && item.workspace === normalizeWorkspace(workspace) ? 2 : 0;
    const kindBoost = item.kind === 'correction' ? 0.4 : item.kind === 'preference' ? 0.25 : item.kind === 'workflow' ? 0.2 : 0;
    return overlap + scopeBoost + kindBoost + item.confidence + Math.min(item.hits, 8) * 0.05;
}

const CN_EXPLICIT_MEMORY = /(?:\u8bb0\u4f4f|\u4ee5\u540e|\u4e0b\u6b21|\u9ed8\u8ba4|\u6211\u559c\u6b22|\u6211\u5e0c\u671b|\u4e0d\u8981\u518d|\u522b\u518d|\u4f18\u5148|\u603b\u662f|\u5c3d\u91cf|\u4e60\u60ef|\u504f\u597d)/;
const CN_CORRECTION = /(?:\u4e0d\u662f|\u7ea0\u6b63|\u66f4\u6b63|\u9519\u4e86|\u5e94\u8be5)/;
const CN_PROJECT_SCOPE = /(?:\u8fd9\u4e2a\u9879\u76ee|\u672c\u9879\u76ee|\u5f53\u524d\u9879\u76ee)/;

function extractExplicitMemories(userInput: string, workspace: string): MemoryItem[] {
    const raw = userInput.trim();
    if (!raw || raw.length > 4000 || isSensitive(raw)) return [];

    const normalized = normalizeText(raw);
    const explicit =
        CN_EXPLICIT_MEMORY.test(raw)
        || /\b(?:remember|from now on|next time|by default|i prefer|i like|do not|don't|always|never|prefer)\b/i.test(raw);
    if (!explicit) return [];

    let kind: MemoryKind = 'preference';
    if (CN_CORRECTION.test(raw) || /(?:correction|actually|instead)/i.test(raw)) kind = 'correction';
    if (CN_PROJECT_SCOPE.test(raw) || /(?:workspace|repo|repository|codebase)/i.test(raw)) kind = 'project';

    const scope: 'global' | 'workspace' = kind === 'project' || CN_PROJECT_SCOPE.test(raw) || /(?:workspace|repo|repository|codebase)/i.test(raw)
        ? 'workspace'
        : 'global';

    return [{
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        scope,
        workspace: scope === 'workspace' ? normalizeWorkspace(workspace) : undefined,
        text: normalized,
        confidence: 0.82,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        hits: 0,
        source: 'explicit',
    }];
}

function extractWorkflowMemories(toolObservations: ToolObservation[], workspace: string): MemoryItem[] {
    const items: MemoryItem[] = [];
    const seen = new Set<string>();
    for (const obs of toolObservations) {
        if (obs.isError || obs.name !== 'execute_command') continue;
        const command = typeof obs.args?.command === 'string' ? obs.args.command.trim() : '';
        if (!command || command.length > 220 || isSensitive(command)) continue;
        const result = obs.result || '';
        const looksSuccessful = /(?:SUCCESS|passed|compiled|Done in|0 failed|no errors|Build complete|Exit code: 0)/i.test(result)
            || !/(?:FAILED|error|Error:|Traceback|npm ERR!|tsc .*error)/i.test(result.slice(0, 1000));
        const isValidation = /(?:npm run compile|npm test|npm run test|pytest|python -m py_compile|node --check|tsc|go test|cargo test|dotnet test|mvn test|gradle test)/i.test(command);
        if (!looksSuccessful || !isValidation) continue;
        const text = `For this workspace, a useful successful validation command is: ${command}`;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
            id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            kind: 'workflow',
            scope: 'workspace',
            workspace: normalizeWorkspace(workspace),
            text,
            confidence: 0.72,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            hits: 0,
            source: 'heuristic',
        });
    }
    return items;
}


export class MemoryManager {
    constructor(private workspace: string, private config: MemoryConfig, private windowSessionId?: string) {}

    updateConfig(workspace: string, config: MemoryConfig, windowSessionId = this.windowSessionId): void {
        this.workspace = workspace;
        this.config = config;
        this.windowSessionId = windowSessionId;
    }

    getRelevant(query: string): MemoryItem[] {
        if (!this.config.enabled) return [];
        const data = this.readCombinedMemory();
        const workspace = normalizeWorkspace(this.workspace);
        return data.items
            .filter(item => item.scope === 'global' || item.workspace === workspace)
            .map(item => ({ item, score: scoreMemory(item, query, workspace) }))
            .filter(({ score }) => score > 0.7)
            .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
            .slice(0, Math.max(0, this.config.maxInjected))
            .map(({ item }) => item);
    }

    formatForPrompt(query: string): string {
        const items = this.getRelevant(query);
        if (items.length === 0) return '';
        const lines = items.map(item => `- [${item.kind}/${item.scope}] ${item.text}`);
        return [
            '## Learned User Memory',
            'These are local user-approved preferences or project notes learned from prior use. Follow them when relevant, but ignore them if they conflict with the current user request, repository evidence, or safety rules.',
            ...lines,
        ].join('\n');
    }

    learnFromTurn(userInput: string, assistantResponse: string, toolObservations: ToolObservation[] = []): number {
        if (!this.config.enabled || !this.config.learnFromExplicitPreferences) return 0;
        if (!assistantResponse || assistantResponse.startsWith('Error:') || assistantResponse.startsWith('FAILED:')) return 0;
        const candidates = [
            ...extractExplicitMemories(userInput, this.workspace),
            ...extractWorkflowMemories(toolObservations, this.workspace),
        ];
        if (candidates.length === 0) return 0;
        return this.addMemories(candidates);
    }

    addMemories(candidates: MemoryItem[]): number {
        if (!this.config.enabled || candidates.length === 0) return 0;
        const globalCandidates = candidates.filter(candidate => candidate.scope === 'global');
        const workspaceCandidates = candidates.filter(candidate => candidate.scope !== 'global');
        return this.addMemoriesToFile(globalMemoryPath(this.workspace, this.windowSessionId), globalCandidates)
            + this.addMemoriesToFile(workspaceMemoryPath(this.workspace, this.windowSessionId), workspaceCandidates);
    }

    private readCombinedMemory(): MemoryFile {
        const globalData = readMemoryFile(globalMemoryPath(this.workspace, this.windowSessionId));
        const workspaceData = readMemoryFile(workspaceMemoryPath(this.workspace, this.windowSessionId));
        const seen = new Set<string>();
        const items: MemoryItem[] = [];
        for (const item of [...globalData.items, ...workspaceData.items]) {
            const key = `${item.scope}|${item.workspace || ''}|${item.text.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(item);
        }
        return { version: MEMORY_VERSION, items };
    }

    private addMemoriesToFile(p: string, candidates: MemoryItem[]): number {
        if (candidates.length === 0) return 0;
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return withFileLockSync(p, () => {
            const data = readMemoryFile(p);
            let added = 0;
            for (const candidate of candidates) {
                const text = normalizeText(candidate.text);
                if (!text || isSensitive(text)) continue;
                const existing = data.items.find(item =>
                    item.scope === candidate.scope
                    && item.workspace === candidate.workspace
                    && item.text.toLowerCase() === text.toLowerCase(),
                );
                if (existing) {
                    existing.updatedAt = nowIso();
                    existing.confidence = Math.min(1, Math.max(existing.confidence, candidate.confidence));
                    existing.hits++;
                    continue;
                }
                data.items.push({ ...candidate, text });
                added++;
            }
            data.items = data.items
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, Math.max(1, this.config.maxItems));
            writeMemoryFile(p, data);
            return added;
        });
    }
}
