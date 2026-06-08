import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';

type JsonRpcMessage = {
    jsonrpc: '2.0';
    id?: number | string;
    method?: string;
    params?: any;
    result?: any;
    error?: { code: number; message: string; data?: any };
};

type ToolSpec = {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    handler: (args: Record<string, any>) => Promise<string>;
};

const DEFAULT_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';
const DEFAULT_OMNI_MODEL = 'mimo-v2.5';
const DEFAULT_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_ASR_MODEL = 'mimo-v2.5-asr';
const MAX_LOCAL_BYTES = 80 * 1024 * 1024;

function env(name: string): string {
    return process.env[name] || '';
}

function apiKey(): string {
    return env('MIMO_API_KEY') || env('MIMO_TP_API_KEY') || env('OPENAI_API_KEY');
}

function baseUrl(): string {
    return (env('MIMO_MULTIMODAL_BASE_URL') || env('MIMO_BASE_URL') || env('OPENAI_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function omniModel(): string {
    return env('MIMO_OMNI_MODEL') || env('MIMO_MULTIMODAL_MODEL') || DEFAULT_OMNI_MODEL;
}

function ttsModel(): string {
    return env('MIMO_TTS_MODEL') || DEFAULT_TTS_MODEL;
}

function asrModel(): string {
    return env('MIMO_ASR_MODEL') || DEFAULT_ASR_MODEL;
}

function workspaceRoot(): string {
    return env('MIMO_WORKSPACE') || process.cwd();
}

function outputDir(): string {
    return env('MIMO_MULTIMODAL_OUTPUT_DIR') || path.join(workspaceRoot(), '.mimo', 'multimodal');
}

function resolveWorkspacePath(input: string): string {
    if (!input || typeof input !== 'string') throw new Error('file_path is required');
    return path.isAbsolute(input) ? input : path.resolve(workspaceRoot(), input);
}

function isUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

function isDataUrl(value: string): boolean {
    return /^data:[^;,]+(?:;base64)?,/i.test(value);
}

function mimeFromPath(filePath: string, fallback = 'application/octet-stream'): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.mpeg': 'video/mpeg',
        '.mpga': 'audio/mpeg',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
    };
    return map[ext] || fallback;
}

function readLocalAsDataUrl(filePath: string): string {
    const resolved = resolveWorkspacePath(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`);
    if (stat.size > MAX_LOCAL_BYTES) {
        throw new Error(`File is too large for inline upload (${stat.size} bytes, max ${MAX_LOCAL_BYTES}). Use a URL instead.`);
    }
    const data = fs.readFileSync(resolved).toString('base64');
    return `data:${mimeFromPath(resolved)};base64,${data}`;
}

function mediaData(args: Record<string, any>): string {
    const url = String(args.url || '').trim();
    if (url) return url;
    const data = String(args.data || args.data_url || '').trim();
    if (data) return data;
    const filePath = String(args.file_path || '').trim();
    if (filePath) return readLocalAsDataUrl(filePath);
    throw new Error('Provide url, data/data_url, or file_path');
}

function outputPath(prefix: string, format: string): string {
    fs.mkdirSync(outputDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(outputDir(), `${prefix}-${stamp}.${format}`);
}

function buildChatBody(model: string, content: any[], maxTokens: number): Record<string, any> {
    return {
        model,
        messages: [
            {
                role: 'system',
                content: 'You are a concise multimodal analysis helper. Return factual, text-only results for a downstream reasoning model.',
            },
            {
                role: 'user',
                content,
            },
        ],
        max_completion_tokens: maxTokens,
    };
}

async function postJson(pathname: string, body: Record<string, any>, timeoutMs = 120_000): Promise<any> {
    const key = apiKey();
    if (!key) throw new Error('Missing API key. Set MIMO_API_KEY, MIMO_TP_API_KEY, or OPENAI_API_KEY.');

    const url = `${baseUrl()}${pathname}`;
    const payload = Buffer.from(JSON.stringify(body), 'utf-8');
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': payload.length,
                    Authorization: `Bearer ${key}`,
                    'api-key': key,
                    Accept: 'application/json',
                },
                timeout: timeoutMs,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => (data += chunk.toString('utf-8')));
                res.on('end', () => {
                    if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
                        reject(new Error(`API error ${res.statusCode}: ${data.slice(0, 1000)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error(`Failed to parse API response: ${data.slice(0, 500)}`));
                    }
                });
            },
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('API request timeout'));
        });
        req.write(payload);
        req.end();
    });
}

