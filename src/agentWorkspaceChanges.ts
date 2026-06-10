import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { TaskChangeFile, TaskChangeSummary } from './agentTypes';

export class AgentWorkspaceChanges {
    constructor(private readonly getWorkspace: () => string) {}

    async getWorkspaceChangeSummary(): Promise<TaskChangeSummary | null> {
        try {
            await this.execGit(['rev-parse', '--is-inside-work-tree'], 256 * 1024);
            const trackedPatch = await this.execGit(['diff', '--binary', '--', '.']);
            const numstat = await this.execGit(['diff', '--numstat', '--', '.'], 1024 * 1024);
            const stagedPatch = await this.execGit(['diff', '--cached', '--binary', '--', '.']);
            const stagedNumstat = await this.execGit(['diff', '--cached', '--numstat', '--', '.'], 1024 * 1024);
            const unstagedFiles = this.parseGitNumstat(numstat);
            const stagedFiles = this.parseGitNumstat(stagedNumstat).map(file => ({ ...file, staged: true }));
            let files = this.mergeTaskChangeFiles([...unstagedFiles, ...stagedFiles]);
            const existingPaths = new Set(files.map(file => file.path));
            const untracked = await this.getUntrackedChangeSummary(existingPaths);
            files = this.mergeTaskChangeFiles([...files, ...untracked.files]);
            const patch = [trackedPatch.trimEnd(), stagedPatch.trimEnd(), untracked.patch.trimEnd()]
                .filter(Boolean)
                .join('\n');
            if (files.length === 0) return null;
            const hasStaged = stagedFiles.length > 0;
            const warnings = [
                hasStaged ? '检测到暂存区改动；Diff 会展示 staged 内容，但无法安全自动撤销暂存状态，请按需手动处理。' : '',
                untracked.warning || '',
            ].filter(Boolean).join('\n');
            return {
                id: `changes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                files,
                totalAdded: files.reduce((sum, file) => sum + file.added, 0),
                totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
                patch,
                createdAt: Date.now(),
                canUndo: hasStaged || untracked.warning ? false : undefined,
                warning: warnings || undefined,
            };
        } catch {
            return null;
        }
    }

    async undoWorkspaceChanges(patch: string): Promise<{ ok: boolean; error?: string }> {
        try {
            if (!patch || patch.length > 8 * 1024 * 1024) {
                return { ok: false, error: 'No reversible patch is available.' };
            }
            await this.applyGitPatch(['apply', '--check', '-R', '--whitespace=nowarn'], patch);
            await this.applyGitPatch(['apply', '-R', '--whitespace=nowarn'], patch);
            return { ok: true };
        } catch (e: any) {
            return { ok: false, error: String(e?.message || e).slice(0, 400) };
        }
    }

    private execGit(args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', args, {
                cwd: this.getWorkspace(),
                windowsHide: true,
                maxBuffer,
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error((stderr || error.message || '').trim()));
                    return;
                }
                resolve(stdout || '');
            });
        });
    }

    private applyGitPatch(args: string[], patch: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, {
                cwd: this.getWorkspace(),
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stderr = '';
            child.stderr.on('data', chunk => { stderr += String(chunk); });
            child.on('error', reject);
            child.on('close', code => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with ${code}`));
                }
            });
            child.stdin.write(patch);
            child.stdin.end();
        });
    }

    private parseGitNumstat(numstat: string): TaskChangeFile[] {
        return numstat
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const parts = line.split('\t');
                const addedRaw = parts[0] || '0';
                const removedRaw = parts[1] || '0';
                const filePath = parts.slice(2).join('\t') || '(unknown)';
                const binary = addedRaw === '-' || removedRaw === '-';
                return {
                    path: filePath,
                    added: binary ? 0 : (parseInt(addedRaw, 10) || 0),
                    removed: binary ? 0 : (parseInt(removedRaw, 10) || 0),
                    binary,
                };
            });
    }

    private mergeTaskChangeFiles(files: TaskChangeFile[]): TaskChangeFile[] {
        const map = new Map<string, TaskChangeFile>();
        for (const file of files) {
            const existing = map.get(file.path);
            if (!existing) {
                map.set(file.path, { ...file });
                continue;
            }
            existing.added += file.added || 0;
            existing.removed += file.removed || 0;
            existing.binary = existing.binary || file.binary;
            existing.staged = existing.staged || file.staged;
        }
        return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
    }

    private isTextBufferForPatch(buffer: Buffer): boolean {
        if (buffer.length === 0) return true;
        const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
        let nul = 0;
        for (const byte of sample) {
            if (byte === 0) nul++;
        }
        return nul <= sample.length * 0.05;
    }

    private escapeGitPathForPatch(filePath: string): string {
        return filePath.replace(/\\/g, '/').replace(/\t/g, ' ');
    }

    private buildUntrackedFilePatch(filePath: string, content: string): string {
        const safePath = this.escapeGitPathForPatch(filePath);
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalized.length ? normalized.split('\n') : [''];
        const addLines = lines.map(line => `+${line}`).join('\n');
        const finalNewline = normalized.endsWith('\n') ? '' : '\n\\ No newline at end of file';
        return [
            `diff --git a/${safePath} b/${safePath}`,
            'new file mode 100644',
            'index 0000000..0000000',
            '--- /dev/null',
            `+++ b/${safePath}`,
            `@@ -0,0 +1,${lines.length} @@`,
            addLines + finalNewline,
        ].join('\n') + '\n';
    }

    private async getUntrackedChangeSummary(existingPaths: Set<string>): Promise<{ files: TaskChangeFile[]; patch: string; warning?: string }> {
        const output = await this.execGit(['ls-files', '--others', '--exclude-standard', '--', '.'], 1024 * 1024);
        const untracked = output
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .filter(file => !existingPaths.has(file));
        const files: TaskChangeFile[] = [];
        const patches: string[] = [];
        let skipped = 0;

        for (const file of untracked) {
            const fullPath = path.resolve(this.getWorkspace(), file);
            let buffer: Buffer;
            try {
                const stat = fs.statSync(fullPath);
                if (!stat.isFile()) continue;
                buffer = fs.readFileSync(fullPath);
            } catch {
                continue;
            }

            if (buffer.length > 512 * 1024 || !this.isTextBufferForPatch(buffer)) {
                skipped++;
                files.push({ path: file, added: 0, removed: 0, binary: true });
                continue;
            }

            const content = buffer.toString('utf8');
            const lineCount = content.length ? content.split(/\r\n|\r|\n/).length : 0;
            files.push({ path: file, added: lineCount, removed: 0, binary: false });
            patches.push(this.buildUntrackedFilePatch(file, content));
        }

        return {
            files,
            patch: patches.join('\n'),
            warning: skipped > 0 ? `${skipped} 个未跟踪的大文件或二进制文件已列入列表，但无法生成可安全撤销的文本 patch。` : undefined,
        };
    }
}
