/**
 * Thinking/reasoning block rendering helpers.
 */

const REASONING_PREVIEW_CHARS = 700;
const REASONING_STORE_CHARS = 12000;
const REASONING_DEDUP_INTERVAL_MS = 1500;

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
        /compressing with summarization\.?\s*x?\s*\d*/gi,
        /sliding window\.?\s*x?\s*\d*/gi,
        /The user wants to continue implementing[^.\n]*(?:\.|\n)?/gi,
    ];
    let out = text;
    for (const pattern of noisyPatterns) out = out.replace(pattern, '');
    return out.replace(/\s{3,}/g, ' ');
}

export function renderThinkingBlock(thinkBlock: HTMLElement, forceFull = false, replayHint = false): void {
    const rawText = (thinkBlock as any)._reasoningText || '';
    const toggle = thinkBlock.previousElementSibling as HTMLElement | null;
    if (rawText.length <= 30) {
        if (toggle) toggle.style.display = 'none';
        return;
    }
    const now = Date.now();
    if (!forceFull && !replayHint) {
        const lastAt = (thinkBlock as any)._lastRenderedAt || 0;
        if (now - lastAt < 350) {
            if (!(thinkBlock as any)._renderTimer) {
                (thinkBlock as any)._renderTimer = window.setTimeout(() => {
                    (thinkBlock as any)._renderTimer = 0;
                    renderThinkingBlock(thinkBlock, false, false);
                }, 350 - (now - lastAt));
            }
            return;
        }
        (thinkBlock as any)._lastRenderedAt = now;
    }

    const expanded = forceFull || thinkBlock.classList.contains('show');
    let displayText = rawText;
    if (expanded) {
        const prefix = (thinkBlock as any)._reasoningTrimmed ? '[Earlier thinking trimmed for responsiveness]\n\n' : '';
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
        const prefix = (thinkBlock as any)._reasoningTrimmed ? '[Thinking trimmed]\n' : '';
        displayText = rawText.length > REASONING_PREVIEW_CHARS
            ? `${prefix}... ${rawText.slice(-REASONING_PREVIEW_CHARS)}`
            : `${prefix}${rawText.slice(-REASONING_PREVIEW_CHARS)}`;
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
