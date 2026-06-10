import { ChatMessage } from './api';

export async function preprocessInputImpl(
    this: any,
    rawInput: string
): Promise<string> {
        // Skip preprocessing for very short or slash commands
        if (rawInput.length < 5 || rawInput.startsWith('/')) return rawInput;

        const preprocessPrompt = `You are a prompt optimizer. The user's input may contain typos, unclear logic, or incomplete instructions.
Your job: rewrite it into a clear, structured, actionable prompt for a coding assistant.

Rules:
1. Fix typos and grammar (保持原始语言，不要翻译)
2. If the intent is ambiguous, rewrite with the MOST LIKELY interpretation
3. If a technical term is misspelled, correct it (e.g., "reacr" → "React")
4. If the request is vague ("fix this"), add the most likely specifics based on context
5. If the request contains multiple steps, structure them clearly
6. If the request references something not specified, add a placeholder like "[请指定具体文件]"
7. NEVER change the user's intent — only clarify it
8. If the input is already clear and well-structured, return it unchanged
9. Output ONLY the optimized prompt, nothing else

User input:
${rawInput}`;

        try {
            const result = await this.api.chatCompletionsStream({
                model: this.config.model,
                messages: [
                    { role: 'system' as const, content: preprocessPrompt },
                    { role: 'user' as const, content: rawInput },
                ],
                max_tokens: 500,
                temperature: 0.3,
            }, {});

            const optimized = result.content.trim();
            // Only use if it's meaningfully different (can be shorter if more concise)
            if (optimized && optimized.length > rawInput.length * 0.5 && optimized !== rawInput) {
                return optimized;
            }
            return rawInput;
        } catch {
            return rawInput; // Fallback to original on error
        }
}
