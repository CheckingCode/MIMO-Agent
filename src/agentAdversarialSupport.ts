import { AgentEvents, TrackedIssue } from './agentTypes';

export class AgentAdversarialSupport {
    summarizeToolCall(name: string, args: Record<string, any>, isError: boolean): string {
        const argKeys = Object.keys(args || {});
        const details = argKeys.length ? ` (${argKeys.slice(0, 4).join(', ')})` : '';
        return `${isError ? 'Tool error' : 'Tool used'}: ${name}${details}`;
    }

    emitAdversarialReport(
        rounds: Array<{ iteration: number; verdict: string; issueCount: number; elapsed: number }>,
        allIssues: TrackedIssue[],
        events: AgentEvents,
    ): void {
        if (rounds.length === 0) return;
        const totalElapsed = rounds[rounds.length - 1].elapsed;
        const resolvedIssues = allIssues.filter(i => i.resolved).length;
        const report = [
            '**Adversarial Report**',
            `Rounds: ${rounds.length}`,
            `Issues: ${allIssues.length}`,
            `Resolved: ${resolvedIssues}`,
            `Final verdict: ${rounds[rounds.length - 1].verdict}`,
            `Elapsed: ${(totalElapsed / 1000).toFixed(1)}s`,
        ].join('\n');
        events.onReasoning(report);
    }

    extractIssues(reviewText: string, dimension: string, round: number, startId: number): { issues: TrackedIssue[]; nextId: number } {
        const issues: TrackedIssue[] = [];
        let nextId = startId;
        const issueRegex = /ISSUE:\s*\[(?:severity:)?(critical|high|medium|low)\]\s*\[([^\]:]+?)(?::(\d+))?\]\s*(.+)/gi;
        let match: RegExpExecArray | null;
        while ((match = issueRegex.exec(reviewText)) !== null) {
            issues.push({
                id: `issue-${++nextId}`,
                severity: match[1].toLowerCase() as TrackedIssue['severity'],
                file: match[2].trim(),
                line: match[3] ? parseInt(match[3], 10) : undefined,
                description: match[4].trim(),
                dimension,
                round,
                resolved: false,
            });
        }
        return { issues, nextId };
    }

    shouldConverge(openIssues: TrackedIssue[], approved: boolean, iteration: number, maxIterations: number): boolean {
        if (approved && openIssues.length === 0) return true;
        return iteration >= maxIterations;
    }

    parseVerdict(review: string): { approved: boolean; issues: string[]; suggestions: string[]; verdictFound: boolean } {
        const approved = /\bAPPROVED\b/i.test(review);
        const rejected = /\bREJECTED\b|\bCHANGES REQUIRED\b/i.test(review);
        const issues = Array.from(review.matchAll(/ISSUE:\s*(.+)/gi)).map(m => m[1].trim());
        const suggestions = Array.from(review.matchAll(/SUGGESTION:\s*(.+)/gi)).map(m => m[1].trim());
        return { approved, issues, suggestions, verdictFound: approved || rejected };
    }

    buildAdversarialFeedback(issues: TrackedIssue[], pmReview: string, diffSnapshot: string): string {
        const openIssues = issues.filter(issue => !issue.resolved);
        const lines = [
            'Please address the remaining review findings.',
            openIssues.length ? `Open issues:\n${openIssues.map(i => `- ${i.id} [${i.severity}] ${i.description}`).join('\n')}` : 'No open issues were tracked.',
        ];
        if (pmReview.trim()) lines.push(`PM review:\n${pmReview.trim()}`);
        if (diffSnapshot.trim()) lines.push(`Diff snapshot:\n${diffSnapshot.trim().slice(0, 2000)}`);
        return lines.join('\n\n');
    }

    buildAdversarialFinalSummary(
        approved: boolean,
        iterations: number,
        allIssues: TrackedIssue[],
        exitReason: string,
    ): string {
        const resolved = allIssues.filter(issue => issue.resolved).length;
        return [
            approved ? 'Adversarial review approved.' : 'Adversarial review finished without full approval.',
            `Iterations: ${iterations}`,
            `Issues tracked: ${allIssues.length}`,
            `Resolved: ${resolved}`,
            `Exit reason: ${exitReason}`,
        ].join('\n');
    }

    reviewsAreSimilar(a: string, b: string): boolean {
        const cleanA = String(a || '').trim();
        const cleanB = String(b || '').trim();
        if (!cleanA || !cleanB) return false;
        if (cleanA === cleanB) return true;
        const shortA = cleanA.slice(0, 500);
        const shortB = cleanB.slice(0, 500);
        return shortA === shortB;
    }
}
