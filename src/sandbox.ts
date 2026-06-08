/**
 * Sandbox — Multi-layer safety system for command execution.
 *
 * Strategy:
 *   Layer 1: Enhanced command safety checks (blocklist + pattern matching)
 *   Layer 2: Workspace path enforcement (file ops restricted to workspace)
 *   Layer 3: Git auto-snapshot before destructive operations (rollback capability)
 *   Layer 4: Process timeout + output truncation (resource limits)
 *   Layer 5: Command execution logging (audit trail)
 *
 * Docker sandbox is kept as an optional advanced feature for users who have it.
 * The default "safe mode" uses layers 1-5 without requiring Docker.
 */

import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Types ──

export interface SandboxConfig {
    /** Enable Docker sandbox (optional, falls back to safe mode) */
    enabled: boolean;
    /** Sandbox mode: safe = local restricted execution, docker = container isolation */
    mode: 'safe' | 'docker';
    /** Docker image */
    image: string;
    /** Memory limit */
    memoryLimit: string;
    /** CPU limit */
    cpuLimit: number;
    /** Timeout in seconds */
    timeoutSec: number;
    /** Enable git auto-snapshot before destructive ops (default: false; opt-in only) */
    gitSnapshot: boolean;
    /** Enable command logging (default: true) */
    logging: boolean;
    /** Block common network commands in local safe mode (default: true) */
    networkDisabled: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
    enabled: false,
    mode: 'safe',
    image: 'node:20-alpine',
    memoryLimit: '512m',
    cpuLimit: 1,
    timeoutSec: 120,
    gitSnapshot: false,
    logging: true,
    networkDisabled: true,
};

// ── Layer 3: Git Auto-Snapshot ──

/**
 * Auto-commit current changes before a destructive operation.
 * Creates a safety net so changes can be rolled back.
 * Returns the commit hash, or null if git is unavailable.
 */
