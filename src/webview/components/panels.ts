/**
 * Panels component — History panel + Settings panel.
 */
import { store, HistoryEntry } from '../core/store';
import { bus } from '../core/bus';
import { vscode } from '../core/vscode';
import { escapeHtml } from '../utils/dom';

export const Panels = {
    mount(): void {
        const historyPanel = document.getElementById('history-panel');
        const settingsPanel = document.getElementById('settings-panel');
        if (!historyPanel || !settingsPanel) return;

        // Close buttons
        const closeHistory = document.getElementById('close-history');
        if (closeHistory) closeHistory.addEventListener('click', () => {
            historyPanel.classList.add('hidden');
        });
        const closeSettings = document.getElementById('close-settings');
        if (closeSettings) closeSettings.addEventListener('click', () => {
            settingsPanel.classList.add('hidden');
        });

        document.addEventListener('click', (e) => {
            if (historyPanel.classList.contains('hidden')) return;
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (historyPanel.contains(target)) return;
            if (target.closest('#btn-history')) return;
            historyPanel.classList.add('hidden');
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                historyPanel.classList.add('hidden');
            }
        });

        // History search
        let searchTimeout: ReturnType<typeof setTimeout>;
        const historySearch = document.getElementById('history-search');
        if (historySearch) historySearch.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value;
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                vscode.historySearch(query);
            }, 300);
        });

        // Export buttons
        const exportMd = document.getElementById('export-md');
        if (exportMd) exportMd.addEventListener('click', () => {
            const activeId = store.get('activeTabId');
            if (activeId) vscode.exportMarkdown(activeId);
        });
        const exportJson = document.getElementById('export-json');
        if (exportJson) exportJson.addEventListener('click', () => {
            const activeId = store.get('activeTabId');
            if (activeId) vscode.exportJson(activeId);
        });

        // Export result handler
        bus.on('exportResult', (format: string, content: string, title: string) => {
            // Download the file with sanitized title as filename
            const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Sanitize title for filename: remove special chars, limit length
            const safeName = (title || 'mimo-export')
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, '_')
                .substring(0, 50);
            a.download = `${safeName}.${format === 'json' ? 'json' : 'md'}`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // Toggle panels
        bus.on('togglePanel', (which: string) => {
            if (which === 'history') {
                const hidden = historyPanel.classList.contains('hidden');
                settingsPanel.classList.add('hidden');
                if (hidden) {
                    historyPanel.classList.remove('hidden');
                    vscode.historyList();
                } else {
                    historyPanel.classList.add('hidden');
                }
            } else if (which === 'settings') {
                const hidden = settingsPanel.classList.contains('hidden');
                historyPanel.classList.add('hidden');
                if (hidden) {
                    settingsPanel.classList.remove('hidden');
                    vscode.getSettings();
                } else {
                    settingsPanel.classList.add('hidden');
                }
            }
        });

        // Save settings
        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) saveBtn.addEventListener('click', () => {
            vscode.saveSettings({
                api_key: (document.getElementById('set-apikey') as HTMLInputElement).value,
                base_url: (document.getElementById('set-baseurl') as HTMLInputElement).value,
                model: (document.getElementById('set-model') as HTMLInputElement).value,
                active_provider_profile: (document.getElementById('set-active-provider-profile') as HTMLInputElement)?.value || '',
                provider_profiles: (() => {
                    try {
                        return JSON.parse((document.getElementById('set-provider-profiles') as HTMLTextAreaElement)?.value || '[]');
                    } catch {
                        return undefined;
                    }
                })(),
                temperature: parseFloat((document.getElementById('set-temperature') as HTMLInputElement).value) || 0.7,
                max_tokens: Math.min(65536, Math.max(256, parseInt((document.getElementById('set-maxtokens') as HTMLInputElement).value) || 8192)),
                command_timeout: parseInt((document.getElementById('set-command-timeout') as HTMLInputElement)?.value || '120') || 120,
                max_output_len: parseInt((document.getElementById('set-max-output-len') as HTMLInputElement)?.value || '5000') || 5000,
                enable_thinking: (document.getElementById('set-thinking') as HTMLInputElement).checked,
                reasoning_effort: store.get('reasoningEffort'),
                sandbox_enabled: (document.getElementById('set-sandbox') as HTMLInputElement).checked,
                sandbox_image: (document.getElementById('set-sandbox-image') as HTMLInputElement).value,
                sandbox_memory: (document.getElementById('set-sandbox-memory') as HTMLInputElement).value,
                sandbox_cpu: parseInt((document.getElementById('set-sandbox-cpu') as HTMLInputElement).value) || 1,
                sandbox_git_snapshot: (document.getElementById('set-sandbox-git') as HTMLInputElement)?.checked ?? false,
                sandbox_logging: (document.getElementById('set-sandbox-logging') as HTMLInputElement)?.checked ?? true,
                dependency_install_enabled: (document.getElementById('set-dependency-install-enabled') as HTMLInputElement)?.checked ?? true,
                dependency_install_project_mode: (document.getElementById('set-dependency-project-mode') as HTMLSelectElement)?.value || 'auto',
                dependency_install_system_mode: (document.getElementById('set-dependency-system-mode') as HTMLSelectElement)?.value || 'confirm',
                dependency_install_long_timeout_sec: parseInt((document.getElementById('set-dependency-long-timeout') as HTMLInputElement)?.value || '600') || 600,
                memory_enabled: (document.getElementById('set-memory-enabled') as HTMLInputElement)?.checked ?? true,
                memory_learn_from_explicit_preferences: (document.getElementById('set-memory-learn') as HTMLInputElement)?.checked ?? true,
                memory_max_items: parseInt((document.getElementById('set-memory-max-items') as HTMLInputElement)?.value || '120') || 120,
                memory_max_injected: parseInt((document.getElementById('set-memory-max-injected') as HTMLInputElement)?.value || '8') || 8,
            });
        });

        // Listen for data
        bus.on('historyList', (items: HistoryEntry[]) => this.renderHistory(items));
        bus.on('settingsData', (settings: Record<string, any>) => this.populateSettings(settings));

        // Event delegation for history list — handles clicks on dynamically created buttons.
        // Single listener on the container survives innerHTML replacements.
        const historyList = document.getElementById('history-list');
        if (historyList) {
            historyList.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const itemDiv = target.closest('.history-item') as HTMLElement | null;
                if (!itemDiv) return;
                const id = itemDiv.dataset.id;
                if (!id) return;

                if (target.closest('.history-del')) {
                    e.stopPropagation();
                    vscode.historyDelete(id);
                } else if (target.closest('.history-export-md')) {
                    e.stopPropagation();
                    vscode.exportMarkdown(id);
                } else if (target.closest('.history-export-json')) {
                    e.stopPropagation();
                    vscode.exportJson(id);
                } else {
                    vscode.historyLoad(id);
                    historyPanel.classList.add('hidden');
                }
            });
        }
    },

    renderHistory(items: HistoryEntry[]): void {
        const el = document.getElementById('history-list')!;
        if (!items || items.length === 0) {
            el.innerHTML = '<div class="panel-empty">No history yet</div>';
            return;
        }
        el.innerHTML = '';
        for (const item of items) {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.dataset.id = item.id;
            const d = new Date(item.timestamp);
            const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            div.innerHTML = `<span class="history-title">${escapeHtml(item.title)}</span><span class="history-meta">${dateStr} (${item.messageCount})</span><button class="history-export-md" title="Export Markdown">MD</button><button class="history-export-json" title="Export JSON">{ }</button><button class="history-del" title="Delete">&times;</button>`;
            el.appendChild(div);
        }
    },

    populateSettings(s: Record<string, any>): void {
        (document.getElementById('set-apikey') as HTMLInputElement).value = s.api_key || '';
        (document.getElementById('set-baseurl') as HTMLInputElement).value = s.base_url || '';
        (document.getElementById('set-model') as HTMLInputElement).value = s.model || '';
        const activeProviderProfile = document.getElementById('set-active-provider-profile') as HTMLInputElement;
        if (activeProviderProfile) activeProviderProfile.value = s.active_provider_profile || '';
        const providerProfiles = document.getElementById('set-provider-profiles') as HTMLTextAreaElement;
        if (providerProfiles) providerProfiles.value = JSON.stringify(s.provider_profiles || [], null, 2);
        (document.getElementById('set-temperature') as HTMLInputElement).value = String(s.temperature ?? 0.7);
        (document.getElementById('set-maxtokens') as HTMLInputElement).value = String(s.max_tokens ?? 8192);
        const commandTimeout = document.getElementById('set-command-timeout') as HTMLInputElement;
        if (commandTimeout) commandTimeout.value = String(s.command_timeout ?? 120);
        const maxOutputLen = document.getElementById('set-max-output-len') as HTMLInputElement;
        if (maxOutputLen) maxOutputLen.value = String(s.max_output_len ?? 5000);
        (document.getElementById('set-thinking') as HTMLInputElement).checked = !!s.enable_thinking;
        (document.getElementById('set-sandbox') as HTMLInputElement).checked = !!s.sandbox_enabled;
        (document.getElementById('set-sandbox-image') as HTMLInputElement).value = s.sandbox_image || 'node:20-alpine';
        (document.getElementById('set-sandbox-memory') as HTMLInputElement).value = s.sandbox_memory || '512m';
        (document.getElementById('set-sandbox-cpu') as HTMLInputElement).value = String(s.sandbox_cpu ?? 1);
        const gitCb = document.getElementById('set-sandbox-git') as HTMLInputElement;
        if (gitCb) gitCb.checked = s.sandbox_git_snapshot === true;
        const logCb = document.getElementById('set-sandbox-logging') as HTMLInputElement;
        if (logCb) logCb.checked = s.sandbox_logging !== false;
        const dependencyEnabled = document.getElementById('set-dependency-install-enabled') as HTMLInputElement;
        if (dependencyEnabled) dependencyEnabled.checked = s.dependency_install_enabled !== false;
        const projectMode = document.getElementById('set-dependency-project-mode') as HTMLSelectElement;
        if (projectMode) projectMode.value = s.dependency_install_project_mode || 'auto';
        const systemMode = document.getElementById('set-dependency-system-mode') as HTMLSelectElement;
        if (systemMode) systemMode.value = s.dependency_install_system_mode || 'confirm';
        const longTimeout = document.getElementById('set-dependency-long-timeout') as HTMLInputElement;
        if (longTimeout) longTimeout.value = String(s.dependency_install_long_timeout_sec ?? 600);
        const memoryEnabled = document.getElementById('set-memory-enabled') as HTMLInputElement;
        if (memoryEnabled) memoryEnabled.checked = s.memory_enabled !== false;
        const memoryLearn = document.getElementById('set-memory-learn') as HTMLInputElement;
        if (memoryLearn) memoryLearn.checked = s.memory_learn_from_explicit_preferences !== false;
        const memoryMaxItems = document.getElementById('set-memory-max-items') as HTMLInputElement;
        if (memoryMaxItems) memoryMaxItems.value = String(s.memory_max_items ?? 120);
        const memoryMaxInjected = document.getElementById('set-memory-max-injected') as HTMLInputElement;
        if (memoryMaxInjected) memoryMaxInjected.value = String(s.memory_max_injected ?? 8);
    },
};
