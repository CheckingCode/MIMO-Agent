export function stripInternalHandoffNoise(text: string): string {
    return (text || '')
        .replace(/\bStatus:\s*status\)\s*=>\s*h;?\s*\{[\s\S]*?(?=\n[A-Z][A-Za-z ]+:|\nNext action:|$)/g, '')
        .replace(/\bexecute_command\s*->[\s\S]*?(?=\n[A-Z][A-Za-z ]+:|\nNext action:|$)/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<code>[\s\S]*?<\/code>/g, '')
        .replace(/\bexport\s+type\s+\w+[\s\S]*?(?=\n[A-Z][A-Za-z ]+:|\nNext action:|$)/g, '')
        .replace(/\binterface\s+\w+\s*\{[\s\S]*?\}/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function buildUserFacingHandoff(reason: string, goal: string, completedToolCalls: number, changedFiles: string[], validationSeen: boolean): string {
    const lines = [
        'MiMo stopped before it could produce a clean final answer.',
        `Reason: ${reason}.`,
        `Request: ${goal.slice(0, 220)}`,
        `Tool calls completed: ${completedToolCalls}.`,
    ];
    if (changedFiles.length > 0) {
        lines.push(`Likely changed files: ${changedFiles.slice(0, 6).join(', ')}.`);
    }
    lines.push(validationSeen ? 'Validation: evidence of validation was seen.' : 'Validation: not confirmed yet.');
    lines.push('Next step: continue the same request; MiMo should inspect the latest files, verify, and then summarize only the user-visible result.');
    return lines.join('\n');
}
