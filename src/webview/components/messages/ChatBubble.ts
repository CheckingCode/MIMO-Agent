/**
 * Chat bubble DOM builders.
 */

import { ImageData } from '../../core/store';
import { bus } from '../../core/bus';
import { createElement } from '../../utils/dom';
import { buildRichMessageClipboardPayload, createCopyButton } from './CodeBlock';

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

    bubble.appendChild(createCopyButton(() => buildRichMessageClipboardPayload(text || '', validImages)));

    return bubble;
}

function setUserBubbleExpandedState(bubble: HTMLElement, expandBtn: HTMLButtonElement): void {
    expandBtn.textContent = bubble.classList.contains('expanded')
        ? '\u6536\u8d77 \u25b4'
        : '\u5c55\u5f00 \u25be';
}

function toggleUserBubbleExpanded(bubble: HTMLElement, expandBtn: HTMLButtonElement): void {
    bubble.classList.toggle('expanded');
    setUserBubbleExpandedState(bubble, expandBtn);
}

function isUserBubbleInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest('button, a, input, textarea, select, summary, .msg-copy, .expand-toggle, .msg-img');
}

export function installUserBubbleCollapse(bubble: HTMLElement, images?: ImageData[] | null, text?: string): void {
    requestAnimationFrame(() => {
        const textDiv = bubble.querySelector('.text-content') as HTMLElement | null;
        const lineHeight = 1.5 * 13;
        const maxHeight = lineHeight * 3 + 16;
        const hasImages = (images?.length || 0) > 0 || !!bubble.querySelector('.msg-img, .msg-image-note');
        const hasText = !!((text || textDiv?.textContent || '').trim());
        const shouldCollapse = !!textDiv && (textDiv.scrollHeight > maxHeight + 10 || (hasImages && hasText));

        const existingBtn = bubble.querySelector<HTMLButtonElement>('.expand-toggle');
        if (!shouldCollapse) {
            bubble.classList.remove('collapsible', 'expanded');
            existingBtn?.remove();
            return;
        }

        bubble.classList.add('collapsible');
        let expandBtn = existingBtn;
        if (expandBtn) {
            const clone = expandBtn.cloneNode(true) as HTMLButtonElement;
            expandBtn.replaceWith(clone);
            expandBtn = clone;
        } else {
            expandBtn = createElement('button', 'expand-toggle') as HTMLButtonElement;
            bubble.appendChild(expandBtn);
        }

        setUserBubbleExpandedState(bubble, expandBtn);
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserBubbleExpanded(bubble, expandBtn!);
        });

        if (!(bubble as any)._userBubbleCollapseBound) {
            bubble.addEventListener('click', (e) => {
                if (!bubble.classList.contains('collapsible') || isUserBubbleInteractiveTarget(e.target)) return;
                toggleUserBubbleExpanded(bubble, expandBtn!);
            });
            (bubble as any)._userBubbleCollapseBound = true;
        }
    });
}
