import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

function normalizeWorkspace(workspace: string): string {
    return path.resolve(workspace || process.cwd()).toLowerCase();
}

export function workspaceDataId(workspace: string): string {
    const normalized = normalizeWorkspace(workspace);
    const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
    const base = path.basename(normalized).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').slice(0, 40) || 'workspace';
    return `${base}-${hash}`;
}

export function workspaceDataDir(workspace: string): string {
    return path.join(os.homedir(), '.mimo', 'workspaces', workspaceDataId(workspace));
}

export function workspaceDataPath(workspace: string, ...segments: string[]): string {
    return path.join(workspaceDataDir(workspace), ...segments);
}

export function createWindowSessionId(): string {
    return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export function workspaceWindowDataDir(workspace: string, windowSessionId: string): string {
    const safeSession = (windowSessionId || 'default').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-');
    return workspaceDataPath(workspace, 'windows', safeSession);
}

export function workspaceWindowDataPath(workspace: string, windowSessionId: string, ...segments: string[]): string {
    return path.join(workspaceWindowDataDir(workspace, windowSessionId), ...segments);
}
