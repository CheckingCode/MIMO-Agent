/**
 * Event bus for component-to-component communication.
 * Decouples components — they emit/listen through the bus, not directly.
 */

type Handler = (...args: any[]) => void;

class EventBus {
    private listeners = new Map<string, Set<Handler>>();

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
        this.listeners.get(event)?.forEach((fn) => {
            try {
                fn(...args);
            } catch (e) {
                console.error(`[MiMo] bus handler error for "${event}":`, e);
            }
        });
    }

    /** Listen once, then auto-remove */
    once(event: string, handler: Handler): void {
        const wrapped = (...args: any[]) => {
            this.off(event, wrapped);
            handler(...args);
        };
        this.on(event, wrapped);
    }
}

export const bus = new EventBus();
