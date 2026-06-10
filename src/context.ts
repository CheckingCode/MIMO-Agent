/**
 * Context Manager — Token estimation, truncation, summarization, and sliding window.
 *
 * Problem: Multi-round tool conversations accumulate unbounded messages,
 * eventually exceeding the model's context window and causing API 400 errors.
 *
 * Solution: Track actual API token usage when available, fall back to estimation.
 * When context is high, compress tool results, summarize old messages,
 * or apply sliding window as a last resort.
 */

import { ChatMessage, MiMoAPI } from './api';

export interface ContextConfig {
    /** Max context window in tokens (per model) */
    maxContextTokens: number;
    /** Reserve tokens for the model's response */
    responseReserve: number;
    /** Max chars to keep per tool result */
    maxToolResultChars: number;
    /** Max messages to keep in sliding window (0 = unlimited) */
    maxMessages: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
    maxContextTokens: 32000,
    responseReserve: 4096,
    maxToolResultChars: 1500,
    maxMessages: 30,
};

// ── Precise Token Tracking ──
// Store actual API usage for accurate context management
let _lastPromptTokens = 0;
let _lastCompletionTokens = 0;
let _totalTokensThisSession = 0;

/**
 * Record actual token usage from API response.
 * Called after each API call that returns usage data.
 */
export function recordTokenUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    _lastPromptTokens = usage.promptTokens;
    _lastCompletionTokens = usage.completionTokens;
    _totalTokensThisSession += usage.totalTokens;
}

/**
 * Get the last known prompt token count from the API.
 * This is the most accurate measure of current context size.
 */
export function getLastPromptTokens(): number {
    return _lastPromptTokens;
}

/**
 * Reset token tracking (e.g., when starting a new conversation).
 */
export function resetTokenTracking(): void {
    _lastPromptTokens = 0;
    _lastCompletionTokens = 0;
    _totalTokensThisSession = 0;
}

// Model-specific context windows
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    'mimo-v2.5-pro': 1000000,   // Official MiMo V2.5 Pro context window
    'MiMo-V2.5-Pro': 1000000,
    'mimo-v2.5': 1000000,       // 1M context
    'MiMo-V2.5': 1000000,
    'mimo-v2.5-tts': 32000,
    'MiMo-V2.5-TTS': 32000,
    'mimo-v2-lite': 16000,      // Lightweight, likely smaller
    'mimo-v2-flash': 16000,     // Ultra-fast, likely smaller
};

/**
 * Estimate token count for a string.
 * More accurate estimation that handles different character types:
 * - CJK characters: ~0.7 tokens per char (1-2 chars = 1 token)
 * - CJK punctuation: ~0.5 tokens per char
 * - English words: ~1 token per 4 chars
 * - Numbers: ~1 token per 3 chars
 * - Other (punctuation, spaces): ~0.25 tokens per char
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;

    let tokens = 0;
    let i = 0;

    while (i < text.length) {
        const code = text.charCodeAt(i);

        if (code >= 0x4E00 && code <= 0x9FFF) {
            // CJK Unified Ideographs: typically 1-2 chars = 1 token
            tokens += 0.7;
            i++;
        } else if (code >= 0x3000 && code <= 0x303F) {
            // CJK Symbols and Punctuation
            tokens += 0.5;
            i++;
        } else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) {
            // English letters: ~4 letters = 1 token
            let wordLen = 0;
            while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
                wordLen++;
                i++;
            }
            tokens += Math.max(1, wordLen / 4);
        } else if (/[0-9]/.test(text[i])) {
            // Numbers
            let numLen = 0;
            while (i < text.length && /[0-9]/.test(text[i])) {
                numLen++;
                i++;
            }
            tokens += Math.max(1, numLen / 3);
        } else {
            // Other characters (punctuation, spaces, etc.)
            tokens += 0.25;
            i++;
        }
    }

    return Math.ceil(tokens + 4); // +4 for message overhead
}

/**
 * Estimate tokens for a single message.
 */
export function estimateMessageTokens(msg: ChatMessage): number {
    let tokens = 4; // Message overhead (role, separators)

    // Content
    if (typeof msg.content === 'string') {
        tokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
            if (part.type === 'text') {
                tokens += estimateTokens(part.text || '');
            } else if (part.type === 'image_url') {
                tokens += 1000; // Rough estimate for images
            }
        }
    }

    // Tool calls
    if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
            tokens += estimateTokens(tc.function.name);
            tokens += estimateTokens(tc.function.arguments);
            tokens += 10; // Structure overhead
        }
    }

    // Reasoning content
    if (msg.reasoning_content) {
        tokens += estimateTokens(msg.reasoning_content);
    }

    // Tool result messages have additional structure overhead
    if (msg.role === 'tool' && msg.tool_call_id) {
        tokens += 4; // tool_call_id overhead
    }

    return tokens;
}

