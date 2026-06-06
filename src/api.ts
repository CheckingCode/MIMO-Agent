import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | ContentPart[];
    tool_call_id?: string;
    tool_calls?: ToolCall[];
    reasoning_content?: string;
    /** Replay metadata — tool name for history display */
    _toolName?: string;
    /** Replay metadata — elapsed seconds for history display */
    _toolElapsed?: number;
}

export interface ContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}

export interface StreamDelta {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
    }>;
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface StreamCallbacks {
    onToken?: (token: string) => void;
    onReasoning?: (token: string) => void;
    onToolCalls?: (toolCalls: ToolCall[]) => void;
    onError?: (error: string) => void;
    onUsage?: (usage: TokenUsage) => void;
}

function createAbortError(message = 'Aborted'): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

/**
 * MiMo API client — pure HTTP, no SDK dependency.
 * Uses OpenAI-compatible chat completions with SSE streaming.
 */
export class MiMoAPI {
    constructor(
        private apiKey: string,
        private baseUrl: string,
    ) {}

    /**
     * Non-streaming chat completion. Used for internal tasks like summarization.
     * Returns the full response text.
     */
    async chatCompletion(
        params: Record<string, any>,
        signal?: AbortSignal,
    ): Promise<string> {
        const url = `${this.baseUrl}/chat/completions`;
        const body = Buffer.from(JSON.stringify({ ...params, stream: false }), 'utf-8');

        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === 'https:';
            const transport = isHttps ? https : http;

            const req = transport.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': body.length,
                        Authorization: `Bearer ${this.apiKey}`,
                        Accept: 'application/json',
                    },
                    timeout: 60_000,
                },
                (res) => {
                    let data = '';
                    res.on('data', (c: Buffer) => (data += c.toString('utf-8')));
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`API error ${res.statusCode}: ${data.slice(0, 500)}`));
                            return;
                        }
                        try {
                            const json = JSON.parse(data);
                            const content = json.choices?.[0]?.message?.content || '';
                            resolve(content);
                        } catch {
                            reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
                        }
                    });
                    res.on('error', reject);
                },
            );

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

            if (signal) {
                if (signal.aborted) { req.destroy(); reject(createAbortError()); return; }
                signal.addEventListener('abort', () => { req.destroy(); reject(createAbortError()); }, { once: true });
            }

            req.write(body);
            req.end();
        });
    }

    /**
     * Streaming chat completion. Calls callbacks as tokens arrive.
     * Returns the full collected content and tool calls.
     */
    async chatCompletionsStream(
        params: Record<string, any>,
        callbacks: StreamCallbacks,
        signal?: AbortSignal,
    ): Promise<{ content: string; toolCalls: ToolCall[]; reasoningContent: string; usage: TokenUsage | null }> {
        const maxRetries = 3;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await this.doChatCompletionsStream(params, callbacks, signal);
            } catch (e: any) {
                lastError = e;
                // Retry on 429 (rate limit), 5xx (server errors), and 400 with truncation
                const isRetryable = e.message?.includes('429') || /\b5\d{2}\b/.test(e.message || '') || e.message?.includes('unexpected end of data');
                if (!isRetryable || signal?.aborted || attempt >= maxRetries) {
                    throw e;
                }
                // Exponential backoff: 2s, 4s, 8s
                const delay = Math.min(2000 * Math.pow(2, attempt), 15000);
                callbacks.onToken?.(`\n[Rate limited, retrying in ${delay / 1000}s...]\n`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError || new Error('Max retries exceeded');
    }

    private async doChatCompletionsStream(
        params: Record<string, any>,
        callbacks: StreamCallbacks,
        signal?: AbortSignal,
    ): Promise<{ content: string; toolCalls: ToolCall[]; reasoningContent: string; usage: TokenUsage | null }> {
        const url = `${this.baseUrl}/chat/completions`;
        const body = Buffer.from(JSON.stringify({ ...params, stream: true }), 'utf-8');
        console.log(`[MiMo API] Request: ${params.model}, messages: ${params.messages?.length}, body size: ${body.length} chars`);

        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === 'https:';
            const transport = isHttps ? https : http;
            let settled = false;
            const settle = (err: Error) => { if (!settled) { settled = true; reject(err); } };

            const req = transport.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': body.length,
                        Authorization: `Bearer ${this.apiKey}`,
                        Accept: 'text/event-stream',
                    },
                    timeout: 120_000,
                },
                (res) => {
                    resRef = res; // save for abort listener
                    if (res.statusCode !== 200) {
                        let errBody = '';
                        res.on('data', (c) => (errBody += c.toString()));
                        res.on('end', () =>
                            settle(new Error(`API error ${res.statusCode}: ${errBody.slice(0, 500)}`)),
                        );
                        return;
                    }

                    let collectedContent = '';
                    let collectedReasoning = '';
                    let collectedUsage: TokenUsage | null = null;
                    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
                    let buffer = '';

                    res.on('data', (chunk: Buffer) => {
                        // Check abort during streaming — destroy immediately
                        if (signal?.aborted) {
                            res.destroy();
                            req.destroy();
                            settle(createAbortError());
                            return;
                        }
                        buffer += chunk.toString('utf-8');

                        // Process complete lines
                        let nlIdx: number;
                        while ((nlIdx = buffer.indexOf('\n')) !== -1) {
                            const line = buffer.slice(0, nlIdx).trim();
                            buffer = buffer.slice(nlIdx + 1);

                            if (!line) continue;
                            if (line === 'data: [DONE]') {
                                // Finalize
                                const toolCalls: ToolCall[] = [];
                                for (const [, tc] of toolCallsMap) {
                                    if (tc.id && tc.name) {
                                        toolCalls.push({
                                            id: tc.id,
                                            type: 'function',
                                            function: { name: tc.name, arguments: tc.arguments },
                                        });
                                    }
                                }
                                if (toolCalls.length > 0) {
                                    callbacks.onToolCalls?.(toolCalls);
                                }
                                if (collectedUsage) {
                                    callbacks.onUsage?.(collectedUsage);
                                }
                                resolve({ content: collectedContent, toolCalls, reasoningContent: collectedReasoning, usage: collectedUsage });
                                return;
                            }

                            if (!line.startsWith('data: ')) continue;
                            let parsed: any;
                            try {
                                parsed = JSON.parse(line.slice(6));
                            } catch {
                                continue;
                            }

                            const choices = parsed.choices;
                            if (!choices?.length) continue;
                            const delta: StreamDelta = choices[0].delta || {};

                            // Reasoning content (MiMo thinking)
                            if (delta.reasoning_content) {
                                collectedReasoning += delta.reasoning_content;
                                callbacks.onReasoning?.(delta.reasoning_content);
                            }

                            // Main content
                            if (delta.content) {
                                collectedContent += delta.content;
                                callbacks.onToken?.(delta.content);
                            }

                            // Tool calls (streamed incrementally)
                            if (delta.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const idx = tc.index;
                                    if (!toolCallsMap.has(idx)) {
                                        toolCallsMap.set(idx, { id: '', name: '', arguments: '' });
                                    }
                                    const existing = toolCallsMap.get(idx)!;
                                    if (tc.id) existing.id = tc.id;
                                    if (tc.function?.name) existing.name = tc.function.name;
                                    if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                                }
                            }

                            // Token usage (sent in final chunk by OpenAI-compatible APIs)
                            if (parsed.usage) {
                                collectedUsage = {
                                    promptTokens: parsed.usage.prompt_tokens || 0,
                                    completionTokens: parsed.usage.completion_tokens || 0,
                                    totalTokens: parsed.usage.total_tokens || 0,
                                };
                            }
                        }
                    });

                    res.on('end', () => {
                        // If we get here without [DONE], resolve with what we have
                        const toolCalls: ToolCall[] = [];
                        for (const [, tc] of toolCallsMap) {
                            if (tc.id && tc.name) {
                                toolCalls.push({
                                    id: tc.id,
                                    type: 'function',
                                    function: { name: tc.name, arguments: tc.arguments },
                                });
                            }
                        }
                        if (collectedUsage) {
                            callbacks.onUsage?.(collectedUsage);
                        }
                        if (!settled) {
                            settled = true;
                            resolve({ content: collectedContent, toolCalls, reasoningContent: collectedReasoning, usage: collectedUsage });
                        }
                    });

                    res.on('error', (err) => { settle(err); });
                },
            );

            req.on('error', (err) => { settle(err); });
            req.on('timeout', () => {
                req.destroy();
                settle(new Error('Request timeout'));
            });

            // Handle abort signal — destroy both req AND res for fast teardown
            let resRef: any = null;
            if (signal) {
                if (signal.aborted) {
                    req.destroy();
                    settle(createAbortError());
                    return;
                }
                signal.addEventListener('abort', () => {
                    if (resRef) resRef.destroy();
                    req.destroy();
                    settle(createAbortError());
                }, { once: true });
            }

            req.write(body);
            req.end();
        });
    }
}
