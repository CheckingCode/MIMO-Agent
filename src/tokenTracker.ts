/**
 * Token Usage Tracker
 *
 * Tracks token consumption per API call, per conversation, and globally.
 * Data is persisted to ~/.mimo/token-usage.json for historical analysis.
 *
 * Multi-window safe: uses atomic writes and disk merging to prevent data loss
 * when multiple VSCode windows write to the same file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWriteSync } from './utils/fileLock';

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface CallRecord {
    id: string;
    convId: string;
    model: string;
    round: number;
    toolName?: string;
    usage: TokenUsage;
    timestamp: number;
    elapsed: number;
}

export interface ConversationUsage {
    convId: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    callCount: number;
    calls: CallRecord[];
}

export interface GlobalUsage {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCalls: number;
    conversations: Record<string, ConversationUsage>;
}

export class TokenTracker {
    private data: GlobalUsage;
    private dataPath: string;
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.dataPath = path.join(os.homedir(), '.mimo', 'token-usage.json');
        this.data = this.load();
    }

    private load(): GlobalUsage {
        try {
            if (fs.existsSync(this.dataPath)) {
                return JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
            }
        } catch { /* ignore */ }
        return {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCalls: 0,
            conversations: {},
        };
    }

    private scheduleSave(): void {
        this.dirty = true;
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            if (this.dirty) {
                this.flush();
            }
        }, 5000); // Debounce: save at most every 5 seconds
    }

    /**
     * Atomic flush: read latest disk data → merge local changes → atomic write.
     * This prevents data loss when multiple VSCode windows write concurrently.
     */
    flush(): void {
        if (!this.dirty) return;
        this.dirty = false;

        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            // Read latest data from disk (other windows may have updated)
            let diskData: GlobalUsage;
            try {
                diskData = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
            } catch {
                diskData = this.emptyData();
            }

            // Merge: use local data for conversations we manage, keep disk data for others
            const merged = this.mergeWithDisk(diskData);
            atomicWriteSync(this.dataPath, JSON.stringify(merged, null, 2));
        } catch { /* ignore */ }
    }

    /**
     * Merge logic: conversations managed by this instance use local data,
     * others keep the disk version. Recalculates global totals from merged data.
     */
    private mergeWithDisk(disk: GlobalUsage): GlobalUsage {
        const mergedConversations = { ...disk.conversations };

        // Override with local data (this instance may have updated these conversations)
        for (const [convId, localConv] of Object.entries(this.data.conversations)) {
            mergedConversations[convId] = localConv;
        }

        // Recalculate global totals from merged conversations
        let totalPrompt = 0, totalCompletion = 0, total = 0, totalCalls = 0;
        for (const conv of Object.values(mergedConversations)) {
            totalPrompt += conv.totalPromptTokens;
            totalCompletion += conv.totalCompletionTokens;
            total += conv.totalTokens;
            totalCalls += conv.callCount;
        }

        return {
            totalPromptTokens: totalPrompt,
            totalCompletionTokens: totalCompletion,
            totalTokens: total,
            totalCalls,
            conversations: mergedConversations,
        };
    }

    /**
     * Create empty data structure.
     */
    private emptyData(): GlobalUsage {
        return {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCalls: 0,
            conversations: {},
        };
    }

    /**
     * Record a single API call's token usage.
     */
    addCall(record: CallRecord): void {
        const { convId, usage } = record;

        // Update global totals
        this.data.totalPromptTokens += usage.promptTokens;
        this.data.totalCompletionTokens += usage.completionTokens;
        this.data.totalTokens += usage.totalTokens;
        this.data.totalCalls++;

        // Update per-conversation
        if (!this.data.conversations[convId]) {
            this.data.conversations[convId] = {
                convId,
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalTokens: 0,
                callCount: 0,
                calls: [],
            };
        }
        const conv = this.data.conversations[convId];
        conv.totalPromptTokens += usage.promptTokens;
        conv.totalCompletionTokens += usage.completionTokens;
        conv.totalTokens += usage.totalTokens;
        conv.callCount++;
        conv.calls.push(record);

        // Keep only last 500 calls per conversation to bound file size
        if (conv.calls.length > 500) {
            conv.calls = conv.calls.slice(-500);
        }

        this.scheduleSave();
    }

    /**
     * Get usage for a specific conversation.
     */
    getConversationUsage(convId: string): ConversationUsage | null {
        return this.data.conversations[convId] || null;
    }

    /**
     * Get global usage summary.
     */
    getGlobalUsage(): { totalPromptTokens: number; totalCompletionTokens: number; totalTokens: number; totalCalls: number } {
        return {
            totalPromptTokens: this.data.totalPromptTokens,
            totalCompletionTokens: this.data.totalCompletionTokens,
            totalTokens: this.data.totalTokens,
            totalCalls: this.data.totalCalls,
        };
    }

    /**
     * Get all conversation summaries (without full call lists).
     */
    getConversationSummaries(): Array<{ convId: string; totalTokens: number; callCount: number }> {
        return Object.values(this.data.conversations).map(c => ({
            convId: c.convId,
            totalTokens: c.totalTokens,
            callCount: c.callCount,
        }));
    }

    /**
     * Export full data as JSON string.
     */
    exportJson(): string {
        return JSON.stringify(this.data, null, 2);
    }

    /**
     * Reset all data.
     */
    reset(): void {
        this.data = {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCalls: 0,
            conversations: {},
        };
        this.dirty = true;
        this.flush();
    }
}
