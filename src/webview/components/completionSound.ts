/**
 * Short synthesized completion chime for live task completion.
 * Uses Web Audio so the extension does not need to ship media files.
 */
import { store } from '../core/store';
import { bus } from '../core/bus';

let audioCtx: AudioContext | undefined;
let lastPlayedAt = 0;
let lastPreviewAt = 0;
let unlockTried = false;

function completionSoundEnabled(): boolean {
    const settings = store.get('settingsData') || {};
    return settings.ui_completion_sound !== false;
}

function normalizeVolume(value: unknown, fallback = 70): number {
    const raw = Number(value ?? fallback);
    if (!Number.isFinite(raw)) return fallback / 100;
    return Math.max(0, Math.min(100, raw)) / 100;
}

function completionSoundVolume(): number {
    const settings = store.get('settingsData') || {};
    return normalizeVolume(settings.ui_completion_sound_volume);
}

function tone(ctx: AudioContext, start: number, frequency: number, duration: number, gainValue: number): void {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
}

function getAudioContext(): AudioContext | undefined {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return undefined;
    audioCtx = audioCtx || new AudioCtor();
    return audioCtx;
}

async function unlockAudio(): Promise<void> {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') await ctx.resume();
        unlockTried = true;
    } catch {
        unlockTried = true;
    }
}

async function playCompletionSound(options?: { preview?: boolean; volume?: number; force?: boolean }): Promise<void> {
    if (!options?.preview && !completionSoundEnabled()) return;
    const now = Date.now();
    if (options?.preview) {
        if (!options.force && now - lastPreviewAt < 380) return;
        lastPreviewAt = now;
    } else {
        if (now - lastPlayedAt < 1200) return;
        lastPlayedAt = now;
    }

    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') await ctx.resume();
        if (ctx.state !== 'running') return;
        const volume = options?.volume !== undefined ? normalizeVolume(options.volume) : completionSoundVolume();
        if (volume <= 0) return;
        const start = ctx.currentTime + 0.02;
        tone(ctx, start, 659.25, 0.15, 0.18 * volume);
        tone(ctx, start + 0.11, 880, 0.22, 0.15 * volume);
    } catch {
        // Some webview hosts may block audio until a user gesture; ignore quietly.
    }
}

export const CompletionSound = {
    mount(): void {
        const prime = () => {
            if (unlockTried && audioCtx?.state === 'running') return;
            void unlockAudio();
        };
        document.addEventListener('pointerdown', prime, { capture: true });
        document.addEventListener('keydown', prime, { capture: true });
        document.addEventListener('touchstart', prime, { capture: true });
        bus.on('liveDone', () => {
            void playCompletionSound();
        });
        bus.on('previewCompletionSound', (volume?: number, force?: boolean) => {
            void playCompletionSound({ preview: true, volume, force });
        });
    },
};
