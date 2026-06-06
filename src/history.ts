import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatMessage, ContentPart } from './api';
import { atomicWriteSync } from './utils/fileLock';

export interface HistoryEntry {
    id: string;
    title: string;
    timestamp: string;
    model: string;
    messageCount: number;
}

export interface HistoryConversation extends HistoryEntry {
    messages: ChatMessage[];
    mode?: string;
    personaId?: string;
    activeSkillPrompt?: string;
    inputHistory?: string[];
}

/**
 * Lightweight index file (~/.mimo/history/index.json) that stores only metadata
 * for all conversations. This avoids reading every full JSON file just to list entries.
 */
interface HistoryIndex {
    [id: string]: HistoryEntry;
}

export class HistoryManager {
    private historyDir: string;
    private indexPath: string;
    private _index: HistoryIndex | null = null;
    /** IDs deleted in this session — excluded during index merge to prevent re-addition from disk */
    private _deletedIds = new Set<string>();

    constructor() {
        this.historyDir = path.join(os.homedir(), '.mimo', 'history');
        this.indexPath = path.join(this.historyDir, 'index.json');
        this.ensureDir();
    }

    private ensureDir(): void {
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
    }

    private filePath(id: string): string {
        return path.join(this.historyDir, `${id}.json`);
    }

    // ── Index management ──

