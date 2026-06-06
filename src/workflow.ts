/**
 * Workflow Engine — Multi-agent parallel/sequential orchestration
 *
 * Enables the AI to spawn multiple sub-agents that work concurrently,
 * similar to Claude Code's Workflow system.
 *
 * Supports:
 * - parallel: multiple tasks run simultaneously (Promise.all)
 * - sequential: tasks run one after another
 * - multi-phase: pipeline of phases, each with its own mode
 * - progress events for real-time UI updates
 */

import { MiMoAPI, ChatMessage, ToolCall, ToolDefinition } from './api';
import { TOOL_DEFINITIONS, executeTool } from './tools';
import { buildSystemPrompt } from './prompt';
import { manageContext } from './context';
import { McpManager } from './mcp';
import { SandboxConfig } from './sandbox';

// ── Types ──

export interface WorkflowTask {
    task: string;
    type: 'explore' | 'general';
    model?: string;
    label?: string;
}

export interface WorkflowPhase {
    title: string;
    tasks: WorkflowTask[];
    mode: 'parallel' | 'sequential';
}

export interface WorkflowResult {
    phases: PhaseResult[];
    totalToolCalls: number;
    totalRounds: number;
    elapsed: number;
}

export interface PhaseResult {
    title: string;
    mode: 'parallel' | 'sequential';
    results: TaskResult[];
    elapsed: number;
}

export interface TaskResult {
    task: string;
    label: string;
    output: string;
    toolCalls: number;
    rounds: number;
    elapsed: number;
    error?: string;
}

export interface WorkflowEvents {
    onWorkflowStart?: (totalPhases: number, totalTasks: number) => void;
    onWorkflowPhaseStart?: (phaseIndex: number, title: string, mode: string, taskCount: number) => void;
    onWorkflowTaskStart?: (phaseIndex: number, taskIndex: number, label: string) => void;
    onWorkflowTaskEnd?: (phaseIndex: number, taskIndex: number, result: TaskResult) => void;
    onWorkflowPhaseEnd?: (phaseIndex: number, result: PhaseResult) => void;
    onWorkflowEnd?: (result: WorkflowResult) => void;
    onStatus?: (status: string) => void;
    onReasoning?: (text: string) => void;
}

// ── Tool filters (same as subagent) ──

const EXPLORE_TOOLS = new Set([
    'read_file', 'search_files', 'glob_files', 'list_directory',
    'get_file_info', 'git_status', 'git_diff', 'git_log',
]);

const GENERAL_EXCLUDED = new Set(['spawn_subagent', 'run_workflow']);

function filterTools(type: 'explore' | 'general', allTools: ToolDefinition[]): ToolDefinition[] {
    if (type === 'explore') {
        return allTools.filter(t => EXPLORE_TOOLS.has(t.function.name));
    }
    return allTools.filter(t => !GENERAL_EXCLUDED.has(t.function.name));
}

// ── Single task executor ──

