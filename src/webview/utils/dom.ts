/**
 * DOM utility functions for the MiMo webview.
 */

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Query a single element */
export function $(selector: string, parent: Element | Document = document): HTMLElement | null {
    return parent.querySelector(selector);
}

/** Query all matching elements */
export function $$(selector: string, parent: Element | Document = document): HTMLElement[] {
    return Array.from(parent.querySelectorAll(selector));
}

/** Get element by ID (throws if not found) */
export function byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`[MiMo] Element #${id} not found`);
    return el;
}

/** Create element with optional class and innerHTML */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    innerHTML?: string,
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
}
