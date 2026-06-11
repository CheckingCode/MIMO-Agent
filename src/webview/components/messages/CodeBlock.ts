/**
 * Code and copy-button helpers used by chat bubbles and rendered code blocks.
 */

import { createElement } from '../../utils/dom';

export interface ClipboardCopyPayload {
    text: string;
    html?: string;
    primaryImageDataUrl?: string;
}

export function copyIconMarkup(): string {
    return '<span class="copy-icon" aria-hidden="true"></span>';
}

export function setCopyButtonState(btn: HTMLElement, copied: boolean): void {
    btn.innerHTML = copyIconMarkup();
    btn.classList.toggle('copied', copied);
    btn.title = copied ? 'Copied' : 'Copy';
    btn.setAttribute('aria-label', copied ? 'Copied' : 'Copy');
}

function writeTextFallback(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
    return Promise.resolve();
}

function escapeHtml(value: string): string {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        '\'': '&#39;',
    }[ch] || ch));
}

function isSafeImageDataUrl(value: string): boolean {
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(String(value || '').trim());
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
    if (!isSafeImageDataUrl(dataUrl)) return null;
    try {
        const res = await fetch(dataUrl);
        return await res.blob();
    } catch {
        return null;
    }
}

export async function writeClipboardPayload(payload: ClipboardCopyPayload | string): Promise<void> {
    const normalized = typeof payload === 'string' ? { text: payload } : payload;
    const text = String(normalized?.text || '');
    const html = String(normalized?.html || '').trim();
    const primaryImageDataUrl = String(normalized?.primaryImageDataUrl || '');

    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
            const itemData: Record<string, Blob> = {
                'text/plain': new Blob([text], { type: 'text/plain' }),
            };
            if (html) {
                itemData['text/html'] = new Blob([html], { type: 'text/html' });
            }
            const imageBlob = await dataUrlToBlob(primaryImageDataUrl);
            if (imageBlob && imageBlob.type) {
                itemData[imageBlob.type] = imageBlob;
            }
            await navigator.clipboard.write([new ClipboardItem(itemData)]);
            return;
        } catch {
            // fall through to text-only copy
        }
    }

    await writeTextFallback(text);
}

export function buildRichMessageClipboardPayload(
    text: string,
    images?: Array<{ dataUrl: string; name?: string | null }> | null,
): ClipboardCopyPayload {
    const safeImages = (images || []).filter(img => isSafeImageDataUrl(img?.dataUrl));
    const plainText = [
        text || '',
        ...safeImages.map(img => `[Image: ${img.name || 'image'}]`),
    ].filter(Boolean).join('\n');

    if (safeImages.length === 0) {
        return { text: plainText };
    }

    const htmlParts: string[] = [];
    htmlParts.push('<div>');
    htmlParts.push('<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px 0;">');
    for (const img of safeImages) {
        htmlParts.push(
            `<img src="${img.dataUrl}" alt="${escapeHtml(String(img.name || 'image'))}" ` +
            'style="max-width:320px;max-height:320px;border-radius:6px;display:block;" />',
        );
    }
    htmlParts.push('</div>');
    if (text) {
        htmlParts.push(`<div style="white-space:pre-wrap;">${escapeHtml(text)}</div>`);
    }
    htmlParts.push('</div>');

    return {
        text: plainText,
        html: htmlParts.join(''),
        primaryImageDataUrl: safeImages.length === 1 ? safeImages[0].dataUrl : undefined,
    };
}

export function setupCodeBlockCopy(messagesDiv: HTMLElement): void {
    messagesDiv.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLElement | null;
        if (!btn) return;
        const block = btn.closest('.code-block');
        if (!block) return;
        const code = block.querySelector('code');
        if (!code) return;
        const text = code.textContent || '';
        writeClipboardPayload(text).then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
        }).catch(() => {});
    });
}

export function createCopyButton(payloadProvider: () => string | ClipboardCopyPayload): HTMLElement {
    const copyBtn = createElement('button', 'msg-copy');
    setCopyButtonState(copyBtn, false);
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        writeClipboardPayload(payloadProvider()).then(() => {
            setCopyButtonState(copyBtn, true);
            setTimeout(() => setCopyButtonState(copyBtn, false), 1600);
        }).catch(() => {});
    });
    return copyBtn;
}