/**
 * Estimate total tokens for a message array.
 */
export function estimateTotalTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Compress a tool result by truncating and adding a note.
 */
function compressToolResult(content: string, maxChars: number): string {
    if (content.length <= maxChars) return content;
    const truncated = content.substring(0, maxChars);
    const removed = content.length - maxChars;
    return truncated + `\n... (${removed} chars truncated to save context)`;
}

function compressReasoningContent(content: string, maxChars: number): string {
    if (!content) return '';
    const clean = content.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    const head = clean.slice(0, Math.floor(maxChars * 0.35));
    const tail = clean.slice(-Math.floor(maxChars * 0.55));
    return `[reasoning compacted for context]\n${head}\n...\n${tail}`;
}

/**
 * Compress messages in-place:
 * - Truncate large tool results
 * - Remove reasoning_content from old messages (keep only recent)
 */
function compressMessages(messages: ChatMessage[], config: ContextConfig, keepRecent: number): void {
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // Compress tool results (role === 'tool')
        if (msg.role === 'tool' && typeof msg.content === 'string') {
            if (msg.content.length > config.maxToolResultChars) {
                (msg as any).content = compressToolResult(msg.content, config.maxToolResultChars);
            }
        }

        // Compact old reasoning. For messages with tool calls, keep the field present
        // because some OpenAI-compatible APIs expect it in the replayed assistant message.
        const isRecent = i >= messages.length - keepRecent;
        if (!isRecent && msg.reasoning_content) {
            (msg as any).reasoning_content = msg.tool_calls?.length
                ? compressReasoningContent(msg.reasoning_content, 900)
                : '[reasoning omitted for context]';
        }
    }
}

/**
 * Apply sliding window to keep messages within the token budget.
 *
 * Strategy:
 * 1. Always keep: system message + first user message (for context)
 * 2. Compress: tool results and old reasoning
 * 3. Drop: oldest messages if still over budget
 * 4. Never drop: the most recent user message
 */
