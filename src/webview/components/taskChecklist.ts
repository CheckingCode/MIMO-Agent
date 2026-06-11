/**
 * TaskChecklist component - execution progress tracker.
 */

import { escapeHtml } from '../utils/dom';
import { t } from '../core/i18n';

export interface TodoItem {
    text: string;
    done: boolean;
    active?: boolean;
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
}

export function parseTodoItems(html: string): TodoItem[] {
    const items: TodoItem[] = [];
    const regex = /<li\s+class="todo(?:\s+done)?"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const done = match[0].includes('todo done');
        const rawText = match[1].replace(/<[^>]+>/g, '').trim();
        const parsed = parsePriority(rawText);
        if (parsed.text) {
            items.push({ text: parsed.text, done, priority: parsed.priority });
        }
    }
    return items;
}

export function renderTaskChecklist(items: TodoItem[]): string {
    if (items.length === 0) return '';

    const doneCount = items.filter(i => i.done).length;
    const total = items.length;
    const percent = Math.round((doneCount / total) * 100);
    const distinctPriorities = new Set(items.map(item => item.priority).filter(Boolean));
    const showPriority = distinctPriorities.size > 1;
    const sorted = showPriority
        ? [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
        : [...items];

    let html = `<div class="task-checklist">`;
    html += `<div class="task-checklist-header">`;
    html += `<span><span class="todo-icon">&#9744;</span>${escapeHtml(t('todo.progress.title'))}</span>`;
    html += `<div class="task-checklist-progress">`;
    html += `<span class="progress-text">${doneCount}/${total}</span>`;
    html += `<div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="task-checklist-items">`;
    for (const item of sorted) {
        const cls = item.done ? 'todo done' : 'todo';
        const check = item.done ? '&#10003;' : '';
        const status = item.done
            ? t('todo.status.done')
            : item.active
                ? t('todo.status.inProgress')
                : t('todo.status.pending');
        html += `<div class="${cls}">`;
        html += `<span class="todo-check">${check}</span>`;
        if (showPriority && item.priority) {
            html += `<span class="todo-priority priority-${item.priority.toLowerCase()}">${item.priority}</span>`;
        }
        html += `<span class="todo-text">${escapeHtml(item.text)}</span>`;
        html += `<span class="todo-status">${status}</span>`;
        html += `</div>`;
    }
    html += `</div>`;
    html += `</div>`;

    return html;
}

export function extractTaskChecklist(html: string): { checklist: string; remainder: string } | null {
    const match = html.match(/<div class="task-checklist">[\s\S]*?<\/div>\s*<\/div>/);
    if (!match) return null;

    const checklist = match[0];
    const remainder = html.replace(checklist, '').trim();
    return { checklist, remainder };
}

function parsePriority(text: string): { text: string; priority?: TodoItem['priority'] } {
    const match = text.match(/^\s*(?:\[(P[0-3])\]|(P[0-3])[:：-])\s*(.+)$/i);
    if (!match) return { text };
    return {
        priority: (match[1] || match[2]).toUpperCase() as TodoItem['priority'],
        text: match[3].trim(),
    };
}

function priorityRank(priority?: TodoItem['priority']): number {
    if (priority === 'P0') return 0;
    if (priority === 'P1') return 1;
    if (priority === 'P2') return 2;
    if (priority === 'P3') return 3;
    return 4;
}
