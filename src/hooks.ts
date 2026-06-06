/**
 * Hooks System — Pre/Post tool-use hooks
 *
 * Allows users to run custom shell commands before and after tool calls.
 * Use cases: linting, formatting, security checks, logging, guardrails.
 *
 * Configuration in ~/.mimo/settings.json:
 * {
 *   "hooks": {
 *     "pre_tool": [
 *       { "name": "check", "tools": ["write_file"], "command": "echo 'about to write ${tool_path}'", "enabled": true }
 *     ],
 *     "post_tool": [
 *       { "name": "lint", "tools": ["write_file", "edit_file"], "command": "eslint ${tool_path} 2>&1 || true", "enabled": true }
 *     ]
 *   }
 * }
 *
 * Supported variables in commands:
 *   ${tool_name}   — Name of the tool being called
 *   ${tool_path}   — 'path' argument if present
 *   ${tool_result} — Tool result (post_tool only)
 *   ${workspace}   — Workspace root path
 */

import { exec } from 'child_process';

// ── Types ──

export interface HookConfig {
    name: string;
    tools: string[];        // Tool names to match, ['*'] = all
    command: string;        // Shell command with ${var} placeholders
    enabled: boolean;
    timeout?: number;       // Timeout in seconds (default 10)
}

export interface PreHookResult {
    proceed: boolean;       // Whether to proceed with the tool call
    output: string;         // Combined output from all hooks
}

export interface PostHookResult {
    output: string;         // Combined output from all hooks
    shouldBlock: boolean;   // Whether to block the result (return error to agent)
}

// ── HookManager ──

export class HookManager {
    private preHooks: HookConfig[];
    private postHooks: HookConfig[];

    constructor(settings: Record<string, any>) {
        const hooks = settings?.hooks || {};
        this.preHooks = (hooks.pre_tool || []).filter((h: HookConfig) => h.enabled);
        this.postHooks = (hooks.post_tool || []).filter((h: HookConfig) => h.enabled);
    }

    /**
     * Run pre-tool hooks. Returns whether to proceed.
     */
    async runPreHooks(
        toolName: string,
        args: Record<string, any>,
        workspace: string,
    ): Promise<PreHookResult> {
        const matching = this.preHooks.filter(h => this.matchesTool(h, toolName));
        if (matching.length === 0) return { proceed: true, output: '' };

        const outputs: string[] = [];
        for (const hook of matching) {
            const cmd = this.interpolate(hook.command, toolName, args, workspace, '');
            const timeout = (hook.timeout ?? 10) * 1000;

            try {
                const result = await this.execCommand(cmd, timeout, workspace);
                if (result.stdout.trim()) {
                    outputs.push(`[${hook.name}] ${result.stdout.trim()}`);
                }
                // If hook exits with non-zero, block the tool call
                if (result.code !== 0) {
                    return {
                        proceed: false,
                        output: outputs.join('\n') + `\n[Hook "${hook.name}" blocked tool call (exit ${result.code})]`,
                    };
                }
            } catch (e: any) {
                outputs.push(`[${hook.name}] Error: ${e.message}`);
            }
        }

        return { proceed: true, output: outputs.join('\n') };
    }

    /**
     * Run post-tool hooks. Returns whether to block the result.
     */
    async runPostHooks(
        toolName: string,
        args: Record<string, any>,
        result: string,
        workspace: string,
    ): Promise<PostHookResult> {
        const matching = this.postHooks.filter(h => this.matchesTool(h, toolName));
        if (matching.length === 0) return { output: '', shouldBlock: false };

        const outputs: string[] = [];
        for (const hook of matching) {
            const cmd = this.interpolate(hook.command, toolName, args, workspace, result);
            const timeout = (hook.timeout ?? 10) * 1000;

            try {
                const execResult = await this.execCommand(cmd, timeout, workspace);
                if (execResult.stdout.trim()) {
                    outputs.push(`[${hook.name}] ${execResult.stdout.trim()}`);
                }
                if (execResult.code !== 0) {
                    return {
                        output: outputs.join('\n'),
                        shouldBlock: true,
                    };
                }
            } catch (e: any) {
                outputs.push(`[${hook.name}] Error: ${e.message}`);
            }
        }

        return { output: outputs.join('\n'), shouldBlock: false };
    }

    /**
     * Check if a hook matches a tool name.
     */
    private matchesTool(hook: HookConfig, toolName: string): boolean {
        return hook.tools.includes('*') || hook.tools.includes(toolName);
    }

    /**
     * Interpolate variables in a command string.
     */
    private interpolate(
        cmd: string,
        toolName: string,
        args: Record<string, any>,
        workspace: string,
        result: string,
    ): string {
        const toolPath = args.path || args.source || args.destination || '';
        // Escape shell metacharacters in interpolated values to prevent injection
        // Platform-aware: backslash on bash, backtick on PowerShell
        const esc = (s: string) => {
            const cleaned = s.replace(/\x00/g, '').replace(/[\r\n]+/g, ' ');
            if (process.platform === 'win32') {
                return cleaned.replace(/[`"$\\]/g, '`$&');
            }
            return cleaned.replace(/["$`\\]/g, '\\$&');
        };
        return cmd
            .replace(/\$\{tool_name\}/g, esc(toolName))
            .replace(/\$\{tool_path\}/g, esc(String(toolPath)))
            .replace(/\$\{tool_result\}/g, esc(result.substring(0, 500)))
            .replace(/\$\{workspace\}/g, esc(workspace));
    }

    /**
     * Execute a shell command.
     */
    private execCommand(cmd: string, timeout: number, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
        return new Promise((resolve) => {
            // exec() with { shell } already wraps the command in `shell -c cmd`,
            // so we pass cmd directly without adding -c again
            const shell = process.platform === 'win32' ? 'powershell' : 'bash';

            const proc = exec(
                cmd,
                { shell, cwd, timeout, windowsHide: true },
                (error, stdout, stderr) => {
                    const exitCode = error
                        ? (typeof (error as any).code === 'number' ? (error as any).code : 1)
                        : 0;
                    resolve({
                        stdout: stdout || '',
                        stderr: stderr || '',
                        code: exitCode,
                    });
                },
            );
        });
    }

    /**
     * Check if any hooks are configured.
     */
    hasHooks(): boolean {
        return this.preHooks.length > 0 || this.postHooks.length > 0;
    }
}
