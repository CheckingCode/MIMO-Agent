import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MiMoAgent } from './agent';
import { ChatViewProvider } from './webview/chatProvider';
import { SettingsProvider } from './webview/settingsProvider';
import { loadConfig } from './config';

let agent: MiMoAgent;
let chatProvider: ChatViewProvider;
let settingsProvider: SettingsProvider;

export function activate(context: vscode.ExtensionContext) {
    const config = loadConfig();

    // Ensure ~/.mimo/ directory exists
    const mimoHome = path.join(os.homedir(), '.mimo');
    if (!fs.existsSync(mimoHome)) {
        fs.mkdirSync(mimoHome, { recursive: true });
    }

    if (!config.apiKey) {
        vscode.window.showWarningMessage(
            'MiMo: API key not set. Configure in Settings or set MIMO_API_KEY environment variable.',
        );
    }

    // Create agent synchronously (it's needed for commands)
    agent = new MiMoAgent(config, context.extensionPath, context);
    chatProvider = new ChatViewProvider(context.extensionUri, agent);
    settingsProvider = new SettingsProvider(context.extensionUri, agent);

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
    agent?.dispose();
    import('./browser').then(m => m.browserClose()).catch(() => {});
}