function extractText(json: any): string {
    const message = json?.choices?.[0]?.message || {};
    const text = message.content || message.reasoning_content || json?.choices?.[0]?.text || '';
    const usage = json?.usage ? `\n\nUsage: ${JSON.stringify(json.usage)}` : '';
    return `${String(text || '').trim()}${usage}`.trim() || JSON.stringify(json);
}

async function analyzeMedia(kind: 'image' | 'audio' | 'video', args: Record<string, any>): Promise<string> {
    const prompt = String(args.prompt || defaultPrompt(kind));
    const maxTokens = Math.max(128, Math.min(8192, Number(args.max_tokens || 2048)));
    const model = String(args.model || omniModel());
    const data = mediaData(args);
    let mediaPart: Record<string, any>;

    if (kind === 'image') {
        mediaPart = { type: 'image_url', image_url: { url: data } };
    } else if (kind === 'audio') {
        mediaPart = { type: 'input_audio', input_audio: { data } };
    } else {
        mediaPart = { type: 'video_url', video_url: { url: data } };
    }

    const json = await postJson('/chat/completions', buildChatBody(model, [mediaPart, { type: 'text', text: prompt }], maxTokens));
    return extractText(json);
}

function defaultPrompt(kind: 'image' | 'audio' | 'video'): string {
    if (kind === 'image') return 'Describe the image and extract any visible text, UI state, errors, or code.';
    if (kind === 'audio') return 'Transcribe the audio if speech is present, then summarize important sounds and context.';
    return 'Describe the video, summarize visible actions, extract on-screen text, and note any audio/speech if available.';
}

async function transcribeAudio(args: Record<string, any>): Promise<string> {
    const prompt = String(args.prompt || 'Transcribe this audio accurately. Include timestamps if you can infer them.');
    const model = String(args.model || asrModel());
    const maxTokens = Math.max(128, Math.min(8192, Number(args.max_tokens || 4096)));
    const data = mediaData(args);
    const attempts = [
        { model, part: { type: 'input_audio', input_audio: { data } } },
        { model: omniModel(), part: { type: 'input_audio', input_audio: { data } } },
    ];

    let lastError = '';
    for (const attempt of attempts) {
        try {
            const json = await postJson('/chat/completions', buildChatBody(attempt.model, [attempt.part, { type: 'text', text: prompt }], maxTokens));
            return extractText(json);
        } catch (e: any) {
            lastError = e?.message || String(e);
        }
    }
    throw new Error(lastError || 'ASR failed');
}

async function synthesizeSpeech(args: Record<string, any>): Promise<string> {
    const text = String(args.text || '').trim();
    if (!text) throw new Error('text is required');
    const voice = String(args.voice || 'Chloe');
    const format = String(args.format || 'wav').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'wav';
    const style = String(args.style || 'Natural, clear, friendly delivery.');
    const model = String(args.model || ttsModel());
    const target = args.output_path
        ? resolveWorkspacePath(String(args.output_path))
        : outputPath('tts', format === 'pcm16' ? 'pcm' : format);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const json = await postJson('/chat/completions', {
        model,
        messages: [
            { role: 'user', content: style },
            { role: 'assistant', content: text },
        ],
        audio: { format, voice },
    }, 180_000);

    const data = json?.choices?.[0]?.message?.audio?.data;
    if (!data || typeof data !== 'string') {
        throw new Error(`TTS response did not include audio.data: ${JSON.stringify(json).slice(0, 1000)}`);
    }
    const bytes = Buffer.from(data, 'base64');
    fs.writeFileSync(target, bytes);
    const usage = json?.usage ? `\nUsage: ${JSON.stringify(json.usage)}` : '';
    return `Speech synthesized.\nPath: ${target}\nFormat: ${format}\nVoice: ${voice}\nBytes: ${bytes.length}${usage}`;
}

