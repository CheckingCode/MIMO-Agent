import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export type ApiEndpointMode = 'chat_completions' | 'responses';

export function normalizeApiEndpointMode(value: unknown): ApiEndpointMode {
    return value === 'responses' ? 'responses' : 'chat_completions';
}

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
    /** Replay metadata - wall-clock elapsed seconds for a user turn */
    _elapsedSec?: number;
    /** Replay metadata - serialized webview turn snapshot for high-fidelity history */
    _uiSnapshot?: any;
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

type ResponseInputItem = {
    role?: 'system' | 'user' | 'assistant';
    type?: string;
    content?: Array<Record<string, any>>;
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
};

function createAbortError(message = 'Aborted'): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function parseRetryAfterMs(message: string): number | null {
    const match = message.match(/retry-after[:\s]+(\d+)/i);
    if (!match) return null;
    return Math.max(0, Number(match[1]) * 1000);
}

function isRetryableStreamError(error: any): boolean {
    const message = String(error?.message || error || '');
    if (/AbortError|Aborted/i.test(error?.name || message)) return false;
    if (/\b(408|409|425|429|500|502|503|504)\b/.test(message)) return true;
    return /Request timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|unexpected end of data|aborted before complete/i.test(message);
}

function retryDelayMs(error: any, attempt: number): number {
    const retryAfter = parseRetryAfterMs(String(error?.message || ''));
    if (retryAfter !== null) return Math.min(retryAfter, 30_000);
    const base = Math.min(1_500 * Math.pow(2, attempt), 15_000);
    const jitter = Math.floor(Math.random() * 750);
    return base + jitter;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortError());
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(createAbortError());
        }, { once: true });
    });
}

/**
 * MiMo API client — pure HTTP, no SDK dependency.
 * Uses OpenAI-compatible chat completions with SSE streaming.
 */
export class MiMoAPI {
    constructor(
        private apiKey: string,
        private baseUrl: string,
        private apiEndpoint: ApiEndpointMode = 'chat_completions',
    ) {}

    getEndpointMode(): ApiEndpointMode {
        return this.apiEndpoint;
    }

    getRequestPath(): string {
        return this.apiEndpoint === 'responses' ? '/responses' : '/chat/completions';
    }

    private buildUrl(): string {
        return `${this.baseUrl}${this.getRequestPath()}`;
    }

    private transformRequest(params: Record<string, any>, stream: boolean): Record<string, any> {
        if (this.apiEndpoint !== 'responses') return { ...params, stream };

        const body: Record<string, any> = {
            model: params.model,
            input: this.toResponsesInput(params.messages),
            stream,
        };

        const maxTokens = Number(params.max_output_tokens ?? params.max_tokens);
        if (Number.isFinite(maxTokens) && maxTokens > 0) {
            body.max_output_tokens = Math.round(maxTokens);
        }

        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.top_p !== undefined) body.top_p = params.top_p;
        if (params.tool_choice !== undefined) body.tool_choice = params.tool_choice;
        if (params.extra_body && typeof params.extra_body === 'object') {
            Object.assign(body, params.extra_body);
        }

