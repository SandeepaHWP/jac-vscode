import * as vscode from 'vscode';
import { runJacCommandForCurrentFile } from '../utils';
import { COMMANDS } from '../constants';
import { getLspManager } from '../extension';
import { EnvManager } from '../environment/manager';
import { inspectTokenScopesHandler } from './inspectTokenScopes';

export function registerAllCommands(context: vscode.ExtensionContext, envManager: EnvManager) {
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SELECT_ENV, () => {
            envManager.promptEnvironmentSelection();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RUN_FILE, () => {
            runJacCommandForCurrentFile('run', envManager);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.DEBUG_FILE, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'jac') {
                vscode.window.showErrorMessage('Please open a Jac file to debug.');
                return;
            }

            // Open the visual debugger webview
            await vscode.commands.executeCommand(COMMANDS.VISUALIZE);

            // Start debugging with dynamic configuration
            await vscode.debug.startDebugging(
                vscode.workspace.getWorkspaceFolder(editor.document.uri),
                {
                    type: 'debugpy',
                    request: 'launch',
                    name: 'Jac: Debug Current File',
                    python: envManager.getPythonPath(),
                    program: envManager.getJacPath(),
                    args: ['run', editor.document.uri.fsPath],
                    console: 'integratedTerminal',
                    justMyCode: true
                }
            );
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SERVE_FILE, () => {
            runJacCommandForCurrentFile('serve', envManager);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.GET_JAC_PATH, () => {
            // Use envManager to get the selected jac path
            return envManager.getJacPath();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.GET_PYTHON_PATH, () => {
            // Use envManager to get the Python path from same environment as Jac
            return envManager.getPythonPath();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.TOGGLE_DEV_MODE, async () => {
            const config = vscode.workspace.getConfiguration('jaclang-extension');
            const currentMode = config.get<boolean>('developerMode', false);

            // Toggle the mode
            await config.update('developerMode', !currentMode, vscode.ConfigurationTarget.Global);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.TOGGLE_JAC_DEFINITION, async () => {
            const config = vscode.workspace.getConfiguration('jaclang-extension');
            const currentMode = config.get<boolean>('enableJacDefinitionProvider', true);

            // Toggle the mode
            await config.update('enableJacDefinitionProvider', !currentMode, vscode.ConfigurationTarget.Global);
            
            const status = !currentMode ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Jac Definition Provider ${status}. Please reload VS Code for changes to take effect.`);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RESTART_LSP, async () => {
            const lspManager = getLspManager();
            if (lspManager) {
                try {
                    vscode.window.showInformationMessage('Restarting Jac Language Server...');
                    await lspManager.restart();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to restart Jac Language Server: ${error.message || error}`);
                }
            } else {
                vscode.window.showErrorMessage('Language Server not available for restart.');
            }
        })
    );

    // Inspect Token Scopes command - dumps all TextMate token scopes for the current Jac file
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.INSPECT_SCOPES, async () => {
            await inspectTokenScopesHandler(context);
        })
    );
}
