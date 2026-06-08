/**
 * Header component — action buttons only (history, new, settings, language).
 * Conversation titles are managed via the outer VSCode editor tab + history panel.
 */
import { store } from '../core/store';
import { bus } from '../core/bus';
import { vscode } from '../core/vscode';
import { toggleLang, t, getLangToggleText, getWelcomePair } from '../core/i18n';

export const Header = {
    mount(): void {
        document.getElementById('btn-new')!.addEventListener('click', () => vscode.newChat());
        document.getElementById('btn-history')!.addEventListener('click', () => bus.emit('togglePanel', 'history'));
        document.getElementById('btn-settings')!.addEventListener('click', () => vscode.post({ type: 'openSettings' }));
        document.getElementById('btn-lang')!.addEventListener('click', () => {
            const lang = toggleLang();
            vscode.setUiLang(lang);
            const btn = document.getElementById('btn-lang');
            if (btn) btn.textContent = getLangToggleText();
            this.updateModeLabels();
            const input = document.getElementById('input') as HTMLTextAreaElement;
            if (input) input.placeholder = t('paste.hint');
            const seed = store.get('activeTabId') || 'default';
            const { desc, hint } = getWelcomePair(seed);
            const welcomeDesc = document.querySelector('.welcome-desc');
            const welcomeHint = document.querySelector('.welcome-hint');
            if (welcomeDesc) welcomeDesc.innerHTML = desc;
            if (welcomeHint) welcomeHint.innerHTML = hint;
            bus.emit('langChanged');
        });

        // Title input — edit conversation title
        const titleInput = document.getElementById('conv-title') as HTMLInputElement;
        if (titleInput) {
            titleInput.addEventListener('blur', () => {
                const val = titleInput.value.trim();
                const convId = titleInput.getAttribute('data-conv-id') || store.get('activeTabId');
                if (val && val !== store.get('convTitle')) {
                    vscode.post({ type: 'renameChat', id: convId, title: val });
                    store.set('convTitle', val);
                } else if (!val) {
                    titleInput.value = store.get('convTitle') || 'New Chat';
                }
            });
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') titleInput.blur();
                if (e.key === 'Escape') {
                    titleInput.value = store.get('convTitle') || 'New Chat';
                    titleInput.blur();
                }
            });
            // Prevent header click from switching focus
            titleInput.addEventListener('click', (e) => e.stopPropagation());
        }

        // Listen for title updates from extension
        bus.on('convTitle', (title: string, convId?: string) => {
            store.set('convTitle', title);
            const inp = document.getElementById('conv-title') as HTMLInputElement;
            if (inp) {
                inp.value = title;
                if (convId) inp.setAttribute('data-conv-id', convId);
            }
        });
    },

    updateModeLabels(): void {
        const modes = ['auto', 'polling', 'plan', 'adversarial', 'infinite'];
        for (const mode of modes) {
            const option = document.querySelector(`.mode-option[data-mode="${mode}"]`);
            if (option) {
                const nameEl = option.querySelector('.mode-option-name');
                const descEl = option.querySelector('.mode-option-desc');
                if (nameEl) nameEl.textContent = t(mode);
                if (descEl) descEl.textContent = t(`${mode}.desc`);
                // Add usage guide as tooltip for adversarial mode
                if (mode === 'adversarial') {
                    option.setAttribute('title', t('adversarial.guide'));
                }
            }
        }
        const modeLabel = document.getElementById('mode-label');
        if (modeLabel) modeLabel.textContent = t(store.get('currentMode'));
    },
};
