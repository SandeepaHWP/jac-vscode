import * as vscode from 'vscode';
import { EnvManager } from './environment/manager';
import { registerAllCommands } from './commands';
import { setupVisualDebuggerWebview } from './webview/visualDebugger';
import { LspManager } from './lsp/lsp_manager';

let lspManager: LspManager | undefined;

export function getLspManager(): LspManager | undefined {
    return lspManager;
}

export async function activate(context: vscode.ExtensionContext) {
    try {
        // pass callback to start LSP when environment is selected
        const envManager = new EnvManager(context, async () => {
            // callback fired when env selected and LSP needed
            if (!lspManager) {
                try {
                    lspManager = new LspManager(envManager);
                    await lspManager.start();
                    context.subscriptions.push({
                        dispose: () => lspManager?.stop()
                    });
                } catch (error) {
                    console.error('LSP failed to start after env selection:', error);
                    vscode.window.showWarningMessage(
                        'Jac Language Server failed to start. IntelliSense features may be limited.'
                    );
                }
            }
        });

        registerAllCommands(context, envManager);
        await envManager.init();

        setupVisualDebuggerWebview(context);

        // If env already exists at activation, start LSP now
        const jacPath = context.globalState.get<string>('jacEnvPath');
        if (jacPath) {
            try {
                lspManager = new LspManager(envManager);
                await lspManager.start();

                context.subscriptions.push({
                    dispose: () => lspManager?.stop()
                });
            } catch (error) {
                console.error('LSP failed to start:', error);
                vscode.window.showWarningMessage(
                    'Jac Language Server failed to start. IntelliSense features may be limited.',
                    'Select Environment'
                ).then(action => {
                    if (action === 'Select Environment') {
                        vscode.commands.executeCommand('jaclang-extension.selectEnv');
                    }
                });
            }
        } else {
            console.log('No Jac environment selected. LSP will start after environment selection.');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to activate Jac extension: ${error}`);
        console.error('Extension activation error:', error);
    }
}

export function deactivate(): Thenable<void> | undefined {
    return lspManager?.stop();
}
