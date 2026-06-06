/**
 * TaskChecklist component — "Update Todos" progress tracker.
 *
 * Renders consecutive todo items as a structured component with:
 * - Header with title and progress counter
 * - Progress bar
 * - Styled checkboxes
 * - In-place updates
 */

import { escapeHtml } from '../utils/dom';

export interface TodoItem {
    text: string;
    done: boolean;
}

/**
 * Parse todo items from a block of HTML (consecutive <li class="todo"> elements).
 */
export function parseTodoItems(html: string): TodoItem[] {
    const items: TodoItem[] = [];
    const regex = /<li\s+class="todo(?:\s+done)?"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const done = match[0].includes('todo done');
        // Strip HTML tags from the text
        const text = match[1].replace(/<[^>]+>/g, '').trim();
        if (text) {
            items.push({ text, done });
        }
    }
    return items;
}

/**
 * Render a TaskChecklist from todo items.
 */
export function renderTaskChecklist(items: TodoItem[]): string {
    if (items.length === 0) return '';

    const doneCount = items.filter(i => i.done).length;
    const total = items.length;
    const percent = Math.round((doneCount / total) * 100);

    let html = `<div class="task-checklist">`;

    // Header
    html += `<div class="task-checklist-header">`;
    html += `<span><span class="todo-icon">☐</span>Update Todos</span>`;
    html += `<div class="task-checklist-progress">`;
    html += `<span class="progress-text">${doneCount}/${total}</span>`;
    html += `<div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>`;
    html += `</div>`;
    html += `</div>`;

    // Items
    html += `<div class="task-checklist-items">`;
    for (const item of items) {
        const cls = item.done ? 'todo done' : 'todo';
        const check = item.done ? '✓' : '';
        const status = item.done ? 'done' : '';
        html += `<div class="${cls}">`;
        html += `<span class="todo-check">${check}</span>`;
        html += `<span class="todo-text">${escapeHtml(item.text)}</span>`;
        html += `<span class="todo-status">${status}</span>`;
        html += `</div>`;
    }
    html += `</div>`;
    html += `</div>`;

    return html;
}

/**
 * Check if HTML contains a task checklist block.
 * Returns the checklist HTML if found, null otherwise.
 */
export function extractTaskChecklist(html: string): { checklist: string; remainder: string } | null {
    // Match a <div class="task-checklist">...</div> block
    const match = html.match(/<div class="task-checklist">[\s\S]*?<\/div>\s*<\/div>/);
    if (!match) return null;

    const checklist = match[0];
    const remainder = html.replace(checklist, '').trim();
    return { checklist, remainder };
}
