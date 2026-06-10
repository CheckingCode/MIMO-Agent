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

    it('renders safe markdown links as clickable URL links', () => {
        const html = renderMarkdown('[site](https://example.com/docs)');
        expect(html).toContain('class="md-link url-link"');
        expect(html).toContain('href="https://example.com/docs"');
    });

    it('auto-links Windows file paths in summary tables', () => {
        const html = renderMarkdown('| 文件 | 路径 |\n| --- | --- |\n| 贴图 | G:\\AI World\\moon_texture_4k.jpg |');
        expect(html).toContain('class="md-link file-link"');
        expect(html).toContain('data-file="G:\\AI World\\moon_texture_4k.jpg"');
    });

    it('keeps local file paths inside inline code as plain code', () => {
        const html = renderMarkdown('路径 `G:\\AI World\\moon_texture_4k.jpg` 不应变成链接');
        expect(html).toContain('<code>G:\\AI World\\moon_texture_4k.jpg</code>');
        expect(html.includes('file-link')).toBe(false);
    });

    it('stores line numbers for auto-linked file paths', () => {
        const html = renderMarkdown('查看 G:\\GitHub\\mimo-agent-vscode\\src\\markdown.ts:12');
        expect(html).toContain('data-file="G:\\GitHub\\mimo-agent-vscode\\src\\markdown.ts"');
        expect(html).toContain('data-line="12"');
    });
});
