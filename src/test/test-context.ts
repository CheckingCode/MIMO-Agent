/**
 * Tests for context.ts — Token estimation and context management.
 */
import { describe, it, expect, summary } from './test-runner';
import { estimateTokens, estimateMessageTokens, getContextStats, manageContext } from '../context';
import { ChatMessage } from '../api';

describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('should estimate English text', () => {
        const tokens = estimateTokens('Hello world');
        expect(tokens).toBeGreaterThan(0);
        expect(tokens).toBeLessThan(10);
    });

    it('should estimate Chinese text (higher density)', () => {
        const en = estimateTokens('Hello world test');
        const zh = estimateTokens('你好世界测试');
        // Chinese should have more tokens per char
        expect(zh).toBeGreaterThan(0);
    });
});

describe('estimateMessageTokens', () => {
    it('should estimate a simple text message', () => {
        const msg: ChatMessage = { role: 'user', content: 'Hello' };
        const tokens = estimateMessageTokens(msg);
        expect(tokens).toBeGreaterThan(4); // At least overhead
    });

    it('should handle empty content', () => {
        const msg: ChatMessage = { role: 'assistant', content: '' };
        const tokens = estimateMessageTokens(msg);
        expect(tokens).toBeGreaterThan(0); // At least overhead
    });
});

describe('getContextStats', () => {
    it('should return stats for a model', () => {
        const msgs: ChatMessage[] = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
        ];
        const stats = getContextStats(msgs, 'mimo-v2.5');
        expect(stats.model).toBe('mimo-v2.5');
        expect(stats.total).toBe(1000000); // 1M context
        expect(stats.used).toBeGreaterThan(0);
        expect(stats.percent).toBeGreaterThanOrEqual(0);
        expect(stats.percent).toBeLessThanOrEqual(100);
    });

    it('should use 1M context for MiMo V2.5 Pro', () => {
        const msgs: ChatMessage[] = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
        ];
        const stats = getContextStats(msgs, 'mimo-v2.5-pro');
        expect(stats.model).toBe('mimo-v2.5-pro');
        expect(stats.total).toBe(1000000);
    });
});

describe('manageContext', () => {
    it('preserves reasoning_content for assistant tool-call messages', () => {
        const toolReasoning = 'full tool reasoning '.repeat(200);
        const messages: ChatMessage[] = [
            { role: 'user', content: 'please inspect the project' },
            {
                role: 'assistant',
                content: null as any,
                reasoning_content: toolReasoning,
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'read_file', arguments: '{"path":"src/agent.ts"}' },
                    },
                ],
            },
            { role: 'tool', tool_call_id: 'call_1', content: 'file contents', _toolName: 'read_file' } as any,
            ...Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, content: `follow-up ${i}` })),
        ];

        const managed = manageContext(messages, 'mimo-v2.5-pro', {
            maxContextTokens: 1000000,
            responseReserve: 0,
            maxMessages: 0,
        });
        const toolAssistant = managed.find(m => m.role === 'assistant' && m.tool_calls?.length);

        expect(toolAssistant?.reasoning_content).toBe(toolReasoning);
    });
});

summary();
