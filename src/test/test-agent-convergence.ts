import { describe, it, expect, summary } from './test-runner';
import { MiMoAgent } from '../agent';
import { MiMoConfig } from '../config';
import { ConversationState } from '../agentTypes';

function makeAgent(): any {
    const config: MiMoConfig = {
        apiKey: '',
        baseUrl: 'http://localhost',
        model: 'mimo-test',
        models: [],
        activeProviderProfile: '',
        activeRoute: { endpoint_id: '', model: 'mimo-test' },
        providerProfiles: [],
        maxTokens: 1024,
        maxRounds: 0,
        temperature: 0.2,
        topP: 0.95,
        enableThinking: false,
        reasoningEffort: 'fast',
        maxOutputLen: 5000,
        commandTimeout: 30,
        workspace: process.cwd(),
        sandbox: { enabled: false, mode: 'safe', image: '', memoryLimit: '1g', cpuLimit: 1, timeoutSec: 30, gitSnapshot: false, logging: false, networkDisabled: false },
        mcpServers: [],
        adversarial: { maxIterations: 3, toolBudget: 10, reviewDimensions: [], enableVerification: true, convergenceThreshold: 2 },
        infinite: { maxRounds: 300, hardMultiplier: 2, stallLimit: 5 },
        context: { autoCompress: false, summarizeAtPercent: 70, summarizeAtMessages: 48, keepRecentMessages: 18, maxSummaryTokens: 1200 },
        memory: { enabled: false, learnFromExplicitPreferences: false, maxItems: 10, maxInjected: 0 },
        dependencyInstall: { enabled: true, projectMode: 'auto', systemMode: 'confirm', longTimeoutSec: 600 },
        settings: {},
    };
    return new MiMoAgent(config, process.cwd());
}

function makeConv(messages: ConversationState['messages']): ConversationState {
    return {
        id: 'test',
        title: 'test',
        messages,
        model: 'mimo-test',
        mode: 'auto',
        uiLang: 'zh',
    };
}

