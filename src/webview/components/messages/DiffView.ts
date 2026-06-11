/**
 * Diff rendering helpers for compact edit cards and git diff previews.
 */

import { escapeHtml, createElement } from '../../utils/dom';

interface DiffLine {
    type: 'add' | 'del' | 'ctx' | 'hunk' | 'file';
    text: string;
    oldLn?: number;
    newLn?: number;
    label?: string;
}

export function createDiffCard(args: any): HTMLElement | null {
    const oldText = args.old_text || '';
    const newText = args.new_text || '';
    if (!oldText && !newText) return null;

    const card = createElement('div', 'diff-card expanded');
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const filePath = args.path || 'file';
    const diff = computeDiff(oldLines, newLines);
    const added = diff.filter(d => d.type === 'add').length;
    const removed = diff.filter(d => d.type === 'del').length;

    card.setAttribute('data-file', filePath);
    card.setAttribute('data-action', 'edit');
    card.setAttribute('data-added', String(added));
    card.setAttribute('data-removed', String(removed));
    card.innerHTML = `<div class="diff-card-header">` +
        `<span class="diff-file">${escapeHtml(filePath)}</span>` +
        `<span class="diff-stats">${added} lines added, ${removed} lines removed</span>` +
        `<span class="diff-chevron">›</span>` +
        `</div><div class="diff-card-body"></div>`;

    const body = card.querySelector('.diff-card-body') as HTMLElement;
    const maxShow = Math.min(diff.length, 15);
    const startLine = Number(args.line_start);
    const initialLine = Number.isFinite(startLine) && startLine > 0 ? Math.floor(startLine) - 1 : 0;
    let oldLineNum = initialLine;
    let newLineNum = initialLine;
    for (let i = 0; i < maxShow; i++) {
        const d = diff[i];
        const div = createElement('div', `diff-card-line ${d.type === 'add' ? 'add' : d.type === 'del' ? 'del' : 'ctx'}`);
        if (d.type === 'del') {
            oldLineNum++;
            div.innerHTML = `<span class="diff-ln">${oldLineNum}</span><span class="diff-text">${escapeHtml(d.text).substring(0, 120)}</span>`;
        } else if (d.type === 'add') {
            newLineNum++;
            div.innerHTML = `<span class="diff-ln">${newLineNum}</span><span class="diff-text">${escapeHtml(d.text).substring(0, 120)}</span>`;
        } else {
            oldLineNum++;
            newLineNum++;
            div.innerHTML = `<span class="diff-ln">${newLineNum}</span><span class="diff-text" style="opacity:.4">${escapeHtml(d.text).substring(0, 120)}</span>`;
        }
        body.appendChild(div);
    }
    if (diff.length > maxShow) {
        const more = createElement('div', 'diff-card-line ctx');
        more.innerHTML = `<span class="diff-ln"></span><span class="diff-text" style="opacity:.4">... ${diff.length - maxShow} more lines</span>`;
        body.appendChild(more);
    }

    const diffHeader = card.querySelector('.diff-card-header');
    if (diffHeader) diffHeader.addEventListener('click', () => {
        card.classList.toggle('expanded');
    });
    return card;
}

