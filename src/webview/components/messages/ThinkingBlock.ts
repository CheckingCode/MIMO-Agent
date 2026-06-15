import { t } from '../../core/i18n';
import { escapeHtml } from '../../utils/dom';

/**
 * Thinking/reasoning block rendering helpers.
 */

const REASONING_PREVIEW_CHARS = 360;
const REASONING_STORE_CHARS = 4000;
const REASONING_HISTORY_DISPLAY_CHARS = 6000;
const REASONING_DEDUP_INTERVAL_MS = 3000;

export function reasoningStoreLimit(): number {
    return REASONING_STORE_CHARS;
}

export function filterReasoningNoise(text: string): string {
    if (!text) return '';
    const noisyPatterns = [
        /\[Context:\s*[^\]]+\]/gi,
        /^\s*\[(?:Router|Intent|意图)[^\]\n]*\][^\n]*(?:\n|$)/gmi,
        /\[Progress\][^\[]*/gi,
        /\[Soft budget reached\][^\[]*/gi,
        /\[Stop guard\][^\[]*/gi,
        /\[[^\]\n]*(?:Context|Progress|Recovery|Completion gate|Round budget|Complexity|Rate limited|Model fallback|Handoff)[^\]\n]*\][^\[]*/gi,
        /(?:第\s*\d+\s*轮|Round\s+\d+)[^\n]*(?:预算|budget|context|上下文|压缩|tokens?)[^\n]*/gi,
        /(?:上下文|Context)[^\n]*(?:估算|压缩|滑动窗口|summar|sliding window|tokens?)[^\n]*/gi,
        /(?:Pre-tool stage|tool timeout|soft timeout|hard cap|round budget)[^\n]*/gi,
        /(?:Let me|I will|I now|I have|Good,|The workspace is clean\.)[^\n]*(?:write|read|try|generate|continue|content|script|file)[^\n]*/gi,
        /compressing with summarization\.?\s*x?\s*\d*/gi,
        /sliding window\.?\s*x?\s*\d*/gi,
        /The user wants to continue implementing[^.\n]*(?:\.|\n)?/gi,
    ];
    let out = text;
    for (const pattern of noisyPatterns) out = out.replace(pattern, '');
    return out
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{3,}/g, ' ');
}