export function manageContext(
    messages: ChatMessage[],
    model: string,
    config: Partial<ContextConfig> = {},
): ChatMessage[] {
    const fullConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config };

    // Override max context from model capabilities
    const modelContext = MODEL_CONTEXT_WINDOWS[model] || fullConfig.maxContextTokens;
    fullConfig.maxContextTokens = modelContext;

    const availableTokens = fullConfig.maxContextTokens - fullConfig.responseReserve;

    // Work on a copy to avoid mutating the original during estimation
    let working = messages.map(m => ({ ...m }));

    // Step 1: Compress all messages
    const keepRecent = Math.min(10, working.length); // Keep reasoning for last 10 messages
    compressMessages(working, fullConfig, keepRecent);

    // Step 2: Check if we're within budget
    let totalTokens = estimateTotalTokens(working);

    if (totalTokens <= availableTokens) {
        return working;
    }

    console.log(`[MiMo] Context overflow: ${totalTokens} tokens > ${availableTokens} budget. Applying sliding window.`);

    // Step 3: Sliding window — keep system messages + first user msg + recent messages
    // CRITICAL: Must respect tool_call / tool_result pairing.
    // Dropping an assistant message with tool_calls without dropping its tool results
    // (or vice versa) causes API 400 errors.
    if (working.length <= 2) return working;

    const firstUserIdx = working.findIndex(m => m.role === 'user');
    const firstUser = firstUserIdx >= 0 ? working[firstUserIdx] : null;

    // Find safe cut points: positions where we can split without breaking tool chains.
    // A safe cut point is right before a user message or right after a complete tool chain.
    const safeCutPoints = new Set<number>();
    safeCutPoints.add(firstUserIdx >= 0 ? firstUserIdx + 1 : 0); // after first user

    for (let i = 0; i < working.length; i++) {
        const m = working[i];
        if (m.role === 'user') {
            safeCutPoints.add(i);
            safeCutPoints.add(i + 1);
        }
        // After a complete tool chain: assistant(tool_calls) followed by all its tool results
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
            const toolCallIds = new Set(m.tool_calls.map(tc => tc.id));
            // Check if all tool results are present
            let allPresent = true;
            for (let j = i + 1; j < working.length; j++) {
                if (working[j].role === 'tool' && toolCallIds.has(working[j].tool_call_id || '')) {
                    toolCallIds.delete(working[j].tool_call_id || '');
                }
                if (toolCallIds.size === 0) break;
                if (working[j].role === 'user' || working[j].role === 'assistant') {
                    allPresent = false;
                    break;
                }
            }
            if (allPresent && toolCallIds.size === 0) {
                // Find the last tool result in this chain
                let lastToolIdx = i;
                for (let j = i + 1; j < working.length; j++) {
                    if (working[j].role === 'tool') lastToolIdx = j;
                    else break;
                }
                safeCutPoints.add(lastToolIdx + 1);
            }
        }
    }

    // Find the best cut point: keep as many recent messages as possible while staying in budget
    // Start from the end and work backwards to find the earliest safe cut
    let keepFrom = working.length; // default: keep everything (shouldn't happen since we're over budget)
    for (let i = working.length - 1; i >= 0; i--) {
        if (safeCutPoints.has(i)) {
            const candidate = working.slice(i);
            const candidateTokens = estimateTotalTokens(candidate);
            if (candidateTokens <= availableTokens) {
                keepFrom = i;
            }
            break; // Only check the nearest safe cut point to the end
        }
    }

    // If no safe cut point fits, try progressively earlier cut points
    if (keepFrom >= working.length) {
        const sortedCuts = [...safeCutPoints].sort((a, b) => b - a);
        for (const cut of sortedCuts) {
            const candidate = working.slice(cut);
            if (estimateTotalTokens(candidate) <= availableTokens) {
                keepFrom = cut;
                break;
            }
        }
    }

    // Build new message list: system messages + first user + dropped marker + recent messages
    const result: ChatMessage[] = [];

    // Always preserve all system messages (they contain tool schemas, persona, etc.)
    for (let i = 0; i < working.length; i++) {
        if (working[i].role === 'system') {
            result.push(working[i]);
        }
    }

    if (firstUser) {
        result.push(firstUser);
        if (keepFrom > firstUserIdx + 1) {
            result.push({
                role: 'system',
                content: '[Some earlier conversation history was removed to save context]',
            } as any);
        }
    }

    for (let i = keepFrom; i < working.length; i++) {
        if (working[i].role !== 'system') { // Avoid duplicating system messages
            result.push(working[i]);
        }
    }

    totalTokens = estimateTotalTokens(result);
    console.log(`[MiMo] After sliding window: ${result.length} messages, ~${totalTokens} tokens`);

    // Safety re-check: if still over budget, truncate tool results further (never drop messages)
    if (totalTokens > availableTokens) {
        for (const m of result) {
            if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
                m.content = m.content.substring(0, 500) + '\n... (truncated to save context)';
                totalTokens = estimateTotalTokens(result);
                if (totalTokens <= availableTokens) break;
            }
        }
        console.log(`[MiMo] After tool result truncation: ~${totalTokens} tokens`);
    }

    return result;
}

/**
 * Get context usage stats for display.
 * Includes an estimate for system prompt overhead (typically 1000-2000 tokens).
 */
export function getContextStats(
    messages: ChatMessage[],
    model: string,
    systemPromptLength?: number,
): { used: number; total: number; percent: number; model: string } {
    const total = MODEL_CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_CONFIG.maxContextTokens;

    // Always use heuristic estimation based on CURRENT messages
    // (API-reported tokens are from the PREVIOUS call, not current — they become stale)
    const msgTokens = estimateTotalTokens(messages);
    const systemOverhead = systemPromptLength
        ? Math.ceil(systemPromptLength / 3) + 100
        : 1500;
    const formatOverhead = messages.length * 2;
    const used = msgTokens + systemOverhead + formatOverhead;

    return {
        used,
        total,
        percent: Math.round((used / total) * 100),
        model,
    };
}

/**
 * Smart context compression using LLM summarization.
 *
 * When context usage exceeds the threshold, old messages are compressed
 * into a summary using the LLM itself. This preserves semantic information
 * that simple truncation would lose.
 *
 * @param messages - Current conversation messages
 * @param api - MiMoAPI instance for making summarization calls
 * @param model - Model to use for summarization
 * @param config - Context configuration
 * @param signal - Optional abort signal
 * @returns Compressed messages array
 */
