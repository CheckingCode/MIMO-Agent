/**
 * Chat bubble DOM builders.
 */

import { ImageData } from '../../core/store';
import { bus } from '../../core/bus';
import { createElement } from '../../utils/dom';
import { createCopyButton } from './CodeBlock';

export function createUserBubble(text: string, images?: ImageData[] | null, className = 'msg msg-user'): HTMLElement {
    const bubble = createElement('div', className);

    if (images && images.length > 0) {
        const imgRow = createElement('div');
        imgRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px';
        for (let i = 0; i < images.length; i++) {
            const img = createElement('img', 'msg-img') as HTMLImageElement;
            img.src = images[i].dataUrl;
            img.title = `#${i + 1} ${images[i].name}`;
            img.style.cssText = 'height:40px;width:auto;border-radius:4px;cursor:pointer;vertical-align:middle';
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                bus.emit('showOverlay', images[i].dataUrl);
            });
            imgRow.appendChild(img);
        }
        bubble.appendChild(imgRow);
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
