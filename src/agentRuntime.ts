import { MiMoAPI, ChatMessage } from './api';
import { MiMoConfig, ProviderProfileSetting } from './config';
import { ConversationState } from './agentTypes';
import {
    DEFAULT_MODELS,
    MODEL_CAPABILITIES,
    ModelCapabilities,
    PREFERRED_CHAT_MODELS,
    inferModelCapabilities,
    normalizeModelName,
} from './modelCapabilities';

export interface ReasoningProfile {
    tokenMultiplier: number;
    roundMultiplier: number;
    stallMultiplier: number;
    temperature?: number;
    topP?: number;
    thinking?: 'enabled' | 'disabled';
    directMaxTokens: number;
}

export class AgentRuntime {
    static readonly MODEL_ROUTE_SEPARATOR = '::';

    constructor(
        private readonly getConfig: () => MiMoConfig,
        private readonly getDefaultApi: () => MiMoAPI,
    ) {}

    getReasoningProfile(): ReasoningProfile {
        const config = this.getConfig();
        const effort = config.reasoningEffort || (config.enableThinking ? 'deep' : 'balanced');
        switch (effort) {
            case 'turbo':
                return {
                    tokenMultiplier: 0.4,
                    roundMultiplier: 0.3,
                    stallMultiplier: 0.5,
                    temperature: 0.2,
                    topP: 0.8,
                    thinking: 'disabled',
                    directMaxTokens: 500,
                };
            case 'fast':
                return {
                    tokenMultiplier: 0.6,
                    roundMultiplier: 0.5,
                    stallMultiplier: 0.65,
                    temperature: 0.4,
                    topP: 0.9,
                    thinking: 'disabled',
                    directMaxTokens: 900,
                };
            case 'deep':
                return {
                    tokenMultiplier: 1.15,
                    roundMultiplier: 1.05,
                    stallMultiplier: 1.05,
                    temperature: 0.55,
                    thinking: 'enabled',
                    directMaxTokens: 2600,
                };
            case 'max':
                return {
                    tokenMultiplier: 1.45,
                    roundMultiplier: 1.35,
                    stallMultiplier: 1.25,
                    temperature: 0.35,
                    topP: 0.9,
                    thinking: 'enabled',
                    directMaxTokens: 3800,
                };
            default:
                return {
                    tokenMultiplier: 0.85,
                    roundMultiplier: 0.75,
                    stallMultiplier: 0.85,
                    directMaxTokens: 1600,
                };
        }
    }

    encodeModelRoute(endpointId: string, model: string): string {
        return endpointId
            ? `${endpointId}${AgentRuntime.MODEL_ROUTE_SEPARATOR}${model}`
            : model;
    }

    decodeModelRoute(value: string): { endpointId: string; model: string } {
        const raw = String(value || '').trim();
        const sep = AgentRuntime.MODEL_ROUTE_SEPARATOR;
        const idx = raw.indexOf(sep);
        if (idx <= 0) return { endpointId: '', model: raw };
        return {
            endpointId: raw.slice(0, idx).trim(),
            model: raw.slice(idx + sep.length).trim(),
        };
    }

    getProfile(endpointId?: string): ProviderProfileSetting | undefined {
        const id = String(endpointId || '').trim();
        if (!id) return undefined;
        return (this.getConfig().providerProfiles || []).find(profile => profile.id === id);
    }

    getEndpointBaseUrl(endpointId?: string): string {
        const config = this.getConfig();
        return this.getProfile(endpointId)?.base_url || config.baseUrl;
    }

    getApiForEndpoint(endpointId?: string): MiMoAPI {
        const config = this.getConfig();
        const profile = this.getProfile(endpointId);
        if (!profile) return this.getDefaultApi();
        return new MiMoAPI(
            profile.api_key || config.apiKey,
            profile.base_url || config.baseUrl,
            profile.api_endpoint || config.apiEndpoint,
        );
    }

    getConversationEndpointId(conv?: ConversationState): string {
        const config = this.getConfig();
        return conv?.modelEndpointId || config.activeRoute?.endpoint_id || config.activeProviderProfile || '';
    }

    getModelsForEndpoint(endpointId = ''): string[] {
        const config = this.getConfig();
        const profile = this.getProfile(endpointId);
        const configured = profile
            ? [profile.model, ...(profile.models || [])]
            : config.models.length > 0
                ? [config.model, ...config.models]
                : [config.model, ...DEFAULT_MODELS];
        const seen = new Set<string>();
        const models: string[] = [];
        for (const model of configured) {
            const key = normalizeModelName(model);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            models.push(model);
        }
        return models;
    }

