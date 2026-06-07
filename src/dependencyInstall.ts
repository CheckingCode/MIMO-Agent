export type DependencyInstallKind = 'none' | 'project-dependency' | 'system-dependency';

export type DependencyProjectMode = 'auto' | 'confirm' | 'disabled';
export type DependencySystemMode = 'confirm' | 'disabled';

export interface DependencyInstallConfig {
    enabled: boolean;
    projectMode: DependencyProjectMode;
    systemMode: DependencySystemMode;
    longTimeoutSec: number;
}

export interface DependencyInstallDecision {
    kind: DependencyInstallKind;
    allowed: boolean;
    needsConfirm: boolean;
    reason: string;
    timeoutSec: number;
}

const PROJECT_INSTALL_PATTERNS: RegExp[] = [
    /^\s*(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci)\b/i,
    /^\s*(?:python|python3|py)\s+-m\s+pip\s+install\b/i,
    /^\s*pip(?:3)?\s+install\b/i,
    /^\s*uv\s+(?:pip\s+)?install\b/i,
    /^\s*(?:poetry|pipenv)\s+install\b/i,
    /^\s*(?:poetry|pipenv)\s+add\b/i,
    /^\s*go\s+(?:mod\s+download|get)\b/i,
    /^\s*cargo\s+(?:fetch|install)\b/i,
    /^\s*composer\s+(?:install|require)\b/i,
    /^\s*dotnet\s+(?:restore|add\s+package)\b/i,
    /^\s*gem\s+install\b/i,
    /^\s*bundle\s+install\b/i,
];

const SYSTEM_INSTALL_PATTERNS: RegExp[] = [
    /^\s*(?:winget|choco|scoop)\s+install\b/i,
    /^\s*brew\s+install\b/i,
    /^\s*(?:apt|apt-get|dnf|yum|pacman|zypper)\s+(?:install|add)\b/i,
    /^\s*apk\s+add\b/i,
];

export function classifyDependencyInstall(command: string): DependencyInstallKind {
    const normalized = normalizeCommand(command);
    if (!normalized) return 'none';
    if (SYSTEM_INSTALL_PATTERNS.some(pattern => pattern.test(normalized))) {
        return 'system-dependency';
    }
    if (PROJECT_INSTALL_PATTERNS.some(pattern => pattern.test(normalized))) {
        return 'project-dependency';
    }
    return 'none';
}

export function dependencyInstallNeedsNetwork(kind: DependencyInstallKind): boolean {
    return kind === 'project-dependency' || kind === 'system-dependency';
}

export function decideDependencyInstall(
    command: string,
    baseTimeoutSec: number,
    config?: Partial<DependencyInstallConfig>,
): DependencyInstallDecision {
    const fullConfig: DependencyInstallConfig = {
        enabled: config?.enabled ?? true,
        projectMode: config?.projectMode || 'auto',
        systemMode: config?.systemMode || 'confirm',
        longTimeoutSec: Math.max(60, Math.min(3600, config?.longTimeoutSec ?? 600)),
    };
    const kind = classifyDependencyInstall(command);
    const timeoutSec = kind === 'none'
        ? baseTimeoutSec
        : Math.max(baseTimeoutSec, fullConfig.longTimeoutSec);

    if (kind === 'none') {
        return { kind, allowed: true, needsConfirm: false, reason: '', timeoutSec };
    }

    if (!fullConfig.enabled) {
        return {
            kind,
            allowed: false,
            needsConfirm: false,
            reason: 'Dependency installation is disabled by settings.',
            timeoutSec,
        };
    }

    if (kind === 'project-dependency') {
        if (fullConfig.projectMode === 'disabled') {
            return {
                kind,
                allowed: false,
                needsConfirm: false,
                reason: 'Project dependency installation is disabled by settings.',
                timeoutSec,
            };
        }
        return {
            kind,
            allowed: true,
            needsConfirm: fullConfig.projectMode === 'confirm',
            reason: fullConfig.projectMode === 'confirm'
                ? 'Project dependency installation requires confirmation by settings.'
                : 'Project dependency installation is allowed automatically.',
            timeoutSec,
        };
    }

    if (fullConfig.systemMode === 'disabled') {
        return {
            kind,
            allowed: false,
            needsConfirm: false,
            reason: 'System software installation is disabled by settings.',
            timeoutSec,
        };
    }

    return {
        kind,
        allowed: true,
        needsConfirm: true,
        reason: 'System software installation requires user confirmation.',
        timeoutSec,
    };
}

function normalizeCommand(command: string): string {
    let value = (command || '').trim();
    const prefixes = [
        'cmd /c ', 'cmd.exe /c ',
        'powershell -c ', 'powershell.exe -c ',
        'powershell -command ', 'powershell.exe -command ',
        'pwsh -c ', 'pwsh.exe -c ',
        'sudo ',
    ];
    let changed = true;
    while (changed) {
        changed = false;
        for (const prefix of prefixes) {
            if (value.toLowerCase().startsWith(prefix)) {
                value = value.slice(prefix.length).trim();
                changed = true;
                break;
            }
        }
    }
    const quoted = value.match(/^["'](.+)["']$/s);
    if (quoted) value = quoted[1].trim();
    return value;
}