const commonMediaProperties = {
    file_path: { type: 'string', description: 'Local media file path. Relative paths resolve against the workspace.' },
    url: { type: 'string', description: 'HTTP(S) media URL.' },
    data_url: { type: 'string', description: 'data: URL or provider-accepted base64 payload.' },
    prompt: { type: 'string', description: 'Question or analysis instruction.' },
    model: { type: 'string', description: 'Override model, e.g. mimo-v2.5 or mimo-v2-omni.' },
    max_tokens: { type: 'number', description: 'Maximum output tokens.' },
};

const tools: ToolSpec[] = [
    {
        name: 'analyze_image',
        description: 'Use MiMo multimodal/Omni model to inspect an image or screenshot and return text for the main agent.',
        inputSchema: { type: 'object', properties: commonMediaProperties },
        handler: (args) => analyzeMedia('image', args),
    },
    {
        name: 'analyze_audio',
        description: 'Use MiMo multimodal/Omni model to understand audio, including speech and non-speech content.',
        inputSchema: { type: 'object', properties: commonMediaProperties },
        handler: (args) => analyzeMedia('audio', args),
    },
    {
        name: 'analyze_video',
        description: 'Use MiMo multimodal/Omni model to understand a video and return a text summary.',
        inputSchema: { type: 'object', properties: commonMediaProperties },
        handler: (args) => analyzeMedia('video', args),
    },
    {
        name: 'transcribe_audio',
        description: 'Transcribe speech audio with MiMo ASR when available, falling back to the multimodal model.',
        inputSchema: { type: 'object', properties: commonMediaProperties },
        handler: transcribeAudio,
    },
    {
        name: 'synthesize_speech',
        description: 'Generate speech audio with MiMo TTS and save it to a local output file.',
        inputSchema: {
            type: 'object',
            required: ['text'],
            properties: {
                text: { type: 'string', description: 'Text to synthesize.' },
                style: { type: 'string', description: 'Voice/style instruction.' },
                voice: { type: 'string', description: 'Voice name, e.g. Chloe.' },
                format: { type: 'string', enum: ['wav', 'mp3', 'pcm16'], description: 'Output audio format.' },
                output_path: { type: 'string', description: 'Optional output path. Relative paths resolve against the workspace.' },
                model: { type: 'string', description: 'Override TTS model, e.g. mimo-v2.5-tts or mimo-v2-tts.' },
            },
        },
        handler: synthesizeSpeech,
    },
];

function respond(id: JsonRpcMessage['id'], result: any): void {
    if (id === undefined) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id: JsonRpcMessage['id'], code: number, message: string, data?: any): void {
    if (id === undefined) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } }) + '\n');
}

async function handleMessage(msg: JsonRpcMessage): Promise<void> {
    if (!msg.method) return;
    if (msg.method === 'initialize') {
        respond(msg.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mimo-multimodal', version: '1.0.0' },
        });
        return;
    }
    if (msg.method === 'tools/list') {
        respond(msg.id, {
            tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });
        return;
    }
    if (msg.method === 'tools/call') {
        const name = String(msg.params?.name || '');
        const tool = tools.find(t => t.name === name);
        if (!tool) {
            respondError(msg.id, -32602, `Unknown tool: ${name}`);
            return;
        }
        try {
            const text = await tool.handler(msg.params?.arguments || {});
            respond(msg.id, { content: [{ type: 'text', text }] });
        } catch (e: any) {
            respondError(msg.id, -32000, e?.message || String(e));
        }
        return;
    }
    if (msg.id !== undefined) respond(msg.id, {});
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
            void handleMessage(JSON.parse(line));
        } catch (e: any) {
            respondError(undefined, -32700, e?.message || String(e));
        }
    }
});

process.stdin.on('end', () => process.exit(0));
process.stderr.write(`[mimo-multimodal-mcp] ready in ${workspaceRoot()} on ${os.platform()}\n`);
