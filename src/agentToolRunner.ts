import { ToolCall } from './api';
import { ConversationState } from './agentTypes';

export type ReadFileRange = { path: string; start: number; end: number; limit: number };

export class AgentToolRunner {
    isToolResultError(result: string): boolean {
        return result.startsWith('Safety:')
            || result.startsWith('Tool error:')
            || result.startsWith('Unknown tool')
            || result.startsWith('Blocked by')
            || result.startsWith('MCP tool error')
            || result.startsWith('MCP error:')
            || result === '(aborted)';
    }

    isNoProgressToolResult(result: string): boolean {
        return /^Skipped (?:duplicate|repeated) read-only tool call\b/i.test(result || '');
    }

    isProgressTool(toolName: string, result: string): boolean {
        if (this.isToolResultError(result)) return false;
        if (this.isNoProgressToolResult(result)) return false;
        return [
            'edit_file',
            'write_file',
            'delete_file',
            'schedule_tasks',
            'update_todos',
            'execute_command',
            'git_commit',
            'run_workflow',
            'spawn_subagent',
        ].includes(toolName);
    }

    parseToolArgs(toolCall: ToolCall): Record<string, any> {
        try {
            const parsed = JSON.parse(toolCall.function.arguments || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    normalizeCommandForIntent(command: string): string {
        return String(command || '')
            .replace(/`/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    isReadOnlyExecuteCommand(args: Record<string, any>): boolean {
        const command = this.normalizeCommandForIntent(args.command || '');
        if (!command || !/\bgit\b/.test(command)) return false;

        const mutatingGit = /\bgit\b[\s\S]{0,120}\b(add|commit|push|pull|fetch|merge|rebase|checkout|switch|restore|reset|clean|stash|tag|branch|remote\s+(?:add|set-url|remove|rename|prune)|submodule\s+(?:update|add|sync))\b/i;
        if (mutatingGit.test(command)) return false;

        return /\bgit\b[\s\S]{0,120}\b(status|log|diff|show|remote\s+-v|rev-parse|branch(?:\s+--show-current)?|ls-files)\b/i.test(command);
    }

    isProgressToolCall(toolCall: ToolCall, result: string): boolean {
        if (!this.isProgressTool(toolCall.function.name, result)) return false;
        if (toolCall.function.name !== 'execute_command') return true;
        return !this.isReadOnlyExecuteCommand(this.parseToolArgs(toolCall));
    }

    normalizeReadFilePath(filePath: string): string {
        return String(filePath || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
    }

    getReadFileRange(args: Record<string, any>): ReadFileRange | null {
        const filePath = this.normalizeReadFilePath(args.path || args.file || '');
        if (!filePath) return null;
        const rawOffset = Number(args.offset ?? 0);
        const rawLimit = Number(args.limit ?? 500);
        const start = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);
        const limit = Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 500);
        return { path: filePath, start, end: start + limit, limit };
    }

    collectReadFileRangesThisTurn(conv: ConversationState, isStateChangingTool: (toolName: string) => boolean): Map<string, Array<{ start: number; end: number }>> {
        const ranges = new Map<string, Array<{ start: number; end: number }>>();
        let currentUserIndex = -1;
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            if (conv.messages[i].role === 'user') {
                currentUserIndex = i;
                break;
            }
        }
        if (currentUserIndex < 0) return ranges;

        const endIndex = conv.messages.length - 1;
        for (let i = currentUserIndex + 1; i < endIndex; i++) {
            const msg = conv.messages[i];
            if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
            for (const tc of msg.tool_calls) {
                if (isStateChangingTool(tc.function.name)) {
                    ranges.clear();
                    continue;
                }
                if (tc.function.name !== 'read_file') continue;
                const range = this.getReadFileRange(this.parseToolArgs(tc));
                if (!range) continue;
                const list = ranges.get(range.path) || [];
                list.push({ start: range.start, end: range.end });
                ranges.set(range.path, list);
            }
        }
        return ranges;
    }

    shouldSkipOverlappingReadFile(
        args: Record<string, any>,
        readRanges: Map<string, Array<{ start: number; end: number }>>,
    ): string | null {
        const range = this.getReadFileRange(args);
        if (!range) return null;
        const prior = readRanges.get(range.path) || [];
        if (prior.length === 0) {
            readRanges.set(range.path, [{ start: range.start, end: range.end }]);
            return null;
        }

        const requested = range.end - range.start;
        const covered = this.readRangeCoveredLength(prior, range.start, range.end);
        const overlapRatio = requested > 0 ? covered / requested : 0;
        if (covered >= requested || overlapRatio >= 0.72) {
            const gap = this.firstUnreadReadRange(prior, range.start, range.end);
            const shownStart = range.start + 1;
            const shownEnd = range.end;
            const gapHint = gap
                ? ` If more context is needed, read only the uncovered gap with offset=${gap.start}, limit=${Math.max(1, gap.end - gap.start)}.`
                : ' Use the earlier read_file result instead of rereading this range.';
            return `Skipped overlapping read_file range for ${args.path || range.path} [L${shownStart}-${shownEnd}]; ${Math.round(overlapRatio * 100)}% was already read in this user turn.${gapHint}`;
        }

        prior.push({ start: range.start, end: range.end });
        readRanges.set(range.path, prior);
        return null;
    }

    describeToolAction(name: string, args: Record<string, any>): string {
        const pathArg = args.path || args.filePath || args.directory || args.dir || args.cwd;
        switch (name) {
            case 'read_file': {
                const offset = Number(args.offset ?? 0);
                const limit = Number(args.limit ?? 500);
                const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) + 1 : 1;
                const end = Number.isFinite(limit) ? start + Math.max(1, Math.floor(limit)) - 1 : '...';
                return `read ${pathArg || 'file'} [L${start}-${end}]`;
            }
            case 'write_file':
                return `write ${pathArg || 'file'}`;
            case 'edit_file':
                return `edit ${pathArg || 'file'}`;
            case 'list_directory':
                return `list ${pathArg || 'directory'}`;
            case 'search_files':
                return `search "${args.pattern || args.query || ''}"`;
            case 'glob_files':
                return `glob ${args.pattern || ''}`;
            case 'execute_command': {
                const command = String(args.command || '').replace(/\s+/g, ' ').trim();
                return `run command ${command.slice(0, 90)}${command.length > 90 ? '...' : ''}`;
            }
            case 'schedule_tasks': {
                const tasks = Array.isArray(args.tasks) ? args.tasks : [];
                return `schedule ${tasks.length} tasks`;
            }
            case 'update_todos': {
                const todos = Array.isArray(args.todos) ? args.todos : [];
                const done = todos.filter((item: any) => /completed|done/i.test(String(item?.status || ''))).length;
                return `update todos ${done}/${todos.length}`;
            }
            case 'git_status':
                return 'check git status';
            case 'git_diff':
                return 'check git diff';
            case 'git_log':
                return 'check git log';
            case 'fetch_url':
                return `fetch ${args.url || 'url'}`;
            case 'web_search':
                return `web search "${args.query || ''}"`;
            case 'spawn_subagent':
                return 'spawn sub-agent';
            case 'run_workflow':
                return 'run workflow';
            default:
                return `call ${name}`;
        }
    }

    describeToolOutcome(name: string, args: Record<string, any>, result: string, elapsed: number, extractText: (value: any) => string): string {
        const action = this.describeToolAction(name, args);
        const seconds = `${elapsed.toFixed(1)}s`;
        if (this.isToolResultError(result)) {
            const firstLine = extractText(result).split(/\r?\n/).find(Boolean) || 'tool returned an error';
            return `[Tool result] ${action} failed (${seconds}): ${firstLine.slice(0, 160)}`;
        }
        if (this.isNoProgressToolResult(result)) {
            return `[Tool result] ${action} skipped: duplicate or no-progress call.`;
        }
        const text = extractText(result);
        const lineCount = text ? text.split(/\r?\n/).length : 0;
        const sizeHint = text.length > 0
            ? `returned about ${lineCount} lines / ${text.length} chars`
            : 'returned no body';
        return `[Tool result] ${action} completed (${seconds}), ${sizeHint}.`;
    }

    describeToolPlan(
        round: number,
        tasks: Array<{ tc: ToolCall; args: Record<string, any>; parallel: boolean }>,
        skippedCount: number,
    ): string {
        const preview = tasks
            .slice(0, 5)
            .map(task => this.describeToolAction(task.tc.function.name, task.args))
            .join('; ');
        const more = tasks.length > 5 ? `; ${tasks.length - 5} more actions` : '';
        const skipped = skippedCount > 0 ? ` Skipped ${skippedCount} duplicate read-only calls.` : '';
        return `[Tool plan] Round ${round} will execute ${tasks.length} actions: ${preview || 'no tool actions'}${more}.${skipped}`;
    }

    private mergeReadRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
        const sorted = ranges
            .filter(r => r.end > r.start)
            .sort((a, b) => a.start - b.start || a.end - b.end);
        const merged: Array<{ start: number; end: number }> = [];
        for (const range of sorted) {
            const last = merged[merged.length - 1];
            if (!last || range.start > last.end) {
                merged.push({ ...range });
            } else {
                last.end = Math.max(last.end, range.end);
            }
        }
        return merged;
    }

    private readRangeCoveredLength(ranges: Array<{ start: number; end: number }>, start: number, end: number): number {
        let covered = 0;
        for (const range of this.mergeReadRanges(ranges)) {
            const overlapStart = Math.max(start, range.start);
            const overlapEnd = Math.min(end, range.end);
            if (overlapEnd > overlapStart) covered += overlapEnd - overlapStart;
        }
        return covered;
    }

    private firstUnreadReadRange(ranges: Array<{ start: number; end: number }>, start: number, end: number): { start: number; end: number } | null {
        let cursor = start;
        for (const range of this.mergeReadRanges(ranges)) {
            if (range.end <= cursor) continue;
            if (range.start > cursor) return { start: cursor, end: Math.min(range.start, end) };
            cursor = Math.max(cursor, range.end);
            if (cursor >= end) return null;
        }
        return cursor < end ? { start: cursor, end } : null;
    }
}
