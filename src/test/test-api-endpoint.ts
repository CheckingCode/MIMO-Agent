import { describe, it, expect, summary } from './test-runner';
import { MiMoAPI, normalizeApiEndpointMode } from '../api';

describe('normalizeApiEndpointMode', () => {
    it('defaults to chat completions', () => {
        expect(normalizeApiEndpointMode(undefined)).toBe('chat_completions');
        expect(normalizeApiEndpointMode('unknown')).toBe('chat_completions');
    });

    it('keeps responses mode', () => {
        expect(normalizeApiEndpointMode('responses')).toBe('responses');
    });
});

describe('MiMoAPI endpoint selection', () => {
    it('uses chat completions path by default', () => {
        const api = new MiMoAPI('key', 'https://api.example.com/v1');
        expect(api.getRequestPath()).toBe('/chat/completions');
        expect(api.getEndpointMode()).toBe('chat_completions');
    });

    it('uses responses path when configured', () => {
        const api = new MiMoAPI('key', 'https://api.example.com/v1', 'responses');
        expect(api.getRequestPath()).toBe('/responses');
        expect(api.getEndpointMode()).toBe('responses');
    });
});

summary();
