export interface ModelCapabilities {
    vision: boolean;
    tts: boolean;
    reasoning: boolean;
    thinkingControl: boolean;
    description: string;
}

export const DEFAULT_MODELS = [
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'gpt-4o',
    'gpt-4o-mini',
    'deepseek-chat',
    'qwen-plus',
];

export const PREFERRED_CHAT_MODELS = [
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'gpt-4o',
    'gpt-4o-mini',
    'deepseek-chat',
    'qwen-plus',
];

export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
    'mimo-v2.5-pro': { vision: false, tts: false, reasoning: true, thinkingControl: true, description: 'MiMo reasoning model' },
    'mimo-v2.5': { vision: true, tts: false, reasoning: true, thinkingControl: true, description: 'MiMo multimodal model' },
    'MiMo-V2.5': { vision: true, tts: false, reasoning: true, thinkingControl: true, description: 'MiMo multimodal model' },
    'mimo-v2.5-tts': { vision: false, tts: true, reasoning: false, thinkingControl: true, description: 'MiMo speech model' },
    'MiMo-V2.5-TTS': { vision: false, tts: true, reasoning: false, thinkingControl: true, description: 'MiMo speech model' },
    'mimo-v2-lite': { vision: false, tts: false, reasoning: false, thinkingControl: true, description: 'MiMo lightweight model' },
    'mimo-v2-flash': { vision: false, tts: false, reasoning: false, thinkingControl: true, description: 'MiMo fast model' },
};

export function normalizeModelName(model: string): string {
    return (model || '').trim().toLowerCase();
}

export function inferProvider(baseUrl: string, model: string): string {
    const value = `${baseUrl || ''} ${model || ''}`.toLowerCase();
    if (value.includes('xiaomi') || value.includes('mimo')) return 'mimo';
    if (value.includes('openai.com') || value.includes('gpt-') || value.includes('o1') || value.includes('o3') || value.includes('o4')) return 'openai';
    if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';
    if (value.includes('deepseek')) return 'deepseek';
    if (value.includes('ollama')) return 'ollama';
    return 'openai-compatible';
}

export function inferModelCapabilities(model: string, baseUrl = ''): ModelCapabilities {
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