describe('agent convergence guards', () => {
    it('detects completed git push delivery from up-to-date and clean evidence', () => {
        const agent = makeAgent();
        const conv = makeConv([
            { role: 'user', content: '帮我 git 并 push' },
            {
                role: 'tool',
                _toolName: 'execute_command',
                content: "[stderr] git : Everything up-to-date\n[exit code: 1]",
            } as any,
            {
                role: 'tool',
                _toolName: 'execute_command',
                content: "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean",
            } as any,
            {
                role: 'tool',
                _toolName: 'execute_command',
                content: 'e89f408 docs: update release notes',
            } as any,
        ]);

        const result = agent.detectGitPushDeliveryComplete(conv, '帮我 git 并 push');
        expect(result.done).toBe(true);
        expect(result.summary || '').toContain('e89f408');
        expect(result.summary || '').toContain('clean');
    });

    it('does not count read-only git execute_command as valuable progress', () => {
        const agent = makeAgent();
        const statusCall = {
            id: '1',
            type: 'function',
            function: { name: 'execute_command', arguments: JSON.stringify({ command: 'git status --short && git log --oneline -3' }) },
        };
        const commitCall = {
            id: '2',
            type: 'function',
            function: { name: 'execute_command', arguments: JSON.stringify({ command: 'git commit -m "release"' }) },
        };

        expect(agent.isProgressToolCall(statusCall, 'nothing to commit, working tree clean')).toBe(false);
        expect(agent.isProgressToolCall(commitCall, '[main abc1234] release')).toBe(true);
    });

    it('detects repeated reasoning chunks before long loops', () => {
        const agent = makeAgent();
        const repeated = Array.from({ length: 5 })
            .map(() => 'The user wants me to add a return home link, so I need to check the current navigation structure.')
            .join(' ');
        const result = agent.detectReasoningLoop(repeated);
        expect(result.detected).toBe(true);
        expect(result.count).toBeGreaterThanOrEqual(4);
    });

    it('keeps automatic chat fallback inside the active provider model family', () => {
        const agent = makeAgent();
        agent.updateConfig({
            ...agent.config,
            model: 'deepseek-tts',
            models: ['deepseek-tts', 'deepseek-chat', 'mimo-v2.5-pro'],
            baseUrl: 'https://api.deepseek.com/v1',
        });

        const fallback = agent.findChatModel('deepseek-tts', true);
        expect(fallback).toBe('deepseek-chat');
    });

    it('does not fallback from a non-MiMo model to MiMo when no same-provider chat model exists', () => {
        const agent = makeAgent();
        agent.updateConfig({
            ...agent.config,
            model: 'custom-tts',
            models: ['custom-tts', 'mimo-v2.5-pro'],
            baseUrl: 'https://example.test/v1',
        });

        const fallback = agent.findChatModel('custom-tts', true);
        expect(fallback).toBeNull();
    });

    it('keeps automatic vision fallback inside MiMo models only when current model is MiMo', () => {
        const agent = makeAgent();
        agent.updateConfig({
            ...agent.config,
            model: 'deepseek-chat',
            models: ['deepseek-chat', 'mimo-v2.5'],
            baseUrl: 'https://api.deepseek.com/v1',
        });
        expect(agent.findVisionModel('deepseek-chat')).toBeNull();

        agent.updateConfig({
            ...agent.config,
            model: 'mimo-v2.5-pro',
            models: ['mimo-v2.5-pro', 'mimo-v2.5', 'deepseek-chat'],
            baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        });
        expect(agent.findVisionModel('mimo-v2.5-pro')).toBe('mimo-v2.5');
    });

    it('distinguishes the same model id on different endpoints', () => {
        const agent = makeAgent();
        agent.updateConfig({
            ...agent.config,
            model: 'mimo-v2.5-pro',
            activeProviderProfile: 'mimo-cn',
            activeRoute: { endpoint_id: 'mimo-cn', model: 'mimo-v2.5-pro' },
            providerProfiles: [
                {
                    id: 'mimo-cn',
                    name: 'MiMo CN',
                    base_url: 'https://token-plan-cn.xiaomimimo.com/v1',
                    api_key: 'cn-key',
                    model: 'mimo-v2.5-pro',
                    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
                },
                {
                    id: 'mimo-proxy',
                    name: 'MiMo Proxy',
                    base_url: 'https://proxy.example.test/v1',
                    api_key: 'proxy-key',
                    model: 'mimo-v2.5-pro',
                    models: ['mimo-v2.5-pro'],
                },
            ],
        });

        const options = agent.getModelOptions();
        expect(options.map((option: any) => option.value)).toContain('mimo-cn::mimo-v2.5-pro');
        expect(options.map((option: any) => option.value)).toContain('mimo-proxy::mimo-v2.5-pro');

        const convId = agent.createConversation();
        agent.setModel('mimo-proxy::mimo-v2.5-pro', convId);
        expect(agent.getConversation(convId).model).toBe('mimo-v2.5-pro');
        expect(agent.getConversation(convId).modelEndpointId).toBe('mimo-proxy');
        expect(agent.getModelSelectionValue(convId)).toBe('mimo-proxy::mimo-v2.5-pro');
    });

    it('keeps one model option per model-card profile', () => {
        const agent = makeAgent();
        agent.updateConfig({
            ...agent.config,
            model: 'mimo-v2.5-pro',
            activeProviderProfile: 'mimo-v2-5-pro',
            activeRoute: { endpoint_id: 'mimo-v2-5-pro', model: 'mimo-v2.5-pro' },
            providerProfiles: [
                {
                    id: 'mimo-v2-5-pro',
                    name: 'MiMo Pro',
                    base_url: 'https://api.example.test/v1',
                    api_key: 'key',
                    model: 'mimo-v2.5-pro',
                    models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro'],
                },
                {
                    id: 'mimo-v2-5',
                    name: 'MiMo V2.5',
                    base_url: 'https://api.example.test/v1',
                    api_key: 'key',
                    model: 'mimo-v2.5',
                    models: ['mimo-v2.5'],
                },
            ],
        });

        const values = agent.getModelOptions().map((option: any) => option.value);
        expect(values.includes('mimo-v2-5-pro::mimo-v2.5-pro')).toBe(true);
        expect(values.includes('mimo-v2-5::mimo-v2.5')).toBe(true);
        expect(values.includes('mimo-v2-5-pro::mimo-v2-pro')).toBe(false);
    });

    it('adds generated artifact paths to sparse final summaries', () => {
        const agent = makeAgent();
        const audioPath = 'g:\\AI World\\output\\高考作文音频\\voicedesign_test.wav';
        const conv = makeConv([
            {
                role: 'assistant',
                content: null as any,
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: {
                            name: 'execute_command',
                            arguments: JSON.stringify({ command: `ffprobe -i "${audioPath}"` }),
                        },
                    },
                ],
            } as any,
            {
                role: 'tool',
                _toolName: 'execute_command',
                content: `Input #0, wav, from '${audioPath}': Duration: 00:00:23.20`,
            } as any,
        ]);

        const finalText = agent.appendMissingArtifactSummary(conv, '任务完成。');
        expect(finalText.includes('交付文件')).toBe(true);
        expect(finalText.includes(audioPath)).toBe(true);
    });

    it('does not duplicate artifact paths already present in final summaries', () => {
        const agent = makeAgent();
        const audioPath = 'g:\\AI World\\output\\高考作文音频\\voicedesign_test.wav';
        const conv = makeConv([
            {
                role: 'tool',
                _toolName: 'execute_command',
                content: `Generated file: ${audioPath}`,
            } as any,
        ]);

        const finalText = agent.appendMissingArtifactSummary(conv, `音频已生成：${audioPath}`);
        expect(finalText.split(audioPath).length - 1).toBe(1);
    });
});

summary();
