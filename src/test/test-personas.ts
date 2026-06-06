/**
 * Tests for personas.ts — Expert persona detection.
 */
import { describe, it, expect, summary } from './test-runner';
import { detectPersona, PERSONAS, buildPersonaPrompt } from '../personas';

describe('detectPersona', () => {
    it('should detect programmer persona', () => {
        const persona = detectPersona('帮我写一个 Python 函数来排序数组');
        expect(persona?.id).toBe('programmer');
    });

    it('should detect PM persona', () => {
        const persona = detectPersona('帮我整理这个项目的需求文档');
        expect(persona?.id).toBe('pm');
    });

    it('should detect reviewer persona', () => {
        const persona = detectPersona('帮我审查这段代码的质量');
        expect(persona?.id).toBe('reviewer');
    });

    it('should detect debugger persona', () => {
        const persona = detectPersona('程序崩溃了，帮我调试一下');
        expect(persona?.id).toBe('debugger');
    });

    it('should detect architect persona', () => {
        const persona = detectPersona('帮我设计一个微服务架构');
        expect(persona?.id).toBe('architect');
    });

    it('should detect summarizer persona', () => {
        const persona = detectPersona('帮我总结一下这个项目的文档');
        expect(persona?.id).toBe('summarizer');
    });

    it('should detect analyst persona', () => {
        const persona = detectPersona('Help me analyze this dataset and chart the trend');
        expect(persona?.id).toBe('analyst');
    });

    it('should return null for vague input', () => {
        const persona = detectPersona('hi');
        expect(persona).toBeNull();
    });
});

describe('PERSONAS', () => {
    it('should have 7 personas', () => {
        expect(PERSONAS).toHaveLength(7);
    });

    it('each persona should have required fields', () => {
        for (const p of PERSONAS) {
            expect(p.id).toBeTruthy();
            expect(p.name).toBeTruthy();
            expect(p.nameZh).toBeTruthy();
            expect(p.icon).toBeTruthy();
            expect(p.keywords.length).toBeGreaterThan(0);
            expect(p.prompt.length).toBeGreaterThan(0);
        }
    });
});

describe('buildPersonaPrompt', () => {
    it('should return base prompt when persona is null', () => {
        const base = 'Base prompt';
        const result = buildPersonaPrompt(base, null);
        expect(result).toBe(base);
    });

    it('should append persona to base prompt', () => {
        const base = 'Base prompt';
        const persona = PERSONAS[0];
        const result = buildPersonaPrompt(base, persona);
        expect(result).toContain('Base prompt');
        expect(result).toContain(persona.name);
        expect(result).toContain(persona.prompt);
    });
});

summary();
