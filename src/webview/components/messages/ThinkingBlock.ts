import { t } from '../../core/i18n';

/**
 * Thinking/reasoning block rendering helpers.
 */

const REASONING_PREVIEW_CHARS = 360;
const REASONING_STORE_CHARS = 4000;
const REASONING_DEDUP_INTERVAL_MS = 3000;

export function reasoningStoreLimit(): number {
    return REASONING_STORE_CHARS;
}

export function filterReasoningNoise(text: string): string {
    if (!text) return '';
    const noisyPatterns = [
        /\[Context:\s*[^\]]+\]/gi,
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

export function renderThinkingBlock(thinkBlock: HTMLElement, forceFull = false, replayHint = false): void {
    const datasetText = thinkBlock.dataset.reasoningText || '';
    const rawText = (thinkBlock as any)._reasoningText || datasetText;
    const trimmed = !!((thinkBlock as any)._reasoningTrimmed || thinkBlock.dataset.reasoningTrimmed === 'true');
    if (rawText && !(thinkBlock as any)._reasoningText) {
        (thinkBlock as any)._reasoningText = rawText;
    }
    (thinkBlock as any)._reasoningTrimmed = trimmed;
    if (rawText && thinkBlock.dataset.reasoningText !== rawText) {
        thinkBlock.dataset.reasoningText = rawText;
    }
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
        const prefix = trimmed ? t('thinking.trimmed.prefix') : '';
        if (
            forceFull ||
            !(thinkBlock as any)._dedupedText ||
            now - ((thinkBlock as any)._lastDedupAt || 0) > REASONING_DEDUP_INTERVAL_MS
        ) {
            (thinkBlock as any)._dedupedText = prefix + dedupReasoning(rawText);
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
        thinkBlock.textContent = displayText;
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
