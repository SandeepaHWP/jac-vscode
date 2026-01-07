import * as vscode from 'vscode';
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs/promises';
import { COMMANDS, TERMINAL_NAME } from '../../constants';
import { runCommand, fileExists, detectPython, getPipxBinDir, mockTerminalAndCapture } from './test-helpers';

let workspacePath: string;

before(() => {
    // Resolve workspace path from VS Code workspace folders
    const folders = vscode.workspace.workspaceFolders;
    expect(folders).to.exist;
    expect(folders?.length).to.be.greaterThan(0);
    workspacePath = folders![0].uri.fsPath;
});

describe('Commands Integration Tests - RUN_FILE and Fallback Mechanisms', () => {
    let temporaryVenvDirectory = '';
    let venvPath = '';
    let pythonCmd: { cmd: string; argsPrefix: string[] };
    let venvPythonPath = '';
    let jacExePath = '';
    let envManager: any;
    let originalPath = process.env.PATH ?? '';
    let pipxBinDir = '';

    before(async function () {
        this.timeout(30_000);
        // Initialize paths and environment manager
        const detectedPython = await detectPython();
        if (!detectedPython) {
            throw new Error('Python interpreter not found. Tests require Python to be installed.');
        }
        pythonCmd = detectedPython;
        temporaryVenvDirectory = path.join(workspacePath, '.venv');
        venvPath = temporaryVenvDirectory;

        // Platform-specific paths to Python and jac executables
        venvPythonPath = process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
        jacExePath = process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'jac.exe')
            : path.join(venvPath, 'bin', 'jac');

        // Get environment manager for status bar verification
        const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
        await ext!.activate();
        const exports = ext!.exports;
        envManager = exports?.getEnvManager?.();
    });

    afterEach(async () => {
        // Clean up any open editors between tests
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    after(async () => {
        // Final cleanup: ensure test workspace is clean
        if (temporaryVenvDirectory) {
            try {
                await fs.rm(temporaryVenvDirectory, { recursive: true, force: true });
            } catch { }
        }
    });

    it('should execute Jac: Run button and verify complete terminal execution flow', async function () {
        this.timeout(60_000);

        // Ensure sample.jac is the active editor
        const filePath = path.join(workspacePath, 'sample.jac');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc);
        expect(vscode.window.activeTextEditor?.document.uri.fsPath).to.equal(filePath);
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify the file is recognized as a JAC file (required for button visibility)
        const activeEditor = vscode.window.activeTextEditor;
        expect(activeEditor, 'Editor should be open').to.exist;
        expect(activeEditor!.document.languageId).to.equal('jac', 'File should be recognized as Jac language');

        // Clean up existing terminals
        vscode.window.terminals.forEach(t => t.dispose());
        await new Promise(resolve => setTimeout(resolve, 250));

        // Mock terminal creation to verify UI integration
        const interactions = await mockTerminalAndCapture(async () => {
            // Step 1: Simulate clicking the "Jac: Run" button by executing its command
            // This mimics the user clicking the play icon button in the editor title bar
            await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }, TERMINAL_NAME);

        // Verify terminal was created and properly configured
        expect(interactions.created, 'Terminal should be created when button is clicked').to.be.true;
        expect(interactions.shown, 'Terminal should be shown to user when button is clicked').to.be.true;
        expect(interactions.name).to.equal(TERMINAL_NAME, `Terminal should be named "${TERMINAL_NAME}"`);

        // Verify the correct command was sent to the terminal
        expect(interactions.commands.length, 'At least one command should be sent to terminal').to.be.greaterThan(0);
        const sentCommand = interactions.commands.join('\n');
        expect(sentCommand).to.include('run', 'Command should include "run"');
        expect(sentCommand).to.include('sample.jac', 'Command should include filename');

        // Get the selected jac path to verify command correctness
        const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
        const envMgr = ext!.exports?.getEnvManager?.();
        const selectedJacPath: string = envMgr?.getJacPath?.() ?? jacExePath;

        // Verify the command includes the correct jac executable path
        expect(sentCommand).to.include(selectedJacPath, 'Command should use selected Jac path');

        // Verify actual execution by running jac directly
        const runResult = await runCommand(selectedJacPath, ['run', filePath]);
        expect(runResult.code).to.equal(0, `jac run command failed: ${runResult.commandError}`);

        // Verify program produces expected output
        const output = runResult.commandOutput;
        expect(output).to.include('Hello world!', 'Output should contain "Hello world!"');
        expect(output).to.include('Calculated 3', 'Output should contain "Calculated 3"');
        expect(output).to.include('Small number', 'Output should contain "Small number"');
    });

    it('should fail with a syntax error when running an invalid Jac file (bad.jac)', async function () {
        this.timeout(30_000);

        // Open bad.jac and make it the active editor (workspace file)
        const filePath = path.join(workspacePath, 'bad.jac');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc);

        // Sanity: ensure it's a real workspace file and active
        expect(doc.isUntitled).to.be.false;
        expect(vscode.workspace.getWorkspaceFolder(doc.uri)).to.exist;
        expect(vscode.window.activeTextEditor?.document.uri.fsPath).to.equal(filePath);

        // Use selected jac if available, otherwise fall back to venv jac path from earlier setup
        const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
        const envMgr = ext!.exports?.getEnvManager?.();
        const selectedJacPath: string = envMgr?.getJacPath?.() ?? jacExePath;

        // Run bad.jac directly (reliable; terminal output capture isn't)
        const runResult = await runCommand(selectedJacPath, ['run', filePath]);

        // Expect failure (syntax error or similar)
        expect(runResult.code).to.not.equal(0);

        // Expect some error text (could be in stderr or stdout depending on jac)
        const combined = `${runResult.commandOutput}\n${runResult.commandError}`.toLowerCase();
        expect(combined.length).to.be.greaterThan(0);
        expect(combined).to.match(/error|syntax|parse|exception/);
    });

    it('should uninstall venv jaclang, delete venv, and clear selection (No Env)', async function () {
        this.timeout(90_000);

        // Uninstall from venv (0 = ok, 2 = not installed is fine)
        const uninstallResult = await runCommand(venvPythonPath, ['-m', 'pip', 'uninstall', '-y', 'jaclang']);
        expect([0, 2]).to.include(uninstallResult.code);

        // Remove venv folder
        await fs.rm(temporaryVenvDirectory, { recursive: true, force: true });
        expect(await fileExists(temporaryVenvDirectory)).to.be.false;

        // Clear selected env in manager (in-memory + persisted)
        const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
        const envMgr = ext!.exports?.getEnvManager?.();

        await (envMgr as any)?.context?.globalState?.update?.('jacEnvPath', undefined);
        (envMgr as any).jacPath = undefined;
        envMgr?.updateStatusBar?.();

        const statusBar = envMgr?.getStatusBar?.();
        expect(statusBar?.text).to.include('No Env');
    });

    it('should install jaclang globally via pipx, then RUN_FILE falls back to global jac and runs', async function () {
        this.timeout(180_000);

        // Get pipx bin dir and prepend to PATH so "jac" is discoverable
        pipxBinDir = await getPipxBinDir();
        process.env.PATH = `${pipxBinDir}${path.delimiter}${originalPath}`;

        // Real install (pipx-managed venv, but global executable exposure)
        const install = await runCommand('pipx', ['install', '--force', 'jaclang']);
        expect(install.code).to.equal(0, install.commandError || install.commandOutput);

        // Verify jac is runnable via PATH
        const jacVersion = await runCommand('jac', ['--version']);
        expect(jacVersion.code).to.equal(0, jacVersion.commandError || jacVersion.commandOutput);

        // Ensure sample.jac active
        const filePath = path.join(workspacePath, 'sample.jac');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc);

        // Mock terminal and capture what extension sends
        const interactions = await mockTerminalAndCapture(async () => {
            await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
            await new Promise(r => setTimeout(r, 800));
        }, TERMINAL_NAME);

        // ✅ Verify extension sent the command to terminal
        expect(interactions.commands.length).to.be.greaterThan(0);
        const combined = interactions.commands.join('\n');
        expect(combined).to.include('run');
        expect(combined).to.include('sample.jac');

        // ✅ Also verify by running jac directly
        const runResult = await runCommand('jac', ['run', filePath]);
        expect(runResult.code).to.equal(0, runResult.commandError);
        expect(runResult.commandOutput).to.include('Hello world!');
        expect(runResult.commandOutput).to.include('Calculated 3');
        expect(runResult.commandOutput).to.include('Small number');
    });
    it('should uninstall global jaclang via pipx, then RUN_FILE fallback fails when no global jac exists (expect ENOENT)', async function () {
        this.timeout(180_000);

        // Uninstall (pipx-managed)
        const uninstall = await runCommand('pipx', ['uninstall', 'jaclang']);
        // pipx uninstall returns non-zero if not installed, so allow both:
        expect([0, 1]).to.include(uninstall.code);

        // Force PATH so "jac" cannot be found even if system has one:
        // Set PATH to ONLY pipxBinDir (where jaclang shim should now be gone).
        // If you want it even stricter, set PATH = ''.
        expect(pipxBinDir).to.be.a('string').and.to.have.length.greaterThan(0);
        process.env.PATH = pipxBinDir;

        // Prove jac is not runnable now (this is the "error" you wanted, no skipping)
        const check = await runCommand('jac', ['--version']);
        expect(check.code).to.equal(127);
        expect(check.commandError).to.include('ENOENT');

        // Ensure sample.jac active
        const filePath = path.join(workspacePath, 'sample.jac');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc);

        // Mock terminal and capture what extension sends (even when jac not found)
        const interactions = await mockTerminalAndCapture(async () => {
            await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
            await new Promise(r => setTimeout(r, 800));
        }, TERMINAL_NAME);

        // ✅ Verify extension still sends the command (doesn't crash)
        expect(interactions.commands.length).to.be.greaterThan(0);
        const combined = interactions.commands.join('\n');
        expect(combined).to.include('run');
        expect(combined).to.include('sample.jac');

        // Restore PATH (cleanup for next test)
        process.env.PATH = originalPath;
    });
});