export async function gitAutoSnapshot(workspace: string, reason: string): Promise<string | null> {
    try {
        // Check if git is available and workspace is a git repo
        await execPromise('git rev-parse --is-inside-work-tree', 5, workspace);

        // Check if there are any changes to commit
        const status = await execPromise('git status --porcelain', 5, workspace);
        if (!status.stdout.trim()) return null; // Nothing to commit

        // Stage all changes
        await execPromise('git add -A', 10, workspace);

        // Commit with descriptive message (escape shell metacharacters, platform-aware)
        const cleanedReason = reason.replace(/\x00/g, '').replace(/[\r\n]+/g, ' ');
        const safeReason = process.platform === 'win32'
            ? cleanedReason.replace(/[`"$\\]/g, '`$&')
            : cleanedReason.replace(/["`$\\]/g, '\\$&');
        const msg = `[MiMo] Auto-snapshot: ${safeReason}`;
        await execPromise(`git commit -m "${msg}" --no-verify`, 10, workspace);

        // Get commit hash
        const hash = await execPromise('git rev-parse --short HEAD', 5, workspace);
        const commitHash = hash.stdout.trim();
        console.log(`[MiMo] Git auto-snapshot: ${commitHash} — ${reason}`);
        return commitHash;
    } catch {
        // Git unavailable or no changes — not an error
        return null;
    }
}

/**
 * Rollback to the last auto-snapshot.
 * Only works if the latest commit is a MiMo auto-snapshot.
 */
export async function gitRollback(workspace: string): Promise<{ success: boolean; message: string }> {
    try {
        // Check if latest commit is a MiMo auto-snapshot
        const log = await execPromise('git log -1 --oneline', 5, workspace);
        if (!log.stdout.includes('[MiMo] Auto-snapshot')) {
            return { success: false, message: 'Latest commit is not a MiMo auto-snapshot' };
        }

        // Soft reset to undo the commit but keep changes
        await execPromise('git reset HEAD~1', 5, workspace);
        return { success: true, message: 'Rolled back to previous state' };
    } catch (e: any) {
        return { success: false, message: `Rollback failed: ${e.message}` };
    }
}

// ── Layer 5: Command Logging ──

const LOG_DIR = path.join(os.tmpdir(), 'mimo-logs');
let logInitialized = false;

function initLogDir(): void {
    if (logInitialized) return;
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        logInitialized = true;
    } catch { /* ignore */ }
}

export function logCommand(command: string, workspace: string, result: { code: number; output: string }): void {
    if (!logInitialized) initLogDir();
    try {
        const date = new Date().toISOString().slice(0, 10);
        const logFile = path.join(LOG_DIR, `commands-${date}.log`);
        const entry = [
            `[${new Date().toISOString()}]`,
            `workspace: ${workspace}`,
            `command: ${command}`,
            `exit_code: ${result.code}`,
            `output_length: ${result.output.length}`,
            '',
        ].join('\n');
        fs.appendFileSync(logFile, entry, 'utf-8');
    } catch { /* ignore log errors */ }
}

// ── Docker Sandbox (optional, Layer 2+) ──

let dockerAvailable: boolean | null = null;

/**
 * Check if Docker daemon is actually running (not just installed).
 * Uses `docker info` and verifies exit code === 0.
 */
export async function isDockerAvailable(): Promise<boolean> {
    if (dockerAvailable !== null) return dockerAvailable;
    try {
        const result = await execPromise('docker info', 10);
        dockerAvailable = result.code === 0;
        return dockerAvailable;
    } catch {
        dockerAvailable = false;
        return false;
    }
}

/**
 * Reset Docker availability cache so next call re-checks.
 * Useful when Docker is started/stopped during a session.
 */
export function resetDockerCache(): void {
    dockerAvailable = null;
}

function toDockerPath(hostPath: string): string {
    if (process.platform !== 'win32') return hostPath;
    const normalized = hostPath.replace(/\\/g, '/');
    const match = normalized.match(/^([a-zA-Z]):\/(.*)/);
    if (match) return `/${match[1].toLowerCase()}/${match[2]}`;
    return normalized;
}

export async function sandboxExec(
    command: string,
    workspace: string,
    config: SandboxConfig,
    maxOutput: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
    const dockerPath = toDockerPath(workspace);

    return new Promise((resolve, reject) => {
        const proc = require('child_process').spawn('docker', [
            'run', '--rm',
            '--network=none',                           // 禁止网络访问
            `--memory=${config.memoryLimit}`,           // 内存限制
            `--cpus=${String(config.cpuLimit)}`,        // CPU 限制
            '--cap-drop', 'ALL',                        // 丢弃所有 Linux capabilities
            '--security-opt', 'no-new-privileges',      // 禁止提升权限
            '--pids-limit', '64',                       // 限制进程数，防止 fork bomb
            '--read-only',                              // 只读容器文件系统
            '--tmpfs', '/tmp:size=64m',                 // 可写的 /tmp
            '-v', `${dockerPath}:/workspace`,           // 工作区读写挂载
            '-w', '/workspace',
            '--user', '1000:1000',                      // 非 root 用户
            config.image,
            'sh', '-c', command,
        ], {
            timeout: config.timeoutSec * 1000,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
        proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

        proc.on('close', (code: number) => {
            if (stdout.length > maxOutput) stdout = stdout.slice(0, maxOutput) + '\n... (truncated)';
            if (stderr.length > maxOutput) stderr = stderr.slice(0, maxOutput) + '\n... (truncated)';
            resolve({ stdout, stderr, code: code ?? 0 });
        });

        proc.on('error', (e: Error) => {
            reject(new Error(`Docker unavailable: ${e.message}`));
        });
    });
}

export function formatSandboxResult(result: { stdout: string; stderr: string; code: number }): string {
    let output = result.stdout.trim();
    if (result.stderr?.trim()) output += `\n[stderr] ${result.stderr.trim()}`;
    if (!output) output = '(no output)';
    if (result.code !== 0) output += `\n[exit code: ${result.code}]`;
    return output;
}

// ── Safe Mode Execution (Docker-free) ──

/**
 * Execute a command in "safe mode" — no Docker, but with:
 * - Pre-execution safety re-check (prevent bypass)
 * - Process timeout
 * - Output truncation
 * - Git auto-snapshot before destructive commands
 * - Command logging
 */
export async function safeModeExec(
    command: string,
    workspace: string,
    timeoutSec: number,
    maxOutput: number,
    config: SandboxConfig,
): Promise<{ stdout: string; stderr: string; code: number; timedOut?: boolean }> {
    const timeoutMs = timeoutSec * 1000;

    // Layer 1: Pre-execution safety re-check (prevent bypass via indirect calls)
    const { isCommandSafe } = require('./safety');
    const safety = isCommandSafe(command, workspace);
    if (safety.blocked) {
        return { stdout: '', stderr: `Blocked: ${safety.reason}`, code: 1 };
    }
    if (config.networkDisabled && isNetworkCommand(command)) {
        return { stdout: '', stderr: 'Blocked: network commands are disabled in Safe Mode', code: 1 };
    }

    // Layer 3: Git auto-snapshot before destructive operations
    if (config.gitSnapshot && isDestructiveCommand(command)) {
        await gitAutoSnapshot(workspace, `Before destructive command: ${command.substring(0, 80)}`);
    }

    // Layer 4: Execute with timeout
    const result = await execPromise(command, timeoutSec, workspace, timeoutMs);

    // Truncate output
    let stdout = result.stdout;
    let stderr = result.stderr;
    if (stdout.length > maxOutput) stdout = stdout.slice(0, maxOutput) + '\n... (truncated)';
    if (stderr.length > maxOutput) stderr = stderr.slice(0, maxOutput) + '\n... (truncated)';

    // Layer 5: Log command
    if (config.logging) {
        logCommand(command, workspace, {
            code: result.code,
            output: stdout + stderr,
        });
    }

    return { stdout, stderr, code: result.code, timedOut: result.timedOut };
}

/**
 * Check if a command is destructive (triggers git auto-snapshot).
 * Uses case-insensitive matching and proper redirect detection.
 */
function isDestructiveCommand(command: string): boolean {
    const destructive = [
        /\brm\b/i,
        /\bdel\b/i,
        /\brmdir\b/i,
        /\bRemove-Item\b/i,
        /\bmv\b/i,
        /\bmove\b/i,
        /\brename\b/i,
        /\btee\b/i,
        /[^=!]>[^>]/,         // single > (redirect/overwrite), but not >= or >>
        />>/,                  // append redirect
        /\bcp\b/i,
        /\bcopy\b/i,
        /\bxcopy\b/i,
        /\brobocopy\b/i,
    ];
    return destructive.some(p => p.test(command));
}

// ── Helper ──

function isNetworkCommand(command: string): boolean {
    return /\b(curl|wget|aria2c|ssh|scp|sftp|ftp|telnet|nc|ncat|netcat|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(command);
}

function execPromise(
    cmd: string,
    timeoutSec: number,
    cwd?: string,
    timeoutMs?: number,
): Promise<{ stdout: string; stderr: string; code: number; timedOut?: boolean }> {
    return new Promise((resolve, reject) => {
        const shell = process.platform === 'win32' ? 'powershell' : 'bash';
        const proc = require('child_process').exec(cmd, {
            shell,
            timeout: timeoutMs || timeoutSec * 1000,
            windowsHide: true,
            cwd,
            maxBuffer: 10 * 1024 * 1024, // 10MB
        }, (err: any, stdout: string, stderr: string) => {
            if (err) {
                // Still resolve with the output — don't reject on non-zero exit
                const timedOut = err.killed === true && err.signal === 'SIGTERM';
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || err.message || '',
                    code: err.code || 1,
                    timedOut,
                });
            } else {
                resolve({ stdout, stderr, code: 0 });
            }
        });
    });
}
