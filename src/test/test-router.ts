import { describe, it, expect, summary } from './test-runner';
import { buildConcreteTaskIntent, quickClassifyIntent, shouldUseModelIntentClassification } from '../router';

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
});

summary();
