import { describe, it, expect, summary } from './test-runner';
import { buildConcreteTaskIntent, quickClassifyIntent, requiresToolBackedAnswer, requiresToolEvidence, shouldUseModelIntentClassification } from '../router';

describe('router fast-path classification', () => {
    it('treats concrete file-edit requests as heuristic code tasks', () => {
        const intent = quickClassifyIntent('帮我修复 src/agent.ts 里的 bug，并检查 package.json');
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('debug');
        expect(intent?.source).toBe('heuristic');
    });

    it('skips model classification for concrete coding requests', () => {
        expect(shouldUseModelIntentClassification('please update src/router.ts to fix this error')).toBe(false);
        expect(shouldUseModelIntentClassification('帮我看看这个报错，文件在 src/agent.ts')).toBe(false);
    });

    it('keeps model classification for short ambiguous asks', () => {
        expect(shouldUseModelIntentClassification('can you help')).toBe(true);
    });

    it('builds a concrete fallback intent without the model', () => {
        const intent = buildConcreteTaskIntent('search the repo for this VS Code extension error');
        expect(intent.category).toBe('debug');
        expect(intent.source).toBe('heuristic');
    });

    it('treats identity and capability questions as direct greeting handling', () => {
        const intent = quickClassifyIntent('\u4f60\u597d\uff0c\u5728\u5417\uff1f\u4f60\u662f\u8c01\uff0c\u4f60\u4f1a\u5e72\u4ec0\u4e48\uff1f');
        expect(intent?.needsTools).toBe(false);
        expect(intent?.category).toBe('greeting');
    });

    it('classifies short confirmations as acknowledgements', () => {
        const intent = quickClassifyIntent('\u53ef\u4ee5');
        expect(intent?.needsTools).toBe(false);
        expect(intent?.category).toBe('acknowledgement');
    });

    it('classifies agent reliability complaints as product experience issues', () => {
        const intent = quickClassifyIntent('MIMO AGENT \u4e3a\u4ec0\u4e48\u603b\u662f\u51fa\u73b0\u8fd9\u79cd\u4e2d\u65ad\uff1f');
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('experience');
        expect(intent?.complexity).toBe('complex');
    });

    it('classifies official/latest model spec checks as search tasks', () => {
        const intent = quickClassifyIntent('\u67e5\u4e00\u4e0b\u5b98\u65b9\u6700\u65b0 MIMO v2.5-pro \u4e0a\u4e0b\u6587\u957f\u5ea6');
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('search');
    });

    it('classifies stop button workflow mismatch as feedback needing diagnosis', () => {
        const intent = quickClassifyIntent('stop \u6309\u94ae\u90fd\u6ca1\u4e86\uff0cworkflow \u8fd8\u5728\u8f93\u51fa\uff0c\u8fd9\u660e\u663e\u662f\u9519\u7684');
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('feedback');
    });

    it('classifies explicit operating-rule saves as preference implementation', () => {
        const intent = quickClassifyIntent('\u8bf7\u5c06\u4e0a\u8ff0\u65b9\u6848\u4fdd\u5b58\u8fdb\u7cfb\u7edf\uff0c\u4ee5\u540e\u5fc5\u987b\u9075\u5b88');
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('preference');
    });

    it('routes provenance and external verification questions through tools', () => {
        const input = '\u6587\u6863\u91cc\u8bf4\u7ecf CrossRef \u9a8c\u8bc1\uff0c\u8fd8\u662f\u4f60\u8fd9\u6b21\u786e\u5b9e\u8c03\u7528 CrossRef \u9a8c\u8bc1\u4e86\uff1f';
        const intent = quickClassifyIntent(input);
        expect(requiresToolEvidence(input)).toBe(true);
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('search');
    });

    it('does not treat ordinary factual questions as evidence-tool requests', () => {
        expect(requiresToolEvidence('TypeScript \u662f\u4ec0\u4e48\uff1f')).toBe(false);
    });

    it('routes root-cause and current project questions through tools', () => {
        const intent = quickClassifyIntent('\u8fd9\u4e2a\u81ea\u52a8\u4e2d\u65ad\u7684\u6839\u672c\u539f\u56e0\u662f\u4ec0\u4e48\uff1f\u8bf7\u5206\u6790\u5e76\u7ed9\u51fa\u4fee\u590d\u65b9\u6848');
        expect(requiresToolBackedAnswer('\u8fd9\u4e2a\u81ea\u52a8\u4e2d\u65ad\u7684\u6839\u672c\u539f\u56e0\u662f\u4ec0\u4e48\uff1f\u8bf7\u5206\u6790\u5e76\u7ed9\u51fa\u4fee\u590d\u65b9\u6848')).toBe(true);
        expect(intent?.needsTools).toBe(true);
        expect(intent?.category).toBe('experience');
    });

    it('keeps pure concept questions eligible for direct answers', () => {
        const intent = quickClassifyIntent('API \u662f\u4ec0\u4e48\uff1f');
        expect(requiresToolEvidence('API \u662f\u4ec0\u4e48\uff1f')).toBe(false);
        expect(requiresToolBackedAnswer('API \u662f\u4ec0\u4e48\uff1f')).toBe(false);
        expect(intent?.needsTools).toBe(false);
        expect(intent?.category).toBe('question');
    });
});

summary();