export function computeDiff(oldLines: string[], newLines: string[]): Array<{ type: string; text: string }> {
    const m = oldLines.length;
    const n = newLines.length;

    if (m * n > 250_000) {
        const result: Array<{ type: string; text: string }> = [];
        for (const line of oldLines) result.push({ type: 'del', text: line });
        for (const line of newLines) result.push({ type: 'add', text: line });
        return result;
    }

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const result: Array<{ type: string; text: string }> = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.push({ type: 'ctx', text: oldLines[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.push({ type: 'add', text: newLines[j - 1] });
            j--;
        } else {
            result.push({ type: 'del', text: oldLines[i - 1] });
            i--;
        }
    }

    result.reverse();
    return result;
}

export function renderEditDiff(res: HTMLElement, args: any, txt: string): void {
    const oldLines = (args.old_text || '').split('\n');
    const newLines = (args.new_text || '').split('\n');
    let html = `<div class="diff-header-line"><span class="diff-stats">-${oldLines.length} +${newLines.length}</span></div>`;
    const maxShow = Math.max(oldLines.length, newLines.length, 8);
    const showOld = oldLines.slice(0, maxShow);
    const showNew = newLines.slice(0, maxShow);
    for (const line of showOld) {
        html += `<div class="diff-line"><span class="diff-ln">-</span><span class="diff-del">- ${escapeHtml(line).substring(0, 120)}</span></div>`;
    }
    if (oldLines.length > maxShow) html += `<div class="diff-line"><span class="diff-ln">...</span><span class="diff-info">+${oldLines.length - maxShow} more lines</span></div>`;
    for (const line of showNew) {
        html += `<div class="diff-line"><span class="diff-ln">+</span><span class="diff-add">+ ${escapeHtml(line).substring(0, 120)}</span></div>`;
    }
    if (newLines.length > maxShow) html += `<div class="diff-line"><span class="diff-ln">...</span><span class="diff-info">+${newLines.length - maxShow} more lines</span></div>`;
    html += `<div class="diff-info">${escapeHtml(txt)}</div>`;
    res.innerHTML = html;
}

export function renderGitDiff(res: HTMLElement, txt: string): void {
    const maxChars = 8000;
    const truncated = txt.length > maxChars;
    const lines = (truncated ? txt.substring(0, maxChars) : txt).split('\n');
    const CONTEXT_LINES = 2;

    const files: { name: string; hunks: DiffLine[][]; added: number; removed: number }[] = [];
    let curFile = { name: '', hunks: [] as DiffLine[][], added: 0, removed: 0 };
    let curHunk: DiffLine[] = [];
    let oldLn = 0, newLn = 0;

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            if (curHunk.length > 0) {
                curFile.hunks.push(curHunk);
                curHunk = [];
            }
            if (curFile.name) { files.push(curFile); }
            const m = line.match(/b\/(.+)$/);
            curFile = { name: m ? m[1] : '', hunks: [], added: 0, removed: 0 };
            oldLn = 0; newLn = 0;
            continue;
        }
        if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) continue;
        if (line.startsWith('@@')) {
            const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
            if (m) { oldLn = parseInt(m[1]) - 1; newLn = parseInt(m[2]) - 1; }
            if (curHunk.length > 0) curFile.hunks.push(curHunk);
            curHunk = [{ type: 'hunk', text: m ? m[0] : line, label: m?.[3]?.trim() }];
            continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
            newLn++; curFile.added++; curHunk.push({ type: 'add', text: line.substring(1), newLn });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            oldLn++; curFile.removed++; curHunk.push({ type: 'del', text: line.substring(1), oldLn });
        } else if (line.startsWith(' ')) {
            oldLn++; newLn++; curHunk.push({ type: 'ctx', text: line.substring(1), oldLn, newLn });
        }
    }
    if (curHunk.length > 0) curFile.hunks.push(curHunk);
    if (curFile.name) files.push(curFile);

    let html = '';
    let totalAdded = 0, totalRemoved = 0;

    for (const file of files) {
        totalAdded += file.added;
        totalRemoved += file.removed;
        if (file.added === 0 && file.removed === 0) continue;

        html += `<div class="diff-file-header" data-file="${escapeHtml(file.name)}">File ${escapeHtml(file.name)}</div>`;

        for (const hunk of file.hunks) {
            const hunkLine = hunk.find(l => l.type === 'hunk');
            if (hunkLine) {
                const m = (hunkLine.text || '').match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
                if (m) {
                    const loc = hunkLine.text.replace(/^@@\s*/, '').replace(/\s*@@.*$/, '').trim();
                    html += `<div class="diff-hunk"><span class="diff-hunk-marker">@@</span><span class="diff-hunk-loc">${escapeHtml(loc)}</span>${hunkLine.label ? `<span class="diff-hunk-fn">${escapeHtml(hunkLine.label)}</span>` : ''}</div>`;
                } else {
                    html += `<div class="diff-hunk"><span class="diff-hunk-marker">@@</span>${escapeHtml(hunkLine.text)}</div>`;
                }
            }

            const changed = new Set<number>();
            hunk.forEach((l, i) => { if (l.type === 'add' || l.type === 'del') changed.add(i); });

            let lastShown = -1;
            for (let i = 0; i < hunk.length; i++) {
                const l = hunk[i];
                if (l.type === 'hunk') continue;

                const isNearChange = [...changed].some(ci => Math.abs(ci - i) <= CONTEXT_LINES);
                if (!isNearChange && l.type === 'ctx') continue;

                if (l.type === 'ctx' && lastShown >= 0 && i - lastShown > 1) {
                    const skipped = i - lastShown - 1;
                    html += `<div class="diff-skip">... ${skipped} unchanged line${skipped > 1 ? 's' : ''} ...</div>`;
                }
                lastShown = i;

                const esc = escapeHtml(l.text);
                if (l.type === 'add') {
                    html += `<div class="diff-line diff-add"><span class="diff-ln new">${l.newLn}</span><span class="diff-sign">+</span><span class="diff-text">${esc}</span></div>`;
                } else if (l.type === 'del') {
                    html += `<div class="diff-line diff-del"><span class="diff-ln old">${l.oldLn}</span><span class="diff-sign">-</span><span class="diff-text">${esc}</span></div>`;
                } else {
                    html += `<div class="diff-line diff-ctx"><span class="diff-ln old">${l.oldLn}</span><span class="diff-ln new">${l.newLn}</span><span class="diff-sign"> </span><span class="diff-text">${esc}</span></div>`;
                }
            }
        }

        html += `<div class="diff-file-summary"><span class="diff-stats-add">+${file.added} lines</span><span class="diff-stats-del">-${file.removed} lines</span></div>`;
    }

    if (totalAdded > 0 || totalRemoved > 0) {
        const label = files.length > 1 ? `${files.length} files` : (files[0]?.name || 'changes');
        html = `<div class="diff-summary"><span class="diff-file-name">${escapeHtml(label)}</span><span class="diff-stats-add">+${totalAdded} lines</span><span class="diff-stats-del">-${totalRemoved} lines</span></div>` + html;
    }

    if (truncated) html += `<div class="diff-info">... (truncated, ${txt.length} chars total)</div>`;
    res.innerHTML = html || '<div class="diff-info">No changes</div>';
}
