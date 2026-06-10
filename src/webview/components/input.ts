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
        const modelTrigger = document.getElementById('model-picker-trigger') as HTMLButtonElement | null;
        const modelPopup = document.getElementById('model-picker-popup') as HTMLElement | null;
        const modelLabel = document.getElementById('model-picker-label') as HTMLElement | null;
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

        modePopup.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.addEventListener('click', (e) => {
            if (!modePopup.classList.contains('show')) return;
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (modePopup.contains(target) || modeTrigger.contains(target)) return;
            modePopup.classList.remove('show');
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                modePopup.classList.remove('show');
                modelPopup?.classList.remove('show');
            }
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

        if (modelTrigger && modelPopup) {
            modelTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                modePopup.classList.remove('show');
                modelPopup.classList.toggle('show');
                // 动态定位弹窗，避免在窄屏时被遮挡
                if (modelPopup.classList.contains('show')) {
                    this.alignModelPopup(modelPopup, modelTrigger);
                }
            });
            modelPopup.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = (e.target as HTMLElement | null)?.closest?.('[data-model-value]') as HTMLElement | null;
                if (!item) return;
                const value = item.getAttribute('data-model-value') || '';
                if (!value) return;
                modelSelect.value = value;
                modelPopup.querySelectorAll('.model-picker-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                if (modelLabel) modelLabel.textContent = item.getAttribute('data-model-label') || value;
                modelPopup.classList.remove('show');
                vscode.setModel(value);
            });
            document.addEventListener('click', (e) => {
                if (!modelPopup.classList.contains('show')) return;
                const target = e.target as HTMLElement | null;
                if (!target) return;
                if (modelPopup.contains(target) || modelTrigger.contains(target)) return;
                modelPopup.classList.remove('show');
            });
        }

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

        bus.on('modelList', (models: Array<string | { value: string; label?: string; model?: string; endpointId?: string; endpointName?: string }>, current: string) => {
            modelSelect.innerHTML = '';
            const seen = new Set<string>();
            const flatOptions: Array<{ value: string; label: string; model?: string; endpointId?: string; endpointName?: string }> = [];
            const decodeRoute = (value: string): { endpointId: string; model: string } => {
                const text = String(value || '');
                const idx = text.indexOf('::');
                if (idx <= 0) return { endpointId: '', model: text };
                return { endpointId: text.slice(0, idx), model: text.slice(idx + 2) };
            };
            const cleanLabel = (option: { value: string; label?: string; model?: string; endpointName?: string }): string => {
                const decoded = decodeRoute(option.value);
                return option.model || decoded.model || option.label || option.value;
            };

            for (const item of models) {
                const value = typeof item === 'string' ? item : item?.value;
                if (!value) continue;
                const decoded = decodeRoute(value);
                const model = typeof item === 'string' ? decoded.model || value : (item?.model || decoded.model || value);
                const endpointId = typeof item === 'string' ? decoded.endpointId : (item?.endpointId || decoded.endpointId);
                const endpointName = typeof item === 'string' ? '' : item?.endpointName;
                const key = `${endpointId || ''}::${model}`;
                if (seen.has(key)) continue;
                seen.add(key);
                flatOptions.push({
                    value,
                    label: cleanLabel({ value, label: typeof item === 'string' ? value : item?.label, model, endpointName }),
                    model,
                    endpointId,
                    endpointName,
                });
            }

            const resolvedCurrent = flatOptions.find(option => option.value === current)?.value
                || flatOptions.find(option => option.model === current)?.value
                || current;
            const routed = flatOptions.filter(option => option.endpointId || option.endpointName);
            if (routed.length > 0) {
                const groups = new Map<string, { label: string; options: typeof flatOptions }>();
                for (const option of flatOptions) {
                    const key = option.endpointId || option.endpointName || '';
                    if (!groups.has(key)) {
                        groups.set(key, { label: option.endpointName || option.endpointId || t('model.label'), options: [] });
                    }
                    groups.get(key)!.options.push(option);
                }
                for (const group of groups.values()) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = group.label;
                    for (const option of group.options) {
                        const opt = document.createElement('option');
                        opt.value = option.value;
                        opt.textContent = option.model || option.label || option.value;
                        if (option.value === resolvedCurrent) opt.selected = true;
                        optgroup.appendChild(opt);
                    }
                    modelSelect.appendChild(optgroup);
                }
            } else {
                for (const option of flatOptions) {
                    const opt = document.createElement('option');
                    opt.value = option.value;
                    opt.textContent = option.label || option.value;
                    if (option.value === resolvedCurrent) opt.selected = true;
                    modelSelect.appendChild(opt);
                }
            }
            const currentRoute = decodeRoute(resolvedCurrent || '');
            const currentKey = `${currentRoute.endpointId || ''}::${currentRoute.model || resolvedCurrent || ''}`;
            if (resolvedCurrent && !seen.has(currentKey)) {
                const opt = document.createElement('option');
                opt.value = resolvedCurrent;
                opt.textContent = `${currentRoute.model || resolvedCurrent} (current)`;
                opt.selected = true;
                modelSelect.appendChild(opt);
                flatOptions.push({
                    value: resolvedCurrent,
                    label: `${currentRoute.model || resolvedCurrent} (current)`,
                    model: currentRoute.model || resolvedCurrent,
                    endpointId: currentRoute.endpointId,
                    endpointName: '',
                });
            }
            store.set('models', flatOptions);
            store.set('currentModel', resolvedCurrent || modelSelect.value || '');
            this.renderModelPicker(flatOptions, resolvedCurrent || modelSelect.value || '');
        });

        bus.on('settingsData', (settings: Record<string, any>) => {
            const effort = this.normalizeReasoningEffort(settings.reasoning_effort, settings.enable_thinking);
            store.set('reasoningEffort', effort);
            this.updateReasoningButton();
        });

        bus.on('langChanged', () => {
            this.updateReasoningButton();
            this.renderModelPicker(
                store.get('models') as Array<{ value: string; label: string; model?: string; endpointId?: string; endpointName?: string }>,
                store.get('currentModel'),
            );
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
            if (store.get('skipNextQueueAutoSend')) {
                store.set('skipNextQueueAutoSend', false);
                return;
            }
            const queued = store.get('queuedMsgs');
            if (queued.length > 0) {
                const next = queued[0];
                const remaining = queued.slice(1);
                store.set('queuedMsgs', remaining);
                bus.emit('queueProcessed', remaining.length);
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

    escapeHtml(value: string): string {
        return String(value || '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch] || ch));
    },

    modelBadges(model: string): string[] {
        const text = String(model || '').toLowerCase();
        const badges: string[] = [];
        if (/tts|voice|speech|audio/.test(text)) badges.push(t('badge.tts'));
        if (/asr|transcribe|whisper/.test(text)) badges.push(t('badge.asr'));
        if (/vision|vl|omni|image/.test(text)) badges.push(t('badge.vision'));
        if (/pro|reasoner|deep|r1/.test(text)) badges.push(t('badge.reason'));
        if (/flash|lite|mini/.test(text)) badges.push(t('badge.fast'));
        return badges.slice(0, 2);
    },

    renderModelPicker(options: Array<{ value: string; label: string; model?: string; endpointId?: string; endpointName?: string }>, current: string): void {
        const popup = document.getElementById('model-picker-popup') as HTMLElement | null;
        const label = document.getElementById('model-picker-label') as HTMLElement | null;
        if (!popup || !label) return;
        const currentOption = options.find(option => option.value === current) || options[0];
        label.textContent = currentOption?.model || currentOption?.label || current || 'Model';

        const groups = new Map<string, { label: string; options: typeof options }>();
        for (const option of options) {
            const key = option.endpointId || option.endpointName || 'default';
            if (!groups.has(key)) {
                groups.set(key, {
                    label: option.endpointName || option.endpointId || t('model.label'),
                    options: [],
                });
            }
            groups.get(key)!.options.push(option);
        }

        const html: string[] = [];
        for (const group of groups.values()) {
            html.push(`<div class="model-picker-group"><div class="model-picker-group-title">${this.escapeHtml(group.label)}</div>`);
            for (const option of group.options) {
                const model = option.model || option.label || option.value;
                const active = option.value === current ? ' active' : '';
                const badges = this.modelBadges(model)
                    .map(badge => `<span class="model-picker-badge">${this.escapeHtml(badge)}</span>`)
                    .join('');
                html.push(
                    `<button class="model-picker-item${active}" type="button" data-model-value="${this.escapeHtml(option.value)}" data-model-label="${this.escapeHtml(model)}">` +
                    `<span class="model-picker-dot"></span>` +
                    `<span class="model-picker-main"><span class="model-picker-name">${this.escapeHtml(model)}</span>` +
                    `<span class="model-picker-meta">${this.escapeHtml(option.endpointName || option.endpointId || '')}</span></span>` +
                    `<span class="model-picker-badges">${badges}</span>` +
                    `</button>`,
                );
            }
            html.push('</div>');
        }
        popup.innerHTML = html.join('');
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
            this.updateSendButton();
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

    /**
     * 对齐弹窗位置，避免在窄屏时被遮挡
     */
    alignPopup(popup: HTMLElement, trigger: HTMLElement): void {
        // 重置定位
        popup.classList.remove('align-left', 'align-right');
        popup.style.left = '';
        popup.style.right = '';

        requestAnimationFrame(() => {
            const viewportWidth = window.innerWidth;
            const triggerRect = trigger.getBoundingClientRect();
            const popupWidth = Math.min(360, viewportWidth - 28);

            // 计算弹窗左边界位置（右对齐触发按钮）
            const popupLeft = triggerRect.right - popupWidth;

            // 如果左边界超出视口左侧，改为左对齐
            if (popupLeft < 8) {
                popup.classList.add('align-left');
                popup.style.left = '8px';
                popup.style.right = 'auto';
            }
            // 如果右边界超出视口右侧，调整位置
            else if (triggerRect.right > viewportWidth - 8) {
                popup.style.left = `${viewportWidth - popupWidth - 8}px`;
                popup.style.right = 'auto';
            }
            // 默认右对齐
            else {
                popup.style.right = `${viewportWidth - triggerRect.right}px`;
                popup.style.left = 'auto';
            }
        });
    },

    alignModelPopup(popup: HTMLElement, trigger: HTMLElement): void {
        popup.classList.remove('align-left', 'align-right');
        popup.style.left = '';
        popup.style.right = '';

        requestAnimationFrame(() => {
            const viewportWidth = window.innerWidth;
            const triggerRect = trigger.getBoundingClientRect();
            const popupWidth = Math.min(360, Math.max(160, viewportWidth - 28));
            const offsetParent = (popup.offsetParent as HTMLElement | null) || popup.parentElement;
            const parentRect = offsetParent?.getBoundingClientRect();
            const minViewportLeft = 8;
            const maxViewportLeft = Math.max(minViewportLeft, viewportWidth - popupWidth - 8);
            const desiredViewportLeft = triggerRect.right - popupWidth;
            const clampedViewportLeft = Math.min(maxViewportLeft, Math.max(minViewportLeft, desiredViewportLeft));
            const relativeLeft = parentRect ? clampedViewportLeft - parentRect.left : clampedViewportLeft;

            popup.style.left = `${relativeLeft}px`;
            popup.style.right = 'auto';
            popup.classList.add(clampedViewportLeft <= minViewportLeft ? 'align-left' : 'align-right');
        });
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
        const hasQueued = store.get('queuedMsgs').length > 0;

        if (busy && !hasText) {
            sendBtn.textContent = '';
            sendBtn.className = 'stop-btn';
            sendBtn.title = t('stop');
        } else if (busy && !hasText && hasQueued) {
            sendBtn.textContent = '▶';
            sendBtn.className = 'run-queued-btn';
            sendBtn.title = t('queue.run.next.title');
        } else {
            sendBtn.textContent = '▶';
            sendBtn.className = '';
            sendBtn.title = busy ? t('send.queued') : t('send');
        }
    },
};
