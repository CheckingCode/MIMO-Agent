/**
 * Chat bubble DOM builders.
 */

import { ImageData } from '../../core/store';
import { bus } from '../../core/bus';
import { createElement } from '../../utils/dom';
import { createCopyButton } from './CodeBlock';

export function isRenderableImageDataUrl(value: string): boolean {
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(String(value || '').trim());
}

export function createUserBubble(text: string, images?: ImageData[] | null, className = 'msg msg-user'): HTMLElement {
    const bubble = createElement('div', className);
    const validImages = (images || []).filter(img => isRenderableImageDataUrl(img?.dataUrl));
    const invalidImageCount = Math.max(0, (images?.length || 0) - validImages.length);

    if (validImages.length > 0) {
        const imgRow = createElement('div');
        imgRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px';
        for (let i = 0; i < validImages.length; i++) {
            const img = createElement('img', 'msg-img') as HTMLImageElement;
            img.src = validImages[i].dataUrl;
            img.title = `#${i + 1} ${validImages[i].name}`;
            img.style.cssText = 'height:40px;width:auto;border-radius:4px;cursor:pointer;vertical-align:middle';
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                bus.emit('showOverlay', validImages[i].dataUrl);
            });
            imgRow.appendChild(img);
        }
        bubble.appendChild(imgRow);
    }

    if (invalidImageCount > 0) {
        const note = createElement('div', 'msg-image-note');
        note.textContent = invalidImageCount === 1
            ? '[1 image omitted in this view]'
            : `[${invalidImageCount} images omitted in this view]`;
        bubble.appendChild(note);
    }

    if (text) {
        const textDiv = createElement('div', 'text-content');
        textDiv.textContent = text;
        bubble.appendChild(textDiv);
    }

    bubble.appendChild(createCopyButton(() => {
        let fullText = text || '';
        if (images && images.length > 0) {
            fullText += (fullText ? '\n' : '') + images.map(img => `[Image: ${img.name}]`).join('\n');
        }
        return fullText;
    }));

    return bubble;
}

export function installUserBubbleCollapse(bubble: HTMLElement, images?: ImageData[] | null, text?: string): void {
    requestAnimationFrame(() => {
        const textDiv = bubble.querySelector('.text-content') as HTMLElement | null;
        const lineHeight = 1.5 * 13;
        const maxHeight = lineHeight * 3 + 16;
        const shouldCollapse = textDiv && (textDiv.scrollHeight > maxHeight + 10 || (images && images.length > 0 && text));

        if (shouldCollapse) {
            const expandBtn = createElement('button', 'expand-toggle');
            expandBtn.textContent = '展开 ▼';
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                bubble.classList.toggle('expanded');
                expandBtn.textContent = bubble.classList.contains('expanded') ? '收起 ▲' : '展开 ▼';
            });
            bubble.appendChild(expandBtn);
            bubble.classList.add('collapsible');
        }
    });
}
