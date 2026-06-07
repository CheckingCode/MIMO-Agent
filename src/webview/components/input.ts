/**
 * Input component - textarea, send button, mode selector, model select.
 */
import { store } from '../core/store';
import { bus } from '../core/bus';
import { vscode } from '../core/vscode';
import { t } from '../core/i18n';

export const InputArea = {
    mount(): void {
        const input = document.getElementById('input') as HTMLTextAreaElement;
        const sendBtn = document.getElementById('send') as HTMLButtonElement;
        const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
        const voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
        const reasoningBtn = document.getElementById('reasoning-effort-btn') as HTMLButtonElement;

        if (voiceBtn) {
            voiceBtn.addEventListener('click', () => {
                if (store.get('isRecording')) {
                    store.set('isRecording', false);
                    voiceBtn.classList.remove('recording');
                    voiceBtn.title = t('voice.input.title');
                    vscode.voiceStop();
                } else {
                    store.set('isRecording', true);
                    voiceBtn.classList.add('recording');
                    voiceBtn.title = t('voice.input.title');
                    vscode.voiceInput();
                }
            });
        }

        sendBtn.addEventListener('click', () => {
            const inputEl = document.getElementById('input') as HTMLTextAreaElement;
            const hasText = inputEl && inputEl.value.trim().length > 0;
            if (store.get('isBusy') && !hasText) {
                vscode.stop();
            } else {
                this.doSend();
            }
        });

        let draftText = '';

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                if (document.getElementById('cmd-palette')?.classList.contains('show')) return;
                e.preventDefault();
                this.doSend();
                return;
            }

            if (e.key === 'ArrowUp' && !e.shiftKey && !e.isComposing) {
                const history = store.get('inputHistory');
                let idx = store.get('historyIdx');

                const lines = input.value.substring(0, input.selectionStart).split('\n');
                const atFirstLine = lines.length <= 1;
                const atLineStart = lines[lines.length - 1].length === 0 || input.selectionStart === 0;

                if (idx === -1 && history.length > 0) {
                    if (!atFirstLine || !atLineStart) return;
                    e.preventDefault();
                    draftText = input.value;
                    idx = 0;
                    store.set('historyIdx', idx);
                    input.value = history[idx];
                    this.autoResize(input);
                    input.setSelectionRange(input.value.length, input.value.length);
                } else if (idx >= 0 && idx < history.length - 1) {
                    if (!atFirstLine || !atLineStart) return;
                    e.preventDefault();
                    idx++;
                    store.set('historyIdx', idx);
                    input.value = history[idx];
                    this.autoResize(input);
                    input.setSelectionRange(input.value.length, input.value.length);
                }
                return;
            }

            if (e.key === 'ArrowDown' && !e.shiftKey && !e.isComposing) {
                const history = store.get('inputHistory');
                let idx = store.get('historyIdx');

                if (idx >= 0) {
                    const lines = input.value.substring(input.selectionStart).split('\n');
                    const atLastLine = lines.length <= 1;
                    const atLineEnd = input.selectionStart >= input.value.length;
                    if (!atLastLine || !atLineEnd) return;

                    e.preventDefault();
                    idx--;
                    store.set('historyIdx', idx);
                    if (idx >= 0) {
                        input.value = history[idx];
                    } else {
                        input.value = draftText;
                        draftText = '';
                    }
                    this.autoResize(input);
                    input.setSelectionRange(input.value.length, input.value.length);
                }
                return;
            }
        });

        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            bus.emit('inputChanged', input.value);
            if (store.get('isBusy')) this.updateSendButton();
        });

        const modeTrigger = document.getElementById('mode-trigger')!;
        const modePopup = document.getElementById('mode-popup')!;
        const modeLabel = document.getElementById('mode-label')!;
        const getModeLabel = (mode: string): string => t(mode);

        input.placeholder = t('paste.hint');

        modeTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            modePopup.classList.toggle('show');
        });

        const modeOptions = modePopup.querySelectorAll('.mode-option');
        for (let i = 0; i < modeOptions.length; i++) {
            modeOptions[i].addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = (e.currentTarget as HTMLElement).getAttribute('data-mode') as string;
                store.set('currentMode', mode as any);
                for (let j = 0; j < modeOptions.length; j++) modeOptions[j].classList.remove('active');
                (e.currentTarget as HTMLElement).classList.add('active');
                modeLabel.textContent = getModeLabel(mode);
                modePopup.classList.remove('show');
                document.getElementById('input-wrapper')!.className = `mode-${mode}`;
                document.body.className = `mode-${mode}`;
                vscode.setMode(mode);
            });
        }

        modelSelect.addEventListener('change', () => {
            vscode.setModel(modelSelect.value);
        });

        if (reasoningBtn) {
            reasoningBtn.addEventListener('click', () => {
                const current = store.get('reasoningEffort');
                const order = ['turbo', 'fast', 'balanced', 'deep', 'max'] as const;
                const idx = order.indexOf(current as any);
                const next = order[((idx >= 0 ? idx : 2) + 1) % order.length];
                store.set('reasoningEffort', next);
                this.updateReasoningButton();
                vscode.setReasoningEffort(next);
            });
        }

        bus.on('modelList', (models: string[], current: string) => {
            modelSelect.innerHTML = '';
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (m === current) opt.selected = true;
                modelSelect.appendChild(opt);
            }
        });

        bus.on('settingsData', (settings: Record<string, any>) => {
            const effort = this.normalizeReasoningEffort(settings.reasoning_effort, settings.enable_thinking);
            store.set('reasoningEffort', effort);
            this.updateReasoningButton();
        });

        bus.on('langChanged', () => {
            this.updateReasoningButton();
        });

        if (voiceBtn) {
            voiceBtn.style.display = 'none';
            store.set('voiceEnabled', false);
        }

        bus.on('restoreMode', (mode: string) => {
            const label = document.getElementById('mode-label');
            if (label) {
                label.textContent = t(mode);
                label.setAttribute('data-i18n', mode);
            }
            document.getElementById('input-wrapper')!.className = `mode-${mode}`;
            document.body.className = `mode-${mode}`;
            const opts = document.querySelectorAll('.mode-option');
            for (let i = 0; i < opts.length; i++) {
                opts[i].classList.remove('active');
                if ((opts[i] as HTMLElement).getAttribute('data-mode') === mode) {
                    opts[i].classList.add('active');
                }
            }
        });

        bus.on('busy', () => this.setBusy(true));
        bus.on('idle', () => {
            this.setBusy(false);
            const queued = store.get('queuedMsgs');
            if (queued.length > 0) {
                const next = queued[0];
                store.set('queuedMsgs', queued.slice(1));
                vscode.send(next.text, next.images);
            }
        });
        bus.on('clearQueue', () => {
            store.set('queuedMsgs', []);
        });
        bus.on('editQueuedMessage', (text: string, images: any[] | null) => {
            input.value = text || '';
            this.autoResize(input);
            store.set('images', images || []);
            bus.emit('imagesChanged');
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            this.updateSendButton();
        });
        this.updateReasoningButton();
        vscode.getSettings();
    },

    normalizeReasoningEffort(value: unknown, enableThinking?: unknown): 'turbo' | 'fast' | 'balanced' | 'deep' | 'max' {
        if (value === 'turbo' || value === 'fast' || value === 'balanced' || value === 'deep' || value === 'max') return value;
        if (value === 'off' || value === 'low') return 'fast';
        if (value === 'auto' || value === 'medium') return 'balanced';
        if (value === 'high') return 'deep';
        return enableThinking ? 'deep' : 'balanced';
    },

    updateReasoningButton(): void {
        const btn = document.getElementById('reasoning-effort-btn') as HTMLButtonElement | null;
        if (!btn) return;
        const effort = store.get('reasoningEffort');
        const labels: Record<string, string> = {
            turbo: t('reasoning.turbo'),
            fast: t('reasoning.fast'),
            balanced: t('reasoning.balanced'),
            deep: t('reasoning.deep'),
            max: t('reasoning.max'),
        };
        const titles: Record<string, string> = {
            turbo: t('reasoning.turbo.tip'),
            fast: t('reasoning.fast.tip'),
            balanced: t('reasoning.balanced.tip'),
            deep: t('reasoning.deep.tip'),
            max: t('reasoning.max.tip'),
        };
        btn.textContent = `${t('reasoning.prefix')}: ${labels[effort]}`;
        btn.setAttribute('data-effort', effort);
        btn.title = titles[effort];
    },

    doSend(): void {
        const input = document.getElementById('input') as HTMLTextAreaElement;
        const text = input.value.trim();
        const images = store.get('images');
        if (!text && images.length === 0) return;

        this.saveToHistory(text);
        const imgs = images.slice();
        input.value = '';
        input.style.height = 'auto';
        store.set('historyIdx', -1);
        store.set('images', []);
        bus.emit('clearImages');

        if (text.charAt(0) === '/') {
            const sp = text.indexOf(' ');
            const cmd = sp > 0 ? text.substring(1, sp) : text.substring(1);
            const rest = sp > 0 ? text.substring(sp + 1) : '';
            if (cmd === 'clear') {
                bus.emit('clearMessages');
                vscode.clear();
                return;
            }
            vscode.skill(cmd, rest);
            return;
        }

        if (store.get('isBusy')) {
            const queued = store.get('queuedMsgs');
            store.set('queuedMsgs', [...queued, { text, images: imgs.length > 0 ? imgs : null }]);
            bus.emit('messageQueued', text, queued.length + 1);
            return;
        }

        vscode.send(text, imgs.length > 0 ? imgs : null);
    },

    saveToHistory(text: string): void {
        if (!text) return;
        const history = store.get('inputHistory');
        if (text === history[0]) return;
        history.unshift(text);
        if (history.length > 50) history.pop();
        store.set('inputHistory', history);
        store.set('historyIdx', -1);
    },

    autoResize(textarea: HTMLTextAreaElement): void {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    },

    setBusy(busy: boolean): void {
        store.set('isBusy', busy);
        this.updateSendButton();
        const statusBar = document.getElementById('status-bar')!;
        if (busy) statusBar.classList.add('active');
        else statusBar.classList.remove('active');
    },

    updateSendButton(): void {
        const sendBtn = document.getElementById('send') as HTMLButtonElement;
        const input = document.getElementById('input') as HTMLTextAreaElement;
        const busy = store.get('isBusy');
        const hasText = input && input.value.trim().length > 0;

        if (busy && !hasText) {
            sendBtn.textContent = '';
            sendBtn.className = 'stop-btn';
            sendBtn.title = t('stop');
        } else {
            sendBtn.textContent = '▶';
            sendBtn.className = '';
            sendBtn.title = busy ? t('send.queued') : t('send');
        }
    },
};
