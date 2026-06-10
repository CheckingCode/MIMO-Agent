import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MiMoAgent } from './agent';
import { ChatViewProvider } from './webview/chatProvider';
import { SettingsProvider } from './webview/settingsProvider';
import { loadConfig, saveSetting } from './config';
import { createWindowSessionId } from './workspaceData';

let agent: MiMoAgent;
let chatProvider: ChatViewProvider;
let settingsProvider: SettingsProvider;

function ensureDefaultUserRules(extensionPath: string, mimoHome: string): void {
    const target = path.join(mimoHome, 'MIMO.md');
    if (fs.existsSync(target)) return;

    const source = path.join(extensionPath, 'MIMO.md');
    if (!fs.existsSync(source)) return;

    try {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    } catch (err: any) {
        if (err?.code !== 'EEXIST') {
            console.warn('[MiMo] Failed to initialize ~/.mimo/MIMO.md:', err);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const config = loadConfig();
    const windowSessionId = createWindowSessionId();

    // Ensure ~/.mimo/ directory exists
    const mimoHome = path.join(os.homedir(), '.mimo');
    if (!fs.existsSync(mimoHome)) {
        fs.mkdirSync(mimoHome, { recursive: true });
    }
    ensureDefaultUserRules(context.extensionPath, mimoHome);

    if (!config.apiKey) {
        vscode.window.showWarningMessage(
            'MiMo: API key not set. Configure in Settings or set MIMO_API_KEY environment variable.',
        );
    }

    // Create agent synchronously (it's needed for commands)
    agent = new MiMoAgent(config, context.extensionPath, context, windowSessionId);
    chatProvider = new ChatViewProvider(context.extensionUri, agent, windowSessionId);
    settingsProvider = new SettingsProvider(context.extensionUri, agent, () => chatProvider.handleSettingsApplied());

    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer('mimo-agent.chat', {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
                chatProvider.restorePanel(panel, state);
            },
        }),
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.chat', () => {
            chatProvider.show();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.newChat', () => {
            chatProvider.show(true);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.clear', () => {
            agent.reset();
            vscode.window.showInformationMessage('MiMo: Conversation cleared');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.settings', () => {
            settingsProvider.show();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.switchModel', async () => {
            const options = agent.getModelOptions();
            if (options.length === 0) {
                vscode.window.showWarningMessage('MiMo: No model profiles configured.');
                return;
            }

            const quickPickItems: Array<vscode.QuickPickItem & { option?: typeof options[number] }> = [];
            const grouped = new Map<string, typeof options>();
            for (const option of options) {
                const key = option.endpointId || option.endpointName || 'default';
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(option);
            }
            for (const [key, groupOptions] of grouped.entries()) {
                const first = groupOptions[0];
                quickPickItems.push({
                    label: first.endpointName || first.endpointId || key,
                    kind: vscode.QuickPickItemKind.Separator,
                });
                for (const option of groupOptions) {
                    quickPickItems.push({
                        label: option.model,
                        description: option.endpointName || option.endpointId || '',
                        detail: option.endpointId ? `${option.endpointId} · ${option.value}` : option.value,
                        option,
                    });
                }
            }

            const selected = await vscode.window.showQuickPick(
                quickPickItems,
                {
                    title: 'MiMo: Switch Model',
                    placeHolder: 'Choose API profile and model',
                    matchOnDescription: true,
                    matchOnDetail: true,
                },
            );
            if (!selected?.option) return;

            const endpointId = selected.option.endpointId || '';
            const model = selected.option.model;
            let ok = true;
            ok = saveSetting('api.model', model) && ok;
            ok = saveSetting('api.active_provider_profile', endpointId) && ok;
            ok = saveSetting('api.active_route', { endpoint_id: endpointId, model }) && ok;
            agent.updateConfig(loadConfig());
            agent.setModel(selected.option.value);
            chatProvider.setModelForOpenPanels(selected.option.value);
            vscode.window.showInformationMessage(
                ok
                    ? `MiMo: Switched to ${selected.option.endpointName ? selected.option.endpointName + ' / ' : ''}${model}`
                    : 'MiMo: Model switched in memory, but saving settings failed.',
            );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.explain', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const selection = editor.document.getText(editor.selection);
            if (!selection) {
                vscode.window.showWarningMessage('MiMo: Select some code first');
                return;
            }
            const fileName = editor.document.fileName;
            const prompt = `Explain this code from ${fileName}:\n\n\`\`\`\n${selection}\n\`\`\``;
            chatProvider.show();
            setTimeout(() => {
                chatProvider.handleUserMessage(prompt);
            }, 300);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.review', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const selection = editor.document.getText(editor.selection);
            if (!selection) {
                vscode.window.showWarningMessage('MiMo: Select some code first');
                return;
            }
            const fileName = editor.document.fileName;
            const prompt = `Review this code from ${fileName}:\n\n\`\`\`\n${selection}\n\`\`\``;
            chatProvider.show();
            setTimeout(() => {
                chatProvider.handleUserMessage(prompt);
            }, 300);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('mimo-agent.refactor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const selection = editor.document.getText(editor.selection);
            if (!selection) {
                vscode.window.showWarningMessage('MiMo: Select some code first');
                return;
            }
            const fileName = editor.document.fileName;
            const prompt = `Refactor this code from ${fileName}:\n\n\`\`\`\n${selection}\n\`\`\``;
            chatProvider.show();
            setTimeout(() => {
                chatProvider.handleUserMessage(prompt);
            }, 300);
        }),
    );

    // Status bar
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = 'MiMo';
    statusBar.tooltip = 'MiMo';
    statusBar.command = 'mimo-agent.chat';
    statusBar.show();
    context.subscriptions.push(statusBar);

    console.log('MiMo activated');
}

export function deactivate() {
    chatProvider?.flushHistorySaves();
    agent?.dispose();
    import('./browser').then(m => m.browserClose()).catch(() => {});
}