async function executeTask(
    task: WorkflowTask,
    taskIndex: number,
    api: MiMoAPI,
    workspace: string,
    mcpManager: McpManager,
    config: {
        maxTokens: number;
        temperature: number;
        topP: number;
        maxOutputLen: number;
        commandTimeout: number;
        sandbox?: SandboxConfig;
        enableThinking: boolean;
    },
    signal?: AbortSignal,
    previousContext?: string,
): Promise<TaskResult> {
    const t0 = Date.now();
    const model = task.model || 'mimo-v2.5-pro';
    const maxRounds = 20; // Cap per-task to prevent runaway
    const label = task.label || task.task.substring(0, 40);

    const typeHint = task.type === 'explore'
        ? `You are an Explore sub-agent — the eyes and ears of the main agent.
Your Mission: Find and report information. You are READ-ONLY — never modify files.

Search Strategy:
1. Start broad (glob for structure), then narrow (grep for specifics)
2. When you find something relevant, read the surrounding context (±20 lines)
3. If the first search doesn't find it, try different patterns/keywords
4. Always report: file path, line numbers, and the actual code snippet

Output Format:
### Findings
- **[Topic]**: [file:line] — [what you found]
### Relevant Context
[Key code snippets or configuration]
### Gaps
[What you couldn't find or needs further investigation]`
        : `You are a General sub-agent — a focused executor.
Your Mission: Complete your assigned task efficiently and precisely.

Working Style:
1. Understand the task fully before acting
2. Make minimal, targeted changes
3. Verify your changes work (syntax check, test if available)
4. Report exactly what you did and any issues encountered

Output Format:
### Result
[What was accomplished]
### Changes Made
- [file]: [what changed]
### Issues (if any)
[What went wrong and what was tried]`;

    const systemPrompt = `${typeHint}

Workspace: ${workspace}
Task: You are working on a specific sub-task within a larger workflow. Complete it and return your findings/result.

Rules:
- Be concise and focused on your task
- Use tools efficiently — don't read unnecessary files
- Return your final answer as clear text when done
- Do NOT ask questions — make reasonable assumptions and proceed`;

    const allTools = [...TOOL_DEFINITIONS, ...mcpManager.getAllToolDefinitions()];
    const tools = filterTools(task.type, allTools);

    const messages: ChatMessage[] = [];

    // Inject previous task context for sequential workflows
    if (previousContext) {
        messages.push({
            role: 'system',
            content: `[Previous task result]\n${previousContext.substring(0, 2000)}`,
        });
    }

    messages.push({ role: 'user', content: task.task });

    let totalToolCalls = 0;
    let rounds = 0;

    for (rounds = 1; rounds <= maxRounds; rounds++) {
        if (signal?.aborted) {
            return {
                task: task.task, label, output: '(aborted)',
                toolCalls: totalToolCalls, rounds, elapsed: Date.now() - t0,
            };
        }

        const managed = manageContext(messages, model);

        const params: Record<string, any> = {
            model,
            messages: [
                { role: 'system' as const, content: systemPrompt },
                ...managed,
            ],
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            top_p: config.topP,
        };
        if (tools.length > 0) {
            params.tools = tools;
            params.tool_choice = 'auto';
        }
        if (!config.enableThinking) {
            params.extra_body = { thinking: { type: 'disabled' } };
        }

        let content: string;
        let toolCalls: ToolCall[];
        try {
            const result = await api.chatCompletionsStream(params, {
                onToken: () => {},
                onReasoning: () => {},
            }, signal);
            content = result.content;
            toolCalls = result.toolCalls;
        } catch (e: any) {
            if (signal?.aborted) {
                return {
                    task: task.task, label, output: '(aborted)',
                    toolCalls: totalToolCalls, rounds, elapsed: Date.now() - t0,
                };
            }
            return {
                task: task.task, label, output: `API error: ${e.message}`,
                toolCalls: totalToolCalls, rounds, elapsed: Date.now() - t0, error: e.message,
            };
        }

        if (toolCalls.length === 0) {
            return {
                task: task.task, label,
                output: content || '(no output)',
                toolCalls: totalToolCalls, rounds, elapsed: Date.now() - t0,
            };
        }

        // Execute tool calls
        const assistantMsg: ChatMessage = {
            role: 'assistant', content: content || null as any,
            tool_calls: toolCalls, reasoning_content: '',
        };
        messages.push(assistantMsg);

        for (const tc of toolCalls) {
            if (signal?.aborted) break;

            let args: Record<string, any> = {};
            try { args = JSON.parse(tc.function.arguments); } catch { /* empty */ }

            const toolResult = mcpManager.isMcpTool(tc.function.name)
                ? await mcpManager.callTool(tc.function.name, args)
                : await executeTool(
                    tc.function.name, args, workspace,
                    config.maxOutputLen, config.commandTimeout, config.sandbox,
                );

            messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
            totalToolCalls++;
        }
    }

    // Max rounds reached
    const lastMsg = messages.filter(m => m.role === 'assistant').pop();
    const lastContent = typeof lastMsg?.content === 'string' ? lastMsg.content : '(max rounds reached)';
    return {
        task: task.task, label, output: lastContent,
        toolCalls: totalToolCalls, rounds, elapsed: Date.now() - t0,
    };
}

// ── Workflow Executor ──

