import { renderMarkdown } from '../markdown';
import { describe, it, expect } from './test-runner';

describe('renderMarkdown', () => {
    it('preserves markdown-looking text inside fenced code blocks', () => {
        const html = renderMarkdown('```text\n- not a list\n`not inline`\n```');
        expect(html).toContain('- not a list');
        expect(html).toContain('`not inline`');
        expect(html.includes('<li>')).toBe(false);
    });

    it('escapes unsafe links instead of rendering anchors', () => {
        const html = renderMarkdown('[bad](javascript:alert(1))');
        expect(html).toContain('bad (javascript:alert(1))');
    });
});
