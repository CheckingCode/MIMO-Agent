/**
 * Input component — textarea, send button, mode selector, model select.
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

        // ── Voice button (extension host STT via PowerShell) ──
        if (voiceBtn) {
            voiceBtn.addEventListener('click', () => {
                if (store.get('isRecording')) {
                    // Stop recording
                    store.set('isRecording', false);
                    voiceBtn.classList.remove('recording');
                    voiceBtn.title = '🎤';
                    vscode.voiceStop();
                } else {
                    // Start recording
                    store.set('isRecording', true);
                    voiceBtn.classList.add('recording');
                    voiceBtn.title = 'Click to stop';
                    vscode.voiceInput();
                }
            });
        }

        // ── Send button ──
        sendBtn.addEventListener('click', () => {
            const input = document.getElementById('input') as HTMLTextAreaElement;
            const hasText = input && input.value.trim().length > 0;
            if (store.get('isBusy') && !hasText) {
                // No text → stop the agent
                vscode.stop();
            } else {
                // Has text (or not busy) → send/queue
                this.doSend();
            }
        });

        // ── Keyboard ──
        // Draft preservation: save current input when navigating to history
        let draftText = '';

        input.addEventListener('keydown', (e) => {
            // Command palette navigation
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                // Don't intercept if command palette is open (handled by CommandPalette)
                if (document.getElementById('cmd-palette')?.classList.contains('show')) return;
                e.preventDefault();
                this.doSend(); // doSend handles queueing if busy
                return;
            }

            if (e.key === 'ArrowUp' && !e.shiftKey && !e.isComposing) {
                const history = store.get('inputHistory');
                let idx = store.get('historyIdx');

                // Check if cursor is at line 1, position 0
                const lines = input.value.substring(0, input.selectionStart).split('\n');
                const atFirstLine = lines.length <= 1;
                const atLineStart = lines[lines.length - 1].length === 0 || input.selectionStart === 0;

                if (idx === -1 && history.length > 0) {
                    // Currently editing new text — save draft and go to history
                    if (!atFirstLine || !atLineStart) {
                        // Not at top of text: move cursor up one line
                        return; // Let default behavior handle it
                    }
                    // At top of text: enter history mode
                    e.preventDefault();
                    draftText = input.value;
                    idx = 0;
                    store.set('historyIdx', idx);
                    input.value = history[idx];
                    this.autoResize(input);
                    input.setSelectionRange(input.value.length, input.value.length);
                } else if (idx >= 0 && idx < history.length - 1) {
                    // In history mode: go to older entry
                    if (!atFirstLine || !atLineStart) {
                        return; // Let default behavior handle line movement
                    }
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
                    // Check if cursor is at last line, end position
                    const lines = input.value.substring(input.selectionStart).split('\n');
                    const atLastLine = lines.length <= 1;
                    const atLineEnd = input.selectionStart >= input.value.length;

                    if (!atLastLine || !atLineEnd) {
                        return; // Let default behavior handle line movement
                    }

                    e.preventDefault();
                    idx--;
                    store.set('historyIdx', idx);
                    if (idx >= 0) {
                        input.value = history[idx];
                    } else {
                        // Back to draft
                        input.value = draftText;
                        draftText = '';
                    }
                    this.autoResize(input);
                    input.setSelectionRange(input.value.length, input.value.length);
                }
                return;
            }
        });

        // ── Auto-resize + send/stop toggle ──
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            // Command palette trigger
            bus.emit('inputChanged', input.value);
            // Toggle send/stop button when busy
            if (store.get('isBusy')) {
                this.updateSendButton();
            }
        });

        // ── Mode popup ──
        const modeTrigger = document.getElementById('mode-trigger')!;
        const modePopup = document.getElementById('mode-popup')!;
        const modeLabel = document.getElementById('mode-label')!;
        const getModeLabel = (mode: string): string => t(mode);

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

        // ── Model select ──
        modelSelect.addEventListener('change', () => {
            vscode.setModel(modelSelect.value);
        });

        // ── Listen for state changes ──
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

        // Voice button hidden (Windows STT quality too low, TODO: revisit with better STT)
        if (voiceBtn) {
            voiceBtn.style.display = 'none';
            store.set('voiceEnabled', false);
        }

        // Restore mode when webview re-resolves
        bus.on('restoreMode', (mode: string, _label: string) => {
            const modeLabel = document.getElementById('mode-label');
            if (modeLabel) {
                modeLabel.textContent = t(mode);
                modeLabel.setAttribute('data-i18n', mode);
            }
            document.getElementById('input-wrapper')!.className = `mode-${mode}`;
            document.body.className = `mode-${mode}`;
            // Update active option in popup
            const modeOptions = document.querySelectorAll('.mode-option');
            for (let i = 0; i < modeOptions.length; i++) {
                modeOptions[i].classList.remove('active');
                if ((modeOptions[i] as HTMLElement).getAttribute('data-mode') === mode) {
                    modeOptions[i].classList.add('active');
                }
            }
        });

        bus.on('busy', () => this.setBusy(true));
        bus.on('idle', () => {
            this.setBusy(false);
            // Process next queued message
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

        // Handle slash commands
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

        // Queue if busy
        if (store.get('isBusy')) {
            const queued = store.get('queuedMsgs');
            store.set('queuedMsgs', [...queued, { text, images: imgs.length > 0 ? imgs : null }]);
            vscode.system(`Message queued (#${queued.length + 1})`);
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
        if (busy) {
            statusBar.classList.add('active');
        } else {
            statusBar.classList.remove('active');
        }
    },

    /**
     * Update send button: show stop when busy+empty input, send when busy+text or idle.
     */
    updateSendButton(): void {
        const sendBtn = document.getElementById('send') as HTMLButtonElement;
        const input = document.getElementById('input') as HTMLTextAreaElement;
        const busy = store.get('isBusy');
        const hasText = input && input.value.trim().length > 0;

        if (busy && !hasText) {
            // Show stop button
            sendBtn.textContent = '';
            sendBtn.className = 'stop-btn';
            sendBtn.title = 'Stop';
        } else {
            // Show send button
            sendBtn.textContent = '➡';
            sendBtn.className = '';
            sendBtn.title = busy ? 'Send (queued)' : 'Send';
        }
    },
};
