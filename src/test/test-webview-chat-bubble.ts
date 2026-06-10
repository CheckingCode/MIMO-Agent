import { describe, it, expect } from './test-runner';
import { isRenderableImageDataUrl } from '../webview/components/messages/ChatBubble';
import { sanitizeReasoningForDisplay } from '../webview/components/messages/ThinkingBlock';

describe('webview chat bubble image handling', () => {
    it('accepts safe image data URLs for inline previews', () => {
        expect(isRenderableImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
        expect(isRenderableImageDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    });

    it('rejects persisted image placeholders and unsafe URLs', () => {
        expect(isRenderableImageDataUrl('[large image omitted from VS Code state; full image is kept in MiMo history]')).toBe(false);
        expect(isRenderableImageDataUrl('https://example.test/image.png')).toBe(false);
        expect(isRenderableImageDataUrl('javascript:alert(1)')).toBe(false);
    });

    it('hides long internal reasoning drafts from the thinking display', () => {
        const raw = [
            '[Role: 解决方案架构师] [意图: refactor]',
            'The user wants a cinematic fighter jet animation. Actually, I should plan the fuselage coordinates.',
            'Here is my plan: draw canvas layers, afterburner particles, then write HTML.',
            '<!DOCTYPE html><html><head><style>canvas{width:100%}</style></head><body><script>const ctx = canvas.getContext("2d"); function draw(){}</script></body></html>',
        ].join('\n').repeat(8);

        const display = sanitizeReasoningForDisplay(raw);
        expect(display).toContain('内部推理已隐藏');
        expect(display).toContain('[Role: 解决方案架构师]');
        expect(display.includes('<!DOCTYPE html>')).toBe(false);
        expect(display.includes('fuselage coordinates')).toBe(false);
    });
});
