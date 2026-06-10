import { describe, it, expect, summary } from './test-runner';
import { apiEndpointMode, canUseResponsesForAnalyze, extractResponsesText, normalizeApiEndpointMode } from '../mcpMultimodalServer';

describe('mcp multimodal endpoint routing', () => {
    it('normalizes multimodal endpoint mode', () => {
        expect(normalizeApiEndpointMode('responses')).toBe('responses');
        expect(normalizeApiEndpointMode('chat_completions')).toBe('chat_completions');
        expect(normalizeApiEndpointMode('other')).toBe('chat_completions');
    });

    it('reads hidden endpoint override for built-in multimodal tools', () => {
        expect(apiEndpointMode({ _mimo_api_endpoint: 'responses' })).toBe('responses');
        expect(apiEndpointMode({ _mimo_api_endpoint: 'chat_completions' })).toBe('chat_completions');
    });

    it('uses responses only for image analysis and keeps audio/video on chat fallback', () => {
        const args = { _mimo_api_endpoint: 'responses' };
        expect(canUseResponsesForAnalyze('image', args)).toBe(true);
        expect(canUseResponsesForAnalyze('audio', args)).toBe(false);
        expect(canUseResponsesForAnalyze('video', args)).toBe(false);
    });

    it('extracts text from responses output payloads', () => {
        const json = {
            output: [
                {
                    content: [
                        { type: 'output_text', text: 'hello ' },
                        { type: 'output_text', text: 'world' },
                    ],
                },
            ],
        };
        expect(extractResponsesText(json)).toBe('helloworld');
    });
});

summary();
