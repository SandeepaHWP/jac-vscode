// lsp/manager.ts
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, Middleware, Trace } from 'vscode-languageclient/node';
import type { EnvManager } from '../environment/manager';

export class LspManager {
    private client: LanguageClient | undefined;
    private envManager: EnvManager;
    private outputChannel: vscode.OutputChannel | undefined;

    constructor(envManager: EnvManager) {
        this.envManager = envManager;
    }

    public async start(): Promise<void> {
        if (this.client) {
            vscode.window.showWarningMessage("LSP client already running. Restart instead.");
            return;
        }

        const jacPath = this.envManager.getJacPath();

        const serverOptions: ServerOptions = {
            run: { command: jacPath, args: ['lsp'] },
            debug: { command: jacPath, args: ['lsp'] }
        };

        this.outputChannel = vscode.window.createOutputChannel('Jac Language Server');
        const traceChannel = vscode.window.createOutputChannel('Jac LSP Trace');
        const channel = this.outputChannel;
        const middleware: Middleware = {
            handleDiagnostics(uri, diagnostics, next) {
                channel.appendLine(`[middleware] handleDiagnostics uri=${uri} count=${diagnostics.length}`);
                diagnostics.forEach((d, i) => {
                    channel.appendLine(`  [${i}] severity=${d.severity} msg=${d.message} line=${d.range.start.line}`);
                });
                next(uri, diagnostics);
            }
        };
        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'jac' },
                { scheme: 'file', language: 'jac-toml' },
            ],
            outputChannel: this.outputChannel,
            traceOutputChannel: traceChannel,
            middleware,
        };
        this.client = new LanguageClient(
            'jacLanguageServer',
            'Jac Language Server',
            serverOptions,
            clientOptions
        );

        await this.client.start();
        await this.client.setTrace(Trace.Verbose);
        vscode.window.showInformationMessage('Jac Language Server started!');
    }

    public async stop(): Promise<void> {
        if (this.client) {
            try {
                // Properly dispose of the client to clean up output channels
                await this.client.stop();
                this.client.dispose();
            } catch (error) {
                console.warn('Error stopping LSP client:', error);
            } finally {
                this.client = undefined;
            }
            if (this.outputChannel) {
                this.outputChannel.dispose();
                this.outputChannel = undefined;
            }
        }
    }

    public async restart(): Promise<void> {
        try {
            await this.stop();
            // Small delay to ensure proper cleanup before restarting
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.start();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to restart Jac Language Server: ${error}`);
            throw error;
        }
    }

    public getClient(): LanguageClient | undefined {
        return this.client;
    }
}