    /**
     * Load the index from disk, or build it from existing files (backward compat).
     * Validates each entry to ensure required fields exist.
     *
     * PERFORMANCE: When rebuilding from files, sorts by mtime (newest first)
     * and limits to MAX_BUILD_FILES to avoid blocking the UI on first access.
     */
    private loadIndex(): HistoryIndex {
        if (this._index) return this._index;

        // Try to read existing index
        try {
            if (fs.existsSync(this.indexPath)) {
                const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
                this._index = {};
                for (const [id, entry] of Object.entries(raw)) {
                    if (entry && typeof entry === 'object' && (entry as any).id) {
                        this._index[id] = {
                            id: (entry as any).id,
                            title: (entry as any).title || 'Untitled',
                            timestamp: (entry as any).timestamp || '',
                            model: (entry as any).model || '',
                            messageCount: (entry as any).messageCount || 0,
                        };
                    }
                }
                return this._index!;
            }
        } catch { /* corrupted index, rebuild */ }

        // Build index from existing conversation files (backward compatibility)
        // Limit to most recent 100 files to avoid UI freeze on first access
        const MAX_BUILD_FILES = 100;
        this._index = {};
        try {
            const files = fs.readdirSync(this.historyDir)
                .filter(f => f.endsWith('.json') && f !== 'index.json')
                .map(f => {
                    try {
                        return { name: f, mtime: fs.statSync(path.join(this.historyDir, f)).mtimeMs };
                    } catch {
                        return { name: f, mtime: 0 };
                    }
                })
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, MAX_BUILD_FILES);

            for (const f of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(this.historyDir, f.name), 'utf-8'));
                    if (data.id) {
                        this._index[data.id] = {
                            id: data.id,
                            title: data.title || 'Untitled',
                            timestamp: data.timestamp || '',
                            model: data.model || '',
                            messageCount: data.messageCount || 0,
                        };
                    }
                } catch { /* skip corrupted files */ }
            }
            this.saveIndex();
        } catch { /* ignore */ }

        return this._index!;
    }

    /**
     * Persist the index to disk with merge strategy for multi-window safety.
     *
     * Before writing, re-reads the disk index and merges:
     * - Entries only on disk are preserved (added by another window)
     * - Entries in memory take precedence for overlapping keys (our updates win)
     * This prevents concurrent windows from overwriting each other's entries.
     */
    private saveIndex(): void {
        if (!this._index) return;
        try {
            // Merge with disk version to avoid losing entries from other windows
            let merged: HistoryIndex = { ...this._index };
            try {
                if (fs.existsSync(this.indexPath)) {
                    const diskIndex: HistoryIndex = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
                    // Keep disk entries that we don't have in memory (added by another window)
                    // BUT skip entries deleted in this session to prevent re-addition
                    for (const [id, entry] of Object.entries(diskIndex)) {
                        if (!merged[id] && !this._deletedIds.has(id) && entry && typeof entry === 'object' && entry.id) {
                            merged[id] = entry;
                        }
                    }
                }
            } catch { /* corrupted disk index — use memory version only */ }

            atomicWriteSync(this.indexPath, JSON.stringify(merged, null, 2));
            // Update memory to reflect the merged state
            this._index = merged;
        } catch { /* ignore write errors */ }
    }

    // ── Helpers ──

    /**
     * Extract plain text from message content (handles string, ContentPart[], null).
     */
    private extractText(content: string | ContentPart[] | null | undefined): string {
        if (!content) return '';
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return '';
        return content.filter(p => p.type === 'text').map(p => p.text || '').join('');
    }

    // ── Public API ──

    /**
     * Normalize messages before saving to history.
     * Fixes common format issues that cause messy replay:
     * 1. null content → empty string (assistant messages with tool_calls)
     * 2. Ensure reasoning_content is always a string (never undefined)
     * 3. Ensure tool messages have _toolName fallback from tool_calls
     *
     * PERFORMANCE: Only creates copies when normalization is actually needed.
     * Messages that are already well-formed are kept as-is (no deep clone).
     */
    private normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
        // Build a map of tool_call_id → tool name from assistant messages
        const toolNameMap = new Map<string, string>();
        for (const m of messages) {
            if (m.role === 'assistant' && m.tool_calls) {
                for (const tc of m.tool_calls) {
                    toolNameMap.set(tc.id, tc.function.name);
                }
            }
        }

        return messages.map(m => {
            const needsContent = m.content === null || m.content === undefined;
            const needsReasoning = m.role === 'assistant' && m.reasoning_content === undefined;
            const needsToolName = m.role === 'tool' && !m._toolName && m.tool_call_id;

            // Skip copy if message is already well-formed
            if (!needsContent && !needsReasoning && !needsToolName) {
                return m;
            }

            const copy: ChatMessage = {
                role: m.role,
                content: m.content ?? '',
            };

            if (m.role === 'assistant') {
                copy.reasoning_content = m.reasoning_content || '';
                if (m.tool_calls) copy.tool_calls = m.tool_calls;
            }

            if (m.role === 'tool') {
                copy.tool_call_id = m.tool_call_id;
                copy._toolName = m._toolName || (m.tool_call_id ? toolNameMap.get(m.tool_call_id) : undefined) || 'tool';
                copy._toolElapsed = m._toolElapsed || 0;
            }

            return copy;
        });
    }

    /**
     * Save or overwrite a conversation by ID.
     * Also updates the lightweight index.
     */
    private buildInputHistory(messages: ChatMessage[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role !== 'user') continue;
            const text = this.extractText(msg.content).trim();
            if (!text || seen.has(text)) continue;
            seen.add(text);
            result.push(text);
            if (result.length >= 50) break;
        }
        return result;
    }

    save(
        id: string,
        title: string,
        messages: ChatMessage[],
        model: string,
        metadata: Partial<Pick<HistoryConversation, 'mode' | 'personaId' | 'activeSkillPrompt' | 'inputHistory'>> = {},
    ): void {
        const messageCount = messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
        const timestamp = new Date().toISOString();

        // Normalize messages before saving to fix format issues
        const normalized = this.normalizeMessages(messages);

        // Save full conversation file
        const entry: HistoryConversation = {
            id,
            title: title || 'Untitled',
            timestamp,
            model,
            messageCount,
            messages: normalized,
            mode: metadata.mode,
            personaId: metadata.personaId,
            activeSkillPrompt: metadata.activeSkillPrompt,
            inputHistory: metadata.inputHistory || this.buildInputHistory(normalized),
        };
        atomicWriteSync(this.filePath(id), JSON.stringify(entry, null, 2));

        // Update index (O(1) instead of re-reading all files)
        const index = this.loadIndex();
        index[id] = { id, title: title || 'Untitled', timestamp, model, messageCount };
        this.saveIndex();
    }

    /**
     * List all saved conversations (newest first).
     * Reads only the lightweight index file — O(1) regardless of history size.
     */
    list(): HistoryEntry[] {
        const index = this.loadIndex();
        return Object.values(index)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    /**
     * Load a full conversation by ID.
     * Applies format fixup to ensure old history files render correctly.
     * If fixup was needed, re-saves the file so it's correct on next load.
     */
    load(id: string): HistoryConversation | null {
        try {
            const data = JSON.parse(fs.readFileSync(this.filePath(id), 'utf-8'));
            if (data && Array.isArray(data.messages)) {
                const { messages: fixed, wasFixed } = this.fixupMessages(data.messages);
                data.messages = fixed;
                // Re-save if fixup changed anything (one-time migration)
                if (wasFixed) {
                    try {
                        atomicWriteSync(this.filePath(id), JSON.stringify(data, null, 2));
                    } catch { /* ignore write errors */ }
                }
            }
            return data as HistoryConversation;
        } catch {
            return null;
        }
    }

    /**
     * Fix common format issues in old history files so they render correctly.
     * This runs on load (not save) to handle legacy data without re-saving everything.
     * Returns [fixedMessages, wasFixed] — caller decides whether to re-save.
     */
    fixupMessages(messages: ChatMessage[]): { messages: ChatMessage[]; wasFixed: boolean } {
        // Build tool name map from assistant messages
        const toolNameMap = new Map<string, string>();
        for (const m of messages) {
            if (m.role === 'assistant' && m.tool_calls) {
                for (const tc of m.tool_calls) {
                    toolNameMap.set(tc.id, tc.function.name);
                }
            }
        }

        let wasFixed = false;
        const result = messages.map(m => {
            // null content → empty string
            if (m.content === null || m.content === undefined) {
                m = { ...m, content: '' };
                wasFixed = true;
            }
            // Ensure reasoning_content is always a string
            if (m.role === 'assistant' && m.reasoning_content === undefined) {
                m = { ...m, reasoning_content: '' };
                wasFixed = true;
            }
            // Ensure tool messages have _toolName
            if (m.role === 'tool' && !m._toolName && m.tool_call_id) {
                const fallback = toolNameMap.get(m.tool_call_id) || 'tool';
                m = { ...m, _toolName: fallback };
                wasFixed = true;
            }
            return m;
        });

        return { messages: wasFixed ? result : messages, wasFixed };
    }

    /**
     * Delete a conversation by ID.
     * Also removes from the index.
     */
    delete(id: string): boolean {
        try {
            const fp = this.filePath(id);
            if (fs.existsSync(fp)) {
                fs.unlinkSync(fp);
            }
            // Remove from index and track deletion to prevent re-addition from disk
            const index = this.loadIndex();
            delete index[id];
            this._deletedIds.add(id);
            this.saveIndex();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Search conversations by keyword (full-text search on titles and messages).
     */
    search(query: string): HistoryEntry[] {
        const lower = query.toLowerCase().trim();
        const index = this.loadIndex();
        const results: HistoryEntry[] = [];
        const matchedIds = new Set<string>();
        if (!lower) return this.list();

        // Search titles from index (fast)
        if (lower.length < 2) {
            return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        }
        const entries = Object.values(index)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .slice(0, 80);
        for (const entry of entries) {
            if (entry.title?.toLowerCase().includes(lower)) {
                results.push(entry);
                matchedIds.add(entry.id);
            }
        }

        // Search message content (requires reading full files — slower)
        for (const entry of Object.values(index)) {
            if (matchedIds.has(entry.id)) continue; // already matched by title
            try {
                const data = JSON.parse(fs.readFileSync(this.filePath(entry.id), 'utf-8')) as HistoryConversation;
                for (const msg of data.messages || []) {
                    const content = this.extractText(msg.content);
                    if (content.toLowerCase().includes(lower)) {
                        results.push(entry);
                        matchedIds.add(entry.id);
                        break;
                    }
                }
            } catch { /* skip corrupted files */ }
        }

        return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    /**
     * Export a conversation to Markdown.
     * Accepts either a conversation ID (string) or a pre-loaded HistoryConversation.
     */
    exportMarkdown(idOrConv: string | HistoryConversation): string | null {
        const conv = typeof idOrConv === 'string' ? this.load(idOrConv) : idOrConv;
        if (!conv) return null;

        let md = `# ${conv.title}\n\n`;
        md += `> Model: ${conv.model}\n`;
        md += `> Date: ${conv.timestamp}\n`;
        md += `> Messages: ${conv.messageCount}\n\n---\n\n`;

        for (const msg of conv.messages) {
            if (msg.role === 'user') {
                const text = this.extractText(msg.content);
                md += `## User\n\n${text}\n\n`;
            } else if (msg.role === 'assistant') {
                const text = this.extractText(msg.content);
                if (text) md += `## Assistant\n\n${text}\n\n`;
            }
        }

        return md;
    }

    /**
     * Export a conversation to JSON.
     * Accepts either a conversation ID (string) or a pre-loaded HistoryConversation.
     */
    exportJson(idOrConv: string | HistoryConversation): string | null {
        const conv = typeof idOrConv === 'string' ? this.load(idOrConv) : idOrConv;
        if (!conv) return null;
        return JSON.stringify(conv, null, 2);
    }

    /**
     * Export all conversations as a JSON array.
     */
    exportAllJson(): string {
        const entries = this.list();
        const conversations = entries.map(e => this.load(e.id)).filter(Boolean);
        return JSON.stringify(conversations, null, 2);
    }
}
