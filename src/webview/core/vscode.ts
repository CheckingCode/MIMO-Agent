/**
 * Wrapper around acquireVsCodeApi() for type-safe message posting.
 */

declare function acquireVsCodeApi(): {
    postMessage(msg: any): void;
    setState(state: any): void;
    getState(): any;
};

const api = acquireVsCodeApi();

export const vscode = {
    post(msg: any): void {
        api.postMessage(msg);
    },

    // ── Convenience methods ──

    ready(): void {
        api.postMessage({ type: 'ready' });
    },

    newChat(): void {
        api.postMessage({ type: 'newChat' });
    },

    switchChat(id: string): void {
        api.postMessage({ type: 'switchChat', id });
    },

    closeChat(id: string): void {
        api.postMessage({ type: 'closeChat', id });
    },

    send(text: string, images?: any[] | null): void {
        api.postMessage({ type: 'send', text, images: images || null });
    },

    stop(): void {
        api.postMessage({ type: 'stop' });
    },

    clear(): void {
        api.postMessage({ type: 'clear' });
    },

    skill(skill: string, text: string): void {
        api.postMessage({ type: 'skill', skill, text });
    },

    setModel(model: string): void {
        api.postMessage({ type: 'setModel', model });
    },

    setMode(mode: string): void {
        api.postMessage({ type: 'setMode', mode });
    },

    system(text: string): void {
        api.postMessage({ type: 'system', text });
    },

    historyList(): void {
        api.postMessage({ type: 'historyList' });
    },

    historyLoad(id: string): void {
        api.postMessage({ type: 'historyLoad', id });
    },

    historyDelete(id: string): void {
        api.postMessage({ type: 'historyDelete', id });
    },

    historySearch(query: string): void {
        api.postMessage({ type: 'historySearch', query });
    },

    exportMarkdown(id: string): void {
        api.postMessage({ type: 'exportMarkdown', id });
    },

    exportJson(id: string): void {
        api.postMessage({ type: 'exportJson', id });
    },

    exportAllJson(): void {
        api.postMessage({ type: 'exportAllJson' });
    },

    openFile(path: string, line?: number): void {
        api.postMessage({ type: 'openFile', path, line });
    },

    openFileBeside(path: string): void {
        api.postMessage({ type: 'openFile', path, beside: true });
    },

    getSettings(): void {
        api.postMessage({ type: 'getSettings' });
    },

    saveSettings(settings: Record<string, any>): void {
        api.postMessage({ type: 'saveSettings', settings });
    },

    skillList(): void {
        api.postMessage({ type: 'skillList' });
    },

    skillSave(skill: { name: string; description: string; tools?: string[]; prompt: string }): void {
        api.postMessage({ type: 'skillSave', skill });
    },

    skillDelete(name: string): void {
        api.postMessage({ type: 'skillDelete', name });
    },

    editConfirm(previewId: string): void {
        api.postMessage({ type: 'editConfirm', previewId });
    },

    editReject(previewId: string): void {
        api.postMessage({ type: 'editReject', previewId });
    },

    writeConfirm(previewId: string, newPath?: string): void {
        api.postMessage({ type: 'writeConfirm', previewId, newPath });
    },

    writeReject(previewId: string): void {
        api.postMessage({ type: 'writeReject', previewId });
    },

    askUserConfirm(previewId: string, answer: string): void {
        api.postMessage({ type: 'askUserConfirm', previewId, answer });
    },

    voiceInput(): void {
        api.postMessage({ type: 'voiceInput' });
    },

    voiceStop(): void {
        api.postMessage({ type: 'voiceStop' });
    },
};