export function sanitizeReasoningForDisplay(text: string, trimmed = false): string {
    const filtered = filterReasoningNoise(text || '');
    const safeStatusLines = filtered
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^\[[^\]\n]{1,120}\]/.test(line) || /^第\s*\d+\s*轮/.test(line))
        .slice(0, 8);
    const looksLikePrivateDraft =
        filtered.length > 800 ||
        /<!DOCTYPE|<html|<script|<\/style>|```|function\s+\w+|const\s+\w+|let\s+\w+|canvas|ctx\.|fuselage|coordinates?|Actually,|Let me|I need to|I should|The user wants|Here's my plan/i.test(filtered);

    if (looksLikePrivateDraft) {
        const lines = [
            '已隐藏详细思考内容。',
            '执行进度、工具结果和最终答复会继续显示。',
        ];
        if (safeStatusLines.length > 0) {
            lines.push('', ...safeStatusLines);
        }
        if (trimmed) {
            lines.push('', '[较早思考内容已为流畅性压缩]');
        }
        return lines.join('\n');
    }

    const maxChars = 1200;
    const clipped = filtered.length > maxChars
        ? `${filtered.slice(0, maxChars)}\n\n[思考内容过长，已截断显示]`
        : filtered;
    return trimmed ? `${t('thinking.trimmed.prefix')}${clipped}` : clipped;
}

export function sanitizeReasoningForHistoryDisplay(text: string, trimmed = false): string {
    const cleaned = String(text || '')
        .replace(/\[reasoning compacted for context\]/gi, '')
        .replace(/\[reasoning omitted for context\]/gi, '')
        .replace(/\[Earlier reasoning trimmed[^\]]*\]/gi, '')
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return false;
            return !/^\[(?:Context|Progress|Soft budget reached|Stop guard|Round budget|Complexity|Rate limited|Model fallback|Handoff|Completion gate)[^\]]*\]/i.test(trimmedLine);
        })
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
    if (!cleaned) return '';
    const maxChars = REASONING_HISTORY_DISPLAY_CHARS;
    const clipped = cleaned.length > maxChars
        ? `${cleaned.slice(0, Math.floor(maxChars * 0.65)).trimEnd()}\n\n... (${cleaned.length - maxChars} chars omitted from history view) ...\n\n${cleaned.slice(-Math.floor(maxChars * 0.25)).trimStart()}`
        : cleaned;
    return trimmed ? `${t('thinking.trimmed.prefix')}${clipped}` : clipped;
}

function renderThinkingMarkdown(text: string): string {
    if (!text) return '';
    let html = escapeHtml(text);

    const codeBlocks: string[] = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(
            `<div class="code-block">` +
            `<div class="code-header"><span class="code-lang">${escapeHtml(lang || 'text')}</span></div>` +
            `<pre><code>${code}</code></pre>` +
            `</div>`
        );
        return `\n__THINK_CODE_${idx}__\n`;
    });

    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => match.includes('<ul>') ? match : `<ol>${match}</ol>`);
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/\n{3,}/g, '\n\n');
    html = html.replace(/\n/g, '<br>');

    codeBlocks.forEach((block, i) => {
        html = html.replace(`__THINK_CODE_${i}__`, block);
    });
    return html;
}

export function renderThinkingBlock(thinkBlock: HTMLElement, forceFull = false, replayHint = false): void {
    const datasetText = thinkBlock.dataset.reasoningText || '';
    const rawText = (thinkBlock as any)._reasoningText || datasetText;
    const trimmed = !!((thinkBlock as any)._reasoningTrimmed || thinkBlock.dataset.reasoningTrimmed === 'true');
    if (rawText && !(thinkBlock as any)._reasoningText) {
        (thinkBlock as any)._reasoningText = rawText;
    }
    (thinkBlock as any)._reasoningTrimmed = trimmed;
    delete thinkBlock.dataset.reasoningText;
    thinkBlock.dataset.reasoningTrimmed = trimmed ? 'true' : 'false';
    const toggle = thinkBlock.previousElementSibling as HTMLElement | null;
    if (rawText.length <= 30) {
        if (toggle) toggle.style.display = 'none';
        return;
    }
    const now = Date.now();
    if (!forceFull && !replayHint) {
        const lastAt = (thinkBlock as any)._lastRenderedAt || 0;
        if (now - lastAt < 900) {
            if (!(thinkBlock as any)._renderTimer) {
                (thinkBlock as any)._renderTimer = window.setTimeout(() => {
                    (thinkBlock as any)._renderTimer = 0;
                    renderThinkingBlock(thinkBlock, false, false);
                }, 900 - (now - lastAt));
            }
            return;
        }
        (thinkBlock as any)._lastRenderedAt = now;
    }

    const expanded = forceFull || thinkBlock.classList.contains('show');
    let displayText = rawText;
    if (expanded) {
        if (
            forceFull ||
            !(thinkBlock as any)._dedupedText ||
            now - ((thinkBlock as any)._lastDedupAt || 0) > REASONING_DEDUP_INTERVAL_MS
        ) {
            const sanitize = thinkBlock.dataset.historyReasoning === 'true'
                ? sanitizeReasoningForHistoryDisplay
                : sanitizeReasoningForDisplay;
            (thinkBlock as any)._dedupedText = dedupReasoning(sanitize(rawText, trimmed));
            (thinkBlock as any)._lastDedupAt = now;
        }
        displayText = (thinkBlock as any)._dedupedText;
    } else {
        const trimmedText = trimmed ? t('thinking.trimmed') : '';
        displayText = t('thinking.compact')
            .replace('{count}', rawText.length.toLocaleString())
            .replace('{trimmed}', trimmedText);
    }

    if (/loop|recovery/i.test(displayText)) {
        thinkBlock.classList.add('reasoning-loop-warn');
    }

    if ((thinkBlock as any)._lastRenderedText !== displayText) {
        if (expanded) {
            thinkBlock.innerHTML = renderThinkingMarkdown(displayText);
        } else {
            thinkBlock.textContent = displayText;
        }
        (thinkBlock as any)._lastRenderedText = displayText;
        if (toggle) toggle.style.display = '';
    }

    if (replayHint && !thinkBlock.classList.contains('show')) {
        thinkBlock.classList.add('show');
        toggle?.classList.add('open');
        renderThinkingBlock(thinkBlock, true);
    }
}

export function dedupReasoning(text: string): string {
    let result = text.replace(
        /((?:[^\n]{1,200}\n?){1,3})\1{2,}/g,
        (_match: string, phrase: string) => {
            const trimmed = phrase.replace(/\n+$/, '');
            const count = Math.ceil(_match.length / phrase.length);
            return trimmed + ` x${count}\n`;
        }
    );
    if (result.length < 3000) {
        for (let size = 100; size >= 20; size -= 10) {
            const regex = new RegExp(`(.{${size}})\\1{2,}`, 'g');
            const newResult = result.replace(regex, (match: string, phrase: string) => {
                const count = Math.round(match.length / phrase.length);
                return phrase + ` x${count}`;
            });
            if (newResult !== result) { result = newResult; break; }
        }
        result = result.replace(/(.{20,}?)\1{2,}/g, (match: string, phrase: string) => {
            const count = Math.round(match.length / phrase.length);
            return phrase + ` x${count}`;
        });
    }
    return result;
}
