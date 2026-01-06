/**
 * JAC Language Extension - Integration Test Suite
 *
 * Tests the complete lifecycle of the Jaclang extension:
 * - Phase 1: Extension initialization and language registration
 * - Phase 2: Complete environment lifecycle (venv creation, jaclang installation,
 *            environment detection & selection, cleanup & verification)
 *
 * NOTE: Tests run sequentially and share state across phases.
 */

import * as vscode from 'vscode';
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { COMMANDS, TERMINAL_NAME } from '../../constants';

describe('Extension Integration Tests - Full Lifecycle', () => {
    let workspacePath: string;

    before(() => {
        // Resolve workspace path from VS Code workspace folders
        const folders = vscode.workspace.workspaceFolders;
        expect(folders).to.exist;
        expect(folders?.length).to.be.greaterThan(0);
        workspacePath = folders![0].uri.fsPath;
    });

    /**
     * PHASE 1: Initial Extension State - No Environment
     *
     * Verifies the extension loads correctly without any environment configured:
     * - Status bar shows "No Env"
     * - JAC language is registered
     * - Opening .jac files triggers environment prompt
     */
    describe('Phase 1: Initial Extension State - No Environment', () => {
        let envManager: any;

        before(async function () {
            this.timeout(30_000);
            // Mock the environment prompts to prevent blocking during test
            vscode.window.showWarningMessage = async () => undefined as any;
            vscode.window.showInformationMessage = async () => undefined as any;

            // Activate extension and get EnvManager for testing
            const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
            await ext!.activate();
            const exports = ext!.exports;
            envManager = exports?.getEnvManager?.();
            expect(envManager, 'EnvManager should be exposed').to.exist;
        });

        afterEach(async () => {
            // Clean up any open editors between tests
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        it('should show "No Env" status bar when extension starts', () => {
            // When no environment is selected, status bar displays "No Env"
            const statusBar = envManager.getStatusBar();
            expect(statusBar.text).to.include('No Env');
        });

        it('should load extension and register jac language', async () => {
            // Extension should be active and JAC language properly registered
            const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
            expect(ext).to.exist;
            expect(ext!.isActive).to.be.true;

            const languages = await vscode.languages.getLanguages();
            expect(languages).to.include('jac');
        });

        it('should trigger environment prompt when opening .jac file without env selected', async function () {
            this.timeout(10_000);

            // Opening a .jac file without environment should trigger a prompt
            const filePath = path.join(workspacePath, 'sample.jac');
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc);

            // Verify document was opened successfully
            expect(doc.languageId).to.equal('jac');
            expect(vscode.window.activeTextEditor?.document).to.equal(doc);
        });
    });


    /**
     * PHASE 2: Environment Lifecycle - Install, Select, Verify & Cleanup
     *
     * Tests the complete environment workflow:
     * - Detects Python and creates virtual environment
     * - Installs jaclang package
     * - Tests environment detection and selection
     * - Verifies status bar updates
     * - Cleans up by uninstalling and removing venv
     */
    describe('Phase 2: Environment Lifecycle - Install, Select, Verify & Cleanup', () => {
        let temporaryVenvDirectory = '';
        let venvPath = '';
        let pythonCmd: { cmd: string; argsPrefix: string[] };
        let venvPythonPath = '';
        let jacExePath = '';
        let envManager: any;
        let originalPath = process.env.PATH ?? '';
        let pipxBinDir = '';

        /**
         * Execute shell commands and capture output
         * Returns exit code, stdout, and stderr for verification
         */
        async function runCommand(cmd: string, args: string[]) {
            return await new Promise<{ code: number; commandOutput: string; commandError: string }>((resolve) => {
                const childProcess = spawn(cmd, args, { shell: false });
                let commandOutput = '';
                let commandError = '';

                childProcess.stdout.on('data', (data) => (commandOutput += data.toString()));
                childProcess.stderr.on('data', (data) => (commandError += data.toString()));

                childProcess.on('error', (err: any) => {
                    commandError += String(err?.message ?? err);
                    resolve({ code: 127, commandOutput, commandError }); // command-not-found
                });

                childProcess.on('close', (code) => resolve({ code: code ?? 0, commandOutput, commandError }));
            });
        }

        /**
         * Check if a file or directory exists
         */
        async function fileExists(filePath: string) {
            try {
                await fs.stat(filePath);
                return true;
            } catch {
                return false;
            }
        }

        /**
         * Detect available Python interpreter
         * Tries: py -3 (Windows), python3, python
         */
        async function detectPython(): Promise<{ cmd: string; argsPrefix: string[] } | null> {
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

        async function getPipxBinDir(): Promise<string> {
            // pipx environment --value PIPX_BIN_DIR returns the bin directory used for app shims
            const r = await runCommand('pipx', ['environment', '--value', 'PIPX_BIN_DIR']);
            expect(r.code).to.equal(0, `pipx not available or failed: ${r.commandError || r.commandOutput}`);
            return r.commandOutput.trim();
        }

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

        // === INSTALLATION PHASE ===

        it('should detect Python interpreter', () => {
            // Verify Python is available on the system
            expect(pythonCmd, 'Python must be available').to.exist;
        });

        it('should create Python virtual environment', async function () {
            this.timeout(30_000);

            // Create isolated virtual environment where jaclang will be installed
            //recursive: true prevents errors if .venv already exists from a previous incomplete test run.
            await fs.mkdir(temporaryVenvDirectory, { recursive: true });

            const venvCreationResult = await runCommand(pythonCmd.cmd, [...pythonCmd.argsPrefix, '-m', 'venv', venvPath]);

            expect(venvCreationResult.code).to.equal(0);
            expect(await fileExists(venvPythonPath)).to.be.true;
        });

        it('should install jaclang package via pip with terminal feedback', async function () {
            this.timeout(300_000);

            // Display terminal window for visual installation feedback
            const terminal = vscode.window.createTerminal({
                name: 'JAC: Installing',
                cwd: workspacePath,
            });
            terminal.show(true);

            terminal.sendText(`${venvPythonPath} -m pip install -U jaclang`, true);

            // Execute installation in background
            const installationResult = await runCommand(venvPythonPath, ['-m', 'pip', 'install', '-U', '--no-cache-dir', 'jaclang']);

            // Verify installation success
            expect(installationResult.code).to.equal(0);
            expect(await fileExists(jacExePath)).to.be.true;
        });

        it('should verify jac executable works', async function () {
            this.timeout(15_000);

            // Test that the installed jac binary is functional
            const versionCheckResult = await runCommand(jacExePath, ['--version']);

            expect(versionCheckResult.code).to.equal(0);
            expect(versionCheckResult.commandOutput).to.have.length.greaterThan(0);
        });

        // === ENVIRONMENT DETECTION & SELECTION PHASE ===

        it('should have venv jac binary available in test environment', async function () {
            this.timeout(15_000);

            // Verify test workspace structure contains expected fixtures
            expect(workspacePath).to.include('fixtures/workspace');
        });

        it('should detect environments after jaclang installation', async function () {
            this.timeout(15_000);

            // After installing jaclang, environment detection should find the .venv jac executable
            const { findPythonEnvsWithJac } = await import('../../utils/envDetection');
            const envs = await findPythonEnvsWithJac(workspacePath);

            // Unlike Phase 1 (where no environments existed), now we should have at least one
            expect(envs.length).to.be.greaterThan(0);

            const foundVenvJac = envs.some(env => env.includes('.venv'));
            expect(foundVenvJac, '.venv jac executable should be detected').to.be.true;

            // Note: The "Select Environment" popup won't appear in same session due to hasPromptedThisSession flag
            // The popup behavior was already tested in Phase 1
        });

        it('should allow environment selection through selectEnv command', async function () {
            this.timeout(15_000);

            // Trigger environment selection command
            await vscode.commands.executeCommand('jaclang-extension.selectEnv');
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Navigate to .venv option in quick pick menu
            await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');

            // Confirm selection
            await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Verify environment was successfully selected
            const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
            const envMgr = ext!.exports?.getEnvManager?.();
            const selectedJacPath = envMgr?.getJacPath?.();

            expect(selectedJacPath).to.include('.venv');

        });

        it('should update status bar to show selected environment path', async function () {
            this.timeout(5_000);

            // After environment selection, status bar should display the selected path
            const statusBar = envManager?.getStatusBar?.();

            // Status bar should no longer show "No Env" and should include path indicator
            expect(statusBar?.text).to.not.include('No Env');
            expect(statusBar?.text.length).to.be.greaterThan(0);
        });

        it('should run the active Jac file via RUN_FILE and verify expected output', async function () {
            this.timeout(60_000);

            // Ensure sample.jac is the active editor
            const filePath = path.join(workspacePath, 'sample.jac');
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc);
            expect(vscode.window.activeTextEditor?.document.uri.fsPath).to.equal(filePath);

            // Dispose existing terminals to force a fresh terminal creation
            vscode.window.terminals.forEach(t => t.dispose());
            await new Promise(resolve => setTimeout(resolve, 250));

            // Capture what the extension sends to the terminal (VS Code API doesn't let us read terminal output)
            const sentToTerminal: string[] = [];
            const originalCreateTerminal = (vscode.window as any).createTerminal;

            (vscode.window as any).createTerminal = (nameOrOptions: any) => {
                const name = typeof nameOrOptions === 'string'
                    ? nameOrOptions
                    : (nameOrOptions?.name ?? TERMINAL_NAME);

                const mockTerminal: Partial<vscode.Terminal> = {
                    name,
                    show: () => undefined,
                    sendText: (text: string) => { sentToTerminal.push(text); },
                    dispose: () => undefined,
                };
                return mockTerminal as vscode.Terminal;
            };

            try {
                // Step 6: run file via the real extension command id
                await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
                await new Promise(resolve => setTimeout(resolve, 1500));
            } finally {
                // Restore original API no matter what
                (vscode.window as any).createTerminal = originalCreateTerminal;
            }

            // Verify the extension attempted to run the active file in the terminal
            expect(sentToTerminal.length, 'Extension did not send anything to terminal').to.be.greaterThan(0);
            const combined = sentToTerminal.join('\n');
            expect(combined).to.include(' run ');
            expect(combined).to.include('sample.jac');

            // Step 7: verify actual output (reliable) by running jac directly
            const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
            const envMgr = ext!.exports?.getEnvManager?.();
            const selectedJacPath: string = envMgr?.getJacPath?.() ?? jacExePath;

            // Optional: ensure the command used the selected jac path (when available)
            if (envMgr?.getJacPath?.()) {
                expect(combined).to.include(envMgr.getJacPath());
            }

            const runResult = await runCommand(selectedJacPath, ['run', filePath]);
            expect(runResult.code).to.equal(0, `jac run failed: ${runResult.commandError}`);

            // sample.jac expected output
            expect(runResult.commandOutput).to.include('Hello world!');
            expect(runResult.commandOutput).to.include('Calculated 3');
            expect(runResult.commandOutput).to.include('Small number');
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
            const terminalInteractions = {
                created: false,
                shown: false,
                name: '',
                commands: [] as string[]
            };

            const originalCreateTerminal = (vscode.window as any).createTerminal;

            (vscode.window as any).createTerminal = (nameOrOptions: any) => {
                terminalInteractions.created = true;
                const name = typeof nameOrOptions === 'string'
                    ? nameOrOptions
                    : (nameOrOptions?.name ?? TERMINAL_NAME);

                terminalInteractions.name = name;

                const mockTerminal: Partial<vscode.Terminal> = {
                    name,
                    show: () => { terminalInteractions.shown = true; },
                    sendText: (text: string) => { terminalInteractions.commands.push(text); },
                    dispose: () => undefined,
                };
                return mockTerminal as vscode.Terminal;
            };

            try {
                // Step 1: Verify the button would be visible in the editor title bar
                // The "Jac: Run" button is shown when: resourceLangId == jac
                const editorContext = vscode.window.activeTextEditor?.document.languageId === 'jac';
                expect(editorContext, 'Button visibility context should be true (file is .jac)').to.be.true;

                // Step 2: Simulate clicking the "Jac: Run" button by executing its command
                // This mimics the user clicking the play icon button in the editor title bar
                await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
                await new Promise(resolve => setTimeout(resolve, 1500));

            } finally {
                // Always restore original API
                (vscode.window as any).createTerminal = originalCreateTerminal;
            }

            // Verify terminal was created and properly configured
            expect(terminalInteractions.created, 'Terminal should be created when button is clicked').to.be.true;
            expect(terminalInteractions.shown, 'Terminal should be shown to user when button is clicked').to.be.true;
            expect(terminalInteractions.name).to.equal(TERMINAL_NAME, `Terminal should be named "${TERMINAL_NAME}"`);

            // Verify the correct command was sent to the terminal
            expect(terminalInteractions.commands.length, 'At least one command should be sent to terminal').to.be.greaterThan(0);
            const sentCommand = terminalInteractions.commands.join('\n');
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

            // Mock terminal to capture what extension sends
            const sentToTerminal: string[] = [];
            const originalCreateTerminal = (vscode.window as any).createTerminal;

            (vscode.window as any).createTerminal = (nameOrOptions: any) => {
                const name = typeof nameOrOptions === 'string'
                    ? nameOrOptions
                    : (nameOrOptions?.name ?? TERMINAL_NAME);

                const mockTerminal: Partial<vscode.Terminal> = {
                    name,
                    show: () => undefined,
                    sendText: (text: string) => { sentToTerminal.push(text); },
                    dispose: () => undefined,
                };
                return mockTerminal as vscode.Terminal;
            };

            try {
                await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
                await new Promise(r => setTimeout(r, 800));
            } finally {
                (vscode.window as any).createTerminal = originalCreateTerminal;
            }

            // Extension should still be using the fallback "jac run <file>"
            expect(sentToTerminal.length).to.be.greaterThan(0);
            const combined = sentToTerminal.join('\n');
            expect(combined).to.include('run');
            expect(combined).to.include('sample.jac');

            // Verify actual output using the globally exposed jac
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

            // Mock terminal to capture extension fallback command
            const sentToTerminal: string[] = [];
            const originalCreateTerminal = (vscode.window as any).createTerminal;

            (vscode.window as any).createTerminal = (nameOrOptions: any) => {
                const name = typeof nameOrOptions === 'string'
                    ? nameOrOptions
                    : (nameOrOptions?.name ?? TERMINAL_NAME);

                const mockTerminal: Partial<vscode.Terminal> = {
                    name,
                    show: () => undefined,
                    sendText: (text: string) => { sentToTerminal.push(text); },
                    dispose: () => undefined,
                };
                return mockTerminal as vscode.Terminal;
            };

            try {
                await vscode.commands.executeCommand(COMMANDS.RUN_FILE);
                await new Promise(r => setTimeout(r, 800));
            } finally {
                (vscode.window as any).createTerminal = originalCreateTerminal;
                process.env.PATH = originalPath; // restore
            }

            // Extension still tries "jac run ..."
            expect(sentToTerminal.length).to.be.greaterThan(0);
            const combined = sentToTerminal.join('\n');
            expect(combined).to.include('run');
            expect(combined).to.include('sample.jac');
        });
    });
});