export async function summarizeContext(
    messages: ChatMessage[],
    api: MiMoAPI,
    model: string,
    config: Partial<ContextConfig> = {},
    signal?: AbortSignal,
): Promise<ChatMessage[]> {
    const fullConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config };
    const modelContext = MODEL_CONTEXT_WINDOWS[model] || fullConfig.maxContextTokens;
    fullConfig.maxContextTokens = modelContext;

    const availableTokens = fullConfig.maxContextTokens - fullConfig.responseReserve;
    const currentTokens = estimateTotalTokens(messages);

    // Only summarize if we're above 75% capacity
    if (currentTokens <= availableTokens * 0.75) {
        return messages;
    }

    // Need at least 10 messages to summarize (keep recent ones intact)
    if (messages.length < 10) {
        // Fall back to simple compression
        return manageContext(messages, model, config);
    }

    // Keep the last 10 messages intact, summarize the rest
    const keepRecent = 10;
    const toSummarize = messages.slice(0, messages.length - keepRecent);
    const recent = messages.slice(messages.length - keepRecent);

    // Preserve system messages from the summarized section (they contain tool schemas, persona, etc.)
    const preservedSystem = toSummarize.filter(m => m.role === 'system');
    const nonSystemToSummarize = toSummarize.filter(m => m.role !== 'system');

    // Build a summary prompt from the old non-system messages
    const conversationText = nonSystemToSummarize.map(m => {
        if (m.role === 'user') return `User: ${extractTextContent(m.content)}`;
        if (m.role === 'assistant') return `Assistant: ${extractTextContent(m.content)}`;
        if (m.role === 'tool') return `[Tool Result]: ${extractTextContent(m.content).substring(0, 300)}`;
        return `[${m.role}]: ${extractTextContent(m.content)}`;
    }).join('\n\n');

    const summaryPrompt = `You are a conversation summarizer for a coding agent. Compress the following conversation into a structured summary that preserves CRITICAL context.

CRITICAL RULES:
1. PRESERVE all file paths mentioned (exact paths, not descriptions)
2. PRESERVE all error messages and their solutions
3. PRESERVE all user constraints (requirements, limitations, preferences)
4. PRESERVE the current task state (what's done, what's pending)
5. DROP casual conversation, greetings, and meta-discussion
6. Preserve the REASONING behind decisions — not just the outcomes

STRUCTURED FORMAT (follow exactly):

## Current Task
[What is being worked on RIGHT NOW, exact step]

## Files Modified (with exact changes)
- path/to/file: [what changed]

## Key Constraints (PRESERVE EXACTLY)
- [Constraint 1]
- [Constraint 2]

## Errors & Solutions
- [Error]: [Solution applied]

## Pending Steps
- [ ] [Next step]

## Important Decisions
- [Decision]: [Rationale]

Keep under 400 words. Prioritize actionable information.

Conversation:
${conversationText.substring(0, 8000)}

Summary:`;

    try {
        const summary = await api.chatCompletion({
            model,
            messages: [
                { role: 'system', content: 'You are a concise summarizer. Output only the summary, no preamble.' },
                { role: 'user', content: summaryPrompt },
            ],
            max_tokens: 1000,
            temperature: 0.3,
        }, signal);

        if (summary && summary.length > 50) {
            // Insert preserved system messages + summary + recent messages
            const result: ChatMessage[] = [
                ...preservedSystem,
                {
                    role: 'system',
                    content: `[Conversation Summary — ${nonSystemToSummarize.length} messages compressed]\n${summary}`,
                } as any,
                ...recent,
            ];

            const newTokens = estimateTotalTokens(result);
            console.log(`[MiMo] Summarized ${toSummarize.length} messages: ${currentTokens} → ${newTokens} tokens`);

            return result;
        }
    } catch (e: any) {
        console.warn(`[MiMo] Summarization failed, falling back to sliding window: ${e.message}`);
    }

    // Fallback to simple sliding window
    return manageContext(messages, model, config);
}

/**
 * Extract text content from a message (handles both string and ContentPart[]).
 */
function extractTextContent(content: string | any[]): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text || '')
            .join(' ');
    }
    return '';
}

/**
 * Get context usage warning level and message.
 * Useful for displaying context usage in the UI.
 */
export function getContextWarning(messages: ChatMessage[], model: string): {
    level: 'normal' | 'warning' | 'critical';
    message: string;
    percent: number;
} {
    const stats = getContextStats(messages, model);

    if (stats.percent >= 90) {
        return {
            level: 'critical',
            message: `🔴 上下文即将溢出（${stats.percent}%）。早期对话内容将被压缩或丢弃。`,
            percent: stats.percent,
        };
    }

    if (stats.percent >= 75) {
        return {
            level: 'warning',
            message: `🟡 上下文使用率较高（${stats.percent}%）。较长的对话可能会丢失早期内容。`,
            percent: stats.percent,
        };
    }

    return { level: 'normal', message: '', percent: stats.percent };
}
