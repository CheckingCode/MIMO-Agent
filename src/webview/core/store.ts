/**
 * Centralized state store for the MiMo webview.
 * Components read/write state through get/set and subscribe to changes via on/off.
 */

export interface ImageData {
    dataUrl: string;
    name: string;
    size: number;
}

export interface InputHistoryItem {
    text: string;
    images: ImageData[] | null;
}

export interface Tab {
    id: string;
    title: string;
    active: boolean;
}

export interface HistoryEntry {
    id: string;
    title: string;
    timestamp: string;
    messageCount: number;
}

export type ModelOption = string | {
    value: string;
    label?: string;
    model?: string;
    endpointId?: string;
    endpointName?: string;
};

export interface StoreState {
    // UI state
    isBusy: boolean;
    statusText: string;
    tabs: Tab[];
    activeTabId: string;

    // Model
    models: ModelOption[];
    currentModel: string;
    modelCaps: { vision: boolean; tts: boolean; description: string };
    reasoningEffort: 'turbo' | 'fast' | 'balanced' | 'deep' | 'max';

    // Mode
    currentMode: 'auto' | 'polling' | 'plan' | 'adversarial' | 'infinite';

    // Streaming
    streamingMsg: HTMLElement | null;
    rawHtml: string;
    lastUserMsg: { text: string; images: ImageData[] | null } | null;
    currentTurnStartedAt: number;
    planExecutionActive: boolean;

    // Images
    images: ImageData[];
    visionEnabled: boolean;

    // Input history
    inputHistory: InputHistoryItem[];
    historyIdx: number;

    // Panels
    historyItems: HistoryEntry[];
    settingsData: Record<string, any>;

    // Queued messages
    queuedMsgs: Array<{ text: string; images: ImageData[] | null }>;
    skipNextQueueAutoSend: boolean;

    // Token usage
    tokenUsage: { prompt: number; completion: number; total: number; calls: number };

    // Voice
    voiceEnabled: boolean;
    isRecording: boolean;

    // Conversation title
    convTitle: string;
}

type Handler = (...args: any[]) => void;

class Store {
    private state: StoreState = {
        isBusy: false,
        statusText: '',
        tabs: [],
        activeTabId: '',
        models: [],
        currentModel: '',
        modelCaps: { vision: false, tts: false, description: '' },
        reasoningEffort: 'balanced',
        currentMode: 'auto',
        streamingMsg: null,
        rawHtml: '',
        lastUserMsg: null,
        currentTurnStartedAt: 0,
        planExecutionActive: false,
        images: [],
        visionEnabled: true,
        inputHistory: [],
        historyIdx: -1,
        historyItems: [],
        settingsData: {},
        queuedMsgs: [],
        skipNextQueueAutoSend: false,
        tokenUsage: { prompt: 0, completion: 0, total: 0, calls: 0 },
        voiceEnabled: false,
        isRecording: false,
        convTitle: '',
    };

    private listeners = new Map<string, Set<Handler>>();

    get<K extends keyof StoreState>(key: K): StoreState[K] {
        return this.state[key];
    }

    set<K extends keyof StoreState>(key: K, value: StoreState[K]): void {
        this.state[key] = value;
        this.emit(`change:${key}`, value);
    }

    /** Get a snapshot of the entire state */
    snapshot(): Readonly<StoreState> {
        return { ...this.state };
    }

    on(event: string, handler: Handler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
    }

    off(event: string, handler: Handler): void {
        this.listeners.get(event)?.delete(handler);
    }

    emit(event: string, ...args: any[]): void {
        this.listeners.get(event)?.forEach((fn) => fn(...args));
    }
}

export const store = new Store();