export async function executeWorkflow(
    phases: WorkflowPhase[],
    api: MiMoAPI,
    workspace: string,
    mcpManager: McpManager,
    config: {
        maxTokens: number;
        temperature: number;
        topP: number;
        maxOutputLen: number;
        commandTimeout: number;
        sandbox?: SandboxConfig;
        enableThinking: boolean;
    },
    events: WorkflowEvents = {},
    signal?: AbortSignal,
): Promise<WorkflowResult> {
    const t0 = Date.now();
    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

    events.onWorkflowStart?.(phases.length, totalTasks);
    events.onReasoning?.(`[Workflow] Starting ${phases.length} phases, ${totalTasks} total tasks`);

    const phaseResults: PhaseResult[] = [];
    let totalToolCalls = 0;
    let totalRounds = 0;

    let phaseSummary: string | undefined;

    for (let pi = 0; pi < phases.length; pi++) {
        if (signal?.aborted) break;

        const phase = phases[pi];
        events.onWorkflowPhaseStart?.(pi, phase.title, phase.mode, phase.tasks.length);
        events.onStatus?.(`[Workflow] Phase ${pi + 1}/${phases.length}: ${phase.title} (${phase.mode})`);
        events.onReasoning?.(`[Phase ${pi + 1}] "${phase.title}" — ${phase.tasks.length} tasks, ${phase.mode}`);

        const phaseT0 = Date.now();
        const taskResults: TaskResult[] = [];

        if (phase.mode === 'parallel') {
            // ── Parallel: all tasks run simultaneously ──
            events.onReasoning?.(`[Phase ${pi + 1}] Running ${phase.tasks.length} tasks in parallel...`);

            const promises = phase.tasks.map((task, ti) => {
                events.onWorkflowTaskStart?.(pi, ti, task.label || task.task.substring(0, 40));
                return executeTask(task, ti, api, workspace, mcpManager, config, signal, phaseSummary)
                    .then(result => {
                        events.onWorkflowTaskEnd?.(pi, ti, result);
                        return result;
                    })
                    .catch(e => {
                        const errResult: TaskResult = {
                            task: task.task,
                            label: task.label || task.task.substring(0, 40),
                            output: `Error: ${e.message}`,
                            toolCalls: 0, rounds: 0,
                            elapsed: 0, error: e.message,
                        };
                        events.onWorkflowTaskEnd?.(pi, ti, errResult);
                        return errResult;
                    });
            });

            const results = await Promise.all(promises);
            taskResults.push(...results);

        } else {
            // ── Sequential: tasks run one after another with result chaining ──
            let previousOutput: string | undefined = phaseSummary;
            for (let ti = 0; ti < phase.tasks.length; ti++) {
                if (signal?.aborted) break;

                const task = phase.tasks[ti];
                events.onWorkflowTaskStart?.(pi, ti, task.label || task.task.substring(0, 40));
                events.onStatus?.(`[Workflow] Phase ${pi + 1}, Task ${ti + 1}/${phase.tasks.length}: ${task.label || task.task.substring(0, 30)}`);

                const result = await executeTask(task, ti, api, workspace, mcpManager, config, signal, previousOutput);
                taskResults.push(result);
                events.onWorkflowTaskEnd?.(pi, ti, result);

                // Chain result as context for next sequential task
                previousOutput = result.output;
                if (ti < phase.tasks.length - 1) {
                    events.onReasoning?.(`[Phase ${pi + 1}] Task ${ti + 1} done (${result.toolCalls} tools, ${(result.elapsed / 1000).toFixed(1)}s). Feeding result to next task...`);
                }
            }
        }

        const phaseResult: PhaseResult = {
            title: phase.title,
            mode: phase.mode,
            results: taskResults,
            elapsed: Date.now() - phaseT0,
        };
        phaseResults.push(phaseResult);

        // Aggregate stats
        for (const r of taskResults) {
            totalToolCalls += r.toolCalls;
            totalRounds += r.rounds;
        }

        events.onWorkflowPhaseEnd?.(pi, phaseResult);
        events.onReasoning?.(
            `[Phase ${pi + 1}] "${phase.title}" done — ${taskResults.length} tasks, ` +
            `${taskResults.reduce((s, r) => s + r.toolCalls, 0)} tool calls, ` +
            `${(phaseResult.elapsed / 1000).toFixed(1)}s`
        );

        // Feed phase summary as context for next phase
        if (pi < phases.length - 1) {
            phaseSummary = taskResults
                .map(r => `[${r.label}] ${r.output.substring(0, 200)}`)
                .join('\n');
            events.onReasoning?.(`[Workflow] Phase ${pi + 1} results summary fed to next phase`);
        }
    }

    const result: WorkflowResult = {
        phases: phaseResults,
        totalToolCalls,
        totalRounds,
        elapsed: Date.now() - t0,
    };

    events.onWorkflowEnd?.(result);
    events.onReasoning?.(
        `[Workflow] Complete — ${phases.length} phases, ${totalTasks} tasks, ` +
        `${totalToolCalls} tool calls, ${(result.elapsed / 1000).toFixed(1)}s`
    );

    return result;
}
