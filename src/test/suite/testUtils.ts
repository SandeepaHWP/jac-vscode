/**
 * Shared Test Utilities
 * Used by all integration test files to avoid code duplication
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';

/**
 * Execute shell commands and capture output
 * Returns exit code, stdout, and stderr for verification
 */
export async function runCommand(cmd: string, args: string[]) {
    return await new Promise<{ code: number; commandOutput: string; commandError: string }>((resolve, reject) => {
        const childProcess = spawn(cmd, args, { shell: false });
        let commandOutput = '';
        let commandError = '';
        childProcess.stdout.on('data', (data) => (commandOutput += data.toString()));
        childProcess.stderr.on('data', (data) => (commandError += data.toString()));
        childProcess.on('error', reject);
        childProcess.on('close', (code) => resolve({ code: code ?? 0, commandOutput, commandError }));
    });
}

/**
 * Check if a file or directory exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Finds which Python command works on local (Windows, Mac, or Linux)
 * Different systems have different Python commands, so we try them one by one
 * Returns: the Python command that works, or null if Python is not installed
 */
export async function detectPython(): Promise<{ cmd: string; argsPrefix: string[] } | null> {
    if (process.platform === 'win32') {
        try {
            const versionCheckResult = await runCommand('py', ['-3', '--version']);
            if (versionCheckResult.code === 0) return { cmd: 'py', argsPrefix: ['-3'] };
        } catch { }
    }
    try {
        const versionCheckResult = await runCommand('python3', ['--version']);
        if (versionCheckResult.code === 0) return { cmd: 'python3', argsPrefix: [] };
    } catch { }
    try {
        const versionCheckResult = await runCommand('python', ['--version']);
        if (versionCheckResult.code === 0) return { cmd: 'python', argsPrefix: [] };
    } catch { }
    return null;
}

// Get pipx bin directory where global executables are exposed
export async function getPipxBinDir(): Promise<string> {
    const result = await runCommand('pipx', ['environment', '--value', 'PIPX_BIN_DIR']);
    if (result.code !== 0) {
        throw new Error(`pipx not available or failed: ${result.commandError || result.commandOutput}`);
    }
    return result.commandOutput.trim();
}

// Mock VS Code terminal creation and track all interactions
// Captures: terminal creation, show() calls, and sendText() commands
export async function mockTerminalAndCapture(
    callback: () => Promise<void>,
    terminalName: string = 'Jac'
): Promise<{
    created: boolean;
    shown: boolean;
    name: string;
    commands: string[];
}> {
    const vscode = require('vscode');

    const interactions = {
        created: false,
        shown: false,
        name: '',
        commands: [] as string[]
    };

    const originalCreateTerminal = (vscode.window as any).createTerminal;

    (vscode.window as any).createTerminal = (nameOrOptions: any) => {
        interactions.created = true;
        const name = typeof nameOrOptions === 'string'
            ? nameOrOptions
            : (nameOrOptions?.name ?? terminalName);

        interactions.name = name;

        const mockTerminal: Partial<any> = {
            name,
            show: () => { interactions.shown = true; },
            sendText: (text: string) => { interactions.commands.push(text); },
            dispose: () => undefined,
        };

        return mockTerminal;
    };

    try {
        await callback();
    } finally {
        (vscode.window as any).createTerminal = originalCreateTerminal; // Restore original
    }

    return interactions;
}