    getModelCapabilities(model: string): ModelCapabilities {
        const route = this.decodeModelRoute(model);
        const actualModel = route.model || model;
        return MODEL_CAPABILITIES[actualModel] || inferModelCapabilities(actualModel, this.getEndpointBaseUrl(route.endpointId));
    }

    buildChatParams(
        model: string,
        messages: ChatMessage[] | Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: any }>,
        options: Record<string, any> = {},
        endpointId = '',
    ): Record<string, any> {
        const config = this.getConfig();
        const reasoningProfile = this.getReasoningProfile();
        const applyReasoningMultiplier = options._applyReasoningMultiplier !== false;
        const requestedMaxTokens = Number(options.max_tokens ?? config.maxTokens);
        const configuredMaxTokens = applyReasoningMultiplier
            ? Math.round(requestedMaxTokens * reasoningProfile.tokenMultiplier)
            : requestedMaxTokens;
        const maxOutputTokens = Math.max(1, Math.min(
            Number.isFinite(configuredMaxTokens) ? configuredMaxTokens : 8192,
            65536,
        ));
        const temperature = options.temperature ?? reasoningProfile.temperature ?? config.temperature;
        const topP = options.top_p ?? reasoningProfile.topP ?? config.topP;
        const params: Record<string, any> = {
            model,
            messages,
            max_tokens: maxOutputTokens,
            temperature,
            top_p: topP,
            stream_options: options.stream_options ?? { include_usage: true },
            ...options,
        };
        params.max_tokens = maxOutputTokens;
        if (params.stream_options === null) delete params.stream_options;
        if (this.shouldSendThinkingControl(model, endpointId) && reasoningProfile.thinking && !params.extra_body?.thinking) {
            params.extra_body = {
                ...(params.extra_body || {}),
                thinking: { type: reasoningProfile.thinking },
            };
        }
        delete params._applyReasoningMultiplier;
        return params;
    }

    findVisionModel(currentModel: string, endpointId = ''): string | null {
        const configuredModels = this.getModelsForEndpoint(endpointId);
        const currentIsMimo = this.isMimoModel(currentModel);
        const candidates = [
            currentModel,
            ...configuredModels.filter(model => this.isMimoModel(model) === currentIsMimo),
            ...(currentIsMimo ? DEFAULT_MODELS.filter(model => this.isMimoModel(model)) : []),
        ];
        const seen = new Set<string>();
        for (const model of candidates) {
            const key = normalizeModelName(model);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            if (this.getModelCapabilities(model).vision) return model;
        }
        return null;
    }

    findChatModel(currentModel: string, excludeCurrent = false, endpointId = ''): string | null {
        const configuredModels = this.getModelsForEndpoint(endpointId);
        const currentIsMimo = this.isMimoModel(currentModel);
        const candidates = currentIsMimo
            ? [
                ...configuredModels.filter(model => this.isMimoModel(model)),
                ...PREFERRED_CHAT_MODELS.filter(model => this.isMimoModel(model)),
                ...DEFAULT_MODELS.filter(model => this.isMimoModel(model)),
            ]
            : [
                currentModel,
                ...configuredModels.filter(model => !this.isMimoModel(model)),
            ];
        const seen = new Set<string>();
        for (const model of candidates) {
            const key = normalizeModelName(model);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            if (excludeCurrent && key === normalizeModelName(currentModel)) continue;
            if (this.isKnownUnsupportedChatModel(model)) continue;
            const caps = this.getModelCapabilities(model);
            if (!caps.tts) return model;
        }
        return null;
    }

    isModelUnsupportedError(error: any): boolean {
        const message = String(error?.message || error || '');
        return /\b400\b/i.test(message)
            && /not supported model|model .*not supported|not exist|not have access|may not|model_not_found|unsupported model/i.test(message);
    }

    private shouldSendThinkingControl(model: string, endpointId = ''): boolean {
        const routedModel = endpointId ? this.encodeModelRoute(endpointId, model) : model;
        return this.getModelCapabilities(routedModel).thinkingControl;
    }

    private isMimoModel(model: string): boolean {
        return /^mimo[-_]/i.test((model || '').trim());
    }

    isKnownUnsupportedChatModel(model: string): boolean {
        return /^mimo-v2-(?:flash|lite)$/i.test((model || '').trim());
    }
}
