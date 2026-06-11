import * as vscode from 'vscode';

function sanitizeBaseName(title: string): string {
    return (title || 'MiMo Preview')
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim() || 'MiMo Preview';
}

function extensionForLanguage(language: string): string {
    if (language === 'diff') return '.diff';
    if (language === 'markdown') return '.md';
    return '.txt';
}

function normalizePreferredName(preferredName: string | undefined, fallbackTitle: string, language: string): string {
    const fallback = `${sanitizeBaseName(fallbackTitle)}${extensionForLanguage(language)}`;
    if (!preferredName) return fallback;

    const raw = preferredName.replace(/^.*[\\/]/, '');
    const safe = sanitizeBaseName(raw);
    if (!safe) return fallback;
    if (language === 'svg' || language === 'xml') {
        const base = safe.replace(/\.[^.]+$/, '');
        return `${base || sanitizeBaseName(fallbackTitle)}.xml`;
    }
    if (/\.[A-Za-z0-9_-]+$/.test(safe)) return safe;
    return `${safe}${extensionForLanguage(language)}`;
}

export class ReadonlyPreviewProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'mimo-preview';

    private readonly docs = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this._onDidChange.event;

    createUri(title: string, content: string, language = 'plaintext', preferredName?: string): vscode.Uri {
        const safeBase = normalizePreferredName(preferredName, title, language).replace(/\.[^.]+$/, '');
        const ext = normalizePreferredName(preferredName, title, language).match(/(\.[^.]+)$/)?.[1] || extensionForLanguage(language);
        const uri = vscode.Uri.from({
            scheme: ReadonlyPreviewProvider.scheme,
            path: `/${safeBase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
        });
        this.docs.set(uri.toString(), content);
        this._onDidChange.fire(uri);
        return uri;
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.docs.get(uri.toString()) || '';
    }

    delete(uri: vscode.Uri): void {
        this.docs.delete(uri.toString());
    }
}