        const tools = this.toResponsesTools(params.tools);
        if (tools.length > 0) body.tools = tools;
        return body;
    }

    private toResponsesTools(tools: any): any[] {
        if (!Array.isArray(tools)) return [];
        return tools
            .map((tool) => {
                if (!tool || tool.type !== 'function' || !tool.function?.name) return null;
                return {
                    type: 'function',
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: tool.function.parameters,
                    strict: false,
                };
            })
            .filter((tool): tool is { type: string; name: any; description: any; parameters: any; strict: boolean } => !!tool);
    }

    private toResponsesInput(messages: any): ResponseInputItem[] {
        if (!Array.isArray(messages)) return [];
        const input: ResponseInputItem[] = [];

        for (const msg of messages) {
            if (!msg || typeof msg !== 'object') continue;
            const role = msg.role;

            if (role === 'tool') {
                input.push({
                    type: 'function_call_output',
                    call_id: String(msg.tool_call_id || ''),
                    output: this.contentToPlainText(msg.content),
                });
                continue;
            }

            if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                const text = this.contentToPlainText(msg.content);
                if (text) {
                    input.push({
                        role: 'assistant',
                        content: [{ type: 'output_text', text }],
                    });
                }
                for (const toolCall of msg.tool_calls) {
                    if (!toolCall?.id || !toolCall.function?.name) continue;
                    input.push({
                        type: 'function_call',
                        call_id: toolCall.id,
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments || '',
                    });
                }
                continue;
            }

            const content = this.toResponsesContent(msg.content);
            if (content.length === 0) continue;
            input.push({ role, content });
        }

        return input;
    }

    private toResponsesContent(content: any): Array<Record<string, any>> {
        if (typeof content === 'string') {
            return content ? [{ type: 'input_text', text: content }] : [];
        }
        if (!Array.isArray(content)) return [];

        const parts: Array<Record<string, any>> = [];
        for (const part of content) {
            if (!part || typeof part !== 'object') continue;
            if (part.type === 'text' && typeof part.text === 'string' && part.text) {
                parts.push({ type: 'input_text', text: part.text });
            } else if (part.type === 'image_url' && part.image_url?.url) {
                parts.push({ type: 'input_image', image_url: part.image_url.url });
            }
        }
        return parts;
    }

    private contentToPlainText(content: any): string {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return '';
        return content
            .map((part) => (part?.type === 'text' && typeof part.text === 'string') ? part.text : '')
            .filter(Boolean)
            .join('\n');
    }

    private extractTextFromResponseJson(json: any): string {
        if (!json || typeof json !== 'object') return '';

        const outputText = typeof json.output_text === 'string' ? json.output_text : '';
        if (outputText) return outputText;

        const segments: string[] = [];
        for (const item of Array.isArray(json.output) ? json.output : []) {
            if (!item || typeof item !== 'object') continue;
            if (Array.isArray(item.content)) {
                for (const part of item.content) {
                    const text = typeof part?.text === 'string' ? part.text : '';
                    if (text) segments.push(text);
                }
            }
        }
        return segments.join('');
    }

    /**
     * Non-streaming chat completion. Used for internal tasks like summarization.
     * Returns the full response text.
     */
    async chatCompletion(
        params: Record<string, any>,
        signal?: AbortSignal,
    ): Promise<string> {
        const url = this.buildUrl();
        const requestBody = this.transformRequest(params, false);
        const body = Buffer.from(JSON.stringify(requestBody), 'utf-8');

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
                            const content = this.apiEndpoint === 'responses'
                                ? this.extractTextFromResponseJson(json)
                                : (json.choices?.[0]?.message?.content || '');
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
        const maxRetries = 4;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await this.doChatCompletionsStream(params, callbacks, signal);
            } catch (e: any) {
                lastError = e;
                if (!isRetryableStreamError(e) || signal?.aborted || attempt >= maxRetries) {
                    throw e;
                }
                const delay = retryDelayMs(e, attempt);
                callbacks.onReasoning?.(`\n[Connection recovery ${attempt + 1}/${maxRetries}: ${String(e.message || e).slice(0, 120)}. Retrying in ${(delay / 1000).toFixed(1)}s.]\n`);
                await abortableDelay(delay, signal);
            }
        }
        throw lastError || new Error('Max retries exceeded');
    }

    private async doChatCompletionsStream(
        params: Record<string, any>,
        callbacks: StreamCallbacks,
        signal?: AbortSignal,
    ): Promise<{ content: string; toolCalls: ToolCall[]; reasoningContent: string; usage: TokenUsage | null }> {
        const url = this.buildUrl();
        const requestBody = this.transformRequest(params, true);
        const body = Buffer.from(JSON.stringify(requestBody), 'utf-8');
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

                            if (this.apiEndpoint === 'responses') {
                                const responseState = this.handleResponsesStreamEvent(parsed, toolCallsMap, callbacks);
                                if (responseState.contentDelta) {
                                    collectedContent += responseState.contentDelta;
                                }
                                if (responseState.reasoningDelta) {
                                    collectedReasoning += responseState.reasoningDelta;
                                }
                                if (responseState.usage) {
                                    collectedUsage = responseState.usage;
                                }
                                continue;
                            }

                            const choices = parsed.choices;
                            if (!choices?.length) continue;
                            const delta: StreamDelta = choices[0].delta || {};

                            if (delta.reasoning_content) {
                                collectedReasoning += delta.reasoning_content;
                                callbacks.onReasoning?.(delta.reasoning_content);
                            }

                            if (delta.content) {
                                collectedContent += delta.content;
                                callbacks.onToken?.(delta.content);
                            }

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

    private handleResponsesStreamEvent(
        parsed: any,
        toolCallsMap: Map<number, { id: string; name: string; arguments: string }>,
        callbacks: StreamCallbacks,
    ): { contentDelta: string; reasoningDelta: string; usage: TokenUsage | null } {
        const type = String(parsed?.type || '');
        let contentDelta = '';
        let reasoningDelta = '';
        let usage: TokenUsage | null = null;

        if (type === 'response.output_text.delta') {
            contentDelta = String(parsed.delta || '');
            if (contentDelta) callbacks.onToken?.(contentDelta);
        } else if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') {
            reasoningDelta = String(parsed.delta || '');
            if (reasoningDelta) callbacks.onReasoning?.(reasoningDelta);
        } else if (type === 'response.function_call_arguments.delta') {
            const idx = Number(parsed.output_index ?? 0);
            if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, { id: '', name: '', arguments: '' });
            }
            const existing = toolCallsMap.get(idx)!;
            if (parsed.item_id) existing.id = String(parsed.item_id);
            if (parsed.name) existing.name = String(parsed.name);
            if (parsed.delta) existing.arguments += String(parsed.delta);
        } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
            const item = parsed.item || {};
            if (item.type === 'function_call') {
                const idx = Number(parsed.output_index ?? item.output_index ?? 0);
                if (!toolCallsMap.has(idx)) {
                    toolCallsMap.set(idx, { id: '', name: '', arguments: '' });
                }
                const existing = toolCallsMap.get(idx)!;
                if (item.call_id) existing.id = String(item.call_id);
                if (item.name) existing.name = String(item.name);
                if (item.arguments) existing.arguments = String(item.arguments);
            }
        } else if (type === 'response.completed') {
            const usageRaw = parsed.response?.usage || parsed.usage;
            if (usageRaw) {
                usage = {
                    promptTokens: usageRaw.input_tokens || usageRaw.prompt_tokens || 0,
                    completionTokens: usageRaw.output_tokens || usageRaw.completion_tokens || 0,
                    totalTokens: usageRaw.total_tokens
                        || ((usageRaw.input_tokens || usageRaw.prompt_tokens || 0) + (usageRaw.output_tokens || usageRaw.completion_tokens || 0)),
                };
                callbacks.onUsage?.(usage);
            }
        }

        return { contentDelta, reasoningDelta, usage };
    }
}
