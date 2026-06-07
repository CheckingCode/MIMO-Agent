/**
 * Code and copy-button helpers used by chat bubbles and rendered code blocks.
 */

import { createElement } from '../../utils/dom';

export function copyIconMarkup(): string {
    return '<span class="copy-icon" aria-hidden="true"></span>';
}

export function setCopyButtonState(btn: HTMLElement, copied: boolean): void {
    btn.innerHTML = copyIconMarkup();
    btn.classList.toggle('copied', copied);
    btn.title = copied ? 'Copied' : 'Copy';
    btn.setAttribute('aria-label', copied ? 'Copied' : 'Copy');
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
        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* ignore */ }
            document.body.removeChild(ta);
        });
    });
}

export function createCopyButton(textProvider: () => string): HTMLElement {
    const copyBtn = createElement('button', 'msg-copy');
    setCopyButtonState(copyBtn, false);
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(textProvider()).then(() => {
            setCopyButtonState(copyBtn, true);
            setTimeout(() => setCopyButtonState(copyBtn, false), 1600);
        }).catch(() => {});
    });
    return copyBtn;
}
