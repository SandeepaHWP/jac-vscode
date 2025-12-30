/**
 * Mocha Test Suite Entry Point (Test Mode)
 * Configures and runs all integration tests in VS Code
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import * as vscode from 'vscode';

declare global {
	var testContext: vscode.ExtensionContext;
	var testWorkspacePath: string;
}

export async function run(context?: vscode.ExtensionContext): Promise<void> {
	global.testContext = context!;

	const workspaceFolders = vscode.workspace.workspaceFolders;
	global.testWorkspacePath = workspaceFolders?.[0]?.uri.fsPath || '';

	console.log('\n📁 Test Environment:');
	console.log(`   Extension Path: ${context?.extensionPath || 'N/A'}`);
	console.log(`   Workspace: ${global.testWorkspacePath || 'N/A'}`);

	const mocha = new Mocha({
		ui: 'bdd',
		color: true,
		timeout: 10000,
		reporter: 'spec',
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((resolve, reject) => {
		glob('**/**.test.js', { cwd: testsRoot })
			.then((files) => {
				console.log(`\n🧪 Found ${files.length} test file(s)`);

				files.forEach(f => {
					const filePath = path.resolve(testsRoot, f);
					console.log(`   → ${f}`);
					mocha.addFile(filePath);
				});

				try {
					console.log('\n▶️  Running tests...\n');
					mocha.run(failures => {
						if (failures > 0) {
							console.log(`\n❌ ${failures} test(s) failed`);
							reject(new Error(`${failures} tests failed.`));
						} else {
							console.log('\n✓ All tests passed');
							resolve();
						}
					});
				} catch (err) {
					console.error(err);
					reject(err);
				}
			})
			.catch((err) => {
				reject(err);
			});
	});
}

