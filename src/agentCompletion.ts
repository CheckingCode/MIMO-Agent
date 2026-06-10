import { ChatMessage } from './api';
import { AgentMode } from './agentTypes';

export type CompletionDecisionKind = 'finish' | 'continue' | 'recover' | 'handoff' | 'stop';

export interface CompletionDecision {
    kind: CompletionDecisionKind;
    reason: string;
    instruction?: ChatMessage;
}

export interface ReasoningLoopResult {
    detected: boolean;
    count: number;
}

export class AgentCompletionPolicy {
    detectReasoningLoop(text: string): ReasoningLoopResult {
        const minRepeats = 5;
        const minTextLength = 300;
        if (text.length < minTextLength) return { detected: false, count: 0 };

        const cleaned = text.replace(
            /\[(?:Role|Intent|Context|意图)[^\]]*\]\s*/g,
            '',
        ).replace(
            /Proceed with tools[\s-]*/gi,
            '',
        ).replace(
            /需要工具[\s-]*/g,
            '',
        ).replace(
            /(?:let me|让我|我来|我先|现在).{0,16}[，。,.]\s*/gi,
            '',
        ).replace(
            /\s+/g,
            ' ',
        ).trim();

        const repeatedChunk = this.detectRepeatedReasoningChunk(cleaned);
        if (repeatedChunk.detected) return repeatedChunk;

        for (const patLen of [20, 30, 40, 60]) {
            if (cleaned.length < patLen * minRepeats) continue;
            const pattern = cleaned.slice(-patLen);
            if (/^[\s\-.:,;!?]+$/.test(pattern)) continue;
            const scanStart = Math.max(0, cleaned.length - 3000);
            const region = cleaned.slice(scanStart, cleaned.length - patLen);
            let count = 0;
            let pos = 0;
            while ((pos = region.indexOf(pattern, pos)) !== -1) {
                count++;
                pos += patLen;
            }
            if (count >= minRepeats) {
                return { detected: true, count: count + 1 };
            }
        }

        if (cleaned.length >= 400) {
            const bestRepeat = this.findMostRepeatedSubstring(cleaned);
            if (bestRepeat && bestRepeat.count >= minRepeats && bestRepeat.length >= 20) {
                return { detected: true, count: bestRepeat.count };
            }
        }

        if (text.length >= 600) {
            const rawPattern = text.slice(-50);
            const rawStart = Math.max(0, text.length - 2000);
            const rawRegion = text.slice(rawStart, text.length - 50);
            let rawCount = 0;
            let rawPos = 0;
            while ((rawPos = rawRegion.indexOf(rawPattern, rawPos)) !== -1) {
                rawCount++;
                rawPos += 50;
            }
            if (rawCount >= 8) {
                return { detected: true, count: rawCount + 1 };
            }
        }

        return { detected: false, count: 0 };
    }

    detectRepeatedReasoningChunk(text: string): ReasoningLoopResult {
        const recent = String(text || '').slice(-5000);
        if (recent.length < 300) return { detected: false, count: 0 };

        const chunks = recent
            .split(/(?:\r?\n+|(?<=[.!?。！？])\s+)/)
            .map(chunk => chunk.replace(/\s+/g, ' ').trim())
            .filter(chunk => chunk.length >= 40 && /[A-Za-z\u4e00-\u9fff]/.test(chunk));

        const counts = new Map<string, number>();
        for (const chunk of chunks) {
            const normalized = chunk
                .replace(/^(?:The user wants me to|I need to|Let me|Now I|用户希望|我需要|让我)\s*/i, '')
                .slice(0, 240);
            if (normalized.length < 40) continue;
            const count = (counts.get(normalized) || 0) + 1;
            if (count >= 5) return { detected: true, count };
            counts.set(normalized, count);
        }

        const intentLoopCount = (recent.match(/The user wants me to|I need to check|Let me check|用户希望我|我需要检查|让我检查/gi) || []).length;
        if (intentLoopCount >= 5) return { detected: true, count: intentLoopCount };

        return { detected: false, count: 0 };
    }

    buildSelfCheckInstruction(mode: AgentMode, reason: string, finalText: string): ChatMessage {
        return {
            role: 'system',
            content: `[${mode === 'infinite' ? 'Infinite' : 'Auto'} completion gate]
The previous assistant response looked like a final answer, but the completion gate kept the task open: ${reason}.

Previous final draft:
${finalText.slice(0, 1600)}

Continue the task now. Do not repeat the final draft. Use tools if needed to inspect files, validate changes, or close the missing evidence. Keep user-visible progress concise and in the user's language. Avoid "Let me..." narration; state only the concrete next action. Only produce a final answer after the user requirements, file evidence, and validation status are clear.`,
        } as any;
    }

    private findMostRepeatedSubstring(text: string): { pattern: string; count: number; length: number } | null {
        let bestPattern = '';
        let bestCount = 0;

        for (let patLen = 15; patLen <= 60; patLen += 5) {
            if (text.length < patLen * 4) break;
            const sampleCount = Math.min(5, Math.floor(text.length / patLen));
            for (let s = 0; s < sampleCount; s++) {
                const endPos = text.length - s * patLen;
                const pattern = text.slice(endPos - patLen, endPos);
                if (/^[\s\-.:,;!?]+$/.test(pattern)) continue;

                let count = 0;
                let pos = 0;
                while ((pos = text.indexOf(pattern, pos)) !== -1) {
                    count++;
                    pos += patLen;
                }

                if (count > bestCount) {
                    bestCount = count;
                    bestPattern = pattern;
                }
            }
        }

        return bestPattern ? { pattern: bestPattern, count: bestCount, length: bestPattern.length } : null;
    }
}
